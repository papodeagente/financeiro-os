/**
 * Campos personalizados dos títulos (06/11/2026, E7), lógica pura:
 * definições normalizadas, valores saneados antes de gravar, conversão do que
 * a tela digita, obrigatórios e formatação pt-BR para lista e planilha.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-campos-personalizados.ts
 */
import {
  camposDaTabela, formatarValorDoCampo, idParaNome, normalizarDefinicoes, problemaNasDefinicoes,
  sanearCamposPersonalizadosDoItem, validarObrigatorios, valorParaGravar,
} from '../src/lib/campos-personalizados.ts';
import { camposDaConfig } from '../src/lib/contas-pagar-receber.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

console.log('--- Definições ---');
const defs = normalizarDefinicoes({
  campos: [
    { id: 'pedido', nome: '  Pedido   do cliente ', tipo: 'texto', ativo: true, aplica_a: 'receber', obrigatorio: true },
    { nome: 'Aprovado pelo sócio', tipo: 'sim_nao', aplica_a: 'pagar' },
    { id: 'pedido', nome: 'Repetido', tipo: 'numero' },
    { nome: '', tipo: 'texto' },
    { nome: 'Região', tipo: 'lista', opcoes: ['Sul', 'sul', ' Norte ', '', 'Sudeste'] },
    { nome: 'Estranho', tipo: 'cor', aplica_a: 'tudo', ativo: false },
    'lixo',
  ],
});
eq(defs.map(d => [d.id, d.nome, d.tipo, d.aplica_a, d.ativo]), [
  ['pedido', 'Pedido do cliente', 'texto', 'receber', true],
  ['aprovado_pelo_socio', 'Aprovado pelo sócio', 'sim_nao', 'pagar', true],
  ['repetido', 'Repetido', 'numero', 'ambos', true],
  ['regiao', 'Região', 'lista', 'ambos', true],
  ['estranho', 'Estranho', 'texto', 'ambos', false],
], 'nome limpo, id estável sem acento, id repetido ganha outro, tipo e alcance desconhecidos caem no padrão');
eq(defs[3].opcoes, ['Sul', 'Norte', 'Sudeste'], 'opções sem vazias nem repetidas');
eq(normalizarDefinicoes(Array.from({ length: 40 }, (_, i) => ({ nome: `C${i}` }))).length, 30, 'no máximo 30 campos');
eq(idParaNome('Pedido', new Set(['pedido', 'pedido_2'])), 'pedido_3', 'id não repete');
eq(problemaNasDefinicoes([{ id: 'a', nome: 'A', tipo: 'texto', ativo: true, aplica_a: 'ambos' }, { id: 'b', nome: 'a', tipo: 'texto', ativo: true, aplica_a: 'ambos' }]),
  'Já existe um campo chamado "a".', 'nome repetido (sem diferença de maiúsculas) recusado');
eq(problemaNasDefinicoes([{ id: 'l', nome: 'Lista', tipo: 'lista', opcoes: [], ativo: true, aplica_a: 'ambos' }]),
  'O campo "Lista" é uma lista: escreva ao menos uma opção.', 'lista sem opção recusada');
eq(camposDaTabela(defs, 'contas_pagar').map(d => d.id), ['aprovado_pelo_socio', 'repetido', 'regiao'], 'pagar: só os que valem e ativos');
eq(camposDaTabela(defs, 'contas_receber', { incluirInativos: true }).map(d => d.id), ['pedido', 'repetido', 'regiao', 'estranho'], 'receber com inativos');
eq(camposDaConfig({ campos: defs }).map(d => d.id), ['pedido', 'aprovado_pelo_socio', 'repetido', 'regiao'], 'a lista de contas lê as mesmas definições (sem as inativas)');

console.log('--- Valores ao gravar ---');
let item: Record<string, unknown> = { campos_personalizados: { pedido: '  PO-1 ', ok: false, n: 2.5, vazio: '  ', nada: null } };
eq([sanearCamposPersonalizadosDoItem(item), item.campos_personalizados], [null, { pedido: 'PO-1', ok: false, n: 2.5 }], 'limpa espaços e tira vazios');
item = { campos_personalizados: { texto: 'x'.repeat(900) } };
sanearCamposPersonalizadosDoItem(item);
eq(((item.campos_personalizados as Record<string, string>).texto).length, 500, 'texto cortado em 500');
eq(sanearCamposPersonalizadosDoItem({ campos_personalizados: { 'Ruim!': 'x' } }), 'Campo personalizado com identificador inválido.', 'id inválido recusado');
eq(sanearCamposPersonalizadosDoItem({ campos_personalizados: { a: { b: 1 } } }) !== null, true, 'objeto recusado');
eq(sanearCamposPersonalizadosDoItem({ campos_personalizados: { a: Number.NaN } }), 'Campo personalizado com número inválido.', 'número inválido recusado');
eq(sanearCamposPersonalizadosDoItem({ campos_personalizados: [1] }), 'Campos personalizados em formato inválido.', 'lista recusada');
item = { campos_personalizados: null };
eq([sanearCamposPersonalizadosDoItem(item), 'campos_personalizados' in item], [null, false], 'nulo sai do registro');
eq(sanearCamposPersonalizadosDoItem({ descricao: 'sem campos' }), null, 'título sem campos: nada a fazer');

console.log('--- O que a tela digita ---');
eq(valorParaGravar({ tipo: 'numero' }, '1.234,5'), 1234.5, 'número em pt-BR');
eq(valorParaGravar({ tipo: 'numero' }, 'abc'), null, 'número inválido vira vazio');
eq(valorParaGravar({ tipo: 'sim_nao' }, 'nao'), false, 'não');
eq(valorParaGravar({ tipo: 'data' }, '2026-11-06'), '2026-11-06', 'data');
eq(valorParaGravar({ tipo: 'data' }, '06/11/2026'), null, 'data fora do formato do campo de data vira vazio');
eq(valorParaGravar({ tipo: 'lista', opcoes: ['Sul'] }, 'Sul'), 'Sul', 'opção da lista');
eq(valorParaGravar({ tipo: 'texto' }, '   '), null, 'texto vazio');

console.log('--- Obrigatórios e formatação ---');
eq(validarObrigatorios(defs, 'contas_receber', {}), 'Preencha o campo "Pedido do cliente".', 'obrigatório vazio');
eq(validarObrigatorios(defs, 'contas_receber', { pedido: 'X' }), null, 'obrigatório preenchido');
eq(validarObrigatorios(defs, 'contas_pagar', {}), null, 'obrigatório só vale onde o campo aparece');
eq([formatarValorDoCampo({ tipo: 'sim_nao' }, true), formatarValorDoCampo({ tipo: 'data' }, '2026-01-31'), formatarValorDoCampo({ tipo: 'numero' }, 1234.5),
  formatarValorDoCampo({ tipo: 'texto' }, null)], ['Sim', '31/01/2026', '1.234,5', ''], 'formatação pt-BR');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
