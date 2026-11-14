/**
 * "Enviar por e-mail" com o documento da fatura (E7, 06/11/2026).
 *
 * A pessoa escolhe o que vai no e-mail: Boleto (o e-mail de sempre), Fatura
 * (o documento da fatura, para o cliente ler e salvar em PDF) ou Boleto e
 * Fatura. O documento vai como LINK do portal do cliente
 * (`/c/<token>/fatura/<id>`, src/lib/cobranca/portal-fatura.ts): é o mesmo
 * documento que a agência imprime, sempre atualizado, sem anexo pesado.
 *
 * Duas portas:
 *   · `enviarCobranca` (servidor.ts) chama `documentoDaFaturaParaEnvio`
 *     quando a escolha leva a fatura;
 *   · `enviarFatura` (ficha da fatura): com boleto em aberto, é o envio da
 *     cobrança com a escolha; sem boleto, só a fatura pode ir, num pedido
 *     `COBRANCA_ENVIAR` com `cobranca_id` "fatura:<id>" (o CRM manda o mesmo
 *     e-mail, no modo fatura).
 *
 * "Nada sai" e o CRM ligado valem como no envio da cobrança.
 */
import pool from '../db';
import type { ExecutorSQL } from '../caixa-atomico';
import { emTransacao } from '../caixa-atomico';
import { generateId } from '../utils';
import { nadaSai } from '../nada-sai';
import { mudancaSegurandoSaidas } from '../migracao/estado';
import { ErroCobranca } from './tipos';
import { urlDoPortalParaCrm } from './portal';
import { avisarCrm, crmLigado } from './crm';
import { camposDoEnvio, lerEnvioPersonalizado, type DocumentosDoEnvio } from './envio';
import { resultadoDoEnvio } from './resultado-envio';
import type { QuemFez } from './servidor';

export type DocumentoParaEnvio =
  | { ok: true; fatura_id: string; numero: number; url: string }
  | { ok: false; motivo: string };

async function temFaturas(exec: ExecutorSQL): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass('public.faturas') IS NOT NULL AS ok`);
  return rows[0]?.ok === true;
}

/** O documento da fatura cuja conta a receber é `contaId`, com o link do portal do cliente. */
export async function documentoDaFaturaParaEnvio(exec: ExecutorSQL, tenantId: string, contaId: string): Promise<DocumentoParaEnvio> {
  const semFatura = { ok: false as const, motivo: 'Esta cobrança não é de uma fatura. Escolha "Boleto".' };
  if (!contaId || !(await temFaturas(exec))) return semFatura;
  const { rows } = await exec.query(
    `SELECT id, numero, pessoa_id, situacao FROM faturas WHERE tenant_id = $1 AND titulo_id = $2 ORDER BY criado_em DESC LIMIT 1`,
    [tenantId, contaId],
  );
  const f = rows[0];
  if (!f) return semFatura;
  if (String(f.situacao) !== 'FECHADA') return { ok: false, motivo: 'A fatura ainda está aberta. Feche a fatura para enviar o documento.' };
  return linkDaFatura(exec, tenantId, String(f.id), Number(f.numero), String(f.pessoa_id ?? ''));
}

async function linkDaFatura(exec: ExecutorSQL, tenantId: string, faturaId: string, numero: number, clienteId: string): Promise<DocumentoParaEnvio> {
  const portal = await urlDoPortalParaCrm(exec, tenantId, clienteId).catch(() => '');
  if (!portal) {
    return { ok: false, motivo: 'Não foi possível montar o link da fatura para o cliente. Gere o link do portal na ficha do cliente e tente de novo.' };
  }
  return { ok: true, fatura_id: faturaId, numero, url: `${portal}/fatura/${encodeURIComponent(faturaId)}` };
}

export interface ResultadoDoEnvioDaFatura {
  enviado: boolean;
  repetido?: boolean;
  na_fila?: boolean;
  motivo?: string;
  /** Saiu junto com o boleto (pelo envio da cobrança) ou só a fatura. */
  com_boleto: boolean;
}

/**
 * "Enviar por e-mail" da ficha da fatura. `corpo` traz `documentos`,
 * `copia_para`, `assunto` e `mensagem` como no envio da cobrança.
 */
export async function enviarFatura(
  tenantId: string, faturaId: string, corpo: Record<string, unknown> | null,
  o: { quem?: QuemFez; idempotencia?: string } = {},
): Promise<ResultadoDoEnvioDaFatura> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const exec = pool as unknown as ExecutorSQL;
  const pedido = lerEnvioPersonalizado('email', corpo);
  const documentos: DocumentosDoEnvio = pedido.documentos ?? 'boleto';
  if (!(await temFaturas(exec))) throw new ErroCobranca('Fatura não encontrada.', 404);
  const { rows } = await exec.query(
    `SELECT id, numero, pessoa_id, pessoa_nome, situacao, titulo_id, vencimento::text AS vencimento, total_centavos
       FROM faturas WHERE tenant_id = $1 AND id = $2`,
    [tenantId, faturaId],
  );
  const f = rows[0];
  if (!f) throw new ErroCobranca('Fatura não encontrada.', 404);
  if (String(f.situacao) !== 'FECHADA') throw new ErroCobranca('Feche a fatura antes de enviar ao cliente.', 409);

  // Com boleto em aberto: é o envio da cobrança, com a escolha.
  const { rows: cob } = f.titulo_id
    ? await exec.query(
      `SELECT id FROM cobrancas WHERE tenant_id = $1 AND titulo_tabela = 'contas_receber' AND titulo_id = $2 AND status IN ('aberta','vencida')
        ORDER BY criado_em DESC LIMIT 1`,
      [tenantId, String(f.titulo_id)],
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }))
    : { rows: [] as Array<Record<string, unknown>> };
  if (cob.length) {
    const { enviarCobranca } = await import('./servidor');
    const r = await enviarCobranca(tenantId, String(cob[0].id), 'email', { quem: o.quem, idempotencia: o.idempotencia, personalizado: { ...(corpo ?? {}), documentos } });
    return { enviado: r.enviado, com_boleto: documentos !== 'fatura', ...(r.repetido ? { repetido: true } : {}), ...(r.na_fila ? { na_fila: true } : {}), ...(r.motivo ? { motivo: r.motivo } : {}) };
  }
  if (documentos !== 'fatura') {
    throw new ErroCobranca('Esta fatura não tem boleto em aberto. Envie só a fatura, ou gere o boleto em "Fechar e cobrar".', 409);
  }

  // Só a fatura: o mesmo pedido de envio ao CRM, no modo fatura.
  if (o.idempotencia) {
    const { rows: ja } = await exec.query(
      `SELECT 1 FROM fatura_eventos WHERE tenant_id = $1 AND fatura_id = $2 AND tipo = 'enviada_por_email' AND detalhe->>'idempotencia' = $3 LIMIT 1`,
      [tenantId, faturaId, o.idempotencia.slice(0, 200)],
    );
    if (ja.length) return { enviado: true, repetido: true, com_boleto: false };
  }
  const motivo = nadaSai() ?? (await mudancaSegurandoSaidas(exec, tenantId));
  if (motivo) throw new ErroCobranca(`Nada é enviado agora (${motivo}).`, 409, 'NADA_SAI');
  if (!(await crmLigado(exec, tenantId))) {
    throw new ErroCobranca('O envio por e-mail sai pelo CRM. Ligue a integração com o CRM em Configurações.', 409);
  }
  const doc = await linkDaFatura(exec, tenantId, String(f.id), Number(f.numero), String(f.pessoa_id ?? ''));
  if (!doc.ok) throw new ErroCobranca(doc.motivo, 409);
  const extra = camposDoEnvio(pedido);
  const retorno: { resposta?: import('../crm-integration').RespostaDoCrm | null } = {};
  await avisarCrm(exec, tenantId, 'COBRANCA_ENVIAR', {
    id: `fatura:${f.id}`, titulo_id: String(f.titulo_id ?? ''), cliente_id: String(f.pessoa_id ?? '') || null, tipo: 'fatura', provedor: '',
    status: 'aberta', valor_centavos: Number(f.total_centavos ?? 0), vencimento: String(f.vencimento ?? '').slice(0, 10),
    descricao: `Fatura Nº ${f.numero}`, linha_digitavel: '', pix_copia_cola: '', url_boleto: '', url_fatura: '', url_link: '',
  }, `fatura-enviar:${tenantId}:${f.id}:${generateId()}`, { canal: 'email', ...extra, documentos: 'fatura', fatura_documento: { numero: doc.numero, url: doc.url } }, retorno);
  const r = resultadoDoEnvio(retorno.resposta);
  const { registrarEventoDaFatura } = await import('../fatura-servidor');
  await emTransacao(tx => registrarEventoDaFatura(tx, tenantId, String(f.id), 'enviada_por_email', {
    usuario: { id: o.quem?.usuarioId ?? '', nome: o.quem?.usuarioNome ?? '' },
    detalhe: {
      documentos: 'fatura', enviado: r.enviado, ...(extra.copia_para ? { copia_para: extra.copia_para } : {}),
      ...(r.motivo ? { motivo: r.motivo } : {}), ...(o.idempotencia ? { idempotencia: o.idempotencia.slice(0, 200) } : {}),
    },
  }));
  return { enviado: r.enviado, com_boleto: false, ...(r.na_fila ? { na_fila: true } : {}), ...(r.motivo ? { motivo: r.motivo } : {}) };
}
