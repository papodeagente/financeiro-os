/**
 * CHEQUES EMITIDOS (E7, frente C, 06/11/2026). Lógica pura: não toca banco
 * nem rede, serve a tela, a impressão e o servidor.
 *
 *  - O valor por extenso do cheque, em DUAS linhas (a primeira mais curta,
 *    depois de "Pague por este cheque a quantia de"), com o fim de cada linha
 *    preenchido por asteriscos para ninguém acrescentar nada.
 *  - A cidade e a data por extenso ("São Paulo, 6 de novembro de 2026").
 *  - O desenho do cheque padrão brasileiro (175 × 80 mm), campo a campo, em
 *    milímetros, com o ajuste de margens que cada conta bancária guarda (cada
 *    banco imprime o formulário um pouco deslocado).
 *  - O número do cheque (só algarismos, até 12: a mesma regra da liquidação,
 *    baixa-meio.ts).
 *  - A vida do cheque: Emitido → Compensado, Devolvido ou Cancelado, com as
 *    passagens permitidas e as frases para a pessoa.
 *
 * Dinheiro em centavos inteiros.
 */
import { comMaiuscula, valorPorExtenso } from './cobranca/extenso';
import { ErroDoMeio, lerMeioDoPagamento } from './baixa-meio';

// ============================================================
// Situações
// ============================================================

export const SITUACOES_DO_CHEQUE = ['EMITIDO', 'COMPENSADO', 'DEVOLVIDO', 'CANCELADO'] as const;
export type SituacaoDoCheque = (typeof SITUACOES_DO_CHEQUE)[number];

export const ROTULO_SITUACAO_CHEQUE: Record<SituacaoDoCheque, string> = {
  EMITIDO: 'Emitido',
  COMPENSADO: 'Compensado',
  DEVOLVIDO: 'Devolvido',
  CANCELADO: 'Cancelado',
};

export const ACOES_DO_CHEQUE = ['compensar', 'devolver', 'cancelar'] as const;
export type AcaoDoCheque = (typeof ACOES_DO_CHEQUE)[number];

/**
 * Para onde cada ação leva e de onde ela pode partir:
 *  - compensar: o banco descontou o cheque. Parte de Emitido ou de Devolvido
 *    (o fornecedor reapresentou e desta vez passou).
 *  - devolver: o banco devolveu o cheque (falta de fundos, divergência,
 *    sustação). Parte de Emitido ou de Compensado (devolução depois do
 *    desconto, dentro do prazo da compensação).
 *  - cancelar: o cheque não vai ser usado (rasgado, preenchido errado,
 *    substituído). Parte de Emitido ou de Devolvido. Cheque compensado não se
 *    cancela: o dinheiro já saiu.
 * Cancelado é o fim: não volta.
 */
export const TRANSICOES_DO_CHEQUE: Record<AcaoDoCheque, { para: SituacaoDoCheque; de: readonly SituacaoDoCheque[] }> = {
  compensar: { para: 'COMPENSADO', de: ['EMITIDO', 'DEVOLVIDO'] },
  devolver: { para: 'DEVOLVIDO', de: ['EMITIDO', 'COMPENSADO'] },
  cancelar: { para: 'CANCELADO', de: ['EMITIDO', 'DEVOLVIDO'] },
};

/** A ação pode ser feita a partir desta situação? Devolve a recusa (frase) ou null. */
export function recusaDaTransicao(acao: AcaoDoCheque, atual: SituacaoDoCheque): string | null {
  const t = TRANSICOES_DO_CHEQUE[acao];
  if (t.de.includes(atual)) return null;
  if (atual === 'CANCELADO') return 'Este cheque está cancelado. Nada mais muda nele.';
  if (acao === 'cancelar' && atual === 'COMPENSADO') return 'Cheque compensado não se cancela: o dinheiro já saiu da conta. Se o banco devolveu, marque como devolvido.';
  if (acao === 'compensar' && atual === 'COMPENSADO') return 'Este cheque já está compensado.';
  if (acao === 'devolver' && atual === 'DEVOLVIDO') return 'Este cheque já está marcado como devolvido.';
  return `Não dá para ${acao} um cheque ${ROTULO_SITUACAO_CHEQUE[atual].toLowerCase()}.`;
}

/** As ações que a tela oferece para um cheque nesta situação. */
export function acoesPossiveis(atual: SituacaoDoCheque): AcaoDoCheque[] {
  return ACOES_DO_CHEQUE.filter(a => recusaDaTransicao(a, atual) === null);
}

/** Motivo obrigatório para devolver e cancelar (pelo menos 3 letras). */
export function recusaDoMotivo(acao: AcaoDoCheque, motivo: string | null | undefined): string | null {
  if (acao === 'compensar') return null;
  const m = String(motivo ?? '').trim();
  if (m.length < 3) return acao === 'devolver' ? 'Diga por que o banco devolveu o cheque.' : 'Diga por que o cheque foi cancelado.';
  return null;
}

// ============================================================
// Número do cheque
// ============================================================

/** Número limpo (só algarismos, até 12) ou a frase da recusa. */
export function lerNumeroDoCheque(v: unknown): { ok: true; numero: string } | { ok: false; erro: string } {
  const bruto = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
  if (!bruto.trim()) return { ok: false, erro: 'Informe o número do cheque.' };
  try {
    const meio = lerMeioDoPagamento('CHEQUE', { cheque_numero: bruto });
    return meio.cheque_numero ? { ok: true, numero: meio.cheque_numero } : { ok: false, erro: 'Informe o número do cheque.' };
  } catch (e) {
    return { ok: false, erro: e instanceof ErroDoMeio ? e.message : 'Número do cheque inválido.' };
  }
}

/** O próximo número do talão: o anterior + 1, com os mesmos zeros à esquerda. */
export function proximoNumero(ultimo: string | null | undefined): string {
  const s = String(ultimo ?? '').replace(/\D/g, '');
  if (!s) return '';
  const n = (BigInt(s) + BigInt(1)).toString();
  return n.length >= s.length ? n : n.padStart(s.length, '0');
}

// ============================================================
// Valor e data por extenso
// ============================================================

/** Quantos caracteres cabem em cada linha do extenso (letra de 3 mm). */
export const CAPACIDADE_DO_EXTENSO = { linha1: 58, linha2: 74 } as const;

/** "1.234,56" a partir de centavos. */
export function valorNumerico(centavos: number): string {
  const c = Math.round(Math.abs(centavos));
  return (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** O valor no quadro do cheque, travado dos dois lados: "#1.234,56#". */
export function valorNoQuadro(centavos: number): string {
  return `#${valorNumerico(centavos)}#`;
}

const preencher = (texto: string, cap: number) => {
  if (!texto) return '*'.repeat(cap);
  const falta = cap - texto.length - 1;
  return falta > 0 ? `${texto} ${'*'.repeat(falta)}` : texto;
};

/**
 * O extenso em duas linhas: palavras inteiras (nunca corta uma palavra), o
 * que sobra de cada linha preenchido com asteriscos. Se não couber nas duas,
 * `cabe` é false (a tela avisa; valores assim não existem num talão).
 */
export function extensoEmDuasLinhas(
  centavos: number, cap: { linha1: number; linha2: number } = CAPACIDADE_DO_EXTENSO,
): { linha1: string; linha2: string; texto: string; cabe: boolean } {
  if (!Number.isFinite(centavos) || centavos <= 0) throw new RangeError('O valor do cheque precisa ser maior que zero.');
  const texto = comMaiuscula(valorPorExtenso(Math.round(centavos) / 100));
  const palavras = texto.split(' ');
  const l1: string[] = [];
  let i = 0;
  while (i < palavras.length && [...l1, palavras[i]].join(' ').length <= cap.linha1) l1.push(palavras[i++]);
  const resto = palavras.slice(i).join(' ');
  const cabe = resto.length <= cap.linha2;
  return {
    linha1: preencher(l1.join(' '), cap.linha1),
    linha2: preencher(resto, cap.linha2),
    texto,
    cabe,
  };
}

export const MESES_POR_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] as const;

/** "6 de novembro de 2026" a partir de AAAA-MM-DD (vazio se a data não vale). */
export function dataPorExtenso(iso: string | null | undefined): string {
  const s = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const mes = Number(s.slice(5, 7));
  const dia = Number(s.slice(8, 10));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return '';
  return `${dia} de ${MESES_POR_EXTENSO[mes - 1]} de ${s.slice(0, 4)}`;
}

/** "São Paulo, 6 de novembro de 2026" (sem cidade: só a data). */
export function localEData(cidade: string | null | undefined, iso: string | null | undefined): string {
  const c = String(cidade ?? '').replace(/\s+/g, ' ').trim();
  const d = dataPorExtenso(iso);
  return [c, d].filter(Boolean).join(', ');
}

// ============================================================
// Desenho do cheque (padrão brasileiro, 175 × 80 mm)
// ============================================================

export const CAMPOS_DO_CHEQUE = ['valor', 'extenso1', 'extenso2', 'favorecido', 'local_data'] as const;
export type CampoDoCheque = (typeof CAMPOS_DO_CHEQUE)[number];

export const ROTULO_CAMPO_DO_CHEQUE: Record<CampoDoCheque, string> = {
  valor: 'Valor',
  extenso1: 'Extenso, 1ª linha',
  extenso2: 'Extenso, 2ª linha',
  favorecido: 'Favorecido',
  local_data: 'Cidade e data',
};

export const TAMANHO_DO_CHEQUE = { largura_mm: 175, altura_mm: 80 } as const;

/** Onde cada campo começa (canto de cima à esquerda do texto), em mm, e a largura que ele ocupa. */
export const POSICOES_PADRAO: Record<CampoDoCheque, { x: number; y: number; largura: number }> = {
  valor: { x: 128, y: 6, largura: 42 },
  extenso1: { x: 46, y: 16, largura: 125 },
  extenso2: { x: 6, y: 23, largura: 165 },
  favorecido: { x: 12, y: 31, largura: 159 },
  local_data: { x: 78, y: 40, largura: 93 },
};

/** O ajuste guardado na conta bancária (contas_bancarias.data.cheque). */
export interface ConfigDoCheque {
  /** Desloca o cheque inteiro: + direita / + para baixo. */
  deslocar_x_mm: number;
  deslocar_y_mm: number;
  /** Ajuste fino por campo, somado ao geral. */
  campos: Partial<Record<CampoDoCheque, { x: number; y: number }>>;
  /** Cidade que vai no cheque quando a pessoa não diz outra. */
  cidade_padrao: string;
  /** Último número usado (sugere o próximo). */
  ultimo_numero: string;
}

export const CONFIG_DO_CHEQUE_PADRAO: ConfigDoCheque = { deslocar_x_mm: 0, deslocar_y_mm: 0, campos: {}, cidade_padrao: '', ultimo_numero: '' };

/** Limite do ajuste: além de 30 mm não é ajuste, é outro formulário. */
export const LIMITE_DO_AJUSTE_MM = 30;

const mm = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(-LIMITE_DO_AJUSTE_MM, Math.min(LIMITE_DO_AJUSTE_MM, n)) * 10) / 10;
};

/** Lê o ajuste de qualquer entrada (o que não vale vira zero). */
export function normalizarConfigDoCheque(v: unknown): ConfigDoCheque {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const campos: ConfigDoCheque['campos'] = {};
  const brutos = (o.campos && typeof o.campos === 'object' ? o.campos : {}) as Record<string, unknown>;
  for (const c of CAMPOS_DO_CHEQUE) {
    const x = brutos[c] as Record<string, unknown> | undefined;
    if (!x || typeof x !== 'object') continue;
    const ajuste = { x: mm(x.x), y: mm(x.y) };
    if (ajuste.x || ajuste.y) campos[c] = ajuste;
  }
  const ultimo = String(o.ultimo_numero ?? '').replace(/\D/g, '').slice(0, 12);
  return {
    deslocar_x_mm: mm(o.deslocar_x_mm),
    deslocar_y_mm: mm(o.deslocar_y_mm),
    campos,
    cidade_padrao: String(o.cidade_padrao ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
    ultimo_numero: ultimo,
  };
}

export interface DadosDaImpressao {
  valor_centavos: number;
  favorecido: string;
  cidade: string;
  /** Data do cheque (a que vai escrita; o "bom para" quando houver). */
  data: string;
}

export interface CampoDesenhado { campo: CampoDoCheque; texto: string; x: number; y: number; largura: number }

export interface DesenhoDoCheque {
  largura_mm: number;
  altura_mm: number;
  campos: CampoDesenhado[];
  /** O extenso não coube nas duas linhas (a pessoa precisa preencher à mão). */
  extenso_nao_cabe: boolean;
}

/** O cheque pronto para imprimir: cada texto e onde ele vai, já com o ajuste da conta. */
export function desenharCheque(d: DadosDaImpressao, config: ConfigDoCheque = CONFIG_DO_CHEQUE_PADRAO): DesenhoDoCheque {
  const ext = extensoEmDuasLinhas(d.valor_centavos);
  const textos: Record<CampoDoCheque, string> = {
    valor: valorNoQuadro(d.valor_centavos),
    extenso1: ext.linha1,
    extenso2: ext.linha2,
    favorecido: String(d.favorecido ?? '').replace(/\s+/g, ' ').trim(),
    local_data: localEData(d.cidade, d.data),
  };
  const campos = CAMPOS_DO_CHEQUE.map(c => {
    const p = POSICOES_PADRAO[c];
    const fino = config.campos[c] ?? { x: 0, y: 0 };
    return {
      campo: c, texto: textos[c], largura: p.largura,
      x: Math.round((p.x + config.deslocar_x_mm + fino.x) * 10) / 10,
      y: Math.round((p.y + config.deslocar_y_mm + fino.y) * 10) / 10,
    };
  });
  return { ...TAMANHO_DO_CHEQUE, campos, extenso_nao_cabe: !ext.cabe };
}

// ============================================================
// Entrada da emissão
// ============================================================

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface PedidoDeEmissao {
  titulo_id: string;
  conta_bancaria_id: string;
  numero: string;
  emissao: string;
  bom_para: string | null;
  favorecido: string;
  cidade: string;
  /** Vazio = o saldo em aberto da conta a pagar. */
  valor_centavos: number | null;
}

/** Confere o que veio da tela. Devolve o pedido limpo ou a primeira recusa. */
export function lerPedidoDeEmissao(v: unknown, hoje: string): { ok: true; pedido: PedidoDeEmissao } | { ok: false; erro: string } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const titulo = String(o.titulo_id ?? '').trim().slice(0, 120);
  if (!titulo) return { ok: false, erro: 'Escolha a conta a pagar do cheque.' };
  const conta = String(o.conta_bancaria_id ?? '').trim().slice(0, 120);
  if (!conta) return { ok: false, erro: 'Escolha a conta bancária do talão.' };
  const n = lerNumeroDoCheque(o.numero);
  if (!n.ok) return n;
  const emissao = String(o.emissao ?? '').slice(0, 10) || hoje;
  if (!ISO.test(emissao)) return { ok: false, erro: 'Data do cheque inválida.' };
  const bomBruto = String(o.bom_para ?? '').slice(0, 10);
  if (bomBruto && !ISO.test(bomBruto)) return { ok: false, erro: 'Data do "bom para" inválida.' };
  if (bomBruto && bomBruto < emissao) return { ok: false, erro: 'O "bom para" não pode ser antes da data do cheque.' };
  const favorecido = String(o.favorecido ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  let valor: number | null = null;
  if (o.valor_centavos !== undefined && o.valor_centavos !== null && o.valor_centavos !== '') {
    const c = Math.round(Number(o.valor_centavos));
    if (!Number.isFinite(c) || c <= 0) return { ok: false, erro: 'O valor do cheque precisa ser maior que zero.' };
    valor = c;
  }
  return {
    ok: true,
    pedido: {
      titulo_id: titulo, conta_bancaria_id: conta, numero: n.numero, emissao, bom_para: bomBruto || null,
      favorecido, cidade: String(o.cidade ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), valor_centavos: valor,
    },
  };
}
