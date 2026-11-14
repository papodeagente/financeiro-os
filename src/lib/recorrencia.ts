/**
 * Recorrência e parcelamento de contas a pagar/receber (05/11/2026).
 *
 * Puro (sem banco, sem relógio): a mesma conta roda no formulário, para a
 * prévia aparecer na hora, e no servidor, que grava. As duas pontas chegam
 * às mesmas datas e aos mesmos valores porque usam esta função.
 *
 * Dois modos, com os nomes de sempre do mercado:
 *  - Recorrente: repete o mesmo valor (aluguel, assinatura).
 *  - Parcelado: divide o valor em N (o resto dos centavos vai na última).
 *
 * A regra vai além das 7 periodicidades fixas: "a cada N" dias/semanas/
 * meses/anos, dia fixo do mês, último dia útil, o que fazer quando cai em
 * fim de semana ou feriado, termina numa data, após N vezes ou nunca (até
 * cancelar) e reajuste anual por percentual.
 *
 * Dinheiro aqui é sempre em CENTAVOS inteiros; datas são 'AAAA-MM-DD'.
 */
import { addDias, addMeses, dataLocal, dataSegura } from './money';
import {
  CALENDARIO_NACIONAL,
  diaDaSemana,
  diaUtilAnterior,
  ehDiaUtil,
  motivoDeNaoSerUtil,
  proximoDiaUtil,
  ultimoDiaUtilDoMes,
  type Calendario,
} from './feriados';

export type Frequencia = 'DIA' | 'SEMANA' | 'MES' | 'ANO';
export type TratamentoFeriado = 'antecipar' | 'postergar' | 'manter';
export type ModoSerie = 'recorrente' | 'parcelado';

export interface FimDaRegra {
  tipo: 'nunca' | 'data' | 'ocorrencias';
  /** Última data possível (inclusive), quando tipo = 'data'. */
  data?: string;
  /** Quantas vezes, quando tipo = 'ocorrencias'. */
  ocorrencias?: number;
}

export interface ReajusteDaRegra {
  tipo: 'fixo';
  /** Percentual aplicado uma vez por ano (ex.: 5 = 5%). */
  percentual: number;
  /** Mês do ano em que o reajuste passa a valer (1 a 12). */
  mes: number;
  /**
   * De onde veio o percentual, quando a pessoa usou a sugestão do índice
   * (05/11/2026, E6): IPCA ou IGP-M acumulado de 12 meses, do Banco Central.
   * Só registra a origem; o percentual aplicado é sempre o gravado acima.
   */
  origem?: OrigemDoReajuste;
}

export interface OrigemDoReajuste {
  indice: 'ipca' | 'igpm';
  /** Primeiro e último mês somados ('AAAA-MM'). */
  de: string;
  ate: string;
  fonte: 'bcb_sgs';
}

const NOME_DO_INDICE: Record<OrigemDoReajuste['indice'], string> = { ipca: 'IPCA', igpm: 'IGP-M' };

/** Origem válida do reajuste (ou nada). */
export function lerOrigemDoReajuste(v: unknown): OrigemDoReajuste | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const ym = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}$/.test(x);
  if ((o.indice !== 'ipca' && o.indice !== 'igpm') || !ym(o.de) || !ym(o.ate)) return undefined;
  return { indice: o.indice, de: o.de as string, ate: o.ate as string, fonte: 'bcb_sgs' };
}

export interface RegraRecorrencia {
  frequencia: Frequencia;
  /** A cada quantas unidades da frequência (1 = toda). */
  intervalo: number;
  /** Dia fixo do mês (1 a 31; mês curto usa o último dia). Mês e ano. */
  dia_do_mes?: number;
  /** Vence no último dia útil do mês (só frequência MES). */
  ultimo_dia_util?: boolean;
  /** Dia da semana (0 = domingo … 6 = sábado). Só frequência SEMANA. */
  dia_semana?: number;
  /** O que fazer quando o vencimento cai em fim de semana ou feriado. */
  feriado: TratamentoFeriado;
  fim: FimDaRegra;
  /** Só no modo recorrente. */
  reajuste?: ReajusteDaRegra;
}

export interface Ocorrencia {
  /** 1, 2, 3… na ordem da série. */
  ordem: number;
  /** Data pela regra, antes do ajuste de feriado. */
  nominal: string;
  /** Vencimento de verdade (depois do ajuste). */
  vencimento: string;
}

export interface OcorrenciaComValor extends Ocorrencia {
  valor_centavos: number;
  /** "sábado", "Natal"… quando o vencimento ficou num dia que não é útil. */
  aviso: string | null;
}

/** Acima disto, a série nasce só até o horizonte e cresce pelo agendador. */
export const LIMITE_GERACAO_IMEDIATA = 120;
/** Trava de segurança para contar/gerar ocorrências. */
export const LIMITE_DE_OCORRENCIAS = 2000;
export const MAX_PARCELAS = 120;

// ---------------------------------------------------------------------------
// Periodicidades com os nomes de sempre
// ---------------------------------------------------------------------------

export type ChavePreset = 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'BIMESTRAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

export interface Preset {
  chave: ChavePreset;
  rotulo: string;
  frequencia: Frequencia;
  intervalo: number;
}

export const PRESETS: ReadonlyArray<Preset> = [
  { chave: 'SEMANAL', rotulo: 'Semanal', frequencia: 'SEMANA', intervalo: 1 },
  // Quinzenal = a cada 14 dias, como sempre foi na despesa fixa desta tela.
  { chave: 'QUINZENAL', rotulo: 'Quinzenal', frequencia: 'SEMANA', intervalo: 2 },
  { chave: 'MENSAL', rotulo: 'Mensal', frequencia: 'MES', intervalo: 1 },
  { chave: 'BIMESTRAL', rotulo: 'Bimestral', frequencia: 'MES', intervalo: 2 },
  { chave: 'TRIMESTRAL', rotulo: 'Trimestral', frequencia: 'MES', intervalo: 3 },
  { chave: 'SEMESTRAL', rotulo: 'Semestral', frequencia: 'MES', intervalo: 6 },
  { chave: 'ANUAL', rotulo: 'Anual', frequencia: 'ANO', intervalo: 1 },
];

export function presetPorChave(chave: string): Preset | null {
  return PRESETS.find(p => p.chave === chave) ?? null;
}

/** Regra de um preset, com o fim e o tratamento de feriado escolhidos. */
export function regraDoPreset(
  chave: ChavePreset,
  fim: FimDaRegra,
  extras: Partial<Omit<RegraRecorrencia, 'frequencia' | 'intervalo' | 'fim'>> = {},
): RegraRecorrencia {
  const p = presetPorChave(chave) ?? PRESETS[2];
  return { frequencia: p.frequencia, intervalo: p.intervalo, feriado: 'manter', ...extras, fim };
}

/** O preset que tem a mesma frequência e intervalo, ou null. */
export function presetDaRegra(regra: Pick<RegraRecorrencia, 'frequencia' | 'intervalo'>): Preset | null {
  return PRESETS.find(p => p.frequencia === regra.frequencia && p.intervalo === regra.intervalo) ?? null;
}

const UNIDADE: Record<Frequencia, [string, string]> = {
  DIA: ['dia', 'dias'],
  SEMANA: ['semana', 'semanas'],
  MES: ['mês', 'meses'],
  ANO: ['ano', 'anos'],
};

/** Periodicidade em minúsculas para o fim da descrição: "mensal", "a cada 3 dias". */
export function rotuloDaPeriodicidade(regra: Pick<RegraRecorrencia, 'frequencia' | 'intervalo'>): string {
  const p = presetDaRegra(regra);
  if (p) return p.rotulo.toLowerCase();
  if (regra.frequencia === 'DIA' && regra.intervalo === 1) return 'diária';
  return `a cada ${regra.intervalo} ${UNIDADE[regra.frequencia][1]}`;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function ehDataValida(iso: unknown): iso is string {
  if (typeof iso !== 'string' || !DATA_RE.test(iso)) return false;
  const d = dataLocal(iso);
  return Boolean(d) && `${d!.getFullYear()}-${String(d!.getMonth() + 1).padStart(2, '0')}-${String(d!.getDate()).padStart(2, '0')}` === iso;
}

/**
 * Lê uma regra vinda de fora (corpo da requisição, JSONB) e devolve a regra
 * limpa ou a mensagem do que está errado, em português de tela.
 */
export function lerRegra(bruta: unknown, modo: ModoSerie = 'recorrente'): { regra: RegraRecorrencia } | { erro: string } {
  if (!bruta || typeof bruta !== 'object') return { erro: 'Informe como a conta se repete.' };
  const r = bruta as Record<string, unknown>;
  const frequencia = r.frequencia as Frequencia;
  if (!['DIA', 'SEMANA', 'MES', 'ANO'].includes(frequencia)) return { erro: 'Escolha uma periodicidade da lista.' };
  const intervalo = Math.floor(Number(r.intervalo ?? 1));
  if (!Number.isFinite(intervalo) || intervalo < 1 || intervalo > 366) return { erro: 'O intervalo precisa ser de 1 a 366.' };
  const feriado = (r.feriado ?? 'manter') as TratamentoFeriado;
  if (!['antecipar', 'postergar', 'manter'].includes(feriado)) return { erro: 'Escolha o que fazer em fim de semana ou feriado.' };

  const regra: RegraRecorrencia = { frequencia, intervalo, feriado, fim: { tipo: 'nunca' } };

  if (r.dia_do_mes !== undefined && r.dia_do_mes !== null && r.dia_do_mes !== '') {
    const d = Math.floor(Number(r.dia_do_mes));
    if (!Number.isFinite(d) || d < 1 || d > 31) return { erro: 'O dia do vencimento precisa ser de 1 a 31.' };
    if (frequencia !== 'MES' && frequencia !== 'ANO') return { erro: 'Dia fixo do mês só vale para repetição por mês ou ano.' };
    regra.dia_do_mes = d;
  }
  if (r.ultimo_dia_util === true) {
    if (frequencia !== 'MES') return { erro: 'Último dia útil só vale para repetição por mês.' };
    regra.ultimo_dia_util = true;
    delete regra.dia_do_mes;
  }
  if (r.dia_semana !== undefined && r.dia_semana !== null && r.dia_semana !== '') {
    const s = Math.floor(Number(r.dia_semana));
    if (!Number.isFinite(s) || s < 0 || s > 6) return { erro: 'Dia da semana inválido.' };
    if (frequencia !== 'SEMANA') return { erro: 'Dia da semana só vale para repetição por semana.' };
    regra.dia_semana = s;
  }

  const fimBruto = (r.fim ?? {}) as Record<string, unknown>;
  const tipo = fimBruto.tipo as FimDaRegra['tipo'];
  if (tipo === 'ocorrencias') {
    const n = Math.floor(Number(fimBruto.ocorrencias));
    if (!Number.isFinite(n) || n < 1) return { erro: 'Informe a quantidade.' };
    const max = modo === 'parcelado' ? MAX_PARCELAS : LIMITE_DE_OCORRENCIAS;
    if (n > max) return { erro: `A quantidade máxima é ${max}.` };
    regra.fim = { tipo, ocorrencias: n };
  } else if (tipo === 'data') {
    if (!ehDataValida(fimBruto.data)) return { erro: 'Informe a data em que a repetição termina.' };
    regra.fim = { tipo, data: fimBruto.data };
  } else if (tipo === 'nunca') {
    regra.fim = { tipo };
  } else {
    return { erro: 'Diga quando a repetição termina.' };
  }
  if (modo === 'parcelado' && regra.fim.tipo !== 'ocorrencias') {
    return { erro: 'No parcelado, informe em quantas parcelas o valor é dividido.' };
  }

  if (r.reajuste && typeof r.reajuste === 'object') {
    const rj = r.reajuste as Record<string, unknown>;
    const pct = Number(rj.percentual);
    const mes = Math.floor(Number(rj.mes));
    if (pct !== 0) {
      if (modo === 'parcelado') return { erro: 'Reajuste só vale para conta recorrente.' };
      if (!Number.isFinite(pct) || pct <= -100 || pct > 1000) return { erro: 'Percentual de reajuste inválido.' };
      if (!Number.isFinite(mes) || mes < 1 || mes > 12) return { erro: 'Escolha o mês do reajuste.' };
      regra.reajuste = { tipo: 'fixo', percentual: pct, mes };
      const origem = lerOrigemDoReajuste(rj.origem);
      if (origem) regra.reajuste.origem = origem;
    }
  }
  return { regra };
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

function anoMes(iso: string): [number, number] {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
}

/** Soma meses a um par (ano, mês 1..12). */
function avancarMes(ano: number, mes: number, n: number): [number, number] {
  const idx = ano * 12 + (mes - 1) + n;
  return [Math.floor(idx / 12), (idx % 12) + 1];
}

/** Data pela regra do candidato n (0, 1, 2…), sem ajuste de feriado. */
function nominalDoIndice(regra: RegraRecorrencia, inicio: string, n: number, cal: Calendario): string {
  const iv = regra.intervalo;
  switch (regra.frequencia) {
    case 'DIA':
      return addDias(inicio, n * iv);
    case 'SEMANA': {
      let base = inicio;
      if (regra.dia_semana !== undefined) {
        const delta = (regra.dia_semana - diaDaSemana(inicio) + 7) % 7;
        base = addDias(inicio, delta);
      }
      return addDias(base, 7 * iv * n);
    }
    case 'MES': {
      const [a, m] = anoMes(inicio);
      const [ano, mes] = avancarMes(a, m, n * iv);
      if (regra.ultimo_dia_util) return ultimoDiaUtilDoMes(ano, mes, cal);
      if (regra.dia_do_mes) return dataSegura(ano, mes, regra.dia_do_mes);
      // Mesmo dia do primeiro vencimento, com o mês curto usando o último dia
      // (31/01 → 28/02 → 31/03): é o que a despesa fixa sempre fez.
      return addMeses(inicio, n * iv);
    }
    case 'ANO': {
      if (regra.dia_do_mes) {
        const [a, m] = anoMes(inicio);
        return dataSegura(a + n * iv, m, regra.dia_do_mes);
      }
      return addMeses(inicio, 12 * iv * n);
    }
  }
}

/** Ajusta o vencimento conforme a regra de fim de semana e feriado. */
export function ajustarVencimento(nominal: string, tratamento: TratamentoFeriado, cal: Calendario = CALENDARIO_NACIONAL): string {
  if (tratamento === 'manter' || ehDiaUtil(nominal, cal)) return nominal;
  return tratamento === 'antecipar' ? diaUtilAnterior(nominal, cal) : proximoDiaUtil(nominal, cal);
}

/**
 * Ocorrências da regra a partir de `inicio`, com data nominal até `ate`
 * (inclusive) e respeitando o fim da regra. A primeira é o próprio início
 * (ou o primeiro dia da regra a partir dele, com dia fixo/dia da semana).
 */
export function proximasDatas(
  regra: RegraRecorrencia,
  inicio: string,
  ate: string,
  cal: Calendario = CALENDARIO_NACIONAL,
): Ocorrencia[] {
  const out: Ocorrencia[] = [];
  if (!ehDataValida(inicio)) return out;
  const maxOcorr = regra.fim.tipo === 'ocorrencias' ? Math.min(regra.fim.ocorrencias ?? 0, LIMITE_DE_OCORRENCIAS) : LIMITE_DE_OCORRENCIAS;
  const fimData = regra.fim.tipo === 'data' ? regra.fim.data ?? '' : '';
  let ordem = 0;
  for (let n = 0; n < LIMITE_DE_OCORRENCIAS * 2 && ordem < maxOcorr; n++) {
    const nominal = nominalDoIndice(regra, inicio, n, cal);
    if (nominal < inicio) continue;
    if (fimData && nominal > fimData) break;
    if (nominal > ate) break;
    ordem++;
    const vencimento = regra.ultimo_dia_util ? nominal : ajustarVencimento(nominal, regra.feriado, cal);
    out.push({ ordem, nominal, vencimento });
  }
  return out;
}

/** Quantas vezes a regra acontece no total, ou null quando é "até cancelar". */
export function totalDeOcorrencias(regra: RegraRecorrencia, inicio: string, cal: Calendario = CALENDARIO_NACIONAL): number | null {
  if (regra.fim.tipo === 'nunca') return null;
  if (regra.fim.tipo === 'ocorrencias') return Math.min(regra.fim.ocorrencias ?? 0, LIMITE_DE_OCORRENCIAS);
  return proximasDatas(regra, inicio, regra.fim.data ?? inicio, cal).length;
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------

/** Divide um total em N parcelas inteiras de centavos; o resto vai na última. */
export function parcelarValor(totalCentavos: number, n: number): number[] {
  const total = Math.round(totalCentavos);
  const qtd = Math.max(1, Math.floor(n) || 1);
  const base = Math.trunc(total / qtd);
  const out = Array.from({ length: qtd }, () => base);
  out[qtd - 1] = total - base * (qtd - 1);
  return out;
}

/** Quantos reajustes anuais já valeram até a data (o mês do reajuste depois do início). */
export function reajustesAte(regra: RegraRecorrencia, inicio: string, data: string): number {
  if (!regra.reajuste) return 0;
  const mm = String(regra.reajuste.mes).padStart(2, '0');
  let k = 0;
  for (let ano = Number(inicio.slice(0, 4)); ano <= Number(data.slice(0, 4)); ano++) {
    const marco = `${ano}-${mm}-01`;
    if (marco > inicio && marco <= data) k++;
  }
  return k;
}

/** Valor de uma ocorrência recorrente com o reajuste aplicado (arredonda a cada ano, como contrato). */
export function valorReajustado(baseCentavos: number, regra: RegraRecorrencia, inicio: string, nominal: string): number {
  let v = Math.round(baseCentavos);
  const k = reajustesAte(regra, inicio, nominal);
  for (let i = 0; i < k; i++) v = Math.round(v * (1 + (regra.reajuste!.percentual / 100)));
  return v;
}

/**
 * Datas e valores da série: no parcelado, `valorCentavos` é o TOTAL e é
 * dividido; no recorrente é o valor de cada ocorrência (com reajuste).
 */
export function ocorrenciasComValor(params: {
  modo: ModoSerie;
  regra: RegraRecorrencia;
  inicio: string;
  valorCentavos: number;
  ate: string;
  cal?: Calendario;
}): OcorrenciaComValor[] {
  const cal = params.cal ?? CALENDARIO_NACIONAL;
  const datas = proximasDatas(params.regra, params.inicio, params.ate, cal);
  const parcelas = params.modo === 'parcelado'
    ? parcelarValor(params.valorCentavos, params.regra.fim.ocorrencias ?? datas.length)
    : null;
  return datas.map(o => ({
    ...o,
    valor_centavos: parcelas
      ? parcelas[o.ordem - 1] ?? 0
      : valorReajustado(params.valorCentavos, params.regra, params.inicio, o.nominal),
    aviso: ehDiaUtil(o.vencimento, cal) ? null : motivoDeNaoSerUtil(o.vencimento, cal),
  }));
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

const DIAS_DA_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function nomeDoDiaDaSemana(s: number): string {
  return DIAS_DA_SEMANA[s] ?? '';
}
export function nomeDoMes(m: number): string {
  return MESES[m - 1] ?? '';
}

function dataBR(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function pct(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/**
 * A regra em português, para a tela: "Todo dia 10, a cada 2 meses, até 12/2027".
 * `inicio` completa o dia quando a regra usa o dia do primeiro vencimento.
 */
export function descreverRegra(regra: RegraRecorrencia, inicio?: string): string {
  const partes: string[] = [];
  const iv = regra.intervalo;
  const cada = (u: Frequencia) => (iv === 1 ? '' : `a cada ${iv} ${UNIDADE[u][1]}`);
  const diaInicio = inicio && ehDataValida(inicio) ? Number(inicio.slice(8, 10)) : null;

  switch (regra.frequencia) {
    case 'DIA':
      partes.push(iv === 1 ? 'Todo dia' : `A cada ${iv} dias`);
      break;
    case 'SEMANA': {
      const s = regra.dia_semana ?? (inicio && ehDataValida(inicio) ? diaDaSemana(inicio) : undefined);
      const nome = s !== undefined ? nomeDoDiaDaSemana(s) : '';
      const toda = s === 0 || s === 6 ? 'Todo' : 'Toda';
      if (iv === 1) partes.push(nome ? `${toda} ${nome}` : 'Toda semana');
      else partes.push(nome ? `A cada ${iv} semanas, na ${nome}` : `A cada ${iv} semanas`);
      break;
    }
    case 'MES': {
      if (regra.ultimo_dia_util) partes.push('No último dia útil do mês');
      else {
        const d = regra.dia_do_mes ?? diaInicio;
        partes.push(d ? `Todo dia ${d}` : 'Todo mês');
      }
      if (iv > 1) partes.push(cada('MES'));
      break;
    }
    case 'ANO': {
      const d = regra.dia_do_mes ?? diaInicio;
      const m = inicio && ehDataValida(inicio) ? Number(inicio.slice(5, 7)) : null;
      const quando = d && m ? ` em ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}` : '';
      partes.push(iv === 1 ? `Todo ano${quando}` : `A cada ${iv} anos${quando}`);
      break;
    }
  }

  if (regra.feriado === 'antecipar') partes.push('antecipando quando cair em fim de semana ou feriado');
  if (regra.feriado === 'postergar') partes.push('adiando quando cair em fim de semana ou feriado');

  if (regra.fim.tipo === 'ocorrencias') {
    const n = regra.fim.ocorrencias ?? 0;
    partes.push(n === 1 ? '1 vez' : `${n} vezes`);
  } else if (regra.fim.tipo === 'data' && regra.fim.data) {
    partes.push(`até ${regra.fim.data.slice(5, 7)}/${regra.fim.data.slice(0, 4)}`);
  } else {
    partes.push('até cancelar');
  }

  if (regra.reajuste) {
    const o = regra.reajuste.origem;
    const deOnde = o ? ` (${NOME_DO_INDICE[o.indice]} de 12 meses até ${o.ate.slice(5, 7)}/${o.ate.slice(0, 4)})` : '';
    partes.push(`com reajuste de ${pct(regra.reajuste.percentual)}${deOnde} todo mês de ${nomeDoMes(regra.reajuste.mes)}`);
  }
  return partes.filter(Boolean).join(', ');
}

/**
 * Sufixo da descrição de cada título. Mantém o formato que a despesa fixa
 * sempre gravou, "(3/12 — mensal)"; parcelado vira "(parcela 3/12)"; a
 * série sem fim não ganha sufixo (a ordem fica em serie_ordem).
 */
export function sufixoDaDescricao(modo: ModoSerie, regra: RegraRecorrencia, ordem: number, total: number | null): string {
  if (modo === 'parcelado') return ` (parcela ${ordem}/${total ?? ordem})`;
  if (total === null || total <= 1) return '';
  return ` (${ordem}/${total} — ${rotuloDaPeriodicidade(regra)})`;
}

const SUFIXO_RE = /\s\((?:parcela\s)?\d+\/\d+(?:\s—\s[^()]*)?\)$/;

/** Descrição sem o sufixo da série: "Aluguel (3/12 — mensal)" → "Aluguel". */
export function separarSufixo(descricao: string): string {
  return String(descricao ?? '').replace(SUFIXO_RE, '');
}

/** "10/12/2026" a partir de 'AAAA-MM-DD'. */
export function formatarData(iso: string): string {
  return ehDataValida(iso) ? dataBR(iso) : iso;
}

// ---------------------------------------------------------------------------
// Títulos: o que pode ser mexido pela série e o que fica de fora
// ---------------------------------------------------------------------------

export type TabelaAlvo = 'contas_pagar' | 'contas_receber';

const ABERTOS = new Set(['PENDENTE', 'VENCIDO', 'ATRASADO', '']);

function numero(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * O título ainda está em aberto e sem nenhuma baixa? Só esses a série pode
 * alterar ou excluir. Título pago, recebido ou com baixa parcial nunca é tocado.
 */
export function tituloSemBaixa(tabela: TabelaAlvo, data: Record<string, unknown>): boolean {
  const status = String(data.status ?? '');
  if (!ABERTOS.has(status)) return false;
  const pago = tabela === 'contas_pagar' ? data.valor_pago : data.valor_recebido;
  const dataBaixa = tabela === 'contas_pagar' ? data.data_pagamento : data.data_recebimento;
  return numero(pago) === 0 && !dataBaixa;
}

/**
 * Título que nasceu de venda, grupo, comissão, plataforma ou fatura de
 * cartão: esses são refeitos pela origem e não ganham mais parcelas
 * nem entram na cópia de mês.
 */
export function tituloGeradoPeloSistema(tabela: TabelaAlvo, data: Record<string, unknown>): boolean {
  if (data.auto_gerado === true || data.auto_gerado === 'true') return true;
  if (data.origem_venda_id || data.origem_comissao_id || data.venda_id || data.grupo_id) return true;
  // compra_id = parcela de compra no cartão (vem da fatura do cartão).
  if (data.plataforma_origem || data.compra_id || data.fatura_id) return true;
  if (tabela === 'contas_pagar' && (data.origem === 'VENDA' || data.origem === 'GRUPO')) return true;
  return false;
}

/**
 * Entra na cópia de mês? Mesmo critério de sempre da tela de contas a pagar
 * (manual, recorrente, não cancelada), e de fora também o que já faz parte
 * de uma repetição: a série cria o mês seguinte sozinha.
 */
export function podeCopiarConta(tabela: TabelaAlvo, data: Record<string, unknown>): boolean {
  if (data.status === 'CANCELADO') return false;
  if (data.serie_id) return false;
  if (data.auto_gerado === true || data.auto_gerado === 'true') return false;
  if (tabela === 'contas_pagar') {
    // Exatamente o critério que a tela sempre usou.
    if (data.natureza_custo === 'COMPRA_UNICA') return false;
    if (data.origem === 'VENDA' || data.origem === 'GRUPO') return false;
    return true;
  }
  return !(data.origem_venda_id || data.venda_id || data.plataforma_origem);
}

/** Chave que impede copiar o mesmo título para o mesmo mês duas vezes. */
export function chaveDaCopia(mesDestino: string, tituloId: string): string {
  return `copia:${mesDestino}:${tituloId}`;
}

/** "Jan/2026" a partir de 'AAAA-MM' — o rótulo que a cópia sempre gravou. */
export function rotuloDoMes(ym: string): string {
  const [y, m] = ym.split('-');
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${meses[parseInt(m, 10) - 1]}/${y}`;
}

// ---------------------------------------------------------------------------
// Estado do formulário → regra (o bloco "Repetir" das telas)
// ---------------------------------------------------------------------------

export type DiaDoVencimento = 'mesmo' | 'fixo' | 'ultimo_util';

export interface EstadoRepeticao {
  ativa: boolean;
  modo: ModoSerie;
  /** Quantidade (parcelas ou vezes), quando o fim é "após N vezes". */
  quantidade: number;
  periodicidade: ChavePreset;
  /** "Mais opções" */
  personalizar: boolean;
  frequencia: Frequencia;
  intervalo: number;
  dia: DiaDoVencimento;
  dia_do_mes: number;
  feriado: TratamentoFeriado;
  termina: FimDaRegra['tipo'];
  termina_em: string;
  reajuste_percentual: number;
  reajuste_mes: number;
  /** Origem do percentual quando veio da sugestão do índice (some se a pessoa digitar outro). */
  reajuste_origem?: OrigemDoReajuste | null;
}

export const REPETICAO_PADRAO: EstadoRepeticao = {
  ativa: false,
  modo: 'recorrente',
  quantidade: 12,
  periodicidade: 'MENSAL',
  personalizar: false,
  frequencia: 'MES',
  intervalo: 1,
  dia: 'mesmo',
  dia_do_mes: 10,
  feriado: 'manter',
  termina: 'ocorrencias',
  termina_em: '',
  reajuste_percentual: 0,
  reajuste_mes: 1,
};

/** Converte o bloco "Repetir" numa regra (sem validar: use lerRegra depois). */
export function regraDoEstado(e: EstadoRepeticao): RegraRecorrencia {
  const p = presetPorChave(e.periodicidade) ?? PRESETS[2];
  const frequencia = e.personalizar ? e.frequencia : p.frequencia;
  const intervalo = e.personalizar ? Math.max(1, Math.floor(e.intervalo) || 1) : p.intervalo;
  const termina = e.modo === 'parcelado' ? 'ocorrencias' : e.personalizar ? e.termina : 'ocorrencias';
  const fim: FimDaRegra = termina === 'ocorrencias'
    ? { tipo: 'ocorrencias', ocorrencias: Math.max(1, Math.floor(e.quantidade) || 1) }
    : termina === 'data'
      ? { tipo: 'data', data: e.termina_em }
      : { tipo: 'nunca' };
  const regra: RegraRecorrencia = { frequencia, intervalo, feriado: e.personalizar ? e.feriado : 'manter', fim };
  if (e.personalizar && (frequencia === 'MES' || frequencia === 'ANO')) {
    if (e.dia === 'fixo') regra.dia_do_mes = Math.min(31, Math.max(1, Math.floor(e.dia_do_mes) || 1));
    if (e.dia === 'ultimo_util' && frequencia === 'MES') regra.ultimo_dia_util = true;
  }
  if (e.personalizar && e.modo === 'recorrente' && e.reajuste_percentual) {
    regra.reajuste = { tipo: 'fixo', percentual: e.reajuste_percentual, mes: e.reajuste_mes };
    if (e.reajuste_origem) regra.reajuste.origem = e.reajuste_origem;
  }
  return regra;
}

export interface PreviaDoFormulario {
  regra: RegraRecorrencia;
  descricao: string;
  /** Total da série, ou null quando é "até cancelar". */
  total: number | null;
  /** O que nasce ao salvar (a série inteira, se for curta; senão até o horizonte). */
  ocorrencias: OcorrenciaComValor[];
  somaCentavos: number | null;
  /** As próximas nascem sozinhas, pela tarefa diária. */
  sozinhas: boolean;
}

/**
 * Prévia do bloco "Repetir", igual à do servidor (previaDaSerie): mesmas
 * datas, mesmos valores, mesmo corte entre "nasce agora" e "nasce sozinha".
 */
export function previaDoFormulario(
  e: EstadoRepeticao,
  inicio: string,
  valorCentavos: number,
  hoje: string,
  horizonteMeses = 3,
): PreviaDoFormulario | { erro: string } {
  if (!ehDataValida(inicio)) return { erro: 'Informe o primeiro vencimento para ver as datas.' };
  const lida = lerRegra(regraDoEstado(e), e.modo);
  if ('erro' in lida) return lida;
  const regra = lida.regra;
  if (regra.fim.tipo === 'data' && (regra.fim.data ?? '') < inicio) {
    return { erro: 'A data final precisa ser depois do primeiro vencimento.' };
  }
  const total = totalDeOcorrencias(regra, inicio);
  if (total === 0) return { erro: 'Com essa regra nenhuma data cai até o fim escolhido.' };
  const curta = total !== null && total <= LIMITE_GERACAO_IMEDIATA;
  const ate = curta ? '9999-12-31' : addMeses(hoje > inicio ? hoje : inicio, horizonteMeses);
  const ocorrencias = ocorrenciasComValor({ modo: e.modo, regra, inicio, valorCentavos, ate });
  return {
    regra,
    descricao: descreverRegra(regra, inicio),
    total,
    ocorrencias,
    somaCentavos: curta ? ocorrencias.reduce((a, o) => a + o.valor_centavos, 0) : null,
    sozinhas: !curta,
  };
}
