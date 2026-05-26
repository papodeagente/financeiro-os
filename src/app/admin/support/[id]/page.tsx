'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Loader2, Send, Paperclip, X, Bug, HelpCircle, Lightbulb, Circle,
  CheckCircle2, Clock, AlertCircle, Shield, User as UserIcon, Image as ImageIcon,
} from 'lucide-react';

interface AdminTicket {
  id: string; numero: string; titulo: string; descricao: string;
  status: string; prioridade: string; categoria: string;
  tenant_id: string; tenant_nome: string | null;
  created_by_nome: string; created_by_email: string;
  url_origem?: string; user_agent?: string;
  anexos: { url: string; nome: string }[];
  created_at: string; updated_at: string;
}
interface Mensagem {
  id: string; from_type: 'user' | 'super_admin'; from_nome: string;
  mensagem: string; anexos: { url: string; nome: string }[]; created_at: string;
}

const STATUS = ['aberto', 'em_andamento', 'aguardando_usuario', 'resolvido', 'fechado'];
const PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente'];

export default function AdminTicketPage() {
  const params = useParams();
  const id = params?.id as string;
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/support/tickets/${id}`)
      .then(async r => {
        if (r.status === 404) { setError('Não encontrado'); return null; }
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then(d => { if (d) { setTicket(d.ticket); setMsgs(d.mensagens || []); } })
      .catch(e => setError(e instanceof Error ? e.message : 'Erro'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateField = async (patch: { status?: string; prioridade?: string }) => {
    const res = await fetch(`/api/admin/support/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>;
  if (error || !ticket) {
    return (
      <div>
        <Link href="/admin/support" className="text-sm text-gray-400 hover:text-gray-100">← Voltar</Link>
        <p className="text-gray-400 mt-4">{error || 'Não encontrado'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <Link href="/admin/support" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-100 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Tickets
      </Link>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4">
        <div className="flex items-start gap-3 mb-2">
          <CategoriaIcon categoria={ticket.categoria} />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-100">{ticket.titulo}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-[12px] text-gray-400">
              <span className="font-mono">{ticket.numero}</span>
              <span>•</span>
              <span className="text-[#d4a853]">{ticket.tenant_nome || ticket.tenant_id}</span>
              <span>•</span>
              <span>{ticket.created_by_nome} ({ticket.created_by_email})</span>
              <span>•</span>
              <span>{new Date(ticket.created_at).toLocaleString('pt-BR')}</span>
            </div>
          </div>
        </div>

        <p className="text-sm text-gray-200 whitespace-pre-wrap mt-3">{ticket.descricao}</p>

        {Array.isArray(ticket.anexos) && ticket.anexos.length > 0 && (
          <AnexosList anexos={ticket.anexos} dark />
        )}

        {(ticket.url_origem || ticket.user_agent) && (
          <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-1 gap-1 text-[11px] text-gray-500">
            {ticket.url_origem && <div><strong>URL:</strong> <span className="font-mono">{ticket.url_origem}</span></div>}
            {ticket.user_agent && <div><strong>Browser:</strong> <span className="font-mono break-all">{ticket.user_agent}</span></div>}
          </div>
        )}

        {/* Controles admin */}
        <div className="mt-4 pt-4 border-t border-gray-800 flex flex-wrap items-center gap-3">
          <div>
            <label className="text-[10px] uppercase text-gray-500 block mb-1">Status</label>
            <select
              value={ticket.status}
              onChange={e => updateField({ status: e.target.value })}
              className="px-2.5 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-sm text-gray-100 outline-none"
            >
              {STATUS.map(s => <option key={s} value={s}>{labelStatus(s)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-gray-500 block mb-1">Prioridade</label>
            <select
              value={ticket.prioridade}
              onChange={e => updateField({ prioridade: e.target.value })}
              className="px-2.5 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-sm text-gray-100 outline-none"
            >
              {PRIORIDADES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Thread */}
      <div className="space-y-3 mb-4">
        {msgs.map(m => <MessageBubble key={m.id} m={m} />)}
        {msgs.length === 0 && <div className="text-center text-sm text-gray-500 py-6">Sem respostas ainda</div>}
      </div>

      {/* Reply */}
      <ReplyBox ticketId={ticket.id} onSent={load} />
    </div>
  );
}

function labelStatus(s: string): string {
  switch (s) {
    case 'aberto': return 'Aberto';
    case 'em_andamento': return 'Em andamento';
    case 'aguardando_usuario': return 'Aguardando usuário';
    case 'resolvido': return 'Resolvido';
    case 'fechado': return 'Fechado';
    default: return s;
  }
}

function ReplyBox({ ticketId, onSent }: { ticketId: string; onSent: () => void }) {
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<{ url: string; nome: string; tamanho: number }[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusAtSend, setStatusAtSend] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) { alert('Erro no upload'); return; }
      const data = await res.json();
      setAnexos(prev => [...prev, ...data]);
    } finally { setUploading(false); }
  };

  const send = async () => {
    if (!texto.trim() && anexos.length === 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem: texto, anexos, status: statusAtSend || undefined }),
      });
      if (!res.ok) { alert('Erro ao enviar'); return; }
      setTexto(''); setAnexos([]); setStatusAtSend('');
      onSent();
    } finally { setSending(false); }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
      <textarea
        value={texto}
        onChange={e => setTexto(e.target.value)}
        placeholder="Resposta ao usuário..."
        rows={4}
        className="w-full bg-transparent text-sm text-gray-100 outline-none resize-none placeholder-gray-600"
      />
      {anexos.length > 0 && (
        <ul className="space-y-1 mt-2">
          {anexos.map((a, i) => (
            <li key={i} className="flex items-center gap-2 text-xs bg-gray-800 rounded px-2 py-1">
              <Paperclip className="w-3 h-3 text-gray-500" />
              <span className="flex-1 truncate text-gray-200">{a.nome}</span>
              <button onClick={() => setAnexos(anexos.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300">
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-gray-800 flex-wrap">
        <button onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-100">
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />} Anexar
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          className="hidden"
          onChange={e => { upload(e.target.files); e.target.value = ''; }}
        />
        <div className="flex items-center gap-2 ml-auto">
          <select
            value={statusAtSend}
            onChange={e => setStatusAtSend(e.target.value)}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-200 outline-none"
            title="Mudar status ao enviar"
          >
            <option value="">Manter status</option>
            <option value="aguardando_usuario">→ Aguardando usuário</option>
            <option value="em_andamento">→ Em andamento</option>
            <option value="resolvido">→ Resolver</option>
            <option value="fechado">→ Fechar</option>
          </select>
          <button
            onClick={send}
            disabled={sending || (!texto.trim() && anexos.length === 0)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#d4a853] text-gray-900 text-xs font-semibold hover:brightness-110 disabled:opacity-60"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: Mensagem }) {
  const isAdmin = m.from_type === 'super_admin';
  return (
    <div className={`flex gap-2 ${isAdmin ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
        isAdmin ? 'bg-[#d4a853]/20 text-[#d4a853]' : 'bg-blue-500/20 text-blue-300'
      }`}>
        {isAdmin ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
      </div>
      <div className="max-w-[80%] flex-1">
        <div className={`flex items-center gap-2 mb-1 text-[11px] text-gray-500 ${isAdmin ? 'justify-end' : ''}`}>
          <span className="font-semibold text-gray-300">{m.from_nome}</span>
          {isAdmin && <span className="px-1.5 py-0.5 rounded bg-[#d4a853]/15 text-[#d4a853] text-[10px] font-semibold">VOCÊ</span>}
          <span>•</span>
          <span>{new Date(m.created_at).toLocaleString('pt-BR')}</span>
        </div>
        <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
          isAdmin ? 'bg-[#d4a853]/10 text-gray-100 border border-[#d4a853]/20' : 'bg-gray-800 text-gray-100'
        }`}>
          {m.mensagem}
          {Array.isArray(m.anexos) && m.anexos.length > 0 && <AnexosList anexos={m.anexos} dark />}
        </div>
      </div>
    </div>
  );
}

function AnexosList({ anexos, dark }: { anexos: { url: string; nome: string }[]; dark?: boolean }) {
  const bg = dark ? 'bg-gray-800 border-gray-700 hover:bg-gray-700' : 'bg-white border-slate-200 hover:bg-slate-50';
  const fg = dark ? 'text-gray-300' : 'text-slate-700';
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
            className={`flex items-center gap-2 p-2 rounded-md border transition-colors ${bg}`}
          >
            {isImg ? <ImageIcon className="w-4 h-4 text-blue-400 shrink-0" /> : <Paperclip className="w-4 h-4 text-gray-500 shrink-0" />}
            <span className={`text-xs truncate ${fg}`}>{a.nome}</span>
          </a>
        );
      })}
    </div>
  );
}

function CategoriaIcon({ categoria }: { categoria: string }) {
  const cfg: Record<string, { Icon: React.ComponentType<{ className?: string }>; bg: string }> = {
    bug: { Icon: Bug, bg: 'bg-red-500/15 text-red-400' },
    duvida: { Icon: HelpCircle, bg: 'bg-blue-500/15 text-blue-400' },
    sugestao: { Icon: Lightbulb, bg: 'bg-amber-500/15 text-amber-400' },
    outro: { Icon: Circle, bg: 'bg-gray-800 text-gray-500' },
  };
  const c = cfg[categoria] || cfg.outro;
  return (
    <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${c.bg}`}>
      <c.Icon className="w-5 h-5" />
    </span>
  );
}
