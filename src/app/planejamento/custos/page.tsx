'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { MoneyInput } from '@/components/MoneyInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { formatBRL, generateId } from '@/lib/utils';
import { Copy, AlertTriangle, ArrowRight, Filter as FunilIcon, Download } from 'lucide-react';
import Link from 'next/link';
import type { FunilPayload } from '@/lib/funil-types';

// ============================================================
// TYPES
// ============================================================

interface CustoFixo {
  categoria: string;
  valor: number;
  observacao: string;
}

interface CustoVariavel {
  nome: string;
  percentual: number;
  base?: 'VENDA' | 'COMISSAO';
}

interface CanalMarketing {
  canal: string;
  valor: number;
}

interface CustosData {
  id: string;
  mes: string;
  custos_fixos: CustoFixo[];
  custos_variaveis: CustoVariavel[];
  marketing: CanalMarketing[];
  // Indicadores de planejamento
  ticket_medio: number;
  margem_comissao: number;
  taxa_conversao: number;
  lucro_desejado: number;
  dias_uteis: number;
  vendedores_ativos: number;
}

const CATEGORIAS_FIXOS = ['Aluguel/Sede', 'Folha de pagamento', 'Ferramentas e software', 'Marketing fixo recorrente', 'Outros fixos'];
const CANAIS_MARKETING = ['Instagram Ads', 'Google Ads', 'Influenciadores', 'Eventos', 'Afiliados', 'Outros'];

const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Decimal no padrão pt-BR — toFixed devolve ponto, que num app brasileiro
 *  lê como erro de digitação ("0.3 vendas por dia"). */
function dec(v: number, casas = 1): string {
  return (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/** 'YYYY-MM' → 'setembro de 2026' (sem passar por Date, que erra o fuso). */
function mesPorExtenso(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  const nome = MESES_PT[(m || 1) - 1] ?? '';
  return `${nome} de ${ano}`;
}

function createDefault(mes: string): CustosData {
  return {
    id: generateId(),
    mes,
    custos_fixos: CATEGORIAS_FIXOS.map(c => ({ categoria: c, valor: 0, observacao: '' })),
    custos_variaveis: [
      { nome: 'Comissão vendedor', percentual: 0, base: 'COMISSAO' },
      { nome: 'Impostos', percentual: 6, base: 'COMISSAO' },
      { nome: 'Taxa cartão/boleto', percentual: 4.5, base: 'VENDA' },
      { nome: 'Outros variáveis', percentual: 0, base: 'VENDA' },
    ],
    marketing: CANAIS_MARKETING.map(c => ({ canal: c, valor: 0 })),
    ticket_medio: 8000,
    margem_comissao: 25,
    taxa_conversao: 10,
    lucro_desejado: 10000,
    dias_uteis: 22,
    vendedores_ativos: 1,
  };
}

// ============================================================
// CALCULATIONS
// ============================================================

interface Relatorio {
  custoFixoTotal: number;
  marketingTotal: number;
  custoFixoMaisMarketing: number;
  comissaoPorVenda: number;
  custoVarPorVenda: number;
  lucroPorVenda: number;
  vendasBreakEven: number;
  faturamentoBreakEven: number;
  vendasMeta: number;
  faturamentoMeta: number;
  comissaoMeta: number;
  atendimentosMeta: number;
  atendimentosPorDia: number;
  vendasPorVendedorMes: number;
  atendimentosPorVendedorDia: number;
  cplMaximo: number;
  roiMarketing: number;
  margemLiquidaPct: number;
  comissaoMediaPorVenda: number;
  faturamentoDiario: number;
  vendasPorDia: number;
}

function calcRelatorio(data: CustosData): Relatorio {
  const custoFixoTotal = data.custos_fixos.reduce((s, c) => s + (c.valor || 0), 0);
  const marketingTotal = data.marketing.reduce((s, c) => s + (c.valor || 0), 0);
  // Excluir "Marketing fixo recorrente" dos fixos para evitar dupla contagem
  // (já que marketing é somado separadamente via array data.marketing)
  const mktFixoRecorrente = data.custos_fixos
    .filter(c => c.categoria === 'Marketing fixo recorrente')
    .reduce((s, c) => s + (c.valor || 0), 0);
  const custoFixoMaisMarketing = (custoFixoTotal - mktFixoRecorrente) + marketingTotal;

  const ticket = data.ticket_medio || 1;
  const margemPct = (data.margem_comissao || 0) / 100;
  const comissaoPorVenda = ticket * margemPct;

  let custoVarPorVenda = 0;
  for (const cv of data.custos_variaveis) {
    const base = cv.base === 'COMISSAO' ? comissaoPorVenda : ticket;
    custoVarPorVenda += base * (cv.percentual || 0) / 100;
  }

  const lucroPorVenda = comissaoPorVenda - custoVarPorVenda;

  const vendasBreakEven = lucroPorVenda > 0 ? Math.ceil(custoFixoMaisMarketing / lucroPorVenda) : 0;
  const faturamentoBreakEven = vendasBreakEven * ticket;

  const vendasMeta = lucroPorVenda > 0 ? Math.ceil((custoFixoMaisMarketing + (data.lucro_desejado || 0)) / lucroPorVenda) : 0;
  const faturamentoMeta = vendasMeta * ticket;
  const comissaoMeta = vendasMeta * comissaoPorVenda;

  const taxaConv = (data.taxa_conversao || 1) / 100;
  const atendimentosMeta = taxaConv > 0 ? Math.ceil(vendasMeta / taxaConv) : 0;
  const diasUteis = data.dias_uteis || 22;
  const vendedores = data.vendedores_ativos || 1;
  const atendimentosPorDia = diasUteis > 0 ? Math.ceil(atendimentosMeta / diasUteis) : 0;
  const vendasPorVendedorMes = vendedores > 0 ? Math.ceil(vendasMeta / vendedores) : 0;
  const atendimentosPorVendedorDia = (diasUteis * vendedores) > 0 ? Math.ceil(atendimentosMeta / (diasUteis * vendedores)) : 0;

  const cplMaximo = atendimentosMeta > 0 ? marketingTotal / atendimentosMeta : 0;
  const roiMarketing = marketingTotal > 0 ? faturamentoMeta / marketingTotal : 0;

  const margemLiquidaPct = faturamentoMeta > 0 ? ((data.lucro_desejado || 0) / faturamentoMeta) * 100 : 0;
  const faturamentoDiario = diasUteis > 0 ? faturamentoMeta / diasUteis : 0;
  const vendasPorDia = diasUteis > 0 ? vendasMeta / diasUteis : 0;

  return {
    custoFixoTotal, marketingTotal, custoFixoMaisMarketing,
    comissaoPorVenda, custoVarPorVenda, lucroPorVenda,
    vendasBreakEven, faturamentoBreakEven,
    vendasMeta, faturamentoMeta, comissaoMeta,
    atendimentosMeta, atendimentosPorDia, vendasPorVendedorMes, atendimentosPorVendedorDia,
    cplMaximo, roiMarketing,
    margemLiquidaPct, comissaoMediaPorVenda: comissaoPorVenda, faturamentoDiario, vendasPorDia,
  };
}

// ============================================================
// UI PRIMITIVES
// ============================================================

/** Título de seção — hairline + label, sem ícone decorativo. */
function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Campo de premissa. Altura fixa pra todos os cards ficarem na mesma linha de base. */
function Premissa({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col rounded-[12px] border p-3.5 h-[104px]"
      style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
    >
      <label className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)] mb-2">
        {label}
      </label>
      {children}
      <p className="text-[11px] text-[var(--ink-3)] mt-auto pt-1.5 leading-tight truncate" title={hint}>
        {hint ?? ''}
      </p>
    </div>
  );
}

const inputBase =
  'w-full h-[34px] px-2.5 rounded-[8px] border text-[14px] tabular-nums text-right ' +
  'text-[var(--ink)] outline-none transition-colors ' +
  'focus:border-[var(--lg-accent)] focus:ring-2 focus:ring-[var(--lg-accent)]/15';

const inputStyle = { borderColor: 'var(--line)', background: 'var(--ink-surface-2)' } as const;

/** Linha do relatório. Sem ícone por linha — a hierarquia vem do peso do texto. */
function Linha({ label, value, forte, alerta }: {
  label: string; value: string; forte?: boolean; alerta?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-[7px]">
      <span
        className={`text-[13px] leading-snug ${forte ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-2)]'}`}
      >
        {alerta && <AlertTriangle className="w-3 h-3 inline-block mr-1.5 -mt-0.5" style={{ color: 'var(--lg-warn)' }} />}
        {label}
      </span>
      <span
        className={`text-[13px] tabular-nums whitespace-nowrap ${forte ? 'font-bold text-[var(--ink)]' : 'font-medium text-[var(--ink-2)]'}`}
        style={alerta ? { color: 'var(--lg-warn)' } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function GrupoLinhas({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-t" style={{ borderColor: 'var(--line)' }}>
      <div className="px-4 pt-3 pb-1">
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[var(--ink-3)]">
          {titulo}
        </span>
      </div>
      <div className="pb-2">{children}</div>
    </div>
  );
}

/** Linha de total no rodapé de cada bloco de custo. */
function TotalLinha({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 px-4 py-3 border-t"
      style={{ borderColor: 'var(--line)', background: 'var(--ink-surface-2)' }}
    >
      <span className="text-[12.5px] font-semibold text-[var(--ink-2)]">{label}</span>
      <span
        className="text-[17px] font-bold tabular-nums"
        style={{ color: accent ?? 'var(--ink)' }}
      >
        {value}
      </span>
    </div>
  );
}

function Bloco({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[14px] border overflow-hidden"
      style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
    >
      {children}
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

// ------------------------------------------------------------
// Helpers para integração com funis em execução
// ------------------------------------------------------------

interface FunilResumoExec {
  count: number;
  investimentoTotal: number;
  receitaProjetada: number;
  /** Investimento agrupado por canal (chave casando com CANAIS_MARKETING quando possível) */
  porCanal: Record<string, number>;
}

function resumirFunisExecucao(funis: FunilPayload[]): FunilResumoExec {
  const ativos = funis.filter(f => f.status === 'em_execucao');
  let investimentoTotal = 0;
  let receitaProjetada = 0;
  const porCanal: Record<string, number> = {};

  for (const f of ativos) {
    const nodes = f.data?.nodes ?? [];
    for (const n of nodes) {
      if (n.data?.categoria === 'trafego') {
        const invest = n.data.config?.investimento ?? 0;
        investimentoTotal += invest;
        const canal = canalDoTipo(n.data.tipo);
        porCanal[canal] = (porCanal[canal] ?? 0) + invest;
      }
    }
    receitaProjetada += f.data?.cenarios?.[0]?.kpis?.receita_bruta ?? 0;
  }

  return { count: ativos.length, investimentoTotal, receitaProjetada, porCanal };
}

/** Mapeia os tipos de tráfego do funil para os canais usados em /custos. */
function canalDoTipo(tipo: string): string {
  if (tipo.includes('instagram')) return 'Instagram Ads';
  if (tipo.includes('google') || tipo.includes('sem')) return 'Google Ads';
  if (tipo.includes('influen')) return 'Influenciadores';
  if (tipo.includes('evento')) return 'Eventos';
  if (tipo.includes('afiliad')) return 'Afiliados';
  return 'Outros';
}

export default function CustosPage() {
  const [mes, setMes] = useState(mesAtual());
  const [data, setData] = useState<CustosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [funis, setFunis] = useState<FunilPayload[]>([]);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/planejamento/custos?mes=${m}`);
      const json = await res.json();
      if (json) {
        const merged = { ...createDefault(m), ...json, mes: m };
        if (!merged.custos_variaveis?.some((c: CustoVariavel) => c.base)) {
          merged.custos_variaveis = createDefault(m).custos_variaveis;
        }
        setData(merged);
      } else {
        setData(createDefault(m));
      }
    } catch { setData(createDefault(m)); }
    setLoading(false);
  }, []);

  useEffect(() => { load(mes); }, [mes, load]);

  useEffect(() => {
    fetch('/api/funis').then(r => r.json()).then((list: FunilPayload[]) => {
      setFunis(Array.isArray(list) ? list : []);
    }).catch(() => setFunis([]));
  }, []);

  const resumoFunis = useMemo(() => resumirFunisExecucao(funis), [funis]);

  useEffect(() => {
    if (!data || loading) return;
    setSaving(true);
    const t = setTimeout(async () => {
      try {
        await fetch('/api/planejamento/custos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } catch { /* silent */ }
      setSaving(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [data, loading]);

  const copyFromPrev = async () => {
    const [y, m] = mes.split('-').map(Number);
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const prevKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
    try {
      const res = await fetch(`/api/planejamento/custos?mes=${prevKey}`);
      const json = await res.json();
      if (json) setData({ ...json, id: generateId(), mes });
    } catch { /* ignore */ }
  };

  const rel = useMemo(() => data ? calcRelatorio(data) : null, [data]);

  const importarCustosFunis = () => {
    if (!data || resumoFunis.count === 0) return;
    const nova = data.marketing.map(item => ({
      ...item,
      valor: resumoFunis.porCanal[item.canal] ?? item.valor,
    }));
    setData({ ...data, marketing: nova });
  };

  if (loading) return (
    <div className="p-6">
      <MinimalPageHead title="Planejamento mensal" meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Carregando…</p>} />
      <SkeletonTable rows={5} cols={3} />
    </div>
  );

  if (!data || !rel) return null;

  const totalFixo = rel.custoFixoTotal;
  const totalMarketing = rel.marketingTotal;
  const viavel = rel.lucroPorVenda > 0;

  // Composição do custo mensal — mostra pra onde o dinheiro vai antes de
  // qualquer venda acontecer.
  const mktFixo = data.custos_fixos
    .filter(c => c.categoria === 'Marketing fixo recorrente')
    .reduce((s, c) => s + (c.valor || 0), 0);
  const fixoSemMkt = totalFixo - mktFixo;
  const baseComposicao = rel.custoFixoMaisMarketing || 1;
  const pctFixo = (fixoSemMkt / baseComposicao) * 100;
  const pctMkt = (totalMarketing / baseComposicao) * 100;

  // Quanto do caminho até a meta já é consumido só para empatar.
  const pctBreakEven = rel.vendasMeta > 0
    ? Math.min(100, (rel.vendasBreakEven / rel.vendasMeta) * 100)
    : 0;

  const alertas: { tom: 'erro' | 'aviso'; texto: string }[] = [];
  if (!viavel) {
    alertas.push({ tom: 'erro', texto: 'A comissão por venda não cobre os custos variáveis. Revise a margem ou os custos antes de definir metas.' });
  }
  if (rel.cplMaximo > 0 && rel.cplMaximo < 10) {
    alertas.push({ tom: 'aviso', texto: `Custo por lead máximo muito baixo (${formatBRL(rel.cplMaximo)}). Aumente o investimento em marketing ou melhore a conversão.` });
  }
  if (rel.roiMarketing > 0 && rel.roiMarketing < 3) {
    alertas.push({ tom: 'aviso', texto: 'Retorno do marketing abaixo de 3x. Otimize os canais ou reduza o investimento nos menos eficientes.' });
  }
  if (rel.atendimentosPorVendedorDia > 8) {
    alertas.push({ tom: 'aviso', texto: `${rel.atendimentosPorVendedorDia} atendimentos por vendedor ao dia pode comprometer a qualidade. Considere ampliar o time.` });
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <MinimalPageHead
        title="Planejamento mensal"
        meta={
          <p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            {mesPorExtenso(mes)} ·{' '}
            <b style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{saving ? 'Salvando…' : 'Salvo'}</b>
          </p>
        }
        actions={
          <>
            <input
              type="month"
              value={mes}
              onChange={e => setMes(e.target.value)}
              className="h-[34px] px-3 text-[12px] border rounded-[8px] outline-none focus:border-[var(--lg-accent)]"
              style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
            />
            <button
              onClick={copyFromPrev}
              className="h-[34px] px-3 text-[12px] border rounded-[8px] transition-colors hover:bg-[var(--ink-surface-2)]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
            >
              <Copy className="w-3.5 h-3.5 inline mr-2 -mt-0.5" /> Copiar do anterior
            </button>
          </>
        }
      />

      {/* ============================================================ */}
      {/* A RESPOSTA — o que este plano exige do mês                    */}
      {/* ============================================================ */}
      <section
        className="rounded-[16px] border overflow-hidden mb-7"
        style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
      >
        {viavel ? (
          <>
            <div className="px-6 pt-5 pb-4">
              <p className="text-[12.5px] text-[var(--ink-3)]">
                Para lucrar{' '}
                <b className="text-[var(--ink)] font-semibold">{formatBRL(data.lucro_desejado)}</b>{' '}
                em {mesPorExtenso(mes)}, este plano exige
              </p>

              {/* O valor de faturamento é sempre o mais largo — escala com a
                  viewport pra não invadir a coluna vizinha em telas médias. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 mt-4">
                <div className="min-w-0">
                  <p className="text-[clamp(28px,3vw,38px)] leading-none font-bold tabular-nums text-[var(--ink)]">
                    {rel.vendasMeta}
                  </p>
                  <p className="text-[12.5px] text-[var(--ink-2)] mt-1.5">
                    vendas fechadas
                    <span className="text-[var(--ink-3)]"> · {dec(rel.vendasPorDia)} por dia útil</span>
                  </p>
                </div>
                <div className="min-w-0">
                  <p
                    className="text-[clamp(24px,2.6vw,38px)] leading-none font-bold tabular-nums truncate"
                    style={{ color: 'var(--lg-stat-green)' }}
                    title={formatBRL(rel.faturamentoMeta)}
                  >
                    {formatBRL(rel.faturamentoMeta)}
                  </p>
                  <p className="text-[12.5px] text-[var(--ink-2)] mt-1.5">
                    de faturamento
                    <span className="text-[var(--ink-3)]"> · {formatBRL(rel.faturamentoDiario)} por dia</span>
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[clamp(28px,3vw,38px)] leading-none font-bold tabular-nums text-[var(--ink)]">
                    {rel.atendimentosMeta}
                  </p>
                  <p className="text-[12.5px] text-[var(--ink-2)] mt-1.5">
                    leads atendidos
                    <span className="text-[var(--ink-3)]"> · {rel.atendimentosPorDia} por dia</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Quanto do esforço é só para empatar */}
            <div className="px-6 pb-5">
              <div
                className="h-[7px] rounded-full overflow-hidden flex"
                style={{ background: 'var(--ink-surface-2)' }}
                role="img"
                aria-label={`${rel.vendasBreakEven} das ${rel.vendasMeta} vendas cobrem os custos; o restante vira lucro`}
              >
                <div style={{ width: `${pctBreakEven}%`, background: 'var(--lg-stat-amber)' }} />
                <div style={{ width: `${100 - pctBreakEven}%`, background: 'var(--lg-stat-green)' }} />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2.5 text-[11.5px]">
                <span className="inline-flex items-center gap-1.5 text-[var(--ink-2)]">
                  <i className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--lg-stat-amber)' }} />
                  <b className="tabular-nums font-semibold">{rel.vendasBreakEven}</b> vendas cobrem os custos
                  <span className="text-[var(--ink-3)]">({formatBRL(rel.faturamentoBreakEven)})</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[var(--ink-2)]">
                  <i className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--lg-stat-green)' }} />
                  as outras <b className="tabular-nums font-semibold">{Math.max(0, rel.vendasMeta - rel.vendasBreakEven)}</b> viram lucro
                </span>
                <span className="text-[var(--ink-3)] ml-auto">
                  Margem líquida <b className="tabular-nums text-[var(--ink-2)]">{dec(rel.margemLiquidaPct)}%</b>
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="px-6 py-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--lg-neg)' }} />
            <div>
              <p className="text-[15px] font-semibold text-[var(--ink)]">
                Este plano não fecha
              </p>
              <p className="text-[13px] text-[var(--ink-2)] mt-1 max-w-[70ch] leading-relaxed">
                A comissão de {formatBRL(rel.comissaoPorVenda)} por venda não cobre os{' '}
                {formatBRL(rel.custoVarPorVenda)} de custo variável. Cada venda dá prejuízo de{' '}
                {formatBRL(Math.abs(rel.lucroPorVenda))}, então nenhuma meta de vendas gera lucro.
                Aumente a margem de comissão ou reduza os custos variáveis.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/* PREMISSAS                                                     */}
      {/* ============================================================ */}
      <section className="mb-7">
        <SectionTitle>Premissas do mês</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Premissa label="Ticket médio" hint={`Comissão de ${formatBRL(rel.comissaoPorVenda)}`}>
            <MoneyInput value={data.ticket_medio} onChange={v => setData({ ...data, ticket_medio: v ?? 0 })} />
          </Premissa>

          <Premissa label="Margem comissão" hint={`${data.margem_comissao || 0}% do ticket`}>
            <input type="number" min={0} max={100} step={0.5} value={data.margem_comissao || ''}
              onChange={e => setData({ ...data, margem_comissao: parseFloat(e.target.value) || 0 })}
              className={inputBase} style={inputStyle} />
          </Premissa>

          <Premissa label="Taxa conversão" hint={`${data.taxa_conversao || 0} de cada 100 leads fecham`}>
            <input type="number" min={0} max={100} step={0.5} value={data.taxa_conversao || ''}
              onChange={e => setData({ ...data, taxa_conversao: parseFloat(e.target.value) || 0 })}
              className={inputBase} style={inputStyle} />
          </Premissa>

          <Premissa label="Lucro desejado" hint="Meta do mês">
            <MoneyInput value={data.lucro_desejado} onChange={v => setData({ ...data, lucro_desejado: v ?? 0 })} />
          </Premissa>

          <Premissa label="Dias úteis" hint="Base do ritmo diário">
            <input type="number" min={1} max={31} value={data.dias_uteis || ''}
              onChange={e => setData({ ...data, dias_uteis: parseInt(e.target.value) || 0 })}
              className={inputBase} style={inputStyle} />
          </Premissa>

          <Premissa
            label="Vendedores"
            hint={data.vendedores_ativos > 1 ? `${rel.vendasPorVendedorMes} vendas cada` : 'No time comercial'}
          >
            <input type="number" min={1} max={100} value={data.vendedores_ativos || ''}
              onChange={e => setData({ ...data, vendedores_ativos: parseInt(e.target.value) || 0 })}
              className={inputBase} style={inputStyle} />
          </Premissa>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_396px] gap-6 items-start">
        {/* ========== ESQUERDA: entradas de custo ========== */}
        <div className="space-y-7 min-w-0">

          {/* Custos fixos */}
          <section>
            <SectionTitle
              right={
                <span className="text-[12px] tabular-nums text-[var(--ink-3)]">
                  {formatBRL(totalFixo)} por mês
                </span>
              }
            >
              Custos fixos mensais
            </SectionTitle>
            <Bloco>
              {data.custos_fixos.map((item, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(140px,1.1fr)_130px_minmax(120px,1.4fr)] items-center gap-3 px-4 py-2 border-b last:border-b-0"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span className="text-[13.5px] text-[var(--ink)] truncate" title={item.categoria}>{item.categoria}</span>
                  <MoneyInput
                    value={item.valor}
                    onChange={v => { const c = [...data.custos_fixos]; c[i] = { ...c[i], valor: v ?? 0 }; setData({ ...data, custos_fixos: c }); }}
                  />
                  <input
                    value={item.observacao}
                    onChange={e => { const c = [...data.custos_fixos]; c[i] = { ...c[i], observacao: e.target.value }; setData({ ...data, custos_fixos: c }); }}
                    placeholder="Observação"
                    className="w-full h-[34px] px-2.5 rounded-[8px] border text-[13px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--lg-accent)]"
                    style={inputStyle}
                  />
                </div>
              ))}
              <TotalLinha label="Total fixo" value={formatBRL(totalFixo)} />
            </Bloco>
          </section>

          {/* Custos variáveis */}
          <section>
            <SectionTitle
              right={
                <span className="text-[12px] tabular-nums text-[var(--ink-3)]">
                  {formatBRL(rel.custoVarPorVenda)} por venda
                </span>
              }
            >
              Custos variáveis por venda
            </SectionTitle>
            <Bloco>
              {data.custos_variaveis.map((item, i) => {
                const valorLinha = (item.base === 'COMISSAO' ? rel.comissaoPorVenda : data.ticket_medio) * (item.percentual || 0) / 100;
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[minmax(120px,1fr)_86px_150px_minmax(90px,0.8fr)] items-center gap-3 px-4 py-2 border-b last:border-b-0"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <span className="text-[13.5px] text-[var(--ink)] truncate" title={item.nome}>{item.nome}</span>
                    <div className="relative">
                      <input
                        type="number" min={0} step={0.5} value={item.percentual || ''}
                        onChange={e => { const c = [...data.custos_variaveis]; c[i] = { ...c[i], percentual: parseFloat(e.target.value) || 0 }; setData({ ...data, custos_variaveis: c }); }}
                        className={`${inputBase} pr-6`} style={inputStyle}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--ink-3)] pointer-events-none">%</span>
                    </div>
                    <select
                      value={item.base || 'VENDA'}
                      onChange={e => { const c = [...data.custos_variaveis]; c[i] = { ...c[i], base: e.target.value as 'VENDA' | 'COMISSAO' }; setData({ ...data, custos_variaveis: c }); }}
                      className="w-full h-[34px] px-2 rounded-[8px] border text-[12.5px] text-[var(--ink-2)] outline-none transition-colors focus:border-[var(--lg-accent)]"
                      style={inputStyle}
                    >
                      <option value="VENDA">sobre a venda</option>
                      <option value="COMISSAO">sobre a comissão</option>
                    </select>
                    <span className="text-[12.5px] tabular-nums text-right text-[var(--ink-2)] whitespace-nowrap">
                      {formatBRL(valorLinha)}
                    </span>
                  </div>
                );
              })}
              <TotalLinha
                label="Total variável por venda"
                value={formatBRL(rel.custoVarPorVenda)}
              />
              <div
                className="flex items-baseline justify-between gap-4 px-4 py-3 border-t"
                style={{ borderColor: 'var(--line)' }}
              >
                <span className="text-[12.5px] font-semibold text-[var(--ink-2)]">
                  Sobra por venda
                  <span className="font-normal text-[var(--ink-3)]"> (comissão − custos)</span>
                </span>
                <span
                  className="text-[17px] font-bold tabular-nums"
                  style={{ color: viavel ? 'var(--lg-stat-green)' : 'var(--lg-neg)' }}
                >
                  {formatBRL(rel.lucroPorVenda)}
                </span>
              </div>
            </Bloco>
          </section>

          {/* Marketing */}
          <section>
            <SectionTitle
              right={
                resumoFunis.count > 0 ? (
                  <button
                    onClick={importarCustosFunis}
                    className="inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[8px] border text-[12px] font-medium transition-colors hover:bg-[var(--t-green-bg)]"
                    style={{ borderColor: 'var(--t-green)', color: 'var(--t-green)' }}
                    title={`Importa o investimento de ${resumoFunis.count} funil(is) em execução, agrupado por canal`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Importar dos funis ativos
                  </button>
                ) : (
                  <span className="text-[12px] tabular-nums text-[var(--ink-3)]">
                    {formatBRL(totalMarketing)} por mês
                  </span>
                )
              }
            >
              Investimento em marketing
            </SectionTitle>
            <Bloco>
              {data.marketing.map((item, i) => {
                const share = totalMarketing > 0 ? (item.valor / totalMarketing) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[minmax(140px,1.1fr)_130px_minmax(120px,1.4fr)] items-center gap-3 px-4 py-2 border-b last:border-b-0"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <span className="text-[13.5px] text-[var(--ink)] truncate">{item.canal}</span>
                    <MoneyInput
                      value={item.valor}
                      onChange={v => { const c = [...data.marketing]; c[i] = { ...c[i], valor: v ?? 0 }; setData({ ...data, marketing: c }); }}
                    />
                    {/* Participação do canal no total — leitura rápida de onde o dinheiro está */}
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'var(--ink-surface-2)' }}>
                        <div
                          className="h-full rounded-full transition-[width] duration-300"
                          style={{ width: `${share}%`, background: 'var(--lg-stat-violet)' }}
                        />
                      </div>
                      <span className="text-[11.5px] tabular-nums text-[var(--ink-3)] w-[38px] text-right">
                        {share > 0 ? `${dec(share, 0)}%` : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
              <TotalLinha label="Total marketing" value={formatBRL(totalMarketing)} />
            </Bloco>
          </section>
        </div>

        {/* ========== DIREITA: leitura do plano ========== */}
        <div className="lg:sticky lg:top-4 space-y-4 min-w-0">

          {/* Composição do custo mensal */}
          <div
            className="rounded-[14px] border p-4"
            style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
          >
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <span className="text-[12.5px] font-semibold text-[var(--ink-2)]">Custo do mês</span>
              <span className="text-[15px] font-bold tabular-nums text-[var(--ink)]">
                {formatBRL(rel.custoFixoMaisMarketing)}
              </span>
            </div>
            <div className="h-[7px] rounded-full overflow-hidden flex" style={{ background: 'var(--ink-surface-2)' }}>
              <div style={{ width: `${pctFixo}%`, background: 'var(--lg-stat-blue)' }} />
              <div style={{ width: `${pctMkt}%`, background: 'var(--lg-stat-violet)' }} />
            </div>
            <div className="flex items-center gap-4 mt-2.5 text-[11.5px] text-[var(--ink-2)]">
              <span className="inline-flex items-center gap-1.5">
                <i className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--lg-stat-blue)' }} />
                Fixos <b className="tabular-nums">{formatBRL(fixoSemMkt)}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--lg-stat-violet)' }} />
                Marketing <b className="tabular-nums">{formatBRL(totalMarketing)}</b>
              </span>
            </div>
          </div>

          {/* Funis em execução */}
          {resumoFunis.count > 0 && (
            <div
              className="rounded-[14px] border overflow-hidden"
              style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
            >
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'var(--t-green-bg)' }}>
                <FunilIcon className="w-3.5 h-3.5" style={{ color: 'var(--t-green)' }} />
                <span className="text-[12.5px] font-semibold text-[var(--ink)]">Funis em execução</span>
                <span className="ml-auto text-[12px] font-semibold tabular-nums" style={{ color: 'var(--t-green)' }}>
                  {resumoFunis.count}
                </span>
              </div>
              <div className="px-4 py-2.5">
                <Linha label="Investimento projetado" value={formatBRL(resumoFunis.investimentoTotal)} />
                <Linha label="Receita projetada" value={formatBRL(resumoFunis.receitaProjetada)} forte />
                <Link
                  href="/planejamento/funis"
                  className="flex items-center justify-center gap-1 mt-1.5 py-1.5 text-[12.5px] rounded-[8px] transition-colors hover:bg-[var(--ink-surface-2)]"
                  style={{ color: 'var(--t-green)' }}
                >
                  Ver funis <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}

          {/* Detalhamento */}
          <div
            className="rounded-[14px] border overflow-hidden"
            style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
          >
            <div className="px-4 py-3">
              <span className="text-[12.5px] font-semibold text-[var(--ink)]">Detalhamento do plano</span>
            </div>

            <GrupoLinhas titulo="Por venda">
              <Linha label="Comissão recebida" value={formatBRL(rel.comissaoPorVenda)} />
              <Linha label="Custo variável" value={`− ${formatBRL(rel.custoVarPorVenda)}`} />
              <Linha label="Sobra por venda" value={formatBRL(rel.lucroPorVenda)} forte alerta={!viavel} />
            </GrupoLinhas>

            <GrupoLinhas titulo="Ponto de equilíbrio">
              <Linha label="Vendas para cobrir custos" value={`${rel.vendasBreakEven}`} forte />
              <Linha label="Faturamento mínimo" value={formatBRL(rel.faturamentoBreakEven)} />
            </GrupoLinhas>

            <GrupoLinhas titulo={`Meta de ${formatBRL(data.lucro_desejado)}`}>
              <Linha label="Vendas necessárias" value={`${rel.vendasMeta}`} forte />
              <Linha label="Faturamento necessário" value={formatBRL(rel.faturamentoMeta)} />
              <Linha label="Comissão total do time" value={formatBRL(rel.comissaoMeta)} />
              <Linha label="Margem líquida" value={`${dec(rel.margemLiquidaPct)}%`} />
            </GrupoLinhas>

            <GrupoLinhas titulo={`Ritmo · ${data.dias_uteis} dias úteis`}>
              <Linha label="Faturamento por dia" value={formatBRL(rel.faturamentoDiario)} />
              <Linha label="Vendas por dia" value={dec(rel.vendasPorDia)} />
              {data.vendedores_ativos > 1 && (
                <>
                  <Linha label={`Vendas por vendedor (${data.vendedores_ativos})`} value={`${rel.vendasPorVendedorMes}`} />
                  <Linha
                    label="Atendimentos por vendedor/dia"
                    value={`${rel.atendimentosPorVendedorDia}`}
                    alerta={rel.atendimentosPorVendedorDia > 8}
                  />
                </>
              )}
            </GrupoLinhas>

            <GrupoLinhas titulo={`Aquisição · conversão de ${data.taxa_conversao}%`}>
              <Linha label="Leads necessários" value={`${rel.atendimentosMeta}`} forte />
              <Linha label="Atendimentos por dia" value={`${rel.atendimentosPorDia}`} />
              <Linha label="Custo máximo por lead" value={formatBRL(rel.cplMaximo)} alerta={rel.cplMaximo > 0 && rel.cplMaximo < 10} />
              <Linha label="Retorno do marketing" value={`${dec(rel.roiMarketing)}x`} alerta={rel.roiMarketing > 0 && rel.roiMarketing < 3} />
            </GrupoLinhas>
          </div>

          {/* Pontos de atenção */}
          {alertas.length > 0 && (
            <div className="space-y-2">
              {alertas.map((a, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3"
                  style={{
                    borderColor: a.tom === 'erro' ? 'var(--lg-neg)' : 'var(--line)',
                    background: a.tom === 'erro' ? 'var(--lg-neg-fill)' : 'var(--lg-warn-fill)',
                  }}
                >
                  <AlertTriangle
                    className="w-4 h-4 mt-[1px] shrink-0"
                    style={{ color: a.tom === 'erro' ? 'var(--lg-neg)' : 'var(--lg-warn)' }}
                  />
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--lg-text-2)' }}>
                    {a.texto}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <MinimalFooter pageId="planejamento mensal" />
    </div>
  );
}
