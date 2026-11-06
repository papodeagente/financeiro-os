/**
 * Avisos da cobrança ao CRM (05/11/2026). É o CRM quem fala com o cliente
 * (e-mail e WhatsApp por modelo aprovado): o financeiro só diz o que
 * aconteceu, com tudo o que a mensagem precisa.
 *
 * `emitirEventoCRM` já respeita "nada sai" e nunca derruba quem chamou.
 */
import type { ExecutorSQL } from '../caixa-atomico';
// crm-integration é carregado na hora do aviso: quem só importa o caminho do
// webhook (e os testes de lógica pura) não arrasta o módulo inteiro do CRM.
import { deCentavos } from '../money';
import { urlDoPortalParaCrm } from './portal';
import type { CanalCobranca } from './config';

export type EventoCobrancaCRM = 'COBRANCA_EMITIDA' | 'COBRANCA_LEMBRETE' | 'COBRANCA_PAGA' | 'COBRANCA_ENVIAR';

export interface CobrancaParaCrm {
  id: string;
  titulo_id: string;
  cliente_id: string | null;
  tipo: string;
  provedor: string;
  status: string;
  valor_centavos: number;
  vencimento: string;
  descricao: string;
  linha_digitavel: string;
  pix_copia_cola: string;
  url_boleto: string;
  url_fatura: string;
  url_link: string;
  pago_centavos?: number | null;
  pago_em?: string | null;
}

export interface PayloadCobrancaCrm {
  cobranca_id: string;
  conta_id: string;
  crm_contact_id: string;
  cliente: { id: string; nome: string; email: string; telefone: string; cpf_cnpj: string };
  valor: number;
  vencimento: string;
  linha_digitavel: string;
  pix_copia_cola: string;
  url_boleto: string;
  url_fatura: string;
  url_portal: string;
  descricao: string;
  tipo: string;
  provedor: string;
  status: string;
  dias?: number;
  canais?: CanalCobranca[];
  canal?: CanalCobranca;
  valor_pago?: number;
  pago_em?: string;
  /** COBRANCA_ENVIAR por e-mail (E7): cópia para outros e-mails e o texto próprio. */
  copia_para?: string[];
  assunto?: string;
  mensagem?: string;
  /** E7: o que o e-mail leva ('fatura' ou 'boleto_e_fatura'); ausente = o boleto, o e-mail de sempre. */
  documentos?: 'fatura' | 'boleto_e_fatura';
  /** E7: o documento da fatura (link do portal para ler e salvar em PDF). */
  fatura_documento?: { numero: number; url: string };
}

export interface ExtraDoAviso {
  dias?: number;
  canal?: CanalCobranca;
  canais?: CanalCobranca[];
  copia_para?: string[];
  assunto?: string;
  mensagem?: string;
  documentos?: 'fatura' | 'boleto_e_fatura';
  fatura_documento?: { numero: number; url: string };
}

/** O id do contato no CRM, a partir do `external_id` do cliente ("crm_contact_<id>"). */
export function idDoContatoNoCrm(externalId: unknown): string {
  const t = String(externalId ?? '').trim();
  const m = t.match(/^crm_contact_(.+)$/);
  return m ? m[1] : '';
}

export function montarPayload(
  c: CobrancaParaCrm,
  cliente: { id: string; nome: string; email: string; telefone: string; cpf_cnpj: string; external_id: string },
  urlPortal: string,
  extra: ExtraDoAviso = {},
): PayloadCobrancaCrm {
  const p: PayloadCobrancaCrm = {
    cobranca_id: c.id,
    conta_id: c.titulo_id,
    crm_contact_id: idDoContatoNoCrm(cliente.external_id),
    cliente: { id: cliente.id, nome: cliente.nome, email: cliente.email, telefone: cliente.telefone, cpf_cnpj: cliente.cpf_cnpj },
    valor: deCentavos(c.valor_centavos),
    vencimento: c.vencimento,
    linha_digitavel: c.linha_digitavel,
    pix_copia_cola: c.pix_copia_cola,
    url_boleto: c.url_boleto || c.url_link,
    url_fatura: c.url_fatura || c.url_link,
    url_portal: urlPortal,
    descricao: c.descricao,
    tipo: c.tipo,
    provedor: c.provedor,
    status: c.status,
  };
  if (extra.dias !== undefined) p.dias = extra.dias;
  if (extra.canal) p.canal = extra.canal;
  if (extra.canais) p.canais = extra.canais;
  if (extra.copia_para?.length) p.copia_para = extra.copia_para;
  if (extra.assunto) p.assunto = extra.assunto;
  if (extra.mensagem) p.mensagem = extra.mensagem;
  if (extra.documentos) p.documentos = extra.documentos;
  if (extra.fatura_documento) p.fatura_documento = extra.fatura_documento;
  if (c.pago_centavos != null) p.valor_pago = deCentavos(c.pago_centavos);
  if (c.pago_em) p.pago_em = c.pago_em;
  return p;
}

/** Cliente da cobrança, como o CRM precisa. */
export async function clienteParaCrm(exec: ExecutorSQL, tenantId: string, clienteId: string | null) {
  const vazio = { id: clienteId ?? '', nome: '', email: '', telefone: '', cpf_cnpj: '', external_id: '' };
  if (!clienteId) return vazio;
  const { rows } = await exec.query(
    `SELECT id, nome, cpf_cnpj, data, COALESCE(external_id, data->>'external_id', '') AS external_id
       FROM clientes WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, clienteId],
  );
  if (!rows.length) return vazio;
  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  return {
    id: String(rows[0].id),
    nome: String(rows[0].nome || d.nome_completo || d.razao_social || ''),
    email: String(d.email ?? ''),
    telefone: String(d.whatsapp || d.telefone_principal || d.telefone || '').replace(/\D/g, ''),
    cpf_cnpj: String(rows[0].cpf_cnpj ?? '').replace(/\D/g, ''),
    external_id: String(rows[0].external_id ?? ''),
  };
}

/**
 * Manda o aviso ao CRM. `chave` faz a mesma coisa não ser mandada duas
 * vezes como eventos diferentes (o CRM recebe o mesmo id).
 */
export async function avisarCrm(
  exec: ExecutorSQL,
  tenantId: string,
  tipo: EventoCobrancaCRM,
  c: CobrancaParaCrm,
  chave: string,
  extra: ExtraDoAviso = {},
  /** Preenchido com o que o CRM respondeu (null = ficou na fila). */
  retorno?: { resposta?: import('../crm-integration').RespostaDoCrm | null },
): Promise<PayloadCobrancaCrm> {
  const cliente = await clienteParaCrm(exec, tenantId, c.cliente_id);
  let portal = '';
  try {
    portal = await urlDoPortalParaCrm(exec, tenantId, c.cliente_id ?? '');
  } catch (e) {
    console.error('[cobranca] portal do cliente:', e instanceof Error ? e.message : e);
  }
  const payload = montarPayload(c, cliente, portal, extra);
  const { emitirEventoCRM } = await import('../crm-integration');
  const resposta = await emitirEventoCRM(tipo, payload as unknown as Record<string, unknown>, { tenantId, idempotency_key: chave });
  if (retorno) retorno.resposta = resposta;
  return payload;
}

/** A agência tem o CRM ligado? (Sem ele, "enviar por e-mail/WhatsApp" não tem por onde sair.) */
export async function crmLigado(exec: ExecutorSQL, tenantId: string): Promise<boolean> {
  try {
    const { rows: t } = await exec.query(`SELECT to_regclass('public.crm_config') IS NOT NULL AS ok`);
    if (!t[0]?.ok) return false;
    const { rows } = await exec.query(
      `SELECT (data->>'ativo') = 'true' AND COALESCE(data->>'webhook_url_crm', '') <> '' AS ok
         FROM crm_config WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}
