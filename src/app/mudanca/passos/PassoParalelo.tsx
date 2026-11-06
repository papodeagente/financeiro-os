'use client';

import * as React from 'react';
import { FileDown, FileSpreadsheet, RefreshCw, Scale, Upload } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Segmentado } from '@/components/fin/Segmentado';
import { StatusChip } from '@/components/fin/StatusChip';
import {
  api, chaveDeIdempotencia, type ArquivoDoLote, type Comparacao, type GrupoComparado, type ParComparado, type RelatorioDoMes,
  type SecaoComparada, type TipoDaComparacao,
} from '@/lib/migracao/contrato-telas';
import { dataBR, nomeDoMes, rotuloDaLista } from '@/lib/migracao/telas/assistente';
import { toast } from '@/lib/toast';
import { cn, formatBRL } from '@/lib/utils';

import { BarraDoPasso, CabecaDoPasso, CONTROLE, PAINEL, plural, textoDoErro, type PropsDoPasso } from '../pecas';

type Filtro = 'diferentes' | TipoDaComparacao;
type Grupo = 'por_conta' | 'por_pessoa' | 'por_categoria';

/** O mês seguinte ao da data de corte: o primeiro mês que a agência viveu nos dois sistemas. */
function mesDepoisDoCorte(corte: string | undefined): string {
  const base = corte && /^\d{4}-\d{2}/.test(corte) ? corte : new Date().toISOString().slice(0, 10);
  const [a, m] = base.split('-').map(Number);
  const d = new Date(Date.UTC(a, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Passo 9 · Mês em paralelo (E7). Depois da mudança, a agência trabalha um
 * mês nos dois sistemas, reenvia as listas do mês do sistema anterior e vê,
 * SEM GRAVAR NADA, o que bate, o que só existe lá, o que só existe aqui e o
 * que mudou de valor ou de data, por conta, por pessoa e por categoria.
 */
export function PassoParalelo({ lote, irPara }: PropsDoPasso) {
  const [comparacoes, setComparacoes] = React.useState<Comparacao[]>([]);
  const [atual, setAtual] = React.useState<Comparacao | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [mes, setMes] = React.useState(() => mesDepoisDoCorte(lote?.data_corte));
  const [criando, setCriando] = React.useState(false);
  const [enviando, setEnviando] = React.useState(0);
  const [relatorio, setRelatorio] = React.useState<RelatorioDoMes | null>(null);
  const [comparando, setComparando] = React.useState(false);
  const chave = React.useRef(chaveDeIdempotencia());
  const entrada = React.useRef<HTMLInputElement>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const { comparacoes: lista } = await api.comparacoes();
      setComparacoes(lista);
      setAtual(a => lista.find(c => c.id === a?.id) ?? lista[0] ?? null);
      setEstado('ok');
    } catch (e) { setErro(textoDoErro(e)); setEstado('erro'); }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  async function comecar() {
    setCriando(true);
    try {
      const c = await api.criarComparacao(mes, chave.current);
      chave.current = chaveDeIdempotencia();
      setComparacoes(l => [c, ...l.filter(x => x.id !== c.id)]);
      setAtual(c);
      setRelatorio(null);
    } catch (e) { toast.error(textoDoErro(e)); } finally { setCriando(false); }
  }

  async function enviar(arquivos: FileList | null) {
    if (!atual || !arquivos?.length) return;
    const lista = [...arquivos];
    setEnviando(lista.length);
    for (const f of lista) {
      try {
        const a = await api.enviarArquivo(atual.id, f);
        // As colunas sugeridas já servem: a comparação só confirma o que o dicionário reconheceu.
        const mapa = (await api.mapeamento(atual.id)).arquivos.find(m => m.arquivo_id === a.id);
        if (mapa) await api.salvarMapeamento(atual.id, { arquivo_id: mapa.arquivo_id, tipo_lista: mapa.tipo_lista, colunas: mapa.colunas.map(c => ({ indice: c.indice, campo: c.campo })) });
      } catch (e) { toast.error(`${f.name}: ${textoDoErro(e)}`); }
      setEnviando(n => n - 1);
    }
    setAtual(await api.lote(atual.id).then(l => ({ ...l, mes: atual.mes })).catch(() => atual));
    setRelatorio(null);
    if (entrada.current) entrada.current.value = '';
  }

  async function comparar() {
    if (!atual) return;
    setComparando(true);
    try { setRelatorio(await api.comparar(atual.id)); } catch (e) { toast.error(textoDoErro(e)); } finally { setComparando(false); }
  }

  const arquivos = atual?.arquivos ?? [];
  const bloqueio = !atual ? 'Escolha o mês e comece a comparação.' : !arquivos.length ? 'Solte as listas do mês do sistema anterior.' : null;

  return (
    <>
      <CabecaDoPasso id="passo-paralelo" titulo="Mês em paralelo">
        Solte as listas de um mês do sistema anterior (contas a pagar e a receber e o extrato) e veja o que bate com o que foi lançado aqui no mesmo mês. Nada é gravado: é só comparação.
      </CabecaDoPasso>

      <DataState
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div aria-hidden="true" className="h-56 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
      >
        <div className="grid grid-cols-1 items-start gap-[var(--fin-s-5)] lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section aria-labelledby="paralelo-mes" className={`${PAINEL} flex flex-col gap-[var(--fin-s-4)] p-[var(--fin-s-5)]`}>
            <h3 id="paralelo-mes" className="fin-t-subhead text-[var(--fin-text)]">Qual mês</h3>
            <div className="flex flex-wrap items-end gap-[var(--fin-s-3)]">
              <Field rotulo="Mês a comparar">
                {a => <input {...a} type="month" value={mes} onChange={e => setMes(e.target.value)} className={cn(CONTROLE, 'w-44 tabular-nums')} />}
              </Field>
              <Button variant={atual ? 'outline' : 'default'} onClick={() => { void comecar(); }} disabled={!/^\d{4}-\d{2}$/.test(mes) || criando} aria-busy={criando || undefined}>
                <Scale aria-hidden="true" /> {atual ? 'Nova comparação' : 'Começar a comparação'}
              </Button>
            </div>
            {comparacoes.length > 1 ? (
              <Field rotulo="Comparações já feitas">
                {a => (
                  <select {...a} value={atual?.id ?? ''} onChange={e => { setAtual(comparacoes.find(c => c.id === e.target.value) ?? null); setRelatorio(null); }} className={CONTROLE}>
                    {comparacoes.map(c => <option key={c.id} value={c.id}>{nomeDoMes(c.mes)} · {dataBR(c.criado_em)}</option>)}
                  </select>
                )}
              </Field>
            ) : null}

            {atual ? (
              <div className="flex flex-col gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)]">
                <p className="fin-t-body-strong text-[var(--fin-text)]">Listas de {nomeDoMes(atual.mes)} do sistema anterior</p>
                <p className="fin-t-caption text-[var(--fin-text-2)]">Contas a Pagar/Receber do mês (Situação: Todas; Data de: Vencimento) e as Movimentações ou o Extrato de conta do mês.</p>
                <input ref={entrada} type="file" multiple accept=".xlsx,.xls,.csv,.txt" className="sr-only" id="paralelo-arquivos" onChange={e => { void enviar(e.target.files); }} />
                <label htmlFor="paralelo-arquivos" className={cn(buttonVariants({ variant: 'outline' }), 'cursor-pointer self-start')}>
                  <Upload aria-hidden="true" /> {enviando ? `Lendo ${plural(enviando, 'arquivo', 'arquivos')}…` : 'Escolher arquivos'}
                </label>
                {arquivos.length ? (
                  <ul className="flex flex-col gap-1.5" aria-label="Arquivos do mês">
                    {arquivos.map(a => <ArquivoDoMes key={a.id} a={a} />)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="paralelo-resultado" className="flex min-w-0 flex-col gap-[var(--fin-s-4)]">
            <div className="flex flex-col gap-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
              <h3 id="paralelo-resultado" className="fin-t-subhead text-[var(--fin-text)]">
                {atual ? `${nomeDoMes(atual.mes)}: sistema anterior × EnturOS` : 'Comparação'}
              </h3>
              <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row">
                {relatorio && atual ? (
                  <a href={api.urlDoPdfDoMes(atual.id)} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: 'outline' }), 'max-sm:w-full')}>
                    <FileDown aria-hidden="true" /> Relatório (PDF)
                  </a>
                ) : null}
                <Button onClick={() => { void comparar(); }} disabled={Boolean(bloqueio) || comparando || enviando > 0} aria-busy={comparando || undefined} className="max-sm:w-full">
                  {relatorio ? <RefreshCw aria-hidden="true" /> : <Scale aria-hidden="true" />} {relatorio ? 'Comparar de novo' : 'Comparar'}
                </Button>
              </div>
            </div>
            {relatorio ? <Relatorio r={relatorio} /> : (
              <div className={`${PAINEL} flex flex-col items-start gap-[var(--fin-s-2)] p-[var(--fin-s-5)]`}>
                <p className="fin-t-body text-[var(--fin-text-2)]">{bloqueio ?? 'Pronto para comparar. Pode soltar mais listas do mesmo mês antes.'}</p>
              </div>
            )}
          </section>
        </div>
      </DataState>

      <BarraDoPasso voltar={{ rotulo: 'Regras e planos', onClick: () => irPara('recriar') }} />
    </>
  );
}

function ArquivoDoMes({ a }: { a: ArquivoDoLote & { mapeamento_confirmado?: boolean } }) {
  const entra = a.tipo_lista === 'titulos' || a.tipo_lista === 'liquidados' || a.tipo_lista === 'movimentos';
  return (
    <li className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-3 py-2">
      <FileSpreadsheet aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate fin-t-body text-[var(--fin-text)]">{a.nome}</span>
        <span className={cn('fin-t-caption', entra ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-warning-text)]')}>
          {entra ? `${rotuloDaLista(a.tipo_lista)} · ${plural(a.linhas, 'linha', 'linhas')}` : `${rotuloDaLista(a.tipo_lista)}: não entra na comparação do mês`}
        </span>
      </span>
    </li>
  );
}

const FILTROS: Array<{ valor: Filtro; rotulo: string }> = [
  { valor: 'diferentes', rotulo: 'Não bateu' }, { valor: 'valor', rotulo: 'Valor' }, { valor: 'data', rotulo: 'Data' },
  { valor: 'so_la', rotulo: 'Só lá' }, { valor: 'so_aqui', rotulo: 'Só aqui' }, { valor: 'bate', rotulo: 'Bateu' },
];

function Relatorio({ r }: { r: RelatorioDoMes }) {
  const [secaoId, setSecaoId] = React.useState(r.secoes[0]?.fonte ?? 'contas');
  const secao = r.secoes.find(s => s.fonte === secaoId) ?? r.secoes[0];
  if (!secao) {
    return <Callout tom="aviso" titulo="Nada para comparar">Os arquivos soltos não são das listas do mês. Solte as contas a pagar e a receber e o extrato.</Callout>;
  }
  const diferentes = r.secoes.reduce((s, x) => s + x.pares.length - x.contagem.bate, 0);
  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      {r.tudo_bate ? (
        <Callout tom="positivo" titulo="Tudo bateu">O que foi lançado aqui em {nomeDoMes(r.mes)} é o mesmo que o sistema anterior mostra.</Callout>
      ) : (
        <Callout tom="aviso" titulo={`${plural(diferentes, 'linha não bateu', 'linhas não bateram')}`}>
          Cada uma diz o que mudou. Corrija aqui o que estiver errado (ou lá, se o erro foi lá) e compare de novo: nada foi gravado.
        </Callout>
      )}
      {r.secoes.length > 1 ? (
        <Segmentado<'contas' | 'extrato'>
          rotulo="Qual lista"
          valor={secaoId}
          onChange={setSecaoId}
          opcoes={r.secoes.map(s => ({ valor: s.fonte, rotulo: s.rotulo, contagem: s.pares.length - s.contagem.bate }))}
        />
      ) : null}
      <Secao s={secao} />
      {r.fora.length ? (
        <div className={`${PAINEL} flex flex-col gap-[var(--fin-s-2)] p-[var(--fin-s-4)]`}>
          <p className="fin-t-body-strong text-[var(--fin-text)]">{plural(r.fora.length, 'linha não entrou', 'linhas não entraram')} na comparação</p>
          <ul className="flex flex-col gap-0.5">
            {r.fora.slice(0, 20).map((f, i) => (
              <li key={i} className="fin-t-caption text-[var(--fin-text-2)]">{f.arquivo}{f.linha ? `, linha ${f.linha}` : ''}: {f.motivo}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Secao({ s }: { s: SecaoComparada }) {
  const [filtro, setFiltro] = React.useState<Filtro>(s.pares.length - s.contagem.bate ? 'diferentes' : 'bate');
  const [grupo, setGrupo] = React.useState<Grupo>('por_pessoa');
  const pares = s.pares.filter(p => (filtro === 'diferentes' ? p.tipo !== 'bate' : p.tipo === filtro));
  const base = (p: ParComparado) => p.anterior ?? p.enturos!;
  const colunas: FinColuna<ParComparado>[] = [
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', dominio: 'mudanca', valor: p => p.tipo },
    {
      id: 'pessoa', cabecalho: 'Pessoa', tipo: 'texto', minWidth: 180, sortable: true, acessor: p => base(p).pessoa,
      render: p => (
        <span className="flex flex-col">
          <span className="text-[var(--fin-text)]">{base(p).pessoa || 'Sem pessoa'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{base(p).tipo === 'pagar' ? 'A pagar' : 'A receber'}{base(p).categoria ? ` · ${base(p).categoria}` : ''}</span>
        </span>
      ),
    },
    { id: 'data', cabecalho: 'Data', tipo: 'texto', minWidth: 96, sortable: true, acessor: p => base(p).liquidacao ?? base(p).vencimento ?? '', render: p => <span className="tabular-nums">{dataBR(base(p).liquidacao ?? base(p).vencimento ?? '')}</span> },
    { id: 'anterior', cabecalho: 'Sistema anterior', tipo: 'dinheiro', valor: p => p.anterior?.valor ?? 0, sub: p => (p.anterior ? '' : 'não existe lá') },
    { id: 'enturos', cabecalho: 'EnturOS', tipo: 'dinheiro', valor: p => p.enturos?.valor ?? 0, sub: p => (p.enturos ? '' : 'não existe aqui') },
    { id: 'detalhe', cabecalho: 'O que mudou', tipo: 'texto', minWidth: 220, render: p => <span className="fin-t-body text-[var(--fin-text-2)]">{p.detalhe || (p.tipo === 'bate' ? '—' : p.rotulo)}</span> },
  ];
  const grupos = s[grupo];
  const colunasGrupo: FinColuna<GrupoComparado>[] = [
    { id: 'rotulo', cabecalho: grupo === 'por_conta' ? 'Conta' : grupo === 'por_pessoa' ? 'Pessoa' : 'Categoria', tipo: 'texto', minWidth: 180, sortable: true, acessor: g => g.rotulo, render: g => <span className="text-[var(--fin-text)]">{g.rotulo}</span> },
    { id: 'anterior', cabecalho: 'Sistema anterior', tipo: 'dinheiro', valor: g => g.anterior },
    { id: 'enturos', cabecalho: 'EnturOS', tipo: 'dinheiro', valor: g => g.enturos },
    { id: 'diferenca', cabecalho: 'Diferença', tipo: 'dinheiro', valor: g => g.diferenca, tone: g => (Math.abs(g.diferenca) < 0.005 ? 'neutro' : 'negativo') },
    { id: 'linhas', cabecalho: 'Não bateu', tipo: 'texto', render: g => <span className="tabular-nums text-[var(--fin-text-2)]">{g.contagem.valor + g.contagem.data + g.contagem.so_la + g.contagem.so_aqui} de {Object.values(g.contagem).reduce((a, b) => a + b, 0)}</span> },
  ];
  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      <dl className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-3">
        {[
          ['Sistema anterior', s.total.anterior], ['EnturOS', s.total.enturos], ['Diferença', s.total.diferenca],
        ].map(([rotulo, v]) => (
          <div key={rotulo as string} className="flex flex-col gap-0.5">
            <dt className="fin-t-caption text-[var(--fin-text-2)]">{rotulo} <span className="text-[var(--fin-text-3)]">(recebido − pago)</span></dt>
            <dd className={cn('fin-t-subhead tabular-nums', rotulo === 'Diferença' && Math.abs(v as number) >= 0.005 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>{formatBRL(v as number)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
        <Segmentado<Filtro>
          rotulo="Mostrar"
          valor={filtro}
          onChange={setFiltro}
          opcoes={FILTROS.map(f => ({ valor: f.valor, rotulo: f.rotulo, contagem: f.valor === 'diferentes' ? s.pares.length - s.contagem.bate : s.contagem[f.valor] }))}
        />
        {filtro !== 'diferentes' ? <StatusChip valor={filtro} dominio="mudanca" dot /> : null}
      </div>
      <FinTable<ParComparado>
        linhas={pares}
        colunas={colunas}
        chave={p => `${p.tipo}|${p.anterior?.ref ?? ''}|${p.enturos?.ref ?? ''}`}
        densidade="compacta"
        estado="ok"
        vazio={{ motivo: 'sem-resultado', titulo: 'Nada neste filtro', oQueE: filtro === 'diferentes' ? 'Tudo bateu nesta lista.' : 'Nenhuma linha deste tipo.' }}
      />
      <div className="flex flex-col gap-[var(--fin-s-3)]">
        <Segmentado<Grupo>
          rotulo="Totais"
          valor={grupo}
          onChange={setGrupo}
          opcoes={[{ valor: 'por_pessoa', rotulo: 'Por pessoa' }, { valor: 'por_conta', rotulo: 'Por conta' }, { valor: 'por_categoria', rotulo: 'Por categoria' }]}
        />
        <FinTable<GrupoComparado>
          linhas={grupos}
          colunas={colunasGrupo}
          chave={g => g.chave}
          densidade="compacta"
          estado="ok"
          vazio={{ motivo: 'sem-dado', titulo: 'Sem totais', oQueE: 'Nenhuma linha para somar.' }}
        />
      </div>
    </div>
  );
}
