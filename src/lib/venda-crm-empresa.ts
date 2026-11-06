/**
 * A empresa da venda que chega do CRM (E7 frente E, 06/11/2026).
 *
 * A G2 trouxe várias empresas por agência (`empresas`, id 'principal' para a
 * de sempre). A venda do CRM nascia sempre na principal. Agora o CRM pode
 * dizer em qual empresa ela entra, no envelope da VENDA_FECHADA (v1 e v2):
 *  - `empresa_cnpj`: o CNPJ da empresa (o CRM não guarda CNPJ de unidade; a
 *    agência configura lá, por equipe ou para a conta inteira);
 *  - `empresa_id`: o id da empresa AQUI, para quem o conhece.
 * O id vence o CNPJ. Empresa inativa não vale.
 *
 * Sem nenhum dos dois (o caso de hoje e de quem tem uma empresa só): nada
 * muda, o gatilho do esquema põe a venda nova na principal e a que já existe
 * fica onde está (inclusive se alguém a mudou de empresa à mão).
 * Pediu e não casou: a venda nova vai para a principal e a agência recebe um
 * aviso no sino; a que já existe fica onde está.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { EMPRESA_PRINCIPAL_ID, formatarCnpj, soDigitos } from './empresas';

export interface EmpresaPedidaPeloCrm { id: string; cnpj: string }

/** O que o CRM pediu (só dígitos no CNPJ). Null = não pediu nada. PURO. */
export function empresaPedidaPeloCrm(payload: Record<string, unknown>): EmpresaPedidaPeloCrm | null {
  const id = String(payload.empresa_id ?? '').trim().slice(0, 80);
  const cnpj = soDigitos(payload.empresa_cnpj);
  if (!id && !cnpj) return null;
  return { id, cnpj };
}

export interface EmpresaDaVendaDoCrm {
  /** A empresa a gravar na venda; null = não mexer (o gatilho decide ou a venda mantém a dela). */
  empresa_id: string | null;
  /** Como achou: pelo id, pelo CNPJ, ou não achou (principal ou mantida). */
  como: 'id' | 'cnpj' | 'nao_encontrada' | 'nao_pedida';
  /** Frase para o histórico do evento e o sino, quando o pedido não casou. */
  aviso: string | null;
}

export async function empresaDaVendaDoCrm(
  exec: ExecutorSQL, tenantId: string, payload: Record<string, unknown>, opcoes: { vendaNova: boolean },
): Promise<EmpresaDaVendaDoCrm> {
  const pedido = empresaPedidaPeloCrm(payload);
  if (!pedido) return { empresa_id: null, como: 'nao_pedida', aviso: null };
  const { rows: tem } = await exec.query(`SELECT to_regclass('public.empresas') IS NOT NULL AS ok`);
  if (tem[0]?.ok !== true) return { empresa_id: null, como: 'nao_pedida', aviso: null };

  if (pedido.id) {
    const { rows } = await exec.query(`SELECT id FROM empresas WHERE tenant_id = $1 AND id = $2 AND ativa`, [tenantId, pedido.id]);
    if (rows[0]) return { empresa_id: String(rows[0].id), como: 'id', aviso: null };
  }
  if (pedido.cnpj) {
    const { rows } = await exec.query(
      `SELECT id FROM empresas WHERE tenant_id = $1 AND ativa AND regexp_replace(cnpj, '\\D', '', 'g') = $2 ORDER BY principal DESC, ordem, id LIMIT 1`,
      [tenantId, pedido.cnpj],
    );
    if (rows[0]) return { empresa_id: String(rows[0].id), como: 'cnpj', aviso: null };
  }
  const pedida = pedido.cnpj ? `o CNPJ ${formatarCnpj(pedido.cnpj)}` : `a empresa "${pedido.id}"`;
  const destino = opcoes.vendaNova ? 'a venda entrou na empresa principal' : 'a venda continua na empresa em que estava';
  return {
    empresa_id: opcoes.vendaNova ? EMPRESA_PRINCIPAL_ID : null,
    como: 'nao_encontrada',
    aviso: `O CRM mandou ${pedida}, que não é de nenhuma empresa ativa cadastrada aqui: ${destino}.`,
  };
}
