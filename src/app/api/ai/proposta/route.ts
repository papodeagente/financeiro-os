import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getPromptForBlock, getPromptForFullProposal } from '@/lib/ai-prompts';
import type { AIPropostaContext } from '@/lib/ai-prompts';
import { getTenantId } from '@/lib/tenant';

// Modelo fallback. Atualizado para Sonnet 4.5 (mais recente e estavel
// em 2026). O modelo antigo claude-sonnet-4-20250514 pode retornar 404
// em propostas geradas hoje. Cada tenant pode sobrescrever em
// Configuracoes > Integracoes > Anthropic > Modelo.
const MODELO_FALLBACK = 'claude-sonnet-4-5-20250929';

async function getAnthropicConfig(tenantId: string) {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT data FROM config_apis WHERE id = 'apis-config-singleton' AND tenant_id = $1`, [tenantId]);
  if (rows.length === 0) return null;
  const cfg = rows[0].data;
  if (!cfg.anthropic?.ativo || !cfg.anthropic?.api_key) return null;
  return { api_key: cfg.anthropic.api_key, modelo: cfg.anthropic.modelo || MODELO_FALLBACK };
}

async function callClaude(apiKey: string, modelo: string, prompt: string): Promise<string> {
  // Tenta com modelo configurado; se 404 (model not found), retry com
  // fallback. Isso protege contra modelos antigos depreciados na conta.
  const tryCall = async (modelToUse: string) => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelToUse,
        // 8192 pra suportar proposta completa com varios blocos. JSON
        // antes era truncado em 4096 quebrando o parse.
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    return response;
  };

  let response = await tryCall(modelo);
  // Se modelo nao encontrado (deprecated/typo), tenta o fallback.
  if (response.status === 404 && modelo !== MODELO_FALLBACK) {
    response = await tryCall(MODELO_FALLBACK);
  }

  if (!response.ok) {
    const err = await response.text();
    console.error('[AI/proposta] Anthropic error:', response.status, err);
    throw new Error(`Anthropic API ${response.status}: ${err}`);
  }

  const result = await response.json();
  // stop_reason possible: 'end_turn' | 'max_tokens' | 'stop_sequence' |
  // 'tool_use' | 'pause_turn' | 'refusal'. Se 'max_tokens', alerta no log.
  if (result.stop_reason === 'max_tokens') {
    console.warn('[AI/proposta] stop_reason=max_tokens — JSON pode estar truncado');
  }
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
      // Try to extract JSON from the response — pode vir cercado de
      // markdown ```json ... ``` ou texto preambulo. Regex pega o
      // bloco entre primeira { e ultima }.
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e) {
          console.error('[AI/proposta] JSON parse falhou:', e, 'text length:', text.length);
          return NextResponse.json({
            error: 'IA retornou JSON inválido (provavelmente truncado). Tente novamente.',
            raw_preview: text.slice(0, 500),
          }, { status: 500 });
        }
      } else {
        return NextResponse.json({
          error: 'Resposta da IA não contém JSON. Verifique modelo configurado.',
          raw_preview: text.slice(0, 500),
        }, { status: 500 });
      }
    }

    return NextResponse.json(parsed);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[AI/proposta] Erro:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
