'use client';

import * as React from 'react';
import Link from 'next/link';
import { Columns3, Download, ShoppingCart } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Segmentado } from '@/components/fin/Segmentado';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { GradeDinamica } from '@/app/financeiro-ag/resultado-por-categoria/GradeDinamica';
import {
  CAMPOS_DA_DINAMICA, RELATORIOS, ROTULO_RELATORIO, registrosDaDinamica,
  type ColunaDoRelatorio, type LinhaDoRelatorio, type TipoDeRelatorio,
} from '@/lib/relatorios-vendas';
import { montarTabelaDinamica, registrosDaCelula } from '@/lib/tabela-dinamica';
import { hojeISO } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Relatórios de vendas (E5, parte F): por produto (colunas escolhíveis, a
 * receita aberta por componente), por vendedor, por unidade, por forma de
 * pagamento, ranking de clientes e a tabela dinâmica de vendas. Clicar abre a
 * venda; exporta em CSV e Excel. O ganho da agência só aparece para quem
 * pode vê-lo (o servidor nem manda o número).
 */

interface Resposta {
  relatorio: TipoDeRelatorio;
  titulo: string;
  colunas: ColunaDoRelatorio[];
  catalogo: ColunaDoRelatorio[];
  medidas: ColunaDoRelatorio[];
  linhas: LinhaDoRelatorio[];
  totais: LinhaDoRelatorio;
  ver_receita: boolean;
  so_as_suas: boolean;
  quantidade_vendas: number;
}

const CAMPO = 'h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10';
const ROTULO_CURTO: Record<TipoDeRelatorio, string> = { produto: 'Por produto', vendedor: 'Por vendedor', unidade: 'Por unidade', forma: 'Por forma de pagamento', clientes: 'Ranking de clientes', dinamica: 'Tabela dinâmica' };
const dataBR = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : '');

function colunaDaTabela(c: ColunaDoRelatorio, i: number): FinColuna<LinhaDoRelatorio> {
  const base = { id: c.id, cabecalho: c.rotulo, sortable: true as const, prioridade: (i < 3 ? 3 : i < 6 ? 2 : 1) as 1 | 2 | 3 };
  if (c.tipo === 'dinheiro') return { ...base, tipo: 'dinheiro', valor: l => Number(l[c.id] ?? 0) / 100 };
  if (c.tipo === 'data') return { ...base, tipo: 'data', valor: l => (l[c.id] ? String(l[c.id]) : null) };
  if (c.tipo === 'percentual') return { ...base, tipo: 'texto', acessor: l => Number(l[c.id] ?? 0), render: l => <span className="tabular-nums">{Number(l[c.id] ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span> };
  if (c.tipo === 'numero') return { ...base, tipo: 'texto', acessor: l => Number(l[c.id] ?? 0), render: l => <span className="tabular-nums">{Number(l[c.id] ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</span> };
  return { ...base, tipo: 'texto', acessor: l => String(l[c.id] ?? ''), render: l => <span className={i === 0 ? 'fin-t-body-strong text-[var(--fin-text)]' : undefined}>{String(l[c.id] ?? '') || '—'}</span> };
}

/** A tela inteira; a página só diz como abrir a venda (o roteador do app). */
export function RelatoriosDeVendas({ abrirVenda }: { abrirVenda: (vendaId: string) => void }) {
  const hoje = hojeISO();
  const [relatorio, setRelatorio] = React.useState<TipoDeRelatorio>('produto');
  const [de, setDe] = React.useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = React.useState(hoje);
  const [situacao, setSituacao] = React.useState('todas');
  const [canceladas, setCanceladas] = React.useState(false);
  const [escolhidas, setEscolhidas] = React.useState<Record<string, string[]>>({});
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  // Tabela dinâmica: linhas, coluna e o número somado.
  const [linhaA, setLinhaA] = React.useState<string>('Vendedor');
  const [linhaB, setLinhaB] = React.useState<string>('Tipo de produto');
  const [colunaDin, setColunaDin] = React.useState<string>('Mês');
  const [medida, setMedida] = React.useState('faturamento');
  const [celula, setCelula] = React.useState<{ titulo: string; vendas: Array<{ venda_id: string; venda_numero: string; centavos: number }> } | null>(null);

  const consulta = React.useCallback((formato?: 'csv' | 'xlsx') => {
    const q = new URLSearchParams({ relatorio, situacao });
    if (de) q.set('de', de);
    if (ate) q.set('ate', ate);
    if (canceladas) q.set('canceladas', '1');
    const cols = escolhidas[relatorio];
    if (cols?.length) q.set('colunas', cols.join(','));
    if (formato) q.set('formato', formato);
    return `/api/relatorios/vendas?${q}`;
  }, [relatorio, situacao, de, ate, canceladas, escolhidas]);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch(consulta());
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível montar o relatório.');
      setDados(j);
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível montar o relatório.');
      setEstado('erro');
    }
  }, [consulta]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const linhas = dados?.linhas ?? [];
  const colunas = React.useMemo(() => (dados?.colunas ?? []).map(colunaDaTabela), [dados?.colunas]);
  const visiveis = new Set((dados?.colunas ?? []).map(c => c.id));
  const totais = (dados?.colunas ?? []).filter(c => c.tipo === 'dinheiro').map(c => ({ colunaId: c.id, valor: Number(dados?.totais[c.id] ?? 0) / 100, rotulo: 'Total' }));

  const registros = React.useMemo(() => (relatorio === 'dinamica' ? registrosDaDinamica(linhas, medida) : []), [relatorio, linhas, medida]);
  const camposLinha = [linhaA, linhaB].filter((c, i, a) => c && a.indexOf(c) === i && c !== colunaDin);
  const tabela = React.useMemo(() => montarTabelaDinamica(registros, camposLinha, colunaDin ? [colunaDin] : []), [registros, camposLinha.join('|'), colunaDin]); // eslint-disable-line react-hooks/exhaustive-deps

  const alternarColuna = (id: string) => {
    const atuais = escolhidas[relatorio]?.length ? escolhidas[relatorio] : (dados?.colunas ?? []).map(c => c.id);
    const prox = atuais.includes(id) ? atuais.filter(x => x !== id) : [...atuais, id];
    setEscolhidas(e => ({ ...e, [relatorio]: prox.length ? prox : atuais }));
  };

  return (
    <MolduraDaPagina>
      <PageHeader
        empresas
        icone={ShoppingCart}
        titulo="Relatórios de vendas"
        subtitulo="Faturamento e receita da agência, aberta por componente. Clique numa linha para abrir a venda."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <div className="overflow-x-auto">
        <Segmentado<TipoDeRelatorio> rotulo="Relatório" valor={relatorio} onChange={setRelatorio}
          opcoes={RELATORIOS.map(r => ({ valor: r, rotulo: ROTULO_CURTO[r] }))} />
      </div>

      <div className="flex flex-wrap items-end gap-[var(--fin-s-3)]">
        <label className="flex flex-col gap-1"><span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Vendas de</span><input type="date" className={CAMPO} value={de} onChange={e => setDe(e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Até</span><input type="date" className={CAMPO} value={ate} onChange={e => setAte(e.target.value)} /></label>
        <label className="flex flex-col gap-1">
          <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Situação</span>
          <select className={CAMPO} value={situacao} onChange={e => setSituacao(e.target.value)}>
            <option value="todas">Todas</option><option value="abertas">Abertas</option><option value="fechadas">Fechadas</option>
          </select>
        </label>
        <label className="flex h-11 items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)] lg:h-10">
          <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={canceladas} onChange={e => setCanceladas(e.target.checked)} />
          Incluir canceladas
        </label>
        <div className="ml-auto flex flex-wrap gap-[var(--fin-s-2)]">
          {relatorio !== 'dinamica' && relatorio !== 'forma' && dados ? (
            <details className="relative">
              <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] lg:h-10">
                <Columns3 aria-hidden="true" className="size-4" /> Colunas
              </summary>
              <div className="absolute right-0 z-[var(--fin-z-popover)] mt-1 flex max-h-80 w-64 flex-col gap-1 overflow-y-auto rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-2)] shadow-[var(--fin-e1)]">
                {dados.catalogo.map(c => (
                  <label key={c.id} className="flex h-9 shrink-0 cursor-pointer items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]">
                    <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={visiveis.has(c.id)} onChange={() => alternarColuna(c.id)} />
                    {c.rotulo}
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <Button variant="outline" nativeButton={false} render={<a href={consulta('csv')} />}><Download aria-hidden="true" className="size-4" /> CSV</Button>
          <Button variant="outline" nativeButton={false} render={<a href={consulta('xlsx')} />}><Download aria-hidden="true" className="size-4" /> Excel</Button>
        </div>
      </div>

      <div className={RITMO_DA_PAGINA}>
        {dados?.so_as_suas ? <Callout tom="info">Mostrando só as suas vendas.</Callout> : null}
        {dados && !dados.ver_receita ? <Callout tom="info">A receita da agência e os componentes não aparecem para o seu acesso.</Callout> : null}

        {relatorio === 'dinamica' ? (
          <DataState estado={estado} erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
            esqueleto={<div className="h-96 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}>
            <section aria-label="Montagem da tabela" className="flex flex-wrap items-end gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]">
              {([['Linhas', linhaA, setLinhaA], ['Depois', linhaB, setLinhaB], ['Colunas', colunaDin, setColunaDin]] as const).map(([rot, val, set]) => (
                <label key={rot} className="flex flex-col gap-1">
                  <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">{rot}</span>
                  <select className={CAMPO} value={val} onChange={e => set(e.target.value)}>
                    <option value="">Nenhum</option>
                    {CAMPOS_DA_DINAMICA.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              ))}
              <label className="flex flex-col gap-1">
                <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Somar</span>
                <select className={CAMPO} value={medida} onChange={e => setMedida(e.target.value)}>
                  {(dados?.medidas ?? []).map(m => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
                </select>
              </label>
            </section>
            <div className="mt-[var(--fin-s-4)]">
              {registros.length ? (
                <GradeDinamica tabela={tabela} onAbrirCelula={(caminho, coluna, titulo) => {
                  const regs = registrosDaCelula(registros, tabela, caminho, coluna);
                  const porVenda = new Map<string, { venda_id: string; venda_numero: string; centavos: number }>();
                  for (const r of regs) {
                    const v = porVenda.get(r.ref!.venda_id) ?? { ...r.ref!, centavos: 0 };
                    v.centavos += r.centavos;
                    porVenda.set(r.ref!.venda_id, v);
                  }
                  setCelula({ titulo, vendas: [...porVenda.values()] });
                }} />
              ) : <p className="fin-t-body text-[var(--fin-text-2)]">Nenhuma venda no período.</p>}
            </div>
          </DataState>
        ) : (
          <FinTable<LinhaDoRelatorio>
            linhas={linhas}
            colunas={colunas}
            chave={l => `${l.venda_id ?? ''}|${String(l.grupo ?? '')}|${String(l.descricao ?? '')}|${String(l.data_venda ?? '')}|${String(l.forma ?? '')}|${linhas.indexOf(l)}`}
            estado={estado}
            erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
            vazio={{ motivo: 'sem-resultado', titulo: 'Nenhuma venda no período', oQueE: `${ROTULO_RELATORIO[relatorio]} soma as vendas lançadas e as que chegam do CRM.`, acaoSecundaria: { rotulo: 'Ver o ano inteiro', onClick: () => setDe(`${hoje.slice(0, 4)}-01-01`) } }}
            onLinhaClick={relatorio === 'produto' ? l => { if (l.venda_id) abrirVenda(String(l.venda_id)); } : undefined}
            totais={totais}
            rodape={dados ? <p className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)]">{dados.quantidade_vendas} {dados.quantidade_vendas === 1 ? 'venda' : 'vendas'} de {dataBR(de) || 'sempre'} a {dataBR(ate) || 'hoje'}.</p> : null}
          />
        )}
      </div>

      {celula ? (
        <RecordSheet aberto onOpenChange={o => { if (!o) setCelula(null); }} largura={480} titulo={celula.titulo}
          descricao={`${celula.vendas.length} ${celula.vendas.length === 1 ? 'venda' : 'vendas'}`}
          acaoPrimaria={{ rotulo: 'Fechar janela', onClick: () => setCelula(null) }} acaoSecundaria={null}>
          <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
            {celula.vendas.map(v => (
              <li key={v.venda_id} className={cn('flex items-center justify-between gap-[var(--fin-s-3)] py-[var(--fin-s-2)]')}>
                <Link href={`/vendas/${encodeURIComponent(v.venda_id)}/ficha`} className="fin-t-body text-[var(--fin-accent)] underline-offset-4 hover:underline">{v.venda_numero || 'Venda'}</Link>
                <span className="fin-t-body tabular-nums text-[var(--fin-text)]">{(v.centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </li>
            ))}
          </ul>
        </RecordSheet>
      ) : null}
    </MolduraDaPagina>
  );
}
