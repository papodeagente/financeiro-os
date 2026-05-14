'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Loader2, TrendingUp, TrendingDown, DollarSign, Users, AlertCircle,
  Plus, Link2, Unlink, ExternalLink, RefreshCw, X, Check, Search,
} from 'lucide-react';
import { toast } from '@/lib/toast';

interface ResumoFin {
  receita: { previsto: number; recebido: number; em_aberto: number; vencido: number };
  despesa: { previsto: number; pago: number; em_aberto: number; vencido: number };
  lucro_previsto: number;
  lucro_realizado: number;
  margem_prevista: number;
  margem_realizada: number;
  qtd_pax_confirmados: number;
  lucro_por_pax: number;
  ponto_equilibrio_pax: number;
}

interface ContaReceberMin {
  id: string;
  descricao: string;
  cliente_nome: string;
  data_emissao: string;
  data_vencimento: string;
  valor_final: number;
  valor_recebido?: number | null;
  status: string;
  parcela_numero?: number;
  total_parcelas?: number;
}

interface ContaPagarMin {
  id: string;
  descricao: string;
  fornecedor_nome: string;
  categoria_id: string;
  data_emissao: string;
  data_vencimento: string;
  valor_final: number;
  valor_pago?: number | null;
  status: string;
  parcela_numero?: number;
  total_parcelas?: number;
}

interface FinanceiroAPI {
  resumo: ResumoFin;
  receitas: ContaReceberMin[];
  despesas: ContaPagarMin[];
  contagem_passageiros: { total: number; adt: number; chd: number; inf: number };
}

interface DespesaCandidata {
  id: string;
  data: ContaPagarMin & { grupo_id?: string | null };
}

interface Props {
  grupoId: string;
  origemDestino: string;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0);

const fmtBRLExato = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const fmtData = (iso?: string): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

const STATUS_RECEBER_BADGE: Record<string, string> = {
  RECEBIDO: 'badge badge--success',
  PARCIAL: 'badge badge--info',
  PENDENTE: 'badge badge--warning',
  ATRASADO: 'badge badge--danger',
  CANCELADO: 'badge badge--neutral',
};
const STATUS_PAGAR_BADGE: Record<string, string> = {
  PAGO: 'badge badge--success',
  PARCIAL: 'badge badge--info',
  PENDENTE: 'badge badge--warning',
  VENCIDO: 'badge badge--danger',
  CANCELADO: 'badge badge--neutral',
};

export function FinanceiroTab({ grupoId, origemDestino }: Props) {
  const [data, setData] = useState<FinanceiroAPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [vincularOpen, setVincularOpen] = useState(false);

  const carregar = useCallback(async (silencioso = false) => {
    if (silencioso) setReloading(true); else setLoading(true);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}/financeiro`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        toast.error('Falha ao carregar financeiro do grupo');
      }
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, [grupoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  if (loading || !data) {
    return (
      <div className="border p-10 text-center rounded-[12px]" style={{ borderColor: 'var(--lg-border-base)' }}>
        <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--lg-text-3)' }} />
      </div>
    );
  }

  const { resumo, receitas, despesas } = data;
  const semDados = resumo.receita.previsto === 0 && resumo.despesa.previsto === 0;
  const lucroPositivo = resumo.lucro_previsto >= 0;
  const margemCor = resumo.margem_prevista >= 20 ? 'var(--lg-pos)' : resumo.margem_prevista >= 0 ? 'var(--lg-warn)' : 'var(--lg-neg)';

  const desvincular = async (contaId: string) => {
    if (!confirm('Desvincular esta despesa do grupo? A conta a pagar continua existindo no financeiro.')) return;
    const res = await fetch(`/api/gestao-grupos/${grupoId}/financeiro/vincular-despesa?conta_pagar_id=${contaId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || 'Falha ao desvincular');
      return;
    }
    toast.success('Despesa desvinculada');
    await carregar(true);
  };

  return (
    <div className="space-y-5">
      {/* KPIs principais — Receita, Despesa, Lucro */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Receita prevista</div>
          <div className="kpi-card__value tabular-nums">{fmtBRL(resumo.receita.previsto)}</div>
          <div className="kpi-card__meta">
            Recebido <b style={{ color: 'var(--lg-pos)' }}>{fmtBRL(resumo.receita.recebido)}</b>
            {' · '}Em aberto {fmtBRL(resumo.receita.em_aberto)}
            {resumo.receita.vencido > 0 && (
              <> · <b style={{ color: 'var(--lg-neg)' }}>{fmtBRL(resumo.receita.vencido)} vencido</b></>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card__label">Despesa prevista</div>
          <div className="kpi-card__value tabular-nums">{fmtBRL(resumo.despesa.previsto)}</div>
          <div className="kpi-card__meta">
            Pago <b>{fmtBRL(resumo.despesa.pago)}</b>
            {' · '}Em aberto {fmtBRL(resumo.despesa.em_aberto)}
            {resumo.despesa.vencido > 0 && (
              <> · <b style={{ color: 'var(--lg-neg)' }}>{fmtBRL(resumo.despesa.vencido)} vencido</b></>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card__label">Lucro previsto</div>
          <div
            className="kpi-card__value tabular-nums"
            style={{ color: lucroPositivo ? 'var(--lg-pos)' : 'var(--lg-neg)' }}
          >
            {fmtBRL(resumo.lucro_previsto)}
          </div>
          <div className="kpi-card__meta">
            Realizado <b style={{ color: lucroPositivo ? 'var(--lg-pos)' : 'var(--lg-neg)' }}>{fmtBRL(resumo.lucro_realizado)}</b>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card__label">Margem prevista</div>
          <div
            className="kpi-card__value tabular-nums"
            style={{ color: margemCor }}
          >
            {resumo.margem_prevista.toFixed(1)}%
          </div>
          <div className="kpi-card__meta">
            Realizada <b>{resumo.margem_realizada.toFixed(1)}%</b>
          </div>
        </div>
      </div>

      {/* KPIs secundários — por pax + ponto de equilíbrio */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Passageiros confirmados</div>
          <div className="kpi-card__value tabular-nums">{resumo.qtd_pax_confirmados}</div>
          <div className="kpi-card__meta flex items-center gap-1">
            <Users className="w-3 h-3" />
            {data.contagem_passageiros.adt} ADT
            {data.contagem_passageiros.chd > 0 && ` · ${data.contagem_passageiros.chd} CHD`}
            {data.contagem_passageiros.inf > 0 && ` · ${data.contagem_passageiros.inf} INF`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card__label">Lucro por pax</div>
          <div
            className="kpi-card__value tabular-nums"
            style={{ color: resumo.lucro_por_pax >= 0 ? 'var(--lg-pos)' : 'var(--lg-neg)' }}
          >
            {fmtBRL(resumo.lucro_por_pax)}
          </div>
          <div className="kpi-card__meta">
            Considerando confirmados
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card__label">Ponto de equilíbrio</div>
          <div className="kpi-card__value tabular-nums">
            {resumo.ponto_equilibrio_pax > 0 ? resumo.ponto_equilibrio_pax : '—'}
            {resumo.ponto_equilibrio_pax > 0 && (
              <span className="text-[16px] font-normal" style={{ color: 'var(--lg-text-3)' }}> pax</span>
            )}
          </div>
          <div className="kpi-card__meta">
            {resumo.ponto_equilibrio_pax > 0
              ? resumo.ponto_equilibrio_pax <= resumo.qtd_pax_confirmados
                ? 'Já no break-even'
                : `Faltam ${resumo.ponto_equilibrio_pax - resumo.qtd_pax_confirmados} pax para empatar`
              : 'Cadastre receita e despesa pra calcular'}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card__label">Resultado</div>
          <div
            className="kpi-card__value"
            style={{ color: lucroPositivo ? 'var(--lg-pos)' : 'var(--lg-neg)', fontSize: '22px' }}
          >
            <span className="inline-flex items-center gap-1.5">
              {lucroPositivo ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {lucroPositivo ? 'Lucrativo' : 'Prejuízo'}
            </span>
          </div>
          <div className="kpi-card__meta">
            {Math.abs(resumo.margem_prevista) < 5 ? 'Margem apertada' : ''}
            {resumo.margem_prevista >= 20 ? 'Margem saudável' : ''}
          </div>
        </div>
      </div>

      {semDados && (
        <div className="banner-info">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <b>Sem dados financeiros ainda.</b> Confirme reservas para gerar receitas e vincule despesas
            (hotel, voo, fornecedores) para ver o resultado real do grupo.
          </div>
        </div>
      )}

      {/* Receitas */}
      <SecaoFinanceiro
        titulo="Receitas"
        subtitulo={`${receitas.length} parcela${receitas.length !== 1 ? 's' : ''} de cliente`}
        onReload={() => carregar(true)}
        reloading={reloading}
      >
        {receitas.length === 0 ? (
          <EmptyMini icone={DollarSign} texto="Sem receitas — confirme reservas para gerar parcelas." />
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ background: '#F8FAFC' }}>
              <tr style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
                <ThMini>Descrição</ThMini>
                <ThMini>Cliente</ThMini>
                <ThMini>Vencimento</ThMini>
                <ThMini align="right">Valor</ThMini>
                <ThMini>Status</ThMini>
                <ThMini align="right">Ações</ThMini>
              </tr>
            </thead>
            <tbody>
              {receitas.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                  <td className="px-3 py-2.5">
                    <div className="text-[13px]" style={{ color: 'var(--lg-text)' }}>{r.descricao}</div>
                    {r.total_parcelas && r.total_parcelas > 1 && (
                      <div className="text-[10px] mono" style={{ color: 'var(--lg-text-3)' }}>
                        Parcela {r.parcela_numero}/{r.total_parcelas}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]" style={{ color: 'var(--lg-text-2)' }}>{r.cliente_nome || '—'}</td>
                  <td className="px-3 py-2.5 text-[12px] mono" style={{ color: 'var(--lg-text-2)' }}>{fmtData(r.data_vencimento)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--lg-text)' }}>{fmtBRLExato(r.valor_final)}</td>
                  <td className="px-3 py-2.5">
                    <span className={STATUS_RECEBER_BADGE[r.status] || 'badge badge--neutral'}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      href="/financeiro-ag/receber"
                      className="table-action-btn"
                      title="Abrir em Contas a Receber"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SecaoFinanceiro>

      {/* Despesas */}
      <SecaoFinanceiro
        titulo="Despesas"
        subtitulo={`${despesas.length} conta${despesas.length !== 1 ? 's' : ''} vinculada${despesas.length !== 1 ? 's' : ''} ao grupo`}
        onReload={() => carregar(true)}
        reloading={reloading}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVincularOpen(true)}
              className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[8px] text-[12px] font-semibold border"
              style={{
                borderColor: 'var(--lg-border-base)',
                color: 'var(--lg-text-2)',
                background: 'white',
              }}
            >
              <Link2 className="w-3.5 h-3.5" /> Vincular existente
            </button>
            <Link
              href={`/financeiro-ag/pagar?grupo_id=${grupoId}`}
              className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[8px] text-[12px] font-semibold"
              style={{ background: 'var(--lg-accent)', color: 'white' }}
            >
              <Plus className="w-3.5 h-3.5" /> Nova despesa
            </Link>
          </div>
        }
      >
        {despesas.length === 0 ? (
          <EmptyMini
            icone={DollarSign}
            texto="Sem despesas vinculadas. Crie ou vincule despesas existentes (hotel, voo, fornecedores) para apurar o resultado real."
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ background: '#F8FAFC' }}>
              <tr style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
                <ThMini>Descrição</ThMini>
                <ThMini>Fornecedor</ThMini>
                <ThMini>Vencimento</ThMini>
                <ThMini align="right">Valor</ThMini>
                <ThMini>Status</ThMini>
                <ThMini align="right">Ações</ThMini>
              </tr>
            </thead>
            <tbody>
              {despesas.map(d => (
                <tr key={d.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                  <td className="px-3 py-2.5">
                    <div className="text-[13px]" style={{ color: 'var(--lg-text)' }}>{d.descricao || '(sem descrição)'}</div>
                    {d.total_parcelas && d.total_parcelas > 1 && (
                      <div className="text-[10px] mono" style={{ color: 'var(--lg-text-3)' }}>
                        Parcela {d.parcela_numero}/{d.total_parcelas}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]" style={{ color: 'var(--lg-text-2)' }}>{d.fornecedor_nome || '—'}</td>
                  <td className="px-3 py-2.5 text-[12px] mono" style={{ color: 'var(--lg-text-2)' }}>{fmtData(d.data_vencimento)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--lg-text)' }}>{fmtBRLExato(d.valor_final)}</td>
                  <td className="px-3 py-2.5">
                    <span className={STATUS_PAGAR_BADGE[d.status] || 'badge badge--neutral'}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        href="/financeiro-ag/pagar"
                        className="table-action-btn"
                        title="Abrir em Contas a Pagar"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => desvincular(d.id)}
                        className="table-action-btn"
                        title="Desvincular do grupo"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SecaoFinanceiro>

      <p className="text-[11px] italic" style={{ color: 'var(--lg-text-3)' }}>
        Receitas e despesas vivem em <b>contas a receber</b> e <b>contas a pagar</b> do financeiro central — esta visão
        apenas filtra pelo grupo. Baixas, edições, juros e estornos continuam acontecendo nas telas
        do financeiro.
      </p>

      {/* Modal vincular despesa */}
      {vincularOpen && (
        <VincularDespesaModal
          grupoId={grupoId}
          origemDestino={origemDestino}
          onClose={() => setVincularOpen(false)}
          onVinculou={async () => {
            setVincularOpen(false);
            await carregar(true);
          }}
        />
      )}
    </div>
  );
}

// ---- Sub-componentes ---------------------------------------------

function SecaoFinanceiro({
  titulo,
  subtitulo,
  onReload,
  reloading,
  action,
  children,
}: {
  titulo: string;
  subtitulo: string;
  onReload?: () => void;
  reloading?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-[12px]"
      style={{
        background: 'var(--lg-surface-solid)',
        border: '1px solid var(--lg-border-base)',
        boxShadow: 'var(--lg-shadow-card)',
      }}
    >
      <div
        className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ borderBottom: '1px solid var(--lg-border-base)' }}
      >
        <div>
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--lg-text)' }}>{titulo}</h3>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--lg-text-3)' }}>{subtitulo}</p>
        </div>
        <div className="flex items-center gap-2">
          {onReload && (
            <button
              type="button"
              onClick={onReload}
              disabled={reloading}
              className="table-action-btn"
              title="Recarregar"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reloading ? 'animate-spin' : ''}`} />
            </button>
          )}
          {action}
        </div>
      </div>
      {children}
    </div>
  );
}

function ThMini({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: 'var(--lg-text-3)' }}
    >
      {children}
    </th>
  );
}

function EmptyMini({ icone: Icon, texto }: { icone: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; texto: string }) {
  return (
    <div className="py-10 px-6 text-center">
      <Icon className="w-8 h-8 mx-auto mb-2" style={{ color: '#CBD5E1' }} />
      <p className="text-[13px]" style={{ color: 'var(--lg-text-3)' }}>{texto}</p>
    </div>
  );
}

// ---- Modal Vincular Despesa --------------------------------------

function VincularDespesaModal({
  grupoId,
  origemDestino,
  onClose,
  onVinculou,
}: {
  grupoId: string;
  origemDestino: string;
  onClose: () => void;
  onVinculou: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [candidatas, setCandidatas] = useState<DespesaCandidata[]>([]);
  const [loading, setLoading] = useState(true);
  const [vinculando, setVinculando] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/contas-pagar');
        if (res.ok) {
          const json = await res.json();
          // Filtra contas que não estão vinculadas a NENHUM grupo (grupo_id vazio)
          const arr = (Array.isArray(json) ? json : []) as Array<ContaPagarMin & { grupo_id?: string | null; data?: ContaPagarMin & { grupo_id?: string | null } }>;
          const livres: DespesaCandidata[] = arr
            .map(item => {
              // API pode retornar shape diferente — normaliza
              const inner = (item.data as ContaPagarMin & { grupo_id?: string | null }) || (item as unknown as ContaPagarMin & { grupo_id?: string | null });
              const gid = (item as { grupo_id?: string | null }).grupo_id || inner?.grupo_id;
              return { id: (item as { id: string }).id, data: inner, grupo_id: gid };
            })
            .filter(x => !x.grupo_id || x.grupo_id === '')
            .map(x => ({ id: x.id, data: x.data }));
          setCandidatas(livres);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtradas = candidatas.filter(c => {
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    const d = c.data || ({} as ContaPagarMin);
    return (
      (d.descricao || '').toLowerCase().includes(q) ||
      (d.fornecedor_nome || '').toLowerCase().includes(q)
    );
  });

  const vincular = async (contaId: string) => {
    setVinculando(contaId);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}/financeiro/vincular-despesa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_pagar_id: contaId }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Falha ao vincular');
        return;
      }
      toast.success('Despesa vinculada ao grupo');
      onVinculou();
    } finally {
      setVinculando(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-full overflow-y-auto p-6 space-y-4 shadow-2xl"
        style={{ background: 'white' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
          <div>
            <h3 className="text-[18px] font-bold" style={{ color: 'var(--lg-text)' }}>
              Vincular despesa existente
            </h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--lg-text-3)' }}>
              Lista contas a pagar sem grupo. Vincular ao grupo {origemDestino || '—'} agrupa custos sem criar conta nova.
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--lg-text-3)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--lg-text-4)' }} />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por descrição ou fornecedor..."
            className="filter-input w-full"
            style={{ paddingLeft: '36px' }}
            autoFocus
          />
        </div>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--lg-text-3)' }} />
          </div>
        ) : filtradas.length === 0 ? (
          <div className="py-10 text-center">
            <DollarSign className="w-8 h-8 mx-auto mb-2" style={{ color: '#CBD5E1' }} />
            <p className="text-[13px]" style={{ color: 'var(--lg-text-3)' }}>
              {candidatas.length === 0
                ? 'Nenhuma despesa sem grupo. Cadastre primeiro em Contas a Pagar.'
                : 'Nenhuma despesa encontrada com esse filtro.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtradas.map(c => {
              const d = c.data || ({} as ContaPagarMin);
              return (
                <div
                  key={c.id}
                  className="px-3 py-2.5 flex items-center justify-between rounded-[8px] hover:bg-[#F8FAFC] cursor-pointer"
                  style={{ border: '1px solid var(--lg-border-base)' }}
                  onClick={() => vincular(c.id)}
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'var(--lg-text)' }}>
                      {d.descricao || '(sem descrição)'}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--lg-text-3)' }}>
                      {d.fornecedor_nome || '—'} · vence {fmtData(d.data_vencimento)} · {d.status}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[14px] font-semibold tabular-nums" style={{ color: 'var(--lg-text)' }}>
                      {fmtBRLExato(d.valor_final || 0)}
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); vincular(c.id); }}
                      disabled={vinculando === c.id}
                      className="inline-flex items-center gap-1 text-[11px] mt-1"
                      style={{ color: 'var(--lg-accent)' }}
                    >
                      {vinculando === c.id ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Vinculando…</>
                      ) : (
                        <><Check className="w-3 h-3" /> Vincular</>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
