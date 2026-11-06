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

const TIPOS: readonly string[] = ['boleto', 'pix', 'boleto_pix', 'link', 'carne'];
const VIVAS: readonly string[] = ['emitindo', 'aberta', 'vencida'];
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Só endereço https vai para o navegador do cliente. */
const url = (v: unknown) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);

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
    total_em_aberto: r2(em_aberto.reduce((s, i) => s + i.saldo, 0)),
    hoje: entrada.hoje,
  };
}
