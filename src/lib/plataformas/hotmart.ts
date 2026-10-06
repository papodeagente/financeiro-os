/**
 * Hotmart.
 *
 * Armadilhas conhecidas, tratadas aqui:
 *
 * - O webhook autentica por `hottok`, um token fixo que a própria Hotmart
 *   mostra no cadastro. Não há assinatura do corpo.
 * - Venda em moeda estrangeira existe. Somar como real infla a receita, e
 *   já aconteceu em produção. A moeda é preservada e a conversão é
 *   decisão de quem consome, nunca implícita aqui.
 * - Reembolso muda o status da PRÓPRIA transação: é o mesmo id, com
 *   status diferente. Por isso o id de idempotência inclui o status, e o
 *   id da transação é guardado à parte para casar o estorno com a venda.
 * - A conta vende muitos produtos além do que interessa. O filtro por
 *   produto é opcional e fica na configuração, não em código.
 * - APPROVED e COMPLETE não são a mesma coisa: aprovado é o comprador
 *   tendo pago; completo é o fim da garantia, quando o dinheiro fica
 *   liberado. Tratar aprovado como caixa antecipa dinheiro que a Hotmart
 *   ainda pode devolver ao comprador.
 * - Boleto/Pix GERADO e renovação que FALHOU não são dinheiro a receber
 *   (06/10/2026): ficam AGUARDANDO e não viram conta. Ver hotmart-regras.ts.
 * - Venda parcelada no cartão do comprador é UM recebimento: a Hotmart
 *   repassa a venda inteira depois da garantia. O parcelamento fica só como
 *   informação (parcelas_do_comprador).
 */
import { round2 } from '../money';
import type {
  AdapterPlataforma, EventoNormalizado, ResultadoVerificacao, StatusParcelaPlataforma,
  TransacaoNormalizada,
} from './tipos';
import { data, digitos, iguaisEmTempoConstante, montarParcelas, numero, texto, em } from './comum';

const MAPA: Record<string, EventoNormalizado['tipo']> = {
  PURCHASE_APPROVED: 'PAGAMENTO_CONFIRMADO',
  // Fim da garantia: é aqui que o dinheiro fica realmente disponível.
  PURCHASE_COMPLETE: 'PAGAMENTO_RECEBIDO',
  PURCHASE_BILLET_PRINTED: 'PAGAMENTO_CRIADO',
  PURCHASE_DELAYED: 'PAGAMENTO_ATRASADO',
  PURCHASE_CANCELED: 'PAGAMENTO_CANCELADO',
  PURCHASE_EXPIRED: 'PAGAMENTO_CANCELADO',
  PURCHASE_REFUNDED: 'REEMBOLSO',
  PURCHASE_CHARGEBACK: 'CHARGEBACK',
  PURCHASE_PROTEST: 'CHARGEBACK',
};

/** O estado em que cada evento deixa as parcelas da venda. */
const STATUS: Record<string, StatusParcelaPlataforma> = {
  // Boleto/Pix gerado e renovação de assinatura que não foi paga: ninguém
  // pagou nada ainda. Não é conta a receber.
  PAGAMENTO_CRIADO: 'AGUARDANDO',
  PAGAMENTO_CONFIRMADO: 'CONFIRMADO',
  PAGAMENTO_RECEBIDO: 'RECEBIDO',
  PAGAMENTO_ATRASADO: 'AGUARDANDO',
  PAGAMENTO_CANCELADO: 'CANCELADO',
  REEMBOLSO: 'ESTORNADO',
  CHARGEBACK: 'CHARGEBACK',
  ANTECIPACAO: 'CONFIRMADO',
  IGNORADO: 'PENDENTE',
};

export const adapterHotmart: AdapterPlataforma = {
  id: 'hotmart',
  nome: 'Hotmart',
  capacidades: {
    assinaturaNoCorpo: false,
    exigeConsultaExtra: false,
    informaTaxa: true,
    informaPrevisaoDeRepasse: false,
    permiteImportacao: false,
  },

  camposCredencial: () => [
    {
      chave: 'segredo_webhook',
      rotulo: 'Hottok',
      tipo: 'segredo',
      obrigatorio: true,
      ajuda: 'Na Hotmart: Ferramentas, Webhook, e copie o campo hottok da integração. É ele que prova que o aviso veio da Hotmart.',
    },
    {
      chave: 'produto_id',
      rotulo: 'Id do produto (opcional)',
      tipo: 'texto',
      obrigatorio: false,
      ajuda: 'Deixe em branco para aceitar todas as vendas da conta. Preencha quando a conta vender outros produtos que não devem virar venda aqui.',
    },
  ],

  async verificar(_corpoCru, cabecalhos, cred): Promise<ResultadoVerificacao> {
    const enviado = cabecalhos['x-hotmart-hottok'] ?? cabecalhos['hottok'] ?? '';
    if (!cred.segredo_webhook) {
      return { valido: false, motivo: 'Hottok não configurado nesta agência.' };
    }
    if (!iguaisEmTempoConstante(enviado, cred.segredo_webhook)) {
      return { valido: false, motivo: 'Hottok não confere.' };
    }
    return { valido: true, motivo: '' };
  },

  async normalizar(corpo, cred): Promise<EventoNormalizado> {
    const evento = texto(corpo, 'event');
    let tipo = MAPA[evento] ?? 'IGNORADO';

    const dados = em(corpo, 'data') ?? corpo;
    const compra = em(dados, 'purchase') ?? {};
    const produto = em(dados, 'product') ?? {};
    const comprador = em(dados, 'buyer') ?? {};
    const assinatura = em(dados, 'subscription') ?? {};

    // Filtro opcional por produto: a conta costuma vender mais coisas do
    // que as que devem virar venda aqui.
    const idProduto = texto(produto, 'id', 'ucode');
    const filtro = String(cred.extras?.produto_id ?? '').trim();
    if (filtro && idProduto !== filtro) tipo = 'IGNORADO';

    const moeda = texto(compra, 'price.currency_value', 'price.currency_code', 'original_offer_price.currency_value') || 'BRL';
    const bruto = round2(numero(compra, 'price.value', 'full_price.value', 'original_offer_price.value'));

    // A taxa aparece em nomes diferentes conforme a versão do payload.
    // Nenhum deles é obrigatório: quando falta, taxa zero é honesto, e a
    // estimativa de 8,2% que já existiu no billing não entra aqui — ela
    // não é fato e não pode virar despesa lançada.
    const taxa = round2(numero(
      compra,
      'commission_fee', 'price.fee', 'fee.value', 'hotmart_fee.total', 'hotmart_fee.value',
    ));

    const parcelasQtd = Math.max(1, numero(compra, 'payment.installments_number', 'payment.installments') || 1);
    const dataVenda = data(compra, 'order_date', 'date', 'approved_date');
    const dataAprovacao = data(compra, 'approved_date') || dataVenda;

    const status = STATUS[tipo] ?? 'AGUARDANDO';
    const pago = tipo === 'PAGAMENTO_CONFIRMADO' || tipo === 'PAGAMENTO_RECEBIDO';
    // Fim da garantia: é quando a Hotmart libera o dinheiro ao produtor.
    const fimDaGarantia = data(compra, 'warranty_expire_date');
    // Data do AVISO: no COMPLETE é o dia em que o dinheiro foi liberado.
    const dataDoAviso = data(corpo, 'creation_date');

    const descricao = texto(produto, 'name') || 'Venda pela Hotmart';

    const transacao: TransacaoNormalizada = {
      id_transacao: texto(compra, 'transaction'),
      id_assinatura: texto(assinatura, 'subscriber_code', 'subscriber.code', 'plan.name'),
      comprador: {
        nome: texto(comprador, 'name'),
        email: texto(comprador, 'email'),
        documento: digitos(texto(comprador, 'document', 'checkout_phone.document')),
        telefone: digitos(texto(comprador, 'checkout_phone.number', 'phone')),
      },
      itens: [{ descricao, quantidade: 1, valor_unitario: bruto, id_externo: idProduto }],
      valor_bruto: bruto,
      valor_taxa: taxa,
      valor_liquido: taxa > 0 ? round2(bruto - taxa) : bruto,
      desconto: round2(numero(compra, 'price.discount', 'offer.coupon_value')),
      juros: 0,
      // Preservada de propósito: conversão implícita já inflou receita em
      // produção. Quem consome decide o câmbio, com o valor à vista.
      moeda,
      forma_pagamento: texto(compra, 'payment.type', 'payment_type'),
      detalhe_pagamento: texto(compra, 'payment.method', 'payment.billet_barcode') ? 'boleto' : '',
      // UMA parcela, qualquer que seja o parcelamento do comprador: a Hotmart
      // repassa a venda inteira ao produtor no fim da garantia. Antes eram N
      // contas mensais com o status da transação, e a "2/6" aparecia como
      // recebida com vencimento no mês seguinte.
      parcelas: montarParcelas({
        total: bruto,
        taxaTotal: taxa,
        quantidade: 1,
        status,
        primeiroVencimento: dataAprovacao || dataVenda,
        primeiraPrevisao: pago ? fimDaGarantia : '',
        dataPagamento: pago ? dataAprovacao : '',
        // Recebido é quando a Hotmart liberou: o dia do aviso de conclusão
        // (ou o fim da garantia). Usar a data da aprovação antecipava em
        // 7 a 30 dias um dinheiro que ainda estava na garantia.
        dataRecebimento: tipo === 'PAGAMENTO_RECEBIDO' ? (dataDoAviso || fimDaGarantia || dataAprovacao) : '',
        idBase: texto(compra, 'transaction'),
      }),
      parcelas_do_comprador: parcelasQtd,
      data_venda: dataVenda,
      descricao,
      bruto: corpo,
    };

    return {
      tipo,
      // Reembolso reusa o id da transação com outro status: sem o status na
      // chave, o estorno seria confundido com reenvio da venda e ignorado.
      id_externo: `${texto(compra, 'transaction')}:${evento}`,
      transacao,
      parcela_afetada: 0,
    };
  },

  async testarCredencial(cred) {
    // A Hotmart não expõe consulta simples com o hottok: ele só serve para
    // validar o webhook. Dizer isso é melhor do que simular um teste que
    // não prova nada.
    if (!cred.segredo_webhook) throw new Error('Informe o hottok.');
    return { ok: true, conta: 'hottok gravado. A prova real vem na primeira venda de teste.' };
  },
};
