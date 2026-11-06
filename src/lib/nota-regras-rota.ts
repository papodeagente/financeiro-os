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
 *   GET    /api/fiscal/gerar?de=&ate=&busca=&pendentes=1 → GradeDeNotas
 *   POST   /api/fiscal/gerar/previa  { selecao: [{ venda_id, produto_ids? }] } → PreviaDeNotas (nada é gravado)
 *   POST   /api/fiscal/gerar  { selecao, assinatura } → ResultadoDaEmissao (409 PREVIA_MUDOU com a prévia nova)
 * Erros: { error, codigo, detalhes? }.
 */
import { NextResponse } from 'next/server';
import { ErroNota } from './nota-regras-servidor';
import { ErroRetencao } from './nota-retencoes-servidor';
import { ErroFiscal } from './nfse-emissor';
import type { SelecaoDeNotas } from './nota-regras-servidor';

export function respostaDeErroDaNota(e: unknown): NextResponse {
  if (e instanceof ErroNota || e instanceof ErroRetencao) {
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
