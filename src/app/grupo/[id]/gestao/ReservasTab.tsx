'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Plus, Edit2, Check, X, Search, Loader2, FileText, AlertCircle } from 'lucide-react';
import { loadEntities } from '@/lib/crm-storage';
import type { Cliente } from '@/lib/crm-types';
import { toast } from '@/lib/toast';

interface PeriodoMinimo {
  id: string;
  label: string;
  vagas_disponiveis: number;
  vagas_total: number;
}

interface Reserva {
  id: string;
  grupo_id: string;
  periodo_id: string;
  periodo_label?: string;
  cliente_id: string;
  cliente_nome?: string;
  nome_passageiro: string;
  tipo_acomodacao: string;
  valor_cobrado: number;
  parcelas: number;
  observacoes: string;
  documentos_ok: boolean;
  passaporte_vencimento: string;
  venda_id: string | null;
  motivo_cancelamento?: string;
  status: 'reservado' | 'confirmado' | 'cancelado' | 'lista_espera';
  created_at?: string;
  updated_at?: string;
}

interface Props {
  grupoId: string;
  periodos: PeriodoMinimo[];
  tarifasAtivas: string[];
  permiteListaEspera: boolean;
  onReservaChange: () => void; // pra recarregar contagens no pai
}

type StatusFiltro = 'todos' | 'reservado' | 'confirmado' | 'cancelado' | 'lista_espera';

const STATUS_LABEL: Record<string, string> = {
  reservado: 'Reservado',
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  lista_espera: 'Lista de espera',
};

function fmtBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}

function fmtData(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface FormReserva {
  periodo_id: string;
  cliente_id: string;
  nome_passageiro: string;
  tipo_acomodacao: string;
  valor_cobrado: number;
  parcelas: number;
  observacoes: string;
  documentos_ok: boolean;
  passaporte_vencimento: string;
}

const formVazio: FormReserva = {
  periodo_id: '',
  cliente_id: '',
  nome_passageiro: '',
  tipo_acomodacao: 'DBL',
  valor_cobrado: 0,
  parcelas: 1,
  observacoes: '',
  documentos_ok: false,
  passaporte_vencimento: '',
};

export function ReservasTab({ grupoId, periodos, tarifasAtivas, permiteListaEspera, onReservaChange }: Props) {
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodoFiltro, setPeriodoFiltro] = useState<string>('');
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('todos');
  const [busca, setBusca] = useState('');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormReserva>(formVazio);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const aptosDisponiveis = useMemo(() => {
    const ativos = (tarifasAtivas || ['dbl']).map(t => t.toUpperCase());
    return ativos.length > 0 ? ativos : ['DBL', 'SGL', 'TPL', 'QDP'];
  }, [tarifasAtivas]);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL(`/api/gestao-grupos/${grupoId}/reservas`, window.location.origin);
      if (periodoFiltro) url.searchParams.set('periodo_id', periodoFiltro);
      if (statusFiltro !== 'todos') url.searchParams.set('status', statusFiltro);
      if (busca.trim()) url.searchParams.set('busca', busca.trim());
      const res = await fetch(url.toString());
      const json = await res.json();
      setReservas(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  }, [grupoId, periodoFiltro, statusFiltro, busca]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { loadEntities<Cliente>('clientes').then(setClientes).catch(() => {}); }, []);

  const clienteLabel = (c: Cliente): string =>
    c.tipo === 'PJ' ? (c.nome_fantasia || c.razao_social || '') : (c.nome_completo || '');

  const abrirNova = (preencher?: Partial<FormReserva>) => {
    const periodoSugerido = periodoFiltro || periodos.find(p => p.vagas_disponiveis > 0)?.id || periodos[0]?.id || '';
    setForm({ ...formVazio, periodo_id: periodoSugerido, ...preencher });
    setEditandoId(null);
    setSheetOpen(true);
  };

  const abrirEditar = (r: Reserva) => {
    setForm({
      periodo_id: r.periodo_id,
      cliente_id: r.cliente_id,
      nome_passageiro: r.nome_passageiro,
      tipo_acomodacao: r.tipo_acomodacao,
      valor_cobrado: r.valor_cobrado,
      parcelas: r.parcelas,
      observacoes: r.observacoes || '',
      documentos_ok: r.documentos_ok,
      passaporte_vencimento: r.passaporte_vencimento || '',
    });
    setEditandoId(r.id);
    setSheetOpen(true);
  };

  const salvar = async () => {
    if (!form.cliente_id) { toast.error('Selecione o cliente'); return; }
    if (!form.periodo_id) { toast.error('Selecione o período'); return; }
    if (form.valor_cobrado <= 0) { toast.error('Informe o valor cobrado'); return; }

    setSalvando(true);
    try {
      const url = editandoId
        ? `/api/gestao-grupos/${grupoId}/reservas/${editandoId}`
        : `/api/gestao-grupos/${grupoId}/reservas`;
      const method = editandoId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Falha ao salvar');
        return;
      }
      toast.success(editandoId ? 'Reserva atualizada' : 'Reserva criada');
      setSheetOpen(false);
      setEditandoId(null);
      setForm(formVazio);
      await carregar();
      onReservaChange();
    } finally {
      setSalvando(false);
    }
  };

  const confirmar = async (reservaId: string) => {
    if (!confirm('Confirmar esta reserva irá gerar uma venda. Continuar?')) return;
    setConfirmando(reservaId);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}/reservas/${reservaId}/confirmar`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Falha ao confirmar');
        return;
      }
      const json = await res.json();
      toast.success('Reserva confirmada', `Venda ${json.venda.numero} criada (${fmtBRL(json.venda.valor_final)})`);
      await carregar();
      onReservaChange();
    } finally {
      setConfirmando(null);
    }
  };

  const cancelar = async (reservaId: string) => {
    const motivo = window.prompt('Motivo do cancelamento:');
    if (!motivo || !motivo.trim()) return;
    const res = await fetch(`/api/gestao-grupos/${grupoId}/reservas/${reservaId}?motivo=${encodeURIComponent(motivo.trim())}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || 'Falha ao cancelar');
      return;
    }
    toast.success('Reserva cancelada');
    await carregar();
    onReservaChange();
  };

  return (
    <div className="space-y-4">
      {/* Filtros + ação */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--ink-3)' }} />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome do passageiro ou cliente"
            className="h-[34px] pl-8 pr-3 border text-[12px] w-[280px]"
            style={{ borderColor: 'var(--line)', background: 'var(--ink-bg)', color: 'var(--ink)' }}
          />
        </div>

        <select
          value={periodoFiltro}
          onChange={e => setPeriodoFiltro(e.target.value)}
          className="h-[34px] px-3 border text-[12px]"
          style={{ borderColor: 'var(--line)', background: 'var(--ink-bg)', color: 'var(--ink)' }}
        >
          <option value="">Todos os períodos</option>
          {periodos.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        <div className="flex items-stretch border" style={{ borderColor: 'var(--line)', height: '34px' }}>
          {(['todos', 'reservado', 'confirmado', 'lista_espera', 'cancelado'] as const).map((s, i, arr) => {
            const ativo = statusFiltro === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFiltro(s)}
                className="px-3 text-[11px] transition-colors capitalize"
                style={{
                  color: ativo ? 'var(--ink)' : 'var(--ink-3)',
                  fontWeight: ativo ? 500 : 400,
                  background: ativo ? 'var(--ink-surface-2)' : 'transparent',
                  borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                {s === 'todos' ? 'Todos' : STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => abrirNova()}
          className="ml-auto inline-flex items-center gap-1 h-[34px] px-4 text-[12px]"
          style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
        >
          <Plus className="w-3.5 h-3.5" /> Nova reserva
        </button>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="border p-10 text-center" style={{ borderColor: 'var(--line)' }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--ink-3)' }} />
        </div>
      ) : reservas.length === 0 ? (
        <div className="border p-10 text-center" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
          <FileText className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--ink-3)' }} />
          <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {busca || statusFiltro !== 'todos' || periodoFiltro ? 'Nenhuma reserva encontrada com esses filtros.' : 'Nenhuma reserva cadastrada ainda.'}
          </p>
          {periodos.length > 0 && !busca && statusFiltro === 'todos' && (
            <button onClick={() => abrirNova()} className="mt-3 inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--ink)' }}>
              <Plus className="w-3 h-3" /> Cadastrar primeira reserva
            </button>
          )}
        </div>
      ) : (
        <div className="border overflow-hidden" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ background: 'var(--ink-surface-2)', borderBottom: '1px solid var(--line)' }}>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Passageiro</th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Período</th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Apto</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Valor</th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Status</th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Docs</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {reservas.map(r => {
                const statusCor: Record<string, string> = {
                  reservado: 'var(--blue, #3b82f6)',
                  confirmado: 'var(--pos)',
                  cancelado: 'var(--ink-3)',
                  lista_espera: 'var(--warn)',
                };
                const cancelada = r.status === 'cancelado';
                const confirmada = r.status === 'confirmado';
                return (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--line)', opacity: cancelada ? 0.55 : 1 }}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium" style={{ color: 'var(--ink)' }}>{r.nome_passageiro || '—'}</div>
                      <div className="text-[10px]" style={{ color: 'var(--ink-3)' }}>{r.cliente_nome || `cliente ${r.cliente_id.slice(0, 6)}`}</div>
                    </td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--ink-2)' }}>{r.periodo_label || '—'}</td>
                    <td className="px-3 py-2.5 mono" style={{ color: 'var(--ink-2)' }}>{r.tipo_acomodacao}</td>
                    <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--ink)' }}>
                      {fmtBRL(r.valor_cobrado)}
                      {r.parcelas > 1 && <div className="text-[10px]" style={{ color: 'var(--ink-3)' }}>{r.parcelas}x</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-wide"
                        style={{ background: statusCor[r.status], color: 'white' }}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                      {cancelada && r.motivo_cancelamento && (
                        <div className="text-[10px] mt-0.5 italic" style={{ color: 'var(--ink-3)' }}>{r.motivo_cancelamento}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.documentos_ok ? (
                        <Check className="w-3.5 h-3.5" style={{ color: 'var(--pos)' }} />
                      ) : r.passaporte_vencimento ? (
                        <span className="text-[10px] mono" style={{ color: 'var(--warn)' }}>passp. {fmtData(r.passaporte_vencimento)}</span>
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--ink-4)' }} />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        {!cancelada && !confirmada && (
                          <button
                            onClick={() => confirmar(r.id)}
                            disabled={confirmando === r.id}
                            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 transition-colors"
                            style={{ color: 'var(--pos)' }}
                            title="Confirmar (gera venda)"
                          >
                            {confirmando === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Confirmar
                          </button>
                        )}
                        {confirmada && r.venda_id && (
                          <a href={`/vendas/${r.venda_id}`} className="text-[11px]" style={{ color: 'var(--ink-3)', textDecoration: 'underline' }}>
                            ver venda
                          </a>
                        )}
                        {!cancelada && (
                          <button onClick={() => abrirEditar(r)} className="text-[11px]" style={{ color: 'var(--ink-2)' }} title="Editar">
                            <Edit2 className="w-3 h-3" />
                          </button>
                        )}
                        {!cancelada && (
                          <button onClick={() => cancelar(r.id)} className="text-[11px]" style={{ color: 'var(--neg)' }} title="Cancelar">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sheet lateral — Nova/Editar reserva */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full max-w-md h-full overflow-y-auto p-6 space-y-4 shadow-2xl"
            style={{ background: 'var(--ink-bg)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
                {editandoId ? 'Editar reserva' : 'Nova reserva'}
              </h3>
              <button onClick={() => setSheetOpen(false)} style={{ color: 'var(--ink-3)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <Field label="Cliente">
              <select
                value={form.cliente_id}
                disabled={!!editandoId}
                onChange={e => {
                  const id = e.target.value;
                  const c = clientes.find(cl => cl.id === id);
                  setForm(f => ({ ...f, cliente_id: id, nome_passageiro: f.nome_passageiro || (c ? clienteLabel(c) : '') }));
                }}
                className="w-full h-[34px] px-2 border text-[12px]"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              >
                <option value="">Selecione…</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{clienteLabel(c)}</option>)}
              </select>
            </Field>

            <Field label="Nome do passageiro" hint="Pode diferir do cliente (ex: filho do contratante)">
              <input
                type="text"
                value={form.nome_passageiro}
                onChange={e => setForm(f => ({ ...f, nome_passageiro: e.target.value }))}
                className="w-full h-[34px] px-2 border text-[12px]"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              />
            </Field>

            <Field label="Período">
              <select
                value={form.periodo_id}
                onChange={e => setForm(f => ({ ...f, periodo_id: e.target.value }))}
                className="w-full h-[34px] px-2 border text-[12px]"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              >
                {periodos.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.vagas_disponiveis}/{p.vagas_total} livres)
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Acomodação">
                <select
                  value={form.tipo_acomodacao}
                  onChange={e => setForm(f => ({ ...f, tipo_acomodacao: e.target.value }))}
                  className="w-full h-[34px] px-2 border text-[12px]"
                  style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
                >
                  {aptosDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Parcelas">
                <input
                  type="number"
                  min={1}
                  value={form.parcelas}
                  onChange={e => setForm(f => ({ ...f, parcelas: parseInt(e.target.value) || 1 }))}
                  className="w-full h-[34px] px-2 border text-[12px] mono"
                  style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
                />
              </Field>
            </div>

            <Field label="Valor cobrado (R$)">
              <input
                type="number"
                step="0.01"
                value={form.valor_cobrado || ''}
                onChange={e => setForm(f => ({ ...f, valor_cobrado: parseFloat(e.target.value) || 0 }))}
                className="w-full h-[34px] px-2 border text-[12px] mono"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              />
            </Field>

            <Field label="Vencimento do passaporte">
              <input
                type="date"
                value={form.passaporte_vencimento}
                onChange={e => setForm(f => ({ ...f, passaporte_vencimento: e.target.value }))}
                className="w-full h-[34px] px-2 border text-[12px] mono"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              />
            </Field>

            <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink-2)' }}>
              <input
                type="checkbox"
                checked={form.documentos_ok}
                onChange={e => setForm(f => ({ ...f, documentos_ok: e.target.checked }))}
              />
              Documentos entregues
            </label>

            <Field label="Observações">
              <textarea
                rows={3}
                value={form.observacoes}
                onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                className="w-full px-2 py-2 border text-[12px]"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              />
            </Field>

            {permiteListaEspera && (
              <p className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                Se o período estiver sem vagas, esta reserva entra em <b>lista de espera</b> automaticamente.
              </p>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={salvar}
                disabled={salvando}
                className="inline-flex items-center gap-1 h-[34px] px-4 text-[12px] disabled:opacity-50"
                style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
              >
                {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Salvar reserva
              </button>
              <button onClick={() => setSheetOpen(false)} className="h-[34px] px-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wide block mb-1" style={{ color: 'var(--ink-3)' }}>{label}</label>
      {children}
      {hint && <p className="text-[10px] mt-1 italic" style={{ color: 'var(--ink-3)' }}>{hint}</p>}
    </div>
  );
}
