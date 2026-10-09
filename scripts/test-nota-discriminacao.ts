/**
 * A descrição da nota diz O QUE FOI VENDIDO.
 *
 * Antes era um texto fixo ("Agenciamento de viagem"): três notas de três
 * viagens diferentes saíam iguais. O texto fixo descreve o ramo da agência,
 * não o serviço prestado.
 *
 * O que estes testes seguram: discriminação é campo de documento fiscal.
 * Ela não pode sair vazia, não pode cortar um nome no meio, e não pode
 * deixar travessão órfão quando um pedaço do modelo vem vazio.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-nota-discriminacao.ts
 */
import { montarDiscriminacao, produtosDaDiscriminacao } from '../src/lib/nfse-calculo.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

const RESERVA = 'Agenciamento de viagem';

console.log('--- o nome do produto vira a descrição ---');
eq(
  produtosDaDiscriminacao({ produtos: [{ descricao: 'Grupo Natal 2026' }], padrao: RESERVA }),
  'Grupo Natal 2026',
  'um produto: o nome dele',
);
eq(
  produtosDaDiscriminacao({ produtos: [{ descricao: 'Grupo Natal 2026' }, { descricao: 'Seguro Viagem' }], padrao: RESERVA }),
  'Grupo Natal 2026, Seguro Viagem',
  'dois produtos: os dois nomes',
);
eq(
  produtosDaDiscriminacao({ produtos: [{ descricao: 'Ingresso Disney', quantidade: 3 }], padrao: RESERVA }),
  '3x Ingresso Disney',
  'quantidade maior que 1 aparece',
);
eq(
  produtosDaDiscriminacao({ produtos: [{ descricao: 'Seguro', quantidade: 1 }], padrao: RESERVA }),
  'Seguro',
  'quantidade 1 não polui o texto',
);
// O mesmo produto em dois fornecedores não vira nome repetido na nota.
eq(
  produtosDaDiscriminacao({ produtos: [{ descricao: 'Hotel Ibis' }, { descricao: 'hotel ibis ' }], padrao: RESERVA }),
  'Hotel Ibis',
  'nome repetido aparece uma vez só',
);

console.log('--- a cascata: a nota nunca sai sem descrição ---');
eq(
  produtosDaDiscriminacao({ produtos: [], descricaoDaConta: 'Parcela 1 de 3 — pacote Europa', padrao: RESERVA }),
  'Parcela 1 de 3 — pacote Europa',
  'sem produto, vale a descrição da conta',
);
eq(
  produtosDaDiscriminacao({ produtos: [{ descricao: '  ' }], descricaoDaConta: '', padrao: RESERVA }),
  RESERVA,
  'sem produto e sem conta, vale o texto de reserva',
);
eq(
  produtosDaDiscriminacao({ padrao: RESERVA }),
  RESERVA,
  'entrada vazia não devolve string vazia',
);
eq(
  [null, undefined].map(v => produtosDaDiscriminacao({ produtos: v as never, descricaoDaConta: v as never, padrao: RESERVA })),
  [RESERVA, RESERVA],
  'nulo em tudo também cai na reserva',
);

console.log('--- o texto não estoura o campo nem corta nome no meio ---');
{
  const muitos = ['Grupo Natal 2026', 'Seguro Viagem Europa', 'Transfer Aeroporto', 'Ingresso Louvre', 'City Tour Paris'];
  const r = produtosDaDiscriminacao({ produtos: muitos.map(descricao => ({ descricao })), limite: 60, padrao: RESERVA });
  eq(r.length <= 60, true, `cabe no limite (${r.length} caracteres)`);
  eq(r.includes(' e mais '), true, 'e avisa quantos ficaram de fora');
  // Nenhum nome sai pela metade.
  const listados = r.split(' e mais ')[0].split(', ');
  eq(listados.every(n => muitos.includes(n)), true, 'nenhum nome foi cortado no meio');
}
{
  // Um único nome maior que o limite: corta na palavra e marca com reticência.
  const r = produtosDaDiscriminacao({ produtos: [{ descricao: 'Pacote completo para a Europa com guia acompanhante e seguro incluso' }], limite: 30, padrao: RESERVA });
  eq(r.length <= 31, true, `nome longo é encurtado (${r.length})`);
  eq(r.endsWith('…'), true, 'e marcado com reticência');
  eq(r.includes('Pacote completo'), true, 'mas o começo do nome continua legível');
}

console.log('--- o modelo da agência continua mandando ---');
eq(
  montarDiscriminacao('{produto} — {cliente} — venda {venda} {parcela}', {
    produto: 'Grupo Natal 2026', cliente: 'Maria Souza', venda: '1042', parcela: '(parcela 2/3)',
  }, RESERVA),
  'Grupo Natal 2026 — Maria Souza — venda 1042 (parcela 2/3)',
  'o modelo padrão novo monta a linha inteira',
);
// Quem já configurou o texto do jeito dele não é atropelado.
eq(
  montarDiscriminacao('Agenciamento de viagem — {cliente}', { cliente: 'Maria Souza', produto: 'Grupo Natal' }, RESERVA),
  'Agenciamento de viagem — Maria Souza',
  'modelo sem {produto} continua saindo como sempre saiu',
);

console.log('--- travessão órfão ---');
// O pedaço vazio não pode deixar a pontuação sozinha na nota.
eq(
  montarDiscriminacao('{produto} — {cliente} — venda {venda} {parcela}', { produto: '', cliente: 'Maria Souza', venda: '7' }, RESERVA),
  'Maria Souza — venda 7',
  'produto vazio não deixa travessão no começo',
);
eq(
  montarDiscriminacao('{produto} — {cliente}', { produto: 'Grupo Natal', cliente: '' }, RESERVA),
  'Grupo Natal',
  'cliente vazio não deixa travessão no fim',
);

console.log('--- nunca vazio ---');
eq(
  montarDiscriminacao('{produto}', { produto: '' }, RESERVA),
  RESERVA,
  'modelo só com {produto} numa venda sem produto cai na reserva',
);
eq(
  montarDiscriminacao('   ', {}, RESERVA),
  RESERVA,
  'modelo em branco também',
);
eq(
  montarDiscriminacao('{produto}', { produto: '' }, ''),
  '',
  'sem reserva nenhuma, devolve vazio — quem chama é que decide o que pôr',
);

console.log(`\n${total - falhas}/${total} testes da descrição da nota passaram`);
if (falhas > 0) process.exit(1);
