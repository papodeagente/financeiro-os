/**
 * Situação no Simples Nacional (src/lib/nfse-simples.ts).
 *
 * Caso que motivou: a prefeitura recusou a nota com E0160, "a opção de
 * situação perante o Simples Nacional informada na DPS não está de acordo
 * com o cadastro". A leitura anterior só aceitava a string literal "true",
 * então toda empresa optante era declarada NÃO OPTANTE.
 */
import {
  situacaoSimples, lerBooleano, lerData, explicarE0160, ROTULO_ENQUADRAMENTO, lerErroNota,
} from '../src/lib/nfse-simples.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const enq = (d: unknown, mes?: string) => situacaoSimples(d, mes).enquadramento;

console.log('--- os formatos reais das bases de CNPJ ---');
eq(enq({ opcao_pelo_simples: true }), 3, 'BrasilAPI: booleano true vira optante');
eq(enq({ opcao_pelo_simples: false }), 1, 'BrasilAPI: booleano false vira não optante');
eq(enq({ simples: { optante: true } }), 3, 'CNPJá: objeto aninhado');
eq(enq({ opcao_pelo_simples: 'S' }), 3, 'ReceitaWS: letra S');
eq(enq({ opcao_pelo_simples: 'N' }), 1, 'ReceitaWS: letra N');
eq(enq({ opcao_pelo_simples: 'Sim' }), 3, 'texto Sim, sem depender de caixa');
eq(enq({ opcao_pelo_simples: 'true' }), 3, 'a string literal continua funcionando');
eq(enq({ optante_simples_nacional: 1 }), 3, 'número 1');
eq(enq({ optante_simples_nacional: 0 }), 1, 'número 0');

console.log('\n--- MEI ---');
eq(enq({ opcao_pelo_simples: true, opcao_pelo_mei: true }), 2, 'MEI tem código próprio, mais específico');
eq(enq({ simples: { optante: true }, mei: { optante: true } }), 2, 'MEI aninhado');
eq(enq({ opcao_pelo_simples: true, opcao_pelo_mei: false }), 3, 'optante que não é MEI é ME ou EPP');

console.log('\n--- não saber é diferente de saber que não ---');
eq(enq({}), 0, 'base que não informou devolve zero, não "não optante"');
eq(enq({ razao_social: 'Agencia X' }), 0, 'resposta sem o campo também é zero');
eq(enq({ opcao_pelo_simples: '' }), 0, 'campo vazio não vira não optante');
eq(enq({ opcao_pelo_simples: null }), 0, 'nulo não vira não optante');
eq(situacaoSimples({}).motivo.includes('não informou'), true, 'e o motivo diz isso');

console.log('\n--- a competência é o que o E0160 compara ---');
{
  const d = { opcao_pelo_simples: true, data_opcao_pelo_simples: '2026-03-01' };
  eq(enq(d, '2026-02'), 1, 'nota de fevereiro: a empresa ainda não era optante');
  eq(enq(d, '2026-03'), 3, 'nota de março: já era, no mês da entrada');
  eq(enq(d, '2026-09'), 3, 'nota depois da entrada');
  eq(enq(d), 3, 'sem competência informada, responde a situação de hoje');
}
{
  const d = { opcao_pelo_simples: true, data_exclusao_do_simples: '2026-06-30' };
  eq(enq(d, '2026-06'), 3, 'no mês da saída ainda conta como optante');
  eq(enq(d, '2026-07'), 1, 'depois da saída, não optante');
}
{
  const d = { simples: { optante: true, data_opcao: '01/03/2026' } };
  eq(enq(d, '2026-02'), 1, 'data em DD/MM/AAAA também é entendida');
}
eq(situacaoSimples({ opcao_pelo_simples: true, data_opcao_pelo_simples: '2026-03-01' }, '2026-02').motivo.includes('2026-03'),
   true, 'o motivo diz a data que causou a diferença');

console.log('\n--- leitura de booleano ---');
eq(lerBooleano(true), true, 'booleano');
eq(lerBooleano('  SIM '), true, 'texto com espaço e caixa alta');
eq(lerBooleano('não'), false, 'com acento');
eq(lerBooleano('talvez'), null, 'texto desconhecido não vira false');
eq(lerBooleano(undefined), null, 'ausente é null, não false');
eq(lerBooleano(2), null, 'número fora de 0 e 1 não é booleano');

console.log('\n--- leitura de data ---');
eq(lerData('2026-03-01T10:00:00Z'), '2026-03-01', 'ISO com hora');
eq(lerData('01/03/2026'), '2026-03-01', 'formato brasileiro');
eq(lerData('março'), '', 'texto que não é data devolve vazio');
eq(lerData(null), '', 'nulo devolve vazio');

console.log('\n--- texto de ajuda ---');
eq(explicarE0160(1).includes('Não optante do Simples'), true, 'a explicação diz o que foi enviado');
eq(explicarE0160(3).includes('atualizar os dados da empresa'), true, 'e diz o que fazer');
eq(ROTULO_ENQUADRAMENTO[2], 'Optante, MEI', 'rótulo do MEI');

console.log('\n--- traduzir a recusa da prefeitura ---');
{
  // O corpo exato que a prefeitura devolveu no caso relatado.
  const recusa = {
    tipoAmbiente: 1,
    versaoAplicativo: 'SefinNacional_1.6.0',
    erros: [{
      Codigo: 'E0160',
      Descricao: 'No mês de competência da NFS-e, a opção de situação perante o Simples Nacional, do prestador, informada na DPS não está de acordo com o cadastro Simples Nacional.',
    }],
  };
  const r = lerErroNota(recusa);
  eq(r.codigos, ['E0160'], 'acha o código dentro do corpo');
  eq(r.explicacao.includes('atualizar os dados da empresa'), true, 'e explica o que fazer');
  eq(r.original.includes('SefinNacional'), true, 'o texto original é preservado para o suporte');
}
{
  // Na prática a recusa chega como STRING JSON dentro da mensagem.
  const comoChega = 'Emissão rejeitada: {"erros":[{"Codigo":"E0160","Descricao":"x"}]}';
  eq(lerErroNota(comoChega).codigos, ['E0160'], 'abre o JSON embutido no texto');
}
{
  const texto = 'Falhou com E0160 e E0043';
  eq(lerErroNota(texto).codigos, ['E0160', 'E0043'], 'acha código solto no texto, sem JSON');
}
eq(lerErroNota({ erros: [{ Codigo: 'E9999' }] }).explicacao, '',
   'código desconhecido não inventa explicação');
eq(lerErroNota({ erros: [{ Codigo: 'E9999' }] }).codigos, ['E9999'],
   'mas o código aparece, para o suporte ter por onde começar');
eq(lerErroNota(null).codigos, [], 'corpo vazio não quebra');

console.log(`\n${total - falhas}/${total} testes do Simples Nacional passaram`);
process.exit(falhas > 0 ? 1 : 0);
