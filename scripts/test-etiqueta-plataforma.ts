/**
 * A etiqueta da plataforma (src/lib/plataformas/rotulo.ts).
 *
 * O que estes testes guardam: todo recebimento de integração diz de onde
 * veio, com o nome que a pessoa conhece, e a descrição não repete a
 * plataforma ao lado da etiqueta.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-etiqueta-plataforma.ts
 */
import { plataformaDaConta, nomeDaPlataforma, descricaoSemPlataforma, descricaoComPlataforma } from '../src/lib/plataformas/rotulo.ts';
import { ADAPTERS } from '../src/lib/plataformas/index.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

eq([plataformaDaConta({ plataforma_origem: 'hotmart' }), plataformaDaConta({ plataforma_origem: ' Asaas ' })], ['hotmart', 'asaas'], 'lê a plataforma da conta, sem caixa nem espaço');
eq([plataformaDaConta({}), plataformaDaConta({ plataforma_origem: '' }), plataformaDaConta(null)], [null, null, null], 'conta lançada à mão não tem etiqueta');
eq([nomeDaPlataforma('hotmart'), nomeDaPlataforma('asaas'), nomeDaPlataforma('pagarme'), nomeDaPlataforma('PAGARME')], ['Hotmart', 'Asaas', 'Pagar.me', 'Pagar.me'], 'nomes como a agência conhece');
eq(nomeDaPlataforma('cakto'), 'Cakto', 'plataforma nova aparece com inicial maiúscula, nunca some');
eq(nomeDaPlataforma(''), '', 'sem id, sem nome');
// Plataforma nova entra no registro dos adapters; o nome tem que vir junto.
eq(Object.values(ADAPTERS).filter(a => nomeDaPlataforma(a.id) !== a.nome).map(a => a.id), [], 'toda plataforma registrada tem o mesmo nome no adapter e na etiqueta');

eq(descricaoSemPlataforma('Pacote Gramado · hotmart', 'hotmart'), 'Pacote Gramado', 'tira o " · hotmart" do fim');
eq(descricaoSemPlataforma('Pacote Gramado · Hotmart (2/3)', 'hotmart'), 'Pacote Gramado (2/3)', 'mantém a parcela');
eq(descricaoSemPlataforma('Curso · pagarme', 'pagarme'), 'Curso', 'id sem ponto');
eq(descricaoSemPlataforma('Pacote Gramado (2/3) · Hotmart', 'hotmart'), 'Pacote Gramado (2/3)', 'formato novo da integração: parcela antes, plataforma no fim');
eq(descricaoSemPlataforma('Curso · Pagar.me (1/2)', 'pagarme'), 'Curso (1/2)', 'nome com ponto');
eq(descricaoSemPlataforma('Viagem Asaas · hotmart', 'asaas'), 'Viagem Asaas · hotmart', 'só tira a plataforma da própria conta, e só no fim');
eq(descricaoSemPlataforma('Pacote · hotmart', null), 'Pacote · hotmart', 'sem plataforma, a descrição fica como está');
eq(descricaoComPlataforma('Pacote Gramado · hotmart (2/3)', 'hotmart'), 'Pacote Gramado (2/3) · Hotmart', 'onde só cabe texto, a plataforma vai com o nome certo no fim');
eq(descricaoComPlataforma('', 'asaas'), 'Asaas', 'descrição vazia vira o nome da plataforma');

console.log(`\n${total - falhas}/${total} testes da etiqueta da plataforma passaram`);
if (falhas > 0) process.exit(1);
