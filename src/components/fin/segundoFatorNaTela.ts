'use client';

import { toast } from '@/lib/toast';

/**
 * Verificação em duas etapas para quem paga (E7). As rotas de pagamento
 * respondem 403 com `precisa_segundo_fator` quando a pessoa ainda não ativou
 * o código; até o prazo, passam e trazem `aviso_segundo_fator`. Estas duas
 * funções dão o aviso com o botão que leva a Meu perfil.
 */
export const ONDE_ATIVAR = '/perfil#segundo-fator';

export interface RespostaComSegundoFator {
  error?: string;
  precisa_segundo_fator?: boolean;
  aviso_segundo_fator?: string;
}

function irParaAtivar(): void {
  window.location.assign(ONDE_ATIVAR);
}

/** Recusa por falta do código: mostra o aviso com "Ativar agora". Devolve true se era isso. */
export function levarParaSegundoFator(status: number, corpo: RespostaComSegundoFator): boolean {
  if (status !== 403 || !corpo?.precisa_segundo_fator) return false;
  toast.comAcao(
    'Ative a verificação em duas etapas',
    corpo.error || 'Para pagar e transferir, ative o código do aplicativo autenticador. Leva um minuto.',
    { rotulo: 'Ativar agora', onClick: irParaAtivar },
  );
  return true;
}

/** Pagamento feito, mas o prazo está chegando: lembra com o mesmo botão. */
export function lembrarSegundoFator(corpo: RespostaComSegundoFator | null | undefined): void {
  if (!corpo?.aviso_segundo_fator) return;
  toast.comAcao('Verificação em duas etapas', corpo.aviso_segundo_fator, { rotulo: 'Ativar agora', onClick: irParaAtivar });
}
