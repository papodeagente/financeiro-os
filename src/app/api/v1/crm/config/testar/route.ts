import { recusaAdmin } from '@/lib/guarda-rota';
import { abrirCrmConfig } from '@/lib/crm-config-cofre';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { createHmac } from 'crypto';
import { getTenantId } from '@/lib/tenant';
import { perfilDaConta } from '@/lib/perfil-da-conta';
import { motivoDaRecusa } from '@/lib/crm-do-ecossistema';
import type { ExecutorSQL } from '@/lib/caixa-atomico';

export async function POST() {
  try {
    const recusa = await recusaAdmin();
    if (recusa) return recusa;
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();

    const tenantId = await getTenantId();
    const { rows } = await pool.query("SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1", [tenantId]);
    if (rows.length === 0) {
      return NextResponse.json({ sucesso: false, erro: 'Configuracao CRM nao encontrada' });
    }

    const config = abrirCrmConfig(rows[0].data);
    if (!config.webhook_url_crm) {
      return NextResponse.json({ sucesso: false, erro: 'URL do webhook do CRM nao configurada' });
    }
    const recusaDoEcossistema = motivoDaRecusa(await perfilDaConta(tenantId, pool as unknown as ExecutorSQL), config.webhook_url_crm);
    if (recusaDoEcossistema) return NextResponse.json({ sucesso: false, erro: recusaDoEcossistema });

    const testPayload = {
      id: 'test-' + Date.now(),
      tipo: 'TESTE_CONEXAO',
      timestamp: new Date().toISOString(),
      versao: 'v1',
      origem: 'entur-os',
      payload: { teste: true },
    };

    const bodyStr = JSON.stringify(testPayload);
    const signature = createHmac('sha256', config.api_key_crm || '').update(bodyStr).digest('hex');
    const start = Date.now();

    const res = await fetch(config.webhook_url_crm, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-entur-event': 'TESTE_CONEXAO',
        'x-entur-signature': signature,
        'x-entur-event-id': testPayload.id,
        'x-entur-timestamp': testPayload.timestamp,
      },
      body: bodyStr,
      signal: AbortSignal.timeout(10000),
    });

    const latencia = Date.now() - start;

    return NextResponse.json({
      sucesso: res.ok,
      status_http: res.status,
      latencia_ms: latencia,
      erro: res.ok ? null : `HTTP ${res.status}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ sucesso: false, erro: msg, latencia_ms: null });
  }
}
