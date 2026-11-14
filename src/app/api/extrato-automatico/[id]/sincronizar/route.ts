import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { clienteHttpMtls } from '@/lib/extrato-automatico/http-mtls';
import { lerConexao, sincronizarConexao } from '@/lib/extrato-automatico/servidor';

/**
 * "Ler o extrato agora" (06/11/2026). Quem concilia a conta pode pedir. A
 * leitura é a mesma da tarefa de hora em hora: serial por conta (se uma já
 * estiver rodando, responde 409) e uma por minuto quando pedida na tela.
 */
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('conciliar');
  if (recusa) return recusa;
  const { id } = await params;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  const tenantId = await getTenantId();
  const conexao = await lerConexao(exec, tenantId, id);
  if (!conexao) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  const recusaConta = await recusaAcao('conciliar', { contaBancariaId: conexao.conta_bancaria_id });
  if (recusaConta) return recusaConta;
  const sessao = await getSession();
  const r = await sincronizarConexao(exec, tenantId, id, {
    origem: 'manual', ambiente: { http: clienteHttpMtls }, emTransacao, pedidaPor: sessao?.userId,
  });
  const depois = await lerConexao(exec, tenantId, id);
  const status = r.resultado === 'ok' || r.resultado === 'falhou' ? 200
    : r.resultado === 'em_andamento' || r.resultado === 'ja_feita' ? 409
    : r.resultado === 'nao_encontrada' ? 404 : 400;
  return NextResponse.json({ ...r, conexao: depois }, { status });
}
