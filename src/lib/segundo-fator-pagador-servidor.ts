/**
 * Verificação em duas etapas de quem paga, por versão da agência (14/11/2026).
 *
 * A exigência (segundo-fator-pagador.ts) é da versão COMPLETA: só vale na
 * agência com o módulo "Núcleo completo". Na versão simples, pagar pela
 * edição da conta e efetivar ou desfazer transferência seguem como sempre
 * seguiram (sem pedido de código e sem aviso). Rotas que só existem na versão
 * completa (liquidação, aprovações) continuam chamando a guarda direto.
 */
import type { NextResponse } from 'next/server';
import { getSession } from './auth';
import { conferirSegundoFatorDoPagador } from './guarda-rota';
import { temModulo } from './modulos-servidor';

/** A agência exige o código de quem paga? Só com o núcleo completo. */
export async function exigeSegundoFatorDoPagador(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return true;
  return temModulo(tenantId, 'nucleo');
}

/**
 * Igual a `conferirSegundoFatorDoPagador` (guarda-rota.ts) na agência com o
 * núcleo; livre na versão simples.
 */
export async function conferirSegundoFatorDoPagadorDaConta(): Promise<{ recusa: NextResponse | null; aviso: string | null }> {
  const sessao = await getSession();
  if (sessao && !(await exigeSegundoFatorDoPagador(sessao.tenantId))) {
    return { recusa: null, aviso: null };
  }
  return conferirSegundoFatorDoPagador();
}
