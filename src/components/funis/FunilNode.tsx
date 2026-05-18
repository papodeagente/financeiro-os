'use client';

/**
 * Custom React Flow node para o simulador de funis — design premium.
 *
 * Layout unificado em CARDS — cada tipo herda a mesma estrutura visual
 * (header colorido + ícone destacado + body com info real) e varia
 * apenas no acento de cor da marca + ícone. Sem placeholder bars cinza:
 * elementos do card sempre carregam informacao significativa.
 *
 * Estados visuais:
 *   - Selected: outline azul 2px com offset
 *   - Gargalo:  outline vermelho 2px tracejado com offset
 *
 * Ambos via CSS `outline` (nao afeta layout — diferente de ring/border).
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { AlertTriangle, Check } from 'lucide-react';
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

const H: React.CSSProperties = {
  width: 11, height: 11,
  background: '#3b82f6',
  border: '2.5px solid #ffffff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
  zIndex: 10,
};
const H_SEC: React.CSSProperties = {
  width: 9, height: 9,
  background: '#94a3b8',
  border: '2px solid #ffffff',
  boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
  zIndex: 10,
};

function Handles() {
  return (
    <>
      <Handle id="t-left"   type="target" position={Position.Left}   style={H} isConnectable />
      <Handle id="s-right"  type="source" position={Position.Right}  style={H} isConnectable />
      <Handle id="t-top"    type="target" position={Position.Top}    style={H_SEC} isConnectable />
      <Handle id="s-bottom" type="source" position={Position.Bottom} style={H_SEC} isConnectable />
    </>
  );
}

// ============================================================
// CardShell — wrapper unificado de todos os illustrations.
// rounded-2xl em todos, bordo branco fino, sombra multi-camada.
// ============================================================

interface CardShellProps {
  width?: number;
  brandColor: string;
  children: React.ReactNode;
  headerLabel?: string;
}

function CardShell({ width = 168, brandColor, children, headerLabel }: CardShellProps) {
  return (
    <div
      className="funil-node-card rounded-2xl overflow-hidden bg-white"
      style={{
        width,
        boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px -8px rgba(15,23,42,0.12)',
        border: '1px solid rgba(15,23,42,0.06)',
      }}
    >
      {headerLabel && (
        <div
          className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white"
          style={{ background: brandColor, letterSpacing: '0.1em' }}
        >
          {headerLabel}
        </div>
      )}
      {children}
    </div>
  );
}

// ============================================================
// IconBubble — bolha de icone reutilizavel, com glow sutil
// ============================================================

function IconBubble({ Icon, color, size = 56, iconSize = 26 }: {
  Icon: TipoInfo['icone'];
  color: string;
  size?: number;
  iconSize?: number;
}) {
  return (
    <div
      className="rounded-2xl flex items-center justify-center relative"
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, ${color} 0%, ${shade(color, -8)} 100%)`,
        boxShadow: `0 6px 18px ${color}40, inset 0 1px 0 rgba(255,255,255,0.35)`,
      }}
    >
      <Icon className="text-white" style={{ width: iconSize, height: iconSize }} strokeWidth={2} />
    </div>
  );
}

// Helper de cor: escurece/clareia hex em N% (aproximado, simples).
function shade(hex: string, percent: number): string {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round((percent / 100) * 255)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round((percent / 100) * 255)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round((percent / 100) * 255)));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// ============================================================
// Visual: Circle (fontes de tráfego, saídas) — circle premium 3D
// ============================================================

function CircleIllustration({ info, brandColor }: { info: TipoInfo; brandColor: string }) {
  const Icon = info.icone;
  return (
    <div
      className="rounded-full flex items-center justify-center relative"
      style={{
        width: 72, height: 72,
        background: `radial-gradient(circle at 30% 25%, ${shade(brandColor, 20)} 0%, ${brandColor} 50%, ${shade(brandColor, -15)} 100%)`,
        boxShadow: `
          0 8px 22px ${brandColor}55,
          inset 0 2px 4px rgba(255,255,255,0.4),
          inset 0 -2px 4px rgba(0,0,0,0.12)
        `,
      }}
    >
      <Icon className="text-white drop-shadow" style={{ width: 30, height: 30 }} strokeWidth={2.2} />
    </div>
  );
}

// ============================================================
// Visual: Page (landing, formulário, popup, checkout)
// Mock de browser limpo + headline ícone + CTA real
// ============================================================

function PageIllustration({ catColor, ctaText, info }: { catColor: string; ctaText: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <CardShell width={172} brandColor={catColor}>
      {/* Browser chrome */}
      <div className="h-[18px] bg-slate-50 flex items-center gap-1 px-2 border-b border-slate-100">
        <span className="w-[6px] h-[6px] rounded-full bg-rose-400" />
        <span className="w-[6px] h-[6px] rounded-full bg-amber-400" />
        <span className="w-[6px] h-[6px] rounded-full bg-emerald-400" />
        <div className="flex-1 ml-1.5 h-[8px] rounded-md bg-white border border-slate-200" />
      </div>
      {/* Hero */}
      <div className="px-3.5 py-3 flex flex-col items-center gap-2">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${catColor}25 0%, ${catColor}10 100%)` }}
        >
          <Icon className="w-[18px] h-[18px]" style={{ color: catColor }} strokeWidth={2.3} />
        </div>
        <div
          className="w-full py-1.5 rounded-md flex items-center justify-center text-white text-[8.5px] font-bold uppercase"
          style={{
            background: `linear-gradient(135deg, ${catColor} 0%, ${shade(catColor, -10)} 100%)`,
            letterSpacing: '0.6px',
            boxShadow: `0 2px 6px ${catColor}45`,
          }}
        >
          {ctaText}
        </div>
      </div>
    </CardShell>
  );
}

// ============================================================
// Visual: Page Success — check grande celebrativo
// ============================================================

function PageSuccessIllustration({ catColor }: { catColor: string }) {
  return (
    <CardShell width={160} brandColor={catColor}>
      <div className="h-[18px] bg-slate-50 flex items-center gap-1 px-2 border-b border-slate-100">
        <span className="w-[6px] h-[6px] rounded-full bg-rose-400" />
        <span className="w-[6px] h-[6px] rounded-full bg-amber-400" />
        <span className="w-[6px] h-[6px] rounded-full bg-emerald-400" />
      </div>
      <div className="px-3 py-4 flex flex-col items-center gap-1.5">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{
            background: `radial-gradient(circle, ${catColor}30 0%, ${catColor}10 100%)`,
            boxShadow: `inset 0 0 0 2px ${catColor}50`,
          }}
        >
          <Check className="w-7 h-7" style={{ color: catColor }} strokeWidth={3.2} />
        </div>
        <span className="text-[9px] font-semibold text-slate-600">Obrigado!</span>
      </div>
    </CardShell>
  );
}

// ============================================================
// Visual: Email — envelope grande + linha de assunto
// ============================================================

function EmailIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  return (
    <CardShell width={148} brandColor={brandColor} headerLabel="Email">
      <div className="px-3 py-3 flex flex-col items-center gap-2">
        <IconBubble Icon={info.icone} color={brandColor} size={56} iconSize={26} />
        <div className="w-full mt-1 space-y-1">
          <div className="flex items-center gap-1.5 text-[8px] text-slate-500">
            <span className="font-semibold text-slate-700">Para:</span>
            <span>cliente@email.com</span>
          </div>
          <div className="text-[8.5px] font-semibold text-slate-800 truncate">
            Sua proposta especial chegou
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ============================================================
// Visual: Chat — bolha + texto curto representando conversa
// ============================================================

function ChatIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  return (
    <CardShell width={148} brandColor={brandColor} headerLabel="Chat">
      <div className="px-3 py-3 flex flex-col gap-2">
        <div className="flex justify-center">
          <IconBubble Icon={info.icone} color={brandColor} size={48} iconSize={22} />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-start">
            <div
              className="text-[8px] px-2 py-1 rounded-xl rounded-bl-sm max-w-[80%]"
              style={{ background: '#f1f5f9', color: '#475569' }}
            >
              Olá! Posso ajudar?
            </div>
          </div>
          <div className="flex justify-end">
            <div
              className="text-[8px] px-2 py-1 rounded-xl rounded-br-sm max-w-[80%] text-white"
              style={{ background: brandColor }}
            >
              Quero saber mais
            </div>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ============================================================
// Visual: Content — header colorido + ícone + título
// ============================================================

function ContentIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <CardShell width={156} brandColor={brandColor}>
      <div
        className="h-[58px] flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${brandColor}18 0%, ${brandColor}06 100%)`,
        }}
      >
        <IconBubble Icon={Icon} color={brandColor} size={40} iconSize={20} />
      </div>
      <div className="px-3 py-2">
        <div className="text-[9px] font-semibold text-slate-700 leading-snug line-clamp-2">
          {info.label}
        </div>
      </div>
    </CardShell>
  );
}

// ============================================================
// Visual: Video — frame de vídeo realista + play
// ============================================================

function VideoIllustration({ brandColor }: { brandColor: string }) {
  return (
    <CardShell width={168} brandColor={brandColor}>
      <div
        className="h-[78px] flex items-center justify-center relative"
        style={{
          background: `linear-gradient(135deg, #0f172a 0%, #1e293b 100%)`,
        }}
      >
        {/* Play button */}
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center relative z-10"
          style={{
            background: `linear-gradient(135deg, ${brandColor} 0%, ${shade(brandColor, -15)} 100%)`,
            boxShadow: `0 6px 16px ${brandColor}65, inset 0 1px 0 rgba(255,255,255,0.3)`,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white" className="drop-shadow translate-x-[1px]">
            <polygon points="7 4 19 12 7 20" />
          </svg>
        </div>
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[4px] bg-black/30">
          <div
            className="h-full w-[42%]"
            style={{
              background: `linear-gradient(90deg, ${brandColor} 0%, ${shade(brandColor, 18)} 100%)`,
              boxShadow: `0 0 6px ${brandColor}90`,
            }}
          />
        </div>
        {/* Live dot */}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-red-500/90">
          <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
          <span className="text-[7px] font-bold text-white tracking-wider">LIVE</span>
        </div>
      </div>
    </CardShell>
  );
}

// ============================================================
// Visual: Phone — círculo grande + ringing rings
// ============================================================

function PhoneIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Ringing rings */}
      <div
        className="absolute rounded-full"
        style={{ width: 96, height: 96, border: `1px solid ${brandColor}22` }}
      />
      <div
        className="absolute rounded-full"
        style={{ width: 80, height: 80, border: `1px solid ${brandColor}35` }}
      />
      <IconBubble Icon={info.icone} color={brandColor} size={60} iconSize={28} />
    </div>
  );
}

// ============================================================
// Visual: Document — Quiz/proposta/lead-scoring com itens visíveis
// ============================================================

function DocumentIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <CardShell width={160} brandColor={brandColor}>
      {/* Header com ícone + título */}
      <div
        className="px-3 py-2.5 flex items-center gap-2"
        style={{ background: `linear-gradient(135deg, ${brandColor}14 0%, ${brandColor}04 100%)` }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${brandColor} 0%, ${shade(brandColor, -12)} 100%)`,
            boxShadow: `0 3px 8px ${brandColor}45`,
          }}
        >
          <Icon className="w-4 h-4 text-white" strokeWidth={2.3} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold text-slate-700 truncate leading-tight">
            {info.label}
          </div>
          <div className="text-[7.5px] uppercase tracking-wider mt-0.5" style={{ color: brandColor }}>
            Etapa
          </div>
        </div>
      </div>
      {/* Body — 3 itens com check */}
      <div className="px-3 py-2 space-y-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full flex items-center justify-center shrink-0"
              style={{ background: `${brandColor}20` }}
            >
              <Check className="w-2 h-2" style={{ color: brandColor }} strokeWidth={3.5} />
            </div>
            <div
              className="flex-1 h-[3px] rounded-full"
              style={{ background: `linear-gradient(90deg, ${brandColor}30 0%, ${brandColor}08 100%)` }}
            />
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ============================================================
// Visual: Diamond — pagamento/upsell, formato losango premium
// ============================================================

function DiamondIllustration({ brandColor, info }: { brandColor: string; info: TipoInfo }) {
  const Icon = info.icone;
  return (
    <div className="relative flex items-center justify-center" style={{ width: 72, height: 72 }}>
      {/* Glow externo */}
      <div
        className="absolute rounded-2xl"
        style={{
          width: 60, height: 60,
          background: `radial-gradient(circle, ${brandColor}40 0%, transparent 70%)`,
          transform: 'rotate(45deg) scale(1.4)',
        }}
      />
      {/* Losango */}
      <div
        className="rotate-45 rounded-2xl flex items-center justify-center"
        style={{
          width: 56, height: 56,
          background: `linear-gradient(135deg, ${shade(brandColor, 12)} 0%, ${brandColor} 50%, ${shade(brandColor, -15)} 100%)`,
          boxShadow: `
            0 8px 22px ${brandColor}55,
            inset 0 2px 4px rgba(255,255,255,0.4),
            inset 0 -2px 4px rgba(0,0,0,0.12)
          `,
        }}
      >
        <Icon className="text-white -rotate-45" style={{ width: 26, height: 26 }} strokeWidth={2.4} />
      </div>
    </div>
  );
}

// ============================================================
// Result Badge
// ============================================================

function ResultBadge({ r }: { r: NodeResultado }) {
  if (r.entrantes === 0) return null;
  return (
    <div className="mt-1 px-2 py-[3px] rounded-full bg-white border border-slate-200 flex items-center gap-1.5 text-[9px] whitespace-nowrap"
      style={{ boxShadow: '0 2px 6px rgba(15,23,42,0.08)' }}
    >
      <span className="text-slate-400 tabular-nums">{r.entrantes.toLocaleString('pt-BR')}</span>
      <span className="text-slate-300">→</span>
      <span className="font-bold text-emerald-600 tabular-nums">{r.convertidos.toLocaleString('pt-BR')}</span>
      {r.receita > 0 && (
        <>
          <span className="text-slate-300">·</span>
          <span className="font-semibold text-emerald-600 tabular-nums">{formatBRL(r.receita)}</span>
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

  const info: TipoInfo = tInfo ?? {
    tipo: data.tipo,
    label: data.label,
    icone: catInfo.icon,
  };

  // Outline (gargalo / selected) — desenhado VIA box-shadow inset spread
  // pra que respeite o border-radius do card sem vazar nas extremidades.
  // Tracejado pro gargalo destaca a urgencia sem competir com a seta.
  const stateStyle: React.CSSProperties = gargalo
    ? { boxShadow: '0 0 0 3px #ffffff, 0 0 0 5px #ef4444, 0 0 24px -4px #ef444460' }
    : selected
      ? { boxShadow: '0 0 0 3px #ffffff, 0 0 0 5px #3b82f6, 0 0 20px -4px #3b82f660' }
      : {};

  return (
    <div className="relative flex flex-col items-center" style={{ minWidth: 80 }}>
      <Handles />

      {/* Container do illustration — box-shadow externo (gargalo/selected)
          aplica diretamente sem alterar layout dos handles. */}
      <div className="rounded-2xl transition-all duration-200" style={stateStyle}>
        {visual === 'circle' && <CircleIllustration info={info} brandColor={brandColor} />}
        {visual === 'page' && <PageIllustration catColor={catInfo.color} ctaText={ctaText} info={info} />}
        {visual === 'page-success' && <PageSuccessIllustration catColor={catInfo.color} />}
        {visual === 'email' && <EmailIllustration brandColor={brandColor} info={info} />}
        {visual === 'chat' && <ChatIllustration brandColor={brandColor} info={info} />}
        {visual === 'content' && <ContentIllustration brandColor={brandColor} info={info} />}
        {visual === 'video' && <VideoIllustration brandColor={brandColor} />}
        {visual === 'phone' && <PhoneIllustration brandColor={brandColor} info={info} />}
        {visual === 'document' && <DocumentIllustration brandColor={brandColor} info={info} />}
        {visual === 'diamond' && <DiamondIllustration brandColor={brandColor} info={info} />}
      </div>

      {/* Label + badges absolute pra nao inflar bounding box */}
      <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none" style={{ top: '100%', paddingTop: 10 }}>
        <p className="text-[11px] font-semibold text-slate-700 text-center leading-tight max-w-[180px] whitespace-nowrap">
          {data.label}
        </p>

        {gargalo && (
          <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-[8.5px] font-bold text-red-600 uppercase tracking-wider">
            <AlertTriangle className="w-2.5 h-2.5" /> Gargalo
          </div>
        )}

        {r && r.entrantes > 0 && <ResultBadge r={r} />}
      </div>
    </div>
  );
}

export const FunilNode = memo(FunilNodeInner);
