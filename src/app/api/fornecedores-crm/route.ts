import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { enviarFornecedorAoCrm } from '@/lib/crm-integration';
import { pode } from '@/lib/permissoes-servidor';
import { decidirGravacaoDoFornecedor, semDadosFinanceiros } from '@/lib/fornecedor-permissao';

const TABLE = 'fornecedores_crm';
const INDEX_COLS = ['nome_fantasia', 'cnpj', 'categoria'];

// Permissões do cadastro (E7, 06/11/2026): ver src/lib/fornecedor-permissao.ts.
// Ler continua para quem está logado na agência (o vendedor escolhe o
// fornecedor na Nova venda), sem os dados bancários para quem não acessa o
// financeiro. Criar continua aberto, mas sem o direito as regras de
// faturamento nascem no padrão; editar o que existe exige o direito.

export async function GET() {
  try {
    const sessao = await getSession();
    if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    await initDB();
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT data FROM ${TABLE} WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    const financeiro = await pode(sessao, 'ver_financeiro');
    return NextResponse.json(rows.map(r => (financeiro ? r.data : semDadosFinanceiros(r.data ?? {}))));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sessao = await getSession();
    if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    await initDB();
    const recebido = await req.json();
    if (!recebido || !recebido.id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 });
    if (!pool) return NextResponse.json(recebido);
    const tenantId = await getTenantId();

    // O POST é upsert: id que já existe é edição e segue as regras de edição.
    const { rows: atual } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [recebido.id, tenantId]);
    const decisao = decidirGravacaoDoFornecedor(
      (atual[0]?.data ?? null) as Record<string, unknown> | null, recebido as Record<string, unknown>,
      { editar: await pode(sessao, 'editar_financeiro'), regras: await pode(sessao, 'gerar_fatura_fornecedor') },
    );
    if (!decisao.ok) return NextResponse.json({ error: decisao.error }, { status: decisao.status });
    const item = decisao.item;

    const paramValues: unknown[] = [item.id, tenantId, JSON.stringify(item)];
    const insertCols = ['id', 'tenant_id', 'data'];
    const insertVals = ['$1', '$2', '$3'];
    const updateSets = ['data = $3', 'updated_at = NOW()'];
    INDEX_COLS.forEach((col, i) => {
      const paramNum = i + 4;
      paramValues.push(item[col] ?? '');
      insertCols.push(col);
      insertVals.push(`$${paramNum}`);
      updateSets.push(`${col} = $${paramNum}`);
    });
    // Guarda de tenant no conflito: fornecedor carrega regras_faturamento,
    // que alimentam a geração de contas a pagar. Sobrescrever o fornecedor
    // de outro tenant alteraria as contas geradas nas vendas dele.
    await pool.query(
      `INSERT INTO ${TABLE} (${insertCols.join(', ')}, created_at, updated_at)
       VALUES (${insertVals.join(', ')}, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET ${updateSets.join(', ')}
       WHERE ${TABLE}.tenant_id = EXCLUDED.tenant_id`,
      paramValues,
    );

    // O CRM recebe o cadastro como ficou, com o vínculo (se já houver).
    void enviarFornecedorAoCrm(tenantId, String(item.id));

    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
