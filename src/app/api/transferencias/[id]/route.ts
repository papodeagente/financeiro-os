import { recusaFinanceira, recusaExclusao, respostaPeriodoFechado } from '@/lib/guarda-rota';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { aplicarMovimentoCaixaAtomico, emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { num, round2, hojeISO } from '@/lib/money';
import { lerCarimbo, moedaDe, pernasDaTransferencia, planoDaTransferencia } from '@/lib/cambio';

const TABLE = 'transferencias';
const INDEX_COLS = ['conta_origem_id', 'conta_destino_id', 'status'];

type Registro = Record<string, unknown>;

function contaId(t: Registro, campo: 'conta_origem_id' | 'conta_destino_id'): string | null {
  const v = t[campo];
  return typeof v === 'string' && v ? v : null;
}

// Aplica a transferência no saldo das contas: sai da origem, entra no destino.
// sinal = +1 efetiva, sinal = -1 estorna. O delta é sempre calculado aqui,
// no servidor — o cliente NUNCA envia saldo_atual.
//
// As duas pernas vivem na MESMA transação e cada uma é um UPDATE atômico. A
// versão anterior fazia duas chamadas soltas de ler-modificar-gravar, fora de
// transação e com o erro engolido: uma falha depois da primeira perna tirava o
// dinheiro da origem sem colocar no destino, e a resposta ainda era 200.
// Perna que não afeta nenhuma linha agora lança, e a transação inteira volta.
async function aplicarTransferencia(
  tenantId: string,
  t: Registro,
  sinal: 1 | -1,
  exec: ExecutorSQL,
): Promise<void> {
  // Entre moedas (05/11/2026, E6): sai `valor` da origem, entra
  // `valor_destino` no destino e a tarifa sai da origem. Transferência
  // antiga não tem esses campos: o mesmo valor nas duas pontas, como antes.
  const { sai, entra, tarifa } = pernasDaTransferencia(t);
  if (sai <= 0) return;
  const origem = contaId(t, 'conta_origem_id');
  const destino = contaId(t, 'conta_destino_id');

  const mov = {
    tipo: 'transferencia' as const,
    tabela: 'transferencias',
    id: typeof t.id === 'string' ? t.id : undefined,
    descricao: sinal === 1 ? 'Transferência entre contas' : 'Transferência entre contas (estorno)',
    // pernasDaTransferencia já pôs cada ponta na moeda da sua conta.
    naMoedaDaConta: true,
  };
  // A tarifa sai junto com o valor, num movimento só: o razão aceita um
  // movimento por conta e por origem em cada transação.
  const movOrigem = tarifa > 0
    ? { ...mov, descricao: sinal === 1 ? 'Transferência entre contas (com tarifa)' : 'Transferência entre contas (estorno, com tarifa)' }
    : mov;
  const saiu = await aplicarMovimentoCaixaAtomico(tenantId, origem, -round2(sai + tarifa) * sinal, exec, movOrigem);
  if (!saiu) throw new Error('Saldo da conta de origem não pôde ser movimentado.');
  const entrou = await aplicarMovimentoCaixaAtomico(tenantId, destino, +entra * sinal, exec, mov);
  if (!entrou) throw new Error('Saldo da conta de destino não pôde ser movimentado.');
}

/**
 * Moedas das duas contas e o plano da transferência (valor que chega, tarifa
 * e câmbio). Grava no item o que foi usado, com a fonte do câmbio.
 */
async function prepararMoedas(tenantId: string, item: Registro, exec: ExecutorSQL): Promise<string | null> {
  const origem = contaId(item, 'conta_origem_id');
  const destino = contaId(item, 'conta_destino_id');
  const { rows } = await exec.query(
    `SELECT id, data->>'moeda' AS moeda FROM contas_bancarias WHERE tenant_id = $1 AND id IN ($2, $3)`,
    [tenantId, origem, destino],
  );
  const moedaDaConta = (id: string | null) => moedaDe(rows.find(r => r.id === id)?.moeda);
  const plano = planoDaTransferencia({
    valor: num(item.valor), moeda_origem: moedaDaConta(origem), moeda_destino: moedaDaConta(destino),
    cambio: num(item.cambio), tarifa: num(item.tarifa),
  });
  if (plano.erros.length) return plano.erros[0];
  item.moeda_origem = plano.moeda_origem;
  item.moeda_destino = plano.moeda_destino;
  item.tarifa = plano.tarifa;
  if (plano.cambio !== null) {
    item.cambio = plano.cambio;
    item.valor_destino = plano.valor_destino;
    item.cambio_carimbo = lerCarimbo(item.cambio_carimbo, plano.cambio);
  } else {
    // Mesma moeda: nada de câmbio; o mesmo valor nas duas pontas.
    delete item.cambio;
    delete item.cambio_carimbo;
    delete item.valor_destino;
  }
  return null;
}

// Contas que a transferência referencia mas que não existem mais no cadastro.
// aplicarMovimentoCaixa ignora conta inexistente em silêncio, então validamos
// antes: sem as duas contas não há como movimentar/estornar o saldo.
async function contasFaltando(
  tenantId: string,
  ids: Array<string | null>,
  exec?: ExecutorSQL,
): Promise<string[]> {
  const alvo = [...new Set(ids.filter((i): i is string => !!i))];
  const db = exec ?? (pool as ExecutorSQL | null);
  if (alvo.length === 0 || !db) return [];
  const placeholders = alvo.map((_, i) => `$${i + 2}`).join(', ');
  const { rows } = await db.query(
    `SELECT id FROM contas_bancarias WHERE tenant_id = $1 AND id IN (${placeholders})`,
    [tenantId, ...alvo],
  );
  const existentes = new Set(rows.map(r => r.id as string));
  return alvo.filter(id => !existentes.has(id));
}

function mesmoMovimento(a: Registro, b: Registro): boolean {
  const pa = pernasDaTransferencia(a);
  const pb = pernasDaTransferencia(b);
  return (
    contaId(a, 'conta_origem_id') === contaId(b, 'conta_origem_id') &&
    contaId(a, 'conta_destino_id') === contaId(b, 'conta_destino_id') &&
    round2(num(a.valor)) === round2(num(b.valor)) &&
    pa.entra === pb.entra && pa.tarifa === pb.tarifa
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const recusa = await recusaFinanceira('ler');
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0].data);
  } catch (e) {
    const fechado = respostaPeriodoFechado(e);
    if (fechado) return fechado;
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
    const recusa = await recusaFinanceira('escrever');
    if (recusa) return recusa;
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

    // Tudo numa transação só. O SELECT ... FOR UPDATE serializa PUTs
    // concorrentes na mesma transferência: sem ele, dois cliques liam ambos
    // status PENDENTE e cada um efetivava, movendo o dobro do valor.
    const resultado = await emTransacao(async exec => {
      const { rows: prevRows } = await exec.query(
        `SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (prevRows.length === 0) return { erro: 'Not found', status: 404 as const };
      const prev = (prevRows[0].data ?? {}) as Registro;

      const prevStatus = String(prev.status ?? '');
      const novoStatus = String(item.status ?? '');
      const eraEfetivada = prevStatus === 'EFETIVADA';
      const ficaEfetivada = novoStatus === 'EFETIVADA';

      if (ficaEfetivada) {
        const valor = round2(num(item.valor));
        const origem = contaId(item, 'conta_origem_id');
        const destino = contaId(item, 'conta_destino_id');
        if (valor <= 0) return { erro: 'Valor da transferência deve ser maior que zero', status: 400 as const };
        if (!origem || !destino || origem === destino) {
          return { erro: 'Origem e destino devem ser contas diferentes', status: 400 as const };
        }
        const recusaMoeda = await prepararMoedas(tenantId, item, exec);
        if (recusaMoeda) return { erro: recusaMoeda, status: 400 as const };
        // Carimbo de efetivação é do servidor (data civil no fuso do tenant).
        if (!eraEfetivada || !item.data_efetivacao) item.data_efetivacao = hojeISO();
      } else if (eraEfetivada) {
        item.data_efetivacao = null;
      }

      // Nada muda no caixa quando a transferência não estava nem fica
      // efetivada, ou quando segue efetivada com o mesmo movimento.
      const semEfeitoNoCaixa =
        (!eraEfetivada && !ficaEfetivada) ||
        (eraEfetivada && ficaEfetivada && mesmoMovimento(prev, item));

      if (!semEfeitoNoCaixa) {
        const faltando = await contasFaltando(tenantId, [
          eraEfetivada ? contaId(prev, 'conta_origem_id') : null,
          eraEfetivada ? contaId(prev, 'conta_destino_id') : null,
          ficaEfetivada ? contaId(item, 'conta_origem_id') : null,
          ficaEfetivada ? contaId(item, 'conta_destino_id') : null,
        ], exec);
        if (faltando.length > 0) {
          return {
            erro: 'Conta bancária da transferência não existe mais — saldo não pode ser movimentado.',
            status: 409 as const,
          };
        }
      }

      const paramValues: unknown[] = [id, tenantId, JSON.stringify(item)];
      const setClauses = ['data = $3', 'updated_at = NOW()'];
      INDEX_COLS.forEach((col, i) => {
        paramValues.push(item[col] ?? '');
        setClauses.push(`${col} = $${i + 4}`);
      });
      await exec.query(`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2`, paramValues);

      if (!semEfeitoNoCaixa) {
        if (eraEfetivada) await aplicarTransferencia(tenantId, prev, -1, exec);
        if (ficaEfetivada) await aplicarTransferencia(tenantId, item, +1, exec);
      }

      return { erro: null };
    });

    if (resultado.erro) {
      return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
    }
    return NextResponse.json(item);
  } catch (e) {
    const fechado = respostaPeriodoFechado(e);
    if (fechado) return fechado;
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Excluir transferência EFETIVADA estorna os saldos antes de apagar. Se o
// estorno não for possível (conta apagada), a exclusão é bloqueada — apagar
// sem reverter deixaria o saldo das contas errado para sempre.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const recusa = (await recusaExclusao()) ?? (await recusaFinanceira('escrever'));
    if (recusa) return recusa;
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ ok: true });
    const tenantId = await getTenantId();

    // Estorno e exclusão na mesma transação: se o DELETE falhar depois do
    // estorno, o saldo não pode ficar creditado com a transferência viva.
    const resultado = await emTransacao(async exec => {
      const { rows } = await exec.query(
        `SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (rows.length === 0) return { erro: null };
      const prev = (rows[0].data ?? {}) as Registro;

      if (String(prev.status ?? '') === 'EFETIVADA') {
        const faltando = await contasFaltando(tenantId, [
          contaId(prev, 'conta_origem_id'),
          contaId(prev, 'conta_destino_id'),
        ], exec);
        if (faltando.length > 0) {
          return {
            erro: 'Transferência efetivada não pode ser excluída: conta bancária ausente impede o estorno do saldo.',
            status: 409 as const,
          };
        }
        await aplicarTransferencia(tenantId, prev, -1, exec);
      }

      await exec.query(`DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
      return { erro: null };
    });

    if (resultado.erro) {
      return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const fechado = respostaPeriodoFechado(e);
    if (fechado) return fechado;
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
