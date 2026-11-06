/**
 * EXPORTAÇÃO (E7, G3): o documento único que toda lista e todo relatório
 * monta para sair em Excel (.xlsx), PDF ou impressão.
 *
 * Arquivo puro (sem SheetJS nem jsPDF): define o documento, valida o que a
 * tela manda, tira as colunas sensíveis de quem não pode vê-las, formata as
 * células e monta o nome do arquivo com o filtro aplicado. A planilha sai
 * em `planilha.ts`, o PDF em `pdf.ts`, e a resposta HTTP (direito
 * "exportar", colunas sensíveis, auditoria) em `servidor.ts`.
 *
 * Dinheiro: o documento diz em que unidade os valores vêm (`dinheiro_em`):
 * as telas trabalham em reais, as tabelas novas em centavos. A planilha
 * sempre recebe reais como NÚMERO (para somar), e o PDF o texto "R$ 1.234,56".
 */

export const FORMATOS_DE_EXPORTACAO = ['xlsx', 'pdf', 'imprimir', 'csv'] as const;
export type FormatoDeExportacao = (typeof FORMATOS_DE_EXPORTACAO)[number];

export type TipoDaColunaExportada = 'texto' | 'data' | 'dinheiro' | 'numero' | 'inteiro' | 'percentual';
export const TIPOS_DE_COLUNA: readonly TipoDaColunaExportada[] = ['texto', 'data', 'dinheiro', 'numero', 'inteiro', 'percentual'];

export interface ColunaExportada {
  id: string;
  rotulo: string;
  tipo: TipoDaColunaExportada;
  /** O ganho da agência (comissão, custo, receita): só sai para quem pode ver. */
  sensivel?: boolean;
}

export type CelulaExportada = string | number | boolean | null | undefined;
export type LinhaExportada = Record<string, CelulaExportada>;

export interface FiltroAplicado { rotulo: string; valor: string }

export interface DocumentoExportado {
  titulo: string;
  subtitulo?: string;
  /** O que a pessoa escolheu na tela; vai no topo do arquivo e no nome dele. */
  filtros?: FiltroAplicado[];
  colunas: ColunaExportada[];
  linhas: LinhaExportada[];
  /** Linha de total (opcional), com os mesmos ids das colunas. */
  totais?: LinhaExportada | null;
  /** Rótulo da linha de total (padrão "Total"). */
  rotulo_total?: string;
  /** Unidade dos valores de dinheiro nas linhas (padrão reais). */
  dinheiro_em?: 'reais' | 'centavos';
  /** Retrato ou paisagem no PDF (padrão: decide pela quantidade de colunas). */
  orientacao?: 'retrato' | 'paisagem';
  /** Observação no pé do arquivo. */
  nota?: string;
}

/** Limites do que a tela pode mandar para virar arquivo. */
export const LIMITES_DA_EXPORTACAO = { colunas: 80, linhas: 50_000, texto: 4_000, filtros: 20, titulo: 160 } as const;

// ============================================================
// Validação do que chega da tela (POST /api/exportacao)
// ============================================================

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : v === null || v === undefined ? '' : String(v).slice(0, max));

/** Confere e limpa o documento que a tela mandou. Devolve o erro em palavras, ou o documento. */
export function validarDocumento(entrada: unknown): { ok: true; documento: DocumentoExportado } | { ok: false; erro: string } {
  if (!entrada || typeof entrada !== 'object') return { ok: false, erro: 'Nada para exportar.' };
  const e = entrada as Record<string, unknown>;
  const titulo = texto(e.titulo, LIMITES_DA_EXPORTACAO.titulo).trim();
  if (!titulo) return { ok: false, erro: 'O arquivo precisa de um título.' };
  if (!Array.isArray(e.colunas) || !e.colunas.length) return { ok: false, erro: 'Escolha ao menos uma coluna.' };
  if (e.colunas.length > LIMITES_DA_EXPORTACAO.colunas) return { ok: false, erro: `O arquivo aceita até ${LIMITES_DA_EXPORTACAO.colunas} colunas.` };
  const colunas: ColunaExportada[] = [];
  const vistos = new Set<string>();
  for (const c of e.colunas as unknown[]) {
    if (!c || typeof c !== 'object') return { ok: false, erro: 'Coluna inválida.' };
    const k = c as Record<string, unknown>;
    const id = texto(k.id, 80).trim();
    if (!id || vistos.has(id)) return { ok: false, erro: 'Coluna sem identificação ou repetida.' };
    vistos.add(id);
    const tipo = (TIPOS_DE_COLUNA as readonly string[]).includes(String(k.tipo)) ? (k.tipo as TipoDaColunaExportada) : 'texto';
    colunas.push({ id, rotulo: texto(k.rotulo, 120) || id, tipo, ...(k.sensivel === true ? { sensivel: true } : {}) });
  }
  if (!Array.isArray(e.linhas)) return { ok: false, erro: 'As linhas não vieram.' };
  if (e.linhas.length > LIMITES_DA_EXPORTACAO.linhas) {
    return { ok: false, erro: `O arquivo aceita até ${LIMITES_DA_EXPORTACAO.linhas.toLocaleString('pt-BR')} linhas. Escolha um período menor ou mais filtros.` };
  }
  const limparLinha = (l: unknown): LinhaExportada => {
    const out: LinhaExportada = {};
    if (!l || typeof l !== 'object') return out;
    const r = l as Record<string, unknown>;
    for (const c of colunas) {
      const v = r[c.id];
      if (v === null || v === undefined) out[c.id] = null;
      else if (typeof v === 'number') out[c.id] = Number.isFinite(v) ? v : null;
      else if (typeof v === 'boolean') out[c.id] = v;
      else out[c.id] = texto(v, LIMITES_DA_EXPORTACAO.texto);
    }
    return out;
  };
  const filtros = Array.isArray(e.filtros)
    ? (e.filtros as unknown[]).slice(0, LIMITES_DA_EXPORTACAO.filtros).flatMap(f => {
      if (!f || typeof f !== 'object') return [];
      const r = f as Record<string, unknown>;
      const rotulo = texto(r.rotulo, 60).trim();
      const valor = texto(r.valor, 200).trim();
      return rotulo && valor ? [{ rotulo, valor }] : [];
    })
    : [];
  return {
    ok: true,
    documento: {
      titulo,
      ...(e.subtitulo ? { subtitulo: texto(e.subtitulo, 300) } : {}),
      filtros,
      colunas,
      linhas: (e.linhas as unknown[]).map(limparLinha),
      totais: e.totais && typeof e.totais === 'object' ? limparLinha(e.totais) : null,
      ...(e.rotulo_total ? { rotulo_total: texto(e.rotulo_total, 40) } : {}),
      dinheiro_em: e.dinheiro_em === 'centavos' ? 'centavos' : 'reais',
      ...(e.orientacao === 'retrato' || e.orientacao === 'paisagem' ? { orientacao: e.orientacao } : {}),
      ...(e.nota ? { nota: texto(e.nota, 600) } : {}),
    },
  };
}

// ============================================================
// Colunas sensíveis
// ============================================================

/** Tira as colunas sensíveis (e os números delas) de quem não pode ver o ganho da agência. */
export function semColunasSensiveis(doc: DocumentoExportado, verSensivel: boolean): DocumentoExportado {
  if (verSensivel || !doc.colunas.some(c => c.sensivel)) return doc;
  const fora = new Set(doc.colunas.filter(c => c.sensivel).map(c => c.id));
  const limpa = (l: LinhaExportada): LinhaExportada => {
    const out: LinhaExportada = {};
    for (const [k, v] of Object.entries(l)) if (!fora.has(k)) out[k] = v;
    return out;
  };
  return {
    ...doc,
    colunas: doc.colunas.filter(c => !c.sensivel),
    linhas: doc.linhas.map(limpa),
    totais: doc.totais ? limpa(doc.totais) : doc.totais,
  };
}

// ============================================================
// Células
// ============================================================

const ISO_DATA = /^(\d{4})-(\d{2})-(\d{2})/;

export function dataParaBR(v: CelulaExportada): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  const m = ISO_DATA.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** Reais (número) a partir do valor da célula, na unidade do documento. */
export function reaisDaCelula(v: CelulaExportada, dinheiroEm: 'reais' | 'centavos' = 'reais'): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return dinheiroEm === 'centavos' ? Math.round(n) / 100 : Math.round(n * 100) / 100;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** O texto da célula como a pessoa lê (PDF e impressão). */
export function textoDaCelula(c: ColunaExportada, v: CelulaExportada, dinheiroEm: 'reais' | 'centavos' = 'reais'): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  switch (c.tipo) {
    case 'dinheiro': {
      const r = reaisDaCelula(v, dinheiroEm);
      return r === null ? String(v) : BRL.format(r).replace(/ /g, ' ');
    }
    case 'data': return dataParaBR(v);
    case 'percentual': return typeof v === 'number' ? `${PCT.format(v)}%` : String(v);
    case 'inteiro': return typeof v === 'number' ? INT.format(v) : String(v);
    case 'numero': return typeof v === 'number' ? NUM.format(v) : String(v);
    default: return String(v);
  }
}

/** Texto começando com =, +, -, @ vira texto puro na planilha (nada de fórmula escondida). */
export function neutralizarFormula(s: string): string {
  return /^[\s﻿]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s) ? `'${s}` : s;
}

/** Valor para a planilha: dinheiro em reais (número), percentual e número como número, data dd/mm/aaaa. */
export function valorParaPlanilha(c: ColunaExportada, v: CelulaExportada, dinheiroEm: 'reais' | 'centavos' = 'reais'): string | number {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (c.tipo === 'dinheiro') return reaisDaCelula(v, dinheiroEm) ?? neutralizarFormula(String(v));
  if (c.tipo === 'numero' || c.tipo === 'inteiro' || c.tipo === 'percentual') {
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && String(v).trim() !== '' ? n : neutralizarFormula(String(v));
  }
  if (c.tipo === 'data') return dataParaBR(v);
  return neutralizarFormula(String(v));
}

/** Linhas do cabeçalho do arquivo: título, subtítulo e filtros por extenso. */
export function linhasDoCabecalho(doc: DocumentoExportado, geradoEm: Date = new Date()): string[] {
  const out = [doc.titulo];
  if (doc.subtitulo) out.push(doc.subtitulo);
  if (doc.filtros?.length) out.push(doc.filtros.map(f => `${f.rotulo}: ${f.valor}`).join(' · '));
  out.push(`Gerado em ${geradoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} às ${geradoEm.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`);
  return out;
}

/** A matriz (cabeçalho + linhas + total) com os valores da planilha. */
export function matrizDoDocumento(doc: DocumentoExportado): Array<Array<string | number>> {
  const un = doc.dinheiro_em ?? 'reais';
  const m: Array<Array<string | number>> = [doc.colunas.map(c => c.rotulo)];
  for (const l of doc.linhas) m.push(doc.colunas.map(c => valorParaPlanilha(c, l[c.id], un)));
  if (doc.totais) m.push(doc.colunas.map((c, i) => (i === 0 && (doc.totais![c.id] === undefined || doc.totais![c.id] === null || doc.totais![c.id] === '') ? (doc.rotulo_total ?? 'Total') : valorParaPlanilha(c, doc.totais![c.id], un))));
  return m;
}

/** CSV com ponto e vírgula e vírgula decimal (o Excel brasileiro abre direto). */
export function csvDoDocumento(doc: DocumentoExportado): string {
  const cel = (v: string | number) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + matrizDoDocumento(doc).map(l => l.map(cel).join(';')).join('\r\n');
}

// ============================================================
// Nome do arquivo
// ============================================================

/** "Contas a pagar · Em atraso" → "contas-a-pagar-em-atraso" (sem acento, só a-z0-9 e hífen). */
export function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/(\d{2})\/(\d{2})\/(\d{4})/g, '$3-$2-$1')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const EXTENSAO: Record<FormatoDeExportacao, string> = { xlsx: 'xlsx', pdf: 'pdf', imprimir: 'pdf', csv: 'csv' };

/** Nome do arquivo com o filtro aplicado: título + valores dos filtros, até 120 letras. */
export function nomeDoArquivo(doc: Pick<DocumentoExportado, 'titulo' | 'filtros'>, formato: FormatoDeExportacao): string {
  const partes = [slug(doc.titulo), ...(doc.filtros ?? []).map(f => slug(f.valor))].filter(Boolean);
  let base = partes.join('-').replace(/-+/g, '-');
  if (base.length > 120) base = base.slice(0, 120).replace(/-[^-]*$/, '');
  return `${base || 'exportacao'}.${EXTENSAO[formato]}`;
}

export const TIPO_MIME: Record<FormatoDeExportacao, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  imprimir: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
};

/** Rótulo de período para o filtro: "01/11/2026 a 30/11/2026". */
export function rotuloDoPeriodo(de?: string | null, ate?: string | null): string {
  if (de && ate) return de === ate ? dataParaBR(de) : `${dataParaBR(de)} a ${dataParaBR(ate)}`;
  if (de) return `desde ${dataParaBR(de)}`;
  if (ate) return `até ${dataParaBR(ate)}`;
  return 'todo o período';
}
