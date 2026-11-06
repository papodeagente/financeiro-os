/**
 * Contas bancárias (06/11/2026, E7), lógica pura: lista oficial de bancos
 * (Banco Central), dados do cadastro (titular, dígitos, banco da lista),
 * desativada fora dos seletores e a marca "Fechado" do extrato.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-contas-bancarias-e7.ts
 */
import { BANCOS, bancoPorCodigo, buscarBancos, rotuloDoBanco } from '../src/lib/bancos.ts';
import { identificacaoDaConta, normalizarDadosDaConta } from '../src/lib/contas-bancarias-dados.ts';
import { contaBancariaAtiva, contasParaEscolher } from '../src/lib/contas-bancarias-regras.ts';
import { marcarFechados, type MovimentoCaixa } from '../src/lib/movimentos-caixa.ts';
import { mensagemContaComMovimento } from '../src/lib/contas-bancarias-servidor.ts';

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

console.log('--- Lista oficial de bancos ---');
eq(BANCOS.length > 300, true, 'centenas de instituições com código');
eq(new Set(BANCOS.map(b => b.codigo)).size, BANCOS.length, 'códigos únicos');
eq(BANCOS.every(b => /^\d{3}$/.test(b.codigo) && /^\d{8}$/.test(b.ispb) && b.nome.length > 0), true, 'código com 3 dígitos, ISPB com 8, nome preenchido');
eq([bancoPorCodigo('1')?.nome, bancoPorCodigo('001')?.ispb, bancoPorCodigo(' 341 ')?.codigo, bancoPorCodigo('abc'), bancoPorCodigo('9999')],
  ['Banco do Brasil S.A.', '00000000', '341', null, null], 'por código, com ou sem zeros');
eq(buscarBancos('341')[0]?.codigo, '341', 'código exato vem primeiro');
eq(buscarBancos('itau').some(b => b.codigo === '341'), true, 'busca sem acento acha o Itaú');
eq(buscarBancos('inter').some(b => b.codigo === '077'), true, 'busca pelo nome curto');
eq(buscarBancos('').length, 20, 'sem texto: os primeiros');
eq(rotuloDoBanco({ codigo: '001', nome: 'Banco do Brasil S.A.' }), '001 · Banco do Brasil S.A.', 'rótulo com código');

console.log('--- Dados do cadastro ---');
let item: Record<string, unknown> = { titular: '  Entur   Viagens ', titular_documento: '12.345.678/0001-90', agencia_digito: 'x', conta_digito: '7', banco_codigo: '77', banco: '' };
eq([normalizarDadosDaConta(item), item.titular, item.titular_documento, item.agencia_digito, item.banco_codigo, item.banco_ispb, item.banco],
  [null, 'Entur Viagens', '12345678000190', 'X', '077', '00416968', 'Banco Inter S.A.'], 'limpa titular, documento, dígito e completa o banco da lista');
eq(normalizarDadosDaConta({ titular_documento: '123' }), 'O CPF ou CNPJ do titular precisa ter 11 ou 14 números.', 'documento inválido recusado');
eq(normalizarDadosDaConta({ conta_digito: '123' }) !== null, true, 'dígito com 3 caracteres recusado');
eq(normalizarDadosDaConta({ banco_codigo: '998' }), 'Escolha o banco na lista oficial.', 'código fora da lista recusado');
item = { banco: 'Banco antigo em texto', agencia: ' 1234 ' };
eq([normalizarDadosDaConta(item), item.banco, item.agencia, 'banco_codigo' in item], [null, 'Banco antigo em texto', '1234', false], 'conta antiga em texto livre fica como está');
item = { ativo: 'false' };
normalizarDadosDaConta(item);
eq(item.ativo, false, 'ativo normalizado');
eq(identificacaoDaConta({ agencia: '1234', agencia_digito: '5', conta: '98765', conta_digito: '0' }), 'Ag 1234-5 · Conta 98765-0', 'agência e conta com dígito');
eq(identificacaoDaConta({ agencia: '0001', conta: '' }), 'Ag 0001', 'sem dígito e sem conta');

console.log('--- Desativada ---');
const contas = [{ id: 'a' }, { id: 'b', ativo: false }, { id: 'c', ativo: true }];
eq([contaBancariaAtiva(contas[0]), contaBancariaAtiva(contas[1]), contaBancariaAtiva(null)], [true, false, false], 'ausente = ativa');
eq(contasParaEscolher(contas).map(c => c.id), ['a', 'c'], 'desativada some do seletor');
eq(contasParaEscolher(contas, 'b').map(c => c.id), ['a', 'b', 'c'], 'a já escolhida continua visível');
eq(mensagemContaComMovimento(['2 contas a pagar', '1 transferência']).startsWith('Esta conta já foi usada (2 contas a pagar e 1 transferência)'), true, 'frase da recusa');

console.log('--- Fechado no extrato ---');
const linha = (conta_id: string, data: string) => ({ conta_id, data, fechado: false }) as unknown as MovimentoCaixa;
const marcadas = marcarFechados([linha('b1', '2026-10-31'), linha('b1', '2026-11-01'), linha('b2', '2026-10-15'), linha('b2', '2026-10-20'), linha('b3', '')],
  new Map([['', '2026-10-15'], ['b1', '2026-10-31']]));
eq(marcadas.map(l => l.fechado), [true, false, true, false, false], 'fechado pela conta ou pela agência inteira; sem data, aberto');
eq(marcarFechados([linha('b1', '2026-01-01')], new Map()).map(l => l.fechado), [false], 'sem fechamento, nada fechado');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
