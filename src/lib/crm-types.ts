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

export type TipoProdutoVenda = 'AEREO' | 'HOTEL' | 'PACOTE' | 'SEGURO' | 'RECEPTIVO' | 'CRUZEIRO' | 'CARRO' | 'INGRESSO' | 'GRUPO' | 'OUTROS';
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

export type NaturezaCusto = 'FIXO' | 'VARIAVEL' | 'COMPRA_UNICA';

export interface PlanoContas {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA';
  categoria_pai_id: string | null;
  natureza_custo: NaturezaCusto | null;
  is_custo_comercial: boolean;
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
  natureza_custo: NaturezaCusto | null;
  is_custo_comercial: boolean;
  status: StatusContaPagar;
  rateio: Array<{ centro_custo: string; percentual: number; valor: number }>;
  anexos: Array<{ nome: string; url: string }>;
  observacoes: string;
}

// ============================================================
// CAC - CUSTO DE AQUISICAO DO CLIENTE
// ============================================================

export interface CACMensal {
  id: string;
  mes: string; // YYYY-MM
  total_despesas_comerciais: number;
  total_despesas_fixas: number;
  total_despesas_variaveis: number;
  total_vendas: number;
  quantidade_clientes_novos: number;
  quantidade_vendas: number;
  cac: number; // total_despesas_comerciais / quantidade_clientes_novos
  ticket_medio: number;
  roi: number;
  detalhamento: Array<{
    categoria_id: string;
    categoria_nome: string;
    natureza: NaturezaCusto;
    valor: number;
  }>;
  calculado_em: string;
}

export interface CenarioCAC {
  id: string;
  nome: string;
  descricao: string;
  mes_referencia: string; // YYYY-MM

  // Valores base (copiados do mês de referência)
  despesas_fixas_base: number;
  despesas_variaveis_base: number;

  // Ajustes do cenário
  investimento_ads: number;
  ads_detalhamento: Array<{
    plataforma: string; // Google Ads, Meta Ads, etc.
    investimento_mensal: number;
    cpc_estimado: number;
    taxa_conversao: number;
    leads_estimados: number;
    clientes_estimados: number;
  }>;

  outros_investimentos: Array<{
    descricao: string;
    valor: number;
    tipo: NaturezaCusto;
  }>;

  // Resultados simulados
  clientes_novos_estimados: number;
  cac_projetado: number;
  ticket_medio_alvo: number;
  roi_projetado: number;
  payback_meses: number;

  criado_em: string;
  atualizado_em: string;
}

export interface CentroCusto {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
}

// ============================================================
// FASE 3 — CONCILIACAO, FLUXO DE CAIXA, TRANSFERENCIAS, DRE
// ============================================================

export type StatusTransferencia = 'PENDENTE' | 'EFETIVADA' | 'CANCELADA';

export interface TransferenciaBancaria {
  id: string;
  conta_origem_id: string;
  conta_origem_nome: string;
  conta_destino_id: string;
  conta_destino_nome: string;
  valor: number;
  data: string;
  data_efetivacao: string | null;
  descricao: string;
  status: StatusTransferencia;
  criado_em: string;
}

export type StatusConciliacao = 'PENDENTE' | 'CONCILIADO' | 'DIVERGENTE' | 'IGNORADO';

export interface ExtratoLinha {
  id: string;
  conta_bancaria_id: string;
  data: string;
  descricao: string;
  valor: number; // positivo = crédito, negativo = débito
  tipo: 'CREDITO' | 'DEBITO';
  saldo: number;
  // Conciliação
  status_conciliacao: StatusConciliacao;
  lancamento_vinculado_id: string | null;
  lancamento_vinculado_tipo: 'CONTA_RECEBER' | 'CONTA_PAGAR' | 'TRANSFERENCIA' | null;
  observacao_conciliacao: string;
  importado_em: string;
  arquivo_origem: string;
}

// ============================================================
// FASE 4 — COMISSOES E METAS
// ============================================================

export type TipoBaseComissao = 'MARKUP' | 'VALOR_VENDA' | 'COMISSAO_FORNECEDOR' | 'LUCRO';

export interface FaixaComissao {
  de: number;
  ate: number;
  percentual: number;
}

export interface PlanoComissao {
  id: string;
  nome: string;
  descricao: string;
  base_calculo: TipoBaseComissao;
  percentual_padrao: number;
  faixas: FaixaComissao[];
  regras_produto: Array<{
    tipo_produto: string;
    percentual: number;
  }>;
  ativo: boolean;
  criado_em: string;
}

export type StatusComissao = 'CALCULADA' | 'APROVADA' | 'PAGA' | 'CANCELADA';

export interface ComissaoVenda {
  id: string;
  venda_id: string;
  venda_numero: string;
  vendedor_id: string;
  vendedor_nome: string;
  plano_comissao_id: string;
  plano_nome: string;
  data_venda: string;
  valor_base: number;
  percentual_aplicado: number;
  valor_comissao: number;
  status: StatusComissao;
  data_aprovacao: string | null;
  data_pagamento: string | null;
  observacoes: string;
}

export type PeriodoMeta = 'MENSAL' | 'TRIMESTRAL' | 'ANUAL';

export interface MetaVendedor {
  id: string;
  vendedor_id: string;
  vendedor_nome: string;
  periodo: PeriodoMeta;
  mes_referencia: string; // YYYY-MM
  meta_valor: number;
  meta_quantidade: number;
  realizado_valor: number;
  realizado_quantidade: number;
  percentual_atingido_valor: number;
  percentual_atingido_quantidade: number;
  bonus_meta: number;
  criado_em: string;
}

// ============================================================
// FASE 6 — PROPOSTAS
// ============================================================

export type StatusProposta = 'RASCUNHO' | 'ENVIADO' | 'VISUALIZADO' | 'ACEITO' | 'RECUSADO' | 'EXPIRADO' | 'CONVERTIDO';
export type TipoSecaoProposta = 'TEXTO' | 'SERVICO' | 'ROTEIRO_DIA' | 'GALERIA' | 'INCLUSOS' | 'VALORES' | 'DEPOIMENTO' | 'CTA';
export type EstiloCapa = 'FULLSCREEN' | 'SPLIT' | 'MINIMAL';

export interface SecaoProposta {
  id: string;
  tipo: TipoSecaoProposta;
  ordem: number;
  visivel: boolean;
  conteudo: Record<string, unknown>;
}

export interface Proposta {
  id: string;
  numero: string;
  versao: number;
  versao_anterior_id: string | null;
  cliente_id: string;
  cliente_nome: string;
  vendedor_id: string;
  vendedor_nome: string;
  template_id: string;

  visual: {
    cor_primaria: string;
    cor_secundaria: string;
    cor_texto: string;
    cor_fundo: string;
    fonte: string;
    imagem_capa: string;
    estilo_capa: EstiloCapa;
  };

  cabecalho: {
    titulo: string;
    subtitulo: string;
    mensagem_abertura: string;
    data_proposta: string;
    validade: string;
  };

  secoes: SecaoProposta[];

  rodape: {
    mensagem: string;
    nome_vendedor: string;
    telefone_vendedor: string;
    whatsapp_vendedor: string;
    email_vendedor: string;
  };

  status: StatusProposta;
  link_publico: string;

  envios: Array<{
    data: string;
    canal: 'EMAIL' | 'WHATSAPP' | 'LINK';
    destinatario: string;
  }>;

  venda_id: string | null;
  grupo_id: string | null;
  data_conversao: string | null;

  // Aceitacao digital
  aceite: {
    nome_aceite: string;
    data_aceite: string;
    ip_aceite: string;
  } | null;
  feedbacks: Array<{
    data: string;
    mensagem: string;
    nome: string;
  }>;

  criado_em: string;
  atualizado_em: string;
}

export type TipoViagem = 'ROMANCE' | 'AVENTURA' | 'FAMILIA' | 'CORPORATIVO' | 'CRUZEIRO' | 'CULTURAL' | 'PRAIA' | 'OUTRO';

export interface TemplateProposta {
  id: string;
  nome: string;
  descricao: string;
  tipo_viagem: TipoViagem;
  icone: string;
  imagem_preview: string;
  visual: Proposta['visual'];
  secoes_padrao: SecaoProposta[];
  mensagem_abertura_padrao: string;
  inclusos_padrao: string[];
  nao_inclusos_padrao: string[];
  is_padrao: boolean;
}

// ============================================================
// DESTINOS (Banco de conteudo rico — estilo Wetu)
// ============================================================

export interface Destino {
  id: string;
  nome: string;
  pais: string;
  descricao: string;
  idioma: string;
  clima: string;
  moeda: string;
  fuso: string;
  melhor_epoca: string;
  gastronomia: string;
  dicas: string;
  coordenadas: { lat: number; lng: number } | null;
  imagens: string[];
  fast_facts: Array<{ label: string; valor: string }>;
  enriquecido: boolean;
  enriquecido_em: string | null;
}

export function createDestino(): Destino {
  return {
    id: generateId(),
    nome: '',
    pais: '',
    descricao: '',
    idioma: '',
    clima: '',
    moeda: '',
    fuso: '',
    melhor_epoca: '',
    gastronomia: '',
    dicas: '',
    coordenadas: null,
    imagens: [],
    fast_facts: [],
    enriquecido: false,
    enriquecido_em: null,
  };
}

export function createProposta(numero: string): Proposta {
  return {
    id: generateId(), numero, versao: 1, versao_anterior_id: null,
    cliente_id: '', cliente_nome: '', vendedor_id: '', vendedor_nome: '',
    template_id: '',
    visual: {
      cor_primaria: '#10b981', cor_secundaria: '#0a0a14', cor_texto: '#ffffff',
      cor_fundo: '#ffffff', fonte: 'Inter', imagem_capa: '', estilo_capa: 'FULLSCREEN',
    },
    cabecalho: { titulo: '', subtitulo: '', mensagem_abertura: '', data_proposta: new Date().toISOString().split('T')[0], validade: '' },
    secoes: [],
    rodape: { mensagem: '', nome_vendedor: '', telefone_vendedor: '', whatsapp_vendedor: '', email_vendedor: '' },
    status: 'RASCUNHO', link_publico: '',
    envios: [], venda_id: null, grupo_id: null, data_conversao: null,
    aceite: null, feedbacks: [],
    criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
  };
}

// ============================================================
// FASE 6 — LOG DE AUDITORIA
// ============================================================

export type AcaoAuditoria = 'CRIAR' | 'EDITAR' | 'EXCLUIR' | 'VISUALIZAR' | 'EXPORTAR' | 'ENVIAR' | 'CONVERTER' | 'CANCELAR' | 'CONFIRMAR';

export interface LogAuditoria {
  id: string;
  timestamp: string;
  usuario_id: string;
  usuario_nome: string;
  perfil: string;
  acao: AcaoAuditoria;
  modulo: string;
  entidade: string;
  entidade_id: string;
  descricao: string;
  alteracoes: Array<{
    campo: string;
    valor_anterior: string;
    valor_novo: string;
  }>;
}

// ============================================================
// FASE 7 — APIs DE VOOS E HOTÉIS
// ============================================================

export interface ConfiguracaoAPIs {
  amadeus: {
    api_key: string;
    api_secret: string;
    ambiente: 'test' | 'production';
    ativo: boolean;
  };
  aviationstack: {
    api_key: string;
    ativo: boolean;
  };
  google_places: {
    api_key: string;
    ativo: boolean;
  };
  anthropic: {
    api_key: string;
    modelo: string;
    ativo: boolean;
  };
  cache: {
    busca_voos_ttl: number;
    aeroportos_ttl: number;
    busca_hoteis_ttl: number;
    precos_hoteis_ttl: number;
    fotos_hoteis_ttl: number;
    reviews_ttl: number;
    status_voo_ttl: number;
  };
}

export interface ResultadoVoo {
  id: string;
  cia: string;
  numero_voo_ida: string;
  numero_voo_volta: string | null;
  ida: {
    partida: string;
    chegada: string;
    duracao: string;
    escalas: number;
    aeroporto_escala: string | null;
    bagagem: string;
  };
  volta: {
    partida: string;
    chegada: string;
    duracao: string;
    escalas: number;
    aeroporto_escala: string | null;
    bagagem: string;
  } | null;
  preco_adt: number;
  preco_chd: number;
  moeda: string;
  usado_em_grupo: string | null;
  usado_em_proposta: string | null;
}

export interface BuscaVoo {
  id: string;
  data_busca: string;
  origem: string;
  destino: string;
  data_ida: string;
  data_volta: string | null;
  adultos: number;
  criancas: number;
  classe: string;
  resultados: ResultadoVoo[];
  source: 'AMADEUS';
  cached: boolean;
}

export interface FotoHotel {
  url: string;
  largura: number;
  altura: number;
  atribuicao: string;
}

export interface ReviewHotel {
  autor: string;
  rating: number;
  texto: string;
  data: string;
  idioma: string;
  link_perfil_autor: string;
}

export interface FichaHotel {
  place_id: string;
  nome: string;
  endereco: string;
  coordenadas: { lat: number; lng: number };
  rating: number;
  total_avaliacoes: number;
  nivel_preco: 1 | 2 | 3 | 4;
  website: string;
  telefone: string;
  google_maps_url: string;
  editorial_summary: string;
  fotos: FotoHotel[];
  amenities: string[];
  reviews: ReviewHotel[];
  horario_funcionamento: string;
  acessibilidade: string[];
  estacionamento: string;
  precos: {
    sgl: number | null;
    dbl: number | null;
    tpl: number | null;
    qdp: number | null;
  } | null;
  disponibilidade: boolean | null;
  cancelamento_gratis: boolean | null;
  cafe_incluso: boolean | null;
  sentimentos: {
    overall: number;
    localizacao: number;
    servico: number;
    quarto: number;
    limpeza: number;
    custo_beneficio: number;
  } | null;
}

export interface BuscaHotel {
  id: string;
  data_busca: string;
  destino: string;
  check_in: string;
  check_out: string;
  resultados: FichaHotel[];
  sources: ('GOOGLE_PLACES' | 'AMADEUS')[];
  cached: boolean;
}

export interface VooMonitorado {
  id: string;
  grupo_id: string;
  cia: string;
  numero_voo: string;
  data: string;
  aeroporto_origem: string;
  aeroporto_destino: string;
  partida_programada: string;
  chegada_programada: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'LANDED' | 'CANCELLED' | 'DIVERTED' | 'DELAYED';
  partida_real: string | null;
  chegada_real: string | null;
  atraso_minutos: number | null;
  gate: string | null;
  terminal: string | null;
  ultimo_check: string;
  notificacao_enviada: boolean;
}

export interface CacheEntry {
  key: string;
  data: unknown;
  created_at: string;
  expires_at: string;
  source: 'AMADEUS' | 'AVIATIONSTACK' | 'GOOGLE_PLACES';
  calls_saved: number;
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
    natureza_custo: null, is_custo_comercial: false,
    status: 'PENDENTE', rateio: [], anexos: [], observacoes: '',
  };
}

export function createTransferencia(): TransferenciaBancaria {
  return {
    id: generateId(),
    conta_origem_id: '',
    conta_origem_nome: '',
    conta_destino_id: '',
    conta_destino_nome: '',
    valor: 0,
    data: new Date().toISOString().split('T')[0],
    data_efetivacao: null,
    descricao: '',
    status: 'PENDENTE',
    criado_em: new Date().toISOString(),
  };
}

export function createPlanoComissao(): PlanoComissao {
  return {
    id: generateId(),
    nome: '',
    descricao: '',
    base_calculo: 'MARKUP',
    percentual_padrao: 10,
    faixas: [],
    regras_produto: [],
    ativo: true,
    criado_em: new Date().toISOString(),
  };
}

// Plano de contas padrao
export function getPlanoContasPadrao(): PlanoContas[] {
  const contas: PlanoContas[] = [];
  let id = 1;
  const add = (
    codigo: string, nome: string, tipo: 'RECEITA' | 'DESPESA', pai: string | null,
    natureza: NaturezaCusto | null = null, comercial = false
  ) => {
    contas.push({ id: String(id++), codigo, nome, tipo, categoria_pai_id: pai, natureza_custo: natureza, is_custo_comercial: comercial, ativo: true });
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
  add('2.1', 'Custos de Vendas (CMV)', 'DESPESA', '23', 'VARIAVEL');
  add('2.1.01', 'Aereo', 'DESPESA', '24', 'VARIAVEL');
  add('2.1.02', 'Hotel', 'DESPESA', '24', 'VARIAVEL');
  add('2.1.03', 'Pacote', 'DESPESA', '24', 'VARIAVEL');
  add('2.1.04', 'Seguro', 'DESPESA', '24', 'VARIAVEL');
  add('2.1.05', 'Receptivo', 'DESPESA', '24', 'VARIAVEL');
  add('2.1.06', 'Locacao Veiculos', 'DESPESA', '24', 'VARIAVEL');
  add('2.1.07', 'Cruzeiro', 'DESPESA', '24', 'VARIAVEL');
  add('2.1.08', 'Ingressos', 'DESPESA', '24', 'VARIAVEL');
  add('2.1.09', 'Brindes', 'DESPESA', '24', 'VARIAVEL');
  add('2.2', 'Despesas Operacionais', 'DESPESA', '23', 'FIXO');
  add('2.2.01', 'Aluguel', 'DESPESA', '34', 'FIXO');
  add('2.2.02', 'Energia/Agua/Internet', 'DESPESA', '34', 'FIXO');
  add('2.2.03', 'Salarios e Encargos', 'DESPESA', '34', 'FIXO');
  add('2.2.04', 'Comissao Equipe', 'DESPESA', '34', 'VARIAVEL', true);
  add('2.2.05', 'Comissao Intermediarios', 'DESPESA', '34', 'VARIAVEL', true);
  add('2.2.06', 'Sistemas e Software', 'DESPESA', '34', 'FIXO');
  add('2.2.07', 'Marketing e Publicidade', 'DESPESA', '34', 'VARIAVEL', true);
  add('2.2.08', 'Material de Escritorio', 'DESPESA', '34', 'FIXO');
  add('2.2.09', 'Viagens a Trabalho', 'DESPESA', '34', 'VARIAVEL');
  add('2.3', 'Taxas e Impostos', 'DESPESA', '23', 'VARIAVEL');
  add('2.3.01', 'Simples Nacional', 'DESPESA', '44', 'VARIAVEL');
  add('2.3.02', 'ISS', 'DESPESA', '44', 'VARIAVEL');
  add('2.3.03', 'Taxa Adquirencia Cartao', 'DESPESA', '44', 'VARIAVEL');
  add('2.3.04', 'Taxa Boleto', 'DESPESA', '44', 'VARIAVEL');
  add('2.3.05', 'IOF', 'DESPESA', '44', 'VARIAVEL');
  add('2.4', 'Despesas Financeiras', 'DESPESA', '23', 'VARIAVEL');
  add('2.4.01', 'Juros', 'DESPESA', '50', 'VARIAVEL');
  add('2.4.02', 'Multas', 'DESPESA', '50', 'VARIAVEL');
  add('2.4.03', 'Variacao Cambial', 'DESPESA', '50', 'VARIAVEL');
  add('2.4.04', 'Tarifas Bancarias', 'DESPESA', '50', 'FIXO');
  add('2.5', 'Outras Despesas', 'DESPESA', '23');

  // CUSTOS COMERCIAIS (para calculo do CAC)
  add('2.6', 'Custos Comerciais', 'DESPESA', '23', 'VARIAVEL', true);
  add('2.6.01', 'Google Ads', 'DESPESA', '56', 'VARIAVEL', true);
  add('2.6.02', 'Meta Ads (Facebook/Instagram)', 'DESPESA', '56', 'VARIAVEL', true);
  add('2.6.03', 'Anuncios Outros', 'DESPESA', '56', 'VARIAVEL', true);
  add('2.6.04', 'Producao de Conteudo', 'DESPESA', '56', 'VARIAVEL', true);
  add('2.6.05', 'Ferramentas de Marketing', 'DESPESA', '56', 'FIXO', true);
  add('2.6.06', 'Eventos e Feiras', 'DESPESA', '56', 'COMPRA_UNICA', true);
  add('2.6.07', 'Brindes Comerciais', 'DESPESA', '56', 'VARIAVEL', true);
  add('2.6.08', 'CRM e Automacao', 'DESPESA', '56', 'FIXO', true);

  return contas;
}
