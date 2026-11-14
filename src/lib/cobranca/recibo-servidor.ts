/**
 * Recibo no servidor (05/11/2026): junta a agência, a conta a receber, o
 * documento do cliente e o histórico de baixas, e devolve o recibo pronto
 * (regras em ./recibo.ts). Usado pela tela interna (/api/recibos/[conta]) e
 * pelo portal do cliente (com o documento mascarado).
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { historicoDaConta } from '../baixas-servidor';
import { num } from '../money';
import { montarRecibo, type AgenciaDoRecibo, type ResultadoDoRecibo } from './recibo';

export async function agenciaDoTenant(exec: ExecutorSQL, tenantId: string): Promise<AgenciaDoRecibo | null> {
  const { rows } = await exec.query(
    'SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1',
    [tenantId],
  );
  return rows.length ? (rows[0].data as AgenciaDoRecibo) : null;
}

export interface ContaLida {
  id: string;
  cliente_id: string;
  data: Record<string, unknown>;
  status: string;
}

/** A conta a receber da agência (null quando não existe ou é de outra). */
export async function contaReceberDoTenant(exec: ExecutorSQL, tenantId: string, contaId: string): Promise<ContaLida | null> {
  const { rows } = await exec.query(
    `SELECT id, COALESCE(NULLIF(cliente_id, ''), data->>'cliente_id', '') AS cliente_id, data,
            COALESCE(NULLIF(data->>'status', ''), status, '') AS st
       FROM contas_receber WHERE tenant_id = $1 AND id = $2`,
    [tenantId, contaId],
  );
  if (!rows.length) return null;
  return { id: String(rows[0].id), cliente_id: String(rows[0].cliente_id ?? ''), data: (rows[0].data ?? {}) as Record<string, unknown>, status: String(rows[0].st) };
}

export async function documentoDoCliente(exec: ExecutorSQL, tenantId: string, clienteId: string): Promise<string> {
  if (!clienteId) return '';
  const { rows } = await exec.query(
    `SELECT COALESCE(NULLIF(cpf_cnpj, ''), data->>'cpf_cnpj', data->>'cpf', data->>'cnpj', '') AS doc
       FROM clientes WHERE tenant_id = $1 AND id = $2`,
    [tenantId, clienteId],
  );
  return rows.length ? String(rows[0].doc ?? '') : '';
}

/**
 * Recibo da conta (ou de uma baixa dela). `documento` decide como o CPF/CNPJ
 * do pagador aparece: 'inteiro' na tela da agência, 'mascarado' no portal.
 */
export async function lerRecibo(
  exec: ExecutorSQL, tenantId: string, conta: ContaLida, opcoes: { baixaId?: string | null; hoje: string; documento: (doc: string) => string },
): Promise<ResultadoDoRecibo> {
  const [agencia, doc, baixas] = await Promise.all([
    agenciaDoTenant(exec, tenantId),
    documentoDoCliente(exec, tenantId, conta.cliente_id),
    historicoDaConta(exec, tenantId, 'contas_receber', conta.id),
  ]);
  const d = conta.data;
  return montarRecibo({
    agencia,
    conta: {
      id: conta.id,
      status: conta.status,
      cliente_nome: String(d.cliente_nome ?? ''),
      descricao: String(d.descricao ?? ''),
      valor_final: num(d.valor_final),
      valor_recebido: d.valor_recebido == null ? null : num(d.valor_recebido),
      data_recebimento: (d.data_recebimento as string | null) ?? null,
      forma_recebimento: String(d.forma_recebimento ?? ''),
      parcela_numero: Number(d.parcela_numero) || 0,
      total_parcelas: Number(d.total_parcelas) || 0,
    },
    documentoDoPagador: opcoes.documento(doc),
    baixas,
    baixaId: opcoes.baixaId ?? null,
    hoje: opcoes.hoje,
  });
}
