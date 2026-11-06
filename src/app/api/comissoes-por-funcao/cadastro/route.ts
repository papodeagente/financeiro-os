import { NextResponse } from 'next/server';
import { contextoDaComissao, respostaDeErroDaComissao } from '@/lib/comissao-rota';
import { lerCadastro, lerConfigComissao } from '@/lib/comissao-funcoes-servidor';
import { listarGrupos } from '@/lib/permissoes-servidor';

// Funções, pessoas, planos e metas, com as listas para escolher (equipe, intermediários, unidades,
// perfis de acesso para "quem fecha" cada função).
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await contextoDaComissao(['ver_comissoes_todos']);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { exec, tenantId } = ctx;
    const vazio = { rows: [] as Array<Record<string, unknown>> };
    const [cadastro, config, equipe, intermediarios, unidades, perfis] = await Promise.all([
      lerCadastro(exec, tenantId),
      lerConfigComissao(exec, tenantId),
      exec.query(`SELECT id, nome FROM usuarios WHERE tenant_id = $1 AND COALESCE(data->>'cadastro_pendente', 'false') <> 'true' ORDER BY nome`, [tenantId]),
      exec.query(`SELECT id, COALESCE(NULLIF(nome_fantasia, ''), data->>'nome_fantasia', id) AS nome FROM fornecedores_crm WHERE tenant_id = $1 ORDER BY 2`, [tenantId]).catch(() => vazio),
      exec.query(
        `SELECT DISTINCT TRIM(data->>'centro_custo') AS nome FROM vendas_crm WHERE tenant_id = $1 AND COALESCE(TRIM(data->>'centro_custo'), '') <> '' ORDER BY 1`,
        [tenantId],
      ).catch(() => vazio),
      listarGrupos(exec, tenantId).catch(() => []),
    ]);
    return NextResponse.json({
      ...cadastro, config,
      equipe: equipe.rows.map(r => ({ id: String(r.id), nome: String(r.nome ?? '') })),
      intermediarios: intermediarios.rows.map(r => ({ id: String(r.id), nome: String(r.nome ?? '') })),
      unidades: unidades.rows.map(r => String(r.nome)),
      perfis: perfis.map(g => ({ id: g.id, nome: g.nome })),
    });
  } catch (e) { return respostaDeErroDaComissao(e); }
}
