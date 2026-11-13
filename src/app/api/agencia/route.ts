import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    // ORDER BY explícito: sem ele, um tenant que herdou duas linhas (a
    // 'default' antiga e a do signup) recebia ora uma ora outra entre
    // requisições, e a tela de configurações piscava dados diferentes.
    const { rows } = await pool.query(
      'SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1',
      [tenantId],
    );
    return NextResponse.json(rows.length > 0 ? rows[0].data : null);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const data = await req.json();
    if (!pool) return NextResponse.json(data);
    const tenantId = await getTenantId();

    // O domínio personalizado foi removido do produto. O GET devolve o valor
    // órfão que ainda está no JSONB e a tela o carrega no estado por spread,
    // então sem este descarte ele voltaria a ser gravado para sempre. Assim
    // ele some do documento no próximo salvamento, sem UPDATE em massa.
    delete (data as Record<string, unknown>).custom_proposta_domain;

    // O id era a constante 'default' com PK só em id: uma linha de agencia
    // para o banco inteiro. Toda tela de Configurações escrevia nela, o
    // tenant_id continuava do primeiro que salvou, e razão social, CNPJ,
    // CADASTUR e domínio de proposta vazavam entre agências.
    //
    // Reaproveitamos o id que o tenant já tem ('default' herdado, ou o
    // 'singleton-<tenant>' criado pelo signup). Gravar um id novo criaria
    // uma segunda linha para o mesmo tenant e o GET passaria a escolher
    // entre duas ao acaso.
    const { rows: atual } = await pool.query(
      `SELECT id FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
      [tenantId],
    );
    const agenciaId = atual.length > 0 ? (atual[0].id as string) : `agencia-${tenantId}`;
    // Atualiza e, se não existir, insere — em vez de ON CONFLICT. A cláusula
    // de conflito precisa casar exatamente com a chave única existente, então
    // ela amarraria esta rota ao sucesso da promoção de PK para (id, tenant_id).
    // Assim a tela salva em qualquer um dos dois estados do schema.
    const atualizado = await pool.query(
      `UPDATE agencia SET data = $3, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [agenciaId, tenantId, JSON.stringify(data)]
    );
    if ((atualizado.rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO agencia (id, tenant_id, data, updated_at) VALUES ($1, $2, $3, NOW())`,
        [agenciaId, tenantId, JSON.stringify(data)]
      );
    }
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
