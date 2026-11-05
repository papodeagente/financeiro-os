/**
 * "Ler boleto ou nota": limpeza do que a IA leu e conferência com o leitor
 * puro do boleto (src/lib/leitura-documento.ts), 05/11/2026.
 * Uso: node --experimental-strip-types scripts/run-tests.mjs scripts/test-leitura-documento.ts
 */
import { conferirLeitura, formatarDocumento, jsonDaResposta, normalizarExtracao, valorEmReais, type RespostaDaLeitura } from '../src/lib/leitura-documento.ts';
import {
  aplicarLeitura, descartarLeitura, escolherNaDivergencia, esquecerOrigem, ligarFornecedorCadastrado, trocarLeitura, usarDoBoleto,
} from '../src/app/financeiro-ag/pagar/leitura.ts';
import { EMPTY_FORM } from '../src/app/financeiro-ag/pagar/tipos.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const BRADESCO = '23793381286000782713695000063305975520000370000'; // R$ 3.700,00, 11/06/2018
const TELEFONE = '846700000017435900240209024050002435842210108119'; // R$ 143,59
const HOJE = '2026-11-05';
const ia = (extra: Record<string, unknown>) => normalizarExtracao({
  tipo_documento: 'boleto', fornecedor_nome: 'Operadora Sol', fornecedor_cnpj: '12.345.678/0001-95',
  descricao: 'Hospedagem do grupo', ...extra,
});

console.log('--- Resposta da IA ---');
eq(jsonDaResposta('```json\n{"valor": 10}\n```'), { valor: 10 }, 'recorta o JSON da cerca de código');
eq(jsonDaResposta('não consegui ler'), null, 'sem JSON: null');
eq(jsonDaResposta('[1,2]'), null, 'lista não é leitura');
eq([valorEmReais('1.234,56'), valorEmReais('R$ 99,90'), valorEmReais(12.345), valorEmReais(-3), valorEmReais('abc')], [1234.56, 99.9, 12.35, null, null],
  'valor em reais: formato brasileiro, número, negativo e lixo');

console.log('--- Limpeza ---');
let e = normalizarExtracao({
  tipo_documento: 'planilha', fornecedor_nome: '  Hotel\nPraia  ', fornecedor_cnpj: '123', valor: '0',
  vencimento: '2026-02-30', data_emissao: '2026-10-01', linha_digitavel: 'NF 1234', chave_pix: 'pix@hotel.com',
  numero_documento: 9876,
});
eq([e.tipo_documento, e.fornecedor_nome, e.fornecedor_cnpj, e.valor, e.vencimento, e.data_emissao, e.linha_digitavel, e.chave_pix, e.numero_documento],
  ['outro', 'Hotel Praia', '', null, null, '2026-10-01', '', 'pix@hotel.com', '9876'],
  'tipo desconhecido vira "outro", CNPJ curto some, data impossível some, número de nota não vira linha');
eq(normalizarExtracao(null).tipo_documento, 'outro', 'nada lido: leitura vazia');
eq(ia({}).fornecedor_cnpj, '12345678000195', 'CNPJ só com dígitos');

console.log('--- Boleto que confere ---');
let l = conferirLeitura(ia({ valor: 3700, vencimento: '2018-06-11', linha_digitavel: BRADESCO }), HOJE);
eq([l.valor, l.valor_origem, l.vencimento, l.vencimento_origem, l.boleto?.confere, l.boleto?.emissor, l.divergencias.length],
  [3700, 'boleto', '2018-06-11', 'boleto', true, 'Banco 237', 0], 'IA e boleto batem: valor e vencimento conferidos pelo boleto');
l = conferirLeitura(ia({ linha_digitavel: BRADESCO }), HOJE);
eq([l.valor, l.valor_origem, l.vencimento], [3700, 'boleto', '2018-06-11'], 'IA não achou valor nem data: o boleto preenche');

console.log('--- Divergência ---');
l = conferirLeitura(ia({ valor: 3900, vencimento: '2018-06-11', linha_digitavel: BRADESCO }), HOJE);
eq([l.valor, l.valor_origem, l.vencimento], [null, null, '2018-06-11'], 'valor diferente: o valor NÃO é preenchido, a data sim');
eq(l.divergencias.map(d => [d.campo, d.no_documento, d.no_boleto].map(s => s.replace(/\u00a0/g, ' '))), [['valor', 'R$ 3.900,00', 'R$ 3.700,00']], 'a divergência mostra os dois valores');
l = conferirLeitura(ia({ valor: 3700, vencimento: '2018-06-12', linha_digitavel: BRADESCO }), HOJE);
eq([l.valor, l.vencimento, l.divergencias.map(d => d.campo)], [3700, null, ['vencimento']], 'data diferente: o vencimento NÃO é preenchido');

console.log('--- Linha que não confere ---');
const errada = BRADESCO.slice(0, 40) + '9' + BRADESCO.slice(41);
l = conferirLeitura(ia({ valor: 3700, vencimento: '2018-06-11', linha_digitavel: errada }), HOJE);
eq([l.valor, l.valor_origem, l.vencimento, l.boleto?.confere], [null, null, '2018-06-11', false], 'linha com dígito errado: valor fica em branco');
eq(l.avisos, ['A linha digitável lida não confere. O valor não foi preenchido: confira no papel.'], 'e a tela avisa');

console.log('--- Conta de consumo e nota ---');
l = conferirLeitura(ia({ tipo_documento: 'boleto', valor: 143.59, vencimento: '2026-11-20', linha_digitavel: TELEFONE }), HOJE);
eq([l.valor, l.valor_origem, l.vencimento, l.vencimento_origem, l.boleto?.emissor], [143.59, 'boleto', '2026-11-20', 'documento', 'Telecomunicações'],
  'conta de consumo: valor pelo código, data pelo documento');
l = conferirLeitura(ia({ tipo_documento: 'nota_fiscal', valor: 850, vencimento: '2026-12-01', numero_documento: '4521' }), HOJE);
eq([l.valor, l.valor_origem, l.vencimento_origem, l.boleto, l.avisos], [850, 'documento', 'documento', null, []], 'nota fiscal: valor e data lidos do documento');
l = conferirLeitura(ia({ valor: 100 }), HOJE);
eq(l.avisos, ['A linha digitável não foi encontrada. Confira o valor e o vencimento no papel.'], 'boleto sem linha: avisa');

console.log('--- Formatação ---');
eq([formatarDocumento('12345678000195'), formatarDocumento('12345678909')], ['12.345.678/0001-95', '123.456.789-09'], 'CNPJ e CPF com pontuação');

console.log('--- No formulário de conta a pagar ---');
const resposta = (lidoExtra: Record<string, unknown>, sugestoes: Partial<RespostaDaLeitura['sugestoes']> = {}, url = '/api/comprovantes/leitura-a.pdf'): RespostaDaLeitura => ({
  leitura: conferirLeitura(ia(lidoExtra), HOJE),
  sugestoes: { fornecedor: null, sugerir_criar: true, categorias: [], ...sugestoes },
  anexo: { nome: 'boleto.pdf', url }, hash: 'h', repetida: false, gravado: false,
});
const comCadastro = {
  fornecedor: { id: 'f-sol', nome: 'Sol Operadora', documento: '12345678000195', como: 'documento' as const },
  sugerir_criar: false,
  categorias: [{ id: 'cat-hosp', codigo: '2.1', nome: 'Hospedagem', vezes: 2 }, { id: 'cat-aereo', codigo: '2.2', nome: 'Aéreo', vezes: 1 }],
};
let f = aplicarLeitura(EMPTY_FORM, resposta({ valor: 3700, vencimento: '2018-06-11', linha_digitavel: BRADESCO, numero_documento: '633' }, comCadastro));
eq([f.fornecedor_nome, f.fornecedor_id, f.fornecedor_cnpj, f.descricao, f.valor_original, f.data_vencimento, f.categoria_id, f.forma_pagamento, f.linha_digitavel, f.numero_documento],
  ['Sol Operadora', 'f-sol', '12345678000195', 'Hospedagem do grupo', 3700, '2018-06-11', 'cat-hosp', 'BOLETO', BRADESCO, '633'],
  'formulário vazio: tudo preenchido, fornecedor do cadastro, categoria mais usada, forma Boleto');
eq(f.leitura?.origens, {
  fornecedor: 'Do cadastro de fornecedores, pelo CNPJ.', descricao: 'Lido do documento. Confira.',
  valor: 'Conferido pelo código do boleto.', vencimento: 'Conferido pelo código do boleto.', categoria: 'Usada 2 vezes para este fornecedor.',
}, 'cada campo diz de onde veio');
eq(f.anexos, [{ nome: 'boleto.pdf', url: '/api/comprovantes/leitura-a.pdf' }], 'o arquivo entra nos anexos (salvo só com a conta)');
eq(esquecerOrigem(f, 'valor').leitura?.origens.valor, undefined, 'editar o valor apaga a origem');
eq(esquecerOrigem(f, 'fornecedor').fornecedor_id, '', 'editar o fornecedor que a leitura ligou desfaz esse vínculo');
const contaQueJaExistia = { ...EMPTY_FORM, fornecedor_nome: 'Operadora', fornecedor_id: 'f-crm' };
eq(esquecerOrigem(contaQueJaExistia, 'fornecedor'), contaQueJaExistia, 'na edição de uma conta (sem leitura), o vínculo de antes fica como está');

const digitado = { ...EMPTY_FORM, fornecedor_nome: 'Digitado', valor_original: 50 };
f = aplicarLeitura(digitado, resposta({ valor: 3700, linha_digitavel: BRADESCO }));
eq([f.fornecedor_nome, f.valor_original, f.leitura?.mantidos], ['Digitado', 50, ['fornecedor', 'valor']], 'o que a pessoa já digitou fica, e a tela diz quais');

f = aplicarLeitura(EMPTY_FORM, resposta({ valor: 3900, vencimento: '2018-06-11', linha_digitavel: BRADESCO }));
eq([f.valor_original, f.leitura?.origens.valor], [0, undefined], 'divergência: o valor fica em branco');
const d = f.leitura!.resposta.leitura.divergencias[0];
eq([escolherNaDivergencia(f, d, 'boleto').valor_original, escolherNaDivergencia(f, d, 'documento').valor_original, escolherNaDivergencia(f, d, 'boleto').leitura?.resolvidas],
  [3700, 3900, ['valor']], 'a pessoa escolhe o lado');
eq([usarDoBoleto(f, { valor: 3700, vencimento: null }).valor_original, usarDoBoleto(f, { valor: 3700, vencimento: null }).leitura?.resolvidas], [3700, ['valor']],
  '"Usar o valor do boleto" da linha digitável resolve a divergência');

f = aplicarLeitura(EMPTY_FORM, resposta({ tipo_documento: 'nota_fiscal', descricao: '', numero_documento: '4521', valor: 850, chave_pix: 'pix@hotel.com' }));
eq([f.descricao, f.forma_pagamento, f.chave_pix, f.leitura?.origens.fornecedor], ['Nota fiscal 4521', 'PIX', 'pix@hotel.com', 'Lido do documento. Ainda não está no cadastro.'],
  'nota sem descrição: "Nota fiscal 4521"; com chave Pix, forma Pix');
f = ligarFornecedorCadastrado(f, { id: 'f-novo', nome: 'Operadora Sol' });
eq([f.fornecedor_id, f.leitura?.resposta.sugestoes.sugerir_criar], ['f-novo', false], 'cadastrado pelo botão: a conta fica ligada');

f = aplicarLeitura(EMPTY_FORM, resposta({ valor: 3700, linha_digitavel: BRADESCO }, comCadastro));
f = { ...esquecerOrigem(f, 'descricao'), descricao: 'Minha descrição' };
f = trocarLeitura(f, resposta({ tipo_documento: 'nota_fiscal', fornecedor_nome: 'Hotel Praia', fornecedor_cnpj: '', valor: 90, descricao: 'Diária' }, {}, '/api/comprovantes/leitura-b.pdf'));
eq([f.fornecedor_nome, f.fornecedor_id, f.descricao, f.valor_original, f.categoria_id, f.linha_digitavel, f.anexos.map(a => a.url)],
  ['Hotel Praia', '', 'Minha descrição', 90, '', '', ['/api/comprovantes/leitura-b.pdf']],
  'ler outro arquivo: troca o que veio do primeiro, mantém o que a pessoa digitou, troca o anexo');
eq([descartarLeitura(f).anexos, descartarLeitura(f).leitura, descartarLeitura(f).valor_original], [[], null, 90], 'descartar: tira o anexo, os campos ficam');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
