'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Proposta } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { Card, CardContent } from '@/components/ui/card';
import {
  BarChart3, Eye, CheckCircle, XCircle, Clock,
  UserPlus, MessageCircle, ArrowLeft, TrendingUp,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function fmtDate(s: string) {
  if (!s) return '-';
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function fmtTempo(segundos: number) {
  if (segundos < 60) return `${segundos}s`;
  const min = Math.floor(segundos / 60);
  const sec = segundos % 60;
  return `${min}m${sec > 0 ? ` ${sec}s` : ''}`;
}

export default function PropostasAnalyticsPage() {
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEntities<Proposta>('propostas').then(p => {
      setPropostas(p);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    );
  }

  // Metrics
  const total = propostas.length;
  const aceitos = propostas.filter(p => p.status === 'ACEITO' || p.status === 'CONVERTIDO').length;
  const recusados = propostas.filter(p => p.status === 'RECUSADO').length;
  const enviados = propostas.filter(p => ['ENVIADO', 'VISUALIZADO', 'ACEITO', 'CONVERTIDO', 'RECUSADO'].includes(p.status)).length;
  const visualizados = propostas.filter(p => (p.visualizacoes?.length || 0) > 0).length;
  const taxaAceite = enviados > 0 ? Math.round((aceitos / enviados) * 100) : 0;
  const totalLeads = propostas.reduce((sum, p) => sum + (p.leads?.length || 0), 0);
  const totalFeedbacks = propostas.reduce((sum, p) => sum + (p.feedbacks?.length || 0), 0);

  // Average time
  const allTempos = propostas.flatMap(p =>
    (p.visualizacoes || []).filter(v => v.tempo_segundos > 0).map(v => v.tempo_segundos)
  );
  const tempoMedio = allTempos.length > 0
    ? Math.round(allTempos.reduce((a, b) => a + b, 0) / allTempos.length)
    : 0;

  // Total value of accepted proposals
  const valorAceito = propostas
    .filter(p => p.status === 'ACEITO' || p.status === 'CONVERTIDO')
    .reduce((sum, p) => {
      return sum + (p.secoes || [])
        .filter(s => s.tipo === 'VALORES')
        .reduce((ss, s) => {
          const opcoes = (s.conteudo as { opcoes?: Array<{ valor_total: number }> })?.opcoes || [];
          return ss + opcoes.reduce((os, o) => os + (o.valor_total || 0), 0);
        }, 0);
    }, 0);

  // Recent activity — last 10 proposals sorted by updated
  const recentes = [...propostas]
    .sort((a, b) => (b.atualizado_em || '').localeCompare(a.atualizado_em || ''))
    .slice(0, 10);

  // Top proposals by views
  const topViews = [...propostas]
    .filter(p => (p.visualizacoes?.length || 0) > 0)
    .sort((a, b) => (b.visualizacoes?.length || 0) - (a.visualizacoes?.length || 0))
    .slice(0, 5);

  const stats = [
    { label: 'Total Propostas', value: total, icon: BarChart3, color: 'text-[var(--t-text)]' },
    { label: 'Visualizadas', value: visualizados, icon: Eye, color: 'text-purple-400' },
    { label: 'Taxa de Aceite', value: `${taxaAceite}%`, icon: TrendingUp, color: 'text-emerald-400' },
    { label: 'Aceitas', value: aceitos, icon: CheckCircle, color: 'text-emerald-400' },
    { label: 'Recusadas', value: recusados, icon: XCircle, color: 'text-red-400' },
    { label: 'Tempo Medio', value: fmtTempo(tempoMedio), icon: Clock, color: 'text-blue-400' },
    { label: 'Leads', value: totalLeads, icon: UserPlus, color: 'text-amber-400' },
    { label: 'Feedbacks', value: totalFeedbacks, icon: MessageCircle, color: 'text-blue-400' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/propostas" className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-text)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-purple-400" />
            </div>
            Analytics de Propostas
          </h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">
            Metricas de visualizacao, aceite e engajamento
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <span className={`text-2xl font-bold ${s.color}`}>{s.value}</span>
              </div>
              <div className="text-xs text-[var(--t-text-secondary)] mt-1">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Value card */}
      {valorAceito > 0 && (
        <Card className="bg-emerald-500/5 border-emerald-500/20">
          <CardContent className="p-6 text-center">
            <div className="text-sm text-emerald-400 font-medium">Valor Total Aceito</div>
            <div className="text-3xl font-bold text-emerald-400 mt-1">{BRL(valorAceito)}</div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top viewed */}
        <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-[var(--t-text)] mb-4 flex items-center gap-2">
              <Eye className="w-4 h-4 text-purple-400" /> Mais Visualizadas
            </h3>
            <div className="space-y-3">
              {topViews.length === 0 && (
                <p className="text-xs text-[var(--t-text-muted)]">Nenhuma visualizacao registrada</p>
              )}
              {topViews.map(p => {
                const views = p.visualizacoes?.length || 0;
                const avgTime = p.visualizacoes?.filter(v => v.tempo_segundos > 0) || [];
                const avg = avgTime.length > 0
                  ? Math.round(avgTime.reduce((s, v) => s + v.tempo_segundos, 0) / avgTime.length)
                  : 0;
                return (
                  <div key={p.id} className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <Link href={`/propostas/${p.id}`} className="text-sm text-[var(--t-text)] hover:text-[var(--t-green)] truncate block">
                        {p.cabecalho?.titulo || p.numero}
                      </Link>
                      <span className="text-[10px] text-[var(--t-text-muted)]">{p.cliente_nome || 'Sem cliente'}</span>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-sm font-medium text-purple-400">{views}x</div>
                      {avg > 0 && <div className="text-[10px] text-[var(--t-text-muted)]">{fmtTempo(avg)} medio</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-[var(--t-text)] mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" /> Atividade Recente
            </h3>
            <div className="space-y-3">
              {recentes.map(p => (
                <div key={p.id} className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <Link href={`/propostas/${p.id}`} className="text-sm text-[var(--t-text)] hover:text-[var(--t-green)] truncate block">
                      {p.cabecalho?.titulo || p.numero}
                    </Link>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--t-text-muted)]">
                      <span>{p.status}</span>
                      {(p.visualizacoes?.length || 0) > 0 && <span>{p.visualizacoes?.length}x visto</span>}
                      {(p.leads?.length || 0) > 0 && <span>{p.leads?.length} lead(s)</span>}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--t-text-muted)] shrink-0 ml-3">
                    {fmtDate(p.atualizado_em)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
