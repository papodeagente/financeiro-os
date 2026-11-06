/**
 * Chamadas das telas de notas por regra e retenções (E5, parte E). Contrato
 * das rotas em src/lib/nota-regras-rota.ts. Dinheiro em centavos.
 */
import type { DataDaNota, RegraDaNota } from '@/lib/nota-regras';
import type { RetencaoDoCliente } from '@/lib/nota-retencoes';
import type {
  ConfigNotas, GradeDeNotas, PreviaDeNotas, ResultadoDaEmissao, SelecaoDeNotas,
} from '@/lib/nota-regras-servidor';

export type { ConfigNotas, GradeDeNotas, PreviaDeNotas, ResultadoDaEmissao, SelecaoDeNotas };

export class ErroDaNota extends Error {
  constructor(public codigo: string, mensagem: string, public status: number, public detalhes?: unknown) {
    super(mensagem);
  }
}

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroDaNota(String(j?.codigo ?? 'ERRO'), String(j?.error ?? 'A operação não respondeu.'), r.status, j?.detalhes);
  return j as T;
}

export const apiNotas = {
  grade: (f: {
    de: string; ate: string; busca?: string; pendentes?: boolean;
    data_de?: 'VENDA' | 'EMBARQUE'; tipo?: string; vendedor?: string; fornecedor?: string; pagina?: number;
  }, signal?: AbortSignal) => {
    const q = new URLSearchParams({ de: f.de, ate: f.ate });
    if (f.busca) q.set('busca', f.busca);
    if (f.pendentes) q.set('pendentes', '1');
    if (f.data_de === 'EMBARQUE') q.set('data_de', 'EMBARQUE');
    if (f.tipo) q.set('tipo', f.tipo);
    if (f.vendedor) q.set('vendedor', f.vendedor);
    if (f.fornecedor) q.set('fornecedor', f.fornecedor);
    if (f.pagina && f.pagina > 1) q.set('pagina', String(f.pagina));
    return chamar<GradeDeNotas>(`/api/fiscal/gerar?${q}`, { signal });
  },
  previa: (selecao: SelecaoDeNotas[], data_da_nota?: DataDaNota) =>
    chamar<PreviaDeNotas>('/api/fiscal/gerar/previa', { method: 'POST', body: JSON.stringify({ selecao, data_da_nota }) }),
  emitir: (selecao: SelecaoDeNotas[], assinatura: string, data_da_nota?: DataDaNota) =>
    chamar<ResultadoDaEmissao>('/api/fiscal/gerar', { method: 'POST', body: JSON.stringify({ selecao, assinatura, data_da_nota }) }),
  registrarNotaDeFora: (n: Record<string, unknown>) =>
    chamar<{ nota: { id: string; numero: string }; repetida: boolean }>('/api/fiscal/notas-externas', { method: 'POST', body: JSON.stringify(n) }),
  cancelarNota: (id: string, motivo: string) =>
    chamar<unknown>(`/api/fiscal/notas/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ motivo }) }),
  regras: () => chamar<{ regras: RegraDaNota[]; config: ConfigNotas; sugerida: RegraDaNota }>('/api/fiscal/regras'),
  salvarRegra: (r: RegraDaNota) => r.id
    ? chamar<RegraDaNota>(`/api/fiscal/regras/${encodeURIComponent(r.id)}`, { method: 'PUT', body: JSON.stringify(r) })
    : chamar<RegraDaNota>('/api/fiscal/regras', { method: 'POST', body: JSON.stringify(r) }),
  apagarRegra: (id: string) => chamar<{ ok: true }>(`/api/fiscal/regras/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  salvarConfig: (c: ConfigNotas) => chamar<ConfigNotas>('/api/fiscal/notas-config', { method: 'PUT', body: JSON.stringify(c) }),
  retencoes: () => chamar<{ retencoes: RetencaoDoCliente[] }>('/api/fiscal/retencoes'),
  salvarRetencao: (r: RetencaoDoCliente) => r.id
    ? chamar<RetencaoDoCliente>(`/api/fiscal/retencoes/${encodeURIComponent(r.id)}`, { method: 'PUT', body: JSON.stringify(r) })
    : chamar<RetencaoDoCliente>('/api/fiscal/retencoes', { method: 'POST', body: JSON.stringify(r) }),
  apagarRetencao: (id: string) => chamar<{ ok: true }>(`/api/fiscal/retencoes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const reais = (centavos: number) => Math.round(centavos) / 100;

export function formatarPercentual(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
}
