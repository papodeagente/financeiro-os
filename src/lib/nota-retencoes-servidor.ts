/**
 * Retenções na fonte (Lei 9.430) no banco (E5, parte E): o cadastro por
 * cliente × produto e a conta a receber líquida da venda.
 *
 * Fica separado do servidor das notas para a venda (venda-servidor.ts) poder
 * usar sem ciclo de importação.
 */
import { generateId } from './utils';
import type { ExecutorSQL } from './caixa-atomico';
import type { Venda } from './venda-modelo';
import type { ContasDaVenda } from './venda-contas';
import {
  aplicarRetencoesNasContas, dispensarRetencaoPequena, normalizarRetencao, normalizarRetencaoMinima, retencoesDaVenda,
  type RetencaoDoCliente, type RetencaoMinima,
} from './nota-retencoes';

export class ErroRetencao extends Error {
  constructor(public codigo: string, mensagem: string, public status = 400, public detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroRetencao';
  }
}

let tabelaPronta = false;
async function tabelaExiste(exec: ExecutorSQL): Promise<boolean> {
  if (tabelaPronta) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.retencoes_cliente') IS NOT NULL AS ok`);
  tabelaPronta = rows[0]?.ok === true;
  return tabelaPronta;
}

function deLinha(r: Record<string, unknown>): RetencaoDoCliente {
  const { retencao } = normalizarRetencao({ ...(r.data as Record<string, unknown>), id: r.id });
  return retencao;
}

export async function listarRetencoes(exec: ExecutorSQL, tenantId: string, clienteId?: string): Promise<RetencaoDoCliente[]> {
  if (!(await tabelaExiste(exec))) return [];
  const { rows } = await exec.query(
    `SELECT id, data FROM retencoes_cliente WHERE tenant_id = $1 AND ($2::text IS NULL OR cliente_id = $2)
      ORDER BY data->'cliente'->>'nome', tipo_produto`,
    [tenantId, clienteId ?? null],
  );
  return rows.map(deLinha);
}

export async function salvarRetencao(exec: ExecutorSQL, tenantId: string, entrada: unknown): Promise<RetencaoDoCliente> {
  const { retencao, erros } = normalizarRetencao(entrada);
  if (erros.length) throw new ErroRetencao('DADOS', erros[0].mensagem, 400, erros);
  const tipo = retencao.tipo_produto ?? '';
  const { rows: outra } = await exec.query(
    `SELECT id FROM retencoes_cliente WHERE tenant_id = $1 AND cliente_id = $2 AND tipo_produto = $3 AND id <> $4`,
    [tenantId, retencao.cliente.id, tipo, retencao.id],
  );
  if (outra.length) {
    throw new ErroRetencao('REPETIDA', 'Este cliente já tem retenção para este produto. Abra a que existe e ajuste os percentuais.', 409, { id: outra[0].id });
  }
  const id = retencao.id || generateId();
  const dados = { ...retencao, id };
  await exec.query(
    `INSERT INTO retencoes_cliente (id, tenant_id, cliente_id, tipo_produto, data) VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET cliente_id = EXCLUDED.cliente_id, tipo_produto = EXCLUDED.tipo_produto, data = EXCLUDED.data, updated_at = NOW()
     WHERE retencoes_cliente.tenant_id = EXCLUDED.tenant_id`,
    [id, tenantId, retencao.cliente.id, tipo, JSON.stringify(dados)],
  );
  const { rows } = await exec.query(`SELECT id, data FROM retencoes_cliente WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows.length) throw new ErroRetencao('NAO_ENCONTRADA', 'Retenção não encontrada.', 404);
  return deLinha(rows[0]);
}

export async function apagarRetencao(exec: ExecutorSQL, tenantId: string, id: string): Promise<boolean> {
  const r = await exec.query(`DELETE FROM retencoes_cliente WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (r.rowCount ?? 0) > 0;
}

/** O limite de dispensa de retenção da agência (agencia.notas_config.retencao_minima). */
export async function retencaoMinimaDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<RetencaoMinima> {
  const { rows } = await exec.query(
    `SELECT data->'notas_config'->'retencao_minima' AS m FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  return normalizarRetencaoMinima(rows[0]?.m);
}

/**
 * As contas da venda com a retenção do cliente descontada (conta a receber
 * líquida). Sem retenção cadastrada para o cliente, devolve as mesmas contas,
 * no mesmo objeto: a venda de quem não usa retenção não muda em nada.
 */
export async function aplicarRetencoesDaAgencia(exec: ExecutorSQL, tenantId: string, venda: Venda, contas: ContasDaVenda): Promise<ContasDaVenda> {
  if (!venda.cliente.id || !(await tabelaExiste(exec))) return contas;
  const regras = await listarRetencoes(exec, tenantId, venda.cliente.id).catch(() => [] as RetencaoDoCliente[]);
  if (!regras.length) return contas;
  const bruta = retencoesDaVenda(venda, regras);
  // Dispensa de retenção pequena (E7), quando a agência digitou o limite.
  const minimo = await retencaoMinimaDaAgencia(exec, tenantId);
  const dispensa = dispensarRetencaoPequena(bruta.por_tributo, minimo);
  const r = { ...bruta, por_tributo: dispensa.por_tributo, total: dispensa.total };
  if (!(r.total > 0)) return contas;
  const { contas: receber, aviso } = aplicarRetencoesNasContas(contas.contas_receber as unknown as Array<Record<string, unknown>>, r);
  return {
    ...contas,
    contas_receber: receber as unknown as ContasDaVenda['contas_receber'],
    avisos: aviso ? [...contas.avisos, { codigo: 'RETENCAO_MAIOR_QUE_O_A_RECEBER', valor_centavos: r.total, mensagem: aviso }] : contas.avisos,
  };
}
