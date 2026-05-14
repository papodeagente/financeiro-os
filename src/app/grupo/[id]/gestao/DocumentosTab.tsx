'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Plus, Loader2, FileCheck2, X, Check, Upload, Download, Link as LinkIcon,
  Edit2, Trash2, AlertCircle, Search, FileX2,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  DOCUMENTO_TIPO_LABEL, DOCUMENTO_STATUS_LABEL,
  type DocumentoTipo, type DocumentoStatus,
} from '@/lib/gestao-grupos';

interface DocAPI {
  id: string;
  grupo_id: string;
  passageiro_id: string;
  passageiro_nome: string;
  tipo: DocumentoTipo;
  status: DocumentoStatus;
  nome_personalizado?: string;
  url?: string;
  nome_arquivo?: string;
  tamanho_bytes?: number | null;
  extensao?: string | null;
  data_vencimento?: string;
  observacoes?: string;
  motivo_reprovacao?: string;
  data_envio?: string;
  data_aprovacao?: string;
  aprovador?: string;
  created_at?: string;
  updated_at?: string;
}

interface APIResp {
  documentos: DocAPI[];
  stats: Record<DocumentoStatus | 'total', number>;
}

interface PassageiroMin {
  id: string;
  nome_completo: string;
}

interface Props {
  grupoId: string;
  onChange?: () => void;
}

const STATUS_BADGE: Record<DocumentoStatus, string> = {
  pendente: 'badge badge--warning',
  enviado: 'badge badge--info',
  em_analise: 'badge badge--info',
  aprovado: 'badge badge--success',
  reprovado: 'badge badge--danger',
  vencido: 'badge badge--danger',
  nao_aplica: 'badge badge--neutral',
};

interface FormDoc {
  passageiro_id: string;
  tipo: DocumentoTipo;
  status: DocumentoStatus;
  nome_personalizado: string;
  url: string;
  nome_arquivo: string;
  tamanho_bytes: number | null;
  extensao: string | null;
  data_vencimento: string;
  observacoes: string;
  motivo_reprovacao: string;
}

const formVazio: FormDoc = {
  passageiro_id: '',
  tipo: 'rg',
  status: 'pendente',
  nome_personalizado: '',
  url: '',
  nome_arquivo: '',
  tamanho_bytes: null,
  extensao: null,
  data_vencimento: '',
  observacoes: '',
  motivo_reprovacao: '',
};

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtData(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

export function DocumentosTab({ grupoId, onChange }: Props) {
  const [docs, setDocs] = useState<DocAPI[]>([]);
  const [stats, setStats] = useState<APIResp['stats'] | null>(null);
  const [passageiros, setPassageiros] = useState<PassageiroMin[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFiltro, setStatusFiltro] = useState<DocumentoStatus | 'todos'>('todos');
  const [busca, setBusca] = useState('');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormDoc>(formVazio);
  const [salvando, setSalvando] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL(`/api/gestao-grupos/${grupoId}/documentos`, window.location.origin);
      if (statusFiltro !== 'todos') url.searchParams.set('status', statusFiltro);
      const [docsRes, paxRes] = await Promise.all([
        fetch(url.toString()).then(r => r.ok ? r.json() : { documentos: [], stats: {} }),
        fetch(`/api/gestao-grupos/${grupoId}/passageiros`).then(r => r.ok ? r.json() : []),
      ]);
      setDocs(Array.isArray(docsRes.documentos) ? docsRes.documentos : []);
      setStats(docsRes.stats || null);
      // Passageiros — só os reais (sem placeholders legado)
      const paxArr = (Array.isArray(paxRes) ? paxRes : [])
        .filter((p: { _legado?: boolean }) => !p._legado)
        .map((p: { id: string; nome_completo: string }) => ({ id: p.id, nome_completo: p.nome_completo }));
      setPassageiros(paxArr);
    } finally {
      setLoading(false);
    }
  }, [grupoId, statusFiltro]);

  useEffect(() => { void carregar(); }, [carregar]);

  const filtered = useMemo(() => {
    const q = busca.toLowerCase().trim();
    if (!q) return docs;
    return docs.filter(d =>
      d.passageiro_nome.toLowerCase().includes(q) ||
      (d.nome_personalizado || '').toLowerCase().includes(q) ||
      (d.nome_arquivo || '').toLowerCase().includes(q),
    );
  }, [docs, busca]);

  const abrirNovo = (passageiroId?: string) => {
    setForm({ ...formVazio, passageiro_id: passageiroId || (passageiros[0]?.id || '') });
    setEditandoId(null);
    setSheetOpen(true);
  };

  const abrirEditar = (d: DocAPI) => {
    setForm({
      passageiro_id: d.passageiro_id,
      tipo: d.tipo,
      status: d.status,
      nome_personalizado: d.nome_personalizado || '',
      url: d.url || '',
      nome_arquivo: d.nome_arquivo || '',
      tamanho_bytes: d.tamanho_bytes ?? null,
      extensao: d.extensao ?? null,
      data_vencimento: d.data_vencimento || '',
      observacoes: d.observacoes || '',
      motivo_reprovacao: d.motivo_reprovacao || '',
    });
    setEditandoId(d.id);
    setSheetOpen(true);
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('files', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Falha no upload');
        return;
      }
      const result = await res.json();
      const item = Array.isArray(result) ? result[0] : result;
      const ext = file.name.split('.').pop()?.toLowerCase() || null;
      setForm(f => ({
        ...f,
        url: item.url,
        nome_arquivo: file.name,
        tamanho_bytes: item.tamanho || file.size,
        extensao: ext,
        status: f.status === 'pendente' ? 'enviado' : f.status,
      }));
      toast.success('Arquivo enviado');
    } finally {
      setUploading(false);
    }
  };

  const salvar = async () => {
    if (!form.passageiro_id) { toast.error('Selecione o passageiro'); return; }
    setSalvando(true);
    try {
      const url = editandoId
        ? `/api/gestao-grupos/${grupoId}/documentos/${editandoId}`
        : `/api/gestao-grupos/${grupoId}/documentos`;
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
      toast.success(editandoId ? 'Documento atualizado' : 'Documento criado');
      setSheetOpen(false);
      await carregar();
      onChange?.();
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (d: DocAPI) => {
    if (!confirm(`Remover ${DOCUMENTO_TIPO_LABEL[d.tipo]} de ${d.passageiro_nome}?`)) return;
    const res = await fetch(`/api/gestao-grupos/${grupoId}/documentos/${d.id}`, { method: 'DELETE' });
    if (!res.ok) return;
    toast.success('Documento removido');
    await carregar();
    onChange?.();
  };

  const aprovar = async (d: DocAPI) => {
    const res = await fetch(`/api/gestao-grupos/${grupoId}/documentos/${d.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'aprovado' }),
    });
    if (!res.ok) return;
    toast.success('Documento aprovado');
    await carregar();
    onChange?.();
  };

  const reprovar = async (d: DocAPI) => {
    const motivo = window.prompt('Motivo da reprovação:');
    if (!motivo || !motivo.trim()) return;
    const res = await fetch(`/api/gestao-grupos/${grupoId}/documentos/${d.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reprovado', motivo_reprovacao: motivo }),
    });
    if (!res.ok) return;
    toast.success('Documento reprovado');
    await carregar();
    onChange?.();
  };

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__label">Total</div>
          <div className="kpi-card__value">{stats?.total ?? 0}</div>
          <div className="kpi-card__meta">documentos vinculados aos passageiros</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Pendentes</div>
          <div className="kpi-card__value" style={{ color: (stats?.pendente || 0) > 0 ? 'var(--lg-warn)' : 'var(--lg-text)' }}>
            {stats?.pendente ?? 0}
          </div>
          <div className="kpi-card__meta">Aguardando envio do passageiro</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Em análise</div>
          <div className="kpi-card__value">
            {(stats?.enviado || 0) + (stats?.em_analise || 0)}
          </div>
          <div className="kpi-card__meta">Enviados aguardando validação</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Aprovados</div>
          <div className="kpi-card__value" style={{ color: 'var(--lg-pos)' }}>{stats?.aprovado ?? 0}</div>
          <div className="kpi-card__meta">
            {(stats?.reprovado || 0) > 0 && (
              <span style={{ color: 'var(--lg-neg)' }}>{stats?.reprovado} reprovados</span>
            )}
            {(stats?.vencido || 0) > 0 && (
              <> · <span style={{ color: 'var(--lg-neg)' }}>{stats?.vencido} vencidos</span></>
            )}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filters-bar">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--lg-text-4)' }} />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por passageiro ou nome do arquivo..."
            className="filter-input"
            style={{ paddingLeft: '36px', minWidth: '300px' }}
          />
        </div>
        <select
          value={statusFiltro}
          onChange={e => setStatusFiltro(e.target.value as DocumentoStatus | 'todos')}
          className="filter-select"
        >
          <option value="todos">Todos os status</option>
          {(Object.entries(DOCUMENTO_STATUS_LABEL) as [DocumentoStatus, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => abrirNovo()}
          disabled={passageiros.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 h-[40px] px-4 rounded-[8px] text-[13px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--lg-accent)', color: 'white' }}
          title={passageiros.length === 0 ? 'Cadastre passageiros primeiro' : ''}
        >
          <Plus className="w-4 h-4" /> Novo documento
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="border p-10 text-center rounded-[12px]" style={{ borderColor: 'var(--lg-border-base)' }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--lg-text-3)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <FileCheck2 className="empty-state__icon" strokeWidth={1.5} />
          <p className="empty-state__title">
            {docs.length === 0 ? 'Nenhum documento cadastrado' : 'Nenhum documento com esses filtros'}
          </p>
          <p className="empty-state__description">
            {passageiros.length === 0
              ? 'Cadastre passageiros primeiro para vincular documentos.'
              : 'Adicione RG, CPF, passaporte, contratos, vistos e outros documentos por passageiro.'}
          </p>
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-[12px]"
          style={{
            background: 'var(--lg-surface-solid)',
            border: '1px solid var(--lg-border-base)',
            boxShadow: 'var(--lg-shadow-card)',
          }}
        >
          <table className="w-full text-[13px]">
            <thead style={{ background: '#F8FAFC' }}>
              <tr style={{ borderBottom: '1px solid var(--lg-border-base)' }}>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Passageiro</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Documento</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Status</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Vencimento</th>
                <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Arquivo</th>
                <th className="text-right px-3 py-2.5 text-[11px] uppercase tracking-[0.05em] font-semibold" style={{ color: 'var(--lg-text-3)' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} style={{ borderTop: '1px solid #F1F5F9' }} className="hover:bg-[#F8FAFC]">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold" style={{ color: 'var(--lg-text)' }}>{d.passageiro_nome}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div style={{ color: 'var(--lg-text)' }}>
                      {DOCUMENTO_TIPO_LABEL[d.tipo]}
                      {d.tipo === 'outros' && d.nome_personalizado && (
                        <span style={{ color: 'var(--lg-text-3)' }}> — {d.nome_personalizado}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={STATUS_BADGE[d.status]}>{DOCUMENTO_STATUS_LABEL[d.status]}</span>
                    {d.status === 'reprovado' && d.motivo_reprovacao && (
                      <div className="text-[10px] italic mt-0.5" style={{ color: 'var(--lg-neg)' }} title={d.motivo_reprovacao}>
                        {d.motivo_reprovacao.length > 30 ? d.motivo_reprovacao.slice(0, 30) + '…' : d.motivo_reprovacao}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] mono" style={{ color: 'var(--lg-text-2)' }}>
                    {d.data_vencimento ? fmtData(d.data_vencimento) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {d.url ? (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1"
                        style={{ color: 'var(--lg-accent)' }}
                      >
                        <Download className="w-3 h-3" />
                        <span className="truncate max-w-[160px]">{d.nome_arquivo || 'Arquivo'}</span>
                        {d.tamanho_bytes && (
                          <span className="text-[10px]" style={{ color: 'var(--lg-text-3)' }}>· {fmtBytes(d.tamanho_bytes)}</span>
                        )}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--lg-text-4)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      {d.status !== 'aprovado' && d.url && (
                        <button onClick={() => aprovar(d)} className="table-action-btn" title="Aprovar" style={{ color: 'var(--lg-pos)' }}>
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {d.status !== 'reprovado' && d.url && (
                        <button onClick={() => reprovar(d)} className="table-action-btn" title="Reprovar" style={{ color: 'var(--lg-neg)' }}>
                          <FileX2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => abrirEditar(d)} className="table-action-btn" title="Editar">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remover(d)} className="table-action-btn table-action-btn--danger" title="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                {editandoId ? 'Editar documento' : 'Novo documento'}
              </h3>
              <button onClick={() => setSheetOpen(false)} style={{ color: 'var(--lg-text-3)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <Field label="Passageiro *">
              <select
                value={form.passageiro_id}
                onChange={e => setForm(f => ({ ...f, passageiro_id: e.target.value }))}
                disabled={!!editandoId}
                className="filter-select w-full"
              >
                <option value="">Selecione…</option>
                {passageiros.map(p => (
                  <option key={p.id} value={p.id}>{p.nome_completo}</option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo">
                <select
                  value={form.tipo}
                  onChange={e => setForm(f => ({ ...f, tipo: e.target.value as DocumentoTipo }))}
                  className="filter-select w-full"
                >
                  {(Object.entries(DOCUMENTO_TIPO_LABEL) as [DocumentoTipo, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as DocumentoStatus }))}
                  className="filter-select w-full"
                >
                  {(Object.entries(DOCUMENTO_STATUS_LABEL) as [DocumentoStatus, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
            </div>

            {form.tipo === 'outros' && (
              <Field label="Nome do documento">
                <input
                  type="text"
                  value={form.nome_personalizado}
                  onChange={e => setForm(f => ({ ...f, nome_personalizado: e.target.value }))}
                  className="filter-input w-full"
                  placeholder="Ex: Certidão de nascimento"
                />
              </Field>
            )}

            <Field label="Data de vencimento" hint="Quando o documento expira">
              <input
                type="date"
                value={form.data_vencimento}
                onChange={e => setForm(f => ({ ...f, data_vencimento: e.target.value }))}
                className="filter-input w-full"
              />
            </Field>

            {/* Upload */}
            <Field label="Arquivo">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.zip"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full inline-flex items-center justify-center gap-2 h-[60px] border-2 border-dashed rounded-[10px] text-[12px] disabled:opacity-50"
                style={{ borderColor: 'var(--lg-border-strong)', color: 'var(--lg-text-2)', background: '#F8FAFC' }}
              >
                {uploading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Enviando…</>
                ) : form.url ? (
                  <><Check className="w-4 h-4" style={{ color: 'var(--lg-pos)' }} /> {form.nome_arquivo || 'Arquivo enviado'} {form.tamanho_bytes && `(${fmtBytes(form.tamanho_bytes)})`}</>
                ) : (
                  <><Upload className="w-4 h-4" /> Clique pra escolher arquivo</>
                )}
              </button>
              <p className="text-[10px] mt-1 italic" style={{ color: 'var(--lg-text-3)' }}>
                Aceita PDF, Word, imagens, ZIP. Máx 25MB.
              </p>
              {form.url && !form.url.startsWith('/api/uploads') && (
                <div className="mt-2 text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--lg-text-2)' }}>
                  <LinkIcon className="w-3 h-3" /> Link externo: {form.url}
                </div>
              )}
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

            {form.status === 'reprovado' && (
              <Field label="Motivo da reprovação">
                <textarea
                  rows={2}
                  value={form.motivo_reprovacao}
                  onChange={e => setForm(f => ({ ...f, motivo_reprovacao: e.target.value }))}
                  className="filter-input w-full"
                  style={{ height: 'auto', paddingTop: '10px', paddingBottom: '10px' }}
                />
              </Field>
            )}

            <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--lg-border-base)' }}>
              <button
                onClick={salvar}
                disabled={salvando || uploading}
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

void AlertCircle;
