'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Proposta, SecaoProposta, Cliente, Membro, Destino } from '@/lib/crm-types';
import { generateId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Save, ArrowLeft, Copy, MessageCircle,
  Check, Loader2, FileDown, GitBranch,
  Undo2, Redo2, Keyboard,
  Monitor, Tablet, Smartphone,
} from 'lucide-react';
import {
  DndContext, closestCenter, pointerWithin, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { BlockToolbar } from './BlockToolbar';
import { BlockPalette } from './BlockPalette';
import { DropZone } from './DropZone';
import { SelectableBlock } from './SelectableBlock';
import { SelectablePageSection } from './SelectablePageSection';
import { BlockPropertiesPanel } from './BlockPropertiesPanel';
import { PageHeaderEditor } from './PageHeaderEditor';
import { PageFooterEditor } from './PageFooterEditor';
import { PropostaSidebar } from './PropostaSidebar';
import { CapaSection } from './preview/CapaSection';
import { RodapeSection } from './preview/RodapeSection';
import { DiscoveryRenderer } from './preview/discovery/DiscoveryRenderer';
import { PreviewEditorProvider, type PreviewEditorBlockType } from './PreviewEditorContext';
import type { IdiomaProposal } from '@/lib/i18n-proposta';
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

// AI nao e suportado em todos os blocos. Lista historica preservada.
const AI_SUPPORTED_TYPES = ['TEXTO', 'SERVICO', 'ROTEIRO_DIA', 'INCLUSOS', 'DEPOIMENTO', 'CTA'];

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
  // Tipo do bloco sendo arrastado da paleta. Quando != null, drop zones
  // ficam visiveis no canvas (caso contrario ocupam apenas 8px).
  const [paletteDragging, setPaletteDragging] = useState<string | null>(null);
  // Bloco selecionado (Elementor-like): click no canvas seleciona, abre
  // editor no painel direito. Esc / click fora deseleciona. Tambem usado
  // pelos atalhos de teclado (D/H/Del/Arrows).
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Modo de viewport do canvas (Fase C). Constrai largura do canvas
  // pra simular como a proposta vai aparecer em cada dispositivo.
  // Default 'desktop' (900px — igual antes da feature).
  const [viewportMode, setViewportMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const VIEWPORT_WIDTHS = { desktop: 900, tablet: 768, mobile: 410 } as const;

  // History stack para undo/redo. Guarda snapshots da proposta inteira.
  // Updates frequentes (typing dentro de bloco) sao coalescidos com
  // debounce de 600ms — uma "sessao de edicao" vira uma entrada no
  // historico. Operacoes estruturais (delete, duplicate, drop) tambem
  // passam por esse caminho mas sao tao espacadas no tempo que viram
  // entradas separadas naturalmente.
  const historyRef = useRef<Proposta[]>([initialProposta]);
  const historyIdxRef = useRef(0);
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSnapshotRef = useRef<Proposta | null>(null);
  // Render trigger pra UI saber se undo/redo estao disponiveis.
  const [, forceHistoryRender] = useState(0);
  const bumpHistoryUI = () => forceHistoryRender(n => n + 1);

  const commitPendingSnapshot = useCallback(() => {
    if (!pendingSnapshotRef.current) return;
    const next = pendingSnapshotRef.current;
    // Descarta historia futura quando o usuario edita depois de um undo.
    const baseline = historyRef.current.slice(0, historyIdxRef.current + 1);
    baseline.push(next);
    // Cap memory: max 50 snapshots por proposta (suficiente pra rollback
    // de uma sessao de edicao normal sem explodir RAM).
    if (baseline.length > 50) baseline.shift();
    historyRef.current = baseline;
    historyIdxRef.current = baseline.length - 1;
    pendingSnapshotRef.current = null;
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = null;
    bumpHistoryUI();
  }, []);

  const pushHistory = useCallback((p: Proposta) => {
    pendingSnapshotRef.current = p;
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = setTimeout(commitPendingSnapshot, 600);
  }, [commitPendingSnapshot]);

  const canUndo = historyIdxRef.current > 0 || !!pendingSnapshotRef.current;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;

  const undo = useCallback(() => {
    // Compromete o snapshot pendente primeiro, senao o usuario pode
    // "perder" uma edicao recem-feita ao apertar Ctrl+Z muito rapido.
    commitPendingSnapshot();
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const snap = historyRef.current[historyIdxRef.current];
    setProposta(snap);
    hasUnsaved.current = true;
    bumpHistoryUI();
  }, [commitPendingSnapshot]);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const snap = historyRef.current[historyIdxRef.current];
    setProposta(snap);
    hasUnsaved.current = true;
    bumpHistoryUI();
  }, []);
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
      // Empurra para o stack de history (com debounce — typing rapido
      // coalesce em uma unica entrada).
      pushHistory(next);
      return next;
    });
  }, [pushHistory]);

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

  // Keyboard shortcuts globais. Ctrl+Z / Cmd+Z faz undo; Ctrl+Y /
  // Ctrl+Shift+Z / Cmd+Shift+Z faz redo. Quando ha um bloco focado
  // (click no header), Del/Backspace deleta, D duplica, H toggle
  // visibilidade, Setas movem.
  //
  // Pula quando o usuario esta digitando em input/textarea/contenteditable
  // (so executa atalhos quando o foco esta no "shell" do editor).
  useEffect(() => {
    const isTypingInForm = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Esc: fecha shortcuts e limpa foco. Funciona em qualquer contexto.
      if (key === 'escape') {
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (selectedBlockId && !isTypingInForm()) {
          setSelectedBlockId(null);
          return;
        }
      }

      // Undo / Redo — funcionam mesmo dentro de inputs (CTRL+Z padrao
      // do navegador ja faz undo de texto, entao so interceptamos
      // quando o foco NAO esta num input — senao atrapalha digitacao).
      if (meta && key === 'z' && !isTypingInForm()) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (meta && key === 'y' && !isTypingInForm()) {
        e.preventDefault();
        redo();
        return;
      }

      // Atalhos por bloco — so quando ha bloco focado e nao estamos
      // digitando.
      if (!selectedBlockId || isTypingInForm()) return;

      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        removeSecao(selectedBlockId);
        setSelectedBlockId(null);
        return;
      }
      if (key === 'd' && !meta) {
        e.preventDefault();
        duplicateSecao(selectedBlockId);
        return;
      }
      if (key === 'h' && !meta) {
        e.preventDefault();
        toggleVisivelSecao(selectedBlockId);
        return;
      }
      if (key === 'arrowup') {
        e.preventDefault();
        moveSecao(selectedBlockId, -1);
        return;
      }
      if (key === 'arrowdown') {
        e.preventDefault();
        moveSecao(selectedBlockId, 1);
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBlockId, showShortcuts, undo, redo]);

  // Quando o editor monta, forca a sidebar do AppShell a colapsar pra
  // dar mais espaco horizontal pra paleta + canvas + preview/sidebar.
  // Restaura preferencia do usuario no unmount.
  useEffect(() => {
    let prevCollapsed = false;
    try {
      prevCollapsed = localStorage.getItem('entur:sidebar-collapsed') === 'true';
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('entur:force-sidebar', { detail: { collapsed: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent('entur:force-sidebar', { detail: { collapsed: prevCollapsed } }));
    };
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
      <div className="relative px-6 py-3 flex items-center justify-between border-b border-[var(--t-border)] bg-[var(--t-surface)] shrink-0">
        {/* Viewport toggle (Fase C) — centralizado absoluto pra nao
            depender do flow do flex. Em telas <lg fica escondido pra
            nao colidir com as outras toolbars. */}
        <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center bg-[var(--t-bg)] border border-[var(--t-border)] rounded-lg overflow-hidden">
          {([
            { mode: 'desktop' as const, Icon: Monitor, label: 'Desktop (900px)' },
            { mode: 'tablet' as const, Icon: Tablet, label: 'Tablet (768px)' },
            { mode: 'mobile' as const, Icon: Smartphone, label: 'Mobile (410px)' },
          ]).map(({ mode, Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewportMode(mode)}
              className={`w-9 h-8 flex items-center justify-center transition-colors ${
                viewportMode === mode
                  ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14]'
                  : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]'
              }`}
              title={label}
              aria-label={label}
              aria-pressed={viewportMode === mode}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

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
          {/* Undo / Redo (Fase 6). Funcionam tanto pelos botoes quanto
              por Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-[var(--t-text-secondary)] disabled:opacity-30"
            onClick={undo}
            disabled={!canUndo}
            title="Desfazer (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-[var(--t-text-secondary)] disabled:opacity-30"
            onClick={redo}
            disabled={!canRedo}
            title="Refazer (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-[var(--t-text-secondary)]"
            onClick={() => setShowShortcuts(true)}
            title="Atalhos de teclado"
          >
            <Keyboard className="w-4 h-4" />
          </Button>

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
          {/* Paleta lateral de blocos com tabs Blocos/Estrutura (Fase D) */}
          <BlockPalette
            onAddBlock={addSecao}
            onSearchFlight={() => setFlightModalOpen(true)}
            onSearchHotel={() => setHotelModalOpen(true)}
            onGenerateFullAI={handleGenerateFullProposal}
            generatingFull={generatingFull}
            secoes={proposta.secoes}
            selectedBlockId={selectedBlockId}
            onSelectBlock={(id) => {
              setSelectedBlockId(id);
              // Scroll suave pro bloco selecionado no canvas. Pequeno
              // truque: cada SelectableBlock nao tem id especifico no DOM,
              // entao usamos data-attr no wrapper. Implementacao opcional
              // — Phase D entrega scroll basico via scroll natural quando
              // o usuario clicka.
            }}
          />

          {/* Editor — canvas estilo Elementor: copia visual fiel de
              /p/[slug]. Bifurca por layout: DISCOVERY (default novo) usa
              o DiscoveryRenderer completo (hero, nav, accommodations
              summary table, transport summary, itinerary, pricing,
              footer com cta de reserva); CLASSICO usa capa + blocos +
              rodape modular. Fundo aplica proposta.visual.cor_fundo
              pra fidelidade total ao resultado final.
              Click no fundo do canvas deseleciona. */}
          <div
            className="flex-1 overflow-y-auto"
            onClick={() => setSelectedBlockId(null)}
            style={{ background: '#e5e7eb' }}
          >
            <div
              className="mx-auto my-6 shadow-2xl rounded-lg overflow-hidden transition-[max-width] duration-300 ease-out relative"
              style={{
                maxWidth: `${VIEWPORT_WIDTHS[viewportMode]}px`,
                background: proposta.visual?.cor_fundo || '#ffffff',
                color: proposta.visual?.cor_texto || '#1a1a2e',
                fontFamily: `'${proposta.visual?.fonte || 'Inter'}', sans-serif`,
                // transform cria containing block para position:fixed
                // descendentes (DiscoveryHeader, etc.) — sem isso o
                // menu vaza pro topo da janela do editor. translateZ(0)
                // e a forma classica e cheap de acionar isso sem efeito
                // visual colateral.
                transform: 'translateZ(0)',
              }}
              onClick={e => e.stopPropagation()}
            >
            {proposta.visual?.layout === 'DISCOVERY' ? (
              // ============ LAYOUT DISCOVERY ============
              // DiscoveryRenderer encapsula tudo (hero, nav, accommodations,
              // transports, itinerario, pricing, footer). Para selecao
              // de bloco no canvas, encapsulamos com PreviewEditorProvider
              // — assim os renderers internos (AccommodationSummary,
              // TransportSummary, PricingSection) detectam que estao em
              // modo editor e disparam onBlockSelect ao inves do
              // comportamento publico (HotelModal, etc.).
              <PreviewEditorProvider
                value={{
                  onBlockSelect: (blockType: PreviewEditorBlockType, conteudoId: string) => {
                    let secaoId: string | null = null;
                    if (blockType === 'ALOJAMENTO') {
                      const s = proposta.secoes.find(s =>
                        s.tipo === 'ALOJAMENTO' &&
                        (s.conteudo as { id?: string })?.id === conteudoId,
                      );
                      secaoId = s?.id || null;
                    } else if (blockType === 'VOO_OR_TRANSPORTE') {
                      const s = proposta.secoes.find(s =>
                        (s.tipo === 'VOO' || s.tipo === 'TRANSPORTE') &&
                        (s.conteudo as { id?: string })?.id === conteudoId,
                      );
                      secaoId = s?.id || null;
                    } else if (blockType === 'VALORES_OR_INCLUSOS') {
                      // conteudoId IS secao.id direto (PricingSection ja
                      // sabe qual secao representa).
                      secaoId = conteudoId;
                    } else if (blockType === 'ROTEIRO_DIA') {
                      const s = proposta.secoes.find(s =>
                        s.tipo === 'ROTEIRO_DIA' &&
                        (s.conteudo as { id?: string })?.id === conteudoId,
                      );
                      secaoId = s?.id || null;
                    }
                    if (secaoId) setSelectedBlockId(secaoId);
                  },
                }}
              >
                {/* DiscoveryRenderer renderiza tudo nativamente — sem
                    wrapper pointer-events-none, pra que clicks nas rows
                    de AccommodationSummary, voos do TransportSummary,
                    etc. cheguem aos onClick handlers que o
                    PreviewEditorProvider redireciona pra setSelectedBlockId.
                    A capa/cabecalho e editavel via aba Estrutura ou
                    seletor visual no proprio canvas. */}
                <DiscoveryRenderer
                  proposta={proposta}
                  slug="preview"
                  idioma={(proposta.idioma || 'pt-BR') as IdiomaProposal}
                />

                {/* Drop zones + bloco no rodape mantidos nesse layout
                    pra adicionar blocos novos sem sair do canvas */}
                {paletteDragging && (
                  <div className="px-6 py-4 bg-blue-50/40 border-t-2 border-dashed border-blue-300">
                    <p className="text-[11px] uppercase tracking-wider font-semibold text-blue-600 text-center mb-2">
                      Solte o bloco aqui — vai aparecer na seção apropriada
                    </p>
                    <SortableContext items={proposta.secoes.map(s => s.id)} strategy={verticalListSortingStrategy}>
                      <DropZone index={proposta.secoes.length} active label="Adicionar ao fim" />
                    </SortableContext>
                  </div>
                )}
              </PreviewEditorProvider>
            ) : (
              // ============ LAYOUT CLASSICO ============
              <>
              {/* CAPA — secao de pagina (nao draggavel). Click abre o
                  PageHeaderEditor no painel direito. */}
              <SelectablePageSection
                id="__page_header__"
                label="Capa"
                selected={selectedBlockId === '__page_header__'}
                onSelect={() => setSelectedBlockId('__page_header__')}
              >
                <CapaSection proposta={proposta} />
              </SelectablePageSection>

              {/* MENSAGEM DE ABERTURA — so renderiza quando preenchida.
                  Selecao tambem leva ao PageHeaderEditor (mesmo editor
                  cuida do cabecalho inteiro). */}
              {proposta.cabecalho.mensagem_abertura && (
                <div className="mt-4">
                  <SelectablePageSection
                    id="__opening_message__"
                    label="Mensagem de abertura"
                    selected={selectedBlockId === '__opening_message__'}
                    onSelect={() => setSelectedBlockId('__page_header__')}
                  >
                    <div className="max-w-3xl mx-auto px-6 py-10 text-center">
                      <p className="text-lg leading-relaxed opacity-80 italic">
                        {proposta.cabecalho.mensagem_abertura}
                      </p>
                    </div>
                  </SelectablePageSection>
                </div>
              )}

              {/* CONTAINER DOS BLOCOS — mesmo max-w e padding do /p/[slug]
                  classico pra fidelidade visual. */}
              <div
                className="mx-auto px-6 py-8 transition-all"
                style={{
                  maxWidth: viewportMode === 'mobile' ? '100%' : '768px',
                }}
              >
              <SortableContext items={proposta.secoes.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {proposta.secoes.length === 0 ? (
                  <div className="space-y-3">
                    <DropZone index={0} active={!!paletteDragging} label="Soltar primeiro bloco aqui" />
                    <div className="text-center py-12 text-[var(--t-text-muted)]">
                      <p className="text-sm">Comece arrastando um bloco da paleta à esquerda</p>
                      <p className="text-[11px] mt-1">ou clique num item da paleta para adicionar no fim</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Drop zone antes do primeiro bloco */}
                    <DropZone index={0} active={!!paletteDragging} />
                    {proposta.secoes.map((secao, idx) => (
                      <div key={secao.id} className="space-y-6">
                        <SelectableBlock
                          secao={secao}
                          selected={selectedBlockId === secao.id}
                          onSelect={() => setSelectedBlockId(secao.id)}
                          onDuplicate={() => duplicateSecao(secao.id)}
                          onToggleVisivel={() => toggleVisivelSecao(secao.id)}
                          onRemove={() => {
                            removeSecao(secao.id);
                            if (selectedBlockId === secao.id) setSelectedBlockId(null);
                          }}
                          corPrimaria={proposta.visual?.cor_primaria || '#004aad'}
                          idioma={(proposta.idioma || 'pt-BR') as 'pt-BR' | 'en' | 'es'}
                        />
                        {/* Drop zone apos cada bloco */}
                        <DropZone index={idx + 1} active={!!paletteDragging} />
                      </div>
                    ))}
                  </div>
                )}
              </SortableContext>

              {/* Add block toolbar — atalho redundante de "adicionar no
                  fim" pra quem nao quer arrastar */}
              <div className="mt-6">
                <BlockToolbar
                  onAddBlock={addSecao}
                  onSearchFlight={() => setFlightModalOpen(true)}
                  onSearchHotel={() => setHotelModalOpen(true)}
                  onGenerateFullAI={handleGenerateFullProposal}
                  generatingFull={generatingFull}
                />
              </div>
              </div>{/* /CONTAINER DOS BLOCOS */}

              {/* RODAPE — secao de pagina (nao draggavel). Click abre o
                  PageFooterEditor no painel direito. */}
              <div
                className="mx-auto px-6"
                style={{ maxWidth: viewportMode === 'mobile' ? '100%' : '768px' }}
              >
                <SelectablePageSection
                  id="__page_footer__"
                  label="Rodapé"
                  selected={selectedBlockId === '__page_footer__'}
                  onSelect={() => setSelectedBlockId('__page_footer__')}
                >
                  <RodapeSection proposta={proposta} />
                </SelectablePageSection>
              </div>

              {/* Validade no fim — espelhando /p/[slug] */}
              {proposta.cabecalho.validade && (
                <div className="text-center pb-8 pt-4 text-sm opacity-40">
                  Válida até{' '}
                  {new Date(proposta.cabecalho.validade + 'T12:00:00').toLocaleDateString('pt-BR')}
                </div>
              )}
              </>
            )}
            </div>
          </div>

          {/* Painel direito Elementor-like — roteamento por tipo de
              selecao no canvas:
              - "__page_header__" → PageHeaderEditor (capa + abertura)
              - "__page_footer__" → PageFooterEditor (rodape)
              - id de secao        → BlockPropertiesPanel
              - null               → PropostaSidebar (config geral) */}
          {selectedBlockId === '__page_header__' ? (
            <PageHeaderEditor
              proposta={proposta}
              onUpdate={update}
              onClose={() => setSelectedBlockId(null)}
            />
          ) : selectedBlockId === '__page_footer__' ? (
            <PageFooterEditor
              proposta={proposta}
              onUpdate={update}
              onClose={() => setSelectedBlockId(null)}
            />
          ) : selectedBlockId && proposta.secoes.find(s => s.id === selectedBlockId) ? (
            <BlockPropertiesPanel
              secao={proposta.secoes.find(s => s.id === selectedBlockId)!}
              onChange={c => updateSecao(selectedBlockId, c)}
              onClose={() => setSelectedBlockId(null)}
              onDuplicate={() => duplicateSecao(selectedBlockId)}
              onToggleVisivel={() => toggleVisivelSecao(selectedBlockId)}
              onRemove={() => { removeSecao(selectedBlockId); setSelectedBlockId(null); }}
              onGenerateAI={() => {
                const s = proposta.secoes.find(s => s.id === selectedBlockId);
                if (s) handleGenerateAI(selectedBlockId, s.tipo);
              }}
              generating={!!generatingAI[selectedBlockId]}
              onInsertAfter={(tipo, conteudo) => insertSecaoAfter(selectedBlockId, tipo, conteudo)}
            />
          ) : (
            <PropostaSidebar
              proposta={proposta}
              clientes={allClientes}
              membros={membros}
              onUpdate={update}
              onSetAIDestino={setAIDestino}
              onClienteCreated={c => setAllClientes(prev => [...prev, c])}
            />
          )}
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

      {/* Atalhos de teclado (Fase 6). Modal lista todos os atalhos
          disponiveis. Fecha com Esc ou click fora. */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="bg-[var(--t-surface)] border border-[var(--t-border)] rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-3 flex items-center justify-between border-b border-[var(--t-border)]">
              <h3 className="text-sm font-semibold text-[var(--t-text)] flex items-center gap-2">
                <Keyboard className="w-4 h-4" /> Atalhos de teclado
              </h3>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4 text-sm">
              <div>
                <h4 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] mb-2">Histórico</h4>
                <div className="space-y-1.5">
                  <ShortcutRow keys={['Ctrl', 'Z']} label="Desfazer" />
                  <ShortcutRow keys={['Ctrl', 'Shift', 'Z']} label="Refazer" />
                  <ShortcutRow keys={['Ctrl', 'Y']} label="Refazer (alternativo)" />
                </div>
              </div>
              <div>
                <h4 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] mb-2">Bloco focado</h4>
                <p className="text-[11px] text-[var(--t-text-muted)] mb-2">
                  Clique num bloco pra focá-lo (anel verde). Atalhos não disparam enquanto você digita num campo.
                </p>
                <div className="space-y-1.5">
                  <ShortcutRow keys={['D']} label="Duplicar bloco" />
                  <ShortcutRow keys={['H']} label="Ocultar / mostrar" />
                  <ShortcutRow keys={['Del']} label="Deletar" />
                  <ShortcutRow keys={['↑']} label="Mover para cima" />
                  <ShortcutRow keys={['↓']} label="Mover para baixo" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--t-text-secondary)]">{label}</span>
      <span className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="text-[var(--t-text-muted)] mx-0.5">+</span>}
            <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded border border-[var(--t-border)] bg-[var(--t-bg)] text-[10px] font-mono font-medium text-[var(--t-text)]">
              {k}
            </kbd>
          </span>
        ))}
      </span>
    </div>
  );
}
