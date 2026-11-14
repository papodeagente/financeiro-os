/**
 * Faturas ao cliente e Regras de faturamento (E5, parte B, 05/11/2026): a
 * conta pura. Cada período com feriado no caminho, o ajuste de dia não útil,
 * a chave, a prévia das próximas 3, a regra mais específica, as faixas do
 * período customizado, os totais com notas e retenções, a conferência por
 * arquivo, a exportação e a nota de débito.
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-faturas.ts
 */
import {
  janelaDoPeriodo, vencimentoDaJanela, posicaoDoItem, proximasFaturas, escolherRegra, normalizarRegra, validarFaixas,
  totaisDaFatura, conferirComArquivo, situacaoVisivel, descricaoDaRegra, ajustarDiaUtil, type RegraDeFaturamento,
} from '../src/lib/fatura-regras.ts';
import { csvDe, linhasDaExportacao, colunasDoModelo, valorDaColuna, notaDeDebitoDaVenda } from '../src/lib/fatura-documento.ts';
import { normalizarVenda } from '../src/lib/venda-modelo.ts';

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

const regra = (o: Partial<RegraDeFaturamento> & Record<string, unknown> = {}): RegraDeFaturamento =>
  normalizarRegra({ id: 'r1', pessoa_id: 'cli-1', pessoa_nome: 'Empresa X', periodo: 'MENSAL', prazo_dias: 0, ...o }).regra;
const venc = (r: RegraDeFaturamento, ref: string) => {
  const j = janelaDoPeriodo(r, ref);
  const v = vencimentoDaJanela(r, j);
  return [j.inicio, j.fim, v.vencimento];
};

console.log('--- Diário ---');
eq(venc(regra({ periodo: 'DIARIO' }), '2026-11-05'), ['2026-11-05', '2026-11-05', '2026-11-05'], 'diário: o próprio dia, dia útil');
const diaFeriado = vencimentoDaJanela(regra({ periodo: 'DIARIO' }), { inicio: '2026-11-20', fim: '2026-11-20' });
eq(diaFeriado.vencimento, '2026-11-23', 'diário: 20/11 (Consciência Negra) passa para segunda 23/11');
eq(/Consciência Negra/.test(diaFeriado.ajuste), true, 'e a frase diz o feriado');

console.log('--- Semanal ---');
eq(venc(regra({ periodo: 'SEMANAL', inicio_semana: 0, prazo_dias: 2 }), '2026-11-05'), ['2026-11-01', '2026-11-07', '2026-11-09'], 'semanal de domingo: 01 a 07/11, vence 2 dias depois (seg 09/11)');
eq(venc(regra({ periodo: 'SEMANAL', inicio_semana: 3 }), '2026-11-05'), ['2026-11-04', '2026-11-10', '2026-11-10'], 'semanal de quarta: 04 a 10/11');
eq(venc(regra({ periodo: 'SEMANAL', inicio_semana: 0, prazo_dias: 9 }), '2026-11-12'), ['2026-11-08', '2026-11-14', '2026-11-23'], 'semanal: 14/11 + 9 = 23/11 (segunda)');
eq(venc(regra({ periodo: 'SEMANAL', inicio_semana: 2, prazo_dias: 7 }), '2026-11-05'), ['2026-11-03', '2026-11-09', '2026-11-16'], 'semanal de terça + 7 dias: cai 16/11 (útil, depois do feriado de 15/11)');

console.log('--- Semanal IATA ---');
eq(venc(regra({ periodo: 'SEMANAL_IATA', inicio_semana: 0 }), '2026-11-05'), ['2026-11-02', '2026-11-08', '2026-11-09'], 'IATA: sempre segunda a domingo (ignora o início escolhido); domingo vai para segunda');
eq(venc(regra({ periodo: 'SEMANAL_IATA', dia_nao_util: 'ANTERIOR' }), '2026-11-05')[2], '2026-11-06', 'IATA antecipando: sexta 06/11');
eq(venc(regra({ periodo: 'SEMANAL_IATA', dia_nao_util: 'NAO_ALTERAR' }), '2026-11-05')[2], '2026-11-08', 'IATA mantendo a data: domingo 08/11');
eq(venc(regra({ periodo: 'SEMANAL_IATA', prazo_dias: 4 }), '2026-11-12'), ['2026-11-09', '2026-11-15', '2026-11-19'], 'IATA: semana do feriado de 15/11, vence quinta 19/11');
eq(venc(regra({ periodo: 'SEMANAL_IATA', prazo_dias: 5 }), '2026-11-12')[2], '2026-11-23', 'IATA + 5: sexta 20/11 é feriado, vai para 23/11');

console.log('--- Semanal respeitando o mês ---');
eq(venc(regra({ periodo: 'SEMANAL_MES', inicio_semana: 1, prazo_dias: 5 }), '2026-12-01'), ['2026-12-01', '2026-12-06', '2026-12-11'], 'semana que vira o mês: a parte de dezembro começa em 01/12');
eq(venc(regra({ periodo: 'SEMANAL_MES', inicio_semana: 1, prazo_dias: 5 }), '2026-11-30'), ['2026-11-30', '2026-11-30', '2026-12-07'], 'e a parte de novembro fica só com 30/11; vence 05/12 (sábado) → 07/12');
eq(venc(regra({ periodo: 'SEMANAL', inicio_semana: 1 }), '2026-12-01').slice(0, 2), ['2026-11-30', '2026-12-06'], 'o semanal comum atravessa o mês');

console.log('--- Decendial ---');
eq(venc(regra({ periodo: 'DECENDIAL', prazo_dias: 10 }), '2026-11-05'), ['2026-11-01', '2026-11-10', '2026-11-23'], 'decendial 1–10, +10 dias cai no feriado de 20/11 → 23/11');
eq(venc(regra({ periodo: 'DECENDIAL' }), '2026-11-15').slice(0, 2), ['2026-11-11', '2026-11-20'], 'segundo decêndio: 11 a 20');
eq(venc(regra({ periodo: 'DECENDIAL' }), '2026-11-25').slice(0, 2), ['2026-11-21', '2026-11-30'], 'terceiro decêndio: 21 ao fim do mês');
eq(venc(regra({ periodo: 'DECENDIAL' }), '2027-02-25').slice(0, 2), ['2027-02-21', '2027-02-28'], 'fevereiro: 21 a 28');

console.log('--- Quinzenal ---');
const q = vencimentoDaJanela(regra({ periodo: 'QUINZENAL' }), janelaDoPeriodo(regra({ periodo: 'QUINZENAL' }), '2026-11-05'));
eq([q.sem_ajuste, q.vencimento], ['2026-11-15', '2026-11-16'], 'quinzena 1–15: 15/11 (domingo e Proclamação da República) → 16/11');
eq(/Proclamação/.test(q.ajuste), true, 'a frase diz o feriado');
eq(venc(regra({ periodo: 'QUINZENAL' }), '2026-11-20').slice(0, 2), ['2026-11-16', '2026-11-30'], 'segunda quinzena: 16 a 30');
eq(venc(regra({ periodo: 'QUINZENAL' }), '2027-02-20').slice(0, 2), ['2027-02-16', '2027-02-28'], 'fevereiro: 16 a 28');

console.log('--- Mensal ---');
eq(venc(regra({ prazo_dias: 10 }), '2026-11-05'), ['2026-11-01', '2026-11-30', '2026-12-10'], 'mensal: novembro, vence 10 dias depois (10/12)');
eq(venc(regra({ prazo_dias: 5, sentido: 'ANTES' }), '2026-11-05')[2], '2026-11-25', 'mensal: 5 dias ANTES do fim do mês');
eq(venc(regra({ prazo_dias: 1 }), '2026-12-10'), ['2026-12-01', '2026-12-31', '2027-01-04'], 'dezembro + 1 = 01/01 (Confraternização) → segunda 04/01');
eq(venc(regra({ prazo_dias: 1, dia_nao_util: 'ANTERIOR' }), '2026-12-10')[2], '2026-12-31', 'antecipando: 31/12');
eq(venc(regra({ prazo_dias: 1, considerar_feriados: false }), '2026-12-10')[2], '2027-01-01', 'sem feriados: 01/01 é sexta, fica');

console.log('--- Avulso ---');
const av = regra({ periodo: 'AVULSO', faturar_por: 'INICIO', sentido: 'ANTES', prazo_dias: 10 });
const pAv = posicaoDoItem(av, { venda: '2026-11-05', inicio: '2026-12-20', fim: '2026-12-24' }, { item_id: 'c1' });
eq([pAv.referencia, pAv.base_usada, pAv.vencimento], ['2026-12-20', 'INICIO', '2026-12-10'], 'avulso: 10 dias antes do início da viagem');
eq(pAv.chave.endsWith('|c1'), true, 'avulso: cada item tem a sua fatura (chave com o item)');
const semInicio = posicaoDoItem(av, { venda: '2026-11-05' }, { item_id: 'c2' });
eq([semInicio.referencia, semInicio.base_usada], ['2026-11-05', 'VENDA'], 'sem data de início: vale a data da venda (e diz)');
eq(posicaoDoItem(regra({ prazo_dias: 10 }), { venda: '2026-11-03' }, { item_id: 'a' }).chave === posicaoDoItem(regra({ prazo_dias: 10 }), { venda: '2026-11-28' }, { item_id: 'b' }).chave, true, 'mensal: itens do mesmo mês têm a mesma chave');
eq(posicaoDoItem(regra({ faturar_por: 'FIM' }), { venda: '2026-10-20', inicio: '2026-11-02', fim: '2026-12-02' }).inicio, '2026-12-01', 'por data de fim: vai para o mês do fim da viagem');

console.log('--- Período customizado ---');
const faixas = [{ de: 1, ate: 15, vence_dia: 25, vence_mes: 0 }, { de: 16, ate: 31, vence_dia: 10, vence_mes: 1 }];
eq(venc(regra({ periodo: 'CUSTOMIZADO', faixas }), '2026-11-05'), ['2026-11-01', '2026-11-15', '2026-11-25'], 'faixa 1–15 vence dia 25');
eq(venc(regra({ periodo: 'CUSTOMIZADO', faixas }), '2026-11-20'), ['2026-11-16', '2026-11-30', '2026-12-10'], 'faixa 16–31 vence dia 10 do mês seguinte');
const carnaval = [{ de: 1, ate: 15, vence_dia: 25, vence_mes: 0 }, { de: 16, ate: 31, vence_dia: 9, vence_mes: 1 }];
eq(venc(regra({ periodo: 'CUSTOMIZADO', faixas: carnaval }), '2027-01-20')[2], '2027-02-10', 'vence 09/02/2027 (Carnaval): vai para quarta 10/02');
const fimDeMes = [{ de: 1, ate: 31, vence_dia: 31, vence_mes: 1 }];
eq(venc(regra({ periodo: 'CUSTOMIZADO', faixas: fimDeMes }), '2027-01-10')[2], '2027-03-01', 'dia 31 em fevereiro vira 28 (domingo) → 01/03');
eq(validarFaixas(faixas).length, 0, 'faixas que cobrem o mês: sem erro');
eq(validarFaixas([{ de: 1, ate: 10, vence_dia: 20, vence_mes: 0 }, { de: 12, ate: 31, vence_dia: 5, vence_mes: 1 }]).map(e => e.mensagem), ['Os dias 11 a 11 não estão em nenhuma faixa.'], 'buraco entre as faixas');
eq(validarFaixas([{ de: 1, ate: 15, vence_dia: 20, vence_mes: 0 }, { de: 10, ate: 31, vence_dia: 5, vence_mes: 1 }]).map(e => e.mensagem), ['Faixa 2: o dia 10 já está em outra faixa.'], 'sobreposição');
eq(validarFaixas([{ de: 10, ate: 5, vence_dia: 20, vence_mes: 0 }]).length > 0, true, 'faixa invertida');
eq(validarFaixas([{ de: 1, ate: 20, vence_dia: 40, vence_mes: 0 }]).map(e => e.mensagem), ['Faixa 1: o dia do vencimento vai de 1 a 31.', 'Os dias 21 a 31 não estão em nenhuma faixa.'], 'dia de vencimento fora e fim do mês descoberto');
eq(normalizarRegra({ pessoa_id: 'x', periodo: 'CUSTOMIZADO', faixas: [] }).erros.map(e => e.campo), ['faixas'], 'customizado sem faixa: pede a faixa');
eq(normalizarRegra({ periodo: 'MENSAL' }).erros.map(e => e.campo), ['pessoa_id'], 'regra sem pessoa: pede a pessoa');
eq(normalizarRegra({ pessoa_id: 'x', descricao: 'x'.repeat(61) }).erros.map(e => e.campo), ['descricao'], 'descrição até 60 letras');
eq(normalizarRegra({ pessoa_id: 'x', prazo_dias: 400 }).erros.map(e => e.campo), ['prazo_dias'], 'prazo até 365 dias');

console.log('--- Próximas 3 faturas ---');
eq(proximasFaturas(regra({ prazo_dias: 10 }), '2026-11-05').map(p => [p.inicio, p.fim, p.vencimento]), [
  ['2026-11-01', '2026-11-30', '2026-12-10'], ['2026-12-01', '2026-12-31', '2027-01-11'], ['2027-01-01', '2027-01-31', '2027-02-10'],
], 'mensal +10: dezembro vence 10/01 (domingo) → 11/01');
eq(proximasFaturas(regra({ periodo: 'SEMANAL_IATA', prazo_dias: 3 }), '2026-11-05').map(p => p.vencimento), ['2026-11-11', '2026-11-18', '2026-11-25'], 'IATA +3: quartas-feiras');
eq(proximasFaturas(regra({ periodo: 'DECENDIAL', prazo_dias: 0 }), '2026-11-05').map(p => [p.fim, p.vencimento]), [['2026-11-10', '2026-11-10'], ['2026-11-20', '2026-11-23'], ['2026-11-30', '2026-11-30']], 'decendial: o do meio cai no feriado');
eq(proximasFaturas(av, '2026-11-05').length, 1, 'avulso: um exemplo só');
eq(proximasFaturas(regra({ periodo: 'DIARIO' }), '2026-11-19').map(p => p.vencimento), ['2026-11-19', '2026-11-23', '2026-11-23'], 'diário: 20 e 21/11 vencem na segunda 23/11');

console.log('--- Descrição da regra ---');
eq(descricaoDaRegra(regra({ prazo_dias: 10 })), 'Mensal pela data da venda; vence 10 dias depois do fim do período; fim de semana e feriado adiam.', 'mensal em uma frase');
eq(descricaoDaRegra(av), 'Cada item na sua fatura; vence 10 dias antes da data de início da viagem; fim de semana e feriado adiam.', 'avulso em uma frase');

console.log('--- Qual regra vale ---');
const rs = [
  { ...regra({ id: 'g' }), ativa: true },
  { ...regra({ id: 'h', produto_tipo: 'HOSPEDAGEM' }) },
  { ...regra({ id: 'f', fornecedor_id: 'f1' }) },
  { ...regra({ id: 'hf', produto_tipo: 'HOSPEDAGEM', fornecedor_id: 'f1' }) },
  { ...regra({ id: 'off', produto_tipo: 'AEREO' }), ativa: false },
  { ...regra({ id: 'outro', pessoa_id: 'cli-2' }) },
];
const item = (p: string[], f: string[], pessoa = 'cli-1') => ({ pessoa_tipo: 'CLIENTE' as const, pessoa_id: pessoa, produto_tipos: p, fornecedor_ids: f });
eq(escolherRegra(rs, item(['HOSPEDAGEM'], ['f1']))?.id, 'hf', 'produto e fornecedor: a mais específica');
eq(escolherRegra(rs, item(['HOSPEDAGEM'], ['f9']))?.id, 'h', 'só o produto');
eq(escolherRegra(rs, item(['AEREO'], ['f1']))?.id, 'f', 'só o fornecedor (a de aéreo está desligada)');
eq(escolherRegra(rs, item(['AEREO'], ['f2']))?.id, 'g', 'a geral');
eq(escolherRegra(rs, item(['AEREO'], [], 'cli-3')), null, 'pessoa sem regra: nenhuma');
eq(escolherRegra([{ ...regra({ id: 'h' , produto_tipo: 'HOSPEDAGEM' }) }], item(['AEREO'], [])), null, 'regra só de hospedagem não serve para aéreo');

console.log('--- Totais, notas e retenções ---');
const itens = [{ valor_centavos: 100000, taxas_servico_centavos: 5000 }, { valor_centavos: 50000 }];
const notas = [{ tipo: 'CREDITO' as const, valor_centavos: 2000 }, { tipo: 'DEBITO' as const, valor_centavos: 500 }];
const t = totaisDaFatura(itens, notas, { ir: 1.5, csll: 1, pis: 0.65, cofins: 3, iss: 0, base: 'TOTAL' });
eq([t.itens, t.creditos, t.debitos, t.bruto], [150000, 2000, 500, 148500], 'itens − crédito + débito');
eq(t.retencoes.map(r => [r.nome, r.valor_centavos]), [['IR', 2228], ['CSLL', 1485], ['PIS', 965], ['COFINS', 4455]], 'retenções sobre o total, ao centavo');
eq([t.total_retencoes, t.liquido, t.invalida], [9133, 139367, false], 'o cliente paga o líquido');
const tTaxas = totaisDaFatura(itens, [], { ir: 1.5, csll: 1, pis: 0.65, cofins: 3, iss: 0, base: 'TAXAS' });
eq(tTaxas.retencoes.map(r => r.valor_centavos), [75, 50, 33, 150], 'retenções só sobre as taxas de serviço');
eq(totaisDaFatura([{ valor_centavos: 1000 }], [{ tipo: 'CREDITO', valor_centavos: 1500 }]).invalida, true, 'crédito maior que os itens: fatura inválida');
eq(totaisDaFatura([], []).liquido, 0, 'vazia: zero');

console.log('--- Conferência por arquivo ---');
const rel = conferirComArquivo([
  { conta_id: 'A', valor_centavos: 100000, referencias: ['VND-0001', 'HM123'] },
  { conta_id: 'B', valor_centavos: 50000, referencias: ['VND-0002', 'LOC9'] },
  { conta_id: 'C', valor_centavos: 30000, referencias: ['VND-0003'] },
], [{ referencia: 'hm-123', valor_centavos: 100000 }, { referencia: ' loc9 ', valor_centavos: 49000 }, { referencia: 'XYZ', valor_centavos: 100 }, { referencia: '' }]);
eq(rel.itens.map(i => [i.conta_id, i.resultado, i.linha ?? null]), [['A', 'CONFERIDO', 1], ['B', 'VALOR_DIFERENTE', 2], ['C', 'FALTA_NO_ARQUIVO', null]], 'bate, valor diferente e falta no arquivo (referência sem traço nem caixa)');
eq(rel.linhas_sem_item.map(l => l.referencia), ['XYZ'], 'linha do arquivo sem item (a vazia é ignorada)');
eq([rel.conferidos, rel.divergentes], [1, 3], 'contagem');
eq(conferirComArquivo([{ conta_id: 'A', valor_centavos: 100, referencias: ['X'] }, { conta_id: 'B', valor_centavos: 100, referencias: ['X'] }], [{ referencia: 'x' }]).itens.map(i => i.resultado), ['CONFERIDO', 'FALTA_NO_ARQUIVO'], 'uma linha vale para um item só; sem valor no arquivo, confere pela referência');

console.log('--- Situação visível ---');
eq([
  situacaoVisivel('ABERTA', 'PENDENTE', '2026-11-10', '2026-11-05'),
  situacaoVisivel('FECHADA', 'PENDENTE', '2026-11-10', '2026-11-05'),
  situacaoVisivel('FECHADA', 'PENDENTE', '2026-11-01', '2026-11-05'),
  situacaoVisivel('FECHADA', 'PARCIAL', '2026-11-01', '2026-11-05'),
  situacaoVisivel('FECHADA', 'RECEBIDO', '2026-11-01', '2026-11-05'),
  situacaoVisivel('CANCELADA', 'CANCELADO', '2026-11-01', '2026-11-05'),
], ['ABERTA', 'FECHADA', 'EM_ATRASO', 'PARCIAL', 'PAGA', 'CANCELADA'], 'aberta, fechada, em atraso, paga em parte, paga, cancelada');
eq(ajustarDiaUtil('2026-11-07', 'PROXIMO', true).ajuste, 'Caía num sábado: passou para o próximo dia útil.', 'frase do sábado');

console.log('--- Modelos e exportação ---');
const it = {
  conta_id: 'c1', venda_numero: 'VND-0007', data_venda: '2026-11-03', descricao: 'Venda VND-0007 - Hotel Mar', valor_centavos: 123456,
  detalhes: { produtos: [{ tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor_nome: 'Mar SA', localizador: 'HM1', data_inicio: '2026-12-20', data_fim: '2026-12-24', passageiros: ['Ana', 'Bia'] }], centro_custo: 'Comercial', solicitante: 'Carla' },
};
eq(colunasDoModelo('SIMPLIFICADA'), ['produto', 'passageiros', 'valor'], 'simplificada: descrição e passageiros');
eq(colunasDoModelo('PERSONALIZADA', ['valor', 'centro_custo', 'venda']), ['venda', 'centro_custo', 'valor'], 'personalizada: as marcadas, na ordem da lista, valor por último');
eq([valorDaColuna(it, 'viagem'), valorDaColuna(it, 'passageiros'), valorDaColuna(it, 'valor')], ['20/12/2026 a 24/12/2026', 'Ana, Bia', '1.234,56'], 'colunas do item');
const linhas = linhasDaExportacao({
  numero: 12, pessoa_nome: 'Empresa X', vencimento: '2026-12-10', emissao: '2026-11-30',
  itens: [it, { ...it, conta_id: 'c2', descricao: '=HYPERLINK("x")', valor_centavos: 1000 }],
  notas: [{ tipo: 'CREDITO', valor_centavos: 500, motivo: 'Correção; "tarifa"' }],
  totais: { itens: 124456, creditos: 500, debitos: 0, bruto: 123956, total_retencoes: 0, liquido: 123956, retencoes: [] },
});
eq(linhas.length, 5, 'cabeçalho, 2 itens, 1 nota e o total');
const csv = csvDe(linhas);
eq(csv.startsWith('﻿Fatura;Vencimento;Cliente;'), true, 'CSV com BOM e ponto e vírgula');
eq(csv.includes(';1234,56\r\n'), true, 'valor com vírgula decimal');
eq(csv.includes("'=HYPERLINK"), true, 'texto que começa com = não vira fórmula');
eq(csv.includes('"Correção; ""tarifa"""'), true, 'texto com ; e aspas vai entre aspas');
eq(csv.includes('Total a pagar') && csv.includes(';1239,56\r\n'), true, 'total a pagar no fim');

console.log('--- Nota de débito por venda ---');
const { venda } = normalizarVenda({
  id: 'v1', numero: 'VND-0009', data_venda: '2026-11-03', cliente: { id: 'cli-1', nome: 'Empresa X' }, centro_custo: 'Diretoria',
  produtos: [{
    id: 'p1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f1', nome: 'Mar SA' }, localizador: 'HM9', data_inicio: '2026-12-20', data_fim: '2026-12-24',
    passageiros: [{ id: 'a', nome: 'Ana', tarifa_centavos: 100000, taxas_centavos: 5000 }],
    componentes: [{ id: 'c1', tipo: 'RAV', valor_centavos: 3000 }, { id: 'c2', tipo: 'FEE', valor_centavos: 2000 }, { id: 'c3', tipo: 'DESCONTO', valor_centavos: 1000 }, { id: 'c4', tipo: 'COMISSAO', valor_centavos: 10000 }],
  }],
  pagamentos: [{ id: 'g1', forma: 'FATURAR', valor_centavos: 109000 }],
});
const nd = notaDeDebitoDaVenda(venda, { vencimentos: { g1: ['2026-12-10'] }, retencoes: { ir: 1.5, csll: 0, pis: 0, cofins: 0, iss: 0, base: 'TAXAS' }, solicitante: 'Carla' });
eq([nd.totais.produtos_centavos, nd.totais.taxas_centavos, nd.totais.servicos_centavos, nd.totais.descontos_centavos, nd.totais.total_centavos, nd.totais.a_faturar_centavos],
  [100000, 5000, 5000, 1000, 109000, 109000], 'tarifa, taxas, serviços (RAV+Fee), desconto, total e a faturar (a comissão não aparece para o cliente)');
eq(nd.produtos[0].servicos.map(s => s.nome), ['RAV', 'Fee'], 'serviços pelo nome de mercado');
eq([nd.retencoes.map(r => r.valor_centavos), nd.a_faturar_liquido_centavos], [[75], 108925], 'IR 1,5% sobre as taxas de serviço');
eq([nd.pagamentos[0].forma, nd.pagamentos[0].vencimentos, nd.solicitante, /antes de a fatura ser emitida/.test(nd.aviso)], ['Faturar', ['2026-12-10'], 'Carla', true], 'forma com vencimento, solicitante e o aviso de divergência');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
