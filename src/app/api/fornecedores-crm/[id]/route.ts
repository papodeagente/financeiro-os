import { NextResponse } from 'next/server';
import { recusaExclusao } from '@/lib/guarda-rota';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { enviarFornecedorAoCrm, enviarRemocaoDeFornecedorAoCrm } from '@/lib/crm-integration';
import { getSession } from '@/lib/auth';
import { pode } from '@/lib/permissoes-servidor';
import { decidirGravacaoDoFornecedor, semDadosFinanceiros } from '@/lib/fornecedor-permissao';

// Permissões (E7, 06/11/2026): ver src/lib/fornecedor-permissao.ts. Ler segue
// aberto a quem está logado (sem dados bancários fora do financeiro); editar
// exige "Lançar e editar no financeiro", e mudar as regras de faturamento
// exige também "Montar fatura de fornecedor".

const TABLE = 'fornecedores_crm';
const INDEX_COLS = ['nome_fantasia', 'cnpj', 'categoria'];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessao = await getSession();
    if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    await initDB();
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const { id } = await params;
    const { rows } = await pool.query(
      `SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json((await pode(sessao, 'ver_financeiro')) ? rows[0].data : semDadosFinanceiros(rows[0].data ?? {}));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessao = await getSession();
    if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    if (!(await pode(sessao, 'editar_financeiro'))) {
      return NextResponse.json({ error: 'Seu acesso não inclui alterar o cadastro de fornecedores. Peça a quem cuida do financeiro.' }, { status: 403 });
    }
    await initDB();
    const { id } = await params;
    const item = await req.json();
    if (!item || typeof item !== 'object') return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
    if (!pool) return NextResponse.json(item);
    const tenantId = await getTenantId();
    const { rows: atual } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (atual.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const decisao = decidirGravacaoDoFornecedor(atual[0].data ?? {}, item as Record<string, unknown>, {
      editar: true, regras: await pode(sessao, 'gerar_fatura_fornecedor'),
    });
    if (!decisao.ok) return NextResponse.json({ error: decisao.error }, { status: decisao.status });

    const paramValues: unknown[] = [id, JSON.stringify(item)];
    const setClauses = ['data = $2', 'updated_at = NOW()'];
    INDEX_COLS.forEach((col, i) => {
      const paramNum = i + 3;
      paramValues.push(item[col] ?? '');
      setClauses.push(`${col} = $${paramNum}`);
    });
    paramValues.push(tenantId);
    const tenantParamNum = paramValues.length;
    await pool.query(
      `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $${tenantParamNum}`,
      paramValues,
    );

    // O CRM recebe o cadastro como ficou, com o vínculo (se já houver).
    void enviarFornecedorAoCrm(tenantId, id);

    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Excluir é do perfil que exclui, como no resto do sistema (05/11/2026).
  const recusa = await recusaExclusao();
  if (recusa) return recusa;
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ ok: true });
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2 RETURNING crm_supplier_id`,
      [id, tenantId],
    );
    // Apagado aqui, desativado no CRM: negociações antigas citam o fornecedor.
    if (rows.length > 0) {
      void enviarRemocaoDeFornecedorAoCrm(tenantId, {
        id,
        crmSupplierId: rows[0].crm_supplier_id == null ? null : String(rows[0].crm_supplier_id),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
