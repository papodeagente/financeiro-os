/**
 * Entrada da VENDA_FECHADA v2 (E5, parte A): resolve as pessoas da venda
 * completa (fornecedor, representante, intermediário, pagante) pelos mesmos
 * caminhos de identidade da v1 e grava pelo MESMO `salvarVenda` da venda
 * lançada à mão. Chamado por `processarEventoCRM` (crm-integration.ts).
 */
import pool from './db';
import { emTransacao, type ExecutorSQL } from './caixa-atomico';
import { receberFornecedorDoCrm, lerFornecedorDaVenda } from './fornecedor-sync';
import { resolverClienteCRM, lerDadosCliente } from './crm-cliente';
import { lerVendaV2 } from './venda-crm-v2';
import { quemCobraNaVendaDoCrm } from './venda-crm-itens';
import { salvarVenda, versaoDoModelo, type ResultadoDaGravacao } from './venda-servidor';
import type { ParteDaVenda } from './venda-modelo';

export interface EntradaVendaV2DoCrm {
  tenantId: string;
  payload: Record<string, unknown>;
  vendaId: string;
  numero: string;
  dataVenda: string;
  cliente: ParteDaVenda;
  vendedor: ParteDaVenda | null;
  grupoId: string | null;
  /** O cabeçalho que o caminho do CRM já montou (carimbo da plataforma, ids externos...). */
  cabecalho: Record<string, unknown>;
  /** O cliente pagou a agência por uma plataforma ligada a esta venda (regra de 13/11/2026). */
  pagoAAgencia?: boolean;
}

export interface ResultadoVendaV2DoCrm extends ResultadoDaGravacao {
  /** Fornecedores cujo vínculo o CRM precisa receber de volta. */
  ecos: string[];
}

export async function receberVendaV2DoCrm(e: EntradaVendaV2DoCrm): Promise<ResultadoVendaV2DoCrm> {
  const lida = lerVendaV2(e.payload, {
    id: e.vendaId, numero: e.numero, data_venda: e.dataVenda,
    cliente: e.cliente, vendedor: e.vendedor, grupo_id: e.grupoId,
  });
  if (lida.erros.length) throw new Error(`VENDA_FECHADA v2 inválida: ${lida.erros.map(x => x.mensagem).join(' ')}`);
  const venda = lida.venda;
  const ecos: string[] = [];

  // Fornecedor, representante e intermediário: o cadastro do financeiro, pelo
  // mesmo caminho da v1 (vínculo, id daqui, chave da venda, CNPJ, nome).
  for (const pessoa of lida.pessoas) {
    const achado = await emTransacao(exec => receberFornecedorDoCrm(exec, e.tenantId, lerFornecedorDaVenda(pessoa.bruto), 'preencher'));
    if (!achado) continue;
    if (achado.ecoar) ecos.push(achado.id);
    const parte = (p: ParteDaVenda | null): ParteDaVenda => ({ ...(p ?? { nome: '' }), id: achado.id, nome: p?.nome || achado.nome });
    const onde = pessoa.onde;
    if (onde.tipo === 'fornecedor') venda.produtos[onde.produto].fornecedor = parte(venda.produtos[onde.produto].fornecedor);
    else if (onde.tipo === 'representante') venda.produtos[onde.produto].representante = parte(venda.produtos[onde.produto].representante);
    else if (onde.tipo === 'intermediario') venda.intermediario = parte(venda.intermediario);
    else if (onde.tipo === 'fornecedor_do_pagamento' && venda.pagamentos[onde.pagamento]) venda.pagamentos[onde.pagamento].fornecedor = parte(venda.pagamentos[onde.pagamento].fornecedor);
  }

  // Quem cobra cada produto pela regra de 13/11/2026, a mesma da v1
  // (venda-crm-itens.ts): a agência recebe do cliente e paga o fornecedor;
  // pago direto só com "recebe direto do cliente" no cadastro do fornecedor
  // ou o item cotado como cobrado pelo fornecedor; plataforma da agência
  // desfaz a exceção.
  const idsDosFornecedores = [...new Set(venda.produtos.map(p => p.fornecedor?.id).filter((x): x is string => !!x))];
  const recebeDiretoDoCliente = new Set<string>();
  if (idsDosFornecedores.length > 0 && pool) {
    const { rows } = await pool.query(
      `SELECT id FROM fornecedores_crm WHERE tenant_id = $1 AND id = ANY($2::text[]) AND (data->>'recebe_direto_do_cliente') = 'true'`,
      [e.tenantId, idsDosFornecedores],
    );
    for (const r of rows) recebeDiretoDoCliente.add(String(r.id));
  }
  const quemCobra = quemCobraNaVendaDoCrm(venda.produtos, lida.cobrado_pelo_fornecedor, {
    pagoAAgencia: e.pagoAAgencia === true, recebeDiretoDoCliente,
  });
  venda.produtos.forEach((p, i) => { p.quem_cobra = quemCobra[i]; });

  // Pagante diferente do cliente: um contato do CRM, pelo caminho único de identidade.
  for (const g of lida.pagantes) {
    if (!venda.pagamentos[g.pagamento]) continue;
    const c = await resolverClienteCRM(pool as unknown as ExecutorSQL, e.tenantId, {
      externalId: g.cliente_id, anteriores: [], alteracoes: null, ficha: null,
      dados: lerDadosCliente({ nome: g.nome, cpf_cnpj: g.cpf_cnpj, email: g.email }),
    });
    venda.pagamentos[g.pagamento].pagante = { id: c.id, nome: g.nome || e.cliente.nome, id_externo: g.cliente_id };
  }

  const resultado = await emTransacao(exec => salvarVenda(exec, e.tenantId, venda, {
    usuario: { id: 'crm', nome: 'CRM' },
    origem: 'crm',
    cabecalho: { ...e.cabecalho, versao_venda: 2, ...(lida.comissao_vendedor ? { comissao_vendedor_crm: lida.comissao_vendedor } : {}) },
    evento: 'recebida_do_crm',
    detalheDoEvento: { crm_venda_id: venda.crm_venda_id },
  }));
  // Itens da Cotação (13/11/2026): a conta a pagar sem fornecedor leva os
  // itens do CRM dos produtos dela; informar o fornecedor aqui devolve-o ao
  // CRM (FORNECEDOR_DO_ITEM, rota-do-titulo.ts).
  const itensPorProduto = new Map<string, number[]>();
  venda.produtos.forEach((p, i) => { if (lida.crm_item_ids[i]?.length) itensPorProduto.set(p.id, lida.crm_item_ids[i]); });
  if (itensPorProduto.size > 0 && pool) {
    const { rows } = await pool.query(
      `SELECT id, data FROM contas_pagar WHERE tenant_id = $1 AND COALESCE(data->>'origem_venda_id', data->>'venda_id') = $2
          AND (data->>'fornecedor_pendente') = 'true'`,
      [e.tenantId, e.vendaId],
    );
    for (const r of rows) {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const produtos = Array.isArray(d.venda_produtos) ? (d.venda_produtos as unknown[]).map(String) : [];
      const ids = [...new Set(produtos.flatMap(id => itensPorProduto.get(id) ?? []))];
      if (ids.length === 0) continue;
      await pool.query(
        `UPDATE contas_pagar SET data = jsonb_set(data, '{crm_item_ids}', $3::jsonb) WHERE id = $1 AND tenant_id = $2`,
        [r.id, e.tenantId, JSON.stringify(ids)],
      );
    }
  }
  return { ...resultado, ecos };
}

/**
 * O CRM voltou a mandar a v1 de uma venda que estava no modelo completo: a
 * venda volta a ser controlada pela v1 (o modelo dela sai; as contas seguem
 * a regra da v1, que preserva o que já foi baixado).
 */
export async function voltarVendaParaV1(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<boolean> {
  if ((await versaoDoModelo(exec, tenantId, vendaId)) !== 2) return false;
  for (const t of ['venda_componentes', 'venda_passageiros', 'venda_produtos', 'venda_pagamentos']) {
    await exec.query(`DELETE FROM ${t} WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId]);
  }
  await exec.query(`UPDATE vendas_modelo SET versao_modelo = 1, atualizado_em = NOW() WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId]);
  return true;
}
