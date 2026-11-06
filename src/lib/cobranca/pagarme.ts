/**
 * Cobrança pelo Pagar.me v5 da agência (documentação oficial lida em 05/11/2026).
 *
 * - Autenticação Basic com a secret key (`sk_`, `sk_test_` em teste).
 * - Valores em CENTAVOS.
 * - Pedido (`POST /orders`) com UM pagamento: boleto OU Pix. Boleto com Pix
 *   no mesmo documento e carnê não estão documentados: `capacidades` diz
 *   isso, e a tela não oferece.
 * - `code` (até 52 caracteres) leva a referência própria; o código do
 *   pedido vai para a cobrança, e `GET /charges?code=` acha a cobrança
 *   depois de um timeout.
 * - Juros, multa e desconto só existem em conta com liquidação pelo
 *   Pagar.me (PSP), e só em %. Em conta "gateway" eles são recusados: só
 *   vão quando a agência marca que a conta é PSP.
 * - Boleto registrado exige nome, documento e ENDEREÇO do cliente; Pix
 *   exige nome, e-mail, documento e telefone.
 * - Vencimento: `PATCH /charges/{id}/due-date` (boleto). Cancelar e
 *   estornar: `DELETE /charges/{id}`.
 */
import { addDias, hojeISO } from '../money';
import { lerLinhaDoBoleto } from '../boleto-linha';
import { data, digitos, em, texto } from '../plataformas/comum';
import { criarClienteHttp, type AmbienteDeCobranca, type ClienteHttp } from './http';
import {
  ErroProvedor,
  type AdapterCobranca, type CapacidadesCobranca, type ClienteDaCobranca, type CobrancaNoProvedor,
  type DadosDePagamento, type EncargosDaCobranca, type PedidoDeCobranca, type StatusCobranca,
} from './tipos';

const BASE = 'https://api.pagar.me/core/v5';

export const CAPACIDADES_PAGARME: CapacidadesCobranca = {
  boleto: true,
  pix: true,
  boletoComPix: false,
  carne: false,
  jurosMulta: true,
  desconto: true,
  link: true,
  estornoPix: true,
  alterarValor: false,
  alterarVencimento: true,
  alterarVencimentoPix: false,
  avisaCredito: false,
  observacoes: [
    'No Pagar.me a cobrança é boleto ou Pix: os dois no mesmo documento não existem lá.',
    'Juros, multa e desconto só valem em conta Pagar.me com liquidação pelo próprio Pagar.me (PSP), e só em porcentagem.',
    'Boleto pelo Pagar.me exige o endereço do cliente; Pix exige e-mail e telefone.',
    'No link de pagamento o cliente escolhe Pix, boleto ou cartão de crédito à vista.',
  ],
};

/**
 * Corpo do link de pagamento (`POST /paymentlinks`, doc oficial lida em
 * 06/11/2026, docs.pagar.me/reference/criar-link):
 *   · `accepted_payment_methods` com boleto, Pix e cartão (`credit_card`);
 *   · cada forma leva a configuração que a doc marca como obrigatória quando
 *     a forma vai: `boleto_settings.due_at` (ISO), `pix_settings.expires_in`
 *     (SEGUNDOS) e `credit_card_settings` com `operation_type`
 *     'auth_and_capture' (captura na hora) e `installments` só com 1x pelo
 *     valor cheio — parcelar com juros é decisão da agência, fora daqui;
 *   · `order_code` leva a nossa referência (`f1;…`) para o pedido gerado
 *     voltar ligado à cobrança. A doc não diz se o `order_code` aparece no
 *     pedido do aviso (confirmar no ambiente de teste): quando não aparece,
 *     o aviso procura o id do link no corpo e, sem achar, vira pendência
 *     (aviso.ts), nunca venda direta.
 */
export function corpoDoLinkPagarme(p: { referencia: string; nome: string; descricao: string; valor_centavos: number; vence_em: string }, agora: Date = new Date()) {
  const nome = p.nome.slice(0, 64);
  const fim = `${p.vence_em}T23:59:59-03:00`;
  const segundos = Math.max(3600, Math.round((Date.parse(fim) - agora.getTime()) / 1000));
  return {
    name: nome,
    type: 'order',
    order_code: p.referencia,
    expires_at: p.vence_em,
    max_paid_sessions: 1,
    payment_settings: {
      accepted_payment_methods: ['boleto', 'pix', 'credit_card'],
      boleto_settings: { due_at: `${p.vence_em}T00:00:00Z` },
      pix_settings: { expires_in: Number.isFinite(segundos) ? segundos : 86_400 },
      credit_card_settings: { operation_type: 'auth_and_capture', installments: [{ number: 1, total: p.valor_centavos }] },
    },
    cart_settings: { items: [{ amount: p.valor_centavos, name: nome, description: p.descricao.slice(0, 256), default_quantity: 1 }] },
  };
}

/** Status da cobrança (charge) no Pagar.me → nosso. */
export function statusPagarme(status: string): StatusCobranca {
  switch (String(status ?? '').toLowerCase()) {
    case 'paid':
    case 'overpaid':
    case 'underpaid':
      return 'paga';
    case 'canceled':
      return 'cancelada';
    case 'failed':
      return 'falhou';
    case 'refunded':
    case 'chargedback':
      return 'estornada';
    default:
      return 'aberta';
  }
}

/** Frase do Pagar.me: `{ message, errors: { campo: [frases] } }`. */
export function erroPagarme(corpo: unknown): string {
  const msg = texto(corpo, 'message');
  const erros = em(corpo, 'errors');
  const detalhes = erros && typeof erros === 'object'
    ? Object.values(erros as Record<string, unknown>).flatMap(v => (Array.isArray(v) ? v.map(String) : [String(v)]))
    : [];
  return [msg, ...detalhes].filter(Boolean).join(' ').slice(0, 300);
}

/** A cobrança (charge) do Pagar.me no nosso vocabulário. */
export function cobrancaPagarme(charge: unknown): CobrancaNoProvedor {
  const t = em(charge, 'last_transaction') ?? {};
  return {
    id_externo: texto(charge, 'id'),
    status: statusPagarme(texto(charge, 'status')),
    valor_centavos: Math.round(Number(em(charge, 'amount') ?? 0)) || 0,
    vencimento: data(t, 'due_at') || data(charge, 'due_at'),
    referencia: texto(charge, 'code', 'order.code'),
    id_carne: '',
    numero_parcela: 0,
    url_boleto: texto(t, 'pdf', 'url'),
    url_fatura: texto(t, 'url'),
    bruto: charge,
  };
}

/** A frase do provedor quando o pedido volta 200 mas a cobrança falhou. */
function motivoDaFalha(charge: unknown): string {
  const erros = em(charge, 'last_transaction.gateway_response.errors');
  const frases = Array.isArray(erros) ? erros.map(e => texto(e, 'message')).filter(Boolean) : [];
  return frases.join(' ').slice(0, 300) || 'O Pagar.me não gerou a cobrança.';
}

/** Juros e multa a partir do dia seguinte à tolerância; desconto até N dias antes. */
export function encargosPagarme(e: EncargosDaCobranca | null, vencimento: string): Record<string, unknown> {
  if (!e) return {};
  const r: Record<string, unknown> = {};
  const dias = Math.max(1, Math.round(e.tolerancia_dias) || 1);
  if (e.juros_am_pct > 0) r.interest = { days: dias, type: 'percentage', amount: e.juros_am_pct };
  if (e.multa_pct > 0) r.fine = { days: dias, type: 'percentage', amount: e.multa_pct };
  if (e.desconto && e.desconto.pct > 0 && e.desconto.dias > 0) {
    r.discount = { type: 'percentage', rules: [{ limit_date: addDias(vencimento, -Math.round(e.desconto.dias)), amount: e.desconto.pct }] };
  }
  return r;
}

function telefone(t: string): Record<string, unknown> | null {
  const d = digitos(t).replace(/^55(?=\d{10,11}$)/, '');
  if (d.length < 10) return null;
  return { mobile_phone: { country_code: '55', area_code: d.slice(0, 2), number: d.slice(2) } };
}

export interface OpcoesPagarme {
  secretKey: string;
  /** A conta liquida pelo Pagar.me (PSP): juros, multa e desconto podem ir no boleto. */
  contaPsp?: boolean;
  antesDeChamar?: () => Promise<void>;
  ambiente?: AmbienteDeCobranca;
}

export function criarAdapterPagarme(o: OpcoesPagarme): AdapterCobranca {
  const http: ClienteHttp = criarClienteHttp({
    base: BASE,
    cabecalhos: { Authorization: `Basic ${Buffer.from(`${o.secretKey}:`).toString('base64')}` },
    nome: 'Pagar.me',
    lerErro: erroPagarme,
    antesDeChamar: o.antesDeChamar,
    ambiente: o.ambiente,
  });

  const adapter: AdapterCobranca = {
    provedor: 'pagarme',
    nome: 'Pagar.me',
    capacidades: CAPACIDADES_PAGARME,

    async acharOuCriarCliente(c: ClienteDaCobranca): Promise<string> {
      const doc = digitos(c.documento);
      if (doc) {
        const r = await http.chamar(`/customers?document=${encodeURIComponent(doc)}&size=5`);
        const achado = ((em(r, 'data') as unknown[]) ?? []).find(x => digitos(texto(x, 'document')) === doc);
        if (achado && texto(achado, 'id')) return texto(achado, 'id');
      }
      const corpo: Record<string, unknown> = {
        name: c.nome.slice(0, 64),
        document: doc,
        document_type: doc.length === 14 ? 'CNPJ' : 'CPF',
        type: doc.length === 14 ? 'company' : 'individual',
        code: c.id.slice(0, 52),
      };
      if (c.email) corpo.email = c.email.slice(0, 64);
      const fone = telefone(c.telefone);
      if (fone) corpo.phones = fone;
      if (c.endereco && c.endereco.cep) {
        corpo.address = {
          line_1: [c.endereco.numero, c.endereco.logradouro, c.endereco.bairro].filter(Boolean).join(', '),
          line_2: c.endereco.complemento || undefined,
          zip_code: digitos(c.endereco.cep),
          city: c.endereco.cidade,
          state: c.endereco.uf,
          country: 'BR',
        };
      }
      const criado = await http.chamar('/customers', { metodo: 'POST', corpo });
      const id = texto(criado, 'id');
      if (!id) throw new ErroProvedor('servidor', 'O Pagar.me não devolveu o cliente criado.');
      return id;
    },

    async emitir(clienteExterno, _cliente, p: PedidoDeCobranca): Promise<CobrancaNoProvedor> {
      if (p.tipo === 'boleto_pix') {
        throw new ErroProvedor('recusa', 'O Pagar.me não emite boleto e Pix no mesmo documento. Escolha boleto ou Pix.');
      }
      const encargos = o.contaPsp ? encargosPagarme(p.encargos, p.vencimento) : {};
      const pagamento = p.tipo === 'pix'
        ? {
            payment_method: 'pix',
            // Vale até o fim do dia do vencimento em Brasília (23h59 = 02h59 UTC do dia seguinte).
            pix: { expires_at: `${addDias(p.vencimento, 1)}T02:59:59Z` },
          }
        : {
            payment_method: 'boleto',
            boleto: {
              due_at: `${p.vencimento}T00:00:00Z`,
              instructions: p.descricao.slice(0, 256),
              type: 'DM',
              ...encargos,
            },
          };
      const corpo = {
        code: p.referencia,
        customer_id: clienteExterno,
        items: [{ amount: p.valor_centavos, description: p.descricao.slice(0, 256) || 'Cobrança', quantity: 1, code: p.referencia }],
        payments: [pagamento],
      };
      const pedido = await http.chamar('/orders', { metodo: 'POST', corpo });
      const charge = ((em(pedido, 'charges') as unknown[]) ?? [])[0];
      if (!charge) throw new ErroProvedor('servidor', 'O Pagar.me não devolveu a cobrança do pedido.');
      const c = cobrancaPagarme(charge);
      if (c.status === 'falhou' || em(charge, 'last_transaction.success') === false) {
        throw new ErroProvedor('recusa', motivoDaFalha(charge));
      }
      if (!c.referencia) c.referencia = p.referencia;
      if (!c.vencimento) c.vencimento = p.vencimento;
      return c;
    },

    async consultar(idExterno) {
      try {
        return cobrancaPagarme(await http.chamar(`/charges/${encodeURIComponent(idExterno)}`));
      } catch (e) {
        if (e instanceof ErroProvedor && e.tipo === 'nao_encontrado') return null;
        throw e;
      }
    },

    async consultarPorReferencia(referencia) {
      const r = await http.chamar(`/charges?code=${encodeURIComponent(referencia)}&size=5`);
      const achadas = ((em(r, 'data') as unknown[]) ?? [])
        .map(cobrancaPagarme)
        .filter(c => c.status !== 'cancelada' && c.status !== 'falhou');
      return achadas[0] ?? null;
    },

    async dadosDePagamento(c): Promise<DadosDePagamento> {
      const t = em(c.bruto, 'last_transaction') ?? {};
      const tipo = texto(t, 'transaction_type') || texto(c.bruto, 'payment_method');
      if (tipo === 'pix') {
        return {
          linha_digitavel: '', codigo_barras: '',
          pix_copia_cola: texto(t, 'qr_code'),
          pix_qrcode_url: texto(t, 'qr_code_url'),
          url_boleto: '', url_fatura: '',
        };
      }
      const linha = digitos(texto(t, 'line'));
      const leitura = linha ? lerLinhaDoBoleto(linha, hojeISO()) : null;
      return {
        linha_digitavel: linha,
        codigo_barras: leitura && leitura.ok ? leitura.codigoDeBarras : '',
        pix_copia_cola: '',
        pix_qrcode_url: '',
        url_boleto: texto(t, 'pdf', 'url'),
        url_fatura: texto(t, 'url'),
      };
    },

    async alterar(idExterno, mudanca, atual) {
      if (mudanca.valor_centavos !== undefined && mudanca.valor_centavos !== atual.valor_centavos) {
        throw new ErroProvedor('recusa', 'O Pagar.me não muda o valor de uma cobrança emitida.');
      }
      if (atual.tipo === 'pix') throw new ErroProvedor('recusa', 'O Pagar.me não muda o vencimento de um Pix emitido.');
      const r = await http.chamar(`/charges/${encodeURIComponent(idExterno)}/due-date`, {
        metodo: 'PATCH', corpo: { due_at: `${mudanca.vencimento ?? atual.vencimento}T00:00:00Z` },
      });
      return cobrancaPagarme(r);
    },

    async cancelar(idExterno) {
      try {
        await http.chamar(`/charges/${encodeURIComponent(idExterno)}`, { metodo: 'DELETE' });
      } catch (e) {
        if (e instanceof ErroProvedor && e.tipo === 'nao_encontrado') return;
        throw e;
      }
    },

    async estornar(idExterno, valorCentavos) {
      const corpo = valorCentavos != null ? { amount: valorCentavos } : undefined;
      await http.chamar(`/charges/${encodeURIComponent(idExterno)}`, { metodo: 'DELETE', corpo });
    },

    async criarLink(p) {
      const corpo = corpoDoLinkPagarme(p);
      const r = await http.chamar('/paymentlinks', { metodo: 'POST', corpo });
      const id = texto(r, 'id');
      if (!id) throw new ErroProvedor('servidor', 'O Pagar.me não devolveu o link criado.');
      return { id_externo: id, url: texto(r, 'url') };
    },
  };
  return adapter;
}
