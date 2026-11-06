'use client';

/**
 * Cheques emitidos (E7, frente C). O talão da agência num lugar só: cada
 * cheque com o número, a conta, o favorecido, o valor, o "bom para" e a
 * situação (Emitido, Compensado, Devolvido, Cancelado). Daqui se imprime de
 * novo, se marca a compensação (ligada à linha do extrato, quando ela já
 * chegou), a devolução e o cancelamento. Os cheques nascem de "Imprimir
 * cheque" em Contas a pagar ou da liquidação com forma cheque.
 */
import * as React from 'react';
import Link from 'next/link';
import { Ban, CheckCheck, FileCheck2, Printer, Undo2 } from 'lucide-react';

import { loadEntities } from '@/lib/crm-storage';
import type { ContaBancaria } from '@/lib/crm-types';
import { ROTULO_SITUACAO_CHEQUE, SITUACOES_DO_CHEQUE, acoesPossiveis, type AcaoDoCheque, type SituacaoDoCheque } from '@/lib/cheques';
import type { Cheque } from '@/lib/cheques-servidor';
import { hojeISO } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn, formatBRL } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { StatusChip } from '@/components/fin/StatusChip';
import type { PeriodoChave } from '@/components/fin/PeriodPicker';

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';
const CONTROLE = cn('fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] lg:h-10', FOCO);
const ACAO_LINHA = cn(
  'size-11 rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] shadow-none hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:size-10',
  FOCO,
);

const TODAS = 'todas';
type Totais = Record<SituacaoDoCheque | 'TODOS', { quantidade: number; valor_centavos: number }>;
type Sugestao = { id: string; data: string; valor: number; descricao: string };

const dataBR = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

const ROTULO_ACAO: Record<AcaoDoCheque, string> = { compensar: 'Compensar', devolver: 'Marcar como devolvido', cancelar: 'Cancelar cheque' };
const ICONE_ACAO = { compensar: CheckCheck, devolver: Undo2, cancelar: Ban } as const;

export default function ChequesPage() {
  const [cheques, setCheques] = React.useState<Cheque[]>([]);
  const [totais, setTotais] = React.useState<Totais | null>(null);
  const [contas, setContas] = React.useState<ContaBancaria[]>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);

  const [busca, setBusca] = React.useState('');
  const [conta, setConta] = React.useState(TODAS);
  const [situacao, setSituacao] = React.useState(TODAS);
  const [dataDe, setDataDe] = React.useState<'emissao' | 'bom_para'>('emissao');
  const [periodo, setPeriodo] = React.useState<{ chave: PeriodoChave; de: string; ate: string }>({ chave: 'TUDO', de: '', ate: '' });

  const [acao, setAcao] = React.useState<{ cheque: Cheque; acao: AcaoDoCheque } | null>(null);
  const [motivo, setMotivo] = React.useState('');
  const [dataCompensacao, setDataCompensacao] = React.useState(hojeISO());
  const [sugestoes, setSugestoes] = React.useState<Sugestao[]>([]);
  const [extratoId, setExtratoId] = React.useState('');
  const [processando, setProcessando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    const q = new URLSearchParams();
    if (conta !== TODAS) q.set('conta', conta);
    if (situacao !== TODAS) q.set('situacao', situacao);
    if (dataDe !== 'emissao') q.set('data_de', dataDe);
    if (periodo.de) q.set('de', periodo.de);
    if (periodo.ate) q.set('ate', periodo.ate);
    if (busca.trim()) q.set('busca', busca.trim());
    try {
      const r = await fetch(`/api/cheques?${q.toString()}`);
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error ?? 'A consulta não respondeu.');
      setCheques(Array.isArray(corpo.cheques) ? corpo.cheques : []);
      setTotais(corpo.totais ?? null);
      setErro(null);
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A consulta não respondeu.');
      setEstado('erro');
    }
  }, [conta, situacao, dataDe, periodo, busca]);

  React.useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, busca ? 250 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

  React.useEffect(() => {
    loadEntities<ContaBancaria>('contas-bancarias').then(cs => setContas(cs.filter(c => c.tipo !== 'CARTAO_CREDITO'))).catch(() => setContas([]));
  }, []);

  function abrirAcao(cheque: Cheque, a: AcaoDoCheque) {
    setAcao({ cheque, acao: a });
    setMotivo('');
    setDataCompensacao(hojeISO() < cheque.emissao ? cheque.emissao : hojeISO());
    setSugestoes([]);
    setExtratoId('');
    if (a === 'compensar') {
      fetch(`/api/cheques/${encodeURIComponent(cheque.id)}`)
        .then(r => (r.ok ? r.json() : null))
        .then((x: { sugestoes_do_extrato?: Sugestao[] } | null) => {
          const lista = Array.isArray(x?.sugestoes_do_extrato) ? x!.sugestoes_do_extrato! : [];
          setSugestoes(lista);
          if (lista.length === 1) { setExtratoId(lista[0].id); setDataCompensacao(lista[0].data || hojeISO()); }
        })
        .catch(() => setSugestoes([]));
    }
  }

  async function confirmarAcao() {
    if (!acao) return;
    setProcessando(true);
    try {
      const r = await fetch(`/api/cheques/${encodeURIComponent(acao.cheque.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acao.acao === 'compensar'
          ? { acao: 'compensar', data: dataCompensacao, extrato_id: extratoId || null }
          : { acao: acao.acao, motivo }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error('Nada mudou no cheque', corpo.error ?? ''); return; }
      toast.success(`Cheque nº ${acao.cheque.numero}: ${ROTULO_SITUACAO_CHEQUE[corpo.cheque.situacao as SituacaoDoCheque].toLowerCase()}`, corpo.aviso ?? '');
      setAcao(null);
      await carregar();
    } finally {
      setProcessando(false);
    }
  }

  const colunas: FinColuna<Cheque>[] = [
    {
      id: 'numero', cabecalho: 'Cheque', tipo: 'texto', sortable: true, minWidth: 140, acessor: c => c.numero,
      render: c => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">Nº {c.numero}</span>
          <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{c.conta_nome || 'Conta sem nome'}</span>
        </span>
      ),
    },
    {
      id: 'favorecido', cabecalho: 'Favorecido', tipo: 'texto', sortable: true, minWidth: 220, acessor: c => c.favorecido,
      render: c => {
        const pagas = c.liquidacoes.map(l => l.descricao).filter(Boolean);
        const legenda = pagas.length ? `Pagou: ${pagas.join(', ')}` : c.titulo_descricao ? `Para: ${c.titulo_descricao}` : '';
        return (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="fin-t-body truncate text-[var(--fin-text)]">{c.favorecido || 'Ao portador'}</span>
            {legenda ? <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{legenda}</span> : null}
          </span>
        );
      },
    },
    { id: 'emissao', cabecalho: 'Data', tipo: 'data', sortable: true, minWidth: 96, valor: c => c.emissao },
    { id: 'bom_para', cabecalho: 'Bom para', tipo: 'data', sortable: true, minWidth: 96, prioridade: 2, valor: c => c.bom_para },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, minWidth: 120, valor: c => c.valor_centavos / 100 },
    {
      id: 'situacao', cabecalho: 'Situação', tipo: 'texto', minWidth: 150, acessor: c => c.situacao,
      render: c => {
        const nota = c.situacao === 'COMPENSADO' ? `em ${dataBR(c.compensado_em)}${c.extrato_id ? ' · no extrato' : ''}` : c.situacao === 'DEVOLVIDO' || c.situacao === 'CANCELADO' ? c.motivo : '';
        return (
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <ChipDoCheque situacao={c.situacao} />
            {nota ? <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{nota}</span> : null}
          </span>
        );
      },
    },
    {
      id: 'acoes', cabecalho: 'Ações', tipo: 'acoes', minWidth: 184,
      render: c => (
        <>
          {c.situacao !== 'CANCELADO' ? (
            <Button
              variant="ghost" size="icon" className={ACAO_LINHA} nativeButton={false}
              aria-label={`Imprimir o cheque nº ${c.numero}`} title="Imprimir"
              render={<Link href={`/financeiro-ag/cheques/${encodeURIComponent(c.id)}/imprimir`} />}
            >
              <Printer aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
          {acoesPossiveis(c.situacao).map(a => {
            const Icone = ICONE_ACAO[a];
            return (
              <Button
                key={a} type="button" variant="ghost" size="icon" title={ROTULO_ACAO[a]}
                aria-label={`${ROTULO_ACAO[a]} nº ${c.numero}`}
                className={cn(ACAO_LINHA, a === 'cancelar' && 'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')}
                onClick={() => abrirAcao(c, a)}
              >
                <Icone aria-hidden="true" className="size-4" />
              </Button>
            );
          })}
        </>
      ),
    },
  ];

  const ativos = (conta !== TODAS ? 1 : 0) + (situacao !== TODAS ? 1 : 0) + (periodo.chave !== 'TUDO' ? 1 : 0) + (busca.trim() ? 1 : 0) + (dataDe !== 'emissao' ? 1 : 0);
  const aCompensar = totais?.EMITIDO;
  const devolvidos = totais?.DEVOLVIDO;

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={FileCheck2}
        titulo="Cheques emitidos"
        subtitulo="O talão da agência: o que foi emitido, o que o banco já descontou e o que voltou."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acoesSecundarias={[{ rotulo: 'Contas a pagar', href: '/financeiro-ag/pagar' }]}
      />

      {estado === 'ok' && totais && totais.TODOS.quantidade > 0 ? (
        <p className="fin-t-body text-[var(--fin-text-2)]">
          <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{(aCompensar?.quantidade ?? 0).toLocaleString('pt-BR')}</span>{' '}
          {aCompensar?.quantidade === 1 ? 'cheque ainda não compensado' : 'cheques ainda não compensados'}
          {aCompensar && aCompensar.quantidade > 0 ? <>, <span className="tabular-nums">{formatBRL(aCompensar.valor_centavos / 100)}</span> que ainda vão sair da conta</> : null}
          {devolvidos && devolvidos.quantidade > 0 ? (
            <> · <span className="fin-t-body-strong text-[var(--fin-negative-text)]">{devolvidos.quantidade.toLocaleString('pt-BR')} {devolvidos.quantidade === 1 ? 'devolvido' : 'devolvidos'}</span> pelo banco</>
          ) : null}
          .
        </p>
      ) : null}

      <FilterBar
        busca={{ valor: busca, onChange: setBusca, placeholder: 'Favorecido ou número' }}
        periodo={{
          valor: periodo.chave, de: periodo.de, ate: periodo.ate,
          opcoes: ['TUDO', 'MES_ATUAL', 'MES_PASSADO', 'ULT_30', 'PROX_30', 'ANO_ATUAL', 'PERSONALIZADO'],
          onChange: (chave, r) => setPeriodo({ chave, de: r.de, ate: r.ate }),
        }}
        selects={[
          {
            id: 'cheques-situacao', rotulo: 'Situação', valor: situacao,
            opcoes: [{ valor: TODAS, rotulo: 'Todas as situações' }, ...SITUACOES_DO_CHEQUE.map(s => ({ valor: s, rotulo: ROTULO_SITUACAO_CHEQUE[s] }))],
            onChange: setSituacao,
          },
          {
            id: 'cheques-conta', rotulo: 'Conta', valor: conta,
            opcoes: [{ valor: TODAS, rotulo: 'Todas as contas' }, ...contas.map(c => ({ valor: c.id, rotulo: c.nome || 'Conta sem nome' }))],
            onChange: setConta,
          },
          {
            id: 'cheques-data', rotulo: 'Período pela', valor: dataDe,
            opcoes: [{ valor: 'emissao', rotulo: 'Data do cheque' }, { valor: 'bom_para', rotulo: 'Data do bom para' }],
            onChange: v => setDataDe(v === 'bom_para' ? 'bom_para' : 'emissao'),
          },
        ]}
        resumo={{
          exibidos: cheques.length, total: cheques.length, substantivo: cheques.length === 1 ? 'cheque' : 'cheques',
          soma: totais ? totais.TODOS.valor_centavos / 100 : undefined,
        }}
        ativos={ativos}
        onLimpar={() => { setBusca(''); setConta(TODAS); setSituacao(TODAS); setDataDe('emissao'); setPeriodo({ chave: 'TUDO', de: '', ate: '' }); }}
      />

      <FinTable
        linhas={cheques}
        colunas={colunas}
        chave={c => c.id}
        densidade="compacta"
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        totais={totais ? [{ colunaId: 'valor', valor: totais.TODOS.valor_centavos / 100, rotulo: 'Total' }] : undefined}
        vazio={ativos > 0 ? {
          motivo: 'sem-resultado',
          titulo: 'Nenhum cheque neste filtro',
          oQueE: 'Tire um filtro ou amplie o período para ver os outros cheques.',
          acaoSecundaria: { rotulo: 'Limpar filtros', onClick: () => { setBusca(''); setConta(TODAS); setSituacao(TODAS); setPeriodo({ chave: 'TUDO', de: '', ate: '' }); } },
        } : {
          motivo: 'sem-dado',
          titulo: 'Nenhum cheque emitido ainda',
          oQueE: 'Aqui fica o controle dos cheques que a agência dá aos fornecedores: número, valor, bom para e se o banco já descontou.',
          comoComeca: [
            'Em Contas a pagar, use o botão de imprimir cheque na conta em aberto.',
            'Ou, ao pagar uma conta, escolha a forma cheque e informe o número: ele entra aqui sozinho.',
          ],
          acao: { rotulo: 'Ir para Contas a pagar', href: '/financeiro-ag/pagar' },
        }}
      />

      <ConfirmDialog
        aberto={acao !== null}
        onOpenChange={a => { if (!a) setAcao(null); }}
        titulo={acao ? `${ROTULO_ACAO[acao.acao]} nº ${acao.cheque.numero}` : ''}
        tone={acao?.acao === 'cancelar' ? 'destrutivo' : 'padrao'}
        oQueVaiAcontecer={
          acao?.acao === 'compensar'
            ? 'O cheque passa a constar como descontado pelo banco. Nenhum dinheiro se move aqui: a saída da conta já foi lançada quando a conta a pagar foi liquidada.'
            : acao?.acao === 'devolver'
              ? 'O cheque passa a constar como devolvido pelo banco. Se ele pagou uma conta, ela continua liquidada: estorne a liquidação na conta a pagar se o fornecedor não recebeu.'
              : 'O cheque sai de uso e o número não volta para o talão. Cancelado não muda mais.'
        }
        detalhes={acao ? [
          { rotulo: 'Favorecido', valor: acao.cheque.favorecido || 'Ao portador' },
          { rotulo: 'Valor', valor: formatBRL(acao.cheque.valor_centavos / 100) },
          { rotulo: 'Conta', valor: acao.cheque.conta_nome || '—' },
        ] : []}
        previa={acao ? (
          acao.acao === 'compensar' ? (
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
              <Field rotulo="Data da compensação" obrigatorio>
                {a => <Input {...a} type="date" className={CONTROLE} value={dataCompensacao} min={acao.cheque.emissao} onChange={e => setDataCompensacao(e.target.value)} />}
              </Field>
              <Field rotulo="Linha do extrato" ajuda={sugestoes.length ? 'Saídas do mesmo valor nesta conta, a partir da data do cheque.' : 'Nenhuma linha do extrato importado bate com este cheque.'}>
                {a => (
                  <select {...a} className={cn(CONTROLE, 'border px-3')} value={extratoId} disabled={!sugestoes.length}
                    onChange={e => { setExtratoId(e.target.value); const s = sugestoes.find(x => x.id === e.target.value); if (s?.data) setDataCompensacao(s.data); }}>
                    <option value="">Sem ligar ao extrato</option>
                    {sugestoes.map(s => <option key={s.id} value={s.id}>{dataBR(s.data)} · {formatBRL(Math.abs(s.valor))} · {s.descricao || 'sem descrição'}</option>)}
                  </select>
                )}
              </Field>
            </div>
          ) : (
            <Field rotulo="Motivo" obrigatorio ajuda={acao.acao === 'devolver' ? 'Ex.: sem fundos, divergência de assinatura, sustado.' : 'Ex.: preenchido errado, rasgado, substituído pelo nº seguinte.'}>
              {a => <Textarea {...a} value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} className="min-h-20 fin-t-body" />}
            </Field>
          )
        ) : null}
        confirmarRotulo={acao ? ROTULO_ACAO[acao.acao] : 'Confirmar'}
        confirmarDesabilitado={acao ? acao.acao !== 'compensar' && motivo.trim().length < 3 : true}
        processando={processando}
        onConfirmar={confirmarAcao}
      />
    </MolduraDaPagina>
  );
}

function ChipDoCheque({ situacao }: { situacao: SituacaoDoCheque }) {
  return <StatusChip valor={situacao} dominio="cheque" dot />;
}
