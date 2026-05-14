'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Loader2, History, FileText, UserCircle2, Bed, FileCheck2, DollarSign,
  Folder, ListChecks, ShoppingCart, ArrowRightLeft, RefreshCw,
} from 'lucide-react';
import { EVENTO_TIPO_LABEL, type EventoTipo } from '@/lib/gestao-grupos';

interface Evento {
  id: string;
  grupo_id: string;
  tipo: EventoTipo;
  descricao: string;
  reserva_id?: string;
  passageiro_id?: string;
  entidade_id?: string;
  entidade_label?: string;
  dados_anteriores?: Record<string, unknown>;
  dados_novos?: Record<string, unknown>;
  usuario_nome?: string;
  created_at: string;
}

interface Props {
  grupoId: string;
}

// Cores e ícones agrupados por categoria de evento.
const CATEGORIA: Array<{ key: string; label: string; tipos: EventoTipo[]; cor: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'reservas', label: 'Reservas / Vendas', tipos: ['reserva_criada', 'reserva_confirmada', 'reserva_cancelada', 'reserva_status_alterado', 'venda_gerada'], cor: '#2563EB', Icon: FileText },
  { key: 'passageiros', label: 'Passageiros', tipos: ['passageiro_adicionado', 'passageiro_alterado', 'passageiro_removido'], cor: '#7C3AED', Icon: UserCircle2 },
  { key: 'rooming', label: 'Rooming list', tipos: ['quarto_criado', 'quarto_alterado', 'quarto_removido', 'quarto_bloqueado', 'quarto_desbloqueado', 'passageiro_alocado', 'passageiro_desalocado'], cor: '#0891B2', Icon: Bed },
  { key: 'documentos', label: 'Documentos', tipos: ['documento_criado', 'documento_aprovado', 'documento_reprovado', 'documento_atualizado', 'documento_removido'], cor: '#0EA5E9', Icon: FileCheck2 },
  { key: 'financeiro', label: 'Financeiro', tipos: ['despesa_vinculada', 'despesa_desvinculada'], cor: '#10B981', Icon: DollarSign },
  { key: 'materiais', label: 'Materiais', tipos: ['material_anexado', 'material_removido'], cor: '#F59E0B', Icon: Folder },
  { key: 'tarefas', label: 'Tarefas', tipos: ['tarefa_criada', 'tarefa_concluida', 'tarefa_cancelada'], cor: '#EC4899', Icon: ListChecks },
  { key: 'pipeline', label: 'Pipeline / Kanban', tipos: ['kanban_stage_alterado', 'grupo_criado', 'grupo_alterado'], cor: '#64748B', Icon: ArrowRightLeft },
];

function categoriaDoEvento(tipo: EventoTipo) {
  for (const c of CATEGORIA) if (c.tipos.includes(tipo)) return c;
  return CATEGORIA[CATEGORIA.length - 1];
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dataRelativa(iso: string): string {
  const d = new Date(iso).getTime();
  const agora = Date.now();
  const diff = Math.floor((agora - d) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function HistoricoTab({ grupoId }: Props) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todos');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}/eventos?limit=300`);
      if (res.ok) {
        const json = await res.json();
        setEventos(json.eventos || []);
      }
    } finally {
      setLoading(false);
    }
  }, [grupoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Agrupa por dia (cabeçalho de seção)
  const filtered = filtroCategoria === 'todos'
    ? eventos
    : eventos.filter(e => {
        const cat = categoriaDoEvento(e.tipo);
        return cat.key === filtroCategoria;
      });

  const porDia = filtered.reduce<Record<string, Evento[]>>((acc, e) => {
    const dia = new Date(e.created_at).toLocaleDateString('pt-BR');
    if (!acc[dia]) acc[dia] = [];
    acc[dia].push(e);
    return acc;
  }, {});

  // Stats por categoria
  const statsPorCategoria = CATEGORIA.map(c => ({
    ...c,
    count: eventos.filter(e => c.tipos.includes(e.tipo)).length,
  }));

  return (
    <div className="space-y-5">
      {/* Filtros de categoria */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFiltroCategoria('todos')}
          className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[8px] text-[12px] font-semibold border transition-colors"
          style={{
            borderColor: filtroCategoria === 'todos' ? 'var(--lg-accent)' : 'var(--lg-border-base)',
            background: filtroCategoria === 'todos' ? 'var(--lg-accent-fill)' : 'white',
            color: filtroCategoria === 'todos' ? 'var(--lg-accent)' : 'var(--lg-text-2)',
          }}
        >
          <History className="w-3.5 h-3.5" /> Tudo
          <span className="text-[10px] mono px-1 py-0.5 rounded" style={{ background: '#F1F5F9', color: 'var(--lg-text-3)' }}>
            {eventos.length}
          </span>
        </button>
        {statsPorCategoria.filter(c => c.count > 0).map(c => {
          const ativo = filtroCategoria === c.key;
          const Icon = c.Icon;
          return (
            <button
              key={c.key}
              onClick={() => setFiltroCategoria(c.key)}
              className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[8px] text-[12px] font-semibold border transition-colors"
              style={{
                borderColor: ativo ? c.cor : 'var(--lg-border-base)',
                background: ativo ? `${c.cor}1A` : 'white',
                color: ativo ? c.cor : 'var(--lg-text-2)',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {c.label}
              <span className="text-[10px] mono px-1 py-0.5 rounded" style={{ background: '#F1F5F9', color: 'var(--lg-text-3)' }}>
                {c.count}
              </span>
            </button>
          );
        })}

        <button
          onClick={() => void carregar()}
          className="ml-auto inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[8px] text-[12px] border"
          style={{ borderColor: 'var(--lg-border-base)', color: 'var(--lg-text-2)', background: 'white' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="border p-10 text-center rounded-[12px]" style={{ borderColor: 'var(--lg-border-base)' }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--lg-text-3)' }} />
        </div>
      ) : eventos.length === 0 ? (
        <div className="empty-state">
          <History className="empty-state__icon" strokeWidth={1.5} />
          <p className="empty-state__title">Nenhum evento registrado ainda</p>
          <p className="empty-state__description">
            Conforme você cria reservas, confirma vendas, adiciona passageiros e usa o módulo,
            os eventos aparecem aqui em ordem cronológica.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <History className="empty-state__icon" strokeWidth={1.5} />
          <p className="empty-state__title">Sem eventos nessa categoria</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(porDia).map(([dia, evts]) => (
            <div key={dia}>
              <div className="text-[11px] uppercase tracking-[0.05em] font-semibold mb-3" style={{ color: 'var(--lg-text-3)' }}>
                {dia}
              </div>
              <div
                className="rounded-[12px] overflow-hidden"
                style={{
                  background: 'var(--lg-surface-solid)',
                  border: '1px solid var(--lg-border-base)',
                  boxShadow: 'var(--lg-shadow-card)',
                }}
              >
                {evts.map((e, idx) => {
                  const cat = categoriaDoEvento(e.tipo);
                  const Icon = cat.Icon;
                  return (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 px-4 py-3"
                      style={{ borderBottom: idx < evts.length - 1 ? '1px solid #F1F5F9' : 'none' }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: `${cat.cor}1A`, color: cat.cor }}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-[13px] font-semibold" style={{ color: 'var(--lg-text)' }}>
                            {EVENTO_TIPO_LABEL[e.tipo] || e.tipo}
                          </div>
                          <div
                            className="text-[10px] mono shrink-0"
                            style={{ color: 'var(--lg-text-3)' }}
                            title={fmtDataHora(e.created_at)}
                          >
                            {dataRelativa(e.created_at)}
                          </div>
                        </div>
                        <p className="text-[12px] mt-0.5" style={{ color: 'var(--lg-text-2)' }}>
                          {e.descricao}
                        </p>
                        {(e.dados_anteriores || e.dados_novos) && (
                          <details className="mt-1">
                            <summary className="text-[10px] cursor-pointer" style={{ color: 'var(--lg-text-3)' }}>
                              Ver detalhes
                            </summary>
                            <div className="grid grid-cols-2 gap-3 mt-1 p-2 rounded text-[10px] mono" style={{ background: '#F8FAFC', color: 'var(--lg-text-2)' }}>
                              {e.dados_anteriores && (
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--lg-text-3)' }}>antes</div>
                                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(e.dados_anteriores, null, 2)}</pre>
                                </div>
                              )}
                              {e.dados_novos && (
                                <div>
                                  <div className="font-semibold mb-1" style={{ color: 'var(--lg-text-3)' }}>depois</div>
                                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(e.dados_novos, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

void ShoppingCart;
