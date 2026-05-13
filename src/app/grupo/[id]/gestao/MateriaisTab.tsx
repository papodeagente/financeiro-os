'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, Loader2, FileText, Link as LinkIcon, MapPin, FileSignature, Ticket,
  File, Edit2, Trash2, X, Check, Eye, Copy, Download, Upload,
} from 'lucide-react';
import { toast } from '@/lib/toast';

type MaterialTipo = 'arquivo' | 'link' | 'roteiro' | 'contrato' | 'voucher' | 'outro';

interface Material {
  id: string;
  tipo: MaterialTipo;
  nome: string;
  url: string;
  tamanho_bytes: number | null;
  extensao: string | null;
  descricao: string;
  visivel_para_passageiro: boolean;
  enviado_para: string[];
  created_at?: string;
}

interface Props {
  grupoId: string;
  onChange: () => void;
}

const TIPOS: { key: MaterialTipo; label: string }[] = [
  { key: 'roteiro', label: 'Roteiro' },
  { key: 'contrato', label: 'Contrato' },
  { key: 'voucher', label: 'Voucher' },
  { key: 'arquivo', label: 'Arquivo' },
  { key: 'link', label: 'Link' },
  { key: 'outro', label: 'Outro' },
];

const ICONE_TIPO: Record<MaterialTipo, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  roteiro: MapPin,
  contrato: FileSignature,
  voucher: Ticket,
  arquivo: FileText,
  link: LinkIcon,
  outro: File,
};

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDataHora(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface FormMaterial {
  tipo: MaterialTipo;
  nome: string;
  url: string;
  descricao: string;
  visivel_para_passageiro: boolean;
  tamanho_bytes: number | null;
  extensao: string | null;
}

const formVazio: FormMaterial = {
  tipo: 'roteiro',
  nome: '',
  url: '',
  descricao: '',
  visivel_para_passageiro: false,
  tamanho_bytes: null,
  extensao: null,
};

export function MateriaisTab({ grupoId, onChange }: Props) {
  const [materiais, setMateriais] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState<MaterialTipo | 'todos'>('todos');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormMaterial>(formVazio);
  const [modoUpload, setModoUpload] = useState<'arquivo' | 'url'>('arquivo');
  const [uploading, setUploading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const inputFileRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}/materiais`);
      const json = await res.json();
      setMateriais(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  }, [grupoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const abrirNovo = () => {
    setForm(formVazio);
    setModoUpload('arquivo');
    setEditandoId(null);
    setSheetOpen(true);
  };

  const abrirEditar = (m: Material) => {
    setForm({
      tipo: m.tipo,
      nome: m.nome,
      url: m.url,
      descricao: m.descricao || '',
      visivel_para_passageiro: m.visivel_para_passageiro,
      tamanho_bytes: m.tamanho_bytes,
      extensao: m.extensao,
    });
    setModoUpload(m.tipo === 'link' ? 'url' : 'arquivo');
    setEditandoId(m.id);
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
        nome: f.nome || file.name,
        tamanho_bytes: item.tamanho || file.size,
        extensao: ext,
        // Auto-detecta tipo por extensão se ainda não foi escolhido manualmente
        tipo: f.tipo === 'roteiro' && ext ? autoTipoPorExt(ext) : f.tipo,
      }));
      toast.success('Arquivo enviado');
    } finally {
      setUploading(false);
    }
  };

  const salvar = async () => {
    if (!form.nome.trim()) { toast.error('Nome é obrigatório'); return; }
    if (!form.url.trim()) { toast.error('Anexe um arquivo ou informe uma URL'); return; }

    setSalvando(true);
    try {
      const url = editandoId
        ? `/api/gestao-grupos/${grupoId}/materiais/${editandoId}`
        : `/api/gestao-grupos/${grupoId}/materiais`;
      const method = editandoId ? 'PUT' : 'POST';
      const body = editandoId
        ? { nome: form.nome, descricao: form.descricao, visivel_para_passageiro: form.visivel_para_passageiro }
        : form;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Falha ao salvar');
        return;
      }
      toast.success(editandoId ? 'Material atualizado' : 'Material adicionado');
      setSheetOpen(false);
      setEditandoId(null);
      setForm(formVazio);
      await carregar();
      onChange();
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (id: string, nome: string) => {
    if (!confirm(`Remover "${nome}"? O registro fica oculto; o arquivo no servidor é preservado.`)) return;
    const res = await fetch(`/api/gestao-grupos/${grupoId}/materiais/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || 'Falha ao remover');
      return;
    }
    toast.success('Material removido');
    await carregar();
    onChange();
  };

  const copiarLink = async (url: string) => {
    const full = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    try {
      await navigator.clipboard.writeText(full);
      toast.success('Link copiado');
    } catch {
      toast.error('Falha ao copiar');
    }
  };

  const filtrados = filtroTipo === 'todos' ? materiais : materiais.filter(m => m.tipo === filtroTipo);
  const contPorTipo: Record<string, number> = {};
  for (const m of materiais) contPorTipo[m.tipo] = (contPorTipo[m.tipo] || 0) + 1;

  return (
    <div className="space-y-4">
      {/* Filtros + ação */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-stretch border" style={{ borderColor: 'var(--line)', height: '34px' }}>
          {(['todos', ...TIPOS.map(t => t.key)] as const).map((k, i, arr) => {
            const ativo = filtroTipo === k;
            const label = k === 'todos' ? `Todos (${materiais.length})` : `${TIPOS.find(t => t.key === k)?.label} (${contPorTipo[k] || 0})`;
            return (
              <button
                key={k}
                onClick={() => setFiltroTipo(k as MaterialTipo | 'todos')}
                className="px-3 text-[11px] transition-colors"
                style={{
                  color: ativo ? 'var(--ink)' : 'var(--ink-3)',
                  fontWeight: ativo ? 500 : 400,
                  background: ativo ? 'var(--ink-surface-2)' : 'transparent',
                  borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <button
          onClick={abrirNovo}
          className="ml-auto inline-flex items-center gap-1 h-[34px] px-4 text-[12px]"
          style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar material
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="border p-10 text-center" style={{ borderColor: 'var(--line)' }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--ink-3)' }} />
        </div>
      ) : filtrados.length === 0 ? (
        <div className="border p-10 text-center" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
          <FileText className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--ink-3)' }} />
          <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {filtroTipo === 'todos' ? 'Nenhum material adicionado ainda.' : `Nenhum material do tipo "${TIPOS.find(t => t.key === filtroTipo)?.label}".`}
          </p>
          <button onClick={abrirNovo} className="mt-3 inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--ink)' }}>
            <Plus className="w-3 h-3" /> Adicionar primeiro material
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtrados.map(m => {
            const Icon = ICONE_TIPO[m.tipo];
            const isExternal = !m.url.startsWith('/api/uploads/');
            return (
              <div key={m.id} className="border p-4 flex flex-col gap-2" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 flex items-center justify-center shrink-0" style={{ background: 'var(--ink-surface-2)' }}>
                    <Icon className="w-4 h-4" style={{ color: 'var(--ink-2)' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
                        {TIPOS.find(t => t.key === m.tipo)?.label || m.tipo}
                      </span>
                      {m.visivel_para_passageiro && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 uppercase tracking-wide" style={{ background: 'var(--ink-surface-2)', color: 'var(--pos)' }}>
                          <Eye className="w-2.5 h-2.5" /> Passageiro
                        </span>
                      )}
                    </div>
                    <h3 className="text-[13px] font-medium mt-0.5 break-words" style={{ color: 'var(--ink)' }}>{m.nome}</h3>
                    {m.descricao && <p className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>{m.descricao}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px] mono" style={{ color: 'var(--ink-3)' }}>
                  {m.extensao && <span className="uppercase">.{m.extensao}</span>}
                  {m.tamanho_bytes && <span>· {fmtBytes(m.tamanho_bytes)}</span>}
                  {m.created_at && <span>· {fmtDataHora(m.created_at)}</span>}
                </div>

                <div className="flex items-center gap-2 mt-1 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px]"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    {isExternal ? <LinkIcon className="w-3 h-3" /> : <Download className="w-3 h-3" />}
                    {isExternal ? 'Abrir' : 'Baixar'}
                  </a>
                  <button onClick={() => copiarLink(m.url)} className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--ink-2)' }}>
                    <Copy className="w-3 h-3" /> Copiar
                  </button>
                  <button onClick={() => abrirEditar(m)} className="text-[11px] ml-auto" style={{ color: 'var(--ink-2)' }} title="Editar">
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button onClick={() => remover(m.id, m.nome)} className="text-[11px]" style={{ color: 'var(--neg)' }} title="Remover">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sheet — Novo/Editar */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setSheetOpen(false)}>
          <div
            className="w-full max-w-md h-full overflow-y-auto p-6 space-y-4 shadow-2xl"
            style={{ background: 'var(--ink-bg)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
                {editandoId ? 'Editar material' : 'Novo material'}
              </h3>
              <button onClick={() => setSheetOpen(false)} style={{ color: 'var(--ink-3)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <Field label="Tipo">
              <select
                value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value as MaterialTipo }))}
                disabled={!!editandoId}
                className="w-full h-[34px] px-2 border text-[12px]"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              >
                {TIPOS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>

            <Field label="Nome">
              <input
                type="text"
                value={form.nome}
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Roteiro Paris 7 dias"
                className="w-full h-[34px] px-2 border text-[12px]"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              />
            </Field>

            <Field label="Descrição">
              <textarea
                rows={2}
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                className="w-full px-2 py-2 border text-[12px]"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              />
            </Field>

            {!editandoId && (
              <>
                <div className="flex items-stretch border" style={{ borderColor: 'var(--line)', height: '34px' }}>
                  {(['arquivo', 'url'] as const).map((m, i, arr) => {
                    const ativo = modoUpload === m;
                    return (
                      <button
                        key={m}
                        onClick={() => setModoUpload(m)}
                        className="flex-1 text-[12px] transition-colors"
                        style={{
                          color: ativo ? 'var(--ink)' : 'var(--ink-3)',
                          fontWeight: ativo ? 500 : 400,
                          background: ativo ? 'var(--ink-surface-2)' : 'transparent',
                          borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
                        }}
                      >
                        {m === 'arquivo' ? 'Upload de arquivo' : 'URL externa'}
                      </button>
                    );
                  })}
                </div>

                {modoUpload === 'arquivo' ? (
                  <div>
                    <input
                      ref={inputFileRef}
                      type="file"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) void handleFile(f);
                      }}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.zip,.txt,.csv"
                      className="hidden"
                    />
                    <button
                      onClick={() => inputFileRef.current?.click()}
                      disabled={uploading}
                      className="w-full inline-flex items-center justify-center gap-2 h-[80px] border-2 border-dashed text-[12px] disabled:opacity-50"
                      style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)', background: 'var(--ink-surface)' }}
                    >
                      {uploading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Enviando…</>
                      ) : form.url ? (
                        <><Check className="w-4 h-4" style={{ color: 'var(--pos)' }} /> {form.nome || 'Arquivo enviado'} {form.tamanho_bytes && `(${fmtBytes(form.tamanho_bytes)})`}</>
                      ) : (
                        <><Upload className="w-4 h-4" /> Clique pra escolher arquivo</>
                      )}
                    </button>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--ink-3)' }}>
                      Aceita PDF, Word, Excel, imagens, ZIP. Máx 25MB.
                    </p>
                  </div>
                ) : (
                  <Field label="URL externa">
                    <input
                      type="url"
                      value={form.url}
                      onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                      placeholder="https://drive.google.com/..."
                      className="w-full h-[34px] px-2 border text-[12px] mono"
                      style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
                    />
                  </Field>
                )}
              </>
            )}

            <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink-2)' }}>
              <input
                type="checkbox"
                checked={form.visivel_para_passageiro}
                onChange={e => setForm(f => ({ ...f, visivel_para_passageiro: e.target.checked }))}
              />
              Visível para o passageiro
            </label>
            <p className="text-[10px] -mt-2" style={{ color: 'var(--ink-3)' }}>
              Por enquanto a área do passageiro ainda não existe — o flag fica salvo pra quando for liberada.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={salvar}
                disabled={salvando || uploading}
                className="inline-flex items-center gap-1 h-[34px] px-4 text-[12px] disabled:opacity-50"
                style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
              >
                {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Salvar
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

function autoTipoPorExt(ext: string): MaterialTipo {
  const e = ext.toLowerCase();
  if (['pdf'].includes(e)) return 'roteiro';
  if (['doc', 'docx'].includes(e)) return 'contrato';
  return 'arquivo';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wide block mb-1" style={{ color: 'var(--ink-3)' }}>{label}</label>
      {children}
    </div>
  );
}
