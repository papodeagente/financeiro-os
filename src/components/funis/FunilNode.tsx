'use client';

/**
 * Custom React Flow node para o simulador de funis — versão visual rica.
 *
 * Cada tipo de node renderiza uma ilustração distinta:
 *  - circle: ícone circular colorido (fontes de tráfego, saídas)
 *  - page: mock de browser com CTA (landing pages, checkout)
 *  - page-success: mock de browser com checkmark (pág. obrigado)
 *  - email: envelope estilizado
 *  - chat: bolha de conversa (WhatsApp, SMS)
 *  - content: card de conteúdo (blog, material rico)
 *  - video: player de vídeo (webinar, vídeo de vendas)
 *  - phone: ícone de ligação
 *  - document: clipboard/documento
 *  - diamond: losango (conversão/pagamento)
 *
 * Referência visual: Funnelytics-style com mockups reais.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import type { CategoriaNode, NodeConfig, NodeResultado, TipoNode } from '@/lib/funil-types';
import { formatBRL } from '@/lib/utils';
import { CATEGORIA_INFO, tipoInfo, type TipoInfo } from './categorias';

interface FunilNodeData extends Record<string, unknown> {
  tipo: TipoNode;
  categoria: CategoriaNode;
  label: string;
  config: NodeConfig;
  resultado?: NodeResultado;
}

type FunilNodeType = Node<FunilNodeData, 'funilNode'>;

// ============================================================
// Handles
// ============================================================

/** Handle principal (esquerda/direita): mais visivel */
const H: React.CSSProperties = {
  width: 10,
  height: 10,
  background: '#3b82f6',
  border: '2px solid #ffffff',
  zIndex: 10,
};
/** Handle secundario (cima/baixo): menor, sutil */
const H_SEC: React.CSSProperties = {
  width: 8,
  height: 8,
  background: '#94a3b8',
  border: '2px solid #ffffff',
  zIndex: 10,
};

function Handles() {
  return (
    <>
      {/* Fluxo horizontal: source = direita, target = esquerda */}
      <Handle id="t-left"   type="target" position={Position.Left}   style={H} isConnectable />
      <Handle id="s-right"  type="source" position={Position.Right}  style={H} isConnectable />
      {/* Fluxo vertical: source = baixo, target = cima */}
      <Handle id="t-top"    type="target" position={Position.Top}    style={H_SEC} isConnectable />
      <Handle id="s-bottom" type="source" position={Position.Bottom} style={H_SEC} isConnectable />
    </>
  );
}

// ============================================================
// Visual: Circle (fontes de tráfego, saídas)
// ============================================================

function CircleIllustration({ info, brandColor }: { info: TipoInfo; brandColor: string }) {
  const Icon = info.icone;
  return (
    <div className="flex flex-col items-center">
      <div
        className="w-[56px] h-[56px] rounded-full flex items-center justify-center"
        style={{ background: brandColor, boxShadow: `0 4px 14px ${brandColor}40` }}
      >
        <Icon className="w-6 h-6 text-white" strokeWidth={2} />
      </div>
    </div>
  );
}

// ============================================================
// Visual: Page (landing, formulário, popup, checkout)
// ============================================================

function PageIllustration({ catColor, ctaText }: { catColor: string; ctaText: string }) {
  return (
    <div className="w-[148px] rounded-lg overflow-hidden bg-white" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
      {/* Browser chrome */}
      <div className="h-[16px] bg-[#f1f3f5] flex items-center gap-[3px] px-[6px] border-b border-[#e5e7eb]">
        <span className="w-[5px] h-[5px] rounded-full bg-[#ff6b6b]" />
        <span className="w-[5px] h-[5px] rounded-full bg-[#ffd43b]" />
        <span className="w-[5px] h-[5px] rounded-full bg-[#51cf66]" />
        <div className="flex-1 ml-1 h-[6px] rounded-[2px] bg-[#e5e7eb]" />
      </div>
      {/* Content */}
      <div className="px-3 py-2.5 space-y-[5px]">
        <div className="h-[5px] w-[60%] bg-[#dee2e6] rounded-sm" />
        <div className="h-[3px] w-full bg-[#f1f3f5] rounded-sm" />
        <div className="h-[3px] w-[85%] bg-[#f1f3f5] rounded-sm" />
        <div className="h-[3px] w-[70%] bg-[#f1f3f5] rounded-sm" />
        <div
          className="mt-1 h-[16px] rounded-[3px] flex items-center justify-center"
          style={{ background: catColor }}
        >
          <span className="text-[6px] font-bold text-white tracking-[0.5px] uppercase">{ctaText}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Visual: Page Success (página de obrigado)
// ============================================================

function PageSuccessIllustration({ catColor }: { catColor: string }) {
  return (
    <div className="w-[148px] rounded-lg overflow-hidden bg-white" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
      <div className="h-[16px] bg-[#f1f3f5] flex items-center gap-[3px] px-[6px] border-b border-[#e5e7eb]">
        <span className="w-[5px] h-[5px] rounded-full bg-[#ff6b6b]" />
        <span className="w-[5px] h-[5px] rounded-full bg-[#ffd43b]" />
        <span className="w-[5px] h-[5px] rounded-full bg-[#51cf66]" />
        <div className="flex-1 ml-1 h-[6px] rounded-[2px] bg-[#e5e7eb]" />
      </div>
      <div className="px-3 py-3 flex flex-col items-center gap-1.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: catColor + '20' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={catColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div className="h-[4px] w-[50%] bg-[#dee2e6] rounded-sm" />
        <div className="h-[3px] w-[80%] bg-[#f1f3f5] rounded-sm" />
      </div>
    </div>
  );
}

// ============================================================
// Visual: Email (envelope estilizado)
// ============================================================

function EmailIllustration({ brandColor }: { brandColor: string }) {
  return (
    <div className="w-[120px] rounded-xl overflow-hidden bg-white" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
      <div className="p-3 flex flex-col items-center gap-2">
        <div
          className="w-12 h-9 rounded-md flex items-center justify-center relative overflow-hidden"
          style={{ background: brandColor }}
        >
          {/* Envelope flap */}
          <svg width="48" height="36" viewBox="0 0 48 36" className="absolute inset-0">
            <path d="M0 4 L24 20 L48 4" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
          </svg>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        </div>
        <div className="w-full space-y-[3px]">
          <div className="h-[3px] w-full bg-[#f1f3f5] rounded-sm" />
          <div className="h-[3px] w-[70%] bg-[#f1f3f5] rounded-sm" />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Visual: Chat (WhatsApp, SMS, chatbot)
// ============================================================

function ChatIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <div className="w-[120px] rounded-xl overflow-hidden bg-white" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
      <div className="p-3 flex flex-col items-center gap-2">
        <div className="relative">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: brandColor, boxShadow: `0 3px 10px ${brandColor}35` }}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
        {/* Chat bubbles */}
        <div className="w-full space-y-[3px]">
          <div className="flex justify-end">
            <div className="h-[8px] w-[60%] rounded-full" style={{ background: brandColor + '25' }} />
          </div>
          <div className="flex justify-start">
            <div className="h-[8px] w-[45%] bg-[#f1f3f5] rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Visual: Content (blog, material rico, lead magnet)
// ============================================================

function ContentIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <div className="w-[130px] rounded-xl overflow-hidden bg-white" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
      <div className="h-[40px] flex items-center justify-center" style={{ background: brandColor + '15' }}>
        <Icon className="w-5 h-5" style={{ color: brandColor }} />
      </div>
      <div className="px-3 py-2 space-y-[3px]">
        <div className="h-[4px] w-[70%] bg-[#dee2e6] rounded-sm" />
        <div className="h-[3px] w-full bg-[#f1f3f5] rounded-sm" />
        <div className="h-[3px] w-[85%] bg-[#f1f3f5] rounded-sm" />
      </div>
    </div>
  );
}

// ============================================================
// Visual: Video (webinar, vídeo de vendas)
// ============================================================

function VideoIllustration({ brandColor }: { brandColor: string }) {
  return (
    <div className="w-[148px] rounded-lg overflow-hidden bg-white" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
      <div className="h-[70px] bg-[#1a1a2e] flex items-center justify-center relative">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: brandColor, boxShadow: `0 3px 10px ${brandColor}50` }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <polygon points="6 3 20 12 6 21" />
          </svg>
        </div>
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#333]">
          <div className="h-full w-[35%] rounded-r-sm" style={{ background: brandColor }} />
        </div>
      </div>
      <div className="px-3 py-1.5 space-y-[3px]">
        <div className="h-[4px] w-[60%] bg-[#dee2e6] rounded-sm" />
        <div className="h-[3px] w-[80%] bg-[#f1f3f5] rounded-sm" />
      </div>
    </div>
  );
}

// ============================================================
// Visual: Phone (SDR ligação)
// ============================================================

function PhoneIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <div className="flex flex-col items-center">
      <div
        className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center"
        style={{ background: brandColor, boxShadow: `0 4px 14px ${brandColor}40` }}
      >
        <Icon className="w-6 h-6 text-white" />
      </div>
    </div>
  );
}

// ============================================================
// Visual: Document (proposta, contrato, lead scoring)
// ============================================================

function DocumentIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <div className="w-[110px] rounded-lg overflow-hidden bg-white" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <div
          className="w-7 h-7 rounded flex items-center justify-center shrink-0"
          style={{ background: brandColor + '18' }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: brandColor }} />
        </div>
        <div className="flex-1 space-y-[3px]">
          <div className="h-[3px] w-full bg-[#dee2e6] rounded-sm" />
          <div className="h-[2px] w-[70%] bg-[#f1f3f5] rounded-sm" />
        </div>
      </div>
      <div className="px-3 py-2 space-y-[3px]">
        <div className="h-[2px] w-full bg-[#f1f3f5] rounded-sm" />
        <div className="h-[2px] w-[85%] bg-[#f1f3f5] rounded-sm" />
        <div className="h-[2px] w-[60%] bg-[#f1f3f5] rounded-sm" />
      </div>
    </div>
  );
}

// ============================================================
// Visual: Diamond (pagamento, upsell, venda direta)
// ============================================================

function DiamondIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <div className="flex flex-col items-center">
      <div
        className="w-[52px] h-[52px] rotate-45 rounded-xl flex items-center justify-center"
        style={{ background: brandColor, boxShadow: `0 4px 14px ${brandColor}40` }}
      >
        <Icon className="w-6 h-6 text-white -rotate-45" strokeWidth={2.5} />
      </div>
    </div>
  );
}

// ============================================================
// Result Badge (aparece quando node foi simulado)
// ============================================================

function ResultBadge({ r }: { r: NodeResultado }) {
  if (r.entrantes === 0) return null;
  return (
    <div className="mt-1 px-2 py-[2px] rounded-full bg-white shadow-md border border-[#e5e7eb] flex items-center gap-1.5 text-[8px] whitespace-nowrap">
      <span className="text-[#94a3b8]">{r.entrantes.toLocaleString('pt-BR')}</span>
      <span className="text-[#cbd5e1]">→</span>
      <span className="font-bold text-[#10b981]">{r.convertidos.toLocaleString('pt-BR')}</span>
      {r.receita > 0 && (
        <>
          <span className="text-[#cbd5e1]">·</span>
          <span className="font-semibold text-[#10b981]">{formatBRL(r.receita)}</span>
        </>
      )}
    </div>
  );
}

// ============================================================
// Main node
// ============================================================

function FunilNodeInner({ data, selected }: NodeProps<FunilNodeType>) {
  const catInfo = CATEGORIA_INFO[data.categoria];
  const tInfo = tipoInfo(data.tipo);
  const visual = tInfo?.visual ?? 'document';
  const brandColor = tInfo?.brandColor ?? catInfo.color;
  const ctaText = tInfo?.ctaText ?? 'SAIBA MAIS';

  const r = data.resultado;
  const gargalo = r?.is_gargalo;

  // Use a fallback TipoInfo if tipoInfo() returns undefined
  const info: TipoInfo = tInfo ?? {
    tipo: data.tipo,
    label: data.label,
    icone: catInfo.icon,
  };

  return (
    <div className="relative flex flex-col items-center" style={{ minWidth: 80 }}>
      <Handles />

      {/* Gargalo ring — this is the measured part for handle centering */}
      <div className={`relative ${gargalo ? 'ring-2 ring-red-500 ring-offset-2 rounded-2xl' : ''} ${selected ? 'ring-2 ring-blue-400 ring-offset-2 rounded-2xl' : ''}`}>
        {visual === 'circle' && <CircleIllustration info={info} brandColor={brandColor} />}
        {visual === 'page' && <PageIllustration catColor={catInfo.color} ctaText={ctaText} />}
        {visual === 'page-success' && <PageSuccessIllustration catColor={catInfo.color} />}
        {visual === 'email' && <EmailIllustration brandColor={brandColor} />}
        {visual === 'chat' && <ChatIllustration brandColor={brandColor} info={info} />}
        {visual === 'content' && <ContentIllustration brandColor={brandColor} info={info} />}
        {visual === 'video' && <VideoIllustration brandColor={brandColor} />}
        {visual === 'phone' && <PhoneIllustration brandColor={brandColor} info={info} />}
        {visual === 'document' && <DocumentIllustration brandColor={brandColor} info={info} />}
        {visual === 'diamond' && <DiamondIllustration brandColor={brandColor} info={info} />}
      </div>

      {/* Label + badges: absolute so they don't inflate the node's bounding box.
          Handles center on the illustration only. */}
      <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none" style={{ top: '100%', paddingTop: 6 }}>
        <p className="text-[10px] font-semibold text-[#374151] text-center leading-tight max-w-[160px] whitespace-nowrap">
          {data.label}
        </p>

        {/* Gargalo badge */}
        {gargalo && (
          <div className="mt-0.5 flex items-center gap-0.5 text-[8px] font-bold text-red-600 uppercase tracking-wider">
            <AlertTriangle className="w-2.5 h-2.5" /> Gargalo
          </div>
        )}

        {/* Resultado da simulação */}
        {r && r.entrantes > 0 && <ResultBadge r={r} />}
      </div>
    </div>
  );
}

export const FunilNode = memo(FunilNodeInner);
