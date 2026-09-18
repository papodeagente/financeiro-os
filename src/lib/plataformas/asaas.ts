/**
 * Asaas.
 *
 * Armadilhas medidas em produção, todas tratadas aqui:
 *
 * - A URL base sai do PREFIXO da chave: `$aact_prod_` é produção,
 *   `$aact_hmlg_` é sandbox. Errar aqui consulta o ambiente errado e não
 *   acha a cobrança.
 * - `User-Agent` é obrigatório: sem ele a API recusa.
 * - CONFIRMED e RECEIVED **não** são a mesma coisa: confirmado é o
 *   comprador tendo pago, recebido é o dinheiro na conta. Os dois chegam,
 *   e tratar confirmado como caixa antecipa dinheiro que só cai em D+30.
 * - O payload manda `customer` como ID, não como objeto. Sem a consulta
 *   extra, a venda entra sem nome e sem documento.
 * - Responder erro para evento que não interessa faz o Asaas PAUSAR a
 *   fila. Evento válido e irrelevante volta como IGNORADO, com 200.
 * - Parcelado no Asaas são N cobranças com o MESMO `installment`. Sem
 *   agrupar por ele, um contrato anual vira 12 vendas de "Parcela N de 12".
 * - Filtrar a importação só por `paymentDate` perde cobrança confirmada e
 *   não liquidada — foi assim que 82 cobranças viraram 4. A varredura é
 *   dupla, por data de pagamento e por data de criação, unida por id.
 */
import { round2 } from '../money';
import type {
  AdapterPlataforma, EventoNormalizado, ParcelaNormalizada, PeriodoImportacao,
  ResultadoVerificacao, StatusParcelaPlataforma, TipoEventoPlataforma, TransacaoNormalizada,
} from './tipos';
import { data, digitos, iguaisEmTempoConstante, numero, texto } from './comum';

const TIMEOUT_MS = 15000;
const PAGINA = 100;
/** Teto de segurança: conta grande não pode virar laço infinito de fetch. */
const MAX_PAGINAS = 50;

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

/** Evento para o vocabulário do financeiro. */
const MAPA: Record<string, TipoEventoPlataforma> = {
  PAYMENT_CREATED: 'PAGAMENTO_CRIADO',
  PAYMENT_CONFIRMED: 'PAGAMENTO_CONFIRMADO',
  PAYMENT_RECEIVED: 'PAGAMENTO_RECEBIDO',
  PAYMENT_RECEIVED_IN_CASH: 'PAGAMENTO_RECEBIDO',
  PAYMENT_OVERDUE: 'PAGAMENTO_ATRASADO',
  PAYMENT_DELETED: 'PAGAMENTO_CANCELADO',
  PAYMENT_REFUNDED: 'REEMBOLSO',
  PAYMENT_PARTIALLY_REFUNDED: 'REEMBOLSO',
  PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK',
  PAYMENT_CHARGEBACK_DISPUTE: 'CHARGEBACK',
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'CHARGEBACK',
  PAYMENT_ANTICIPATED: 'ANTECIPACAO',
};

/**
 * O status da própria cobrança, para os eventos que não dizem o que
 * aconteceu (UPDATED, RESTORED) e para a importação, onde não há evento
 * nenhum — só o retrato atual.
 */
export function tipoPorStatus(status: string): TipoEventoPlataforma {
  switch (String(status ?? '').toUpperCase()) {
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
    case 'DUNNING_RECEIVED':
      return 'PAGAMENTO_RECEBIDO';
    case 'CONFIRMED':
      return 'PAGAMENTO_CONFIRMADO';
    case 'OVERDUE':
      return 'PAGAMENTO_ATRASADO';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
      return 'REEMBOLSO';
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'CHARGEBACK';
    case 'DELETED':
      return 'PAGAMENTO_CANCELADO';
    default:
      return 'PAGAMENTO_CRIADO';
  }
}

const STATUS: Record<TipoEventoPlataforma, StatusParcelaPlataforma> = {
  PAGAMENTO_CRIADO: 'PENDENTE',
  PAGAMENTO_CONFIRMADO: 'CONFIRMADO',
  PAGAMENTO_RECEBIDO: 'RECEBIDO',
  PAGAMENTO_ATRASADO: 'ATRASADO',
  PAGAMENTO_CANCELADO: 'CANCELADO',
  REEMBOLSO: 'ESTORNADO',
  CHARGEBACK: 'CHARGEBACK',
  // Antecipar muda a data, não o direito: a parcela segue confirmada.
  ANTECIPACAO: 'CONFIRMADO',
  IGNORADO: 'PENDENTE',
};

async function buscarComprador(clienteId: string, apiKey: string) {
  try {
    const c = await chamar(`/customers/${encodeURIComponent(clienteId)}`, apiKey);
    return {
      nome: texto(c, 'name'),
      email: texto(c, 'email'),
      documento: digitos(texto(c, 'cpfCnpj')),
      telefone: digitos(texto(c, 'mobilePhone', 'phone')),
    };
  } catch {
    // Falhar a consulta não pode perder a venda: o dinheiro entrou.
    // A venda fica com o id do cliente no nome e alguém completa depois.
    return { nome: `Cliente Asaas ${clienteId}`, email: '', documento: '', telefone: '' };
  }
}

/** Uma cobrança do Asaas vira uma parcela. */
function parcelaDaCobranca(pagamento: unknown, tipo: TipoEventoPlataforma): ParcelaNormalizada {
  const bruto = round2(numero(pagamento, 'value'));
  const liquido = round2(numero(pagamento, 'netValue'));
  const original = round2(numero(pagamento, 'originalValue'));
  const juros = round2(numero(pagamento, 'interestValue'));

  // `originalValue` é o valor antes de desconto e juros. A diferença para
  // o `value` cobrado é desconto quando cobrou menos, e nunca vira juros
  // negativo: sinal trocado aqui inverte receita no DRE.
  const desconto = original > 0 && original > bruto ? round2(original - bruto) : 0;

  const recebido = tipo === 'PAGAMENTO_RECEBIDO';
  const pago = recebido || tipo === 'PAGAMENTO_CONFIRMADO';

  return {
    numero: Math.max(1, numero(pagamento, 'installmentNumber') || 1),
    total: Math.max(1, numero(pagamento, 'installmentCount') || 1),
    id_externo: texto(pagamento, 'id'),
    valor_bruto: bruto,
    // netValue já vem descontado: a taxa é a diferença, e só existe
    // quando o Asaas informou o líquido.
    valor_taxa: liquido > 0 && bruto > liquido ? round2(bruto - liquido) : 0,
    valor_liquido: liquido > 0 ? liquido : bruto,
    desconto,
    juros,
    status: STATUS[tipo] ?? 'PENDENTE',
    data_vencimento: data(pagamento, 'dueDate', 'originalDueDate'),
    data_prevista_recebimento: data(pagamento, 'estimatedCreditDate', 'creditDate'),
    data_pagamento: pago ? data(pagamento, 'paymentDate', 'clientPaymentDate', 'confirmedDate') : '',
    data_recebimento: recebido ? data(pagamento, 'creditDate', 'paymentDate', 'clientPaymentDate') : '',
    antecipada: (pagamento as Record<string, unknown>)?.anticipated === true || tipo === 'ANTECIPACAO',
  };
}

function transacaoDaCobranca(
  pagamento: unknown,
  tipo: TipoEventoPlataforma,
  comprador: TransacaoNormalizada['comprador'],
  bruto: unknown,
): TransacaoNormalizada {
  const parcela = parcelaDaCobranca(pagamento, tipo);
  const descricao = texto(pagamento, 'description') || 'Venda pelo Asaas';
  // Parcelado: o contrato é o `installment`, não a cobrança do mês. Sem
  // isso cada parcela vira uma venda e o total do cliente multiplica.
  const idContrato = texto(pagamento, 'installment') || texto(pagamento, 'id');

  return {
    id_transacao: idContrato,
    id_assinatura: texto(pagamento, 'subscription'),
    comprador,
    itens: [{
      descricao,
      quantidade: 1,
      valor_unitario: parcela.valor_bruto,
      id_externo: texto(pagamento, 'externalReference'),
    }],
    // Um webhook fala de UMA cobrança. O total do contrato só é conhecido
    // com as outras: quem consolida é o financeiro, somando as parcelas
    // que já conhece. Prometer aqui o total de 12 parcelas a partir de uma
    // seria inventar receita que a plataforma não confirmou.
    valor_bruto: parcela.valor_bruto,
    valor_taxa: parcela.valor_taxa,
    valor_liquido: parcela.valor_liquido,
    desconto: parcela.desconto,
    juros: parcela.juros,
    moeda: 'BRL',
    forma_pagamento: texto(pagamento, 'billingType'),
    detalhe_pagamento: texto(pagamento, 'creditCard.creditCardBrand', 'pixTransaction.endToEndIdentifier'),
    parcelas: [parcela],
    data_venda: data(pagamento, 'dateCreated', 'dueDate'),
    descricao,
    bruto,
  };
}

export const adapterAsaas: AdapterPlataforma = {
  id: 'asaas',
  nome: 'Asaas',
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
    const pagamento = (corpo as Record<string, unknown>)?.payment ?? {};

    // Evento que não diz o que houve (UPDATED, RESTORED) é lido pelo
    // status da cobrança: é o mesmo caminho da importação.
    const conhecido = MAPA[evento];
    const tipo: TipoEventoPlataforma = conhecido
      ?? (evento === 'PAYMENT_UPDATED' || evento === 'PAYMENT_RESTORED'
        ? tipoPorStatus(texto(pagamento, 'status'))
        : 'IGNORADO');

    let comprador = { nome: '', email: '', documento: '', telefone: '' };
    const clienteId = texto(pagamento, 'customer');
    if (clienteId && cred.api_key && tipo !== 'IGNORADO') {
      comprador = await buscarComprador(clienteId, cred.api_key);
    }

    const transacao = transacaoDaCobranca(pagamento, tipo, comprador, corpo);

    return {
      tipo,
      // O id do EVENTO garante idempotência de reenvio; quando o Asaas não
      // manda, o par cobrança e evento serve, porque a mesma cobrança pode
      // legitimamente gerar CONFIRMED e depois RECEIVED.
      id_externo: texto(corpo, 'id') || `${texto(pagamento, 'id')}:${evento}`,
      transacao,
      parcela_afetada: transacao.parcelas[0]?.numero ?? 0,
    };
  },

  async importar(cred, periodo: PeriodoImportacao): Promise<TransacaoNormalizada[]> {
    // Varredura dupla: só por data de pagamento perde o que está
    // confirmado e ainda não liquidado, e é justamente ali que moram os
    // contratos anuais.
    const filtros = [
      `paymentDate[ge]=${periodo.de}&paymentDate[le]=${periodo.ate}`,
      `dateCreated[ge]=${periodo.de}&dateCreated[le]=${periodo.ate}`,
    ];

    const porId = new Map<string, unknown>();
    for (const filtro of filtros) {
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const r = await chamar(
          `/payments?limit=${PAGINA}&offset=${pagina * PAGINA}&${filtro}`,
          cred.api_key,
        );
        const lista = ((r as Record<string, unknown>)?.data as unknown[]) ?? [];
        for (const p of lista) {
          const id = texto(p, 'id');
          if (id) porId.set(id, p);
        }
        if (lista.length < PAGINA || (r as Record<string, unknown>)?.hasMore !== true) break;
      }
    }

    // Uma consulta de cliente por cliente, não por cobrança: conta com 12
    // parcelas do mesmo comprador faria 12 chamadas idênticas.
    const compradores = new Map<string, TransacaoNormalizada['comprador']>();
    const saida: TransacaoNormalizada[] = [];
    for (const pagamento of porId.values()) {
      const tipo = tipoPorStatus(texto(pagamento, 'status'));
      const clienteId = texto(pagamento, 'customer');
      if (clienteId && !compradores.has(clienteId)) {
        compradores.set(clienteId, await buscarComprador(clienteId, cred.api_key));
      }
      const comprador = compradores.get(clienteId)
        ?? { nome: '', email: '', documento: '', telefone: '' };
      saida.push(transacaoDaCobranca(pagamento, tipo, comprador, pagamento));
    }
    return saida;
  },

  async testarCredencial(cred) {
    const r = await chamar('/myAccount', cred.api_key);
    return { ok: true, conta: texto(r, 'name', 'email', 'id') || 'conta Asaas' };
  },
};
