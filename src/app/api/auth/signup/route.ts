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
    let planoSlug = String(body.plano_slug || 'basic').trim();
    const codigoConvite = String(body.codigo_convite || '').trim().toUpperCase();

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

    // Se ha codigo de convite, valida + sobrescreve plano/duracao.
    // Convite e fonte de verdade: plano selecionado pelo user e ignorado
    // (alguem que tem convite Founder Pro nao pode trocar pra Basic).
    let conviteInfo: {
      id: string;
      duracao_dias: number;
      max_usos: number | null;
      usos_atuais: number;
    } | null = null;
    if (codigoConvite) {
      const { rows: cv } = await pool.query(
        `SELECT id, plano_slug, duracao_dias, max_usos, usos_atuais, expira_em, ativo
         FROM convites WHERE codigo = $1 LIMIT 1`,
        [codigoConvite],
      );
      if (cv.length === 0) {
        return NextResponse.json({ error: 'Convite inválido' }, { status: 400 });
      }
      const c = cv[0];
      if (!c.ativo) return NextResponse.json({ error: 'Convite desativado' }, { status: 410 });
      if (c.expira_em && new Date(c.expira_em) < new Date()) {
        return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
      }
      if (c.max_usos != null && c.usos_atuais >= c.max_usos) {
        return NextResponse.json({ error: 'Convite esgotado' }, { status: 410 });
      }
      planoSlug = c.plano_slug; // sobrescreve
      conviteInfo = {
        id: c.id,
        duracao_dias: c.duracao_dias,
        max_usos: c.max_usos,
        usos_atuais: c.usos_atuais,
      };
    }

    // Verifica plano (apos convite eventual ter sobrescrito)
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
    // Convite tem duracao propria (ex: 365 dias pra Clube de IA);
    // sem convite, trial padrao de 14 dias.
    const duracaoDias = conviteInfo?.duracao_dias ?? TRIAL_DAYS;
    const trialEndsAt = new Date(Date.now() + duracaoDias * 86400 * 1000);
    // Convite = acesso ja garantido pelo periodo definido (nao e trial
    // que precisa converter — e acesso pago/concedido); status 'ativa'.
    // Sem convite = trial padrao 14d.
    const assinaturaStatus = conviteInfo ? 'ativa' : 'trial';

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
      assinatura_status: assinaturaStatus,
      criado_via: conviteInfo ? 'convite' : 'signup_publico',
      convite_id: conviteInfo?.id || null,
      created_at: new Date().toISOString(),
    };

    // Criador da conta vira ADMIN com todas as permissoes canonicas.
    const userData = {
      id: userId,
      nome: nomeCompleto,
      email,
      telefone,
      senha_hash: senhaHash,
      perfil: 'ADMIN',
      permissoes: {
        ver_vendas_todos: true,
        ver_financeiro: true,
        editar_financeiro: true,
        ver_comissoes: true,
        acessar_relatorios: true,
        gerenciar_usuarios: true,
        pode_excluir: true,
        pode_exportar: true,
        ver_extrato_contas: [] as string[],
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
         VALUES ($1, $2, $3, $4, $5, 'mensal', $6)`,
        [
          assinaturaId, tenantId, planoSlug,
          assinaturaStatus, trialEndsAt,
          JSON.stringify({
            plano_nome: plano.nome,
            origem: conviteInfo ? 'convite' : 'signup_publico',
            convite_id: conviteInfo?.id || null,
            convite_codigo: conviteInfo ? codigoConvite : null,
            duracao_dias: duracaoDias,
          }),
        ],
      );

      // Se veio via convite, registra o uso + incrementa contador.
      if (conviteInfo) {
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || req.headers.get('x-real-ip') || '';
        const ua = req.headers.get('user-agent') || '';
        await client.query(
          `INSERT INTO convite_usos
             (id, convite_id, tenant_id, usuario_id, nome_cliente, email_cliente, ip, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [generateId(), conviteInfo.id, tenantId, userId, nomeCompleto, email, ip, ua],
        );
        await client.query(
          `UPDATE convites SET usos_atuais = usos_atuais + 1, updated_at = NOW() WHERE id = $1`,
          [conviteInfo.id],
        );
      }

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
      perfil: 'ADMIN',
      permissoes: userData.permissoes,
      tenantId,
      tenantSlug,
    });

    const res = NextResponse.json({
      ok: true,
      tenant: { id: tenantId, slug: tenantSlug, nome: nomeAgencia },
      plano: { slug: planoSlug, nome: plano.nome },
      trial_ends_at: trialEndsAt.toISOString(),
      duracao_dias: duracaoDias,
      via_convite: !!conviteInfo,
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
