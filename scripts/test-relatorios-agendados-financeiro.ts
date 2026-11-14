/**
 * Envio agendado do DRE, do Fluxo de caixa e da Visão geral (E7, fechamento),
 * regras puras: relatórios e períodos novos (sem mexer nos de vendas), e os
 * documentos de exportação que a tela e o envio usam (um desenho só).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-relatorios-agendados-financeiro.ts
 */
import {
  PERIODOS_POR_RELATORIO, RELATORIOS_AGENDAVEIS, descricaoDoAgendamento, periodoDoEnvio, periodoSugerido, validarAgendamento,
} from '../src/lib/relatorios-agendados/regras.ts';
import {
  documentoDaGradeDoFluxo, documentoDaVisaoGeral, documentoDoCadernoDoFluxo, documentoDoDREdoMes, documentoDoDREMesAMes,
  linhasDoDREnoModo, linhasDoMesAMesNoModo, rotuloCurtoDoMesDRE, rotuloDoMesDRE,
} from '../src/lib/exportacao/documentos-financeiro.ts';
import { agrupamentoDoPeriodo, filtrosDoDRE, filtrosDoFluxo } from '../src/lib/relatorios-agendados/filtros-financeiro.ts';
import { dreMesAMes, montarDRE } from '../src/lib/resultado-dre.ts';
import { lancamentosDoCaixa, montarCaderno } from '../src/lib/caderno-caixa.ts';
import { gradeContaPorDia } from '../src/lib/fluxo-comparativo.ts';
import { agendaDosProximosDias, mesAteHoje, posicaoDeHoje } from '../src/lib/visao-geral.ts';
import type { ContaBancaria, ContaPagar, ContaReceber, PlanoContas } from '../src/lib/crm-types.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- Relatórios e períodos ---');
eq(RELATORIOS_AGENDAVEIS, ['vendas', 'dre', 'fluxo', 'visao_geral'], 'DRE, fluxo e visão geral agendáveis');
eq(PERIODOS_POR_RELATORIO.vendas, ['ontem', 'ultimos_7', 'semana_anterior', 'mes_atual', 'mes_anterior', 'ultimos_30', 'ano_atual'], 'vendas: os sete períodos de sempre');
const base = { nome: 'Resultado', relatorio: 'dre', consulta: 'regime=caixa', frequencia: 'mensal', dia_mes: 1, hora: 7, periodo: 'mes_anterior', formato: 'pdf', destinatarios: ['a@x.com'], validade_dias: 30 };
eq(validarAgendamento(base).ok, true, 'DRE do mês passado: válido');
const r1 = validarAgendamento({ ...base, periodo: 'ontem' });
eq(r1.ok ? null : r1.erros.periodo, 'Este período não serve para este relatório. Escolha um da lista.', 'DRE não aceita "ontem"');
const r2 = validarAgendamento({ ...base, relatorio: 'vendas', periodo: 'proximos_30' });
eq(r2.ok, false, 'vendas não aceita período para a frente');
eq(validarAgendamento({ ...base, relatorio: 'fluxo', periodo: 'proximos_30' }).ok, true, 'fluxo aceita os próximos 30 dias');
eq(validarAgendamento({ ...base, relatorio: 'visao_geral', periodo: 'posicao_do_dia', consulta: '' }).ok, true, 'visão geral: a posição do dia');
eq(validarAgendamento({ ...base, relatorio: 'visao_geral', periodo: 'mes_anterior' }).ok, false, 'visão geral só tem a posição do dia');
eq([periodoSugerido('vendas', 'semanal'), periodoSugerido('dre', 'diario'), periodoSugerido('fluxo', 'mensal'), periodoSugerido('visao_geral', 'semanal')],
  ['semana_anterior', 'mes_atual', 'mes_atual_inteiro', 'posicao_do_dia'], 'período sugerido por relatório e frequência');
eq(periodoDoEnvio('proximos_7', '2026-11-06'), { de: '2026-11-06', ate: '2026-11-12' }, 'próximos 7 dias contam o dia do envio');
eq(periodoDoEnvio('proximos_30', '2026-11-06'), { de: '2026-11-06', ate: '2026-12-05' }, 'próximos 30 dias');
eq(periodoDoEnvio('mes_atual_inteiro', '2026-02-10'), { de: '2026-02-01', ate: '2026-02-28' }, 'mês atual inteiro');
eq(periodoDoEnvio('posicao_do_dia', '2026-11-06'), { de: '2026-11-06', ate: '2026-11-06' }, 'a posição é a do dia do envio');
eq(descricaoDoAgendamento({ frequencia: 'diario', dia_semana: 0, dia_mes: 1, hora: 8, periodo: 'posicao_do_dia' }), 'Todo dia às 8h, com a posição do dia', 'descrição da visão geral');
eq(descricaoDoAgendamento({ frequencia: 'semanal', dia_semana: 1, dia_mes: 1, hora: 7, periodo: 'proximos_30' }), 'Toda segunda-feira às 7h, com próximos 30 dias', 'descrição sem o parêntese');
eq(descricaoDoAgendamento({ frequencia: 'semanal', dia_semana: 1, dia_mes: 1, hora: 7, periodo: 'semana_anterior' }), 'Toda segunda-feira às 7h, com semana passada', 'a descrição de vendas não mudou');

console.log('--- Filtros salvos ---');
eq(filtrosDoDRE(''), { regime: 'competencia', centro: '', rateio: 'todas', simplificado: true }, 'DRE sem filtro: competência, resumido');
eq(filtrosDoDRE('regime=caixa&centro=cc-1&rateio=rateadas&detalhe=completo'), { regime: 'caixa', centro: 'cc-1', rateio: 'rateadas', simplificado: false }, 'DRE com os filtros da tela');
eq(filtrosDoDRE('regime=xx&rateio=xx').regime, 'competencia', 'valor desconhecido volta ao padrão');
eq(filtrosDoFluxo('vista=grade&medida=movimento&folha=0'), { conta: '', agrupamento: null, vista: 'grade', medida: 'movimento', folha: false }, 'fluxo em grade, sem folha');
eq(filtrosDoFluxo('agrupamento=semana&conta=cb1'), { conta: 'cb1', agrupamento: 'semana', vista: 'caderno', medida: 'saldo', folha: true }, 'fluxo por semana numa conta');
eq([agrupamentoDoPeriodo('2026-11-01', '2026-11-30'), agrupamentoDoPeriodo('2026-10-01', '2026-12-31'), agrupamentoDoPeriodo('2026-01-01', '2026-11-05')], ['dia', 'semana', 'mes'], 'agrupamento pelo tamanho do período');

console.log('--- Documento do DRE ---');
const plano = [{ id: 'c221', codigo: '2.2.1', nome: 'Aluguel' }] as unknown as PlanoContas[];
const cr = (id: string, o: Record<string, unknown>) => ({ id, status: 'PENDENTE', valor_final: 0, taxa: 0, ...o }) as unknown as ContaReceber;
const cp = (id: string, o: Record<string, unknown>) => ({ id, status: 'PENDENTE', valor_final: 0, ...o }) as unknown as ContaPagar;
const receber = [cr('f1', { origem: 'FEE', data_vencimento: '2026-10-10', valor_final: 1000 }), cr('f2', { origem: 'FEE', data_vencimento: '2026-11-10', valor_final: 500 })];
const pagar = [cp('a1', { categoria_id: 'c221', data_vencimento: '2026-10-05', valor_final: 400 })];
const baseDRE = { receber, pagar, vendasComLastro: [], planoContas: plano, comissaoNaoCapturada: new Map<string, number>() };
const outubro = montarDRE({ ...baseDRE, mes: '2026-10' });
const docMes = documentoDoDREdoMes({ filtros: { periodo: 'Outubro 2026', regime: 'competencia', rateio: 'todas' }, rotuloMes: rotuloDoMesDRE('2026-10'), linhas: linhasDoDREnoModo(outubro, true) });
eq([docMes.titulo, docMes.colunas.map(c => c.id), docMes.filtros], ['Resultado do mês (DRE)', ['linha', 'valor'], [{ rotulo: 'Período', valor: 'Outubro 2026' }, { rotulo: 'Regime', valor: 'Competência' }]], 'um mês: título, colunas e filtros');
eq(docMes.linhas.find(l => String(l.linha).includes('Lucro líquido'))?.valor, 600, 'lucro de outubro');
eq(docMes.linhas.every(l => !String(l.linha).startsWith('Margem')), true, 'margens vão para o rodapé');
eq(/^Margem sobre a receita: /.test(String(docMes.nota)), true, 'rodapé com a margem');
const novembro = montarDRE({ ...baseDRE, mes: '2026-11' });
const docComp = documentoDoDREdoMes({ filtros: { periodo: 'Novembro 2026', regime: 'caixa', centro: 'Loja', rateio: 'rateadas', comparadoCom: 'Outubro 2026' }, rotuloMes: 'Novembro 2026', linhas: linhasDoDREnoModo(novembro, true), comparativo: linhasDoDREnoModo(outubro, true), orcado: new Map([['LUCRO LÍQUIDO', 300]]) });
eq(docComp.colunas.map(c => c.id), ['linha', 'valor', 'orcado', 'desvio', 'comparativo', 'variacao'], 'com orçado e comparativo (a tela)');
eq(docComp.filtros?.map(f => f.rotulo), ['Período', 'Regime', 'Centro de custo', 'Rateio', 'Comparado com'], 'filtros da tela no arquivo');
const lucroComp = docComp.linhas.find(l => String(l.linha).includes('Lucro líquido'))!;
eq([lucroComp.valor, lucroComp.orcado, lucroComp.desvio, lucroComp.comparativo, lucroComp.variacao], [500, 300, 200, 600, -100], 'orçado, desvio, comparativo e variação casados pelo nome');
eq(linhasDoDREnoModo(outubro, false).length >= linhasDoDREnoModo(outubro, true).length, true, 'completo tem pelo menos as linhas do resumido');
const mm = dreMesAMes(baseDRE, ['2026-10', '2026-11']);
const docMM = documentoDoDREMesAMes({ filtros: { periodo: 'Outubro 2026 a Novembro 2026', regime: 'competencia' }, mesAMes: mm, linhas: linhasDoMesAMesNoModo(mm.linhas, true) });
eq([docMM.titulo, docMM.colunas.map(c => c.rotulo), docMM.orientacao], ['Resultado mês a mês (DRE)', ['Conta', 'out/26', 'nov/26', 'Total', 'Média'], 'paisagem'], 'mês a mês: uma coluna por mês');
eq(docMM.linhas.find(l => String(l.linha).includes('Lucro líquido')), { linha: 'Lucro líquido', total: 1100, media: 550, '2026-10': 600, '2026-11': 500 }, 'lucro mês a mês, total e média');
eq(rotuloCurtoDoMesDRE('2027-01'), 'jan/27', 'rótulo curto do mês');

console.log('--- Documento do fluxo ---');
const bancarias = [{ id: 'cb1', nome: 'Banco', saldo_inicial: 1000 }, { id: 'cb2', nome: 'Caixa Geral', saldo_inicial: 0 }] as unknown as ContaBancaria[];
const rf = [cr('r1', { data_vencimento: '2026-11-03', valor_final: 200, conta_bancaria_id: 'cb1', cliente_nome: 'Ana' })];
const pf = [cp('p1', { data_vencimento: '2026-11-04', valor_final: 50, conta_bancaria_id: 'cb1', fornecedor_nome: 'Hotel' })];
const periodo = { tipo: 'mes' as const, inicio: '2026-11-01', fim: '2026-11-07', rotulo: '01/11/2026 a 07/11/2026', meses: '' };
const caderno = montarCaderno({ lancamentos: lancamentosDoCaixa({ receber: rf, pagar: pf, hoje: '2026-11-01' }), contas: bancarias, periodo, agrupamento: 'dia', hoje: '2026-11-01' });
const docCad = documentoDoCadernoDoFluxo({ caderno, periodo, agrupamento: 'dia', conta: null });
eq([docCad.titulo, docCad.filtros, docCad.linhas[0]], ['Fluxo de caixa', [{ rotulo: 'Período', valor: '01/11/2026 a 07/11/2026' }], { rotulo: 'Saldo em 1 nov', saldo: 1000 }], 'caderno: o saldo do começo na primeira linha');
eq(docCad.totais, { entradas: 200, saidas: 50, saldo: 1150 }, 'totais do caderno');
eq(documentoDoCadernoDoFluxo({ caderno, periodo, agrupamento: 'dia', conta: '' }).filtros?.[1], { rotulo: 'Conta', valor: 'Conta sem nome' }, 'conta sem nome dita');
const grade = gradeContaPorDia({ receber: rf, pagar: pf, contas: bancarias, caixaGeralId: 'cb2', periodo, hoje: '2026-11-01' });
const docGrade = documentoDaGradeDoFluxo({ grade, periodo, medida: 'movimento' });
eq([docGrade.titulo, docGrade.linhas.length, docGrade.totais?.total], ['Fluxo de caixa por conta e dia', 7, 150], 'grade por movimento: um dia por linha, total do período');
eq(documentoDaGradeDoFluxo({ grade, periodo, medida: 'saldo' }).linhas[0].dia, 'Saldo anterior', 'grade por saldo começa no saldo anterior');

console.log('--- Documento da visão geral ---');
const hoje = '2026-11-06';
const rv = [cr('v1', { data_vencimento: '2026-11-01', valor_final: 300, cliente_nome: 'Bia' }), cr('v2', { status: 'RECEBIDO', data_vencimento: '2026-11-02', data_recebimento: '2026-11-02', valor_final: 100, valor_recebido: 100, conta_bancaria_id: 'cb1' })];
const pv = [cp('w1', { data_vencimento: '2026-11-20', valor_final: 80, fornecedor_nome: 'Aéreo' })];
const docVG = documentoDaVisaoGeral({ hoje, posicao: posicaoDeHoje({ contasBancarias: bancarias, receber: rv, pagar: pv, hoje }), mes: mesAteHoje(rv, pv, hoje), agenda: agendaDosProximosDias({ receber: rv, pagar: pv, hoje }) });
eq([docVG.titulo, docVG.subtitulo, docVG.colunas.map(c => c.id)], ['Visão geral do financeiro', 'Posição em 06/11/2026', ['secao', 'item', 'valor', 'detalhe']], 'visão geral: título e colunas');
const item = (nome: string) => docVG.linhas.find(l => l.item === nome);
eq([item('Em caixa')?.valor, item('A receber')?.valor, item('A receber vencido')?.valor, item('A pagar')?.valor], [1100, 300, 300, 80], 'posição do dia');
eq(item('Entrou')?.valor, 100, 'o mês até o dia, pela data da baixa');
eq([item('Bia')?.secao, item('Bia')?.valor, item('Aéreo')?.valor, String(item('Aéreo')?.detalhe).startsWith('Pagar em 20/11')], ['Vencidos', 300, -80, true], 'agenda: vencido primeiro, saída negativa');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
