'use client';

/**
 * Notas fiscais emitidas.
 *
 * Nota não se apaga: cancela. A linha continua aqui com o motivo e a data,
 * porque a prefeitura tem o documento do outro lado e o histórico precisa
 * bater com o dela.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Download, FileCode, RefreshCw, Pencil } from 'lucide-react';

import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { lerErroNota } from '@/lib/nfse-simples';
import { somaPor } from '@/lib/money';
import type { NotaFiscal, StatusNota } from '@/lib/nfse-tipos';

const ROTULO: Record<StatusNota, string> = {
  RASCUNHO: 'Rascunho',
  PROCESSANDO: 'Na prefeitura',
  AUTORIZADA: 'Autorizada',
  REJEITADA: 'Recusada',
  CANCELADA: 'Cancelada',
};

const COR: Record<StatusNota, string> = {
  RASCUNHO: 'text-[var(--fin-text-3)]',
  PROCESSANDO: 'text-[var(--fin-warning-text)]',
  AUTORIZADA: 'text-[var(--fin-positive)]',
  REJEITADA: 'text-[var(--fin-negative)]',
  CANCELADA: 'text-[var(--fin-text-3)]',
};

export default function NotasFiscaisPage() {
  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [cancelando, setCancelando] = useState<NotaFiscal | null>(null);
  const [motivo, setMotivo] = useState('');
  const [processando, setProcessando] = useState(false);
  const [baixando, setBaixando] = useState('');
  const [corrigindo, setCorrigindo] = useState<NotaFiscal | null>(null);
  const [novaDescricao, setNovaDescricao] = useState('');
  // Filtros da busca. Data por intervalo porque "de tal dia a tal dia" é a
  // pergunta que a contabilidade faz; cliente por texto porque ninguém
  // lembra a razão social inteira.
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [buscaCliente, setBuscaCliente] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODAS');

  const CAMPO_CLASSE = 'h-9 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch('/api/fiscal/notas');
      const corpo = await res.json();
      if (!res.ok) { setErro(corpo?.error || 'Não foi possível carregar.'); return; }
      setNotas(corpo as NotaFiscal[]);
      setErro('');
    } catch {
      setErro('Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /** Pergunta ao emissor em que pé está uma nota que ficou processando. */
  async function atualizar(nota: NotaFiscal) {
    const res = await fetch(`/api/fiscal/notas/${nota.id}`);
    const corpo = await res.json();
    if (!res.ok) { toast.error('Não foi possível consultar', corpo?.error || ''); return; }
    const atualizada = corpo as NotaFiscal;
    setNotas(lista => lista.map(n => (n.id === atualizada.id ? atualizada : n)));
    toast.success(`Situação: ${ROTULO[atualizada.status]}`, atualizada.erro || '');
  }

  /**
   * Baixa pelo servidor, que é quem tem a credencial do emissor.
   *
   * Um <a download> apontando para o emissor voltaria 401, e um link nosso
   * abriria uma aba em branco quando o emissor recusasse. Aqui o erro chega
   * como JSON e vira aviso na tela, em vez de sumir.
   */
  async function baixar(nota: NotaFiscal, tipo: 'pdf' | 'xml') {
    const chave = `${nota.id}-${tipo}`;
    if (baixando) return;
    setBaixando(chave);
    try {
      const res = await fetch(`/api/fiscal/notas/${nota.id}/documento?tipo=${tipo}`);
      if (!res.ok) {
        const corpo = await res.json().catch(() => null);
        toast.error(
          `Não foi possível baixar o ${tipo.toUpperCase()}`,
          corpo?.error || '',
        );
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NFSe-${nota.numero || nota.id}.${tipo}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Sem revogar, o blob fica na memória da aba até recarregar a página.
      URL.revokeObjectURL(url);
    } catch {
      toast.error(`Não foi possível baixar o ${tipo.toUpperCase()}`);
    } finally {
      setBaixando('');
    }
  }

  async function confirmarCancelamento() {
    if (!cancelando || processando) return;
    setProcessando(true);
    try {
      const res = await fetch(`/api/fiscal/notas/${cancelando.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      });
      const corpo = await res.json();
      if (!res.ok) { toast.error('A nota não foi cancelada', corpo?.error || ''); return; }
      setNotas(lista => lista.map(n => (n.id === corpo.id ? (corpo as NotaFiscal) : n)));
      setCancelando(null);
      setMotivo('');
      toast.success('Nota cancelada');
    } finally {
      setProcessando(false);
    }
  }

  const autorizadas = useMemo(() => notas.filter(n => n.status === 'AUTORIZADA'), [notas]);
  const pendentes = useMemo(() => notas.filter(n => n.status === 'PROCESSANDO'), [notas]);
  const recusadas = useMemo(() => notas.filter(n => n.status === 'REJEITADA'), [notas]);

  /**
   * Notas que passam no filtro.
   *
   * O recorte é por data de EMISSÃO, que é o que a prefeitura e a
   * contabilidade usam como referência. Nota ainda sem data de emissão
   * (rascunho ou recusada) só aparece quando não há filtro de data, senão
   * ela sumiria justamente quando se procura o que deu errado.
   */
  const notasFiltradas = useMemo(() => {
    const alvo = buscaCliente.trim().toLowerCase();
    return notas.filter(n => {
      if (filtroStatus !== 'TODAS' && n.status !== filtroStatus) return false;

      const dia = n.emitida_em ? n.emitida_em.slice(0, 10) : '';
      if (de || ate) {
        if (!dia) return false;
        if (de && dia < de) return false;
        if (ate && dia > ate) return false;
      }

      if (alvo) {
        const campos = [
          n.tomador?.razao_social ?? '',
          n.tomador?.cpf_cnpj ?? '',
          n.numero ?? '',
        ].join(' ').toLowerCase();
        if (!campos.includes(alvo)) return false;
      }
      return true;
    });
  }, [notas, de, ate, buscaCliente, filtroStatus]);

  const filtrando = Boolean(de || ate || buscaCliente.trim() || filtroStatus !== 'TODAS');

  /**
   * Corrigir uma nota.
   *
   * Nota autorizada NÃO se edita: a prefeitura não tem esse conceito. O que
   * existe é substituir, que é cancelar e emitir outra. São dois passos
   * contra a prefeitura, e o segundo pode falhar depois do primeiro dar
   * certo: nesse caso a parcela fica SEM nota, e a tela precisa dizer isso
   * com todas as letras, em vez de um erro genérico.
   *
   * Nota recusada nunca chegou a valer, então não há o que cancelar: emite
   * de novo direto.
   */
  async function confirmarCorrecao() {
    if (!corrigindo || processando) return;
    const nota = corrigindo;
    const precisaCancelar = nota.status === 'AUTORIZADA';

    if (precisaCancelar && motivo.trim().length < 15) {
      toast.error('Escreva o motivo', 'A prefeitura exige pelo menos 15 caracteres.');
      return;
    }
    if (!nota.conta_receber_id) {
      toast.error('Não dá para substituir esta nota', 'Ela não está ligada a nenhuma parcela.');
      return;
    }

    setProcessando(true);
    let cancelou = false;
    try {
      if (precisaCancelar) {
        const res = await fetch(`/api/fiscal/notas/${nota.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ motivo: motivo.trim() }),
        });
        const corpo = await res.json();
        if (!res.ok) {
          toast.error('A nota não foi cancelada', corpo?.error || 'A prefeitura recusou o cancelamento.');
          return;
        }
        cancelou = true;
      }

      const res = await fetch('/api/fiscal/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contaId: nota.conta_receber_id,
          regime: nota.regime,
          discriminacao: novaDescricao.trim() || undefined,
        }),
      });
      const corpo = await res.json();
      if (!res.ok) {
        // O ponto que não pode ser escondido: a antiga já foi cancelada.
        toast.error(
          cancelou ? 'A nota antiga foi cancelada, mas a nova NÃO saiu' : 'A nota não foi emitida',
          cancelou
            ? `${corpo?.error || 'A prefeitura recusou.'} A parcela está sem nota: corrija o que falta e emita de novo em Contas a receber.`
            : (corpo?.error || ''),
        );
        return;
      }

      const nova = corpo as NotaFiscal;
      if (nova.status === 'REJEITADA') {
        toast.error('A prefeitura recusou a nota nova', lerErroNota(nova.erro).explicacao || nova.erro || '');
      } else {
        toast.success(
          cancelou ? 'Nota substituída' : 'Nota reenviada',
          nova.numero ? `Nova nota ${nova.numero}` : 'A prefeitura está processando.',
        );
      }
      setCorrigindo(null);
      void carregar();
    } finally {
      setProcessando(false);
    }
  }

  /**
   * Colunas enxutas de propósito.
   *
   * A soma das larguras mínimas dava 1080px, então em notebook de 1280px a
   * tabela rolava para o lado e a coluna de Ações, que fica na ponta,
   * saía da tela. O botão de cancelar existia e ninguém via.
   *
   * Regime e ISS deixaram de ser coluna: viraram sublinha de quem já
   * estava ali. Coluna própria para dado secundário custa largura, e
   * largura é o que estava faltando.
   */
  const colunas: FinColuna<NotaFiscal>[] = [
    {
      id: 'tomador',
      cabecalho: 'Cliente e nota',
      tipo: 'texto',
      minWidth: 200,
      acessor: n => n.tomador?.razao_social || '',
      render: n => (
        <span className="flex min-w-0 flex-col">
          <span className="fin-t-body-strong truncate text-[var(--fin-text)]">
            {n.tomador?.razao_social || 'Cliente não informado'}
          </span>
          <span className="fin-t-caption truncate text-[var(--fin-text-3)]">
            {n.numero ? `Nota ${n.numero}` : 'Sem número ainda'}
            {n.regime === 'INTERMEDIACAO' ? ' · intermediação' : ''}
            {n.ambiente === 'HOMOLOGACAO' ? ' · homologação' : ''}
          </span>
          {n.erro ? (
            <span className="fin-t-caption text-[var(--fin-negative)]">{n.erro}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'emissao',
      cabecalho: 'Emitida em',
      tipo: 'data',
      minWidth: 104,
      prioridade: 2,
      valor: n => (n.emitida_em ? n.emitida_em.slice(0, 10) : null),
    },
    {
      id: 'valor',
      cabecalho: 'Serviço',
      tipo: 'dinheiro',
      minWidth: 120,
      valor: n => n.valor_servicos,
      // ISS como sublinha, não como coluna: é consulta, não comparação.
      sub: n => (n.valor_iss > 0
        ? <>ISS {n.valor_iss.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</>
        : null),
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      tipo: 'texto',
      minWidth: 110,
      acessor: n => n.status,
      render: n => (
        <span className="flex min-w-0 flex-col">
          <span className={`fin-t-body-strong ${COR[n.status]}`}>{ROTULO[n.status]}</span>
          {/* Em telas estreitas a data some da coluna própria e reaparece
              aqui, para a informação não sumir junto com a largura. */}
          {n.emitida_em ? (
            <span className="fin-t-caption text-[var(--fin-text-3)] min-[900px]:hidden">
              {n.emitida_em.slice(0, 10).split('-').reverse().join('/')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      minWidth: 168,
      render: n => (
        <>
          {n.status === 'PROCESSANDO' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Consultar a situação da nota ${n.numero || ''}`}
              title="Consultar a situação na prefeitura"
              onClick={() => { void atualizar(n); }}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
          {n.status === 'AUTORIZADA' || n.status === 'CANCELADA' ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Baixar o PDF da nota ${n.numero || ''}`}
                title="Baixar a nota em PDF"
                onClick={() => { void baixar(n, 'pdf'); }}
                disabled={baixando === `${n.id}-pdf`}
              >
                <Download aria-hidden="true" className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Baixar o XML da nota ${n.numero || ''}`}
                title="Baixar o XML, que é o arquivo da contabilidade"
                onClick={() => { void baixar(n, 'xml'); }}
                disabled={baixando === `${n.id}-xml`}
              >
                <FileCode aria-hidden="true" className="size-4" />
              </Button>
            </>
          ) : null}
          {/* Substituir: cancela e emite outra com o texto corrigido. Nota
              autorizada não se edita, por lei; o que existe é substituição. */}
          {n.status === 'AUTORIZADA' || n.status === 'REJEITADA' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Corrigir a nota ${n.numero || ''}`}
              title={n.status === 'AUTORIZADA'
                ? 'Corrigir: cancela esta nota e emite outra no lugar'
                : 'Corrigir a descrição e enviar de novo'}
              onClick={() => {
                setCorrigindo(n);
                setNovaDescricao(n.discriminacao || '');
                setMotivo('');
              }}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
          {n.status !== 'CANCELADA' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Cancelar a nota ${n.numero || ''}`}
              title="Cancelar a nota na prefeitura"
              onClick={() => { setCancelando(n); setMotivo(''); }}
            >
              <Ban aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <PageShell width="full" padding="md" gap="md" className="max-w-[1280px]">
      <PageHeader
        titulo="Notas fiscais"
        subtitulo="As notas de serviço emitidas a partir dos recebimentos confirmados."
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={{ mensagem: erro, onTentarDeNovo: () => { void carregar(); } }}
        esqueleto={<div className="fin-t-body text-[var(--fin-text-3)]">Carregando…</div>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            rotulo="Serviço autorizado"
            valor={somaPor(autorizadas, n => n.valor_servicos)}
            estado="ok"
            contexto={`${autorizadas.length} nota(s) autorizada(s).`}
            explicacao="Soma do valor de serviço das notas que a prefeitura autorizou. Não é o valor das vendas: é o que a agência declarou como receita própria."
          />
          <MetricCard
            rotulo="ISS das notas"
            valor={somaPor(autorizadas, n => n.valor_iss)}
            estado="ok"
            contexto="Imposto sobre serviço destacado nas notas autorizadas."
            explicacao="Total de ISS das notas autorizadas no período carregado."
          />
          <MetricCard
            rotulo="Aguardando prefeitura"
            valor={somaPor(pendentes, n => n.valor_servicos)}
            estado="ok"
            tone={recusadas.length > 0 ? 'negativo' : 'neutro'}
            contexto={
              recusadas.length > 0
                ? `${pendentes.length} em processamento e ${recusadas.length} recusada(s).`
                : `${pendentes.length} nota(s) em processamento.`
            }
            explicacao="Notas enviadas que a prefeitura ainda não respondeu. Use Consultar para atualizar a situação."
          />
        </div>
      </DataState>

      {/* Busca. Envolve em flex-wrap para nunca empurrar a largura: é
          justamente o que criava rolagem lateral nesta tela. */}
      <div className="flex flex-wrap items-end gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <label htmlFor="nf-cliente" className="fin-t-overline text-[var(--fin-text-3)]">Cliente</label>
          <input
            id="nf-cliente"
            type="search"
            value={buscaCliente}
            onChange={e => setBuscaCliente(e.target.value)}
            placeholder="Nome, CNPJ ou número da nota"
            className={CAMPO_CLASSE}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nf-de" className="fin-t-overline text-[var(--fin-text-3)]">Emitida de</label>
          <input id="nf-de" type="date" value={de} onChange={e => setDe(e.target.value)}
                 className={`${CAMPO_CLASSE} tabular-nums`} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nf-ate" className="fin-t-overline text-[var(--fin-text-3)]">até</label>
          <input id="nf-ate" type="date" value={ate} onChange={e => setAte(e.target.value)}
                 className={`${CAMPO_CLASSE} tabular-nums`} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nf-situacao" className="fin-t-overline text-[var(--fin-text-3)]">Situação</label>
          <select id="nf-situacao" value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                  className={CAMPO_CLASSE}>
            <option value="TODAS">Todas</option>
            {(Object.keys(ROTULO) as (keyof typeof ROTULO)[]).map(k => (
              <option key={k} value={k}>{ROTULO[k]}</option>
            ))}
          </select>
        </div>
        {filtrando ? (
          <div className="flex items-center gap-2">
            <span className="fin-t-caption text-[var(--fin-text-3)]">
              {notasFiltradas.length} de {notas.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setDe(''); setAte(''); setBuscaCliente(''); setFiltroStatus('TODAS'); }}
            >
              Limpar
            </Button>
          </div>
        ) : null}
      </div>

      <FinTable<NotaFiscal>
        linhas={notasFiltradas}
        colunas={colunas}
        chave={n => n.id}
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={{ mensagem: erro, onTentarDeNovo: () => { void carregar(); } }}
        vazio={filtrando ? {
          motivo: 'sem-resultado',
          titulo: 'Nenhuma nota com esse filtro',
          oQueE: 'Existem notas cadastradas, mas nenhuma bate com o que você procurou.',
          acao: {
            rotulo: 'Limpar filtros',
            onClick: () => { setDe(''); setAte(''); setBuscaCliente(''); setFiltroStatus('TODAS'); },
          },
        } : {
          motivo: 'sem-dado',
          titulo: 'Nenhuma nota emitida',
          oQueE:
            'As notas nascem em Contas a receber: quando um recebimento é confirmado, aparece o botão Emitir nota naquela parcela.',
          comoComeca: [
            'Configure o emissor e envie o certificado em Configurações › Nota fiscal.',
            'Confirme o recebimento de uma parcela em Contas a receber.',
            'Clique em Emitir nota e confira os valores antes de transmitir.',
          ],
        }}
      />

      <ConfirmDialog
        aberto={Boolean(cancelando)}
        onOpenChange={a => { if (!a) setCancelando(null); }}
        titulo="Cancelar esta nota fiscal"
        oQueVaiAcontecer="A nota é cancelada na prefeitura e continua no histórico, com o motivo e a data. Não dá para desfazer."
        detalhes={
          cancelando
            ? [
                { rotulo: 'Tomador', valor: cancelando.tomador?.razao_social || 'Não informado' },
                { rotulo: 'Nota', valor: cancelando.numero || 'Sem número' },
                { rotulo: 'Valor', valor: <Money valor={cancelando.valor_servicos} size="strong" estado="ok" /> },
                {
                  rotulo: 'Motivo',
                  valor: (
                    <Input
                      value={motivo}
                      onChange={e => setMotivo(e.target.value)}
                      placeholder="A prefeitura exige o motivo"
                      aria-label="Motivo do cancelamento"
                    />
                  ),
                },
              ]
            : undefined
        }
        confirmarRotulo="Cancelar nota"
        tone="destrutivo"
        processando={processando}
        onConfirmar={() => { void confirmarCancelamento(); }}
      />

      <ConfirmDialog
        aberto={Boolean(corrigindo)}
        onOpenChange={a => { if (!a) setCorrigindo(null); }}
        titulo={corrigindo?.status === 'AUTORIZADA' ? 'Substituir esta nota' : 'Corrigir e enviar de novo'}
        oQueVaiAcontecer={
          corrigindo?.status === 'AUTORIZADA'
            ? 'Nota autorizada não se altera: a prefeitura não tem esse conceito. O que acontece aqui é substituição, ou seja, esta nota é cancelada e outra é emitida no lugar, com a descrição corrigida.'
            : 'Esta nota foi recusada, então nada precisa ser cancelado. Uma nova é enviada com a descrição corrigida.'
        }
        detalhes={
          corrigindo
            ? [
                { rotulo: 'Tomador', valor: corrigindo.tomador?.razao_social || 'Não informado' },
                { rotulo: 'Nota', valor: corrigindo.numero || 'Sem número' },
                {
                  rotulo: 'Valor do serviço',
                  valor: <Money valor={corrigindo.valor_servicos} size="strong" estado="ok" />,
                },
              ]
            : undefined
        }
        previa={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="nf-descricao" className="fin-t-overline text-[var(--fin-text-3)]">
                Descrição do serviço na nota
              </label>
              <Input
                id="nf-descricao"
                value={novaDescricao}
                onChange={e => setNovaDescricao(e.target.value)}
                placeholder="O que a prefeitura vai imprimir na nota"
              />
            </div>

            {corrigindo?.status === 'AUTORIZADA' ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="nf-motivo-sub" className="fin-t-overline text-[var(--fin-text-3)]">
                  Motivo do cancelamento
                </label>
                <Input
                  id="nf-motivo-sub"
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  placeholder="A prefeitura exige pelo menos 15 caracteres"
                />
                <span className={`fin-t-caption ${motivo.trim().length >= 15 ? 'text-[var(--fin-text-3)]' : 'text-[var(--fin-warning-text)]'}`}>
                  {motivo.trim().length} de 15 caracteres
                </span>
              </div>
            ) : null}

            {/* O valor não é campo livre: sai da parcela. Dizer isso evita
                a pessoa procurar um campo que não existe. */}
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              O valor do serviço vem da parcela em Contas a receber e não se digita aqui. Para
              mudá-lo, ajuste a parcela e depois substitua a nota.
            </p>

            {corrigindo?.status === 'AUTORIZADA' ? (
              <p className="fin-t-caption text-[var(--fin-warning-text)]">
                São dois passos na prefeitura. Se o cancelamento passar e a nova nota for recusada,
                a parcela fica sem nota, e o aviso vai dizer exatamente isso.
              </p>
            ) : null}
          </div>
        }
        confirmarRotulo={corrigindo?.status === 'AUTORIZADA' ? 'Cancelar e emitir a nova' : 'Enviar de novo'}
        tone={corrigindo?.status === 'AUTORIZADA' ? 'destrutivo' : undefined}
        processando={processando}
        onConfirmar={() => { void confirmarCorrecao(); }}
      />
    </PageShell>
  );
}
