'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { MoneyInput } from '@/components/MoneyInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { formatBRL, generateId } from '@/lib/utils';
import { Copy, Target, TrendingUp, Users, DollarSign, AlertTriangle, CheckCircle, ArrowRight, Zap, BarChart3, Filter as FunilIcon, Download } from 'lucide-react';
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

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
// COMPONENTS
// ============================================================

function MetricCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-secondary)]">{label}</p>
          <p className="text-xl font-bold mt-1 truncate" style={{ color }} title={value}>{value}</p>
          {sub && <p className="text-[12px] text-[var(--t-text-secondary)] mt-0.5 truncate">{sub}</p>}
        </div>
        <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: color + '18' }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
    </div>
  );
}

function ReportLine({ label, value, highlight, warn }: {
  label: string; value: string; highlight?: boolean; warn?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 px-4 ${highlight ? 'bg-[var(--t-surface-hover)]' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {warn ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : highlight ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <ArrowRight className="w-3 h-3 text-[var(--t-text-secondary)] shrink-0" />}
        <span className={`text-sm leading-snug ${highlight ? 'font-semibold text-[var(--t-text)]' : 'text-[var(--t-text-secondary)]'}`}>{label}</span>
      </div>
      <span className={`text-sm font-mono tabular-nums whitespace-nowrap ${highlight ? 'font-bold text-[var(--t-text)]' : 'text-[var(--t-text)]'}`}>{value}</span>
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
      <PageHeader title="Planejamento Mensal" />
      <SkeletonTable rows={5} cols={3} />
    </div>
  );

  if (!data || !rel) return null;

  const totalFixo = rel.custoFixoTotal;
  const totalMarketing = rel.marketingTotal;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Planejamento Mensal"
        subtitle={saving ? 'Salvando...' : 'Salvo'}
        actions={
          <div className="flex items-center gap-3">
            <input
              type="month"
              value={mes}
              onChange={e => setMes(e.target.value)}
              className="px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
            />
            <button onClick={copyFromPrev} className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)] transition-colors">
              <Copy className="w-3.5 h-3.5" /> Copiar do anterior
            </button>
          </div>
        }
      />

      {/* ============================================================ */}
      {/* INDICADORES DO MÊS */}
      {/* ============================================================ */}
      <section className="mb-8">
        <h2 className="text-[var(--text-body-lg)] font-semibold text-[var(--t-text)] mb-4 flex items-center gap-2">
          <Target className="w-5 h-5" style={{ color: '#d4a853' }} />
          Indicadores do mês
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 rounded-xl bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-secondary)] block mb-1.5">Ticket médio</label>
            <MoneyInput value={data.ticket_medio} onChange={v => setData({ ...data, ticket_medio: v ?? 0 })} />
          </div>
          <div className="p-3 rounded-xl bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-secondary)] block mb-1.5">Margem comissão (%)</label>
            <input type="number" min={0} max={100} step={0.5} value={data.margem_comissao || ''} onChange={e => setData({ ...data, margem_comissao: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            <p className="text-[12px] text-[var(--t-text-secondary)] mt-1.5">Comissão: {formatBRL(rel.comissaoPorVenda)}/venda</p>
          </div>
          <div className="p-3 rounded-xl bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-secondary)] block mb-1.5">Taxa conversão (%)</label>
            <input type="number" min={0} max={100} step={0.5} value={data.taxa_conversao || ''} onChange={e => setData({ ...data, taxa_conversao: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            <p className="text-[12px] text-[var(--t-text-secondary)] mt-1.5">A cada 100 leads, {data.taxa_conversao} viram venda</p>
          </div>
          <div className="p-3 rounded-xl bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-secondary)] block mb-1.5">Lucro desejado</label>
            <MoneyInput value={data.lucro_desejado} onChange={v => setData({ ...data, lucro_desejado: v ?? 0 })} />
          </div>
          <div className="p-3 rounded-xl bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-secondary)] block mb-1.5">Dias úteis</label>
            <input type="number" min={1} max={31} value={data.dias_uteis || ''} onChange={e => setData({ ...data, dias_uteis: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
          </div>
          <div className="p-3 rounded-xl bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-secondary)] block mb-1.5">Vendedores ativos</label>
            <input type="number" min={1} max={100} value={data.vendedores_ativos || ''} onChange={e => setData({ ...data, vendedores_ativos: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6">
        {/* LEFT: Inputs */}
        <div className="space-y-8">
          {/* Custos Fixos */}
          <section>
            <h2 className="text-[var(--text-body-lg)] font-semibold text-[var(--t-text)] mb-3">Custos fixos mensais</h2>
            <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
              {data.custos_fixos.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-2.5 border-b border-[var(--t-border)] last:border-b-0">
                  <span className="text-[var(--text-body-sm)] text-[var(--t-text)] w-48 shrink-0">{item.categoria}</span>
                  <MoneyInput value={item.valor} onChange={v => { const c = [...data.custos_fixos]; c[i] = { ...c[i], valor: v ?? 0 }; setData({ ...data, custos_fixos: c }); }} />
                  <input value={item.observacao} onChange={e => { const c = [...data.custos_fixos]; c[i] = { ...c[i], observacao: e.target.value }; setData({ ...data, custos_fixos: c }); }}
                    placeholder="Observação" className="flex-1 px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--t-surface-hover)]">
                <span className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">Total fixo</span>
                <span className="text-[var(--text-body)] font-semibold text-[var(--t-text)]">{formatBRL(totalFixo)}</span>
              </div>
            </div>
          </section>

          {/* Custos Variáveis */}
          <section>
            <h2 className="text-[var(--text-body-lg)] font-semibold text-[var(--t-text)] mb-3">Custos variáveis por venda</h2>
            <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
              {data.custos_variaveis.map((item, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--t-border)] last:border-b-0">
                  <span className="text-[var(--text-body-sm)] text-[var(--t-text)] w-40 shrink-0">{item.nome}</span>
                  <div className="flex items-center gap-1">
                    <input type="number" value={item.percentual || ''} onChange={e => { const c = [...data.custos_variaveis]; c[i] = { ...c[i], percentual: parseFloat(e.target.value) || 0 }; setData({ ...data, custos_variaveis: c }); }}
                      className="w-16 px-2 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] text-right" />
                    <span className="text-[var(--text-body-sm)] text-[var(--t-text-secondary)]">%</span>
                  </div>
                  <select value={item.base || 'VENDA'} onChange={e => { const c = [...data.custos_variaveis]; c[i] = { ...c[i], base: e.target.value as 'VENDA' | 'COMISSAO' }; setData({ ...data, custos_variaveis: c }); }}
                    className="px-2 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[12px] text-[var(--t-text)] min-w-[140px]">
                    <option value="VENDA">% da venda</option>
                    <option value="COMISSAO">% da comissão</option>
                  </select>
                  <span className="text-[12px] text-[var(--t-text-secondary)] ml-auto whitespace-nowrap">
                    {formatBRL((item.base === 'COMISSAO' ? rel.comissaoPorVenda : data.ticket_medio) * (item.percentual || 0) / 100)}/venda
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--t-surface-hover)]">
                <span className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">Total variável por venda</span>
                <span className="text-[var(--text-body)] font-semibold text-[var(--t-text)]">{formatBRL(rel.custoVarPorVenda)}</span>
              </div>
            </div>
          </section>

          {/* Marketing */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[var(--text-body-lg)] font-semibold text-[var(--t-text)]">Investimento em marketing</h2>
              {resumoFunis.count > 0 && (
                <button
                  onClick={importarCustosFunis}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-medium text-[var(--t-green)] border border-[var(--t-green)] rounded-lg hover:bg-[var(--t-green-bg)] transition-colors"
                  title={`Importa o investimento de ${resumoFunis.count} funil(is) em execução, agrupado por canal`}
                >
                  <Download className="w-3.5 h-3.5" />
                  Importar custos dos funis ativos
                </button>
              )}
            </div>
            <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
              {data.marketing.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-2.5 border-b border-[var(--t-border)] last:border-b-0">
                  <span className="text-[var(--text-body-sm)] text-[var(--t-text)] w-48 shrink-0">{item.canal}</span>
                  <MoneyInput value={item.valor} onChange={v => { const c = [...data.marketing]; c[i] = { ...c[i], valor: v ?? 0 }; setData({ ...data, marketing: c }); }} />
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--t-surface-hover)]">
                <span className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">Total marketing</span>
                <span className="text-[var(--text-body)] font-semibold text-[var(--t-text)]">{formatBRL(totalMarketing)}</span>
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT: Relatorio de Precisão */}
        <div className="space-y-4">
          <div className="sticky top-4 space-y-4">

            {/* Funis em execução */}
            {resumoFunis.count > 0 && (
              <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-2 bg-[var(--t-green-bg)]">
                  <FunilIcon className="w-4 h-4 text-[var(--t-green)]" />
                  <span className="text-sm font-semibold text-[var(--t-text)]">Funis em execução este mês</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[var(--t-text-secondary)]">Funis ativos</span>
                    <span className="text-sm font-semibold text-[var(--t-text)]">{resumoFunis.count}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[var(--t-text-secondary)]">Investimento projetado</span>
                    <span className="text-sm font-mono text-[var(--t-text)]">{formatBRL(resumoFunis.investimentoTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[var(--t-text-secondary)]">Receita projetada</span>
                    <span className="text-sm font-mono text-[var(--t-green)]">{formatBRL(resumoFunis.receitaProjetada)}</span>
                  </div>
                  <Link
                    href="/planejamento/funis"
                    className="flex items-center justify-center gap-1 mt-2 px-3 py-1.5 text-[var(--text-body-sm)] text-[var(--t-green)] hover:underline"
                  >
                    Ver funis <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            )}

            {/* Cards resumo */}
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Ponto de Equilíbrio" value={`${rel.vendasBreakEven} vendas`} sub={formatBRL(rel.faturamentoBreakEven)} icon={Target} color="#f59e0b" />
              <MetricCard label="Meta Lucro" value={`${rel.vendasMeta} vendas`} sub={formatBRL(rel.faturamentoMeta)} icon={TrendingUp} color="#22c55e" />
              <MetricCard label="Atendimentos/mês" value={`${rel.atendimentosMeta}`} sub={`${rel.atendimentosPorDia}/dia`} icon={Users} color="#3b82f6" />
              <MetricCard label="CPL Máximo" value={formatBRL(rel.cplMaximo)} sub={`ROI: ${rel.roiMarketing.toFixed(1)}x`} icon={DollarSign} color="#8b5cf6" />
            </div>

            {/* Relatório detalhado */}
            <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: '#1a1a2e' }}>
                <BarChart3 className="w-4 h-4" style={{ color: '#d4a853' }} />
                <span className="text-sm font-semibold text-white">Relatório de Precisão</span>
              </div>

              {/* Estrutura de custos */}
              <div className="px-4 py-2 bg-[var(--t-surface-hover)]">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--t-text-secondary)]">Estrutura de custos</span>
              </div>
              <ReportLine label="Custos fixos + marketing" value={formatBRL(rel.custoFixoMaisMarketing)} />
              <ReportLine label="Comissão por venda" value={formatBRL(rel.comissaoPorVenda)} />
              <ReportLine label="Custo variável por venda" value={formatBRL(rel.custoVarPorVenda)} />
              <ReportLine label="Lucro líquido por venda" value={formatBRL(rel.lucroPorVenda)} highlight />

              {/* Ponto de equilíbrio */}
              <div className="px-4 py-2 bg-[var(--t-surface-hover)]">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--t-text-secondary)]">Ponto de equilíbrio</span>
              </div>
              <ReportLine label="Vendas para cobrir custos" value={`${rel.vendasBreakEven} vendas`} warn={rel.vendasBreakEven > rel.vendasMeta} />
              <ReportLine label="Faturamento mínimo" value={formatBRL(rel.faturamentoBreakEven)} highlight />

              {/* Meta mensal */}
              <div className="px-4 py-2 bg-[var(--t-surface-hover)]">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--t-text-secondary)]">Meta para lucro de {formatBRL(data.lucro_desejado)}</span>
              </div>
              <ReportLine label="Vendas necessárias" value={`${rel.vendasMeta} vendas`} highlight />
              <ReportLine label="Faturamento necessário" value={formatBRL(rel.faturamentoMeta)} />
              <ReportLine label="Comissão total" value={formatBRL(rel.comissaoMeta)} />
              <ReportLine label="Margem líquida s/ faturamento" value={`${rel.margemLiquidaPct.toFixed(1)}%`} />

              {/* Ritmo diário */}
              <div className="px-4 py-2 bg-[var(--t-surface-hover)]">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--t-text-secondary)]">Ritmo diário ({data.dias_uteis} dias úteis)</span>
              </div>
              <ReportLine label="Faturamento por dia" value={formatBRL(rel.faturamentoDiario)} />
              <ReportLine label="Vendas por dia" value={`${rel.vendasPorDia.toFixed(1)}`} />
              {data.vendedores_ativos > 1 && (
                <>
                  <ReportLine label={`Vendas/vendedor/mês (${data.vendedores_ativos} vendedores)`} value={`${rel.vendasPorVendedorMes}`} />
                  <ReportLine label="Atendimentos/vendedor/dia" value={`${rel.atendimentosPorVendedorDia}`} />
                </>
              )}

              {/* Funil de vendas */}
              <div className="px-4 py-2 bg-[var(--t-surface-hover)]">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--t-text-secondary)]">Funil de vendas (conversão {data.taxa_conversao}%)</span>
              </div>
              <ReportLine label="Leads/atendimentos necessários" value={`${rel.atendimentosMeta}`} highlight />
              <ReportLine label="Atendimentos por dia" value={`${rel.atendimentosPorDia}`} />
              <ReportLine label="CPL máximo viável" value={formatBRL(rel.cplMaximo)} highlight warn={rel.cplMaximo < 5} />
              <ReportLine label="ROI do marketing" value={`${rel.roiMarketing.toFixed(1)}x`} warn={rel.roiMarketing < 3} />

              {/* Alertas e insights */}
              <div className="px-4 py-3 space-y-2 border-t border-[var(--t-border)]">
                {rel.lucroPorVenda <= 0 && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10">
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-[13px] leading-snug text-red-500 dark:text-red-400">A comissão por venda não cobre os custos variáveis. Revise a margem ou os custos.</p>
                  </div>
                )}
                {rel.cplMaximo > 0 && rel.cplMaximo < 10 && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-[13px] leading-snug text-amber-600 dark:text-amber-400">CPL máximo muito baixo ({formatBRL(rel.cplMaximo)}). Considere aumentar o investimento em marketing ou melhorar a taxa de conversão.</p>
                  </div>
                )}
                {rel.roiMarketing > 0 && rel.roiMarketing < 3 && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-[13px] leading-snug text-amber-600 dark:text-amber-400">ROI do marketing abaixo de 3x. Otimize os canais ou reduza investimento nos menos eficientes.</p>
                  </div>
                )}
                {rel.atendimentosPorVendedorDia > 8 && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-[13px] leading-snug text-amber-600 dark:text-amber-400">Mais de 8 atendimentos/vendedor/dia pode comprometer a qualidade. Considere contratar mais vendedores.</p>
                  </div>
                )}
                {rel.vendasMeta > 0 && rel.lucroPorVenda > 0 && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-green-500/10">
                    <Zap className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    <p className="text-[13px] leading-snug text-green-600 dark:text-green-400">
                      Para lucrar {formatBRL(data.lucro_desejado)}: fature {formatBRL(rel.faturamentoMeta)} com {rel.vendasMeta} vendas,
                      gerando {rel.atendimentosMeta} leads a no máximo {formatBRL(rel.cplMaximo)} cada.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
