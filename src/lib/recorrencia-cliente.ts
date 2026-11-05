/**
 * Chamadas da tela às rotas de recorrência (05/11/2026). Cada função devolve
 * os dados ou lança Error com a mensagem do servidor, pronta para o toast.
 */
import type { ChavePreset, EstadoRepeticao, ModoSerie, RegraRecorrencia, TabelaAlvo } from './recorrencia';
import { regraDoEstado } from './recorrencia';

async function chamar<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new Error('Sem conexão com o servidor. Nada foi gravado.');
  }
  let corpo: unknown = null;
  try { corpo = await res.json(); } catch { corpo = null; }
  if (!res.ok) {
    const msg = corpo && typeof corpo === 'object' && typeof (corpo as { error?: unknown }).error === 'string'
      ? (corpo as { error: string }).error : `Não foi possível concluir (erro ${res.status}).`;
    throw new Error(msg);
  }
  return corpo as T;
}

export interface TituloGeradoNaTela { id: string; ordem: number; vencimento: string; valor: number }

export interface RespostaCriacao {
  ok: true;
  criados: number;
  ja_existia: boolean;
  titulos: TituloGeradoNaTela[];
  serie: { id: string; descricao_regra: string; total: number | null };
}

/** Cria a série (repetição ou parcelamento) com os títulos, numa transação. */
export function criarSerie(p: {
  id: string;
  tabela: TabelaAlvo;
  estado: EstadoRepeticao;
  inicio: string;
  valor: number;
  modelo: Record<string, unknown>;
}): Promise<RespostaCriacao> {
  const regra: RegraRecorrencia = regraDoEstado(p.estado);
  const tipo: ModoSerie = p.estado.modo;
  return chamar('/api/recorrencias', {
    method: 'POST',
    body: JSON.stringify({ modo: 'gravar', id: p.id, tabela: p.tabela, tipo, regra, inicio: p.inicio, valor: p.valor, modelo: p.modelo }),
  });
}

export interface SerieNaTela {
  serie: { id: string; descricao_regra: string; modo: ModoSerie; status: 'ativa' | 'concluida' | 'encerrada'; versao: number; total: number | null; regra: RegraRecorrencia };
  titulos: { id: string; ordem: number; vencimento: string; valor: number; status: string; descricao: string }[];
}

export function lerSerie(id: string): Promise<SerieNaTela> {
  return chamar(`/api/recorrencias/${encodeURIComponent(id)}`, { method: 'GET' });
}

export type EscopoDaEdicao = 'so_esta' | 'esta_e_proximas' | 'todas';

export interface RespostaEdicao {
  alterados: { id: string; ordem: number; vencimento: string }[];
  intocados: { id: string; ordem: number; motivo: string }[];
  versao: number;
}

export function editarSerie(serieId: string, p: {
  escopo: EscopoDaEdicao; titulo_id: string; alteracoes: Record<string, unknown>; versao?: number; previa?: boolean;
}): Promise<RespostaEdicao> {
  return chamar(`/api/recorrencias/${encodeURIComponent(serieId)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...p, modo: p.previa ? 'previa' : 'gravar' }),
  });
}

export interface RespostaEncerramento {
  removidos: { id: string; ordem: number; vencimento: string; valor: number }[];
  mantidos: number;
  soma: number;
}

export function encerrarSerie(serieId: string, p: { aPartirDe?: string; previa: boolean }): Promise<RespostaEncerramento> {
  const q = new URLSearchParams();
  if (p.aPartirDe) q.set('a_partir_de', p.aPartirDe);
  if (p.previa) q.set('previa', '1');
  return chamar(`/api/recorrencias/${encodeURIComponent(serieId)}?${q.toString()}`, { method: 'DELETE' });
}

export interface RespostaMaisParcelas {
  serie_id: string;
  parcelas: { id: string; ordem: number; vencimento: string; emissao: string; valor: number }[];
  criadas: number;
  ja_feito: boolean;
}

export function maisParcelas(p: {
  tabela: TabelaAlvo; titulo_id: string; quantidade: number; periodicidade: ChavePreset;
  emissao_no_vencimento: boolean; previa: boolean; chave?: string;
}): Promise<RespostaMaisParcelas> {
  return chamar('/api/recorrencias/mais-parcelas', {
    method: 'POST',
    body: JSON.stringify({ ...p, modo: p.previa ? 'previa' : 'gravar' }),
  });
}

export interface RespostaCopiarMes {
  quantidade: number;
  ja_copiadas: number;
  soma: number;
  copiadas: number;
}

export function copiarMes(p: { tabela: TabelaAlvo; mes_origem: string; mes_destino: string; previa: boolean }): Promise<RespostaCopiarMes> {
  return chamar('/api/recorrencias/copiar-mes', {
    method: 'POST',
    body: JSON.stringify({ ...p, modo: p.previa ? 'previa' : 'gravar' }),
  });
}

/** Id novo para uma série, gerado ao abrir o formulário: o duplo clique reusa. */
export function novoIdDeSerie(): string {
  return `rec-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}
