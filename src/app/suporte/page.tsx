'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2, Plus, MessageSquare, Bug, HelpCircle, Lightbulb,
  Upload, X, AlertCircle, CheckCircle2, Clock, Circle, ArrowRight,
} from 'lucide-react';

interface Ticket {
  id: string;
  numero: string;
  titulo: string;
  status: string;
  prioridade: string;
  categoria: string;
  created_by_nome: string;
  mensagens_count: number;
  tem_resposta_admin: boolean;
  tem_nao_lida_usuario: boolean;
  created_at: string;
  updated_at: string;
  ultima_msg_at: string | null;
}

export default function SuportePage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    fetch('/api/support/tickets')
      .then(r => r.json())
      .then((d) => { setTickets(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fin-text)] flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[var(--fin-accent)]" />
            Suporte
          </h1>
          <p className="text-sm text-[var(--fin-text-2)] mt-1">
            Reporte bugs, tire dúvidas ou envie sugestões. Acompanhe as respostas aqui.
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] text-sm font-semibold hover:bg-[var(--fin-accent-hover)]"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancelar' : 'Novo ticket'}
        </button>
      </div>

      {showForm && (
        <FormNovoTicket
          onCreated={(id) => {
            setShowForm(false);
            load();
            router.push(`/suporte/${id}`);
          }}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-[var(--fin-text-3)]" /></div>
      ) : tickets.length === 0 ? (
        <div className="bg-[var(--fin-surface)] rounded-2xl border-2 border-dashed border-[var(--fin-border)] p-12 text-center shadow-[var(--fin-e-card)]">
          <div className="w-12 h-12 rounded-2xl bg-[var(--fin-accent-soft)] flex items-center justify-center mx-auto mb-3">
            <MessageSquare className="w-6 h-6 text-[var(--fin-accent)]" />
          </div>
          <h3 className="font-semibold text-[var(--fin-text)] mb-1">Nenhum ticket ainda</h3>
          <p className="text-sm text-[var(--fin-text-3)] max-w-sm mx-auto mb-5">
            Encontrou um bug? Tem uma dúvida? Abra um ticket e nosso time responde aqui.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--fin-text)] text-[var(--fin-text-on-fill)] text-sm font-semibold hover:bg-[var(--fin-text)]"
          >
            <Plus className="w-4 h-4" /> Abrir primeiro ticket
          </button>
        </div>
      ) : (
        <div className="bg-[var(--fin-surface)] rounded-xl border border-[var(--fin-border)] overflow-hidden shadow-[var(--fin-e-card)]">
          <ul className="divide-y divide-[var(--fin-border)]">
            {tickets.map(t => (
              <li key={t.id}>
                <Link
                  href={`/suporte/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--fin-surface-2)] transition-colors"
                >
                  <StatusIcon status={t.status} />
                  <CategoriaIcon categoria={t.categoria} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[var(--fin-text)] truncate">{t.titulo}</span>
                      <span className="text-[10px] font-mono text-[var(--fin-text-3)]">{t.numero}</span>
                      {t.tem_nao_lida_usuario && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]">
                          NOVA RESPOSTA
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--fin-text-3)] mt-0.5">
                      {t.mensagens_count} {t.mensagens_count === 1 ? 'mensagem' : 'mensagens'} ·{' '}
                      Atualizado em {new Date(t.ultima_msg_at || t.updated_at).toLocaleDateString('pt-BR')}{' '}
                      {new Date(t.ultima_msg_at || t.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <PrioridadeBadge prioridade={t.prioridade} />
                  <ArrowRight className="w-4 h-4 text-[var(--fin-text-3)]" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============ Form de novo ticket ============
function FormNovoTicket({ onCreated }: { onCreated: (id: string) => void }) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState<'bug' | 'duvida' | 'sugestao' | 'outro'>('bug');
  const [prioridade, setPrioridade] = useState<'baixa' | 'normal' | 'alta' | 'urgente'>('normal');
  const [anexos, setAnexos] = useState<{ url: string; nome: string; tamanho: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!titulo.trim() || !descricao.trim()) {
      setError('Preencha título e descrição.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo,
          descricao,
          categoria,
          prioridade,
          anexos,
          url_origem: typeof window !== 'undefined' ? window.location.href : '',
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro ao criar');
      onCreated(d.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[var(--fin-surface)] rounded-2xl border border-[var(--fin-border)] p-5 mb-6 shadow-[var(--fin-e-card)]">
      <h2 className="font-bold text-[var(--fin-text)] mb-4">Novo ticket</h2>

      {error && (
        <div className="mb-3 p-3 bg-[var(--fin-warning-soft)] border border-[var(--fin-warning)]/30 rounded-md text-sm text-[var(--fin-warning-text)]">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase text-[var(--fin-text-3)]">Categoria</span>
            <div className="mt-1.5 grid grid-cols-4 gap-1">
              {([
                { id: 'bug', label: 'Bug', Icon: Bug },
                { id: 'duvida', label: 'Dúvida', Icon: HelpCircle },
                { id: 'sugestao', label: 'Ideia', Icon: Lightbulb },
                { id: 'outro', label: 'Outro', Icon: Circle },
              ] as const).map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoria(c.id)}
                  className={`flex flex-col items-center gap-1 py-2 rounded-md border text-[11px] transition-colors ${
 categoria === c.id
 ? 'border-[var(--fin-accent)]/30 bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]'
 : 'border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]'
 }`}
                >
                  <c.Icon className="w-3.5 h-3.5" />
                  {c.label}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase text-[var(--fin-text-3)]">Prioridade</span>
            <select
              value={prioridade}
              onChange={e => setPrioridade(e.target.value as typeof prioridade)}
              className="mt-1.5 w-full px-3 py-2 rounded-md border border-[var(--fin-border)] text-sm outline-none focus:border-[var(--fin-accent)]"
            >
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-[var(--fin-text-3)]">Título</span>
          <input
            type="text"
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Ex.: Botão de salvar não funciona em /grupos"
            maxLength={200}
            className="mt-1.5 w-full px-3 py-2 rounded-md border border-[var(--fin-border)] text-sm outline-none focus:border-[var(--fin-accent)]"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-[var(--fin-text-3)]">Descrição</span>
          <textarea
            value={descricao}
            onChange={e => setDescricao(e.target.value)}
            placeholder="Descreva o problema. Inclua passos pra reproduzir, o que esperava, e o que aconteceu."
            rows={5}
            className="mt-1.5 w-full px-3 py-2 rounded-md border border-[var(--fin-border)] text-sm outline-none focus:border-[var(--fin-accent)] resize-y"
          />
        </label>

        <div>
          <span className="text-[11px] font-semibold uppercase text-[var(--fin-text-3)]">Anexos (prints, arquivos)</span>
          <div className="mt-1.5">
            <UploadField anexos={anexos} onChange={setAnexos} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] text-sm font-semibold hover:bg-[var(--fin-accent-hover)] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Abrir ticket
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Componente reutilizado de upload ============
export function UploadField({
  anexos, onChange,
}: {
  anexos: { url: string; nome: string; tamanho: number }[];
  onChange: (next: { url: string; nome: string; tamanho: number }[]) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const handle = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      onChange([...anexos, ...data]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] hover:bg-[var(--fin-surface-2)] text-xs font-medium cursor-pointer">
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {uploading ? 'Enviando...' : 'Enviar arquivo'}
        <input
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          className="hidden"
          onChange={e => { handle(e.target.files); e.target.value = ''; }}
        />
      </label>
      {anexos.length > 0 && (
        <ul className="mt-2 space-y-1">
          {anexos.map((a, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-[var(--fin-text-2)] bg-[var(--fin-surface-2)] rounded px-2 py-1">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:text-[var(--fin-accent)]">
                {a.nome}
              </a>
              <button
                onClick={() => onChange(anexos.filter((_, j) => j !== i))}
                className="text-[var(--fin-negative-text)] hover:text-[var(--fin-negative-text)]"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============ Helpers visuais ============
function StatusIcon({ status }: { status: string }) {
  const cfg: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
    aberto: { Icon: Circle, color: 'text-[var(--fin-accent)]', label: 'Aberto' },
    em_andamento: { Icon: Clock, color: 'text-[var(--fin-warning-text)]', label: 'Em andamento' },
    aguardando_usuario: { Icon: AlertCircle, color: 'text-[var(--fin-violet)]', label: 'Aguardando você' },
    resolvido: { Icon: CheckCircle2, color: 'text-[var(--fin-positive)]', label: 'Resolvido' },
    fechado: { Icon: CheckCircle2, color: 'text-[var(--fin-text-3)]', label: 'Fechado' },
  };
  const c = cfg[status] || cfg.aberto;
  return <c.Icon className={`w-4 h-4 ${c.color}`} aria-label={c.label} />;
}

function CategoriaIcon({ categoria }: { categoria: string }) {
  const cfg: Record<string, { Icon: React.ComponentType<{ className?: string }>; bg: string }> = {
    bug: { Icon: Bug, bg: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]' },
    duvida: { Icon: HelpCircle, bg: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]' },
    sugestao: { Icon: Lightbulb, bg: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]' },
    outro: { Icon: Circle, bg: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-3)]' },
  };
  const c = cfg[categoria] || cfg.outro;
  return (
    <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${c.bg}`}>
      <c.Icon className="w-3.5 h-3.5" />
    </span>
  );
}

function PrioridadeBadge({ prioridade }: { prioridade: string }) {
  if (prioridade === 'normal' || !prioridade) return null;
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    baixa: { bg: 'bg-[var(--fin-surface-2)]', text: 'text-[var(--fin-text-2)]', label: 'Baixa' },
    alta: { bg: 'bg-[var(--fin-warning-soft)]', text: 'text-[var(--fin-warning-text)]', label: 'Alta' },
    urgente: { bg: 'bg-[var(--fin-negative-soft)]', text: 'text-[var(--fin-negative-text)]', label: 'Urgente' },
  };
  const c = cfg[prioridade];
  if (!c) return null;
  return (
    <span className={`hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
