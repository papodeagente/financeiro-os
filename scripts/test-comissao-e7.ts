/**
 * Comissões, fechamento de paridade (E7), lógica pura:
 *  - dia de fechamento das metas: o período da meta e o mês a que a venda
 *    pertence; sem dia configurado, NADA muda (o mês civil de sempre);
 *  - quem fecha cada função (pessoas e perfis de acesso; o administrador
 *    fecha todas; lista vazia = todos com o direito);
 *  - comissão manual na venda: validação, valor sobre a receita da agência,
 *    item próprio no fechamento, estorno quando a venda é cancelada depois de
 *    fechada, e a explicação;
 *  - a grade de metas (todas as pessoas × 12 meses).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-comissao-e7.ts
 */
import { normalizarVenda } from '../src/lib/venda-modelo.ts';
import {
  calcularComissoesPorFuncao, normalizarPlano, normalizarConfigComissao, normalizarFuncao, funcoesDoSistema, itensAFechar, linhasDoFechamento,
  frasesDaExplicacao, mesDaMeta, periodoDaMeta, rotuloDoPeriodoDaMeta, normalizarDiaDeFechamento, podeFecharAFuncao,
  prepararComissaoManual, baseDaComissaoManual, linhasDaGradeDeMetas, CONFIG_COMISSAO_PADRAO,
  type ComissaoManual, type PessoaDaFuncao, type LancamentoGravado,
} from '../src/lib/comissao-funcoes.ts';

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

console.log('--- Dia de fechamento das metas ---');
eq([normalizarDiaDeFechamento(0), normalizarDiaDeFechamento(15), normalizarDiaDeFechamento(27), normalizarDiaDeFechamento(28), normalizarDiaDeFechamento(31), normalizarDiaDeFechamento(-3), normalizarDiaDeFechamento('abc')],
  [0, 15, 27, 0, 0, 0, 0], '28 a 31 (e vazio) = último dia do mês');
eq([mesDaMeta('2026-11-25', 0), mesDaMeta('2026-11-30', 0)], ['2026-11', '2026-11'], 'sem dia: o mês da venda');
eq([mesDaMeta('2026-11-25', 25), mesDaMeta('2026-11-26', 25), mesDaMeta('2026-12-26', 25)], ['2026-11', '2026-12', '2027-01'], 'dia 25: depois do dia 25 conta para o mês seguinte (e vira o ano)');
eq(periodoDaMeta('2026-11', 25), { de: '2026-10-26', ate: '2026-11-25' }, 'meta de novembro com dia 25: 26/10 a 25/11');
eq(periodoDaMeta('2027-01', 25), { de: '2026-12-26', ate: '2027-01-25' }, 'janeiro pega o fim de dezembro do ano anterior');
eq(periodoDaMeta('2026-02', 0), { de: '2026-02-01', ate: '2026-02-28' }, 'sem dia: o mês civil (fevereiro com 28)');
eq(rotuloDoPeriodoDaMeta('2026-11', 25), 'de 26/10 a 25/11', 'rótulo do período');
eq(normalizarConfigComissao({ regra: 'FUNCOES' }).dia_fechamento_meta, 0, 'config antiga sem o campo: 0 (nada muda)');

// Uma venda por data, R$ 100 de receita cada.
const vendaEm = (id: string, data: string, vendedor = 'u-bia') => normalizarVenda({
  id, numero: id.toUpperCase(), data_venda: data, cliente: { id: 'c', nome: 'Cliente' }, vendedor: { id: vendedor, nome: vendedor },
  produtos: [{ id: `p-${id}`, tipo: 'OUTROS', descricao: 'Passeio', quantidade: 1, valor_unitario_centavos: 100000, componentes: [{ tipo: 'MARKUP', valor_centavos: 10000 }] }],
}).venda;
const [VENDEDOR] = funcoesDoSistema();
const bia: PessoaDaFuncao = { id: 'fn-vendedor:u-bia', funcao_id: VENDEDOR.id, pessoa_id: 'u-bia', pessoa_nome: 'Bia', plano_id: 'pl', data_inicio: '', nao_comissionado: false };
const plano = normalizarPlano({ id: 'pl', nome: 'Plano', faixas: [
  { percentual_meta: 0, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 10, sobre: ['RECEITA'] } }] },
  { percentual_meta: 100, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 20, sobre: ['RECEITA'] } }] },
] });
const vendas = [vendaEm('a', '2026-11-10'), vendaEm('b', '2026-11-27')].map(venda => ({ venda, cancelada: false, situacao: 'FECHADA' as const }));
const metas = [{ pessoa_funcao_id: bia.id, mes: '2026-11', centavos: 20000 }, { pessoa_funcao_id: bia.id, mes: '2026-12', centavos: 10000 }];
const entrada = (dia: number) => ({
  vendas, funcoes: funcoesDoSistema(), pessoas: [bia], planos: [plano], metas,
  config: { ...CONFIG_COMISSAO_PADRAO, regra: 'FUNCOES' as const, dia_fechamento_meta: dia }, ate: '2026-12-31',
});
let r = calcularComissoesPorFuncao(entrada(0));
eq(r.resumos.map(x => [x.mes, x.atingida_centavos, x.percentual]), [['2026-11', 20000, 100]], 'mês civil: as duas vendas em novembro, 100% da meta');
eq(r.itens.map(i => [i.mes, i.valor_centavos]), [['2026-11', 2000], ['2026-11', 2000]], 'mês civil: faixa de 100% (20%) nas duas');
r = calcularComissoesPorFuncao(entrada(25));
eq(r.resumos.map(x => [x.mes, x.atingida_centavos, x.percentual]), [['2026-11', 10000, 50], ['2026-12', 10000, 100]], 'dia 25: a venda do dia 27 vai para a meta de dezembro');
eq(r.itens.map(i => [i.mes, i.valor_centavos]), [['2026-11', 1000], ['2026-12', 2000]], 'dia 25: cada venda na faixa do seu período');

console.log('--- Quem fecha cada função ---');
const gerente = normalizarFuncao({ id: 'fn-g', nome: 'Gerente', sobre_pessoas: ['u-bia'], quem_fecha: ['u-ana', 'grupo:g-fin', 'u-ana'] });
eq(gerente.quem_fecha, ['u-ana', 'grupo:g-fin'], 'lista sem repetição');
eq(normalizarFuncao({ id: 'x', nome: 'X' }).quem_fecha, [], 'função antiga: ninguém marcado');
eq([
  podeFecharAFuncao(gerente, 'u-ana', [], false),
  podeFecharAFuncao(gerente, 'u-leo', ['g-fin'], false),
  podeFecharAFuncao(gerente, 'u-leo', ['g-outro'], false),
  podeFecharAFuncao(gerente, 'u-leo', [], true),
  podeFecharAFuncao(funcoesDoSistema()[0], 'u-leo', [], false),
], [true, true, false, true, true], 'pessoa marcada, perfil marcado, outro perfil, administrador, função sem lista');

console.log('--- Comissão manual ---');
const vendaFechada = vendaEm('m', '2026-11-05');
const base = baseDaComissaoManual(vendaFechada);
eq(base, 10000, 'base = receita da agência na venda (R$ 100)');
eq(prepararComissaoManual({ tipo: 'PERCENTUAL', percentual: '12,5', descricao: 'Indicação' }, base), { tipo: 'PERCENTUAL', percentual: 12.5, valor_centavos: 1250, descricao: 'Indicação', erros: [] }, '12,5% de R$ 100 = R$ 12,50');
eq(prepararComissaoManual({ tipo: 'VALOR', valor_centavos: 5000, descricao: 'Bônus' }, base).valor_centavos, 5000, 'valor fixo');
eq(prepararComissaoManual({ tipo: 'VALOR', valor_centavos: 0, descricao: '' }, base).erros, ['Diga do que é a comissão (ex.: indicação do cliente, bônus da campanha).', 'Diga o valor da comissão.'], 'sem descrição nem valor');
eq(prepararComissaoManual({ tipo: 'PERCENTUAL', percentual: 150, descricao: 'x' }, base).erros, ['O percentual vai de 0,01% a 100%.'], 'percentual acima de 100%');
eq(prepararComissaoManual({ tipo: 'PERCENTUAL', percentual: 10, descricao: 'x' }, 0).erros, ['A venda não tem receita da agência: lance um valor fixo.'], 'percentual sem receita: pede valor fixo');

const manual: ComissaoManual = {
  id: 'cm1', venda_id: 'm', venda_numero: 'M', cliente_nome: 'Cliente', pessoa_funcao_id: bia.id, pessoa_id: 'u-bia', pessoa_nome: 'Bia',
  funcao_id: VENDEDOR.id, funcao_nome: 'Vendedor', descricao: 'Indicação', tipo: 'PERCENTUAL', percentual: 12.5, base_centavos: 10000, valor_centavos: 1250,
  data: '2026-11-20', lancado_por: 'Ana',
};
const comManual = (cancelada: boolean, ate = '2026-11-30') => calcularComissoesPorFuncao({
  vendas: [{ venda: vendaFechada, cancelada, situacao: 'FECHADA' }], funcoes: funcoesDoSistema(), pessoas: [bia], planos: [plano], metas,
  config: { ...CONFIG_COMISSAO_PADRAO, regra: 'FUNCOES' }, ate, manuais: [manual],
});
r = comManual(false);
const item = r.itens.find(i => i.chave === 'manual|cm1')!;
eq([item.valor_centavos, item.liberado_centavos, item.mes, item.data_venda, item.descricao], [1250, 1250, '2026-11', '2026-11-20', 'Indicação'], 'item próprio, liberado inteiro na data do lançamento');
eq(r.resumos[0].atingida_centavos, 10000, 'a manual não entra na meta');
eq(comManual(false, '2026-11-19').itens.find(i => i.chave === 'manual|cm1')!.liberado_centavos, 0, 'antes da data do lançamento: ainda não liberada');
eq(frasesDaExplicacao(item.explicacao, item.valor_centavos).map(s => s.replace(/\u00a0/g, ' ')), [
  'Comissão lançada à mão por Ana em 20/11/2026: Indicação.',
  '12,5% sobre a receita da agência na venda (R$ 100,00) = R$ 12,50.',
  'Não conta para a meta. Entra inteira no próximo fechamento.',
], 'por que recebi isto?');
let aFechar = itensAFechar(r.itens, []);
const linhas = linhasDoFechamento(r.resumos, aFechar);
eq(linhas[0].itens.map(i => [i.chave, i.valor_centavos]), [['m|p-m|fn-vendedor:u-bia', 1000], ['manual|cm1', 1250]], 'entra no Fechar comissões junto do item do plano');
// Fechada; depois a venda é cancelada: volta como estorno.
const gravados: LancamentoGravado[] = aFechar.map(i => ({ ...i, fechado_centavos: i.valor_centavos, fechado_retido_centavos: 0 }));
aFechar = itensAFechar(comManual(true).itens, gravados);
eq(aFechar.filter(i => i.chave === 'manual|cm1').map(i => [i.valor_centavos, i.estorno]), [[-1250, true]], 'venda cancelada depois de fechada: a manual volta como estorno');
eq(calcularComissoesPorFuncao({ ...entrada(0), manuais: [{ ...manual, venda_id: 'velha' }], vendas_canceladas: ['velha'] }).itens.find(i => i.chave === 'manual|cm1')!.valor_centavos, 0,
  'venda de antes da data inicial cancelada: a manual dela zera');
eq(calcularComissoesPorFuncao({ ...entrada(0), manuais: [manual], so_participantes: ['outra'] }).itens.length, 0, 'filtro de participante vale para a manual');

console.log('--- Grade de metas ---');
const leo: PessoaDaFuncao = { ...bia, id: 'fn-vendedor:u-leo', pessoa_id: 'u-leo', pessoa_nome: 'Leo', plano_id: '' };
const grade = linhasDaGradeDeMetas({ funcoes: [...funcoesDoSistema(), gerente], pessoas: [leo, bia, { ...bia, id: 'fn-g:u-ana', funcao_id: 'fn-g', pessoa_id: 'u-ana', pessoa_nome: 'Ana' }], planos: [plano], metas }, 2026);
eq(grade.map(l => [l.pessoa_nome, l.funcao_nome, l.plano_nome, l.meses[10], l.meses[11], l.meses[0]]),
  [['Bia', 'Vendedor', 'Plano', 20000, 10000, 0], ['Leo', 'Vendedor', '', 0, 0, 0], ['Ana', 'Gerente', 'Plano', 0, 0, 0]], 'todas as pessoas × 12 meses, por função');
eq(linhasDaGradeDeMetas({ funcoes: funcoesDoSistema(), pessoas: [bia], planos: [plano], metas }, 2027)[0].meses.every(v => v === 0), true, 'outro ano: em branco');
eq(linhasDaGradeDeMetas({ funcoes: [...funcoesDoSistema(), gerente], pessoas: [bia, { ...bia, id: 'fn-g:u-ana', funcao_id: 'fn-g' }], planos: [plano], metas }, 2026, 'fn-g').length, 1, 'filtro por função');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
