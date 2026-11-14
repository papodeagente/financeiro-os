// Travas de permissão para rotas escritas à mão (as do CRUD genérico usam
// as opções de crud-api). Devolvem a resposta de recusa ou null.
import { NextResponse } from 'next/server';
import { getSession } from './auth';
import { bloqueioFinanceiro, podeExcluir, podeGerenciarUsuarios } from './permissoes';
import { mensagemPeriodoFechado, periodoFechadoDoErro } from './periodo-fechado';
import { pode } from './permissoes-servidor';
import { ACOES_FINANCEIRAS, type AcaoFinanceira } from './acoes-financeiras';
import {
  MENSAGEM_BLOQUEIO_PAGADOR, ONDE_ATIVAR_SEGUNDO_FATOR, mensagemAvisoPagador, regraDoPagador, situacaoDoPagador,
} from './segundo-fator-pagador';
import { hojeISO } from './money';
import { MENSAGEM_CONTA_SO_VER } from './conta-da-gravacao';
import { exigirModulo } from './modulos-servidor';
import type { ModuloId } from './modulos';

/**
 * Rota de um módulo da versão completa (modulos.ts, APIS_DOS_MODULOS): a
 * agência da sessão sem o módulo recebe 404, como se a rota não existisse.
 * Primeira linha de cada handler; o teste scripts/test-modulos-rotas.ts
 * confere que nenhuma rota do catálogo ficou sem ela. Sem sessão, deixa a
 * rota responder o 401 dela de sempre.
 */
export async function recusaModulo(id: ModuloId): Promise<NextResponse | null> {
  const sessao = await getSession();
  if (!sessao) return null;
  const tenantId = sessao.impersonatingTenantId || sessao.tenantId || '';
  const fora = await exigirModulo(tenantId, id);
  return fora ? NextResponse.json({ error: fora.erro }, { status: fora.status }) : null;
}

/**
 * Rota pública (link do cliente, link de leitura): confere o módulo da
 * AGÊNCIA DONA do token, nunca o de quem abriu. `resposta` é a recusa que a
 * rota já dá para token inválido, para o link de agência sem o módulo ser
 * indistinguível de um link que não existe.
 */
export async function recusaModuloDaAgencia(
  tenantId: string, id: ModuloId, resposta?: () => NextResponse,
): Promise<NextResponse | null> {
  const fora = await exigirModulo(tenantId, id);
  if (!fora) return null;
  return resposta ? resposta() : NextResponse.json({ error: fora.erro }, { status: fora.status });
}

export async function recusaFinanceira(modo: 'ler' | 'escrever'): Promise<NextResponse | null> {
  const sessao = await getSession();
  const bloqueio = bloqueioFinanceiro(sessao, modo);
  if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
  // Abaixo do teto, o perfil de acesso ainda pode ter tirado o acesso
  // (05/11/2026). Sem grupo, é o mesmo resultado de antes.
  if (await pode(sessao, modo === 'escrever' ? 'editar_financeiro' : 'ver_financeiro')) return null;
  return NextResponse.json({ error: 'Seu perfil de acesso não inclui isto no financeiro.' }, { status: 403 });
}

/** Excluir exige o perfil que exclui (ADMIN). OPERADOR e VENDEDOR não apagam. */
export async function recusaExclusao(): Promise<NextResponse | null> {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  if (podeExcluir(sessao) && await pode(sessao, 'excluir')) return null;
  return NextResponse.json({ error: 'Seu perfil nao pode excluir registros.' }, { status: 403 });
}

/** Só administrador da agência (ou superadmin). Manutenção, segredos, integração. */
export async function recusaAdmin(): Promise<NextResponse | null> {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  if (podeGerenciarUsuarios(sessao)) return null;
  return NextResponse.json({ error: 'Apenas administradores podem fazer isto.' }, { status: 403 });
}

/**
 * Guarda por ação do catálogo (05/11/2026). Com `contaBancariaId`, a conta
 * também precisa estar liberada para a pessoa.
 */
export async function recusaAcao(
  acao: AcaoFinanceira, opcoes?: { contaBancariaId?: string | null },
): Promise<NextResponse | null> {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  if (await pode(sessao, acao, opcoes)) return null;
  const rotulo = ACOES_FINANCEIRAS.find(a => a.id === acao)?.rotulo ?? acao;
  const conta = opcoes?.contaBancariaId && await pode(sessao, acao);
  // Conta "só ver" (E7): vê saldo e extrato, mas não movimenta.
  const soVer = conta && await pode(sessao, 'ver_conta_bancaria', { contaBancariaId: opcoes?.contaBancariaId });
  return NextResponse.json({
    error: soVer
      ? MENSAGEM_CONTA_SO_VER
      : conta
        ? 'Esta conta bancária não está liberada para você.'
        : `Seu acesso não inclui: ${rotulo.charAt(0).toLowerCase()}${rotulo.slice(1)}.`,
    acao,
  }, { status: 403 });
}

/**
 * Verificação em duas etapas de quem vai pagar ou transferir agora (E7, ver
 * ./segundo-fator-pagador). `recusa` = 403 com `precisa_segundo_fator` (a tela
 * leva a Meu perfil); `aviso` = passa, mas a resposta avisa do prazo.
 */
export async function conferirSegundoFatorDoPagador(): Promise<{ recusa: NextResponse | null; aviso: string | null }> {
  const sessao = await getSession();
  if (!sessao) return { recusa: NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 }), aviso: null };
  const regra = regraDoPagador();
  const situacao = situacaoDoPagador(sessao, regra, hojeISO());
  if (situacao === 'bloqueio') {
    return {
      recusa: NextResponse.json({
        error: MENSAGEM_BLOQUEIO_PAGADOR, precisa_segundo_fator: true, onde_ativar: ONDE_ATIVAR_SEGUNDO_FATOR,
      }, { status: 403 }),
      aviso: null,
    };
  }
  return { recusa: null, aviso: situacao === 'aviso' ? mensagemAvisoPagador(regra.prazo) : null };
}

/**
 * Rotas que só servem para teste (apagar vendas, simular venda) não existem
 * em produção, a não ser que PERMITIR_ROTAS_DE_TESTE=1 seja ligado de
 * propósito. Responde 404, como se a rota não existisse.
 */
export function rotaDeTesteDesligada(): NextResponse | null {
  const producao = process.env.NODE_ENV === 'production';
  if (!producao || process.env.PERMITIR_ROTAS_DE_TESTE === '1') return null;
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

/**
 * Erro de período fechado (gatilho do banco) vira 423 com a frase pronta
 * para a tela (05/11/2026). Devolve null para os demais erros.
 */
export function respostaPeriodoFechado(e: unknown): NextResponse | null {
  const ate = periodoFechadoDoErro(e);
  if (!ate) return null;
  return NextResponse.json({ error: mensagemPeriodoFechado(ate), periodo_fechado_ate: ate }, { status: 423 });
}
