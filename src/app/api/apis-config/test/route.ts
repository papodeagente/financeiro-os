import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin } from '@/lib/guarda-rota';
import { lerConfigApis, mesclar, type Consulta } from '@/lib/config-apis';
import { NextResponse } from 'next/server';
import { testConnection as testAmadeus } from '@/lib/amadeus-api';
import { testConnection as testGoogle } from '@/lib/google-places-api';

async function testAnthropic(config: { api_key: string; modelo?: string }) {
  const modelo = config.modelo || 'claude-sonnet-4-5-20250929';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.api_key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Responda apenas: OK' }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const msg = err?.error?.message || `HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  return { ok: true, message: `Modelo ${data.model} respondeu: "${text}"` };
}

async function testOpenAI(config: { api_key: string }) {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${config.api_key}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const msg = err?.error?.message || `HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  const data = await res.json();
  const imageModels = (data.data || [])
    .filter((m: { id: string }) => m.id.includes('dall-e') || m.id.includes('gpt-image'))
    .map((m: { id: string }) => m.id);
  return {
    ok: true,
    message: imageModels.length > 0
      ? `Conectado. Modelos de imagem: ${imageModels.join(', ')}`
      : 'Conectado. Nenhum modelo de imagem encontrado na conta.',
  };
}

export async function POST(req: Request) {
  try {
    // Testar gasta a chave da agência: só administrador.
    const recusa = await recusaAdmin();
    if (recusa) return recusa;
    const body = await req.json();
    const provider = String(body?.provider ?? '');
    // A tela só tem a máscara. Campo mascarado (ou ausente) usa a chave
    // gravada; valor novo digitado é testado como veio, antes de salvar.
    await initDB();
    const gravada = pool ? (await lerConfigApis(pool as unknown as Consulta, await getTenantId()))[provider] ?? {} : {};
    const config = mesclar({ [provider]: body?.config ?? {} }, { [provider]: gravada })[provider] as never;

    if (provider === 'amadeus') {
      const result = await testAmadeus(config);
      return NextResponse.json(result);
    }
    if (provider === 'google_places') {
      const result = await testGoogle(config);
      return NextResponse.json(result);
    }
    if (provider === 'anthropic') {
      const result = await testAnthropic(config);
      return NextResponse.json(result);
    }
    if (provider === 'openai') {
      const result = await testOpenAI(config);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Provider desconhecido' }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
