import { recusaAdmin } from '@/lib/guarda-rota';
import { abrirCrmConfig, selarCrmConfig } from '@/lib/crm-config-cofre';
import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { randomBytes } from 'crypto';
import { perfilDaConta } from '@/lib/perfil-da-conta';
import { CRM_DO_ECOSSISTEMA, motivoDaRecusa, urlDoCrmDoEcossistema } from '@/lib/crm-do-ecossistema';
import type { ExecutorSQL } from '@/lib/caixa-atomico';

/** Na conta do ecossistema, a tela mostra com qual conta do CRM ela pode se integrar. */
async function regraDoEcossistema(tenantId: string, url: unknown) {
  if ((await perfilDaConta(tenantId, pool as unknown as ExecutorSQL)) !== 'ecossistema') return null;
  return { conta: CRM_DO_ECOSSISTEMA, url: urlDoCrmDoEcossistema(), recusada: motivoDaRecusa('ecossistema', url) };
}

function suggestedWebhookUrl(req: NextRequest, tenantId: string): string {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('host') || 'localhost';
  return `${proto}://${host}/api/v1/crm/webhook/${tenantId}`;
}

export async function GET(req: NextRequest) {
  try {
    if (!pool) return NextResponse.json(null);
    await initDB();
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      "SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
      [tenantId],
    );
    const suggested = suggestedWebhookUrl(req, tenantId);

    if (rows.length === 0) {
      return NextResponse.json({
        ativo: false,
        webhook_url_entur: suggested,
        webhook_url_crm: '',
        api_key_entur: '',
        api_key_crm: '',
        retry_max: 5,
        circuit_breaker_threshold: 10,
        circuit_breaker_status: 'fechado',
        tenant_id: tenantId,
        suggested_webhook_url_entur: suggested,
        regra_do_ecossistema: await regraDoEcossistema(tenantId, ''),
      });
    }

    const config = abrirCrmConfig(rows[0].data);
    // Envelopes do cofre não saem para a tela.
    const { api_key_crm_cofre: _c, api_key_entur_cofre: _e, ...semEnvelopes } = config;
    return NextResponse.json({
      ...semEnvelopes,
      // Mask the secret on the wire — UI can request the raw value via ?reveal=1
      api_key_crm: config.api_key_crm
        ? '****' + String(config.api_key_crm).slice(-4)
        : '',
      api_key_entur: config.api_key_entur
        ? '****' + String(config.api_key_entur).slice(-4)
        : '',
      tenant_id: tenantId,
      suggested_webhook_url_entur: suggested,
      regra_do_ecossistema: await regraDoEcossistema(tenantId, config.webhook_url_crm),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const recusa = await recusaAdmin();
    if (recusa) return recusa;
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();
    const body = await req.json();
    // O financeiro da Entur só se integra com a conta da Entur no CRM.
    const recusaDoEcossistema = motivoDaRecusa(await perfilDaConta(tenantId, pool as unknown as ExecutorSQL), body?.webhook_url_crm);
    if (recusaDoEcossistema) return NextResponse.json({ error: recusaDoEcossistema }, { status: 400 });
    // O que a tela recebe para mostrar não é gravado.
    delete body.regra_do_ecossistema;

    // Load existing config (if any) so we can preserve masked values.
    const { rows: existing } = await pool.query(
      "SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
      [tenantId],
    );
    const gravado = existing[0]?.data ?? {};
    const prev = abrirCrmConfig(gravado);

    // Preserve secrets when UI sends back the masked placeholder.
    if (typeof body.api_key_crm === 'string' && body.api_key_crm.startsWith('****')) {
      body.api_key_crm = prev.api_key_crm ?? '';
    }
    if (typeof body.api_key_entur === 'string' && body.api_key_entur.startsWith('****')) {
      body.api_key_entur = prev.api_key_entur ?? '';
    }

    // Segredo gravado que não decifra (INTEGRACOES_MASTER_KEY trocada): NÃO
    // gerar outro em silêncio — a integração com o CRM pararia sem ninguém
    // saber por quê. Só segue se a tela mandou um segredo novo de verdade.
    const temEnvelope = !!(gravado.api_key_crm_cofre || gravado.api_key_entur_cofre);
    const ilegivel = temEnvelope && !prev.api_key_crm && !prev.api_key_entur;
    const gerarNovo = body.gerar_novo_segredo === true;
    delete body.gerar_novo_segredo;
    if (ilegivel && !body.api_key_crm && !body.api_key_entur && !gerarNovo) {
      return NextResponse.json({
        error: 'Não foi possível ler o segredo atual da integração (a chave do cofre do servidor mudou). '
          + 'Informe o segredo que está configurado no CRM, ou gere um novo (gerar_novo_segredo) e atualize o CRM também.',
      }, { status: 409 });
    }

    // The CRM uses a single hmacSecret for both directions; keep the two
    // local fields in sync. If only one was provided, mirror it. If neither
    // was provided and nothing exists yet, generate a fresh secret.
    if (!body.api_key_crm && body.api_key_entur) {
      body.api_key_crm = body.api_key_entur;
    } else if (body.api_key_crm && !body.api_key_entur) {
      body.api_key_entur = body.api_key_crm;
    } else if (!body.api_key_crm && !body.api_key_entur) {
      const fresh = prev.api_key_crm || randomBytes(32).toString('hex');
      body.api_key_crm = fresh;
      body.api_key_entur = fresh;
    }

    // Default the inbound webhook URL to the canonical multi-tenant path
    // when the UI didn't supply one (or sent a stale value).
    if (!body.webhook_url_entur) {
      body.webhook_url_entur = suggestedWebhookUrl(req, tenantId);
    }

    // Segredo cifrado ao gravar (FIN-11). Envelopes que vieram no corpo não
    // valem: só o servidor escreve envelope.
    delete body.api_key_crm_cofre;
    delete body.api_key_entur_cofre;
    const selado = selarCrmConfig(body, gravado);

    // Multi-tenant upsert (PK is composite (id, tenant_id)).
    const upsert = await pool.query(
      `UPDATE crm_config SET data = $2, updated_at = NOW()
       WHERE id = 'singleton' AND tenant_id = $1`,
      [tenantId, JSON.stringify(selado)],
    );
    if (upsert.rowCount === 0) {
      await pool.query(
        `INSERT INTO crm_config (id, tenant_id, data, updated_at)
         VALUES ('singleton', $1, $2, NOW())`,
        [tenantId, JSON.stringify(selado)],
      );
    }
    return NextResponse.json({ ok: true, tenant_id: tenantId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
