/**
 * Cliente HTTP da cobrança, com tudo o que fala com fora injetável:
 * `fetch`, relógio e espera. Os testes trocam por provedores falsos e
 * nenhuma chamada de rede acontece fora de produção.
 *
 * Toda chamada passa pelo `limitador` da agência antes de sair (2 por
 * segundo por agência) e volta como JSON ou como `ErroProvedor` com o tipo
 * certo para a fila decidir se repete.
 */
import { ErroProvedor } from './tipos';

export type Buscador = (url: string, init?: RequestInit) => Promise<Response>;

export interface AmbienteDeCobranca {
  fetch: Buscador;
  /** Milissegundos desde a época. */
  agora: () => number;
  dormir: (ms: number) => Promise<void>;
  timeoutMs: number;
}

const PADRAO: AmbienteDeCobranca = {
  fetch: (url, init) => fetch(url, init),
  agora: () => Date.now(),
  dormir: ms => new Promise(r => setTimeout(r, ms)),
  timeoutMs: 20_000,
};

let atual: AmbienteDeCobranca = { ...PADRAO };

/** O ambiente em uso (produção: fetch de verdade). */
export function ambienteDeCobranca(): AmbienteDeCobranca {
  return atual;
}

/** Troca partes do ambiente (testes). Devolve a função que desfaz. */
export function definirAmbienteDeCobranca(parcial: Partial<AmbienteDeCobranca>): () => void {
  const antes = atual;
  atual = { ...atual, ...parcial };
  return () => { atual = antes; };
}

export interface OpcoesChamada {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  corpo?: unknown;
  /** Resposta binária (PDF do carnê). */
  binario?: boolean;
}

export interface ClienteHttp {
  chamar<T = unknown>(caminho: string, opcoes?: OpcoesChamada): Promise<T>;
  chamarBinario(caminho: string): Promise<{ conteudo: ArrayBuffer; tipo: string }>;
}

/** Frase do provedor, sem nada que pareça dado sensível. */
export type LeitorDeErro = (corpo: unknown, status: number) => string;

export function criarClienteHttp(o: {
  base: string;
  cabecalhos: Record<string, string>;
  nome: string;
  lerErro: LeitorDeErro;
  /** Espera a vez da agência antes de cada chamada. */
  antesDeChamar?: () => Promise<void>;
  ambiente?: AmbienteDeCobranca;
}): ClienteHttp {
  async function executar(caminho: string, opcoes: OpcoesChamada): Promise<Response> {
    const amb = o.ambiente ?? ambienteDeCobranca();
    if (o.antesDeChamar) await o.antesDeChamar();
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), amb.timeoutMs);
    let res: Response;
    try {
      res = await amb.fetch(`${o.base}${caminho}`, {
        method: opcoes.metodo ?? 'GET',
        headers: {
          ...o.cabecalhos,
          Accept: opcoes.binario ? 'application/pdf' : 'application/json',
          ...(opcoes.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
        signal: controle.signal,
      });
    } catch (e) {
      const abortado = controle.signal.aborted || (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError'));
      // Timeout NÃO quer dizer que não foi criado: quem chamou consulta pela
      // referência antes de repetir.
      throw new ErroProvedor(
        abortado ? 'timeout' : 'rede',
        abortado ? `O ${o.nome} demorou demais para responder.` : `Não foi possível falar com o ${o.nome}.`,
      );
    } finally {
      clearTimeout(relogio);
    }
    if (res.ok) return res;

    let corpo: unknown = null;
    try { corpo = await res.json(); } catch { corpo = null; }
    const frase = o.lerErro(corpo, res.status);
    if (res.status === 429) {
      const reset = Number(res.headers.get('ratelimit-reset') ?? res.headers.get('retry-after') ?? '');
      throw new ErroProvedor('limite', `O ${o.nome} pediu para esperar (limite de chamadas).`, 429,
        Number.isFinite(reset) && reset > 0 ? reset : null);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ErroProvedor('credencial', `O ${o.nome} recusou a chave de acesso. Confira a integração em Configurações.`, res.status);
    }
    if (res.status === 404) throw new ErroProvedor('nao_encontrado', frase || `Não encontrado no ${o.nome}.`, 404);
    if (res.status >= 500) throw new ErroProvedor('servidor', `O ${o.nome} está com instabilidade (erro ${res.status}).`, res.status);
    throw new ErroProvedor('recusa', frase || `O ${o.nome} recusou o pedido (erro ${res.status}).`, res.status);
  }

  return {
    async chamar<T>(caminho: string, opcoes: OpcoesChamada = {}): Promise<T> {
      const res = await executar(caminho, opcoes);
      const texto = await res.text();
      if (!texto) return {} as T;
      try {
        return JSON.parse(texto) as T;
      } catch {
        throw new ErroProvedor('servidor', `O ${o.nome} respondeu algo que não é JSON.`, res.status);
      }
    },
    async chamarBinario(caminho: string) {
      const res = await executar(caminho, { binario: true });
      return { conteudo: await res.arrayBuffer(), tipo: res.headers.get('content-type') || 'application/pdf' };
    },
  };
}
