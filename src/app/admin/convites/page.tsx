'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Plus, Copy, ExternalLink, Check, Users as UsersIcon,
  Trash2, Calendar, Tag as TagIcon,
} from 'lucide-react';

interface Plano { slug: string; nome: string; }

interface Convite {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  plano_slug: string;
  duracao_dias: number;
  max_usos: number | null;
  usos_atuais: number;
  expira_em: string | null;
  ativo: boolean;
  tag: string;
  created_at: string;
  updated_at: string;
}

export default function AdminConvitesPage() {
  const [convites, setConvites] = useState<Convite[]>([]);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = () => {
    Promise.all([
      fetch('/api/admin/convites').then(r => r.json()),
      fetch('/api/admin/planos').then(r => r.json()),
    ]).then(([cv, pl]) => {
      if (Array.isArray(cv)) setConvites(cv);
      if (Array.isArray(pl)) setPlanos(pl.filter(p => p.ativo !== false));
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(carregar, []);

  const copiar = async (convite: Convite) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/signup?convite=${convite.codigo}`;
    await navigator.clipboard.writeText(url);
    setCopiado(convite.codigo);
    setTimeout(() => setCopiado(null), 2000);
  };

  const desativar = async (c: Convite) => {
    if (!confirm(`Desativar convite "${c.nome}"? Quem já usou continua com acesso; o link novo deixa de funcionar.`)) return;
    await fetch(`/api/admin/convites/${c.id}`, { method: 'DELETE' });
    carregar();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--fin-text-3)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fin-text)]">Convites</h1>
          <p className="text-sm text-[var(--fin-text-2)] mt-1">
            Links rastreáveis que dão acesso por tempo definido. Use para campanhas (Clube de IA, parceiros, alunos).
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--fin-surface)] text-[var(--fin-text)] text-sm font-semibold hover:bg-[var(--fin-surface-2)]"
        >
          <Plus className="w-4 h-4" /> Novo convite
        </button>
      </div>

      {showCreate && (
        <ModalCriarConvite
          planos={planos}
          onClose={() => setShowCreate(false)}
          onCriado={() => { setShowCreate(false); carregar(); }}
        />
      )}

      {convites.length === 0 ? (
        <div className="bg-[var(--fin-surface)] rounded-2xl border-2 border-dashed border-[var(--fin-border)] p-12 text-center shadow-[var(--fin-e-card)]">
          <UsersIcon className="w-10 h-10 text-[var(--fin-text-3)] mx-auto mb-3" />
          <p className="text-[var(--fin-text-2)]">Nenhum convite criado.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--fin-accent)] hover:text-[var(--fin-accent)]"
          >
            <Plus className="w-4 h-4" /> Criar o primeiro convite
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {convites.map(c => {
            const esgotado = c.max_usos != null && c.usos_atuais >= c.max_usos;
            const expirado = c.expira_em ? new Date(c.expira_em) < new Date() : false;
            const valido = c.ativo && !esgotado && !expirado;
            return (
              <div key={c.id} className={`rounded-2xl border bg-[var(--fin-surface)] p-5 ${valido ? 'border-[var(--fin-border)]' : 'border-[var(--fin-border)] opacity-70'} shadow-[var(--fin-e-card)]`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold text-[var(--fin-text)]">{c.nome}</h3>
                      {!c.ativo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] font-bold uppercase">Inativo</span>}
                      {esgotado && c.ativo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)] font-bold uppercase">Esgotado</span>}
                      {expirado && c.ativo && !esgotado && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)] font-bold uppercase">Expirado</span>}
                      {valido && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--fin-positive-soft)] text-[var(--fin-positive)] font-bold uppercase">Válido</span>}
                    </div>
                    {c.descricao && <p className="text-sm text-[var(--fin-text-2)] mb-2">{c.descricao}</p>}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--fin-text-3)]">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {c.duracao_dias} dias de acesso
                      </span>
                      <span>·</span>
                      <span>Plano <strong className="text-[var(--fin-text-2)]">{planos.find(p => p.slug === c.plano_slug)?.nome || c.plano_slug}</strong></span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon className="w-3 h-3" />
                        <strong className="text-[var(--fin-text-2)]">{c.usos_atuais}</strong>
                        {c.max_usos != null && ` / ${c.max_usos}`} usos
                      </span>
                      {c.tag && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            <TagIcon className="w-3 h-3" /> {c.tag}
                          </span>
                        </>
                      )}
                      {c.expira_em && (
                        <>
                          <span>·</span>
                          <span>expira em {new Date(c.expira_em).toLocaleDateString('pt-BR')}</span>
                        </>
                      )}
                    </div>

                    {/* URL */}
                    <div className="mt-3 flex items-center gap-2 bg-[var(--fin-surface-2)] border border-[var(--fin-border)] rounded-lg px-3 py-2">
                      <code className="text-xs text-[var(--fin-text-2)] flex-1 truncate font-mono">
                        {typeof window !== 'undefined' ? window.location.origin : ''}/signup?convite={c.codigo}
                      </code>
                      <button
                        onClick={() => copiar(c)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-[var(--fin-accent)] hover:bg-[var(--fin-accent-soft)]"
                      >
                        {copiado === c.codigo
                          ? <><Check className="w-3 h-3 text-[var(--fin-positive)]" /> Copiado</>
                          : <><Copy className="w-3 h-3" /> Copiar</>
                        }
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Link
                      href={`/admin/convites/${c.id}`}
                      className="text-[11px] font-semibold text-[var(--fin-accent)] hover:text-[var(--fin-accent)] inline-flex items-center gap-0.5"
                    >
                      Ver usos <ExternalLink className="w-3 h-3" />
                    </Link>
                    <button
                      onClick={() => desativar(c)}
                      className="p-1.5 rounded-lg text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)]"
                      title="Desativar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Modal de criação
// ============================================================

function ModalCriarConvite({
  planos, onClose, onCriado,
}: {
  planos: Plano[];
  onClose: () => void;
  onCriado: () => void;
}) {
  const [form, setForm] = useState({
    nome: '', descricao: '',
    plano_slug: planos[0]?.slug || '',
    duracao_dias: 365,
    max_usos: '',
    expira_em: '',
    tag: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!form.nome.trim()) { setError('Nome obrigatório'); return; }
    if (!form.plano_slug) { setError('Selecione um plano'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/convites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome.trim(),
          descricao: form.descricao.trim(),
          plano_slug: form.plano_slug,
          duracao_dias: Number(form.duracao_dias) || 365,
          max_usos: form.max_usos ? Number(form.max_usos) : null,
          expira_em: form.expira_em ? new Date(form.expira_em + 'T23:59:59').toISOString() : null,
          tag: form.tag.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      onCriado();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--fin-surface)] rounded-2xl shadow-2xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-[var(--fin-text)] mb-1">Novo convite</h2>
        <p className="text-sm text-[var(--fin-text-2)] mb-5">
          Link rastreável dando acesso por tempo definido. Ideal para campanhas ou parceiros.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--fin-text-2)] mb-1">
              Nome da campanha *
            </label>
            <input
              type="text" value={form.nome}
              onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              placeholder="Ex: Alunos Clube de IA"
              className="w-full px-3 py-2 border border-[var(--fin-border)] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--fin-text-2)] mb-1">
              Descrição (interna)
            </label>
            <input
              type="text" value={form.descricao}
              onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
              placeholder="Aparece pro convidado durante o signup"
              className="w-full px-3 py-2 border border-[var(--fin-border)] rounded-lg text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--fin-text-2)] mb-1">
                Plano *
              </label>
              <select
                value={form.plano_slug}
                onChange={e => setForm(f => ({ ...f, plano_slug: e.target.value }))}
                className="w-full px-3 py-2 border border-[var(--fin-border)] rounded-lg text-sm bg-[var(--fin-surface)]"
              >
                {planos.map(p => (
                  <option key={p.slug} value={p.slug}>{p.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--fin-text-2)] mb-1">
                Duração (dias) *
              </label>
              <input
                type="number" min={1}
                value={form.duracao_dias}
                onChange={e => setForm(f => ({ ...f, duracao_dias: Number(e.target.value) || 365 }))}
                className="w-full px-3 py-2 border border-[var(--fin-border)] rounded-lg text-sm"
              />
              <p className="text-[10px] text-[var(--fin-text-3)] mt-1">365 = 1 ano</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--fin-text-2)] mb-1">
                Máx. usos (opcional)
              </label>
              <input
                type="number" min={1}
                value={form.max_usos}
                onChange={e => setForm(f => ({ ...f, max_usos: e.target.value }))}
                placeholder="ilimitado"
                className="w-full px-3 py-2 border border-[var(--fin-border)] rounded-lg text-sm"
              />
              <p className="text-[10px] text-[var(--fin-text-3)] mt-1">Vazio = ilimitado</p>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--fin-text-2)] mb-1">
                Link expira em (opcional)
              </label>
              <input
                type="date"
                value={form.expira_em}
                onChange={e => setForm(f => ({ ...f, expira_em: e.target.value }))}
                className="w-full px-3 py-2 border border-[var(--fin-border)] rounded-lg text-sm"
              />
              <p className="text-[10px] text-[var(--fin-text-3)] mt-1">Vazio = sem expiração</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--fin-text-2)] mb-1">
              Tag (opcional)
            </label>
            <input
              type="text" value={form.tag}
              onChange={e => setForm(f => ({ ...f, tag: e.target.value }))}
              placeholder="Ex: clube-ia, parceria-xyz"
              className="w-full px-3 py-2 border border-[var(--fin-border)] rounded-lg text-sm"
            />
            <p className="text-[10px] text-[var(--fin-text-3)] mt-1">Usado pra agrupar convites em relatórios</p>
          </div>

          {error && (
            <div className="text-sm text-[var(--fin-negative-text)] bg-[var(--fin-negative-soft)] border border-[var(--fin-negative)]/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--fin-border)]">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3 py-2 text-sm text-[var(--fin-text-2)] hover:text-[var(--fin-text)]"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] text-sm font-semibold hover:bg-[var(--fin-accent-hover)] disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar convite
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
