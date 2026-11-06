/**
 * Exclusão lógica e restauração de títulos (06/11/2026, E7).
 *
 * EXCLUIR (DELETE da conta, lote "Excluir"):
 *   1. a linha sai de contas_pagar/contas_receber (o gatilho do Fechar Caixa
 *      continua barrando quando há dinheiro em período fechado: 423);
 *   2. o que já tinha sido pago/recebido volta para a conta bancária que
 *      pagou/recebeu, como sempre foi (estornarBaixaDaConta, com o razão);
 *   3. cada baixa ainda valendo no histórico ganha a linha de estorno, para o
 *      histórico de baixas bater com o título;
 *   4. a linha inteira vai para contas_excluidas, já sem a baixa (em aberto),
 *      com o quanto foi estornado.
 * Como a linha sai da tabela, relatórios, painéis, DRE e fluxo ignoram o
 * excluído sem mudar nada neles.
 *
 * RESTAURAR: a linha volta igual (mesmo id, número, datas de cadastro), em
 * aberto. O dinheiro estornado na exclusão NÃO volta sozinho: se o pagamento
 * de fato aconteceu, liquida-se de novo (com data, conta e encargos certos).
 * Assim o caixa e o razão nunca ganham dinheiro que ninguém registrou.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { estornarBaixaDaConta, statusMovimentaCaixa, valorNoCaixa } from './caixa-atomico';
import { hojeISO, round2 } from './money';

export type TabelaDoTitulo = 'contas_pagar' | 'contas_receber';
import { CONTAS_EXCLUIDAS_SCHEMA_SQL } from './contas-excluidas-schema';
export { CONTAS_EXCLUIDAS_SCHEMA_SQL };

export class ErroDaLixeira extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ErroDaLixeira';
  }
}

export interface QuemFaz { id?: string | null; nome?: string | null }

export interface BaixaEstornada {
  valor: number;
  conta_bancaria_id: string | null;
  data: string;
  status: string;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O título como fica guardado: em aberto, sem a baixa que a exclusão estornou. */
export function semABaixa(tabela: TabelaDoTitulo, data: Record<string, unknown>): Record<string, unknown> {
  if (!statusMovimentaCaixa(String(data.status ?? ''))) return { ...data };
  const pagar = tabela === 'contas_pagar';
  return {
    ...data,
    status: 'PENDENTE',
    [pagar ? 'valor_pago' : 'valor_recebido']: 0,
    [pagar ? 'data_pagamento' : 'data_recebimento']: '',
  };
}

/** O aviso da exclusão para a tela (null quando não havia dinheiro). */
export function avisoDaExclusao(tabela: TabelaDoTitulo, estornado: BaixaEstornada | null): string | null {
  if (!estornado || estornado.valor <= 0) return null;
  return tabela === 'contas_pagar'
    ? `Os ${brl(estornado.valor)} pagos voltaram para a conta bancária que pagou.`
    : `Os ${brl(estornado.valor)} recebidos saíram da conta bancária que recebeu.`;
}

/** O aviso da restauração para a tela (null quando não havia dinheiro). */
export function avisoDaRestauracao(tabela: TabelaDoTitulo, estornado: BaixaEstornada | null): string | null {
  if (!estornado || !(estornado.valor > 0)) return null;
  return tabela === 'contas_pagar'
    ? `A conta voltou em aberto. O pagamento de ${brl(estornado.valor)} foi estornado na exclusão; se ele aconteceu, liquide de novo.`
    : `A conta voltou em aberto. O recebimento de ${brl(estornado.valor)} foi estornado na exclusão; se ele aconteceu, liquide de novo.`;
}

let lixeiraPronta = false;
/** O initDB cria a tabela; isto só cobre banco que ainda não passou por ele. */
async function garantirLixeira(exec: ExecutorSQL): Promise<void> {
  if (lixeiraPronta) return;
  const { rows } = await exec.query(`SELECT to_regclass('public.contas_excluidas') IS NOT NULL AS ok`);
  if (rows[0]?.ok !== true) {
    // Um comando por vez (alguns drivers não aceitam vários num pedido só).
    for (const comando of CONTAS_EXCLUIDAS_SCHEMA_SQL.split(';').map(c => c.trim()).filter(Boolean)) await exec.query(comando);
  }
  lixeiraPronta = true;
}

let temBaixas: boolean | null = null;
async function existeHistoricoDeBaixas(exec: ExecutorSQL): Promise<boolean> {
  if (temBaixas) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.baixas') IS NOT NULL AS ok`);
  temBaixas = rows[0]?.ok === true;
  return temBaixas;
}

/**
 * Exclui logicamente, dentro da transação do chamador. Devolve null quando a
 * conta não existe (ou já foi excluída: o segundo clique não estorna de novo).
 */
export async function excluirTitulo(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, id: string, quem: QuemFaz = {},
): Promise<{ estornado: BaixaEstornada | null; aviso: string | null } | null> {
  await garantirLixeira(exec);
  const { rows } = await exec.query(
    `DELETE FROM ${tabela} t WHERE t.id = $1 AND t.tenant_id = $2 RETURNING to_jsonb(t.*) AS linha`,
    [id, tenantId],
  );
  const linha = rows[0]?.linha as Record<string, unknown> | undefined;
  if (!linha) return null;
  const data = (linha.data ?? {}) as Record<string, unknown>;

  // O dinheiro volta como sempre voltou (com o lançamento no razão).
  await estornarBaixaDaConta(tenantId, tabela, { ...data, id }, exec);
  const valor = valorNoCaixa(data, tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago');
  const estornado: BaixaEstornada | null = valor > 0 ? {
    valor: round2(valor),
    conta_bancaria_id: (data.conta_bancaria_id as string | null) || null,
    data: String(data[tabela === 'contas_receber' ? 'data_recebimento' : 'data_pagamento'] ?? '').slice(0, 10),
    status: String(data.status ?? ''),
  } : null;

  // Histórico de baixas: cada baixa que ainda valia ganha o estorno.
  if (await existeHistoricoDeBaixas(exec)) {
    await exec.query(
      `INSERT INTO baixas (id, tenant_id, tipo, titulo_tabela, titulo_id, data_baixa, conta_bancaria_id, forma, valor_centavos,
                           juros_centavos, multa_centavos, desconto_centavos, taxa_centavos, credito_centavos, caixa_centavos,
                           origem, usuario_id, usuario_nome, estorna_baixa_id, motivo)
       SELECT 'exc_' || b.id, b.tenant_id, 'estorno', b.titulo_tabela, b.titulo_id, $4::date, b.conta_bancaria_id, b.forma, b.valor_centavos,
              b.juros_centavos, b.multa_centavos, b.desconto_centavos, b.taxa_centavos, b.credito_centavos, -b.caixa_centavos,
              'exclusao', $5, $6, b.id, 'Conta excluída'
         FROM baixas b
        WHERE b.tenant_id = $1 AND b.titulo_tabela = $2 AND b.titulo_id = $3
          AND b.tipo IN ('baixa', 'anterior', 'legada')
          AND NOT EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = b.tenant_id AND e.estorna_baixa_id = b.id)
       ON CONFLICT DO NOTHING`,
      [tenantId, tabela, id, hojeISO(), quem.id ?? null, quem.nome ?? null],
    );
  }

  const guardada = semABaixa(tabela, data);
  const linhaGuardada = { ...linha, data: guardada, status: String(guardada.status ?? linha.status ?? '') };
  await exec.query(
    `INSERT INTO contas_excluidas (tenant_id, tabela, id, linha, data, baixa_estornada, excluido_em, excluido_por, excluido_por_nome)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NOW(), $7, $8)
     ON CONFLICT (tenant_id, tabela, id) DO UPDATE
       SET linha = EXCLUDED.linha, data = EXCLUDED.data, baixa_estornada = EXCLUDED.baixa_estornada,
           excluido_em = EXCLUDED.excluido_em, excluido_por = EXCLUDED.excluido_por, excluido_por_nome = EXCLUDED.excluido_por_nome`,
    [tenantId, tabela, id, JSON.stringify(linhaGuardada), JSON.stringify(guardada),
      estornado ? JSON.stringify(estornado) : null, quem.id ?? null, quem.nome ?? null],
  );
  return { estornado, aviso: avisoDaExclusao(tabela, estornado) };
}

/** A conta excluída, sem restaurar (para permissões e para a tela). */
export async function lerExcluida(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, id: string,
): Promise<{ data: Record<string, unknown>; estornado: BaixaEstornada | null } | null> {
  await garantirLixeira(exec);
  const { rows } = await exec.query(
    `SELECT data, baixa_estornada FROM contas_excluidas WHERE tenant_id = $1 AND tabela = $2 AND id = $3`,
    [tenantId, tabela, id],
  );
  if (!rows[0]) return null;
  return { data: (rows[0].data ?? {}) as Record<string, unknown>, estornado: (rows[0].baixa_estornada as BaixaEstornada | null) ?? null };
}

/**
 * Restaura dentro da transação do chamador: a linha volta igual, em aberto.
 * 404 quando não está entre as excluídas; 409 quando o lugar já foi ocupado
 * (mesmo id de novo, ou a venda já gerou outra conta para a mesma parcela).
 */
export async function restaurarTitulo(
  exec: ExecutorSQL, tenantId: string, tabela: TabelaDoTitulo, id: string,
): Promise<{ data: Record<string, unknown>; aviso: string | null }> {
  const { rows } = await exec.query(
    `DELETE FROM contas_excluidas WHERE tenant_id = $1 AND tabela = $2 AND id = $3 RETURNING linha, baixa_estornada`,
    [tenantId, tabela, id],
  );
  if (!rows[0]) throw new ErroDaLixeira('Esta conta não está entre as excluídas (talvez já tenha sido restaurada). Recarregue a lista.', 404);
  const linha = rows[0].linha as Record<string, unknown>;
  const estornado = (rows[0].baixa_estornada as BaixaEstornada | null) ?? null;
  const { rows: ocupado } = await exec.query(`SELECT 1 FROM ${tabela} WHERE id = $1`, [id]);
  if (ocupado.length > 0) throw new ErroDaLixeira('Já existe uma conta com este mesmo registro. Nada foi restaurado.', 409);
  try {
    await exec.query('SAVEPOINT restaurar_titulo');
    await exec.query(
      `INSERT INTO ${tabela} SELECT (jsonb_populate_record(NULL::${tabela}, $1::jsonb)).*`,
      [JSON.stringify({ ...linha, id, tenant_id: tenantId })],
    );
    await exec.query(`UPDATE ${tabela} SET updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    await exec.query('RELEASE SAVEPOINT restaurar_titulo');
  } catch (e) {
    try { await exec.query('ROLLBACK TO SAVEPOINT restaurar_titulo'); } catch { /* conexão perdida */ }
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate key|unique/i.test(msg)) {
      throw new ErroDaLixeira('A venda já gerou outra conta para esta mesma parcela. Nada foi restaurado: use a conta que está na lista.', 409);
    }
    throw e;
  }
  return { data: (linha.data ?? {}) as Record<string, unknown>, aviso: avisoDaRestauracao(tabela, estornado) };
}
