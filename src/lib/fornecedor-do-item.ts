/**
 * Fornecedor informado aqui volta para a Cotação do CRM (13/11/2026).
 *
 * Bruno: "Se não tiver fornecedor alinhado dentro da cotação no CRM, isso
 * deve ser cobrado no financeiro para adicionar. Ao adicionar no financeiro,
 * deve sincronizar no CRM e vice versa."
 *
 * A conta a pagar de um item da Cotação sem fornecedor nasce pendente e
 * carrega `crm_item_ids` (os itens dela no CRM). Quando alguém informa o
 * fornecedor, o evento FORNECEDOR_DO_ITEM leva ao CRM qual fornecedor é, com
 * o vínculo do cadastro (crm_supplier_id) e o CNPJ; o CRM grava no custo do
 * item, achando ou cadastrando o fornecedor lá.
 *
 * `deveAvisarOCrm` é pura (testada); `avisarFornecedorDoItem` nunca lança: a
 * edição da conta não pode falhar por causa da volta ao CRM.
 */
import pool from './db';
import { emitirEventoCRM } from './crm-integration';
import { deveAvisarOCrm } from './fornecedor-do-item-regra';

export { deveAvisarOCrm };

type Dados = Record<string, unknown>;

export async function avisarFornecedorDoItem(tenantId: string, antes: Dados, depois: Dados): Promise<void> {
  try {
    const ids = deveAvisarOCrm(antes, depois);
    if (!ids || !pool) return;
    const vendaId = String(depois.origem_venda_id ?? antes.origem_venda_id ?? '');
    if (!vendaId) return;
    const { rows: vendas } = await pool.query(
      `SELECT data->>'crm_venda_id' AS crm FROM vendas_crm WHERE id = $1 AND tenant_id = $2`,
      [vendaId, tenantId],
    );
    const crmVendaId = String(vendas[0]?.crm ?? '');
    if (!crmVendaId) return;
    const { rows: forn } = await pool.query(
      `SELECT id, nome_fantasia, cnpj, crm_supplier_id, data FROM fornecedores_crm WHERE id = $1 AND tenant_id = $2`,
      [String(depois.fornecedor_id), tenantId],
    );
    const f = forn[0];
    if (!f) return;
    const d = (f.data ?? {}) as Dados;
    await emitirEventoCRM('FORNECEDOR_DO_ITEM', {
      crm_venda_id: crmVendaId,
      crm_item_ids: ids,
      fornecedor: {
        financeiro_id: String(f.id),
        crm_supplier_id: f.crm_supplier_id == null ? null : String(f.crm_supplier_id),
        nome: String(f.nome_fantasia || d.nome_fantasia || d.razao_social || ''),
        cnpj: String(f.cnpj || d.cnpj || '').replace(/\D/g, '') || null,
        email: String(d.email ?? '') || null,
        telefone: String(d.telefone ?? '') || null,
      },
    }, { tenantId, idempotency_key: `fornecedor-do-item:${vendaId}:${ids.join(',')}:${f.id}` });
  } catch (e) {
    console.error('[fornecedor-do-item] não avisou o CRM:', e instanceof Error ? e.message : e);
  }
}
