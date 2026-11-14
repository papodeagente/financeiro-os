/**
 * Mudança de sistema (E4, 05/11/2026): dicionário das listas que a agência
 * exporta do sistema anterior e o mapeamento por cabeçalho. Puro.
 *
 * Cada lista tem os seus campos, e cada campo os nomes de coluna com que ele
 * costuma aparecer (sinônimos de mercado). O mesmo nome muda de sentido
 * conforme a lista: "Tipo" é Receita/Despesa nas categorias, Pessoa Física
 * ou Jurídica nas pessoas e o tipo da conta nas contas. Por isso o
 * dicionário é por lista.
 *
 * A pessoa nunca digita sintaxe: a tela mostra a sugestão (coluna → campo),
 * ela confirma ou troca escolhendo numa lista. Coluna que não casa com nada
 * fica de fora e aparece listada.
 */
import { normalizar } from './valores';

export type ListaIdV1 = 'contas' | 'categorias' | 'centros_custo' | 'pessoas' | 'titulos' | 'saldos';

/**
 * Listas do histórico (E7, mudança v2, 06/11/2026): contas já liquidadas,
 * movimentações e extrato de conta, vendas por produto, faturas ao cliente,
 * notas emitidas, comissões já pagas, metas, reembolsos em aberto e
 * créditos de clientes.
 */
export type ListaIdV2 = 'liquidados' | 'movimentos' | 'vendas' | 'faturas' | 'notas' | 'comissoes_pagas' | 'metas' | 'reembolsos' | 'creditos';

export type ListaId = ListaIdV1 | ListaIdV2;

/** As listas da v1 (E4), na ordem. */
export const LISTAS_V1: ListaIdV1[] = ['contas', 'categorias', 'centros_custo', 'pessoas', 'titulos', 'saldos'];

/** As listas do histórico (E7), na ordem. */
export const LISTAS_V2: ListaIdV2[] = ['liquidados', 'movimentos', 'vendas', 'faturas', 'notas', 'comissoes_pagas', 'metas', 'reembolsos', 'creditos'];

/** Ordem de aplicação: cada etapa depende das anteriores. */
export const ORDEM_DAS_LISTAS: ListaId[] = [...LISTAS_V1, ...LISTAS_V2];

/**
 * Etapa em que as linhas de cada lista são gravadas. O histórico vem DEPOIS
 * dos saldos de abertura (etapa 5): a baixa antiga encontra a conta já com o
 * saldo da data de corte e só leva a abertura para antes dela (a regra do
 * dinheiro em dobro, em plano.ts). As movimentações vêm depois das contas
 * liquidadas, para se ligarem a elas; as vendas, antes dos registros que
 * citam o número da venda.
 */
export const ETAPA_DA_LISTA: Record<ListaId, number> = {
  contas: 1, categorias: 2, centros_custo: 2, pessoas: 3, titulos: 4, saldos: 5,
  liquidados: 6, movimentos: 7, vendas: 8, faturas: 9, notas: 9, comissoes_pagas: 9, metas: 9, reembolsos: 9, creditos: 9,
};

export type TipoDoCampo = 'texto' | 'data' | 'dinheiro' | 'documento' | 'simnao' | 'parcela';

export interface CampoDaLista {
  id: string;
  rotulo: string;
  tipo: TipoDoCampo;
  obrigatorio?: boolean;
  /** Nomes de coluna aceitos, na forma em que aparecem nas telas. */
  sinonimos: string[];
  /** Dica curta para a tela (o que é o campo). */
  dica?: string;
}

export interface DefinicaoDaLista {
  id: ListaId;
  rotulo: string;
  /** Onde fica no sistema anterior e como exportar, em palavras. */
  comoExportar: string[];
  campos: CampoDaLista[];
  /** Pelo menos um destes precisa estar ligado (além dos obrigatórios). */
  algumDe?: string[][];
  /**
   * false = o cabeçalho sozinho não decide esta lista: as contas liquidadas
   * e as faturas saem da MESMA lista de contas a pagar e a receber. O leitor
   * olha o conteúdo (liquidados) ou a pessoa escolhe.
   */
  adivinhar?: boolean;
  /** Lista do histórico (E7): opcional, entra depois dos saldos. */
  historico?: boolean;
}

/** Janeiro a dezembro, como saem nas colunas da lista de metas. */
export const MESES_DO_ANO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const CAMPOS_DOS_MESES = MESES_DO_ANO.map((_, i) => `mes_${String(i + 1).padStart(2, '0')}`);

// ---------------------------------------------------------------------------
// Histórico (E7, mudança v2). Cabeçalhos como saem nas exportações do sistema
// anterior: servem só para reconhecer a coluna; a tela mostra o rótulo nosso.

const PESSOA_DO_TITULO = ['Pessoa', 'Cliente', 'Fornecedor', 'Nome', 'Favorecido', 'Sacado', 'Cliente/Fornecedor'];
const DOC_DA_PESSOA = ['CPF/CNPJ', 'CNPJ/CPF', 'CPF', 'CNPJ', 'CPF ou CNPJ'];

const LISTAS_DO_HISTORICO: DefinicaoDaLista[] = [
  {
    id: 'liquidados',
    rotulo: 'Contas já liquidadas (histórico)',
    historico: true,
    adivinhar: false,
    comoExportar: [
      'Abra a lista de contas a pagar e a receber.',
      'Em "Data de", escolha Liquidação; em Situação, Liquidado. Um arquivo por mês, até a data de corte.',
      'Deixe à mostra Pessoa, CPF/CNPJ, Movimento, Documento, Descrição, Emissão, Vencimento, Liquidação, Valor, Valor Final, Categoria, Conta e Forma de pagamento.',
    ],
    campos: [
      { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto', obrigatorio: true, sinonimos: PESSOA_DO_TITULO },
      { id: 'razao_social', rotulo: 'Razão social', tipo: 'texto', sinonimos: ['Razão social'] },
      { id: 'documento_pessoa', rotulo: 'CPF/CNPJ da pessoa', tipo: 'documento', sinonimos: DOC_DA_PESSOA },
      { id: 'movimento', rotulo: 'A pagar ou a receber', tipo: 'texto', sinonimos: ['Movimento', 'Movimentação', 'Pagar/Receber', 'Receber/Pagar', 'Tipo de movimento', 'Natureza', 'Pagar ou receber'] },
      { id: 'numero', rotulo: 'Número no sistema anterior', tipo: 'texto', sinonimos: ['Número', 'Nº', 'Numero', 'Código'] },
      { id: 'documento', rotulo: 'Documento', tipo: 'texto', sinonimos: ['Documento', 'Nº documento', 'Número do documento', 'Nota', 'Nota fiscal', 'NF'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', sinonimos: ['Descrição', 'Histórico', 'Descricao'] },
      { id: 'emissao', rotulo: 'Emissão', tipo: 'data', sinonimos: ['Emissão', 'Data de emissão', 'Data emissão', 'Competência', 'Cadastrado em'] },
      { id: 'vencimento', rotulo: 'Vencimento', tipo: 'data', obrigatorio: true, sinonimos: ['Vencimento', 'Data de vencimento', 'Data vencimento', 'Vence em'] },
      { id: 'liquidacao', rotulo: 'Liquidação', tipo: 'data', obrigatorio: true, sinonimos: ['Liquidação', 'Data de liquidação', 'Pagamento', 'Recebimento', 'Data de pagamento', 'Data de recebimento', 'Baixa', 'Pago em', 'Recebido em'] },
      { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro', sinonimos: ['Valor', 'Valor original', 'Valor do título'] },
      { id: 'valor_final', rotulo: 'Valor final', tipo: 'dinheiro', sinonimos: ['Valor Final', 'Valor total', 'Total'] },
      { id: 'valor_pago', rotulo: 'Valor pago ou recebido', tipo: 'dinheiro', sinonimos: ['Valor pago', 'Valor recebido', 'Valor liquidado', 'Valor da baixa'] },
      { id: 'juros', rotulo: 'Juros', tipo: 'dinheiro', sinonimos: ['Juros'] },
      { id: 'multa', rotulo: 'Multa', tipo: 'dinheiro', sinonimos: ['Multa'] },
      { id: 'desconto', rotulo: 'Desconto', tipo: 'dinheiro', sinonimos: ['Desconto', 'Descontos'] },
      { id: 'taxa', rotulo: 'Taxa (banco ou cartão)', tipo: 'dinheiro', sinonimos: ['Taxa', 'Taxa do cartão', 'Taxa banco', 'Tarifa bancária'] },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto', sinonimos: ['Situação', 'Status', 'Situacao'] },
      { id: 'categoria', rotulo: 'Categoria', tipo: 'texto', sinonimos: ['Categoria', 'Categorias', 'Plano de contas', 'Conta contábil'] },
      { id: 'grupo', rotulo: 'Grupo da categoria', tipo: 'texto', sinonimos: ['Grupo', 'Grupo de categoria', 'Grupo da categoria'] },
      { id: 'centro_custo', rotulo: 'Centro de custo', tipo: 'texto', sinonimos: ['Centro de custo', 'Centro de custos', 'Centro'] },
      { id: 'conta', rotulo: 'Conta da liquidação', tipo: 'texto', sinonimos: ['Conta', 'Conta bancária', 'Conta da liquidação', 'Conta (previsão)'] },
      { id: 'empresa', rotulo: 'Empresa', tipo: 'texto', sinonimos: ['Empresa', 'Filial', 'Loja', 'Unidade'] },
      { id: 'venda', rotulo: 'Venda Nº', tipo: 'texto', sinonimos: ['Venda Nº', 'Venda', 'Nº da venda', 'Número da venda'] },
      { id: 'fatura', rotulo: 'Fatura Nº', tipo: 'texto', sinonimos: ['Fatura Nº', 'Fatura', 'Nº da fatura', 'Número da fatura'] },
      { id: 'vendedor', rotulo: 'Vendedor', tipo: 'texto', sinonimos: ['Vendedor', 'Vendedora', 'Agente'] },
      { id: 'parcela', rotulo: 'Parcela', tipo: 'parcela', sinonimos: ['Parcela', 'Parcelas', 'Nº parcela'] },
      { id: 'forma', rotulo: 'Forma de pagamento', tipo: 'texto', sinonimos: ['Formas de pagamento', 'Forma de pagamento', 'Forma'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda'] },
      { id: 'observacoes', rotulo: 'Observações', tipo: 'texto', sinonimos: ['Observações', 'Observação', 'Obs'] },
    ],
    algumDe: [['valor', 'valor_final', 'valor_pago']],
  },
  {
    id: 'movimentos',
    rotulo: 'Movimentações e extrato de conta',
    historico: true,
    comoExportar: [
      'Abra as movimentações das contas (ou o extrato de cada conta).',
      'Escolha o período até a data de corte, um mês por arquivo.',
      'Deixe à mostra Data, Conta, Pessoa, CPF/CNPJ, Descrição, Documento, Forma de pagamento, Movimento e Valor.',
    ],
    campos: [
      { id: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true, sinonimos: ['Data', 'Data do movimento', 'Data da movimentação', 'Dia'] },
      { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro', obrigatorio: true, sinonimos: ['Valor', 'Valor (R$)', 'Valor movimentado', 'Quantia'] },
      { id: 'conta', rotulo: 'Conta', tipo: 'texto', obrigatorio: true, sinonimos: ['Conta', 'Conta bancária', 'Banco/Conta'] },
      { id: 'movimento', rotulo: 'Entrada ou saída', tipo: 'texto', sinonimos: ['Movimento', 'Entrada/Saída', 'Crédito/Débito', 'C/D', 'D/C', 'Natureza'] },
      { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto', sinonimos: ['Pessoa', 'Pessoa - Nome', 'Favorecido', 'Cliente/Fornecedor', 'Nome'] },
      { id: 'documento_pessoa', rotulo: 'CPF/CNPJ da pessoa', tipo: 'documento', sinonimos: ['CPF/CNPJ', 'Pessoa - CPF/CNPJ', 'CNPJ/CPF', 'CPF', 'CNPJ'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', sinonimos: ['Descrição', 'Histórico', 'Informações', 'Descricao'] },
      { id: 'documento', rotulo: 'Documento', tipo: 'texto', sinonimos: ['Documento', 'Nº documento', 'Cheque - Número'] },
      { id: 'numero', rotulo: 'Número no sistema anterior', tipo: 'texto', sinonimos: ['Número', 'Nº', 'Código'] },
      { id: 'venda', rotulo: 'Venda Nº', tipo: 'texto', sinonimos: ['Número Venda', 'Venda Nº', 'Venda'] },
      { id: 'fatura', rotulo: 'Fatura Nº', tipo: 'texto', sinonimos: ['Número Fatura', 'Fatura Nº', 'Fatura'] },
      { id: 'forma', rotulo: 'Forma de pagamento', tipo: 'texto', sinonimos: ['Forma Pagamento', 'Forma de pagamento', 'Forma'] },
      { id: 'categoria', rotulo: 'Categoria', tipo: 'texto', sinonimos: ['Categoria'] },
      { id: 'empresa', rotulo: 'Empresa', tipo: 'texto', sinonimos: ['Empresa', 'Filial', 'Unidade'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda'] },
    ],
  },
  {
    id: 'vendas',
    rotulo: 'Vendas por produto',
    historico: true,
    comoExportar: [
      'Abra o relatório de vendas por produto.',
      'Em "Data de", escolha Venda; um mês por arquivo. Traga também as viagens que ainda vão acontecer.',
      'Deixe à mostra Venda Nº, Data Venda, Situação, Produto, Pagante, CPF, CNPJ, Vendedor, Fornecedor, Representante, Intermediário, Passageiros, Documento, Data Início, Data Fim, Total Produtos, Total Taxas, Taxa DU, Taxa RAV, Comissão, Over, Desconto, Valor Total e Moeda.',
    ],
    campos: [
      { id: 'venda', rotulo: 'Venda Nº', tipo: 'texto', obrigatorio: true, sinonimos: ['Venda Nº', 'Nº da venda', 'Número da venda', 'Numero venda', 'Venda'] },
      { id: 'data_venda', rotulo: 'Data da venda', tipo: 'data', obrigatorio: true, sinonimos: ['Data Venda', 'Data da venda', 'Emissão da venda'] },
      { id: 'produto', rotulo: 'Produto (tipo)', tipo: 'texto', obrigatorio: true, sinonimos: ['Produto', 'Tipo de produto', 'Tipo produto', 'Serviço'] },
      { id: 'pagante', rotulo: 'Cliente (pagante)', tipo: 'texto', obrigatorio: true, sinonimos: ['Pagante', 'Cliente', 'Contratante'] },
      { id: 'cpf', rotulo: 'CPF do cliente', tipo: 'documento', sinonimos: ['CPF', 'CPF do pagante'] },
      { id: 'cnpj', rotulo: 'CNPJ do cliente', tipo: 'documento', sinonimos: ['CNPJ', 'CNPJ do pagante'] },
      { id: 'documento_cliente', rotulo: 'CPF/CNPJ do cliente', tipo: 'documento', sinonimos: ['CPF/CNPJ', 'CNPJ/CPF'] },
      { id: 'email', rotulo: 'E-mail do cliente', tipo: 'texto', sinonimos: ['E-mail', 'Email'] },
      { id: 'situacao', rotulo: 'Situação da venda', tipo: 'texto', sinonimos: ['Situação', 'Situação Venda', 'Situação da venda'] },
      { id: 'cancelado', rotulo: 'Produto cancelado', tipo: 'simnao', sinonimos: ['Produto Cancelado', 'Cancelado'] },
      { id: 'data_cancelamento', rotulo: 'Data do cancelamento', tipo: 'data', sinonimos: ['Data Cancelamento', 'Cancelado em'] },
      { id: 'empresa', rotulo: 'Empresa', tipo: 'texto', sinonimos: ['Empresa', 'Filial', 'Unidade'] },
      { id: 'vendedor', rotulo: 'Vendedor', tipo: 'texto', sinonimos: ['Vendedor', 'Vendedora', 'Agente'] },
      { id: 'intermediario', rotulo: 'Intermediário', tipo: 'texto', sinonimos: ['Intermediário', 'Intermediario', 'Agência parceira'] },
      { id: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto', sinonimos: ['Fornecedor', 'Operadora', 'Companhia'] },
      { id: 'representante', rotulo: 'Representante', tipo: 'texto', sinonimos: ['Representante', 'Consolidador'] },
      { id: 'passageiros', rotulo: 'Passageiros', tipo: 'texto', sinonimos: ['Passageiros', 'Passageiro', 'Hóspedes', 'Pax'] },
      { id: 'localizador', rotulo: 'Localizador ou documento', tipo: 'texto', sinonimos: ['Documento', 'Localizador', 'Bilhete', 'Voucher', 'Reserva'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', sinonimos: ['Descrição', 'Destino', 'Pacote', 'Trechos'] },
      { id: 'data_inicio', rotulo: 'Início da viagem', tipo: 'data', sinonimos: ['Data Início', 'Início', 'Embarque', 'Check-in', 'Ida'] },
      { id: 'data_fim', rotulo: 'Fim da viagem', tipo: 'data', sinonimos: ['Data Fim', 'Fim', 'Retorno', 'Check-out', 'Volta'] },
      { id: 'quantidade', rotulo: 'Quantidade', tipo: 'texto', sinonimos: ['Quantidade', 'Qtd'] },
      { id: 'valor_unitario', rotulo: 'Valor unitário', tipo: 'dinheiro', sinonimos: ['Valor Unitário', 'Valor unitario'] },
      { id: 'tarifa', rotulo: 'Tarifa (total dos produtos)', tipo: 'dinheiro', sinonimos: ['Total Produtos', 'Tarifa', 'Valor dos produtos', 'Valor Produto'] },
      { id: 'taxas', rotulo: 'Taxas', tipo: 'dinheiro', sinonimos: ['Total Taxas', 'Taxas', 'Taxa de embarque'] },
      { id: 'outras_taxas', rotulo: 'Outras taxas', tipo: 'dinheiro', sinonimos: ['Outras Taxas'] },
      { id: 'taxa_du', rotulo: 'Taxa DU', tipo: 'dinheiro', sinonimos: ['Taxa DU', 'DU'] },
      { id: 'rav', rotulo: 'RAV', tipo: 'dinheiro', sinonimos: ['Taxa RAV', 'RAV'] },
      { id: 'fee', rotulo: 'Fee', tipo: 'dinheiro', sinonimos: ['Fee', 'Taxa de serviço', 'Taxa Serviço Destacada', 'Taxa Serviço Oculta'] },
      { id: 'markup', rotulo: 'Markup', tipo: 'dinheiro', sinonimos: ['Markup', 'Mark-up'] },
      { id: 'comissao', rotulo: 'Comissão', tipo: 'dinheiro', sinonimos: ['Comissão', 'Comissao', 'Comissão do fornecedor'] },
      { id: 'over', rotulo: 'Over', tipo: 'dinheiro', sinonimos: ['Over', 'Incentivo'] },
      { id: 'taxa_cc', rotulo: 'Taxa CC (DU/RAV)', tipo: 'dinheiro', sinonimos: ['Taxa CC DU', 'Taxa CC RAV', 'Taxa CC'] },
      { id: 'desconto', rotulo: 'Desconto', tipo: 'dinheiro', sinonimos: ['Total Desconto', 'Desconto', 'Abatimentos'] },
      { id: 'valor_total', rotulo: 'Valor total do produto', tipo: 'dinheiro', sinonimos: ['Valor Total', 'Total', 'Valor da venda'] },
      { id: 'receita', rotulo: 'Receita no sistema anterior', tipo: 'dinheiro', sinonimos: ['Receitas', 'Receita'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda Venda', 'Moeda', 'Moeda Origem'] },
      { id: 'cambio', rotulo: 'Câmbio', tipo: 'texto', sinonimos: ['Câmbio Operadora', 'Câmbio', 'Cambio'] },
    ],
  },
  {
    id: 'faturas',
    rotulo: 'Faturas ao cliente (registro)',
    historico: true,
    adivinhar: false,
    comoExportar: [
      'As faturas ficam na própria lista de contas a pagar e a receber, com a coluna Fatura Nº.',
      'Exporte com Fatura Nº, Pessoa, CPF/CNPJ, Emissão, Vencimento, Liquidação, Valor e Situação. Um arquivo por mês.',
    ],
    campos: [
      { id: 'fatura', rotulo: 'Fatura Nº', tipo: 'texto', obrigatorio: true, sinonimos: ['Fatura Nº', 'Fatura', 'Nº da fatura', 'Número da fatura', 'Número Fatura'] },
      { id: 'pessoa', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, sinonimos: ['Pessoa', 'Cliente', 'Pagante', 'Sacado'] },
      { id: 'documento_pessoa', rotulo: 'CPF/CNPJ', tipo: 'documento', sinonimos: DOC_DA_PESSOA },
      { id: 'emissao', rotulo: 'Emissão', tipo: 'data', sinonimos: ['Emissão', 'Faturado em', 'Data de emissão'] },
      { id: 'vencimento', rotulo: 'Vencimento', tipo: 'data', sinonimos: ['Vencimento', 'Data de vencimento'] },
      { id: 'liquidacao', rotulo: 'Liquidação', tipo: 'data', sinonimos: ['Liquidação', 'Recebimento'] },
      { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro', obrigatorio: true, sinonimos: ['Valor Final', 'Valor', 'Valor total', 'Total'] },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto', sinonimos: ['Situação', 'Status'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', sinonimos: ['Descrição', 'Histórico'] },
    ],
  },
  {
    id: 'notas',
    rotulo: 'Notas fiscais emitidas (registro)',
    historico: true,
    comoExportar: [
      'Abra a lista de notas fiscais, escolha o período (um mês por arquivo) e a situação Emitida.',
      'Deixe à mostra Número, Série, Data de emissão, Tomador, CPF/CNPJ, Valor total dos serviços, Valor ISS, Situação, Código de verificação e Venda Nº.',
    ],
    campos: [
      { id: 'numero', rotulo: 'Número da nota', tipo: 'texto', obrigatorio: true, sinonimos: ['Número da nota', 'Número NFS-e', 'NFS-e', 'Número', 'Nº', 'Nota'] },
      { id: 'serie', rotulo: 'Série', tipo: 'texto', sinonimos: ['Série', 'Serie'] },
      { id: 'emissao', rotulo: 'Data de emissão', tipo: 'data', obrigatorio: true, sinonimos: ['Data de Emissão', 'Emissão', 'Data emissão'] },
      { id: 'tomador', rotulo: 'Tomador', tipo: 'texto', obrigatorio: true, sinonimos: ['Tomador', 'Nome/Razão social', 'Razão social do tomador'] },
      { id: 'documento', rotulo: 'CPF/CNPJ do tomador', tipo: 'documento', sinonimos: DOC_DA_PESSOA },
      { id: 'valor', rotulo: 'Valor dos serviços', tipo: 'dinheiro', obrigatorio: true, sinonimos: ['Valor Total Serviços', 'Valor dos serviços', 'Valor total', 'Valor'] },
      { id: 'iss', rotulo: 'ISS', tipo: 'dinheiro', sinonimos: ['Valor ISS', 'ISS'] },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto', sinonimos: ['Situação', 'Status'] },
      { id: 'codigo_verificacao', rotulo: 'Código de verificação', tipo: 'texto', sinonimos: ['Código de verificação', 'Código verificação', 'Verificação'] },
      { id: 'venda', rotulo: 'Venda Nº', tipo: 'texto', sinonimos: ['Venda Nº', 'Venda', 'Número Venda'] },
    ],
  },
  {
    id: 'comissoes_pagas',
    rotulo: 'Comissões já pagas (registro)',
    historico: true,
    comoExportar: [
      'Abra as comissões já pagas de cada pessoa (ou a conta a pagar de cada pagamento de comissão).',
      'Deixe à mostra Pessoa, Venda Nº, Data Venda, Pagante, Descrição, Valor, Valor Retido e a data do pagamento.',
    ],
    campos: [
      { id: 'pessoa', rotulo: 'Quem recebeu', tipo: 'texto', obrigatorio: true, sinonimos: ['Pessoa', 'Vendedor', 'Comissionado', 'Nome'] },
      { id: 'data_venda', rotulo: 'Data da venda', tipo: 'data', obrigatorio: true, sinonimos: ['Data Venda', 'Data da venda'] },
      { id: 'valor', rotulo: 'Valor da comissão', tipo: 'dinheiro', obrigatorio: true, sinonimos: ['Valor', 'Comissão', 'Valor da comissão'] },
      { id: 'venda', rotulo: 'Venda Nº', tipo: 'texto', sinonimos: ['Venda Nº', 'Venda', 'Número Venda'] },
      { id: 'pagante', rotulo: 'Cliente da venda', tipo: 'texto', sinonimos: ['Pagante', 'Cliente'] },
      { id: 'descricao', rotulo: 'Descrição ou produto', tipo: 'texto', sinonimos: ['Descrição/Produto', 'Descrição', 'Produto'] },
      { id: 'documento', rotulo: 'Documento', tipo: 'texto', sinonimos: ['Documento'] },
      { id: 'retido', rotulo: 'Valor retido', tipo: 'dinheiro', sinonimos: ['Valor Retido', 'Retido'] },
      { id: 'pago_em', rotulo: 'Pago em', tipo: 'data', sinonimos: ['Pago em', 'Data do pagamento', 'Pagamento', 'Liquidação'] },
      { id: 'funcao', rotulo: 'Função', tipo: 'texto', sinonimos: ['Função', 'Funcao'] },
    ],
  },
  {
    id: 'metas',
    rotulo: 'Metas',
    historico: true,
    comoExportar: ['Abra as metas, escolha o ano e exporte. Uma linha por pessoa e função, com os 12 meses.'],
    campos: [
      { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto', obrigatorio: true, sinonimos: ['Pessoa', 'Vendedor', 'Nome'] },
      { id: 'funcao', rotulo: 'Função', tipo: 'texto', sinonimos: ['Função', 'Funcao'] },
      { id: 'plano', rotulo: 'Plano', tipo: 'texto', sinonimos: ['Plano', 'Plano de comissão'] },
      { id: 'ano', rotulo: 'Ano', tipo: 'texto', sinonimos: ['Ano'] },
      ...MESES_DO_ANO.map((m, i) => ({ id: CAMPOS_DOS_MESES[i], rotulo: m, tipo: 'dinheiro' as const, sinonimos: [m, m.slice(0, 3)] })),
    ],
    algumDe: [CAMPOS_DOS_MESES],
  },
  {
    id: 'reembolsos',
    rotulo: 'Reembolsos em aberto',
    historico: true,
    comoExportar: [
      'Abra os reembolsos (ao cliente e do fornecedor) que ainda não foram pagos.',
      'Deixe à mostra Pessoa, CPF/CNPJ, Tipo (ao cliente ou do fornecedor), Venda Nº, Valor, Prazo e Descrição.',
    ],
    campos: [
      { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto', obrigatorio: true, sinonimos: ['Pessoa', 'Cliente', 'Fornecedor', 'Favorecido', 'Nome'] },
      { id: 'documento_pessoa', rotulo: 'CPF/CNPJ', tipo: 'documento', sinonimos: DOC_DA_PESSOA },
      { id: 'tipo', rotulo: 'Ao cliente ou do fornecedor', tipo: 'texto', sinonimos: ['Tipo', 'Tipo de reembolso', 'Reembolso', 'Movimento'] },
      { id: 'valor', rotulo: 'Valor do reembolso', tipo: 'dinheiro', obrigatorio: true, sinonimos: ['Valor', 'Valor do reembolso', 'Reembolso ao Cliente', 'Reembolso do Fornecedor'] },
      { id: 'prazo', rotulo: 'Prazo', tipo: 'data', sinonimos: ['Prazo', 'Vencimento', 'Data prevista'] },
      { id: 'venda', rotulo: 'Venda Nº', tipo: 'texto', sinonimos: ['Venda Nº', 'Venda', 'Número Venda'] },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto', sinonimos: ['Situação', 'Status'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', sinonimos: ['Descrição', 'Motivo', 'Histórico'] },
    ],
  },
  {
    id: 'creditos',
    rotulo: 'Créditos de clientes',
    historico: true,
    comoExportar: [
      'Abra os créditos que os clientes têm com a agência (saldo a usar em próximas viagens).',
      'Deixe à mostra Cliente, CPF/CNPJ, Saldo, Validade, Venda de origem e Descrição.',
    ],
    campos: [
      { id: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true, sinonimos: ['Cliente', 'Pessoa', 'Nome'] },
      { id: 'documento_pessoa', rotulo: 'CPF/CNPJ', tipo: 'documento', sinonimos: DOC_DA_PESSOA },
      { id: 'saldo', rotulo: 'Saldo do crédito', tipo: 'dinheiro', obrigatorio: true, sinonimos: ['Saldo', 'Saldo do crédito', 'Crédito', 'Valor disponível', 'Valor'] },
      { id: 'validade', rotulo: 'Validade', tipo: 'data', sinonimos: ['Validade', 'Válido até', 'Vence em'] },
      { id: 'venda', rotulo: 'Venda de origem', tipo: 'texto', sinonimos: ['Venda Origem Crédito', 'Venda de origem', 'Venda Nº', 'Venda'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', sinonimos: ['Descrição', 'Motivo', 'Histórico'] },
    ],
  },
];

export const LISTAS: DefinicaoDaLista[] = [
  {
    id: 'contas',
    rotulo: 'Contas bancárias e cartões',
    comoExportar: [
      'Abra a lista de contas e cartões da agência.',
      'Deixe à mostra as colunas Descrição, Tipo, Banco, Agência, Conta e Saldo.',
      'Use Exportar e escolha Excel ou Texto.',
    ],
    campos: [
      { id: 'nome', rotulo: 'Nome da conta', tipo: 'texto', obrigatorio: true, sinonimos: ['Descrição', 'Nome', 'Nome da conta', 'Conta', 'Conta bancária', 'Apelido'] },
      { id: 'tipo', rotulo: 'Tipo da conta', tipo: 'texto', sinonimos: ['Tipo', 'Tipo da conta', 'Tipo de conta'], dica: 'Corrente, Caixa, Poupança, Cartão de crédito ou Aplicação' },
      { id: 'banco', rotulo: 'Banco', tipo: 'texto', sinonimos: ['Banco', 'Nº do banco', 'Número do banco', 'Código do banco', 'Instituição'] },
      { id: 'agencia', rotulo: 'Agência', tipo: 'texto', sinonimos: ['Agência', 'Agência/Dígito', 'Ag'] },
      { id: 'numero', rotulo: 'Número da conta', tipo: 'texto', sinonimos: ['Conta', 'Número', 'Número da conta', 'Nº da conta', 'Conta/Dígito', 'Conta corrente'] },
      { id: 'saldo', rotulo: 'Saldo na data de corte', tipo: 'dinheiro', sinonimos: ['Saldo', 'Saldo atual', 'Saldo na data', 'Saldo final'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda'] },
      { id: 'ativa', rotulo: 'Ativa', tipo: 'simnao', sinonimos: ['Ativa', 'Ativo', 'Situação'] },
      { id: 'dia_fechamento', rotulo: 'Dia de fechamento da fatura', tipo: 'texto', sinonimos: ['Fechamento da fatura', 'Dia de fechamento', 'Fechamento fatura'] },
      { id: 'dia_vencimento', rotulo: 'Dia de vencimento da fatura', tipo: 'texto', sinonimos: ['Vencimento da fatura', 'Dia de vencimento', 'Vencimento fatura'] },
    ],
  },
  {
    id: 'categorias',
    rotulo: 'Categorias',
    comoExportar: [
      'Abra a lista de categorias do financeiro.',
      'Exporte com as colunas Descrição, Grupo e Tipo (Receita ou Despesa).',
    ],
    campos: [
      { id: 'nome', rotulo: 'Categoria', tipo: 'texto', obrigatorio: true, sinonimos: ['Descrição', 'Categoria', 'Nome', 'Nome da categoria'] },
      { id: 'grupo', rotulo: 'Grupo', tipo: 'texto', sinonimos: ['Grupo', 'Grupo de categoria', 'Grupo da categoria', 'Categoria pai'] },
      { id: 'tipo', rotulo: 'Receita ou despesa', tipo: 'texto', sinonimos: ['Tipo', 'Natureza', 'Movimento', 'Receita/Despesa'] },
      { id: 'repasse', rotulo: 'Repasse', tipo: 'simnao', sinonimos: ['Repasse', 'É repasse'] },
    ],
  },
  {
    id: 'centros_custo',
    rotulo: 'Centros de custo',
    comoExportar: ['Abra a lista de centros de custo e exporte a coluna Descrição.'],
    campos: [
      { id: 'nome', rotulo: 'Centro de custo', tipo: 'texto', obrigatorio: true, sinonimos: ['Descrição', 'Centro de custo', 'Centro de custos', 'Centro', 'Nome'] },
    ],
  },
  {
    id: 'pessoas',
    rotulo: 'Pessoas (clientes e fornecedores)',
    comoExportar: [
      'Abra a lista de pessoas.',
      'Deixe à mostra Nome, Razão social, CPF, CNPJ, E-mail, Telefone e Celular.',
      'Se a lista for grande, exporte por letra ou por tipo: o sistema anterior corta listas longas.',
    ],
    campos: [
      { id: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, sinonimos: ['Nome', 'Pessoa', 'Cliente', 'Fornecedor', 'Nome fantasia', 'Favorecido'] },
      { id: 'razao_social', rotulo: 'Razão social', tipo: 'texto', sinonimos: ['Razão social', 'Razao'] },
      { id: 'documento', rotulo: 'CPF/CNPJ', tipo: 'documento', sinonimos: ['CPF/CNPJ', 'CNPJ/CPF', 'Documento', 'CPF ou CNPJ'] },
      { id: 'cpf', rotulo: 'CPF', tipo: 'documento', sinonimos: ['CPF'] },
      { id: 'cnpj', rotulo: 'CNPJ', tipo: 'documento', sinonimos: ['CNPJ'] },
      { id: 'email', rotulo: 'E-mail', tipo: 'texto', sinonimos: ['E-mail', 'Email', 'Correio eletrônico'] },
      { id: 'telefone', rotulo: 'Telefone', tipo: 'texto', sinonimos: ['Telefone', 'Fone', 'Telefone comercial', 'Telefone fixo'] },
      { id: 'celular', rotulo: 'Celular', tipo: 'texto', sinonimos: ['Celular', 'Telefone celular', 'WhatsApp', 'Whatsapp'] },
      { id: 'tipo_pessoa', rotulo: 'Pessoa física ou jurídica', tipo: 'texto', sinonimos: ['Tipo', 'Tipo de pessoa', 'Pessoa física/jurídica'] },
      { id: 'papel', rotulo: 'Cliente ou fornecedor', tipo: 'texto', sinonimos: ['Papel', 'Perfil', 'Cadastro', 'Cliente/Fornecedor', 'Categoria da pessoa'] },
      { id: 'cep', rotulo: 'CEP', tipo: 'texto', sinonimos: ['CEP'] },
      { id: 'endereco', rotulo: 'Endereço', tipo: 'texto', sinonimos: ['Endereço', 'Logradouro', 'Rua'] },
      { id: 'numero_endereco', rotulo: 'Número', tipo: 'texto', sinonimos: ['Número', 'Nº'] },
      { id: 'bairro', rotulo: 'Bairro', tipo: 'texto', sinonimos: ['Bairro'] },
      { id: 'cidade', rotulo: 'Cidade', tipo: 'texto', sinonimos: ['Cidade', 'Município'] },
      { id: 'uf', rotulo: 'UF', tipo: 'texto', sinonimos: ['UF', 'Estado'] },
      { id: 'codigo', rotulo: 'Código no sistema anterior', tipo: 'texto', sinonimos: ['Código', 'Cód', 'Codigo'] },
    ],
  },
  {
    id: 'titulos',
    rotulo: 'Contas a pagar e a receber em aberto',
    comoExportar: [
      'Abra a lista de contas a pagar e a receber.',
      'Filtre a situação "Em aberto" e o período pelo vencimento.',
      'Exporte UM ARQUIVO POR MÊS: o sistema anterior corta listas grandes e só mostra os primeiros registros.',
      'Deixe à mostra Pessoa, CPF/CNPJ, Movimento, Documento, Descrição, Emissão, Vencimento, Liquidação, Valor Final, Categoria, Centro de custo, Conta e Parcelas.',
    ],
    campos: [
      { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto', obrigatorio: true, sinonimos: ['Pessoa', 'Cliente', 'Fornecedor', 'Nome', 'Favorecido', 'Sacado', 'Cliente/Fornecedor'] },
      { id: 'razao_social', rotulo: 'Razão social', tipo: 'texto', sinonimos: ['Razão social'] },
      { id: 'documento_pessoa', rotulo: 'CPF/CNPJ da pessoa', tipo: 'documento', sinonimos: ['CPF/CNPJ', 'CNPJ/CPF', 'CPF', 'CNPJ', 'CPF ou CNPJ'] },
      { id: 'movimento', rotulo: 'A pagar ou a receber', tipo: 'texto', sinonimos: ['Movimento', 'Pagar/Receber', 'Receber/Pagar', 'Tipo de movimento', 'Natureza', 'Movimentação', 'Pagar ou receber'] },
      { id: 'numero', rotulo: 'Número no sistema anterior', tipo: 'texto', sinonimos: ['Número', 'Nº', 'Numero', 'Código'] },
      { id: 'documento', rotulo: 'Documento', tipo: 'texto', sinonimos: ['Documento', 'Nº documento', 'Número do documento', 'Nota', 'Nota fiscal', 'NF'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', sinonimos: ['Descrição', 'Histórico', 'Descricao'] },
      { id: 'emissao', rotulo: 'Emissão', tipo: 'data', sinonimos: ['Emissão', 'Data de emissão', 'Data emissão', 'Competência', 'Cadastrado em'] },
      { id: 'vencimento', rotulo: 'Vencimento', tipo: 'data', obrigatorio: true, sinonimos: ['Vencimento', 'Data de vencimento', 'Data vencimento', 'Vence em'] },
      { id: 'liquidacao', rotulo: 'Liquidação', tipo: 'data', sinonimos: ['Liquidação', 'Data de liquidação', 'Pagamento', 'Recebimento', 'Data de pagamento', 'Data de recebimento', 'Baixa'] },
      { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro', sinonimos: ['Valor', 'Valor original', 'Valor do título'] },
      { id: 'valor_final', rotulo: 'Valor final', tipo: 'dinheiro', sinonimos: ['Valor Final', 'Valor total', 'Total', 'Saldo', 'Valor em aberto'] },
      { id: 'situacao', rotulo: 'Situação', tipo: 'texto', sinonimos: ['Situação', 'Status', 'Situacao'] },
      { id: 'categoria', rotulo: 'Categoria', tipo: 'texto', sinonimos: ['Categoria', 'Categorias', 'Plano de contas', 'Conta contábil'] },
      { id: 'grupo', rotulo: 'Grupo da categoria', tipo: 'texto', sinonimos: ['Grupo', 'Grupo de categoria', 'Grupo da categoria'] },
      { id: 'centro_custo', rotulo: 'Centro de custo', tipo: 'texto', sinonimos: ['Centro de custo', 'Centro de custos', 'Centro'] },
      { id: 'conta', rotulo: 'Conta (previsão)', tipo: 'texto', sinonimos: ['Conta', 'Conta previsão', 'Conta (previsão)', 'Conta bancária'] },
      { id: 'empresa', rotulo: 'Empresa', tipo: 'texto', sinonimos: ['Empresa', 'Filial', 'Loja', 'Unidade'] },
      { id: 'venda', rotulo: 'Venda Nº', tipo: 'texto', sinonimos: ['Venda Nº', 'Venda', 'Nº da venda', 'Número da venda'] },
      { id: 'fatura', rotulo: 'Fatura Nº', tipo: 'texto', sinonimos: ['Fatura Nº', 'Fatura', 'Nº da fatura', 'Número da fatura'] },
      { id: 'vendedor', rotulo: 'Vendedor', tipo: 'texto', sinonimos: ['Vendedor', 'Vendedora', 'Agente'] },
      { id: 'parcela', rotulo: 'Parcela', tipo: 'parcela', sinonimos: ['Parcela', 'Parcelas', 'Nº parcela'] },
      { id: 'forma', rotulo: 'Forma de pagamento', tipo: 'texto', sinonimos: ['Formas de pagamento', 'Forma de pagamento', 'Forma'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda'] },
      { id: 'observacoes', rotulo: 'Observações', tipo: 'texto', sinonimos: ['Observações', 'Observação', 'Obs'] },
    ],
    algumDe: [['valor', 'valor_final']],
  },
  {
    id: 'saldos',
    rotulo: 'Saldos das contas na data de corte',
    comoExportar: [
      'Abra o saldo das contas (ou o extrato de cada conta) na data de corte.',
      'Exporte a conta e o saldo. Pode ser uma conta por linha.',
    ],
    campos: [
      { id: 'conta', rotulo: 'Conta', tipo: 'texto', obrigatorio: true, sinonimos: ['Conta', 'Descrição', 'Nome', 'Nome da conta'] },
      { id: 'saldo', rotulo: 'Saldo', tipo: 'dinheiro', obrigatorio: true, sinonimos: ['Saldo', 'Saldo final', 'Saldo na data', 'Saldo atual', 'Saldo da conta'] },
      { id: 'data', rotulo: 'Data do saldo', tipo: 'data', sinonimos: ['Data', 'Fechamento', 'Data do saldo', 'Em'] },
      { id: 'moeda', rotulo: 'Moeda', tipo: 'texto', sinonimos: ['Moeda'] },
    ],
  },
  ...LISTAS_DO_HISTORICO,
];

export function definicaoDaLista(id: string): DefinicaoDaLista | null {
  return LISTAS.find(l => l.id === id) ?? null;
}

/** Mapeamento confirmado: campo → índice da coluna (0 = primeira). */
export type Mapeamento = Record<string, number>;

export interface SugestaoDeMapeamento {
  mapeamento: Mapeamento;
  /** Colunas que não casaram com nenhum campo (ficam de fora). */
  ignoradas: Array<{ indice: number; cabecalho: string }>;
  /** Campos obrigatórios (ou do grupo "pelo menos um") ainda sem coluna. */
  faltando: string[];
  /** Quantos cabeçalhos casaram (serve para escolher a lista). */
  pontos: number;
}

const SINONIMOS_NORMALIZADOS = new Map<string, Map<string, string[]>>();

function sinonimosDe(lista: DefinicaoDaLista): Map<string, string[]> {
  let m = SINONIMOS_NORMALIZADOS.get(lista.id);
  if (!m) {
    m = new Map();
    for (const c of lista.campos) m.set(c.id, c.sinonimos.map(normalizar).filter(Boolean));
    SINONIMOS_NORMALIZADOS.set(lista.id, m);
  }
  return m;
}

/**
 * Sugere o mapeamento de uma lista a partir dos cabeçalhos.
 *
 * Primeiro casam as colunas que só servem para um campo; depois as
 * ambíguas vão para o primeiro campo ainda livre, na ordem do dicionário.
 * Assim, nas contas, "Conta" vira o número quando há "Descrição", e o nome
 * da conta quando não há.
 */
export function sugerirMapeamento(cabecalhos: readonly string[], listaId: ListaId): SugestaoDeMapeamento {
  const lista = definicaoDaLista(listaId);
  if (!lista) return { mapeamento: {}, ignoradas: [], faltando: [], pontos: 0 };
  const sin = sinonimosDe(lista);
  const candidatos: Array<{ indice: number; cabecalho: string; campos: string[] }> = cabecalhos.map((cab, indice) => {
    const n = normalizar(cab);
    const campos = n ? lista.campos.filter(c => sin.get(c.id)!.includes(n)).map(c => c.id) : [];
    return { indice, cabecalho: cab, campos };
  });
  const mapeamento: Mapeamento = {};
  const usada = new Set<number>();
  for (const c of candidatos) {
    if (c.campos.length === 1 && mapeamento[c.campos[0]] === undefined) {
      mapeamento[c.campos[0]] = c.indice;
      usada.add(c.indice);
    }
  }
  for (const c of candidatos) {
    if (usada.has(c.indice) || c.campos.length < 2) continue;
    const livre = c.campos.find(id => mapeamento[id] === undefined);
    if (livre) { mapeamento[livre] = c.indice; usada.add(c.indice); }
  }
  const ignoradas = candidatos.filter(c => !usada.has(c.indice) && normalizar(c.cabecalho)).map(c => ({ indice: c.indice, cabecalho: c.cabecalho }));
  return { mapeamento, ignoradas, faltando: camposFaltando(lista, mapeamento), pontos: usada.size };
}

/** Campos obrigatórios sem coluna (e grupos "pelo menos um" vazios, como "valor ou valor_final"). */
export function camposFaltando(lista: DefinicaoDaLista, mapeamento: Mapeamento): string[] {
  const faltando = lista.campos.filter(c => c.obrigatorio && mapeamento[c.id] === undefined).map(c => c.id);
  for (const grupo of lista.algumDe ?? []) {
    if (!grupo.some(id => mapeamento[id] !== undefined)) faltando.push(grupo.join('|'));
  }
  return faltando;
}

/** Rótulo legível dos campos que faltam ("Vencimento", "Valor ou Valor final"). */
export function rotuloDosFaltando(listaId: ListaId, faltando: readonly string[]): string[] {
  const lista = definicaoDaLista(listaId);
  const rot = (id: string) => lista?.campos.find(c => c.id === id)?.rotulo ?? id;
  return faltando.map(f => f.split('|').map(rot).join(' ou '));
}

/**
 * Qual lista o arquivo parece ser. Ganha a que casa mais colunas sem faltar
 * obrigatório; empate fica com a ordem de ORDEM_DAS_LISTAS invertida (a
 * lista mais "rica", títulos, vence pessoas quando as duas casam igual).
 */
export function adivinharLista(cabecalhos: readonly string[]): { lista: ListaId; sugestao: SugestaoDeMapeamento } {
  let melhor: { lista: ListaId; sugestao: SugestaoDeMapeamento; nota: number } | null = null;
  // As listas da v1 primeiro (ordem invertida, como sempre), depois as do
  // histórico que o cabeçalho decide. Empate fica com quem veio antes: um
  // arquivo que a v1 já reconhecia continua reconhecido igual.
  const candidatas: ListaId[] = [...LISTAS_V1].reverse();
  for (const l of LISTAS) if (l.historico && l.adivinhar !== false) candidatas.push(l.id);
  for (const id of candidatas) {
    const s = sugerirMapeamento(cabecalhos, id);
    const nota = s.pontos * 10 - s.faltando.length * 25 + (s.faltando.length === 0 ? 5 : 0);
    if (!melhor || nota > melhor.nota) melhor = { lista: id, sugestao: s, nota };
  }
  return { lista: melhor!.lista, sugestao: melhor!.sugestao };
}

/** Confere um mapeamento enviado pela tela: campos existentes e colunas dentro do arquivo, sem repetir coluna. */
export function validarMapeamento(listaId: ListaId, mapeamento: unknown, colunas: number): { ok: true; mapeamento: Mapeamento } | { ok: false; erro: string } {
  const lista = definicaoDaLista(listaId);
  if (!lista) return { ok: false, erro: 'Lista desconhecida.' };
  if (!mapeamento || typeof mapeamento !== 'object' || Array.isArray(mapeamento)) return { ok: false, erro: 'Mapeamento inválido.' };
  const limpo: Mapeamento = {};
  const usadas = new Map<number, string>();
  for (const [campo, valor] of Object.entries(mapeamento as Record<string, unknown>)) {
    if (valor === null || valor === undefined || valor === '') continue;
    const def = lista.campos.find(c => c.id === campo);
    if (!def) return { ok: false, erro: `O campo "${campo}" não existe nesta lista.` };
    const i = Number(valor);
    if (!Number.isInteger(i) || i < 0 || i >= colunas) return { ok: false, erro: `A coluna escolhida para "${def.rotulo}" não existe no arquivo.` };
    if (usadas.has(i)) {
      const outro = lista.campos.find(c => c.id === usadas.get(i))?.rotulo ?? '';
      return { ok: false, erro: `A mesma coluna foi ligada a "${outro}" e a "${def.rotulo}". Escolha uma só.` };
    }
    usadas.set(i, campo);
    limpo[campo] = i;
  }
  return { ok: true, mapeamento: limpo };
}

/** Campos da lista cujo sinônimo é exatamente este cabeçalho (vazio = nenhum). */
export function camposDoCabecalho(cabecalho: string, listaId: ListaId): string[] {
  const lista = definicaoDaLista(listaId);
  if (!lista) return [];
  const n = normalizar(cabecalho);
  if (!n) return [];
  const sin = sinonimosDe(lista);
  return lista.campos.filter(c => sin.get(c.id)!.includes(n)).map(c => c.id);
}
