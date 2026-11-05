import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { normalizarPolitica, type PoliticaCobranca } from '@/lib/baixa-calculo';
import { normalizarAvisos } from '@/lib/avisos-vencimento';
import { ErroEncargos, gravarChaveDaAgencia, salvarCategoriasDosEncargos } from '@/lib/encargos-servidor';

// Configurações › Financeiro (05/11/2026):
//  - politica_cobranca: juros, multa, tolerância e desconto por antecipação
//    que a liquidação SUGERE (a pessoa sempre pode mudar na hora);
//  - categorias_encargos: em que categoria do resultado entram juros, multa,
//    desconto e taxa registrados na liquidação;
//  - avisos_vencimento: quais avisos de vencimento vão para o sino.
// O PUT grava só as chaves enviadas, sem tocar o resto do cadastro.
export const dynamic = 'force-dynamic';

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ politica_cobranca: null, categorias_encargos: {}, avisos_vencimento: normalizarAvisos(null) });
  const tenantId = await getTenantId();
  const { rows } = await pool.query(
    `SELECT data->'politica_cobranca' AS p, data->'categorias_encargos' AS c, data->'avisos_vencimento' AS a
       FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return NextResponse.json({
    politica_cobranca: rows[0]?.p ?? null,
    categorias_encargos: rows[0]?.c ?? {},
    avisos_vencimento: normalizarAvisos(rows[0]?.a),
  });
}

export async function PUT(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => ({}))) as {
    politica_cobranca?: Partial<PoliticaCobranca>;
    categorias_encargos?: unknown;
    avisos_vencimento?: unknown;
  };
  const tenantId = await getTenantId();
  try {
    const resposta = await emTransacao(async exec => {
      const r: Record<string, unknown> = {};
      if ('politica_cobranca' in corpo) {
        r.politica_cobranca = normalizarPolitica(corpo.politica_cobranca);
        await gravarChaveDaAgencia(exec, tenantId, 'politica_cobranca', r.politica_cobranca);
      }
      if ('categorias_encargos' in corpo) {
        r.categorias_encargos = await salvarCategoriasDosEncargos(exec, tenantId, corpo.categorias_encargos);
      }
      if ('avisos_vencimento' in corpo) {
        r.avisos_vencimento = normalizarAvisos(corpo.avisos_vencimento);
        await gravarChaveDaAgencia(exec, tenantId, 'avisos_vencimento', r.avisos_vencimento);
      }
      return r;
    });
    return NextResponse.json(resposta);
  } catch (e) {
    if (e instanceof ErroEncargos) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
