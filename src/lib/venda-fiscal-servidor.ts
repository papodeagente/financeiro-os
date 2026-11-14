/**
 * Notas fiscais e retenção na fonte de uma venda, para a ficha (E7,
 * 06/11/2026). Só leitura; regras em ./venda-fiscal.ts.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { contasDaVendaNoBanco } from './venda-servidor';
import { resumoFiscalDaVenda, type FiscalDaVenda } from './venda-fiscal';

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export async function fiscalDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<FiscalDaVenda> {
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.notas_fiscais') IS NOT NULL AS ok`);
  const notas = tem[0]?.ok
    ? (await exec.query(
      // As notas da regra têm a venda; as de antes, só a conta a receber da venda.
      `SELECT n.id, n.status, n.data, n.created_at::text AS criado_em
         FROM notas_fiscais n
         LEFT JOIN contas_receber c ON c.tenant_id = n.tenant_id AND c.id = n.conta_receber_id
        WHERE n.tenant_id = $1
          AND (n.venda_id = $2 OR COALESCE(c.data->>'origem_venda_id', c.data->>'venda_id', c.venda_id, '') = $2)
        ORDER BY n.created_at DESC
        LIMIT 200`,
      [tenantId, vendaId],
    )).rows
    : [];
  const { contas_receber } = await contasDaVendaNoBanco(exec, tenantId, vendaId);
  return resumoFiscalDaVenda(
    notas.map(r => ({ id: txt(r.id), status: txt(r.status), data: (r.data ?? {}) as Record<string, unknown>, criado_em: txt(r.criado_em) })),
    contas_receber,
  );
}
