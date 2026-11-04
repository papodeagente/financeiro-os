/**
 * Limite de tentativas de login (FIN-12, auditoria de 04/11/2026).
 *
 * Login comum e de superadmin aceitavam tentativas sem limite: dava para
 * testar senhas em massa. Agora, numa janela de 15 minutos:
 *   - cada IP faz no máximo 30 tentativas (certas ou erradas);
 *   - cada conta (e-mail) aceita no máximo 8 senhas erradas.
 * Estourou, responde 429 até a janela passar. A conferência vem ANTES de
 * calcular o hash, para o ataque nem gastar CPU.
 *
 * Em memória, por réplica (mesmo modelo do limitador do webhook do Sites).
 * Com duas réplicas o teto efetivo dobra, o que ainda inviabiliza força bruta.
 */
const JANELA_MS = 15 * 60_000;
const LIMITE_IP = 30;
const LIMITE_CONTA = 8;
const MAX_CHAVES = 20_000;

interface Balde { inicio: number; quantidade: number }

const porIp = new Map<string, Balde>();
const porConta = new Map<string, Balde>();

function vigente(mapa: Map<string, Balde>, chave: string, agora: number): Balde | null {
  const b = mapa.get(chave);
  if (!b) return null;
  if (agora - b.inicio >= JANELA_MS) {
    mapa.delete(chave);
    return null;
  }
  return b;
}

function somar(mapa: Map<string, Balde>, chave: string, agora: number) {
  const b = vigente(mapa, chave, agora);
  if (b) b.quantidade += 1;
  else mapa.set(chave, { inicio: agora, quantidade: 1 });
  if (mapa.size > MAX_CHAVES) {
    for (const [k, v] of mapa) if (agora - v.inicio >= JANELA_MS) mapa.delete(k);
    while (mapa.size > MAX_CHAVES) mapa.delete(mapa.keys().next().value as string);
  }
}

function restante(b: Balde, agora: number): number {
  return Math.max(1, Math.ceil((b.inicio + JANELA_MS - agora) / 1000));
}

export function ipDoLogin(headers: Headers): string {
  // O Traefik sobrescreve X-Real-IP com o IP que chegou nele; X-Forwarded-For
  // fica de fora porque o cliente consegue antepor valores.
  const valor = (headers.get('x-real-ip') || headers.get('cf-connecting-ip') || 'desconhecido').trim().slice(0, 64);
  return /^[0-9a-f:.]+$/i.test(valor) ? valor : 'desconhecido';
}

/**
 * Registra a tentativa e diz se pode seguir. `escopo` separa o login comum
 * do login da plataforma. Devolve os segundos de espera, ou null.
 */
export function bloqueioDeLogin(escopo: string, ip: string, email: string, agora = Date.now()): number | null {
  const conta = vigente(porConta, `${escopo}:${email}`, agora);
  if (conta && conta.quantidade >= LIMITE_CONTA) return restante(conta, agora);
  somar(porIp, `${escopo}:${ip}`, agora);
  const doIp = vigente(porIp, `${escopo}:${ip}`, agora)!;
  if (doIp.quantidade > LIMITE_IP) return restante(doIp, agora);
  return null;
}

export function registrarFalhaDeLogin(escopo: string, email: string, agora = Date.now()) {
  somar(porConta, `${escopo}:${email}`, agora);
}

export function registrarSucessoDeLogin(escopo: string, email: string) {
  porConta.delete(`${escopo}:${email}`);
}

export function limparLimiteDeLoginParaTeste() {
  porIp.clear();
  porConta.clear();
}
