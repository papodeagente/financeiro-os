/**
 * Contrato persistido do planejamento mensal.
 *
 * Há duas entradas distintas:
 *  - `hidratarPlanoCustos`: tolera registros antigos e recompõe linhas que
 *    passaram a existir depois que o mês foi salvo;
 *  - `validarPayloadPlanoCustos`: protege a API contra dados incompletos,
 *    negativos, não finitos ou grandes demais antes de gravar.
 */
import { parseMoneyBR, round2, soma } from './money';
import {
  CANAIS_MARKETING,
  CATEGORIAS_FIXOS,
  type CustoFixo,
  type CustoVariavel,
  type CustosData,
} from './planejamento-custos';
import { normalizarMarketing } from './planejamento-custos-associacao';

export const CUSTOS_VARIAVEIS_PADRAO: readonly CustoVariavel[] = [
  { nome: 'Comissão vendedor', percentual: 0, base: 'COMISSAO' },
  { nome: 'Impostos', percentual: 6, base: 'COMISSAO' },
  { nome: 'Taxa cartão/boleto', percentual: 4.5, base: 'VENDA' },
  { nome: 'Outros variáveis', percentual: 0, base: 'VENDA' },
];

const MAX_DINHEIRO = 1_000_000_000_000;
const MAX_LINHAS = 100;
const MAX_NOME = 100;
const MAX_OBSERVACAO = 500;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type Objeto = Record<string, unknown>;

function objeto(value: unknown): Objeto | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Objeto
    : null;
}

function normalizarTexto(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function texto(value: unknown, fallback = '', max = MAX_NOME): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

function numero(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return parseMoneyBR(value);
  return null;
}

function dinheiroOu(value: unknown, fallback: number): number {
  const parsed = numero(value);
  return parsed === null ? fallback : round2(Math.min(MAX_DINHEIRO, Math.max(0, parsed)));
}

function percentualOu(value: unknown, fallback: number): number {
  const parsed = numero(value);
  return parsed === null ? fallback : Math.min(100, Math.max(0, parsed));
}

function inteiroPositivoOu(value: unknown, fallback: number, max: number): number {
  const parsed = numero(value);
  if (parsed === null || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
}

export function mesPlanejamentoValido(value: unknown): value is string {
  return typeof value === 'string' && MES_RE.test(value);
}

export function criarPlanoCustosPadrao(mes: string, id: string): CustosData {
  return {
    id,
    mes,
    custos_fixos: CATEGORIAS_FIXOS.map(categoria => ({ categoria, valor: 0, observacao: '' })),
    custos_variaveis: CUSTOS_VARIAVEIS_PADRAO.map(item => ({ ...item })),
    marketing: CANAIS_MARKETING.map(canal => ({ canal, valor: 0 })),
    ticket_medio: 8000,
    margem_comissao: 25,
    taxa_conversao: 10,
    lucro_desejado: 10000,
    dias_uteis: 22,
    vendedores_ativos: 1,
  };
}

const FIXOS_POR_CHAVE = new Map<string, string>(
  CATEGORIAS_FIXOS.map(categoria => [normalizarTexto(categoria), categoria]),
);
for (const [alias, categoria] of [
  ['aluguel', 'Aluguel/Sede'], ['sede', 'Aluguel/Sede'],
  ['folha', 'Folha de pagamento'], ['salarios', 'Folha de pagamento'], ['pessoal', 'Folha de pagamento'],
  ['ferramentas', 'Ferramentas e software'], ['software', 'Ferramentas e software'],
  ['marketing_fixo', 'Marketing fixo recorrente'],
  ['outros', 'Outros fixos'],
] as const) FIXOS_POR_CHAVE.set(alias, categoria);

function normalizarCustosFixos(value: unknown): CustoFixo[] {
  const agregados = new Map<string, CustoFixo>();

  if (Array.isArray(value)) {
    for (const raw of value) {
      const row = objeto(raw);
      if (!row) continue;
      const categoriaOriginal = texto(row.categoria);
      if (!categoriaOriginal) continue;
      const chaveOriginal = normalizarTexto(categoriaOriginal);
      const categoria = FIXOS_POR_CHAVE.get(chaveOriginal) ?? categoriaOriginal;
      const chave = FIXOS_POR_CHAVE.has(chaveOriginal) ? categoria : `custom:${chaveOriginal}`;
      const anterior = agregados.get(chave);
      const observacao = texto(row.observacao, '', MAX_OBSERVACAO);
      agregados.set(chave, {
        categoria,
        valor: soma([anterior?.valor, dinheiroOu(row.valor, 0)]),
        observacao: [anterior?.observacao, observacao].filter(Boolean).filter((item, i, all) => all.indexOf(item) === i).join(' · ').slice(0, MAX_OBSERVACAO),
      });
    }
  }

  const result = CATEGORIAS_FIXOS.map(categoria => (
    agregados.get(categoria) ?? { categoria, valor: 0, observacao: '' }
  ));
  for (const [chave, row] of agregados) {
    if (chave.startsWith('custom:')) result.push(row);
  }
  return result;
}

const VARIAVEIS_POR_CHAVE = new Map<string, CustoVariavel>(
  CUSTOS_VARIAVEIS_PADRAO.map(item => [normalizarTexto(item.nome), item]),
);
for (const [alias, nome] of [
  ['comissao', 'Comissão vendedor'], ['comissao_do_vendedor', 'Comissão vendedor'],
  ['imposto', 'Impostos'],
  ['taxa_cartao', 'Taxa cartão/boleto'], ['taxa_de_cartao', 'Taxa cartão/boleto'], ['cartao_boleto', 'Taxa cartão/boleto'],
  ['outros', 'Outros variáveis'], ['outros_variaveis', 'Outros variáveis'],
] as const) {
  const padrao = CUSTOS_VARIAVEIS_PADRAO.find(item => item.nome === nome);
  if (padrao) VARIAVEIS_POR_CHAVE.set(alias, padrao);
}

function normalizarCustosVariaveis(value: unknown): CustoVariavel[] {
  const agregados = new Map<string, CustoVariavel>();

  if (Array.isArray(value)) {
    for (const raw of value) {
      const row = objeto(raw);
      if (!row) continue;
      const nomeOriginal = texto(row.nome);
      if (!nomeOriginal) continue;
      const chaveOriginal = normalizarTexto(nomeOriginal);
      const padrao = VARIAVEIS_POR_CHAVE.get(chaveOriginal);
      const nome = padrao?.nome ?? nomeOriginal;
      const chave = padrao ? nome : `custom:${chaveOriginal}`;
      const anterior = agregados.get(chave);
      const base = row.base === 'COMISSAO' || row.base === 'VENDA'
        ? row.base
        : padrao?.base ?? anterior?.base ?? 'VENDA';
      agregados.set(chave, {
        nome,
        percentual: Math.min(100, soma([anterior?.percentual, percentualOu(row.percentual, 0)])),
        base,
      });
    }
  }

  const result = CUSTOS_VARIAVEIS_PADRAO.map(padrao => (
    agregados.get(padrao.nome) ?? { ...padrao }
  ));
  for (const [chave, row] of agregados) {
    if (chave.startsWith('custom:')) result.push(row);
  }
  return result;
}

/** Recompõe um registro salvo sem apagar percentuais/categorias legadas. */
export function hidratarPlanoCustos(value: unknown, mes: string, idNovo: string): CustosData {
  const base = criarPlanoCustosPadrao(mes, idNovo);
  const raw = objeto(value);
  if (!raw) return base;

  const idSalvo = texto(raw.id, '', 128);
  return {
    id: idSalvo || idNovo,
    mes,
    custos_fixos: normalizarCustosFixos(raw.custos_fixos),
    custos_variaveis: normalizarCustosVariaveis(raw.custos_variaveis),
    marketing: normalizarMarketing(raw.marketing),
    ticket_medio: dinheiroOu(raw.ticket_medio, base.ticket_medio),
    margem_comissao: percentualOu(raw.margem_comissao, base.margem_comissao),
    taxa_conversao: percentualOu(raw.taxa_conversao, base.taxa_conversao),
    lucro_desejado: dinheiroOu(raw.lucro_desejado, base.lucro_desejado),
    dias_uteis: inteiroPositivoOu(raw.dias_uteis, base.dias_uteis, 31),
    vendedores_ativos: inteiroPositivoOu(raw.vendedores_ativos, base.vendedores_ativos, 10_000),
  };
}

export type ResultadoValidacaoPlano =
  | { ok: true; data: CustosData }
  | { ok: false; error: string };

function dinheiroValido(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DINHEIRO;
}

function percentualValido(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** Validação estrita usada antes de qualquer gravação na API. */
export function validarPayloadPlanoCustos(value: unknown): ResultadoValidacaoPlano {
  const raw = objeto(value);
  if (!raw) return { ok: false, error: 'Planejamento inválido.' };
  if (!mesPlanejamentoValido(raw.mes)) return { ok: false, error: 'Mês de referência inválido.' };

  if (!Array.isArray(raw.custos_fixos) || !Array.isArray(raw.custos_variaveis) || !Array.isArray(raw.marketing)) {
    return { ok: false, error: 'As listas de custos e marketing são obrigatórias.' };
  }
  if (raw.custos_fixos.length > MAX_LINHAS || raw.custos_variaveis.length > MAX_LINHAS || raw.marketing.length > MAX_LINHAS) {
    return { ok: false, error: 'O planejamento excede o limite de itens.' };
  }

  for (const item of raw.custos_fixos) {
    const row = objeto(item);
    if (!row || typeof row.categoria !== 'string' || !row.categoria.trim() || row.categoria.trim().length > MAX_NOME
      || !dinheiroValido(row.valor)
      || typeof row.observacao !== 'string' || row.observacao.length > MAX_OBSERVACAO) {
      return { ok: false, error: 'Há um custo fixo inválido.' };
    }
  }
  for (const item of raw.custos_variaveis) {
    const row = objeto(item);
    if (!row || typeof row.nome !== 'string' || !row.nome.trim() || row.nome.trim().length > MAX_NOME
      || !percentualValido(row.percentual)
      || (row.base !== 'VENDA' && row.base !== 'COMISSAO')) {
      return { ok: false, error: 'Há um custo variável inválido.' };
    }
  }
  for (const item of raw.marketing) {
    const row = objeto(item);
    if (!row || typeof row.canal !== 'string' || !row.canal.trim() || row.canal.trim().length > MAX_NOME
      || !dinheiroValido(row.valor)) {
      return { ok: false, error: 'Há um investimento de marketing inválido.' };
    }
  }

  if (!dinheiroValido(raw.ticket_medio) || !percentualValido(raw.margem_comissao)
    || !percentualValido(raw.taxa_conversao) || !dinheiroValido(raw.lucro_desejado)
    || typeof raw.dias_uteis !== 'number' || !Number.isInteger(raw.dias_uteis)
    || raw.dias_uteis < 1 || raw.dias_uteis > 31
    || typeof raw.vendedores_ativos !== 'number' || !Number.isInteger(raw.vendedores_ativos)
    || raw.vendedores_ativos < 1 || raw.vendedores_ativos > 10_000) {
    return { ok: false, error: 'Há uma premissa mensal inválida.' };
  }

  const id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 128 ? raw.id.trim() : 'novo';
  return { ok: true, data: hidratarPlanoCustos(raw, raw.mes, id) };
}
