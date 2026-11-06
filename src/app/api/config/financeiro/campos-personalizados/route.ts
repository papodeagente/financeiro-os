import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarChaveDaAgencia } from '@/lib/encargos-servidor';
import {
  CHAVE_DOS_CAMPOS, LIMITES, normalizarDefinicoes, problemaNasDefinicoes, type CampoPersonalizado,
} from '@/lib/campos-personalizados';

class ErroDosCampos extends Error {}

// Configurações › Financeiro › Campos personalizados dos títulos (06/11/2026, E7).
// GET: quem vê o financeiro (o lançamento e a lista precisam das definições).
// PUT: só administrador. A lista enviada substitui a gravada, mas um campo que
// some da lista fica guardado como desativado: os valores já gravados nos
// títulos nunca perdem o nome.
export const dynamic = 'force-dynamic';

async function lerCampos(exec: ExecutorSQL, tenantId: string): Promise<CampoPersonalizado[]> {
  const { rows } = await exec.query(
    `SELECT data->'${CHAVE_DOS_CAMPOS}' AS c FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return normalizarDefinicoes(rows[0]?.c ?? []);
}

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ campos: [] });
  const tenantId = await getTenantId();
  return NextResponse.json({ campos: await lerCampos(pool as unknown as ExecutorSQL, tenantId) });
}

export async function PUT(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => null)) as unknown;
  const novos = normalizarDefinicoes(corpo);
  const problema = problemaNasDefinicoes(novos);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });
  const tenantId = await getTenantId();
  try {
    const campos = await emTransacao(async exec => {
      const antigos = await lerCampos(exec, tenantId);
      const ids = new Set(novos.map(c => c.id));
      // Campo que saiu da lista vira desativado, nunca some.
      const guardados = antigos.filter(a => !ids.has(a.id)).map(a => ({ ...a, ativo: false }));
      if (novos.length + guardados.length > LIMITES.campos) {
        throw new ErroDosCampos(`Até ${LIMITES.campos} campos, contando os desativados. Reative e renomeie um campo desativado em vez de criar outro.`);
      }
      const tudo = normalizarDefinicoes([...novos, ...guardados]);
      await gravarChaveDaAgencia(exec, tenantId, CHAVE_DOS_CAMPOS, tudo);
      return tudo;
    });
    return NextResponse.json({ campos });
  } catch (e) {
    if (e instanceof ErroDosCampos) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
