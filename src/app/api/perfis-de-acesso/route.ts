// Configurações › Perfis de acesso (05/11/2026). Tabela grupos_usuario.
//   GET  → perfis (grupos), restrições por usuário, catálogo de direitos, pessoas e contas
//   POST { grupo } → grava o perfil (com membros e contas)
//   POST { restricao } → grava a restrição de uma pessoa (vazia = apaga)
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { acoesDoTeto, acoesPorModulo } from '@/lib/acoes-financeiras';
import {
  listarGrupos, listarRestricoesDeUsuarios, salvarGrupo, salvarRestricaoDeUsuario, tenantDaSessao,
  type ExecutorPermissoes,
} from '@/lib/permissoes-servidor';
import { contasDaAgencia, corpoJson, respostaDeErro, usuariosDaAgencia } from '@/lib/permissoes-rota';
import { emTransacao } from '@/lib/caixa-atomico';

export async function GET() {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    await initDB();
    const recusa = await recusaAcao('gerenciar_usuarios');
    if (recusa) return recusa;
    const sessao = (await getSession())!;
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const exec = pool as unknown as ExecutorPermissoes;
    const tenantId = tenantDaSessao(sessao);
    const [grupos, restricoes, usuarios, contas] = await Promise.all([
      listarGrupos(exec, tenantId), listarRestricoesDeUsuarios(exec, tenantId),
      usuariosDaAgencia(exec, tenantId), contasDaAgencia(exec, tenantId),
    ]);
    return NextResponse.json({
      grupos, restricoes, usuarios, contas,
      catalogo: acoesPorModulo(),
      tetos: { ADMIN: acoesDoTeto('ADMIN'), OPERADOR: acoesDoTeto('OPERADOR'), VENDEDOR: acoesDoTeto('VENDEDOR') },
    });
  } catch (e) {
    return respostaDeErro(e);
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    await initDB();
    const recusa = await recusaAcao('gerenciar_usuarios');
    if (recusa) return recusa;
    const sessao = (await getSession())!;
    const tenantId = tenantDaSessao(sessao);
    const corpo = await corpoJson(req);
    if (corpo.grupo && typeof corpo.grupo === 'object') {
      const grupo = await emTransacao(exec => salvarGrupo(exec, tenantId, corpo.grupo as Record<string, unknown>, sessao.userId));
      return NextResponse.json({ grupo });
    }
    if (corpo.restricao && typeof corpo.restricao === 'object') {
      const entrada = corpo.restricao as Record<string, unknown>;
      // Ninguém limita a si mesmo (evita se trancar fora).
      if (entrada.usuario_id === sessao.userId) {
        return NextResponse.json({ error: 'O próprio acesso não se limita aqui; peça a outro administrador.' }, { status: 403 });
      }
      const restricao = await emTransacao(exec => salvarRestricaoDeUsuario(exec, tenantId, entrada));
      return NextResponse.json({ restricao });
    }
    return NextResponse.json({ error: 'Nada para gravar.' }, { status: 400 });
  } catch (e) {
    return respostaDeErro(e);
  }
}
