import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getPromptForBlock, getPromptForFullProposal } from '@/lib/ai-prompts';
import type { AIPropostaContext } from '@/lib/ai-prompts';
import { getTenantId } from '@/lib/tenant';

async function getAnthropicConfig(tenantId: string) {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT data FROM config_apis WHERE id = 'apis-config-singleton' AND tenant_id = $1`, [tenantId]);
  if (rows.length === 0) return null;
  const cfg = rows[0].data;
  if (!cfg.anthropic?.ativo || !cfg.anthropic?.api_key) return null;
  return { api_key: cfg.anthropic.api_key, modelo: cfg.anthropic.modelo || 'claude-sonnet-4-20250514' };
}

async function callClaude(apiKey: string, modelo: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.content?.[0]?.text || '';
}

export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const config = await getAnthropicConfig(tenantId);
    if (!config) {
      return NextResponse.json(
        { error: 'API Anthropic nao configurada. Va em Configuracoes > Integracoes.' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { tipo_bloco, contexto, modo } = body as {
      tipo_bloco?: string;
      contexto: AIPropostaContext;
      modo?: 'bloco' | 'completo';
    };

    // Enrich context with destination data if available
    if (contexto.destino && pool) {
      try {
        const { rows } = await pool.query(
          `SELECT data FROM destinos WHERE LOWER(data->>'nome') = LOWER($1) AND tenant_id = $2 LIMIT 1`,
          [contexto.destino, tenantId]
        );
        if (rows.length > 0) {
          const dest = rows[0].data;
          if (dest.descricao) contexto.destino_descricao = dest.descricao;
          if (dest.dicas) contexto.destino_dicas = dest.dicas;
          if (dest.gastronomia) contexto.destino_gastronomia = dest.gastronomia;
        }
      } catch { /* ignore */ }
    }

    let prompt: string;
    if (modo === 'completo') {
      prompt = getPromptForFullProposal(contexto);
    } else {
      if (!tipo_bloco) {
        return NextResponse.json({ error: 'tipo_bloco e obrigatorio' }, { status: 400 });
      }
      prompt = getPromptForBlock(tipo_bloco, contexto);
    }

    const text = await callClaude(config.api_key, config.modelo, prompt);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON from the response
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return NextResponse.json({ error: 'Erro ao processar resposta da IA', raw: text }, { status: 500 });
      }
    }

    return NextResponse.json(parsed);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro desconhecido' },
      { status: 500 }
    );
  }
}
