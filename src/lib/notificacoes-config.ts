export const TIPOS_NOTIFICACAO = [
  { tipo: 'PROPOSTA_ACEITA', label: 'Propostas aceitas', descricao: 'Quando um cliente aceita uma proposta.' },
  { tipo: 'PROPOSTA_FEEDBACK', label: 'Pedidos de alteração', descricao: 'Quando um cliente envia comentários ou pede mudanças.' },
  { tipo: 'PROPOSTA_VISUALIZADA', label: 'Propostas visualizadas', descricao: 'Na primeira visualização de cada proposta por dia.' },
  { tipo: 'PROPOSTA_LEAD', label: 'Novos interessados', descricao: 'Quando alguém deixa seus dados em uma proposta.' },
  { tipo: 'VENDA_VENDEDOR_NAO_CADASTRADO', label: 'Pendências de vendedores', descricao: 'Vendas recebidas do CRM sem vendedor cadastrado.' },
  { tipo: 'VENDA_CANCELADA_CRM', label: 'Vendas perdidas no CRM', descricao: 'Quando o CRM perde uma venda que já movimentou dinheiro, ou pede aprovação para cancelar.' },
  // Venda completa (E5, 05/11/2026).
  // Fatura do fornecedor (E5, parte C, 05/11/2026).
  { tipo: 'FATURA_FORNECEDOR_PRONTA', label: 'Faturas de fornecedor', descricao: 'No dia seguinte ao corte do fornecedor: a fatura pronta para montar (ou montada sozinha, se a regra pedir).' },
  { tipo: 'VENDA_FECHADA_MUDANCA_CRM', label: 'Mudanças do CRM em venda fechada', descricao: 'Quando o CRM muda uma venda que já está fechada no financeiro: a mudança espera alguém reabrir a venda.' },
  // Faturas ao cliente (E5, parte B, 05/11/2026): resposta do cliente no portal.
  { tipo: 'FATURA_CONTESTADA', label: 'Faturas contestadas pelo cliente', descricao: 'Quando o cliente contesta um item da fatura no portal.' },
  { tipo: 'FATURA_APROVADA', label: 'Faturas aprovadas pelo cliente', descricao: 'Quando o cliente confere e aprova a fatura no portal.' },
  { tipo: 'VENDA_CANCELADA_EM_FATURA', label: 'Venda cancelada já faturada', descricao: 'Quando uma venda é cancelada com itens numa fatura já fechada: falta a nota de crédito.' },
  // Pedidos de aprovação do financeiro (05/11/2026).
  { tipo: 'APROVACAO_PEDIDA', label: 'Pedidos de aprovação', descricao: 'Quando alguém pede aprovação para pagar, dar desconto ou mudar data.' },
  { tipo: 'APROVACAO_DECIDIDA', label: 'Respostas de aprovação', descricao: 'Quando um pedido seu é aprovado ou recusado.' },
  // Avisos de vencimento (05/11/2026), ligados em Configurações › Financeiro.
  { tipo: 'CONTAS_A_PAGAR_VENCENDO', label: 'Contas a pagar vencendo', descricao: 'De manhã, as contas a pagar que vencem hoje (e, se ligado, amanhã).' },
  { tipo: 'CONTAS_A_RECEBER_ATRASADAS', label: 'Contas a receber em atraso', descricao: 'De manhã, quantas contas a receber estão em atraso e quanto somam.' },
  // Crédito do cliente e reembolsos (E5, parte D).
  { tipo: 'CREDITO_CLIENTE_VENCENDO', label: 'Crédito do cliente vencendo', descricao: 'Um aviso por crédito, 30 dias antes de ele vencer sem uso.' },
  { tipo: 'REEMBOLSO_NO_PRAZO', label: 'Reembolsos no prazo', descricao: 'Quando um reembolso ao cliente ou do fornecedor chega perto do prazo sem ser pago.' },
  // Extrato automático do banco (06/11/2026): leitura parada e certificado vencendo.
  { tipo: 'EXTRATO_AUTOMATICO', label: 'Extrato automático do banco', descricao: 'Quando a leitura do extrato falha seguidas vezes ou o certificado do banco está perto de vencer.' },
  // Fechamento de paridade (E7, 06/11/2026): pendência da baixa automática e nota recusada.
  { tipo: 'COBRANCA_PENDENCIA', label: 'Pagamentos que não baixaram sozinhos', descricao: 'Quando o banco avisa um pagamento, mas a baixa da conta não entra sozinha e precisa da sua escolha.' },
  { tipo: 'NOTA_RECUSADA', label: 'Notas recusadas pela prefeitura', descricao: 'Quando uma nota que estava na prefeitura volta recusada, com o motivo.' },
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
