import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { hashPassword, createSession, COOKIE_NAME } from '@/lib/auth';
import { generateId } from '@/lib/utils';

const TRIAL_DAYS = 14;

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function validarEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// POST /api/auth/signup
// Body: { nome_agencia, nome_completo, email, senha, telefone?, plano_slug }
// Cria atomicamente: Tenant (status 'ativo'), Usuario (perfil 'owner'),
// Assinatura (status 'trial', trial_ends_at = NOW + 14 dias).
// Retorna cookie de sessao pra logar o usuario imediatamente.
export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });

    const body = await req.json();
    const nomeAgencia = String(body.nome_agencia || '').trim();
    const nomeCompleto = String(body.nome_completo || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const senha = String(body.senha || '');
    const telefone = String(body.telefone || '').trim();
    const planoSlug = String(body.plano_slug || 'basic').trim();

    if (!nomeAgencia) return NextResponse.json({ error: 'Nome da agência obrigatório' }, { status: 400 });
    if (!nomeCompleto) return NextResponse.json({ error: 'Nome completo obrigatório' }, { status: 400 });
    if (!email || !validarEmail(email)) return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 });
    if (senha.length < 8) return NextResponse.json({ error: 'Senha deve ter pelo menos 8 caracteres' }, { status: 400 });

    // Verifica se email ja esta cadastrado em qualquer tenant
    const { rows: existingUser } = await pool.query(
      `SELECT id FROM usuarios WHERE LOWER(data->>'email') = $1 LIMIT 1`,
      [email],
    );
    if (existingUser.length > 0) {
      return NextResponse.json({ error: 'Este e-mail já está cadastrado. Faça login ou recupere a senha.' }, { status: 400 });
    }

    // Verifica plano selecionado
    const { rows: planos } = await pool.query(
      `SELECT slug, nome, limites, features FROM planos WHERE slug = $1 AND ativo = TRUE LIMIT 1`,
      [planoSlug],
    );
    if (planos.length === 0) {
      return NextResponse.json({ error: 'Plano não encontrado' }, { status: 400 });
    }
    const plano = planos[0];

    // Gera slug unico para o tenant. Tenta o slug base, se colidir
    // anexa sufixo aleatorio curto.
    let slugBase = slugify(nomeAgencia) || 'agencia';
    let tenantSlug = slugBase;
    let suffix = 0;
    for (;;) {
      const { rows: dup } = await pool.query('SELECT 1 FROM tenants WHERE slug = $1 LIMIT 1', [tenantSlug]);
      if (dup.length === 0) break;
      suffix += 1;
      tenantSlug = `${slugBase}-${suffix}`;
      if (suffix > 50) {
        tenantSlug = `${slugBase}-${Math.random().toString(36).slice(2, 7)}`;
        break;
      }
    }

    const tenantId = generateId();
    const userId = generateId();
    const assinaturaId = generateId();
    const senhaHash = await hashPassword(senha);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400 * 1000);

    const tenantData = {
      id: tenantId,
      slug: tenantSlug,
      nome: nomeAgencia,
      cnpj: '',
      plano: planoSlug,
      plano_nome: plano.nome,
      status: 'ativo',
      max_usuarios: (plano.limites?.usuarios ?? 3),
      max_grupos: (plano.limites?.grupos ?? 10),
      features: plano.features ?? [],
      trial_ends_at: trialEndsAt.toISOString(),
      assinatura_status: 'trial',
      criado_via: 'signup_publico',
      created_at: new Date().toISOString(),
    };

    const userData = {
      id: userId,
      nome: nomeCompleto,
      email,
      telefone,
      senha_hash: senhaHash,
      perfil: 'owner',
      permissoes: {
        // Owner tem todas permissoes
        admin: true,
        propostas: ['create', 'edit', 'delete'],
        vendas: ['create', 'edit', 'delete'],
        financeiro: ['create', 'edit', 'delete'],
        grupos: ['create', 'edit', 'delete'],
        config: ['edit'],
      },
      ativo: true,
      criado_via: 'signup_publico',
      created_at: new Date().toISOString(),
    };

    // Transacao: cria tenant + user + assinatura. Se qualquer um falha,
    // rollback e nada e persistido.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO tenants (id, slug, nome, cnpj, plano, status, data)
         VALUES ($1, $2, $3, '', $4, 'ativo', $5)`,
        [tenantId, tenantSlug, nomeAgencia, planoSlug, JSON.stringify(tenantData)],
      );

      await client.query(
        `INSERT INTO usuarios (id, tenant_id, nome, email, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, tenantId, nomeCompleto, email, JSON.stringify(userData)],
      );

      await client.query(
        `INSERT INTO assinaturas
           (id, tenant_id, plano_slug, status, trial_ends_at, ciclo, data)
         VALUES ($1, $2, $3, 'trial', $4, 'mensal', $5)`,
        [
          assinaturaId, tenantId, planoSlug, trialEndsAt,
          JSON.stringify({
            plano_nome: plano.nome,
            preco_origem: 'placeholder',
            origem: 'signup_publico',
          }),
        ],
      );

      // Bootstrap minimo: cria a agencia singleton dentro do tenant
      // (legacy compat: alguns componentes carregam /api/agencia).
      await client.query(
        `INSERT INTO agencia (id, tenant_id, data)
         VALUES ('singleton-' || $1, $1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [tenantId, JSON.stringify({ nome: nomeAgencia, email_contato: email, telefone })],
      ).catch(() => { /* agencia ja existe ou tabela diferente — segue */ });

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Cria sessao + cookie pra logar o usuario imediatamente
    const token = await createSession({
      userId,
      nome: nomeCompleto,
      email,
      perfil: 'owner',
      permissoes: userData.permissoes,
      tenantId,
      tenantSlug,
    });

    const res = NextResponse.json({
      ok: true,
      tenant: { id: tenantId, slug: tenantSlug, nome: nomeAgencia },
      plano: { slug: planoSlug, nome: plano.nome },
      trial_ends_at: trialEndsAt.toISOString(),
      redirect: '/dashboard',
    });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true, secure: true, sameSite: 'lax',
      path: '/', maxAge: 7 * 24 * 3600,
    });
    return res;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[signup]', msg);
    return NextResponse.json({ error: 'Erro ao criar conta. Tente novamente em instantes.' }, { status: 500 });
  }
}
