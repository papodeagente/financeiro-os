/**
 * Mapa categoria → cor + label + ícone + lista de tipos que pertencem a ela.
 * Cada tipo agora tem um ícone específico e uma cor de marca para as
 * ilustrações ricas no canvas (FunilNode.tsx).
 */

import {
  type LucideIcon,
  Megaphone, Mouse, Mail, Filter as FunilIcon,
  FileText, DollarSign, ArrowUpCircle, Flag,
  Search, Globe, Users, Music, CirclePlay, Briefcase, Link2,
  Layout, ClipboardList, Gift, CheckCircle, Maximize2,
  MessageCircle, Smartphone, RotateCcw, BookOpen,
  Phone, BarChart3, CalendarCheck, Video,
  FileCheck, ShoppingCart, CreditCard,
  TrendingUp, ShoppingBag, RefreshCw,
  UserCheck, UserX,
} from 'lucide-react';
import type { CategoriaNode, TipoNode } from '@/lib/funil-types';

export interface TipoInfo {
  tipo: TipoNode;
  label: string;
  icone: LucideIcon;
  /** Cor de marca específica do tipo (usado nos nós circulares de tráfego, etc.) */
  brandColor?: string;
  /** Estilo visual: 'circle' | 'page' | 'email' | 'chat' | 'content' | 'document' | 'diamond' | 'video' */
  visual?: 'circle' | 'page' | 'page-success' | 'email' | 'chat' | 'content' | 'document' | 'diamond' | 'video' | 'phone';
  /** Texto do CTA para nodes tipo 'page' */
  ctaText?: string;
}

export interface CategoriaInfo {
  label: string;
  color: string;
  icon: LucideIcon;
  tipos: TipoInfo[];
}

export const CATEGORIA_INFO: Record<CategoriaNode, CategoriaInfo> = {
  trafego: {
    label: 'Tráfego',
    color: '#8b5cf6',
    icon: Megaphone,
    tipos: [
      { tipo: 'ads_meta', label: 'Meta Ads', icone: Megaphone, brandColor: '#1877F2', visual: 'circle' },
      { tipo: 'ads_google', label: 'Google Ads', icone: Search, brandColor: '#EA4335', visual: 'circle' },
      { tipo: 'ads_tiktok', label: 'TikTok Ads', icone: Music, brandColor: '#010101', visual: 'circle' },
      { tipo: 'youtube_ads', label: 'YouTube Ads', icone: CirclePlay, brandColor: '#FF0000', visual: 'circle' },
      { tipo: 'linkedin_ads', label: 'LinkedIn Ads', icone: Briefcase, brandColor: '#0A66C2', visual: 'circle' },
      { tipo: 'seo_organico', label: 'SEO Orgânico', icone: Globe, brandColor: '#10b981', visual: 'circle' },
      { tipo: 'indicacao', label: 'Indicação', icone: Users, brandColor: '#06b6d4', visual: 'circle' },
      { tipo: 'afiliados', label: 'Afiliados', icone: Link2, brandColor: '#22c55e', visual: 'circle' },
    ],
  },
  captura: {
    label: 'Captura',
    color: '#0ea5e9',
    icon: Mouse,
    tipos: [
      { tipo: 'landing_page', label: 'Landing page', icone: Layout, visual: 'page', ctaText: 'CALL TO ACTION' },
      { tipo: 'formulario', label: 'Formulário', icone: ClipboardList, visual: 'page', ctaText: 'ENVIAR' },
      { tipo: 'popup', label: 'Pop-up', icone: Maximize2, visual: 'page', ctaText: 'SIM, QUERO!' },
      { tipo: 'lead_magnet', label: 'Lead magnet', icone: Gift, visual: 'content' },
      { tipo: 'pagina_obrigado', label: 'Pág. obrigado', icone: CheckCircle, visual: 'page-success' },
    ],
  },
  nutricao: {
    label: 'Nutrição',
    color: '#06b6d4',
    icon: Mail,
    tipos: [
      { tipo: 'email_sequencia', label: 'Sequência de e-mail', icone: Mail, visual: 'email', brandColor: '#3b82f6' },
      { tipo: 'whatsapp_ativo', label: 'WhatsApp ativo', icone: MessageCircle, visual: 'chat', brandColor: '#25D366' },
      { tipo: 'sms', label: 'SMS', icone: Smartphone, visual: 'chat', brandColor: '#6366f1' },
      { tipo: 'remarketing', label: 'Remarketing', icone: RotateCcw, visual: 'circle', brandColor: '#8b5cf6' },
      { tipo: 'material_rico', label: 'Material rico', icone: BookOpen, visual: 'content', brandColor: '#8b5cf6' },
    ],
  },
  qualificacao: {
    label: 'Qualificação',
    color: '#f59e0b',
    icon: FunilIcon,
    tipos: [
      { tipo: 'sdr_ligacao', label: 'SDR ligação', icone: Phone, visual: 'phone', brandColor: '#0ea5e9' },
      { tipo: 'quiz', label: 'Quiz / Survey', icone: BarChart3, visual: 'document', brandColor: '#f59e0b' },
      { tipo: 'agendamento', label: 'Agendamento', icone: CalendarCheck, visual: 'document', brandColor: '#3b82f6' },
      { tipo: 'webinar', label: 'Webinar', icone: Video, visual: 'video', brandColor: '#ef4444' },
    ],
  },
  proposta: {
    label: 'Proposta',
    color: '#3b82f6',
    icon: FileText,
    tipos: [
      { tipo: 'apresentacao', label: 'Apresentação', icone: FileText, visual: 'document', brandColor: '#3b82f6' },
      { tipo: 'proposta_enviada', label: 'Proposta enviada', icone: FileText, visual: 'document', brandColor: '#3b82f6' },
      { tipo: 'followup', label: 'Follow-up', icone: RefreshCw, visual: 'email', brandColor: '#6366f1' },
      { tipo: 'video_vendas', label: 'Vídeo de vendas', icone: Video, visual: 'video', brandColor: '#ef4444' },
    ],
  },
  fechamento: {
    label: 'Fechamento',
    color: '#10b981',
    icon: DollarSign,
    tipos: [
      { tipo: 'contrato', label: 'Contrato', icone: FileCheck, visual: 'document', brandColor: '#10b981' },
      { tipo: 'pagamento', label: 'Pagamento', icone: CreditCard, visual: 'diamond', brandColor: '#10b981' },
      { tipo: 'checkout', label: 'Checkout', icone: ShoppingCart, visual: 'page', ctaText: 'COMPRAR AGORA' },
      { tipo: 'venda_direta', label: 'Venda direta', icone: DollarSign, visual: 'diamond', brandColor: '#10b981' },
    ],
  },
  upsell: {
    label: 'Upsell',
    color: '#ec4899',
    icon: ArrowUpCircle,
    tipos: [
      { tipo: 'upsell_produto', label: 'Upsell produto', icone: TrendingUp, visual: 'diamond', brandColor: '#f59e0b' },
      { tipo: 'cross_sell', label: 'Cross-sell', icone: ShoppingBag, visual: 'diamond', brandColor: '#ec4899' },
      { tipo: 'recompra_indicacao', label: 'Recompra/Indicação', icone: RefreshCw, visual: 'circle', brandColor: '#8b5cf6' },
    ],
  },
  saida: {
    label: 'Saída',
    color: '#6b7280',
    icon: Flag,
    tipos: [
      { tipo: 'cliente_final', label: 'Cliente final', icone: UserCheck, visual: 'circle', brandColor: '#10b981' },
      { tipo: 'churn', label: 'Churn', icone: UserX, visual: 'circle', brandColor: '#ef4444' },
      { tipo: 'perdido', label: 'Perdido', icone: Flag, visual: 'circle', brandColor: '#6b7280' },
    ],
  },
};

export const CATEGORIAS_ORDEM: CategoriaNode[] = [
  'trafego', 'captura', 'nutricao', 'qualificacao',
  'proposta', 'fechamento', 'upsell', 'saida',
];

/**
 * Dado um tipo, retorna a categoria à qual pertence.
 */
export function categoriaDoTipo(tipo: TipoNode): CategoriaNode {
  for (const [cat, info] of Object.entries(CATEGORIA_INFO)) {
    if (info.tipos.some(t => t.tipo === tipo)) return cat as CategoriaNode;
  }
  return 'trafego';
}

/**
 * Dado um tipo, retorna seu TipoInfo completo (label, ícone, visual, cor).
 */
export function tipoInfo(tipo: TipoNode): TipoInfo | undefined {
  for (const info of Object.values(CATEGORIA_INFO)) {
    const found = info.tipos.find(t => t.tipo === tipo);
    if (found) return found;
  }
  return undefined;
}
