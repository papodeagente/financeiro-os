import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaAdmin, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { desconectar, historicoDeLeituras, lerConexao } from '@/lib/extrato-automatico/servidor';

/**
 * Uma conexão do extrato automático.
 * GET    — a conexão e o histórico das últimas leituras (conta liberada).
 * DELETE — desconecta: apaga o segredo na hora, mantém o extrato já lido.
 */
export const dynamic = 'force-dynamic';

const exec = () => pool as unknown as ExecutorSQL;

async function conexaoDaAgencia(id: string) {
  await initDB();
  if (!pool) return null;
  const tenantId = await getTenantId();
  const conexao = await lerConexao(exec(), tenantId, id);
  return conexao ? { conexao, tenantId } : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('ver_conta_bancaria');
  if (recusa) return recusa;
  const { id } = await params;
  const achada = await conexaoDaAgencia(id);
  if (!achada) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  const recusaConta = await recusaAcao('ver_conta_bancaria', { contaBancariaId: achada.conexao.conta_bancaria_id });
  if (recusaConta) return recusaConta;
  const historico = await historicoDeLeituras(exec(), achada.tenantId, id);
  return NextResponse.json({ conexao: achada.conexao, historico }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const admin = await recusaAdmin();
  if (admin) return admin;
  const { id } = await params;
  const achada = await conexaoDaAgencia(id);
  if (!achada) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  const recusaConta = await recusaAcao('conciliar', { contaBancariaId: achada.conexao.conta_bancaria_id });
  if (recusaConta) return recusaConta;
  await desconectar(exec(), achada.tenantId, id);
  return NextResponse.json({ ok: true, mensagem: 'Conta desconectada. O extrato já lido continua na conciliação.' });
}
