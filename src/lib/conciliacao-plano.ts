/**
 * CONCILIAÇÃO BANCÁRIA: a regra, sem banco e sem tela.
 *
 * Pedido do Bruno (05/10/2026): "Se o extrato é do banco, tudo é
 * consolidado." A linha do extrato é FATO: o dinheiro entrou ou saiu naquele
 * dia, naquele valor. Conciliar é dizer a que lançamento esse fato pertence,
 * e o lançamento passa a refletir o fato (baixado, com a data e o valor do
 * banco). Nunca o contrário.
 *
 * Uma linha pode quitar mais de uma conta (um Pix que paga duas parcelas da
 * mesma venda) ou parte de uma (o cliente pagou metade). O plano distribui o
 * valor do banco pelas contas escolhidas, na ordem do vencimento:
 *   - conta já baixada no sistema: só se amarra ao extrato, e o valor dela
 *     conta como coberto (o banco é a prova daquele pagamento);
 *   - conta em aberto inteiramente coberta: é baixada;
 *   - conta em aberto coberta em parte: fica PARCIAL com o que entrou.
 * O valor do banco tem que ser TODO atribuído. Sobra sem conta não concilia:
 * a tela pede mais uma conta ou uma conta nova para a diferença.
 */
import { divSegura, mesDe, round2, somaPor } from './money';
import { diasEntre } from './resultado-financeiro';

export type TipoLancamento = 'CONTA_RECEBER' | 'CONTA_PAGAR';

export interface ContaConciliavel {
  id: string;
  tipo: TipoLancamento;
  status: string;
  valor_final: number;
  /** valor_recebido ou valor_pago, como está gravado (acumulado na PARCIAL). */
  valor_baixado: number | null;
  data_vencimento: string;
  conta_bancaria_id?: string | null;
}

export type PassoDaConciliacao =
  | { id: string; tipo: TipoLancamento; acao: 'VINCULAR'; aplicado: number }
  | { id: string; tipo: TipoLancamento; acao: 'BAIXAR' | 'PARCIAL'; aplicado: number; status_novo: string; valor_baixado_novo: number };

export type MotivoRecusa =
  | 'SEM_CONTA'
  | 'TIPO_ERRADO'
  | 'CANCELADA'
  | 'SOBRA'
  | 'EXCEDE'
  | 'CONTA_SEM_VALOR'
  | 'OUTRA_CONTA_BANCARIA';

export interface PlanoDaConciliacao {
  passos: PassoDaConciliacao[];
  valor_extrato: number;
  /** Quanto do valor do banco ficou atribuído às contas. */
  aplicado: number;
  /** Do banco, sem conta: tem que ser zero para conciliar. */
  sobra: number;
  /** Das contas em aberto escolhidas, o que continua a receber/pagar. */
  falta: number;
  ok: boolean;
  motivo: MotivoRecusa | null;
  /** A conta que provocou a recusa, quando for uma só. */
  conta_do_motivo: string | null;
}

const ABERTAS = new Set(['PENDENTE', 'ATRASADO', 'VENCIDO', 'PARCIAL']);
const QUITADAS = new Set(['RECEBIDO', 'PAGO']);
/** Centavo de tolerância: arredondamento de banco não trava a conciliação. */
const CENTAVO = 0.01;

export function statusQuitado(tipo: TipoLancamento): 'RECEBIDO' | 'PAGO' {
  return tipo === 'CONTA_RECEBER' ? 'RECEBIDO' : 'PAGO';
}

/** O que já entrou/saiu por esta conta, como o caixa enxerga. */
export function jaBaixado(c: ContaConciliavel): number {
  if (QUITADAS.has(c.status)) return round2(c.valor_baixado || c.valor_final);
  if (c.status === 'PARCIAL') return round2(c.valor_baixado ?? 0);
  return 0;
}

/** O que ainda falta entrar/sair por esta conta. */
export function emAberto(c: ContaConciliavel): number {
  if (!ABERTAS.has(c.status)) return 0;
  return round2(Math.max(0, c.valor_final - jaBaixado(c)));
}

/**
 * @param valorExtrato valor da linha do banco, com sinal (crédito +, débito -)
 * @param contaBancaria a conta do extrato: uma PARCIAL baixada em OUTRA conta
 *   bancária não recebe o resto por aqui, porque a conta só guarda uma conta
 *   bancária e mover a parte antiga mudaria o saldo de um banco que não mexeu.
 */
export function planoDaConciliacao(
  contas: readonly ContaConciliavel[],
  valorExtrato: number,
  contaBancaria: string | null = null,
): PlanoDaConciliacao {
  const valor = round2(Math.abs(valorExtrato));
  const tipoEsperado: TipoLancamento = valorExtrato >= 0 ? 'CONTA_RECEBER' : 'CONTA_PAGAR';
  const recusa = (motivo: MotivoRecusa, conta: string | null = null): PlanoDaConciliacao => ({
    passos: [], valor_extrato: valor, aplicado: 0, sobra: valor, falta: 0, ok: false, motivo, conta_do_motivo: conta,
  });

  if (contas.length === 0) return recusa('SEM_CONTA');
  for (const c of contas) {
    if (c.tipo !== tipoEsperado) return recusa('TIPO_ERRADO', c.id);
    if (!ABERTAS.has(c.status) && !QUITADAS.has(c.status)) return recusa('CANCELADA', c.id);
    if (c.status === 'PARCIAL' && contaBancaria && c.conta_bancaria_id && c.conta_bancaria_id !== contaBancaria && jaBaixado(c) > 0) {
      return recusa('OUTRA_CONTA_BANCARIA', c.id);
    }
  }

  // Fatos primeiro (o que o sistema já dá como pago é o que o banco prova),
  // depois as abertas na ordem em que vencem.
  const ordem = [...contas].sort((a, b) => {
    const qa = QUITADAS.has(a.status) ? 0 : 1;
    const qb = QUITADAS.has(b.status) ? 0 : 1;
    return qa - qb || String(a.data_vencimento).localeCompare(String(b.data_vencimento)) || a.id.localeCompare(b.id);
  });

  let restante = valor;
  let falta = 0;
  const passos: PassoDaConciliacao[] = [];
  for (const c of ordem) {
    if (QUITADAS.has(c.status)) {
      const baixado = jaBaixado(c);
      if (baixado > restante + CENTAVO) return { ...recusa('EXCEDE', c.id) };
      passos.push({ id: c.id, tipo: c.tipo, acao: 'VINCULAR', aplicado: baixado });
      restante = round2(restante - baixado);
      continue;
    }
    const aberto = emAberto(c);
    if (aberto <= 0 || restante <= CENTAVO) return recusa('CONTA_SEM_VALOR', c.id);
    const aplicado = round2(Math.min(aberto, restante));
    const quita = aberto - aplicado <= CENTAVO;
    const novoBaixado = round2(jaBaixado(c) + aplicado);
    passos.push({
      id: c.id,
      tipo: c.tipo,
      acao: quita ? 'BAIXAR' : 'PARCIAL',
      aplicado,
      status_novo: quita ? statusQuitado(c.tipo) : 'PARCIAL',
      // Quitada grava o valor que de fato entrou/saiu: o banco é a verdade,
      // inclusive no centavo de arredondamento.
      valor_baixado_novo: novoBaixado,
    });
    if (!quita) falta = round2(falta + aberto - aplicado);
    restante = round2(restante - aplicado);
  }

  const sobra = round2(Math.max(0, restante));
  const aplicado = round2(valor - sobra);
  if (sobra > CENTAVO) {
    return { passos, valor_extrato: valor, aplicado, sobra, falta, ok: false, motivo: 'SOBRA', conta_do_motivo: null };
  }
  return { passos, valor_extrato: valor, aplicado, sobra: 0, falta, ok: true, motivo: null, conta_do_motivo: null };
}

/**
 * As contas que a tela pré-marca ao escolher uma venda: uma conta aberta de
 * valor igual ao do banco, se houver; senão as abertas em ordem de
 * vencimento até cobrir o valor.
 */
export function preSelecao(contas: readonly ContaConciliavel[], valorExtrato: number): string[] {
  const valor = round2(Math.abs(valorExtrato));
  const abertas = contas
    .filter(c => emAberto(c) > 0)
    .sort((a, b) => String(a.data_vencimento).localeCompare(String(b.data_vencimento)) || a.id.localeCompare(b.id));
  const exata = abertas.find(c => Math.abs(emAberto(c) - valor) <= CENTAVO);
  if (exata) return [exata.id];
  const ids: string[] = [];
  let falta = valor;
  for (const c of abertas) {
    if (falta <= CENTAVO) break;
    ids.push(c.id);
    falta = round2(falta - emAberto(c));
  }
  if (ids.length > 0) return ids;
  // Nenhuma aberta: a já baixada de valor igual é a candidata natural.
  const quitada = contas.find(c => QUITADAS.has(c.status) && Math.abs(jaBaixado(c) - valor) <= CENTAVO);
  return quitada ? [quitada.id] : [];
}

/** A frase do que vai acontecer, antes de confirmar. Números, não adjetivos. */
export function descreverPlanoDaConciliacao(p: PlanoDaConciliacao, fmt: (v: number) => string, receber: boolean): string {
  if (!p.ok) {
    switch (p.motivo) {
      case 'SEM_CONTA': return 'Escolha a conta que este valor quita.';
      case 'TIPO_ERRADO': return receber ? 'Entrada no banco só concilia com conta a receber.' : 'Saída do banco só concilia com conta a pagar.';
      case 'CANCELADA': return 'Conta cancelada não recebe baixa.';
      case 'EXCEDE': return 'Uma conta já baixada tem valor maior que o do banco: não pode ser esta.';
      case 'CONTA_SEM_VALOR': return 'Uma das contas escolhidas não recebe nada deste valor. Desmarque-a.';
      case 'OUTRA_CONTA_BANCARIA': return 'Esta conta já teve parte baixada em outra conta bancária. Resolva pela tela de contas.';
      case 'SOBRA': return `Sobram ${fmt(p.sobra)} do banco sem conta. Escolha mais uma conta ou crie uma nova para a diferença.`;
      default: return 'Não dá para conciliar com essa escolha.';
    }
  }
  const baixadas = p.passos.filter(x => x.acao === 'BAIXAR').length;
  const parciais = p.passos.filter(x => x.acao === 'PARCIAL').length;
  const vinculadas = p.passos.filter(x => x.acao === 'VINCULAR').length;
  const verbo = receber ? 'recebida' : 'paga';
  const verboP = receber ? 'recebidas' : 'pagas';
  const partes: string[] = [];
  if (baixadas > 0) partes.push(baixadas === 1 ? `1 conta fica ${verbo}` : `${baixadas} contas ficam ${verboP}`);
  if (parciais > 0) partes.push(`${parciais === 1 ? '1 conta fica' : `${parciais} contas ficam`} ${verbo} em parte, faltando ${fmt(p.falta)}`);
  if (vinculadas > 0) partes.push(vinculadas === 1 ? `1 conta que já constava como ${verbo} ganha a prova do banco` : `${vinculadas} contas que já constavam como ${verboP} ganham a prova do banco`);
  return `${partes.join('; ')}.`;
}

// ── A contraparte, lida da descrição do banco ─────────────────────────────

const PALAVRAS_MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em']);
/** Siglas que aparecem em extrato de agência e têm vogal, então a regra
 *  "curta sem vogal" não as pega. */
const SIGLAS = new Set([
  'cef', 'bb', 'brb', 'btg', 'xp', 'inss', 'iof', 'iss', 'iptu', 'ipva', 'darf', 'gps', 'icms',
  'pis', 'cofins', 'csll', 'irpj', 'irrf', 'ltda', 'me', 'epp', 'eireli', 'sa', 'oab', 'detran', 'sabesp', 'cemig', 'copel', 'cpfl',
]);

function capitalizar(texto: string): string {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => {
      if (i > 0 && PALAVRAS_MINUSCULAS.has(p)) return p;
      // Sigla com ponto (S.A., LTDA.) ou curta sem vogal fica como sigla.
      if (/\./.test(p) || SIGLAS.has(p) || (p.length <= 4 && !/[aeiouáéíóú]/.test(p))) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ');
}

/**
 * Quem está do outro lado do lançamento, a partir do que o banco escreveu:
 *   'Pix enviado: "Cp :00360305-CEF MATRIZ"'     → 'CEF Matriz'
 *   'Pagamento de Titulo: "ITAU UNIBANCO S.A."'  → 'Itau Unibanco S.A.'
 *   'PIX RECEBIDO - MARIA DA SILVA'             → 'Maria da Silva'
 * Devolve '' quando não há nada que pareça um nome.
 */
export function contraparteDaDescricao(descricao: string): string {
  let t = String(descricao ?? '').trim();
  const aspas = t.match(/"([^"]+)"/);
  if (aspas) t = aspas[1];
  else if (t.includes(':')) t = t.slice(t.indexOf(':') + 1);
  // Código de conta do banco antes do nome: "Cp :00360305-", "12345678-".
  t = t.replace(/^\s*[A-Za-z]{0,3}\s*:?\s*\d{4,}\s*-\s*/, '');
  // Prefixo de operação sem dois-pontos.
  t = t.replace(/^\s*(pix|ted|doc|tef|transf(er[eê]ncia)?|pagamento|pgto|dep[oó]sito)(\s+(enviado|recebido|recebida|enviada|de|a|para))*\s*[-–:]?\s*/i, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (!/[A-Za-zÀ-ú]{2,}/.test(t)) return '';
  return capitalizar(t);
}

/** Forma da descrição que serve para comparar nomes: sem acento, minúscula, só letras. */
export function normalizarNome(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Forma de pagamento que a descrição do banco revela. */
export function formaDaDescricao(descricao: string): 'PIX' | 'TED' | 'BOLETO' | '' {
  const d = normalizarNome(descricao);
  if (/\bpix\b/.test(d)) return 'PIX';
  if (/\bted\b|\bdoc\b|\btransf/.test(d)) return 'TED';
  if (/titulo|boleto/.test(d)) return 'BOLETO';
  return '';
}

/**
 * A categoria que a agência costuma usar para esta contraparte: a mais
 * frequente entre as contas a pagar com o mesmo nome. É o que faz a
 * vigésima linha da Receita Federal já vir como imposto.
 */
export function categoriaPeloHistorico(
  contraparte: string,
  contas: readonly { fornecedor_nome?: string; categoria_id?: string; status?: string }[],
): string {
  const alvo = normalizarNome(contraparte);
  if (!alvo) return '';
  const contagem = new Map<string, number>();
  for (const c of contas) {
    if (!c.categoria_id || c.status === 'CANCELADO') continue;
    const nome = normalizarNome(c.fornecedor_nome ?? '');
    if (!nome || (nome !== alvo && !nome.includes(alvo) && !alvo.includes(nome))) continue;
    contagem.set(c.categoria_id, (contagem.get(c.categoria_id) ?? 0) + 1);
  }
  let melhor = '';
  let max = 0;
  for (const [cat, n] of contagem) if (n > max || (n === max && cat < melhor)) { melhor = cat; max = n; }
  return melhor;
}

// ── Candidatas, em ordem de chance ────────────────────────────────────────

export interface Candidata {
  chave: string;
  /** Valor que se compara ao do banco: o aberto, ou o baixado se já quitada. */
  valor: number;
  /** Data que se compara à do banco: pagamento se quitada, senão vencimento. */
  data: string;
  /** Nome que se compara à contraparte (cliente, fornecedor, descrição). */
  nomes: string[];
}

/**
 * Pontos de 0 a 100: valor igual pesa mais que tudo (60), nome da
 * contraparte depois (25), data perto por último (15). Ordem estável.
 */
export function pontuarCandidata(c: Candidata, valorExtrato: number, dataExtrato: string, contraparte: string): number {
  const valor = Math.abs(valorExtrato);
  let pts = 0;
  const dif = Math.abs(c.valor - valor);
  if (dif <= CENTAVO) pts += 60;
  else if (valor > 0 && dif / valor <= 0.05) pts += 30;
  else if (valor > 0 && c.valor > valor) pts += 10; // pode ser uma parte dela
  const alvo = normalizarNome(contraparte);
  if (alvo) {
    const tokens = alvo.split(' ').filter(t => t.length >= 3);
    const texto = normalizarNome(c.nomes.join(' '));
    if (texto.includes(alvo)) pts += 25;
    else if (tokens.length > 0) pts += Math.round(25 * divSegura(tokens.filter(t => texto.includes(t)).length, tokens.length));
  }
  if (c.data && dataExtrato) {
    const dias = Math.abs(diasEntre(c.data, dataExtrato));
    if (dias <= 3) pts += 15;
    else if (dias <= 15) pts += 8;
    else if (dias <= 45) pts += 3;
  }
  return pts;
}

export function ordenarCandidatas<T extends Candidata>(lista: readonly T[], valorExtrato: number, dataExtrato: string, contraparte: string): Array<T & { pontos: number }> {
  return lista
    .map(c => ({ ...c, pontos: pontuarCandidata(c, valorExtrato, dataExtrato, contraparte) }))
    .sort((a, b) => b.pontos - a.pontos || Math.abs(diasEntre(a.data || dataExtrato, dataExtrato)) - Math.abs(diasEntre(b.data || dataExtrato, dataExtrato)) || a.chave.localeCompare(b.chave));
}

// ── O painel do período ───────────────────────────────────────────────────

export interface LinhaDoPainel {
  data: string;
  valor: number;
  status_conciliacao: string;
}

export interface PainelDoExtrato {
  de: string;
  ate: string;
  entrou: number;
  saiu: number;
  resultado: number;
  creditos: number;
  debitos: number;
  linhas: number;
  conferidas: number;
  a_conferir: number;
  /** Valor (em módulo) das linhas ainda a conferir. */
  a_conferir_valor: number;
  pct_conferido: number;
}

/** O que o banco diz que entrou e saiu no período, e quanto disso já tem dono. */
export function painelDoExtrato(linhas: readonly LinhaDoPainel[]): PainelDoExtrato {
  let de = '';
  let ate = '';
  for (const l of linhas) {
    if (!l.data) continue;
    if (!de || l.data < de) de = l.data;
    if (!ate || l.data > ate) ate = l.data;
  }
  const creditos = linhas.filter(l => l.valor > 0);
  const debitos = linhas.filter(l => l.valor < 0);
  const entrou = somaPor(creditos, l => l.valor);
  const saiu = round2(Math.abs(somaPor(debitos, l => l.valor)));
  // Ignorada é decisão tomada: conta como conferida. Divergente ainda não.
  const resolvidas = linhas.filter(l => l.status_conciliacao === 'CONCILIADO' || l.status_conciliacao === 'IGNORADO');
  const abertas = linhas.filter(l => l.status_conciliacao === 'PENDENTE' || l.status_conciliacao === 'DIVERGENTE');
  return {
    de,
    ate,
    entrou,
    saiu,
    resultado: round2(entrou - saiu),
    creditos: creditos.length,
    debitos: debitos.length,
    linhas: linhas.length,
    conferidas: resolvidas.length,
    a_conferir: abertas.length,
    a_conferir_valor: round2(Math.abs(somaPor(abertas, l => Math.abs(l.valor)))),
    pct_conferido: Math.round(divSegura(resolvidas.length, linhas.length) * 100),
  };
}

/** Os meses que o extrato cobre, do mais recente ao mais antigo. */
export function mesesDoExtrato(linhas: readonly { data: string }[]): string[] {
  return [...new Set(linhas.map(l => mesDe(l.data)).filter(Boolean))].sort().reverse();
}
