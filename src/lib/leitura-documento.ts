/**
 * "Ler boleto ou nota" (05/11/2026): a parte PURA.
 *
 * A IA lê o documento (boleto, nota fiscal, fatura de fornecedor ou de
 * operadora) e devolve o que achou. Daqui para a frente nada é da IA:
 *
 *  1. `normalizarExtracao` limpa o que veio (tamanho, tipos, CNPJ só com 11
 *     ou 14 dígitos, data real, valor positivo). Texto do documento é dado.
 *  2. `conferirLeitura` passa a linha digitável pelo leitor puro
 *     (boleto-linha.ts). O que o boleto diz com dígito verificador certo é o
 *     que vale; se a IA leu outro valor ou outra data, a divergência aparece e
 *     o campo NÃO é preenchido. Linha que não confere também não preenche o
 *     valor.
 *
 * Nada aqui grava. A tela mostra o resultado com a origem de cada campo para
 * a pessoa conferir, e só o "Criar conta" salva.
 *
 * Sem imports de servidor: a tela usa as mesmas funções para conferir a linha
 * que a pessoa corrigir à mão.
 */
import { formatarLinhaDigitavel, lerLinhaDoBoleto, SEGMENTOS_ARRECADACAO, soDigitosDoBoleto } from './boleto-linha';

export const TIPOS_DE_DOCUMENTO = ['boleto', 'nota_fiscal', 'fatura', 'recibo', 'outro'] as const;
export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

export const ROTULO_DO_TIPO: Record<TipoDeDocumento, string> = {
  boleto: 'Boleto',
  nota_fiscal: 'Nota fiscal',
  fatura: 'Fatura',
  recibo: 'Recibo',
  outro: 'Documento',
};

/** O que a IA leu, já limpo. Campo que ela não achou fica vazio ou null. */
export interface ExtracaoDoDocumento {
  tipo_documento: TipoDeDocumento;
  fornecedor_nome: string;
  /** Só dígitos, 11 (CPF) ou 14 (CNPJ). Outra coisa vira vazio. */
  fornecedor_cnpj: string;
  descricao: string;
  /** Em reais. */
  valor: number | null;
  /** AAAA-MM-DD. */
  vencimento: string | null;
  data_emissao: string | null;
  numero_documento: string;
  /** Só dígitos (44, 47 ou 48), como a IA leu. Ainda não conferida. */
  linha_digitavel: string;
  chave_pix: string;
}

/** De onde veio o valor de um campo, para a tela dizer. */
export type OrigemDoCampo = 'boleto' | 'documento';

export interface BoletoConferido {
  /** A linha passou em todos os dígitos verificadores. */
  confere: boolean;
  /** Linha formatada como no papel (ou os dígitos lidos, se não conferiu). */
  linha_digitavel: string;
  codigo_de_barras: string;
  tipo: 'bancario' | 'arrecadacao' | null;
  /** "Banco 237" ou o segmento da conta de consumo. */
  emissor: string;
  /** Frase para a tela quando não confere. */
  mensagem: string;
}

export interface Divergencia {
  campo: 'valor' | 'vencimento';
  /** Para mostrar: "R$ 3.900,00" ou "12/06/2018". */
  no_documento: string;
  no_boleto: string;
  /** Para aplicar quando a pessoa escolhe: reais ("3900") ou AAAA-MM-DD. */
  bruto_documento: string;
  bruto_boleto: string;
  mensagem: string;
}

export interface LeituraDoDocumento {
  tipo_documento: TipoDeDocumento;
  fornecedor_nome: string;
  fornecedor_cnpj: string;
  descricao: string;
  /** Null = não preencher (não leu, ou leu e não confere). */
  valor: number | null;
  valor_origem: OrigemDoCampo | null;
  vencimento: string | null;
  vencimento_origem: OrigemDoCampo | null;
  data_emissao: string | null;
  numero_documento: string;
  chave_pix: string;
  boleto: BoletoConferido | null;
  divergencias: Divergencia[];
  avisos: string[];
}

export interface FornecedorSugerido {
  id: string;
  nome: string;
  documento: string;
  /** Como foi achado: o CNPJ bateu, ou o nome (único, sem documento em conflito). */
  como: 'documento' | 'nome';
}

export interface CategoriaSugerida {
  id: string;
  codigo: string;
  nome: string;
  /** Em quantas contas desse fornecedor a agência usou esta categoria. */
  vezes: number;
}

export interface SugestoesDaLeitura {
  fornecedor: FornecedorSugerido | null;
  /** Leu um fornecedor que não existe no cadastro: a tela oferece criar. */
  sugerir_criar: boolean;
  categorias: CategoriaSugerida[];
}

/** O que POST /api/leitura-documento devolve. */
export interface RespostaDaLeitura {
  leitura: LeituraDoDocumento;
  sugestoes: SugestoesDaLeitura;
  anexo: { nome: string; url: string };
  hash: string;
  /** O mesmo arquivo já tinha sido lido: veio da guarda, sem chamar a IA. */
  repetida: boolean;
  gravado: false;
}

const txt = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function dataValida(v: unknown): string | null {
  const s = txt(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== s) return null;
  const ano = Number(s.slice(0, 4));
  return ano >= 2000 && ano <= 2100 ? s : null;
}

/** Valor em reais. Aceita número ou texto "1.234,56" / "1234.56". */
export function valorEmReais(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const s = v.replace(/[R$\s]/g, '');
    const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    n = Number(normal);
  } else return null;
  if (!Number.isFinite(n) || n <= 0 || n > 1e10) return null;
  return Math.round(n * 100) / 100;
}

/**
 * O JSON da resposta do modelo. O modelo às vezes embrulha em cerca de
 * código; recortar do primeiro "{" ao último "}" é mais honesto do que pedir
 * "sem markdown" e torcer.
 */
export function jsonDaResposta(texto: string): Record<string, unknown> | null {
  const inicio = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;
  try {
    const v = JSON.parse(texto.slice(inicio, fim + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function normalizarExtracao(bruto: Record<string, unknown> | null | undefined): ExtracaoDoDocumento {
  const b = bruto ?? {};
  const tipo = txt(b.tipo_documento, 20) as TipoDeDocumento;
  const doc = soDigitosDoBoleto(b.fornecedor_cnpj);
  const linha = soDigitosDoBoleto(b.linha_digitavel);
  return {
    tipo_documento: TIPOS_DE_DOCUMENTO.includes(tipo) ? tipo : 'outro',
    fornecedor_nome: txt(b.fornecedor_nome, 160),
    fornecedor_cnpj: doc.length === 11 || doc.length === 14 ? doc : '',
    descricao: txt(b.descricao, 200),
    valor: valorEmReais(b.valor),
    vencimento: dataValida(b.vencimento),
    data_emissao: dataValida(b.data_emissao),
    numero_documento: txt(b.numero_documento, 60),
    // Linha com tamanho de boleto passa adiante para ser conferida; o resto
    // (número de nota, CNPJ trocado de campo) é descartado aqui.
    linha_digitavel: [44, 47, 48].includes(linha.length) ? linha : '',
    chave_pix: txt(b.chave_pix, 400),
  };
}

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Confere a leitura da IA com o leitor puro do boleto.
 *
 * @param hoje AAAA-MM-DD, para o ciclo do fator de vencimento.
 */
export function conferirLeitura(ext: ExtracaoDoDocumento, hoje: string): LeituraDoDocumento {
  const saida: LeituraDoDocumento = {
    tipo_documento: ext.tipo_documento,
    fornecedor_nome: ext.fornecedor_nome,
    fornecedor_cnpj: ext.fornecedor_cnpj,
    descricao: ext.descricao,
    valor: ext.valor,
    valor_origem: ext.valor !== null ? 'documento' : null,
    vencimento: ext.vencimento,
    vencimento_origem: ext.vencimento ? 'documento' : null,
    data_emissao: ext.data_emissao,
    numero_documento: ext.numero_documento,
    chave_pix: ext.chave_pix,
    boleto: null,
    divergencias: [],
    avisos: [],
  };

  if (!ext.linha_digitavel) {
    if (ext.tipo_documento === 'boleto') {
      saida.avisos.push('A linha digitável não foi encontrada. Confira o valor e o vencimento no papel.');
    }
    return saida;
  }

  const lido = lerLinhaDoBoleto(ext.linha_digitavel, hoje);
  if (!lido.ok) {
    saida.boleto = {
      confere: false,
      linha_digitavel: formatarLinhaDigitavel(ext.linha_digitavel),
      codigo_de_barras: '',
      tipo: null,
      emissor: '',
      mensagem: lido.mensagem,
    };
    // Boleto que não confere não preenche valor: o número lido pode estar
    // trocado, e é dinheiro saindo.
    saida.valor = null;
    saida.valor_origem = null;
    saida.avisos.push('A linha digitável lida não confere. O valor não foi preenchido: confira no papel.');
    return saida;
  }

  saida.boleto = {
    confere: true,
    linha_digitavel: formatarLinhaDigitavel(lido.linhaDigitavel),
    codigo_de_barras: lido.codigoDeBarras,
    tipo: lido.tipo,
    emissor: lido.tipo === 'bancario'
      ? `Banco ${lido.banco}`
      : SEGMENTOS_ARRECADACAO[lido.segmento] ?? 'Conta de consumo',
    mensagem: '',
  };

  // Valor: o do boleto, quando está em reais e preenchido.
  if (lido.emReais && lido.valorCentavos > 0) {
    const doBoleto = lido.valorCentavos;
    const daIa = ext.valor === null ? null : Math.round(ext.valor * 100);
    if (daIa === null || daIa === doBoleto) {
      saida.valor = doBoleto / 100;
      saida.valor_origem = 'boleto';
    } else {
      saida.valor = null;
      saida.valor_origem = null;
      saida.divergencias.push({
        campo: 'valor',
        no_documento: brl(daIa),
        no_boleto: brl(doBoleto),
        bruto_documento: String(daIa / 100),
        bruto_boleto: String(doBoleto / 100),
        mensagem: `O documento mostra ${brl(daIa)}, mas o código do boleto diz ${brl(doBoleto)}. Confira qual é o certo.`,
      });
    }
  } else if (saida.valor !== null) {
    saida.avisos.push('O código do boleto não traz o valor. O valor veio do documento: confira.');
  }

  // Vencimento: só o boleto bancário tem data no código.
  if (lido.tipo === 'bancario' && lido.vencimento) {
    if (!ext.vencimento || ext.vencimento === lido.vencimento) {
      saida.vencimento = lido.vencimento;
      saida.vencimento_origem = 'boleto';
    } else {
      saida.vencimento = null;
      saida.vencimento_origem = null;
      saida.divergencias.push({
        campo: 'vencimento',
        no_documento: dataBR(ext.vencimento),
        no_boleto: dataBR(lido.vencimento),
        bruto_documento: ext.vencimento,
        bruto_boleto: lido.vencimento,
        mensagem: `O documento mostra vencimento em ${dataBR(ext.vencimento)}, mas o código do boleto diz ${dataBR(lido.vencimento)}. Confira qual é o certo.`,
      });
    }
  }

  return saida;
}

/** CNPJ ou CPF com a pontuação de costume. */
export function formatarDocumento(d: string): string {
  const s = soDigitosDoBoleto(d);
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  return s;
}
