/**
 * Cofre de segredos (src/lib/cofre.ts).
 *
 * Chave de plataforma de pagamento move dinheiro. Estes testes fixam o que
 * não pode falhar: o que entra volta igual, texto adulterado NÃO volta como
 * lixo silencioso, e a máscara nunca devolve o segredo inteiro.
 */
process.env.INTEGRACOES_MASTER_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { cifrar, decifrar, mascarar, cofreDisponivel, ErroCofre } from '../src/lib/cofre.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
function lanca(fn: () => unknown, label: string) {
  total++;
  try { fn(); falhas++; console.log(`FAIL  ${label} (não lançou)`); }
  catch { console.log(`PASS  ${label}`); }
}

console.log('--- ida e volta ---');
{
  const segredo = '$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZm';
  eq(decifrar(cifrar(segredo)), segredo, 'chave do Asaas volta idêntica');
}
eq(decifrar(cifrar('')), '', 'texto vazio não quebra');
eq(decifrar(cifrar('acentuação e emoji 🔐')), 'acentuação e emoji 🔐', 'UTF-8 sobrevive');
{
  const longo = 'x'.repeat(5000);
  eq(decifrar(cifrar(longo)), longo, 'segredo longo');
}

console.log('\n--- o texto cifrado não repete ---');
{
  const a = cifrar('mesma coisa');
  const b = cifrar('mesma coisa');
  eq(a.ct !== b.ct, true, 'mesmo segredo gera cifrado diferente (IV novo a cada vez)');
  eq(a.iv !== b.iv, true, 'e o IV muda');
  eq([decifrar(a), decifrar(b)], ['mesma coisa', 'mesma coisa'], 'mas os dois decifram igual');
}

console.log('\n--- adulteração é detectada, não devolve lixo ---');
{
  const e = cifrar('sk_live_importante');
  lanca(() => decifrar({ ...e, ct: Buffer.from('outra coisa').toString('base64') }),
        'texto cifrado trocado quebra a decifra');
  lanca(() => decifrar({ ...e, tag: Buffer.alloc(16).toString('base64') }),
        'tag de autenticação inválida quebra');
  lanca(() => decifrar({ ...e, iv: Buffer.alloc(12).toString('base64') }),
        'IV trocado quebra');
}

console.log('\n--- envelope inválido ---');
lanca(() => decifrar(null), 'nulo');
lanca(() => decifrar({}), 'objeto vazio');
lanca(() => decifrar({ v: 2, iv: 'a', tag: 'b', ct: 'c' }), 'versão desconhecida não é adivinhada');
lanca(() => decifrar('texto puro'), 'string crua não é aceita como envelope');

console.log('\n--- chave mestra ---');
eq(cofreDisponivel(), true, 'com a variável definida o cofre está disponível');
{
  const antes = process.env.INTEGRACOES_MASTER_KEY;
  process.env.INTEGRACOES_MASTER_KEY = '';
  eq(cofreDisponivel(), false, 'sem a variável o cofre avisa que não está disponível');
  lanca(() => cifrar('x'), 'e cifrar lança em vez de gravar em texto puro');
  process.env.INTEGRACOES_MASTER_KEY = '123';
  lanca(() => cifrar('x'), 'frase curta é recusada, não derivada');
  process.env.INTEGRACOES_MASTER_KEY = 'uma frase longa o suficiente para virar chave derivada';
  eq(decifrar(cifrar('ok')), 'ok', 'frase longa é aceita e derivada por SHA-256');
  process.env.INTEGRACOES_MASTER_KEY = antes;
}
{
  // Trocar a chave mestra não pode devolver segredo errado: tem que falhar.
  const e = cifrar('segredo original');
  process.env.INTEGRACOES_MASTER_KEY =
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  lanca(() => decifrar(e), 'chave mestra diferente não decifra, e não devolve lixo');
  process.env.INTEGRACOES_MASTER_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}
eq(ErroCofre.name, 'ErroCofre', 'erro tem tipo próprio, para a rota distinguir');

console.log('\n--- máscara ---');
eq(mascarar('sk_live_1234567890abcdef'), 'sk_l••••••••••••cdef', 'mostra pontas, esconde o meio');
eq(mascarar('curto'), '•••••', 'segredo curto vira só pontos');
eq(mascarar(''), '', 'vazio continua vazio');
eq(mascarar('sk_live_1234567890abcdef').includes('567890'), false,
   'o miolo do segredo NUNCA aparece');

console.log(`\n${total - falhas}/${total} testes do cofre passaram`);
process.exit(falhas > 0 ? 1 : 0);
