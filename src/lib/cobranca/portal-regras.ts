/**
 * Portal do cliente (/c/[token]) — regras puras (05/11/2026).
 *
 * O portal é PÚBLICO: quem tem o link vê as contas daquele cliente naquela
 * agência, e nada mais. Estas regras decidem o recorte que sai do servidor:
 *   · só o que o cliente precisa para pagar e guardar comprovante;
 *   · documento (CPF/CNPJ) sempre mascarado, nome só o primeiro;
 *   · nenhum id interno de cliente, agência, usuário, provedor ou conta
 *     bancária; nenhuma margem, custo, categoria, observação ou comissão;
 *   · o token tem formato fixo; formato errado nem chega ao banco.
 *
 * Testado em scripts/test-cobranca-telas.ts; o recorte com banco real, em
 * scripts/test-sql-portal-cobranca.mjs.
 */
import type { StatusDaCobranca, TipoDeCobranca } from './contrato-telas';
import { calcularEncargos } from '../baixa-calculo';
import { addDias } from '../money';
import { CALENDARIO_NACIONAL, ehFimDeSemana } from '../feriados';

/** 32 bytes em base64url = 43 caracteres. Aceita 32 a 64 para não amarrar o gerador. */
const FORMATO_DO_TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

export function tokenComFormatoValido(t: unknown): t is string {
  return typeof t === 'string' && FORMATO_DO_TOKEN.test(t);
}

/**
 * Limites do portal por janela (em memória, src/lib/limite-publico.ts):
 *   · leituras por IP: uma família abrindo o link várias vezes passa folgada;
 *   · tentativas de token ERRADO por IP: quem chuta tokens para logo;
 *   · leituras por link: um link vazado não vira robô.
 */
export const LIMITES_DO_PORTAL = {
  leiturasPorIp: { maximo: 60, janelaMs: 10 * 60_000 },
  falhasPorIp: { maximo: 10, janelaMs: 60 * 60_000 },
  leiturasPorLink: { maximo: 300, janelaMs: 24 * 3600_000 },
} as const;

/** "Ana Maria Souza" → "Ana". */
export function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome ?? '').trim().split(/\s+/)[0] ?? '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

/**
 * CPF: ***.456.789-** (só os 6 do meio, o padrão de publicação de dados
 * pessoais). CNPJ: **.345.678/0001-** (a raiz do meio e a filial; o CNPJ é
 * público, mas o portal mostra o mesmo tanto). Outro formato: nada.
 */
export function documentoMascarado(doc: string | null | undefined): string {
  const d = String(doc ?? '').replace(/\D/g, '');
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return '';
}

export type SituacaoNoPortal = 'em_aberto' | 'em_atraso' | 'pago';

export interface CobrancaNoPortal {
  tipo: TipoDeCobranca;
  status: StatusDaCobranca;
  valor: number;
  vencimento: string;
  linha_digitavel: string | null;
  pix_copia_cola: string | null;
  url_boleto: string | null;
  url_fatura: string | null;
  /**
   * 2ª via que o próprio cliente pode gerar (E7): só quando o boleto venceu e
   * o provedor não deu o link que já cobra o valor atualizado. Null = não há.
   */
  segunda_via: SegundaViaNoPortal | null;
}

/** O que a 2ª via pelo portal vai ser, já calculado (o cliente vê antes de pedir). */
export interface SegundaViaNoPortal {
  vencimento: string;
  valor: number;
  juros: number;
  multa: number;
}

/** Nota fiscal do cliente no portal (E7): só autorizada, só dele. */
export interface NotaNoPortal {
  /** Referência da nota para baixar o arquivo (só vale com o mesmo token). */
  ref: string;
  numero: string;
  emitida_em: string | null;
  valor: number;
  /** O emissor guardou o PDF/XML (nota emitida fora do sistema pode não ter). */
  tem_pdf: boolean;
  tem_xml: boolean;
}

export interface ItemDoPortal {
  /** Referência da conta para abrir o recibo (só vale com o mesmo token). */
  ref: string;
  descricao: string;
  /** "2/6" ou vazio. */
  parcela: string;
  valor: number;
  /** Quanto falta pagar (0 quando paga). */
  saldo: number;
  vencimento: string;
  situacao: SituacaoNoPortal;
  pago_em: string | null;
  cobranca: CobrancaNoPortal | null;
  tem_recibo: boolean;
}

export interface PortalPublico {
  agencia: { nome: string; logo: string; telefone: string; email: string; whatsapp: string };
  cliente: { primeiro_nome: string; documento: string };
  em_aberto: ItemDoPortal[];
  pagas: ItemDoPortal[];
  /** Notas fiscais autorizadas do cliente (E7). */
  notas: NotaNoPortal[];
  /** Soma do que falta pagar. */
  total_em_aberto: number;
  hoje: string;
}

/** Linha de contas_receber como o servidor lê (data JSON + colunas). */
export interface ContaParaPortal {
  id: string;
  status: string;
  data: Record<string, unknown>;
}

export interface CobrancaParaPortal {
  titulo_id: string;
  tipo: string;
  status: string;
  valor_centavos: number | string;
  vencimento: string;
  linha_digitavel: string | null;
  pix_copia_cola: string | null;
  url_boleto: string | null;
  url_fatura: string | null;
}

/** Nota fiscal como o servidor lê (data JSON + colunas). */
export interface NotaParaPortal {
  id: string;
  status: string;
  data: Record<string, unknown>;
}

/** Juros e multa da política que a 2ª via pelo portal aplica (null = nenhum). */
export interface EncargosDoPortal {
  juros_am_pct: number;
  multa_pct: number;
  tolerancia_dias: number;
}

const TIPOS: readonly string[] = ['boleto', 'pix', 'boleto_pix', 'link', 'carne'];
const VIVAS: readonly string[] = ['emitindo', 'aberta', 'vencida'];
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Só endereço https vai para o navegador do cliente. */
const url = (v: unknown) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);

/** Dia útil (sem sábado, domingo e feriado nacional) a partir de `iso`, inclusive. */
export function diaUtilAPartirDe(iso: string): string {
  let d = iso;
  for (let i = 0; i < 10 && (ehFimDeSemana(d) || CALENDARIO_NACIONAL.ehFeriado(d)); i++) d = addDias(d, 1);
  return d;
}

/**
 * Vencimento da 2ª via pedida pelo cliente: o próximo dia útil depois de hoje
 * (boleto que vence no mesmo dia pode não ser registrado a tempo no banco).
 */
export function vencimentoDaSegundaVia(hoje: string): string {
  return diaUtilAPartirDe(addDias(hoje, 1));
}

/**
 * A 2ª via que o cliente pode gerar sozinho, ou null.
 *
 * Só quando o boleto/Pix venceu e NÃO há o link do provedor que já cobra o
 * valor atualizado (com ele, o portal manda para o link: nada a gerar). Link
 * de pagamento não ganha 2ª via (não tem vencimento de boleto). O valor é o
 * do documento mais os juros e a multa da política da agência até o novo
 * vencimento, pela mesma conta da liquidação (`calcularEncargos`).
 */
export function segundaViaPossivel(
  cob: { tipo: string; status: string; valor_centavos: number | string; vencimento: string; url_fatura: string | null },
  hoje: string,
  encargos: EncargosDoPortal | null,
): SegundaViaNoPortal | null {
  if (!['boleto', 'pix', 'boleto_pix', 'carne'].includes(cob.tipo)) return null;
  const venc = String(cob.vencimento ?? '').slice(0, 10);
  const vencida = cob.status === 'vencida' || (cob.status === 'aberta' && !!venc && venc < hoje);
  if (!vencida) return null;
  if (url(cob.url_fatura)) return null;
  const base = r2(n(cob.valor_centavos) / 100);
  if (base <= 0) return null;
  const vencimento = vencimentoDaSegundaVia(hoje);
  const e = encargos
    ? calcularEncargos({ tabela: 'contas_receber', status: 'PENDENTE', valor_final: base, valor_baixado: 0, data_vencimento: venc }, vencimento, {
      juros_am_pct: encargos.juros_am_pct, multa_pct: encargos.multa_pct, tolerancia_dias: encargos.tolerancia_dias,
    })
    : { juros: 0, multa: 0 };
  return { vencimento, valor: r2(base + e.juros + e.multa), juros: e.juros, multa: e.multa };
}

/**
 * As notas que o cliente vê: autorizadas, emitidas para ele (nunca a do
 * fornecedor ou do representante), da mais nova para a mais velha.
 */
export function notasDoPortal(notas: readonly NotaParaPortal[]): NotaNoPortal[] {
  const lista: NotaNoPortal[] = [];
  for (const nota of notas) {
    const d = nota.data ?? {};
    const status = String(nota.status || d.status || '').toUpperCase();
    if (status !== 'AUTORIZADA') continue;
    const destino = String(d.destino ?? '');
    if (destino === 'FORNECEDOR' || destino === 'REPRESENTANTE') continue;
    lista.push({
      ref: nota.id,
      numero: String(d.numero ?? '').trim(),
      emitida_em: String(d.autorizada_em || d.emitida_em || '').slice(0, 10) || null,
      valor: r2(n(d.valor_servicos) || n(d.valor_recebido)),
      tem_pdf: !!String(d.link_pdf ?? '').trim(),
      tem_xml: !!String(d.link_xml ?? '').trim(),
    });
  }
  return lista.sort((a, b) => String(b.emitida_em ?? '').localeCompare(String(a.emitida_em ?? '')));
}

/**
 * Monta o que o cliente vê. Recebe linhas já filtradas por agência e cliente
 * no SQL; aqui se escolhe CAMPO a campo o que sai (lista de permissão: o que
 * não está escrito aqui não sai).
 */
export function montarPortal(entrada: {
  agencia: Record<string, unknown> | null;
  cliente: { nome: string; documento: string };
  contas: readonly ContaParaPortal[];
  cobrancas: readonly CobrancaParaPortal[];
  hoje: string;
  /** Notas fiscais do cliente (E7); ausente = nenhuma. */
  notas?: readonly NotaParaPortal[];
  /** Juros e multa da política para a 2ª via pelo portal (E7); null = sem encargos. */
  encargos?: EncargosDoPortal | null;
}): PortalPublico {
  const a = entrada.agencia ?? {};
  const redes = (a.redes_sociais ?? {}) as Record<string, unknown>;
  const porConta = new Map<string, CobrancaParaPortal>();
  // A cobrança que vale para a conta: a viva; senão a paga mais recente
  // (as linhas chegam da mais nova para a mais velha).
  for (const c of entrada.cobrancas) {
    const atual = porConta.get(c.titulo_id);
    if (!atual || (!VIVAS.includes(atual.status) && VIVAS.includes(c.status))) porConta.set(c.titulo_id, c);
  }

  const em_aberto: ItemDoPortal[] = [];
  const pagas: ItemDoPortal[] = [];
  for (const conta of entrada.contas) {
    const d = conta.data;
    const status = conta.status;
    if (status === 'CANCELADO') continue;
    const valor = r2(n(d.valor_final));
    const pago = status === 'RECEBIDO';
    const saldo = pago ? 0 : r2(valor - n(d.valor_recebido));
    if (!pago && saldo <= 0) continue;
    const vencimento = String(d.data_vencimento ?? '').slice(0, 10);
    const total = n(d.total_parcelas);
    const cob = porConta.get(conta.id) ?? null;
    const cobranca: CobrancaNoPortal | null = cob && TIPOS.includes(cob.tipo) && (VIVAS.includes(cob.status) || cob.status === 'paga')
      ? {
        tipo: cob.tipo as TipoDeCobranca,
        status: cob.status as StatusDaCobranca,
        valor: r2(n(cob.valor_centavos) / 100),
        vencimento: String(cob.vencimento ?? '').slice(0, 10),
        // Pago: não há mais o que copiar.
        linha_digitavel: pago || cob.status === 'paga' ? null : cob.linha_digitavel || null,
        pix_copia_cola: pago || cob.status === 'paga' ? null : cob.pix_copia_cola || null,
        url_boleto: pago || cob.status === 'paga' ? null : url(cob.url_boleto),
        url_fatura: url(cob.url_fatura),
        segunda_via: pago ? null : segundaViaPossivel(cob, entrada.hoje, entrada.encargos ?? null),
      }
      : null;
    const item: ItemDoPortal = {
      ref: conta.id,
      descricao: String(d.descricao ?? '').trim() || 'Serviços de turismo',
      parcela: total > 1 ? `${n(d.parcela_numero)}/${total}` : '',
      valor,
      saldo,
      vencimento,
      situacao: pago ? 'pago' : vencimento && vencimento < entrada.hoje ? 'em_atraso' : 'em_aberto',
      pago_em: pago ? String(d.data_recebimento ?? '').slice(0, 10) || null : null,
      cobranca,
      tem_recibo: pago,
    };
    (pago ? pagas : em_aberto).push(item);
  }
  em_aberto.sort((x, y) => x.vencimento.localeCompare(y.vencimento));
  pagas.sort((x, y) => String(y.pago_em ?? '').localeCompare(String(x.pago_em ?? '')));

  const telefone = String(a.telefone ?? '').trim();
  const whats = String(redes.whatsapp ?? a.whatsapp ?? '').replace(/\D/g, '') || telefone.replace(/\D/g, '');
  return {
    agencia: {
      nome: String(a.nome_fantasia || a.nome || a.razao_social || 'Sua agência de viagens').trim(),
      logo: url(a.logo) ?? '',
      telefone,
      email: String(a.email ?? '').trim(),
      whatsapp: whats.length >= 10 ? (whats.startsWith('55') ? whats : `55${whats}`) : '',
    },
    cliente: { primeiro_nome: primeiroNome(entrada.cliente.nome), documento: documentoMascarado(entrada.cliente.documento) },
    em_aberto,
    pagas,
    notas: notasDoPortal(entrada.notas ?? []),
    total_em_aberto: r2(em_aberto.reduce((s, i) => s + i.saldo, 0)),
    hoje: entrada.hoje,
  };
}
