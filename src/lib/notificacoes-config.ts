export const TIPOS_NOTIFICACAO = [
  { tipo: 'PROPOSTA_ACEITA', label: 'Propostas aceitas', descricao: 'Quando um cliente aceita uma proposta.' },
  { tipo: 'PROPOSTA_FEEDBACK', label: 'Pedidos de alteração', descricao: 'Quando um cliente envia comentários ou pede mudanças.' },
  { tipo: 'PROPOSTA_VISUALIZADA', label: 'Propostas visualizadas', descricao: 'Na primeira visualização de cada proposta por dia.' },
  { tipo: 'PROPOSTA_LEAD', label: 'Novos interessados', descricao: 'Quando alguém deixa seus dados em uma proposta.' },
  { tipo: 'VENDA_VENDEDOR_NAO_CADASTRADO', label: 'Pendências de vendedores', descricao: 'Vendas recebidas do CRM sem vendedor cadastrado.' },
] as const;

export type TipoNotificacao = (typeof TIPOS_NOTIFICACAO)[number]['tipo'];
export const tiposNotificacaoValidos = new Set<string>(TIPOS_NOTIFICACAO.map(item => item.tipo));

export interface PreferenciasNotificacoes {
  tipos: Record<TipoNotificacao, boolean>;
  mostrar_contador: boolean;
  atualizacao_automatica: boolean;
}

export const PREFERENCIAS_NOTIFICACOES_PADRAO: PreferenciasNotificacoes = {
  tipos: Object.fromEntries(TIPOS_NOTIFICACAO.map(item => [item.tipo, true])) as Record<TipoNotificacao, boolean>,
  mostrar_contador: true,
  atualizacao_automatica: true,
};

export function normalizarPreferencias(value: unknown): PreferenciasNotificacoes {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sourceTypes = source.tipos && typeof source.tipos === 'object'
    ? source.tipos as Record<string, unknown> : {};
  return {
    tipos: Object.fromEntries(TIPOS_NOTIFICACAO.map(({ tipo }) => [
      tipo,
      typeof sourceTypes[tipo] === 'boolean' ? sourceTypes[tipo] : true,
    ])) as Record<TipoNotificacao, boolean>,
    mostrar_contador: typeof source.mostrar_contador === 'boolean' ? source.mostrar_contador : true,
    atualizacao_automatica: typeof source.atualizacao_automatica === 'boolean' ? source.atualizacao_automatica : true,
  };
}

export function validarPreferencias(value: unknown): PreferenciasNotificacoes | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => !['tipos', 'mostrar_contador', 'atualizacao_automatica'].includes(key))) return null;
  if (typeof source.mostrar_contador !== 'boolean' || typeof source.atualizacao_automatica !== 'boolean') return null;
  if (!source.tipos || typeof source.tipos !== 'object' || Array.isArray(source.tipos)) return null;
  const sourceTypes = source.tipos as Record<string, unknown>;
  const expected = TIPOS_NOTIFICACAO.map(item => item.tipo);
  if (Object.keys(sourceTypes).length !== expected.length
    || Object.keys(sourceTypes).some(key => !tiposNotificacaoValidos.has(key))
    || expected.some(tipo => typeof sourceTypes[tipo] !== 'boolean')) return null;
  return normalizarPreferencias(source);
}
