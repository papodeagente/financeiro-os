import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

async function getAnthropicConfig() {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT data FROM config_apis WHERE id = 'apis-config-singleton'`);
  if (rows.length === 0) return null;
  const cfg = rows[0].data;
  if (!cfg.anthropic?.ativo || !cfg.anthropic?.api_key) return null;
  return { api_key: cfg.anthropic.api_key, modelo: cfg.anthropic.modelo || 'claude-sonnet-4-20250514' };
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { mensagem, historico } = await req.json();
    if (!mensagem?.trim()) {
      return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 });
    }

    const config = await getAnthropicConfig();
    if (!config) {
      return NextResponse.json({ error: 'IA nao configurada' }, { status: 503 });
    }

    // Load proposal data for context
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB offline' }, { status: 500 });
    const { rows } = await pool.query(
      `SELECT data FROM propostas WHERE id LIKE $1 LIMIT 1`,
      [`${slug}%`]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });
    }

    const proposta = rows[0].data;

    // Build proposal summary for AI context
    const secoesSummary = (proposta.secoes || []).map((s: { tipo: string; conteudo: Record<string, unknown> }) => {
      const c = s.conteudo;
      switch (s.tipo) {
        case 'TEXTO': return `[Texto] ${(c as { titulo?: string }).titulo || ''}: ${((c as { corpo?: string }).corpo || '').slice(0, 200)}`;
        case 'SERVICO': return `[Servico] ${(c as { titulo?: string }).titulo || ''}: ${(c as { descricao?: string }).descricao || ''}${(c as { valor?: number }).valor ? ` — R$ ${(c as { valor?: number }).valor}` : ''}`;
        case 'ROTEIRO_DIA': {
          const dias = (c as { dias?: Array<{ numero: number; titulo: string; descricao?: string }> }).dias || [];
          return `[Roteiro] ${dias.length} dias: ${dias.map(d => `Dia ${d.numero}: ${d.titulo}`).join(', ')}`;
        }
        case 'INCLUSOS': return `[Inclusos] ${((c as { inclusos?: string[] }).inclusos || []).join(', ')}. Nao incluso: ${((c as { nao_inclusos?: string[] }).nao_inclusos || []).join(', ')}`;
        case 'VALORES': {
          const opcoes = (c as { opcoes?: Array<{ titulo: string; valor_total: number }> }).opcoes || [];
          return `[Valores] ${opcoes.map(o => `${o.titulo}: R$ ${o.valor_total}`).join(', ')}`;
        }
        default: return `[${s.tipo}] ${JSON.stringify(c).slice(0, 100)}`;
      }
    }).join('\n');

    const vendedor = proposta.rodape || {};

    const systemPrompt = `Voce e um assistente virtual de viagens que responde perguntas sobre uma proposta de viagem especifica.

PROPOSTA:
- Titulo: ${proposta.cabecalho?.titulo || ''}
- Subtitulo: ${proposta.cabecalho?.subtitulo || ''}
- Mensagem: ${proposta.cabecalho?.mensagem_abertura || ''}
- Validade: ${proposta.cabecalho?.validade || 'nao informada'}

CONTEUDO:
${secoesSummary}

VENDEDOR: ${vendedor.nome_vendedor || ''} | WhatsApp: ${vendedor.whatsapp_vendedor || ''} | Email: ${vendedor.email_vendedor || ''}

REGRAS:
- Responda APENAS sobre esta proposta e viagem. Nao invente informacoes que nao estao na proposta.
- Se nao souber a resposta, sugira que o cliente entre em contato com o vendedor.
- Seja amigavel, conciso e em ${proposta.idioma === 'en' ? 'ingles' : proposta.idioma === 'es' ? 'espanhol' : 'portugues brasileiro'}.
- Use no maximo 3 paragrafos curtos por resposta.
- Nao mencione que voce e uma IA ou que esta lendo dados de uma proposta. Apenas responda naturalmente.`;

    // Build messages array with history
    const messages = [];
    if (historico && Array.isArray(historico)) {
      for (const msg of historico.slice(-10)) { // Keep last 10 messages
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: mensagem });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.api_key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.modelo,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return NextResponse.json({ error: 'Erro na IA' }, { status: 500 });
    }

    const result = await response.json();
    const resposta = result.content?.[0]?.text || 'Desculpe, nao consegui processar sua pergunta.';

    return NextResponse.json({ resposta });
  } catch (e) {
    console.error('Chat error:', e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
