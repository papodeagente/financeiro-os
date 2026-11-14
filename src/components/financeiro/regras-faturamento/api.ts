/**
 * Chamadas das telas de Regras de faturamento (E5, parte B). Contrato das
 * rotas no topo de src/lib/fatura-rota.ts. Erro vira ErroDaRegra com a frase
 * do servidor e o código (REGRA_REPETIDA traz o id da regra que já existe).
 */
import type { ErroDaRegra as ErroDeCampo, PreviaDaFatura, RegraDeFaturamento } from '@/lib/fatura-regras';
import type { MudancaDeVencimento } from '@/lib/fatura-servidor';

export type RegraNaLista = RegraDeFaturamento & { descricao_curta: string };

export class ErroDaTela extends Error {
  constructor(public status: number, mensagem: string, public codigo: string | null, public detalhes: Record<string, unknown> | null) {
    super(mensagem);
  }
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ErroDaTela(0, 'Sem conexão. Confira a internet e tente de novo.', null, null);
  }
  const corpo = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) {
    throw new ErroDaTela(
      r.status,
      typeof corpo?.error === 'string' ? corpo.error : 'Não foi possível concluir agora. Tente de novo.',
      typeof corpo?.codigo === 'string' ? corpo.codigo : null,
      (corpo?.detalhes && typeof corpo.detalhes === 'object' ? corpo.detalhes : null) as Record<string, unknown> | null,
    );
  }
  return corpo as T;
}

export const apiRegras = {
  listar: (filtro: { pessoa_tipo?: string; inativas?: boolean } = {}, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (filtro.pessoa_tipo) q.set('pessoa_tipo', filtro.pessoa_tipo);
    if (filtro.inativas) q.set('inativas', '1');
    return pedir<{ regras: RegraNaLista[] }>(`/api/regras-faturamento${q.size ? `?${q}` : ''}`, { signal });
  },
  criar: (regra: Partial<RegraDeFaturamento>) =>
    pedir<{ regra: RegraDeFaturamento; descricao_curta: string }>('/api/regras-faturamento', { method: 'POST', body: JSON.stringify({ regra }) }),
  alterar: (id: string, regra: Partial<RegraDeFaturamento>) =>
    pedir<{ regra: RegraDeFaturamento; descricao_curta: string }>(`/api/regras-faturamento/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ regra }) }),
  desligar: (id: string) => pedir<{ ok: true }>(`/api/regras-faturamento/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  previa: (regra: Partial<RegraDeFaturamento>, signal?: AbortSignal) =>
    pedir<{ descricao: string; proximas: PreviaDaFatura[]; erros: ErroDeCampo[] }>('/api/regras-faturamento/previa', { method: 'POST', body: JSON.stringify({ regra }), signal }),
  recalcular: (pessoa_id: string, aplicar: boolean) =>
    pedir<{ mudancas: MudancaDeVencimento[]; faturas_afetadas: number[]; aplicado: boolean }>('/api/regras-faturamento/recalcular', { method: 'POST', body: JSON.stringify({ pessoa_id, aplicar }) }),
};

export interface PessoaDoCadastro { id: string; nome: string; documento: string }

const SO_DIGITOS = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Clientes e fornecedores do cadastro, para escolher de quem é a regra. */
export async function carregarPessoas(tipo: 'CLIENTE' | 'FORNECEDOR' | 'REPRESENTANTE', signal?: AbortSignal): Promise<PessoaDoCadastro[]> {
  const url = tipo === 'CLIENTE' ? '/api/clientes' : '/api/fornecedores-crm';
  const lista = await pedir<Array<Record<string, unknown>>>(url, { signal });
  if (!Array.isArray(lista)) return [];
  return lista
    .map(d => ({
      id: String(d.id ?? ''),
      nome: String((tipo === 'CLIENTE' ? d.nome || d.nome_completo || d.razao_social || d.nome_fantasia : d.nome_fantasia || d.razao_social || d.nome) ?? '').trim(),
      documento: SO_DIGITOS(d.cpf_cnpj || d.cnpj || d.cpf),
    }))
    .filter(p => p.id)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
