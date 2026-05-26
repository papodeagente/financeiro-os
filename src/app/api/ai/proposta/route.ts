import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getPromptForBlock, getPromptForFullProposal } from '@/lib/ai-prompts';
import type { AIPropostaContext } from '@/lib/ai-prompts';
import { getTenantId } from '@/lib/tenant';

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

async function callClaude(apiKey: string, modelo: string, prompt: string, maxTokens: number): Promise<string> {
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
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    return response;
  };

  let response = await tryCall(modelo);
  if (response.status === 404 && modelo !== MODELO_FALLBACK) {
    response = await tryCall(MODELO_FALLBACK);
  }

  if (!response.ok) {
    const err = await response.text();
    console.error('[AI/proposta] Anthropic error:', response.status, err);
    throw new Error(`Anthropic API ${response.status}: ${err}`);
  }

  const result = await response.json();
  if (result.stop_reason === 'max_tokens') {
    console.warn('[AI/proposta] stop_reason=max_tokens — JSON pode estar truncado');
  }
  return result.content?.[0]?.text || '';
}

// ============================================================
// Enriquecimento de imagens — converte image_query/image_queries
// (texto descritivo gerado pela IA) em URLs reais via Pollinations.AI
// (Flux model). Gera imagem AI baseada no prompt, com seed
// determinístico pra estabilizar a foto da proposta entre re-renders.
// CDN Cloudflare + cache imutável = serve rápido.
// `source.unsplash.com` foi descontinuado pelo Unsplash, daí a troca.
// ============================================================
function imageUrl(query: string, width: number, height: number, sigSeed: string): string {
  const q = encodeURIComponent(query.trim());
  const seed = Math.abs(hashString(`${query}|${sigSeed}`)) % 1_000_000;
  return `https://image.pollinations.ai/prompt/${q}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function avatarUrl(nome: string): string {
  // ui-avatars.com gera avatar com iniciais; ZERO config necessária.
  const n = encodeURIComponent((nome || 'Cliente').trim());
  return `https://ui-avatars.com/api/?name=${n}&background=0a84ff&color=fff&size=128&bold=true&format=png`;
}

type Bloco = { tipo: string; conteudo: Record<string, unknown> };

function enrichSecoes(secoes: Bloco[], propostaId: string): Bloco[] {
  return secoes.map((s, idx) => {
    const seed = `${propostaId}-${idx}`;
    const c = s.conteudo as Record<string, unknown>;

    if (s.tipo === 'GALERIA') {
      const queries = (c.image_queries as string[]) || [];
      const imagens = queries.map((q, i) => ({
        url: imageUrl(q, 1600, 900, `${seed}-${i}`),
        legenda: q,
      }));
      return { tipo: s.tipo, conteudo: { titulo: c.titulo || '', imagens } };
    }

    if (s.tipo === 'ALOJAMENTO') {
      const imgQuery = (c.image_query as string) || '';
      const galleryQs = ((c.gallery_queries as string[]) || []).filter(Boolean);
      if (imgQuery) {
        c.hotel_imagem = imageUrl(imgQuery, 1600, 900, `${seed}-cover`);
      }
      if (galleryQs.length > 0) {
        c.hotel_galeria = galleryQs.map((q, i) => imageUrl(q, 1200, 800, `${seed}-g${i}`));
        c.mostrar_galeria = true;
      }
      // Limpa chaves auxiliares pra não vazar pro JSONB
      delete c.image_query;
      delete c.gallery_queries;
      return s;
    }

    if (s.tipo === 'DEPOIMENTO') {
      const deps = (c.depoimentos as Array<{ autor?: string; foto?: string }>) || [];
      const enriched = deps.map(d => ({
        ...d,
        foto: d.foto || avatarUrl(d.autor || 'Cliente'),
      }));
      return { tipo: s.tipo, conteudo: { ...c, depoimentos: enriched } };
    }

    if (s.tipo === 'SERVICO') {
      const imgQuery = (c.image_query as string) || '';
      if (imgQuery && !c.imagem) {
        c.imagem = imageUrl(imgQuery, 1200, 800, `${seed}-serv`);
        delete c.image_query;
      }
      return s;
    }

    return s;
  });
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
    // Proposta completa precisa de muito mais tokens pra caber todos
    // os blocos. 16384 é o cap atual do Claude Sonnet 4.5.
    let maxTokens = 8192;
    if (modo === 'completo') {
      prompt = getPromptForFullProposal(contexto);
      maxTokens = 16384;
    } else {
      if (!tipo_bloco) {
        return NextResponse.json({ error: 'tipo_bloco e obrigatorio' }, { status: 400 });
      }
      prompt = getPromptForBlock(tipo_bloco, contexto);
    }

    const text = await callClaude(config.api_key, config.modelo, prompt, maxTokens);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
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

    // Enriquecimento server-side de imagens (galeria, hotel, depoimentos).
    // A IA gera apenas image_query/queries — aqui convertemos pra URLs.
    if (modo === 'completo' && parsed && Array.isArray(parsed.secoes)) {
      // ID determinístico pra estabilizar sig do Unsplash (mesmo destino
      // gera mesmas fotos em re-renders, mas propostas diferentes têm
      // imagens diferentes).
      const propostaSeed = `${contexto.destino || 'p'}-${Date.now()}`;
      parsed.secoes = enrichSecoes(parsed.secoes as Bloco[], propostaSeed);
    }

    return NextResponse.json(parsed);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[AI/proposta] Erro:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
