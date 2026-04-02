'use client';

import { useEffect, useState, useMemo } from 'react';
import { LogAuditoria } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { exportCSV } from '@/lib/export-utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Search, Download, Filter, Plus, Edit3, Trash2, Eye, Send,
  ArrowRightLeft, XCircle, CheckCircle, LogIn, LogOut, FileText,
} from 'lucide-react';

const fmtDateTime = (s: string) => {
  if (!s) return '-';
  const d = new Date(s);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const acaoConfig: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  CRIAR: { label: 'Criou', icon: Plus, color: 'text-emerald-400' },
  EDITAR: { label: 'Editou', icon: Edit3, color: 'text-blue-400' },
  EXCLUIR: { label: 'Excluiu', icon: Trash2, color: 'text-red-400' },
  VISUALIZAR: { label: 'Visualizou', icon: Eye, color: 'text-[var(--t-text-secondary)]' },
  EXPORTAR: { label: 'Exportou', icon: Download, color: 'text-purple-400' },
  ENVIAR: { label: 'Enviou', icon: Send, color: 'text-cyan-400' },
  CONVERTER: { label: 'Converteu', icon: ArrowRightLeft, color: 'text-amber-400' },
  CANCELAR: { label: 'Cancelou', icon: XCircle, color: 'text-red-400' },
  CONFIRMAR: { label: 'Confirmou', icon: CheckCircle, color: 'text-emerald-400' },
};

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<LogAuditoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroModulo, setFiltroModulo] = useState('TODOS');
  const [filtroAcao, setFiltroAcao] = useState('TODOS');
  const [filtroUsuario, setFiltroUsuario] = useState('TODOS');
  const [page, setPage] = useState(0);
  const perPage = 50;

  useEffect(() => {
    loadEntities<LogAuditoria>('audit-log').then(l => {
      setLogs(l.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')));
      setLoading(false);
    });
  }, []);

  const modulos = useMemo(() => [...new Set(logs.map(l => l.modulo).filter(Boolean))].sort(), [logs]);
  const usuarios = useMemo(() => [...new Set(logs.map(l => l.usuario_nome).filter(Boolean))].sort(), [logs]);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (filtroModulo !== 'TODOS' && l.modulo !== filtroModulo) return false;
      if (filtroAcao !== 'TODOS' && l.acao !== filtroAcao) return false;
      if (filtroUsuario !== 'TODOS' && l.usuario_nome !== filtroUsuario) return false;
      if (busca) {
        const q = busca.toLowerCase();
        return l.descricao?.toLowerCase().includes(q) ||
          l.entidade?.toLowerCase().includes(q) ||
          l.usuario_nome?.toLowerCase().includes(q) ||
          l.modulo?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [logs, filtroModulo, filtroAcao, filtroUsuario, busca]);

  const paginated = filtered.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(filtered.length / perPage);

  const handleExport = () => {
    const headers = ['Data/Hora', 'Usuario', 'Perfil', 'Acao', 'Modulo', 'Entidade', 'ID', 'Descricao'];
    const rows = filtered.map(l => [
      fmtDateTime(l.timestamp),
      l.usuario_nome || '',
      l.perfil || '',
      l.acao || '',
      l.modulo || '',
      l.entidade || '',
      l.entidade_id || '',
      l.descricao || '',
    ]);
    exportCSV('log-auditoria', headers, rows);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-text)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Search className="w-5 h-5 text-purple-400" />
            </div>
            Log de Auditoria
          </h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">
            Registro de todas as acoes no sistema ({logs.length} registros)
          </p>
        </div>
        <Button onClick={handleExport} variant="outline" size="sm" className="gap-2 border-[var(--t-border)] text-[var(--t-text)]">
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
          <Input
            placeholder="Buscar..."
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPage(0); }}
            className="pl-10 bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)]"
          />
        </div>
        <select value={filtroUsuario} onChange={(e) => { setFiltroUsuario(e.target.value); setPage(0); }}
          className="bg-[var(--t-bg-secondary)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm">
          <option value="TODOS">Todos os usuarios</option>
          {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={filtroModulo} onChange={(e) => { setFiltroModulo(e.target.value); setPage(0); }}
          className="bg-[var(--t-bg-secondary)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm">
          <option value="TODOS">Todos os modulos</option>
          {modulos.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filtroAcao} onChange={(e) => { setFiltroAcao(e.target.value); setPage(0); }}
          className="bg-[var(--t-bg-secondary)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm">
          <option value="TODOS">Todas as acoes</option>
          {Object.entries(acaoConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Log entries */}
      <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
        <CardContent className="p-0">
          {paginated.length === 0 ? (
            <div className="py-16 text-center">
              <Search className="w-12 h-12 text-[var(--t-text-muted)] mx-auto mb-3" />
              <p className="text-[var(--t-text-secondary)]">
                {logs.length === 0 ? 'Nenhum registro de auditoria ainda' : 'Nenhum registro encontrado com os filtros aplicados'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--t-border)]">
              {paginated.map(l => {
                const cfg = acaoConfig[l.acao] || { label: l.acao, icon: FileText, color: 'text-[var(--t-text-secondary)]' };
                const Icon = cfg.icon;
                return (
                  <div key={l.id} className="px-5 py-3 flex items-start gap-3 hover:bg-[var(--t-bg)]/30 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-[var(--t-bg)] flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className={`w-4 h-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-[var(--t-text-muted)]">{fmtDateTime(l.timestamp)}</span>
                        <span className="text-xs font-medium text-[var(--t-text)]">{l.usuario_nome || 'Sistema'}</span>
                        {l.perfil && <Badge className="text-[9px] px-1.5 py-0 bg-[var(--t-bg)] text-[var(--t-text-secondary)]">{l.perfil}</Badge>}
                      </div>
                      <div className="text-sm text-[var(--t-text)] mt-0.5">
                        <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                        {' '}
                        {l.entidade && <span className="text-[var(--t-text-secondary)]">{l.entidade}</span>}
                        {l.entidade_id && <span className="text-[var(--t-text-muted)]"> #{l.entidade_id.slice(0, 8)}</span>}
                        {l.descricao && <span className="text-[var(--t-text-secondary)]"> — {l.descricao}</span>}
                      </div>
                      {l.alteracoes && l.alteracoes.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {l.alteracoes.slice(0, 3).map((a, i) => (
                            <div key={i} className="text-[11px] text-[var(--t-text-muted)]">
                              <span className="text-[var(--t-text-secondary)]">{a.campo}:</span>{' '}
                              <span className="text-red-400 line-through">{a.valor_anterior || '(vazio)'}</span>{' → '}
                              <span className="text-emerald-400">{a.valor_novo}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {l.modulo && (
                      <Badge className="text-[9px] px-2 py-0.5 bg-[var(--t-bg)] text-[var(--t-text-muted)] shrink-0">
                        {l.modulo}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-[var(--t-text-secondary)]">
          <span>Mostrando {page * perPage + 1}-{Math.min((page + 1) * perPage, filtered.length)} de {filtered.length}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="border-[var(--t-border)] text-[var(--t-text)]">Anterior</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              className="border-[var(--t-border)] text-[var(--t-text)]">Proximo</Button>
          </div>
        </div>
      )}
    </div>
  );
}
