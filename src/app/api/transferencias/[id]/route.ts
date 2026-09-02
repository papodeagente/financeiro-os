import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { aplicarMovimentoCaixa } from '@/lib/caixa-helpers';
import { num, round2, hojeISO } from '@/lib/money';

const TABLE = 'transferencias';
const INDEX_COLS = ['conta_origem_id', 'conta_destino_id', 'status'];

type Registro = Record<string, unknown>;

function contaId(t: Registro, campo: 'conta_origem_id' | 'conta_destino_id'): string | null {
  const v = t[campo];
  return typeof v === 'string' && v ? v : null;
}

// Aplica a transferência no saldo das contas: sai da origem, entra no destino.
// sinal = +1 efetiva, sinal = -1 estorna. O delta é sempre calculado aqui,
// no servidor, e aplicado via aplicarMovimentoCaixa (que relê o saldo do
// banco) — o cliente NUNCA envia saldo_atual.
async function aplicarTransferencia(tenantId: string, t: Registro, sinal: 1 | -1): Promise<void> {
  const valor = round2(num(t.valor));
  if (valor <= 0) return;
  await aplicarMovimentoCaixa(tenantId, contaId(t, 'conta_origem_id'), -valor * sinal);
  await aplicarMovimentoCaixa(tenantId, contaId(t, 'conta_destino_id'), +valor * sinal);
}

// Contas que a transferência referencia mas que não existem mais no cadastro.
// aplicarMovimentoCaixa ignora conta inexistente em silêncio, então validamos
// antes: sem as duas contas não há como movimentar/estornar o saldo.
async function contasFaltando(tenantId: string, ids: Array<string | null>): Promise<string[]> {
  const alvo = [...new Set(ids.filter((i): i is string => !!i))];
  if (alvo.length === 0 || !pool) return [];
  const placeholders = alvo.map((_, i) => `$${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `SELECT id FROM contas_bancarias WHERE tenant_id = $1 AND id IN (${placeholders})`,
    [tenantId, ...alvo],
  );
  const existentes = new Set(rows.map(r => r.id as string));
  return alvo.filter(id => !existentes.has(id));
}

function mesmoMovimento(a: Registro, b: Registro): boolean {
  return (
    contaId(a, 'conta_origem_id') === contaId(b, 'conta_origem_id') &&
    contaId(a, 'conta_destino_id') === contaId(b, 'conta_destino_id') &&
    round2(num(a.valor)) === round2(num(b.valor))
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0].data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT é o único caminho que mexe no saldo das contas bancárias por causa de
// transferência. Transições tratadas:
//   → EFETIVADA        : debita a origem e credita o destino
//   EFETIVADA → outro  : estorna (credita a origem, debita o destino)
//   EFETIVADA → EFETIVADA com valor/contas diferentes: estorna o antigo e
//                        aplica o novo
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    const item = { ...(body as Registro) } as Registro;
    if (!pool) return NextResponse.json(item);
    const tenantId = await getTenantId();

    const { rows: prevRows } = await pool.query(
      `SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (prevRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const prev = (prevRows[0].data ?? {}) as Registro;

    const prevStatus = String(prev.status ?? '');
    const novoStatus = String(item.status ?? '');
    const eraEfetivada = prevStatus === 'EFETIVADA';
    const ficaEfetivada = novoStatus === 'EFETIVADA';

    if (ficaEfetivada) {
      const valor = round2(num(item.valor));
      const origem = contaId(item, 'conta_origem_id');
      const destino = contaId(item, 'conta_destino_id');
      if (valor <= 0) return NextResponse.json({ error: 'Valor da transferência deve ser maior que zero' }, { status: 400 });
      if (!origem || !destino || origem === destino) {
        return NextResponse.json({ error: 'Origem e destino devem ser contas diferentes' }, { status: 400 });
      }
      // Carimbo de efetivação é do servidor (data civil no fuso do tenant).
      if (!eraEfetivada || !item.data_efetivacao) item.data_efetivacao = hojeISO();
    } else if (eraEfetivada) {
      item.data_efetivacao = null;
    }

    // Nada muda no caixa quando a transferência não estava nem fica efetivada,
    // ou quando segue efetivada com exatamente o mesmo movimento.
    const semEfeitoNoCaixa =
      (!eraEfetivada && !ficaEfetivada) ||
      (eraEfetivada && ficaEfetivada && mesmoMovimento(prev, item));

    if (!semEfeitoNoCaixa) {
      const faltando = await contasFaltando(tenantId, [
        eraEfetivada ? contaId(prev, 'conta_origem_id') : null,
        eraEfetivada ? contaId(prev, 'conta_destino_id') : null,
        ficaEfetivada ? contaId(item, 'conta_origem_id') : null,
        ficaEfetivada ? contaId(item, 'conta_destino_id') : null,
      ]);
      if (faltando.length > 0) {
        return NextResponse.json(
          { error: 'Conta bancária da transferência não existe mais — saldo não pode ser movimentado.' },
          { status: 409 },
        );
      }
    }

    const paramValues: unknown[] = [id, tenantId, JSON.stringify(item)];
    const setClauses = ['data = $3', 'updated_at = NOW()'];
    INDEX_COLS.forEach((col, i) => {
      paramValues.push(item[col] ?? '');
      setClauses.push(`${col} = $${i + 4}`);
    });
    await pool.query(`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2`, paramValues);

    if (!semEfeitoNoCaixa) {
      if (eraEfetivada) await aplicarTransferencia(tenantId, prev, -1);
      if (ficaEfetivada) await aplicarTransferencia(tenantId, item, +1);
    }

    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Excluir transferência EFETIVADA estorna os saldos antes de apagar. Se o
// estorno não for possível (conta apagada), a exclusão é bloqueada — apagar
// sem reverter deixaria o saldo das contas errado para sempre.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ ok: true });
    const tenantId = await getTenantId();

    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) return NextResponse.json({ ok: true });
    const prev = (rows[0].data ?? {}) as Registro;

    if (String(prev.status ?? '') === 'EFETIVADA') {
      const faltando = await contasFaltando(tenantId, [
        contaId(prev, 'conta_origem_id'),
        contaId(prev, 'conta_destino_id'),
      ]);
      if (faltando.length > 0) {
        return NextResponse.json(
          { error: 'Transferência efetivada não pode ser excluída: conta bancária ausente impede o estorno do saldo.' },
          { status: 409 },
        );
      }
      await aplicarTransferencia(tenantId, prev, -1);
    }

    await pool.query(`DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
