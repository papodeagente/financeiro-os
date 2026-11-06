/**
 * Câmbio e índices (05/11/2026, E6, parte A) — regra pura: leitura das
 * respostas das fontes (simuladas a partir da documentação oficial), idade e
 * disjuntor, carimbo, contas em moeda, transferência entre moedas, variação
 * cambial, índices, e a prova de que conta em real e conta sem variação
 * continuam iguais (liquidação, DRE e recorrência).
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-cambio.ts
 */
import {
  MOEDAS_TURISMO, moedaDe, lerRespostaAwesome, lerRespostaPtax, lerSerieSgs, urlAwesomeTurismo, urlPtaxPeriodo, urlSgsUltimos,
  diaDaPtaxEsperada, precisaConsultarPtax, precisaConsultarIndices, proximoEstadoDaFonte, fonteEmPausa, FALHAS_PARA_ABRIR_FONTE,
  idadeEmMinutos, situacaoDaCotacao, textoDaIdade, carimboManual, carimboDaCotacao, lerCarimbo, descreverCarimbo, sugestoesPara,
  saldosEmReais, saldoTotalEmReais, planoDaTransferencia, pernasDaTransferencia, significadoDoCambio, valorNaMoedaDoTitulo,
  variacaoCambial, moedaLiquidada, acumuladoPct, reajusteDosUltimos12Meses, equivalenteMensalPct, ultimoDoIndice, variacaoPorTitulo,
  ErroDeFonte, cambioDaLiquidacao, type Cotacao, type ValorDeIndice,
} from '../src/lib/cambio.ts';
import { planoDaBaixa, tituloDepoisDaBaixa, tituloDepoisDoEstorno, baseDosEncargos } from '../src/lib/baixa-calculo.ts';
import { montarDRE } from '../src/lib/resultado-dre.ts';
import { lerRegra, descreverRegra, regraDoEstado, REPETICAO_PADRAO } from '../src/lib/recorrencia.ts';

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
function lanca(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof ErroDeFonte ? 'ErroDeFonte' : String(e); }
}

const AGORA = new Date('2026-11-05T17:00:00Z'); // 14h de Brasília, quinta-feira

console.log('--- Moedas ---');
eq(moedaDe(undefined), 'BRL', 'moeda ausente = real (como sempre foi)');
eq(moedaDe('usd'), 'USD', 'moeda em minúsculas é reconhecida');
eq(moedaDe('XYZ'), 'BRL', 'moeda desconhecida = real');
eq(MOEDAS_TURISMO, ['USD', 'EUR'], 'turismo só existe para dólar e euro (AwesomeAPI: USD-BRLT, EUR-BRLT)');

console.log('--- Endereços (chave nunca na URL) ---');
eq(urlAwesomeTurismo(), 'https://economia.awesomeapi.com.br/json/last/USD-BRLT,EUR-BRLT', 'uma chamada só para os dois pares de turismo');
eq(urlAwesomeTurismo().includes('token'), false, 'a chave vai no cabeçalho, não na URL');
eq(urlPtaxPeriodo('EUR', '2026-10-29', '2026-11-05'),
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='EUR'&@dataInicial='10-29-2026'&@dataFinalCotacao='11-05-2026'&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim",
  'PTAX pelo período, datas MM-DD-AAAA entre aspas simples');
eq(urlSgsUltimos(433, 14), 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/14?formato=json', 'SGS: últimos N');
eq(urlSgsUltimos(433, 25).includes('/ultimos/20?'), true, 'SGS: N acima de 20 é limitado a 20 (limite do BCB)');

console.log('--- AwesomeAPI (resposta da documentação) ---');
const respAwesome = {
  USDBRLT: { code: 'USD', codein: 'BRLT', name: 'Dólar Americano/Real Brasileiro Turismo', high: '5.46354', low: '5.38583', varBid: '0.04366', pctChange: '0.805787', bid: '5.46195', ask: '5.88929', timestamp: '1793918930', create_date: '2026-11-05 19:48:50' },
  EURBRLT: { code: 'EUR', codein: 'BRLT', name: 'Euro/Real Brasileiro Turismo', high: '6.2', low: '6.1', varBid: '0.01', pctChange: '0.1', bid: '6.13501', ask: '6.61667', timestamp: '1793923769', create_date: '2026-11-05 21:09:29' },
};
const turismo = lerRespostaAwesome(respAwesome, AGORA);
eq(turismo.map(c => [c.moeda, c.tipo, c.fonte, c.compra, c.venda]), [['USD', 'turismo', 'awesomeapi', 5.46195, 5.88929], ['EUR', 'turismo', 'awesomeapi', 6.13501, 6.61667]], 'bid = compra, ask = venda, valores em texto viram número');
eq(turismo[0].cotado_em, new Date(1793918930 * 1000).toISOString(), 'horário da fonte vem do timestamp (segundos UTC)');
eq(lanca(() => lerRespostaAwesome({ status: 404, code: 'CoinNotExists', message: 'moeda nao encontrada' }, AGORA)), 'ErroDeFonte', 'resposta de erro não vira cotação');
eq(lanca(() => lerRespostaAwesome({ USDBRLT: { ...respAwesome.USDBRLT, ask: '0' } }, AGORA)), 'ErroDeFonte', 'valor zero é rejeitado, nunca gravado');
eq(lerRespostaAwesome({ USDBRL: { code: 'USD', codein: 'BRL', bid: '5.4', ask: '5.41', timestamp: '1793918930' }, ...respAwesome }, AGORA).length, 2, 'par comercial (BRL) não entra como turismo');

console.log('--- PTAX (resposta da documentação) ---');
const respPtax = { value: [
  { paridadeCompra: 1.1263, paridadeVenda: 1.1265, cotacaoCompra: 6.1567, cotacaoVenda: 6.1585, dataHoraCotacao: '2026-11-04 10:07:11.299421', tipoBoletim: 'Abertura' },
  { paridadeCompra: 1.124, paridadeVenda: 1.1242, cotacaoCompra: 6.155, cotacaoVenda: 6.157, dataHoraCotacao: '2026-11-04 11:05:00.1', tipoBoletim: 'Intermediário' },
  { paridadeCompra: 1.1234, paridadeVenda: 1.1236, cotacaoCompra: 6.1531, cotacaoVenda: 6.1549, dataHoraCotacao: '2026-11-04 13:05:19.232051', tipoBoletim: 'Fechamento PTAX' },
  { cotacaoCompra: 6.14, cotacaoVenda: 6.142, dataHoraCotacao: '2026-11-03 13:04:10.1', tipoBoletim: 'Fechamento PTAX' },
] };
const ptax = lerRespostaPtax(respPtax, 'EUR', AGORA);
eq(ptax.map(c => [c.referencia, c.compra, c.venda]), [['2026-11-03', 6.14, 6.142], ['2026-11-04', 6.1531, 6.1549]], 'só o boletim de fechamento, um por dia, em ordem');
eq(ptax[1].cotado_em, '2026-11-04T16:05:19.000Z', 'hora da Olinda é de Brasília (13h05 = 16h05 UTC)');
eq(lerRespostaPtax({ value: [] }, 'EUR', AGORA), [], 'fim de semana/feriado: lista vazia, nada inventado');
{
  // Resposta REAL da Olinda (05/11/2026, USD de 29/10): o boletim vem como
  // "Fechamento", entre "Abertura" e "Intermediário".
  const real = { value: [
    { cotacaoCompra: 5.3484, cotacaoVenda: 5.349, dataHoraCotacao: '2026-10-29 10:10:54.921', tipoBoletim: 'Abertura' },
    { cotacaoCompra: 5.3662, cotacaoVenda: 5.3668, dataHoraCotacao: '2026-10-29 11:03:53.702626', tipoBoletim: 'Intermediário' },
    { cotacaoCompra: 5.3738, cotacaoVenda: 5.3744, dataHoraCotacao: '2026-10-29 13:11:53.555689', tipoBoletim: 'Fechamento' },
    { cotacaoCompra: 5.4206, cotacaoVenda: 5.4212, dataHoraCotacao: '2026-10-30 13:04:18.706316', tipoBoletim: 'Fechamento' },
  ] };
  const lidas = lerRespostaPtax(real, 'USD', AGORA);
  eq(lidas.map(c => [c.referencia, c.compra, c.venda]), [['2026-10-29', 5.3738, 5.3744], ['2026-10-30', 5.4206, 5.4212]], 'resposta real: só o boletim "Fechamento" de cada dia (abertura e intermediário ficam de fora)');
}
eq(lanca(() => lerRespostaPtax({ erro: 'x' }, 'EUR', AGORA)), 'ErroDeFonte', 'formato estranho vira erro da fonte');

console.log('--- SGS (respostas da documentação) ---');
eq(lerSerieSgs([{ data: '01/08/2026', valor: '-0.32' }, { data: '01/09/2026', valor: '0.82' }], 'ipca', '2026-11-05'),
  [{ indice: 'ipca', referencia: '2026-08', valor: -0.32 }, { indice: 'ipca', referencia: '2026-09', valor: 0.82 }], 'IPCA mensal, valor em texto, mês AAAA-MM');
eq(lerSerieSgs([{ data: '01/11/2026', valor: '0.15' }, { data: '01/10/2026', valor: '1.07' }], 'selic_mes', '2026-11-05'),
  [{ indice: 'selic_mes', referencia: '2026-10', valor: 1.07 }, { indice: 'selic_mes', referencia: '2026-11', valor: 0.15, parcial: true }], 'Selic do mês: ordem invertida corrigida, mês corrente marcado como parcial');
eq(lerSerieSgs([{ data: '04/11/2026', valor: '15.00' }, { data: '08/12/2026', valor: '13.75' }], 'selic_meta', '2026-11-05').map(v => v.referencia),
  ['2026-11-04'], 'meta Selic: datas futuras são ignoradas (a série vem preenchida adiante)');

console.log('--- Quando consultar ---');
eq(diaDaPtaxEsperada(new Date('2026-11-05T15:00:00Z')), '2026-11-04', 'antes das 13h30 de Brasília espera-se a PTAX do dia útil anterior');
eq(diaDaPtaxEsperada(new Date('2026-11-05T17:00:00Z')), '2026-11-05', 'depois das 13h30, a de hoje');
eq(diaDaPtaxEsperada(new Date('2026-11-08T15:00:00Z')), '2026-11-06', 'domingo: a de sexta');
eq(precisaConsultarPtax('2026-11-05', null, AGORA), false, 'PTAX de hoje já guardada: não consulta');
eq(precisaConsultarPtax('2026-11-04', '2026-11-05T16:30:00Z', AGORA), false, 'faltando, mas tentou há 30 min: espera a hora');
eq(precisaConsultarPtax('2026-11-04', '2026-11-05T15:59:00Z', AGORA), true, 'faltando e a última tentativa passou de 1 h: consulta');
eq(precisaConsultarIndices('2026-11-05T08:00:00Z', null, AGORA), false, 'índices: menos de 12 h desde o último sucesso, não consulta');
eq(precisaConsultarIndices('2026-11-04T08:00:00Z', null, AGORA), true, 'índices: mais de 12 h, consulta');

console.log('--- Disjuntor por fonte ---');
let est = proximoEstadoDaFonte(null, 'awesomeapi', { ok: false, erro: 'HTTP 500' }, AGORA);
for (let i = 1; i < FALHAS_PARA_ABRIR_FONTE; i++) est = proximoEstadoDaFonte(est, 'awesomeapi', { ok: false, erro: 'HTTP 500' }, AGORA);
eq([est.falhas_seguidas, fonteEmPausa(est, AGORA)], [3, true], 'três falhas seguidas pausam a fonte');
eq(fonteEmPausa(est, new Date(AGORA.getTime() + 31 * 60_000)), false, 'a pausa acaba em 30 minutos');
est = proximoEstadoDaFonte(est, 'awesomeapi', { ok: true }, AGORA);
eq([est.falhas_seguidas, est.aberto_ate, est.ultimo_erro], [0, null, null], 'um sucesso zera o disjuntor');

console.log('--- Idade da cotação ---');
const usdT = turismo[0];
eq(idadeEmMinutos('2026-11-05T16:48:00Z', AGORA), 12, 'idade em minutos');
eq(situacaoDaCotacao({ tipo: 'turismo', cotado_em: '2026-11-05T16:20:00Z', referencia: '2026-11-05' }, AGORA), 'em_dia', 'turismo de 40 min: em dia');
eq(situacaoDaCotacao({ tipo: 'turismo', cotado_em: '2026-11-05T16:00:00Z', referencia: '2026-11-05' }, AGORA), 'atrasada', 'turismo de 1 h: atrasada (a tela mostra a idade)');
eq(situacaoDaCotacao({ tipo: 'ptax', cotado_em: '2026-11-04T16:05:00Z', referencia: '2026-11-04' }, new Date('2026-11-05T15:00:00Z')), 'em_dia', 'PTAX de ontem antes das 13h30: em dia');
eq(situacaoDaCotacao(null, AGORA), 'sem_cotacao', 'sem cotação');
eq([textoDaIdade(0), textoDaIdade(12), textoDaIdade(180), textoDaIdade(4000)], ['agora há pouco', 'há 12 min', 'há 3 h', 'há 2 dias'], 'texto da idade');

console.log('--- Carimbo (fonte e horário em cada valor usado) ---');
eq(carimboManual(5.123456), { valor: 5.1235, origem: 'manual' }, 'digitado: 4 casas, origem manual');
const c1 = carimboDaCotacao(usdT);
eq([c1.valor, c1.origem, c1.fonte, c1.cotado_em, c1.lado], [5.8893, 'turismo', 'awesomeapi', usdT.cotado_em, 'venda'], 'sugestão usada: valor de venda, fonte e horário');
eq(lerCarimbo(c1, 5.8893).origem, 'turismo', 'carimbo que bate com o valor é aceito');
eq(lerCarimbo(c1, 5.9).origem, 'manual', 'a pessoa mexeu no número: vira digitado (nunca fica a fonte errada)');
eq(lerCarimbo({ origem: 'invente', valor: 5 }, 5).origem, 'manual', 'origem desconhecida vira digitado');
eq(descreverCarimbo(carimboManual(5)), 'Digitado', 'descrição do digitado');
const cot: Cotacao[] = [...turismo, ...ptax];
eq(sugestoesPara('USD', cot).ptax, null, 'sem PTAX do dólar: a sugestão de PTAX fica vazia (o turismo não ocupa o lugar dela)');
eq(sugestoesPara('EUR', cot).ptax?.referencia, '2026-11-04', 'a PTAX mais recente');
eq(sugestoesPara('GBP', cot), { turismo: null, ptax: null }, 'libra sem turismo e sem PTAX guardada: nenhuma sugestão');

console.log('--- Contas em moeda e saldo total em reais ---');
const contas = [
  { id: 'brl', moeda: undefined, saldo_atual: 1234.56 },
  { id: 'eur', moeda: 'EUR', saldo_atual: 100 },
  { id: 'usd', moeda: 'USD', saldo_atual: 50 },
];
const saldos = saldosEmReais(contas, cot);
eq(saldos[0], { id: 'brl', moeda: 'BRL', saldo_moeda: 1234.56, saldo_reais: 1234.56, cambio: 1, referencia: null }, 'conta em real: o mesmo número, sem conversão');
eq([saldos[1].saldo_moeda, saldos[1].saldo_reais, saldos[1].cambio], [100, 615.49, 6.1549], 'conta em euro: saldo na moeda e em reais pela PTAX de venda');
eq([saldos[2].saldo_reais, saldos[2].referencia], [null, null], 'conta em dólar sem PTAX: sem valor em reais (nunca pelo turismo em silêncio)');
eq(saldoTotalEmReais(saldos), { total: 1850.05, sem_cotacao: ['usd'] }, 'total em reais e a conta que ficou de fora, nomeada');

console.log('--- Transferência entre moedas ---');
eq(planoDaTransferencia({ valor: 1000, moeda_origem: 'BRL', moeda_destino: 'BRL' }),
  { moeda_origem: 'BRL', moeda_destino: 'BRL', valor: 1000, valor_destino: 1000, tarifa: 0, sai_da_origem: 1000, cambio: null, erros: [] }, 'mesma moeda: o mesmo valor nas duas pontas, como sempre');
const t1 = planoDaTransferencia({ valor: 5889.29, moeda_origem: 'BRL', moeda_destino: 'USD', cambio: 5.88929, tarifa: 35 });
eq([t1.cambio, t1.valor_destino, t1.tarifa, t1.sai_da_origem, t1.erros], [5.8893, 1000, 35, 5924.29, []], 'reais → dólar: divide pelo câmbio; a tarifa sai da origem');
eq(planoDaTransferencia({ valor: 200, moeda_origem: 'USD', moeda_destino: 'BRL', cambio: 5.4 }).valor_destino, 1080, 'dólar → reais: multiplica');
eq(planoDaTransferencia({ valor: 100, moeda_origem: 'USD', moeda_destino: 'EUR', cambio: 0.92 }).valor_destino, 92, 'entre estrangeiras: unidades do destino por unidade da origem');
eq(planoDaTransferencia({ valor: 100, moeda_origem: 'BRL', moeda_destino: 'USD' }).erros.length, 1, 'moedas diferentes sem câmbio: recusa');
eq(significadoDoCambio('BRL', 'USD'), 'Quantos reais vale 1 USD', 'rótulo do câmbio explica o número');
eq(pernasDaTransferencia({ valor: 300 }), { valor: 300, sai: 300, entra: 300, tarifa: 0 }, 'transferência antiga (sem campos novos): igual a antes');
eq(pernasDaTransferencia({ valor: 5889.29, valor_destino: 1000, tarifa: 35 }), { valor: 5889.29, sai: 5889.29, entra: 1000, tarifa: 35 }, 'entre moedas: chega o valor de destino');

console.log('--- Variação cambial ---');
const cpUSD = { moeda: 'USD', valor_original: 1000, cambio: 5, valor_final: 5000 };
eq(valorNaMoedaDoTitulo(cpUSD, 5000), { moeda: 'USD', valor: 1000, cambio: 5 }, 'conta em dólar com valor e câmbio que se confirmam');
eq(valorNaMoedaDoTitulo({ moeda: 'USD', valor_original: 5000, cambio: 5, valor_final: 5000 }, 5000), null, 'conta antiga com o valor em reais repetido no original: sem variação a calcular');
eq(valorNaMoedaDoTitulo({ moeda: 'BRL', valor_original: 100, cambio: 1, valor_final: 100 }, 100), null, 'conta em real: nada de câmbio');
eq(variacaoCambial({ tabela: 'contas_pagar', valor_moeda: 1000, cambio_lancado: 5, cambio_pago: 5.2 }),
  { valor_moeda: 1000, cambio_lancado: 5, cambio_pago: 5.2, variacao: 200, resultado: -200 }, 'pagar com câmbio maior: a conta sobe R$ 200 e é perda');
eq(variacaoCambial({ tabela: 'contas_receber', valor_moeda: 1000, cambio_lancado: 5, cambio_pago: 5.2 }).resultado, 200, 'receber com câmbio maior: ganho');
eq(variacaoCambial({ tabela: 'contas_pagar', valor_moeda: 1000, cambio_lancado: 5, cambio_pago: 4.9 }).resultado, 100, 'pagar com câmbio menor: ganho');
eq(moedaLiquidada({ saldo_moeda: 1000, principal_reais: 2600, cambio_pago: 5.2 }), 500, 'parcial: a parte paga em reais ÷ câmbio');
eq(moedaLiquidada({ saldo_moeda: 1000, principal_reais: 9999, cambio_pago: 5.2 }), 1000, 'nunca liquida mais que o saldo na moeda');

eq(cambioDaLiquidacao({ tabela: 'contas_pagar', titulo: cpUSD, base_reais: 5000, valor_baixado: 0, valor: 5200, cambio_pago: 5.2 })?.variacao.variacao, 200,
  'tela e servidor usam a mesma conta: US$ 1.000 a 5,20 sobre 5,00 = R$ 200');
eq(cambioDaLiquidacao({ tabela: 'contas_pagar', titulo: cpUSD, base_reais: 5000, valor_baixado: 2500, valor: 2600, cambio_pago: 5.2 })?.saldo_moeda, 500,
  'baixa anterior sem câmbio conta pelo câmbio lançado (R$ 2.500 = US$ 500)');
eq(cambioDaLiquidacao({ tabela: 'contas_pagar', titulo: cpUSD, base_reais: 5000, valor_baixado: 0, valor: 1680, cambio_pago: 5.6, moeda_conta: 'USD' })?.caixa_na_moeda, 300,
  'conta bancária em dólar: sai a moeda liquidada');
eq(cambioDaLiquidacao({ tabela: 'contas_pagar', titulo: cpUSD, base_reais: 5000, valor_baixado: 0, valor: 5000, cambio_pago: 0 }), null, 'sem câmbio: nada muda');

console.log('--- Liquidação: com variação e, sem ela, igual a antes ---');
const tCP = { tabela: 'contas_pagar' as const, status: 'PENDENTE', valor_final: 5000, valor_baixado: 0, data_vencimento: '2026-11-10' };
const semVar = planoDaBaixa(tCP, { valor: 5000, data: '2026-11-05' });
eq([semVar.status_depois, semVar.valor_final_depois, semVar.variacao_cambial], ['PAGO', 5000, 0], 'sem câmbio: a liquidação de sempre');
const comVar = planoDaBaixa(tCP, { valor: 5200, data: '2026-11-05', variacao_cambial: 200 });
eq([comVar.status_depois, comVar.valor_final_depois, comVar.juros, comVar.diferenca], ['PAGO', 5200, 0, 0], 'com variação: quita pelo câmbio do dia e a sobra NÃO vira juros');
const dCP = { ...cpUSD, status: 'PENDENTE' };
const depois = tituloDepoisDaBaixa(dCP, tCP, comVar, { data: '2026-11-05', conta_bancaria_id: 'b1' });
eq([depois.valor_final, depois.variacao_cambial, depois.valor_base_encargos, depois.valor_original, depois.cambio], [5200, 200, 5000, 1000, 5], 'o lançado (valor na moeda, câmbio, base) fica; a variação é uma parcela própria');
eq(baseDosEncargos({ valor_final: 5200, juros: 0, desconto: 0, multa: 0, variacao_cambial: 200 }), 5000, 'a base desconta a variação');
const estornado = tituloDepoisDoEstorno(depois, 'contas_pagar', { valor: 5200, juros: 0, multa: 0, desconto: 0, taxa: 0, credito: 0, variacao_cambial: 200 });
eq([estornado.status, estornado.valor_final, estornado.variacao_cambial, estornado.valor_pago], ['PENDENTE', 5000, 0, 0], 'estorno devolve o título ao valor lançado');
const semCampo = tituloDepoisDoEstorno({ valor_final: 100, valor_pago: 100, status: 'PAGO' }, 'contas_pagar', { valor: 100, juros: 0, multa: 0, desconto: 0, taxa: 0, credito: 0 });
eq('variacao_cambial' in semCampo, false, 'estorno de conta sem câmbio não ganha campo novo');

console.log('--- DRE: linha própria e, sem variação, número por número igual ---');
const cp = (id: string, valor: number, extra: Record<string, unknown> = {}) => ({
  id, origem: 'OUTROS', descricao: id, fornecedor_nome: 'F', categoria_id: 'cat-op', valor_final: valor, valor_pago: valor,
  status: 'PAGO', data_vencimento: '2026-11-05', data_pagamento: '2026-11-05', ...extra,
}) as never;
const plano = [{ id: 'cat-op', codigo: '2.2.1', nome: 'Operacional' }] as never;
const base = { receber: [], vendasComLastro: [], planoContas: plano, comissaoNaoCapturada: new Map(), mes: '2026-11' };
const dreAntes = montarDRE({ ...base, pagar: [cp('p1', 5000), cp('p2', 5200)] });
const dreVazio = montarDRE({ ...base, pagar: [cp('p1', 5000), cp('p2', 5200)], variacoes: new Map() });
eq(dreVazio, dreAntes, 'mapa de variações vazio: DRE idêntico');
const dreCom = montarDRE({ ...base, pagar: [cp('p1', 5000), cp('p2', 5200)], variacoes: new Map([['contas_pagar:p2', 200]]) });
const linha = (d: typeof dreCom, nome: string) => d.find(l => l.nome === nome)?.valor;
eq(linha(dreCom, 'Despesas operacionais (aluguel, salários, etc.)'), 10000, 'a despesa de origem fica no valor lançado (5000 + 5000)');
eq(linha(dreCom, 'Variação cambial (ganhos e perdas na liquidação)'), -200, 'a variação aparece numa linha própria (perda de R$ 200)');
eq(linha(dreCom, 'LUCRO LÍQUIDO'), linha(dreAntes, 'LUCRO LÍQUIDO'), 'o lucro final é o mesmo: só muda onde o número aparece');
eq(variacaoPorTitulo([
  { titulo_tabela: 'contas_pagar', titulo_id: 'p2', variacao: 200 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p3', variacao: 50 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p3', variacao: -50 },
]), new Map([['contas_pagar:p2', 200]]), 'estorno anula a variação do título (linha de estorno)');

console.log('--- Índices ---');
eq(acumuladoPct([1, 1]), 2.01, 'acumulado composto');
const ipca: ValorDeIndice[] = Array.from({ length: 13 }, (_, i) => ({ indice: 'ipca', referencia: `20${i < 2 ? '25' : '26'}-${String(i < 2 ? 11 + i : i - 1).padStart(2, '0')}`, valor: 0.4 }));
const r12 = reajusteDosUltimos12Meses(ipca, 'ipca');
eq([r12?.meses, r12?.de, r12?.ate, r12?.percentual], [12, '2025-12', '2026-11', 4.91], 'IPCA de 12 meses acumulado (0,4% ao mês ≈ 4,91%)');
eq(reajusteDosUltimos12Meses(ipca.slice(0, 5), 'ipca'), null, 'menos de 12 meses: sem sugestão');
eq(equivalenteMensalPct(15), 1.17, 'Selic de 15% ao ano ≈ 1,17% ao mês');
eq(ultimoDoIndice([{ indice: 'selic_mes', referencia: '2026-10', valor: 1.07 }, { indice: 'selic_mes', referencia: '2026-11', valor: 0.15, parcial: true }], 'selic_mes', true)?.referencia, '2026-10', 'último mês fechado da Selic');

console.log('--- Recorrência: índice só como opção ---');
const regraComIndice = lerRegra({ frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'nunca' },
  reajuste: { tipo: 'fixo', percentual: 4.91, mes: 1, origem: { indice: 'ipca', de: '2025-12', ate: '2026-11', fonte: 'bcb_sgs' } } }, 'recorrente');
eq('regra' in regraComIndice && regraComIndice.regra.reajuste, { tipo: 'fixo', percentual: 4.91, mes: 1, origem: { indice: 'ipca', de: '2025-12', ate: '2026-11', fonte: 'bcb_sgs' } }, 'a origem do percentual é guardada; o percentual aplicado é o gravado');
eq('regra' in regraComIndice && descreverRegra(regraComIndice.regra).includes('(IPCA de 12 meses até 11/2026)'), true, 'a descrição diz de onde veio');
const semIndice = lerRegra({ frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'nunca' }, reajuste: { tipo: 'fixo', percentual: 5, mes: 1 } }, 'recorrente');
eq('regra' in semIndice && semIndice.regra.reajuste, { tipo: 'fixo', percentual: 5, mes: 1 }, 'reajuste digitado: igual a antes, sem origem');
eq(regraDoEstado({ ...REPETICAO_PADRAO }), regraDoEstado(REPETICAO_PADRAO), 'estado padrão do bloco Repetir sem mudança');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
