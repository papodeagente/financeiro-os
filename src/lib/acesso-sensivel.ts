/**
 * Registro de acesso a tela sensível (E7, 06/11/2026).
 *
 * Abrir dados sensíveis grava no Registro de atividades QUEM viu e QUANDO,
 * nunca o dado em si. Telas escolhidas (critério: dado de outra pessoa ou
 * segredo, que não aparece no dia a dia de todo mundo):
 *
 *   - folha             Pessoas › Folha: vínculo, salário e encargos da equipe
 *                       (GET /api/folha);
 *   - comissao_pessoa   painel de comissão de OUTRA pessoa
 *                       (GET /api/comissoes-por-funcao/painel?pessoa_id=...);
 *   - comissoes_equipe  comissões a pagar da equipe inteira
 *                       (GET /api/comissoes-por-funcao/a-pagar, quem vê todos).
 *
 * Já registravam antes e continuam: revelar a chave de integração com o CRM
 * (GET /api/v1/crm/config/secret) e toda exportação (EXPORTAR), que agora diz
 * quando o arquivo levou as colunas do ganho da agência (comissão, over,
 * receita).
 *
 * As outras chaves (plataformas, Sites, banco, nota fiscal) nunca voltam
 * abertas para a tela (só "tem segredo: sim"), então não há o que registrar.
 *
 * Para não encher o registro com cada recarga da tela, a mesma pessoa na
 * mesma tela (e no mesmo alvo) entra no máximo uma vez a cada 30 minutos por
 * processo. Falha ao registrar nunca derruba a tela.
 */
import { registrarEventoAuditoria } from './audit';
import type { SessionPayload } from './auth';

export const TELAS_SENSIVEIS = {
  folha: { modulo: 'Pessoas', entidade: 'folha', descricao: 'Abriu a folha de pagamento da equipe.' },
  comissao_pessoa: { modulo: 'Comissões', entidade: 'comissao_painel', descricao: 'Abriu o painel de comissão de outra pessoa.' },
  comissoes_equipe: { modulo: 'Comissões', entidade: 'comissoes_a_pagar', descricao: 'Abriu as comissões a pagar da equipe.' },
} as const;

export type TelaSensivel = keyof typeof TELAS_SENSIVEIS;

export const JANELA_DO_ACESSO_MS = 30 * 60 * 1000;

const ultimos = new Map<string, number>();

/** Puro: registra agora? Atualiza o mapa quando sim. */
export function deveRegistrarAcesso(
  chave: string, agora: number, mapa: Map<string, number> = ultimos, janela = JANELA_DO_ACESSO_MS,
): boolean {
  const antes = mapa.get(chave);
  if (antes !== undefined && agora - antes < janela) return false;
  mapa.set(chave, agora);
  if (mapa.size > 5_000) for (const [k, v] of mapa) if (agora - v >= janela) mapa.delete(k);
  return true;
}

/** Para os testes: esquece os acessos guardados. */
export function esquecerAcessosSensiveis(): void {
  ultimos.clear();
}

/**
 * Grava "fulano abriu tal tela". `alvo` = id do que foi aberto (ex.: a
 * pessoa cuja comissão foi vista), `detalhe` completa a frase. Nunca lança.
 */
export async function registrarAcessoSensivel(
  sessao: SessionPayload | null | undefined, tela: TelaSensivel, opcoes: { alvo?: string; detalhe?: string } = {},
): Promise<void> {
  if (!sessao?.userId) return;
  const tenantId = sessao.impersonatingTenantId || sessao.tenantId;
  if (!tenantId) return;
  const chave = `${tenantId}|${sessao.userId}|${tela}|${opcoes.alvo ?? ''}`;
  if (!deveRegistrarAcesso(chave, Date.now())) return;
  const def = TELAS_SENSIVEIS[tela];
  try {
    await registrarEventoAuditoria({
      tenantId, session: sessao, acao: 'VISUALIZAR', modulo: def.modulo, entidade: def.entidade,
      entidadeId: opcoes.alvo ?? '', descricao: opcoes.detalhe ? `${def.descricao} ${opcoes.detalhe}` : def.descricao,
    });
  } catch (e) {
    // Sem registro, a chave sai do mapa para tentar de novo na próxima abertura.
    ultimos.delete(chave);
    console.error('[acesso-sensivel] não registrou:', e instanceof Error ? e.message : e);
  }
}
