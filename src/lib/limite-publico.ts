/**
 * Teto de chamadas por janela, em memória, para as rotas públicas (proposta,
 * chat, ações do cliente). Uma réplica só; se o Financeiro passar a rodar com
 * várias, cada uma conta a sua parte, o que ainda limita.
 *
 * Auditoria 04/11/2026: FIN-09 (chat público sem orçamento) e FIN2-07
 * (escritores públicos sem limite).
 */
interface Balde { inicio: number; n: number; janela: number }

const baldes = new Map<string, Balde>();
const MAX_CHAVES = 50_000;

/**
 * Passou do teto de chaves: apaga só as vencidas. Nunca zera nem descarta
 * balde ativo (isso devolveria o orçamento a quem já estava no limite).
 */
function limpar(agora: number) {
  if (baldes.size < MAX_CHAVES) return;
  for (const [k, b] of baldes) if (agora - b.inicio >= b.janela) baldes.delete(k);
}

/**
 * true = pode seguir (e conta esta chamada); false = passou do teto.
 * Com o limitador lotado de baldes ativos (ataque com muitas origens), chave
 * NOVA é recusada até abrir espaço: falha fechada, como um 429.
 */
export function permitirChamada(chave: string, maximo: number, janelaMs: number, agora = Date.now()): boolean {
  const b = baldes.get(chave);
  if (!b || agora - b.inicio >= janelaMs) {
    if (!b) {
      limpar(agora);
      if (baldes.size >= MAX_CHAVES) return false;
    }
    baldes.set(chave, { inicio: agora, n: 1, janela: janelaMs });
    return true;
  }
  if (b.n >= maximo) return false;
  b.n++;
  return true;
}

export function limparLimitePublicoParaTeste() {
  baldes.clear();
}

export function quantidadeDeBaldesParaTeste(): number {
  return baldes.size;
}

/**
 * IP do visitante, como o resto do sistema lê (src/lib/limite-login.ts): o
 * que o proxy grava (x-real-ip / cf-connecting-ip). O PRIMEIRO item do
 * X-Forwarded-For vem do próprio visitante e é forjável; na falta dos outros,
 * vale o ÚLTIMO, que é o que o nosso proxy acrescentou.
 */
export function ipDaRequisicao(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim() || req.headers.get('cf-connecting-ip')?.trim();
  if (real) return real.slice(0, 64);
  const saltos = (req.headers.get('x-forwarded-for') ?? '').split(',').map(x => x.trim()).filter(Boolean);
  return (saltos.at(-1) || 'sem-ip').slice(0, 64);
}
