/**
 * Câmbio e índices (E6, parte A, 05/11/2026) — regra pura, sem banco e sem
 * React. Usada pelo servidor (tarefa de 15 min, baixa, transferência) e pelas
 * telas (campo de câmbio, "Moedas e câmbio", contas em moeda).
 *
 * Decisão do dono (não reabrir):
 * - a pessoa SEMPRE pode digitar o câmbio; a cotação é só sugestão;
 * - turismo pela AwesomeAPI com a chave própria do Financeiro (cofre do Super
 *   Admin); PTAX, Selic, IPCA e IGP-M pelas APIs abertas do Banco Central;
 * - uma consulta global a cada 15 min, guardada em `cotacoes_cambio` e lida
 *   por todas as agências; as telas leem só o cache;
 * - disjuntor: fonte fora do ar mostra a última cotação com a idade;
 * - nunca trocar em silêncio uma fonte por outra (turismo ausente NÃO vira
 *   PTAX: as duas aparecem com o nome, e a pessoa escolhe);
 * - fonte e horário ficam guardados em cada valor usado (o "carimbo").
 *
 * Fontes conferidas na documentação oficial em 05/11/2026:
 * - AwesomeAPI: https://docs.awesomeapi.com.br/api-de-moedas e
 *   https://docs.awesomeapi.com.br/instrucoes-api-key (pares USD-BRLT e
 *   EUR-BRLT; chave no cabeçalho `x-api-key`; `bid` = compra, `ask` = venda;
 *   valores em texto; `timestamp` em segundos UTC).
 * - PTAX (Olinda): https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/$metadata
 *   (CotacaoMoedaPeriodo, datas MM-DD-AAAA entre aspas simples, boletim
 *   de fechamento, "Fechamento" ou "Fechamento PTAX"; números como número).
 * - SGS: https://dadosabertos.bcb.gov.br/dataset/432-taxa-de-juros---meta-selic-definida-pelo-copom
 *   (432 meta Selic % a.a., 4390 Selic acumulada no mês % a.m., 433 IPCA % no
 *   mês, 189 IGP-M % no mês; `/dados/ultimos/N` aceita N até 20; a 432 traz
 *   datas FUTURAS e a 4390 traz o mês corrente parcial).
 */
import { addDias, num, round2, paraCentavos } from './money';
import { CALENDARIO_NACIONAL, ehDiaUtil, diaUtilAnterior } from './feriados';

// ---------------------------------------------------------------------------
// Moedas
// ---------------------------------------------------------------------------

/** As oito moedas que o sistema sempre conhece. */
export type CodigoMoedaDoSistema = 'BRL' | 'USD' | 'EUR' | 'GBP' | 'CAD' | 'CHF' | 'AUD' | 'JPY';
/**
 * Código ISO 4217 de três letras. Desde a E7 (06/11/2026) a agência pode
 * cadastrar outras moedas além das oito do sistema (ARS, CLP, MXN...): por
 * isso o tipo é texto. Quem decide se um código vale é o catálogo.
 */
export type CodigoMoeda = string;

export interface Moeda {
  codigo: CodigoMoeda;
  nome: string;
  simbolo: string;
  /** Existe câmbio turismo na AwesomeAPI (só dólar e euro). */
  turismo: boolean;
  /** Casas decimais da moeda (0 no iene). */
  casas: number;
  /** O Banco Central publica a PTAX desta moeda. */
  ptax?: boolean;
  /** Cadastrada pela agência (as do sistema não têm a marca). */
  da_agencia?: boolean;
  /** Moeda da agência desativada: some das escolhas, mas os registros nela continuam lidos nela. */
  ativo?: boolean;
}

/** Catálogo de moedas de uma agência: as do sistema mais as que ela cadastrou. */
export type CatalogoDeMoedas = readonly Moeda[];

export const MOEDAS: CatalogoDeMoedas = [
  { codigo: 'BRL', nome: 'Real', simbolo: 'R$', turismo: false, casas: 2 },
  { codigo: 'USD', nome: 'Dólar americano', simbolo: 'US$', turismo: true, casas: 2, ptax: true },
  { codigo: 'EUR', nome: 'Euro', simbolo: '€', turismo: true, casas: 2, ptax: true },
  { codigo: 'GBP', nome: 'Libra esterlina', simbolo: '£', turismo: false, casas: 2, ptax: true },
  { codigo: 'CAD', nome: 'Dólar canadense', simbolo: 'C$', turismo: false, casas: 2, ptax: true },
  { codigo: 'CHF', nome: 'Franco suíço', simbolo: 'CHF', turismo: false, casas: 2, ptax: true },
  { codigo: 'AUD', nome: 'Dólar australiano', simbolo: 'A$', turismo: false, casas: 2, ptax: true },
  { codigo: 'JPY', nome: 'Iene', simbolo: '¥', turismo: false, casas: 0, ptax: true },
];

export const MOEDAS_ESTRANGEIRAS: readonly CodigoMoeda[] = MOEDAS.filter(m => m.codigo !== 'BRL').map(m => m.codigo);
export const MOEDAS_TURISMO: readonly CodigoMoeda[] = MOEDAS.filter(m => m.turismo).map(m => m.codigo);

/**
 * Moedas com PTAX publicada pelo Banco Central. Conferido no serviço oficial
 * (Olinda, `PTAX/versao/v1/odata/Moedas`) em 06/11/2026: AUD, CAD, CHF, DKK,
 * EUR, GBP, JPY, NOK, SEK e USD. Moeda da agência fora desta lista não tem
 * cotação ao vivo: o câmbio é sempre digitado.
 */
export const MOEDAS_PTAX_DISPONIVEIS: readonly CodigoMoeda[] = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'DKK', 'NOK', 'SEK'];

// No navegador há uma agência só por página: a tela que carrega o catálogo da
// agência (useMoedas) deixa ele aqui, e formatação e leitura passam a
// reconhecer as moedas dela. No servidor NUNCA: lá o catálogo vai explícito
// em cada chamada (o processo atende várias agências).
let catalogoDoNavegador: CatalogoDeMoedas | null = null;

export function definirCatalogoDoNavegador(c: CatalogoDeMoedas | null): void {
  if (typeof window !== 'undefined') catalogoDoNavegador = c;
}

function catalogoPadrao(): CatalogoDeMoedas {
  return typeof window !== 'undefined' && catalogoDoNavegador ? catalogoDoNavegador : MOEDAS;
}

export function ehMoedaConhecida(v: unknown, catalogo?: CatalogoDeMoedas): v is CodigoMoeda {
  return typeof v === 'string' && (catalogo ?? catalogoPadrao()).some(m => m.codigo === v);
}

/**
 * Moeda gravada (ausente, vazia ou desconhecida = real, como sempre foi).
 * Sem catálogo, só as oito do sistema são conhecidas.
 */
export function moedaDe(v: unknown, catalogo?: CatalogoDeMoedas): CodigoMoeda {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return ehMoedaConhecida(s, catalogo) ? s : 'BRL';
}

export function infoDaMoeda(codigo: string, catalogo?: CatalogoDeMoedas): Moeda {
  const c = catalogo ?? catalogoPadrao();
  return c.find(m => m.codigo === codigo) ?? MOEDAS.find(m => m.codigo === codigo) ?? MOEDAS[0];
}

/** "US$ 1.234,56" — valor na moeda, para tela, com as casas da moeda. */
export function formatarNaMoeda(valor: number, moeda: string, catalogo?: CatalogoDeMoedas): string {
  const m = moedaDe(moeda, catalogo);
  const info = infoDaMoeda(m, catalogo);
  const casas = Number.isInteger(info.casas) && info.casas >= 0 && info.casas <= 3 ? info.casas : 2;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: m, minimumFractionDigits: casas, maximumFractionDigits: casas }).format(num(valor));
  } catch {
    return `${info.simbolo} ${num(valor).toFixed(casas)}`;
  }
}

/** "5,8893" — câmbio com 4 casas, sem símbolo. */
export function formatarCambio(c: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(num(c));
}

// ---------------------------------------------------------------------------
// Cotações, índices e fontes
// ---------------------------------------------------------------------------

export type TipoCotacao = 'turismo' | 'ptax';
export type CodigoIndice = 'selic_meta' | 'selic_mes' | 'ipca' | 'igpm';
export type NomeDaFonte = 'awesomeapi' | 'bcb_ptax' | 'bcb_sgs';

export const NOMES_DAS_FONTES: Record<NomeDaFonte, string> = {
  awesomeapi: 'AwesomeAPI (câmbio turismo)',
  bcb_ptax: 'Banco Central (PTAX)',
  bcb_sgs: 'Banco Central (índices)',
};

export const SERIES_SGS: Record<CodigoIndice, { codigo: number; nome: string; unidade: string; periodicidade: 'diaria' | 'mensal' }> = {
  selic_meta: { codigo: 432, nome: 'Selic (meta do Copom)', unidade: '% ao ano', periodicidade: 'diaria' },
  selic_mes: { codigo: 4390, nome: 'Selic acumulada no mês', unidade: '% no mês', periodicidade: 'mensal' },
  ipca: { codigo: 433, nome: 'IPCA', unidade: '% no mês', periodicidade: 'mensal' },
  igpm: { codigo: 189, nome: 'IGP-M', unidade: '% no mês', periodicidade: 'mensal' },
};

/** Uma cotação gravada no cache (o que as telas recebem). */
export interface Cotacao {
  tipo: TipoCotacao;
  moeda: CodigoMoeda;
  fonte: NomeDaFonte;
  compra: number;
  venda: number;
  /** Horário que a FONTE informou (ISO). */
  cotado_em: string;
  /** Quando o Financeiro buscou (ISO). */
  obtido_em: string;
  /** Dia a que a PTAX se refere (AAAA-MM-DD); no turismo, igual ao dia de cotado_em. */
  referencia: string;
}

export interface ValorDeIndice {
  indice: CodigoIndice;
  /** 'AAAA-MM-DD' (diária) ou 'AAAA-MM' (mensal). */
  referencia: string;
  valor: number;
  /** Mês ainda em curso (Selic acumulada do mês corrente). */
  parcial?: boolean;
}

/** Estado de uma fonte, com o disjuntor. */
export interface EstadoDaFonte {
  fonte: NomeDaFonte;
  falhas_seguidas: number;
  aberto_ate: string | null;
  ultimo_erro: string | null;
  ultimo_sucesso: string | null;
  ultima_tentativa: string | null;
  /** Fonte que precisa de chave e não tem (AwesomeAPI sem chave no cofre). */
  sem_chave?: boolean;
}

// ---------------------------------------------------------------------------
// Endereços (sem chave na URL: ela vai no cabeçalho e nunca cai em log)
// ---------------------------------------------------------------------------

export const URL_AWESOME = 'https://economia.awesomeapi.com.br/json/last/';
export const URL_PTAX = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/';
export const URL_SGS = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.';

/** Uma chamada só para todos os pares de turismo. */
export function urlAwesomeTurismo(moedas: readonly string[] = MOEDAS_TURISMO): string {
  return URL_AWESOME + moedas.map(m => `${m}-BRLT`).join(',');
}

/** 'AAAA-MM-DD' → "'MM-DD-AAAA'" (formato da Olinda). */
function dataOlinda(iso: string): string {
  return `'${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}'`;
}

/** PTAX de uma moeda num período (pega fim de semana e feriado de uma vez). */
export function urlPtaxPeriodo(moeda: string, de: string, ate: string): string {
  const q = `@moeda='${moeda}'&@dataInicial=${dataOlinda(de)}&@dataFinalCotacao=${dataOlinda(ate)}&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim`;
  return `${URL_PTAX}CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?${q}`;
}

/** Últimos N valores de uma série do SGS (o BCB aceita N até 20). */
export function urlSgsUltimos(codigo: number, n: number): string {
  return `${URL_SGS}${codigo}/dados/ultimos/${Math.min(20, Math.max(1, Math.floor(n)))}?formato=json`;
}

// ---------------------------------------------------------------------------
// Leitura das respostas (rejeita o que não reconhece, nunca inventa)
// ---------------------------------------------------------------------------

export class ErroDeFonte extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroDeFonte';
  }
}

function numeroPositivo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Resposta da AwesomeAPI (`/json/last/USD-BRLT,EUR-BRLT`) → cotações de turismo. */
export function lerRespostaAwesome(json: unknown, obtidoEm: Date): Cotacao[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ErroDeFonte('Resposta da AwesomeAPI em formato inesperado.');
  const saida: Cotacao[] = [];
  for (const [chave, v] of Object.entries(json as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (r.codein !== 'BRLT') continue;
    const moeda = moedaDe(r.code);
    if (moeda === 'BRL' || chave !== `${moeda}BRLT`) continue;
    const compra = numeroPositivo(r.bid);
    const venda = numeroPositivo(r.ask);
    const ts = Number(r.timestamp);
    if (compra === null || venda === null || !Number.isFinite(ts) || ts <= 0) continue;
    const cotado = new Date(ts * 1000).toISOString();
    saida.push({
      tipo: 'turismo', moeda, fonte: 'awesomeapi', compra, venda, cotado_em: cotado,
      obtido_em: obtidoEm.toISOString(), referencia: diaDeBrasilia(new Date(ts * 1000)),
    });
  }
  if (saida.length === 0) throw new ErroDeFonte('A AwesomeAPI não devolveu nenhuma cotação de turismo reconhecível.');
  return saida;
}

/**
 * Resposta da Olinda (CotacaoMoedaPeriodo) → uma cotação por dia, só o
 * boletim de fechamento. A Olinda responde `tipoBoletim: "Fechamento"` (visto na
 * resposta real em 05/11/2026; a documentação fala em "Fechamento PTAX"):
 * aceita os dois. Dia sem fechamento fica de fora.
 */
export function lerRespostaPtax(json: unknown, moeda: CodigoMoeda, obtidoEm: Date): Cotacao[] {
  const valor = (json as { value?: unknown } | null)?.value;
  if (!Array.isArray(valor)) throw new ErroDeFonte('Resposta da PTAX em formato inesperado.');
  const porDia = new Map<string, Cotacao>();
  for (const v of valor) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (r.tipoBoletim !== undefined && !/^Fechamento\b/i.test(String(r.tipoBoletim))) continue;
    const compra = numeroPositivo(r.cotacaoCompra);
    const venda = numeroPositivo(r.cotacaoVenda);
    const dh = String(r.dataHoraCotacao ?? '');
    if (compra === null || venda === null || !/^\d{4}-\d{2}-\d{2}/.test(dh)) continue;
    // A Olinda informa a hora de Brasília, sem fuso.
    const cotado = new Date(`${dh.slice(0, 19).replace(' ', 'T')}-03:00`);
    if (Number.isNaN(cotado.getTime())) continue;
    const dia = dh.slice(0, 10);
    porDia.set(dia, {
      tipo: 'ptax', moeda, fonte: 'bcb_ptax', compra, venda, cotado_em: cotado.toISOString(),
      obtido_em: obtidoEm.toISOString(), referencia: dia,
    });
  }
  return [...porDia.values()].sort((a, b) => a.referencia.localeCompare(b.referencia));
}

/**
 * Resposta do SGS (`[{data:"dd/MM/aaaa", valor:"0.82"}]`) → valores em ordem,
 * sem datas futuras (a meta Selic vem preenchida adiante).
 */
export function lerSerieSgs(json: unknown, indice: CodigoIndice, hoje: string): ValorDeIndice[] {
  if (!Array.isArray(json)) throw new ErroDeFonte('Resposta do Banco Central (SGS) em formato inesperado.');
  const mensal = SERIES_SGS[indice].periodicidade === 'mensal';
  const mesAtual = hoje.slice(0, 7);
  const saida = new Map<string, ValorDeIndice>();
  for (const v of json) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(r.data ?? ''));
    const valor = typeof r.valor === 'string' || typeof r.valor === 'number' ? Number(String(r.valor).replace(',', '.')) : NaN;
    if (!m || !Number.isFinite(valor)) continue;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (iso > hoje) continue;
    const referencia = mensal ? iso.slice(0, 7) : iso;
    saida.set(referencia, { indice, referencia, valor, ...(mensal && referencia === mesAtual ? { parcial: true } : {}) });
  }
  return [...saida.values()].sort((a, b) => a.referencia.localeCompare(b.referencia));
}

// ---------------------------------------------------------------------------
// Quando consultar (o cache de 15 min não vira 15 min de chamadas a tudo)
// ---------------------------------------------------------------------------

/** 'AAAA-MM-DD' de Brasília para um instante. */
export function diaDeBrasilia(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p.slice(0, 10);
}

function horaDeBrasiliaEmMinutos(d: Date): number {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0);
  return v('hour') * 60 + v('minute');
}

/**
 * Último dia cujo fechamento PTAX já deveria existir: hoje, se for dia útil
 * e já passou das 13h30 de Brasília (o BCB publica perto das 13h10); senão,
 * o dia útil anterior.
 */
export function diaDaPtaxEsperada(agora: Date): string {
  const hoje = diaDeBrasilia(agora);
  if (ehDiaUtil(hoje, CALENDARIO_NACIONAL) && horaDeBrasiliaEmMinutos(agora) >= 13 * 60 + 30) return hoje;
  // diaUtilAnterior devolve o próprio dia quando ele é útil: começa em ontem.
  return diaUtilAnterior(addDias(hoje, -1), CALENDARIO_NACIONAL);
}

const minutosDesde = (iso: string | null | undefined, agora: Date) =>
  iso ? (agora.getTime() - new Date(iso).getTime()) / 60_000 : Infinity;

/** PTAX: só quando falta o fechamento esperado, e no máximo uma vez por hora. */
export function precisaConsultarPtax(ultimaReferencia: string | null, ultimaTentativa: string | null, agora: Date): boolean {
  if (ultimaReferencia && ultimaReferencia >= diaDaPtaxEsperada(agora)) return false;
  return minutosDesde(ultimaTentativa, agora) >= 60;
}

/** Índices mudam por dia ou por mês: uma consulta a cada 12 horas basta. */
export function precisaConsultarIndices(ultimoSucesso: string | null, ultimaTentativa: string | null, agora: Date): boolean {
  if (minutosDesde(ultimoSucesso, agora) < 12 * 60) return false;
  return minutosDesde(ultimaTentativa, agora) >= 60;
}

// ---------------------------------------------------------------------------
// Disjuntor por fonte
// ---------------------------------------------------------------------------

export const FALHAS_PARA_ABRIR_FONTE = 3;
export const MINUTOS_FONTE_ABERTA = 30;

/** A fonte está em pausa (disjuntor aberto)? */
export function fonteEmPausa(e: Pick<EstadoDaFonte, 'aberto_ate'> | null | undefined, agora: Date): boolean {
  return !!e?.aberto_ate && new Date(e.aberto_ate).getTime() > agora.getTime();
}

/** Próximo estado depois de uma tentativa. Três falhas seguidas pausam 30 min. */
export function proximoEstadoDaFonte(
  atual: EstadoDaFonte | null,
  fonte: NomeDaFonte,
  resultado: { ok: true } | { ok: false; erro: string },
  agora: Date,
): EstadoDaFonte {
  const base: EstadoDaFonte = atual ?? { fonte, falhas_seguidas: 0, aberto_ate: null, ultimo_erro: null, ultimo_sucesso: null, ultima_tentativa: null };
  const quando = agora.toISOString();
  if (resultado.ok) return { ...base, fonte, falhas_seguidas: 0, aberto_ate: null, ultimo_erro: null, ultimo_sucesso: quando, ultima_tentativa: quando, sem_chave: false };
  const falhas = base.falhas_seguidas + 1;
  return {
    ...base, fonte, falhas_seguidas: falhas, ultimo_erro: resultado.erro.slice(0, 500), ultima_tentativa: quando,
    aberto_ate: falhas >= FALHAS_PARA_ABRIR_FONTE ? new Date(agora.getTime() + MINUTOS_FONTE_ABERTA * 60_000).toISOString() : base.aberto_ate,
  };
}

// ---------------------------------------------------------------------------
// Idade da cotação (o que a tela diz ao lado do número)
// ---------------------------------------------------------------------------

export type SituacaoDaCotacao = 'em_dia' | 'atrasada' | 'sem_cotacao';

/** Minutos desde que a fonte cotou. */
export function idadeEmMinutos(cotadoEm: string | null | undefined, agora: Date): number | null {
  if (!cotadoEm) return null;
  const t = new Date(cotadoEm).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((agora.getTime() - t) / 60_000));
}

/**
 * Turismo vale "em dia" até 45 min (três janelas de 15). PTAX vale em dia
 * quando é o fechamento esperado (dia útil anterior antes das 13h30).
 */
export function situacaoDaCotacao(c: Pick<Cotacao, 'tipo' | 'cotado_em' | 'referencia'> | null | undefined, agora: Date): SituacaoDaCotacao {
  if (!c) return 'sem_cotacao';
  if (c.tipo === 'ptax') return c.referencia >= diaDaPtaxEsperada(agora) ? 'em_dia' : 'atrasada';
  const idade = idadeEmMinutos(c.cotado_em, agora);
  if (idade === null) return 'sem_cotacao';
  return idade <= 45 ? 'em_dia' : 'atrasada';
}

/** "agora há pouco", "há 12 min", "há 3 h", "há 2 dias". */
export function textoDaIdade(minutos: number | null): string {
  if (minutos === null) return 'sem horário';
  if (minutos < 2) return 'agora há pouco';
  if (minutos < 60) return `há ${minutos} min`;
  const h = Math.floor(minutos / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

// ---------------------------------------------------------------------------
// Carimbo: fonte e horário guardados em cada valor usado
// ---------------------------------------------------------------------------

export type OrigemDoCambio = 'manual' | 'turismo' | 'ptax';

export interface CarimboDoCambio {
  valor: number;
  origem: OrigemDoCambio;
  /** Fonte da cotação usada (ausente quando digitado). */
  fonte?: NomeDaFonte;
  /** Horário que a fonte informou (ausente quando digitado). */
  cotado_em?: string;
  /** Lado usado: venda (padrão para pagar/comprar moeda) ou compra. */
  lado?: 'venda' | 'compra';
}

export function carimboManual(valor: number): CarimboDoCambio {
  return { valor: round4(valor), origem: 'manual' };
}

export function carimboDaCotacao(c: Cotacao, lado: 'venda' | 'compra' = 'venda'): CarimboDoCambio {
  return { valor: round4(lado === 'venda' ? c.venda : c.compra), origem: c.tipo, fonte: c.fonte, cotado_em: c.cotado_em, lado };
}

/** Câmbio com 4 casas (o que se grava e o que se mostra). */
export function round4(n: number): number {
  return Math.round(num(n) * 10_000) / 10_000;
}

/** Lê um carimbo vindo da tela; o que não reconhece vira "digitado". */
export function lerCarimbo(v: unknown, valor: number): CarimboDoCambio {
  const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const origem = c.origem === 'turismo' || c.origem === 'ptax' ? c.origem : 'manual';
  // Valor diferente da sugestão = a pessoa mexeu: vira digitado.
  if (origem === 'manual' || round4(num(c.valor)) !== round4(valor)) return carimboManual(valor);
  const fonte = c.fonte === 'awesomeapi' || c.fonte === 'bcb_ptax' ? c.fonte : undefined;
  const cotado = typeof c.cotado_em === 'string' && !Number.isNaN(Date.parse(c.cotado_em)) ? c.cotado_em : undefined;
  return { valor: round4(valor), origem, fonte, cotado_em: cotado, lado: c.lado === 'compra' ? 'compra' : 'venda' };
}

/** "Turismo, AwesomeAPI, 05/11 14:30" / "Digitado". */
export function descreverCarimbo(c: CarimboDoCambio | null | undefined): string {
  if (!c || c.origem === 'manual') return 'Digitado';
  const quando = c.cotado_em
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(c.cotado_em))
    : '';
  return `${c.origem === 'turismo' ? 'Turismo' : 'PTAX'}${c.fonte ? `, ${NOMES_DAS_FONTES[c.fonte]}` : ''}${quando ? `, ${quando}` : ''}`;
}

/** As sugestões para uma moeda, lado a lado e com nome — nunca uma no lugar da outra. */
export function sugestoesPara(moeda: string, cotacoes: readonly Cotacao[], catalogo?: CatalogoDeMoedas): { turismo: Cotacao | null; ptax: Cotacao | null } {
  const m = moedaDe(moeda, catalogo);
  const ultima = (tipo: TipoCotacao) => cotacoes
    .filter(c => c.moeda === m && c.tipo === tipo)
    .sort((a, b) => b.cotado_em.localeCompare(a.cotado_em))[0] ?? null;
  return { turismo: ultima('turismo'), ptax: ultima('ptax') };
}

// ---------------------------------------------------------------------------
// Contas em moeda estrangeira
// ---------------------------------------------------------------------------

export interface ContaComMoeda {
  id: string;
  nome?: string;
  moeda?: string | null;
  saldo_atual?: number | null;
}

export interface SaldoEmReais {
  id: string;
  moeda: CodigoMoeda;
  saldo_moeda: number;
  /** Em reais pelo câmbio de referência; null quando falta a cotação. */
  saldo_reais: number | null;
  cambio: number | null;
  /** Qual cotação foi usada (sempre PTAX de venda, a referência de mercado). */
  referencia: Cotacao | null;
}

/**
 * Saldo de cada conta em reais. Real fica igual (sem tocar no número). Moeda
 * estrangeira usa a PTAX de venda mais recente; sem PTAX, fica sem valor em
 * reais (a tela avisa), nunca com outra cotação no lugar.
 */
export function saldosEmReais(contas: readonly ContaComMoeda[], cotacoes: readonly Cotacao[], catalogo?: CatalogoDeMoedas): SaldoEmReais[] {
  return contas.map(c => {
    const moeda = moedaDe(c.moeda, catalogo);
    const saldo = round2(num(c.saldo_atual));
    if (moeda === 'BRL') return { id: c.id, moeda, saldo_moeda: saldo, saldo_reais: saldo, cambio: 1, referencia: null };
    const ref = sugestoesPara(moeda, cotacoes, catalogo).ptax;
    return {
      id: c.id, moeda, saldo_moeda: saldo,
      saldo_reais: ref ? round2(saldo * ref.venda) : null,
      cambio: ref ? ref.venda : null,
      referencia: ref,
    };
  });
}

/** Total em reais e as contas que ficaram de fora por falta de cotação. */
export function saldoTotalEmReais(saldos: readonly SaldoEmReais[]): { total: number; sem_cotacao: string[] } {
  let centavos = 0;
  const sem: string[] = [];
  for (const s of saldos) {
    if (s.saldo_reais === null) sem.push(s.id);
    else centavos += paraCentavos(s.saldo_reais);
  }
  return { total: centavos / 100, sem_cotacao: sem };
}

// ---------------------------------------------------------------------------
// Transferência entre moedas
// ---------------------------------------------------------------------------

export interface PedidoDeTransferencia {
  /** Sai da origem, na moeda da origem. */
  valor: number;
  moeda_origem: string;
  moeda_destino: string;
  /**
   * Câmbio: quantos reais vale 1 unidade da moeda estrangeira. Entre duas
   * estrangeiras: quantas unidades do destino vale 1 unidade da origem.
   */
  cambio?: number | null;
  /** Tarifa cobrada pelo banco, na moeda da origem; sai da origem. */
  tarifa?: number | null;
}

export interface PlanoDaTransferencia {
  moeda_origem: CodigoMoeda;
  moeda_destino: CodigoMoeda;
  valor: number;
  valor_destino: number;
  tarifa: number;
  /** Total que sai da origem (valor + tarifa). */
  sai_da_origem: number;
  cambio: number | null;
  erros: string[];
}

/** Rótulo do campo de câmbio para o par (o que o número significa). */
export function significadoDoCambio(origem: string, destino: string, catalogo?: CatalogoDeMoedas): string {
  const o = moedaDe(origem, catalogo);
  const d = moedaDe(destino, catalogo);
  if (o === d) return '';
  if (o === 'BRL') return `Quantos reais vale 1 ${d}`;
  if (d === 'BRL') return `Quantos reais vale 1 ${o}`;
  return `Quantos ${d} vale 1 ${o}`;
}

export function planoDaTransferencia(p: PedidoDeTransferencia, catalogo?: CatalogoDeMoedas): PlanoDaTransferencia {
  const moeda_origem = moedaDe(p.moeda_origem, catalogo);
  const moeda_destino = moedaDe(p.moeda_destino, catalogo);
  const valor = round2(num(p.valor));
  const tarifa = Math.max(0, round2(num(p.tarifa)));
  const erros: string[] = [];
  if (valor <= 0) erros.push('Informe um valor maior que zero.');
  if (num(p.tarifa) < 0) erros.push('A tarifa não pode ser negativa.');
  let cambio: number | null = null;
  let valor_destino = valor;
  if (moeda_origem !== moeda_destino) {
    const c = round4(num(p.cambio));
    if (!(c > 0)) {
      erros.push(`Informe o câmbio (${significadoDoCambio(moeda_origem, moeda_destino, catalogo).toLowerCase()}).`);
    } else {
      cambio = c;
      // Reais → estrangeira divide; estrangeira → reais e entre estrangeiras multiplica.
      valor_destino = moeda_origem === 'BRL' ? round2(valor / c) : round2(valor * c);
      if (valor > 0 && valor_destino <= 0) erros.push('Com esse câmbio o valor que chega é zero.');
    }
  }
  return { moeda_origem, moeda_destino, valor, valor_destino, tarifa, sai_da_origem: round2(valor + tarifa), cambio, erros };
}

/**
 * Valores de uma transferência gravada (antigas: sem moeda, sem tarifa, o
 * mesmo valor nas duas pontas — exatamente como sempre foi).
 */
export function pernasDaTransferencia(t: Record<string, unknown>): { sai: number; entra: number; tarifa: number; valor: number } {
  const valor = round2(num(t.valor));
  const tarifa = Math.max(0, round2(num(t.tarifa)));
  const destino = t.valor_destino === undefined || t.valor_destino === null || t.valor_destino === ''
    ? valor
    : round2(num(t.valor_destino));
  return { valor, sai: valor, entra: destino, tarifa };
}

// ---------------------------------------------------------------------------
// Variação cambial na liquidação
// ---------------------------------------------------------------------------

/**
 * Valor do título na moeda estrangeira, só quando os números se confirmam:
 * moeda estrangeira, câmbio e valor original positivos, e valor original ×
 * câmbio igual ao valor lançado em reais (tolerância de arredondamento).
 * Contas antigas com o valor em reais repetido no "original" ficam de fora
 * (null): nelas não existe variação a calcular.
 */
export function valorNaMoedaDoTitulo(d: Record<string, unknown>, baseEmReais: number, catalogo?: CatalogoDeMoedas): { moeda: CodigoMoeda; valor: number; cambio: number } | null {
  const moeda = moedaDe(d.moeda, catalogo);
  if (moeda === 'BRL') return null;
  const valor = round2(num(d.valor_original));
  const cambio = round4(num(d.cambio));
  if (!(valor > 0) || !(cambio > 0) || cambio === 1) return null;
  const tolerancia = Math.max(0.05, round2(valor * 0.00005) + 0.01);
  if (Math.abs(round2(valor * cambio) - round2(baseEmReais)) > tolerancia) return null;
  return { moeda, valor, cambio };
}

export interface VariacaoCambial {
  /** Moeda estrangeira liquidada nesta baixa. */
  valor_moeda: number;
  cambio_lancado: number;
  cambio_pago: number;
  /** Quanto o título muda em reais (+ ficou maior, − ficou menor). */
  variacao: number;
  /** Efeito no resultado da agência: + ganho, − perda. */
  resultado: number;
}

/**
 * Variação de uma liquidação: a moeda liquidada × (câmbio pago − câmbio
 * lançado). Para quem paga, câmbio que sobe é perda; para quem recebe, ganho.
 */
export function variacaoCambial(p: {
  tabela: 'contas_receber' | 'contas_pagar';
  valor_moeda: number;
  cambio_lancado: number;
  cambio_pago: number;
}): VariacaoCambial {
  const valor_moeda = round2(num(p.valor_moeda));
  const cambio_lancado = round4(num(p.cambio_lancado));
  const cambio_pago = round4(num(p.cambio_pago));
  const variacao = valor_moeda > 0 && cambio_lancado > 0 && cambio_pago > 0
    ? round2(valor_moeda * cambio_pago) - round2(valor_moeda * cambio_lancado)
    : 0;
  const v = round2(variacao);
  return { valor_moeda, cambio_lancado, cambio_pago, variacao: v, resultado: p.tabela === 'contas_pagar' ? round2(-v) : v };
}

/**
 * Quanto da moeda estrangeira esta baixa liquida: o que falta do título na
 * moeda, ou a parte paga (principal em reais ÷ câmbio pago), o que for menor.
 */
export function moedaLiquidada(p: {
  saldo_moeda: number;
  principal_reais: number;
  cambio_pago: number;
}): number {
  const saldo = Math.max(0, round2(num(p.saldo_moeda)));
  const c = num(p.cambio_pago);
  if (!(c > 0)) return 0;
  return Math.min(saldo, round2(num(p.principal_reais) / c));
}

/** Natureza para a tela: "Ganho de câmbio" / "Perda de câmbio". */
export function rotuloDaVariacao(resultado: number): string {
  if (resultado > 0) return 'Ganho de câmbio';
  if (resultado < 0) return 'Perda de câmbio';
  return 'Sem variação';
}

// ---------------------------------------------------------------------------
// Índices: reajuste e juros (só sugestão; a pessoa decide)
// ---------------------------------------------------------------------------

/** Acumulado de variações mensais em %: (1+a)(1+b)... − 1. */
export function acumuladoPct(valores: readonly number[]): number {
  let f = 1;
  for (const v of valores) f *= 1 + num(v) / 100;
  return Math.round((f - 1) * 10_000) / 100;
}

export interface ReajustePeloIndice {
  indice: 'ipca' | 'igpm';
  percentual: number;
  /** Primeiro e último mês somados ('AAAA-MM'). */
  de: string;
  ate: string;
  meses: number;
}

/** Os últimos 12 meses fechados de IPCA ou IGP-M, acumulados. */
export function reajusteDosUltimos12Meses(serie: readonly ValorDeIndice[], indice: 'ipca' | 'igpm'): ReajustePeloIndice | null {
  const fechados = serie.filter(v => v.indice === indice && !v.parcial).sort((a, b) => a.referencia.localeCompare(b.referencia));
  const ult = fechados.slice(-12);
  if (ult.length < 12) return null;
  return { indice, percentual: acumuladoPct(ult.map(v => v.valor)), de: ult[0].referencia, ate: ult[ult.length - 1].referencia, meses: 12 };
}

/** Selic anual → equivalente ao mês, em % (para sugerir juros ao mês). */
export function equivalenteMensalPct(anualPct: number): number {
  const a = num(anualPct);
  if (!(a > -100)) return 0;
  return Math.round((Math.pow(1 + a / 100, 1 / 12) - 1) * 10_000) / 100;
}

/** O valor mais recente de um índice (até hoje). */
export function ultimoDoIndice(serie: readonly ValorDeIndice[], indice: CodigoIndice, apenasFechados = false): ValorDeIndice | null {
  return serie
    .filter(v => v.indice === indice && (!apenasFechados || !v.parcial))
    .sort((a, b) => b.referencia.localeCompare(a.referencia))[0] ?? null;
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** 'AAAA-MM' → "out/2026". */
export function mesPorExtenso(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MESES_CURTOS[m - 1]}/${ym.slice(0, 4)}` : ym;
}

/** Soma por título (`${tabela}:${id}`) do que as liquidações somaram ao valor em reais. */
export function variacaoPorTitulo(linhas: ReadonlyArray<{ titulo_tabela: string; titulo_id: string; variacao: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of linhas) {
    const k = `${l.titulo_tabela}:${l.titulo_id}`;
    m.set(k, round2((m.get(k) ?? 0) + num(l.variacao)));
  }
  for (const [k, v] of m) if (v === 0) m.delete(k);
  return m;
}

/** Resultado do câmbio numa liquidação (a tela mostra; o servidor grava). */
export interface CambioNaLiquidacao {
  moeda: CodigoMoeda;
  /** Ainda em aberto na moeda, antes desta liquidação. */
  saldo_moeda: number;
  cambio_lancado: number;
  variacao: VariacaoCambial;
  /** Conta bancária em moeda: quanto sai/entra dela, na moeda. */
  caixa_na_moeda: number | null;
}

/**
 * A conta do câmbio de uma liquidação, igual na tela e no servidor.
 * - O já liquidado na moeda soma as baixas com câmbio (guardado no título)
 *   e as sem câmbio, que contam pelo câmbio lançado (sem variação).
 * - A moeda liquidada agora é o principal em reais ÷ câmbio pago, até o saldo.
 * null = conta sem valor na moeda (antiga ou em real) ou sem câmbio.
 */
export function cambioDaLiquidacao(p: {
  tabela: 'contas_receber' | 'contas_pagar';
  titulo: Record<string, unknown>;
  base_reais: number;
  valor_baixado: number;
  valor: number;
  juros?: number;
  multa?: number;
  desconto?: number;
  cambio_pago: number | null | undefined;
  moeda_conta?: CodigoMoeda;
  /** Catálogo da agência (moedas cadastradas por ela). */
  catalogo?: CatalogoDeMoedas;
}): CambioNaLiquidacao | null {
  const naMoeda = valorNaMoedaDoTitulo(p.titulo, p.base_reais, p.catalogo);
  const cambioPago = num(p.cambio_pago) > 0 ? round4(num(p.cambio_pago)) : 0;
  if (!naMoeda || !cambioPago) return null;
  const semCambio = Math.max(0, round2(num(p.valor_baixado) - num(p.titulo.valor_reais_liquidado_com_cambio)));
  const liquidado = round2(num(p.titulo.valor_moeda_liquidado) + round2(semCambio / naMoeda.cambio));
  const saldoMoeda = Math.max(0, round2(naMoeda.valor - liquidado));
  const principalReais = round2(num(p.valor) - num(p.juros) - num(p.multa) + num(p.desconto));
  let liq = moedaLiquidada({ saldo_moeda: saldoMoeda, principal_reais: principalReais, cambio_pago: cambioPago });
  // Diferença de arredondamento de um centavo na moeda: liquida o saldo todo.
  if (saldoMoeda - liq > 0 && saldoMoeda - liq <= 0.01) liq = saldoMoeda;
  const variacao = variacaoCambial({ tabela: p.tabela, valor_moeda: liq, cambio_lancado: naMoeda.cambio, cambio_pago: cambioPago });
  let caixa: number | null = null;
  if (p.moeda_conta && p.moeda_conta !== 'BRL') {
    const encargosNaMoeda = round2((num(p.valor) - principalReais) / cambioPago);
    const exato = round2(liq + encargosNaMoeda);
    const direto = round2(num(p.valor) / cambioPago);
    caixa = Math.abs(direto - exato) <= 0.01 ? exato : direto;
  }
  return { moeda: naMoeda.moeda, saldo_moeda: saldoMoeda, cambio_lancado: naMoeda.cambio, variacao, caixa_na_moeda: caixa };
}
