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
 */
import { round2 } from '../money';
import type {
  AdapterPlataforma, EventoNormalizado, ResultadoVerificacao,
} from './tipos';
import { data, digitos, iguaisEmTempoConstante, numero, texto, em } from './comum';

const MAPA: Record<string, EventoNormalizado['tipo']> = {
  PURCHASE_APPROVED: 'PAGAMENTO_CONFIRMADO',
  PURCHASE_COMPLETE: 'PAGAMENTO_CONFIRMADO',
  PURCHASE_REFUNDED: 'REEMBOLSO',
  PURCHASE_CHARGEBACK: 'CHARGEBACK',
  PURCHASE_PROTEST: 'CHARGEBACK',
};

export const adapterHotmart: AdapterPlataforma = {
  id: 'hotmart',
  nome: 'Hotmart',
  capacidades: {
    assinaturaNoCorpo: false,
    exigeConsultaExtra: false,
    informaTaxa: true,
    informaPrevisaoDeRepasse: false,
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

    // Filtro opcional por produto: a conta costuma vender mais coisas do
    // que as que devem virar venda aqui.
    const filtro = String(cred.extras?.produto_id ?? '').trim();
    if (filtro && texto(produto, 'id', 'ucode') !== filtro) tipo = 'IGNORADO';

    const moeda = texto(compra, 'price.currency_value', 'price.currency_code', 'original_offer_price.currency_value') || 'BRL';
    const bruto = round2(numero(compra, 'price.value', 'full_price.value', 'original_offer_price.value'));
    const comissaoPlataforma = round2(numero(compra, 'commission_fee', 'price.fee'));

    const descricao = texto(produto, 'name') || 'Venda pela Hotmart';

    return {
      tipo,
      // Reembolso reusa o id da transação com outro status: sem o status na
      // chave, o estorno seria confundido com reenvio da venda e ignorado.
      id_externo: `${texto(compra, 'transaction')}:${evento}`,
      id_transacao: texto(compra, 'transaction'),
      comprador: {
        nome: texto(comprador, 'name'),
        email: texto(comprador, 'email'),
        documento: digitos(texto(comprador, 'document', 'checkout_phone.document')),
        telefone: digitos(texto(comprador, 'checkout_phone.number', 'phone')),
      },
      itens: [{ descricao, quantidade: 1, valor_unitario: bruto }],
      valor_bruto: bruto,
      valor_taxa: comissaoPlataforma,
      valor_liquido: comissaoPlataforma > 0 ? round2(bruto - comissaoPlataforma) : bruto,
      // Preservada de propósito: conversão implícita já inflou receita em
      // produção. Quem consome decide o câmbio, com o valor à vista.
      moeda,
      data_pagamento: data(compra, 'approved_date', 'order_date', 'date'),
      data_prevista_recebimento: '',
      forma_pagamento: texto(compra, 'payment.type', 'payment_type'),
      parcelas: Math.max(1, numero(compra, 'payment.installments_number') || 1),
      descricao,
      bruto: corpo,
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
