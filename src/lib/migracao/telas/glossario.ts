/**
 * E4 · Mudança — Glossário "como chamava lá → como chama aqui" (05/11/2026).
 * Lista pura, sem React: a tela /mudanca/glossario e a busca ⌘K leem daqui.
 *
 * Só termos de mercado (o nome que qualquer agência usa), nunca nome de tela
 * ou frase exclusiva do sistema anterior (lista proibida em
 * docs/programa/e2-contratos.md, regra 3; scripts/test-mudanca-telas.ts
 * confere). Quando aqui funciona diferente, uma frase diz como. O que ainda
 * não existe diz em qual entrega chega.
 */
import type { Entrega } from './paridade';

export interface TermoDoGlossario {
  id: string;
  /** Como a pessoa chamava lá (o primeiro é o principal; os outros também acham na busca). */
  la: string[];
  /** Como chama aqui. */
  aqui: string;
  /** Onde fica aqui (rota que existe). Ausente quando ainda não chegou. */
  href?: string;
  /** Uma frase quando aqui funciona diferente. */
  diferenca?: string;
  /** Quando ainda não existe: a entrega em que chega. */
  chega?: Entrega;
  /** Agrupa na tela. */
  assunto: AssuntoDoGlossario;
}

export type AssuntoDoGlossario = 'contas' | 'caixa' | 'categorias' | 'cobranca' | 'relatorios' | 'venda' | 'cadastros' | 'controle';

export const ROTULO_DO_ASSUNTO: Record<AssuntoDoGlossario, string> = {
  contas: 'Contas a pagar e a receber',
  caixa: 'Contas, caixa e bancos',
  categorias: 'Categorias, centros e rateio',
  cobranca: 'Boletos e cobrança',
  relatorios: 'Relatórios',
  venda: 'Venda, fornecedor e comissão',
  cadastros: 'Cadastros',
  controle: 'Acesso e controle',
};

export const GLOSSARIO: readonly TermoDoGlossario[] = [
  // Contas a pagar e a receber
  { id: 'contas-pagar-receber', assunto: 'contas', la: ['Contas a Pagar/Receber', 'Títulos', 'Lançamentos financeiros'], aqui: 'Contas a Pagar/Receber', href: '/financeiro-ag/contas',
    diferenca: 'As telas separadas de Contas a pagar e Contas a receber continuam existindo.' },
  { id: 'liquidar', assunto: 'contas', la: ['Liquidar', 'Dar baixa', 'Quitar'], aqui: 'Liquidar', href: '/financeiro-ag/contas',
    diferenca: 'Na liquidação, juros, multa e desconto já vêm calculados pela política da agência, e uma conta pode receber várias baixas.' },
  { id: 'liquidado', assunto: 'contas', la: ['Liquidado'], aqui: 'Pago (a pagar) ou Recebido (a receber)', href: '/financeiro-ag/contas' },
  { id: 'em-aberto', assunto: 'contas', la: ['Em aberto', 'Pendente'], aqui: 'Em aberto', href: '/financeiro-ag/contas' },
  { id: 'em-atraso', assunto: 'contas', la: ['Em atraso', 'Vencido'], aqui: 'Em atraso', href: '/financeiro-ag/contas' },
  { id: 'estorno', assunto: 'contas', la: ['Estornar liquidação', 'Desfazer baixa'], aqui: 'Estornar uma baixa', href: '/financeiro-ag/contas',
    diferenca: 'Cada baixa tem seu histórico e pode ser estornada sozinha, com o motivo.' },
  { id: 'saldo-pendente', assunto: 'contas', la: ['Pagamento parcial', 'Saldo pendente'], aqui: 'Liquidar uma parte e deixar o saldo em aberto', href: '/financeiro-ag/contas',
    diferenca: 'O saldo fica na mesma conta, sem criar outra.' },
  { id: 'recorrente', assunto: 'contas', la: ['Conta recorrente', 'Parcelado', 'Periodicidade'], aqui: 'Recorrência e Mais parcelas', href: '/financeiro-ag/pagar' },
  { id: 'juros-multa', assunto: 'contas', la: ['Juros', 'Multa', 'Desconto'], aqui: 'Juros, multa e desconto da política', href: '/config/financeiro' },
  { id: 'bloqueios', assunto: 'controle', la: ['Bloqueio de desconto', 'Bloqueio de datas', 'Limite de desconto'], aqui: 'Limites e aprovação', href: '/config/limites-e-aprovacao',
    diferenca: 'Passou do limite, o sistema pede aprovação a quem você escolher, em vez de travar.' },

  // Contas, caixa e bancos
  { id: 'conta-corrente', assunto: 'caixa', la: ['Conta corrente', 'Conta caixa', 'Contas e cartões'], aqui: 'Contas bancárias', href: '/financeiro-ag/contas-bancarias' },
  { id: 'cartao-credito', assunto: 'caixa', la: ['Cartão de crédito da agência', 'Fatura do cartão'], aqui: 'Cartões corporativos', href: '/financeiro-ag/cartoes',
    diferenca: 'A fatura do cartão pode ser lida por IA a partir do PDF.' },
  { id: 'saldo-inicial', assunto: 'caixa', la: ['Saldo inicial'], aqui: 'Saldo de abertura na data de corte', href: '/financeiro-ag/extrato',
    diferenca: 'Entra pela mudança de sistema, na data de corte, sem mexer no que já foi lançado aqui.' },
  { id: 'extrato', assunto: 'caixa', la: ['Extrato de conta', 'Extrato bancário'], aqui: 'Extrato de conta', href: '/financeiro-ag/extrato',
    diferenca: 'Mostra várias contas de uma vez, com o saldo linha a linha e sem limite de um ano.' },
  { id: 'movimentacoes', assunto: 'caixa', la: ['Movimentações', 'Entradas e saídas'], aqui: 'Movimentações', href: '/financeiro-ag/movimentacoes' },
  { id: 'transferencia', assunto: 'caixa', la: ['Transferência entre contas'], aqui: 'Transferências', href: '/financeiro-ag/transferencias' },
  { id: 'fechar-caixa', assunto: 'caixa', la: ['Fechar caixa', 'Reabrir caixa'], aqui: 'Fechar Caixa', href: '/financeiro-ag/fechamento',
    diferenca: 'Fechar um dia trava os lançamentos até ele em todas as telas; reabrir pede o motivo.' },
  { id: 'conferido', assunto: 'caixa', la: ['Conferido', 'Conferência bancária'], aqui: 'Conciliação', href: '/financeiro-ag/conciliacao',
    diferenca: 'Importe o extrato do banco e confira cada lançamento, em vez de mudar a data à mão.' },
  { id: 'cheque', assunto: 'caixa', la: ['Cheque', 'Cheque pré-datado'], aqui: 'Forma de pagamento Cheque', href: '/financeiro-ag/formas-pagamento' },
  { id: 'formas', assunto: 'caixa', la: ['Formas de pagamento'], aqui: 'Formas de pagamento', href: '/financeiro-ag/formas-pagamento',
    diferenca: 'Pix é uma forma de pagamento própria.' },
  { id: 'moeda', assunto: 'caixa', la: ['Moedas', 'Câmbio', 'Atualizar câmbio'], aqui: 'Câmbio sugerido ao vivo, sempre editável', href: '/financeiro-ag/moedas' },

  // Categorias, centros e rateio
  { id: 'categoria', assunto: 'categorias', la: ['Categoria', 'Categoria financeira'], aqui: 'Categorias', href: '/financeiro-ag/plano-contas' },
  { id: 'grupo-categoria', assunto: 'categorias', la: ['Grupo de categoria'], aqui: 'Categoria de cima no plano de contas', href: '/financeiro-ag/plano-contas',
    diferenca: 'O plano de contas é uma árvore: a categoria de cima agrupa as de baixo.' },
  { id: 'repasse', assunto: 'categorias', la: ['Categoria de repasse', 'Repasse'], aqui: 'Repasse (marcado na categoria)', href: '/financeiro-ag/plano-contas' },
  { id: 'unificar', assunto: 'categorias', la: ['Unificar categorias'], aqui: 'Juntar categorias', href: '/financeiro-ag/plano-contas' },
  { id: 'centro-custo', assunto: 'categorias', la: ['Centro de custo'], aqui: 'Centros de Custo', href: '/financeiro-ag/centros-custo',
    diferenca: 'Um centro pode ficar dentro de outro.' },
  { id: 'rateio', assunto: 'categorias', la: ['Rateio', 'Rateio entre empresas', 'Rateio entre centros'], aqui: 'Rateio por linha de categoria', href: '/financeiro-ag/centros-custo',
    diferenca: 'Cada linha de categoria pode ir para um centro diferente.' },
  { id: 'relatorio-categoria', assunto: 'relatorios', la: ['Relatório por categoria'], aqui: 'Por categoria', href: '/financeiro-ag/relatorios/lancamentos-categoria' },
  { id: 'relatorio-centro', assunto: 'relatorios', la: ['Relatório por centro de custo'], aqui: 'Por centro de custo', href: '/financeiro-ag/relatorios/lancamentos-centro-custo' },
  { id: 'relatorio-rateio', assunto: 'relatorios', la: ['Relatório de rateio'], aqui: 'Por rateio', href: '/financeiro-ag/relatorios/lancamentos-rateio' },

  // Relatórios
  { id: 'fluxo', assunto: 'relatorios', la: ['Fluxo de caixa', 'Previsto', 'Realizado'], aqui: 'Fluxo de caixa', href: '/financeiro-ag/fluxo-caixa',
    diferenca: 'Previsto e realizado aparecem lado a lado, com o desvio.' },
  { id: 'dre', assunto: 'relatorios', la: ['Demonstrativo de resultado', 'DRE'], aqui: 'DRE', href: '/financeiro-ag/dre',
    diferenca: 'Por competência ou por caixa, à escolha.' },
  { id: 'tabela-dinamica', assunto: 'relatorios', la: ['Tabela dinâmica por categoria', 'Gastos por categoria'], aqui: 'Resultado por categoria', href: '/financeiro-ag/resultado-por-categoria' },
  { id: 'painel', assunto: 'relatorios', la: ['Painel inicial', 'Contas do dia', 'Saldo das contas'], aqui: 'Visão geral do financeiro', href: '/financeiro-ag' },
  { id: 'vendas-relatorios', assunto: 'relatorios', la: ['Vendas por produto', 'Vendas por vendedor', 'Ranking de clientes'], aqui: 'Relatórios de vendas', href: '/relatorios/vendas' },

  // Boletos e cobrança
  { id: 'boleto', assunto: 'cobranca', la: ['Boleto', 'Gerar boleto'], aqui: 'Cobranças (boleto e Pix)', href: '/financeiro-ag/cobrancas',
    diferenca: 'O boleto sai pelo Asaas ou Pagar.me da agência, com Pix no mesmo documento quando o provedor permite.' },
  { id: 'boleto-nao-emitido', assunto: 'cobranca', la: ['Boleto não emitido'], aqui: 'Filtro "Boleto não emitido" em Contas a Pagar/Receber', href: '/financeiro-ag/contas' },
  { id: 'remessa', assunto: 'cobranca', la: ['Arquivo de remessa', 'Remessa'], aqui: 'Não existe: o boleto é registrado na hora', href: '/financeiro-ag/cobrancas',
    diferenca: 'Ninguém precisa subir arquivo no site do banco.' },
  { id: 'retorno', assunto: 'cobranca', la: ['Arquivo de retorno', 'Retorno do banco'], aqui: 'Não existe: o pagamento baixa a conta sozinho', href: '/financeiro-ag/cobrancas',
    diferenca: 'O provedor avisa o pagamento e a conta a receber é liquidada com a taxa e a data certas.' },
  { id: 'carne', assunto: 'cobranca', la: ['Carnê'], aqui: 'Carnê', href: '/financeiro-ag/cobrancas' },
  { id: 'reemitir', assunto: 'cobranca', la: ['Reemitir boleto', 'Segunda via'], aqui: '2ª via (novo vencimento)', href: '/financeiro-ag/cobrancas' },
  { id: 'recibo', assunto: 'cobranca', la: ['Recibo', 'Imprimir recibo'], aqui: 'Recibo da conta recebida', href: '/financeiro-ag/receber' },
  { id: 'envio-email', assunto: 'cobranca', la: ['Enviar boleto por e-mail'], aqui: 'Enviar por e-mail ou WhatsApp', href: '/financeiro-ag/cobrancas',
    diferenca: 'A régua de lembretes manda sozinha, pelo CRM, nos dias que você escolher.' },

  // Venda, fornecedor e comissão
  { id: 'venda', assunto: 'venda', la: ['Venda', 'Fechar venda'], aqui: 'Vendas fechadas', href: '/vendas',
    diferenca: 'As contas a pagar e a receber da venda nascem sozinhas, sem passo manual.' },
  { id: 'taxas-venda', assunto: 'venda', la: ['Taxa DU', 'RAV', 'Over', 'Fee'], aqui: 'Componentes da receita na venda', href: '/config/vendas' },
  { id: 'fatura-cliente', assunto: 'venda', la: ['Fatura do cliente', 'Regras de faturamento', 'Nota de débito'], aqui: 'Faturas e Regras de faturamento', href: '/financeiro-ag/faturas' },
  { id: 'fatura-fornecedor', assunto: 'venda', la: ['Fatura do fornecedor', 'Sinal ao fornecedor'], aqui: 'Fatura do fornecedor e sinal', href: '/financeiro-ag/fornecedores/faturas' },
  { id: 'reembolso', assunto: 'venda', la: ['Reembolso', 'Crédito do cliente', 'Cancelamento de produto'], aqui: 'Reembolsos e crédito do cliente', href: '/financeiro-ag/reembolsos' },
  { id: 'comissao', assunto: 'venda', la: ['Comissão', 'Plano de comissão', 'Metas'], aqui: 'Comissões e Planos de comissão', href: '/equipe/comissoes' },
  { id: 'fechar-comissao', assunto: 'venda', la: ['Fechar comissões', 'Pagar comissões'], aqui: 'Fechar e pagar comissões no servidor', href: '/equipe/fechar-comissoes' },
  { id: 'nota-fiscal', assunto: 'venda', la: ['Nota fiscal', 'NFS-e'], aqui: 'Notas fiscais (padrão nacional)', href: '/financeiro-ag/notas' },
  { id: 'retencao', assunto: 'venda', la: ['Retenção', 'Imposto retido'], aqui: 'Retenções na fonte (Lei 9.430)', href: '/financeiro-ag/notas/retencoes' },
  { id: 'operadora', assunto: 'venda', la: ['Extrato da operadora', 'Conferência de depósito'], aqui: 'Conferência de extrato de qualquer operadora', href: '/financeiro-ag/conferencia-operadora' },

  // Cadastros
  { id: 'pessoa', assunto: 'cadastros', la: ['Pessoa', 'Cadastro de pessoas'], aqui: 'Clientes e Fornecedores', href: '/pessoas/clientes',
    diferenca: 'Ninguém é duplicado: CPF ou CNPJ liga com o cadastro que já existe.' },
  { id: 'fornecedor', assunto: 'cadastros', la: ['Fornecedor', 'Operadora', 'Consolidadora'], aqui: 'Fornecedores', href: '/pessoas/fornecedores' },

  // Acesso e controle
  { id: 'permissoes', assunto: 'controle', la: ['Permissões', 'Direitos do usuário', 'Contas liberadas'], aqui: 'Perfis de acesso', href: '/config/perfis-de-acesso',
    diferenca: 'Cada perfil diz o que pode fazer e quais contas bancárias vê.' },
  { id: 'historico', assunto: 'controle', la: ['Histórico', 'Log de alterações'], aqui: 'Registro de atividades', href: '/config/auditoria',
    diferenca: 'Mostra o antes e o depois de cada campo.' },
  { id: 'usuarios', assunto: 'controle', la: ['Usuários'], aqui: 'Usuários', href: '/config/usuarios' },
  { id: 'configuracoes', assunto: 'controle', la: ['Configurações do financeiro', 'Categorias padrão'], aqui: 'Configurações › Financeiro', href: '/config/financeiro' },
];

export function normalizarTermo(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Termos cujo nome lá (ou aqui) contém a busca. Os que batem pelo nome de
 * lá vêm primeiro: é o nome que a pessoa traz na cabeça.
 */
export function buscarNoGlossario(q: string): TermoDoGlossario[] {
  const n = normalizarTermo(q);
  if (n.length < 2) return [];
  const pelaOrigem = GLOSSARIO.filter(t => t.la.some(l => normalizarTermo(l).includes(n)));
  const peloDestino = GLOSSARIO.filter(t => !pelaOrigem.includes(t) && normalizarTermo(t.aqui).includes(n));
  return [...pelaOrigem, ...peloDestino];
}

/** Termos agrupados por assunto, na ordem de ROTULO_DO_ASSUNTO. */
export function glossarioPorAssunto(termos: readonly TermoDoGlossario[] = GLOSSARIO): Array<{ assunto: AssuntoDoGlossario; termos: TermoDoGlossario[] }> {
  return (Object.keys(ROTULO_DO_ASSUNTO) as AssuntoDoGlossario[])
    .map(assunto => ({ assunto, termos: termos.filter(t => t.assunto === assunto) }))
    .filter(g => g.termos.length > 0);
}
