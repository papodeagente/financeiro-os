// Configurações › Bloqueios e aprovação (05/11/2026).
//   GET → bloqueios, alçadas e as listas para escolher (pessoas, grupos,
//         categorias, centros de custo). Quem vê o financeiro lê.
//   PUT { bloqueios, alcadas } → grava os dois numa transação (Configurar bloqueios).
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { pode, listarGrupos, tenantDaSessao, type ExecutorPermissoes } from '@/lib/permissoes-servidor';
import { lerBloqueios, gravarBloqueios } from '@/lib/bloqueios-servidor';
import { listarAlcadas, salvarAlcadas } from '@/lib/aprovacoes-servidor';
import { categoriasDeDespesa, centrosDeCusto, corpoJson, respostaDeErro, usuariosDaAgencia } from '@/lib/permissoes-rota';
import { emTransacao } from '@/lib/caixa-atomico';

export async function GET() {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    await initDB();
    const recusa = await recusaAcao('ver_financeiro');
    if (recusa) return recusa;
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const sessao = (await getSession())!;
    const exec = pool as unknown as ExecutorPermissoes;
    const tenantId = tenantDaSessao(sessao);
    const [bloqueios, alcadas, usuarios, grupos, categorias, centros, podeEditar] = await Promise.all([
      lerBloqueios(exec, tenantId), listarAlcadas(exec, tenantId), usuariosDaAgencia(exec, tenantId),
      listarGrupos(exec, tenantId), categoriasDeDespesa(exec, tenantId), centrosDeCusto(exec, tenantId),
      pode(sessao, 'configurar_limites'),
    ]);
    return NextResponse.json({
      bloqueios, alcadas, categorias, centros, pode_editar: podeEditar,
      usuarios: usuarios.filter(u => u.ativo && u.papel !== 'VENDEDOR'),
      grupos: grupos.map(g => ({ id: g.id, nome: g.nome })),
    });
  } catch (e) {
    return respostaDeErro(e);
  }
}

export async function PUT(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    await initDB();
    const recusa = await recusaAcao('configurar_limites');
    if (recusa) return recusa;
    const sessao = (await getSession())!;
    const tenantId = tenantDaSessao(sessao);
    const corpo = await corpoJson(req);
    const r = await emTransacao(async exec => ({
      bloqueios: await gravarBloqueios(exec, tenantId, corpo.bloqueios),
      alcadas: await salvarAlcadas(exec, tenantId, Array.isArray(corpo.alcadas) ? corpo.alcadas : []),
    }));
    return NextResponse.json(r);
  } catch (e) {
    return respostaDeErro(e);
  }
}
