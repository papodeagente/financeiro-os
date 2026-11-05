/**
 * Ritmo das chamadas por agência: no máximo 2 por segundo (05/11/2026).
 *
 * A vez é RESERVADA na hora (antes de esperar), então chamadas simultâneas
 * da mesma agência entram em fila, cada uma meio segundo depois da outra.
 * Cada agência tem a sua vez: uma agência com 2 mil boletos não atrasa a
 * que tem um. Vale dentro do processo; a fila do agendador roda um
 * processo por vez (trava do banco), e a emissão "na hora" é uma só.
 */
import { ambienteDeCobranca, type AmbienteDeCobranca } from './http';

export const CHAMADAS_POR_SEGUNDO = 2;
const INTERVALO_MS = Math.ceil(1000 / CHAMADAS_POR_SEGUNDO);

const proximaVez = new Map<string, number>();

/** Espera a vez desta chave (agência). */
export async function aguardarVez(chave: string, ambiente?: AmbienteDeCobranca): Promise<void> {
  const amb = ambiente ?? ambienteDeCobranca();
  const agora = amb.agora();
  const quando = Math.max(agora, proximaVez.get(chave) ?? 0);
  proximaVez.set(chave, quando + INTERVALO_MS);
  if (quando > agora) await amb.dormir(quando - agora);
}

/** Esquece as vezes reservadas (testes). */
export function zerarLimitador(): void {
  proximaVez.clear();
}
