import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { hojeISO } from '@/lib/money';
import { montarPerfilDoCliente } from '@/lib/perfil-do-cliente';

/**
 * O retrato de um cliente numa requisição.
 *
 * GUARDA FINANCEIRA. Esta tela mostra o que o cliente já pagou, o que deve e o
 * que está vencido — dado de dono, do mesmo tipo que o dashboard protege. As
 * rotas antigas de contas a receber não exigem permissão de financeiro; esta
 * exige, pelo mesmo motivo que o dashboard passou a exigir: não ampliar a
 * brecha enquanto ela não é fechada.
 *
 * TUDO FILTRADO POR tenant_id em TODAS as quatro consultas. Sem chave
 * estrangeira e sem RLS, o isolamento deste sistema é exatamente o `WHERE`
 * que o autor da consulta escreve.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });

    const recusa = bloqueioFinanceiro(await getSession(), 'ler');
    if (recusa) return NextResponse.json({ error: recusa.erro }, { status: recusa.status });

    const tenantId = await getTenantId();
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: 'Cliente não informado' }, { status: 400 });

    const [cli, vendas, contas, notas] = await Promise.all([
      pool.query(
        `SELECT id, nome, cpf_cnpj, tipo, data, created_at
           FROM clientes WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      ),
      pool.query(
        `SELECT id, status, data FROM vendas_crm
          WHERE cliente_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC LIMIT 200`,
        [id, tenantId],
      ),
      pool.query(
        `SELECT id, status, venda_id, data FROM contas_receber
          WHERE cliente_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC LIMIT 300`,
        [id, tenantId],
      ),
      pool.query(
        `SELECT id, status, conta_receber_id, data FROM notas_fiscais
          WHERE cliente_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC LIMIT 200`,
        [id, tenantId],
      ),
    ]);

    if (cli.rows.length === 0) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    }

    // O status é COLUNA e também vive no documento. A coluna é a que as
    // consultas do sistema filtram, então ela vence na hora de montar o
    // objeto — senão o perfil contaria por um status e a lista por outro.
    const comStatus = (r: { id: string; status: string; data: unknown }) => ({
      ...(r.data as Record<string, unknown>),
      id: r.id,
      status: r.status,
    });

    const linhasVendas = vendas.rows.map(comStatus);
    const linhasContas = contas.rows.map(r => ({
      ...comStatus(r as { id: string; status: string; data: unknown }),
      venda_id: (r as { venda_id?: string }).venda_id ?? '',
    }));
    const linhasNotas = notas.rows.map(r => ({
      ...comStatus(r as { id: string; status: string; data: unknown }),
      conta_receber_id: (r as { conta_receber_id?: string }).conta_receber_id ?? '',
    }));

    const c = cli.rows[0];
    const perfil = montarPerfilDoCliente({
      vendas: linhasVendas,
      contas: linhasContas,
      notas: linhasNotas,
      hoje: hojeISO(),
    });

    return NextResponse.json({
      cliente: { ...(c.data as Record<string, unknown>), id: c.id, nome: c.nome, cpf_cnpj: c.cpf_cnpj, tipo: c.tipo, cliente_desde: c.created_at },
      perfil,
      vendas: linhasVendas,
      contas: linhasContas,
      notas: linhasNotas,
    });
  } catch (e) {
    console.error('[perfil-cliente]', e);
    return NextResponse.json({ error: 'Não foi possível montar o perfil' }, { status: 500 });
  }
}
