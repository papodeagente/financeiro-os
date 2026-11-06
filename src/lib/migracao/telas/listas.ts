/**
 * E4 · Mudança — o passo 1 do assistente: o que exportar de cada lista do
 * sistema anterior, em palavras simples (05/11/2026). Lista pura, sem React.
 *
 * Cada lista diz onde fica lá, como exportar, quais colunas deixar visíveis
 * antes de exportar e quando é preciso "um arquivo por mês" (o sistema
 * anterior corta listas grandes e mostra só as primeiras linhas).
 *
 * Só nomes de mercado (Contas a Pagar/Receber, Extrato de conta, Situação,
 * Em aberto...). Nenhum nome de tela ou frase exclusiva do sistema anterior
 * (lista proibida em docs/programa/e2-contratos.md, regra 3; o teste confere).
 */
import type { TipoDeLista } from '../contrato-telas';

/** Nome curto da lista, para chip, filtro e coluna. */
export const ROTULO_DA_LISTA: Record<TipoDeLista, string> = {
  contas: 'Contas e cartões',
  categorias: 'Categorias',
  centros_custo: 'Centros de custo',
  pessoas: 'Clientes e fornecedores',
  titulos: 'Contas a pagar e a receber',
  saldos: 'Saldos de abertura',
  liquidados: 'Contas já liquidadas',
  movimentos: 'Extrato e movimentações',
  vendas: 'Vendas por produto',
  faturas: 'Faturas ao cliente',
  notas: 'Notas emitidas',
  comissoes_pagas: 'Comissões já pagas',
  metas: 'Metas',
  reembolsos: 'Reembolsos em aberto',
  creditos: 'Créditos de clientes',
};

export interface GuiaDaLista {
  tipo: TipoDeLista;
  /** Título do bloco no passo 1. */
  nome: string;
  /** Pode pular sem perder nada essencial. */
  opcional: boolean;
  /** Uma frase: onde a lista fica no sistema anterior. */
  ondeFica: string;
  /** Passos curtos, na ordem. */
  passos: string[];
  /** Colunas a deixar visíveis antes de exportar (escolha de colunas da lista). */
  colunas: string[];
  /** A lista costuma ser grande: um arquivo por mês. */
  umArquivoPorMes: boolean;
  /** O que a pessoa precisa saber para não errar. */
  dica?: string;
  /** Onde isso aparece aqui depois de aplicado. */
  aqui: { tela: string; href: string };
}

export const GUIA_DE_EXPORTACAO: readonly GuiaDaLista[] = [
  {
    tipo: 'contas',
    nome: 'Contas bancárias, caixa e cartões',
    opcional: false,
    ondeFica: 'No financeiro do sistema anterior, na lista de contas e cartões da agência.',
    passos: [
      'Abra a lista de contas e cartões e mostre também as contas inativas.',
      'Deixe visíveis as colunas abaixo.',
      'Use Exportar e salve em Excel.',
    ],
    colunas: ['Descrição', 'Tipo', 'Banco', 'Agência', 'Conta', 'Moeda', 'Ativa', 'Dia de fechamento da fatura', 'Dia de vencimento da fatura'],
    umArquivoPorMes: false,
    dica: 'Uma conta que já existe aqui com o mesmo banco, agência e número (ou o mesmo nome) é ligada, não duplicada.',
    aqui: { tela: 'Contas bancárias', href: '/financeiro-ag/contas-bancarias' },
  },
  {
    tipo: 'categorias',
    nome: 'Categorias',
    opcional: false,
    ondeFica: 'No financeiro do sistema anterior, na lista de categorias de receita e despesa.',
    passos: [
      'Abra a lista de categorias com todos os grupos abertos.',
      'Deixe visíveis as colunas abaixo.',
      'Use Exportar e salve em Excel.',
    ],
    colunas: ['Grupo', 'Categoria', 'Tipo (Receita ou Despesa)', 'Repasse'],
    umArquivoPorMes: false,
    dica: 'A categoria com o mesmo nome e o mesmo tipo de uma que já existe aqui é ligada a ela.',
    aqui: { tela: 'Categorias', href: '/financeiro-ag/plano-contas' },
  },
  {
    tipo: 'centros_custo',
    nome: 'Centros de custo',
    opcional: true,
    ondeFica: 'No cadastro de centros de custo do sistema anterior, se a agência usa centros.',
    passos: [
      'Abra a lista de centros de custo.',
      'Use Exportar e salve em Excel.',
    ],
    colunas: ['Descrição'],
    umArquivoPorMes: false,
    dica: 'Se a agência não usa centro de custo, pule. Uma conta que citar um centro que não existe aparece no ensaio com o motivo.',
    aqui: { tela: 'Centros de Custo', href: '/financeiro-ag/centros-custo' },
  },
  {
    tipo: 'pessoas',
    nome: 'Clientes e fornecedores',
    opcional: false,
    ondeFica: 'No cadastro de pessoas do sistema anterior (clientes, fornecedores e operadoras).',
    passos: [
      'Abra o cadastro de pessoas.',
      'Deixe visíveis as colunas abaixo, principalmente CPF e CNPJ.',
      'Use Exportar e salve em Excel.',
      'Se aparecer o aviso de que a consulta trouxe registros demais, exporte por tipo: primeiro pessoa física, depois pessoa jurídica.',
    ],
    colunas: ['Nome', 'Razão social', 'Tipo (física ou jurídica)', 'CPF', 'CNPJ', 'E-mail', 'Telefone', 'Celular', 'Cidade'],
    umArquivoPorMes: false,
    dica: 'É pelo CPF ou CNPJ que não duplicamos ninguém. Mesmo e-mail ou telefone só junta com quem tem o mesmo nome.',
    aqui: { tela: 'Clientes e Fornecedores', href: '/pessoas/clientes' },
  },
  {
    tipo: 'titulos',
    nome: 'Contas a pagar e a receber em aberto',
    opcional: false,
    ondeFica: 'No financeiro do sistema anterior, na lista Contas a Pagar/Receber.',
    passos: [
      'Em Situação, escolha Em aberto. Se Em atraso for uma opção separada, exporte também.',
      'Em "Data de", escolha Vencimento.',
      'No Período, escolha um mês só (do primeiro ao último dia).',
      'Deixe visíveis as colunas abaixo.',
      'Use Exportar e salve em Excel. Repita para cada mês que tiver conta em aberto, inclusive os atrasados.',
    ],
    colunas: [
      'Empresa', 'Pessoa', 'Razão social', 'CPF/CNPJ', 'Movimento (Pagar ou Receber)', 'Documento', 'Descrição',
      'Emissão', 'Vencimento', 'Valor', 'Valor final', 'Parcelas', 'Categoria', 'Centro de custo', 'Conta',
      'Venda Nº', 'Fatura Nº', 'Vendedor',
    ],
    umArquivoPorMes: true,
    dica: 'Pode soltar o mesmo mês duas vezes sem medo: a conta com a mesma pessoa, documento, vencimento, valor e parcela não entra de novo.',
    aqui: { tela: 'Contas a Pagar/Receber', href: '/financeiro-ag/contas' },
  },
  {
    tipo: 'saldos',
    nome: 'Saldo de cada conta na data de corte',
    opcional: false,
    ondeFica: 'No saldo das contas do sistema anterior, olhando o dia da data de corte.',
    passos: [
      'Escolha a data de corte: o dia a partir do qual a agência passa a lançar só aqui.',
      'Veja o saldo de cada conta nesse dia (saldo das contas ou Extrato de conta até o dia).',
      'Exporte, ou monte uma planilha simples com duas colunas: Conta e Saldo.',
    ],
    colunas: ['Conta', 'Saldo', 'Data (opcional)'],
    umArquivoPorMes: false,
    dica: 'O nome da conta precisa ser o mesmo da lista de contas. O saldo entra como saldo de abertura na data de corte, sem mexer no que já existe aqui.',
    aqui: { tela: 'Extrato de conta', href: '/financeiro-ag/extrato' },
  },
  // ── Histórico (E7): tudo opcional, entra depois dos saldos ──
  {
    tipo: 'liquidados',
    nome: 'Contas já liquidadas (histórico)',
    opcional: true,
    ondeFica: 'Na mesma lista Contas a Pagar/Receber, olhando o que já foi pago e recebido.',
    passos: [
      'Em Situação, escolha Liquidado.',
      'Em "Data de", escolha Liquidação.',
      'No Período, escolha um mês só, até a data de corte.',
      'Deixe visíveis as colunas abaixo, principalmente Liquidação e Conta.',
      'Use Exportar e salve em Excel. Repita mês a mês, até onde quiser ter o histórico aqui.',
    ],
    colunas: ['Pessoa', 'CPF/CNPJ', 'Movimento (Pagar ou Receber)', 'Documento', 'Descrição', 'Emissão', 'Vencimento', 'Liquidação', 'Valor final', 'Categoria', 'Conta', 'Forma de pagamento', 'Venda Nº'],
    umArquivoPorMes: true,
    dica: 'Cada conta entra já liquidada, na data e na conta em que foi paga lá. O saldo da data de corte não muda: o dinheiro dessas contas já está nele.',
    aqui: { tela: 'Contas a Pagar/Receber', href: '/financeiro-ag/contas' },
  },
  {
    tipo: 'movimentos',
    nome: 'Extrato e movimentações das contas',
    opcional: true,
    ondeFica: 'No Extrato de conta (uma conta por vez) ou nas Movimentações (todas as contas).',
    passos: [
      'Escolha o período de um mês, até a data de corte.',
      'Deixe visíveis as colunas abaixo.',
      'Use Exportar e salve em Excel ou CSV. Repita mês a mês.',
    ],
    colunas: ['Data', 'Conta', 'Pessoa', 'CPF/CNPJ', 'Descrição', 'Documento', 'Forma de pagamento', 'Movimento', 'Valor'],
    umArquivoPorMes: true,
    dica: 'O que já está nas contas liquidadas é ligado, não duplicado. O que só existe no extrato (tarifa, rendimento) vira uma conta liquidada. Transferência entre contas fica de fora.',
    aqui: { tela: 'Extrato de conta', href: '/financeiro-ag/extrato' },
  },
  {
    tipo: 'vendas',
    nome: 'Vendas por produto',
    opcional: true,
    ondeFica: 'No relatório de vendas por produto do sistema anterior.',
    passos: [
      'Em "Data de", escolha Venda; um mês por arquivo.',
      'Traga também as vendas das viagens que ainda vão acontecer: é por elas que dá para cancelar, reembolsar e conferir comissão aqui.',
      'Deixe visíveis as colunas abaixo.',
      'Use Exportar e salve em Excel.',
    ],
    colunas: ['Venda Nº', 'Data Venda', 'Situação', 'Produto', 'Pagante', 'CPF', 'CNPJ', 'Vendedor', 'Fornecedor', 'Representante', 'Intermediário', 'Passageiros', 'Documento', 'Data Início', 'Data Fim', 'Total Produtos', 'Total Taxas', 'Taxa DU', 'Taxa RAV', 'Comissão', 'Over', 'Desconto', 'Valor Total', 'Receitas', 'Moeda'],
    umArquivoPorMes: true,
    dica: 'Cada venda entra completa (produtos, passageiros, Taxa DU, RAV, comissão), sem criar contas de novo: as contas dela são as que vieram nas listas de contas, com o mesmo Venda Nº.',
    aqui: { tela: 'Vendas', href: '/vendas' },
  },
  {
    tipo: 'faturas',
    nome: 'Faturas ao cliente (para consulta)',
    opcional: true,
    ondeFica: 'Na lista Contas a Pagar/Receber, nas contas que têm Fatura Nº.',
    passos: [
      'Deixe visível a coluna Fatura Nº e as colunas abaixo.',
      'Exporte um mês por arquivo e, ao soltar aqui, diga que o arquivo é de Faturas ao cliente.',
    ],
    colunas: ['Fatura Nº', 'Pessoa', 'CPF/CNPJ', 'Emissão', 'Vencimento', 'Liquidação', 'Valor final', 'Situação'],
    umArquivoPorMes: false,
    dica: 'Ficam só para consulta. As faturas novas nascem aqui, pelas regras de faturamento.',
    aqui: { tela: 'Registros trazidos', href: '/mudanca/historico' },
  },
  {
    tipo: 'notas',
    nome: 'Notas fiscais emitidas (para consulta)',
    opcional: true,
    ondeFica: 'Na lista de notas fiscais do sistema anterior.',
    passos: ['Escolha o período e a situação Emitida.', 'Deixe visíveis as colunas abaixo.', 'Use Exportar e salve em Excel.'],
    colunas: ['Número', 'Série', 'Data de emissão', 'Tomador', 'CPF/CNPJ', 'Valor total dos serviços', 'Valor ISS', 'Situação', 'Venda Nº'],
    umArquivoPorMes: false,
    dica: 'Nota trazida nunca é emitida de novo: fica como registro, ligada à venda quando ela também veio.',
    aqui: { tela: 'Registros trazidos', href: '/mudanca/historico' },
  },
  {
    tipo: 'comissoes_pagas',
    nome: 'Comissões já pagas (para consulta)',
    opcional: true,
    ondeFica: 'Nas comissões pagas de cada pessoa (ou na conta a pagar de cada pagamento de comissão).',
    passos: ['Deixe visíveis as colunas abaixo.', 'Use Exportar e salve em Excel.'],
    colunas: ['Pessoa', 'Venda Nº', 'Data Venda', 'Pagante', 'Descrição/Produto', 'Valor', 'Valor Retido', 'Pago em'],
    umArquivoPorMes: false,
    dica: 'Ficam como registro e não são pagas de novo: as vendas trazidas não entram no cálculo das comissões daqui.',
    aqui: { tela: 'Registros trazidos', href: '/mudanca/historico' },
  },
  {
    tipo: 'metas',
    nome: 'Metas da equipe',
    opcional: true,
    ondeFica: 'Nas metas do sistema anterior, ano a ano.',
    passos: ['Escolha o ano.', 'Use Exportar e salve em Excel: uma linha por pessoa e função, com os 12 meses.'],
    colunas: ['Pessoa', 'Função', 'Plano', 'Ano', 'Janeiro a Dezembro'],
    umArquivoPorMes: false,
    dica: 'Cada pessoa precisa estar antes na função aqui (Equipe › Funções), com o mesmo nome.',
    aqui: { tela: 'Funções da equipe', href: '/equipe/funcoes' },
  },
  {
    tipo: 'reembolsos',
    nome: 'Reembolsos em aberto',
    opcional: true,
    ondeFica: 'Nos reembolsos ao cliente e do fornecedor que ainda não foram pagos.',
    passos: ['Deixe visíveis as colunas abaixo.', 'Use Exportar e salve em Excel.'],
    colunas: ['Pessoa', 'CPF/CNPJ', 'Tipo (ao cliente ou do fornecedor)', 'Venda Nº', 'Valor', 'Prazo', 'Descrição'],
    umArquivoPorMes: false,
    dica: 'Se a conta do reembolso já veio nas contas em aberto, o reembolso usa essa conta: nada dobra.',
    aqui: { tela: 'Reembolsos', href: '/financeiro-ag/reembolsos' },
  },
  {
    tipo: 'creditos',
    nome: 'Créditos de clientes',
    opcional: true,
    ondeFica: 'No saldo de crédito que cada cliente tem com a agência.',
    passos: ['Deixe visíveis as colunas abaixo, com o saldo que ainda dá para usar.', 'Use Exportar e salve em Excel.'],
    colunas: ['Cliente', 'CPF/CNPJ', 'Saldo', 'Validade', 'Venda de origem'],
    umArquivoPorMes: false,
    dica: 'Entram na carteira do cliente, prontos para usar numa próxima venda. Crédito vencido fica de fora.',
    aqui: { tela: 'Créditos de clientes', href: '/financeiro-ag/creditos' },
  },
];

export function guiaDaLista(tipo: TipoDeLista): GuiaDaLista | undefined {
  return GUIA_DE_EXPORTACAO.find(g => g.tipo === tipo);
}
