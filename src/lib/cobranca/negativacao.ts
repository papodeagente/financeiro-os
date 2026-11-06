/**
 * Negativação (Serasa) de cobrança vencida — regras puras (E7, 06/11/2026).
 *
 * Só pelo Asaas (doc oficial lida em 06/11/2026: `POST /paymentDunnings`,
 * tipo CREDIT_BUREAU; protesto não existe na API). Nunca automática: a
 * pessoa abre a prévia (simulação do provedor, taxa, início previsto, o que
 * falta no cadastro) e confirma com a assinatura dessa prévia.
 *
 * Testado em scripts/test-cobranca-item18.ts e, com banco, em
 * scripts/test-sql-cobranca-item18.mjs.
 */
import type { ClienteDaCobranca, DevedorDaNegativacao, StatusNegativacao } from './tipos';

const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const txt = (v: unknown) => String(v ?? '').trim();

/** O devedor como o Asaas pede, a partir do cadastro do cliente. */
export function devedorDoCliente(c: ClienteDaCobranca): DevedorDaNegativacao {
  const e = c.endereco;
  return {
    nome: txt(c.nome), documento: dig(c.documento), telefone: dig(c.telefone),
    cep: dig(e?.cep), logradouro: txt(e?.logradouro), numero: txt(e?.numero), complemento: txt(e?.complemento), bairro: txt(e?.bairro),
  };
}

/** O que falta no cadastro para pedir (vazio = pronto). */
export function faltasParaNegativar(d: DevedorDaNegativacao): string[] {
  const f: string[] = [];
  if (!d.nome) f.push('nome');
  if (d.documento.length !== 11 && d.documento.length !== 14) f.push('CPF ou CNPJ');
  if (d.telefone.length < 10) f.push('telefone com DDD');
  if (d.cep.length !== 8) f.push('CEP');
  if (!d.logradouro) f.push('endereço (rua)');
  if (!d.numero) f.push('número do endereço');
  if (!d.bairro) f.push('bairro');
  return f;
}

/** A cobrança aceita negativação? Frase de recusa ou null. */
export function recusaDaCobranca(c: { provedor: string; status: string; tipo: string; id_externo: string | null }, negativa: boolean): string | null {
  if (!negativa) return 'Negativação pela integração só existe no Asaas.';
  if (c.tipo === 'link') return 'Link de pagamento não tem cobrança para negativar.';
  if (c.status !== 'vencida') return 'Só cobrança vencida pode ser negativada.';
  if (!c.id_externo) return 'Esta cobrança não foi emitida no provedor.';
  return null;
}

/** Situações em que já existe uma negativação valendo (não pedir outra). */
export const NEGATIVACAO_VIVA: readonly StatusNegativacao[] = ['PENDING', 'AWAITING_APPROVAL', 'AWAITING_CANCELLATION', 'PROCESSED', 'PARTIALLY_PAID'];

export function negativacaoViva(status: unknown): boolean {
  return (NEGATIVACAO_VIVA as readonly string[]).includes(String(status ?? '')) || status === 'PEDINDO';
}

/** Situação em palavras, para a tela. */
export function rotuloDaNegativacao(status: unknown): string {
  switch (String(status ?? '')) {
    case 'PEDINDO': return 'Pedido em andamento';
    case 'PENDING': return 'Pedida, aguardando o Serasa';
    case 'AWAITING_APPROVAL': return 'Em análise no provedor';
    case 'AWAITING_CANCELLATION': return 'Cancelamento em andamento';
    case 'PROCESSED': return 'Cliente negativado';
    case 'PAID': return 'Paga pelo cliente (saiu do Serasa)';
    case 'PARTIALLY_PAID': return 'Paga em parte';
    case 'DENIED': return 'Recusada pelo provedor';
    case 'CANCELLED': return 'Cancelada';
    default: return 'Sem negativação';
  }
}
