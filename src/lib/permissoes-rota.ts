// Peças comuns das rotas de Perfis de acesso, Limites e Aprovações
// (05/11/2026): cadastros que as telas listam para a pessoa escolher (nunca
// digitar código) e a resposta de erro padrão.
import { NextResponse } from 'next/server';
import { perfilCanonico } from './permissoes';
import type { ExecutorPermissoes } from './permissoes-servidor';
import { ErroPermissoes } from './permissoes-servidor';
import { ErroAprovacao } from './aprovacoes-servidor';

export interface OpcaoSimples { id: string; nome: string; detalhe?: string }

export interface UsuarioParaEscolha { id: string; nome: string; email: string; papel: string; ativo: boolean }

export async function usuariosDaAgencia(exec: ExecutorPermissoes, tenantId: string): Promise<UsuarioParaEscolha[]> {
  const { rows } = await exec.query(
    `SELECT id, data FROM usuarios WHERE tenant_id = $1 ORDER BY lower(COALESCE(data->>'nome', nome, '')), id`, [tenantId]);
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id), nome: String(d.nome ?? ''), email: String(d.email ?? ''),
      papel: perfilCanonico(d.perfil as string), ativo: d.ativo !== false,
    };
  }).filter(u => u.papel !== 'COLABORADOR');
}

export async function contasDaAgencia(exec: ExecutorPermissoes, tenantId: string): Promise<OpcaoSimples[]> {
  const { rows } = await exec.query(
    `SELECT id, data FROM contas_bancarias WHERE tenant_id = $1 ORDER BY lower(COALESCE(data->>'nome', '')), id`, [tenantId]);
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return { id: String(r.id), nome: String(d.nome || 'Conta sem nome'), detalhe: String(d.banco ?? '') };
  });
}

export async function categoriasDeDespesa(exec: ExecutorPermissoes, tenantId: string): Promise<OpcaoSimples[]> {
  const { rows } = await exec.query(
    `SELECT id, data FROM plano_contas WHERE tenant_id = $1 AND COALESCE(data->>'tipo', '') <> 'RECEITA'
      ORDER BY lower(COALESCE(data->>'nome', '')), id`, [tenantId]);
  return rows.map(r => ({ id: String(r.id), nome: String((r.data as Record<string, unknown>)?.nome ?? '') }));
}

export async function centrosDeCusto(exec: ExecutorPermissoes, tenantId: string): Promise<OpcaoSimples[]> {
  const { rows } = await exec.query(
    `SELECT id, data FROM centros_custo WHERE tenant_id = $1 ORDER BY lower(COALESCE(data->>'nome', '')), id`, [tenantId]);
  return rows.map(r => ({ id: String(r.id), nome: String((r.data as Record<string, unknown>)?.nome ?? '') }));
}

export async function corpoJson(req: Request): Promise<Record<string, unknown>> {
  const corpo = await req.json().catch(() => null);
  return corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? corpo as Record<string, unknown> : {};
}

export function respostaDeErro(e: unknown): NextResponse {
  if (e instanceof ErroPermissoes || e instanceof ErroAprovacao) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error('[permissoes]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir agora. Tente de novo.' }, { status: 500 });
}
