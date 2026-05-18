import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

async function getAnthropicConfig(tenantId: string) {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT data FROM config_apis WHERE id = 'apis-config-singleton' AND tenant_id = $1`, [tenantId]);
  if (rows.length === 0) return null;
  const cfg = rows[0].data;
  if (!cfg.anthropic?.ativo || !cfg.anthropic?.api_key) return null;
  return { api_key: cfg.anthropic.api_key, modelo: cfg.anthropic.modelo || 'claude-sonnet-4-5-20250929' };
}

export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const config = await getAnthropicConfig(tenantId);
    if (!config) {
      return NextResponse.json({ error: 'API Anthropic não configurada. Vá em Configurações > Integrações.' }, { status: 400 });
    }

    const { nome, pais } = await req.json();
    if (!nome) {
      return NextResponse.json({ error: 'Nome do destino é obrigatório' }, { status: 400 });
    }

    const prompt = `Você é um especialista em turismo brasileiro. Gere informações completas sobre o destino "${nome}"${pais ? ` (${pais})` : ''} para uma agência de viagens brasileira.

Responda APENAS com JSON válido (sem markdown, sem \`\`\`), no seguinte formato:
{
  "descricao": "Descrição rica e atrativa do destino em 2-3 parágrafos, tom comercial e inspirador para vender viagens",
  "idioma": "Idioma(s) principal(is) do destino",
  "clima": "Descrição do clima ao longo do ano, temperaturas médias",
  "moeda": "Moeda local e dica de câmbio",
  "fuso": "Fuso horário em relação a Brasília",
  "melhor_epoca": "Melhor época para visitar e por quê",
  "gastronomia": "Pratos típicos e restaurantes recomendados",
  "dicas": "5-8 dicas práticas para viajantes brasileiros (visto, tomadas, transporte, gorjetas, etc.)",
  "fast_facts": [
    {"label": "Capital", "valor": "..."},
    {"label": "População", "valor": "..."},
    {"label": "Área", "valor": "..."},
    {"label": "Código telefone", "valor": "..."},
    {"label": "Voltagem", "valor": "..."},
    {"label": "Visto para brasileiros", "valor": "..."},
    {"label": "Vacinas", "valor": "..."}
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.api_key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.modelo,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `Erro na API Anthropic: ${response.status} - ${err}` }, { status: 500 });
    }

    const result = await response.json();
    const text = result.content?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Erro ao processar resposta da IA', raw: text }, { status: 500 });
    }

    return NextResponse.json({
      descricao: parsed.descricao || '',
      idioma: parsed.idioma || '',
      clima: parsed.clima || '',
      moeda: parsed.moeda || '',
      fuso: parsed.fuso || '',
      melhor_epoca: parsed.melhor_epoca || '',
      gastronomia: parsed.gastronomia || '',
      dicas: parsed.dicas || '',
      fast_facts: parsed.fast_facts || [],
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro desconhecido' }, { status: 500 });
  }
}
