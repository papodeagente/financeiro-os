/**
 * Cheque e cartão na liquidação (06/11/2026, E7) — regra pura.
 *
 * Quem liquida com cheque informa o número do cheque; com cartão, os quatro
 * últimos dígitos e o número da autorização (o código que a maquininha ou o
 * comprovante mostra). O número completo do cartão NUNCA é guardado: o
 * campo de dígitos recusa qualquer sequência com mais de 4 algarismos, e a
 * autorização recusa algo que pareça um número de cartão. Validade e código
 * de segurança não existem aqui.
 *
 * Também confere a forma escolhida contra as formas da agência
 * (Formas de pagamento): desligada ou de outro sentido é recusada, exceto
 * quando é a forma que a conta já tinha (abrir e liquidar nunca troca a forma
 * gravada), um valor antigo do sistema ou um texto que não é forma do
 * cadastro (ex.: o nome da plataforma, como sempre).
 */
import { VALORES_ANTIGOS, type FormaPagamento } from './formas-pagamento';

export interface MeioDoPagamento {
  cheque_numero?: string;
  cartao_ultimos4?: string;
  cartao_autorizacao?: string;
}

export class ErroDoMeio extends Error {}

/** Forma de cheque (código da forma de sempre ou valor antigo). */
export function formaEhCheque(forma: string | null | undefined): boolean {
  return String(forma ?? '').trim().toUpperCase() === 'CHEQUE';
}

/** Forma de cartão: crédito, débito, corporativo ou o "Cartão" antigo. */
export function formaEhCartao(forma: string | null | undefined): boolean {
  return String(forma ?? '').trim().toUpperCase().startsWith('CARTAO');
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const soDigitos = (v: string) => v.replace(/[\s.\-/]/g, '');

/**
 * Lê e confere os campos do meio de pagamento de um item. Devolve só o que
 * foi informado (objeto vazio = nada a guardar). Lança ErroDoMeio com a frase
 * para a pessoa.
 */
export function lerMeioDoPagamento(
  forma: string | null | undefined,
  campos: { cheque_numero?: unknown; cartao_ultimos4?: unknown; cartao_autorizacao?: unknown },
): MeioDoPagamento {
  const meio: MeioDoPagamento = {};
  const cheque = texto(campos.cheque_numero);
  const digitos = texto(campos.cartao_ultimos4);
  const autorizacao = texto(campos.cartao_autorizacao);

  // Dígitos do cartão primeiro: um número completo é recusado antes de qualquer outra regra.
  if (digitos) {
    const d = soDigitos(digitos);
    if (/\d{5,}/.test(d) || (d.replace(/\D/g, '').length > 4)) {
      throw new ErroDoMeio('Informe só os 4 últimos dígitos do cartão. O número completo nunca é guardado.');
    }
    if (!/^\d{4}$/.test(d)) throw new ErroDoMeio('Os últimos dígitos do cartão são 4 números.');
    if (!formaEhCartao(forma)) throw new ErroDoMeio('Os dígitos do cartão só valem quando a forma é cartão.');
    meio.cartao_ultimos4 = d;
  }
  if (autorizacao) {
    // Uma sequência de 13 ou mais algarismos é um número de cartão, não autorização.
    if (/\d{13,}/.test(soDigitos(autorizacao))) {
      throw new ErroDoMeio('Isto parece o número do cartão. No campo de autorização vai só o código do comprovante.');
    }
    if (!/^[0-9A-Za-z]{1,20}$/.test(autorizacao)) {
      throw new ErroDoMeio('A autorização do cartão tem até 20 letras e números, sem espaços.');
    }
    if (!formaEhCartao(forma)) throw new ErroDoMeio('A autorização só vale quando a forma é cartão.');
    meio.cartao_autorizacao = autorizacao.toUpperCase();
  }
  if (cheque) {
    const n = soDigitos(cheque);
    if (!/^\d{1,12}$/.test(n)) throw new ErroDoMeio('O número do cheque tem só algarismos (até 12).');
    if (!formaEhCheque(forma)) throw new ErroDoMeio('O número do cheque só vale quando a forma é cheque.');
    meio.cheque_numero = n;
  }
  return meio;
}

/**
 * Formas que valem para TODAS as contas de um lote: ligadas e do sentido
 * delas (só a pagar, só a receber, ou as duas misturadas = só "ambos").
 * O servidor confere de novo, conta por conta.
 */
export function formasDoLote(formas: readonly FormaPagamento[], sentidos: ReadonlySet<'pagar' | 'receber'>): FormaPagamento[] {
  return formas.filter(f => f.ativo && (f.uso === 'ambos' || (sentidos.size === 1 && sentidos.has(f.uso))));
}

/** "Cheque nº 000123" / "Cartão final 4242 · autorização A1B2C3". Vazio quando não há nada. */
export function descreverMeio(meio: MeioDoPagamento | null | undefined): string {
  if (!meio) return '';
  const partes: string[] = [];
  if (meio.cheque_numero) partes.push(`cheque nº ${meio.cheque_numero}`);
  if (meio.cartao_ultimos4) partes.push(`cartão final ${meio.cartao_ultimos4}`);
  if (meio.cartao_autorizacao) partes.push(`autorização ${meio.cartao_autorizacao}`);
  return partes.join(' · ');
}

/**
 * A forma pode ser usada nesta liquidação? Devolve a recusa (frase) ou null.
 * Vale a forma que a conta já tinha, os valores antigos e o texto livre que
 * não é código de forma; só a forma do cadastro desligada ou do outro
 * sentido é recusada.
 */
export function recusaDaForma(
  forma: string | null | undefined,
  sentido: 'pagar' | 'receber',
  formas: readonly FormaPagamento[],
  formaDaConta?: string | null,
): string | null {
  const f = String(forma ?? '').trim();
  if (!f) return null;
  if (formaDaConta && f === String(formaDaConta).trim()) return null;
  if (VALORES_ANTIGOS[f]) return null;
  const achada = formas.find(x => x.codigo === f);
  // Texto livre que não é código de forma (ex.: o nome da plataforma que a
  // tela de recebimento manda quando ninguém escolheu forma): grava como
  // sempre gravou.
  if (!achada) return null;
  if (!achada.ativo) return `A forma "${achada.nome}" está desligada em Formas de pagamento. Escolha outra.`;
  if (achada.uso !== 'ambos' && achada.uso !== sentido) {
    return `A forma "${achada.nome}" vale só para contas a ${achada.uso === 'pagar' ? 'pagar' : 'receber'}.`;
  }
  return null;
}
