/**
 * A fatura do fornecedor vista de dentro da venda (E5, parte C): as duas
 * consultas que a venda completa (venda-servidor.ts) precisa para conviver
 * com a fatura, sem depender do resto do módulo do fornecedor.
 *
 *  - `contasNaFaturaDoFornecedor`: as contas da venda que estão numa fatura
 *    valendo. A regeração das contas da venda as trata como TRAVADAS (como as
 *    baixadas): não muda, não apaga, e a diferença da venda vai para uma conta
 *    livre ("complemento"), que entra na próxima fatura.
 *  - `refletirFaturasNasContas`: a posição da venda lê a conta que entrou na
 *    fatura como viva, com o pagamento da fatura (fornecedor-fatura.ts).
 *
 * Sem as tabelas da parte C (ambiente antigo), as duas não fazem nada.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { refletirContaFaturada, type FaturaParaReflexo } from './fornecedor-fatura';
import { paraCentavos, num } from './money';

let tabelaPronta = false;
async function temFaturas(exec: ExecutorSQL): Promise<boolean> {
  if (tabelaPronta) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.faturas_fornecedor') IS NOT NULL AS ok`);
  tabelaPronta = rows[0]?.ok === true;
  return tabelaPronta;
}

/** Ids das contas a pagar da venda que estão numa fatura do fornecedor. */
export async function contasNaFaturaDoFornecedor(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<Set<string>> {
  const { rows } = await exec.query(
    `SELECT id FROM contas_pagar
      WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND COALESCE(data->>'fatura_fornecedor_id', '') <> ''`,
    [tenantId, vendaId],
  );
  return new Set(rows.map(r => String(r.id)));
}

/** As faturas (com a conta a pagar delas) para refletir o pagamento nas contas das vendas. */
export async function faturasParaReflexo(exec: ExecutorSQL, tenantId: string, ids: string[]): Promise<Map<string, FaturaParaReflexo>> {
  const mapa = new Map<string, FaturaParaReflexo>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length || !(await temFaturas(exec))) return mapa;
  const { rows } = await exec.query(
    `SELECT f.id, f.numero, f.situacao, f.vencimento::text AS vencimento, f.valor_itens_centavos, f.sinal_centavos,
            c.data AS conta
       FROM faturas_fornecedor f
       LEFT JOIN contas_pagar c ON c.tenant_id = f.tenant_id AND c.id = f.conta_pagar_id
      WHERE f.tenant_id = $1 AND f.id = ANY($2::text[])`,
    [tenantId, unicos],
  );
  for (const r of rows) {
    const c = (r.conta ?? null) as Record<string, unknown> | null;
    mapa.set(String(r.id), {
      id: String(r.id), numero: String(r.numero), situacao: String(r.situacao), vencimento: String(r.vencimento ?? '').slice(0, 10),
      valor_itens_centavos: Number(r.valor_itens_centavos) || 0, sinal_centavos: Number(r.sinal_centavos) || 0,
      conta_status: c ? String(c.status ?? '') : null,
      conta_valor_centavos: c ? paraCentavos(num(c.valor_final)) : 0,
      conta_pago_centavos: c ? paraCentavos(num(c.valor_pago)) : 0,
    });
  }
  return mapa;
}

/** As contas a pagar com as que estão em fatura lidas pela fatura (o resto passa igual). */
export async function refletirFaturasNasContas(
  exec: ExecutorSQL, tenantId: string, contas: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const ids = contas.map(c => String(c.fatura_fornecedor_id ?? '')).filter(Boolean);
  if (!ids.length) return contas;
  const faturas = await faturasParaReflexo(exec, tenantId, ids);
  return contas.map(c => {
    const f = faturas.get(String(c.fatura_fornecedor_id ?? ''));
    return f && f.situacao === 'GERADA' ? refletirContaFaturada(c, f) : c;
  });
}
