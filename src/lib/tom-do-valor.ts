/**
 * Que cor um valor em dinheiro pode vestir.
 *
 * Regra pura, fora do componente, porque componente `.tsx` não entra no
 * runner de teste — e esta é exatamente a classe de regra que volta a
 * quebrar quando não tem teste em cima.
 */

/** Os mesmos tons do <Money>. */
export type TomDoDinheiro = 'neutro' | 'positivo' | 'negativo' | 'suave';

/**
 * Cor de status é uma AFIRMAÇÃO sobre o número, e zero não sustenta nenhuma.
 *
 * "Em atraso R$ 0,00" pintado de vermelho anuncia alarme onde está a melhor
 * notícia possível; "Recebido R$ 0,00" em verde comemora o que não aconteceu.
 * Quem escreve a tela passa o tom pensando na COLUNA ("aqui mora atraso"),
 * não no valor daquele dia — então a regra mora aqui: no zero o número volta
 * a ser tinta de texto, e a frase de contexto do cartão diz o que aquilo
 * significa.
 *
 * É a mesma regra que já barra o R$ 0,00 falso de 'carregando' e
 * 'indisponivel', um passo adiante.
 *
 * DUAS EXCEÇÕES DELIBERADAS:
 *  - `suave` não é status, é ênfase menor. Apagar um zero secundário continua
 *    fazendo sentido.
 *  - ausência (null/undefined) NÃO é zero. Quem não sabe o valor não pode
 *    afirmar que ele é neutro; quem decide não pintar aí é o estado do
 *    componente.
 */
export function tomDoValor(
  valor: number | null | undefined,
  tom: TomDoDinheiro | null | undefined,
): TomDoDinheiro {
  const pedido: TomDoDinheiro = tom ?? 'neutro';
  if (pedido === 'suave') return pedido;
  return valor === 0 ? 'neutro' : pedido;
}
