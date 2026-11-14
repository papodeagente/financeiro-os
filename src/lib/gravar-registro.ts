/**
 * Gravar um registro pela tela e SABER quando não gravou (06/11/2026, E7).
 *
 * `updateEntity` (crm-storage) devolve o corpo da resposta mesmo quando o
 * servidor recusa, e as telas antigas dependem disso. As telas de títulos e
 * de contas bancárias usam esta função: resposta fora de 2xx vira
 * `ErroAoGravar`, com o que a tela precisa para reagir:
 *   - `conflito`: outra pessoa gravou depois que esta tela abriu (409). A
 *     tela oferece recarregar (AvisoDeEdicaoSimultanea);
 *   - `vendaId`: o campo só muda pela venda; a tela mostra "Abrir a venda".
 */

export class ErroAoGravar extends Error {
  readonly status: number;
  readonly conflito: boolean;
  readonly vendaId: string | null;
  readonly corpo: Record<string, unknown>;
  constructor(mensagem: string, status: number, corpo: Record<string, unknown> = {}) {
    super(mensagem);
    this.name = 'ErroAoGravar';
    this.status = status;
    this.corpo = corpo;
    this.conflito = corpo.conflito === true;
    this.vendaId = typeof corpo.venda_id === 'string' && corpo.venda_id ? corpo.venda_id : null;
  }
}

/** Endereço da ficha da venda, para o link "Abrir a venda". */
export function enderecoDaVenda(vendaId: string): string {
  return `/vendas/${encodeURIComponent(vendaId)}/ficha`;
}

async function enviar<T>(url: string, metodo: 'PUT' | 'POST' | 'DELETE', corpo?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroAoGravar('Sem conexão com o servidor. Tente de novo.', 0);
  }
  let dados: unknown = null;
  try { dados = await res.json(); } catch { dados = null; }
  const obj = (dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {}) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof obj.error === 'string' && obj.error ? obj.error : `Não foi possível salvar (erro ${res.status}).`;
    throw new ErroAoGravar(msg, res.status, obj);
  }
  return dados as T;
}

/** PUT /api/<endpoint>/<id>. Mande o `_versao` que a tela leu para o aviso de edição simultânea. */
export function atualizarRegistro<T extends { id: string }>(endpoint: string, item: T): Promise<T> {
  return enviar<T>(`/api/${endpoint}/${encodeURIComponent(item.id)}`, 'PUT', item);
}

/** POST em qualquer rota do sistema, com o mesmo tratamento de erro. */
export function postarRegistro<T>(url: string, corpo?: unknown): Promise<T> {
  return enviar<T>(url, 'POST', corpo ?? {});
}

/** DELETE /api/<endpoint>/<id>, com o mesmo tratamento de erro. */
export function excluirRegistro<T = { ok: boolean }>(endpoint: string, id: string): Promise<T> {
  return enviar<T>(`/api/${endpoint}/${encodeURIComponent(id)}`, 'DELETE');
}
