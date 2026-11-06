/**
 * Cheques emitidos (E7, frente C), lógica pura: o extenso nas duas linhas do
 * cheque, a cidade e a data por extenso, o desenho com o ajuste da conta, o
 * número do cheque e a vida dele (Emitido, Compensado, Devolvido, Cancelado).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-cheques.ts
 */
import {
  acoesPossiveis, dataPorExtenso, desenharCheque, extensoEmDuasLinhas, lerNumeroDoCheque, lerPedidoDeEmissao, localEData,
  normalizarConfigDoCheque, POSICOES_PADRAO, proximoNumero, recusaDaTransicao, recusaDoMotivo, valorNoQuadro, CAPACIDADE_DO_EXTENSO,
} from '../src/lib/cheques.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else console.log(`PASS  ${label}`);
}

console.log('--- Extenso em duas linhas ---');
{
  const e = extensoEmDuasLinhas(123456);
  eq(e.texto, 'Mil duzentos e trinta e quatro reais e cinquenta e seis centavos', 'o extenso de sempre (extenso.ts), com maiúscula');
  eq([e.linha1.length, e.linha2.length], [CAPACIDADE_DO_EXTENSO.linha1, CAPACIDADE_DO_EXTENSO.linha2], 'as duas linhas cheias até o fim');
  eq(e.linha1.startsWith('Mil duzentos e trinta e quatro reais e cinquenta e seis'), true, 'primeira linha com palavras inteiras');
  eq(e.linha2.replace(/\*+$/, '').trim(), 'centavos', 'segunda linha começa onde a primeira parou');
  eq(/ \*+$/.test(e.linha1) || e.linha1.length === CAPACIDADE_DO_EXTENSO.linha1, true, 'o fim da linha é travado com asteriscos');
  eq(e.cabe, true, 'cabe nas duas linhas');
  const curto = extensoEmDuasLinhas(10000);
  eq([curto.linha1.startsWith('Cem reais *'), /^\*+$/.test(curto.linha2)], [true, true], 'valor curto: a segunda linha inteira de asteriscos');
  const um = extensoEmDuasLinhas(1);
  eq(um.texto, 'Um centavo', 'um centavo');
  const grande = extensoEmDuasLinhas(77777777777);
  eq([grande.cabe, grande.linha1.split(' ').every(p => p.length > 0)], [true, true], 'setecentos e setenta e sete milhões...: ainda cabe');
  let erro = '';
  try { extensoEmDuasLinhas(0); } catch (x) { erro = (x as Error).message; }
  eq(erro, 'O valor do cheque precisa ser maior que zero.', 'zero recusado');
  eq(valorNoQuadro(123456), '#1.234,56#', 'valor no quadro travado dos dois lados');
}

console.log('--- Cidade e data ---');
eq(dataPorExtenso('2026-11-06'), '6 de novembro de 2026', 'data por extenso, dia sem zero');
eq(dataPorExtenso('2026-03-01'), '1 de março de 2026', 'março com cedilha');
eq(dataPorExtenso('2026-13-01'), '', 'data inválida: vazio');
eq(localEData('  São   Paulo ', '2026-11-06'), 'São Paulo, 6 de novembro de 2026', 'cidade e data');
eq(localEData('', '2026-11-06'), '6 de novembro de 2026', 'sem cidade: só a data');

console.log('--- Número do cheque ---');
eq(lerNumeroDoCheque(' 000.123 '), { ok: true, numero: '000123' }, 'só os algarismos ficam (a regra da liquidação)');
eq(lerNumeroDoCheque('12A'), { ok: false, erro: 'O número do cheque tem só algarismos (até 12).' }, 'letra recusada');
eq(lerNumeroDoCheque(''), { ok: false, erro: 'Informe o número do cheque.' }, 'vazio recusado');
eq([proximoNumero('000123'), proximoNumero('999'), proximoNumero('')], ['000124', '1000', ''], 'próximo número mantém os zeros');

console.log('--- Situações ---');
eq(acoesPossiveis('EMITIDO'), ['compensar', 'devolver', 'cancelar'], 'emitido: compensar, devolver ou cancelar');
eq(acoesPossiveis('COMPENSADO'), ['devolver'], 'compensado: só devolver');
eq(acoesPossiveis('DEVOLVIDO'), ['compensar', 'cancelar'], 'devolvido: reapresentado e compensado, ou cancelado');
eq(acoesPossiveis('CANCELADO'), [], 'cancelado é o fim');
eq(recusaDaTransicao('cancelar', 'COMPENSADO'), 'Cheque compensado não se cancela: o dinheiro já saiu da conta. Se o banco devolveu, marque como devolvido.', 'frase de cancelar compensado');
eq(recusaDaTransicao('compensar', 'CANCELADO'), 'Este cheque está cancelado. Nada mais muda nele.', 'frase de cancelado');
eq([recusaDoMotivo('devolver', ' '), recusaDoMotivo('cancelar', 'ok'), recusaDoMotivo('compensar', ''), recusaDoMotivo('cancelar', 'rasgado')],
  ['Diga por que o banco devolveu o cheque.', 'Diga por que o cheque foi cancelado.', null, null], 'motivo obrigatório para devolver e cancelar');

console.log('--- Desenho e ajuste da conta ---');
{
  const d = desenharCheque({ valor_centavos: 123456, favorecido: 'Operadora Sol', cidade: 'Recife', data: '2026-11-06' });
  eq([d.largura_mm, d.altura_mm], [175, 80], 'cheque padrão 175 × 80 mm');
  const valor = d.campos.find(c => c.campo === 'valor')!;
  eq([valor.texto, valor.x, valor.y], ['#1.234,56#', POSICOES_PADRAO.valor.x, POSICOES_PADRAO.valor.y], 'valor na posição padrão');
  eq(d.campos.find(c => c.campo === 'local_data')!.texto, 'Recife, 6 de novembro de 2026', 'cidade e data no cheque');
  eq(d.campos.find(c => c.campo === 'favorecido')!.texto, 'Operadora Sol', 'nominal');
  const cfg = normalizarConfigDoCheque({ deslocar_x_mm: '1,5', deslocar_y_mm: -2, campos: { valor: { x: 3, y: 0 }, extenso2: { x: 0, y: 0 } } });
  const a = desenharCheque({ valor_centavos: 123456, favorecido: 'X', cidade: '', data: '2026-11-06' }, cfg);
  const va = a.campos.find(c => c.campo === 'valor')!;
  const fa = a.campos.find(c => c.campo === 'favorecido')!;
  eq([va.x, va.y, fa.x, fa.y], [POSICOES_PADRAO.valor.x + 4.5, POSICOES_PADRAO.valor.y - 2, POSICOES_PADRAO.favorecido.x + 1.5, POSICOES_PADRAO.favorecido.y - 2],
    'deslocamento geral em todos os campos e o fino só no campo dele');
  eq(Object.keys(cfg.campos), ['valor'], 'ajuste zerado por campo não é guardado');
  eq(normalizarConfigDoCheque({ deslocar_x_mm: 500, ultimo_numero: 'a12b' }).deslocar_x_mm, 30, 'ajuste limitado a 30 mm');
  eq(normalizarConfigDoCheque({ ultimo_numero: 'a12b' }).ultimo_numero, '12', 'último número só com algarismos');
}

console.log('--- Pedido de emissão ---');
eq(lerPedidoDeEmissao({ titulo_id: 'p1', conta_bancaria_id: 'b1', numero: '000123', bom_para: '2026-11-01', emissao: '2026-11-06' }, '2026-11-06'),
  { ok: false, erro: 'O "bom para" não pode ser antes da data do cheque.' }, 'bom para antes da data: recusado');
eq(lerPedidoDeEmissao({ titulo_id: 'p1', numero: '1' }, '2026-11-06'), { ok: false, erro: 'Escolha a conta bancária do talão.' }, 'sem conta bancária: recusado');
eq(lerPedidoDeEmissao({ titulo_id: 'p1', conta_bancaria_id: 'b1', numero: '7', valor_centavos: 0 }, '2026-11-06'),
  { ok: false, erro: 'O valor do cheque precisa ser maior que zero.' }, 'valor zero recusado');
const ok = lerPedidoDeEmissao({ titulo_id: 'p1', conta_bancaria_id: 'b1', numero: '7' }, '2026-11-06');
eq(ok.ok && [ok.pedido.emissao, ok.pedido.bom_para, ok.pedido.valor_centavos], ['2026-11-06', null, null], 'sem data: hoje; sem valor: o saldo da conta (decidido no servidor)');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
