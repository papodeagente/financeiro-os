// Pedidos de aprovação e alçadas: regras puras (05/11/2026). O banco fica em
// ./aprovacoes-servidor.
//
// Passar de um limite vira um pedido com motivo: quem tem o direito aprova
// ou recusa, e quem pediu nunca aprova o próprio.

import { perfilCanonico } from './permissoes';

export const STATUS_PEDIDO = ['PENDENTE', 'APROVADO', 'RECUSADO', 'EXECUTADO', 'EXPIRADO'] as const;
export type StatusPedido = (typeof STATUS_PEDIDO)[number];

export const ROTULO_STATUS_PEDIDO: Record<StatusPedido, string> = {
  PENDENTE: 'Aguardando',
  APROVADO: 'Aprovado',
  RECUSADO: 'Recusado',
  EXECUTADO: 'Aprovado e feito',
  EXPIRADO: 'Expirado',
};

export interface DecisaoRegistrada {
  usuario_id: string;
  usuario_nome: string;
  decisao: 'aprovar' | 'recusar';
  motivo: string;
  em: string;
}

export interface PedidoAprovacao {
  id: string;
  tipo: string;
  alvo_tabela: string;
  alvo_id: string;
  descricao: string;
  payload: Record<string, unknown>;
  valor_centavos: number;
  solicitante_id: string;
  solicitante_nome: string;
  status: StatusPedido;
  alcada_id: string | null;
  aprovadores: string[];
  niveis: number;
  decisoes: DecisaoRegistrada[];
  motivo: string;
  motivo_decisao: string;
  erro_execucao: string;
  resultado: Record<string, unknown> | null;
  expira_em: string;
  created_at: string;
  decidido_em: string | null;
  executado_em: string | null;
}

export interface Alcada {
  id: string;
  nome: string;
  prioridade: number;
  ativo: boolean;
  categoria_id: string | null;
  centro_custo: string | null;
  valor_min_centavos: number | null;
  valor_max_centavos: number | null;
  /** 'usuario:<id>', 'grupo:<id>' ou 'papel:ADMIN'. Vazio = quem tiver o direito. */
  aprovadores: string[];
  niveis: number;
}

export interface TituloParaAlcada {
  valor_centavos: number;
  categoria_id?: string | null;
  centro_custo?: string | null;
}

/** A primeira alçada ativa (menor prioridade) que casa com o título. */
export function escolherAlcada(alcadas: readonly Alcada[], t: TituloParaAlcada): Alcada | null {
  const ordenadas = [...alcadas].filter(a => a.ativo).sort((a, b) => a.prioridade - b.prioridade || a.id.localeCompare(b.id));
  for (const a of ordenadas) {
    if (a.categoria_id && a.categoria_id !== (t.categoria_id || '')) continue;
    if (a.centro_custo && a.centro_custo !== (t.centro_custo || '')) continue;
    if (a.valor_min_centavos !== null && t.valor_centavos < a.valor_min_centavos) continue;
    if (a.valor_max_centavos !== null && t.valor_centavos > a.valor_max_centavos) continue;
    return a;
  }
  return null;
}

export interface Decisor {
  id: string;
  perfil?: string;
  isSuperAdmin?: boolean;
  /** Perfis de acesso (grupos_usuario) de que a pessoa faz parte. */
  grupos: string[];
  /** Resultado de pode(sessao, acaoAprovadora). */
  temDireito: boolean;
}

/** A pessoa está na lista de aprovadores do pedido? Lista vazia = qualquer um com o direito. */
export function estaNaLista(aprovadores: readonly string[], d: Decisor): boolean {
  if (aprovadores.length === 0) return true;
  return aprovadores.some(a => {
    if (a === `usuario:${d.id}`) return true;
    if (a.startsWith('grupo:')) return d.grupos.includes(a.slice(6));
    if (a === 'papel:ADMIN') return perfilCanonico(d.perfil) === 'ADMIN';
    return false;
  });
}

export function podeDecidirPedido(
  pedido: Pick<PedidoAprovacao, 'status' | 'solicitante_id' | 'aprovadores' | 'decisoes' | 'expira_em'>,
  d: Decisor,
  agora: Date = new Date(),
): { ok: true } | { ok: false; motivo: string } {
  if (pedido.status !== 'PENDENTE') return { ok: false, motivo: 'Este pedido já foi decidido.' };
  if (new Date(pedido.expira_em).getTime() <= agora.getTime()) return { ok: false, motivo: 'Este pedido expirou. Peça de novo.' };
  if (!d.id || d.id === pedido.solicitante_id) return { ok: false, motivo: 'Quem pediu não pode aprovar o próprio pedido.' };
  if (!d.temDireito) return { ok: false, motivo: 'Você não tem o direito de decidir este pedido.' };
  if (!estaNaLista(pedido.aprovadores, d)) return { ok: false, motivo: 'Este pedido está com outros aprovadores.' };
  if (pedido.decisoes.some(x => x.usuario_id === d.id)) return { ok: false, motivo: 'Você já aprovou este pedido; falta outra pessoa.' };
  return { ok: true };
}

/** Status depois da decisão. Recusa encerra; aprovação conta níveis. */
export function statusDepoisDaDecisao(
  pedido: Pick<PedidoAprovacao, 'niveis' | 'decisoes'>,
  decisao: 'aprovar' | 'recusar',
): 'PENDENTE' | 'APROVADO' | 'RECUSADO' {
  if (decisao === 'recusar') return 'RECUSADO';
  const aprovacoes = pedido.decisoes.filter(x => x.decisao === 'aprovar').length + 1;
  return aprovacoes >= Math.max(1, pedido.niveis) ? 'APROVADO' : 'PENDENTE';
}

/** JSON com chaves em ordem: a mesma carga sempre dá o mesmo texto (e o mesmo hash). */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj).filter(k => obj[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`).join(',')}}`;
}

export function normalizarAprovadores(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const ok = valor.filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v === 'papel:ADMIN' || /^usuario:[^\s]{1,120}$/.test(v) || /^grupo:[^\s]{1,120}$/.test(v));
  return [...new Set(ok)].slice(0, 50);
}
