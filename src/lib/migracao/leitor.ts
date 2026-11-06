/**
 * Mudança de sistema (E4, 05/11/2026): leitor das planilhas exportadas do
 * sistema anterior. Sem banco.
 *
 * Aceita XLSX, XLS (inclusive o "xls" que na verdade é HTML, comum em
 * exportações antigas), ODS, CSV (separado por ; ou ,) e TXT tabulado, em
 * UTF-8 ou Latin-1. O formato vem dos primeiros bytes, não do nome.
 *
 * Depois de ler, `prepararAba` acha a linha do cabeçalho (pode haver título
 * e período antes dela), separa as linhas de dado das de total do rodapé,
 * de agrupamento ("Grupo: Despesas") e dos avisos de lista cortada ("Essa
 * consulta retornou muitos registros…"). Nada é descartado em silêncio: cada
 * linha guarda o número dela no arquivo e o motivo de ter ficado de fora.
 */
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import { adivinharLista } from './dicionario';
import { lerCentavos, normalizar, texto, type Celula } from './valores';

XLSX.set_cptable(cptable);

export type FormatoDoArquivo = 'xlsx' | 'xls' | 'ods' | 'html' | 'csv' | 'txt';

export interface AbaLida {
  nome: string;
  /** Linhas como vieram (vazias inclusive), na ordem do arquivo. */
  linhas: Celula[][];
  /** Número (1 = primeira) da linha do arquivo que corresponde a linhas[0]. */
  primeiraLinha: number;
}

export interface PlanilhaLida {
  formato: FormatoDoArquivo;
  codificacao: 'utf-8' | 'latin-1' | null;
  separador: ';' | ',' | '\t' | null;
  abas: AbaLida[];
}

export class ErroDeLeitura extends Error {
  readonly codigo: string;
  constructor(mensagem: string, codigo = 'ARQUIVO_ILEGIVEL') {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Limite de linhas de um arquivo (o sistema anterior corta bem antes). */
export const MAX_LINHAS = 60_000;

// ---------------------------------------------------------------------------
// Texto: codificação e CSV

/** Windows-1252 nos bytes 0x80–0x9F (o resto do Latin-1 é o próprio código). */
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** Bytes → texto: UTF-8 quando é UTF-8 válido; senão Latin-1 (Windows-1252). */
export function decodificarTexto(bytes: Uint8Array): { texto: string; codificacao: 'utf-8' | 'latin-1' } {
  let b = bytes;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return { texto: new TextDecoder('utf-8', { fatal: true }).decode(b), codificacao: 'utf-8' };
  } catch {
    let s = '';
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      s += String.fromCharCode(c >= 0x80 && c <= 0x9f ? (CP1252[c] ?? c) : c);
    }
    return { texto: s, codificacao: 'latin-1' };
  }
}

/** Quebra o texto em registros respeitando aspas ("a;b" é um campo só). */
export function lerCsv(conteudo: string, sep: string): string[][] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i];
    if (aspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { campo += '"'; i++; }
        else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"' && campo.trim() === '') { campo = ''; aspas = true; continue; }
    if (c === sep) { linha.push(campo); campo = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

/** O separador que divide as primeiras linhas de forma mais constante. */
export function detectarSeparador(conteudo: string): ';' | ',' | '\t' {
  const amostra = conteudo.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
  let melhor: ';' | ',' | '\t' = ';';
  let melhorNota = -1;
  for (const sep of ['\t', ';', ','] as const) {
    const contagens = amostra.map(l => lerCsv(l, sep)[0]?.length ?? 1);
    const maiores = contagens.filter(n => n > 1);
    if (!maiores.length) continue;
    // A moda das contagens: quantas linhas têm o mesmo número de colunas.
    const freq = new Map<number, number>();
    for (const n of maiores) freq.set(n, (freq.get(n) ?? 0) + 1);
    const [colunas, vezes] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const nota = vezes * 100 + colunas;
    if (nota > melhorNota) { melhorNota = nota; melhor = sep; }
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// Leitura

function formatoPelosBytes(bytes: Uint8Array, nome: string): FormatoDoArquivo {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return /\.ods$/i.test(nome) ? 'ods' : 'xlsx';
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'xls';
  const inicio = decodificarTexto(bytes.subarray(0, 512)).texto.trimStart().slice(0, 100).toLowerCase();
  if (inicio.startsWith('<') && /<(html|table|\?xml|workbook|meta|!doctype)/.test(inicio)) return 'html';
  return /\.txt$/i.test(nome) ? 'txt' : 'csv';
}

function celula(v: unknown): Celula {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return texto(v.toISOString().slice(0, 10));
  const s = String(v);
  return s.trim() === '' ? null : s;
}

/** Lê o arquivo inteiro (todas as abas). Lança ErroDeLeitura com a frase para a tela. */
export function lerPlanilha(nome: string, bytes: Uint8Array): PlanilhaLida {
  if (!bytes.length) throw new ErroDeLeitura('O arquivo está vazio.', 'ARQUIVO_VAZIO');
  const formato = formatoPelosBytes(bytes, nome);
  if (formato === 'csv' || formato === 'txt') {
    const { texto: conteudo, codificacao } = decodificarTexto(bytes);
    const separador = formato === 'txt' && conteudo.includes('\t') ? '\t' : detectarSeparador(conteudo);
    const linhas = lerCsv(conteudo, separador).map(l => l.map(celula));
    if (linhas.length > MAX_LINHAS) throw new ErroDeLeitura(`O arquivo tem mais de ${MAX_LINHAS.toLocaleString('pt-BR')} linhas. Exporte em partes (um arquivo por mês).`, 'ARQUIVO_GRANDE');
    return { formato, codificacao, separador, abas: [{ nome: nome.replace(/\.[^.]+$/, '') || 'Planilha', linhas, primeiraLinha: 1 }] };
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: false, cellHTML: false, dense: false });
  } catch {
    throw new ErroDeLeitura('Não consegui abrir este arquivo. Exporte de novo em Excel (.xlsx) ou Texto (.csv).');
  }
  const abas: AbaLida[] = [];
  for (const nomeAba of wb.SheetNames) {
    const ws = wb.Sheets[nomeAba];
    if (!ws || !ws['!ref']) { abas.push({ nome: nomeAba, linhas: [], primeiraLinha: 1 }); continue; }
    const faixa = XLSX.utils.decode_range(ws['!ref']);
    if (faixa.e.r - faixa.s.r + 1 > MAX_LINHAS) throw new ErroDeLeitura(`A aba "${nomeAba}" tem mais de ${MAX_LINHAS.toLocaleString('pt-BR')} linhas. Exporte em partes (um arquivo por mês).`, 'ARQUIVO_GRANDE');
    const crus = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    abas.push({ nome: nomeAba, linhas: crus.map(l => (Array.isArray(l) ? l.map(celula) : [])), primeiraLinha: faixa.s.r + 1 });
  }
  return { formato, codificacao: null, separador: null, abas };
}

// ---------------------------------------------------------------------------
// Preparação: cabeçalho, dados, totais, agrupamentos e avisos

export type TipoDaLinha = 'dado' | 'total' | 'agrupamento' | 'aviso';

export interface LinhaPreparada {
  /** Número da linha no arquivo (1 = primeira), como a pessoa vê no Excel. */
  numero: number;
  celulas: Celula[];
  tipo: TipoDaLinha;
  /** Linha de agrupamento: "Grupo: Despesas" vira { rotulo: 'Grupo', valor: 'Despesas' }. */
  agrupamento?: { rotulo: string; valor: string };
}

export interface AvisoDoArquivo {
  codigo: 'lista_cortada' | 'lista_pode_estar_cortada' | 'total_do_rodape' | 'sem_cabecalho' | 'linhas_de_agrupamento';
  mensagem: string;
}

export interface AbaPreparada {
  /** Número da linha do cabeçalho no arquivo. */
  linhaCabecalho: number;
  cabecalhos: string[];
  linhas: LinhaPreparada[];
  avisos: AvisoDoArquivo[];
  /** Somas encontradas na linha de total do rodapé: coluna → centavos. */
  totalRodape: Record<number, number>;
}

const RE_CORTADA = /(muitos registros|serao exibidos os|nao foi possivel trazer todos|exibidos os primeiros)/;
const RE_TOTAL = /^(total|totais|soma|subtotal|total geral|qtd|quantidade|registros?)\b|\b\d+ registros?$/;
const RE_AGRUPAMENTO = /^([^:]{2,40}?)\s*:\s*(.+)$/;
/** Números redondos em que uma lista cortada costuma parar. */
const CORTES_COMUNS = new Set([100, 200, 250, 300, 400, 500]);

function preenchidas(l: Celula[]): Celula[] {
  return l.filter(c => c !== null && c !== '' && !(typeof c === 'string' && !c.trim()));
}

function ehNumerico(c: Celula): boolean {
  if (typeof c === 'number') return true;
  return typeof c === 'string' && lerCentavos(c) !== null;
}

/** Acha o cabeçalho entre as primeiras 25 linhas: a que mais casa com o dicionário. */
function acharCabecalho(linhas: Celula[][]): number {
  let melhor = -1;
  let melhorPontos = 1;
  const limite = Math.min(linhas.length, 25);
  for (let i = 0; i < limite; i++) {
    const textos = linhas[i].map(c => (typeof c === 'string' ? c : ''));
    if (preenchidas(linhas[i]).length < 2) continue;
    const pontos = adivinharLista(textos).sugestao.pontos;
    if (pontos > melhorPontos) { melhor = i; melhorPontos = pontos; }
  }
  if (melhor >= 0) return melhor;
  // Sem nada que case: a primeira linha com 2+ textos.
  for (let i = 0; i < limite; i++) {
    const p = preenchidas(linhas[i]);
    if (p.length >= 2 && p.every(c => typeof c === 'string')) return i;
  }
  return linhas.findIndex(l => preenchidas(l).length > 0);
}

/** Separa cabeçalho, dados, totais, agrupamentos e avisos de uma aba. */
export function prepararAba(aba: AbaLida): AbaPreparada {
  const avisos: AvisoDoArquivo[] = [];
  const idx = acharCabecalho(aba.linhas);
  if (idx < 0) {
    return { linhaCabecalho: 0, cabecalhos: [], linhas: [], avisos: [{ codigo: 'sem_cabecalho', mensagem: 'A planilha está vazia.' }], totalRodape: {} };
  }
  const cab = aba.linhas[idx].map(c => texto(c));
  while (cab.length && !cab[cab.length - 1]) cab.pop();
  const ncol = cab.length;
  const linhas: LinhaPreparada[] = [];
  let cortada = false;
  for (let i = idx + 1; i < aba.linhas.length; i++) {
    const celulas = aba.linhas[i].slice(0, Math.max(ncol, 1));
    const cheias = preenchidas(celulas);
    if (!cheias.length) continue;
    const numero = aba.primeiraLinha + i;
    const primeiroTexto = normalizar(cheias.find(c => typeof c === 'string') ?? '');
    if (cheias.some(c => typeof c === 'string' && RE_CORTADA.test(normalizar(c)))) {
      cortada = true;
      linhas.push({ numero, celulas, tipo: 'aviso' });
      continue;
    }
    // Cabeçalho repetido (exportação em páginas): fica de fora como agrupamento.
    if (celulas.every((c, j) => normalizar(c) === normalizar(cab[j] ?? ''))) {
      linhas.push({ numero, celulas, tipo: 'agrupamento', agrupamento: { rotulo: 'cabeçalho repetido', valor: '' } });
      continue;
    }
    if (primeiroTexto && RE_TOTAL.test(primeiroTexto) && cheias.length <= Math.max(3, Math.ceil(ncol / 2))) {
      linhas.push({ numero, celulas, tipo: 'total' });
      continue;
    }
    if (cheias.length === 1 && typeof cheias[0] === 'string') {
      const m = texto(cheias[0]).match(RE_AGRUPAMENTO);
      if (m) {
        linhas.push({ numero, celulas, tipo: 'agrupamento', agrupamento: { rotulo: m[1].trim(), valor: m[2].trim() } });
        continue;
      }
    }
    linhas.push({ numero, celulas, tipo: 'dado' });
  }
  // Rodapé sem a palavra "total": linhas finais só com números e quase vazias.
  for (let k = linhas.length - 1; k >= 0; k--) {
    const l = linhas[k];
    if (l.tipo !== 'dado') { if (l.tipo === 'total' || l.tipo === 'aviso') continue; break; }
    const cheias = preenchidas(l.celulas);
    const soNumeros = cheias.length > 0 && cheias.every(ehNumerico);
    if (soNumeros && cheias.length <= Math.max(2, Math.floor(ncol / 3))) { l.tipo = 'total'; continue; }
    break;
  }
  const totalRodape: Record<number, number> = {};
  for (const l of linhas) {
    if (l.tipo !== 'total') continue;
    l.celulas.forEach((c, j) => {
      if (typeof c === 'number' || (typeof c === 'string' && lerCentavos(c) !== null && !RE_TOTAL.test(normalizar(c)))) {
        const v = lerCentavos(c);
        if (v !== null) totalRodape[j] = v;
      }
    });
  }
  const dados = linhas.filter(l => l.tipo === 'dado').length;
  if (cortada) {
    avisos.push({
      codigo: 'lista_cortada',
      mensagem: 'O próprio arquivo avisa que a lista foi cortada (muitos registros). Exporte de novo em partes menores, um arquivo por mês, e solte todos aqui.',
    });
  } else if (dados >= 100 && (dados % 500 === 0 || CORTES_COMUNS.has(dados))) {
    avisos.push({
      codigo: 'lista_pode_estar_cortada',
      mensagem: `A lista tem exatamente ${dados.toLocaleString('pt-BR')} linhas, um número redondo: o sistema anterior pode ter cortado o resto. Confira lá e, se precisar, exporte um arquivo por mês.`,
    });
  }
  const totais = linhas.filter(l => l.tipo === 'total').length;
  if (totais) {
    avisos.push({ codigo: 'total_do_rodape', mensagem: `${totais === 1 ? 'A linha de total do rodapé ficou de fora' : `${totais} linhas de total ficaram de fora`} (não é um lançamento).` });
  }
  const agrup = linhas.filter(l => l.tipo === 'agrupamento' && l.agrupamento?.rotulo !== 'cabeçalho repetido').length;
  if (agrup) {
    avisos.push({ codigo: 'linhas_de_agrupamento', mensagem: `${agrup} linha(s) de agrupamento (ex.: "Grupo: …") viraram informação das linhas de baixo.` });
  }
  return { linhaCabecalho: aba.primeiraLinha + idx, cabecalhos: cab, linhas, avisos, totalRodape };
}

/** A primeira aba com dados (as exportações costumam ter uma só). */
export function abaPrincipal(p: PlanilhaLida): number {
  const i = p.abas.findIndex(a => a.linhas.some(l => preenchidas(l).length > 1));
  return i < 0 ? 0 : i;
}
