'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus, Loader2, ListChecks, Check, X, Edit2, Trash2, Clock,
  AlertCircle, Calendar, User as UserIcon,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  TAREFA_TIPO_LABEL, TAREFA_STATUS_LABEL, TAREFA_PRIORIDADE_LABEL,
  type TarefaTipo, type TarefaStatus, type TarefaPrioridade,
} from '@/lib/gestao-grupos';

interface Tarefa {
  id: string;
  grupo_id: string;
  tipo: TarefaTipo;
  status: TarefaStatus;
  prioridade: TarefaPrioridade;
  titulo: string;
  descricao?: string;
  reserva_id?: string;
  passageiro_id?: string;
  responsavel_id?: string;
  responsavel_nome?: string;
  prazo?: string;
  observacoes?: string;
  data_conclusao?: string;
  concluida_por?: string;
  created_at?: string;
}

interface Stats {
  total: number;
  pendente: number;
  em_andamento: number;
  concluida: number;
  cancelada: number;
  atrasadas: number;
}

interface Props {
  grupoId: string;
}

interface FormTarefa {
  tipo: TarefaTipo;
  titulo: string;
  prioridade: TarefaPrioridade;
  status: TarefaStatus;
  prazo: string;
  descricao: string;
  responsavel_nome: string;
  observacoes: string;
}

const formVazio: FormTarefa = {
  tipo: 'confirmar_fornecedor',
  titulo: '',
  prioridade: 'media',
  status: 'pendente',
  prazo: '',
  descricao: '',
  responsavel_nome: '',
  observacoes: '',
};

function fmtData(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function diasAte(iso?: string): number | null {
  if (!iso) return null;
  const target = new Date(iso + 'T00:00:00').getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.floor((target - today) / 86400000);
}

export function TarefasTab({ grupoId }: Props) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormTarefa>(formVazio);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}/tarefas`);
      if (res.ok) {
        const json = await res.json();
        setTarefas(json.tarefas || []);
        setStats(json.stats || null);
      }
    } finally {
      setLoading(false);
    }
  }, [grupoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const porStatus = useMemo(() => {
    const map: Record<TarefaStatus, Tarefa[]> = {
      pendente: [], em_andamento: [], concluida: [], cancelada: [],
    };
    for (const t of tarefas) map[t.status]?.push(t);
    return map;
  }, [tarefas]);

  const abrirNovo = (statusInicial?: TarefaStatus) => {
    setForm({ ...formVazio, status: statusInicial || 'pendente' });
    setEditandoId(null);
    setSheetOpen(true);
  };

  const abrirEditar = (t: Tarefa) => {
    setForm({
      tipo: t.tipo,
      titulo: t.titulo,
      prioridade: t.prioridade,
      status: t.status,
      prazo: t.prazo || '',
      descricao: t.descricao || '',
      responsavel_nome: t.responsavel_nome || '',
      observacoes: t.observacoes || '',
    });
    setEditandoId(t.id);
    setSheetOpen(true);
  };

  const salvar = async () => {
    if (!form.titulo.trim() && form.tipo === 'outros') {
      toast.error('Título é obrigatório para "Outros"');
      return;
    }
    const titulo = form.titulo.trim() || TAREFA_TIPO_LABEL[form.tipo];
    setSalvando(true);
    try {
      const url = editandoId
        ? `/api/gestao-grupos/${grupoId}/tarefas/${editandoId}`
        : `/api/gestao-grupos/${grupoId}/tarefas`;
      const res = await fetch(url, {
        method: editandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, titulo }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Falha ao salvar');
        return;
      }
      toast.success(editandoId ? 'Tarefa atualizada' : 'Tarefa criada');
      setSheetOpen(false);
      await carregar();
    } finally {
      setSalvando(false);
    }
  };

  const mudarStatus = async (t: Tarefa, status: TarefaStatus) => {
    const res = await fetch(`/api/gestao-grupos/${grupoId}/tarefas/${t.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return;
    toast.success(`Tarefa: ${TAREFA_STATUS_LABEL[status]}`);
    await carregar();
  };

  const remover = async (t: Tarefa) => {
    if (!confirm(`Remover "${t.titulo}"?`)) return;
    const res = await fetch(`/api/gestao-grupos/${grupoId}/tarefas/${t.id}`, { method: 'DELETE' });
    if (!res.ok) return;
    toast.success('Tarefa removida');
    await carregar();
  };

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Total</div>
          <div className="kpi-card__value">{stats?.total ?? 0}</div>
          <div className="kpi-card__meta">tarefas operacionais</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Pendentes</div>
          <div className="kpi-card__value" style={{ color: (stats?.pendente || 0) > 0 ? 'var(--lg-warn)' : 'var(--lg-text)' }}>
            {stats?.pendente ?? 0}
          </div>
          <div className="kpi-card__meta">+ {stats?.em_andamento || 0} em andamento</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Atrasadas</div>
          <div className="kpi-card__value" style={{ color: (stats?.atrasadas || 0) > 0 ? 'var(--lg-neg)' : 'var(--lg-text)' }}>
            {stats?.atrasadas ?? 0}
          </div>
          <div className="kpi-card__meta">Com prazo vencido</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Concluídas</div>
          <div className="kpi-card__value" style={{ color: 'var(--lg-pos)' }}>{stats?.concluida ?? 0}</div>
          <div className="kpi-card__meta">{stats?.cancelada || 0} canceladas</div>
        </div>
      </div>

      {/* Botão criar */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => abrirNovo()}
          className="inline-flex items-center gap-1.5 h-[40px] px-4 rounded-[8px] text-[13px] font-semibold"
          style={{ background: 'var(--lg-accent)', color: 'white' }}
        >
          <Plus className="w-4 h-4" /> Nova tarefa
        </button>
      </div>

      {/* Kanban simples por status */}
      {loading ? (
        <div className="border p-10 text-center rounded-[12px]" style={{ borderColor: 'var(--lg-border-base)' }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--lg-text-3)' }} />
        </div>
      ) : tarefas.length === 0 ? (
        <div className="empty-state">
          <ListChecks className="empty-state__icon" strokeWidth={1.5} />
          <p className="empty-state__title">Nenhuma tarefa cadastrada</p>
          <p className="empty-state__description">
            Crie tarefas operacionais (confirmar fornecedor, enviar voucher, cobrar inadimplentes, etc.)
            para manter o checklist do grupo organizado.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ColunaStatus
            titulo="Pendentes"
            status="pendente"
            tarefas={porStatus.pendente}
            cor="#F59E0B"
            onAdd={() => abrirNovo('pendente')}
            onMudarStatus={mudarStatus}
            onEditar={abrirEditar}
            onRemover={remover}
          />
          <ColunaStatus
            titulo="Em andamento"
            status="em_andamento"
            tarefas={porStatus.em_andamento}
            cor="#2563EB"
            onAdd={() => abrirNovo('em_andamento')}
            onMudarStatus={mudarStatus}
            onEditar={abrirEditar}
            onRemover={remover}
          />
          <ColunaStatus
            titulo="Concluídas"
            status="concluida"
            tarefas={porStatus.concluida}
            cor="#10B981"
            onAdd={() => abrirNovo('concluida')}
            onMudarStatus={mudarStatus}
            onEditar={abrirEditar}
            onRemover={remover}
            compact
          />
        </div>
      )}

      {/* Sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(15, 23, 42, 0.45)' }} onClick={() => setSheetOpen(false)}>
          <div
            className="w-full max-w-lg h-full overflow-y-auto p-6 space-y-4 shadow-2xl"
            style={{ background: 'white' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
              <h3 className="text-[18px] font-bold" style={{ color: 'var(--lg-text)' }}>
                {editandoId ? 'Editar tarefa' : 'Nova tarefa'}
              </h3>
              <button onClick={() => setSheetOpen(false)} style={{ color: 'var(--lg-text-3)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <Field label="Tipo">
              <select
                value={form.tipo}
                onChange={e => {
                  const tipo = e.target.value as TarefaTipo;
                  setForm(f => ({ ...f, tipo, titulo: f.titulo || (tipo !== 'outros' ? TAREFA_TIPO_LABEL[tipo] : '') }));
                }}
                className="filter-select w-full"
              >
                {(Object.entries(TAREFA_TIPO_LABEL) as [TarefaTipo, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>

            <Field label="Título *">
              <input
                type="text"
                value={form.titulo}
                onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                className="filter-input w-full"
                placeholder={TAREFA_TIPO_LABEL[form.tipo]}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Prioridade">
                <select
                  value={form.prioridade}
                  onChange={e => setForm(f => ({ ...f, prioridade: e.target.value as TarefaPrioridade }))}
                  className="filter-select w-full"
                >
                  {(Object.entries(TAREFA_PRIORIDADE_LABEL) as [TarefaPrioridade, { label: string; cor: string }][]).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as TarefaStatus }))}
                  className="filter-select w-full"
                >
                  {(Object.entries(TAREFA_STATUS_LABEL) as [TarefaStatus, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Prazo">
              <input
                type="date"
                value={form.prazo}
                onChange={e => setForm(f => ({ ...f, prazo: e.target.value }))}
                className="filter-input w-full"
              />
            </Field>

            <Field label="Responsável">
              <input
                type="text"
                value={form.responsavel_nome}
                onChange={e => setForm(f => ({ ...f, responsavel_nome: e.target.value }))}
                className="filter-input w-full"
                placeholder="Nome de quem vai executar"
              />
            </Field>

            <Field label="Descrição">
              <textarea
                rows={3}
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                className="filter-input w-full"
                style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
              />
            </Field>

            <Field label="Observações">
              <textarea
                rows={2}
                value={form.observacoes}
                onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                className="filter-input w-full"
                style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
              />
            </Field>

            <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--lg-border-base)' }}>
              <button
                onClick={salvar}
                disabled={salvando}
                className="inline-flex items-center gap-1.5 h-[40px] px-5 rounded-[8px] text-[13px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--lg-accent)', color: 'white' }}
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Salvar
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

// ---- Coluna do kanban ------------------------------------------------

function ColunaStatus({
  titulo, status, tarefas, cor, onAdd, onMudarStatus, onEditar, onRemover, compact,
}: {
  titulo: string;
  status: TarefaStatus;
  tarefas: Tarefa[];
  cor: string;
  onAdd: () => void;
  onMudarStatus: (t: Tarefa, s: TarefaStatus) => void;
  onEditar: (t: Tarefa) => void;
  onRemover: (t: Tarefa) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-[12px]" style={{ background: '#F8FAFC', border: '1px solid var(--lg-border-base)' }}>
      <div className="px-3 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: cor }} />
          <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: cor }}>{titulo}</span>
          <span className="text-[11px] mono px-1.5 py-0.5 rounded" style={{ background: 'white', color: cor }}>{tarefas.length}</span>
        </div>
        {status !== 'concluida' && (
          <button onClick={onAdd} className="text-[11px]" style={{ color: 'var(--lg-text-3)' }} title="Adicionar tarefa nesta coluna">
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="p-2 space-y-2 min-h-[200px]">
        {tarefas.length === 0 ? (
          <p className="text-[11px] text-center py-6" style={{ color: 'var(--lg-text-4)' }}>
            {compact ? 'nenhuma' : 'Arraste ou crie tarefas'}
          </p>
        ) : (
          tarefas.map(t => (
            <CardTarefa
              key={t.id}
              t={t}
              onEditar={() => onEditar(t)}
              onRemover={() => onRemover(t)}
              onConcluir={() => onMudarStatus(t, 'concluida')}
              onIniciar={() => onMudarStatus(t, 'em_andamento')}
              onReabrir={() => onMudarStatus(t, 'pendente')}
              onCancelar={() => onMudarStatus(t, 'cancelada')}
              compact={compact}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CardTarefa({
  t, onEditar, onRemover, onConcluir, onIniciar, onReabrir, onCancelar, compact,
}: {
  t: Tarefa;
  onEditar: () => void;
  onRemover: () => void;
  onConcluir: () => void;
  onIniciar: () => void;
  onReabrir: () => void;
  onCancelar: () => void;
  compact?: boolean;
}) {
  const prioInfo = TAREFA_PRIORIDADE_LABEL[t.prioridade];
  const dias = diasAte(t.prazo);
  const atrasada = (t.status === 'pendente' || t.status === 'em_andamento') && dias !== null && dias < 0;
  const proxima = (t.status === 'pendente' || t.status === 'em_andamento') && dias !== null && dias >= 0 && dias <= 3;
  const concluida = t.status === 'concluida';
  const cancelada = t.status === 'cancelada';

  return (
    <div
      className="rounded-[8px] p-2.5 group/card"
      style={{
        background: 'white',
        border: `1px solid ${atrasada ? '#FCA5A5' : 'var(--lg-border-base)'}`,
        borderLeft: `3px solid ${prioInfo.cor}`,
        opacity: cancelada ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold leading-tight" style={{
            color: 'var(--lg-text)',
            textDecoration: concluida ? 'line-through' : 'none',
          }}>
            {t.titulo}
          </div>
          {!compact && t.tipo !== 'outros' && (
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--lg-text-3)' }}>
              {TAREFA_TIPO_LABEL[t.tipo]}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity">
          <button onClick={onEditar} className="table-action-btn" title="Editar"><Edit2 className="w-3 h-3" /></button>
          <button onClick={onRemover} className="table-action-btn table-action-btn--danger" title="Remover"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>

      {/* Meta: prazo, responsável, prioridade */}
      <div className="flex items-center gap-2 mt-2 flex-wrap text-[10px]">
        {t.prazo && (
          <span
            className="inline-flex items-center gap-0.5"
            style={{ color: atrasada ? 'var(--lg-neg)' : proxima ? 'var(--lg-warn)' : 'var(--lg-text-3)' }}
          >
            <Calendar className="w-2.5 h-2.5" />
            <span className="mono">{fmtData(t.prazo)}</span>
            {atrasada && <span>({Math.abs(dias!)}d atrasada)</span>}
            {proxima && <span>(em {dias}d)</span>}
          </span>
        )}
        {t.responsavel_nome && (
          <span className="inline-flex items-center gap-0.5" style={{ color: 'var(--lg-text-3)' }}>
            <UserIcon className="w-2.5 h-2.5" /> {t.responsavel_nome}
          </span>
        )}
        <span
          className="inline-block px-1.5 rounded text-[9px] uppercase tracking-wide font-semibold"
          style={{ background: `${prioInfo.cor}1A`, color: prioInfo.cor }}
        >
          {prioInfo.label}
        </span>
      </div>

      {/* Ações de mudança rápida */}
      {!cancelada && !concluida && (
        <div className="flex items-center gap-1 mt-2 pt-2 text-[10px]" style={{ borderTop: '1px solid #F1F5F9' }}>
          {t.status === 'pendente' && (
            <button onClick={onIniciar} className="px-2 py-0.5 rounded" style={{ background: '#EFF6FF', color: '#2563EB' }}>
              <Clock className="w-2.5 h-2.5 inline mr-0.5" /> Iniciar
            </button>
          )}
          <button onClick={onConcluir} className="px-2 py-0.5 rounded" style={{ background: '#ECFDF5', color: '#065F46' }}>
            <Check className="w-2.5 h-2.5 inline mr-0.5" /> Concluir
          </button>
          <button onClick={onCancelar} className="px-2 py-0.5 rounded ml-auto" style={{ color: 'var(--lg-text-3)' }}>
            <X className="w-2.5 h-2.5 inline" />
          </button>
        </div>
      )}
      {concluida && (
        <button onClick={onReabrir} className="text-[10px] mt-2 pt-2 w-full" style={{ borderTop: '1px solid #F1F5F9', color: 'var(--lg-text-3)' }}>
          Reabrir
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.04em] font-semibold block mb-1.5" style={{ color: 'var(--lg-text-3)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

void AlertCircle;
