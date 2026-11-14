/**
 * CONFERÊNCIA DO EXTRATO DA OPERADORA (E6, 05/11/2026): a parte PURA.
 *
 * A agência recebe da operadora ou da consolidadora um extrato (CSV, PDF,
 * planilha ou e-mail) com o que ela cobra, o que ela paga de comissão e o que
 * ela cancelou. A IA da agência LÊ o documento; daqui para a frente nada é
 * da IA:
 *
 *  1. `normalizarExtratoLido` limpa o que veio (datas reais, centavos
 *     inteiros, tipos conhecidos, tamanho). Texto do documento é dado.
 *  2. `checarExtrato` confere por regra: a soma das linhas bate com o total
 *     que o documento declara, cada linha fecha (bruto + taxas − comissão =
 *     líquido), a data está dentro do período e não há linha repetida. É a
 *     coluna "Válido": linha que não fecha não é confiável, venha de onde vier.
 *  3. `casarLinha` acha a venda pelo localizador (e, sem ele, pelo
 *     passageiro, a data e o valor, só quando é uma só).
 *  4. `compararLinha` diz Conferido ou Divergente e EXPLICA a diferença:
 *     valor, comissão, taxa ou cancelamento. Cancelamento que a venda ainda
 *     não tem vira PROPOSTA: a conferência nunca cancela nada.
 *  5. `podeFechar` diz se o período pode ser fechado e, se não, por quê.
 *
 * Dinheiro em centavos inteiros do começo ao fim.
 */
import { normalizarNome } from './conciliacao-plano';
import { diasEntre } from './resultado-financeiro';

export const TIPOS_DE_LINHA = ['venda', 'cancelamento', 'reembolso', 'ajuste', 'taxa'] as const;
export type TipoDeLinha = (typeof TIPOS_DE_LINHA)[number];

export const ROTULO_DO_TIPO: Record<TipoDeLinha, string> = {
  venda: 'Venda',
  cancelamento: 'Cancelamento',
  reembolso: 'Reembolso',
  ajuste: 'Ajuste',
  taxa: 'Taxa',
};

export interface LinhaLida {
  data: string | null;
  localizador: string;
  passageiro: string;
  descricao: string;
  tipo: TipoDeLinha;
  /** Tudo em centavos, sem sinal: o tipo diz a direção. */
  bruto_centavos: number | null;
  taxas_centavos: number | null;
  comissao_centavos: number | null;
  liquido_centavos: number | null;
}

export interface ExtratoLido {
  operadora_nome: string;
  operadora_cnpj: string;
  periodo_de: string | null;
  periodo_ate: string | null;
  total_bruto_centavos: number | null;
  total_comissao_centavos: number | null;
  total_liquido_centavos: number | null;
  linhas: LinhaLida[];
}

/** Linhas que uma conferência aceita (o resto é avisado, não cortado em silêncio). */
export const MAX_LINHAS_DA_CONFERENCIA = 2000;

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);

function dataReal(v: unknown): string | null {
  const s = txt(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** Reais vindos da IA (número ou texto "1.234,56") → centavos sem sinal; null se não houver. */
export function centavosDe(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const s = String(v).replace(/[^\d,.-]/g, '');
    if (!s) return null;
    const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    n = Number(normal);
  }
  if (!Number.isFinite(n)) return null;
  return Math.abs(Math.round(n * 100));
}

export function normalizarLocalizador(s: unknown): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

function tipoDe(v: unknown, valorBruto: unknown): TipoDeLinha {
  const t = normalizarNome(txt(v, 30));
  if (t.startsWith('cancel')) return 'cancelamento';
  if (t.startsWith('reemb') || t.startsWith('estorno') || t.startsWith('devol')) return 'reembolso';
  if (t.startsWith('ajust')) return 'ajuste';
  if (t.startsWith('taxa') || t.startsWith('tarifa')) return 'taxa';
  // Linha de venda com valor negativo é desfazimento.
  if (typeof valorBruto === 'number' && valorBruto < 0) return 'cancelamento';
  return 'venda';
}

export function normalizarExtratoLido(bruto: Record<string, unknown> | null | undefined): ExtratoLido {
  const b = bruto ?? {};
  const linhasBrutas = Array.isArray(b.linhas) ? (b.linhas as Record<string, unknown>[]) : [];
  return {
    operadora_nome: txt(b.operadora_nome, 160),
    operadora_cnpj: (() => { const d = txt(b.operadora_cnpj, 30).replace(/\D/g, ''); return d.length === 14 || d.length === 11 ? d : ''; })(),
    periodo_de: dataReal(b.periodo_de),
    periodo_ate: dataReal(b.periodo_ate),
    total_bruto_centavos: centavosDe(b.total_bruto),
    total_comissao_centavos: centavosDe(b.total_comissao),
    total_liquido_centavos: centavosDe(b.total_liquido),
    linhas: linhasBrutas.slice(0, MAX_LINHAS_DA_CONFERENCIA).map(l => ({
      data: dataReal(l?.data),
      localizador: normalizarLocalizador(l?.localizador),
      passageiro: txt(l?.passageiro, 120),
      descricao: txt(l?.descricao, 200),
      tipo: tipoDe(l?.tipo, l?.valor_bruto),
      bruto_centavos: centavosDe(l?.valor_bruto),
      taxas_centavos: centavosDe(l?.taxas),
      comissao_centavos: centavosDe(l?.comissao),
      liquido_centavos: centavosDe(l?.valor_liquido),
    })),
  };
}

// ── Regras puras de soma e data ───────────────────────────────────────────

/** Venda e taxa somam; cancelamento e reembolso devolvem. */
export function sinalDoTipo(t: TipoDeLinha): 1 | -1 {
  return t === 'cancelamento' || t === 'reembolso' ? -1 : 1;
}

/** O que a linha cobra da agência: o líquido, ou o bruto + taxas − comissão. */
export function cobradoDaLinha(l: LinhaLida): number | null {
  if (l.liquido_centavos !== null) return l.liquido_centavos;
  if (l.bruto_centavos === null) return null;
  return l.bruto_centavos + (l.taxas_centavos ?? 0) - (l.comissao_centavos ?? 0);
}

export interface ChecagemDaLinha {
  valido: boolean;
  motivos: string[];
  duplicada_de: number | null;
}

export interface ChecagemDoExtrato {
  linhas: ChecagemDaLinha[];
  /** Avisos do documento inteiro (soma, período). */
  avisos: string[];
  soma: { bruto: number; comissao: number; liquido: number };
  /** null quando o documento não declara o total. */
  soma_confere: boolean | null;
}

const fmt = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => iso.split('-').reverse().join('/');
const CENTAVO = 1;

export function checarExtrato(e: ExtratoLido): ChecagemDoExtrato {
  const vistos = new Map<string, number>();
  const linhas = e.linhas.map((l, i): ChecagemDaLinha => {
    const motivos: string[] = [];
    if (!l.data) motivos.push('Sem data legível.');
    else {
      if (e.periodo_de && l.data < e.periodo_de) motivos.push(`Data ${dataBR(l.data)} antes do período do extrato.`);
      if (e.periodo_ate && l.data > e.periodo_ate) motivos.push(`Data ${dataBR(l.data)} depois do período do extrato.`);
    }
    if (l.bruto_centavos === null && l.liquido_centavos === null && l.comissao_centavos === null) motivos.push('Sem valor.');
    if (l.bruto_centavos !== null && l.liquido_centavos !== null) {
      const com = l.comissao_centavos ?? 0;
      const tax = l.taxas_centavos ?? 0;
      const fecha = Math.abs(l.bruto_centavos + tax - com - l.liquido_centavos) <= CENTAVO
        || Math.abs(l.bruto_centavos - com - l.liquido_centavos) <= CENTAVO;
      if (!fecha) {
        motivos.push(`As contas da linha não fecham: ${fmt(l.bruto_centavos)}${tax ? ` + taxas ${fmt(tax)}` : ''}${com ? ` − comissão ${fmt(com)}` : ''} não dá ${fmt(l.liquido_centavos)}.`);
      }
    }
    const chave = [l.tipo, l.localizador, normalizarNome(l.passageiro), l.data, l.bruto_centavos, l.liquido_centavos, l.comissao_centavos].join('|');
    let duplicada: number | null = null;
    if (l.localizador || l.passageiro) {
      const ant = vistos.get(chave);
      if (ant !== undefined) {
        duplicada = ant;
        motivos.push(`Igual à linha ${ant + 1}: confira se a operadora não lançou duas vezes.`);
      } else vistos.set(chave, i);
    }
    return { valido: motivos.length === 0, motivos, duplicada_de: duplicada };
  });

  const soma = { bruto: 0, comissao: 0, liquido: 0 };
  for (const l of e.linhas) {
    const s = sinalDoTipo(l.tipo);
    soma.bruto += s * (l.bruto_centavos ?? 0);
    soma.comissao += s * (l.comissao_centavos ?? 0);
    soma.liquido += s * (cobradoDaLinha(l) ?? 0);
  }
  const avisos: string[] = [];
  const comparacoes: boolean[] = [];
  const conferir = (rotulo: string, declarado: number | null, somado: number) => {
    if (declarado === null) return;
    const ok = Math.abs(Math.abs(declarado) - Math.abs(somado)) <= CENTAVO * Math.max(1, Math.ceil(e.linhas.length / 50));
    comparacoes.push(ok);
    if (!ok) avisos.push(`O total ${rotulo} do documento é ${fmt(declarado)}, mas a soma das linhas dá ${fmt(Math.abs(somado))}. Falta ou sobra linha na leitura.`);
  };
  conferir('líquido', e.total_liquido_centavos, soma.liquido);
  conferir('bruto', e.total_bruto_centavos, soma.bruto);
  conferir('de comissão', e.total_comissao_centavos, soma.comissao);
  if (e.periodo_de && e.periodo_ate && e.periodo_de > e.periodo_ate) avisos.push('O período do documento começa depois de terminar.');
  if (e.linhas.length === 0) avisos.push('Nenhuma linha lida no documento.');
  return { linhas, avisos, soma, soma_confere: comparacoes.length === 0 ? null : comparacoes.every(Boolean) };
}

// ── Casar com a venda ─────────────────────────────────────────────────────

export interface ItemParaCasar {
  item_id: string;
  venda_id: string;
  venda_numero: string;
  venda_status: string;
  data_venda: string;
  data_servico: string;
  localizadores: string[];
  passageiros: string[];
  fornecedor_id: string;
  fornecedor_nome: string;
  /** 'proprio': a agência paga a operadora. 'fornecedor': o cliente pagou direto e a operadora deve comissão. */
  meio: 'proprio' | 'fornecedor';
  custo_centavos: number;
  venda_centavos: number;
  comissao_centavos: number;
  conta_pagar: { id: string; valor_centavos: number; status: string } | null;
  conta_comissao: { id: string; valor_centavos: number; status: string; recebido_centavos: number } | null;
}

export type ComoCasou = 'localizador' | 'passageiro' | 'manual' | 'nenhum';

export interface Casamento {
  item: ItemParaCasar | null;
  como: ComoCasou;
  /** Mais de um candidato e nenhum critério desempatou. */
  ambiguos: number;
}

/** Sem localizador, a data da linha precisa estar a até 15 dias da venda (ou do serviço). */
export const JANELA_PASSAGEIRO_DIAS = 15;

function tokensDoNome(n: string): string[] {
  return normalizarNome(n).split(' ').filter(t => t.length >= 2 && !['de', 'da', 'do', 'das', 'dos', 'e', 'sr', 'sra', 'mr', 'mrs', 'chd', 'inf', 'adt'].includes(t));
}

/** O passageiro da linha é um dos da venda: primeiro e último nome batem (em qualquer ordem, "SOBRENOME/NOME" incluso). */
export function mesmoPassageiro(linha: string, daVenda: string): boolean {
  const a = tokensDoNome(linha.replace('/', ' '));
  const b = new Set(tokensDoNome(daVenda.replace('/', ' ')));
  if (a.length === 0 || b.size === 0) return false;
  const primeiro = a[0];
  const ultimo = a[a.length - 1];
  return b.has(primeiro) && b.has(ultimo);
}

function temPassageiro(l: LinhaLida, it: ItemParaCasar): boolean {
  return !!l.passageiro && it.passageiros.some(p => mesmoPassageiro(l.passageiro, p));
}

function mesmoFornecedor(it: ItemParaCasar, f: { id?: string; nome?: string } | null | undefined): boolean {
  if (!f) return false;
  if (f.id && it.fornecedor_id) return f.id === it.fornecedor_id;
  const a = normalizarNome(f.nome ?? '');
  const b = normalizarNome(it.fornecedor_nome);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

function valorBate(l: LinhaLida, it: ItemParaCasar): boolean {
  const cobrado = cobradoDaLinha(l);
  return (cobrado !== null && Math.abs(cobrado - it.custo_centavos) <= CENTAVO)
    || (l.bruto_centavos !== null && Math.abs(l.bruto_centavos - it.venda_centavos) <= CENTAVO)
    || (l.comissao_centavos !== null && it.comissao_centavos > 0 && Math.abs(l.comissao_centavos - it.comissao_centavos) <= CENTAVO);
}

/**
 * A venda da linha. Localizador primeiro (desempata pelo passageiro, pela
 * operadora e pelo valor); sem localizador, passageiro + data perto + valor,
 * e só quando sobra UMA. Nunca chuta: ambíguo fica "não encontrado" com a
 * contagem, para a pessoa escolher.
 */
export function casarLinha(l: LinhaLida, itens: readonly ItemParaCasar[], operadora?: { id?: string; nome?: string } | null): Casamento {
  const desempatar = (lista: ItemParaCasar[]): ItemParaCasar[] => {
    for (const filtro of [(it: ItemParaCasar) => temPassageiro(l, it), (it: ItemParaCasar) => mesmoFornecedor(it, operadora), (it: ItemParaCasar) => valorBate(l, it)]) {
      if (lista.length <= 1) break;
      const f = lista.filter(filtro);
      if (f.length > 0) lista = f;
    }
    return lista;
  };
  if (l.localizador.length >= 5) {
    const porLoc = itens.filter(it => it.localizadores.includes(l.localizador));
    if (porLoc.length > 0) {
      const final = desempatar(porLoc);
      if (final.length === 1) return { item: final[0], como: 'localizador', ambiguos: 0 };
      // Vários itens da MESMA venda (aéreo + hotel no mesmo localizador): a venda é certa; fica o de valor igual, se houver.
      return { item: null, como: 'nenhum', ambiguos: final.length };
    }
  }
  if (l.passageiro && l.data) {
    const candidatos = itens.filter(it => {
      if (!temPassageiro(l, it)) return false;
      const ref = it.data_servico || it.data_venda;
      if (ref && Math.abs(diasEntre(ref, l.data!)) > JANELA_PASSAGEIRO_DIAS && Math.abs(diasEntre(it.data_venda, l.data!)) > JANELA_PASSAGEIRO_DIAS) return false;
      return valorBate(l, it);
    });
    if (candidatos.length === 1) return { item: candidatos[0], como: 'passageiro', ambiguos: 0 };
    if (candidatos.length > 1) {
      const final = desempatar(candidatos);
      if (final.length === 1) return { item: final[0], como: 'passageiro', ambiguos: 0 };
      return { item: null, como: 'nenhum', ambiguos: final.length };
    }
  }
  return { item: null, como: 'nenhum', ambiguos: 0 };
}

// ── Comparar e explicar ───────────────────────────────────────────────────

export type Situacao = 'CONFERIDO' | 'DIVERGENTE' | 'NAO_ENCONTRADO';
export type TipoDeDiferenca = 'valor' | 'comissao' | 'taxa' | 'cancelamento';

export interface Diferenca {
  tipo: TipoDeDiferenca;
  /** Positivo: a operadora diz mais do que a venda. */
  diferenca_centavos: number;
  texto: string;
}

export interface PropostaDeCancelamento {
  tipo: 'cancelamento';
  venda_id: string;
  venda_numero: string;
  item_id: string;
  valor_centavos: number;
  texto: string;
}

export interface Comparacao {
  situacao: Situacao;
  diferencas: Diferenca[];
  proposta: PropostaDeCancelamento | null;
  /** Comissão que a venda espera desta linha (venda +, cancelamento −). */
  comissao_esperada_centavos: number;
}

const maisMenos = (d: number) => (d > 0 ? `${fmt(d)} a mais` : `${fmt(-d)} a menos`);

export function compararLinha(l: LinhaLida, it: ItemParaCasar | null): Comparacao {
  if (!it) {
    return { situacao: 'NAO_ENCONTRADO', diferencas: [], proposta: null, comissao_esperada_centavos: 0 };
  }
  const diferencas: Diferenca[] = [];
  let proposta: PropostaDeCancelamento | null = null;
  const loc = l.localizador || 'sem localizador';

  if (l.tipo === 'cancelamento' || l.tipo === 'reembolso') {
    if (it.venda_status !== 'CANCELADO') {
      const valor = cobradoDaLinha(l) ?? l.bruto_centavos ?? 0;
      const texto = `A operadora registrou ${l.tipo === 'cancelamento' ? 'o cancelamento' : 'o reembolso'} de ${loc}${l.passageiro ? ` (${l.passageiro})` : ''}, mas a venda ${it.venda_numero || ''} continua ativa no sistema.`;
      diferencas.push({ tipo: 'cancelamento', diferenca_centavos: -valor, texto });
      proposta = { tipo: 'cancelamento', venda_id: it.venda_id, venda_numero: it.venda_numero, item_id: it.item_id, valor_centavos: valor, texto: `Cancelar a venda ${it.venda_numero || ''} no sistema, se o cancelamento for confirmado.`.replace('  ', ' ') };
    }
    return { situacao: diferencas.length ? 'DIVERGENTE' : 'CONFERIDO', diferencas, proposta, comissao_esperada_centavos: -it.comissao_centavos };
  }

  if (l.tipo === 'taxa' || l.tipo === 'ajuste') {
    const valor = cobradoDaLinha(l) ?? 0;
    diferencas.push({
      tipo: l.tipo === 'taxa' ? 'taxa' : 'valor', diferenca_centavos: valor,
      texto: l.tipo === 'taxa'
        ? `Taxa avulsa de ${fmt(valor)} cobrada pela operadora em ${loc}; a venda não tem essa taxa.`
        : `Ajuste de ${fmt(valor)} lançado pela operadora em ${loc}. Confira o motivo com ela.`,
    });
    return { situacao: 'DIVERGENTE', diferencas, proposta: null, comissao_esperada_centavos: 0 };
  }

  if (it.venda_status === 'CANCELADO') {
    diferencas.push({
      tipo: 'cancelamento', diferenca_centavos: cobradoDaLinha(l) ?? 0,
      texto: `A venda ${it.venda_numero} está cancelada no sistema, mas a operadora ainda cobra ${loc}.`,
    });
  }

  let comissaoJaExplicada = false;
  if (it.meio === 'proprio') {
    const cobrado = cobradoDaLinha(l);
    if (cobrado !== null) {
      const diff = cobrado - it.custo_centavos;
      if (Math.abs(diff) > CENTAVO) {
        const tax = l.taxas_centavos ?? 0;
        const com = l.comissao_centavos ?? 0;
        if (tax > 0 && Math.abs(diff - tax) <= CENTAVO) {
          diferencas.push({ tipo: 'taxa', diferenca_centavos: diff, texto: `A diferença de ${fmt(diff)} é a taxa que a operadora cobrou e que o custo da venda não tem.` });
        } else if (com > 0 && Math.abs(diff + com) <= CENTAVO) {
          comissaoJaExplicada = true;
          diferencas.push({ tipo: 'comissao', diferenca_centavos: diff, texto: `A diferença de ${fmt(-diff)} é a comissão: o custo da venda está pelo valor cheio e a operadora cobra já descontada a comissão.` });
        } else if (com > 0 && Math.abs(diff - com) <= CENTAVO) {
          comissaoJaExplicada = true;
          diferencas.push({ tipo: 'comissao', diferenca_centavos: diff, texto: `A operadora cobra ${fmt(diff)} a mais, o valor da comissão: ela não descontou a comissão que a venda espera.` });
        } else {
          diferencas.push({ tipo: 'valor', diferenca_centavos: diff, texto: `A operadora cobra ${fmt(cobrado)}; o custo na venda ${it.venda_numero} é ${fmt(it.custo_centavos)} (${maisMenos(diff)}).` });
        }
      }
    }
  } else if (l.bruto_centavos !== null && it.venda_centavos > 0) {
    const diff = l.bruto_centavos - it.venda_centavos;
    if (Math.abs(diff) > CENTAVO) {
      diferencas.push({ tipo: 'valor', diferenca_centavos: diff, texto: `A operadora registra ${fmt(l.bruto_centavos)} pago pelo cliente; a venda ${it.venda_numero} tem ${fmt(it.venda_centavos)} (${maisMenos(diff)}).` });
    }
  }

  if (!comissaoJaExplicada && l.comissao_centavos !== null && (it.comissao_centavos > 0 || it.meio === 'fornecedor')) {
    const diff = l.comissao_centavos - it.comissao_centavos;
    if (Math.abs(diff) > CENTAVO) {
      diferencas.push({ tipo: 'comissao', diferenca_centavos: diff, texto: `Comissão no extrato ${fmt(l.comissao_centavos)}; a venda espera ${fmt(it.comissao_centavos)} (${maisMenos(diff)}).` });
    }
  }

  return { situacao: diferencas.length ? 'DIVERGENTE' : 'CONFERIDO', diferencas, proposta, comissao_esperada_centavos: it.comissao_centavos };
}

// ── Fechar o período ──────────────────────────────────────────────────────

export interface LinhaParaFechar {
  ordem: number;
  situacao: Situacao;
  valido: boolean;
  aceita: boolean;
  proposta_pendente: boolean;
}

/** Linha resolvida: conferida e válida, ou aceita por alguém com o motivo escrito. */
export function linhaResolvida(l: Pick<LinhaParaFechar, 'situacao' | 'valido' | 'aceita' | 'proposta_pendente'>): boolean {
  if (l.proposta_pendente) return false;
  return l.aceita || (l.situacao === 'CONFERIDO' && l.valido);
}

export function podeFechar(
  linhas: readonly LinhaParaFechar[],
  anteriorAberta: { periodo_de: string | null } | null,
): { ok: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (anteriorAberta) {
    motivos.push(`Há uma conferência anterior desta operadora ainda aberta${anteriorAberta.periodo_de ? ` (desde ${dataBR(anteriorAberta.periodo_de)})` : ''}. Feche a anterior primeiro.`);
  }
  const propostas = linhas.filter(l => l.proposta_pendente).length;
  if (propostas > 0) motivos.push(`${propostas === 1 ? '1 cancelamento proposto espera' : `${propostas} cancelamentos propostos esperam`} decisão: trate na venda ou descarte a proposta.`);
  const abertas = linhas.filter(l => !l.proposta_pendente && !linhaResolvida(l)).length;
  if (abertas > 0) motivos.push(`${abertas === 1 ? '1 linha não está conferida' : `${abertas} linhas não estão conferidas`}: ligue à venda, ou aceite com o motivo.`);
  return { ok: motivos.length === 0, motivos };
}

// ── Comissão esperada × recebida ──────────────────────────────────────────

export interface LinhaParaComissao {
  operadora: string;
  tipo: TipoDeLinha;
  comissao_informada_centavos: number | null;
  comissao_esperada_centavos: number;
  /** Recebido nas contas de comissão da venda (cliente pagou direto à operadora). */
  comissao_recebida_centavos: number;
  tem_conta_de_comissao: boolean;
}

export interface ComissaoDaOperadora {
  operadora: string;
  esperada_centavos: number;
  informada_centavos: number;
  recebida_centavos: number;
  /** Informada − esperada. */
  diferenca_informada_centavos: number;
  /** Das contas de comissão: o que falta receber. */
  a_receber_centavos: number;
  linhas: number;
}

export function comissaoPorOperadora(linhas: readonly LinhaParaComissao[]): ComissaoDaOperadora[] {
  const m = new Map<string, ComissaoDaOperadora>();
  for (const l of linhas) {
    const nome = l.operadora || 'Operadora sem nome';
    const c = m.get(nome) ?? { operadora: nome, esperada_centavos: 0, informada_centavos: 0, recebida_centavos: 0, diferenca_informada_centavos: 0, a_receber_centavos: 0, linhas: 0 };
    c.esperada_centavos += l.comissao_esperada_centavos;
    c.informada_centavos += sinalDoTipo(l.tipo) * (l.comissao_informada_centavos ?? 0);
    c.recebida_centavos += l.comissao_recebida_centavos;
    if (l.tem_conta_de_comissao) c.a_receber_centavos += Math.max(0, l.comissao_esperada_centavos - l.comissao_recebida_centavos);
    c.linhas += 1;
    m.set(nome, c);
  }
  return [...m.values()]
    .map(c => ({ ...c, diferenca_informada_centavos: c.informada_centavos - c.esperada_centavos }))
    .sort((a, b) => Math.abs(b.diferenca_informada_centavos) - Math.abs(a.diferenca_informada_centavos) || a.operadora.localeCompare(b.operadora));
}

// ── A conferência inteira ─────────────────────────────────────────────────

export interface LinhaConferida {
  ordem: number;
  lida: LinhaLida;
  checagem: ChecagemDaLinha;
  casamento: Casamento;
  comparacao: Comparacao;
}

/** Cada linha lida, checada, casada e comparada. A prévia e a gravação usam a mesma conta. */
export function conferirLinhas(
  e: ExtratoLido, itens: readonly ItemParaCasar[], operadora?: { id?: string; nome?: string } | null,
): { linhas: LinhaConferida[]; checagem: ChecagemDoExtrato; resumo: Record<Situacao, number> & { invalidas: number; propostas: number } } {
  const checagem = checarExtrato(e);
  const linhas = e.linhas.map((lida, i) => {
    const casamento = casarLinha(lida, itens, operadora);
    return { ordem: i + 1, lida, checagem: checagem.linhas[i], casamento, comparacao: compararLinha(lida, casamento.item) };
  });
  const resumo = { CONFERIDO: 0, DIVERGENTE: 0, NAO_ENCONTRADO: 0, invalidas: 0, propostas: 0 };
  for (const l of linhas) {
    resumo[l.comparacao.situacao] += 1;
    if (!l.checagem.valido) resumo.invalidas += 1;
    if (l.comparacao.proposta) resumo.propostas += 1;
  }
  return { linhas, checagem, resumo };
}
