import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { createSession, getSession, duracaoDaSessao, COOKIE_NAME, type SessionPayload } from '@/lib/auth';
import { COOKIE_NAVEGADOR, opcoesDoCookieDoNavegador, seloDepoisDoCodigo } from '@/lib/navegador-confiavel';
import { registrarEventoAuditoria } from '@/lib/audit';
import { etapaSegundoFator, exigeSegundoFator, segredoGravado, type Consulta } from '@/lib/segundo-fator';
import { regraDoPagador } from '@/lib/segundo-fator-pagador';
import { exigeSegundoFatorDoPagador } from '@/lib/segundo-fator-pagador-servidor';
import { pode } from '@/lib/permissoes-servidor';
import { bloqueioDeLogin, ipDoLogin, registrarFalhaDeLogin, registrarSucessoDeLogin } from '@/lib/limite-login';

/**
 * Verificação em duas etapas da própria pessoa, já logada (E7, 06/11/2026).
 *
 *   GET  → { ativo, exigido_para_pagar, verificada_nesta_sessao, prazo, administrador }
 *   POST {}                          → começa o cadastro: { segredo, uri } (nada gravado)
 *   POST { segredo_novo, codigo }    → cadastra (o código prova o aplicativo)
 *   POST { codigo }                  → quem já cadastrou confirma nesta sessão
 *
 * Cadastrou ou confirmou: a sessão é trocada por uma com `sf: true` (o
 * pagamento segue sem sair do sistema). O segredo nunca vai para o registro
 * de atividades. Erros de código contam no mesmo limite do login.
 */
export const dynamic = 'force-dynamic';

type Sessao = SessionPayload & { iat?: number; exp?: number };

async function lerCadastro(sessao: Sessao): Promise<Record<string, unknown> | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT data FROM usuarios WHERE id = $1 AND tenant_id = $2`, [sessao.userId, sessao.tenantId || ''],
  );
  return (rows[0]?.data ?? null) as Record<string, unknown> | null;
}

async function pagaNoFinanceiro(sessao: Sessao): Promise<boolean> {
  return (await pode(sessao, 'liquidar_pagar')) || (await pode(sessao, 'transferir')) || (await pode(sessao, 'aprovar_pagamento'));
}

export async function GET() {
  const sessao = (await getSession()) as Sessao | null;
  if (!sessao?.userId) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  await initDB();
  const administrador = !!sessao.isSuperAdmin || exigeSegundoFator(sessao.perfil);
  const cadastro = sessao.isSuperAdmin ? null : await lerCadastro(sessao);
  const regra = regraDoPagador();
  return NextResponse.json({
    ativo: administrador || (cadastro ? segredoGravado(cadastro) !== null : false),
    administrador,
    // Versão por agência (14/11/2026): só a versão completa pede o código de quem paga.
    exigido_para_pagar: !administrador && regra.ligado && (await exigeSegundoFatorDoPagador(sessao.tenantId)) && (await pagaNoFinanceiro(sessao)),
    verificada_nesta_sessao: administrador || sessao.sf === true,
    prazo: regra.prazo,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const sessao = (await getSession()) as Sessao | null;
  if (!sessao?.userId) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  if (sessao.isSuperAdmin) {
    return NextResponse.json({ error: 'O administrador da plataforma usa o código no próprio login.' }, { status: 400 });
  }
  const corpo = (await req.json().catch(() => ({}))) as { segredo_novo?: unknown; codigo?: unknown };
  const email = String(sessao.email || '').toLowerCase().trim();
  const ip = ipDoLogin(req.headers);
  const espera = bloqueioDeLogin('agencia', ip, email);
  if (espera !== null) {
    return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
      { status: 429, headers: { 'Retry-After': String(espera) } });
  }
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const cadastro = await lerCadastro(sessao);
  if (!cadastro) return NextResponse.json({ error: 'Cadastro não encontrado.' }, { status: 404 });
  const jaTinha = segredoGravado(cadastro) !== null;

  const etapa = await etapaSegundoFator(pool as unknown as Consulta, 'usuarios', cadastro, {
    codigo: typeof corpo.codigo === 'string' ? corpo.codigo : undefined,
    segredo_novo: corpo.segredo_novo,
  });
  if (!etapa.ok) {
    if (etapa.contaComoFalha) registrarFalhaDeLogin('agencia', email, ip);
    const resposta = { ...etapa.corpo };
    // A frase do login fala de administrador; aqui é a própria pessoa ativando.
    if (resposta.precisa_cadastrar && !etapa.contaComoFalha) {
      resposta.error = 'Cadastre a chave no aplicativo autenticador e digite o código que ele mostrar.';
    }
    return NextResponse.json(resposta, { status: 400 });
  }
  registrarSucessoDeLogin('agencia', email, ip);

  await registrarEventoAuditoria({
    tenantId: sessao.tenantId,
    session: sessao,
    acao: 'CONFIRMAR',
    modulo: 'Segurança',
    entidade: 'usuarios',
    entidadeId: sessao.userId,
    descricao: jaTinha
      ? 'Confirmou a verificação em duas etapas nesta sessão.'
      : 'Ativou a verificação em duas etapas (aplicativo autenticador).',
  });

  // Troca a sessão por uma marcada com o segundo fator, sem sair do sistema.
  const { iat: _iat, exp: _exp, ...semDatas } = sessao;
  void _iat; void _exp;
  const token = await createSession({ ...semDatas, sf: true });
  const resposta = NextResponse.json({ ok: true, ativo: true, verificada_nesta_sessao: true });
  resposta.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: duracaoDaSessao(semDatas),
    path: '/',
  });
  // Quem entrou com "Manter conectado" já escolheu lembrar este navegador:
  // o código digitado aqui também vale para os próximos logins.
  if (semDatas.lembrar === true) {
    const selo = await seloDepoisDoCodigo(pool, 'usuarios', sessao.userId, sessao.tenantId);
    if (selo) resposta.cookies.set(COOKIE_NAVEGADOR, selo, opcoesDoCookieDoNavegador());
  }
  return resposta;
}
