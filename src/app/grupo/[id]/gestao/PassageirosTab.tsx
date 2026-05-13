'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus, Loader2, Search, Users, X, Check, Edit2, Trash2, AlertCircle,
  IdCard, Plane, Heart, MapPin, Phone,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import type { PassageiroTipo, PassageiroGenero } from '@/lib/gestao-grupos';

interface PassageiroAPI {
  id: string;
  grupo_id: string;
  reserva_id: string;
  nome_completo: string;
  reserva_status?: string;
  reserva_label?: string;
  _legado?: boolean;
  tipo?: PassageiroTipo;
  data_nascimento?: string;
  genero?: PassageiroGenero;
  nacionalidade?: string;
  cpf?: string;
  rg?: string;
  rg_orgao_emissor?: string;
  passaporte?: string;
  passaporte_vencimento?: string;
  passaporte_pais_emissao?: string;
  email?: string;
  telefone?: string;
  whatsapp?: string;
  contato_emergencia_nome?: string;
  contato_emergencia_telefone?: string;
  contato_emergencia_relacao?: string;
  restricoes_alimentares?: string;
  alergias?: string;
  necessidades_especiais?: string;
  medicamentos_continuos?: string;
  local_embarque?: string;
  assento?: string;
  tipo_acomodacao?: string;
  is_responsavel_financeiro?: boolean;
  observacoes_internas?: string;
  created_at?: string;
  updated_at?: string;
}

interface ReservaMin {
  id: string;
  periodo_label?: string;
  cliente_nome?: string;
  status: string;
  nome_passageiro?: string;
  tipo_acomodacao?: string;
}

interface Props {
  grupoId: string;
  onChange?: () => void;
}

const TIPO_LABEL: Record<PassageiroTipo, string> = {
  ADT: 'Adulto',
  CHD: 'Criança',
  INF: 'Bebê',
};

function fmtData(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function calcIdade(dataNasc?: string): number | null {
  if (!dataNasc) return null;
  const nasc = new Date(dataNasc + 'T00:00:00');
  if (isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function passaporteVencido(iso?: string): 'venc' | 'proximo' | null {
  if (!iso) return null;
  const venc = new Date(iso + 'T00:00:00').getTime();
  const hoje = new Date().setHours(0, 0, 0, 0);
  const dias = Math.floor((venc - hoje) / 86400000);
  if (dias < 0) return 'venc';
  if (dias <= 180) return 'proximo';
  return null;
}

function formFromAPI(p: Partial<PassageiroAPI>): FormPassageiro {
  return {
    reserva_id: p.reserva_id || '',
    nome_completo: p.nome_completo || '',
    tipo: p.tipo || 'ADT',
    data_nascimento: p.data_nascimento || '',
    genero: p.genero || '',
    nacionalidade: p.nacionalidade || '',
    cpf: p.cpf || '',
    rg: p.rg || '',
    rg_orgao_emissor: p.rg_orgao_emissor || '',
    passaporte: p.passaporte || '',
    passaporte_vencimento: p.passaporte_vencimento || '',
    passaporte_pais_emissao: p.passaporte_pais_emissao || '',
    email: p.email || '',
    telefone: p.telefone || '',
    whatsapp: p.whatsapp || '',
    contato_emergencia_nome: p.contato_emergencia_nome || '',
    contato_emergencia_telefone: p.contato_emergencia_telefone || '',
    contato_emergencia_relacao: p.contato_emergencia_relacao || '',
    restricoes_alimentares: p.restricoes_alimentares || '',
    alergias: p.alergias || '',
    necessidades_especiais: p.necessidades_especiais || '',
    medicamentos_continuos: p.medicamentos_continuos || '',
    local_embarque: p.local_embarque || '',
    assento: p.assento || '',
    tipo_acomodacao: p.tipo_acomodacao || '',
    is_responsavel_financeiro: !!p.is_responsavel_financeiro,
    observacoes_internas: p.observacoes_internas || '',
  };
}

interface FormPassageiro {
  reserva_id: string;
  nome_completo: string;
  tipo: PassageiroTipo;
  data_nascimento: string;
  genero: PassageiroGenero;
  nacionalidade: string;
  cpf: string;
  rg: string;
  rg_orgao_emissor: string;
  passaporte: string;
  passaporte_vencimento: string;
  passaporte_pais_emissao: string;
  email: string;
  telefone: string;
  whatsapp: string;
  contato_emergencia_nome: string;
  contato_emergencia_telefone: string;
  contato_emergencia_relacao: string;
  restricoes_alimentares: string;
  alergias: string;
  necessidades_especiais: string;
  medicamentos_continuos: string;
  local_embarque: string;
  assento: string;
  tipo_acomodacao: string;
  is_responsavel_financeiro: boolean;
  observacoes_internas: string;
}

const formVazio = (reservaId = ''): FormPassageiro => ({
  reserva_id: reservaId,
  nome_completo: '',
  tipo: 'ADT',
  data_nascimento: '',
  genero: '',
  nacionalidade: '',
  cpf: '',
  rg: '',
  rg_orgao_emissor: '',
  passaporte: '',
  passaporte_vencimento: '',
  passaporte_pais_emissao: '',
  email: '',
  telefone: '',
  whatsapp: '',
  contato_emergencia_nome: '',
  contato_emergencia_telefone: '',
  contato_emergencia_relacao: '',
  restricoes_alimentares: '',
  alergias: '',
  necessidades_especiais: '',
  medicamentos_continuos: '',
  local_embarque: '',
  assento: '',
  tipo_acomodacao: '',
  is_responsavel_financeiro: false,
  observacoes_internas: '',
});

export function PassageirosTab({ grupoId, onChange }: Props) {
  const [pax, setPax] = useState<PassageiroAPI[]>([]);
  const [reservas, setReservas] = useState<ReservaMin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroDoc, setFiltroDoc] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormPassageiro>(formVazio());
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL(`/api/gestao-grupos/${grupoId}/passageiros`, window.location.origin);
      if (busca.trim()) url.searchParams.set('busca', busca.trim());
      if (filtroDoc) url.searchParams.set('doc_pendente', '1');
      const [paxRes, reservasRes] = await Promise.all([
        fetch(url.toString()).then(r => r.ok ? r.json() : []),
        fetch(`/api/gestao-grupos/${grupoId}/reservas`).then(r => r.ok ? r.json() : []),
      ]);
      setPax(Array.isArray(paxRes) ? paxRes : []);
      setReservas(Array.isArray(reservasRes) ? reservasRes : []);
    } finally {
      setLoading(false);
    }
  }, [grupoId, busca, filtroDoc]);

  useEffect(() => { void carregar(); }, [carregar]);

  const stats = useMemo(() => {
    const adultos = pax.filter(p => p.tipo === 'ADT').length;
    const criancas = pax.filter(p => p.tipo === 'CHD').length;
    const bebes = pax.filter(p => p.tipo === 'INF').length;
    const docPendentes = pax.filter(p => !p.cpf && !p.passaporte && !p._legado).length;
    const legados = pax.filter(p => p._legado).length;
    return { total: pax.length, adultos, criancas, bebes, docPendentes, legados };
  }, [pax]);

  const reservasAtivas = useMemo(
    () => reservas.filter(r => r.status !== 'cancelado'),
    [reservas],
  );

  const abrirNovo = (reservaId?: string) => {
    const reservaSugerida = reservaId
      || (reservasAtivas[0]?.id ?? '');
    setForm(formVazio(reservaSugerida));
    setEditandoId(null);
    setSheetOpen(true);
  };

  const abrirEditar = (p: PassageiroAPI) => {
    setForm(formFromAPI(p));
    setEditandoId(p.id);
    setSheetOpen(true);
  };

  const salvar = async () => {
    if (!form.nome_completo.trim()) { toast.error('Nome completo é obrigatório'); return; }
    if (!form.reserva_id) { toast.error('Selecione a reserva'); return; }

    setSalvando(true);
    try {
      const url = editandoId
        ? `/api/gestao-grupos/${grupoId}/passageiros/${editandoId}`
        : `/api/gestao-grupos/${grupoId}/passageiros`;
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
      toast.success(editandoId ? 'Passageiro atualizado' : 'Passageiro adicionado');
      setSheetOpen(false);
      setEditandoId(null);
      setForm(formVazio());
      await carregar();
      onChange?.();
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (p: PassageiroAPI) => {
    if (p._legado) {
      toast.message('Passageiro legado — edite a reserva para alterar o nome');
      return;
    }
    if (!confirm(`Remover "${p.nome_completo}"? A reserva e cobranças permanecem.`)) return;
    const res = await fetch(`/api/gestao-grupos/${grupoId}/passageiros/${p.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || 'Falha ao remover');
      return;
    }
    toast.success('Passageiro removido');
    await carregar();
    onChange?.();
  };

  return (
    <div className="space-y-4">
      {/* KPIs compactos */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiMini label="Total" value={stats.total} />
        <KpiMini label="Adultos" value={stats.adultos} />
        <KpiMini label="Crianças" value={stats.criancas} />
        <KpiMini label="Bebês" value={stats.bebes} />
        <KpiMini
          label="Docs pendentes"
          value={stats.docPendentes}
          accent={stats.docPendentes > 0 ? 'warn' : 'neutral'}
        />
      </div>

      {stats.legados > 0 && (
        <div className="banner-info">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <b>{stats.legados} passageiro{stats.legados > 1 ? 's' : ''} com dados básicos.</b>
            {' '}Clique em <i>Editar</i> em qualquer linha cinza pra cadastrar CPF, passaporte, contato e demais campos.
          </div>
        </div>
      )}

      {/* Filtros + ação */}
      <div className="filters-bar">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--lg-text-4)' }} />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF, passaporte, email..."
            className="filter-input"
            style={{ paddingLeft: '36px', minWidth: '320px' }}
          />
        </div>
        <label className="inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--lg-text-2)' }}>
          <input
            type="checkbox"
            checked={filtroDoc}
            onChange={e => setFiltroDoc(e.target.checked)}
          />
          Só com documentos pendentes
        </label>
        <button
          type="button"
          onClick={() => abrirNovo()}
          className="ml-auto inline-flex items-center gap-1.5 h-[40px] px-4 rounded-[8px] text-[13px] font-semibold"
          style={{ background: 'var(--lg-accent)', color: 'white' }}
          disabled={reservasAtivas.length === 0}
          title={reservasAtivas.length === 0 ? 'Crie uma reserva primeiro' : ''}
        >
          <Plus className="w-4 h-4" /> Novo passageiro
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="border p-10 text-center rounded-[12px]" style={{ borderColor: 'var(--lg-border-base)' }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--lg-text-3)' }} />
        </div>
      ) : pax.length === 0 ? (
        <div className="empty-state">
          <Users className="empty-state__icon" strokeWidth={1.5} />
          <p className="empty-state__title">Nenhum passageiro cadastrado</p>
          <p className="empty-state__description">
            {reservasAtivas.length === 0
              ? 'Crie uma reserva primeiro para adicionar passageiros.'
              : busca || filtroDoc
                ? 'Nenhum passageiro encontrado com esses filtros.'
                : 'Adicione os passageiros que vão efetivamente viajar (podem diferir do contratante).'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px]" style={{
          background: 'var(--lg-surface-solid)',
          border: '1px solid var(--lg-border-base)',
          boxShadow: 'var(--lg-shadow-card)',
        }}>
          <table className="w-full text-[13px]">
            <thead style={{ background: '#F8FAFC' }}>
              <tr style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Passageiro</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Documentos</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Contato</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Reserva</th>
                <th className="text-right px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {pax.map(p => {
                const idade = calcIdade(p.data_nascimento);
                const passVenc = passaporteVencido(p.passaporte_vencimento);
                const ehLegado = p._legado;
                return (
                  <tr
                    key={p.id}
                    className="transition-colors hover:bg-[#F8FAFC]"
                    style={{
                      borderTop: '1px solid #F1F5F9',
                      opacity: ehLegado ? 0.7 : 1,
                    }}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold" style={{ color: 'var(--lg-text)' }}>
                          {p.nome_completo}
                        </span>
                        {p.is_responsavel_financeiro && (
                          <span className="badge badge--info text-[10px]" title="Também é o responsável financeiro">$</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] mt-0.5" style={{ color: 'var(--lg-text-3)' }}>
                        <span className="badge badge--neutral text-[10px]">{TIPO_LABEL[p.tipo || 'ADT']}</span>
                        {idade !== null && <span>{idade} anos</span>}
                        {ehLegado && <span className="italic">(dados básicos)</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {p.cpf || p.passaporte ? (
                        <div className="text-[12px] mono" style={{ color: 'var(--lg-text-2)' }}>
                          {p.cpf && <div>CPF: {p.cpf}</div>}
                          {p.passaporte && (
                            <div className="flex items-center gap-1">
                              Pass: {p.passaporte}
                              {passVenc === 'venc' && (
                                <span className="badge badge--danger text-[9px]">vencido</span>
                              )}
                              {passVenc === 'proximo' && (
                                <span className="badge badge--warning text-[9px]" title={fmtData(p.passaporte_vencimento)}>
                                  vence {fmtData(p.passaporte_vencimento)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="badge badge--warning text-[10px]">Pendente</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[12px]" style={{ color: 'var(--lg-text-2)' }}>
                      {p.whatsapp ? <div>📱 {p.whatsapp}</div> : p.telefone ? <div>{p.telefone}</div> : null}
                      {p.email && <div className="truncate max-w-[180px]" title={p.email}>{p.email}</div>}
                      {!p.whatsapp && !p.telefone && !p.email && (
                        <span style={{ color: 'var(--lg-text-4)' }}>—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[12px]" style={{ color: 'var(--lg-text-2)' }}>
                      {p.reserva_label || '—'}
                      {p.tipo_acomodacao && (
                        <div className="text-[10px] mono" style={{ color: 'var(--lg-text-3)' }}>
                          Apto {p.tipo_acomodacao}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => abrirEditar(p)}
                          className="table-action-btn"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remover(p)}
                          className="table-action-btn table-action-btn--danger"
                          title="Remover"
                          disabled={ehLegado}
                          style={{ opacity: ehLegado ? 0.3 : 1 }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sheet — Novo/Editar passageiro */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: 'rgba(15, 23, 42, 0.45)' }}
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full max-w-2xl h-full overflow-y-auto p-6 space-y-5 shadow-2xl"
            style={{ background: 'white' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
              <h3 className="text-[18px] font-bold" style={{ color: 'var(--lg-text)' }}>
                {editandoId ? 'Editar passageiro' : 'Novo passageiro'}
              </h3>
              <button onClick={() => setSheetOpen(false)} style={{ color: 'var(--lg-text-3)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Reserva + Nome — sempre no topo */}
            <SectionTitle icon={Users} label="Identificação" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Reserva *" className="md:col-span-3">
                <select
                  value={form.reserva_id}
                  onChange={e => setForm(f => ({ ...f, reserva_id: e.target.value }))}
                  className="filter-select w-full"
                  disabled={!!editandoId}
                >
                  <option value="">Selecione…</option>
                  {reservasAtivas.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.cliente_nome || r.nome_passageiro || 'Reserva'} — {r.periodo_label || 'Sem período'} · {r.tipo_acomodacao || ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nome completo *" className="md:col-span-3">
                <input
                  type="text"
                  value={form.nome_completo}
                  onChange={e => setForm(f => ({ ...f, nome_completo: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="Como aparece no documento"
                />
              </Field>
              <Field label="Tipo">
                <select
                  value={form.tipo}
                  onChange={e => setForm(f => ({ ...f, tipo: e.target.value as PassageiroTipo }))}
                  className="filter-select w-full"
                >
                  <option value="ADT">Adulto</option>
                  <option value="CHD">Criança</option>
                  <option value="INF">Bebê</option>
                </select>
              </Field>
              <Field label="Data de nascimento">
                <input
                  type="date"
                  value={form.data_nascimento}
                  onChange={e => setForm(f => ({ ...f, data_nascimento: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="Gênero">
                <select
                  value={form.genero}
                  onChange={e => setForm(f => ({ ...f, genero: e.target.value as PassageiroGenero }))}
                  className="filter-select w-full"
                >
                  <option value="">—</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </Field>
              <Field label="Nacionalidade" className="md:col-span-3">
                <input
                  type="text"
                  value={form.nacionalidade}
                  onChange={e => setForm(f => ({ ...f, nacionalidade: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="Brasileira"
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--lg-text-2)' }}>
              <input
                type="checkbox"
                checked={form.is_responsavel_financeiro}
                onChange={e => setForm(f => ({ ...f, is_responsavel_financeiro: e.target.checked }))}
              />
              Este passageiro também é o responsável financeiro (contratante)
            </label>

            {/* Documentos */}
            <SectionTitle icon={IdCard} label="Documentos" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="CPF">
                <input
                  type="text"
                  value={form.cpf}
                  onChange={e => setForm(f => ({ ...f, cpf: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="000.000.000-00"
                />
              </Field>
              <Field label="RG">
                <input
                  type="text"
                  value={form.rg}
                  onChange={e => setForm(f => ({ ...f, rg: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="Órgão emissor">
                <input
                  type="text"
                  value={form.rg_orgao_emissor}
                  onChange={e => setForm(f => ({ ...f, rg_orgao_emissor: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="SSP/SP"
                />
              </Field>
              <Field label="Passaporte">
                <input
                  type="text"
                  value={form.passaporte}
                  onChange={e => setForm(f => ({ ...f, passaporte: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="Vencimento">
                <input
                  type="date"
                  value={form.passaporte_vencimento}
                  onChange={e => setForm(f => ({ ...f, passaporte_vencimento: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="País de emissão">
                <input
                  type="text"
                  value={form.passaporte_pais_emissao}
                  onChange={e => setForm(f => ({ ...f, passaporte_pais_emissao: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="Brasil"
                />
              </Field>
            </div>

            {/* Contato */}
            <SectionTitle icon={Phone} label="Contato" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="E-mail" className="md:col-span-3">
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="Telefone">
                <input
                  type="tel"
                  value={form.telefone}
                  onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="WhatsApp">
                <input
                  type="tel"
                  value={form.whatsapp}
                  onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="Contato de emergência">
                <input
                  type="text"
                  value={form.contato_emergencia_nome}
                  onChange={e => setForm(f => ({ ...f, contato_emergencia_nome: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="Nome"
                />
              </Field>
              <Field label="Telefone emergência">
                <input
                  type="tel"
                  value={form.contato_emergencia_telefone}
                  onChange={e => setForm(f => ({ ...f, contato_emergencia_telefone: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="Relação">
                <input
                  type="text"
                  value={form.contato_emergencia_relacao}
                  onChange={e => setForm(f => ({ ...f, contato_emergencia_relacao: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="Pai, esposa, irmã..."
                />
              </Field>
            </div>

            {/* Saúde */}
            <SectionTitle icon={Heart} label="Saúde e restrições" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Restrições alimentares">
                <textarea
                  rows={2}
                  value={form.restricoes_alimentares}
                  onChange={e => setForm(f => ({ ...f, restricoes_alimentares: e.target.value }))}
                  className="filter-input w-full"
                  style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
                  placeholder="Vegetariano, lactose, glúten..."
                />
              </Field>
              <Field label="Alergias">
                <textarea
                  rows={2}
                  value={form.alergias}
                  onChange={e => setForm(f => ({ ...f, alergias: e.target.value }))}
                  className="filter-input w-full"
                  style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
                />
              </Field>
              <Field label="Necessidades especiais">
                <textarea
                  rows={2}
                  value={form.necessidades_especiais}
                  onChange={e => setForm(f => ({ ...f, necessidades_especiais: e.target.value }))}
                  className="filter-input w-full"
                  style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
                  placeholder="Cadeira de rodas, etc."
                />
              </Field>
              <Field label="Medicamentos contínuos">
                <textarea
                  rows={2}
                  value={form.medicamentos_continuos}
                  onChange={e => setForm(f => ({ ...f, medicamentos_continuos: e.target.value }))}
                  className="filter-input w-full"
                  style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
                />
              </Field>
            </div>

            {/* Operação */}
            <SectionTitle icon={MapPin} label="Operação" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Local de embarque">
                <input
                  type="text"
                  value={form.local_embarque}
                  onChange={e => setForm(f => ({ ...f, local_embarque: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="GRU, CGH..."
                />
              </Field>
              <Field label="Assento">
                <input
                  type="text"
                  value={form.assento}
                  onChange={e => setForm(f => ({ ...f, assento: e.target.value }))}
                  className="filter-input w-full"
                />
              </Field>
              <Field label="Acomodação desejada">
                <select
                  value={form.tipo_acomodacao}
                  onChange={e => setForm(f => ({ ...f, tipo_acomodacao: e.target.value }))}
                  className="filter-select w-full"
                >
                  <option value="">—</option>
                  <option value="SGL">SGL — Single</option>
                  <option value="DBL">DBL — Duplo</option>
                  <option value="TPL">TPL — Triplo</option>
                  <option value="QDP">QDP — Quádruplo</option>
                </select>
              </Field>
            </div>

            {/* Observações */}
            <Field label="Observações internas">
              <textarea
                rows={3}
                value={form.observacoes_internas}
                onChange={e => setForm(f => ({ ...f, observacoes_internas: e.target.value }))}
                className="filter-input w-full"
                style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
                placeholder="Notas operacionais..."
              />
            </Field>

            {/* Ações */}
            <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--lg-border-base)' }}>
              <button
                onClick={salvar}
                disabled={salvando}
                className="inline-flex items-center gap-1.5 h-[40px] px-5 rounded-[8px] text-[13px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--lg-accent)', color: 'white' }}
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editandoId ? 'Salvar alterações' : 'Adicionar passageiro'}
              </button>
              <button
                onClick={() => setSheetOpen(false)}
                className="h-[40px] px-4 text-[13px]"
                style={{ color: 'var(--lg-text-3)' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Helpers ------------------------------------------------------

function KpiMini({ label, value, accent }: { label: string; value: number; accent?: 'warn' | 'neutral' }) {
  return (
    <div className="kpi-card" style={{ padding: '12px 16px' }}>
      <div className="kpi-card__label" style={{ fontSize: '10px' }}>{label}</div>
      <div
        className="kpi-card__value"
        style={{
          fontSize: '22px',
          color: accent === 'warn' && value > 0 ? 'var(--lg-warn)' : 'var(--lg-text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2" style={{ color: 'var(--lg-text-2)' }}>
      <Icon className="w-4 h-4" />
      <span className="text-[12px] font-semibold uppercase tracking-[0.05em]">{label}</span>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-[11px] uppercase tracking-[0.04em] font-semibold block mb-1.5" style={{ color: 'var(--lg-text-3)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// Suprime warning de import não usado (mantém os ícones pra futuro uso)
void Plane;
