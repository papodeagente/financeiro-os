'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Proposta, SecaoProposta, Cliente, Membro, Destino } from '@/lib/crm-types';
import { generateId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Save, ArrowLeft, Copy, MessageCircle, GripVertical,
  ChevronUp, ChevronDown, Trash2, Plane, Hotel,
  Type, Calendar, Image, CheckSquare, DollarSign, Quote, MousePointer,
  Check, Loader2, Sparkles, FileDown, GitBranch,
  Video, Map, HelpCircle, Timer, Bed, Car,
  Eye, EyeOff, CopyPlus, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import {
  DndContext, closestCenter, pointerWithin, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { BlockRenderer } from './BlockRenderer';
import { BlockToolbar } from './BlockToolbar';
import { BlockPalette } from './BlockPalette';
import { DropZone } from './DropZone';
import { PropostaSidebar } from './PropostaSidebar';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import { HotelSearchModal } from '@/components/HotelSearchModal';
import { formatFlightForTransporte } from '@/lib/flight-data-mapper';
import { formatHotelForAlojamento } from '@/lib/hotel-data-mapper';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import type { GooglePlace } from '@/lib/hotel-data-mapper';
import type { AlojamentoData, TransporteData } from '@/lib/crm-types';
import { PdfExportModal } from './PdfExportModal';
import { consumePendingPropostaHotelHandoff, consumePendingPropostaFlightHandoff } from '@/lib/api-search-handoff';
import type { SearchAPIHotelProperty } from '@/lib/searchapi-hotels';

const TIPO_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  TEXTO: Type, SERVICO: Plane, VOO: Plane, ROTEIRO_DIA: Calendar, GALERIA: Image,
  INCLUSOS: CheckSquare, VALORES: DollarSign, DEPOIMENTO: Quote, CTA: MousePointer,
  VIDEO: Video, MAPA: Map, FAQ: HelpCircle, COUNTDOWN: Timer,
  ALOJAMENTO: Bed, TRANSPORTE: Car,
};
const TIPO_LABELS: Record<string, string> = {
  TEXTO: 'Texto', SERVICO: 'Servico', VOO: 'Voo', ROTEIRO_DIA: 'Roteiro', GALERIA: 'Galeria',
  INCLUSOS: 'Inclusos', VALORES: 'Valores', DEPOIMENTO: 'Depoimento', CTA: 'CTA',
  VIDEO: 'Video', MAPA: 'Mapa', FAQ: 'FAQ', COUNTDOWN: 'Countdown',
  ALOJAMENTO: 'Hospedagem', TRANSPORTE: 'Transporte',
};

function defaultConteudo(tipo: string): Record<string, unknown> {
  switch (tipo) {
    case 'TEXTO': return { titulo: '', corpo: '', alinhamento: 'left' };
    case 'SERVICO': return { icone: '✈️', titulo: '', descricao: '', detalhes: [], imagem: '', valor: 0, exibir_valor: true };
    case 'ROTEIRO_DIA': return { dias: [{ numero: 1, titulo: 'Dia 1', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' }] };
    case 'GALERIA': return { imagens: [] };
    case 'INCLUSOS': return { inclusos: [''], nao_inclusos: [''] };
    case 'VALORES': return { opcoes: [{ titulo: 'Opcao 1', valor_total: 0, destaque: false, parcelas: [{ forma: 'A vista PIX', valor_parcela: 0, valor_total: 0, destaque: true }] }], observacoes_valores: '', validade: '' };
    case 'DEPOIMENTO': return { depoimentos: [{ texto: '', autor: '', foto: '', destino: '' }] };
    case 'CTA': return { texto_botao: 'Quero reservar minha viagem!', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: '', cor_botao: '#004aad' };
    case 'VIDEO': return { url: '', titulo: '' };
    case 'MAPA': return { titulo: '', pontos: [], zoom: 10 };
    case 'FAQ': return { titulo: 'Perguntas Frequentes', perguntas: [] };
    case 'COUNTDOWN': return { titulo: '', data_evento: '', mensagem: '' };
    case 'ALOJAMENTO': return { id: generateId(), destino_nome: '', hotel_nome: '', hotel_estrelas: 0, hotel_imagem: '', hotel_galeria: [], hotel_descricao: '', hotel_link: '', check_in: '', check_out: '', noites: 0, regime: 'BB', quarto_tipo: '', bebidas: '', viagem_noturna: false };
    case 'TRANSPORTE': return { id: generateId(), tipo: 'TRANSFER', data: '', origem: '', destino: '', companhia: '', numero_voo: '', horario_saida: '', horario_chegada: '', distancia_km: 0, tempo_estimado: '', detalhes: '' };
    case 'VOO': return {
      id: generateId(),
      data: '', origem: '', destino: '',
      companhia: '', numero_voo: '', horario_saida: '', horario_chegada: '',
      detalhes: '',
      // Defaults dos toggles — visíveis quando o voo for importado da API
      mostrar_segmentos: true,
      mostrar_emissao_co2: true,
      mostrar_aeronave: true,
      mostrar_bagagem: true,
      mostrar_alerta_atraso: false,
    };
    default: return {};
  }
}

// Sortable block wrapper
const AI_SUPPORTED_TYPES = ['TEXTO', 'SERVICO', 'ROTEIRO_DIA', 'INCLUSOS', 'DEPOIMENTO', 'CTA'];

function SortableBlock({
  secao, index, total, collapsed, onUpdate, onRemove, onMove, onDuplicate,
  onToggleVisivel, onToggleCollapsed, onGenerateAI, generating, onInsertAfter,
}: {
  secao: SecaoProposta; index: number; total: number;
  collapsed: boolean;
  onUpdate: (conteudo: Record<string, unknown>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onToggleVisivel: () => void;
  onToggleCollapsed: () => void;
  onGenerateAI: () => void;
  generating: boolean;
  onInsertAfter?: (tipo: string, conteudo: Record<string, unknown>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: secao.id });
  const hidden = secao.visivel === false;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : hidden ? 0.55 : 1,
  };
  const TipoIcon = TIPO_ICONS[secao.tipo] || Type;
  const canAI = AI_SUPPORTED_TYPES.includes(secao.tipo);

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]"
        // Borda esquerda colorida acentua o estado: verde quando visível,
        // cinza pontilhada quando oculto. Facilita escanear lista grande.
        style={{
          borderLeft: hidden
            ? '3px dashed var(--t-text-muted)'
            : '3px solid var(--t-green)',
        }}
      >
        <CardContent className={collapsed ? 'p-3' : 'p-4'}>
          <div className={`flex items-center gap-2 ${collapsed ? '' : 'mb-3'}`}>
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing touch-none p-1 -m-1 rounded hover:bg-[var(--t-surface-hover)]"
              title="Arrastar para reordenar"
            >
              <GripVertical className="w-4 h-4 text-[var(--t-text-muted)]" />
            </div>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-[var(--t-surface-hover)] rounded px-1.5 py-0.5 -mx-1.5"
              title={collapsed ? 'Expandir bloco' : 'Colapsar bloco'}
            >
              <TipoIcon className={`w-4 h-4 shrink-0 ${hidden ? 'text-[var(--t-text-muted)]' : 'text-[var(--t-green)]'}`} />
              <span className={`text-xs font-medium truncate ${hidden ? 'text-[var(--t-text-muted)] line-through' : 'text-[var(--t-text)]'}`}>
                {TIPO_LABELS[secao.tipo] || secao.tipo}
              </span>
              {hidden && (
                <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--t-text-muted)]/10 text-[var(--t-text-muted)] font-semibold">
                  Oculto
                </span>
              )}
              {collapsed ? (
                <ChevronsUpDown className="w-3 h-3 text-[var(--t-text-muted)] ml-1" />
              ) : (
                <ChevronsDownUp className="w-3 h-3 text-[var(--t-text-muted)] ml-1" />
              )}
            </button>
            {canAI && !collapsed && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-purple-400 hover:bg-purple-400/10 gap-1 text-[10px]"
                onClick={onGenerateAI} disabled={generating}>
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {generating ? 'Gerando...' : 'IA'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-[var(--t-text-secondary)]"
              onClick={onToggleVisivel}
              title={hidden ? 'Tornar visível' : 'Ocultar da proposta'}
            >
              {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-[var(--t-text-secondary)]"
              onClick={onDuplicate}
              title="Duplicar bloco"
            >
              <CopyPlus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[var(--t-text-secondary)]"
              onClick={() => onMove(-1)} disabled={index === 0} title="Mover para cima">
              <ChevronUp className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[var(--t-text-secondary)]"
              onClick={() => onMove(1)} disabled={index === total - 1} title="Mover para baixo">
              <ChevronDown className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" onClick={onRemove} title="Deletar bloco">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          {!collapsed && (
            <BlockRenderer tipo={secao.tipo} conteudo={secao.conteudo} onChange={onUpdate} onInsertAfter={onInsertAfter} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface Props {
  proposta: Proposta;
  clientes: Cliente[];
  membros: Membro[];
  isEdit: boolean;
}

export function PropostaEditor({ proposta: initialProposta, clientes: clientesProp, membros, isEdit }: Props) {
  const router = useRouter();
  const [proposta, setProposta] = useState<Proposta>(initialProposta);
  const [allClientes, setAllClientes] = useState<Cliente[]>(clientesProp);
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [flightModalOpen, setFlightModalOpen] = useState(false);
  const [hotelModalOpen, setHotelModalOpen] = useState(false);
  const [generatingAI, setGeneratingAI] = useState<Record<string, boolean>>({});
  const [generatingFull, setGeneratingFull] = useState(false);
  const [aiDestino, setAIDestino] = useState<Destino | null>(null);
  // Estado UI-only (não persistido): blocos colapsados visualmente para
  // o usuário escanear a lista. Reset a cada montagem.
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());
  // Tipo do bloco sendo arrastado da paleta. Quando != null, drop zones
  // ficam visiveis no canvas (caso contrario ocupam apenas 8px).
  const [paletteDragging, setPaletteDragging] = useState<string | null>(null);
  const toggleCollapsed = (id: string) => {
    setCollapsedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const collapseAll = () => setCollapsedBlocks(new Set(proposta.secoes.map(s => s.id)));
  const expandAll = () => setCollapsedBlocks(new Set());
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsaved = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const update = useCallback((fn: (p: Proposta) => Proposta) => {
    setProposta(prev => {
      const next = fn({ ...prev });
      // Sync ALOJAMENTO/TRANSPORTE blocks → viagem
      if (next.viagem) {
        next.viagem = {
          ...next.viagem,
          alojamentos: next.secoes
            .filter(s => s.tipo === 'ALOJAMENTO')
            .map(s => s.conteudo as unknown as AlojamentoData),
          transportes: next.secoes
            .filter(s => s.tipo === 'TRANSPORTE')
            .map(s => s.conteudo as unknown as TransporteData),
        };
      }
      hasUnsaved.current = true;
      return next;
    });
  }, []);

  // Consome handoff de busca de hotel/voo. Disparado uma vez no mount —
  // quando o usuário volta de /hoteis ou /voos após selecionar um item.
  useEffect(() => {
    const hotelHandoff = consumePendingPropostaHotelHandoff(initialProposta.id);
    if (hotelHandoff) {
      const mapped = formatHotelForAlojamento(hotelHandoff.hotel as SearchAPIHotelProperty);
      setProposta(prev => ({
        ...prev,
        secoes: prev.secoes.map(s =>
          s.id === hotelHandoff.ctx.blockId && s.tipo === 'ALOJAMENTO'
            ? {
                ...s,
                conteudo: {
                  ...s.conteudo,
                  ...mapped,
                  // Preserva config existente
                  check_in: (s.conteudo as Partial<AlojamentoData>).check_in || '',
                  check_out: (s.conteudo as Partial<AlojamentoData>).check_out || '',
                  noites: (s.conteudo as Partial<AlojamentoData>).noites || 0,
                  regime: (s.conteudo as Partial<AlojamentoData>).regime || 'BB',
                  id: hotelHandoff.ctx.blockId,
                } as Record<string, unknown>,
              }
            : s
        ),
      }));
      hasUnsaved.current = true;
    }
    const flightHandoff = consumePendingPropostaFlightHandoff(initialProposta.id);
    if (flightHandoff) {
      // Round-trip: mapper devolve [ida, volta] — aplica IDA no bloco que
      // disparou o handoff e insere VOLTA como bloco VOO logo depois.
      // One-way: só [ida], aplica no bloco e pronto.
      const mapped = formatFlightForTransporte(flightHandoff.flight) as unknown as Partial<TransporteData>[];
      const defaultsToggles = {
        mostrar_segmentos: true,
        mostrar_emissao_co2: true,
        mostrar_aeronave: true,
        mostrar_bagagem: true,
        mostrar_alerta_atraso: false,
      };
      const idaEnriched: Record<string, unknown> = {
        ...(mapped[0] || {}),
        id: flightHandoff.ctx.blockId,
        ...defaultsToggles,
      };
      setProposta(prev => {
        const idx = prev.secoes.findIndex(s => s.id === flightHandoff.ctx.blockId);
        const novasSecoes = prev.secoes.map(s => {
          if (s.id !== flightHandoff.ctx.blockId) return s;
          if (s.tipo !== 'TRANSPORTE' && s.tipo !== 'VOO') return s;
          // Força tipo VOO quando o mapper sinaliza voo_etapa (round-trip
          // sempre cria pares VOO mesmo se o bloco original era TRANSPORTE
          // legado — mantém consistência visual).
          const tipoFinal: SecaoProposta['tipo'] = idaEnriched.voo_etapa ? 'VOO' : s.tipo;
          return { ...s, tipo: tipoFinal, conteudo: { ...s.conteudo, ...idaEnriched } as Record<string, unknown> };
        });
        // Insere bloco VOLTA logo após o bloco IDA quando aplicável
        if (mapped[1] && idx >= 0) {
          const voltaConteudo: Record<string, unknown> = {
            ...(mapped[1] as Record<string, unknown>),
            id: generateId(),
            ...defaultsToggles,
          };
          const voltaSecao: SecaoProposta = {
            id: voltaConteudo.id as string,
            tipo: 'VOO',
            ordem: idx + 1,
            visivel: true,
            conteudo: voltaConteudo,
          };
          const arr = [...novasSecoes];
          arr.splice(idx + 1, 0, voltaSecao);
          return { ...prev, secoes: arr };
        }
        return { ...prev, secoes: novasSecoes };
      });
      hasUnsaved.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save with debounce
  useEffect(() => {
    if (!hasUnsaved.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      if (!hasUnsaved.current) return;
      setAutoSaveStatus('saving');
      try {
        const p = { ...proposta, atualizado_em: new Date().toISOString() };
        if (!p.link_publico) {
          p.link_publico = `${window.location.origin}/p/${p.id}`;
        }
        await fetch(`/api/propostas${isEdit ? `/${p.id}` : ''}`, {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        });
        hasUnsaved.current = false;
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 2000);
      } catch {
        setAutoSaveStatus('idle');
      }
    }, 2000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [proposta, isEdit]);

  const handleSave = async () => {
    setSaving(true);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const p = { ...proposta, atualizado_em: new Date().toISOString() };
    if (!p.link_publico) {
      p.link_publico = `${window.location.origin}/p/${p.id}`;
    }
    await fetch(`/api/propostas${isEdit ? `/${p.id}` : ''}`, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    hasUnsaved.current = false;
    setSaving(false);
    router.push('/propostas');
  };

  const addSecao = (tipo: string) => {
    update(p => ({
      ...p,
      secoes: [...p.secoes, {
        id: generateId(),
        tipo: tipo as SecaoProposta['tipo'],
        ordem: p.secoes.length,
        visivel: true,
        conteudo: defaultConteudo(tipo),
      }],
    }));
  };

  const insertSecaoAfter = (afterId: string, tipo: string, conteudo: Record<string, unknown>) => {
    update(p => {
      const idx = p.secoes.findIndex(s => s.id === afterId);
      const insertAt = idx >= 0 ? idx + 1 : p.secoes.length;
      const newSecao: SecaoProposta = {
        id: generateId(),
        tipo: tipo as SecaoProposta['tipo'],
        ordem: insertAt,
        visivel: true,
        conteudo,
      };
      const arr = [...p.secoes];
      arr.splice(insertAt, 0, newSecao);
      return { ...p, secoes: arr };
    });
  };

  // Insere um novo bloco numa posicao especifica (usado pelo handleDragEnd
  // quando o usuario solta um item da paleta sobre uma drop zone).
  const insertSecaoAt = (tipo: string, index: number) => {
    update(p => {
      const insertAt = Math.max(0, Math.min(index, p.secoes.length));
      const newSecao: SecaoProposta = {
        id: generateId(),
        tipo: tipo as SecaoProposta['tipo'],
        ordem: insertAt,
        visivel: true,
        conteudo: defaultConteudo(tipo),
      };
      const arr = [...p.secoes];
      arr.splice(insertAt, 0, newSecao);
      return { ...p, secoes: arr };
    });
  };

  const removeSecao = (id: string) => {
    update(p => ({ ...p, secoes: p.secoes.filter(s => s.id !== id) }));
  };

  const duplicateSecao = (id: string) => {
    update(p => {
      const idx = p.secoes.findIndex(s => s.id === id);
      if (idx < 0) return p;
      const src = p.secoes[idx];
      // Cópia profunda do conteúdo + novo id. Mantém visivel original.
      // Se o conteúdo tiver um `id` interno (caso de ALOJAMENTO/TRANSPORTE/VOO),
      // ele também é renovado para evitar colisão no viagem.alojamentos/transportes.
      const cloneConteudo = JSON.parse(JSON.stringify(src.conteudo)) as Record<string, unknown>;
      if (typeof cloneConteudo.id === 'string') cloneConteudo.id = generateId();
      const dup: SecaoProposta = {
        ...src,
        id: generateId(),
        conteudo: cloneConteudo,
      };
      const arr = [...p.secoes];
      arr.splice(idx + 1, 0, dup);
      return { ...p, secoes: arr };
    });
  };

  const toggleVisivelSecao = (id: string) => {
    update(p => ({
      ...p,
      secoes: p.secoes.map(s => s.id === id ? { ...s, visivel: !s.visivel } : s),
    }));
  };

  const moveSecao = (id: string, dir: -1 | 1) => {
    update(p => {
      const idx = p.secoes.findIndex(s => s.id === id);
      if (idx < 0) return p;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= p.secoes.length) return p;
      const arr = [...p.secoes];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return { ...p, secoes: arr };
    });
  };

  const updateSecao = (id: string, conteudo: Record<string, unknown>) => {
    update(p => ({ ...p, secoes: p.secoes.map(s => s.id === id ? { ...s, conteudo } : s) }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { source?: string; tipo?: string } | undefined;
    if (data?.source === 'palette' && typeof data.tipo === 'string') {
      setPaletteDragging(data.tipo);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setPaletteDragging(null);
    if (!over) return;

    const activeData = active.data.current as { source?: string; tipo?: string } | undefined;
    const overData = over.data.current as { kind?: string; index?: number } | undefined;

    // Drop vindo da paleta: insere bloco na posicao da drop zone.
    if (activeData?.source === 'palette' && typeof activeData.tipo === 'string') {
      if (overData?.kind === 'drop-zone' && typeof overData.index === 'number') {
        insertSecaoAt(activeData.tipo, overData.index);
      }
      return;
    }

    // Reordenacao canvas → canvas: troca posicao do bloco arrastado.
    if (active.id === over.id) return;
    update(p => {
      const oldIndex = p.secoes.findIndex(s => s.id === active.id);
      const newIndex = p.secoes.findIndex(s => s.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return p;
      return { ...p, secoes: arrayMove(p.secoes, oldIndex, newIndex) };
    });
  };

  // Collision detection sensivel ao tipo de drag:
  //  - paleta -> so vamos olhar drop zones
  //  - canvas -> so vamos olhar blocos sortable
  // Isso evita conflito em listas pequenas onde uma drop zone fica
  // proxima de um bloco e o dnd-kit poderia escolher o "errado".
  const collisionDetection: CollisionDetection = (args) => {
    const activeData = args.active.data.current as { source?: string } | undefined;
    if (activeData?.source === 'palette') {
      return pointerWithin({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          c => (c.data.current as { kind?: string } | undefined)?.kind === 'drop-zone',
        ),
      });
    }
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        c => (c.data.current as { kind?: string } | undefined)?.kind !== 'drop-zone',
      ),
    });
  };

  const handleEnviarWhatsApp = () => {
    const cliente = allClientes.find(c => c.id === proposta.cliente_id);
    const phone = cliente?.whatsapp || cliente?.telefone_principal || '';
    const nome = proposta.cliente_nome || cliente?.nome_completo || 'Cliente';
    const msg = encodeURIComponent(
      `Ola, ${nome.split(' ')[0]}! Preparei a proposta da sua viagem. Da uma olhada:\n${proposta.link_publico}\n\nQualquer duvida, e so chamar!\n${proposta.rodape.nome_vendedor}`
    );
    window.open(`https://wa.me/55${phone.replace(/\D/g, '')}?text=${msg}`, '_blank');
  };

  const [pdfModalOpen, setPdfModalOpen] = useState(false);

  const handleNovaVersao = async () => {
    if (!confirm(`Criar versao ${proposta.versao + 1} desta proposta?`)) return;
    // Save current first
    const current = { ...proposta, atualizado_em: new Date().toISOString() };
    await fetch(`/api/propostas/${current.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(current),
    });
    // Create new version
    const nova: Proposta = {
      ...current,
      id: generateId(),
      versao: current.versao + 1,
      versao_anterior_id: current.id,
      status: 'RASCUNHO',
      link_publico: '',
      aceite: null,
      feedbacks: [],
      envios: [],
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
      secoes: current.secoes.map(s => ({ ...s, id: generateId() })),
    };
    nova.link_publico = `${window.location.origin}/p/${nova.id}`;
    const res = await fetch('/api/propostas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nova),
    });
    if (res.ok) {
      router.push(`/propostas/${nova.id}`);
    }
  };

  const handleFlightSelect = (ida: FlightOffer, volta?: FlightOffer) => {
    // Combine ida + volta into a single offer so the mapper produces two
    // tagged TRANSPORTE entries (IDA + VOLTA). Use volta.price as the total
    // because SearchAPI returns the full round-trip price on the volta leg.
    const combined: FlightOffer = volta
      ? {
          ...ida,
          price: volta.price || ida.price,
          returnFlights: volta.flights,
          returnDuration: volta.totalDuration,
          returnLayovers: volta.layovers,
        }
      : ida;

    const transportes = formatFlightForTransporte(combined);

    update(p => ({
      ...p,
      secoes: [
        ...p.secoes,
        ...transportes.map((conteudo, i) => ({
          id: generateId(),
          tipo: 'TRANSPORTE' as SecaoProposta['tipo'],
          ordem: p.secoes.length + i,
          visivel: true,
          conteudo,
        })),
      ],
    }));
  };

  const handleHotelSelect = (place: GooglePlace) => {
    // Always create rich ALOJAMENTO blocks regardless of layout — both
    // CLASSICO and DISCOVERY renderers know how to show them with photo,
    // gallery, amenities and ratings.
    const conteudo = formatHotelForAlojamento(place);
    update(p => ({
      ...p,
      secoes: [...p.secoes, {
        id: generateId(),
        tipo: 'ALOJAMENTO' as SecaoProposta['tipo'],
        ordem: p.secoes.length,
        visivel: true,
        conteudo,
      }],
    }));
  };

  const getAIContext = useCallback(() => ({
    destino: aiDestino?.nome || proposta.cabecalho.titulo?.replace(/.*—\s*/, '').replace(/Proposta.*/, '').trim() || '',
    cliente_nome: proposta.cliente_nome || '',
    tipo_viagem: '',
    num_dias: proposta.secoes.find(s => s.tipo === 'ROTEIRO_DIA')
      ? ((s => (s?.conteudo as { dias?: unknown[] })?.dias?.length || 5)(proposta.secoes.find(s => s.tipo === 'ROTEIRO_DIA')))
      : 5,
  }), [proposta, aiDestino]);

  const handleGenerateAI = async (secaoId: string, tipo: string) => {
    setGeneratingAI(prev => ({ ...prev, [secaoId]: true }));
    try {
      const res = await fetch('/api/ai/proposta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo_bloco: tipo, contexto: getAIContext(), modo: 'bloco' }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        updateSecao(secaoId, data);
      }
    } catch {
      alert('Erro ao gerar conteudo com IA');
    }
    setGeneratingAI(prev => ({ ...prev, [secaoId]: false }));
  };

  const handleGenerateFullProposal = async () => {
    setGeneratingFull(true);
    try {
      const res = await fetch('/api/ai/proposta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contexto: getAIContext(), modo: 'completo' }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        update(p => {
          if (data.cabecalho) {
            if (data.cabecalho.titulo) p.cabecalho.titulo = data.cabecalho.titulo;
            if (data.cabecalho.subtitulo) p.cabecalho.subtitulo = data.cabecalho.subtitulo;
            if (data.cabecalho.mensagem_abertura) p.cabecalho.mensagem_abertura = data.cabecalho.mensagem_abertura;
          }
          if (data.secoes && Array.isArray(data.secoes)) {
            const newSecoes = data.secoes.map((s: { tipo: string; conteudo: Record<string, unknown> }, i: number) => ({
              id: generateId(),
              tipo: s.tipo as SecaoProposta['tipo'],
              ordem: p.secoes.length + i,
              visivel: true,
              conteudo: s.conteudo,
            }));
            p.secoes = [...p.secoes, ...newSecoes];
          }
          return p;
        });
      }
    } catch {
      alert('Erro ao gerar proposta com IA');
    }
    setGeneratingFull(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-[var(--t-border)] bg-[var(--t-surface)] shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/propostas')} className="text-[var(--t-text-secondary)]">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium text-[var(--t-text)]">
            {isEdit ? `Editar ${proposta.numero}` : 'Nova Proposta'}
            {proposta.versao > 1 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                v{proposta.versao}
              </span>
            )}
          </span>
          {/* Auto-save indicator */}
          {autoSaveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--t-text-muted)]">
              <Loader2 className="w-3 h-3 animate-spin" /> Salvando...
            </span>
          )}
          {autoSaveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--t-green)]">
              <Check className="w-3 h-3" /> Salvo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {proposta.link_publico && (
            <Button variant="outline" size="sm" className="gap-1 text-xs border-[var(--t-border)] text-[var(--t-text-secondary)]"
              onClick={() => navigator.clipboard.writeText(proposta.link_publico)}>
              <Copy className="w-3 h-3" /> Copiar link
            </Button>
          )}
          {isEdit && (
            <Button variant="outline" size="sm" className="gap-1 text-xs border-[var(--t-border)] text-purple-400"
              onClick={handleNovaVersao}>
              <GitBranch className="w-3 h-3" /> v{proposta.versao + 1}
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1 text-xs border-[var(--t-border)] text-[var(--t-text-secondary)]"
            onClick={() => setPdfModalOpen(true)}>
            <FileDown className="w-3 h-3" />
            PDF
          </Button>
          {proposta.cliente_id && (
            <Button variant="outline" size="sm" className="gap-1 text-xs border-[var(--t-border)] text-emerald-400"
              onClick={handleEnviarWhatsApp}>
              <MessageCircle className="w-3 h-3" /> WhatsApp
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="bg-[var(--t-green)] text-white dark:text-[#0a0a14] gap-1 text-sm">
            <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar e Fechar'}
          </Button>
        </div>
      </div>

      {/* Main area: Paleta + Editor + Sidebar (3 colunas, DnD unificado) */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setPaletteDragging(null)}
      >
        <div className="flex-1 flex overflow-hidden">
          {/* Paleta lateral de blocos (Fase 2/3) */}
          <BlockPalette
            onAddBlock={addSecao}
            onSearchFlight={() => setFlightModalOpen(true)}
            onSearchHotel={() => setHotelModalOpen(true)}
            onGenerateFullAI={handleGenerateFullProposal}
            generatingFull={generatingFull}
          />

          {/* Editor */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[900px] mx-auto p-6 space-y-6">
              <SortableContext items={proposta.secoes.map(s => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-[var(--t-text)]">Blocos da Proposta ({proposta.secoes.length})</h3>
                    {proposta.secoes.length > 0 && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px] text-[var(--t-text-secondary)] gap-1"
                          onClick={collapsedBlocks.size === proposta.secoes.length ? expandAll : collapseAll}
                          title={collapsedBlocks.size === proposta.secoes.length ? 'Expandir todos' : 'Colapsar todos'}
                        >
                          {collapsedBlocks.size === proposta.secoes.length ? (
                            <><ChevronsUpDown className="w-3 h-3" /> Expandir todos</>
                          ) : (
                            <><ChevronsDownUp className="w-3 h-3" /> Colapsar todos</>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Empty state — quando a proposta nao tem blocos, vira
                       um alvo gigante de drop encorajando o usuario a
                       arrastar da paleta. */}
                  {proposta.secoes.length === 0 ? (
                    <DropZone index={0} active={!!paletteDragging} label="Soltar primeiro bloco aqui" />
                  ) : (
                    <>
                      {/* Drop zone antes do primeiro bloco */}
                      <DropZone index={0} active={!!paletteDragging} />
                      {proposta.secoes.map((secao, idx) => (
                        <div key={secao.id}>
                          <SortableBlock
                            secao={secao}
                            index={idx}
                            total={proposta.secoes.length}
                            collapsed={collapsedBlocks.has(secao.id)}
                            onUpdate={c => updateSecao(secao.id, c)}
                            onRemove={() => removeSecao(secao.id)}
                            onMove={dir => moveSecao(secao.id, dir)}
                            onDuplicate={() => duplicateSecao(secao.id)}
                            onToggleVisivel={() => toggleVisivelSecao(secao.id)}
                            onToggleCollapsed={() => toggleCollapsed(secao.id)}
                            onGenerateAI={() => handleGenerateAI(secao.id, secao.tipo)}
                            generating={!!generatingAI[secao.id]}
                            onInsertAfter={(tipo, conteudo) => insertSecaoAfter(secao.id, tipo, conteudo)}
                          />
                          {/* Drop zone apos cada bloco */}
                          <DropZone index={idx + 1} active={!!paletteDragging} />
                        </div>
                      ))}
                    </>
                  )}

                  {proposta.secoes.length === 0 && (
                    <div className="text-center py-12 text-[var(--t-text-muted)]">
                      <p className="text-sm">Comece arrastando um bloco da paleta à esquerda</p>
                      <p className="text-[11px] mt-1">ou clique num item da paleta para adicionar no fim</p>
                    </div>
                  )}
                </div>
              </SortableContext>

              {/* Add block toolbar (atalho redundante, continua util como
                  fallback de "adicionar no fim sem precisar arrastar") */}
              <BlockToolbar
                onAddBlock={addSecao}
                onSearchFlight={() => setFlightModalOpen(true)}
                onSearchHotel={() => setHotelModalOpen(true)}
                onGenerateFullAI={handleGenerateFullProposal}
                generatingFull={generatingFull}
              />
            </div>
          </div>

          {/* Sidebar */}
          <PropostaSidebar
            proposta={proposta}
            clientes={allClientes}
            membros={membros}
            onUpdate={update}
            onSetAIDestino={setAIDestino}
            onClienteCreated={c => setAllClientes(prev => [...prev, c])}
          />
        </div>

        {/* DragOverlay mostra preview do bloco sendo arrastado da paleta */}
        <DragOverlay>
          {paletteDragging && (
            <div className="px-3 py-2 rounded-lg bg-[var(--t-green)] text-white text-xs font-medium shadow-2xl pointer-events-none">
              + {paletteDragging}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Modals */}
      <FlightSearchModal open={flightModalOpen} onClose={() => setFlightModalOpen(false)} onSelect={handleFlightSelect} />
      <HotelSearchModal open={hotelModalOpen} onClose={() => setHotelModalOpen(false)} onSelect={handleHotelSelect} />
      <PdfExportModal proposta={proposta} open={pdfModalOpen} onClose={() => setPdfModalOpen(false)} />
    </div>
  );
}
