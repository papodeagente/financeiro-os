/**
 * O que o CRM respondeu ao pedido de envio da cobrança (05/11/2026). Puro.
 * O CRM sempre responde 200 e diz em `acao` se mandou: "…: não enviada
 * (motivo)" quando não saiu. Sem resposta = o pedido ficou na fila.
 */
export interface RespostaDoCrmEnvio { entregue: boolean; acao: string }

export function resultadoDoEnvio(resposta: RespostaDoCrmEnvio | null | undefined):
  { enviado: boolean; na_fila: boolean; motivo: string } {
  if (!resposta || !resposta.entregue) {
    return { enviado: false, na_fila: true, motivo: 'O CRM não respondeu agora. O pedido ficou na fila e sai assim que ele voltar.' };
  }
  const m = /não enviada \((.*)\)\s*$/i.exec(resposta.acao);
  if (m) return { enviado: false, na_fila: false, motivo: m[1] };
  return { enviado: true, na_fila: false, motivo: '' };
}
