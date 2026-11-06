import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaAdmin } from '@/lib/guarda-rota';
import { contasPermitidas, pode } from '@/lib/permissoes-servidor';
import { podeGerenciarUsuarios } from '@/lib/permissoes';
import { cofreDisponivel } from '@/lib/cofre';
import { horaDeBrasilia } from '@/lib/agendador/nucleo';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { ehFalhaColeta } from '@/lib/extrato-automatico/contrato';
import { adaptadorDe, provedoresDeColeta } from '@/lib/extrato-automatico/registro';
import { clienteHttpMtls } from '@/lib/extrato-automatico/http-mtls';
import {
  ErroExtratoAutomatico, completarComSegredoGravado, listarConexoes, montarCredencial, salvarConexao,
  type CredencialRecebida,
} from '@/lib/extrato-automatico/servidor';

/**
 * Extrato automático (06/11/2026, E6 parte B).
 *
 * GET  — conexões da agência (só das contas liberadas para a pessoa), com a
 *        saúde em palavras, e os bancos que já leem sozinhos (campos e passo a
 *        passo para a tela de conexão). Nunca devolve segredo.
 * POST — conecta (ou renova) uma conta: confere os arquivos, faz a chamada de
 *        teste no banco e só então cifra e grava. Só administrador, e só em
 *        conta liberada. Corpo:
 *        { conta_bancaria_id, provedor, apelido?, vezes_por_dia?,
 *          credencial: { clientId, clientSecret, certificadoPem, chavePrivadaPem, extras? } }
 *        Na renovação, ClientId e ClientSecret podem vir vazios (o banco os mantém).
 */
export const dynamic = 'force-dynamic';

const exec = () => pool as unknown as ExecutorSQL;

export async function GET() {
  const recusa = await recusaAcao('ver_conta_bancaria');
  if (recusa) return recusa;
  await initDB();
  const sessao = await getSession();
  const tenantId = await getTenantId();
  const provedores = provedoresDeColeta();
  // O que a tela pode oferecer (quem decide de verdade é cada rota).
  const podeConectar = podeGerenciarUsuarios(sessao);
  const podeLer = await pode(sessao, 'conciliar');
  if (!pool) return NextResponse.json({ conexoes: [], contas: [], provedores, cofre_disponivel: cofreDisponivel(), pode_conectar: podeConectar, pode_ler: podeLer });
  const liberadas = await contasPermitidas(sessao);
  const conexoes = await listarConexoes(exec(), tenantId, liberadas);
  const { rows } = await exec().query(
    `SELECT id, COALESCE(data->>'nome', '') AS nome, COALESCE(NULLIF(data->>'moeda', ''), 'BRL') AS moeda
       FROM contas_bancarias WHERE tenant_id = $1 AND ($2::text[] IS NULL OR id = ANY($2::text[]))
      ORDER BY 2, 1`,
    [tenantId, liberadas],
  );
  const contas = rows.map(r => ({ id: String(r.id), nome: String(r.nome), moeda: String(r.moeda) }));
  return NextResponse.json(
    { conexoes, contas, provedores, cofre_disponivel: cofreDisponivel(), pode_conectar: podeConectar, pode_ler: podeLer },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: Request) {
  const admin = await recusaAdmin();
  if (admin) return admin;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  }
  const contaId = typeof body.conta_bancaria_id === 'string' ? body.conta_bancaria_id.trim() : '';
  const provedor = typeof body.provedor === 'string' ? body.provedor.trim() : '';
  if (!contaId) return NextResponse.json({ error: 'Escolha a conta bancária.' }, { status: 400 });
  const recusaConta = await recusaAcao('conciliar', { contaBancariaId: contaId });
  if (recusaConta) return recusaConta;
  const adaptador = adaptadorDe(provedor);
  if (!adaptador || !adaptador.capacidades.coletaAutomatica || !adaptador.validarCredencial) {
    return NextResponse.json({ error: 'Este banco ainda não tem leitura automática.' }, { status: 400 });
  }
  if (!cofreDisponivel()) {
    return NextResponse.json({ error: 'O cofre de credenciais não está configurado neste servidor. Fale com o suporte do EnturOS.' }, { status: 503 });
  }
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  const sessao = await getSession();
  const tenantId = await getTenantId();

  const { rows: conta } = await exec().query(`SELECT id FROM contas_bancarias WHERE id = $1 AND tenant_id = $2`, [contaId, tenantId]);
  if (!conta.length) return NextResponse.json({ error: 'Conta bancária não encontrada nesta agência.' }, { status: 404 });

  let cred = montarCredencial(body.credencial as CredencialRecebida);
  cred = await completarComSegredoGravado(exec(), tenantId, contaId, cred);
  const hoje = horaDeBrasilia(new Date()).data;
  try {
    // 1) Os arquivos, sem sair do servidor (ZIP, trocados, vencido).
    const material = adaptador.conferirMaterial ? adaptador.conferirMaterial(cred, hoje) : { expiraEm: null };
    // 2) A chamada de teste no banco.
    const teste = await adaptador.validarCredencial(cred, { http: clienteHttpMtls });
    // 3) Só então cifra e grava.
    const vezes = Number(body.vezes_por_dia ?? 1);
    const r = await salvarConexao(exec(), {
      tenantId, contaId, provedor: adaptador.id, credencial: cred, expiraEm: material.expiraEm,
      apelido: typeof body.apelido === 'string' ? body.apelido : '',
      vezesPorDia: Number.isFinite(vezes) ? vezes : 1,
      contaDetectada: teste.contaDetectada, saldo: teste.saldo, usuario: sessao?.userId,
    });
    return NextResponse.json({
      id: r.id,
      renovada: r.renovada,
      expira_em: material.expiraEm,
      saldo_no_banco: teste.saldo ? teste.saldo.disponivelCentavos / 100 : null,
      mensagem: r.renovada ? 'Conexão renovada. O extrato continua chegando sozinho.' : 'Conexão validada. O banco reconheceu a integração.',
    });
  } catch (e) {
    if (ehFalhaColeta(e)) return NextResponse.json({ error: e.mensagemUsuario, motivo: e.motivo }, { status: 422 });
    if (e instanceof ErroExtratoAutomatico) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[extrato-automatico] conectar falhou:', e instanceof Error ? e.message : 'erro');
    return NextResponse.json({ error: 'Não foi possível gravar a conexão agora.' }, { status: 500 });
  }
}
