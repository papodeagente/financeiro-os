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
 *    É o que permite aceitar o webhook que a agência já cadastrou sem
 *    Basic Auth, sem baixar a guarda.
 *
 * Valores vêm em CENTAVOS. Somar centavo como real multiplica a receita
 * por cem, então a conversão é explícita em todo campo de dinheiro.
 */
import type {
  AdapterPlataforma, EventoNormalizado, ResultadoVerificacao,
} from './tipos';
import { data, deCentavos, digitos, iguaisEmTempoConstante, numero, texto, em } from './comum';

const BASE = 'https://api.pagar.me/core/v5';
const TIMEOUT_MS = 15000;

const MAPA: Record<string, EventoNormalizado['tipo']> = {
  'order.paid': 'PAGAMENTO_CONFIRMADO',
  'charge.paid': 'PAGAMENTO_CONFIRMADO',
  'charge.refunded': 'REEMBOLSO',
  'order.canceled': 'REEMBOLSO',
  'charge.chargeback': 'CHARGEBACK',
};

/** Caminho de consulta por tipo de objeto, para a verificação por retorno. */
function caminhoDoObjeto(tipoEvento: string, id: string): string | null {
  if (!id) return null;
  if (tipoEvento.startsWith('order.')) return `/orders/${encodeURIComponent(id)}`;
  if (tipoEvento.startsWith('charge.')) return `/charges/${encodeURIComponent(id)}`;
  if (tipoEvento.startsWith('subscription.')) return `/subscriptions/${encodeURIComponent(id)}`;
  return null;
}

async function consultar(caminho: string, secretKey: string): Promise<boolean> {
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${caminho}`, {
      headers: {
        // Basic com a secret key como usuário e senha vazia.
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        Accept: 'application/json',
      },
      signal: controle.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export const adapterPagarme: AdapterPlataforma = {
  id: 'pagarme',
  nome: 'Pagar.me',
  capacidades: {
    assinaturaNoCorpo: false,
    exigeConsultaExtra: false,
    informaTaxa: false,
    informaPrevisaoDeRepasse: false,
  },

  camposCredencial: () => [
    {
      chave: 'api_key',
      rotulo: 'Secret key',
      tipo: 'segredo',
      obrigatorio: true,
      ajuda: 'No Pagar.me: Configurações, Chaves. Começa com sk_. Serve para confirmar que o aviso recebido corresponde a um pedido real da sua conta.',
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

    const existe = await consultar(caminho, cred.api_key);
    return existe
      ? { valido: true, motivo: '' }
      : { valido: false, motivo: 'O objeto informado não existe nesta conta Pagar.me.' };
  },

  async normalizar(corpo): Promise<EventoNormalizado> {
    const tipoEvento = texto(corpo, 'type');
    const tipo = MAPA[tipoEvento] ?? 'IGNORADO';

    const dados = em(corpo, 'data') ?? {};
    const cobrancas = (em(dados, 'charges') as unknown[]) ?? [];
    const primeira = cobrancas[0] ?? dados;
    const cliente = em(dados, 'customer') ?? em(primeira, 'customer') ?? {};
    const transacao = em(primeira, 'last_transaction') ?? {};

    // Tudo em centavos na origem.
    const bruto = deCentavos(numero(dados, 'amount') || numero(primeira, 'amount'));
    const itensBrutos = (em(dados, 'items') as unknown[]) ?? [];
    const itens = itensBrutos.length > 0
      ? itensBrutos.map(i => ({
          descricao: texto(i, 'description', 'name') || 'Item',
          quantidade: Math.max(1, numero(i, 'quantity') || 1),
          valor_unitario: deCentavos(numero(i, 'amount')),
        }))
      : [{ descricao: texto(dados, 'code') || 'Venda pelo Pagar.me', quantidade: 1, valor_unitario: bruto }];

    const descricao = itens[0]?.descricao ?? 'Venda pelo Pagar.me';

    return {
      tipo,
      id_externo: texto(corpo, 'id') || `${texto(dados, 'id')}:${tipoEvento}`,
      id_transacao: texto(dados, 'id'),
      comprador: {
        nome: texto(cliente, 'name'),
        email: texto(cliente, 'email'),
        documento: digitos(texto(cliente, 'document')),
        telefone: digitos(`${texto(cliente, 'phones.mobile_phone.area_code')}${texto(cliente, 'phones.mobile_phone.number')}`),
      },
      itens,
      valor_bruto: bruto,
      // A v5 não devolve a taxa no webhook: informar zero é honesto, e
      // inventar um percentual estimado seria pior que não informar.
      valor_taxa: 0,
      valor_liquido: bruto,
      moeda: texto(dados, 'currency') || 'BRL',
      data_pagamento: data(primeira, 'paid_at', 'created_at') || data(dados, 'created_at'),
      data_prevista_recebimento: '',
      forma_pagamento: texto(primeira, 'payment_method') || texto(transacao, 'transaction_type'),
      parcelas: Math.max(1, numero(transacao, 'installments') || 1),
      descricao,
      bruto: corpo,
    };
  },

  async testarCredencial(cred) {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/orders?size=1`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${cred.api_key}:`).toString('base64')}`,
          Accept: 'application/json',
        },
        signal: controle.signal,
      });
      if (!res.ok) throw new Error(`Pagar.me respondeu ${res.status}`);
      return { ok: true, conta: 'secret key válida' };
    } finally {
      clearTimeout(t);
    }
  },
};
