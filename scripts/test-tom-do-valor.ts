/**
 * Cor de status no dinheiro (src/components/fin/Money.tsx).
 *
 * POR QUE ESTE TESTE IMPORTA. A tela de contas a receber mostrava
 * "EM ATRASO R$ 0,00" em vermelho de alarme e "RECEBIDO R$ 0,00" em verde de
 * comemoração. Os dois são a mesma mentira: cor de status é uma afirmação
 * sobre o número, e zero não sustenta nenhuma. Quem escreve a tela passa o tom
 * pensando na COLUNA ("aqui mora atraso"), nunca no valor daquele dia — então
 * a regra precisa morar no componente, senão volta no próximo cartão que
 * alguém escrever.
 *
 * Roda com: node --experimental-strip-types scripts/test-tom-do-valor.ts
 */
import { tomDoValor } from '../src/lib/tom-do-valor.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- zero nunca veste cor de status ---');
eq(tomDoValor(0, 'negativo'), 'neutro', 'zero em coluna de atraso não fica vermelho');
eq(tomDoValor(0, 'positivo'), 'neutro', 'zero em coluna de recebido não fica verde');
eq(tomDoValor(0, 'neutro'), 'neutro', 'zero neutro continua neutro');
eq(tomDoValor(-0, 'negativo'), 'neutro', 'zero negativo de ponto flutuante também');

console.log('--- valor real mantém o que a tela pediu ---');
eq(tomDoValor(-1200, 'negativo'), 'negativo', 'atraso de verdade fica vermelho');
eq(tomDoValor(1200, 'negativo'), 'negativo', 'o tom é da coluna, não do sinal do número');
eq(tomDoValor(1200, 'positivo'), 'positivo', 'recebido de verdade fica verde');
eq(tomDoValor(0.01, 'negativo'), 'negativo', 'um centavo já é um fato');
eq(tomDoValor(-0.01, 'positivo'), 'positivo', 'um centavo negativo também');

console.log('--- suave não é status, é ênfase menor ---');
// Vale para o zero de propósito: "suave" existe para APAGAR um número
// secundário, e apagar um zero continua fazendo sentido.
eq(tomDoValor(0, 'suave'), 'suave', 'zero suave continua suave');
eq(tomDoValor(500, 'suave'), 'suave', 'valor suave continua suave');

console.log('--- ausência não vira zero ---');
// null/undefined NÃO são zero: quem não sabe o valor não pode afirmar que ele
// é neutro por ser zero. O tom pedido é preservado, e o estado do componente
// ('carregando'/'indisponivel') é quem decide não pintar.
eq(tomDoValor(null, 'negativo'), 'negativo', 'valor ausente preserva o tom pedido');
eq(tomDoValor(undefined, 'positivo'), 'positivo', 'valor indefinido preserva o tom pedido');
eq(tomDoValor(0, null), 'neutro', 'sem tom pedido, neutro');
eq(tomDoValor(500, undefined), 'neutro', 'sem tom pedido, neutro mesmo com valor');

console.log(`\n${total - falhas}/${total} testes do tom do valor passaram`);
if (falhas > 0) process.exit(1);
