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
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            Suporte
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Reporte bugs, tire dúvidas ou envie sugestões. Acompanhe as respostas aqui.
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
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
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
            <MessageSquare className="w-6 h-6 text-blue-600" />
          </div>
          <h3 className="font-semibold text-slate-900 mb-1">Nenhum ticket ainda</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-5">
            Encontrou um bug? Tem uma dúvida? Abra um ticket e nosso time responde aqui.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" /> Abrir primeiro ticket
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {tickets.map(t => (
              <li key={t.id}>
                <Link
                  href={`/suporte/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <StatusIcon status={t.status} />
                  <CategoriaIcon categoria={t.categoria} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900 truncate">{t.titulo}</span>
                      <span className="text-[10px] font-mono text-slate-400">{t.numero}</span>
                      {t.tem_nao_lida_usuario && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                          NOVA RESPOSTA
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {t.mensagens_count} {t.mensagens_count === 1 ? 'mensagem' : 'mensagens'} ·{' '}
                      Atualizado em {new Date(t.ultima_msg_at || t.updated_at).toLocaleDateString('pt-BR')}{' '}
                      {new Date(t.ultima_msg_at || t.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <PrioridadeBadge prioridade={t.prioridade} />
                  <ArrowRight className="w-4 h-4 text-slate-300" />
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
    <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
      <h2 className="font-bold text-slate-900 mb-4">Novo ticket</h2>

      {error && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase text-slate-500">Categoria</span>
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
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <c.Icon className="w-3.5 h-3.5" />
                  {c.label}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase text-slate-500">Prioridade</span>
            <select
              value={prioridade}
              onChange={e => setPrioridade(e.target.value as typeof prioridade)}
              className="mt-1.5 w-full px-3 py-2 rounded-md border border-slate-200 text-sm outline-none focus:border-blue-400"
            >
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Título</span>
          <input
            type="text"
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Ex.: Botão de salvar não funciona em /grupos"
            maxLength={200}
            className="mt-1.5 w-full px-3 py-2 rounded-md border border-slate-200 text-sm outline-none focus:border-blue-400"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Descrição</span>
          <textarea
            value={descricao}
            onChange={e => setDescricao(e.target.value)}
            placeholder="Descreva o problema. Inclua passos pra reproduzir, o que esperava, e o que aconteceu."
            rows={5}
            className="mt-1.5 w-full px-3 py-2 rounded-md border border-slate-200 text-sm outline-none focus:border-blue-400 resize-y"
          />
        </label>

        <div>
          <span className="text-[11px] font-semibold uppercase text-slate-500">Anexos (prints, arquivos)</span>
          <div className="mt-1.5">
            <UploadField anexos={anexos} onChange={setAnexos} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
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
      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium cursor-pointer">
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
            <li key={i} className="flex items-center gap-2 text-xs text-slate-700 bg-slate-50 rounded px-2 py-1">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:text-blue-700">
                {a.nome}
              </a>
              <button
                onClick={() => onChange(anexos.filter((_, j) => j !== i))}
                className="text-red-500 hover:text-red-700"
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
    aberto: { Icon: Circle, color: 'text-blue-500', label: 'Aberto' },
    em_andamento: { Icon: Clock, color: 'text-amber-500', label: 'Em andamento' },
    aguardando_usuario: { Icon: AlertCircle, color: 'text-purple-500', label: 'Aguardando você' },
    resolvido: { Icon: CheckCircle2, color: 'text-emerald-500', label: 'Resolvido' },
    fechado: { Icon: CheckCircle2, color: 'text-slate-400', label: 'Fechado' },
  };
  const c = cfg[status] || cfg.aberto;
  return <c.Icon className={`w-4 h-4 ${c.color}`} aria-label={c.label} />;
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
    <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${c.bg}`}>
      <c.Icon className="w-3.5 h-3.5" />
    </span>
  );
}

function PrioridadeBadge({ prioridade }: { prioridade: string }) {
  if (prioridade === 'normal' || !prioridade) return null;
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    baixa: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Baixa' },
    alta: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Alta' },
    urgente: { bg: 'bg-red-100', text: 'text-red-700', label: 'Urgente' },
  };
  const c = cfg[prioridade];
  if (!c) return null;
  return (
    <span className={`hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
