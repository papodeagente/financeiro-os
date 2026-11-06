/**
 * E7, frente C: DRE e fluxo de caixa por centro de custo e por tag.
 *  (a) congelado: sem recorte, o DRE recebe as mesmas listas e o caderno é o de sempre;
 *  (b) recorte do DRE por tag (sem acento, com centro, venda sem conta fica fora);
 *  (c) resultado por tag (competência × caixa, várias tags, sem tag);
 *  (d) fluxo: recorte das contas e visão por centro (rateio, pai pega filhos) e por tag.
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-dre-fluxo-dimensoes.ts
 */
import { aplicarRecorteDRE, chaveDaTag, contaTemTag, fracaoNoRecorte, recorteVazio } from '../src/lib/dre-recorte.ts';
import { lancamentosDoCaixa, montarCaderno, periodoQueContem } from '../src/lib/caderno-caixa.ts';
import {
  ROTULO_SEM_CENTRO, SEM_CENTRO, SEM_TAG, fluxoPorDimensao, recortarContasDoFluxo, recorteDoFluxoVazio, resultadoPorTag, tagsDasContas,
} from '../src/lib/resultado-por-dimensao.ts';
import type { ContaPagar, ContaReceber } from '../src/lib/crm-types.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const cr = (id: string, o: Record<string, unknown>) => ({ id, status: 'PENDENTE', valor_final: 0, taxa: 0, ...o }) as unknown as ContaReceber;
const cp = (id: string, o: Record<string, unknown>) => ({ id, status: 'PENDENTE', valor_final: 0, ...o }) as unknown as ContaPagar;

const centros = [
  { id: 'sp', nome: 'São Paulo', codigo: '1' },
  { id: 'sp-a', nome: 'Loja Paulista', codigo: '1.1', centro_pai_id: 'sp' },
  { id: 'rj', nome: 'Rio', codigo: '2' },
];

const receber = [
  cr('r1', { valor_final: 1000, data_vencimento: '2026-10-05', centro_custo_id: 'sp', tags: ['Corporativo'] }),
  cr('r2', { valor_final: 600, valor_recebido: 600, status: 'RECEBIDO', data_vencimento: '2026-10-10', data_recebimento: '2026-10-12', centro_custo_id: 'rj', tags: ['Lazer', 'corporativo'] }),
  cr('r3', { valor_final: 400, data_vencimento: '2026-10-20', centro_custo_id: 'sp-a' }),
  cr('r4', { valor_final: 300, data_vencimento: '2026-10-21', centro_custo_id: 'sp', tags: ['Promoção'], status: 'CANCELADO' }),
];
const pagar = [
  // Aluguel rateado 60% SP (filho) / 40% RJ, com a tag "Promoção" sem acento.
  cp('p1', {
    valor_final: 500, valor_pago: 500, status: 'PAGO', data_vencimento: '2026-10-08', data_pagamento: '2026-10-08', tags: ['promocao'],
    rateio: [{ centro_custo_id: 'sp-a', percentual: 60 }, { centro_custo_id: 'rj', percentual: 40 }],
  }),
  cp('p2', { valor_final: 200, data_vencimento: '2026-11-03', centro_custo_id: 'sp' }),
];

console.log('--- (a) Congelado: sem recorte nada muda ---');
const vendas = [{ id: 'v1', valor_final: 1000, valor_total_custo: 800, centro_custo: 'São Paulo' }];
eq(recorteVazio({ centro_id: null, rateio: 'todas', tag: '' }), true, 'recorte com tag vazia continua vazio');
eq(recorteVazio({ tag: '  ' }), true, 'tag só com espaço é vazia');
const semRecorte = aplicarRecorteDRE({ receber, pagar, vendas }, { centro_id: null, rateio: 'todas', tag: null }, centros);
eq(semRecorte.receber, receber, 'DRE sem recorte: contas a receber idênticas');
eq(semRecorte.pagar, pagar, 'DRE sem recorte: contas a pagar idênticas');
eq(semRecorte.vendas, vendas, 'DRE sem recorte: vendas idênticas');
eq(recorteDoFluxoVazio({ centro_id: '', tag: '' }), true, 'fluxo sem recorte');
const recFluxoVazio = recortarContasDoFluxo({ receber, pagar }, null, centros);
eq([recFluxoVazio.receber, recFluxoVazio.pagar], [receber, pagar], 'fluxo sem recorte: as mesmas listas');
const periodo = periodoQueContem('mes', '2026-10-15');
const lanc = lancamentosDoCaixa({ receber, pagar, hoje: '2026-10-15' });
const caderno = montarCaderno({ lancamentos: lanc, contas: [{ saldo_inicial: 100 }], periodo, agrupamento: 'mes', hoje: '2026-10-15' });
eq([caderno.saldoInicial, caderno.entradas, caderno.saidas, caderno.saldoFinal], [100, 2000, 500, 1600], 'caderno de outubro (o de sempre)');

console.log('--- (b) DRE por tag ---');
eq(chaveDaTag('  Promoção '), 'promocao', 'tag comparável: sem acento nem maiúscula');
eq(contaTemTag({ tags: ['promocao'] }, 'Promoção'), true, 'tag sem acento casa com a com acento');
eq(contaTemTag({ tags: [] }, 'Corporativo'), false, 'conta sem tag não casa');
eq(fracaoNoRecorte(receber[0], { tag: 'corporativo' }, centros, 'receber'), 1, 'conta com a tag entra inteira');
eq(fracaoNoRecorte(receber[2], { tag: 'corporativo' }, centros, 'receber'), 0, 'conta sem a tag fica fora');
eq(fracaoNoRecorte(pagar[0], { tag: 'Promoção', centro_id: 'sp' }, centros, 'pagar'), 0.6, 'tag com centro: a parte do centro (pai pega o filho)');
eq(fracaoNoRecorte(pagar[0], { tag: 'Promoção', rateio: 'sem_rateio' }, centros, 'pagar'), 0, 'tag com "sem rateio": fora');
const porTag = aplicarRecorteDRE({ receber, pagar, vendas: [...vendas, { id: 'v2', valor_final: 50, valor_total_custo: 10, centro_custo: 'Rio' }] }, { tag: 'Corporativo' }, centros);
eq(porTag.receber.map(c => c.id), ['r1', 'r2'], 'DRE com tag: só as contas a receber com a tag');
eq(porTag.pagar.map(c => c.id), [], 'DRE com tag: nenhuma conta a pagar com a tag');
eq(porTag.vendas.map(v => v.id), [], 'venda sem conta a receber fica fora quando há tag');
const vendaComConta = aplicarRecorteDRE({
  receber: [cr('rv', { valor_final: 100, origem_venda_id: 'v1', tags: ['Corporativo'] })], pagar: [], vendas,
}, { tag: 'corporativo' }, centros);
eq(vendaComConta.vendas.map(v => [v.id, v.valor_final]), [['v1', 1000]], 'venda com conta a receber com a tag entra');

console.log('--- (c) Resultado por tag ---');
eq(tagsDasContas(receber, pagar).map(t => t.valor), ['Corporativo', 'Lazer', 'Promoção'], 'opções do filtro: uma por grafia, em ordem');
const comp = resultadoPorTag({ receber, pagar, meses: ['2026-10'], regime: 'competencia' });
eq(comp.linhas.map(l => [l.rotulo, l.entradas, l.saidas, l.resultado, l.titulos]), [
  ['Corporativo', 1600, 0, 1600, 2], ['Lazer', 600, 0, 600, 1], ['Promoção', 0, 500, -500, 1], ['Sem tag', 400, 0, 400, 1],
], 'competência: pelo vencimento, cancelada fora, "Sem tag" no fim, várias tags contam em cada uma');
eq(comp.totais, { entradas: 2000, saidas: 500, resultado: 1500 }, 'totais: cada título uma vez');
eq(comp.com_varias_tags, 1, 'um título com duas tags');
const cx = resultadoPorTag({ receber, pagar, meses: ['2026-10'], regime: 'caixa' });
eq(cx.linhas.map(l => [l.rotulo, l.entradas, l.saidas]), [['Corporativo', 600, 0], ['Lazer', 600, 0], ['Promoção', 0, 500]], 'caixa: só o que se moveu, pela data da baixa');
eq(resultadoPorTag({ receber, pagar, meses: ['2026-11'], regime: 'competencia' }).linhas.map(l => [l.chave, l.saidas]), [[SEM_TAG, 200]], 'outro mês: só o que vence nele');

console.log('--- (d) Fluxo por centro e por tag ---');
const fCentro = fluxoPorDimensao({ lancamentos: lanc, receber, pagar, periodo, dimensao: 'centro', centros });
eq(fCentro.linhas.map(l => [l.chave, l.nivel, l.entrou, l.saiu, l.a_entrar, l.a_sair, l.resultado]), [
  ['sp', 0, 0, 0, 1000, 0, 1000], ['sp-a', 1, 0, 300, 400, 0, 100], ['rj', 0, 600, 200, 0, 0, 400],
], 'por centro: árvore com recuo, rateio 60/40 na saída paga');
eq([fCentro.totais.entrou + fCentro.totais.a_entrar, fCentro.totais.saiu + fCentro.totais.a_sair], [caderno.entradas, caderno.saidas], 'sem recorte, a soma bate com o caderno');
const comFolha = lancamentosDoCaixa({ receber, pagar, hoje: '2026-10-15', folha: [{ descricao: 'Folha', valor: 50, data_pagamento: '2026-10-30', competencia: '2026-10' }] });
const fFolha = fluxoPorDimensao({ lancamentos: comFolha, receber, pagar, periodo, dimensao: 'centro', centros });
eq(fFolha.linhas.find(l => l.chave === SEM_CENTRO)?.rotulo, ROTULO_SEM_CENTRO, 'folha sem lançar: "Sem centro de custo"');
eq(fFolha.linhas.find(l => l.chave === SEM_CENTRO)?.a_sair, 50, 'folha: a sair');
const fSp = fluxoPorDimensao({ lancamentos: comFolha, receber, pagar, periodo, dimensao: 'centro', centros, recorte: { centro_id: 'sp' } });
eq(fSp.linhas.map(l => l.chave), ['sp', 'sp-a'], 'recorte por centro: o centro e os de baixo; folha fora');
const fTag = fluxoPorDimensao({ lancamentos: lanc, receber, pagar, periodo, dimensao: 'tag', centros });
eq(fTag.linhas.map(l => [l.rotulo, l.entrou, l.saiu, l.a_entrar]), [
  ['Corporativo', 600, 0, 1000], ['Lazer', 600, 0, 0], ['Promoção', 0, 500, 0], ['Sem tag', 0, 0, 400],
], 'por tag: cada tag com o título inteiro');
eq([fTag.totais.entrou, fTag.totais.a_entrar, fTag.com_varias_tags], [600, 1400, 1], 'totais por tag sem contar duas vezes');
const fTagSp = fluxoPorDimensao({ lancamentos: lanc, receber, pagar, periodo, dimensao: 'tag', centros, recorte: { centro_id: 'sp', tag: 'PROMOÇÃO' } });
eq(fTagSp.linhas.map(l => [l.rotulo, l.saiu]), [['Promoção', 300]], 'tag + centro: só a parte do centro da conta com a tag');
const rec = recortarContasDoFluxo({ receber, pagar }, { centro_id: 'rj' }, centros);
eq([rec.receber.map(c => c.id), rec.pagar.map(c => [c.id, c.valor_final, c.valor_pago])], [['r2'], [['p1', 200, 200]]], 'contas do recorte: a parte do centro (valor e pago)');
const lancRj = lancamentosDoCaixa({ ...rec, hoje: '2026-10-15' }).filter(l => l.data >= periodo.inicio);
const cadRj = montarCaderno({ lancamentos: lancRj, contas: [], periodo, agrupamento: 'mes', hoje: '2026-10-15' });
eq([cadRj.saldoInicial, cadRj.entradas, cadRj.saidas, cadRj.saldoFinal], [0, 600, 200, 400], 'caderno do recorte começa em zero e acumula o resultado');

console.log(`\n${total - falhas}/${total} testes de DRE e fluxo por centro e tag passaram`);
if (falhas) process.exit(1);
