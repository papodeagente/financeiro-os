/**
 * Peças comuns das rotas de cheques (E7, frente C): quem pede, as contas
 * bancárias que a pessoa enxerga (direito por conta e empresas marcadas) e a
 * resposta de erro.
 */
import { NextResponse } from 'next/server';
import type { ExecutorSQL } from './caixa-atomico';
import { contasPermitidas, type SessaoPermissoes } from './permissoes-servidor';
import { contasBancariasVisiveis, escopoDaSessao, type ExecutorEmpresas } from './empresas-servidor';
import { ErroCheque } from './cheques-servidor';
import { respostaPeriodoFechado } from './guarda-rota';

/**
 * Contas bancárias que a pessoa pode ver/usar: as liberadas no perfil de
 * acesso e as das empresas marcadas. `null` = todas (o caso de sempre).
 */
export async function contasDoCheque(exec: ExecutorSQL, tenantId: string, sessao: SessaoPermissoes): Promise<Set<string> | null> {
  const liberadas = await contasPermitidas(sessao);
  const escopo = await escopoDaSessao(sessao, exec as unknown as ExecutorEmpresas);
  const visiveis = await contasBancariasVisiveis(exec as unknown as ExecutorEmpresas, tenantId, escopo.visiveis);
  if (liberadas === null && visiveis === null) return null;
  if (liberadas === null) return visiveis;
  const lib = new Set(liberadas);
  if (visiveis === null) return lib;
  return new Set([...lib].filter(id => visiveis.has(id)));
}

export function respostaDoErro(e: unknown, onde: string): NextResponse {
  if (e instanceof ErroCheque) return NextResponse.json({ error: e.message }, { status: e.status });
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  const st = (e as { status?: number })?.status;
  if (typeof st === 'number' && st >= 400 && st < 500) return NextResponse.json({ error: (e as Error).message }, { status: st });
  // Número repetido na mesma conta (corrida entre duas telas).
  if (/uq_cheques_emitidos_numero/.test(String((e as Error)?.message ?? ''))) {
    return NextResponse.json({ error: 'Este número de cheque já foi usado nesta conta. Use o próximo do talão.' }, { status: 409 });
  }
  console.error(`[cheques] ${onde}`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir. Nada foi gravado.' }, { status: 500 });
}
