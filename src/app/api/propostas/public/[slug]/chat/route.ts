import { chaveAnthropic, type Consulta } from '@/lib/config-apis';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { resolvePropostaForHost } from '@/lib/tenant-host';
import { ipDaRequisicao, permitirChamada } from '@/lib/limite-publico';


/** Tetos do chat público (FIN-09): por visitante, por link e de tamanho. */
const TETO_MENSAGEM = 1000;
const TETO_HISTORICO = 10;
const TETO_ITEM_HISTORICO = 2000;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const ip = ipDaRequisicao(req);
    // Orçamento ANTES de qualquer leitura ou chamada à IA: quem tem o link
    // não pode gastar a conta da agência em laço.
    if (!permitirChamada(`chat-ip:${ip}`, 20, 10 * 60_000)) {
      return NextResponse.json({ error: 'Muitas perguntas seguidas. Tente de novo mais tarde.' }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const mensagem = typeof body?.mensagem === 'string' ? body.mensagem.trim() : '';
    if (!mensagem) {
      return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 });
    }
    if (mensagem.length > TETO_MENSAGEM) {
      return NextResponse.json({ error: 'Mensagem longa demais' }, { status: 413 });
    }
    const historico = Array.isArray(body?.historico) ? body.historico : [];

    // A proposta (e com ela a agência) vem antes da configuração da IA.
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB offline' }, { status: 500 });
    const r = await resolvePropostaForHost(req, slug);
    if (!r.ok) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });
    }
    // Orçamento por link, contado só para proposta que existe (um slug
    // inventado não ocupa espaço no limitador).
    if (!permitirChamada(`chat-link:${r.id}`, 200, 24 * 3600_000)) {
      return NextResponse.json({ error: 'Muitas perguntas seguidas. Tente de novo mais tarde.' }, { status: 429 });
    }
    const proposta = r.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    // A chave é a da agência dona da proposta.
    const config = await chaveAnthropic(pool as unknown as Consulta, r.tenantId, 'claude-sonnet-4-5-20250929');
    if (!config) {
      return NextResponse.json({ error: 'IA nao configurada' }, { status: 503 });
    }

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

    // Histórico: só papéis válidos e texto, com teto de itens e tamanho.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of historico.slice(-TETO_HISTORICO)) {
      const role = msg?.role === 'assistant' ? 'assistant' : msg?.role === 'user' ? 'user' : null;
      if (!role || typeof msg?.content !== 'string') continue;
      messages.push({ role, content: msg.content.slice(0, TETO_ITEM_HISTORICO) });
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
        max_tokens: 600,
        system: systemPrompt,
        messages,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.error('Anthropic API error:', response.status);
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
