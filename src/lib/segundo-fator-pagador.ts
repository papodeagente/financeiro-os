/**
 * Verificação em duas etapas para quem paga (E7, 06/11/2026).
 *
 * Antes, o código do aplicativo autenticador era obrigatório só para o
 * administrador da agência e para o superadmin (./segundo-fator, no login).
 * Agora vale também para quem PAGA sem ser administrador: dar baixa em conta
 * a pagar, efetivar ou desfazer transferência e aprovar pedido de pagamento.
 *
 * Como funciona, sem tirar o acesso ao resto:
 *   - quem já tem o aplicativo cadastrado entra com senha e código (como o
 *     administrador) e a sessão sai marcada `sf: true`;
 *   - quem ainda não cadastrou entra só com a senha e usa tudo normalmente;
 *     na hora de pagar, a rota responde 403 `precisa_segundo_fator` e a tela
 *     leva a pessoa a Meu perfil › Verificação em duas etapas. Ao cadastrar
 *     ali, a sessão é trocada por uma com `sf: true` e o pagamento segue.
 *
 * Mudança para quem já paga hoje, com prazo e escape:
 *   - até o prazo (PRAZO_PADRAO_PAGADOR, ou SEGUNDO_FATOR_PAGADOR_PRAZO=AAAA-MM-DD
 *     no ambiente), o pagamento passa e a resposta traz `aviso_segundo_fator`;
 *   - a partir do prazo, sem o código, o pagamento é recusado;
 *   - SEGUNDO_FATOR_PAGADOR=0 desliga a exigência para quem não é
 *     administrador (escape de emergência; o administrador segue exigido).
 *
 * Versão por agência (14/11/2026): a exigência é da versão COMPLETA. Só vale
 * na agência com o módulo "Núcleo completo" (modulos.ts); na versão simples,
 * pagar e transferir seguem como sempre (`nucleo: false` → livre). O
 * administrador continua com o código no login nas duas (./segundo-fator).
 *
 * Puro (sem banco e sem Next): a rota decide com `situacaoDoPagador`; quem lê
 * o módulo da agência é segundo-fator-pagador-servidor.ts.
 */
import { nuncaRestringido } from './acoes-financeiras';

/** Data a partir da qual quem paga sem o código é recusado (antes: só aviso). */
export const PRAZO_PADRAO_PAGADOR = '2026-11-23';

export interface RegraDoPagador {
  ligado: boolean;
  /** AAAA-MM-DD: a partir deste dia (inclusive) recusa; antes, só avisa. */
  prazo: string;
}

export function regraDoPagador(env: Record<string, string | undefined> = process.env): RegraDoPagador {
  const ligado = env.SEGUNDO_FATOR_PAGADOR !== '0';
  const pedido = (env.SEGUNDO_FATOR_PAGADOR_PRAZO ?? '').trim();
  const prazo = /^\d{4}-\d{2}-\d{2}$/.test(pedido) ? pedido : PRAZO_PADRAO_PAGADOR;
  return { ligado, prazo };
}

export interface QuemPaga {
  perfil?: string;
  isSuperAdmin?: boolean;
  /** Segundo fator provado nesta sessão (login com código ou cadastro agora). */
  sf?: boolean;
  /**
   * A agência tem o núcleo completo? `false` = versão simples: livre.
   * Ausente = como antes (exige), para quem ainda não informa.
   */
  nucleo?: boolean;
}

export type SituacaoDoPagador = 'livre' | 'aviso' | 'bloqueio';

/**
 * O que fazer com quem vai pagar agora. Administrador e superadmin já
 * passaram pelo código no login: livres. Quem provou o código: livre.
 */
export function situacaoDoPagador(quem: QuemPaga, regra: RegraDoPagador, hoje: string): SituacaoDoPagador {
  if (quem.nucleo === false) return 'livre';
  if (nuncaRestringido(quem)) return 'livre';
  if (quem.sf === true) return 'livre';
  if (!regra.ligado) return 'livre';
  return hoje < regra.prazo ? 'aviso' : 'bloqueio';
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export const MENSAGEM_BLOQUEIO_PAGADOR =
  'Para pagar e transferir, ative a verificação em duas etapas em Meu perfil. O resto do sistema continua liberado.';

export function mensagemAvisoPagador(prazo: string): string {
  return `A partir de ${dataBR(prazo)}, pagar e transferir vão pedir a verificação em duas etapas. Ative agora em Meu perfil.`;
}

/** Endereço da tela onde a pessoa ativa o código. */
export const ONDE_ATIVAR_SEGUNDO_FATOR = '/perfil#segundo-fator';
