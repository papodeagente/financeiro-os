/**
 * Mapa categoria → cor + label + ícone + lista de tipos que pertencem a ela.
 * Usado pelo FunilNode (coloração), BibliotecaNodes (agrupamento) e
 * PainelConfigNode (campos por categoria).
 */

import {
  type LucideIcon,
  Megaphone, Mouse, Mail, Filter as FunilIcon,
  FileText, DollarSign, ArrowUpCircle, Flag,
} from 'lucide-react';
import type { CategoriaNode, TipoNode } from '@/lib/funil-types';

export interface CategoriaInfo {
  label: string;
  color: string;
  icon: LucideIcon;
  tipos: { tipo: TipoNode; label: string; icone: LucideIcon }[];
}

export const CATEGORIA_INFO: Record<CategoriaNode, CategoriaInfo> = {
  trafego: {
    label: 'Tráfego',
    color: '#8b5cf6',
    icon: Megaphone,
    tipos: [
      { tipo: 'ads_meta', label: 'Meta Ads', icone: Megaphone },
      { tipo: 'ads_google', label: 'Google Ads', icone: Megaphone },
      { tipo: 'ads_tiktok', label: 'TikTok Ads', icone: Megaphone },
      { tipo: 'seo_organico', label: 'SEO Orgânico', icone: Megaphone },
      { tipo: 'indicacao', label: 'Indicação', icone: Megaphone },
    ],
  },
  captura: {
    label: 'Captura',
    color: '#0ea5e9',
    icon: Mouse,
    tipos: [
      { tipo: 'landing_page', label: 'Landing page', icone: Mouse },
      { tipo: 'formulario', label: 'Formulário', icone: Mouse },
      { tipo: 'lead_magnet', label: 'Lead magnet', icone: Mouse },
    ],
  },
  nutricao: {
    label: 'Nutrição',
    color: '#06b6d4',
    icon: Mail,
    tipos: [
      { tipo: 'email_sequencia', label: 'Sequência de e-mail', icone: Mail },
      { tipo: 'whatsapp_ativo', label: 'WhatsApp ativo', icone: Mail },
      { tipo: 'remarketing', label: 'Remarketing', icone: Mail },
    ],
  },
  qualificacao: {
    label: 'Qualificação',
    color: '#f59e0b',
    icon: FunilIcon,
    tipos: [
      { tipo: 'sdr_ligacao', label: 'SDR ligação', icone: FunilIcon },
      { tipo: 'quiz', label: 'Quiz', icone: FunilIcon },
      { tipo: 'agendamento', label: 'Agendamento', icone: FunilIcon },
    ],
  },
  proposta: {
    label: 'Proposta',
    color: '#3b82f6',
    icon: FileText,
    tipos: [
      { tipo: 'apresentacao', label: 'Apresentação', icone: FileText },
      { tipo: 'proposta_enviada', label: 'Proposta enviada', icone: FileText },
      { tipo: 'followup', label: 'Follow-up', icone: FileText },
    ],
  },
  fechamento: {
    label: 'Fechamento',
    color: '#10b981',
    icon: DollarSign,
    tipos: [
      { tipo: 'contrato', label: 'Contrato', icone: DollarSign },
      { tipo: 'pagamento', label: 'Pagamento', icone: DollarSign },
      { tipo: 'venda_direta', label: 'Venda direta', icone: DollarSign },
    ],
  },
  upsell: {
    label: 'Upsell',
    color: '#ec4899',
    icon: ArrowUpCircle,
    tipos: [
      { tipo: 'upsell_produto', label: 'Upsell produto', icone: ArrowUpCircle },
      { tipo: 'cross_sell', label: 'Cross-sell', icone: ArrowUpCircle },
      { tipo: 'recompra_indicacao', label: 'Recompra/Indicação', icone: ArrowUpCircle },
    ],
  },
  saida: {
    label: 'Saída',
    color: '#6b7280',
    icon: Flag,
    tipos: [
      { tipo: 'cliente_final', label: 'Cliente final', icone: Flag },
      { tipo: 'churn', label: 'Churn', icone: Flag },
      { tipo: 'perdido', label: 'Perdido', icone: Flag },
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
