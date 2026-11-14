import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { deCentavos } from '@/lib/money';
import { lerConfigCobranca } from '@/lib/cobranca/config';
import { lerCorpo, respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// Taxa de boleto repassada ao cliente (E7, 06/11/2026): a marca "Repassar a taxa do boleto" no cadastro.
//   GET ?cliente_id=  → { cliente_id, cobrar_taxa_boleto, taxa_boleto (reais, de Configurações › Cobrança; 0 = desligada) }
//   PUT { cliente_id, cobrar_taxa_boleto: boolean } → o mesmo. Vale para os próximos boletos; os já emitidos não mudam.
export const dynamic = 'force-dynamic';

async function estado(exec: ExecutorSQL, tenantId: string, clienteId: string) {
  const { rows } = await exec.query(`SELECT data->>'cobrar_taxa_boleto' AS m FROM clientes WHERE tenant_id = $1 AND id = $2`, [tenantId, clienteId]);
  if (!rows.length) return null;
  const { config } = await lerConfigCobranca(exec, tenantId);
  return { cliente_id: clienteId, cobrar_taxa_boleto: rows[0].m === 'true', taxa_boleto: deCentavos(config.taxa_boleto_centavos) };
}

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const clienteId = new URL(req.url).searchParams.get('cliente_id')?.trim();
  if (!clienteId) return NextResponse.json({ error: 'Informe o cliente.' }, { status: 400 });
  try {
    const r = await estado(pool as unknown as ExecutorSQL, await getTenantId(), clienteId);
    return r ? NextResponse.json(r) : NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'taxa do cliente');
  }
}

export async function PUT(req: Request) {
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await lerCorpo<{ cliente_id?: string; cobrar_taxa_boleto?: boolean }>(req);
  const clienteId = String(corpo?.cliente_id ?? '').trim();
  if (!clienteId || typeof corpo?.cobrar_taxa_boleto !== 'boolean') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const tenantId = await getTenantId();
  const exec = pool as unknown as ExecutorSQL;
  try {
    const { rowCount } = await exec.query(
      `UPDATE clientes SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{cobrar_taxa_boleto}', to_jsonb($3::boolean), true), updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, clienteId, corpo.cobrar_taxa_boleto],
    );
    if (!rowCount) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    return NextResponse.json(await estado(exec, tenantId, clienteId));
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'taxa do cliente');
  }
}
