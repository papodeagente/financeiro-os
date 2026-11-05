import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { verifyPassword, createSession, COOKIE_NAME, SESSAO_SEGUNDOS, type SessionPayload } from '@/lib/auth';
import { registrarEventoAuditoria } from '@/lib/audit';
import { etapaSegundoFator, exigeSegundoFator, type Consulta as ConsultaSegundoFator } from '@/lib/segundo-fator';
import { bloqueioDeLogin, ipDoLogin, registrarFalhaDeLogin, registrarSucessoDeLogin } from '@/lib/limite-login';

export async function POST(req: Request) {
  try {
    const corpoLogin = await req.json();
    const { email, senha } = corpoLogin;
    if (!email || !senha) {
      return NextResponse.json({ error: 'Email e senha sao obrigatorios' }, { status: 400 });
    }

    const emailNormalizado = String(email).toLowerCase().trim();
    const ipLogin = ipDoLogin(req.headers);
    const espera = bloqueioDeLogin('plataforma', ipLogin, emailNormalizado);
    if (espera !== null) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
        { status: 429, headers: { 'Retry-After': String(espera) } },
      );
    }

    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const { rows } = await pool.query(
      `SELECT data FROM super_admins WHERE data->>'email' = $1 LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      registrarFalhaDeLogin('plataforma', emailNormalizado, ipLogin);
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    const user = rows[0].data;
    const registrarFalha = (motivo: string) => registrarEventoAuditoria({
      tenantId: '__platform__',
      session: null,
      origem: 'PUBLICO',
      acao: 'LOGIN_FALHOU',
      modulo: 'Segurança',
      entidade: 'super_admins',
      entidadeId: user.id,
      descricao: `Tentativa de acesso administrativo recusada: ${motivo}.`,
    });

    // Superadmin desativado não entra (FIN2-10). Antes só a senha era olhada.
    if (user.ativo === false) {
      await registrarFalha('conta desativada');
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    if (!user.senha_hash) {
      await registrarFalha('conta sem senha configurada');
      return NextResponse.json({ error: 'Conta sem senha configurada' }, { status: 401 });
    }

    const valid = await verifyPassword(senha, user.senha_hash);
    if (!valid) {
      registrarFalhaDeLogin('plataforma', emailNormalizado, ipLogin);
      await registrarFalha('credenciais inválidas');
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    // Administrador entra com senha e código do app autenticador (FIN-12).
    if (exigeSegundoFator(undefined, true)) {
      const etapa = await etapaSegundoFator(pool as unknown as ConsultaSegundoFator, 'super_admins', user, corpoLogin ?? {});
      if (!etapa.ok) {
        if (etapa.contaComoFalha) {
          registrarFalhaDeLogin('plataforma', emailNormalizado, ipLogin);
          await registrarFalha('código do segundo fator inválido');
        }
        return NextResponse.json(etapa.corpo, { status: etapa.status });
      }
    }

    const session: SessionPayload = {
      userId: user.id,
      nome: user.nome,
      email: user.email,
      perfil: 'SUPER_ADMIN',
      permissoes: {},
      tenantId: '__platform__',
      tenantSlug: '__platform__',
      isSuperAdmin: true,
    };
    registrarSucessoDeLogin('plataforma', emailNormalizado, ipLogin);
    const token = await createSession(session);
    await registrarEventoAuditoria({
      tenantId: '__platform__',
      session,
      acao: 'LOGIN',
      modulo: 'Segurança',
      entidade: 'super_admins',
      entidadeId: user.id,
      descricao: 'Entrou na administração da plataforma.',
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: 'SUPER_ADMIN',
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSAO_SEGUNDOS,
      path: '/',
    });

    return response;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
