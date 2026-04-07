import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { generateId } from '@/lib/utils';

const UPLOAD_DIR_PROD = '/app/data/uploads';

async function getUploadDir(): Promise<string> {
  if (process.env.NODE_ENV !== 'production') {
    const dir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(dir, { recursive: true });
    return dir;
  }
  await mkdir(UPLOAD_DIR_PROD, { recursive: true });
  return UPLOAD_DIR_PROD;
}

async function getOpenAIConfig(tenantId: string) {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT data FROM config_apis WHERE id = 'apis-config-singleton' AND tenant_id = $1`,
    [tenantId],
  );
  if (rows.length === 0) return null;
  const cfg = rows[0].data;
  if (!cfg.openai?.ativo || !cfg.openai?.api_key) return null;
  return {
    api_key: cfg.openai.api_key as string,
    modelo: (cfg.openai.modelo_imagem as string) || 'gpt-image-1',
  };
}

interface GenerateBody {
  prompt: string;
  /** quantidade de imagens, 1..4 */
  n?: number;
  /** "1024x1024" | "1024x1536" (vertical) | "1536x1024" (horizontal) */
  size?: string;
  /** estilo opcional anexado ao prompt */
  estilo?: string;
}

/**
 * POST /api/ai/imagem
 *
 * Gera imagens via OpenAI (gpt-image-1 / dall-e-3), salva cada uma no
 * volume persistente de uploads e devolve URLs locais estáveis.
 *
 * Body: { prompt, n?, size?, estilo? }
 * Response: { urls: string[] }
 */
export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const config = await getOpenAIConfig(tenantId);
    if (!config) {
      return NextResponse.json(
        { error: 'OpenAI não configurado. Vá em Configurações → Integrações.' },
        { status: 400 },
      );
    }

    const body = (await req.json()) as GenerateBody;
    const prompt = (body.prompt || '').trim();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt é obrigatório.' }, { status: 400 });
    }

    const n = Math.min(Math.max(body.n ?? 1, 1), 4);
    const size = body.size && /^\d+x\d+$/.test(body.size) ? body.size : '1024x1024';
    const fullPrompt = body.estilo
      ? `${prompt}. Estilo: ${body.estilo}.`
      : prompt;

    const isDallE3 = config.modelo === 'dall-e-3';
    // dall-e-3 só suporta n=1 por chamada — fazemos chamadas paralelas se necessário.
    const calls = isDallE3
      ? Array.from({ length: n }, () => 1)
      : [n];

    const results = await Promise.all(
      calls.map(async (count) => {
        const payload: Record<string, unknown> = {
          model: config.modelo,
          prompt: fullPrompt,
          n: count,
          size,
        };
        if (isDallE3) {
          payload.response_format = 'b64_json';
          payload.quality = 'standard';
        }

        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.api_key}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
        }
        return (await res.json()) as { data: Array<{ b64_json?: string; url?: string }> };
      }),
    );

    const dir = await getUploadDir();
    const urls: string[] = [];

    for (const result of results) {
      for (const item of result.data || []) {
        let buf: Buffer | null = null;
        if (item.b64_json) {
          buf = Buffer.from(item.b64_json, 'base64');
        } else if (item.url) {
          const r = await fetch(item.url);
          if (r.ok) buf = Buffer.from(await r.arrayBuffer());
        }
        if (!buf || buf.length === 0) continue;
        const fileName = `${generateId()}.png`;
        await writeFile(path.join(dir, fileName), buf);
        urls.push(`/api/uploads/${fileName}`);
      }
    }

    if (urls.length === 0) {
      return NextResponse.json({ error: 'Nenhuma imagem foi gerada.' }, { status: 500 });
    }

    return NextResponse.json({ urls });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao gerar imagem' },
      { status: 500 },
    );
  }
}
