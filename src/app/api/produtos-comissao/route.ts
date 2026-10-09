import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';

/**
 * Os produtos que uma regra de comissão pode escolher.
 *
 * O OS FIN não tem cadastro de produto — ele foi para o CRM. Então a lista é
 * montada das duas fontes que existem aqui:
 *
 *  1. os GRUPOS que esta agência publica no catálogo do CRM (ficam
 *     disponíveis na hora, antes de qualquer venda);
 *  2. os produtos que já APARECERAM em alguma venda, com o id que o CRM
 *     mandou (é como um produto nascido no CRM fica conhecido aqui).
 *
 * Um produto que nunca foi vendido e não é grupo desta agência não aparece:
 * oferecer na tela um id que o cálculo nunca vai casar seria prometer uma
 * regra que não paga.
 */
export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();

    const { rows } = await pool.query(
      `SELECT id, nome, origem FROM (
         SELECT g.id AS id,
                NULLIF(TRIM(CONCAT_WS(' · ', NULLIF(g.grp_id, ''), NULLIF(g.origem_destino, ''))), '') AS nome,
                'GRUPO' AS origem,
                g.updated_at AS quando
           FROM grupos g
          WHERE g.tenant_id = $1

         UNION ALL

         SELECT p->>'produto_id' AS id,
                NULLIF(TRIM(p->>'descricao'), '') AS nome,
                'VENDA' AS origem,
                v.updated_at AS quando
           FROM vendas_crm v
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.data->'produtos', '[]'::jsonb)) AS p
          WHERE v.tenant_id = $1
            AND NULLIF(TRIM(p->>'produto_id'), '') IS NOT NULL
       ) t
       WHERE id IS NOT NULL AND id <> ''
       GROUP BY id, nome, origem
       ORDER BY MAX(quando) DESC
       LIMIT 500`,
      [tenantId],
    );

    // Um produto vendido que também é grupo daqui aparece uma vez só: o
    // grupo ganha, porque é o nome que a agência cadastrou.
    const vistos = new Set<string>();
    const lista: Array<{ id: string; nome: string; origem: string }> = [];
    for (const r of [...rows].sort((a, b) => (a.origem === 'GRUPO' ? -1 : 1) - (b.origem === 'GRUPO' ? -1 : 1))) {
      const id = String(r.id);
      if (vistos.has(id)) continue;
      vistos.add(id);
      lista.push({ id, nome: String(r.nome ?? '') || id, origem: String(r.origem) });
    }
    return NextResponse.json(lista);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Não foi possível listar os produtos' },
      { status: 500 },
    );
  }
}
