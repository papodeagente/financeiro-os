// Grupos OS - CRM & Agency Management Types

import { generateId } from './utils';

// ============================================================
// PESSOAS
// ============================================================

export interface Cliente {
  id: string;
  tipo: 'PF' | 'PJ';

  // PF
  nome_completo: string;
  cpf: string;
  rg: string;
  data_nascimento: string;
  genero: 'M' | 'F' | 'OUTRO' | '';
  estado_civil: string;
  nacionalidade: string;
  passaporte: string;
  validade_passaporte: string;

  // PJ
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  inscricao_estadual: string;

  // Contato
  telefone_principal: string;
  telefone_secundario: string;
  whatsapp: string;
  email: string;
  email_secundario: string;

  // Endereco
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  pais: string;

  // Cartoes
  cartoes: Array<{ bandeira: string; ultimos_digitos: string; titular: string; validade: string }>;

  // Anexos
  anexos: Array<{ id: string; nome: string; tipo: string; url: string; data_upload: string }>;

  // Tags
  marcadores: string[];
  campos_personalizados: Record<string, string>;

  // Preferencias
  preferencias: {
    tipo_viagem: string[];
    classe_voo: string;
    tipo_hotel: string;
    destinos_favoritos: string[];
    restricoes_alimentares: string;
    necessidades_especiais: string;
    assento_preferido: string;
    programa_fidelidade: Array<{ companhia: string; numero: string }>;
  };

  // Relacionamento
  vendedor_responsavel: string;
  indicado_por: string;
  data_cadastro: string;
  ultima_compra: string;
  total_compras: number;
  valor_total_historico: number;

  status: 'ATIVO' | 'INATIVO';
  observacoes: string;
}

export type TipoFornecedor = 'OPERADORA' | 'CONSOLIDADORA' | 'CIA_AEREA' | 'HOTEL' | 'RECEPTIVO' | 'SEGURADORA' | 'LOCADORA' | 'CRUZEIRO' | 'OUTROS';

export interface FornecedorCRM {
  id: string;
  tipo: TipoFornecedor;

  razao_social: string;
  nome_fantasia: string;
  cnpj: string;

  telefone: string;
  email: string;
  site: string;
  contato_principal: string;
  whatsapp: string;

  endereco_completo: string;
  cidade: string;
  estado: string;

  dados_bancarios: Array<{
    banco: string;
    agencia: string;
    conta: string;
    pix: string;
    titular: string;
  }>;

  regras_faturamento: {
    prazo_pagamento_dias: number;
    dia_corte: number;
    dia_vencimento: number;
    comissao_padrao: number;
    moeda_padrao: 'BRL' | 'USD' | 'EUR';
  };

  integracao_ativa: boolean;
  tipo_integracao: string;

  anexos: Array<{ nome: string; url: string; tipo: string }>;
  marcadores: string[];
  campos_personalizados: Record<string, string>;
  observacoes: string;
  status: 'ATIVO' | 'INATIVO';
}

export interface Membro {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  cargo: string;
  data_admissao: string;

  meta_mensal_vendas: number;
  meta_mensal_quantidade: number;
  plano_comissao_id: string;

  status: 'ATIVO' | 'INATIVO';
}

// ============================================================
// VENDAS
// ============================================================

export type TipoProdutoVenda = 'AEREO' | 'HOTEL' | 'PACOTE' | 'SEGURO' | 'RECEPTIVO' | 'CRUZEIRO' | 'CARRO' | 'INGRESSO' | 'OUTROS';
export type StatusProdutoVenda = 'RESERVADO' | 'CONFIRMADO' | 'EMITIDO' | 'CANCELADO' | 'ALTERADO';
export type StatusVendaCRM = 'ORCAMENTO' | 'RESERVADO' | 'CONFIRMADO' | 'CANCELADO' | 'CONCLUIDO';
export type FormaPagamentoCRM = 'AVISTA_PIX' | 'CARTAO' | 'BOLETO' | 'FATURADO' | 'MISTO';

export interface ProdutoVenda {
  id: string;
  tipo: TipoProdutoVenda;
  descricao: string;
  fornecedor_id: string;
  fornecedor_nome: string;
  data_inicio: string;
  data_fim: string;
  localizador: string;
  cia_aerea: string;
  trecho: string;
  hotel_nome: string;
  tipo_apto: string;
  regime: string;
  valor_custo: number;
  valor_venda: number;
  comissao_fornecedor: number;
  moeda: 'BRL' | 'USD' | 'EUR';
  cambio: number;
  status: StatusProdutoVenda;
  aprovador: string;
  solicitante: string;
  centro_custo: string;
  projeto: string;
}

export interface VendaCRM {
  id: string;
  numero: string;
  data_venda: string;
  tipo: 'AVULSA' | 'GRUPO';
  grupo_id: string | null;
  cliente_id: string;
  vendedor_id: string;

  passageiros: Array<{
    nome: string;
    tipo: 'ADT' | 'CHD' | 'INF';
    documento: string;
    data_nascimento: string;
    telefone: string;
    email: string;
  }>;

  pagantes: Array<{
    cliente_id: string;
    nome: string;
    percentual: number;
    valor: number;
  }>;

  produtos: ProdutoVenda[];

  valor_total_custo: number;
  valor_total_venda: number;
  markup_realizado: number;
  desconto: number;
  valor_final: number;

  forma_pagamento: FormaPagamentoCRM;
  parcelas: number;
  pagamento_detalhado: Array<{ forma: string; valor: number; parcelas: number }>;

  status: StatusVendaCRM;
  motivo_cancelamento: string;
  recibo_emitido: boolean;

  intermediario_id: string | null;
  comissao_intermediario: number;

  centro_custo: string;
  numero_po: string;

  anexos: Array<{ nome: string; url: string }>;
  observacoes: string;
  campos_personalizados: Record<string, string>;
}

export interface Orcamento {
  id: string;
  numero: string;
  data_criacao: string;
  validade: string;
  cliente_id: string;
  vendedor_id: string;

  template: {
    logo_agencia: string;
    cores: { primaria: string; secundaria: string; texto: string };
    titulo: string;
    subtitulo: string;
    imagem_capa: string;
    mensagem_abertura: string;
    mensagem_rodape: string;
    redes_sociais: Record<string, string>;
    whatsapp_vendedor: string;
  };

  itens: Array<{ titulo: string; descricao: string; imagem: string; valor: number; observacoes: string }>;
  opcoes_pagamento: Array<{ descricao: string; valor_total: number; parcelas: number; valor_parcela: number }>;
  inclusos: string[];
  nao_inclusos: string[];
  roteiro: Array<{ dia: number; titulo: string; descricao: string; imagem: string }>;

  status: 'RASCUNHO' | 'ENVIADO' | 'VISUALIZADO' | 'ACEITO' | 'RECUSADO' | 'EXPIRADO';
  link_publico: string;
  data_visualizacao: string | null;
  venda_id: string | null;
}

// ============================================================
// FINANCEIRO DA AGENCIA
// ============================================================

export interface PlanoContas {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA';
  categoria_pai_id: string | null;
  ativo: boolean;
}

export interface ContaBancaria {
  id: string;
  nome: string;
  tipo: 'CORRENTE' | 'POUPANCA' | 'CARTAO_CREDITO' | 'CAIXA' | 'APLICACAO';
  banco: string;
  agencia: string;
  conta: string;
  saldo_inicial: number;
  saldo_atual: number;
  limite: number;
  dia_fechamento: number;
  dia_vencimento: number;
}

export type StatusContaReceber = 'PENDENTE' | 'RECEBIDO' | 'ATRASADO' | 'CANCELADO' | 'PARCIAL';

export interface ContaReceber {
  id: string;
  origem: 'VENDA' | 'COMISSAO_FORNECEDOR' | 'FEE' | 'OUTROS';
  venda_id: string | null;
  grupo_id: string | null;
  cliente_id: string;
  cliente_nome: string;
  descricao: string;
  categoria_id: string;
  centro_custo: string;
  valor_original: number;
  juros: number;
  multa: number;
  desconto: number;
  valor_final: number;
  data_emissao: string;
  data_vencimento: string;
  data_recebimento: string | null;
  valor_recebido: number | null;
  conta_bancaria_id: string | null;
  forma_recebimento: 'PIX' | 'TED' | 'CARTAO' | 'BOLETO' | 'DINHEIRO' | 'CHEQUE' | '';
  parcela_numero: number;
  total_parcelas: number;
  boleto_emitido: boolean;
  boleto_codigo: string;
  boleto_url: string;
  status: StatusContaReceber;
  rateio: Array<{ centro_custo: string; percentual: number; valor: number }>;
  anexos: Array<{ nome: string; url: string }>;
  observacoes: string;
}

export type StatusContaPagar = 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'CANCELADO' | 'PARCIAL';

export interface ContaPagar {
  id: string;
  origem: 'VENDA' | 'GRUPO' | 'DESPESA_FIXA' | 'OUTROS';
  venda_id: string | null;
  grupo_id: string | null;
  fornecedor_id: string;
  fornecedor_nome: string;
  descricao: string;
  categoria_id: string;
  centro_custo: string;
  valor_original: number;
  juros: number;
  multa: number;
  desconto: number;
  valor_final: number;
  moeda: 'BRL' | 'USD' | 'EUR';
  cambio: number;
  valor_brl: number;
  data_emissao: string;
  data_vencimento: string;
  data_pagamento: string | null;
  valor_pago: number | null;
  conta_bancaria_id: string | null;
  forma_pagamento: 'PIX' | 'TED' | 'CARTAO_CORP' | 'BOLETO' | 'DEPOSITO' | '';
  comprovante: string;
  parcela_numero: number;
  total_parcelas: number;
  status: StatusContaPagar;
  rateio: Array<{ centro_custo: string; percentual: number; valor: number }>;
  anexos: Array<{ nome: string; url: string }>;
  observacoes: string;
}

export interface CentroCusto {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
}

// ============================================================
// CONFIGURACOES
// ============================================================

export interface Agencia {
  id: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  inscricao_municipal: string;
  cadastur: string;
  endereco: {
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
  };
  telefone: string;
  email: string;
  site: string;
  redes_sociais: Record<string, string>;
  logo: string;
  cores_identidade: { primaria: string; secundaria: string };
  regime_tributario: 'SIMPLES' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';
  aliquota_padrao: number;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  senha_hash: string;
  perfil: 'ADMIN' | 'GERENTE' | 'VENDEDOR' | 'FINANCEIRO' | 'VISUALIZADOR';
  permissoes: {
    ver_vendas_todos: boolean;
    ver_financeiro: boolean;
    editar_financeiro: boolean;
    ver_comissoes: boolean;
    acessar_relatorios: boolean;
    gerenciar_usuarios: boolean;
    ver_extrato_contas: string[];
  };
  ativo: boolean;
}

// ============================================================
// DEFAULTS / FACTORIES
// ============================================================

export function createCliente(): Cliente {
  return {
    id: generateId(), tipo: 'PF',
    nome_completo: '', cpf: '', rg: '', data_nascimento: '', genero: '', estado_civil: '',
    nacionalidade: 'Brasileira', passaporte: '', validade_passaporte: '',
    razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '',
    telefone_principal: '', telefone_secundario: '', whatsapp: '', email: '', email_secundario: '',
    cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '', pais: 'Brasil',
    cartoes: [], anexos: [], marcadores: [], campos_personalizados: {},
    preferencias: {
      tipo_viagem: [], classe_voo: '', tipo_hotel: '', destinos_favoritos: [],
      restricoes_alimentares: '', necessidades_especiais: '', assento_preferido: '',
      programa_fidelidade: [],
    },
    vendedor_responsavel: '', indicado_por: '', data_cadastro: new Date().toISOString(),
    ultima_compra: '', total_compras: 0, valor_total_historico: 0,
    status: 'ATIVO', observacoes: '',
  };
}

export function createFornecedorCRM(): FornecedorCRM {
  return {
    id: generateId(), tipo: 'OUTROS',
    razao_social: '', nome_fantasia: '', cnpj: '',
    telefone: '', email: '', site: '', contato_principal: '', whatsapp: '',
    endereco_completo: '', cidade: '', estado: '',
    dados_bancarios: [],
    regras_faturamento: { prazo_pagamento_dias: 30, dia_corte: 25, dia_vencimento: 10, comissao_padrao: 0, moeda_padrao: 'BRL' },
    integracao_ativa: false, tipo_integracao: '',
    anexos: [], marcadores: [], campos_personalizados: {},
    observacoes: '', status: 'ATIVO',
  };
}

export function createMembro(): Membro {
  return {
    id: generateId(), nome: '', cpf: '', email: '', telefone: '', cargo: 'vendedor',
    data_admissao: new Date().toISOString().split('T')[0],
    meta_mensal_vendas: 0, meta_mensal_quantidade: 0, plano_comissao_id: '',
    status: 'ATIVO',
  };
}

export function createProdutoVenda(): ProdutoVenda {
  return {
    id: generateId(), tipo: 'AEREO', descricao: '', fornecedor_id: '', fornecedor_nome: '',
    data_inicio: '', data_fim: '', localizador: '', cia_aerea: '', trecho: '',
    hotel_nome: '', tipo_apto: '', regime: '',
    valor_custo: 0, valor_venda: 0, comissao_fornecedor: 0,
    moeda: 'BRL', cambio: 1, status: 'RESERVADO',
    aprovador: '', solicitante: '', centro_custo: '', projeto: '',
  };
}

export function createVendaCRM(numero: string): VendaCRM {
  return {
    id: generateId(), numero, data_venda: new Date().toISOString().split('T')[0],
    tipo: 'AVULSA', grupo_id: null, cliente_id: '', vendedor_id: '',
    passageiros: [], pagantes: [], produtos: [],
    valor_total_custo: 0, valor_total_venda: 0, markup_realizado: 0,
    desconto: 0, valor_final: 0,
    forma_pagamento: 'AVISTA_PIX', parcelas: 1, pagamento_detalhado: [],
    status: 'ORCAMENTO', motivo_cancelamento: '', recibo_emitido: false,
    intermediario_id: null, comissao_intermediario: 0,
    centro_custo: '', numero_po: '',
    anexos: [], observacoes: '', campos_personalizados: {},
  };
}

export function createContaReceber(): ContaReceber {
  return {
    id: generateId(), origem: 'VENDA', venda_id: null, grupo_id: null,
    cliente_id: '', cliente_nome: '', descricao: '', categoria_id: '', centro_custo: '',
    valor_original: 0, juros: 0, multa: 0, desconto: 0, valor_final: 0,
    data_emissao: new Date().toISOString().split('T')[0], data_vencimento: '',
    data_recebimento: null, valor_recebido: null,
    conta_bancaria_id: null, forma_recebimento: '',
    parcela_numero: 1, total_parcelas: 1,
    boleto_emitido: false, boleto_codigo: '', boleto_url: '',
    status: 'PENDENTE', rateio: [], anexos: [], observacoes: '',
  };
}

export function createContaPagar(): ContaPagar {
  return {
    id: generateId(), origem: 'OUTROS', venda_id: null, grupo_id: null,
    fornecedor_id: '', fornecedor_nome: '', descricao: '', categoria_id: '', centro_custo: '',
    valor_original: 0, juros: 0, multa: 0, desconto: 0, valor_final: 0,
    moeda: 'BRL', cambio: 1, valor_brl: 0,
    data_emissao: new Date().toISOString().split('T')[0], data_vencimento: '',
    data_pagamento: null, valor_pago: null,
    conta_bancaria_id: null, forma_pagamento: '', comprovante: '',
    parcela_numero: 1, total_parcelas: 1,
    status: 'PENDENTE', rateio: [], anexos: [], observacoes: '',
  };
}

// Plano de contas padrao
export function getPlanoContasPadrao(): PlanoContas[] {
  const contas: PlanoContas[] = [];
  let id = 1;
  const add = (codigo: string, nome: string, tipo: 'RECEITA' | 'DESPESA', pai: string | null) => {
    contas.push({ id: String(id++), codigo, nome, tipo, categoria_pai_id: pai, ativo: true });
  };

  // RECEITAS
  add('1', 'RECEITAS', 'RECEITA', null);
  add('1.1', 'Comissoes de Fornecedores', 'RECEITA', '1');
  add('1.1.01', 'Comissao Aereo', 'RECEITA', '2');
  add('1.1.02', 'Comissao Hotel', 'RECEITA', '2');
  add('1.1.03', 'Comissao Pacote', 'RECEITA', '2');
  add('1.1.04', 'Comissao Seguro', 'RECEITA', '2');
  add('1.1.05', 'Comissao Cruzeiro', 'RECEITA', '2');
  add('1.1.06', 'Over (bonus sobre meta)', 'RECEITA', '2');
  add('1.2', 'Markup de Vendas', 'RECEITA', '1');
  add('1.2.01', 'Markup Aereo', 'RECEITA', '9');
  add('1.2.02', 'Markup Hotel', 'RECEITA', '9');
  add('1.2.03', 'Markup Pacote', 'RECEITA', '9');
  add('1.2.04', 'Markup Operacao Propria (Grupos)', 'RECEITA', '9');
  add('1.3', 'Fee de Servico', 'RECEITA', '1');
  add('1.3.01', 'Fee por Emissao', 'RECEITA', '14');
  add('1.3.02', 'Fee por Assessoria', 'RECEITA', '14');
  add('1.3.03', 'Fee Corporativo', 'RECEITA', '14');
  add('1.4', 'Operacao Propria', 'RECEITA', '1');
  add('1.4.01', 'Receita de Grupos', 'RECEITA', '18');
  add('1.4.02', 'Receita de Excursoes', 'RECEITA', '18');
  add('1.4.03', 'Receita de Eventos', 'RECEITA', '18');
  add('1.5', 'Outras Receitas', 'RECEITA', '1');

  // DESPESAS
  add('2', 'DESPESAS', 'DESPESA', null);
  add('2.1', 'Custos de Vendas (CMV)', 'DESPESA', '23');
  add('2.1.01', 'Aereo', 'DESPESA', '24');
  add('2.1.02', 'Hotel', 'DESPESA', '24');
  add('2.1.03', 'Pacote', 'DESPESA', '24');
  add('2.1.04', 'Seguro', 'DESPESA', '24');
  add('2.1.05', 'Receptivo', 'DESPESA', '24');
  add('2.1.06', 'Locacao Veiculos', 'DESPESA', '24');
  add('2.1.07', 'Cruzeiro', 'DESPESA', '24');
  add('2.1.08', 'Ingressos', 'DESPESA', '24');
  add('2.1.09', 'Brindes', 'DESPESA', '24');
  add('2.2', 'Despesas Operacionais', 'DESPESA', '23');
  add('2.2.01', 'Aluguel', 'DESPESA', '34');
  add('2.2.02', 'Energia/Agua/Internet', 'DESPESA', '34');
  add('2.2.03', 'Salarios e Encargos', 'DESPESA', '34');
  add('2.2.04', 'Comissao Equipe', 'DESPESA', '34');
  add('2.2.05', 'Comissao Intermediarios', 'DESPESA', '34');
  add('2.2.06', 'Sistemas e Software', 'DESPESA', '34');
  add('2.2.07', 'Marketing e Publicidade', 'DESPESA', '34');
  add('2.2.08', 'Material de Escritorio', 'DESPESA', '34');
  add('2.2.09', 'Viagens a Trabalho', 'DESPESA', '34');
  add('2.3', 'Taxas e Impostos', 'DESPESA', '23');
  add('2.3.01', 'Simples Nacional', 'DESPESA', '44');
  add('2.3.02', 'ISS', 'DESPESA', '44');
  add('2.3.03', 'Taxa Adquirencia Cartao', 'DESPESA', '44');
  add('2.3.04', 'Taxa Boleto', 'DESPESA', '44');
  add('2.3.05', 'IOF', 'DESPESA', '44');
  add('2.4', 'Despesas Financeiras', 'DESPESA', '23');
  add('2.4.01', 'Juros', 'DESPESA', '50');
  add('2.4.02', 'Multas', 'DESPESA', '50');
  add('2.4.03', 'Variacao Cambial', 'DESPESA', '50');
  add('2.4.04', 'Tarifas Bancarias', 'DESPESA', '50');
  add('2.5', 'Outras Despesas', 'DESPESA', '23');

  return contas;
}
