'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { MoneyInput } from '@/components/MoneyInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { formatBRL, generateId } from '@/lib/utils';
import { Copy } from 'lucide-react';

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
  margem_minima: number;
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
      { nome: 'Comissao ao vendedor', percentual: 0, base: 'COMISSAO' },
      { nome: 'Impostos', percentual: 0, base: 'COMISSAO' },
      { nome: 'Outros variaveis', percentual: 0, base: 'VENDA' },
    ],
    marketing: CANAIS_MARKETING.map(c => ({ canal: c, valor: 0 })),
    margem_minima: 15,
  };
}

export default function CustosPage() {
  const [mes, setMes] = useState(mesAtual());
  const [data, setData] = useState<CustosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/planejamento/custos?mes=${m}`);
      const json = await res.json();
      setData(json || createDefault(m));
    } catch { setData(createDefault(m)); }
    setLoading(false);
  }, []);

  useEffect(() => { load(mes); }, [mes, load]);

  // Auto-save debounce
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
      if (json) {
        setData({ ...json, id: generateId(), mes });
      }
    } catch { /* ignore */ }
  };

  const totalFixo = data?.custos_fixos.reduce((s, c) => s + (c.valor || 0), 0) || 0;
  const totalMarketing = data?.marketing.reduce((s, c) => s + (c.valor || 0), 0) || 0;
  const totalMensal = totalFixo + totalMarketing;
  // Exemplo: venda R$10k, comissao R$2.5k
  const exemploVenda = 10000;
  const exemploComissao = 2500;
  const totalVarExemplo = data?.custos_variaveis.reduce((s, c) => {
    const base = c.base === 'COMISSAO' ? exemploComissao : exemploVenda;
    return s + base * (c.percentual || 0) / 100;
  }, 0) || 0;

  if (loading) return (
    <div className="p-6">
      <PageHeader title="Custos do negocio" />
      <SkeletonTable rows={5} cols={3} />
    </div>
  );

  if (!data) return null;

  return (
    <div className="p-6">
      <PageHeader
        title="Custos do negocio"
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

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 space-y-8">
          {/* Custos Fixos */}
          <section>
            <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-3">Custos fixos</h2>
            <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
              {data.custos_fixos.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-[var(--t-border)] last:border-b-0">
                  <span className="text-[var(--text-body-sm)] text-[var(--t-text)] w-48 shrink-0">{item.categoria}</span>
                  <MoneyInput
                    value={item.valor}
                    onChange={v => {
                      const c = [...data.custos_fixos];
                      c[i] = { ...c[i], valor: v ?? 0 };
                      setData({ ...data, custos_fixos: c });
                    }}
                  />
                  <input
                    value={item.observacao}
                    onChange={e => {
                      const c = [...data.custos_fixos];
                      c[i] = { ...c[i], observacao: e.target.value };
                      setData({ ...data, custos_fixos: c });
                    }}
                    placeholder="Observacao"
                    className="flex-1 px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                  />
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-[var(--t-surface-hover)]">
                <span className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">Total fixo mensal</span>
                <span className="text-[var(--text-body)] font-medium text-[var(--t-text)]">{formatBRL(totalFixo)}</span>
              </div>
            </div>
          </section>

          {/* Custos Variaveis */}
          <section>
            <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-3">Custos variaveis por venda</h2>
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mb-3">
              Defina se cada custo incide sobre o valor total da venda ou sobre a receita da agencia (comissao/markup).
            </p>
            <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
              {data.custos_variaveis.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-[var(--t-border)] last:border-b-0">
                  <span className="text-[var(--text-body-sm)] text-[var(--t-text)] w-48 shrink-0">{item.nome}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={item.percentual || ''}
                      onChange={e => {
                        const c = [...data.custos_variaveis];
                        c[i] = { ...c[i], percentual: parseFloat(e.target.value) || 0 };
                        setData({ ...data, custos_variaveis: c });
                      }}
                      className="w-20 px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] text-right"
                    />
                    <span className="text-[var(--text-body-sm)] text-[var(--t-text-muted)]">%</span>
                  </div>
                  <select
                    value={item.base || 'VENDA'}
                    onChange={e => {
                      const c = [...data.custos_variaveis];
                      c[i] = { ...c[i], base: e.target.value as 'VENDA' | 'COMISSAO' };
                      setData({ ...data, custos_variaveis: c });
                    }}
                    className="px-2 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-caption)] text-[var(--t-text)] min-w-[160px]"
                  >
                    <option value="VENDA">% da venda total</option>
                    <option value="COMISSAO">% da comissao</option>
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-3 p-3 rounded-lg bg-[var(--t-surface-hover)]">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">
                <strong>Exemplo</strong>: Venda de R$ 10.000 com custo fornecedor R$ 7.500 (comissao = R$ 2.500)
              </p>
              <div className="mt-1 space-y-0.5">
                {data.custos_variaveis.filter(v => v.percentual > 0).map((item, i) => {
                  const base = item.base === 'COMISSAO' ? 2500 : 10000;
                  const valor = base * item.percentual / 100;
                  return (
                    <p key={i} className="text-[var(--text-caption)] text-[var(--t-text-secondary)]">
                      {item.nome}: {item.percentual}% {item.base === 'COMISSAO' ? 'da comissao' : 'da venda'} = {formatBRL(valor)}
                    </p>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Marketing */}
          <section>
            <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-3">Investimento em marketing</h2>
            <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
              {data.marketing.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-[var(--t-border)] last:border-b-0">
                  <span className="text-[var(--text-body-sm)] text-[var(--t-text)] w-48 shrink-0">{item.canal}</span>
                  <MoneyInput
                    value={item.valor}
                    onChange={v => {
                      const c = [...data.marketing];
                      c[i] = { ...c[i], valor: v ?? 0 };
                      setData({ ...data, marketing: c });
                    }}
                  />
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-[var(--t-surface-hover)]">
                <span className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">Total marketing</span>
                <span className="text-[var(--text-body)] font-medium text-[var(--t-text)]">{formatBRL(totalMarketing)}</span>
              </div>
            </div>
          </section>
        </div>

        {/* Sticky summary panel */}
        <div className="w-[260px] shrink-0">
          <div className="sticky top-6 space-y-4 p-5 rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)]">
            <div>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Total fixo mensal</p>
              <p className="text-[var(--text-title)] font-medium text-[var(--t-text)]">{formatBRL(totalFixo)}</p>
            </div>
            <div>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Custo variavel (ex. venda R$ 10k)</p>
              <p className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)]">{formatBRL(totalVarExemplo)}</p>
            </div>
            <div>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Marketing mensal</p>
              <p className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)]">{formatBRL(totalMarketing)}</p>
            </div>
            <div className="pt-3 border-t border-[var(--t-border)]">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Custo total mensal</p>
              <p className="text-[var(--text-title)] font-medium text-[var(--t-green)]">{formatBRL(totalMensal)}</p>
            </div>
            <div className="pt-3 border-t border-[var(--t-border)]">
              <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Margem minima por venda (%)</label>
              <input
                type="number"
                value={data.margem_minima || ''}
                onChange={e => setData({ ...data, margem_minima: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
