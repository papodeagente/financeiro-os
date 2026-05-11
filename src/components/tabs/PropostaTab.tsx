'use client';

import { GrupoViagem } from '@/lib/types';
import { calcProposta, calcItensIncluidos, calcResumoFornecedores, type ItemIncluido, type ResumoFornecedor } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';
import { Sparkles, Users, Building2 } from 'lucide-react';

interface Props { grupo: GrupoViagem; }

const ALL_TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };
const PAX_MAP: Record<string, number> = { sgl: 1, dbl: 2, tpl: 3, qdp: 4, chd: 1 };

export function PropostaTab({ grupo }: Props) {
  const tipo = grupo.tipo ?? 'GRUPO';
  const tarifas = grupo.tarifas_ativas || ['sgl', 'dbl', 'tpl', 'qdp'];
  const TIPOS = [...tarifas.filter(t => ALL_TIPOS.includes(t as typeof ALL_TIPOS[number])), 'chd'] as typeof ALL_TIPOS[number][];
  const p = calcProposta(grupo);

  const tipoBase = tipo === 'PROPOSTA' ? 'sgl' : (tarifas[0] ?? 'dbl');

  // Itens efetivamente incluídos no roteiro (so os com dados preenchidos).
  const itens: ItemIncluido[] = calcItensIncluidos(grupo, tipoBase);
  const temItens = itens.length > 0;

  // Resumo por fornecedor — agrupa items vinculados a fornecedores
  // (cadastrados ou por nome livre).
  const fornecedores: ResumoFornecedor[] = calcResumoFornecedores(grupo, tipoBase);
  const totalForn = fornecedores.reduce((acc, f) => ({
    custo: acc.custo + f.custo,
    venda: acc.venda + f.venda,
    margem: acc.margem + f.margem,
  }), { custo: 0, venda: 0, margem: 0 });

  // Resumo geral — referência tipoBase
  const SERVICOS_CUSTO = ['TKT', 'HTL', 'REC', 'CAR', 'GUIA', 'SEG', 'NAVIO', 'ING', 'BRINDE', 'DIVULGACAO'];
  const custoApto = p.lines
    .filter(l => SERVICOS_CUSTO.includes(l.label))
    .reduce((sum, l) => sum + (l[tipoBase as keyof typeof l] as number || 0), 0);
  const vendaApto = (p.totalAvista[tipoBase] as number) || 0;
  const margemApto = Math.max(vendaApto - custoApto, 0);
  const margemPct = vendaApto > 0 ? (margemApto / vendaApto) * 100 : 0;

  const modoSimples =
    (grupo.params.markup ?? 0) === 0 &&
    (grupo.params.tx_ad_mp ?? 0) === 0 &&
    (grupo.params.tx_boleto ?? 0) === 0;

  let margemMediaPct = margemPct;
  if (tipo === 'GRUPO') {
    let somaPesos = 0;
    let somaMargemPct = 0;
    for (const t of tarifas) {
      const c = p.lines
        .filter(l => SERVICOS_CUSTO.includes(l.label))
        .reduce((sum, l) => sum + (l[t as keyof typeof l] as number || 0), 0);
      const v = (p.totalAvista[t] as number) || 0;
      const m = Math.max(v - c, 0);
      const pct = v > 0 ? (m / v) * 100 : 0;
      const peso = PAX_MAP[t] || 1;
      somaPesos += peso;
      somaMargemPct += pct * peso;
    }
    margemMediaPct = somaPesos > 0 ? somaMargemPct / somaPesos : 0;
  }

  // Tipos a mostrar nas tabelas de preço final.
  // Modo PROPOSTA: só SGL faz sentido.
  const TIPOS_PRECO = tipo === 'PROPOSTA' ? ['sgl'] : TIPOS;

  const Row = ({ label, values, className = '' }: { label: string; values: Record<string, number>; className?: string }) => (
    <tr className={className}>
      <td className="p-2 border border-[var(--t-border)] font-medium text-[var(--t-text)]">{label}</td>
      {TIPOS_PRECO.map(t => <td key={t} className="p-2 border border-[var(--t-border)] text-right tabular-nums">{formatBRL(values[t])}</td>)}
    </tr>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-4 rounded-lg flex flex-wrap gap-6">
        <div><span className="text-xs text-[var(--t-accent)]">GRP#</span><div className="font-bold">{grupo.grp_id || '—'}</div></div>
        <div><span className="text-xs text-[var(--t-accent)]">Origem x Destino</span><div className="font-bold">{grupo.origem_destino || '—'}</div></div>
        <div><span className="text-xs text-[var(--t-accent)]">Tipo</span><div className="font-bold">{tipo}</div></div>
        {grupo.params.parcelas > 1 && (
          <div><span className="text-xs text-[var(--t-accent)]">Parcelas</span><div className="font-bold">{grupo.params.parcelas}x</div></div>
        )}
      </div>

      {/* Resumo financeiro — Custo / Venda / Margem (referência {tipoBase.toUpperCase()}) */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">
          Resumo financeiro {tipo === 'GRUPO' && (
            <span className="text-xs text-[var(--t-text-muted)] font-normal">(referência {LABELS[tipoBase] ?? tipoBase.toUpperCase()})</span>
          )}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-4">
            <p className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)]">Preço de custo</p>
            <p className="text-xl font-bold text-[var(--t-text)] mt-1 tabular-nums">{formatBRL(custoApto)}</p>
          </div>
          <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-4">
            <p className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)]">Preço de venda</p>
            <p className="text-xl font-bold text-[var(--t-text)] mt-1 tabular-nums">{formatBRL(vendaApto)}</p>
          </div>
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
            <p className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)]">Margem</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400 mt-1 tabular-nums">{formatBRL(margemApto)}</p>
          </div>
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
            <p className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)]">
              {tipo === 'GRUPO' ? 'Margem média do grupo' : 'Margem %'}
            </p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400 mt-1 tabular-nums">{margemMediaPct.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Itens incluídos — só os que têm dados, com margem individual */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-[var(--t-text)] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--t-accent)]" />
            Itens incluídos
            <span className="text-xs text-[var(--t-text-muted)] font-normal">({itens.length})</span>
          </h3>
          {tipo === 'GRUPO' && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)]">
              valores em {LABELS[tipoBase] ?? tipoBase.toUpperCase()}
            </span>
          )}
        </div>

        {!temItens ? (
          <div className="rounded-xl border border-dashed border-[var(--t-border)] p-8 text-center text-sm text-[var(--t-text-muted)]">
            Nenhum item incluído ainda. Volte nas abas (Aéreo, Hotel, Receptivo, etc.) para adicionar serviços.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {itens.map(item => (
              <div key={item.servico} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-4 flex flex-col gap-3" style={{ boxShadow: 'var(--elevation-1)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--t-text)]">{item.label}</p>
                      {item.vendaManual && (
                        <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400">venda manual</span>
                      )}
                    </div>
                    {item.fornecedores.length > 0 && (
                      <p className="text-xs text-[var(--t-text-muted)] truncate mt-0.5">
                        {item.fornecedores.join(', ')}
                      </p>
                    )}
                    {item.detalhes && (
                      <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">{item.detalhes}</p>
                    )}
                  </div>
                  <div className={`text-right shrink-0 ${item.margem > 0 ? 'text-green-600 dark:text-green-400' : 'text-[var(--t-text-muted)]'}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide">Margem</p>
                    <p className="text-sm font-bold tabular-nums">{formatBRL(item.margem)}</p>
                    {item.venda > 0 && (
                      <p className="text-[10px] tabular-nums opacity-80">{item.margemPct.toFixed(1)}%</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--t-border)]">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)]">Custo</p>
                    <p className="text-sm font-medium text-[var(--t-text)] tabular-nums">{formatBRL(item.custo)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)]">Venda</p>
                    <p className="text-sm font-medium text-[var(--t-text)] tabular-nums">{formatBRL(item.venda)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resumo por fornecedor — quanto cada fornecedor vendeu e a margem */}
      {fornecedores.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-[var(--t-text)] flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[var(--t-accent)]" />
              Por fornecedor
              <span className="text-xs text-[var(--t-text-muted)] font-normal">({fornecedores.length})</span>
            </h3>
          </div>
          <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
                  <th className="text-left px-3 py-2 font-medium">Fornecedor</th>
                  <th className="text-left px-3 py-2 font-medium">Serviços</th>
                  <th className="text-right px-3 py-2 font-medium">Custo</th>
                  <th className="text-right px-3 py-2 font-medium">Venda</th>
                  <th className="text-right px-3 py-2 font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {fornecedores.map(f => (
                  <tr key={f.fornecedor_id || f.nome} className="border-t border-[var(--t-border)] hover:bg-[var(--t-surface-hover)]">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {f.fornecedor_id && <Building2 className="w-3.5 h-3.5 text-[var(--t-green)] shrink-0" />}
                        <span className="text-[var(--t-text)]">{f.nome}</span>
                        {!f.fornecedor_id && (
                          <span className="text-[9px] text-amber-600 dark:text-amber-400 ml-1 italic">não cadastrado</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {f.servicos.map(s => (
                          <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--t-bg)] text-[var(--t-text-secondary)]">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--t-text-secondary)]">{formatBRL(f.custo)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--t-text)]">{formatBRL(f.venda)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={f.margem > 0 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-[var(--t-text-muted)]'}>
                        {formatBRL(f.margem)}
                        {f.venda > 0 && (
                          <span className="text-[10px] ml-1 opacity-70">{f.margemPct.toFixed(1)}%</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--t-border)] bg-[var(--t-surface-hover)] font-semibold">
                  <td colSpan={2} className="px-3 py-2 text-[var(--t-text)]">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBRL(totalForn.custo)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBRL(totalForn.venda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">{formatBRL(totalForn.margem)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {fornecedores.some(f => !f.fornecedor_id) && (
            <p className="text-[10px] text-[var(--t-text-muted)] mt-2 italic">
              Itens com fornecedor &quot;não cadastrado&quot; não são sincronizados com o cadastro central.
              Vincule um fornecedor cadastrado nas abas de serviço para sincronizar com o CRM.
            </p>
          )}
        </div>
      )}

      {/* Preço final ao cliente — só se houver itens */}
      {temItens && (
        <>
          {tipo === 'GRUPO' && (
            <div className="text-sm text-[var(--t-text-secondary)] flex items-center gap-3 flex-wrap">
              <Users className="w-4 h-4" />
              {TIPOS_PRECO.map(t => <span key={t}><b>{LABELS[t]}</b> = {PAX_MAP[t]} PAX</span>)}
            </div>
          )}

          <div>
            <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">
              {tipo === 'GRUPO' ? 'Preço por apartamento' : 'Preço ao cliente'}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
                  <th className="p-2 text-left shadow-[var(--t-card-shadow)] w-40">Modalidade</th>
                  {TIPOS_PRECO.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-32">{LABELS[t]}</th>)}
                </tr></thead>
                <tbody>
                  <Row label={modoSimples ? 'Preço de venda' : 'À Vista / PIX'} values={p.totalAvista} className="bg-green-50 dark:bg-green-950/20 font-bold" />
                  {!modoSimples && <Row label="Cartão de Crédito" values={p.totalCartao} className="bg-blue-50 dark:bg-blue-950/20" />}
                  {!modoSimples && <Row label="Boleto" values={p.totalBoleto} className="bg-orange-50 dark:bg-orange-950/20" />}
                </tbody>
              </table>
            </div>
          </div>

          {tipo === 'GRUPO' && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">Preço por pessoa</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
                    <th className="p-2 text-left shadow-[var(--t-card-shadow)] w-40">Modalidade</th>
                    {TIPOS_PRECO.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-32">{LABELS[t]}</th>)}
                  </tr></thead>
                  <tbody>
                    <Row label={modoSimples ? 'Preço de venda' : 'À Vista / PIX'} values={p.totalPaxAvista} className="bg-green-50 dark:bg-green-950/20 font-bold" />
                    {!modoSimples && <Row label="Cartão de Crédito" values={p.totalPaxCartao} className="bg-blue-50 dark:bg-blue-950/20" />}
                    {!modoSimples && <Row label="Boleto" values={p.totalPaxBoleto} className="bg-orange-50 dark:bg-orange-950/20" />}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {grupo.params.parcelas > 1 && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--t-text)] mb-3">
                Parcelamento ({grupo.params.parcelas}x)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
                    <th className="p-2 text-left shadow-[var(--t-card-shadow)] w-40">Modalidade</th>
                    {TIPOS_PRECO.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-32">{LABELS[t]}</th>)}
                  </tr></thead>
                  <tbody>
                    {modoSimples ? (
                      <Row label={tipo === 'GRUPO' ? 'Parcela por apto' : 'Valor da parcela'} values={p.parcelaAptoCC} className="bg-blue-50 dark:bg-blue-950/20" />
                    ) : (
                      <>
                        <Row label="Parcela Cartão" values={p.parcelaAptoCC} className="bg-blue-50 dark:bg-blue-950/20" />
                        <Row label="Parcela Boleto" values={p.parcelaAptoBoleto} className="bg-orange-50 dark:bg-orange-950/20" />
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
