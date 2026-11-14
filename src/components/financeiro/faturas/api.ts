/**
 * Chamadas das telas de faturas (E5, parte B) às rotas /api/faturas/*.
 * Contrato no topo de src/lib/fatura-rota.ts. Dinheiro em centavos.
 * Erro do servidor vira ErroDaFatura com a frase pronta e o código.
 */
import type { FichaDaFatura } from '@/lib/fatura-rota';
import type {
  AjusteDaFatura, FiltroDasFaturas, ItemAFaturar, ResultadoDaAlocacao, ResumoDaFatura,
} from '@/lib/fatura-servidor';
import type { CampoDaFatura, ConfigRetencoes, LinhaDoArquivo, ModeloDeFatura, RelatorioDaConferencia } from '@/lib/fatura-regras';

export type { FichaDaFatura, ResumoDaFatura, ItemAFaturar, AjusteDaFatura, ResultadoDaAlocacao, RelatorioDaConferencia };

export class ErroDaFatura extends Error {
  constructor(mensagem: string, public status: number, public codigo: string | null, public detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroDaFatura';
  }
}

async function chamar<T>(url: string, init?: RequestInit & { json?: unknown; chave?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init?.chave) headers['Idempotency-Key'] = init.chave;
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body, cache: 'no-store' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ErroDaFatura('Sem conexão com o servidor. Confira a internet e tente de novo.', 0, 'REDE');
  }
  const corpo = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) {
    const msg = typeof corpo?.error === 'string' ? corpo.error : 'Não foi possível concluir agora. Tente de novo.';
    throw new ErroDaFatura(msg, r.status, typeof corpo?.codigo === 'string' ? corpo.codigo : null, corpo?.detalhes);
  }
  return corpo as T;
}

const enc = encodeURIComponent;

export interface RespostaDaLista {
  faturas: ResumoDaFatura[];
  totais: { quantidade: number; total_centavos: number; recebido_centavos: number; em_aberto_centavos: number } | null;
}

export interface CobrancaDaTela {
  id: string;
  status: string;
  tipo: string;
  linha_digitavel: string | null;
  pix_copia_cola: string | null;
  url_boleto: string | null;
  erro: string | null;
}

export const apiFaturas = {
  listar(f: Pick<FiltroDasFaturas, 'de' | 'ate' | 'campo_data' | 'situacao' | 'busca' | 'pessoa_id'>, signal?: AbortSignal) {
    const q = new URLSearchParams();
    if (f.de) q.set('de', f.de);
    if (f.ate) q.set('ate', f.ate);
    if (f.campo_data) q.set('campo', f.campo_data);
    if (f.situacao) q.set('situacao', f.situacao);
    if (f.busca) q.set('busca', f.busca);
    if (f.pessoa_id) q.set('pessoa_id', f.pessoa_id);
    return chamar<RespostaDaLista>(`/api/faturas?${q}`, { signal });
  },
  alocar: () => chamar<ResultadoDaAlocacao>('/api/faturas/alocar', { method: 'POST', json: {} }),
  aFaturar: (signal?: AbortSignal) => chamar<{ itens: ItemAFaturar[]; notas: AjusteDaFatura[] }>('/api/faturas/a-faturar', { signal }),
  avulsaDeItens: (conta_ids: string[], vencimento?: string) =>
    chamar<FichaDaFatura>('/api/faturas/avulsa', { method: 'POST', json: { conta_ids, vencimento } }),
  avulsaDeNotas: (pessoa_id: string, vencimento?: string) =>
    chamar<FichaDaFatura>('/api/faturas/avulsa', { method: 'POST', json: { pessoa_id, notas: true, vencimento } }),
  ficha: (id: string, signal?: AbortSignal) => chamar<FichaDaFatura>(`/api/faturas/${enc(id)}`, { signal }),
  ajustar: (id: string, mudanca: { modelo?: ModeloDeFatura; campos?: CampoDaFatura[]; observacoes?: string; retencoes?: ConfigRetencoes }) =>
    chamar<FichaDaFatura>(`/api/faturas/${enc(id)}`, { method: 'PATCH', json: mudanca }),
  fechar: (id: string) => chamar<FichaDaFatura>(`/api/faturas/${enc(id)}/fechar`, { method: 'POST', json: {} }),
  reabrir: (id: string, motivo: string) => chamar<FichaDaFatura>(`/api/faturas/${enc(id)}/reabrir`, { method: 'POST', json: { motivo } }),
  cobrar: (id: string, chave: string) =>
    chamar<{ ficha: FichaDaFatura; cobranca: CobrancaDaTela | null }>(`/api/faturas/${enc(id)}/cobrar`, { method: 'POST', json: {}, chave }),
  itens: (id: string, corpo: Record<string, unknown>) =>
    chamar<FichaDaFatura & { destino_id: string | null }>(`/api/faturas/${enc(id)}/itens`, { method: 'POST', json: corpo }),
  lancarNota: (id: string, nota: { tipo: 'CREDITO' | 'DEBITO'; valor_centavos: number; motivo: string; proxima?: boolean }) =>
    chamar<FichaDaFatura>(`/api/faturas/${enc(id)}/notas`, { method: 'POST', json: nota }),
  removerNota: (id: string, nota: string) => chamar<FichaDaFatura>(`/api/faturas/${enc(id)}/notas?nota=${enc(nota)}`, { method: 'DELETE' }),
  levarSaldo: (id: string) => chamar<FichaDaFatura>(`/api/faturas/${enc(id)}/saldo`, { method: 'POST', json: {} }),
  conferir: (id: string, linhas: LinhaDoArquivo[], arquivo: string) =>
    chamar<{ relatorio: RelatorioDaConferencia; ficha: FichaDaFatura }>(`/api/faturas/${enc(id)}/conferencia`, { method: 'POST', json: { linhas, arquivo } }),
  urlExportar: (id: string, formato: 'csv' | 'xlsx') => `/api/faturas/${enc(id)}/exportar?formato=${formato}`,
};

/** Chave de idempotência gerada na tela (um pedido = uma chave; repetir o clique não cobra em dobro). */
export function novaChave(prefixo: string): string {
  const aleatorio = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefixo}-${aleatorio}`;
}
