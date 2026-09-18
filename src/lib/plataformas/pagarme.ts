/**
 * Pagar.me v5.
 *
 * Armadilha central: a v5 NÃO assina o corpo. Sobram duas provas, e as
 * duas estão implementadas:
 *
 * 1. Basic Auth no webhook, que é o caminho rápido quando a agência
 *    configurou usuário e senha no painel.
 * 2. Verificação por retorno: busca o objeto na conta usando a secret key.
 *    Quem forja o aviso não consegue inventar um id que exista na conta.
 *
 * Valores vêm em CENTAVOS. Somar centavo como real multiplica a receita
 * por cem, então a conversão é explícita em todo campo de dinheiro.
 *
 * Taxa, antecipação e data de liberação NÃO vêm no webhook. Elas vivem em
 * `/payables`, o extrato de recebíveis: é de lá que sai o que a agência
 * realmente vai receber e quando. Sem essa consulta a integração mostraria
 * taxa zero — que é honesto, mas inútil para conciliar o extrato.
 */
import { round2 } from '../money';
import type {
  AdapterPlataforma, EventoNormalizado, ParcelaNormalizada, PeriodoImportacao,
  ResultadoVerificacao, StatusParcelaPlataforma, TipoEventoPlataforma, TransacaoNormalizada,
} from './tipos';
import {
  data, deCentavos, digitos, iguaisEmTempoConstante, montarParcelas, numero, texto, em,
} from './comum';

const BASE = 'https://api.pagar.me/core/v5';
const TIMEOUT_MS = 15000;
const MAX_PAGINAS = 50;

const MAPA: Record<string, TipoEventoPlataforma> = {
  'order.created': 'PAGAMENTO_CRIADO',
  'charge.created': 'PAGAMENTO_CRIADO',
  'charge.pending': 'PAGAMENTO_CRIADO',
  'order.paid': 'PAGAMENTO_CONFIRMADO',
  'charge.paid': 'PAGAMENTO_CONFIRMADO',
  'charge.overpaid': 'PAGAMENTO_CONFIRMADO',
  'charge.underpaid': 'PAGAMENTO_CONFIRMADO',
  'charge.payment_failed': 'PAGAMENTO_ATRASADO',
  'charge.refunded': 'REEMBOLSO',
  'order.canceled': 'PAGAMENTO_CANCELADO',
  'charge.chargeback': 'CHARGEBACK',
};

const STATUS: Record<TipoEventoPlataforma, StatusParcelaPlataforma> = {
  PAGAMENTO_CRIADO: 'PENDENTE',
  PAGAMENTO_CONFIRMADO: 'CONFIRMADO',
  PAGAMENTO_RECEBIDO: 'RECEBIDO',
  PAGAMENTO_ATRASADO: 'ATRASADO',
  PAGAMENTO_CANCELADO: 'CANCELADO',
  REEMBOLSO: 'ESTORNADO',
  CHARGEBACK: 'CHARGEBACK',
  ANTECIPACAO: 'CONFIRMADO',
  IGNORADO: 'PENDENTE',
};

function autorizacao(secretKey: string): string {
  // Basic com a secret key como usuário e senha vazia.
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
}

async function buscar(caminho: string, secretKey: string): Promise<unknown | null> {
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${caminho}`, {
      headers: { Authorization: autorizacao(secretKey), Accept: 'application/json' },
      signal: controle.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Caminho de consulta por tipo de objeto, para a verificação por retorno. */
function caminhoDoObjeto(tipoEvento: string, id: string): string | null {
  if (!id) return null;
  if (tipoEvento.startsWith('order.')) return `/orders/${encodeURIComponent(id)}`;
  if (tipoEvento.startsWith('charge.')) return `/charges/${encodeURIComponent(id)}`;
  if (tipoEvento.startsWith('subscription.')) return `/subscriptions/${encodeURIComponent(id)}`;
  return null;
}

export interface RecebivelPagarme {
  installment: number;
  amount: number;
  fee: number;
  anticipation_fee: number;
  payment_date: string;
  original_payment_date: string;
  status: string;
  type: string;
}

/**
 * Recebíveis de uma cobrança, já traduzidos.
 *
 * `status: paid` é dinheiro na conta; `waiting_funds` é promessa com data.
 * `type` separa crédito de estorno e de chargeback — somar tudo como
 * crédito faria o estornado aparecer como receita.
 */
export function lerRecebiveis(resposta: unknown): RecebivelPagarme[] {
  const lista = ((resposta as Record<string, unknown>)?.data as unknown[]) ?? [];
  return lista.map(p => ({
    installment: Math.max(1, numero(p, 'installment') || 1),
    amount: deCentavos(numero(p, 'amount')),
    fee: deCentavos(numero(p, 'fee')),
    anticipation_fee: deCentavos(numero(p, 'anticipation_fee')),
    payment_date: data(p, 'payment_date'),
    original_payment_date: data(p, 'original_payment_date'),
    status: texto(p, 'status'),
    type: texto(p, 'type'),
  }));
}

/**
 * Aplica o extrato de recebíveis sobre as parcelas montadas do pedido.
 *
 * Só mexe no que o extrato conhece: parcela sem recebível continua como
 * estava, com taxa zero declarada, em vez de virar estimativa.
 */
export function aplicarRecebiveis(
  parcelas: ParcelaNormalizada[],
  recebiveis: RecebivelPagarme[],
): ParcelaNormalizada[] {
  if (recebiveis.length === 0) return parcelas;

  // Estorno e chargeback aparecem como recebível de tipo próprio, com
  // valor negativo. Eles não são liberação de parcela: o status da venda
  // já cuida deles, e somá-los aqui zeraria a taxa da parcela original.
  const creditos = recebiveis.filter(r => r.type === 'credit' || r.type === '');

  return parcelas.map(parcela => {
    const doNumero = creditos.filter(r => r.installment === parcela.numero);
    if (doNumero.length === 0) return parcela;

    const taxa = round2(doNumero.reduce((a, r) => a + r.fee + r.anticipation_fee, 0));
    const valor = round2(doNumero.reduce((a, r) => a + r.amount, 0));
    const liquidado = doNumero.every(r => r.status === 'paid');
    const antecipada = doNumero.some(
      r => r.anticipation_fee > 0
        || (!!r.original_payment_date && r.original_payment_date !== r.payment_date),
    );
    const quando = doNumero[0].payment_date;

    return {
      ...parcela,
      valor_taxa: taxa,
      valor_liquido: round2((valor || parcela.valor_bruto) - taxa),
      data_prevista_recebimento: quando || parcela.data_prevista_recebimento,
      data_recebimento: liquidado ? (quando || parcela.data_recebimento) : parcela.data_recebimento,
      status: liquidado && parcela.status === 'CONFIRMADO' ? 'RECEBIDO' : parcela.status,
      antecipada,
    };
  });
}

export const adapterPagarme: AdapterPlataforma = {
  id: 'pagarme',
  nome: 'Pagar.me',
  capacidades: {
    assinaturaNoCorpo: false,
    exigeConsultaExtra: true,
    informaTaxa: true,
    informaPrevisaoDeRepasse: true,
    permiteImportacao: true,
  },

  camposCredencial: () => [
    {
      chave: 'api_key',
      rotulo: 'Secret key',
      tipo: 'segredo',
      obrigatorio: true,
      ajuda: 'No Pagar.me: Configurações, Chaves. Começa com sk_. Além de confirmar a origem do aviso, é ela que busca a taxa real e a data de liberação de cada parcela.',
    },
    {
      chave: 'segredo_webhook',
      rotulo: 'Basic Auth do webhook (opcional)',
      tipo: 'segredo',
      obrigatorio: false,
      ajuda: 'No formato usuario:senha, igual ao que você cadastrou no webhook do Pagar.me. Em branco, a confirmação é feita consultando o pedido na sua conta.',
    },
  ],

  async verificar(_corpoCru, cabecalhos, cred): Promise<ResultadoVerificacao> {
    // Caminho rápido: Basic Auth.
    if (cred.segredo_webhook) {
      const cabecalho = cabecalhos['authorization'] ?? '';
      const esperado = `Basic ${Buffer.from(cred.segredo_webhook).toString('base64')}`;
      if (iguaisEmTempoConstante(cabecalho, esperado)) return { valido: true, motivo: '' };
      return { valido: false, motivo: 'Basic Auth do webhook não confere.' };
    }

    // Sem Basic Auth, a prova é o objeto existir na conta. Quem forja não
    // inventa um id que responda 200 com a secret key da agência.
    if (!cred.api_key) {
      return { valido: false, motivo: 'Sem Basic Auth e sem secret key, não há como confirmar a origem.' };
    }
    let corpo: unknown;
    try { corpo = JSON.parse(_corpoCru); } catch { return { valido: false, motivo: 'Corpo não é JSON.' }; }

    const tipoEvento = texto(corpo, 'type');
    const id = texto(corpo, 'data.id', 'data.order.id', 'data.charge.id');
    const caminho = caminhoDoObjeto(tipoEvento, id);
    if (!caminho) return { valido: false, motivo: `Evento ${tipoEvento} sem objeto consultável.` };

    const existe = await buscar(caminho, cred.api_key);
    return existe
      ? { valido: true, motivo: '' }
      : { valido: false, motivo: 'O objeto informado não existe nesta conta Pagar.me.' };
  },

  async normalizar(corpo, cred): Promise<EventoNormalizado> {
    const tipoEvento = texto(corpo, 'type');
    const tipo = MAPA[tipoEvento] ?? 'IGNORADO';

    const dados = em(corpo, 'data') ?? {};
    const cobrancas = (em(dados, 'charges') as unknown[]) ?? [];
    const primeira = cobrancas[0] ?? dados;
    const cliente = em(dados, 'customer') ?? em(primeira, 'customer') ?? {};
    const transacaoCartao = em(primeira, 'last_transaction') ?? {};

    // Tudo em centavos na origem.
    const bruto = deCentavos(numero(dados, 'amount') || numero(primeira, 'amount'));
    const itensBrutos = (em(dados, 'items') as unknown[]) ?? [];
    const itens = itensBrutos.length > 0
      ? itensBrutos.map(i => ({
          descricao: texto(i, 'description', 'name') || 'Item',
          quantidade: Math.max(1, numero(i, 'quantity') || 1),
          valor_unitario: deCentavos(numero(i, 'amount')),
          id_externo: texto(i, 'id', 'code'),
        }))
      : [{
          descricao: texto(dados, 'code') || 'Venda pelo Pagar.me',
          quantidade: 1,
          valor_unitario: bruto,
          id_externo: texto(dados, 'code'),
        }];

    const descricao = itens[0]?.descricao ?? 'Venda pelo Pagar.me';
    const parcelasQtd = Math.max(1, numero(transacaoCartao, 'installments') || 1);
    const pago = tipo === 'PAGAMENTO_CONFIRMADO';
    const quandoPagou = data(primeira, 'paid_at', 'created_at') || data(dados, 'created_at');

    let parcelas = montarParcelas({
      total: bruto,
      quantidade: parcelasQtd,
      status: STATUS[tipo] ?? 'PENDENTE',
      primeiroVencimento: quandoPagou || data(dados, 'created_at'),
      dataPagamento: pago ? quandoPagou : '',
      idBase: texto(primeira, 'id') || texto(dados, 'id'),
    });

    // A taxa real e a data de liberação vivem no extrato de recebíveis.
    // Falhar aqui não pode perder a venda: sem o extrato a parcela fica
    // com taxa zero declarada, e a próxima importação completa.
    const idCobranca = texto(primeira, 'id');
    if (pago && cred.api_key && idCobranca) {
      const extrato = await buscar(`/payables?charge_id=${encodeURIComponent(idCobranca)}&size=100`, cred.api_key);
      if (extrato) parcelas = aplicarRecebiveis(parcelas, lerRecebiveis(extrato));
    }

    const taxaTotal = round2(parcelas.reduce((a, p) => a + p.valor_taxa, 0));

    const transacao: TransacaoNormalizada = {
      id_transacao: texto(dados, 'id'),
      id_assinatura: texto(dados, 'subscription_id', 'subscription.id'),
      comprador: {
        nome: texto(cliente, 'name'),
        email: texto(cliente, 'email'),
        documento: digitos(texto(cliente, 'document')),
        telefone: digitos(`${texto(cliente, 'phones.mobile_phone.area_code')}${texto(cliente, 'phones.mobile_phone.number')}`),
      },
      itens,
      valor_bruto: bruto,
      valor_taxa: taxaTotal,
      valor_liquido: round2(bruto - taxaTotal),
      desconto: 0,
      juros: 0,
      moeda: texto(dados, 'currency') || 'BRL',
      forma_pagamento: texto(primeira, 'payment_method') || texto(transacaoCartao, 'transaction_type'),
      detalhe_pagamento: texto(transacaoCartao, 'card.brand', 'card.first_six_digits'),
      parcelas,
      data_venda: data(dados, 'created_at') || quandoPagou,
      descricao,
      bruto: corpo,
    };

    return {
      tipo,
      id_externo: texto(corpo, 'id') || `${texto(dados, 'id')}:${tipoEvento}`,
      transacao,
      parcela_afetada: 0,
    };
  },

  async importar(cred, periodo: PeriodoImportacao): Promise<TransacaoNormalizada[]> {
    const saida: TransacaoNormalizada[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const r = await buscar(
        `/orders?size=100&page=${pagina}&created_since=${periodo.de}T00:00:00Z&created_until=${periodo.ate}T23:59:59Z`,
        cred.api_key,
      );
      const lista = ((r as Record<string, unknown>)?.data as unknown[]) ?? [];
      for (const pedido of lista) {
        // O mesmo caminho do webhook, para não existirem duas traduções do
        // mesmo pedido: o status do pedido faz o papel do tipo do evento.
        const status = texto(pedido, 'status');
        const evento = status === 'paid' ? 'order.paid'
          : status === 'canceled' ? 'order.canceled'
          : 'order.created';
        const e = await adapterPagarme.normalizar({ type: evento, data: pedido }, cred);
        saida.push(e.transacao);
      }
      if (lista.length < 100) break;
    }
    return saida;
  },

  async testarCredencial(cred) {
    const r = await buscar('/orders?size=1', cred.api_key);
    if (!r) throw new Error('A secret key foi recusada pelo Pagar.me.');
    return { ok: true, conta: 'secret key válida' };
  },
};
