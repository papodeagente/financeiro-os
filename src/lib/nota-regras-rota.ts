/**
 * Peças das rotas das notas por regra e das retenções (E5, parte E).
 *
 * Contrato (dinheiro em CENTAVOS, como o modelo da venda):
 *   GET    /api/fiscal/regras              → { regras: RegraDaNota[], config: ConfigNotas, sugerida: RegraDaNota }
 *   POST   /api/fiscal/regras  RegraDaNota → 201 RegraDaNota (409 REGRA_REPETIDA)
 *   PUT    /api/fiscal/regras/[id]         → RegraDaNota
 *   DELETE /api/fiscal/regras/[id]         → { ok }
 *   GET    /api/fiscal/retencoes[?cliente_id=] → { retencoes: RetencaoDoCliente[] }
 *   POST   /api/fiscal/retencoes           → 201 RetencaoDoCliente (409 REPETIDA)
 *   PUT    /api/fiscal/retencoes/[id]      → RetencaoDoCliente
 *   DELETE /api/fiscal/retencoes/[id]      → { ok }
 *   GET/PUT /api/fiscal/notas-config  { automatico, enviar_ao_cliente }
 *   GET    /api/fiscal/gerar?de=&ate=&data_de=VENDA|EMBARQUE&busca=&pendentes=1&tipo=&vendedor=&fornecedor=&pagina=&por_pagina= → GradeDeNotas
 *          (paginada por venda; `fornecedor` casa com o fornecedor ou o representante do produto)
 *   POST   /api/fiscal/gerar/previa  { selecao: [{ venda_id, produto_ids? }], data_da_nota?: DIA|VENDA|EMBARQUE } → PreviaDeNotas (nada é gravado)
 *   POST   /api/fiscal/gerar  { selecao, assinatura, data_da_nota? } → ResultadoDaEmissao (409 PREVIA_MUDOU com a prévia nova)
 *   POST   /api/fiscal/notas-externas  NotaDeFora (nota-externa.ts) → 201 { nota, repetida } (200 quando já estava registrada)
 *   GET    /api/fiscal/notas-config inclui data_da_nota, retencao_minima e tributos_aproximados (E7)
 * Erros: { error, codigo, detalhes? }.
 */
import { NextResponse } from 'next/server';
import { ErroNota } from './nota-regras-servidor';
import { ErroRetencao } from './nota-retencoes-servidor';
import { ErroFiscal } from './nfse-emissor';
import type { FiltroDaGrade, SelecaoDeNotas } from './nota-regras-servidor';
import { DATAS_DA_NOTA, type DataDaNota } from './nota-regras';
import { TIPOS_PRODUTO, type TipoProduto } from './venda-modelo';
import { ErroNotaExterna } from './nota-externa';

export function respostaDeErroDaNota(e: unknown): NextResponse {
  if (e instanceof ErroNota || e instanceof ErroRetencao || e instanceof ErroNotaExterna) {
    return NextResponse.json({ error: e.message, codigo: e.codigo, ...(e.detalhes ? { detalhes: e.detalhes } : {}) }, { status: e.status });
  }
  if (e instanceof ErroFiscal) return NextResponse.json({ error: e.message, codigo: 'FISCAL' }, { status: 400 });
  const msg = e instanceof Error ? e.message : 'Erro interno';
  return NextResponse.json({ error: msg, codigo: 'ERRO' }, { status: 500 });
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function dataOu(v: string | null, padrao: string): string {
  return v && ISO.test(v) ? v : padrao;
}

/** A data da nota pedida pela tela (vazio: a da configuração). */
export function lerDataDaNota(v: unknown): DataDaNota | null {
  return (DATAS_DA_NOTA as readonly string[]).includes(String(v)) ? v as DataDaNota : null;
}

/** Os filtros da grade vindos da URL (E7: embarque, tipo, vendedor, fornecedor e página). */
export function lerFiltrosDaGrade(q: URLSearchParams, padrao: { de: string; ate: string }): FiltroDaGrade {
  const tipo = q.get('tipo');
  return {
    de: dataOu(q.get('de'), padrao.de),
    ate: dataOu(q.get('ate'), padrao.ate),
    data_de: q.get('data_de') === 'EMBARQUE' ? 'EMBARQUE' : 'VENDA',
    busca: (q.get('busca') ?? '').slice(0, 120),
    so_pendentes: q.get('pendentes') === '1',
    tipo: tipo && (TIPOS_PRODUTO as readonly string[]).includes(tipo) ? tipo as TipoProduto : null,
    vendedor_id: (q.get('vendedor') ?? '').slice(0, 200) || undefined,
    fornecedor_id: (q.get('fornecedor') ?? '').slice(0, 200) || undefined,
    pagina: Math.max(1, Number(q.get('pagina')) || 1),
    por_pagina: Math.min(200, Math.max(1, Number(q.get('por_pagina')) || 50)),
  };
}

/** A seleção da grade, limpa (no máximo 200 vendas por vez). */
export function lerSelecao(v: unknown): SelecaoDeNotas[] {
  const lista = Array.isArray(v) ? v : [];
  return lista.slice(0, 200).flatMap(x => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const venda_id = String(o.venda_id ?? '').trim().slice(0, 200);
    if (!venda_id) return [];
    const produto_ids = Array.isArray(o.produto_ids) ? o.produto_ids.map(p => String(p).slice(0, 80)).filter(Boolean).slice(0, 300) : [];
    return [{ venda_id, produto_ids }];
  });
}
