/**
 * Regras de faturamento e a conta da fatura do cliente (E5, parte B,
 * 05/11/2026). Puro: sem banco, sem relógio (quem chama passa `hoje`).
 *
 * A fatura corporativa junta, por pagante, os itens a faturar (contas da
 * forma "Faturar" da venda) numa janela de tempo dada pela Regra de
 * faturamento da pessoa:
 *
 *   referência do item = data da venda, do início ou do fim da viagem;
 *   janela = o período (dia, semana, decêndio, quinzena, mês, faixa do
 *            período customizado ou o próprio item, no avulso) que contém a
 *            referência;
 *   vencimento = fim da janela ± prazo em dias (no período customizado, o
 *            dia de vencimento da faixa), passado pelo ajuste de dia não
 *            útil (sábado, domingo e feriado nacional, com a escolha da
 *            regra: dia útil anterior, próximo dia útil ou não mexer).
 *
 * Todo item com a mesma regra, a mesma janela e o mesmo vencimento cai na
 * mesma fatura (a `chave`). Datas são strings civis 'AAAA-MM-DD'.
 * Dinheiro em centavos inteiros.
 */
import { addDias, dataLocal, ultimoDiaDoMes } from './money';
import {
  CALENDARIO_NACIONAL, diaDaSemana, diaUtilAnterior, ehDiaUtil, motivoDeNaoSerUtil, proximoDiaUtil,
  type Calendario,
} from './feriados';

export type Centavos = number;

// ============================================================
// Tipos e rótulos
// ============================================================

export const TIPOS_DE_PESSOA = ['CLIENTE', 'FORNECEDOR', 'REPRESENTANTE'] as const;
export type TipoDePessoaDaRegra = (typeof TIPOS_DE_PESSOA)[number];
export const ROTULO_TIPO_DE_PESSOA: Record<TipoDePessoaDaRegra, string> = {
  CLIENTE: 'Cliente', FORNECEDOR: 'Fornecedor', REPRESENTANTE: 'Representante',
};

export const PERIODOS = ['DIARIO', 'SEMANAL', 'SEMANAL_IATA', 'SEMANAL_MES', 'DECENDIAL', 'QUINZENAL', 'MENSAL', 'AVULSO', 'CUSTOMIZADO'] as const;
export type PeriodoDaRegra = (typeof PERIODOS)[number];

export const INFO_DO_PERIODO: Record<PeriodoDaRegra, { rotulo: string; ajuda: string }> = {
  DIARIO: { rotulo: 'Diário', ajuda: 'Uma fatura por dia.' },
  SEMANAL: { rotulo: 'Semanal', ajuda: 'Uma fatura por semana, começando no dia escolhido.' },
  SEMANAL_IATA: { rotulo: 'Semanal IATA', ajuda: 'Semana de segunda a domingo, como o calendário semanal da IATA.' },
  SEMANAL_MES: { rotulo: 'Semanal respeitando o mês', ajuda: 'Semana do dia escolhido; quando o mês vira no meio da semana, os dias do mês novo vão para outra fatura.' },
  DECENDIAL: { rotulo: 'Decendial', ajuda: 'Três faturas por mês: dias 1 a 10, 11 a 20 e 21 ao fim do mês.' },
  QUINZENAL: { rotulo: 'Quinzenal', ajuda: 'Duas faturas por mês: dias 1 a 15 e 16 ao fim do mês.' },
  MENSAL: { rotulo: 'Mensal', ajuda: 'Uma fatura por mês.' },
  AVULSO: { rotulo: 'Avulso', ajuda: 'Cada item vira a sua própria fatura.' },
  CUSTOMIZADO: { rotulo: 'Período customizado', ajuda: 'Faixas de dias do mês, cada uma com o seu dia de vencimento.' },
};

export const BASES_DE_DATA = ['VENDA', 'INICIO', 'FIM'] as const;
export type BaseDeData = (typeof BASES_DE_DATA)[number];
export const ROTULO_BASE_DE_DATA: Record<BaseDeData, string> = {
  VENDA: 'data da venda', INICIO: 'data de início da viagem', FIM: 'data de fim da viagem',
};

export const SENTIDOS = ['DEPOIS', 'ANTES'] as const;
export type SentidoDoPrazo = (typeof SENTIDOS)[number];

export const AJUSTES_DE_DIA = ['PROXIMO', 'ANTERIOR', 'NAO_ALTERAR'] as const;
export type AjusteDeDiaNaoUtil = (typeof AJUSTES_DE_DIA)[number];
export const ROTULO_AJUSTE_DE_DIA: Record<AjusteDeDiaNaoUtil, string> = {
  PROXIMO: 'Passar para o próximo dia útil',
  ANTERIOR: 'Antecipar para o dia útil anterior',
  NAO_ALTERAR: 'Manter a data',
};

export const DIAS_DA_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const;

export const MODELOS_DE_FATURA = ['PADRAO', 'PERSONALIZADA', 'SIMPLIFICADA'] as const;
export type ModeloDeFatura = (typeof MODELOS_DE_FATURA)[number];
export const INFO_DO_MODELO: Record<ModeloDeFatura, { rotulo: string; ajuda: string }> = {
  PADRAO: { rotulo: 'Padrão', ajuda: 'Cada produto com passageiros, datas, localizador e centro de custo, as retenções e o total líquido.' },
  PERSONALIZADA: { rotulo: 'Personalizada', ajuda: 'Só as colunas que você escolher.' },
  SIMPLIFICADA: { rotulo: 'Simplificada', ajuda: 'Só a descrição e os passageiros de cada item.' },
};

/** Colunas que a fatura Personalizada pode mostrar. */
export const CAMPOS_DA_FATURA = [
  { id: 'venda', rotulo: 'Venda' },
  { id: 'data_venda', rotulo: 'Data da venda' },
  { id: 'produto', rotulo: 'Produto' },
  { id: 'fornecedor', rotulo: 'Fornecedor' },
  { id: 'passageiros', rotulo: 'Passageiros' },
  { id: 'localizador', rotulo: 'Localizador' },
  { id: 'viagem', rotulo: 'Período da viagem' },
  { id: 'centro_custo', rotulo: 'Centro de custo' },
  { id: 'solicitante', rotulo: 'Solicitante' },
  { id: 'valor', rotulo: 'Valor' },
] as const;
export type CampoDaFatura = (typeof CAMPOS_DA_FATURA)[number]['id'];
export const CAMPOS_PADRAO_PERSONALIZADA: CampoDaFatura[] = ['venda', 'produto', 'passageiros', 'centro_custo', 'valor'];

/** Faixa do período customizado: dias `de` a `ate` vencem no `vence_dia` do mês (0 = mesmo mês, 1 = mês seguinte). */
export interface FaixaCustomizada {
  de: number;
  ate: number;
  vence_dia: number;
  vence_mes: 0 | 1;
}

/** Retenções na fonte, em % (0 = não retém). `base`: o total da fatura ou só as taxas de serviço (Taxa DU, RAV, Fee). */
export interface ConfigRetencoes {
  ir: number;
  csll: number;
  pis: number;
  cofins: number;
  iss: number;
  base: 'TOTAL' | 'TAXAS';
}
export const RETENCOES_ZERADAS: ConfigRetencoes = { ir: 0, csll: 0, pis: 0, cofins: 0, iss: 0, base: 'TOTAL' };
export const NOMES_DAS_RETENCOES: Record<Exclude<keyof ConfigRetencoes, 'base'>, string> = {
  ir: 'IR', csll: 'CSLL', pis: 'PIS', cofins: 'COFINS', iss: 'ISS',
};

export interface RegraDeFaturamento {
  id: string;
  pessoa_tipo: TipoDePessoaDaRegra;
  pessoa_id: string;
  pessoa_nome: string;
  /** Vazio = vale para todo produto. */
  produto_tipo: string;
  /** Vazio = vale para todo fornecedor. */
  fornecedor_id: string;
  fornecedor_nome: string;
  periodo: PeriodoDaRegra;
  /** 0 = domingo … 6 = sábado. */
  inicio_semana: number;
  faturar_por: BaseDeData;
  sentido: SentidoDoPrazo;
  prazo_dias: number;
  dia_nao_util: AjusteDeDiaNaoUtil;
  considerar_feriados: boolean;
  faixas: FaixaCustomizada[];
  /** Vai para a descrição das faturas desta regra (até 60 letras). */
  descricao: string;
  solicitante: string;
  centro_custo: string;
  modelo: ModeloDeFatura;
  campos: CampoDaFatura[];
  retencoes: ConfigRetencoes;
  ativa: boolean;
}

export interface ErroDaRegra { campo: string; mensagem: string }

// ============================================================
// Normalização e validação
// ============================================================

const txt = (v: unknown, max = 200) => (v === null || v === undefined ? '' : String(v)).trim().slice(0, max);
const inteiro = (v: unknown, padrao = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : padrao;
};
const escolha = <T extends string>(lista: readonly T[], v: unknown, padrao: T): T =>
  (lista as readonly string[]).includes(String(v)) ? (String(v) as T) : padrao;
const pct = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.round(n * 10000) / 10000) : 0;
};

export function normalizarRetencoes(v: unknown): ConfigRetencoes {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { ir: pct(o.ir), csll: pct(o.csll), pis: pct(o.pis), cofins: pct(o.cofins), iss: pct(o.iss), base: o.base === 'TAXAS' ? 'TAXAS' : 'TOTAL' };
}

export function normalizarFaixas(v: unknown): FaixaCustomizada[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 31).map(f => {
    const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    return { de: inteiro(o.de), ate: inteiro(o.ate), vence_dia: inteiro(o.vence_dia), vence_mes: inteiro(o.vence_mes) === 1 ? 1 : 0 } as FaixaCustomizada;
  }).sort((a, b) => a.de - b.de);
}

/** Lê a regra vinda da tela ou do banco e diz o que falta. Nunca lança. */
export function normalizarRegra(v: unknown): { regra: RegraDeFaturamento; erros: ErroDaRegra[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const periodo = escolha(PERIODOS, o.periodo, 'MENSAL');
  const camposBrutos = Array.isArray(o.campos) ? o.campos.map(String) : [];
  const campos = CAMPOS_DA_FATURA.map(c => c.id).filter(id => camposBrutos.includes(id)) as CampoDaFatura[];
  const regra: RegraDeFaturamento = {
    id: txt(o.id, 80),
    pessoa_tipo: escolha(TIPOS_DE_PESSOA, o.pessoa_tipo, 'CLIENTE'),
    pessoa_id: txt(o.pessoa_id, 120),
    pessoa_nome: txt(o.pessoa_nome),
    produto_tipo: txt(o.produto_tipo, 40).toUpperCase(),
    fornecedor_id: txt(o.fornecedor_id, 120),
    fornecedor_nome: txt(o.fornecedor_nome),
    periodo,
    inicio_semana: Math.min(6, Math.max(0, inteiro(o.inicio_semana, 1))),
    faturar_por: escolha(BASES_DE_DATA, o.faturar_por, 'VENDA'),
    sentido: escolha(SENTIDOS, o.sentido, 'DEPOIS'),
    prazo_dias: inteiro(o.prazo_dias),
    dia_nao_util: escolha(AJUSTES_DE_DIA, o.dia_nao_util, 'PROXIMO'),
    considerar_feriados: o.considerar_feriados !== false,
    faixas: normalizarFaixas(o.faixas),
    descricao: txt(o.descricao, 500),
    solicitante: txt(o.solicitante),
    centro_custo: txt(o.centro_custo),
    modelo: escolha(MODELOS_DE_FATURA, o.modelo, 'PADRAO'),
    campos: campos.length ? campos : [...CAMPOS_PADRAO_PERSONALIZADA],
    retencoes: normalizarRetencoes(o.retencoes),
    ativa: o.ativa !== false,
  };
  const erros: ErroDaRegra[] = [];
  if (!regra.pessoa_id) erros.push({ campo: 'pessoa_id', mensagem: `Escolha o ${ROTULO_TIPO_DE_PESSOA[regra.pessoa_tipo].toLowerCase()} desta regra.` });
  if (regra.prazo_dias < 0 || regra.prazo_dias > 365) erros.push({ campo: 'prazo_dias', mensagem: 'O prazo vai de 0 a 365 dias.' });
  if (regra.descricao.length > 60) erros.push({ campo: 'descricao', mensagem: 'A descrição da fatura cabe em 60 letras.' });
  if (regra.periodo === 'CUSTOMIZADO') erros.push(...validarFaixas(regra.faixas));
  return { regra, erros };
}

/** As faixas precisam cobrir o mês inteiro (1 a 31), em ordem, sem buraco nem sobreposição. */
export function validarFaixas(faixas: readonly FaixaCustomizada[]): ErroDaRegra[] {
  const erros: ErroDaRegra[] = [];
  if (!faixas.length) return [{ campo: 'faixas', mensagem: 'Monte ao menos uma faixa de dias (por exemplo, de 1 a 31).' }];
  let esperado = 1;
  faixas.forEach((f, i) => {
    const n = i + 1;
    if (f.de < 1 || f.de > 31 || f.ate < 1 || f.ate > 31) erros.push({ campo: `faixas.${i}`, mensagem: `Faixa ${n}: os dias vão de 1 a 31.` });
    else if (f.de > f.ate) erros.push({ campo: `faixas.${i}`, mensagem: `Faixa ${n}: o primeiro dia (${f.de}) vem depois do último (${f.ate}).` });
    else if (f.de !== esperado) {
      erros.push({ campo: `faixas.${i}`, mensagem: f.de < esperado
        ? `Faixa ${n}: o dia ${f.de} já está em outra faixa.`
        : `Os dias ${esperado} a ${f.de - 1} não estão em nenhuma faixa.` });
    }
    if (f.vence_dia < 1 || f.vence_dia > 31) erros.push({ campo: `faixas.${i}.vence_dia`, mensagem: `Faixa ${n}: o dia do vencimento vai de 1 a 31.` });
    esperado = Math.max(esperado, f.ate + 1);
  });
  if (esperado <= 31) erros.push({ campo: 'faixas', mensagem: `Os dias ${esperado} a 31 não estão em nenhuma faixa.` });
  return erros;
}

// ============================================================
// Janela, vencimento e chave
// ============================================================

const doisDigitos = (n: number) => String(n).padStart(2, '0');
function partes(iso: string): { ano: number; mes: number; dia: number } {
  return { ano: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)), dia: Number(iso.slice(8, 10)) };
}
const dataDe = (ano: number, mes: number, dia: number) => {
  // Normaliza mês 13 → janeiro do ano seguinte; dia além do fim do mês → último dia.
  const a = ano + Math.floor((mes - 1) / 12);
  const m = ((mes - 1) % 12 + 12) % 12 + 1;
  return `${a}-${doisDigitos(m)}-${doisDigitos(Math.min(dia, ultimoDiaDoMes(a, m)))}`;
};
const ehData = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && dataLocal(s) !== null;

export interface Janela { inicio: string; fim: string }

/** O período da regra que contém a data de referência. */
export function janelaDoPeriodo(regra: Pick<RegraDeFaturamento, 'periodo' | 'inicio_semana' | 'faixas'>, ref: string): Janela {
  const { ano, mes, dia } = partes(ref);
  const ultimo = ultimoDiaDoMes(ano, mes);
  const doMes = (de: number, ate: number): Janela => ({ inicio: dataDe(ano, mes, de), fim: dataDe(ano, mes, Math.min(ate, ultimo)) });
  switch (regra.periodo) {
    case 'DIARIO':
    case 'AVULSO':
      return { inicio: ref, fim: ref };
    case 'SEMANAL':
    case 'SEMANAL_IATA':
    case 'SEMANAL_MES': {
      const comeco = regra.periodo === 'SEMANAL_IATA' ? 1 : regra.inicio_semana;
      const recuo = (diaDaSemana(ref) - comeco + 7) % 7;
      const inicio = addDias(ref, -recuo);
      const fim = addDias(inicio, 6);
      if (regra.periodo !== 'SEMANAL_MES') return { inicio, fim };
      const primeiro = dataDe(ano, mes, 1);
      const derradeiro = dataDe(ano, mes, ultimo);
      return { inicio: inicio < primeiro ? primeiro : inicio, fim: fim > derradeiro ? derradeiro : fim };
    }
    case 'DECENDIAL':
      return dia <= 10 ? doMes(1, 10) : dia <= 20 ? doMes(11, 20) : doMes(21, 31);
    case 'QUINZENAL':
      return dia <= 15 ? doMes(1, 15) : doMes(16, 31);
    case 'MENSAL':
      return doMes(1, 31);
    case 'CUSTOMIZADO': {
      const f = faixaDoDia(regra.faixas, dia);
      return f ? doMes(f.de, f.ate) : doMes(1, 31);
    }
  }
}

function faixaDoDia(faixas: readonly FaixaCustomizada[], dia: number): FaixaCustomizada | null {
  return faixas.find(f => dia >= f.de && dia <= f.ate) ?? null;
}

export interface VencimentoCalculado {
  /** Já ajustado para dia útil (quando a regra pede). */
  vencimento: string;
  /** Antes do ajuste de dia não útil. */
  sem_ajuste: string;
  /** "Caiu num sábado: foi para o próximo dia útil." — ou vazio. */
  ajuste: string;
}

/** Vencimento de uma janela pela regra, com o ajuste de sábado, domingo e feriado. */
export function vencimentoDaJanela(
  regra: Pick<RegraDeFaturamento, 'periodo' | 'faixas' | 'sentido' | 'prazo_dias' | 'dia_nao_util' | 'considerar_feriados'>,
  janela: Janela, cal: Calendario = CALENDARIO_NACIONAL,
): VencimentoCalculado {
  let bruto: string;
  if (regra.periodo === 'CUSTOMIZADO') {
    const { ano, mes, dia } = partes(janela.inicio);
    const f = faixaDoDia(regra.faixas, dia);
    bruto = f ? dataDe(ano, mes + f.vence_mes, f.vence_dia) : janela.fim;
  } else {
    const prazo = Math.max(0, regra.prazo_dias);
    bruto = addDias(janela.fim, regra.sentido === 'ANTES' ? -prazo : prazo);
  }
  return ajustarDiaUtil(bruto, regra.dia_nao_util, regra.considerar_feriados, cal);
}

const SEM_FERIADO: Calendario = { ehFeriado: () => false, nomeDoFeriado: () => null };

export function ajustarDiaUtil(data: string, ajuste: AjusteDeDiaNaoUtil, considerarFeriados: boolean, cal: Calendario = CALENDARIO_NACIONAL): VencimentoCalculado {
  const c = considerarFeriados ? cal : SEM_FERIADO;
  if (ajuste === 'NAO_ALTERAR' || ehDiaUtil(data, c)) return { vencimento: data, sem_ajuste: data, ajuste: '' };
  const motivo = motivoDeNaoSerUtil(data, c) ?? 'dia não útil';
  const novo = ajuste === 'ANTERIOR' ? diaUtilAnterior(data, c) : proximoDiaUtil(data, c);
  const verbo = ajuste === 'ANTERIOR' ? 'antecipado para o dia útil anterior' : 'passou para o próximo dia útil';
  const em = /^(sábado|domingo)$/.test(motivo) ? `num ${motivo}` : `em ${motivo}`;
  return { vencimento: novo, sem_ajuste: data, ajuste: `Caía ${em}: ${verbo}.` };
}

/** Datas do item que a regra pode usar. */
export interface DatasDoItem { venda: string; inicio?: string; fim?: string }

export interface PosicaoDoItem extends VencimentoCalculado {
  referencia: string;
  /** Qual data foi usada (se a da viagem faltar, vale a da venda). */
  base_usada: BaseDeData;
  inicio: string;
  fim: string;
  /** Itens com a mesma chave vão para a mesma fatura. */
  chave: string;
}

/** Onde o item cai: a referência, a janela, o vencimento e a chave da fatura. */
export function posicaoDoItem(regra: RegraDeFaturamento, datas: DatasDoItem, opcoes: { item_id?: string; cal?: Calendario } = {}): PosicaoDoItem {
  const pela = regra.faturar_por === 'INICIO' ? datas.inicio : regra.faturar_por === 'FIM' ? datas.fim : datas.venda;
  const usaPropria = !!pela && ehData(String(pela).slice(0, 10));
  const referencia = usaPropria ? String(pela).slice(0, 10) : String(datas.venda).slice(0, 10);
  const janela = janelaDoPeriodo(regra, referencia);
  const venc = vencimentoDaJanela(regra, janela, opcoes.cal);
  const chave = [regra.id || 'regra', janela.inicio, janela.fim, venc.vencimento, regra.periodo === 'AVULSO' ? (opcoes.item_id ?? '') : '']
    .filter((p, i) => i < 4 || p).join('|');
  return { ...venc, referencia, base_usada: usaPropria ? regra.faturar_por : 'VENDA', inicio: janela.inicio, fim: janela.fim, chave };
}

export interface PreviaDaFatura extends VencimentoCalculado { inicio: string; fim: string }

/**
 * As próximas `n` faturas que a regra monta a partir de hoje (prévia da
 * tela da regra). No avulso, mostra o exemplo de um item com referência hoje.
 */
export function proximasFaturas(regra: RegraDeFaturamento, hoje: string, n = 3, cal: Calendario = CALENDARIO_NACIONAL): PreviaDaFatura[] {
  const lista: PreviaDaFatura[] = [];
  let ref = hoje;
  for (let i = 0; i < n; i++) {
    const janela = janelaDoPeriodo(regra, ref);
    lista.push({ ...janela, ...vencimentoDaJanela(regra, janela, cal) });
    if (regra.periodo === 'AVULSO') break;
    ref = addDias(janela.fim, 1);
  }
  return lista;
}

/** A regra numa frase, para a lista e para o topo da prévia. */
export function descricaoDaRegra(regra: RegraDeFaturamento): string {
  const p = INFO_DO_PERIODO[regra.periodo].rotulo;
  const pela = ROTULO_BASE_DE_DATA[regra.faturar_por];
  let periodo: string;
  if (regra.periodo === 'SEMANAL' || regra.periodo === 'SEMANAL_MES') periodo = `${p}, começando na ${DIAS_DA_SEMANA[regra.inicio_semana]}`;
  else if (regra.periodo === 'AVULSO') periodo = 'Cada item na sua fatura';
  else periodo = p;
  let venc: string;
  if (regra.periodo === 'CUSTOMIZADO') {
    venc = regra.faixas.map(f => `dias ${f.de} a ${f.ate} vencem dia ${f.vence_dia}${f.vence_mes ? ' do mês seguinte' : ''}`).join('; ');
  } else {
    const fim = regra.periodo === 'AVULSO' ? `da ${pela}` : 'do fim do período';
    venc = regra.prazo_dias === 0 ? `vence no dia em que termina o período` : `vence ${regra.prazo_dias} ${regra.prazo_dias === 1 ? 'dia' : 'dias'} ${regra.sentido === 'ANTES' ? 'antes' : 'depois'} ${fim}`;
    if (regra.periodo === 'AVULSO' && regra.prazo_dias === 0) venc = `vence na ${pela}`;
  }
  const ajuste = regra.dia_nao_util === 'NAO_ALTERAR' ? '' : regra.dia_nao_util === 'ANTERIOR' ? '; fim de semana e feriado antecipam' : '; fim de semana e feriado adiam';
  const pelaData = regra.periodo === 'AVULSO' ? '' : ` pela ${pela}`;
  return `${periodo}${pelaData}; ${venc}${ajuste}.`;
}

// ============================================================
// Qual regra vale para o item
// ============================================================

export interface PerfilDoItem {
  pessoa_tipo: TipoDePessoaDaRegra;
  pessoa_id: string;
  produto_tipos: readonly string[];
  fornecedor_ids: readonly string[];
}

/**
 * A regra mais específica que serve: a que pede produto e fornecedor vence
 * a que pede só um deles, que vence a geral. Regra com filtro que o item não
 * tem não serve. Empate: a de id menor (estável).
 */
export function escolherRegra<R extends Pick<RegraDeFaturamento, 'id' | 'pessoa_tipo' | 'pessoa_id' | 'produto_tipo' | 'fornecedor_id' | 'ativa'>>(
  regras: readonly R[], item: PerfilDoItem,
): R | null {
  let melhor: R | null = null;
  let nota = -1;
  for (const r of regras) {
    if (!r.ativa || r.pessoa_tipo !== item.pessoa_tipo || r.pessoa_id !== item.pessoa_id) continue;
    if (r.produto_tipo && !item.produto_tipos.includes(r.produto_tipo)) continue;
    if (r.fornecedor_id && !item.fornecedor_ids.includes(r.fornecedor_id)) continue;
    const n = (r.produto_tipo ? 2 : 0) + (r.fornecedor_id ? 1 : 0);
    if (n > nota || (n === nota && melhor && r.id < melhor.id)) { melhor = r; nota = n; }
  }
  return melhor;
}

// ============================================================
// Totais da fatura e retenções
// ============================================================

export interface ItemParaTotal { valor_centavos: Centavos; taxas_servico_centavos?: Centavos }
export interface AjusteParaTotal { tipo: 'CREDITO' | 'DEBITO'; valor_centavos: Centavos }
export interface LinhaDeRetencao { id: keyof typeof NOMES_DAS_RETENCOES; nome: string; percentual: number; base_centavos: Centavos; valor_centavos: Centavos }

export interface TotaisDaFatura {
  itens: Centavos;
  creditos: Centavos;
  debitos: Centavos;
  /** itens + débitos − créditos. */
  bruto: Centavos;
  retencoes: LinhaDeRetencao[];
  total_retencoes: Centavos;
  /** O que o cliente paga: bruto − retenções. */
  liquido: Centavos;
  /** Créditos maiores que os itens: a fatura não pode ser fechada. */
  invalida: boolean;
}

export function calcularRetencoes(bruto: Centavos, taxas: Centavos, cfg: ConfigRetencoes): LinhaDeRetencao[] {
  const base = Math.max(0, cfg.base === 'TAXAS' ? taxas : bruto);
  const linhas: LinhaDeRetencao[] = [];
  for (const id of Object.keys(NOMES_DAS_RETENCOES) as Array<keyof typeof NOMES_DAS_RETENCOES>) {
    const p = cfg[id];
    if (!p) continue;
    linhas.push({ id, nome: NOMES_DAS_RETENCOES[id], percentual: p, base_centavos: base, valor_centavos: Math.round(base * p / 100) });
  }
  return linhas;
}

export function totaisDaFatura(itens: readonly ItemParaTotal[], ajustes: readonly AjusteParaTotal[], cfg: ConfigRetencoes = RETENCOES_ZERADAS): TotaisDaFatura {
  const soma = (l: readonly { valor_centavos: number }[]) => l.reduce((a, x) => a + Math.round(Number(x.valor_centavos) || 0), 0);
  const tItens = soma(itens);
  const creditos = soma(ajustes.filter(a => a.tipo === 'CREDITO'));
  const debitos = soma(ajustes.filter(a => a.tipo === 'DEBITO'));
  const bruto = tItens + debitos - creditos;
  const taxas = itens.reduce((a, i) => a + Math.round(Number(i.taxas_servico_centavos) || 0), 0);
  const retencoes = bruto > 0 ? calcularRetencoes(bruto, taxas, cfg) : [];
  const total_retencoes = retencoes.reduce((a, r) => a + r.valor_centavos, 0);
  return { itens: tItens, creditos, debitos, bruto, retencoes, total_retencoes, liquido: bruto - total_retencoes, invalida: bruto < 0 || (bruto - total_retencoes) < 0 };
}

// ============================================================
// Conferência por arquivo
// ============================================================

export interface ItemParaConferir {
  conta_id: string;
  valor_centavos: Centavos;
  /** Localizadores, número da venda, documento: o que o cliente costuma ter na planilha dele. */
  referencias: readonly string[];
}
export interface LinhaDoArquivo { referencia: string; valor_centavos?: Centavos | null }

export type ResultadoDaConferencia = 'CONFERIDO' | 'VALOR_DIFERENTE' | 'FALTA_NO_ARQUIVO';
export interface ConferenciaDoItem { conta_id: string; resultado: ResultadoDaConferencia; linha?: number; valor_arquivo_centavos?: Centavos | null }
export interface RelatorioDaConferencia {
  itens: ConferenciaDoItem[];
  /** Linhas do arquivo que não acharam item (índice começando em 1). */
  linhas_sem_item: Array<{ linha: number; referencia: string; valor_centavos?: Centavos | null }>;
  conferidos: number;
  divergentes: number;
}

export const normalizarReferencia = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Confere os itens contra as linhas da planilha do cliente: cada linha vale
 * para um item só (a primeira referência que casar), e o valor, quando a
 * linha traz, precisa ser o mesmo (ao centavo).
 */
export function conferirComArquivo(itens: readonly ItemParaConferir[], linhas: readonly LinhaDoArquivo[]): RelatorioDaConferencia {
  const usadas = new Set<number>();
  const porRef = new Map<string, number[]>();
  linhas.forEach((l, i) => {
    const k = normalizarReferencia(l.referencia);
    if (!k) return;
    if (!porRef.has(k)) porRef.set(k, []);
    porRef.get(k)!.push(i);
  });
  const resultado: ConferenciaDoItem[] = [];
  for (const it of itens) {
    let achou: number | undefined;
    for (const r of it.referencias) {
      const k = normalizarReferencia(r);
      if (!k) continue;
      achou = porRef.get(k)?.find(i => !usadas.has(i));
      if (achou !== undefined) break;
    }
    if (achou === undefined) { resultado.push({ conta_id: it.conta_id, resultado: 'FALTA_NO_ARQUIVO' }); continue; }
    usadas.add(achou);
    const v = linhas[achou].valor_centavos;
    const igual = v === null || v === undefined || Math.round(v) === Math.round(it.valor_centavos);
    resultado.push({ conta_id: it.conta_id, resultado: igual ? 'CONFERIDO' : 'VALOR_DIFERENTE', linha: achou + 1, valor_arquivo_centavos: v ?? null });
  }
  const linhas_sem_item = linhas
    .map((l, i) => ({ linha: i + 1, referencia: String(l.referencia ?? ''), valor_centavos: l.valor_centavos ?? null }))
    .filter((l, i) => !usadas.has(i) && normalizarReferencia(l.referencia));
  return {
    itens: resultado, linhas_sem_item,
    conferidos: resultado.filter(r => r.resultado === 'CONFERIDO').length,
    divergentes: resultado.filter(r => r.resultado !== 'CONFERIDO').length + linhas_sem_item.length,
  };
}

// ============================================================
// Situação da fatura (para a tela)
// ============================================================

export type SituacaoDaFatura = 'ABERTA' | 'FECHADA' | 'CANCELADA';
export type ConferenciaDaFatura = 'NAO_ENVIADA' | 'AGUARDANDO' | 'APROVADA' | 'CONTESTADA';

/** A situação que a pessoa lê: combina a da fatura com a da conta a receber (pagamento). */
export type SituacaoVisivel = 'ABERTA' | 'FECHADA' | 'EM_ATRASO' | 'PARCIAL' | 'PAGA' | 'CANCELADA';
export const ROTULO_SITUACAO: Record<SituacaoVisivel, string> = {
  ABERTA: 'Aberta', FECHADA: 'Fechada', EM_ATRASO: 'Em atraso', PARCIAL: 'Paga em parte', PAGA: 'Paga', CANCELADA: 'Cancelada',
};
export const ROTULO_CONFERENCIA: Record<ConferenciaDaFatura, string> = {
  NAO_ENVIADA: 'Não enviada', AGUARDANDO: 'Aguardando o cliente', APROVADA: 'Aprovada pelo cliente', CONTESTADA: 'Contestada',
};

export function situacaoVisivel(situacao: SituacaoDaFatura, statusDoTitulo: string, vencimento: string, hoje: string): SituacaoVisivel {
  if (situacao === 'CANCELADA') return 'CANCELADA';
  const st = String(statusDoTitulo || '').toUpperCase();
  if (st === 'RECEBIDO') return 'PAGA';
  if (st === 'PARCIAL') return 'PARCIAL';
  if (situacao === 'ABERTA') return 'ABERTA';
  return vencimento && vencimento < hoje ? 'EM_ATRASO' : 'FECHADA';
}
