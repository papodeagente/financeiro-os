// Catálogo de ações (direitos) do financeiro, agrupadas por módulo, com
// rótulos nossos e termos de mercado. 05/11/2026.
//
// Regra do dono: o PAPEL é o teto. Perfis de acesso e a restrição por
// usuário só tiram direitos abaixo dele, nunca dão:
//   - ADMIN e superadmin nunca são restringidos;
//   - VENDEDOR nunca ganha financeiro (o teto dele não tem);
//   - sem grupo e sem restrição, vale exatamente o que valia antes.
//
// Este arquivo é puro (sem banco): o servidor carrega as restrições em
// ./permissoes-servidor e decide com `decidirAcao`/`contasLiberadasPor`.

import type { PerfilUsuario } from './crm-types';
import { perfilCanonico, permissoesParaPerfil, type Permissoes } from './permissoes';

export type PapelCanonico = ReturnType<typeof perfilCanonico>;

export const MODULOS_DE_ACAO = [
  { id: 'acesso', rotulo: 'Acesso ao financeiro' },
  { id: 'pagar_receber', rotulo: 'Contas a Pagar/Receber' },
  { id: 'contas', rotulo: 'Contas bancárias' },
  { id: 'faturas', rotulo: 'Faturas e cobrança' },
  { id: 'vendas_comissoes', rotulo: 'Vendas e comissões' },
  { id: 'resumo', rotulo: 'Painel e relatórios' },
  { id: 'administracao', rotulo: 'Administração' },
] as const;

export type ModuloDeAcao = (typeof MODULOS_DE_ACAO)[number]['id'];

type Teto = (p: Permissoes, papel: PapelCanonico) => boolean;

const soAdmin: Teto = (_p, papel) => papel === 'ADMIN';

interface DefinicaoDeAcao {
  id: string;
  modulo: ModuloDeAcao;
  rotulo: string;
  descricao: string;
  /** Quem o papel deixa fazer. Grupos nunca vão além disto. */
  teto: Teto;
}

const DEFINICOES = [
  // Acesso
  { id: 'ver_financeiro', modulo: 'acesso', rotulo: 'Acessar o financeiro', descricao: 'Abre as telas do financeiro: contas, extratos, relatórios.', teto: p => p.ver_financeiro },
  { id: 'editar_financeiro', modulo: 'acesso', rotulo: 'Lançar e editar no financeiro', descricao: 'Cria e altera lançamentos, contas e cadastros financeiros.', teto: p => p.editar_financeiro },
  { id: 'acessar_lancamentos_outros', modulo: 'acesso', rotulo: 'Ver e alterar o que outras pessoas lançaram', descricao: 'Sem isto, a pessoa trabalha só no que ela mesma lançou.', teto: p => p.ver_financeiro },

  // Contas a Pagar/Receber
  { id: 'liquidar_pagar', modulo: 'pagar_receber', rotulo: 'Dar baixa em contas a pagar', descricao: 'Registra que a conta foi paga.', teto: p => p.editar_financeiro },
  { id: 'liquidar_receber', modulo: 'pagar_receber', rotulo: 'Dar baixa em contas a receber', descricao: 'Registra que o cliente pagou.', teto: p => p.editar_financeiro },
  { id: 'editar_liquidado', modulo: 'pagar_receber', rotulo: 'Alterar lançamento já baixado', descricao: 'Mexe em conta que já foi paga ou recebida.', teto: p => p.editar_financeiro },
  { id: 'estornar_baixa', modulo: 'pagar_receber', rotulo: 'Estornar baixa', descricao: 'Desfaz um pagamento ou recebimento registrado.', teto: p => p.editar_financeiro },
  { id: 'aprovar_pagamento', modulo: 'pagar_receber', rotulo: 'Aprovar pagamentos', descricao: 'Decide os pedidos de aprovação de pagamento (nunca o próprio).', teto: p => p.editar_financeiro },
  { id: 'aprovar_excecao', modulo: 'pagar_receber', rotulo: 'Aprovar pedidos fora dos limites', descricao: 'Decide os pedidos de aprovação de desconto, data e vencimento; o que esta pessoa lança não gera pedido.', teto: soAdmin },
  { id: 'excluir_com_vinculo', modulo: 'pagar_receber', rotulo: 'Excluir lançamento ligado a venda ou fatura', descricao: 'Apaga o que está amarrado a outro registro.', teto: p => p.pode_excluir },

  // Contas bancárias
  { id: 'ver_conta_bancaria', modulo: 'contas', rotulo: 'Ver saldo e extrato', descricao: 'Das contas bancárias que a pessoa enxerga.', teto: p => p.ver_financeiro },
  { id: 'movimentar_conta_bancaria', modulo: 'contas', rotulo: 'Usar a conta bancária em pagamentos e recebimentos', descricao: 'Escolhe a conta ao dar baixa ou transferir.', teto: p => p.editar_financeiro },
  { id: 'transferir', modulo: 'contas', rotulo: 'Transferir entre contas', descricao: 'Lança transferências entre as contas da agência.', teto: p => p.editar_financeiro },
  { id: 'conciliar', modulo: 'contas', rotulo: 'Conciliar com o banco', descricao: 'Importa o extrato do banco e confere com os lançamentos.', teto: p => p.editar_financeiro },
  { id: 'fechar_periodo', modulo: 'contas', rotulo: 'Fechar caixa', descricao: 'Trava os lançamentos até uma data: nada anterior muda.', teto: p => p.editar_financeiro },
  { id: 'reabrir_periodo', modulo: 'contas', rotulo: 'Reabrir caixa', descricao: 'Destrava um período fechado, com motivo registrado.', teto: soAdmin },

  // Faturas e cobrança
  { id: 'fechar_fatura', modulo: 'faturas', rotulo: 'Fechar fatura do cliente', descricao: 'Encerra a fatura e libera a cobrança.', teto: p => p.editar_financeiro },
  { id: 'reabrir_fatura', modulo: 'faturas', rotulo: 'Reabrir fatura do cliente', descricao: 'Volta a fatura fechada para edição.', teto: p => p.editar_financeiro },
  { id: 'gerar_fatura_fornecedor', modulo: 'faturas', rotulo: 'Montar fatura de fornecedor', descricao: 'Junta os itens do fornecedor numa conta a pagar.', teto: p => p.editar_financeiro },
  { id: 'gerar_boletos', modulo: 'faturas', rotulo: 'Emitir boleto e Pix', descricao: 'Gera a cobrança para o cliente pagar.', teto: p => p.editar_financeiro },
  { id: 'emitir_nota', modulo: 'faturas', rotulo: 'Emitir notas fiscais das vendas', descricao: 'Gera as notas pela regra, com prévia, inclusive as complementares.', teto: p => p.editar_financeiro },
  { id: 'configurar_notas', modulo: 'faturas', rotulo: 'Configurar regras da nota e retenções', descricao: 'Define para quem sai nota, sobre o quê, quando sai sozinha e as retenções na fonte de cada cliente.', teto: p => p.editar_financeiro },

  // Vendas e comissões
  { id: 'ver_aba_financeiro', modulo: 'vendas_comissoes', rotulo: 'Ver o financeiro dentro da venda', descricao: 'Contas a pagar e a receber ligadas à venda.', teto: p => p.ver_financeiro },
  { id: 'ver_colunas_comissao', modulo: 'vendas_comissoes', rotulo: 'Ver o ganho da agência nas vendas', descricao: 'Comissão, over e receita de cada venda.', teto: p => p.ver_financeiro },
  { id: 'ver_proprias_comissoes', modulo: 'vendas_comissoes', rotulo: 'Ver a própria comissão', descricao: 'Quanto a pessoa tem a receber de comissão.', teto: p => p.ver_comissoes },
  { id: 'fechar_venda', modulo: 'vendas_comissoes', rotulo: 'Fechar venda', descricao: 'Encerra a venda: produtos e pagamentos param de mudar.', teto: p => p.editar_financeiro },
  { id: 'reabrir_venda', modulo: 'vendas_comissoes', rotulo: 'Reabrir venda', descricao: 'Volta a venda fechada para edição, com motivo registrado.', teto: p => p.editar_financeiro },
  // Cancelamento, reembolsos e crédito do cliente (E5, parte D).
  { id: 'cancelar_produto', modulo: 'vendas_comissoes', rotulo: 'Cancelar produto ou passageiro', descricao: 'Cancela parte da venda com multa, acerto das contas e estorno da comissão, sempre com prévia.', teto: p => p.editar_financeiro },
  { id: 'cuidar_reembolsos', modulo: 'vendas_comissoes', rotulo: 'Aprovar e cancelar reembolsos', descricao: 'Aprova o reembolso (gera a conta), cancela ou transforma em crédito do cliente.', teto: p => p.editar_financeiro },
  { id: 'usar_credito_cliente', modulo: 'vendas_comissoes', rotulo: 'Usar e ajustar crédito do cliente', descricao: 'Liquida conta com o crédito do cliente e lança ou corrige crédito à mão.', teto: p => p.editar_financeiro },
  { id: 'ver_comissoes_todos', modulo: 'vendas_comissoes', rotulo: 'Ver a comissão da equipe', descricao: 'Comissão de todos os vendedores.', teto: p => p.ver_comissoes && p.ver_vendas_todos },
  { id: 'fechar_comissoes', modulo: 'vendas_comissoes', rotulo: 'Fechar comissões', descricao: 'Fecha as comissões da equipe até uma data, para pagar.', teto: p => p.editar_financeiro && p.ver_comissoes },
  { id: 'pagar_comissoes', modulo: 'vendas_comissoes', rotulo: 'Pagar comissões', descricao: 'Transforma as comissões fechadas em conta a pagar, total ou em parte.', teto: p => p.editar_financeiro && p.ver_comissoes },

  // Painel e relatórios
  { id: 'resumo_pagar_receber', modulo: 'resumo', rotulo: 'Ver totais a pagar e a receber no painel', descricao: 'Os números de contas em aberto no painel inicial.', teto: p => p.ver_financeiro },
  { id: 'resumo_saldo', modulo: 'resumo', rotulo: 'Ver saldo das contas bancárias no painel', descricao: 'O saldo de cada conta no painel inicial.', teto: p => p.ver_financeiro },
  { id: 'acessar_relatorios', modulo: 'resumo', rotulo: 'Abrir relatórios', descricao: 'Fluxo de caixa, resultado do mês e demais relatórios.', teto: p => p.acessar_relatorios },
  { id: 'exportar', modulo: 'resumo', rotulo: 'Baixar em Excel e PDF', descricao: 'Exporta listas e relatórios.', teto: p => p.pode_exportar },

  // Administração
  { id: 'excluir', modulo: 'administracao', rotulo: 'Excluir registros', descricao: 'Apaga cadastros e lançamentos. Sem isto, só altera.', teto: p => p.pode_excluir },
  { id: 'gerenciar_usuarios', modulo: 'administracao', rotulo: 'Cuidar de usuários e perfis de acesso', descricao: 'Cadastra pessoas e define o que cada perfil faz.', teto: p => p.gerenciar_usuarios },
  { id: 'configurar_limites', modulo: 'administracao', rotulo: 'Configurar limites e aprovação', descricao: 'Define os limites e quem aprova cada pedido.', teto: soAdmin },
] as const satisfies readonly DefinicaoDeAcao[];

export type AcaoFinanceira = (typeof DEFINICOES)[number]['id'];

export interface InfoDaAcao {
  id: AcaoFinanceira;
  modulo: ModuloDeAcao;
  rotulo: string;
  descricao: string;
}

export const ACOES_FINANCEIRAS: readonly InfoDaAcao[] = DEFINICOES.map(({ id, modulo, rotulo, descricao }) => ({ id, modulo, rotulo, descricao }));

const POR_ID = new Map<string, DefinicaoDeAcao>(DEFINICOES.map(d => [d.id, d]));

export function ehAcaoFinanceira(valor: unknown): valor is AcaoFinanceira {
  return typeof valor === 'string' && POR_ID.has(valor);
}

/** Ações do catálogo por módulo, na ordem da tela. */
export function acoesPorModulo(): { modulo: (typeof MODULOS_DE_ACAO)[number]; acoes: InfoDaAcao[] }[] {
  return MODULOS_DE_ACAO.map(modulo => ({ modulo, acoes: ACOES_FINANCEIRAS.filter(a => a.modulo === modulo.id) }));
}

/** O que o papel deixa fazer, sem grupo nenhum. É o teto. */
export function tetoDoPapel(perfil: PerfilUsuario | string | undefined, acao: AcaoFinanceira): boolean {
  const papel = perfilCanonico(perfil);
  const def = POR_ID.get(acao);
  if (!def) return false;
  return def.teto(permissoesParaPerfil(papel as PerfilUsuario), papel);
}

/** Lista de ações que o papel alcança (para a matriz e para "marcar tudo"). */
export function acoesDoTeto(perfil: PerfilUsuario | string | undefined): AcaoFinanceira[] {
  return ACOES_FINANCEIRAS.filter(a => tetoDoPapel(perfil, a.id)).map(a => a.id);
}

// ---------------------------------------------------------------------------
// Decisão pura a partir das restrições já carregadas.

export interface GrupoDoUsuario {
  id: string;
  nome: string;
  acesso_total: boolean;
  acoes: string[];
  /** Vazio = todas as contas. */
  contas: string[];
  /** Vazio (ou ausente) = todas as empresas da agência (E7, multiempresa). */
  empresas?: string[];
}

export interface RestricaoDoUsuario {
  /** Vazio = sem restrição própria de conta. */
  contas_liberadas: string[];
  acoes_negadas: string[];
  /** Vazio (ou ausente) = sem restrição própria de empresa (E7). */
  empresas_liberadas?: string[];
}

export interface RestricoesCarregadas {
  grupos: GrupoDoUsuario[];
  usuario: RestricaoDoUsuario | null;
}

export interface QuemPede {
  perfil?: string;
  isSuperAdmin?: boolean;
}

/** Superadmin e ADMIN nunca são restringidos por grupo nem por usuário. */
export function nuncaRestringido(quem: QuemPede): boolean {
  return Boolean(quem.isSuperAdmin) || perfilCanonico(quem.perfil) === 'ADMIN';
}

/**
 * Contas bancárias que a pessoa pode ver/usar. `null` = todas (o de hoje).
 * Perfil com acesso completo ou sem conta marcada libera todas; com mais de
 * um perfil, vale a soma. A restrição do usuário corta por cima.
 */
export function contasLiberadasPor(quem: QuemPede, r: RestricoesCarregadas | null): string[] | null {
  if (nuncaRestringido(quem) || !r) return null;
  let doGrupo: Set<string> | null = null;
  if (r.grupos.length > 0) {
    const todas = r.grupos.some(g => g.acesso_total || g.contas.length === 0);
    if (!todas) doGrupo = new Set(r.grupos.flatMap(g => g.contas));
  }
  const doUsuario = r.usuario && r.usuario.contas_liberadas.length > 0 ? new Set(r.usuario.contas_liberadas) : null;
  if (!doGrupo && !doUsuario) return null;
  if (doGrupo && doUsuario) return [...doGrupo].filter(c => doUsuario.has(c)).sort();
  return [...(doGrupo ?? doUsuario)!].sort();
}

/**
 * A decisão inteira, sem banco. `r = null` (ninguém configurou nada) dá
 * exatamente o teto do papel.
 */
export function decidirAcao(
  quem: QuemPede,
  acao: AcaoFinanceira,
  r: RestricoesCarregadas | null,
  opcoes?: { contaBancariaId?: string | null },
): boolean {
  if (quem.isSuperAdmin) return true;
  if (!tetoDoPapel(quem.perfil, acao)) return false;
  if (nuncaRestringido(quem) || !r) return true;
  if (r.grupos.length > 0 && !r.grupos.some(g => g.acesso_total || g.acoes.includes(acao))) return false;
  if (r.usuario?.acoes_negadas.includes(acao)) return false;
  const conta = opcoes?.contaBancariaId;
  if (conta) {
    const liberadas = contasLiberadasPor(quem, r);
    if (liberadas && !liberadas.includes(conta)) return false;
  }
  return true;
}

/** Normaliza listas vindas do banco ou da tela: só textos, sem repetição. */
export function listaDeTextos(valor: unknown, max = 500): string[] {
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim().slice(0, 200)))].slice(0, max);
}

/** Só ações conhecidas do catálogo (o resto é descartado em silêncio). */
export function listaDeAcoes(valor: unknown): AcaoFinanceira[] {
  return listaDeTextos(valor).filter(ehAcaoFinanceira);
}
