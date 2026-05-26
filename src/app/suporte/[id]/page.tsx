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

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (error || !ticket) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <button onClick={() => router.push('/suporte')} className="text-sm text-slate-500 hover:text-slate-900 mb-3">
          ← Voltar
        </button>
        <p className="text-slate-600">{error || 'Não encontrado'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/suporte" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar pra lista
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
        <div className="flex items-start gap-3 mb-2">
          <CategoriaIcon categoria={ticket.categoria} />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900">{ticket.titulo}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-[12px] text-slate-500">
              <span className="font-mono">{ticket.numero}</span>
              <span>•</span>
              <span>Aberto por {ticket.created_by_nome}</span>
              <span>•</span>
              <span>{new Date(ticket.created_at).toLocaleString('pt-BR')}</span>
            </div>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
        <p className="text-sm text-slate-700 whitespace-pre-wrap mt-3">{ticket.descricao}</p>
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
          <div className="text-center text-sm text-slate-400 py-6">Sem respostas ainda</div>
        )}
      </div>

      {/* Resposta */}
      {ticket.status !== 'fechado' && (
        <ReplyBox ticketId={ticket.id} onSent={load} />
      )}
      {ticket.status === 'fechado' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-sm text-slate-500">
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
    <div className="bg-white rounded-xl border border-slate-200 p-3">
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
            <li key={i} className="flex items-center gap-2 text-xs bg-slate-50 rounded px-2 py-1">
              <Paperclip className="w-3 h-3 text-slate-500" />
              <span className="flex-1 truncate">{a.nome}</span>
              <button onClick={() => setAnexos(anexos.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
        <button
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60"
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
        isAdmin ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
      }`}>
        {isAdmin ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
      </div>
      <div className={`max-w-[80%] flex-1`}>
        <div className={`flex items-center gap-2 mb-1 text-[11px] text-slate-500 ${isAdmin ? '' : 'justify-end'}`}>
          <span className="font-semibold">{m.from_nome}</span>
          {isAdmin && <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold">SUPORTE</span>}
          <span>•</span>
          <span>{new Date(m.created_at).toLocaleString('pt-BR')}</span>
        </div>
        <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
          isAdmin ? 'bg-emerald-50 text-slate-800' : 'bg-blue-50 text-slate-800'
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
            className="flex items-center gap-2 p-2 rounded-md bg-white/60 border border-slate-200 hover:border-blue-300 hover:bg-white transition-colors"
          >
            {isImg ? (
              <ImageIcon className="w-4 h-4 text-blue-500 shrink-0" />
            ) : (
              <Paperclip className="w-4 h-4 text-slate-500 shrink-0" />
            )}
            <span className="text-xs truncate text-slate-700">{a.nome}</span>
          </a>
        );
      })}
    </div>
  );
}

function CategoriaIcon({ categoria }: { categoria: string }) {
  const cfg: Record<string, { Icon: React.ComponentType<{ className?: string }>; bg: string }> = {
    bug: { Icon: Bug, bg: 'bg-red-50 text-red-600' },
    duvida: { Icon: HelpCircle, bg: 'bg-blue-50 text-blue-600' },
    sugestao: { Icon: Lightbulb, bg: 'bg-amber-50 text-amber-600' },
    outro: { Icon: Circle, bg: 'bg-slate-100 text-slate-500' },
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
    aberto: { Icon: Circle, bg: 'bg-blue-50', text: 'text-blue-700', label: 'Aberto' },
    em_andamento: { Icon: Clock, bg: 'bg-amber-50', text: 'text-amber-700', label: 'Em andamento' },
    aguardando_usuario: { Icon: AlertCircle, bg: 'bg-purple-50', text: 'text-purple-700', label: 'Aguardando você' },
    resolvido: { Icon: CheckCircle2, bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Resolvido' },
    fechado: { Icon: CheckCircle2, bg: 'bg-slate-100', text: 'text-slate-600', label: 'Fechado' },
  };
  const c = cfg[status] || cfg.aberto;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold ${c.bg} ${c.text}`}>
      <c.Icon className="w-3 h-3" /> {c.label}
    </span>
  );
}
