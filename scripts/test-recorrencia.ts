/**
 * Recorrência e parcelamento (05/11/2026): datas, valores, textos e a prova
 * de que a despesa fixa continua gerando os mesmos títulos de antes.
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-recorrencia.ts
 */
import {
  proximasDatas, totalDeOcorrencias, parcelarValor, ocorrenciasComValor, descreverRegra,
  regraDoPreset, lerRegra, separarSufixo, sufixoDaDescricao, regraDoEstado, REPETICAO_PADRAO,
  reajustesAte, valorReajustado, podeCopiarConta, tituloGeradoPeloSistema, tituloSemBaixa,
  rotuloDaPeriodicidade, PRESETS, previaDoFormulario, type RegraRecorrencia,
} from '../src/lib/recorrencia.ts';
import { montarTitulo, idDoTitulo, limparModelo, brlEmCentavos } from '../src/lib/recorrencia-titulos.ts';
import { addDias, addMeses, round2, num, paraBRL, paraCentavos } from '../src/lib/money.ts';
import { createContaPagar, type ContaPagar } from '../src/lib/crm-types.ts';

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
const datas = (r: RegraRecorrencia, ini: string, ate = '2099-12-31') => proximasDatas(r, ini, ate).map(o => o.vencimento);
const vezes = (n: number) => ({ tipo: 'ocorrencias' as const, ocorrencias: n });

console.log('--- Presets com os nomes de sempre ---');
eq(PRESETS.map(p => p.rotulo), ['Semanal', 'Quinzenal', 'Mensal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual'], 'as 7 periodicidades');
eq(datas(regraDoPreset('MENSAL', vezes(4)), '2026-01-31'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'], 'mensal com dia 31: mês curto usa o último dia e volta ao 31');
eq(datas(regraDoPreset('SEMANAL', vezes(3)), '2026-11-05'), ['2026-11-05', '2026-11-12', '2026-11-19'], 'semanal');
eq(datas(regraDoPreset('QUINZENAL', vezes(3)), '2026-11-05'), ['2026-11-05', '2026-11-19', '2026-12-03'], 'quinzenal = a cada 14 dias');
eq(datas(regraDoPreset('BIMESTRAL', vezes(3)), '2026-12-15'), ['2026-12-15', '2027-02-15', '2027-04-15'], 'bimestral atravessa o ano');
eq(datas(regraDoPreset('TRIMESTRAL', vezes(2)), '2026-11-30'), ['2026-11-30', '2027-02-28'], 'trimestral com clamp');
eq(datas(regraDoPreset('SEMESTRAL', vezes(3)), '2026-08-31'), ['2026-08-31', '2027-02-28', '2027-08-31'], 'semestral');
eq(datas(regraDoPreset('ANUAL', vezes(3)), '2028-02-29'), ['2028-02-29', '2029-02-28', '2030-02-28'], 'anual a partir de 29/02');

console.log('--- A cada N, dia fixo, dia da semana, último dia útil ---');
eq(datas({ frequencia: 'DIA', intervalo: 10, feriado: 'manter', fim: vezes(3) }, '2026-11-05'), ['2026-11-05', '2026-11-15', '2026-11-25'], 'a cada 10 dias');
eq(datas({ frequencia: 'MES', intervalo: 2, dia_do_mes: 10, feriado: 'manter', fim: vezes(3) }, '2026-11-05'), ['2026-11-10', '2027-01-10', '2027-03-10'], 'dia 10 a cada 2 meses (começa no dia 10 seguinte)');
eq(datas({ frequencia: 'MES', intervalo: 1, dia_do_mes: 3, feriado: 'manter', fim: vezes(2) }, '2026-11-05'), ['2026-12-03', '2027-01-03'], 'dia fixo já passado no mês do início pula para o mês seguinte');
eq(datas({ frequencia: 'MES', intervalo: 1, dia_do_mes: 31, feriado: 'manter', fim: vezes(3) }, '2027-01-31'), ['2027-01-31', '2027-02-28', '2027-03-31'], 'dia fixo 31 com clamp');
eq(datas({ frequencia: 'MES', intervalo: 1, ultimo_dia_util: true, feriado: 'manter', fim: vezes(3) }, '2026-01-01'), ['2026-01-30', '2026-02-27', '2026-03-31'], 'último dia útil do mês');
eq(datas({ frequencia: 'SEMANA', intervalo: 1, dia_semana: 1, feriado: 'manter', fim: vezes(3) }, '2026-11-05'), ['2026-11-09', '2026-11-16', '2026-11-23'], 'toda segunda-feira');
eq(datas({ frequencia: 'ANO', intervalo: 1, dia_do_mes: 15, feriado: 'manter', fim: vezes(2) }, '2026-03-01'), ['2026-03-15', '2027-03-15'], 'todo ano no dia 15 do mês do início');

console.log('--- Fim de semana e feriado ---');
const dia15 = (feriado: RegraRecorrencia['feriado']): RegraRecorrencia => ({ frequencia: 'MES', intervalo: 1, dia_do_mes: 15, feriado, fim: vezes(3) });
eq(datas(dia15('manter'), '2026-11-01'), ['2026-11-15', '2026-12-15', '2027-01-15'], 'manter: 15/11 (domingo e feriado) fica');
eq(datas(dia15('antecipar'), '2026-11-01'), ['2026-11-13', '2026-12-15', '2027-01-15'], 'antecipar: 15/11 vai para sexta 13/11');
eq(datas(dia15('postergar'), '2026-11-01'), ['2026-11-16', '2026-12-15', '2027-01-15'], 'postergar: 15/11 vai para segunda 16/11');
eq(proximasDatas(dia15('postergar'), '2026-11-01', '2099-12-31')[0].nominal, '2026-11-15', 'a data nominal fica guardada');
const avisos = ocorrenciasComValor({ modo: 'recorrente', regra: dia15('manter'), inicio: '2026-11-01', valorCentavos: 100, ate: '2099-12-31' }).map(o => o.aviso);
eq(avisos, ['Proclamação da República', null, null], 'prévia avisa quando o vencimento não é dia útil');

console.log('--- Termina em / após N / nunca ---');
eq(datas({ frequencia: 'MES', intervalo: 1, dia_do_mes: 10, feriado: 'manter', fim: { tipo: 'data', data: '2027-03-09' } }, '2026-11-10'), ['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10'], 'termina numa data (inclusive)');
eq(totalDeOcorrencias({ frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'data', data: '2027-11-10' } }, '2026-11-10'), 13, 'total com data final');
eq(totalDeOcorrencias({ frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'nunca' } }, '2026-11-10'), null, 'até cancelar não tem total');
eq(datas({ frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'nunca' } }, '2026-11-10', '2027-02-10').length, 4, 'até cancelar: só até o horizonte pedido');

console.log('--- Parcelado: soma exata em centavos ---');
eq(parcelarValor(100000, 3), [33333, 33333, 33334], 'R$ 1.000,00 em 3: resto na última');
eq(parcelarValor(1, 3), [0, 0, 1], 'um centavo em 3');
for (const [t, n] of [[100000, 3], [99999, 7], [123456789, 12], [1, 1], [5000, 120]] as const) {
  eq(parcelarValor(t, n).reduce((a, b) => a + b, 0), t, `soma de ${t} em ${n} = ${t}`);
}
const parc = ocorrenciasComValor({ modo: 'parcelado', regra: regraDoPreset('MENSAL', vezes(3)), inicio: '2026-11-10', valorCentavos: 100000, ate: '2099-12-31' });
eq(parc.map(o => o.valor_centavos), [33333, 33333, 33334], 'parcelado divide o total');

console.log('--- Reajuste ---');
const rj: RegraRecorrencia = { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: vezes(15), reajuste: { tipo: 'fixo', percentual: 10, mes: 1 } };
eq(reajustesAte(rj, '2026-11-10', '2026-12-10'), 0, 'antes de janeiro: sem reajuste');
eq(reajustesAte(rj, '2026-11-10', '2027-01-10'), 1, 'janeiro: 1 reajuste');
eq(reajustesAte(rj, '2026-11-10', '2028-01-10'), 2, 'segundo janeiro: 2');
eq(valorReajustado(100000, rj, '2026-11-10', '2028-01-10'), 121000, '10% composto duas vezes');
const comReajuste = ocorrenciasComValor({ modo: 'recorrente', regra: rj, inicio: '2026-11-10', valorCentavos: 100000, ate: '2099-12-31' });
eq([comReajuste[1].valor_centavos, comReajuste[2].valor_centavos, comReajuste[14].valor_centavos], [100000, 110000, 121000], 'valores da série com reajuste');

console.log('--- Textos ---');
eq(descreverRegra({ frequencia: 'MES', intervalo: 2, dia_do_mes: 10, feriado: 'manter', fim: { tipo: 'data', data: '2027-12-10' } }), 'Todo dia 10, a cada 2 meses, até 12/2027', 'exemplo do plano');
eq(descreverRegra(regraDoPreset('MENSAL', vezes(12)), '2026-11-05'), 'Todo dia 5, 12 vezes', 'mensal pelo dia do início');
eq(descreverRegra({ frequencia: 'MES', intervalo: 1, ultimo_dia_util: true, feriado: 'manter', fim: { tipo: 'nunca' } }), 'No último dia útil do mês, até cancelar', 'último dia útil até cancelar');
eq(descreverRegra({ frequencia: 'SEMANA', intervalo: 1, dia_semana: 1, feriado: 'postergar', fim: vezes(4) }), 'Toda segunda-feira, adiando quando cair em fim de semana ou feriado, 4 vezes', 'semanal com feriado');
eq(descreverRegra(rj, '2026-11-10'), 'Todo dia 10, 15 vezes, com reajuste de 10% todo mês de janeiro', 'reajuste na descrição');
eq(descreverRegra({ frequencia: 'DIA', intervalo: 3, feriado: 'antecipar', fim: vezes(2) }), 'A cada 3 dias, antecipando quando cair em fim de semana ou feriado, 2 vezes', 'a cada 3 dias');
eq(rotuloDaPeriodicidade({ frequencia: 'MES', intervalo: 4 }), 'a cada 4 meses', 'periodicidade sem nome vira "a cada"');
eq(separarSufixo('Aluguel (3/12 — mensal)'), 'Aluguel', 'tira o sufixo da série');
eq(separarSufixo('Notebook (parcela 2/10)'), 'Notebook', 'tira o sufixo do parcelado');
eq(separarSufixo('Pacote (Chile)'), 'Pacote (Chile)', 'parênteses comuns ficam');
eq(sufixoDaDescricao('recorrente', regraDoPreset('MENSAL', { tipo: 'nunca' }), 3, null), '', 'série sem fim não ganha sufixo');

console.log('--- Leitura da regra ---');
eq('erro' in lerRegra({ frequencia: 'MES', intervalo: 1, fim: { tipo: 'data', data: '2026-02-31' } }), true, 'data inexistente recusada');
eq('erro' in lerRegra({ frequencia: 'MES', intervalo: 1, fim: { tipo: 'nunca' } }, 'parcelado'), true, 'parcelado exige a quantidade');
eq('erro' in lerRegra({ frequencia: 'MES', intervalo: 1, fim: vezes(121) }, 'parcelado'), true, 'parcelado até 120');
eq('erro' in lerRegra({ frequencia: 'SEMANA', intervalo: 1, dia_do_mes: 10, fim: vezes(2) }), true, 'dia do mês em semanal é recusado');
eq('erro' in lerRegra({ frequencia: 'MES', intervalo: 1, fim: vezes(3), reajuste: { tipo: 'fixo', percentual: 5, mes: 1 } }, 'parcelado'), true, 'reajuste no parcelado é recusado');
const lida = lerRegra({ frequencia: 'MES', intervalo: '2', dia_do_mes: '10', feriado: 'postergar', fim: { tipo: 'ocorrencias', ocorrencias: '6' } });
eq('regra' in lida ? lida.regra : null, { frequencia: 'MES', intervalo: 2, feriado: 'postergar', fim: { tipo: 'ocorrencias', ocorrencias: 6 }, dia_do_mes: 10 }, 'texto vira número');

console.log('--- Bloco "Repetir" da tela ---');
eq(regraDoEstado({ ...REPETICAO_PADRAO, ativa: true, quantidade: 6, periodicidade: 'TRIMESTRAL' }), { frequencia: 'MES', intervalo: 3, feriado: 'manter', fim: vezes(6) }, 'básico: preset + quantidade');
eq(regraDoEstado({ ...REPETICAO_PADRAO, ativa: true, personalizar: true, frequencia: 'MES', intervalo: 2, dia: 'fixo', dia_do_mes: 10, feriado: 'antecipar', termina: 'data', termina_em: '2027-12-31', reajuste_percentual: 4.5, reajuste_mes: 3 }),
  { frequencia: 'MES', intervalo: 2, feriado: 'antecipar', fim: { tipo: 'data', data: '2027-12-31' }, dia_do_mes: 10, reajuste: { tipo: 'fixo', percentual: 4.5, mes: 3 } }, 'mais opções');
eq(regraDoEstado({ ...REPETICAO_PADRAO, ativa: true, modo: 'parcelado', personalizar: true, termina: 'nunca', quantidade: 4, reajuste_percentual: 5 }).fim, vezes(4), 'parcelado sempre termina após N, sem reajuste');

console.log('--- Prévia do formulário ---');
{
  const p = previaDoFormulario({ ...REPETICAO_PADRAO, ativa: true, quantidade: 3, modo: 'parcelado' }, '2026-11-10', 100000, '2026-11-05');
  eq('erro' in p ? p.erro : [p.ocorrencias.map(o => o.valor_centavos), p.somaCentavos, p.sozinhas, p.descricao],
    [[33333, 33333, 33334], 100000, false, 'Todo dia 10, 3 vezes'], 'parcelado: 3 parcelas, soma exata, nasce tudo');
  const aberta = previaDoFormulario({ ...REPETICAO_PADRAO, ativa: true, personalizar: true, termina: 'nunca' }, '2026-11-10', 5000, '2026-11-05');
  eq('erro' in aberta ? aberta.erro : [aberta.ocorrencias.length, aberta.somaCentavos, aberta.sozinhas, aberta.total], [4, null, true, null], 'até cancelar: 4 agora, o resto sozinho');
  const sem = previaDoFormulario({ ...REPETICAO_PADRAO, ativa: true }, '', 5000, '2026-11-05');
  eq('erro' in sem, true, 'sem vencimento a prévia pede a data');
  const fimAntes = previaDoFormulario({ ...REPETICAO_PADRAO, ativa: true, personalizar: true, termina: 'data', termina_em: '2026-10-01' }, '2026-11-10', 5000, '2026-11-05');
  eq('erro' in fimAntes ? fimAntes.erro : '', 'A data final precisa ser depois do primeiro vencimento.', 'data final antes do início');
}

console.log('--- Critérios dos títulos ---');
eq(tituloSemBaixa('contas_pagar', { status: 'PENDENTE', valor_pago: null }), true, 'pendente sem baixa');
eq(tituloSemBaixa('contas_pagar', { status: 'PARCIAL', valor_pago: 10 }), false, 'parcial nunca é tocado');
eq(tituloSemBaixa('contas_receber', { status: 'RECEBIDO', valor_recebido: 10 }), false, 'recebido nunca é tocado');
eq(tituloSemBaixa('contas_receber', { status: 'PENDENTE', valor_recebido: 5 }), false, 'pendente com valor recebido não é tocado');
eq(tituloGeradoPeloSistema('contas_receber', { origem_venda_id: 'v1' }), true, 'título de venda');
eq(tituloGeradoPeloSistema('contas_pagar', { compra_id: 'c1' }), true, 'parcela de compra no cartão (fatura)');
eq(tituloGeradoPeloSistema('contas_pagar', { origem: 'DESPESA_FIXA' }), false, 'despesa manual');
eq(podeCopiarConta('contas_pagar', { origem: 'OUTROS', natureza_custo: 'FIXO', status: 'PENDENTE' }), true, 'cópia: despesa manual entra');
eq(podeCopiarConta('contas_pagar', { origem: 'OUTROS', natureza_custo: 'COMPRA_UNICA' }), false, 'cópia: compra única fica fora');
eq(podeCopiarConta('contas_pagar', { origem: 'OUTROS', serie_id: 's1' }), false, 'cópia: título de série fica fora (a série cria o próximo)');

console.log('--- Despesa fixa: os mesmos títulos de antes ---');
// Cópia congelada do laço que a tela de contas a pagar rodava até 05/11/2026.
type Periodo = 'MENSAL' | 'SEMANAL' | 'QUINZENAL';
function legado(form: Record<string, unknown> & { descricao: string; data_vencimento: string; valor_original: number; moeda: ContaPagar['moeda']; cambio: number; forma_pagamento: string; cartao_id: string }, periodo: Periodo, repeticoes: number): ContaPagar[] {
  const avancar = (b: string, p: Periodo, c: number) => (p === 'MENSAL' ? addMeses(b, c) : addDias(b, (p === 'SEMANAL' ? 7 : 14) * c));
  const valorOriginal = round2(num(form.valor_original));
  const cambio = form.moeda === 'BRL' ? 1 : num(form.cambio);
  const valorBrl = paraBRL(valorOriginal, form.moeda, cambio);
  const cartaoIdFinal = form.forma_pagamento === 'CARTAO_CORP' ? (form.cartao_id || null) : null;
  const rotulo: Record<Periodo, string> = { MENSAL: 'mensal', SEMANAL: 'semanal', QUINZENAL: 'quinzenal' };
  const out: ContaPagar[] = [];
  for (let i = 0; i < repeticoes; i++) {
    out.push({
      ...createContaPagar(), ...(form as Partial<ContaPagar>), cartao_id: cartaoIdFinal,
      descricao: `${form.descricao} (${i + 1}/${repeticoes} — ${rotulo[periodo]})`,
      data_vencimento: i === 0 ? form.data_vencimento : avancar(form.data_vencimento, periodo, i),
      valor_original: valorOriginal, cambio, valor_final: valorBrl, valor_brl: valorBrl,
      parcela_numero: i + 1, total_parcelas: repeticoes,
    } as ContaPagar);
  }
  return out;
}
function novo(form: Parameters<typeof legado>[0], periodo: Periodo, repeticoes: number): ContaPagar[] {
  const regra = regraDoPreset(periodo, vezes(repeticoes));
  const modelo = limparModelo('contas_pagar', form);
  const valor = paraCentavos(num(form.valor_original));
  return proximasDatas(regra, form.data_vencimento, '9999-12-31').map(o => montarTitulo({
    tabela: 'contas_pagar', serieId: 's', modo: 'recorrente', regra, modelo, ordem: o.ordem, total: repeticoes,
    vencimento: o.vencimento, valorCentavos: valor, valorBrlCentavos: brlEmCentavos('contas_pagar', modelo, valor),
    emissao: '2026-11-05', id: idDoTitulo('s', o.ordem),
  }) as ContaPagar);
}
const CAMPOS: (keyof ContaPagar)[] = [
  'origem', 'fornecedor_nome', 'descricao', 'categoria_id', 'data_vencimento', 'valor_original', 'moeda', 'cambio',
  'valor_final', 'valor_brl', 'forma_pagamento', 'cartao_id', 'natureza_custo', 'is_custo_comercial', 'observacoes',
  'status', 'parcela_numero', 'total_parcelas', 'valor_pago', 'data_pagamento', 'juros', 'multa', 'desconto',
];
const recorte = (l: ContaPagar[]) => l.map(c => Object.fromEntries(CAMPOS.map(k => [k, c[k]])));
const formBase = {
  origem: 'DESPESA_FIXA', fornecedor_nome: 'Imobiliária Centro', descricao: 'Aluguel da loja', categoria_id: 'cat-aluguel',
  valor_original: 3500.1, moeda: 'BRL' as const, cambio: 1, data_vencimento: '2026-01-31', forma_pagamento: 'BOLETO',
  cartao_id: '', natureza_custo: 'FIXO', is_custo_comercial: false, observacoes: 'contrato 2026',
};
for (const [periodo, n] of [['MENSAL', 12], ['SEMANAL', 5], ['QUINZENAL', 6], ['MENSAL', 2]] as const) {
  eq(recorte(novo(formBase, periodo, n)), recorte(legado(formBase, periodo, n)), `despesa fixa ${periodo.toLowerCase()} × ${n}: mesmos títulos`);
}
const formDolar = { ...formBase, moeda: 'USD' as const, cambio: 5.4321, valor_original: 199.99, forma_pagamento: 'CARTAO_CORP', cartao_id: 'cartao-1', data_vencimento: '2026-03-15' };
eq(recorte(novo(formDolar, 'MENSAL', 3)), recorte(legado(formDolar, 'MENSAL', 3)), 'despesa fixa em dólar no cartão: mesmos títulos');
const n1 = novo(formBase, 'MENSAL', 3)[1] as ContaPagar & { serie_id: string; serie_ordem: number };
eq([n1.serie_id, n1.serie_ordem, n1.id], ['s', 2, 's-002'], 'título novo ganha série, ordem e id estável');


console.log('--- Centro, rateio e tags na série ---');
{
  const comRateio = {
    ...formBase, valor_original: 1000, centro_custo_id: 'cc-sp', tags: ['loja'],
    rateio: [{ centro_custo_id: 'cc-sp', percentual: 60, valor: 600 }, { centro_custo_id: 'cc-rj', percentual: 40, valor: 400 }],
  };
  const regra = regraDoPreset('MENSAL', vezes(3));
  const modelo = limparModelo('contas_pagar', comRateio);
  const valor = paraCentavos(1000);
  const parcelas = [333.34, 333.33, 333.33];
  const titulos = parcelas.map((p, i) => montarTitulo({
    tabela: 'contas_pagar', serieId: 's', modo: 'parcelado', regra, modelo, ordem: i + 1, total: 3,
    vencimento: addMeses('2026-01-10', i), valorCentavos: valor, valorBrlCentavos: paraCentavos(p),
    emissao: '2026-11-05', id: idDoTitulo('s', i + 1),
  }) as ContaPagar);
  eq(titulos.map(t => [t.centro_custo_id, t.tags]), [['cc-sp', ['loja']], ['cc-sp', ['loja']], ['cc-sp', ['loja']]], 'centro e tags vão para cada título');
  eq(titulos.map(t => t.rateio.map(l => l.percentual)), [[60, 40], [60, 40], [60, 40]], 'percentuais do rateio iguais em cada título');
  eq(titulos.map(t => round2(t.rateio.reduce((a, l) => a + l.valor, 0))), parcelas, 'valores do rateio fecham o valor de cada parcela');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
