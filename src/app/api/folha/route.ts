import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { podeEditarFinanceiro } from '@/lib/permissoes';
import { num, round2 } from '@/lib/money';
import type { EntradaPessoa } from '@/lib/folha-pagamento';

/**
 * Folha de pagamento: quem entra e quanto a agência faturou por mês.
 *
 * Salário é dado sensível. A rota exige permissão de financeiro, e não só
 * sessão: vendedor não enxerga a folha da equipe.
 */

/** Faturamento por mês, para a relação folha sobre receita. Mesma base do
 *  painel de produtos: venda confirmada ou concluída, por valor_final. */
async function faturamentoPorMes(tenantId: string): Promise<Record<string, number>> {
  if (!pool) return {};
  const { rows } = await pool.query(
    `SELECT substring(v.data->>'data_venda' from 1 for 7) AS mes,
            COALESCE(SUM(
              CASE WHEN v.data->>'valor_final' ~ '^-?[0-9]+(\\\\.[0-9]+)?$'
                   THEN (v.data->>'valor_final')::numeric ELSE 0 END
            ), 0) AS total
       FROM vendas_crm v
      WHERE v.tenant_id = $1
        AND v.data->>'status' IN ('CONFIRMADO', 'CONCLUIDO')
        AND COALESCE(v.data->>'data_venda', '') <> ''
      GROUP BY 1`,
    [tenantId],
  );
  const fora: Record<string, number> = {};
  for (const r of rows) fora[r.mes as string] = round2(num(r.total));
  return fora;
}

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao para ver a folha' }, { status: 403 });
    }
    const tenantId = await getTenantId();

    const [usuariosRes, faturamento] = await Promise.all([
      pool.query(
        `SELECT id, nome, data FROM usuarios
          WHERE tenant_id = $1
            AND COALESCE(data->>'cadastro_pendente', 'false') <> 'true'
          ORDER BY nome ASC`,
        [tenantId],
      ),
      faturamentoPorMes(tenantId),
    ]);

    const pessoas: EntradaPessoa[] = usuariosRes.rows.map(r => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return {
        id: r.id as string,
        nome: (r.nome as string) || String(d.nome ?? ''),
        vinculo: d.vinculo as EntradaPessoa['vinculo'],
        // Campos extras que a tela usa para cadastrar quem ainda não tem
        // vínculo. Não fazem parte do cálculo.
        ...({
          email: String(d.email ?? ''),
          perfil: String(d.perfil ?? ''),
          ativo: d.ativo !== false,
        } as Record<string, unknown>),
      };
    });

    return NextResponse.json({ pessoas, faturamento });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao para editar a folha' }, { status: 403 });
    }
    const tenantId = await getTenantId();
    const body = await req.json();

    if (String(body.acao || '') !== 'salvar_vinculo') {
      return NextResponse.json({ error: `Acao desconhecida: ${body.acao}` }, { status: 400 });
    }

    const usuarioId = String(body.usuario_id || '');
    const vinculo = body.vinculo as Record<string, unknown> | null;
    if (!usuarioId) return NextResponse.json({ error: 'usuario_id e obrigatorio' }, { status: 400 });

    // Tirar da folha apaga o vínculo, não a pessoa: histórico de conta a
    // pagar já lançada continua de pé.
    const patch = vinculo === null
      ? `data = data - 'vinculo'`
      : `data = data || $1::jsonb`;
    const params = vinculo === null
      ? [usuarioId, tenantId]
      : [JSON.stringify({ vinculo }), usuarioId, tenantId];
    const idx = vinculo === null ? { id: '$1', tenant: '$2' } : { id: '$2', tenant: '$3' };

    const upd = await pool.query(
      `UPDATE usuarios SET ${patch}, updated_at = NOW()
        WHERE id = ${idx.id} AND tenant_id = ${idx.tenant}`,
      params,
    );
    if (upd.rowCount === 0) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
