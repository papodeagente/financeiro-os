/**
 * Cobrança pelo Asaas v3 da agência (documentação oficial lida em 05/11/2026).
 *
 * - Autenticação: cabeçalho `access_token` e `User-Agent` obrigatório; o
 *   ambiente sai do prefixo da chave (o mesmo `baseDaChave` da integração
 *   de vendas).
 * - Valores em REAIS (aqui convertidos de/para centavos).
 * - Sem chave de idempotência: a referência própria vai em
 *   `externalReference`, e `consultarPorReferencia` é quem descobre, depois
 *   de um timeout, se a cobrança já nasceu.
 * - BOLETO já traz o QR do Pix no mesmo documento quando a conta tem chave
 *   Pix: é o "Boleto com Pix".
 * - Carnê = parcelamento (`POST /installments`), PDF em
 *   `/installments/{id}/paymentBook`.
 */
import { deCentavos, paraCentavos } from '../money';
import { baseDaChave } from '../plataformas/asaas';
import { data, digitos, texto } from '../plataformas/comum';
import { criarClienteHttp, type AmbienteDeCobranca, type ClienteHttp } from './http';
import {
  ErroProvedor,
  type AdapterCobranca, type CapacidadesCobranca, type CarneNoProvedor, type ClienteDaCobranca, type CobrancaNoProvedor,
  type DadosDePagamento, type EncargosDaCobranca, type NegativacaoNoProvedor, type PedidoDeCobranca, type StatusCobranca,
  type StatusNegativacao,
} from './tipos';

export const CAPACIDADES_ASAAS: CapacidadesCobranca = {
  boleto: true,
  pix: true,
  boletoComPix: true,
  carne: true,
  jurosMulta: true,
  desconto: true,
  link: true,
  estornoPix: true,
  alterarValor: true,
  alterarVencimento: true,
  alterarVencimentoPix: true,
  avisaCredito: true,
  observacoes: [
    'O boleto já sai com o QR do Pix quando a conta Asaas tem chave Pix cadastrada.',
    'Juros e multa começam no dia seguinte ao vencimento: o Asaas não tem dias de tolerância.',
  ],
  negativacao: true,
};

const STATUS_NEGATIVACAO = ['PENDING', 'AWAITING_APPROVAL', 'AWAITING_CANCELLATION', 'PROCESSED', 'PAID', 'PARTIALLY_PAID', 'DENIED', 'CANCELLED'] as const;

/** Negativação do Asaas (`/paymentDunnings`) → nossa. */
export function negativacaoAsaas(r: unknown): NegativacaoNoProvedor {
  const st = texto(r, 'status').toUpperCase();
  return {
    id_externo: texto(r, 'id'),
    numero: String((r as Record<string, unknown> | null)?.dunningNumber ?? ''),
    status: (STATUS_NEGATIVACAO as readonly string[]).includes(st) ? st as StatusNegativacao : 'PENDING',
    taxa_centavos: paraCentavos(Number((r as Record<string, unknown> | null)?.feeValue ?? 0)),
    pode_cancelar: (r as Record<string, unknown> | null)?.canBeCancelled === true,
    motivo_recusa: texto(r, 'denialReason') || texto(r, 'cannotBeCancelledReason'),
    reenviar_documentos: (r as Record<string, unknown> | null)?.isNecessaryResendDocumentation === true,
  };
}

/** Status da cobrança no Asaas → nosso. */
export function statusAsaas(status: string, removida = false): StatusCobranca {
  if (removida) return 'cancelada';
  switch (String(status ?? '').toUpperCase()) {
    case 'OVERDUE':
      return 'vencida';
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
    case 'DUNNING_RECEIVED':
      return 'paga';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'estornada';
    case 'DELETED':
      return 'cancelada';
    default:
      return 'aberta';
  }
}

/** Frase do Asaas: `{ errors: [{ code, description }] }`. */
export function erroAsaas(corpo: unknown): string {
  const erros = (corpo as { errors?: Array<{ description?: string }> } | null)?.errors;
  if (Array.isArray(erros) && erros.length) {
    return erros.map(e => String(e?.description ?? '').trim()).filter(Boolean).join(' ').slice(0, 300);
  }
  return '';
}

export function cobrancaAsaas(p: unknown): CobrancaNoProvedor {
  return {
    id_externo: texto(p, 'id'),
    status: statusAsaas(texto(p, 'status'), (p as Record<string, unknown>)?.deleted === true),
    valor_centavos: paraCentavos(Number((p as Record<string, unknown>)?.value ?? 0)),
    vencimento: data(p, 'dueDate'),
    referencia: texto(p, 'externalReference'),
    id_carne: texto(p, 'installment'),
    numero_parcela: Number((p as Record<string, unknown>)?.installmentNumber ?? 0) || 0,
    url_boleto: texto(p, 'bankSlipUrl'),
    url_fatura: texto(p, 'invoiceUrl'),
    bruto: p,
  };
}

/** Juros (% ao mês), multa (%) e desconto (% até N dias antes). */
export function encargosAsaas(e: EncargosDaCobranca | null): Record<string, unknown> {
  if (!e) return {};
  const r: Record<string, unknown> = {};
  if (e.juros_am_pct > 0) r.interest = { value: e.juros_am_pct };
  if (e.multa_pct > 0) r.fine = { value: e.multa_pct, type: 'PERCENTAGE' };
  if (e.desconto && e.desconto.pct > 0) {
    r.discount = { value: e.desconto.pct, dueDateLimitDays: Math.max(0, Math.round(e.desconto.dias)), type: 'PERCENTAGE' };
  }
  return r;
}

export interface OpcoesAsaas {
  apiKey: string;
  /** Deixa o Asaas mandar os avisos dele ao cliente (padrão: não; a régua é pelo CRM). */
  notificacoesDoProvedor?: boolean;
  antesDeChamar?: () => Promise<void>;
  ambiente?: AmbienteDeCobranca;
}

export function criarAdapterAsaas(o: OpcoesAsaas): AdapterCobranca {
  const http: ClienteHttp = criarClienteHttp({
    base: baseDaChave(o.apiKey),
    cabecalhos: { access_token: o.apiKey, 'User-Agent': 'EnturOSFin/1.0' },
    nome: 'Asaas',
    lerErro: erroAsaas,
    antesDeChamar: o.antesDeChamar,
    ambiente: o.ambiente,
  });

  const lista = async (caminho: string): Promise<unknown[]> => {
    const r = await http.chamar<{ data?: unknown[] }>(caminho);
    return Array.isArray(r?.data) ? r.data : [];
  };

  const pixCopiaCola = async (id: string): Promise<string> => {
    try {
      const r = await http.chamar(`/payments/${encodeURIComponent(id)}/pixQrCode`);
      return texto(r, 'payload');
    } catch (e) {
      // Conta sem chave Pix: o boleto continua valendo sem o QR.
      if (e instanceof ErroProvedor && (e.tipo === 'recusa' || e.tipo === 'nao_encontrado')) return '';
      throw e;
    }
  };

  const adapter: AdapterCobranca = {
    provedor: 'asaas',
    nome: 'Asaas',
    capacidades: CAPACIDADES_ASAAS,

    async acharOuCriarCliente(c: ClienteDaCobranca): Promise<string> {
      const doc = digitos(c.documento);
      // O Asaas aceita cliente duplicado: procura antes, pelo documento e
      // pela nossa referência do cliente.
      if (doc) {
        const achados = await lista(`/customers?cpfCnpj=${encodeURIComponent(doc)}&limit=10`);
        const vivo = achados.find(x => (x as Record<string, unknown>)?.deleted !== true);
        if (vivo && texto(vivo, 'id')) return texto(vivo, 'id');
      }
      if (c.id) {
        const achados = await lista(`/customers?externalReference=${encodeURIComponent(c.id)}&limit=10`);
        const vivo = achados.find(x => (x as Record<string, unknown>)?.deleted !== true);
        if (vivo && texto(vivo, 'id')) return texto(vivo, 'id');
      }
      const corpo: Record<string, unknown> = {
        name: c.nome,
        cpfCnpj: doc,
        externalReference: c.id,
        notificationDisabled: o.notificacoesDoProvedor !== true,
      };
      if (c.email) corpo.email = c.email;
      if (c.telefone) corpo.mobilePhone = c.telefone;
      if (c.endereco) {
        if (c.endereco.cep) corpo.postalCode = digitos(c.endereco.cep);
        if (c.endereco.logradouro) corpo.address = c.endereco.logradouro;
        if (c.endereco.numero) corpo.addressNumber = c.endereco.numero;
        if (c.endereco.complemento) corpo.complement = c.endereco.complemento;
        if (c.endereco.bairro) corpo.province = c.endereco.bairro;
      }
      const criado = await http.chamar('/customers', { metodo: 'POST', corpo });
      const id = texto(criado, 'id');
      if (!id) throw new ErroProvedor('servidor', 'O Asaas não devolveu o cliente criado.');
      return id;
    },

    async emitir(clienteExterno, _cliente, p: PedidoDeCobranca): Promise<CobrancaNoProvedor> {
      const corpo = {
        customer: clienteExterno,
        billingType: p.tipo === 'pix' ? 'PIX' : 'BOLETO',
        value: deCentavos(p.valor_centavos),
        dueDate: p.vencimento,
        description: p.descricao.slice(0, 500),
        externalReference: p.referencia,
        ...encargosAsaas(p.encargos),
      };
      const r = await http.chamar('/payments', { metodo: 'POST', corpo });
      const c = cobrancaAsaas(r);
      if (!c.id_externo) throw new ErroProvedor('servidor', 'O Asaas não devolveu a cobrança criada.');
      return c;
    },

    async consultar(idExterno) {
      try {
        return cobrancaAsaas(await http.chamar(`/payments/${encodeURIComponent(idExterno)}`));
      } catch (e) {
        if (e instanceof ErroProvedor && e.tipo === 'nao_encontrado') return null;
        throw e;
      }
    },

    async consultarPorReferencia(referencia) {
      const achadas = (await lista(`/payments?externalReference=${encodeURIComponent(referencia)}&limit=10`))
        .map(cobrancaAsaas)
        .filter(c => c.referencia === referencia && c.status !== 'cancelada');
      return achadas[0] ?? null;
    },

    async dadosDePagamento(c, tipo): Promise<DadosDePagamento> {
      const id = c.id_externo;
      let linha = '';
      let barras = '';
      if (tipo !== 'pix' && tipo !== 'link') {
        const r = await http.chamar(`/payments/${encodeURIComponent(id)}/identificationField`);
        linha = texto(r, 'identificationField');
        barras = texto(r, 'barCode');
      }
      const pix = tipo === 'link' ? '' : await pixCopiaCola(id);
      return {
        linha_digitavel: linha,
        codigo_barras: barras,
        pix_copia_cola: pix,
        pix_qrcode_url: '',
        url_boleto: c.url_boleto,
        url_fatura: c.url_fatura,
      };
    },

    async alterar(idExterno, mudanca, atual) {
      // PUT exige forma, valor e vencimento: vai o que mudou sobre o atual.
      const corpo = {
        billingType: atual.tipo === 'pix' ? 'PIX' : 'BOLETO',
        value: deCentavos(mudanca.valor_centavos ?? atual.valor_centavos),
        dueDate: mudanca.vencimento ?? atual.vencimento,
      };
      return cobrancaAsaas(await http.chamar(`/payments/${encodeURIComponent(idExterno)}`, { metodo: 'PUT', corpo }));
    },

    async cancelar(idExterno) {
      try {
        await http.chamar(`/payments/${encodeURIComponent(idExterno)}`, { metodo: 'DELETE' });
      } catch (e) {
        // Já removida no Asaas: o efeito que se queria já aconteceu.
        if (e instanceof ErroProvedor && e.tipo === 'nao_encontrado') return;
        throw e;
      }
    },

    async estornar(idExterno, valorCentavos, motivo) {
      const corpo: Record<string, unknown> = { description: motivo.slice(0, 500) };
      if (valorCentavos != null) corpo.value = deCentavos(valorCentavos);
      await http.chamar(`/payments/${encodeURIComponent(idExterno)}/refund`, { metodo: 'POST', corpo });
    },

    async emitirCarne(clienteExterno, _cliente, p): Promise<CarneNoProvedor> {
      const corpo = {
        installmentCount: p.parcelas,
        customer: clienteExterno,
        value: deCentavos(p.valor_parcela_centavos),
        billingType: 'BOLETO',
        dueDate: p.primeiro_vencimento,
        description: p.descricao.slice(0, 500),
        paymentExternalReference: p.referencia,
        ...encargosAsaas(p.encargos),
      };
      const r = await http.chamar('/installments', { metodo: 'POST', corpo });
      const id = texto(r, 'id');
      if (!id) throw new ErroProvedor('servidor', 'O Asaas não devolveu o carnê criado.');
      const parcelas = (await lista(`/payments?installment=${encodeURIComponent(id)}&limit=100`))
        .map(cobrancaAsaas)
        .sort((a, b) => a.numero_parcela - b.numero_parcela);
      return { id_externo: id, parcelas };
    },

    async consultarCarnePorReferencia(referencia) {
      const achadas = (await lista(`/payments?externalReference=${encodeURIComponent(referencia)}&limit=100`))
        .map(cobrancaAsaas)
        .filter(c => c.referencia === referencia && c.id_carne);
      if (!achadas.length) return null;
      const id = achadas[0].id_carne;
      return { id_externo: id, parcelas: achadas.filter(c => c.id_carne === id).sort((a, b) => a.numero_parcela - b.numero_parcela) };
    },

    async pdfDoCarne(idCarne) {
      return http.chamarBinario(`/installments/${encodeURIComponent(idCarne)}/paymentBook`);
    },

    async criarLink(p) {
      const corpo = {
        name: p.nome.slice(0, 100),
        description: p.descricao.slice(0, 500),
        value: deCentavos(p.valor_centavos),
        billingType: 'UNDEFINED',
        chargeType: 'DETACHED',
        endDate: p.vence_em,
        dueDateLimitDays: 3,
        externalReference: p.referencia,
        notificationEnabled: o.notificacoesDoProvedor === true,
      };
      const r = await http.chamar('/paymentLinks', { metodo: 'POST', corpo });
      const id = texto(r, 'id');
      if (!id) throw new ErroProvedor('servidor', 'O Asaas não devolveu o link criado.');
      return { id_externo: id, url: texto(r, 'url') };
    },

    // Negativação (Serasa) pela API (doc oficial lida em 06/11/2026,
    // docs.asaas.com/reference/criar-uma-negativacao). Protesto não existe na API.
    async simularNegativacao(cobrancaExterna) {
      const r = await http.chamar(`/paymentDunnings/simulate?payment=${encodeURIComponent(cobrancaExterna)}`, { metodo: 'POST' });
      const sims = (((r as Record<string, unknown>).typeSimulations as unknown[]) ?? []);
      const serasa = sims.find(x => texto(x, 'type') === 'CREDIT_BUREAU') ?? sims[0];
      if (!serasa) return { permitida: false, motivo: 'O Asaas não ofereceu negativação para esta cobrança.', taxa_centavos: 0, liquido_centavos: 0, inicio_previsto: '' };
      const s = serasa as Record<string, unknown>;
      return {
        permitida: s.isAllowed === true,
        motivo: texto(s, 'notAllowedReason'),
        taxa_centavos: paraCentavos(Number(s.feeValue ?? 0)),
        liquido_centavos: paraCentavos(Number(s.netValue ?? 0)),
        inicio_previsto: data(s, 'startDate'),
      };
    },

    async negativar(p) {
      const d = p.devedor;
      const r = await http.chamar('/paymentDunnings', {
        metodo: 'POST',
        formulario: {
          payment: p.cobranca_externa, type: 'CREDIT_BUREAU', description: p.descricao.slice(0, 500),
          customerName: d.nome, customerCpfCnpj: digitos(d.documento), customerPrimaryPhone: digitos(d.telefone),
          customerPostalCode: digitos(d.cep), customerAddress: d.logradouro, customerAddressNumber: d.numero,
          customerComplement: d.complemento, customerProvince: d.bairro,
        },
      });
      const n = negativacaoAsaas(r);
      if (!n.id_externo) throw new ErroProvedor('servidor', 'O Asaas não devolveu a negativação criada.');
      return n;
    },

    async negativacaoDaCobranca(cobrancaExterna) {
      const r = await http.chamar(`/paymentDunnings?payment=${encodeURIComponent(cobrancaExterna)}&limit=10`);
      const lista = ((r as Record<string, unknown>).data as unknown[] ?? []).map(negativacaoAsaas);
      return lista.find(n => n.status !== 'CANCELLED' && n.status !== 'DENIED') ?? null;
    },

    async consultarNegativacao(id) {
      return negativacaoAsaas(await http.chamar(`/paymentDunnings/${encodeURIComponent(id)}`));
    },

    async cancelarNegativacao(id) {
      return negativacaoAsaas(await http.chamar(`/paymentDunnings/${encodeURIComponent(id)}/cancel`, { metodo: 'POST' }));
    },
  };
  return adapter;
}
