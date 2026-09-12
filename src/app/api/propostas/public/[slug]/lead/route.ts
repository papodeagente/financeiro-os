import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { criarNotificacao } from '@/lib/notificacoes';
import { isHostAuthorizedForProposta } from '@/lib/tenant-host';

function normalizarTextoIdentidade(valor: string): string {
  return valor.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function fingerprintLead(nome: string, email: string, telefone: string): string {
  const identidadeNormalizada = JSON.stringify({
    nome: normalizarTextoIdentidade(nome),
    email: normalizarTextoIdentidade(email),
    telefone: telefone.replace(/\D/g, ''),
  });
  return createHash('sha256').update(identidadeNormalizada).digest('hex');
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await initDB();
    const { slug } = await params;
    if (!pool || !slug || slug.length < 10 || !/^[\w-]+$/.test(slug)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const body = await req.json();
    const { nome, email, telefone, mensagem } = body;
    if (!nome?.trim() || (!email?.trim() && !telefone?.trim())) {
      return NextResponse.json({ error: 'Nome e email ou telefone obrigatorios' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT id, tenant_id, data FROM propostas WHERE id = $1 LIMIT 1`,
      [slug]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });

    if (!(await isHostAuthorizedForProposta(req, rows[0].tenant_id))) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 });
    }

    const proposta = rows[0].data;
    const tenantId = rows[0].tenant_id || '';
    const nomeLead = nome.trim();
    const emailLead = (email || '').trim();
    const telefoneLead = (telefone || '').trim();
    const mensagemLead = (mensagem || '').trim();
    const dataLead = new Date().toISOString();
    if (!proposta.leads) proposta.leads = [];
    proposta.leads.push({
      nome: nomeLead,
      email: emailLead,
      telefone: telefoneLead,
      mensagem: mensagemLead,
      data: dataLead,
    });
    proposta.atualizado_em = dataLead;

    await pool.query(
      `UPDATE propostas SET data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(proposta), rows[0].id]
    );

    if (tenantId) {
      const numero = proposta.numero || rows[0].id;
      const leadFingerprint = fingerprintLead(nomeLead, emailLead, telefoneLead);
      await criarNotificacao({
        tenantId,
        tipo: 'PROPOSTA_LEAD',
        titulo: `${nomeLead} demonstrou interesse na proposta ${numero}`,
        descricao: mensagemLead || 'Um novo contato foi enviado pela proposta pública.',
        link: `/propostas/${rows[0].id}`,
        vendedorId: proposta.vendedor_id || '',
        chaveDeduplicacao: `proposta:${rows[0].id}:lead:${leadFingerprint}`,
        data: {
          proposta_id: rows[0].id,
          proposta_numero: numero,
          recebido_em: dataLead,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
