/**
 * Acompanhamento do plano do mês (src/lib/plano-do-mes.ts): o planejado
 * contra o realizado, área por área.
 *
 * Outubro de 2026 tem 22 dias úteis; o dia 20 é o 14º (64% do mês). O plano é
 * o da tela do Bruno: ticket R$ 8.000, comissão 25%, conversão 10%, lucro
 * desejado R$ 10.000, impostos 6% da comissão e taxa de cartão 4,5% da venda.
 *
 * O que se prova:
 *   (a) o calendário em dias úteis e o ritmo esperado;
 *   (b) meta: concluída, pendente (no ritmo), atrasada (abaixo do ritmo ou mês
 *       fechado), e a folga de 10% só no dinheiro;
 *   (c) atendimentos: sem registro é SEM DADOS (nunca zero, nunca concluído);
 *       o registro vale no dia em que foi feito; registro velho vira aviso;
 *   (d) custos: conta vencida é ATRASADA, gasto além do plano é ACIMA DO
 *       PLANO, nada lançado é SEM DADOS, e só é concluído o que foi pago;
 *   (e) lucro só fecha no fim do mês; equilíbrio vem do que de fato aconteceu;
 *   (f) sem plano: o realizado aparece e nada vira meta; editar o plano muda
 *       as metas e não toca nos registros;
 *   (g) pontos de atenção, premissas contra a realidade e a frase do mês.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-plano-do-mes.ts
 */
import { calcRelatorio, type CustosData } from '../src/lib/planejamento-custos.ts';
import {
  calendarioDoMes, diasUteisAte, montarAcompanhamento, situacaoDaMeta,
  type RealizadoDoMes, type ContaDoMes, type ItemDoPlano,
} from '../src/lib/plano-do-mes.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const plano: CustosData = {
  id: 'p1', mes: '2026-10',
  custos_fixos: [
    { categoria: 'Aluguel/Sede', valor: 3000, observacao: '' },
    { categoria: 'Ferramentas e software', valor: 500, observacao: '' },
  ],
  custos_variaveis: [
    { nome: 'Impostos', percentual: 6, base: 'COMISSAO' },
    { nome: 'Taxa cartão/boleto', percentual: 4.5, base: 'VENDA' },
  ],
  marketing: [{ canal: 'Instagram Ads', valor: 1000 }],
  ticket_medio: 8000, margem_comissao: 25, taxa_conversao: 10, lucro_desejado: 10000, dias_uteis: 22, vendedores_ativos: 1,
};
const rel = calcRelatorio(plano);

const realizado = (o: Partial<RealizadoDoMes> = {}): RealizadoDoMes => ({
  mes: '2026-10', hoje: '2026-10-20',
  vendas: 2, faturamento: 15000, comissao: 3600, comissao_vendedor: 0, taxa_plataforma: 600, impostos: 216,
  impostos_estimados: false, contribuicao: 2784, custo_fixo: 4500, lucro: -1716,
  equilibrio: { atingido: false, na_venda: null, data: null, faltam: 1716 },
  contas: [], registros: [],
  ...o,
});
const conta = (id: string, valor: number, pago: number, vencimento: string, grupo: ContaDoMes['grupo'] = 'fixo'): ContaDoMes =>
  ({ id, descricao: id, fornecedor: '', valor, pago, vencimento, grupo });
const item = (a: ReturnType<typeof montarAcompanhamento>, chave: ItemDoPlano['chave']) =>
  a.areas.flatMap(x => x.itens).find(i => i.chave === chave)!;

console.log(`(o plano pede ${rel.vendasMeta} vendas, ${rel.atendimentosMeta} atendimentos, R$ ${rel.receitaMeta} de comissão)`);

console.log('\n--- (a) calendário ---');
eq([diasUteisAte('2026-10', 31), diasUteisAte('2026-10', 20), diasUteisAte('2026-10', 4)], [22, 14, 2], 'outubro/2026: 22 dias úteis; 14 até o dia 20; 2 até o domingo dia 4');
const c20 = calendarioDoMes('2026-10', '2026-10-20');
eq([c20.diasUteisPassados, c20.diasUteisRestantes, Math.round(c20.fracao * 100), c20.aberto], [14, 8, 64, true], 'dia 20: 14 passados, 8 restantes, 64% do mês');
eq([calendarioDoMes('2026-10', '2026-11-03').fracao, calendarioDoMes('2026-10', '2026-11-03').aberto], [1, false], 'mês que já passou: inteiro');
eq([calendarioDoMes('2026-10', '2026-09-28').futuro, calendarioDoMes('2026-10', '2026-09-28').fracao], [true, 0], 'mês que ainda não começou: nada esperado');

console.log('\n--- (b) metas ---');
eq(situacaoDaMeta({ planejado: 7, realizado: 2, formato: 'contagem', cal: c20 }).situacao, 'atrasado', '2 de 7 vendas no dia 20: o ritmo pedia 4, atrasado');
eq(situacaoDaMeta({ planejado: 7, realizado: 4, formato: 'contagem', cal: c20 }).situacao, 'pendente', '4 de 7: no ritmo (4,45 arredonda para 4), pendente');
eq(situacaoDaMeta({ planejado: 7, realizado: 7, formato: 'contagem', cal: c20 }).situacao, 'concluido', '7 de 7: concluído');
eq(situacaoDaMeta({ planejado: 7, realizado: 6, formato: 'contagem', cal: calendarioDoMes('2026-10', '2026-11-02') }).situacao, 'atrasado', 'mês fechado com 6 de 7: atrasado');
eq(situacaoDaMeta({ planejado: 7, realizado: 0, formato: 'contagem', cal: calendarioDoMes('2026-10', '2026-09-30') }).situacao, 'pendente', 'mês que não começou: pendente, não atrasado');
const meta = 14000;
eq([
  situacaoDaMeta({ planejado: meta, realizado: 8100, formato: 'dinheiro', cal: c20 }).situacao,
  situacaoDaMeta({ planejado: meta, realizado: 8000, formato: 'dinheiro', cal: c20 }).situacao,
], ['pendente', 'atrasado'], 'dinheiro tem 10% de folga: R$ 8.100 está no ritmo de R$ 8.909, R$ 8.000 não');

const a = montarAcompanhamento({ plano, rel, realizado: realizado() });
const vendas = item(a, 'vendas');
eq([vendas.planejado, vendas.realizado, vendas.falta, vendas.situacao], [rel.vendasMeta, 2, rel.vendasMeta - 2, 'atrasado'], 'vendas: planejado, realizado, falta e situação');
eq([vendas.progresso, vendas.esperadoPct], [Math.round((2 / rel.vendasMeta) * 10000) / 100, Math.round((Math.floor(rel.vendasMeta * 14 / 22) / rel.vendasMeta) * 10000) / 100], 'a barra e a marca de hoje, em % do planejado');

console.log('\n--- (c) atendimentos ---');
const semRegistro = item(a, 'atendimentos');
eq([semRegistro.situacao, semRegistro.realizado, semRegistro.progresso, semRegistro.registravel], ['sem_dados', null, null, true], 'sem registro: SEM DADOS, nunca zero e nunca concluído');
eq(a.atencao.some(p => p.chave === 'atendimentos' && p.acao?.registrar === 'atendimentos'), true, 'e vira ponto de atenção com o atalho de registrar');
const reg = (valor: number, data: string, criado = `${data}T12:00:00Z`) => ({ id: `r-${valor}-${data}`, chave: 'atendimentos', valor, data, observacao: '', autor: 'Karen', criado_em: criado });
const comRegistro = montarAcompanhamento({ plano, rel, realizado: realizado({ registros: [reg(35, '2026-10-09')] }) });
const at = item(comRegistro, 'atendimentos');
eq([at.realizado, at.situacao, /até 09\/10/.test(at.porque), at.fonte], [35, 'pendente', true, 'Registrado em 09/10 por Karen'], '35 em 09/10: comparado com o ritmo de 09/10 (pedia 31), pendente; pelo de hoje (63) estaria atrasado');
eq(item(montarAcompanhamento({ plano, rel, realizado: realizado({ registros: [reg(30, '2026-10-09')] }) }), 'atendimentos').situacao, 'atrasado', '30 em 09/10: abaixo dos 31 daquele dia, atrasado');
eq(comRegistro.atencao.some(p => /último registro de atendimentos é de 09\/10/.test(p.texto)), true, 'registro com mais de 7 dias: pede atualização');
const doisRegistros = montarAcompanhamento({ plano, rel, realizado: realizado({ registros: [reg(30, '2026-10-09'), reg(55, '2026-10-19'), reg(40, '2026-10-19', '2026-10-19T08:00:00Z')] }) });
eq(item(doisRegistros, 'atendimentos').realizado, 55, 'vale o registro do dia mais recente; no mesmo dia, o último feito');
eq(doisRegistros.indicadores.find(i => i.titulo === 'Taxa de conversão')!.realizado, 3.64, 'conversão real = vendas sobre atendimentos registrados (2 de 55)');

console.log('\n--- (d) custos ---');
const comContas = montarAcompanhamento({ plano, rel, realizado: realizado({ contas: [
  conta('Aluguel', 3000, 3000, '2026-10-05'),
  conta('Sistema', 500, 0, '2026-10-10'),
  conta('Contador', 400, 0, '2026-10-25'),
  conta('Instagram', 800, 800, '2026-10-02', 'marketing'),
] }) });
const fixos = item(comContas, 'custos_fixos');
eq([fixos.planejado, fixos.realizado, fixos.situacao, fixos.contas!.vencidas.length, fixos.contas!.aVencer.length, fixos.contas!.vencido], [3500, 3000, 'atrasado', 1, 1, 500], 'fixos: R$ 3.000 pagos de R$ 3.500; a conta vencida de R$ 500 deixa ATRASADO');
const atencaoFixos = comContas.atencao.find(p => p.chave === 'custos_fixos')!;
eq([atencaoFixos.tom, atencaoFixos.acao?.href], ['negativo', '/financeiro-ag/pagar?status=VENCIDO'], 'e vira ponto de atenção negativo, com o atalho para as vencidas');
const mkt = item(comContas, 'marketing');
eq([mkt.planejado, mkt.realizado, mkt.situacao], [1000, 800, 'pendente'], 'marketing: separado da estrutura; tudo pago, R$ 200 ainda por lançar no mês aberto, pendente');
eq(item(a, 'custos_fixos').situacao, 'sem_dados', 'nenhuma conta fixa lançada: SEM DADOS, não "pago"');
const acima = montarAcompanhamento({ plano, rel, realizado: realizado({ contas: [conta('Aluguel', 3000, 3000, '2026-10-05'), conta('Reforma', 1200, 0, '2026-10-28')] }) });
eq([item(acima, 'custos_fixos').situacao, acima.atencao.some(p => /Custos fixos acima do plano/.test(p.texto))], ['acima', true], 'lançado além do teto, nada vencido: ACIMA DO PLANO, com aviso');
const tudoPago = montarAcompanhamento({ plano, rel, realizado: realizado({ contas: [conta('Aluguel', 3000, 3000, '2026-10-05'), conta('Sistema', 500, 500, '2026-10-10')] }) });
eq(item(tudoPago, 'custos_fixos').situacao, 'concluido', 'tudo o planejado lançado e pago: concluído');

const variaveis = item(a, 'custos_variaveis');
eq([variaveis.planejado, variaveis.realizado, variaveis.situacao], [rel.custoVarPorVenda, 408, 'pendente'], 'variáveis: R$ 408 por venda contra R$ 480 previstos, dentro');
const variavelAlto = item(montarAcompanhamento({ plano, rel, realizado: realizado({ comissao_vendedor: 400 }) }), 'custos_variaveis');
eq(variavelAlto.situacao, 'acima', 'com R$ 400 de comissão de vendedor a mais: acima do plano');
eq(item(montarAcompanhamento({ plano, rel, realizado: realizado({ vendas: 0, faturamento: 0, comissao: 0 }) }), 'custos_variaveis').situacao, 'sem_dados', 'sem venda: custo por venda SEM DADOS');

console.log('\n--- (e) resultado ---');
const lucro = item(a, 'lucro');
eq([lucro.planejado, lucro.realizado, lucro.situacao, lucro.progresso], [10000, -1716, 'pendente', 0], 'lucro negativo no meio do mês: pendente (só fecha no fim), progresso zero');
eq(item(montarAcompanhamento({ plano, rel, realizado: realizado({ hoje: '2026-11-04' }) }), 'lucro').situacao, 'atrasado', 'mês fechado abaixo do lucro desejado: atrasado');
const pago = montarAcompanhamento({ plano, rel, realizado: realizado({ equilibrio: { atingido: true, na_venda: 2, data: '2026-10-15', faltam: 0 } }) });
eq([item(pago, 'equilibrio').situacao, item(pago, 'equilibrio').porque], ['concluido', 'Os custos do mês foram pagos pela 2ª venda, em 15/10.'], 'equilíbrio: vem do que de fato aconteceu');

console.log('\n--- (f) sem plano, e plano editado ---');
const semPlano = montarAcompanhamento({ plano: null, rel: null, realizado: realizado() });
eq([item(semPlano, 'vendas').situacao, item(semPlano, 'vendas').realizado, item(semPlano, 'comissao').realizado], ['sem_meta', 2, 3600], 'sem plano: nada é meta, e o realizado aparece');
eq(semPlano.frase.replace(/\u00a0/g, ' '), 'Ainda não há plano para este mês. O que já aconteceu está abaixo: 2 vendas e R$ 3.600,00 em comissões.', 'a frase diz que não há plano e mostra o que já aconteceu');
const semPremissa = { ...plano, ticket_medio: 0 };
eq(item(montarAcompanhamento({ plano: semPremissa, rel: calcRelatorio(semPremissa), realizado: realizado() }), 'vendas').situacao, 'sem_meta', 'plano sem ticket: sem meta de vendas, mas os custos continuam acompanhados');
const registros = [reg(30, '2026-10-19')];
const antes = montarAcompanhamento({ plano, rel, realizado: realizado({ registros }) });
const planoNovo = { ...plano, taxa_conversao: 20 };
const depois = montarAcompanhamento({ plano: planoNovo, rel: calcRelatorio(planoNovo), realizado: realizado({ registros }) });
eq([item(antes, 'atendimentos').realizado, item(depois, 'atendimentos').realizado], [30, 30], 'editar o plano não mexe no registro');
eq(item(depois, 'atendimentos').planejado! < item(antes, 'atendimentos').planejado!, true, 'e a meta de atendimentos é refeita com a conversão nova');

console.log('\n--- (g) atenção, premissas e frase ---');
eq(a.atencao[0].tom, 'negativo', 'atrasado vem antes de aviso');
eq(a.atencao.some(p => p.chave === 'vendas' && /Para fechar o mês: .* por dia útil nos 8 que restam/.test(p.texto)), true, 'vendas atrasadas dizem o ritmo que falta');
const ticket = a.indicadores.find(i => i.titulo === 'Ticket médio')!;
eq([ticket.planejado, ticket.realizado, ticket.desvio], [8000, 7500, false], 'ticket real R$ 7.500 contra R$ 8.000: dentro da folga de 15%');
const margem = a.indicadores.find(i => i.titulo === 'Margem de comissão')!;
eq([margem.realizado, margem.desvio], [24, false], 'margem real 24% contra 25%: dentro de 3 pontos');
const margemBaixa = montarAcompanhamento({ plano, rel, realizado: realizado({ comissao: 2700 }) });
eq(margemBaixa.indicadores.find(i => i.titulo === 'Margem de comissão')!.desvio, true, 'margem real 18%: abaixo do plano, vira aviso');
eq(/^14 de 22 dias úteis: \d+ itens? precisa/.test(a.frase), true, 'a frase: onde o mês está e quantos itens pedem atenção');
eq(Object.values(a.contagem).reduce((x, y) => x + y, 0), 9, 'nove itens em quatro áreas');

console.log(`\n${total - falhas}/${total} testes do acompanhamento do plano passaram`);
if (falhas > 0) process.exit(1);
