'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Loader2, MessageSquare, ArrowRight, AlertCircle, Clock, Circle, CheckCircle2, Bug, HelpCircle, Lightbulb,
  Search, Filter,
} from 'lucide-react';

interface AdminTicket {
  id: string; numero: string; titulo: string;
  status: string; prioridade: string; categoria: string;
  tenant_id: string; tenant_nome: string | null; tenant_slug: string | null;
  created_by_nome: string; created_by_email: string;
  mensagens_count: number; tem_nao_lida_admin: boolean; tem_resposta_admin: boolean;
  created_at: string; updated_at: string; ultima_msg_at: string | null;
}
interface Stats {
  abertos?: number; em_andamento?: number; aguardando_usuario?: number;
  resolvidos?: number; fechados?: number; nao_lidos?: number;
}

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [prioFilter, setPrioFilter] = useState<string>('');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (prioFilter) params.set('prioridade', prioFilter);
    if (q.trim()) params.set('q', q.trim());
    fetch(`/api/admin/support/tickets?${params}`)
      .then(r => r.json())
      .then(d => {
        setTickets(Array.isArray(d?.tickets) ? d.tickets : []);
        setStats(d?.stats || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [statusFilter, prioFilter, q]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-100 mb-1">Tickets de suporte</h1>
      <p className="text-sm text-gray-400 mb-6">Todos os tickets de todas as agências.</p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <StatCard label="Abertos" value={stats.abertos || 0} color="blue" onClick={() => setStatusFilter(statusFilter === 'aberto' ? '' : 'aberto')} active={statusFilter === 'aberto'} />
        <StatCard label="Em andamento" value={stats.em_andamento || 0} color="amber" onClick={() => setStatusFilter(statusFilter === 'em_andamento' ? '' : 'em_andamento')} active={statusFilter === 'em_andamento'} />
        <StatCard label="Aguardando" value={stats.aguardando_usuario || 0} color="purple" onClick={() => setStatusFilter(statusFilter === 'aguardando_usuario' ? '' : 'aguardando_usuario')} active={statusFilter === 'aguardando_usuario'} />
        <StatCard label="Resolvidos" value={stats.resolvidos || 0} color="emerald" onClick={() => setStatusFilter(statusFilter === 'resolvido' ? '' : 'resolvido')} active={statusFilter === 'resolvido'} />
        <StatCard label="Fechados" value={stats.fechados || 0} color="gray" onClick={() => setStatusFilter(statusFilter === 'fechado' ? '' : 'fechado')} active={statusFilter === 'fechado'} />
        <StatCard label="Não lidos" value={stats.nao_lidos || 0} color="red" />
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar por título, número ou email..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-100 outline-none focus:border-[#d4a853]"
          />
        </div>
        <select
          value={prioFilter}
          onChange={e => setPrioFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-100 outline-none"
        >
          <option value="">Todas prioridades</option>
          <option value="urgente">Urgente</option>
          <option value="alta">Alta</option>
          <option value="normal">Normal</option>
          <option value="baixa">Baixa</option>
        </select>
        {(statusFilter || prioFilter || q) && (
          <button
            onClick={() => { setStatusFilter(''); setPrioFilter(''); setQ(''); }}
            className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-100 inline-flex items-center gap-1"
          >
            <Filter className="w-3.5 h-3.5" /> Limpar
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
      ) : tickets.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
          <MessageSquare className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Nenhum ticket encontrado com esses filtros.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-800">
            {tickets.map(t => (
              <li key={t.id}>
                <Link
                  href={`/admin/support/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors"
                >
                  <StatusIcon status={t.status} />
                  <CategoriaIcon categoria={t.categoria} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-100 truncate">{t.titulo}</span>
                      <span className="text-[10px] font-mono text-gray-500">{t.numero}</span>
                      {t.tem_nao_lida_admin && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300">
                          NÃO LIDA
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {t.tenant_nome || t.tenant_slug || t.tenant_id} ·{' '}
                      {t.created_by_nome} ({t.created_by_email}) ·{' '}
                      {t.mensagens_count} msg ·{' '}
                      {new Date(t.ultima_msg_at || t.updated_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <PrioridadeBadge prioridade={t.prioridade} />
                  <ArrowRight className="w-4 h-4 text-gray-600" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, color, onClick, active,
}: {
  label: string; value: number; color: string;
  onClick?: () => void; active?: boolean;
}) {
  const palette: Record<string, string> = {
    blue: 'text-blue-400',
    amber: 'text-amber-400',
    purple: 'text-purple-400',
    emerald: 'text-emerald-400',
    gray: 'text-gray-400',
    red: 'text-red-400',
  };
  const interactive = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`text-left p-3 rounded-lg border bg-gray-900 transition-colors ${
        active ? 'border-[#d4a853]' : 'border-gray-800 hover:border-gray-700'
      } ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <p className="text-[10px] uppercase text-gray-500 tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${palette[color] || 'text-gray-100'}`}>{value}</p>
    </button>
  );
}

function StatusIcon({ status }: { status: string }) {
  const cfg: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string }> = {
    aberto: { Icon: Circle, color: 'text-blue-400' },
    em_andamento: { Icon: Clock, color: 'text-amber-400' },
    aguardando_usuario: { Icon: AlertCircle, color: 'text-purple-400' },
    resolvido: { Icon: CheckCircle2, color: 'text-emerald-400' },
    fechado: { Icon: CheckCircle2, color: 'text-gray-500' },
  };
  const c = cfg[status] || cfg.aberto;
  return <c.Icon className={`w-4 h-4 ${c.color}`} />;
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
    <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${c.bg}`}>
      <c.Icon className="w-3.5 h-3.5" />
    </span>
  );
}

function PrioridadeBadge({ prioridade }: { prioridade: string }) {
  const cfg: Record<string, { bg: string; label: string }> = {
    baixa: { bg: 'bg-gray-800 text-gray-400', label: 'Baixa' },
    normal: { bg: 'bg-gray-700 text-gray-300', label: 'Normal' },
    alta: { bg: 'bg-amber-500/20 text-amber-300', label: 'Alta' },
    urgente: { bg: 'bg-red-500/20 text-red-300', label: 'Urgente' },
  };
  const c = cfg[prioridade] || cfg.normal;
  return (
    <span className={`hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.bg}`}>
      {c.label}
    </span>
  );
}
