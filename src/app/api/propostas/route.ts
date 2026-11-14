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
  // A tela de proposta nova salva sozinha pelo POST até ser reaberta. Se a
  // proposta já existe nesta agência, a gravação passa pela MESMA fusão do
  // PUT: aceite, interessados, comentários e status escritos pelo cliente
  // não são apagados por tela velha (auditoria 04/11/2026, FIN2-07).
  if (pool && typeof (corpo as { id?: unknown }).id === 'string') {
    const id = (corpo as { id: string }).id;
    const { rows } = await pool.query(`SELECT 1 FROM propostas WHERE id = $1 AND tenant_id = $2`, [id, await getTenantId()]);
    if (rows.length > 0) {
      const { PUT } = await import('./[id]/route');
      return PUT(new Request(req.url, { method: 'PUT', headers: req.headers, body: JSON.stringify(corpo) }), { params: Promise.resolve({ id }) });
    }
  }
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
