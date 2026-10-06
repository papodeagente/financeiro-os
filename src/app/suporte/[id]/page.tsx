'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, Send, Paperclip, X, Bug, HelpCircle, Lightbulb, Circle,
  CheckCircle2, Clock, AlertCircle, Shield, User as UserIcon, Image as ImageIcon,
} from 'lucide-react';

interface Ticket {
  id: string; numero: string; titulo: string; descricao: string;
  status: string; prioridade: string; categoria: string;
  created_by_nome: string; created_by_email: string;
  url_origem?: string; anexos: { url: string; nome: string }[];
  created_at: string; updated_at: string;
}
interface Mensagem {
  id: string; from_type: 'user' | 'super_admin'; from_nome: string;
  mensagem: string; anexos: { url: string; nome: string }[]; created_at: string;
}

export default function TicketPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/support/tickets/${id}`)
      .then(async r => {
        if (r.status === 404) { setError('Ticket não encontrado'); return null; }
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then(d => { if (d) { setTicket(d.ticket); setMsgs(d.mensagens || []); } })
      .catch(e => setError(e instanceof Error ? e.message : 'Erro'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[var(--fin-text-3)]" /></div>;
  if (error || !ticket) {
    return (
      <div className="mx-auto w-full max-w-2xl px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
        <button onClick={() => router.push('/suporte')} className="text-sm text-[var(--fin-text-3)] hover:text-[var(--fin-text)] mb-3">
          ← Voltar
        </button>
        <p className="text-[var(--fin-text-2)]">{error || 'Não encontrado'}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <Link href="/suporte" className="inline-flex items-center gap-1 text-sm text-[var(--fin-text-3)] hover:text-[var(--fin-text)] mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar pra lista
      </Link>

      <div className="bg-[var(--fin-surface)] rounded-2xl border border-[var(--fin-border)] p-5 mb-4 shadow-[var(--fin-e-card)]">
        <div className="flex items-start gap-3 mb-2">
          <CategoriaIcon categoria={ticket.categoria} />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-[var(--fin-text)]">{ticket.titulo}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-[12px] text-[var(--fin-text-3)]">
              <span className="font-mono">{ticket.numero}</span>
              <span>•</span>
              <span>Aberto por {ticket.created_by_nome}</span>
              <span>•</span>
              <span>{new Date(ticket.created_at).toLocaleString('pt-BR')}</span>
            </div>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
        <p className="text-sm text-[var(--fin-text-2)] whitespace-pre-wrap mt-3">{ticket.descricao}</p>
        {Array.isArray(ticket.anexos) && ticket.anexos.length > 0 && (
          <AnexosList anexos={ticket.anexos} />
        )}
      </div>

      {/* Thread */}
      <div className="space-y-3 mb-4">
        {msgs.map(m => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {msgs.length === 0 && (
          <div className="text-center text-sm text-[var(--fin-text-3)] py-6">Sem respostas ainda</div>
        )}
      </div>

      {/* Resposta */}
      {ticket.status !== 'fechado' && (
        <ReplyBox ticketId={ticket.id} onSent={load} />
      )}
      {ticket.status === 'fechado' && (
        <div className="bg-[var(--fin-surface-2)] border border-[var(--fin-border)] rounded-xl p-4 text-center text-sm text-[var(--fin-text-3)]">
          Este ticket foi fechado. Abra um novo se precisar de mais ajuda.
        </div>
      )}
    </div>
  );
}

function ReplyBox({ ticketId, onSent }: { ticketId: string; onSent: () => void }) {
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<{ url: string; nome: string; tamanho: number }[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Erro no upload');
        return;
      }
      const data = await res.json();
      setAnexos(prev => [...prev, ...data]);
    } finally { setUploading(false); }
  };

  const send = async () => {
    if (!texto.trim() && anexos.length === 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem: texto, anexos }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Erro ao enviar');
        return;
      }
      setTexto('');
      setAnexos([]);
      onSent();
    } finally { setSending(false); }
  };

  return (
    <div className="bg-[var(--fin-surface)] rounded-xl border border-[var(--fin-border)] p-3 shadow-[var(--fin-e-card)]">
      <textarea
        value={texto}
        onChange={e => setTexto(e.target.value)}
        placeholder="Escreva sua resposta..."
        rows={3}
        className="w-full text-sm bg-transparent outline-none resize-none"
      />
      {anexos.length > 0 && (
        <ul className="space-y-1 mt-2">
          {anexos.map((a, i) => (
            <li key={i} className="flex items-center gap-2 text-xs bg-[var(--fin-surface-2)] rounded px-2 py-1">
              <Paperclip className="w-3 h-3 text-[var(--fin-text-3)]" />
              <span className="flex-1 truncate">{a.nome}</span>
              <button onClick={() => setAnexos(anexos.filter((_, j) => j !== i))} className="text-[var(--fin-negative-text)] hover:text-[var(--fin-negative-text)]">
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--fin-border)]">
        <button
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1 text-xs text-[var(--fin-text-2)] hover:text-[var(--fin-text)]"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
          Anexar
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          className="hidden"
          onChange={e => { upload(e.target.files); e.target.value = ''; }}
        />
        <button
          onClick={send}
          disabled={sending || (!texto.trim() && anexos.length === 0)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] text-xs font-semibold hover:bg-[var(--fin-accent-hover)] disabled:opacity-60"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Enviar
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: Mensagem }) {
  const isAdmin = m.from_type === 'super_admin';
  return (
    <div className={`flex gap-2 ${isAdmin ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
 isAdmin ? 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]' : 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]'
 }`}>
        {isAdmin ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
      </div>
      <div className={`max-w-[80%] flex-1`}>
        <div className={`flex items-center gap-2 mb-1 text-[11px] text-[var(--fin-text-3)] ${isAdmin ? '' : 'justify-end'}`}>
          <span className="font-semibold">{m.from_nome}</span>
          {isAdmin && <span className="px-1.5 py-0.5 rounded bg-[var(--fin-positive-soft)] text-[var(--fin-positive)] text-[10px] font-semibold">SUPORTE</span>}
          <span>•</span>
          <span>{new Date(m.created_at).toLocaleString('pt-BR')}</span>
        </div>
        <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
 isAdmin ? 'bg-[var(--fin-positive-soft)] text-[var(--fin-text)]' : 'bg-[var(--fin-accent-soft)] text-[var(--fin-text)]'
 }`}>
          {m.mensagem}
          {Array.isArray(m.anexos) && m.anexos.length > 0 && (
            <AnexosList anexos={m.anexos} />
          )}
        </div>
      </div>
    </div>
  );
}

function AnexosList({ anexos }: { anexos: { url: string; nome: string }[] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {anexos.map((a, i) => {
        const isImg = /\.(jpe?g|png|webp|gif|avif)$/i.test(a.nome);
        return (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 rounded-md bg-[var(--fin-surface)]/60 border border-[var(--fin-border)] hover:border-[var(--fin-accent)]/30 hover:bg-[var(--fin-surface)] transition-colors"
          >
            {isImg ? (
              <ImageIcon className="w-4 h-4 text-[var(--fin-accent)] shrink-0" />
            ) : (
              <Paperclip className="w-4 h-4 text-[var(--fin-text-3)] shrink-0" />
            )}
            <span className="text-xs truncate text-[var(--fin-text-2)]">{a.nome}</span>
          </a>
        );
      })}
    </div>
  );
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
    <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${c.bg}`}>
      <c.Icon className="w-5 h-5" />
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { Icon: React.ComponentType<{ className?: string }>; bg: string; text: string; label: string }> = {
    aberto: { Icon: Circle, bg: 'bg-[var(--fin-accent-soft)]', text: 'text-[var(--fin-accent)]', label: 'Aberto' },
    em_andamento: { Icon: Clock, bg: 'bg-[var(--fin-warning-soft)]', text: 'text-[var(--fin-warning-text)]', label: 'Em andamento' },
    aguardando_usuario: { Icon: AlertCircle, bg: 'bg-[var(--fin-violet-soft)]', text: 'text-[var(--fin-violet)]', label: 'Aguardando você' },
    resolvido: { Icon: CheckCircle2, bg: 'bg-[var(--fin-positive-soft)]', text: 'text-[var(--fin-positive)]', label: 'Resolvido' },
    fechado: { Icon: CheckCircle2, bg: 'bg-[var(--fin-surface-2)]', text: 'text-[var(--fin-text-2)]', label: 'Fechado' },
  };
  const c = cfg[status] || cfg.aberto;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold ${c.bg} ${c.text}`}>
      <c.Icon className="w-3 h-3" /> {c.label}
    </span>
  );
}
