/**
 * CONTAS AVULSAS LIGADAS À VENDA (E7, 06/11/2026).
 *
 * Da ficha da venda, sem sair dela:
 *  - "Pagamento avulso ao fornecedor": adiantar ao fornecedor (ou
 *    representante) parte do que a venda deve a ele, antes da fatura. Vira
 *    uma conta a pagar própria; a conta da venda daquele fornecedor diminui
 *    na mesma medida (a regeração a conta como já feita), e o total a pagar
 *    a ele continua batendo com a venda.
 *  - "Conta a pagar" e "Conta a receber" avulsas: o que nasce por causa da
 *    venda mas não é dela (um motoboy que levou os documentos, uma taxa extra
 *    combinada com o cliente). Ficam ligadas à venda (`origem_venda_id`) e
 *    aparecem nas abas Fornecedor e Cliente, mas a venda nunca as mexe.
 *
 * Nenhuma é `auto_gerado`: a regeração da venda não apaga nem altera. Quem
 * chama abre a transação.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { deCentavos, hojeISO } from './money';
import { normalizarAvulsa, partesDoAcerto } from './venda-avulsas-modelo';
import { ErroVenda, carregarVenda, previaDasContas, regerarContasDaVenda, registrarEventoDaVenda, type UsuarioDaAcao } from './venda-servidor';
import type { AvisoDaVenda } from './venda-contas';

export { ROTULO_AVULSA, normalizarAvulsa, partesDoAcerto, type PedidoDeAvulsa, type TipoDeAvulsa } from './venda-avulsas-modelo';

export interface ResultadoDaAvulsa {
  conta_id: string;
  tabela: 'contas_pagar' | 'contas_receber';
  avisos: AvisoDaVenda[];
}

/**
 * Lança a conta avulsa ligada à venda. No pagamento ao fornecedor, a conta
 * da venda daquela pessoa diminui na mesma hora (regeração de sempre).
 */
export async function lancarAvulsaDaVenda(
  exec: ExecutorSQL, tenantId: string, vendaId: string, entrada: unknown, usuario: UsuarioDaAcao, hoje = hojeISO(),
): Promise<ResultadoDaAvulsa> {
  const { pedido, erros } = normalizarAvulsa(entrada, hoje);
  if (erros.length) throw new ErroVenda('DADOS', erros[0].mensagem, 400, { erros });
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [tenantId, `venda:${vendaId}`]);
  const carregada = await carregarVenda(exec, tenantId, vendaId);
  if (!carregada) throw new ErroVenda('NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  const venda = carregada.venda;
  const numero = venda.numero || vendaId;
  const reais = deCentavos(pedido.valor_centavos);
  const id = generateId();
  const comum = {
    id, venda_id: vendaId, grupo_id: venda.grupo_id, categoria_id: pedido.categoria_id, centro_custo: venda.centro_custo || '',
    valor_original: reais, valor_final: reais, juros: 0, multa: 0, desconto: 0, data_emissao: hoje, data_vencimento: pedido.vencimento,
    status: 'PENDENTE', parcela_numero: 1, total_parcelas: 1, rateio: [], anexos: [], observacoes: pedido.observacoes,
    conta_bancaria_id: null, origem_venda_id: vendaId, auto_gerado: false, avulsa_da_venda: pedido.tipo === 'pagamento_fornecedor' ? 'pagamento_fornecedor' : 'avulsa',
    lancada_por: usuario.nome || usuario.id,
  };
  let avisos: AvisoDaVenda[] = [];
  if (pedido.tipo === 'receber') {
    const conta = {
      ...comum, origem: 'OUTROS', cliente_id: pedido.pessoa.id, cliente_nome: pedido.pessoa.nome,
      descricao: pedido.descricao || `Venda ${numero} - conta avulsa`,
      data_recebimento: null, valor_recebido: null, forma_recebimento: '', taxa: 0, taxa_plataforma: '',
      boleto_emitido: false, boleto_codigo: '', boleto_url: '',
    };
    await exec.query(
      `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, $4, 'PENDENTE', $5::jsonb, NOW(), NOW())`,
      [id, tenantId, vendaId, pedido.pessoa.id, JSON.stringify(conta)],
    );
  } else {
    if (pedido.tipo === 'pagamento_fornecedor') {
      if (carregada.versao_modelo !== 2) throw new ErroVenda('MODELO_ANTERIOR', 'Esta venda está no formato anterior. Salve-a na ficha (produtos e passageiros) para adiantar o fornecedor por aqui.', 409);
      const partes = partesDoAcerto(venda);
      const parte = partes.find(x => x.id === pedido.pessoa.id);
      if (!parte) throw new ErroVenda('DADOS', 'Escolha um dos fornecedores desta venda.', 400);
      pedido.pessoa = parte;
    }
    const conta = {
      ...comum, origem: 'VENDA', fornecedor_id: pedido.pessoa.id, fornecedor_nome: pedido.pessoa.nome,
      descricao: pedido.descricao || (pedido.tipo === 'pagamento_fornecedor'
        ? `Venda ${numero} - pagamento avulso a ${pedido.pessoa.nome}`
        : `Venda ${numero} - conta avulsa`),
      moeda: 'BRL', cambio: 1, valor_brl: reais, data_pagamento: null, valor_pago: null, forma_pagamento: '', cartao_id: null, comprovante: '',
      natureza_custo: 'VARIAVEL', is_custo_comercial: false,
      ...(pedido.tipo === 'pagamento_fornecedor'
        ? { venda_chave: `v2:avulso:${id}`, venda_parte_id: pedido.pessoa.id, venda_modelo: 2 }
        : {}),
    };
    await exec.query(
      `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, 'PENDENTE', $4::jsonb, NOW(), NOW())`,
      [id, tenantId, pedido.pessoa.id, JSON.stringify(conta)],
    );
    if (pedido.tipo === 'pagamento_fornecedor') {
      // A conta da venda daquele fornecedor diminui: a regeração de sempre conta o avulso como já feito.
      const r = await regerarContasDaVenda(exec, tenantId, vendaId, await previaDasContas(exec, tenantId, venda));
      avisos = r.avisos;
    }
  }
  await registrarEventoDaVenda(exec, tenantId, vendaId, 'conta_avulsa', {
    usuario,
    detalhe: { tipo: pedido.tipo, conta_id: id, pessoa: pedido.pessoa.nome, valor_centavos: pedido.valor_centavos, vencimento: pedido.vencimento, avisos: avisos.map(a => a.codigo) },
  });
  return { conta_id: id, tabela: pedido.tipo === 'receber' ? 'contas_receber' : 'contas_pagar', avisos };
}
