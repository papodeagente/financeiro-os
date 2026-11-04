/**
 * Teto de chamadas por janela, em memória, para as rotas públicas (proposta,
 * chat, ações do cliente). Uma réplica só; se o Financeiro passar a rodar com
 * várias, cada uma conta a sua parte, o que ainda limita.
 *
 * Auditoria 04/11/2026: FIN-09 (chat público sem orçamento) e FIN2-07
 * (escritores públicos sem limite).
 */
interface Balde { inicio: number; n: number }

const baldes = new Map<string, Balde>();
const MAX_CHAVES = 50_000;

function limpar(agora: number) {
  if (baldes.size < MAX_CHAVES) return;
  for (const [k, b] of baldes) if (agora - b.inicio > 24 * 3600_000) baldes.delete(k);
  if (baldes.size >= MAX_CHAVES) baldes.clear();
}

/** true = pode seguir (e conta esta chamada); false = passou do teto. */
export function permitirChamada(chave: string, maximo: number, janelaMs: number, agora = Date.now()): boolean {
  limpar(agora);
  const b = baldes.get(chave);
  if (!b || agora - b.inicio >= janelaMs) {
    baldes.set(chave, { inicio: agora, n: 1 });
    return true;
  }
  if (b.n >= maximo) return false;
  b.n++;
  return true;
}

export function limparLimitePublicoParaTeste() {
  baldes.clear();
}

/** IP do visitante atrás do proxy (primeiro da lista), ou 'sem-ip'. */
export function ipDaRequisicao(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || 'sem-ip';
}
