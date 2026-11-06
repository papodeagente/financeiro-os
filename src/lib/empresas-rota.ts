/**
 * Peças de rota da multiempresa (06/11/2026, E7 G2).
 *
 * Contrato das rotas:
 *   GET  /api/empresas                → { empresas, multi, selecao, permitidas, visiveis, pode_editar }
 *                                       (?inativas=1 inclui as desativadas, para o cadastro)
 *   POST /api/empresas                → cria ou altera { id?, nome, razao_social, cnpj, ativa } (só administrador)
 *   PUT  /api/empresas/selecao        → { empresas: string[] } grava o que a pessoa marcou no seletor
 *   POST /api/empresas/copiar         → { secao: financeiro|cobranca|vendas|notas, de, para } "Copiar de outra empresa"
 *   ?empresa=<id> nas configurações   → /api/config/financeiro, /api/config/cobranca, /api/config/vendas e
 *                                       /api/fiscal/* leem e gravam a configuração daquela empresa. Sem o
 *                                       parâmetro (ou com a principal), a configuração de sempre.
 */
import { NextResponse } from 'next/server';
import pool from './db';
import { getSession } from './auth';
import { ErroEmpresa, empresaComConfigPropria, empresaLiberada, type ExecutorEmpresas } from './empresas-servidor';

/**
 * Lê `?empresa=` do pedido. Vazio ou a principal = null (a configuração de
 * sempre). Outra empresa precisa existir, estar ativa e liberada para quem pede.
 */
export async function empresaDoPedido(req: Request | undefined): Promise<{ empresa: string | null; recusa: NextResponse | null }> {
  // Chamada sem pedido (testes e chamadas internas antigas): a de sempre.
  const empresa = req?.url ? new URL(req.url).searchParams.get('empresa')?.trim() || null : null;
  if (!empresaComConfigPropria(empresa)) return { empresa: null, recusa: null };
  const sessao = await getSession();
  if (!pool || !sessao || !(await empresaLiberada(pool as unknown as ExecutorEmpresas, sessao, empresa))) {
    return { empresa: null, recusa: NextResponse.json({ error: 'Empresa não encontrada ou não liberada para você.' }, { status: 404 }) };
  }
  return { empresa, recusa: null };
}

export function respostaDeErroDaEmpresa(e: unknown): NextResponse {
  if (e instanceof ErroEmpresa) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[empresas] falha:', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir. Tente de novo.' }, { status: 500 });
}

/**
 * A empresa que a tela da venda mandou (E7), pronta para o cabeçalho da
 * venda. Ausente = nada (a venda fica onde está ou nasce pelo gatilho).
 * Empresa inexistente ou não liberada para quem grava: recusa 403.
 */
export async function cabecalhoDaEmpresa(
  sessao: Parameters<typeof empresaLiberada>[1] | null | undefined, empresaId: unknown,
): Promise<Record<string, unknown> | undefined | NextResponse> {
  if (typeof empresaId !== 'string' || !empresaId.trim()) return undefined;
  const id = empresaId.trim();
  if (!pool || !sessao || !(await empresaLiberada(pool as unknown as ExecutorEmpresas, sessao, id))) {
    return NextResponse.json({ error: 'Esta empresa não está liberada para você.', codigo: 'EMPRESA' }, { status: 403 });
  }
  return { empresa_id: id };
}
