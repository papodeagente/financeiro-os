import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

// GET /api/convites/[codigo] — endpoint PUBLICO. Retorna metadados do
// convite pra UI do /signup. Não vaza informações sensíveis (criado_por,
// tag interna, lista de usos). Retorna 404 se invalido/expirado/esgotado.
export async function GET(_req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const { codigo } = await params;
    if (!codigo || !/^[A-Z0-9]{6,32}$/.test(codigo)) {
      return NextResponse.json({ error: 'Código inválido' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.codigo, c.nome, c.descricao, c.plano_slug, c.duracao_dias,
              c.max_usos, c.usos_atuais, c.expira_em, c.ativo,
              p.nome AS plano_nome, p.descricao AS plano_descricao,
              p.preco_mensal, p.features
       FROM convites c
       LEFT JOIN planos p ON p.slug = c.plano_slug
       WHERE c.codigo = $1
       LIMIT 1`,
      [codigo.toUpperCase()],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Convite não encontrado' }, { status: 404 });
    }
    const c = rows[0];
    if (!c.ativo) {
      return NextResponse.json({ error: 'Convite desativado' }, { status: 410 });
    }
    if (c.expira_em && new Date(c.expira_em) < new Date()) {
      return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
    }
    if (c.max_usos != null && c.usos_atuais >= c.max_usos) {
      return NextResponse.json({ error: 'Convite esgotado (limite de usos atingido)' }, { status: 410 });
    }
    return NextResponse.json({
      codigo: c.codigo,
      nome: c.nome,
      descricao: c.descricao,
      plano_slug: c.plano_slug,
      plano_nome: c.plano_nome,
      plano_descricao: c.plano_descricao,
      preco_mensal: c.preco_mensal,
      features: c.features,
      duracao_dias: c.duracao_dias,
      usos_atuais: c.usos_atuais,
      max_usos: c.max_usos,
      expira_em: c.expira_em,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
