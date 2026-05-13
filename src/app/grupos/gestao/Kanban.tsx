'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, Users, Package, AlertTriangle, MapPin, GripVertical } from 'lucide-react';
import { toast } from '@/lib/toast';
import { KANBAN_STAGES, type KanbanStage } from '@/lib/gestao-grupos';

interface ResumoGrupo {
  id: string;
  grp_id: string;
  origem_destino: string;
  status_pipeline: string;
  gestao_status: string | null;
  kanban_stage: KanbanStage;
  data_inicio: string;
  data_fim: string;
  periodos_count: number;
  vagas: {
    total: number;
    ocupadas: number;
    disponiveis: number;
    reservadas: number;
    confirmadas: number;
  };
  reservas: number;
  confirmadas: number;
  materiais: number;
  alerta_vagas_restantes: number;
  updated_at: string;
}

interface Props {
  grupos: ResumoGrupo[];
  onStageChange: (grupoId: string, stage: KanbanStage) => Promise<void>;
}

function fmtData(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function diasAte(iso: string): number | null {
  if (!iso) return null;
  const target = new Date(iso + 'T00:00:00').getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.floor((target - today) / 86400000);
}

// ---- Card ---------------------------------------------------------

function GroupCard({ g, isDragging = false }: { g: ResumoGrupo; isDragging?: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: dragActive,
  } = useDraggable({ id: g.id, data: g });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: dragActive ? 0.4 : 1,
  };

  const stage = KANBAN_STAGES.find(s => s.key === g.kanban_stage);

  const pct = g.vagas.total > 0 ? Math.min((g.vagas.ocupadas / g.vagas.total) * 100, 100) : 0;
  const lotado = g.vagas.total > 0 && g.vagas.disponiveis === 0;
  const emAlerta = !lotado && g.vagas.total > 0 && g.vagas.disponiveis <= g.alerta_vagas_restantes;
  const corBarra = lotado ? '#EF4444' : emAlerta ? '#F59E0B' : '#10B981';

  const dias = diasAte(g.data_inicio);
  const urgenteData = dias !== null && dias >= 0 && dias <= 30;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/card relative bg-white border border-[#E2E8F0] rounded-[12px] p-4 cursor-grab active:cursor-grabbing transition-all duration-150 hover:border-[#CBD5E1] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] ${isDragging ? 'shadow-[0_8px_24px_rgba(0,0,0,0.12)] rotate-[1deg]' : ''}`}
      {...attributes}
      {...listeners}
    >
      {/* Faixa lateral colorida por estágio */}
      {stage && (
        <span
          className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r"
          style={{ background: stage.color }}
        />
      )}

      {/* Drag handle indicator (visível em hover) */}
      <GripVertical
        className="absolute right-2 top-2 w-3.5 h-3.5 text-[#CBD5E1] opacity-0 group-hover/card:opacity-100 transition-opacity"
      />

      {/* Header — destino + grp_id */}
      <div className="pl-2 pr-4">
        <div className="flex items-start gap-1.5 mb-1">
          <MapPin className="w-3.5 h-3.5 text-[#94A3B8] mt-0.5 shrink-0" />
          <h3 className="text-[14px] font-semibold text-[#0F172A] leading-tight truncate flex-1">
            {g.origem_destino || 'Sem destino'}
          </h3>
        </div>
        <p className="text-[10px] font-mono text-[#94A3B8] uppercase tracking-wider pl-5">
          {g.grp_id || '—'}
        </p>
      </div>

      {/* Período */}
      {(g.data_inicio || g.data_fim) && (
        <div className="pl-2 pr-4 mt-3 flex items-center gap-1.5 text-[11px] text-[#64748B]">
          <Calendar className="w-3 h-3 shrink-0" />
          <span className="font-mono tabular-nums">
            {fmtData(g.data_inicio)} → {fmtData(g.data_fim)}
          </span>
          {urgenteData && dias !== null && (
            <span
              className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide"
              style={{
                background: dias <= 7 ? '#FEF2F2' : '#FFFBEB',
                color: dias <= 7 ? '#991B1B' : '#92400E',
              }}
            >
              {dias === 0 ? 'Hoje' : dias < 0 ? 'Atrasado' : `${dias}d`}
            </span>
          )}
        </div>
      )}

      {/* Barra de ocupação compacta */}
      {g.vagas.total > 0 && (
        <div className="pl-2 pr-4 mt-3">
          <div className="flex items-center justify-between text-[10px] mono mb-1">
            <span className="flex items-center gap-1" style={{ color: corBarra }}>
              {lotado && <AlertTriangle className="w-2.5 h-2.5" />}
              <span className="font-semibold tabular-nums">{g.vagas.disponiveis}</span>
              <span className="text-[#94A3B8]">livres</span>
            </span>
            <span className="text-[#94A3B8] tabular-nums">
              {g.vagas.ocupadas}/{g.vagas.total}
            </span>
          </div>
          <div className="h-1 bg-[#F1F5F9] rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${pct}%`, background: corBarra }}
            />
          </div>
        </div>
      )}

      {/* Stats inferiores: reservas + confirmadas + materiais */}
      <div className="pl-2 pr-4 mt-3 pt-3 border-t border-[#F1F5F9] flex items-center gap-3 text-[11px]">
        <div className="flex items-center gap-1">
          <Users className="w-3 h-3 text-[#94A3B8]" />
          <span className="font-semibold text-[#475569] tabular-nums">{g.reservas}</span>
          <span className="text-[#94A3B8]">reserv.</span>
        </div>
        {g.confirmadas > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
            <span className="font-semibold text-[#10B981] tabular-nums">{g.confirmadas}</span>
            <span className="text-[#94A3B8]">conf.</span>
          </div>
        )}
        {g.materiais > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <Package className="w-3 h-3 text-[#94A3B8]" />
            <span className="font-semibold text-[#64748B] tabular-nums">{g.materiais}</span>
          </div>
        )}
      </div>

      {/* Click overlay para abrir gestão (desativa drag em duplo clique) */}
      <a
        href={`/grupo/${g.id}/gestao`}
        onClick={e => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 h-6 text-[10px] flex items-center justify-center text-[#94A3B8] hover:text-[#2563EB] opacity-0 group-hover/card:opacity-100 transition-opacity z-10"
        style={{ background: 'linear-gradient(to top, white 60%, transparent)' }}
        onPointerDown={e => e.stopPropagation()}
      >
        Abrir gestão →
      </a>
    </div>
  );
}

// ---- Column -------------------------------------------------------

function Column({ stage, grupos }: { stage: typeof KANBAN_STAGES[number]; grupos: ResumoGrupo[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col shrink-0 w-[280px] h-full"
    >
      {/* Header da coluna */}
      <div
        className="px-3 py-2.5 mb-2 flex items-center justify-between gap-2 rounded-[10px]"
        style={{
          background: stage.fill,
          borderTop: `2px solid ${stage.color}`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: stage.color }}
          />
          <h3
            className="text-[12px] font-semibold uppercase tracking-[0.04em] truncate"
            style={{ color: stage.color }}
          >
            {stage.label}
          </h3>
        </div>
        <span
          className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded tabular-nums"
          style={{ color: stage.color, background: 'white' }}
        >
          {grupos.length}
        </span>
      </div>

      {/* Cards stack */}
      <div
        className={`flex-1 overflow-y-auto space-y-2 p-1 rounded-[10px] transition-all ${
          isOver ? 'bg-[#EFF6FF] outline-2 outline-dashed outline-[#BFDBFE]' : ''
        }`}
        style={{ minHeight: '60vh' }}
      >
        {grupos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-[11px] text-[#CBD5E1]">Arraste cards aqui</p>
          </div>
        ) : (
          grupos.map(g => <GroupCard key={g.id} g={g} />)
        )}
      </div>
    </div>
  );
}

// ---- Kanban container ---------------------------------------------

export function Kanban({ grupos, onStageChange }: Props) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const gruposPorStage = useMemo(() => {
    const map: Record<KanbanStage, ResumoGrupo[]> = {
      novo: [], formalizacao: [], vendas: [], fechado: [], embarque: [], finalizado: [],
    };
    for (const g of grupos) {
      const stage = g.kanban_stage || 'novo';
      if (map[stage]) map[stage].push(g);
      else map.novo.push(g);
    }
    return map;
  }, [grupos]);

  const grupoAtivo = useMemo(
    () => grupos.find(g => g.id === activeDragId) || null,
    [activeDragId, grupos],
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    const destinoStage = over.id as KanbanStage;
    if (!KANBAN_STAGES.find(s => s.key === destinoStage)) return;
    const grupoId = String(active.id);
    const grupo = grupos.find(g => g.id === grupoId);
    if (!grupo || grupo.kanban_stage === destinoStage) return;
    try {
      await onStageChange(grupoId, destinoStage);
    } catch {
      toast.error('Falha ao mover card');
    }
  }, [grupos, onStageChange]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '70vh' }}>
        {KANBAN_STAGES.map(stage => (
          <Column key={stage.key} stage={stage} grupos={gruposPorStage[stage.key]} />
        ))}
      </div>

      <DragOverlay>
        {grupoAtivo && (
          <div className="w-[280px]">
            <GroupCard g={grupoAtivo} isDragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
