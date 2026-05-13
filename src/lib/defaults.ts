import {
  GrupoViagem, Periodo, Trecho, TktTrecho, HtlHotel, RecPasseio,
  CarTransporte, GuiaDestino, SegSeguradora, NavioFornecedor, IngAtrativo,
  BrindeFornecedor, DivulgacaoFornecedor, Passageiro, TKT_FONTES, HTL_FONTES,
} from './types';
import { createFinanceiroGrupo } from './financial-defaults';
import { generateId } from './utils';

export function createPeriodo(): Periodo {
  return { check_in: null, check_out: null, destino: '', hotel: '' };
}

export function createTrecho(): Trecho {
  return { data: null, qtd_adt: 0, qtd_chd: 0 };
}

export function createPassageiro(tipo: 'ADT' | 'CHD' = 'ADT'): Passageiro {
  return { id: generateId(), tipo, idade: tipo === 'CHD' ? 0 : undefined };
}

export function createTktTrecho(): TktTrecho {
  return {
    fontes: TKT_FONTES.map(nome => ({ nome, valor_adt: null, valor_chd: null, partida_chegada: '' })),
    deadline: null,
  };
}

export function createHtlHotel(): HtlHotel {
  return {
    fontes: HTL_FONTES.map(nome => ({ nome, valor_sgl: null, valor_dbl: null, valor_tpl: null, valor_qdp: null, valor_chd: null })),
    info: {
      deadline: null, check_in_hora: '', check_out_hora: '',
      pensao: '', estacionamento: '', politica_chd: '', politica_free: '', info_adicional: '',
    },
  };
}

export function createRecPasseio(): RecPasseio {
  return {
    nome: '', data: null,
    fornecedores: Array.from({ length: 5 }, (_, i) => ({
      nome: `Fornecedor ${i + 1}`, valor_adt: null, valor_chd: null, deadline: null, info: '',
    })),
  };
}

export function createCarTransporte(): CarTransporte {
  return {
    origem: '', destino: '',
    empresas: Array.from({ length: 6 }, (_, i) => ({
      nome: `Empresa ${i + 1}`, valor_veiculo: null, telefone: '', email: '', contato: '', deadline: null,
    })),
  };
}

export function createGuiaDestino(): GuiaDestino {
  return {
    fornecedores: Array.from({ length: 5 }, (_, i) => ({
      nome: `Guia ${i + 1}`, valor_total: null, telefone: '', email: '', deadline: null, anotacoes: '',
    })),
    inicio: null, termino: null,
  };
}

export function createSegSeguradora(i: number): SegSeguradora {
  return {
    nome: `Seguradora ${i + 1}`, valor_sgl: null, valor_dbl: null,
    valor_tpl: null, valor_qdp: null, deadline: null,
    data_inicio: null, data_fim: null, descricao: '',
  };
}

export function createNavioFornecedor(i: number): NavioFornecedor {
  return {
    nome: `Fornecedor ${i + 1}`, valor_sgl: null, valor_dbl: null,
    valor_tpl: null, valor_qdp: null, valor_chd: null,
  };
}

export function createIngAtrativo(): IngAtrativo {
  return {
    nome: '', data: null,
    fontes: ['Direto Site', 'Fornecedor 1', 'Fornecedor 2', 'Fornecedor 3', 'Fornecedor 4', 'Fornecedor 5'].map(nome => ({
      nome, valor_adt: null, valor_chd: null, valor_inf: null, valor_meia: null, info: '',
    })),
  };
}

export function createBrindeFornecedor(i: number): BrindeFornecedor {
  return {
    nome: `Fornecedor ${i + 1}`, valor_unidade: null, descricao: '',
    contato: '', deadline: null, prazo_entrega: '',
  };
}

const DIVULGACAO_CANAIS = [
  'Instagram Ads', 'Facebook Ads', 'Google Ads', 'YouTube Ads',
  'Influenciador', 'E-mail Marketing', 'Material Impresso', 'Eventos / Feiras',
];

export function createDivulgacaoFornecedor(i: number): DivulgacaoFornecedor {
  return {
    nome: DIVULGACAO_CANAIS[i] || `Canal ${i + 1}`,
    valor_total: null,
    canal: DIVULGACAO_CANAIS[i] || '',
    descricao: '',
    contato: '',
    deadline: null,
    periodo: '',
  };
}

const SERVICOS_KEYS = ['tkt', 'htl', 'rec', 'car', 'guia', 'seg', 'navio', 'ing', 'brinde', 'divulgacao'];

export function createGrupoViagem(): GrupoViagem {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    grp_id: 'GRP-' + Date.now().toString(36).toUpperCase(),
    origem_destino: '',
    created_at: now,
    updated_at: now,
    status_pipeline: 'PRODUTO',
    tipo: 'GRUPO',
    proposta_id: null,
    orcamento_id: null,
    venda_crm_id: null,
    tarifas_ativas: ['sgl', 'dbl', 'tpl', 'qdp'],
    periodos: [createPeriodo()],
    trechos: [createTrecho()],
    navio_info: { embarque: null, desembarque: null, cidade_embarque: '', cidade_desembarque: '', nome_cruzeiro: '' },
    params: {
      // Novo modelo (custo+venda manual): markup/contrato/tx_* zerados
      // por default. Quem preenche venda em cada item nao precisa deles.
      // Para grupos no fluxo antigo, basta ajustar via "Configuracoes
      // avancadas" no InfTab.
      markup: 0, contrato: 0, tx_ad_mp: 0, tx_boleto: 0,
      parcelas: 1, qtd_min_pax: 10, qtd_max_pax: 20,
      cortesia: 0, cortesia_apto: 'dbl',
    },
    cambio: Object.fromEntries(SERVICOS_KEYS.map(k => [k, { valor: 1.0, moeda: 'BRL', deadline: null }])),
    passageiros: [],
    links: {},
    descricao_orcamento: '',
    tkt: { trechos: [createTktTrecho()] },
    htl: { hoteis: [createHtlHotel()] },
    rec: { passeios: [createRecPasseio()] },
    car: { transportes: [createCarTransporte()] },
    guia: { destinos: [createGuiaDestino()] },
    seg: { seguradoras: Array.from({ length: 5 }, (_, i) => createSegSeguradora(i)) },
    navio: { fornecedores: Array.from({ length: 11 }, (_, i) => createNavioFornecedor(i)), deadline: null, info_adicional: '' },
    ing: { atrativos: [createIngAtrativo()] },
    brinde: { fornecedores: Array.from({ length: 13 }, (_, i) => createBrindeFornecedor(i)) },
    divulgacao: { fornecedores: Array.from({ length: 8 }, (_, i) => createDivulgacaoFornecedor(i)) },
    financeiro: createFinanceiroGrupo(),
  };
}
