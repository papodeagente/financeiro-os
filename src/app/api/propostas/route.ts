import { NextResponse } from 'next/server';
import { createCrudHandlers } from '@/lib/crud-api';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { comLink, garantirLinkPublico, type Consulta } from '@/lib/proposta-publica';
import { limparHtmlDaProposta } from '@/lib/html-seguro';

const crud = createCrudHandlers('propostas', ['numero', 'cliente_id', 'vendedor_id', 'status']);

// A lista leva o link público de cada proposta (coluna própria, ver
// src/lib/proposta-publica.ts): o link é um token, não o id.
export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT data, link_publico_url FROM propostas WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return NextResponse.json(rows.map(r => comLink(r.data as Record<string, unknown>, r.link_publico_url)));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Cadastro pelo CRUD; o token do link nasce aqui, no servidor.
export async function POST(req: Request) {
  // Texto rico limpo ao gravar (FIN-07); a página limpa de novo ao desenhar.
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
  const limpa = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(limparHtmlDaProposta(corpo)),
  });
  const resposta = await crud.POST(limpa);
  if (!resposta.ok || !pool) return resposta;
  const salvo = (await resposta.json()) as Record<string, unknown>;
  const link = await garantirLinkPublico(pool as unknown as Consulta, await getTenantId(), String(salvo.id ?? ''));
  return NextResponse.json(comLink(salvo, link));
}
