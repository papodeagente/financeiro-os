/**
 * Asaas.
 *
 * Armadilhas medidas em produção, todas tratadas aqui:
 *
 * - A URL base sai do PREFIXO da chave: `$aact_prod_` é produção,
 *   `$aact_hmlg_` é sandbox. Errar aqui consulta o ambiente errado e não
 *   acha a cobrança.
 * - `User-Agent` é obrigatório: sem ele a API recusa.
 * - PAYMENT_CONFIRMED e PAYMENT_RECEIVED significam pago, e os DOIS
 *   chegam. Tratar os dois como venda nova duplicaria; a idempotência por
 *   id de cobrança é o que segura.
 * - O payload manda `customer` como ID, não como objeto. Sem a consulta
 *   extra, a venda entra sem nome e sem documento.
 * - Responder erro para evento que não interessa faz o Asaas PAUSAR a
 *   fila. Evento válido e irrelevante volta como IGNORADO, com 200.
 */
import { round2 } from '../money';
import type {
  AdapterPlataforma, EventoNormalizado, ResultadoVerificacao,
} from './tipos';
import { data, digitos, iguaisEmTempoConstante, numero, texto } from './comum';

const TIMEOUT_MS = 15000;

export function baseDaChave(apiKey: string): string {
  // O prefixo é a única fonte confiável do ambiente. Perguntar ao usuário
  // dava erro silencioso: chave de produção consultada no sandbox responde
  // 401 e parece credencial errada.
  return String(apiKey ?? '').startsWith('$aact_hmlg_')
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3';
}

async function chamar(caminho: string, apiKey: string): Promise<unknown> {
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseDaChave(apiKey)}${caminho}`, {
      headers: {
        access_token: apiKey,
        // Obrigatório: sem User-Agent o Asaas recusa a requisição.
        'User-Agent': 'EnturOSFin/1.0',
        Accept: 'application/json',
      },
      signal: controle.signal,
    });
    if (!res.ok) throw new Error(`Asaas respondeu ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** PAGO: os dois eventos valem. Estorno e chargeback revogam. */
const MAPA: Record<string, EventoNormalizado['tipo']> = {
  PAYMENT_CONFIRMED: 'PAGAMENTO_CONFIRMADO',
  PAYMENT_RECEIVED: 'PAGAMENTO_CONFIRMADO',
  PAYMENT_REFUNDED: 'REEMBOLSO',
  PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK',
  PAYMENT_CHARGEBACK_DISPUTE: 'CHARGEBACK',
};

export const adapterAsaas: AdapterPlataforma = {
  id: 'asaas',
  nome: 'Asaas',
  capacidades: {
    assinaturaNoCorpo: false,
    exigeConsultaExtra: true,
    informaTaxa: true,
    informaPrevisaoDeRepasse: true,
  },

  camposCredencial: () => [
    {
      chave: 'api_key',
      rotulo: 'Chave de API',
      tipo: 'segredo',
      obrigatorio: true,
      ajuda: 'No Asaas: Configurações, Integrações, Gerar chave de API. Começa com $aact_. O ambiente (produção ou sandbox) é reconhecido pelo próprio prefixo.',
    },
    {
      chave: 'segredo_webhook',
      rotulo: 'Token do webhook',
      tipo: 'segredo',
      obrigatorio: true,
      ajuda: 'Você escolhe este valor e repete no Asaas ao cadastrar o webhook, no campo Token de autenticação.',
    },
  ],

  async verificar(_corpoCru, cabecalhos, cred): Promise<ResultadoVerificacao> {
    const enviado = cabecalhos['asaas-access-token'] ?? '';
    if (!cred.segredo_webhook) {
      return { valido: false, motivo: 'Token do webhook não configurado nesta agência.' };
    }
    if (!iguaisEmTempoConstante(enviado, cred.segredo_webhook)) {
      return { valido: false, motivo: 'Token do webhook não confere.' };
    }
    return { valido: true, motivo: '' };
  },

  async normalizar(corpo, cred): Promise<EventoNormalizado> {
    const evento = texto(corpo, 'event');
    const tipo = MAPA[evento] ?? 'IGNORADO';
    const pagamento = (corpo as Record<string, unknown>)?.payment ?? {};

    // O payload traz customer como id. Sem buscar, a venda entra anônima.
    let comprador = { nome: '', email: '', documento: '', telefone: '' };
    const clienteId = texto(pagamento, 'customer');
    if (clienteId && cred.api_key && tipo !== 'IGNORADO') {
      try {
        const c = await chamar(`/customers/${encodeURIComponent(clienteId)}`, cred.api_key);
        comprador = {
          nome: texto(c, 'name'),
          email: texto(c, 'email'),
          documento: digitos(texto(c, 'cpfCnpj')),
          telefone: digitos(texto(c, 'mobilePhone', 'phone')),
        };
      } catch {
        // Falhar a consulta não pode perder a venda: o dinheiro entrou.
        // A venda fica com o id do cliente na descrição e alguém completa.
        comprador = { nome: `Cliente Asaas ${clienteId}`, email: '', documento: '', telefone: '' };
      }
    }

    const bruto = round2(numero(pagamento, 'value'));
    const liquido = round2(numero(pagamento, 'netValue'));
    const descricao = texto(pagamento, 'description') || 'Venda pelo Asaas';

    return {
      tipo,
      // O id do EVENTO garante idempotência de reenvio; quando o Asaas não
      // manda, o par cobrança e evento serve, porque a mesma cobrança pode
      // legitimamente gerar CONFIRMED e depois RECEIVED.
      id_externo: texto(corpo, 'id') || `${texto(pagamento, 'id')}:${evento}`,
      id_transacao: texto(pagamento, 'id'),
      comprador,
      itens: [{ descricao, quantidade: 1, valor_unitario: bruto }],
      valor_bruto: bruto,
      // netValue já vem descontado: a taxa é a diferença, e só existe
      // quando o Asaas informou o líquido.
      valor_taxa: liquido > 0 ? round2(bruto - liquido) : 0,
      valor_liquido: liquido > 0 ? liquido : bruto,
      moeda: 'BRL',
      data_pagamento: data(pagamento, 'paymentDate', 'clientPaymentDate', 'confirmedDate', 'dateCreated'),
      data_prevista_recebimento: data(pagamento, 'estimatedCreditDate', 'creditDate'),
      forma_pagamento: texto(pagamento, 'billingType'),
      parcelas: Math.max(1, numero(pagamento, 'installmentCount') || 1),
      descricao,
      bruto: corpo,
    };
  },

  async testarCredencial(cred) {
    const r = await chamar('/myAccount', cred.api_key);
    return { ok: true, conta: texto(r, 'name', 'email', 'id') || 'conta Asaas' };
  },
};
