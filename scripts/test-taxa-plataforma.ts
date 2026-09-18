/**
 * Taxa da plataforma de pagamento (src/lib/taxa-plataforma.ts).
 *
 * POR QUE ESTES TESTES IMPORTAM. Esta taxa é dinheiro que sai sem ninguém
 * lançar uma despesa: o cliente paga a conta inteira e a agência recebe menos.
 * Três coisas quebram silenciosamente aqui.
 *
 * 1) O percentual. Base zero tem que devolver NULL. Se devolvesse 0, a tela
 *    mostraria "0%" — que se lê como "não teve taxa", o contrário do que é.
 * 2) O agrupamento. O relatório inteiro é por plataforma, então "Mercado Pago",
 *    "mercado pago" e "MERCADOPAGO" precisam cair na MESMA linha. Se rachar,
 *    o relatório não responde a pergunta que existe para responder.
 * 3) Quando a taxa conta. Conta pendente não teve retenção nenhuma — contá-la
 *    tiraria do saldo bancário um dinheiro que ainda nem entrou.
 *
 * Roda com: node --experimental-strip-types scripts/test-taxa-plataforma.ts
 */
import {
  PLATAFORMAS_CONHECIDAS, SEM_PLATAFORMA, agruparTaxasPorPlataforma, brutoQuePassou,
  chaveDaPlataforma, mensagemDaTaxaInvalida, normalizarPlataforma, opcoesDePlataforma,
  percentualDaTaxa, taxaRealizada, totalDeTaxas, validarTaxa,
} from '../src/lib/taxa-plataforma.ts';
import { calcularSaldoBancario, entradaLiquidaNoBanco } from '../src/lib/saldo-bancario.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

// ── chave de comparação ───────────────────────────────────────────────────
console.log('--- a chave ignora caixa, acento e pontuação ---');
eq(chaveDaPlataforma('Mercado Pago'), 'mercadopago', 'nome comum vira chave');
eq(chaveDaPlataforma('MERCADO PAGO'), 'mercadopago', 'caixa alta casa');
eq(chaveDaPlataforma('  mercado   pago  '), 'mercadopago', 'espaço sobrando casa');
eq(chaveDaPlataforma('MercadoPago'), 'mercadopago', 'sem espaço casa');
eq(chaveDaPlataforma('Pagar.me'), 'pagarme', 'ponto some');
eq(chaveDaPlataforma('PAGAR ME'), 'pagarme', 'ponto virou espaço e ainda casa');
// O acento é o caso que mais pega: uma plataforma escrita com e sem acento
// abriria duas linhas no relatório.
eq(chaveDaPlataforma('Cielo'), 'cielo', 'sem acento');
eq(chaveDaPlataforma('Céilo'), 'ceilo', 'acento é removido, não trocado por nada estranho');
eq(chaveDaPlataforma('Ação'), 'acao', 'cedilha e til somem');
eq(chaveDaPlataforma(null), '', 'nulo vira vazio');
eq(chaveDaPlataforma('   '), '', 'só espaço vira vazio');

// ── nome canônico ─────────────────────────────────────────────────────────
console.log('--- o nome canônico impede o relatório de rachar ---');
eq(normalizarPlataforma('mercado pago'), 'Mercado Pago', 'conhecida volta na grafia oficial');
eq(normalizarPlataforma('MERCADOPAGO'), 'Mercado Pago', 'sem espaço também volta oficial');
eq(normalizarPlataforma('pagar.me'), 'Pagar.me', 'pontuação oficial é restaurada');
eq(normalizarPlataforma('PAGARME'), 'Pagar.me', 'escrita sem ponto vira a oficial');
eq(normalizarPlataforma('infinitepay'), 'InfinitePay', 'caixa interna é restaurada');
eq(normalizarPlataforma('  stripe '), 'Stripe', 'espaços somem');
// Desconhecida NÃO é corrigida: não é papel deste módulo inventar a grafia
// certa de uma plataforma que ele não conhece.
eq(normalizarPlataforma('Banco do Zé'), 'Banco do Zé', 'desconhecida é preservada como escrita');
eq(normalizarPlataforma('  Banco   do   Zé  '), 'Banco do Zé', 'mas os espaços são arrumados');
eq(normalizarPlataforma(''), '', 'vazio continua vazio');
eq(normalizarPlataforma(null), '', 'nulo vira vazio');
// Toda a lista precisa ser estável: normalizar o nome oficial devolve ele mesmo.
for (const p of PLATAFORMAS_CONHECIDAS) {
  eq(normalizarPlataforma(p), p, `"${p}" é ponto fixo da normalização`);
}

// ── percentual ────────────────────────────────────────────────────────────
console.log('--- o percentual é derivado, e base zero é NULL ---');
eq(percentualDaTaxa(300, 10000), 3, '300 de 10.000 é 3%');
eq(percentualDaTaxa(299.1, 9970), 3, 'arredonda para duas casas');
eq(percentualDaTaxa(0, 10000), 0, 'taxa zero com base é 0% de verdade');
// O caso que importa: sem base não existe percentual. 0 aqui seria mentira.
eq(percentualDaTaxa(300, 0), null, 'base zero devolve null, nunca 0');
eq(percentualDaTaxa(300, null), null, 'base nula devolve null');
eq(percentualDaTaxa(null, 10000), 0, 'taxa nula com base é 0%');
eq(percentualDaTaxa(10000, 10000), 100, 'taxa igual à conta é 100%');

// ── validação ─────────────────────────────────────────────────────────────
console.log('--- só o impossível é barrado ---');
eq(validarTaxa(300, 9970), null, 'taxa normal passa');
eq(validarTaxa(0, 9970), null, 'taxa zero passa');
eq(validarTaxa(9970, 9970), null, 'taxa igual à conta ainda passa');
eq(validarTaxa(-1, 9970), 'negativa', 'negativa é barrada');
eq(validarTaxa(9971, 9970), 'maior-que-a-conta', 'maior que a conta é barrada');
eq(validarTaxa(300, 0), null, 'sem base ainda não dá para julgar o teto');
eq(mensagemDaTaxaInvalida('negativa'), 'A taxa não pode ser negativa.', 'mensagem da negativa');
eq(
  mensagemDaTaxaInvalida('maior-que-a-conta'),
  'A taxa não pode ser maior do que o valor da conta.',
  'mensagem do teto',
);

// ── quando a taxa conta como dinheiro que saiu ────────────────────────────
console.log('--- pendente não teve retenção ---');
eq(taxaRealizada({ status: 'RECEBIDO', taxa: 300 }), 300, 'recebida conta a taxa');
eq(taxaRealizada({ status: 'PARCIAL', taxa: 150 }), 150, 'parcial conta o que foi retido');
// Este é o que protege o saldo bancário: contar a taxa de uma conta pendente
// tiraria do banco um dinheiro que ainda não entrou.
eq(taxaRealizada({ status: 'PENDENTE', taxa: 300 }), 0, 'pendente não conta');
eq(taxaRealizada({ status: 'ATRASADO', taxa: 300 }), 0, 'atrasada não conta');
eq(taxaRealizada({ status: 'CANCELADO', taxa: 300 }), 0, 'cancelada não conta');
eq(taxaRealizada({ status: 'RECEBIDO' }), 0, 'sem taxa é zero');
eq(taxaRealizada({ status: 'RECEBIDO', taxa: null }), 0, 'taxa nula é zero');
eq(taxaRealizada({ status: 'RECEBIDO', taxa: -50 }), 0, 'taxa negativa gravada não vira crédito');
// Status é enum EXATO, como em valorRealizado/valorMovimentado. Ser mais
// tolerante aqui do que o cálculo da entrada produziria uma entrada negativa
// no banco: zero de entrada menos a taxa.
eq(taxaRealizada({ status: 'recebido', taxa: 300 }), 0, 'status fora do enum não conta');

eq(
  totalDeTaxas([
    { status: 'RECEBIDO', taxa: 300 },
    { status: 'PARCIAL', taxa: 50 },
    { status: 'PENDENTE', taxa: 999 },
  ]),
  350,
  'o total soma só o que foi retido',
);
eq(totalDeTaxas([]), 0, 'lista vazia soma zero');
eq(totalDeTaxas(null), 0, 'lista nula soma zero');

// ── base que passou pela plataforma ───────────────────────────────────────
console.log('--- a base é o que passou, não o que foi lançado ---');
eq(brutoQuePassou({ status: 'RECEBIDO', valor_final: 9970, valor_recebido: 9970 }), 9970, 'recebida inteira');
eq(brutoQuePassou({ status: 'RECEBIDO', valor_final: 9970, valor_recebido: null }), 9970, 'recebida sem o campo cai no valor_final');
eq(brutoQuePassou({ status: 'PARCIAL', valor_final: 9970, valor_recebido: 4000 }), 4000, 'parcial usa o acumulado');
eq(brutoQuePassou({ status: 'PENDENTE', valor_final: 9970 }), 0, 'pendente não passou nada');
eq(brutoQuePassou({ status: 'CANCELADO', valor_final: 9970, valor_recebido: 9970 }), 0, 'cancelada não passou nada');

// ── opções do seletor ─────────────────────────────────────────────────────
console.log('--- a lista aprende sem tela de cadastro ---');
const opcoesBase = opcoesDePlataforma([]);
eq(opcoesBase.length, PLATAFORMAS_CONHECIDAS.length, 'sem histórico, só as conhecidas');
eq(opcoesBase.includes('Mercado Pago'), true, 'as conhecidas estão lá');
eq(
  opcoesDePlataforma([{ taxa_plataforma: 'Banco do Zé' }]).includes('Banco do Zé'),
  true,
  'uma usada antes passa a aparecer',
);
eq(
  opcoesDePlataforma([{ taxa_plataforma: 'mercado pago' }]).filter(o => o === 'Mercado Pago').length,
  1,
  'a usada que já é conhecida não duplica',
);
eq(
  opcoesDePlataforma([{ taxa_plataforma: 'Zé Pay' }, { taxa_plataforma: 'ZÉ PAY' }])
    .filter(o => chaveDaPlataforma(o) === 'zepay').length,
  1,
  'duas grafias da mesma desconhecida viram uma opção só',
);
eq(opcoesDePlataforma([], ['Hotmart', 'Kiwify']).includes('Kiwify'), true, 'extras entram na lista');
eq(opcoesDePlataforma([{ taxa_plataforma: '' }]).length, PLATAFORMAS_CONHECIDAS.length, 'vazio não vira opção');
const ordenadas = opcoesDePlataforma([]);
eq(ordenadas, [...ordenadas].sort((a, b) => a.localeCompare(b, 'pt-BR')), 'a lista sai em ordem alfabética');

// ── o relatório ───────────────────────────────────────────────────────────
console.log('--- o relatório por plataforma ---');
const contas = [
  { status: 'RECEBIDO', valor_final: 10000, valor_recebido: 10000, taxa: 300, taxa_plataforma: 'Mercado Pago' },
  // MESMA plataforma escrita de outro jeito: precisa cair na mesma linha.
  { status: 'RECEBIDO', valor_final: 5000, valor_recebido: 5000, taxa: 150, taxa_plataforma: 'mercado pago' },
  { status: 'RECEBIDO', valor_final: 2000, valor_recebido: 2000, taxa: 80, taxa_plataforma: 'Stripe' },
  // Pendente com taxa prevista NÃO entra.
  { status: 'PENDENTE', valor_final: 8000, taxa: 240, taxa_plataforma: 'Stripe' },
  // Recebida sem taxa também não gera linha.
  { status: 'RECEBIDO', valor_final: 1000, valor_recebido: 1000, taxa: 0, taxa_plataforma: 'Cielo' },
  // Com taxa mas sem plataforma informada.
  { status: 'RECEBIDO', valor_final: 1000, valor_recebido: 1000, taxa: 25, taxa_plataforma: '' },
];
const rel = agruparTaxasPorPlataforma(contas);

eq(rel.linhas.map(l => l.plataforma), ['Mercado Pago', 'Stripe', SEM_PLATAFORMA], 'maior mordida primeiro');
eq(rel.linhas[0].quantidade, 2, 'as duas grafias somam na mesma linha');
eq(rel.linhas[0].bruto, 15000, 'bruto da linha');
eq(rel.linhas[0].taxa, 450, 'taxa da linha');
eq(rel.linhas[0].liquido, 14550, 'líquido da linha');
eq(rel.linhas[0].percentual, 3, 'percentual da linha');
eq(rel.linhas[1].plataforma, 'Stripe', 'a pendente não inflou a Stripe');
eq(rel.linhas[1].bruto, 2000, 'a Stripe só conta o que passou');
eq(rel.linhas[1].taxa, 80, 'a taxa prevista da pendente ficou de fora');
eq(rel.linhas.some(l => l.plataforma === 'Cielo'), false, 'plataforma sem taxa não vira linha');
eq(rel.linhas[2].plataforma, SEM_PLATAFORMA, 'taxa sem plataforma tem linha própria');

eq(rel.total.quantidade, 4, 'o total conta as contas com taxa');
eq(rel.total.bruto, 18000, 'bruto total');
eq(rel.total.taxa, 555, 'taxa total');
eq(rel.total.liquido, 17445, 'líquido total');
eq(rel.total.percentual, 3.08, 'percentual efetivo total');
// O total tem que fechar com a soma das linhas, senão a tela se contradiz.
eq(
  rel.total.taxa,
  Math.round(rel.linhas.reduce((s, l) => s + l.taxa, 0) * 100) / 100,
  'o total fecha com a soma das linhas',
);

const vazio = agruparTaxasPorPlataforma([]);
eq(vazio.linhas, [], 'sem contas, sem linhas');
eq(vazio.total.taxa, 0, 'total zerado');
eq(vazio.total.percentual, null, 'sem base o percentual total é null, não 0');
eq(agruparTaxasPorPlataforma(null).linhas, [], 'lista nula não quebra');

// ── o saldo do banco ──────────────────────────────────────────────────────
// Esta é a parte que amarra tudo. A conta quita pelo valor CHEIO, porque foi
// isso que o cliente pagou. Mas a adquirente retém antes de repassar, então o
// extrato mostra menos. Se o saldo computado somasse o valor cheio, ele
// ficaria acima do saldo real por todo o valor das taxas e a conciliação
// nunca fecharia.
console.log('--- o saldo do banco desconta a taxa ---');
const recebida = {
  status: 'RECEBIDO', valor_final: 10000, valor_recebido: 10000,
  taxa: 300, taxa_plataforma: 'Mercado Pago',
} as never;
eq(entradaLiquidaNoBanco(recebida), 9700, 'entra no banco o valor menos a taxa');
eq(
  entradaLiquidaNoBanco({ status: 'RECEBIDO', valor_final: 10000, valor_recebido: 10000, taxa: 0 } as never),
  10000,
  'sem taxa, entra o valor cheio',
);
// Compatibilidade com o histórico: conta antiga não tem o campo.
eq(
  entradaLiquidaNoBanco({ status: 'RECEBIDO', valor_final: 10000, valor_recebido: 10000 } as never),
  10000,
  'conta antiga sem o campo não muda de valor',
);
eq(
  entradaLiquidaNoBanco({ status: 'PENDENTE', valor_final: 10000, taxa: 300 } as never),
  0,
  'pendente não entra nem sai',
);
eq(
  entradaLiquidaNoBanco({ status: 'PARCIAL', valor_final: 10000, valor_recebido: 4000, taxa: 120 } as never),
  3880,
  'parcial entra pelo acumulado menos a taxa',
);

eq(
  calcularSaldoBancario(
    [{ saldo_inicial: 1000 }] as never,
    [recebida],
    [{ status: 'PAGO', valor_final: 500, valor_pago: 500 }] as never,
  ),
  10200,
  'saldo = inicial + recebido - taxa - pago',
);
// A prova de que nada muda para quem não usa o campo: mesma conta sem taxa.
eq(
  calcularSaldoBancario(
    [{ saldo_inicial: 1000 }] as never,
    [{ status: 'RECEBIDO', valor_final: 10000, valor_recebido: 10000 }] as never,
    [] as never,
  ),
  11000,
  'sem taxa o saldo é o de sempre',
);

// O INVARIANTE que amarra taxaRealizada() a valorMovimentado(): a taxa nunca
// pode ser descontada de uma entrada que não aconteceu. Se as duas discordarem
// sobre qual status conta, a conta coloca dinheiro NEGATIVO no banco.
console.log('--- a entrada no banco nunca é negativa ---');
for (const status of [
  'RECEBIDO', 'PARCIAL', 'PENDENTE', 'ATRASADO', 'CANCELADO',
  'recebido', 'Parcial', 'AGUARDANDO', '', 'QUALQUER_COISA',
]) {
  const conta = { status, valor_final: 1000, valor_recebido: 1000, taxa: 300 };
  const entrada = entradaLiquidaNoBanco(conta as never);
  eq(entrada >= 0, true, `entrada não negativa com status "${status}" (deu ${entrada})`);
}

console.log(`\n${total - falhas}/${total} testes da taxa de plataforma passaram`);
if (falhas > 0) process.exit(1);
