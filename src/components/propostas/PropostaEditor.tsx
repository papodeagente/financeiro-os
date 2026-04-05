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
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { BlockRenderer } from './BlockRenderer';
import { BlockToolbar } from './BlockToolbar';
import { PropostaSidebar } from './PropostaSidebar';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import { HotelSearchModal } from '@/components/HotelSearchModal';
import { formatFlightForProposta, formatFlightForTransporte } from '@/lib/flight-data-mapper';
import { formatHotelForProposta, formatHotelForAlojamento } from '@/lib/hotel-data-mapper';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import type { GooglePlace } from '@/lib/hotel-data-mapper';
import type { AlojamentoData, TransporteData } from '@/lib/crm-types';

const TIPO_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  TEXTO: Type, SERVICO: Plane, ROTEIRO_DIA: Calendar, GALERIA: Image,
  INCLUSOS: CheckSquare, VALORES: DollarSign, DEPOIMENTO: Quote, CTA: MousePointer,
  VIDEO: Video, MAPA: Map, FAQ: HelpCircle, COUNTDOWN: Timer,
  ALOJAMENTO: Bed, TRANSPORTE: Car,
};
const TIPO_LABELS: Record<string, string> = {
  TEXTO: 'Texto', SERVICO: 'Servico', ROTEIRO_DIA: 'Roteiro', GALERIA: 'Galeria',
  INCLUSOS: 'Inclusos', VALORES: 'Valores', DEPOIMENTO: 'Depoimento', CTA: 'CTA',
  VIDEO: 'Video', MAPA: 'Mapa', FAQ: 'FAQ', COUNTDOWN: 'Countdown',
  ALOJAMENTO: 'Alojamento', TRANSPORTE: 'Transporte',
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
    default: return {};
  }
}

// Sortable block wrapper
const AI_SUPPORTED_TYPES = ['TEXTO', 'SERVICO', 'ROTEIRO_DIA', 'INCLUSOS', 'DEPOIMENTO', 'CTA'];

function SortableBlock({
  secao, index, total, onUpdate, onRemove, onMove, onGenerateAI, generating, onInsertAfter,
}: {
  secao: SecaoProposta; index: number; total: number;
  onUpdate: (conteudo: Record<string, unknown>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onGenerateAI: () => void;
  generating: boolean;
  onInsertAfter?: (tipo: string, conteudo: Record<string, unknown>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: secao.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const TipoIcon = TIPO_ICONS[secao.tipo] || Type;
  const canAI = AI_SUPPORTED_TYPES.includes(secao.tipo);

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none">
              <GripVertical className="w-4 h-4 text-[var(--t-text-muted)]" />
            </div>
            <TipoIcon className="w-4 h-4 text-[var(--t-green)]" />
            <span className="text-xs font-medium text-[var(--t-text)] flex-1">
              {TIPO_LABELS[secao.tipo] || secao.tipo}
            </span>
            {canAI && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-purple-400 hover:bg-purple-400/10 gap-1 text-[10px]"
                onClick={onGenerateAI} disabled={generating}>
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {generating ? 'Gerando...' : 'IA'}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[var(--t-text-secondary)]"
              onClick={() => onMove(-1)} disabled={index === 0}>
              <ChevronUp className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[var(--t-text-secondary)]"
              onClick={() => onMove(1)} disabled={index === total - 1}>
              <ChevronDown className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" onClick={onRemove}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <BlockRenderer tipo={secao.tipo} conteudo={secao.conteudo} onChange={onUpdate} onInsertAfter={onInsertAfter} />
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

export function PropostaEditor({ proposta: initialProposta, clientes, membros, isEdit }: Props) {
  const router = useRouter();
  const [proposta, setProposta] = useState<Proposta>(initialProposta);
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [flightModalOpen, setFlightModalOpen] = useState(false);
  const [hotelModalOpen, setHotelModalOpen] = useState(false);
  const [generatingAI, setGeneratingAI] = useState<Record<string, boolean>>({});
  const [generatingFull, setGeneratingFull] = useState(false);
  const [aiDestino, setAIDestino] = useState<Destino | null>(null);
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
          p.link_publico = `${window.location.origin}/p/${p.id.slice(0, 8)}`;
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
      p.link_publico = `${window.location.origin}/p/${p.id.slice(0, 8)}`;
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

  const removeSecao = (id: string) => {
    update(p => ({ ...p, secoes: p.secoes.filter(s => s.id !== id) }));
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    update(p => {
      const oldIndex = p.secoes.findIndex(s => s.id === active.id);
      const newIndex = p.secoes.findIndex(s => s.id === over.id);
      return { ...p, secoes: arrayMove(p.secoes, oldIndex, newIndex) };
    });
  };

  const handleEnviarWhatsApp = () => {
    const cliente = clientes.find(c => c.id === proposta.cliente_id);
    const phone = cliente?.whatsapp || cliente?.telefone_principal || '';
    const nome = proposta.cliente_nome || cliente?.nome_completo || 'Cliente';
    const msg = encodeURIComponent(
      `Ola, ${nome.split(' ')[0]}! Preparei a proposta da sua viagem. Da uma olhada:\n${proposta.link_publico}\n\nQualquer duvida, e so chamar!\n${proposta.rodape.nome_vendedor}`
    );
    window.open(`https://wa.me/55${phone.replace(/\D/g, '')}?text=${msg}`, '_blank');
  };

  const [generatingPDF, setGeneratingPDF] = useState(false);

  const handleDownloadPDF = async () => {
    setGeneratingPDF(true);
    try {
      const slug = proposta.id.slice(0, 8);
      // Open preview in hidden iframe, render, then capture
      const html2pdf = (await import('html2pdf.js')).default;
      const previewWindow = window.open(`/p/${slug}`, '_blank', 'width=800,height=600');
      if (!previewWindow) {
        // Fallback: generate from current page context
        alert('Permita popups para gerar o PDF, ou use o link publico.');
        setGeneratingPDF(false);
        return;
      }
      // Wait for page to load then capture
      previewWindow.onload = () => {
        setTimeout(() => {
          const body = previewWindow.document.body;
          html2pdf()
            .set({
              margin: 0,
              filename: `${proposta.numero || 'proposta'}.pdf`,
              image: { type: 'jpeg', quality: 0.95 },
              html2canvas: { scale: 2, useCORS: true, logging: false },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
              pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
            })
            .from(body)
            .save()
            .then(() => {
              previewWindow.close();
              setGeneratingPDF(false);
            });
        }, 2000); // Wait for images/fonts to load
      };
    } catch {
      alert('Erro ao gerar PDF');
      setGeneratingPDF(false);
    }
  };

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
    nova.link_publico = `${window.location.origin}/p/${nova.id.slice(0, 8)}`;
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
    const isDiscovery = proposta.visual.layout === 'DISCOVERY';
    if (isDiscovery) {
      const idaTransportes = formatFlightForTransporte(ida);
      const voltaTransportes = volta ? formatFlightForTransporte(volta) : [];
      const allTransportes = [...idaTransportes, ...voltaTransportes];
      update(p => ({
        ...p,
        secoes: [...p.secoes, ...allTransportes.map((conteudo, i) => ({
          id: generateId(),
          tipo: 'TRANSPORTE' as SecaoProposta['tipo'],
          ordem: p.secoes.length + i,
          visivel: true,
          conteudo,
        }))],
      }));
    } else {
      const combined: FlightOffer = volta
        ? { ...ida, returnFlights: volta.flights, returnDuration: volta.totalDuration, returnLayovers: volta.layovers }
        : ida;
      const conteudo = formatFlightForProposta(combined);
      update(p => ({
        ...p,
        secoes: [...p.secoes, {
          id: generateId(),
          tipo: 'SERVICO' as SecaoProposta['tipo'],
          ordem: p.secoes.length,
          visivel: true,
          conteudo,
        }],
      }));
    }
  };

  const handleHotelSelect = (place: GooglePlace) => {
    const isDiscovery = proposta.visual.layout === 'DISCOVERY';
    if (isDiscovery) {
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
    } else {
      const conteudo = formatHotelForProposta(place);
      update(p => ({
        ...p,
        secoes: [...p.secoes, {
          id: generateId(),
          tipo: 'SERVICO' as SecaoProposta['tipo'],
          ordem: p.secoes.length,
          visivel: true,
          conteudo,
        }],
      }));
    }
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
            onClick={handleDownloadPDF} disabled={generatingPDF}>
            {generatingPDF ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
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

      {/* Main area: Editor + Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[900px] mx-auto p-6 space-y-6">
            {/* Sections with drag-drop */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={proposta.secoes.map(s => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-[var(--t-text)]">Blocos da Proposta ({proposta.secoes.length})</h3>
                  </div>
                  {proposta.secoes.map((secao, idx) => (
                    <SortableBlock
                      key={secao.id}
                      secao={secao}
                      index={idx}
                      total={proposta.secoes.length}
                      onUpdate={c => updateSecao(secao.id, c)}
                      onRemove={() => removeSecao(secao.id)}
                      onMove={dir => moveSecao(secao.id, dir)}
                      onGenerateAI={() => handleGenerateAI(secao.id, secao.tipo)}
                      generating={!!generatingAI[secao.id]}
                      onInsertAfter={(tipo, conteudo) => insertSecaoAfter(secao.id, tipo, conteudo)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Add block toolbar */}
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
          clientes={clientes}
          membros={membros}
          onUpdate={update}
          onSetAIDestino={setAIDestino}
        />
      </div>

      {/* Modals */}
      <FlightSearchModal open={flightModalOpen} onClose={() => setFlightModalOpen(false)} onSelect={handleFlightSelect} />
      <HotelSearchModal open={hotelModalOpen} onClose={() => setHotelModalOpen(false)} onSelect={handleHotelSelect} />
    </div>
  );
}
