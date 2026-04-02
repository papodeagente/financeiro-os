'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Proposta, Cliente } from '@/lib/crm-types';
import { loadEntities, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  FileText, Plus, Search, Send, Eye, CheckCircle, XCircle,
  Clock, Trash2, Copy, ExternalLink, MessageCircle, Mail,
  ArrowRightLeft, Filter,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtDate = (s: string) => {
  if (!s) return '-';
  return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR');
};

const statusConfig: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  RASCUNHO: { label: 'Rascunho', color: 'bg-[var(--t-surface-hover)]0/10 text-[var(--t-text-secondary)]', icon: Clock },
  ENVIADO: { label: 'Enviado', color: 'bg-[var(--t-blue-bg)]0/10 text-blue-400', icon: Send },
  VISUALIZADO: { label: 'Visualizado', color: 'bg-purple-500/10 text-purple-400', icon: Eye },
  ACEITO: { label: 'Aceito', color: 'bg-emerald-500/10 text-emerald-400', icon: CheckCircle },
  RECUSADO: { label: 'Recusado', color: 'bg-red-500/10 text-red-400', icon: XCircle },
  EXPIRADO: { label: 'Expirado', color: 'bg-amber-500/10 text-amber-400', icon: Clock },
  CONVERTIDO: { label: 'Convertido', color: 'bg-[var(--t-green)]/10 text-[var(--t-green)]', icon: ArrowRightLeft },
};

export default function PropostasPage() {
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');

  useEffect(() => {
    Promise.all([
      loadEntities<Proposta>('propostas'),
      loadEntities<Cliente>('clientes'),
    ]).then(([p, c]) => {
      setPropostas(p);
      setClientes(c);
      setLoading(false);
    });
  }, []);

  const clienteMap = Object.fromEntries(
    clientes.map(c => [c.id, c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social])
  );

  const filtered = propostas.filter(p => {
    if (filtroStatus !== 'TODOS' && p.status !== filtroStatus) return false;
    if (busca) {
      const q = busca.toLowerCase();
      return (
        p.numero?.toLowerCase().includes(q) ||
        p.cliente_nome?.toLowerCase().includes(q) ||
        p.cabecalho?.titulo?.toLowerCase().includes(q)
      );
    }
    return true;
  }).sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''));

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta proposta?')) return;
    await deleteEntity('propostas', id);
    setPropostas(prev => prev.filter(p => p.id !== id));
  };

  const stats = {
    total: propostas.length,
    rascunho: propostas.filter(p => p.status === 'RASCUNHO').length,
    enviados: propostas.filter(p => p.status === 'ENVIADO' || p.status === 'VISUALIZADO').length,
    aceitos: propostas.filter(p => p.status === 'ACEITO' || p.status === 'CONVERTIDO').length,
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
            <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-[var(--t-green)]" />
            </div>
            Propostas
          </h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">
            Gerencie orcamentos e propostas de viagem
          </p>
        </div>
        <Link href="/propostas/nova">
          <Button className="bg-[var(--t-green)] hover:bg-[var(--t-green)]/90 text-white dark:text-[#0a0a14] gap-2">
            <Plus className="w-4 h-4" /> Nova Proposta
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-[var(--t-text)]' },
          { label: 'Rascunhos', value: stats.rascunho, color: 'text-[var(--t-text-secondary)]' },
          { label: 'Enviados', value: stats.enviados, color: 'text-blue-400' },
          { label: 'Aceitos', value: stats.aceitos, color: 'text-emerald-400' },
        ].map(s => (
          <Card key={s.label} className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
            <CardContent className="p-4 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-[var(--t-text-secondary)]">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
          <Input
            placeholder="Buscar por numero, cliente, titulo..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-10 bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)]"
          />
        </div>
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          className="bg-[var(--t-bg-secondary)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm"
        >
          <option value="TODOS">Todos os status</option>
          {Object.entries(statusConfig).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 text-[var(--t-text-muted)] mx-auto mb-3" />
            <p className="text-[var(--t-text-secondary)]">
              {propostas.length === 0 ? 'Nenhuma proposta criada ainda' : 'Nenhuma proposta encontrada'}
            </p>
            {propostas.length === 0 && (
              <Link href="/propostas/nova">
                <Button className="mt-4 bg-[var(--t-green)] text-white dark:text-[#0a0a14]">
                  Criar primeira proposta
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => {
            const sc = statusConfig[p.status] || statusConfig.RASCUNHO;
            const Icon = sc.icon;
            const valorTotal = p.secoes
              ?.filter(s => s.tipo === 'VALORES')
              .reduce((sum, s) => {
                const opcoes = (s.conteudo as { opcoes?: Array<{ valor_total: number }> })?.opcoes || [];
                return sum + opcoes.reduce((os, o) => os + (o.valor_total || 0), 0);
              }, 0) || 0;

            return (
              <Card key={p.id} className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] hover:border-[var(--t-border-hover)] transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-[var(--t-bg)] flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-[var(--t-text-secondary)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--t-text)]">
                          {p.cabecalho?.titulo || `Proposta ${p.numero}`}
                        </span>
                        <Badge className={`${sc.color} text-[10px] px-2 py-0 gap-1`}>
                          <Icon className="w-3 h-3" /> {sc.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--t-text-secondary)] mt-1">
                        <span>#{p.numero}</span>
                        <span>&middot;</span>
                        <span>{p.cliente_nome || clienteMap[p.cliente_id] || 'Sem cliente'}</span>
                        <span>&middot;</span>
                        <span>{fmtDate(p.cabecalho?.data_proposta || p.criado_em?.split('T')[0])}</span>
                        {valorTotal > 0 && (
                          <>
                            <span>&middot;</span>
                            <span className="font-medium text-[var(--t-text)]">{BRL(valorTotal)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link href={`/propostas/${p.id}`}>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                          <FileText className="w-4 h-4" />
                        </Button>
                      </Link>
                      {p.link_publico && (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
                          onClick={() => { navigator.clipboard.writeText(p.link_publico); }}
                          title="Copiar link">
                          <Copy className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                        onClick={() => handleDelete(p.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
