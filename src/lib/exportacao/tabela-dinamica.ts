/**
 * EXPORTAÇÃO (E7, G3): qualquer tabela dinâmica (src/lib/tabela-dinamica.ts)
 * como documento de exportação. Linhas achatadas na ordem da grade, todos os
 * níveis abertos, com recuo no primeiro campo (o caminho inteiro fica na
 * coluna "Caminho" para filtrar no Excel); uma coluna por coluna-folha, o
 * total da linha e o total geral. Arquivo puro; valores em centavos.
 */
import { COLUNA_TOTAL, type TabelaDinamica } from '../tabela-dinamica';
import type { DocumentoExportado, FiltroAplicado, LinhaExportada } from './documento';

export interface OpcoesDaDinamica {
  titulo: string;
  subtitulo?: string;
  filtros?: FiltroAplicado[];
  /** Nome legível do campo (ex.: "categoria" → "Categoria"). */
  rotuloDoCampo?: (campo: string) => string;
  /** Valor legível (ex.: mês "2026-03" → "mar/2026"). */
  rotuloDoValor?: (campo: string, valor: string) => string;
  /** Rótulo da coluna quando não há campo de coluna (padrão "Valor"). */
  rotuloDoValorUnico?: string;
}

const RECUO = '    ';

export function documentoDaTabelaDinamica(t: TabelaDinamica, o: OpcoesDaDinamica): DocumentoExportado {
  const campo = o.rotuloDoCampo ?? ((c: string) => c);
  const valor = o.rotuloDoValor ?? ((_: string, v: string) => v);
  const colunasFolha = t.colunas.map((col, i) => ({
    id: `c${i}`,
    chave: col.chave,
    rotulo: col.chave === COLUNA_TOTAL
      ? (o.rotuloDoValorUnico ?? 'Valor')
      : col.caminho.map((v, k) => valor(t.camposColuna[k], v)).join(' › '),
  }));
  const temColunas = !(colunasFolha.length === 1 && colunasFolha[0].chave === COLUNA_TOTAL);
  const rotuloLinhas = t.camposLinha.length ? t.camposLinha.map(campo).join(' › ') : 'Linha';
  const linhas: LinhaExportada[] = t.linhas.map(l => {
    const r: LinhaExportada = {
      linha: `${RECUO.repeat(l.nivel)}${valor(l.campo, l.valor) || '(vazio)'}`,
      caminho: l.caminho.map((v, i) => valor(t.camposLinha[i], v)).join(' › '),
    };
    for (const c of colunasFolha) r[c.id] = l.celulas[c.chave] ?? null;
    if (temColunas) r.total = l.total;
    return r;
  });
  const totais: LinhaExportada = { linha: 'Total geral' };
  for (const c of colunasFolha) totais[c.id] = t.totaisPorColuna[c.chave] ?? 0;
  if (temColunas) totais.total = t.totalGeral;
  return {
    titulo: o.titulo,
    ...(o.subtitulo ? { subtitulo: o.subtitulo } : {}),
    filtros: o.filtros ?? [],
    colunas: [
      { id: 'linha', rotulo: rotuloLinhas, tipo: 'texto' },
      ...(t.camposLinha.length > 1 ? [{ id: 'caminho', rotulo: 'Caminho', tipo: 'texto' as const }] : []),
      ...colunasFolha.map(c => ({ id: c.id, rotulo: c.rotulo, tipo: 'dinheiro' as const })),
      ...(temColunas ? [{ id: 'total', rotulo: 'Total', tipo: 'dinheiro' as const }] : []),
    ],
    linhas,
    totais,
    dinheiro_em: 'centavos',
    ...(colunasFolha.length > 8 ? { orientacao: 'paisagem' as const } : {}),
  };
}
