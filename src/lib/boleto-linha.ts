/**
 * Leitor PURO da linha digitável e do código de barras de boleto (05/11/2026).
 *
 * Existe para conferir o que a IA leu de um boleto: a IA sugere, este leitor
 * confere. Ele não depende de rede, banco ou modelo, e só aceita a linha se
 * TODOS os dígitos verificadores baterem.
 *
 * Dois padrões da FEBRABAN:
 *
 *  - Boleto de cobrança (bancário): código de barras de 44 dígitos, linha
 *    digitável de 47. Traz banco, moeda, fator de vencimento e valor.
 *      barras: BBB M D FFFF VVVVVVVVVV LLLLLLLLLLLLLLLLLLLLLLLLL
 *              banco(3) moeda(1) DV geral(1) fator(4) valor(10) campo livre(25)
 *      linha:  campo 1 = banco+moeda+livre[0..5)  + DV (módulo 10)
 *              campo 2 = livre[5..15)             + DV (módulo 10)
 *              campo 3 = livre[15..25)            + DV (módulo 10)
 *              campo 4 = DV geral (módulo 11 do código de barras)
 *              campo 5 = fator + valor
 *
 *  - Arrecadação (concessionária, tributo, convênio): código de barras de 44
 *    dígitos começando por 8, linha digitável de 48 (4 blocos de 11 + DV).
 *    O 3º dígito diz se o valor é em reais (6 ou 8) ou referência (7 ou 9) e
 *    qual módulo vale (6/7 = módulo 10; 8/9 = módulo 11). Esse padrão não tem
 *    campo de vencimento: a data fica com o documento.
 *
 * O FATOR DE VENCIMENTO conta dias desde 07/10/1997 e tem 4 dígitos. Em
 * 21/02/2025 ele chegou a 9999 e, no dia seguinte, recomeçou em 1000
 * (22/02/2025 = 1000). O mesmo fator, então, aponta para duas datas; vale a
 * mais próxima da data de referência (hoje), que é a regra que os bancos
 * adotaram na virada.
 */

export type MotivoRecusa = 'vazio' | 'tamanho' | 'digito' | 'formato';

export type BoletoBancario = {
  ok: true;
  tipo: 'bancario';
  codigoDeBarras: string;
  linhaDigitavel: string;
  /** Código do banco (3 dígitos). */
  banco: string;
  /** 9 = real. Outro código: valor não é em reais. */
  moeda: string;
  fator: number;
  /** AAAA-MM-DD. Null quando o fator é 0000 (boleto sem vencimento). */
  vencimento: string | null;
  /** Em centavos. 0 = valor em branco (quem paga informa). */
  valorCentavos: number;
  /** O valor está em reais (moeda 9). */
  emReais: boolean;
};

export type BoletoArrecadacao = {
  ok: true;
  tipo: 'arrecadacao';
  codigoDeBarras: string;
  linhaDigitavel: string;
  /** 1 prefeitura, 2 saneamento, 3 energia e gás, 4 telecomunicações... */
  segmento: string;
  /** Este padrão não tem data no código. */
  vencimento: null;
  valorCentavos: number;
  /** Identificador 6 ou 8: valor efetivo em reais. 7 ou 9: valor de referência. */
  emReais: boolean;
};

export type BoletoRecusado = {
  ok: false;
  motivo: MotivoRecusa;
  /** Frase pronta para a tela. */
  mensagem: string;
};

export type LeituraDoBoleto = BoletoBancario | BoletoArrecadacao | BoletoRecusado;

const DIA_MS = 24 * 60 * 60 * 1000;
/** Fator 0 do primeiro ciclo. */
const BASE_ANTIGA = Date.UTC(1997, 9, 7);
/** Fator 1000 do segundo ciclo (o dia seguinte ao fator 9999 do primeiro). */
const BASE_NOVA = Date.UTC(2025, 1, 22);

export const SEGMENTOS_ARRECADACAO: Record<string, string> = {
  '1': 'Prefeitura',
  '2': 'Saneamento',
  '3': 'Energia elétrica e gás',
  '4': 'Telecomunicações',
  '5': 'Órgão do governo',
  '6': 'Carnê ou convênio',
  '7': 'Multa de trânsito',
  '9': 'Uso do banco',
};

/** Só os dígitos. Aceita a linha copiada com pontos, espaços e traços. */
export function soDigitosDoBoleto(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** Módulo 10 da FEBRABAN: pesos 2,1,2,1... da direita, soma dos algarismos. */
export function modulo10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    let p = Number(numero[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** Soma ponderada 2..9 da direita para a esquerda, resto por 11. */
function resto11(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma % 11;
}

/** DV geral do boleto bancário: 0, 10 e 11 viram 1. */
export function modulo11Bancario(numero: string): number {
  const dv = 11 - resto11(numero);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** DV da arrecadação em módulo 11: resto 0 ou 1 vira 0. */
export function modulo11Arrecadacao(numero: string): number {
  const dv = 11 - resto11(numero);
  return dv >= 10 ? 0 : dv;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Data do fator de vencimento. Entre os dois ciclos, vale a data mais
 * próxima de `referencia` (AAAA-MM-DD, normalmente hoje).
 */
export function dataDoFator(fator: number, referencia: string): string | null {
  if (!Number.isInteger(fator) || fator <= 0 || fator > 9999) return null;
  const ref = Date.parse(`${referencia}T00:00:00Z`);
  const antiga = BASE_ANTIGA + fator * DIA_MS;
  // O segundo ciclo só tem fatores de 1000 a 9999.
  if (fator < 1000 || !Number.isFinite(ref)) return iso(antiga);
  const nova = BASE_NOVA + (fator - 1000) * DIA_MS;
  return Math.abs(nova - ref) < Math.abs(antiga - ref) ? iso(nova) : iso(antiga);
}

function recusa(motivo: MotivoRecusa, mensagem: string): BoletoRecusado {
  return { ok: false, motivo, mensagem };
}

/** Linha digitável bancária (47) a partir do código de barras (44). */
function linhaBancaria(barras: string): string {
  const livre = barras.slice(19);
  const c1 = barras.slice(0, 4) + livre.slice(0, 5);
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  return c1 + modulo10(c1) + c2 + modulo10(c2) + c3 + modulo10(c3) + barras[4] + barras.slice(5, 19);
}

function lerBancario(barras: string, referencia: string, linhaInformada: string | null): LeituraDoBoleto {
  const semDv = barras.slice(0, 4) + barras.slice(5);
  if (modulo11Bancario(semDv) !== Number(barras[4])) {
    return recusa('digito', 'O dígito verificador geral do boleto não confere. Confira os números no papel.');
  }
  const fator = Number(barras.slice(5, 9));
  const moeda = barras[3];
  return {
    ok: true,
    tipo: 'bancario',
    codigoDeBarras: barras,
    linhaDigitavel: linhaInformada ?? linhaBancaria(barras),
    banco: barras.slice(0, 3),
    moeda,
    fator,
    vencimento: dataDoFator(fator, referencia),
    valorCentavos: Number(barras.slice(9, 19)),
    emReais: moeda === '9',
  };
}

function moduloDaArrecadacao(identificador: string): ((n: string) => number) | null {
  if (identificador === '6' || identificador === '7') return modulo10;
  if (identificador === '8' || identificador === '9') return modulo11Arrecadacao;
  return null;
}

function lerArrecadacao(barras: string, linhaInformada: string | null): LeituraDoBoleto {
  const identificador = barras[2];
  const modulo = moduloDaArrecadacao(identificador);
  if (!modulo) return recusa('formato', 'Este código de arrecadação não segue o padrão dos bancos.');
  const semDv = barras.slice(0, 3) + barras.slice(4);
  if (modulo(semDv) !== Number(barras[3])) {
    return recusa('digito', 'O dígito verificador geral da conta não confere. Confira os números no papel.');
  }
  const blocos = [0, 11, 22, 33].map((i) => barras.slice(i, i + 11));
  return {
    ok: true,
    tipo: 'arrecadacao',
    codigoDeBarras: barras,
    linhaDigitavel: linhaInformada ?? blocos.map((b) => b + modulo(b)).join(''),
    segmento: barras[1],
    vencimento: null,
    valorCentavos: Number(barras.slice(4, 15)),
    emReais: identificador === '6' || identificador === '8',
  };
}

/**
 * Lê a linha digitável (47 ou 48 dígitos) ou o código de barras (44) de um
 * boleto, conferindo todos os dígitos verificadores.
 *
 * @param referencia data de hoje (AAAA-MM-DD), para escolher o ciclo do fator.
 */
export function lerLinhaDoBoleto(entrada: unknown, referencia: string): LeituraDoBoleto {
  const d = soDigitosDoBoleto(entrada);
  if (!d) return recusa('vazio', 'Nenhum número de boleto.');

  if (d.length === 44) {
    return d[0] === '8' ? lerArrecadacao(d, null) : lerBancario(d, referencia, null);
  }

  if (d.length === 47) {
    if (d[0] === '8') return recusa('formato', 'Linha de 47 números que começa com 8 não é de um boleto válido.');
    const campos: Array<[string, string]> = [[d.slice(0, 9), d[9]], [d.slice(10, 20), d[20]], [d.slice(21, 31), d[31]]];
    for (let i = 0; i < campos.length; i++) {
      const [numero, dv] = campos[i];
      if (modulo10(numero) !== Number(dv)) {
        return recusa('digito', `O ${i + 1}º bloco da linha digitável não confere. Confira os números no papel.`);
      }
    }
    const barras = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    return lerBancario(barras, referencia, d);
  }

  if (d.length === 48) {
    if (d[0] !== '8') return recusa('formato', 'Linha de 48 números é de conta de consumo e começa com 8.');
    const modulo = moduloDaArrecadacao(d[2]);
    if (!modulo) return recusa('formato', 'Este código de arrecadação não segue o padrão dos bancos.');
    for (let i = 0; i < 4; i++) {
      const bloco = d.slice(i * 12, i * 12 + 11);
      if (modulo(bloco) !== Number(d[i * 12 + 11])) {
        return recusa('digito', `O ${i + 1}º bloco da linha digitável não confere. Confira os números no papel.`);
      }
    }
    const barras = [0, 1, 2, 3].map((i) => d.slice(i * 12, i * 12 + 11)).join('');
    return lerArrecadacao(barras, d);
  }

  return recusa('tamanho', `A linha tem ${d.length} números. Boleto tem 47, conta de consumo tem 48 e o código de barras tem 44.`);
}

/** Linha digitável com a pontuação de costume, para mostrar. */
export function formatarLinhaDigitavel(linha: string): string {
  const d = soDigitosDoBoleto(linha);
  if (d.length === 47) {
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
  }
  if (d.length === 48) {
    return [0, 1, 2, 3].map((i) => `${d.slice(i * 12, i * 12 + 11)}-${d[i * 12 + 11]}`).join(' ');
  }
  return d;
}
