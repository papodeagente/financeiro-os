/**
 * Lançamento de contas a pagar e a receber (06/11/2026, E7), lógica pura:
 *  1. CONGELADO: o rateio de antes continua igual (fecha 100%, centavos,
 *     linha sem centro e sem categoria recusada, repetida recusada).
 *  2. Várias categorias no mesmo título SEM exigir centro.
 *  3. Emissão nunca depois do vencimento nem da liquidação.
 *  4. Aviso (não bloqueio) de vencimento em sábado, domingo ou feriado.
 *  5. Conta prevista: a do título, senão a padrão; o fluxo por conta usa
 *     ela no que está em aberto, e o que já se moveu continua pela conta da
 *     baixa (a regra de antes).
 *  6. Conta que nasceu de venda: o id da venda que trava pessoa/valor/vencimento.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-lancamento-titulo.ts
 */
import { validarRateio, dimensoesDoLancamento } from '../src/lib/dimensoes.ts';
import {
  avisoDeDiaNaoUtil, conferirEmissao, conferirEmissaoDaConta, contaPrevistaDoTitulo, vendaQueTravaATitulo,
} from '../src/lib/lancamento-titulo.ts';
import { contaDoTitulo, titulosDaConta } from '../src/lib/fluxo-comparativo.ts';
import { soma } from '../src/lib/money.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}
const erroDe = (r: { ok: boolean; erro?: string }) => (r.ok ? null : r.erro);

console.log('--- 1. rateio de antes, congelado ---');
{
  const r = validarRateio(100, [
    { centro_custo_id: 'sp', percentual: 33.34 }, { centro_custo_id: 'rj', percentual: 33.33 }, { centro_custo_id: 'bh', percentual: 33.33 },
  ]);
  eq(r.ok && r.linhas.map(l => l.valor), [33.34, 33.33, 33.33], 'três centros fecham 100% em centavos');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: 'a', percentual: 60 }])), 'O rateio soma 60%. Faltam 40% para fechar 100%.', 'abaixo de 100% recusado');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: '', percentual: 100 }])), 'Escolha o centro de custo da linha 1 do rateio.', 'linha sem centro e sem categoria continua recusada, com a mesma frase');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: 'a', percentual: 50 }, { centro_custo_id: 'a', percentual: 50 }])), 'A linha 2 repete centro e categoria de outra linha. Junte as duas.', 'centro repetido recusado, mesma frase');
  eq(validarRateio(100, []), { ok: true, linhas: [] }, 'vazio = centro único');
}

console.log('--- 2. várias categorias, centro opcional ---');
{
  const r = validarRateio(1000, [
    { centro_custo_id: '', categoria_id: 'hosp', percentual: 70 },
    { centro_custo_id: '', categoria_id: 'taxa', percentual: 30 },
  ]);
  eq(r.ok, true, 'duas categorias sem centro passam');
  if (r.ok) {
    eq(r.linhas.map(l => [l.centro_custo_id, l.categoria_id, l.valor]), [['', 'hosp', 700], ['', 'taxa', 300]], 'cada linha guarda a categoria e o valor em centavos');
    eq(soma(r.linhas.map(l => l.valor)), 1000, 'o total fecha');
  }
  eq(erroDe(validarRateio(100, [{ centro_custo_id: '', categoria_id: 'x', percentual: 60 }])), 'O rateio soma 60%. Faltam 40% para fechar 100%.', 'sem centro, o total ainda precisa fechar 100%');
  eq(erroDe(validarRateio(100, [{ centro_custo_id: '', categoria_id: 'x', percentual: 50 }, { centro_custo_id: '', categoria_id: 'x', percentual: 50 }])),
    'A linha 2 repete a categoria de outra linha sem centro. Junte as duas.', 'mesma categoria sem centro duas vezes é recusada');
  eq(validarRateio(100, [{ centro_custo_id: 'sp', categoria_id: 'x', percentual: 50 }, { centro_custo_id: '', categoria_id: 'y', percentual: 50 }]).ok, true, 'mistura linha com centro e linha só com categoria');
  const d = dimensoesDoLancamento({ valor_final: 1000, status: 'PENDENTE', categoria_id: 'geral', valor_pago: 0, rateio: [
    { centro_custo_id: '', categoria_id: 'hosp', percentual: 70 }, { centro_custo_id: '', categoria_id: 'taxa', percentual: 30 },
  ] }, { lado: 'pagar' });
  eq(d.fatias.map(f => [f.categoria_id, f.centro_custo_id, f.valor]), [['hosp', '', 700], ['taxa', '', 300]], 'relatórios leem as fatias por categoria, sem centro');
}

console.log('--- 3. emissão ---');
{
  eq(conferirEmissao({ emissao: '2026-11-01', vencimento: '2026-11-10' }), null, 'emissão antes do vencimento passa');
  eq(conferirEmissao({ emissao: '2026-11-10', vencimento: '2026-11-10' }), null, 'emissão no dia do vencimento passa');
  eq(conferirEmissao({ emissao: '2026-11-11', vencimento: '2026-11-10' }), 'A emissão (11/11/2026) ficou depois do vencimento (10/11/2026). Corrija uma das duas datas.', 'emissão depois do vencimento é recusada');
  eq(conferirEmissao({ emissao: '2026-11-05', vencimento: '2026-11-10', liquidacao: '2026-11-03' }), 'A emissão (05/11/2026) ficou depois da data em que a conta foi liquidada (03/11/2026).', 'emissão depois da liquidação é recusada');
  eq(conferirEmissao({ emissao: '', vencimento: '2026-11-10' }), null, 'conta antiga sem emissão: nada a conferir');
  eq(conferirEmissao({ emissao: '2026-13-45x', vencimento: '2026-11-10' }), 'A data de emissão é inválida.', 'emissão que não é data é recusada');
  eq(conferirEmissaoDaConta('contas_pagar', { data_emissao: '2026-11-08', data_vencimento: '2026-11-20', data_pagamento: '2026-11-07' }) !== null, true, 'servidor: a pagar usa data_pagamento como liquidação');
  eq(conferirEmissaoDaConta('contas_receber', { data_emissao: '2026-11-08', data_vencimento: '2026-11-20', data_pagamento: '2026-11-07' }), null, 'servidor: a receber ignora data_pagamento');
  eq(conferirEmissaoDaConta('contas_receber', { data_emissao: '2026-11-08', data_vencimento: '2026-11-20', data_recebimento: '2026-11-07T10:00:00' }) !== null, true, 'servidor: a receber usa data_recebimento (com hora)');
}

console.log('--- 4. aviso de dia não útil ---');
{
  eq(avisoDeDiaNaoUtil('2026-11-06'), null, 'sexta-feira comum: sem aviso');
  const sab = avisoDeDiaNaoUtil('2026-11-07');
  eq(sab && [sab.motivo, sab.proximo, sab.mensagem], ['sábado', '2026-11-09', 'Este vencimento cai num sábado. O primeiro dia útil depois é 09/11/2026.'], 'sábado sugere a segunda');
  const dom = avisoDeDiaNaoUtil('2026-11-08');
  eq(dom && dom.proximo, '2026-11-09', 'domingo sugere a segunda');
  const natal = avisoDeDiaNaoUtil('2026-12-25');
  eq(natal && [natal.motivo, natal.proximo], ['Natal', '2026-12-28'], 'Natal numa sexta pula o fim de semana');
  eq(natal?.mensagem, 'Este vencimento cai no feriado de Natal. O primeiro dia útil depois é 28/12/2026.', 'feriado diz o nome');
  eq(avisoDeDiaNaoUtil(''), null, 'sem vencimento: sem aviso');
}

console.log('--- 5. conta prevista e fluxo por conta ---');
{
  eq(contaPrevistaDoTitulo({ conta_previsao_id: 'itau' }, 'inter'), 'itau', 'a do título vence a padrão');
  eq(contaPrevistaDoTitulo({}, 'inter'), 'inter', 'sem a do título, a padrão');
  eq(contaPrevistaDoTitulo({ conta_previsao_id: '' }, null), null, 'sem nenhuma: null');

  const aberta = { status: 'PENDENTE', valor_final: 100, conta_bancaria_id: null, conta_previsao_id: 'itau' };
  eq(contaDoTitulo(aberta, 'pagar', 'cx', 'inter'), 'itau', 'em aberto: vale a conta prevista do título');
  eq(contaDoTitulo({ ...aberta, conta_previsao_id: null }, 'pagar', 'cx', 'inter'), 'inter', 'em aberto sem prevista: a padrão da agência');
  eq(contaDoTitulo({ ...aberta, conta_previsao_id: null }, 'pagar', 'cx', null), null, 'sem padrão: como antes, nenhuma');
  eq(contaDoTitulo({ ...aberta, conta_previsao_id: null, conta_bancaria_id: 'b1' }, 'pagar', 'cx', 'inter'), 'b1', 'em aberto com conta escolhida e sem prevista: a escolhida, como antes');
  const paga = { status: 'PAGO', valor_final: 100, valor_pago: 100, conta_bancaria_id: 'b1', conta_previsao_id: 'itau' };
  eq(contaDoTitulo(paga, 'pagar', 'cx', 'inter'), 'b1', 'o que já se moveu vale pela conta da baixa, não pela prevista');
  eq(contaDoTitulo({ ...paga, conta_bancaria_id: null }, 'pagar', 'cx', 'inter'), 'cx', 'baixa sem conta continua na Caixa Geral');

  const pagar = [
    { id: 'p1', status: 'PENDENTE', valor_final: 100, valor_pago: 0, conta_bancaria_id: null, conta_previsao_id: 'itau', data_vencimento: '2026-11-10' },
    { id: 'p2', status: 'PENDENTE', valor_final: 50, valor_pago: 0, conta_bancaria_id: null, data_vencimento: '2026-11-10' },
  ] as never[];
  const semPadrao = titulosDaConta({ receber: [], pagar, filtro: { contaId: 'itau', caixaGeralId: 'cx' } });
  eq([semPadrao.pagar.map((t: { id: string }) => t.id), semPadrao.semConta], [['p1'], { quantidade: 1, valor: 50 }], 'conta Itaú: só a prevista nela; a sem conta fica de fora e contada');
  const comPadrao = titulosDaConta({ receber: [], pagar, filtro: { contaId: 'inter', caixaGeralId: 'cx', contaPrevisaoPadraoId: 'inter' } });
  eq([comPadrao.pagar.map((t: { id: string }) => t.id), comPadrao.semConta], [['p2'], { quantidade: 0, valor: 0 }], 'conta padrão: recebe a previsão sem conta');
  const todas = titulosDaConta({ receber: [], pagar, filtro: { contaId: null, contaPrevisaoPadraoId: 'inter' } });
  eq(todas.pagar.length, 2, 'todas as contas: as listas intactas, como antes');
}

console.log('--- 6. conta da venda ---');
{
  eq(vendaQueTravaATitulo({ origem_venda_id: 'v-9' }), 'v-9', 'nasceu da venda: trava pela venda');
  eq(vendaQueTravaATitulo({ origem_venda_id: '' }), null, 'sem venda: livre');
  eq(vendaQueTravaATitulo(undefined), null, 'sem conta: livre');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
