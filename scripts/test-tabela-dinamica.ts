/**
 * Tabela dinâmica (src/lib/tabela-dinamica.ts) e Resultado por categoria
 * (src/lib/resultado-por-categoria.ts), 05/11/2026.
 *
 * O que não pode quebrar:
 *   1) Subtotal de um nó = soma dos filhos, em cada coluna; total geral =
 *      soma das colunas = soma dos registros. Em centavos, sem perder um.
 *   2) Ordem estável (Receitas antes de Despesas, meses em ordem natural).
 *   3) Repasse fora por padrão; dentro quando a pessoa pede.
 *   4) Rateio divide a conta pelos centros e a soma continua a da conta.
 *   5) O CSV não deixa fórmula passar.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-tabela-dinamica.ts
 */
import {
  COLUNA_TOTAL, linhasVisiveis, montarTabelaDinamica, registrosDaCelula, SEPARADOR, type RegistroDinamico,
} from '../src/lib/tabela-dinamica.ts';
import {
  COLUNAS_PADRAO, csvDoDemonstrativo, LINHAS_PADRAO, ORDEM_DO_DEMONSTRATIVO, ratearCentavos, registrosDoDemonstrativo,
  rotuloDoValor, SEM_CENTRO,
} from '../src/lib/resultado-por-categoria.ts';
import type { ContaPagar, ContaReceber, PlanoContas } from '../src/lib/crm-types.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- pivot genérico: 2 níveis de linha × 2 de coluna ---');
const reg = (a: string, b: string, ano: string, mes: string, centavos: number): RegistroDinamico =>
  ({ campos: { a, b, ano, mes }, centavos });
const regs = [
  reg('X', 'x1', '2026', '2026-10', 1000),
  reg('X', 'x2', '2026', '2026-10', 250),
  reg('X', 'x1', '2026', '2026-11', 1),
  reg('Y', 'y1', '2025', '2025-12', -300),
  reg('Y', 'y1', '2026', '2026-10', 99),
];
const t = montarTabelaDinamica(regs, ['a', 'b'], ['ano', 'mes']);
eq(t.colunas.map(c => c.chave), [['2025', '2025-12'], ['2026', '2026-10'], ['2026', '2026-11']].map(c => c.join(SEPARADOR)), 'colunas em ordem natural');
eq(t.cabecalho.map(n => n.map(g => [g.valor, g.span])), [[['2025', 1], ['2026', 2]], [['2025-12', 1], ['2026-10', 1], ['2026-11', 1]]], 'cabeçalho: ano cobre os seus meses');
eq(t.linhas.map(l => [l.chave.split(SEPARADOR).join('/'), l.nivel, l.folha, l.total]), [
  ['X', 0, false, 1251], ['X/x1', 1, true, 1001], ['X/x2', 1, true, 250], ['Y', 0, false, -201], ['Y/y1', 1, true, -201],
], 'pai antes dos filhos, subtotal no pai');
const c1026 = ['2026', '2026-10'].join(SEPARADOR);
eq(t.linhas[0].celulas[c1026], 1250, 'subtotal por coluna = soma dos filhos');
eq([t.totaisPorColuna[c1026], t.totalGeral], [1349, 1050], 'total por coluna e geral');
eq(Object.values(t.totaisPorColuna).reduce((s, v) => s + v, 0), t.totalGeral, 'soma das colunas = total geral');
eq(registrosDaCelula(regs, t, ['X'], c1026).length, 2, 'clique na célula: os registros por trás');
eq(registrosDaCelula(regs, t, null, null).length, 5, 'célula do total geral: tudo');
eq(linhasVisiveis(t.linhas, new Set(['X'])).map(l => l.valor), ['X', 'Y', 'y1'], 'recolher um nó esconde os filhos');
const semColuna = montarTabelaDinamica(regs, ['a'], []);
eq([semColuna.colunas.map(c => c.chave), semColuna.linhas[0].celulas[COLUNA_TOTAL]], [[COLUNA_TOTAL], 1251], 'sem campo de coluna: uma coluna só');
const ordemCustom = montarTabelaDinamica(regs, ['a'], [], { ordem: { a: (x, y) => y.localeCompare(x) } });
eq(ordemCustom.linhas.map(l => l.valor), ['Y', 'X'], 'comparador por campo');

console.log('--- resultado por categoria ---');
const plano = (id: string, codigo: string, nome: string, pai: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, codigo, nome, tipo: codigo.startsWith('1') ? 'RECEITA' : 'DESPESA', categoria_pai_id: pai, natureza_custo: null, is_custo_comercial: false, ativo: true, ...extra }) as PlanoContas;
const planoContas = [
  plano('r1', '1.1', 'Comissões', null), plano('r11', '1.1.01', 'Comissão aérea', 'r1'),
  plano('d2', '2.2', 'Operacionais', null), plano('d21', '2.2.01', 'Aluguel', 'd2'),
  plano('rep', '2.9', 'Repasse operadora', null, { repasse: true }),
];
const cr = (o: Partial<ContaReceber> & { id: string }) => ({ status: 'PENDENTE', origem: 'OUTROS', cliente_nome: 'Ana', descricao: o.id, centro_custo: '', rateio: [], ...o }) as ContaReceber;
const cp = (o: Partial<ContaPagar> & { id: string }) => ({ status: 'PENDENTE', origem: 'OUTROS', fornecedor_nome: 'Imobiliária', descricao: o.id, centro_custo: '', rateio: [], ...o }) as ContaPagar;
const receber = [
  cr({ id: 'c1', categoria_id: 'r11', valor_final: 300, data_vencimento: '2026-10-05', status: 'RECEBIDO', valor_recebido: 300, data_recebimento: '2026-11-01', conta_bancaria_id: 'b1' }),
  cr({ id: 'c2', categoria_id: 'r11', valor_final: 100, data_vencimento: '2026-11-05' }),
  cr({ id: 'c3', categoria_id: 'r11', valor_final: 999, data_vencimento: '2026-10-05', status: 'CANCELADO' }),
];
const pagar = [
  cp({ id: 'p1', categoria_id: 'd21', valor_final: 1000, data_vencimento: '2026-10-10', rateio: [{ centro_custo: 'SP', percentual: 50, valor: 0 }, { centro_custo: 'RJ', percentual: 30, valor: 0 }] }),
  cp({ id: 'p2', categoria_id: 'rep', valor_final: 700, data_vencimento: '2026-10-11' }),
  cp({ id: 'p3', categoria_id: '', origem: 'VENDA', auto_gerado: true, valor_final: 200, data_vencimento: '2026-10-12' }),
];
const base = { receber, pagar, planoContas, contasBancarias: [{ id: 'b1', nome: 'Inter' }], regime: 'competencia' as const, incluirRepasse: false, usarRateio: false };
const sem = registrosDoDemonstrativo(base);
eq(sem.map(r => r.ref?.id), ['c1', 'c2', 'p1'], 'repasse fora por padrão (categoria marcada e repasse da venda); cancelada fora');
const com = registrosDoDemonstrativo({ ...base, incluirRepasse: true });
eq(com.map(r => r.ref?.id), ['c1', 'c2', 'p1', 'p2', 'p3'], 'mostrar repasses ao fornecedor');
eq(sem[0].campos, { tipo: 'Receitas', grupo: '1.1 Comissões', categoria: '1.1.01 Comissão aérea', ano: '2026', mes: '2026-10', pessoa: 'Ana', conta: 'Inter', centro: 'Sem centro de custo' }, 'campos: grupo é a categoria pai');
eq(sem[2].centavos, -100000, 'despesa negativa, em centavos');
const tabela = montarTabelaDinamica(sem, LINHAS_PADRAO, COLUNAS_PADRAO, { ordem: ORDEM_DO_DEMONSTRATIVO });
eq(tabela.linhas.filter(l => l.nivel === 0).map(l => [l.valor, l.total]), [['Receitas', 40000], ['Despesas', -100000]], 'Receitas antes de Despesas');
eq(tabela.totalGeral, -60000, 'total geral = resultado');
eq(registrosDoDemonstrativo({ ...base, regime: 'caixa' }).map(r => [r.ref?.id, r.campos.mes, r.centavos]), [['c1', '2026-11', 30000]], 'caixa: pela data da baixa, só o que se moveu');
eq(registrosDoDemonstrativo({ ...base, de: '2026-11-01', ate: '2026-11-30' }).map(r => r.ref?.id), ['c2'], 'período');

console.log('--- rateio ---');
const rateado = registrosDoDemonstrativo({ ...base, usarRateio: true }).filter(r => r.ref?.id === 'p1');
eq(rateado.map(r => [r.campos.centro, r.centavos]), [['SP', -50000], ['RJ', -30000], [SEM_CENTRO, -20000]], 'rateio pelos centros, sobra sem centro');
eq(rateado.reduce((s, r) => s + r.centavos, 0), -100000, 'rateio não perde centavo');
eq(ratearCentavos(1000, [{ centro_custo: 'A', percentual: 33.33 }, { centro_custo: 'B', percentual: 33.33 }, { centro_custo: 'C', percentual: 33.34 }]).map(p => p.centavos), [333, 333, 334], '100%: o resto vai para o último');
eq(ratearCentavos(1000, []), [], 'sem rateio, nada');

console.log('--- CSV ---');
const perigoso = registrosDoDemonstrativo({ ...base, receber: [cr({ id: 'z', categoria_id: '', cliente_nome: '=HYPERLINK("x")', valor_final: 1.5, data_vencimento: '2026-10-01' })], pagar: [] });
const csv = csvDoDemonstrativo(montarTabelaDinamica(perigoso, ['pessoa'], ['mes']));
eq(csv.startsWith('﻿"Pessoa";"out/2026";"Total"'), true, 'cabeçalho com BOM e ;');
eq(csv.includes(`"'=HYPERLINK(""x"")";"1,50";"1,50"`), true, 'fórmula neutralizada, número em formato brasileiro');
eq(csvDoDemonstrativo(montarTabelaDinamica(sem, ['tipo'], [])).includes('"Despesas";"-1000,00";"-1000,00"'), true, 'número negativo sai como número, não como texto');
eq(rotuloDoValor('mes', '2026-01'), 'jan/2026', 'rótulo do mês');

console.log(`\n${total - falhas}/${total} testes da tabela dinâmica passaram`);
if (falhas) process.exit(1);
