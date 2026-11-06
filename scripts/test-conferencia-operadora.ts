/**
 * Conferência do extrato de operadora (src/lib/conferencia-operadora.ts), a
 * parte pura: o que a IA leu passa pelas regras de soma e data, casa com a
 * venda e a diferença sai explicada.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-conferencia-operadora.ts
 */
import {
  casarLinha, centavosDe, checarExtrato, comissaoPorOperadora, compararLinha, conferirLinhas, mesmoPassageiro,
  normalizarExtratoLido, podeFechar,
  type ExtratoLido, type ItemParaCasar, type LinhaLida,
} from '../src/lib/conferencia-operadora.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

const linha = (p: Partial<LinhaLida>): LinhaLida => ({
  data: '2026-10-10', localizador: 'ABC123', passageiro: 'SILVA/MARIA', descricao: '', tipo: 'venda',
  bruto_centavos: 100000, taxas_centavos: null, comissao_centavos: 10000, liquido_centavos: 90000, ...p,
});
const item = (p: Partial<ItemParaCasar>): ItemParaCasar => ({
  item_id: 'i1', venda_id: 'v1', venda_numero: 'V-1', venda_status: 'CONFIRMADO', data_venda: '2026-10-01', data_servico: '2026-12-01',
  localizadores: ['ABC123'], passageiros: ['Maria Silva'], fornecedor_id: 'f1', fornecedor_nome: 'Operadora Sol',
  meio: 'proprio', custo_centavos: 90000, venda_centavos: 120000, comissao_centavos: 10000,
  conta_pagar: null, conta_comissao: null, ...p,
});

console.log('--- o que a IA leu, limpo ---');
{
  const e = normalizarExtratoLido({
    operadora_nome: ' Operadora Sol ', operadora_cnpj: '11.222.333/0001-81', periodo_de: '2026-10-01', periodo_ate: '2026-10-31',
    total_liquido: '1.234,56',
    linhas: [
      { data: '2026-10-05', localizador: 'abc-123', passageiro: 'SILVA/MARIA MRS', tipo: 'Venda', valor_bruto: 1000, comissao: 100, valor_liquido: 900 },
      { data: '2026-02-31', localizador: 'x', tipo: 'Cancelado', valor_bruto: '500,00' },
      { data: '2026-10-07', localizador: 'ZZZ999', tipo: 'venda', valor_bruto: -300 },
    ],
  });
  eq([e.operadora_nome, e.operadora_cnpj, e.total_liquido_centavos], ['Operadora Sol', '11222333000181', 123456], 'nome, CNPJ só com dígitos e total em centavos');
  eq(e.linhas.map(l => [l.localizador, l.tipo, l.data, l.bruto_centavos]), [['ABC123', 'venda', '2026-10-05', 100000], ['X', 'cancelamento', null, 50000], ['ZZZ999', 'cancelamento', '2026-10-07', 30000]], 'localizador normalizado, data impossível vira nula, valor negativo vira cancelamento');
  eq([centavosDe('1.000,50'), centavosDe(12.345), centavosDe(''), centavosDe('abc')], [100050, 1235, null, null], 'reais em texto ou número viram centavos');
}

console.log('--- regras de soma e data (coluna Válido) ---');
{
  const e: ExtratoLido = {
    operadora_nome: 'Sol', operadora_cnpj: '', periodo_de: '2026-10-01', periodo_ate: '2026-10-31',
    total_bruto_centavos: null, total_comissao_centavos: null, total_liquido_centavos: 150000,
    linhas: [
      linha({}),
      linha({ localizador: 'DEF456', passageiro: 'JOAO', bruto_centavos: 50000, comissao_centavos: 5000, liquido_centavos: 45000, data: '2026-11-02' }),
      linha({ localizador: 'GHI789', passageiro: 'ANA', bruto_centavos: 30000, comissao_centavos: 0, liquido_centavos: 29000 }),
      linha({ localizador: 'JKL000', passageiro: 'BETO', tipo: 'cancelamento', bruto_centavos: 14000, comissao_centavos: 0, liquido_centavos: 14000 }),
      linha({}),
    ],
  };
  const c = checarExtrato(e);
  eq(c.linhas.map(l => l.valido), [true, false, false, true, false], 'fora do período, conta que não fecha e linha repetida não são válidas');
  eq([/depois do período/.test(c.linhas[1].motivos[0]), /não fecham/.test(c.linhas[2].motivos[0]), c.linhas[4].duplicada_de], [true, true, 0], 'cada motivo escrito');
  eq([c.soma.liquido, c.soma_confere], [90000 + 45000 + 29000 - 14000 + 90000, false], 'cancelamento devolve na soma; total declarado diferente é avisado');
  eq(/Falta ou sobra linha/.test(c.avisos[0]), true, 'o aviso explica');
  const comTaxa = checarExtrato({ ...e, total_liquido_centavos: null, linhas: [linha({ taxas_centavos: 5000, liquido_centavos: 95000 })] });
  eq([comTaxa.linhas[0].valido, comTaxa.soma_confere], [true, null], 'bruto + taxas − comissão fecha; sem total declarado, a soma não é julgada');
}

console.log('--- casar com a venda ---');
{
  eq([mesmoPassageiro('SILVA/MARIA MRS', 'Maria da Silva'), mesmoPassageiro('MARIA SOUZA', 'Maria Silva')], [true, false], 'passageiro "SOBRENOME/NOME" casa; sobrenome diferente não');
  const i1 = item({});
  const outro = item({ item_id: 'i2', venda_id: 'v2', venda_numero: 'V-2', localizadores: ['XYZ999'], passageiros: ['Carlos'] });
  eq(casarLinha(linha({}), [outro, i1]).item?.item_id, 'i1', 'pelo localizador');
  eq(casarLinha(linha({ localizador: 'abc-123'.toUpperCase().replace('-', '') }), [i1]).como, 'localizador', 'localizador com outra pontuação');
  const mesmaLocDois = [i1, item({ item_id: 'i3', passageiros: ['Pedro Lima'], custo_centavos: 50000 })];
  eq(casarLinha(linha({}), mesmaLocDois).item?.item_id, 'i1', 'mesmo localizador em dois itens: o passageiro desempata');
  const gemeos = [i1, item({ item_id: 'i4' })];
  eq([casarLinha(linha({}), gemeos).item, casarLinha(linha({}), gemeos).ambiguos], [null, 2], 'dois itens idênticos: não chuta, conta os candidatos');
  eq(casarLinha(linha({ localizador: '' }), [i1, outro]).como, 'passageiro', 'sem localizador: passageiro + data + valor');
  eq(casarLinha(linha({ localizador: '', liquido_centavos: 77700, bruto_centavos: 77700, comissao_centavos: null }), [i1]).item, null, 'sem localizador e valor diferente: não casa');
  eq(casarLinha(linha({ localizador: 'NAOEXISTE', passageiro: '' }), [i1]).como, 'nenhum', 'não encontrado');
}

console.log('--- comparar e explicar ---');
{
  eq(compararLinha(linha({}), item({})).situacao, 'CONFERIDO', 'líquido igual ao custo e comissão igual: conferido');
  const valor = compararLinha(linha({ liquido_centavos: 95000, bruto_centavos: 105000 }), item({}));
  eq([valor.situacao, valor.diferencas[0].tipo, valor.diferencas[0].diferenca_centavos], ['DIVERGENTE', 'valor', 5000], 'cobra 50,00 a mais: diferença de valor');
  eq(/R\$\s?950,00.*R\$\s?900,00.*a mais/.test(valor.diferencas[0].texto), true, 'e a frase diz quanto e de que lado');
  const taxa = compararLinha(linha({ taxas_centavos: 4000, liquido_centavos: 94000 }), item({}));
  eq([taxa.diferencas[0].tipo, /taxa/.test(taxa.diferencas[0].texto)], ['taxa', true], 'a diferença igual à taxa é explicada como taxa');
  const cheio = compararLinha(linha({}), item({ custo_centavos: 100000 }));
  eq([cheio.diferencas.length, cheio.diferencas[0].tipo, /valor cheio/.test(cheio.diferencas[0].texto)], [1, 'comissao', true], 'custo pelo valor cheio: a diferença é a comissão, sem repetir');
  const semDesconto = compararLinha(linha({ liquido_centavos: 100000 }), item({}));
  eq([semDesconto.diferencas[0].tipo, /não descontou/.test(semDesconto.diferencas[0].texto)], ['comissao', true], 'operadora não descontou a comissão');
  const com = compararLinha(linha({ comissao_centavos: 8000, liquido_centavos: 92000, bruto_centavos: 100000 }), item({ custo_centavos: 92000 }));
  eq([com.diferencas.map(d => d.tipo), com.diferencas[0].diferenca_centavos], [['comissao'], -2000], 'comissão a menos que a esperada');
  const direto = compararLinha(linha({ bruto_centavos: 120000, comissao_centavos: 12000, liquido_centavos: null }), item({ meio: 'fornecedor', comissao_centavos: 12000 }));
  eq(direto.situacao, 'CONFERIDO', 'cliente pagou direto: confere o que o cliente pagou e a comissão');
  const cancel = compararLinha(linha({ tipo: 'cancelamento' }), item({}));
  eq([cancel.situacao, cancel.diferencas[0].tipo, cancel.proposta?.venda_id, cancel.comissao_esperada_centavos], ['DIVERGENTE', 'cancelamento', 'v1', -10000], 'cancelamento na operadora com venda ativa: divergente e PROPOSTA de cancelar');
  eq(compararLinha(linha({ tipo: 'cancelamento' }), item({ venda_status: 'CANCELADO' })).situacao, 'CONFERIDO', 'venda já cancelada: confere');
  eq(compararLinha(linha({}), item({ venda_status: 'CANCELADO' })).diferencas[0].tipo, 'cancelamento', 'operadora ainda cobra venda cancelada: divergente');
  eq(compararLinha(linha({}), null).situacao, 'NAO_ENCONTRADO', 'sem venda: não encontrado');
}

console.log('--- fechar e comissão ---');
{
  const l = (s: 'CONFERIDO' | 'DIVERGENTE' | 'NAO_ENCONTRADO', extra = {}) => ({ ordem: 1, situacao: s, valido: true, aceita: false, proposta_pendente: false, ...extra });
  eq(podeFechar([l('CONFERIDO'), l('DIVERGENTE', { aceita: true })], null), { ok: true, motivos: [] }, 'tudo conferido ou aceito: fecha');
  const r = podeFechar([l('CONFERIDO', { valido: false }), l('NAO_ENCONTRADO'), l('DIVERGENTE', { proposta_pendente: true })], { periodo_de: '2026-09-01' });
  eq([r.ok, r.motivos.length, /01\/09\/2026/.test(r.motivos[0]), /1 cancelamento proposto/.test(r.motivos[1]), /2 linhas/.test(r.motivos[2])], [false, 3, true, true, true], 'anterior aberta, proposta sem decisão e linhas pendentes impedem, cada uma com o motivo');
  const c = comissaoPorOperadora([
    { operadora: 'Sol', tipo: 'venda', comissao_informada_centavos: 10000, comissao_esperada_centavos: 10000, comissao_recebida_centavos: 0, tem_conta_de_comissao: false },
    { operadora: 'Sol', tipo: 'venda', comissao_informada_centavos: 8000, comissao_esperada_centavos: 12000, comissao_recebida_centavos: 5000, tem_conta_de_comissao: true },
    { operadora: 'Sol', tipo: 'cancelamento', comissao_informada_centavos: 1000, comissao_esperada_centavos: -1000, comissao_recebida_centavos: 0, tem_conta_de_comissao: false },
    { operadora: 'Mar', tipo: 'venda', comissao_informada_centavos: 500, comissao_esperada_centavos: 500, comissao_recebida_centavos: 0, tem_conta_de_comissao: false },
  ]);
  eq(c.map(x => [x.operadora, x.esperada_centavos, x.informada_centavos, x.recebida_centavos, x.diferenca_informada_centavos, x.a_receber_centavos]),
    [['Sol', 21000, 17000, 5000, -4000, 7000], ['Mar', 500, 500, 0, 0, 0]], 'esperada × informada × recebida por operadora, a maior diferença primeiro');
}
{
  const e: ExtratoLido = {
    operadora_nome: 'Sol', operadora_cnpj: '', periodo_de: '2026-10-01', periodo_ate: '2026-10-31',
    total_bruto_centavos: null, total_comissao_centavos: null, total_liquido_centavos: null,
    linhas: [linha({}), linha({ localizador: 'NADA00', passageiro: 'X' }), linha({ tipo: 'cancelamento' })],
  };
  const r = conferirLinhas(e, [item({})], { nome: 'Sol' });
  eq([r.resumo.CONFERIDO, r.resumo.DIVERGENTE, r.resumo.NAO_ENCONTRADO, r.resumo.propostas], [1, 1, 1, 1], 'a conferência inteira resume conferido, divergente, não encontrado e propostas');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
