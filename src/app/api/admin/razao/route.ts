import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

// Painel do Super Admin para o razão financeiro (05/11/2026): o que precisa
// de olho humano. Só leitura.
//  - conferência mais recente com diferença (razão × saldo, por conta);
//  - falhas do razão nas últimas 48 h;
//  - diferenças guardadas na abertura (saldo de hoje × o que o histórico
//    reconstruiria) — para revisar com a agência, nada foi ajustado;
//  - agendador: última execução de cada tarefa e disjuntores abertos.
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
  }
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });

  const [abertas, conferencia, falhas, abertura, execucoes, disjuntores] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM razao_estado`),
    pool.query(
      `SELECT c.tenant_id, c.dia, c.conta_bancaria_id, c.saldo_atual_centavos, c.razao_centavos, c.diferenca_centavos
         FROM razao_conferencias c
         JOIN (SELECT tenant_id, MAX(dia) AS dia FROM razao_conferencias WHERE tipo = 'diaria' GROUP BY tenant_id) u
           ON u.tenant_id = c.tenant_id AND u.dia = c.dia
        WHERE c.tipo = 'diaria' AND c.diferenca_centavos <> 0
        ORDER BY ABS(c.diferenca_centavos) DESC LIMIT 200`,
    ),
    pool.query(
      `SELECT tenant_id, chave_natural, erro, criado_em FROM razao_falhas
        WHERE criado_em > NOW() - INTERVAL '48 hours' ORDER BY criado_em DESC LIMIT 200`,
    ),
    pool.query(
      `SELECT tenant_id, dia, conta_bancaria_id, saldo_atual_centavos,
              (dados->>'reconstruido_pelo_historico_centavos')::bigint AS reconstruido_centavos,
              (dados->>'diferenca_para_revisar_centavos')::bigint AS diferenca_centavos
         FROM razao_conferencias
        WHERE tipo = 'abertura' AND COALESCE((dados->>'diferenca_para_revisar_centavos')::bigint, 0) <> 0
        ORDER BY ABS((dados->>'diferenca_para_revisar_centavos')::bigint) DESC LIMIT 500`,
    ),
    pool.query(
      `SELECT tarefa, MAX(iniciado_em) AS ultima, COUNT(*) FILTER (WHERE terminado_em IS NULL)::int AS em_andamento
         FROM agendador_execucoes GROUP BY tarefa ORDER BY tarefa`,
    ),
    pool.query(
      `SELECT tarefa, tenant_id, falhas_seguidas, aberto_ate, ultimo_erro FROM agendador_estado
        WHERE falhas_seguidas > 0 ORDER BY falhas_seguidas DESC LIMIT 200`,
    ),
  ]);

  const reais = (c: unknown) => Number(c ?? 0) / 100;
  return NextResponse.json({
    agencias_com_razao: abertas.rows[0]?.n ?? 0,
    conferencia_com_diferenca: conferencia.rows.map(r => ({
      tenant_id: r.tenant_id, dia: r.dia, conta_bancaria_id: r.conta_bancaria_id,
      saldo_atual: reais(r.saldo_atual_centavos), razao: reais(r.razao_centavos), diferenca: reais(r.diferenca_centavos),
    })),
    falhas_do_razao: falhas.rows,
    diferencas_da_abertura: abertura.rows.map(r => ({
      tenant_id: r.tenant_id, dia: r.dia, conta_bancaria_id: r.conta_bancaria_id,
      saldo_atual: reais(r.saldo_atual_centavos), reconstruido: reais(r.reconstruido_centavos), diferenca: reais(r.diferenca_centavos),
    })),
    agendador: { execucoes: execucoes.rows, disjuntores: disjuntores.rows },
  });
}
