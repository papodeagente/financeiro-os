import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { semAcessoAoSistema } from '@/lib/permissoes';
import { verifyPassword, createSession, duracaoDaSessao, COOKIE_NAME, type SessionPayload } from '@/lib/auth';
import { COOKIE_NAVEGADOR, navegadorConfiavel, opcoesDoCookieDoNavegador, seloDepoisDoCodigo, seloDoPedido } from '@/lib/navegador-confiavel';
import { registrarEventoAuditoria } from '@/lib/audit';
import { etapaSegundoFator, loginPedeSegundoFator, type Consulta as ConsultaSegundoFator } from '@/lib/segundo-fator';
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
    const espera = bloqueioDeLogin('agencia', ipLogin, emailNormalizado);
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

    // Find user by email, JOIN with tenants for tenant context
    const { rows } = await pool.query(
      `SELECT u.data, u.tenant_id, t.slug as tenant_slug, t.status as tenant_status, t.nome as tenant_nome
       FROM usuarios u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.data->>'email' = $1
       -- O mesmo e-mail pode existir em outra agência como cadastro sem senha
       -- (veio de uma venda do CRM). O que entra é o que tem senha e está ativo.
       ORDER BY (COALESCE(u.data->>'senha_hash', '') <> '') DESC,
                (COALESCE(u.data->>'ativo', 'true') <> 'false') DESC,
                u.created_at ASC
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      registrarFalhaDeLogin('agencia', emailNormalizado, ipLogin);
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    const row = rows[0];
    const user = row.data;
    const registrarFalha = async (motivo: string) => {
      if (!row.tenant_id) return;
      await registrarEventoAuditoria({
        tenantId: row.tenant_id,
        session: null,
        origem: 'PUBLICO',
        acao: 'LOGIN_FALHOU',
        modulo: 'Segurança',
        entidade: 'usuarios',
        entidadeId: user.id,
        descricao: `Tentativa de acesso recusada: ${motivo}.`,
      });
    };

    if (!user.ativo) {
      await registrarFalha('conta inativa');
      return NextResponse.json({ error: 'Usuario inativo. Contate o administrador.' }, { status: 403 });
    }

    // Colaborador existe para entrar na folha de pagamento, não para usar o
    // sistema. A recusa fica AQUI, no login, e não só nas permissões: quem
    // nunca recebe sessão não depende de nenhuma checagem posterior estar
    // correta em cada rota.
    if (semAcessoAoSistema(user.perfil)) {
      return NextResponse.json(
        { error: 'Este cadastro nao tem acesso ao sistema. Fale com o administrador da agencia.' },
        { status: 403 },
      );
    }

    // Usuário sem agência não entra.
    //
    // Sessão com tenantId vazio fazia todo `WHERE tenant_id = $1` casar com
    // as linhas órfãs (tenant_id = '') que sobraram da migração multi-tenant
    // — em várias tabelas ela nunca rodou o backfill. Além de expor esses
    // registros, /api/config/reset apagaria todos eles de uma vez.
    if (!row.tenant_id) {
      return NextResponse.json(
        { error: 'Usuario sem agencia vinculada. Contate o suporte.' },
        { status: 403 },
      );
    }

    // Check tenant status.
    // O JOIN é LEFT: agência removida devolve status nulo, e a checagem
    // antiga (`row.tenant_status && ...`) era simplesmente pulada, deixando
    // entrar quem pertence a uma agência que não existe mais.
    if (row.tenant_status !== 'ativo') {
      await registrarFalha('agência indisponível');
      return NextResponse.json({ error: 'Agencia suspensa. Contate o suporte.' }, { status: 403 });
    }

    if (!user.senha_hash) {
      await registrarFalha('conta sem senha configurada');
      return NextResponse.json({ error: 'Usuario sem senha configurada. Contate o administrador.' }, { status: 401 });
    }

    // Verify password
    const valid = await verifyPassword(senha, user.senha_hash);
    if (!valid) {
      registrarFalhaDeLogin('agencia', emailNormalizado, ipLogin);
      await registrarFalha('credenciais inválidas');
      return NextResponse.json({ error: 'Email ou senha incorretos' }, { status: 401 });
    }

    // Administrador entra com senha e código do app autenticador (FIN-12).
    // Quem não é administrador e já cadastrou o aplicativo (para pagar, E7)
    // também: o código cadastrado passa a valer no login. Quem não cadastrou
    // entra só com a senha e é levado a cadastrar na hora de pagar.
    //
    // Navegador confiável (12/11/2026): quem já digitou o código neste
    // navegador e marcou "Manter conectado" não digita de novo por 30 dias.
    // A senha continua sempre obrigatória. Ver src/lib/navegador-confiavel.ts.
    const lembrar = corpoLogin?.lembrar === true;
    const comSegundoFator = loginPedeSegundoFator(user);
    let seloNovo: string | null = null;
    let peloNavegador = false;
    if (comSegundoFator) {
      peloNavegador = await navegadorConfiavel(seloDoPedido(req.headers), 'usuarios', user);
      if (!peloNavegador) {
        const etapa = await etapaSegundoFator(pool as unknown as ConsultaSegundoFator, 'usuarios', user, corpoLogin ?? {});
        if (!etapa.ok) {
          if (etapa.contaComoFalha) {
            registrarFalhaDeLogin('agencia', emailNormalizado, ipLogin);
            await registrarFalha('código do segundo fator inválido');
          }
          return NextResponse.json(etapa.corpo, { status: etapa.status });
        }
        if (lembrar) seloNovo = await seloDepoisDoCodigo(pool, 'usuarios', user.id, row.tenant_id);
      }
    }

    // Create JWT session with tenant context
    const session: SessionPayload = {
      userId: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
      permissoes: user.permissoes || {},
      tenantId: row.tenant_id || '',
      tenantSlug: row.tenant_slug || '',
      ...(comSegundoFator ? { sf: true } : {}),
      ...(lembrar ? { lembrar: true } : {}),
    };
    registrarSucessoDeLogin('agencia', emailNormalizado, ipLogin);
    const token = await createSession(session);
    await registrarEventoAuditoria({
      tenantId: row.tenant_id,
      session,
      acao: 'LOGIN',
      modulo: 'Segurança',
      entidade: 'usuarios',
      entidadeId: user.id,
      descricao: peloNavegador ? 'Entrou no sistema (navegador confiável, sem código).' : 'Entrou no sistema.',
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: user.perfil,
        permissoes: user.permissoes,
        tenantId: row.tenant_id,
        tenantSlug: row.tenant_slug,
        tenantNome: row.tenant_nome,
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: duracaoDaSessao(session),
      path: '/',
    });
    if (seloNovo) response.cookies.set(COOKIE_NAVEGADOR, seloNovo, opcoesDoCookieDoNavegador());

    return response;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
