import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { generateId } from '@/lib/utils';
import { round2, num, paraISO } from '@/lib/money';

const TABLE = 'extrato_bancario';

interface LinhaImportada {
  data: string;
  descricao: string;
  valor: number;
  fitid?: string;
}

/**
 * Chave de idempotência de uma linha de extrato.
 * Quando o banco fornece FITID (OFX), ele é a identidade oficial da transação
 * e basta. Sem FITID (CSV), a tupla conta + data + valor + descrição é o mais
 * próximo disso — duas linhas realmente idênticas no mesmo dia são
 * indistinguíveis e por definição não podem ser separadas.
 */
function chaveLinha(contaId: string, l: { data?: unknown; valor?: unknown; descricao?: unknown; fitid?: unknown }): string {
  const fitid = typeof l.fitid === 'string' ? l.fitid.trim() : '';
  if (fitid) return `${contaId}|fitid:${fitid}`;
  const data = paraISO(typeof l.data === 'string' ? l.data : '');
  const valor = round2(num(l.valor)).toFixed(2);
  const desc = String(l.descricao ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${contaId}|${data}|${valor}|${desc}`;
}

/**
 * Importa um extrato inteiro numa única transação.
 *  - Idempotente: linha já existente na conta (FITID, ou data+valor+descrição)
 *    é ignorada, então reimportar o mesmo arquivo não duplica nada.
 *  - Atômico: falha no meio faz ROLLBACK — nunca fica importação parcial.
 */
export async function POST(req: Request) {
  try {
    await initDB();
    const body = await req.json();
    const contaId = String(body?.conta_bancaria_id ?? '');
    const arquivoOrigem = String(body?.arquivo_origem ?? '');
    const linhas: LinhaImportada[] = Array.isArray(body?.linhas) ? body.linhas : [];

    if (!contaId) return NextResponse.json({ error: 'conta_bancaria_id é obrigatório' }, { status: 400 });
    if (linhas.length === 0) return NextResponse.json({ inseridas: 0, duplicadas: 0, total: 0 });
    if (!pool) return NextResponse.json({ inseridas: 0, duplicadas: 0, total: linhas.length });

    const tenantId = await getTenantId();

    // Chaves já existentes na conta — base da deduplicação.
    const { rows: existentes } = await pool.query(
      `SELECT data FROM ${TABLE} WHERE tenant_id = $1 AND conta_bancaria_id = $2`,
      [tenantId, contaId],
    );
    const vistas = new Set<string>(
      existentes.map(r => chaveLinha(contaId, (r.data ?? {}) as Record<string, unknown>)),
    );

    const importadoEm = new Date().toISOString();
    const client = await pool.connect();
    let inseridas = 0;
    let duplicadas = 0;
    try {
      await client.query('BEGIN');
      // Saldo corrente acumulado sobre TODAS as linhas do arquivo (inclusive as
      // ignoradas), para que a coluna saldo reflita o extrato original.
      let saldo = 0;
      for (const l of linhas) {
        const valor = round2(num(l.valor));
        saldo = round2(saldo + valor);
        const chave = chaveLinha(contaId, l);
        if (vistas.has(chave)) { duplicadas++; continue; }
        vistas.add(chave);

        const fitid = typeof l.fitid === 'string' ? l.fitid.trim() : '';
        const item = {
          id: generateId(),
          conta_bancaria_id: contaId,
          data: paraISO(l.data),
          descricao: String(l.descricao ?? ''),
          valor,
          tipo: valor >= 0 ? 'CREDITO' : 'DEBITO',
          saldo,
          status_conciliacao: 'PENDENTE',
          lancamento_vinculado_id: null,
          lancamento_vinculado_tipo: null,
          observacao_conciliacao: '',
          importado_em: importadoEm,
          arquivo_origem: arquivoOrigem,
          // FITID do OFX: identidade da transação no banco, guardada para que
          // reimportações futuras reconheçam a linha mesmo se a descrição mudar.
          ...(fitid ? { fitid } : {}),
        };

        await client.query(
          `INSERT INTO ${TABLE} (id, tenant_id, conta_bancaria_id, status_conciliacao, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
          [item.id, tenantId, contaId, 'PENDENTE', JSON.stringify(item)],
        );
        inseridas++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({ inseridas, duplicadas, total: linhas.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
