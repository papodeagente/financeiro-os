'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus, Loader2, Bed, Lock, Unlock, Trash2, X, Check, Users,
  AlertCircle, BedDouble, BedSingle, UserPlus, UserMinus, Edit2,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { TIPO_ACOMODACAO_LABEL, type TipoAcomodacaoQuarto } from '@/lib/gestao-grupos';

interface Ocupante {
  id: string;
  nome_completo: string;
  tipo: string;
  reserva_id: string;
}

interface Quarto {
  id: string;
  numero: string;
  tipo_acomodacao: TipoAcomodacaoQuarto;
  capacidade: number;
  ocupantes: Ocupante[];
  ocupacao_atual: number;
  vagas_restantes: number;
  excesso: boolean;
  completo: boolean;
  hotel_nome?: string;
  bloqueado?: boolean;
  motivo_bloqueio?: string;
  observacoes?: string;
}

interface RoomingAPI {
  quartos: Quarto[];
  sem_quarto: Ocupante[];
  stats: {
    quartos_total: number;
    quartos_completos: number;
    quartos_disponiveis: number;
    quartos_bloqueados: number;
    quartos_com_excesso: number;
    capacidade_total: number;
    ocupacao_total: number;
    passageiros_sem_quarto: number;
  };
}

interface Props {
  grupoId: string;
  onChange?: () => void;
}

interface FormQuarto {
  numero: string;
  tipo_acomodacao: TipoAcomodacaoQuarto;
  capacidade: number;
  hotel_nome: string;
  observacoes: string;
}

const formVazio: FormQuarto = {
  numero: '',
  tipo_acomodacao: 'DBL_CASAL',
  capacidade: 2,
  hotel_nome: '',
  observacoes: '',
};

export function RoomingListTab({ grupoId, onChange }: Props) {
  const [data, setData] = useState<RoomingAPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormQuarto>(formVazio);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}/quartos`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [grupoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const abrirNovo = () => {
    setForm(formVazio);
    setEditandoId(null);
    setSheetOpen(true);
  };
  const abrirEditar = (q: Quarto) => {
    setForm({
      numero: q.numero,
      tipo_acomodacao: q.tipo_acomodacao,
      capacidade: q.capacidade,
      hotel_nome: q.hotel_nome || '',
      observacoes: q.observacoes || '',
    });
    setEditandoId(q.id);
    setSheetOpen(true);
  };

  const salvar = async () => {
    if (!form.numero.trim()) { toast.error('Número/nome do quarto é obrigatório'); return; }
    setSalvando(true);
    try {
      const url = editandoId
        ? `/api/gestao-grupos/${grupoId}/quartos/${editandoId}`
        : `/api/gestao-grupos/${grupoId}/quartos`;
      const res = await fetch(url, {
        method: editandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Falha ao salvar');
        return;
      }
      toast.success(editandoId ? 'Quarto atualizado' : 'Quarto criado');
      setSheetOpen(false);
      await carregar();
      onChange?.();
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (q: Quarto) => {
    if (!confirm(`Remover quarto "${q.numero}"? Os ${q.ocupacao_atual} ocupantes serão desalocados.`)) return;
    const res = await fetch(`/api/gestao-grupos/${grupoId}/quartos/${q.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || 'Falha ao remover');
      return;
    }
    toast.success('Quarto removido');
    await carregar();
    onChange?.();
  };

  const toggleBloqueio = async (q: Quarto) => {
    let motivo = q.motivo_bloqueio || '';
    if (!q.bloqueado) {
      motivo = window.prompt('Motivo do bloqueio:') || '';
      if (!motivo.trim()) return;
    }
    const res = await fetch(`/api/gestao-grupos/${grupoId}/quartos/${q.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bloqueado: !q.bloqueado, motivo_bloqueio: motivo }),
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || 'Falha ao alterar bloqueio');
      return;
    }
    toast.success(q.bloqueado ? 'Quarto desbloqueado' : 'Quarto bloqueado');
    await carregar();
  };

  const alocar = async (quartoId: string, passageiroId: string) => {
    const res = await fetch(`/api/gestao-grupos/${grupoId}/quartos/${quartoId}/alocar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passageiro_id: passageiroId }),
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || 'Falha ao alocar');
      return;
    }
    toast.success('Passageiro alocado');
    await carregar();
  };

  const desalocar = async (quartoId: string, passageiroId: string) => {
    const res = await fetch(`/api/gestao-grupos/${grupoId}/quartos/${quartoId}/alocar?passageiro_id=${passageiroId}`, {
      method: 'DELETE',
    });
    if (!res.ok) return;
    toast.success('Passageiro removido do quarto');
    await carregar();
  };

  const stats = data?.stats;
  const alocacaoPct = useMemo(() => {
    if (!stats || stats.capacidade_total === 0) return 0;
    return (stats.ocupacao_total / stats.capacidade_total) * 100;
  }, [stats]);

  if (loading || !data) {
    return (
      <div className="border p-10 text-center rounded-[12px]" style={{ borderColor: 'var(--lg-border-base)' }}>
        <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--lg-text-3)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Quartos</div>
          <div className="kpi-card__value">{stats?.quartos_total ?? 0}</div>
          <div className="kpi-card__meta">
            <b>{stats?.quartos_completos ?? 0}</b> completos · {stats?.quartos_bloqueados ?? 0} bloqueados
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Ocupação</div>
          <div className="kpi-card__value tabular-nums">
            {stats?.ocupacao_total ?? 0}<span className="text-[16px] font-normal" style={{ color: 'var(--lg-text-3)' }}>/{stats?.capacidade_total ?? 0}</span>
          </div>
          <div className="mt-2 h-1.5 bg-[#F1F5F9] rounded-full overflow-hidden">
            <div className="h-full transition-all" style={{ width: `${Math.min(alocacaoPct, 100)}%`, background: 'var(--lg-accent)' }} />
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Sem quarto</div>
          <div
            className="kpi-card__value tabular-nums"
            style={{ color: (stats?.passageiros_sem_quarto || 0) > 0 ? 'var(--lg-warn)' : 'var(--lg-text)' }}
          >
            {stats?.passageiros_sem_quarto ?? 0}
          </div>
          <div className="kpi-card__meta">Passageiros aguardando alocação</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Alertas</div>
          <div
            className="kpi-card__value tabular-nums"
            style={{ color: (stats?.quartos_com_excesso || 0) > 0 ? 'var(--lg-neg)' : 'var(--lg-text)' }}
          >
            {stats?.quartos_com_excesso ?? 0}
          </div>
          <div className="kpi-card__meta">Quartos em excesso de capacidade</div>
        </div>
      </div>

      {/* Bag de passageiros sem quarto + botão novo */}
      <div className="flex items-start gap-3 flex-wrap justify-between">
        <div className="flex-1 min-w-[300px]">
          {data.sem_quarto.length > 0 ? (
            <div
              className="rounded-[12px] p-3 border"
              style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4" style={{ color: '#92400E' }} />
                <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: '#92400E' }}>
                  Aguardando alocação ({data.sem_quarto.length})
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.sem_quarto.map(p => (
                  <PassageiroChip
                    key={p.id}
                    pax={p}
                    onAlocar={qId => alocar(qId, p.id)}
                    quartosDisponiveis={data.quartos.filter(q => !q.bloqueado && q.vagas_restantes > 0)}
                  />
                ))}
              </div>
            </div>
          ) : data.quartos.length > 0 ? (
            <div
              className="rounded-[12px] p-3 border flex items-center gap-2"
              style={{ background: '#ECFDF5', borderColor: '#A7F3D0' }}
            >
              <Check className="w-4 h-4" style={{ color: '#065F46' }} />
              <span className="text-[13px]" style={{ color: '#065F46' }}>
                Todos os passageiros estão alocados.
              </span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={abrirNovo}
          className="inline-flex items-center gap-1.5 h-[40px] px-4 rounded-[8px] text-[13px] font-semibold"
          style={{ background: 'var(--lg-accent)', color: 'white' }}
        >
          <Plus className="w-4 h-4" /> Novo quarto
        </button>
      </div>

      {/* Grid de quartos */}
      {data.quartos.length === 0 ? (
        <div className="empty-state">
          <Bed className="empty-state__icon" strokeWidth={1.5} />
          <p className="empty-state__title">Nenhum quarto cadastrado</p>
          <p className="empty-state__description">
            Crie quartos para organizar a rooming list e alocar os passageiros confirmados.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.quartos.map(q => (
            <QuartoCard
              key={q.id}
              q={q}
              passageirosSemQuarto={data.sem_quarto}
              onEditar={() => abrirEditar(q)}
              onRemover={() => remover(q)}
              onToggleBloqueio={() => toggleBloqueio(q)}
              onAlocar={pid => alocar(q.id, pid)}
              onDesalocar={pid => desalocar(q.id, pid)}
            />
          ))}
        </div>
      )}

      {/* Sheet — novo/editar quarto */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(15, 23, 42, 0.45)' }} onClick={() => setSheetOpen(false)}>
          <div
            className="w-full max-w-md h-full overflow-y-auto p-6 space-y-4 shadow-2xl"
            style={{ background: 'white' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
              <h3 className="text-[18px] font-bold" style={{ color: 'var(--lg-text)' }}>
                {editandoId ? 'Editar quarto' : 'Novo quarto'}
              </h3>
              <button onClick={() => setSheetOpen(false)} style={{ color: 'var(--lg-text-3)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <Field label="Número / nome *">
                <input
                  type="text"
                  value={form.numero}
                  onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="101, Suíte Master, Cabine A..."
                />
              </Field>

              <Field label="Tipo de acomodação">
                <select
                  value={form.tipo_acomodacao}
                  onChange={e => {
                    const tipo = e.target.value as TipoAcomodacaoQuarto;
                    setForm(f => ({ ...f, tipo_acomodacao: tipo, capacidade: TIPO_ACOMODACAO_LABEL[tipo].capacidadeDefault }));
                  }}
                  className="filter-select w-full"
                >
                  {Object.entries(TIPO_ACOMODACAO_LABEL).map(([key, info]) => (
                    <option key={key} value={key}>{info.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Capacidade">
                <input
                  type="number"
                  min={1}
                  value={form.capacidade}
                  onChange={e => setForm(f => ({ ...f, capacidade: parseInt(e.target.value) || 1 }))}
                  className="filter-input w-full"
                />
              </Field>

              <Field label="Hotel (opcional)" hint="Útil quando o grupo passa por mais de um hotel">
                <input
                  type="text"
                  value={form.hotel_nome}
                  onChange={e => setForm(f => ({ ...f, hotel_nome: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>

              <Field label="Observações">
                <textarea
                  rows={3}
                  value={form.observacoes}
                  onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                  className="filter-input w-full"
                  style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--lg-border-base)' }}>
              <button
                onClick={salvar}
                disabled={salvando}
                className="inline-flex items-center gap-1.5 h-[40px] px-5 rounded-[8px] text-[13px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--lg-accent)', color: 'white' }}
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editandoId ? 'Salvar alterações' : 'Criar quarto'}
              </button>
              <button onClick={() => setSheetOpen(false)} className="h-[40px] px-4 text-[13px]" style={{ color: 'var(--lg-text-3)' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Componentes ------------------------------------------------------

function QuartoCard({
  q,
  passageirosSemQuarto,
  onEditar,
  onRemover,
  onToggleBloqueio,
  onAlocar,
  onDesalocar,
}: {
  q: Quarto;
  passageirosSemQuarto: Ocupante[];
  onEditar: () => void;
  onRemover: () => void;
  onToggleBloqueio: () => void;
  onAlocar: (pid: string) => void;
  onDesalocar: (pid: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const tipo = TIPO_ACOMODACAO_LABEL[q.tipo_acomodacao];
  const Icon = q.capacidade === 1 ? BedSingle : BedDouble;

  const corBorda = q.bloqueado
    ? '#94A3B8'
    : q.excesso
      ? '#EF4444'
      : q.completo
        ? '#10B981'
        : 'var(--lg-border-base)';

  return (
    <div
      className="rounded-[12px] p-4 relative"
      style={{
        background: q.bloqueado ? '#F8FAFC' : 'var(--lg-surface-solid)',
        border: `1px solid ${corBorda}`,
        boxShadow: 'var(--lg-shadow-card)',
        opacity: q.bloqueado ? 0.65 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
          style={{ background: q.bloqueado ? '#F1F5F9' : 'var(--lg-accent-fill)', color: q.bloqueado ? '#94A3B8' : 'var(--lg-accent)' }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-bold" style={{ color: 'var(--lg-text)' }}>{q.numero}</h3>
            {q.bloqueado && (
              <span className="badge badge--neutral inline-flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" /> Bloqueado</span>
            )}
            {q.completo && !q.bloqueado && (
              <span className="badge badge--success">Completo</span>
            )}
            {q.excesso && (
              <span className="badge badge--danger">Excesso</span>
            )}
          </div>
          <p className="text-[11px]" style={{ color: 'var(--lg-text-3)' }}>
            {tipo.label} · capacidade {q.capacidade}
            {q.hotel_nome && <> · {q.hotel_nome}</>}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEditar} className="table-action-btn" title="Editar">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onToggleBloqueio} className="table-action-btn" title={q.bloqueado ? 'Desbloquear' : 'Bloquear'}>
            {q.bloqueado ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onRemover} className="table-action-btn table-action-btn--danger" title="Remover">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {q.bloqueado && q.motivo_bloqueio && (
        <p className="text-[11px] italic mt-2 px-2 py-1 rounded" style={{ background: '#F1F5F9', color: 'var(--lg-text-3)' }}>
          Motivo: {q.motivo_bloqueio}
        </p>
      )}

      {/* Ocupantes */}
      <div className="mt-3 pt-3" style={{ borderTop: '1px solid #F1F5F9' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--lg-text-3)' }}>
            Ocupantes
          </span>
          <span className="text-[11px] mono tabular-nums" style={{ color: q.excesso ? 'var(--lg-neg)' : 'var(--lg-text-2)' }}>
            {q.ocupacao_atual}/{q.capacidade}
          </span>
        </div>

        {q.ocupantes.length === 0 ? (
          <p className="text-[12px] italic" style={{ color: 'var(--lg-text-4)' }}>Quarto vazio</p>
        ) : (
          <ul className="space-y-1">
            {q.ocupantes.map(o => (
              <li
                key={o.id}
                className="flex items-center justify-between px-2 py-1.5 rounded-[6px] text-[12px] group"
                style={{ background: '#F8FAFC' }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Users className="w-3 h-3 shrink-0" style={{ color: 'var(--lg-text-4)' }} />
                  <span className="truncate" style={{ color: 'var(--lg-text-2)' }}>{o.nome_completo}</span>
                  {o.tipo !== 'ADT' && (
                    <span className="badge badge--neutral text-[9px]">{o.tipo}</span>
                  )}
                </div>
                <button
                  onClick={() => onDesalocar(o.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                  style={{ color: 'var(--lg-neg)' }}
                  title="Remover do quarto"
                >
                  <UserMinus className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Alocar */}
        {!q.bloqueado && q.vagas_restantes > 0 && passageirosSemQuarto.length > 0 && (
          <div className="mt-2">
            {!pickerOpen ? (
              <button
                onClick={() => setPickerOpen(true)}
                className="w-full inline-flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-[6px] border"
                style={{ borderColor: 'var(--lg-border-base)', color: 'var(--lg-accent)' }}
              >
                <UserPlus className="w-3 h-3" /> Alocar passageiro
              </button>
            ) : (
              <div className="space-y-1 mt-1">
                {passageirosSemQuarto.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setPickerOpen(false); onAlocar(p.id); }}
                    className="w-full text-left px-2 py-1.5 rounded-[6px] text-[12px] hover:bg-[#EFF6FF]"
                    style={{ border: '1px solid var(--lg-border-base)' }}
                  >
                    {p.nome_completo}
                  </button>
                ))}
                <button
                  onClick={() => setPickerOpen(false)}
                  className="w-full text-[11px] py-1"
                  style={{ color: 'var(--lg-text-3)' }}
                >
                  cancelar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PassageiroChip({
  pax,
  onAlocar,
  quartosDisponiveis,
}: {
  pax: Ocupante;
  onAlocar: (quartoId: string) => void;
  quartosDisponiveis: Quarto[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[12px] hover:opacity-80"
        style={{ background: 'white', border: '1px solid #FDE68A', color: '#92400E' }}
      >
        <Users className="w-3 h-3" />
        {pax.nome_completo}
        {pax.tipo !== 'ADT' && <span className="badge badge--neutral text-[9px]">{pax.tipo}</span>}
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 left-0 min-w-[200px] rounded-[8px] shadow-lg overflow-hidden"
          style={{ background: 'white', border: '1px solid var(--lg-border-base)' }}
        >
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--lg-text-3)', background: '#F8FAFC', borderBottom: '1px solid var(--lg-border-base)' }}>
            Alocar em…
          </div>
          {quartosDisponiveis.length === 0 ? (
            <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--lg-text-3)' }}>
              Sem quartos disponíveis
            </div>
          ) : (
            quartosDisponiveis.map(q => (
              <button
                key={q.id}
                onClick={() => { setOpen(false); onAlocar(q.id); }}
                className="w-full text-left px-3 py-2 text-[12px] hover:bg-[#EFF6FF]"
              >
                <div style={{ color: 'var(--lg-text)' }}>{q.numero}</div>
                <div className="text-[10px] mono" style={{ color: 'var(--lg-text-3)' }}>
                  {TIPO_ACOMODACAO_LABEL[q.tipo_acomodacao].label} · {q.ocupacao_atual}/{q.capacidade}
                </div>
              </button>
            ))
          )}
          <button onClick={() => setOpen(false)} className="w-full text-center text-[11px] py-1.5" style={{ color: 'var(--lg-text-3)', background: '#F8FAFC' }}>
            fechar
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.04em] font-semibold block mb-1.5" style={{ color: 'var(--lg-text-3)' }}>
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] mt-1 italic" style={{ color: 'var(--lg-text-3)' }}>{hint}</p>}
    </div>
  );
}
