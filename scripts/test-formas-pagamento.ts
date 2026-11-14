/**
 * Formas de pagamento (src/lib/formas-pagamento.ts), 05/11/2026.
 *
 * O que não pode quebrar: os valores já gravados nos títulos ('PIX', 'TED',
 * 'CARTAO', 'BOLETO', 'DINHEIRO', 'CHEQUE', 'CARTAO_CORP', 'DEPOSITO')
 * continuam aparecendo e continuam sendo a escolha do campo, sem reescrita.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-formas-pagamento.ts
 */
import {
  FORMAS_DO_SISTEMA, codigoParaNome, detalheDaForma, formaDoValor, formasDaAgencia,
  opcoesDeForma, rotuloDaForma, taxaDaForma, validarAjuste,
} from '../src/lib/formas-pagamento.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- Formas de sempre ---');
eq(FORMAS_DO_SISTEMA.map(f => f.nome), [
  'Pix', 'Dinheiro', 'Cheque', 'Boleto', 'Cartão de crédito', 'Cartão de débito',
  'Depósito/Transferência', 'Faturar', 'Cartão corporativo', 'Outros',
], 'as formas de sempre, com Pix');
const semAjuste = formasDaAgencia([]);
eq(semAjuste.length, FORMAS_DO_SISTEMA.length, 'agência sem cadastro vê as formas de sempre');

console.log('--- Valores já gravados (nunca reescritos) ---');
// Os rótulos de antes, como os formulários mostravam.
eq(['PIX', 'TED', 'BOLETO', 'DINHEIRO', 'CHEQUE', 'CARTAO_CORP'].map(v => rotuloDaForma(v, semAjuste)),
  ['Pix', 'Depósito/Transferência', 'Boleto', 'Dinheiro', 'Cheque', 'Cartão corporativo'],
  'códigos antigos casam direto com a forma de sempre');
eq([rotuloDaForma('CARTAO', semAjuste), rotuloDaForma('DEPOSITO', semAjuste)], ['Cartão', 'Depósito'],
  '"CARTAO" e "DEPOSITO" (sem par exato) aparecem como antes');
eq(rotuloDaForma('', semAjuste), '', 'sem forma continua sem forma');
eq(rotuloDaForma('VALE_VIAGEM', semAjuste), 'Vale viagem', 'forma própria apagada: o texto, legível');
eq(rotuloDaForma('Hotmart', semAjuste), 'Hotmart', 'texto livre antigo (nome da plataforma) aparece como estava');

for (const sentido of ['receber', 'pagar'] as const) {
  for (const antigo of ['CARTAO', 'DEPOSITO', 'PIX', 'TED', 'BOLETO']) {
    const op = opcoesDeForma(semAjuste, sentido, antigo);
    eq(op.some(o => o.valor === antigo), true, `${sentido}: valor "${antigo}" gravado continua entre as escolhas (salvar sem mexer não troca)`);
  }
}
eq(opcoesDeForma(semAjuste, 'receber').some(o => o.valor === 'CARTAO_CORP'), false, 'cartão corporativo só aparece em contas a pagar');
eq(opcoesDeForma(semAjuste, 'pagar').some(o => o.valor === 'CARTAO_CORP'), true, 'contas a pagar mantêm o cartão corporativo (liga ao cartão cadastrado)');
eq(opcoesDeForma(semAjuste, 'receber', 'CARTAO')[0], { valor: 'CARTAO', rotulo: 'Cartão' }, 'valor antigo vem primeiro, com o rótulo de antes');

console.log('--- Ajustes da agência ---');
const ajustadas = formasDaAgencia([
  { codigo: 'CARTAO_CREDITO', conta_bancaria_id: 'b-stone', dias_para_cair: 30, taxa_pct: 3.49, taxa_fixa: 0, nome: 'IGNORADO', uso: 'pagar' },
  { codigo: 'CHEQUE', ativo: false },
  { codigo: 'VALE_VIAGEM', nome: 'Vale-viagem', uso: 'receber', dias_para_cair: 0, taxa_pct: 0, taxa_fixa: 0, ordem: 1000 },
]);
const cc = ajustadas.find(f => f.codigo === 'CARTAO_CREDITO')!;
eq([cc.nome, cc.uso, cc.conta_bancaria_id, cc.dias_para_cair, cc.taxa_pct], ['Cartão de crédito', 'ambos', 'b-stone', 30, 3.49],
  'forma de sempre: nome e uso não mudam; conta, dias e taxa sim');
eq(opcoesDeForma(ajustadas, 'receber').some(o => o.valor === 'CHEQUE'), false, 'forma desligada sai das escolhas novas');
eq(opcoesDeForma(ajustadas, 'receber', 'CHEQUE').some(o => o.valor === 'CHEQUE'), true, '...mas continua para a conta que já a usa');
eq(opcoesDeForma(ajustadas, 'pagar').some(o => o.valor === 'VALE_VIAGEM'), false, 'forma própria "só receber" não aparece no pagar');
eq(opcoesDeForma(ajustadas, 'receber').find(o => o.valor === 'VALE_VIAGEM')?.rotulo, 'Vale-viagem', 'forma própria aparece no receber');
eq(formaDoValor('CARTAO', ajustadas)?.conta_bancaria_id, 'b-stone', '"CARTAO" antigo acha a conta padrão do cartão de crédito');
eq(formaDoValor('DEPOSITO', ajustadas)?.codigo, 'TED', '"DEPOSITO" antigo acha Depósito/Transferência');
eq(formaDoValor('', ajustadas), null, 'sem forma, sem padrão');

console.log('--- Prazo e taxa ---');
eq(detalheDaForma(cc), 'Cai em 30 dias · taxa de 3,49%', 'linha curta de prazo e taxa');
eq(detalheDaForma({ dias_para_cair: 1, taxa_pct: 0, taxa_fixa: 1.99 }), 'Cai em 1 dia · taxa de R$ 1,99', 'taxa fixa');
eq(detalheDaForma({ dias_para_cair: 0, taxa_pct: 0, taxa_fixa: 0 }), '', 'na hora e sem taxa: nada a dizer');
eq(taxaDaForma(1000, { taxa_pct: 3.49, taxa_fixa: 0 }), 34.9, 'taxa % em reais');
eq(taxaDaForma(100, { taxa_pct: 2, taxa_fixa: 0.5 }), 2.5, 'taxa % + fixa');
eq(taxaDaForma(1, { taxa_pct: 0, taxa_fixa: 5 }), 1, 'taxa nunca passa do valor');
eq(taxaDaForma(0, { taxa_pct: 5, taxa_fixa: 5 }), 0, 'sem valor, sem taxa');
eq(taxaDaForma(333.33, { taxa_pct: 1.5, taxa_fixa: 0 }), 5, 'arredonda ao centavo');

console.log('--- Código e validação ---');
eq(codigoParaNome('Vale-viagem'), 'VALE_VIAGEM', 'código nasce do nome, sem acento nem símbolo');
eq(codigoParaNome('Pix'), 'PIX_2', 'nunca toma o código de uma forma de sempre');
eq(codigoParaNome('Cartão'), 'CARTAO_2', 'nunca toma um valor antigo ("CARTAO")');
eq(codigoParaNome('Vale viagem', ['VALE_VIAGEM']), 'VALE_VIAGEM_2', 'nem um código já usado');
eq(validarAjuste({ nome: '' }, false), 'Dê um nome para a forma de pagamento.', 'forma própria precisa de nome');
eq(validarAjuste({}, true), null, 'forma de sempre não precisa de nome');
eq(validarAjuste({ nome: 'X', taxa_pct: 100 }, false) !== null, true, 'taxa de 100% recusada');
eq(validarAjuste({ nome: 'X', taxa_fixa: -1 }, false) !== null, true, 'taxa fixa negativa recusada');
eq(validarAjuste({ nome: 'X', dias_para_cair: 400 }, false) !== null, true, 'mais de 365 dias recusado');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
