/**
 * Cancelamento, reembolso e crédito do cliente (E5, parte D), lógica pura:
 * o cancelamento no modelo (passageiro e produto, multa, as três escolhas),
 * a ordem em que o que deixou de ser devido sai dos pagamentos, a multa
 * sugerida pela política, o estorno da comissão, reaplicar sobre a venda que
 * chega de novo do CRM, e a carteira (uso parcial, validade, devolução).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-cancelamento.ts
 */
import { normalizarVenda, totaisDaVenda, totaisDoProduto, TIPOS_COMPONENTE_DA_TELA } from '../src/lib/venda-modelo.ts';
import { receitaDaVenda } from '../src/lib/venda-receita.ts';
import { contasDaVenda } from '../src/lib/venda-contas.ts';
import {
  desfazerNoModelo, normalizarPedidoDeCancelamento, planejarCancelamento, planoDoEstornoDeComissao, reaplicarCancelamentos, sugerirMulta, normalizarPolitica,
} from '../src/lib/cancelamento.ts';
import {
  creditosParaAvisar, creditosParaVencer, extratoDoCliente, planoDeDevolucao, planoDeUso, saldoDoCliente, situacaoEm, type Credito,
} from '../src/lib/credito-cliente.ts';

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

const HOJE = '2026-11-05';
const venda = normalizarVenda({
  id: 'v1', numero: 'VND-0001', data_venda: '2026-11-01', cliente: { id: 'cli', nome: 'Ana Lima' },
  produtos: [
    {
      id: 'h1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f-h', nome: 'Hotel Mar' }, data_inicio: '2026-12-20',
      passageiros: [{ id: 'a', nome: 'Ana', tarifa_centavos: 100000 }, { id: 'b', nome: 'Bia', tarifa_centavos: 100000 }],
      componentes: [
        { id: 'ca', tipo: 'COMISSAO', valor_centavos: 10000, passageiro_id: 'a' }, { id: 'cb', tipo: 'COMISSAO', valor_centavos: 10000, passageiro_id: 'b' },
        { id: 'ra', tipo: 'RAV', valor_centavos: 3000, passageiro_id: 'a' }, { id: 'rb', tipo: 'RAV', valor_centavos: 3000, passageiro_id: 'b' },
      ],
    },
    { id: 's1', tipo: 'SEGURO', descricao: 'Seguro', fornecedor: { id: 'f-s', nome: 'Seguradora' }, quantidade: 1, valor_unitario_centavos: 20000, componentes: [{ id: 'cs', tipo: 'COMISSAO', valor_centavos: 4000 }] },
  ],
  pagamentos: [
    { id: 'pix', forma: 'PIX', valor_centavos: 106000 },
    { id: 'bol', forma: 'BOLETO', valor_centavos: 100000, parcelas: 2 },
    { id: 'cre', forma: 'CREDITO_CLIENTE', valor_centavos: 20000 },
  ],
}).venda;
const t0 = totaisDaVenda(venda);
eq([t0.valor_cliente, t0.valor_fornecedor, t0.saldo_sem_forma], [226000, 196000, 0], 'venda de partida: 2.260 do cliente, 1.960 ao fornecedor');

console.log('--- Pedido ---');
let p = normalizarPedidoDeCancelamento({ data: '2026-10-01', motivo: 'x', itens: [] }, venda, HOJE);
eq(p.erros.map(e => e.campo), ['data', 'motivo', 'itens'], 'data antes da venda, sem motivo e sem item: recusado');
p = normalizarPedidoDeCancelamento({ data: HOJE, motivo: 'Cliente desistiu', itens: [{ produto_id: 'h1', passageiro_ids: ['a', 'b'] }] }, venda, HOJE);
eq([p.erros.length, p.pedido.itens[0].passageiro_ids, p.pedido.sobra, p.pedido.prazo_reembolso], [0, null, 'reembolso', '2026-11-12'], 'todos os passageiros = produto inteiro; sobra padrão é reembolso em 7 dias');

console.log('--- Um passageiro, zerando os dois lados, com multa ---');
const pedA = normalizarPedidoDeCancelamento({
  data: HOJE, motivo: 'Ana adoeceu', itens: [{ produto_id: 'h1', passageiro_ids: ['a'] }],
  multas: [{ produto_id: 'h1', fornecedor_centavos: 10000, cliente_centavos: 15000 }],
  zerar_fornecedor: true, zerar_cliente: true,
}, venda, HOJE).pedido;
const planoA = planejarCancelamento(venda, pedA, { livre: { bol: 100000, pix: 0 }, credito_nao_usado: { cre: 0 } }, 'c1');
const hA = planoA.venda.produtos[0];
eq([hA.passageiros.map(x => !!x.cancelado_em), hA.cancelado_em], [[true, false], null], 'só a Ana sai; o produto continua');
eq(planoA.produtos[0], {
  ...planoA.produtos[0], valor_cliente: 103000, valor_fornecedor: 90000, multa_fornecedor: 10000, multa_cliente: 15000, retido_cliente: 15000, retido_fornecedor: 10000,
  sai_do_cliente_brl: 88000, sai_do_fornecedor_brl: 80000,
}, 'parte da Ana: 1.030 do cliente e 900 do fornecedor; ficam a multa do cliente (150) e a do fornecedor (100)');
eq(hA.componentes.filter(c => c.tipo === 'COBRADO_NO_CANCELAMENTO' || c.tipo === 'RETIDO_PELO_FORNECEDOR').map(c => [c.id, c.valor_centavos]), [['cx:c1:h1:cli', 15000], ['cx:c1:h1:forn', 10000]], 'o que continua valendo vira componente do cancelamento');
const tA = totaisDoProduto(hA);
eq([tA.valor_cliente, tA.valor_fornecedor, tA.receita_bruta], [118000, 100000, 18000], 'hotel depois: 1.180 do cliente, 1.000 ao fornecedor, receita 180');
eq(planoA.reducoes, [{ pagamento_id: 'bol', forma: 'BOLETO', faixa: 'em_aberto', centavos: 88000 }], 'o que deixou de ser devido sai primeiro do boleto em aberto');
eq([planoA.venda.pagamentos.find(g => g.id === 'bol')!.valor_centavos, totaisDaVenda(planoA.venda).saldo_sem_forma, planoA.sobra_prevista_centavos], [12000, 0, 0], 'boleto vira 120 e a venda fecha sem sobra');
const contasA = contasDaVenda({ versao: 2, venda: planoA.venda, hoje: HOJE });
eq(contasA.contas_pagar.map(c => [c.fornecedor_nome, c.valor_final]), [['Hotel Mar', 1000], ['Seguradora', 160]], 'gerador de sempre: hotel deve 1.000 (900 da Bia + 100 de multa)');
const recA = receitaDaVenda(planoA.venda);
eq(recA.linhas.filter(l => l.tipo === 'COBRADO_NO_CANCELAMENTO' || l.tipo === 'RETIDO_PELO_FORNECEDOR').map(l => [l.tipo, l.valor, l.sinal]), [['COBRADO_NO_CANCELAMENTO', 15000, 1], ['RETIDO_PELO_FORNECEDOR', 10000, -1]], 'a receita mostra a multa aberta');
eq(TIPOS_COMPONENTE_DA_TELA.includes('RETIDO_PELO_FORNECEDOR' as never), false, 'a tela não oferece os componentes do cancelamento');

console.log('--- Sem zerar: os dois continuam devendo tudo ---');
const pedB = { ...pedA, zerar_cliente: false, zerar_fornecedor: false };
const planoB = planejarCancelamento(venda, pedB, { livre: { bol: 100000 }, credito_nao_usado: {} }, 'c2');
const tB = totaisDaVenda(planoB.venda);
eq([tB.valor_cliente, tB.valor_fornecedor, planoB.reducoes.length], [226000, 196000, 0], 'manter os saldos: nenhuma conta muda');

console.log('--- Só o fornecedor zerado ---');
const planoC = planejarCancelamento(venda, { ...pedA, zerar_cliente: false }, { livre: { bol: 100000 }, credito_nao_usado: {} }, 'c3');
eq([totaisDaVenda(planoC.venda).valor_cliente, totaisDaVenda(planoC.venda).valor_fornecedor, planoC.reducoes.length], [226000, 116000, 0], 'cliente segue devendo tudo; a agência deve ao hotel só a multa pela Ana');

console.log('--- Ordem de saída dos pagamentos ---');
const pedTudo = normalizarPedidoDeCancelamento({ data: HOJE, motivo: 'Viagem cancelada', itens: [{ produto_id: 'h1', passageiro_ids: null }, { produto_id: 's1' }], zerar_cliente: true, zerar_fornecedor: true, sobra: 'credito' }, venda, HOJE).pedido;
const planoT = planejarCancelamento(venda, pedTudo, { livre: { bol: 50000 }, credito_nao_usado: { cre: 5000 } }, 'c4');
eq(planoT.reducoes.map(r => [r.pagamento_id, r.faixa, r.centavos]), [
  ['bol', 'em_aberto', 50000], ['cre', 'credito_nao_usado', 5000], ['bol', 'ja_recebido', 50000], ['pix', 'ja_recebido', 106000], ['cre', 'credito_usado', 15000],
], 'em aberto → crédito não usado → já recebido (sobra) → crédito usado (volta à carteira)');
eq([planoT.sobra_prevista_centavos, planoT.credito_devolvido_centavos, planoT.todos_cancelados, planoT.venda.pagamentos.length], [156000, 15000, true, 0], 'tudo cancelado sem multa: sobra 1.560 e 150 de crédito voltam');

console.log('--- Fornecedor cobra direto ---');
const vF = normalizarVenda({ ...venda, produtos: [{ ...venda.produtos[1], quem_cobra: 'FORNECEDOR' }], pagamentos: [] }).venda;
const planoF = planejarCancelamento(vF, normalizarPedidoDeCancelamento({ data: HOJE, motivo: 'Desistiu', itens: [{ produto_id: 's1' }], zerar_cliente: true, zerar_fornecedor: true, multas: [{ produto_id: 's1', fornecedor_centavos: 1000 }] }, vF, HOJE).pedido, { livre: {}, credito_nao_usado: {} }, 'c5');
eq([planoF.produtos[0].retido_cliente, planoF.produtos[0].retido_fornecedor, planoF.avisos.map(a => a.codigo)], [0, 0, ['COBRADO_PELO_FORNECEDOR']], 'cobrado pelo fornecedor: a multa é entre eles; sai a comissão');
eq(contasDaVenda({ versao: 2, venda: planoF.venda, hoje: HOJE }).contas_receber.length, 0, 'e a comissão a receber some');

console.log('--- Multa maior que a parte cancelada ---');
const planoX = planejarCancelamento(venda, { ...pedA, multas: [{ produto_id: 'h1', fornecedor_centavos: 99999999, cliente_centavos: null }] }, { livre: {}, credito_nao_usado: {} }, 'c6');
eq(planoX.erros.length > 0, true, 'multa acima do valor: recusada');

console.log('--- Multa sugerida ---');
const hotel = venda.produtos[0];
eq(sugerirMulta(hotel, 90000, HOJE, null).origem, 'sem_politica', 'sem política: a pessoa digita');
const comReserva = { ...hotel, detalhes: { multa_cancelamento: '250,00', multa_a_partir_de: '2026-12-01' } };
eq(sugerirMulta(comReserva, 90000, '2026-11-20', null).centavos, 0, 'reserva: antes do prazo, sem multa');
eq(sugerirMulta(comReserva, 90000, '2026-12-05', null).centavos, 25000, 'reserva: depois do prazo, a multa dela');
eq(sugerirMulta({ ...hotel, detalhes: { multa_percentual: '20' } }, 90000, HOJE, null).centavos, 18000, 'reserva com percentual');
const politica = normalizarPolitica({ faixas: [{ dias_antes: 30, percentual: 10 }, { dias_antes: 7, percentual: 50 }, { dias_antes: 0, percentual: 100 }] });
eq([sugerirMulta(hotel, 90000, '2026-11-05', politica).centavos, sugerirMulta(hotel, 90000, '2026-11-25', politica).centavos, sugerirMulta(hotel, 90000, '2026-12-15', politica).centavos, sugerirMulta(hotel, 90000, '2026-12-20', politica).centavos],
  [0, 9000, 45000, 90000], 'política do fornecedor por dias antes do início: 45 dias = 0; 25 = 10%; 5 = 50%; no dia = 100%');

console.log('--- Comissão do vendedor ---');
const com = [
  { id: 'k1', status: 'CALCULADA', valor_comissao: 26, valor_base: 260, vendedor_nome: 'Vera' },
  { id: 'k2', status: 'PAGA', valor_comissao: 18, valor_base: 180, vendedor_nome: 'Vera' },
  { id: 'k3', status: 'CANCELADA', valor_comissao: 10, valor_base: 1, vendedor_nome: 'Vera' },
  { id: 'k4', status: 'CALCULADA', valor_comissao: 5, valor_base: 1, vendedor_nome: 'Vera', origem: 'mrr' },
];
eq(planoDoEstornoDeComissao(com, 26000, 18000, false).map(e => [e.comissao_id, e.acao, e.valor_depois, e.estorno]), [['k1', 'reduzir', 18, 8], ['k2', 'estornar_paga', 18, 5.54]], 'na proporção da receita: não paga cai; paga gera estorno');
eq(planoDoEstornoDeComissao(com, 26000, 0, false).map(e => e.acao), ['cancelar', 'estornar_paga'], 'receita zerada: a não paga é cancelada');
eq(planoDoEstornoDeComissao(com, 26000, 18000, true).every(e => e.acao === 'manter'), true, 'manter na meta: nada muda');

console.log('--- Reaplicar sobre a venda que chega de novo do CRM ---');
const gravado = { id: 'c1', data: HOJE, produtos: planoA.produtos, reducoes: planoA.reducoes };
const reenvio = reaplicarCancelamentos(venda, [gravado]);
eq([totaisDaVenda(reenvio).valor_cliente, totaisDaVenda(reenvio).saldo_sem_forma, reenvio.pagamentos.find(g => g.id === 'bol')!.valor_centavos], [138000, 0, 12000], 'a venda original + o cancelamento gravado = a venda cancelada');
const duas = reaplicarCancelamentos(reaplicarCancelamentos(venda, [gravado]), []);
eq(duas.produtos[0].componentes.length, reenvio.produtos[0].componentes.length, 'componente pelo id: não duplica');

console.log('--- Desfazer um cancelamento no modelo ---');
const igual = (v: typeof venda) => JSON.stringify([v.produtos.map(p => [p.cancelado_em, p.passageiros.map(x => x.cancelado_em), p.componentes.map(c => [c.id, c.valor_centavos])]), v.pagamentos.map(g => [g.id, g.forma, g.valor_centavos, g.parcelas])]);
const dA = desfazerNoModelo(planoA.venda, gravado, venda.pagamentos);
eq(igual(dA.venda), igual(venda), 'desfazer a Ana: a venda volta a ser a de antes');
eq([dA.produtos, dA.pagamentos], [[{ produto_id: 'h1', descricao: 'Hotel Mar', produto_inteiro: false, passageiros: ['Ana'] }], [{ pagamento_id: 'bol', forma: 'BOLETO', centavos: 88000, recriado: false }]], 'e diz quem voltou e o que voltou a cada pagamento');
const gravadoT = { id: 'c4', data: HOJE, produtos: planoT.produtos, reducoes: planoT.reducoes };
const dT = desfazerNoModelo(planoT.venda, gravadoT, venda.pagamentos);
eq([igual(dT.venda) === igual(venda), dT.pagamentos.map(g => [g.pagamento_id, g.centavos, g.recriado])], [true, [['bol', 100000, true], ['cre', 20000, true], ['pix', 106000, true]]], 'tudo cancelado: os pagamentos que sumiram voltam com os dados de antes, na ordem de antes');
const semAntes = desfazerNoModelo(planoT.venda, gravadoT);
eq(semAntes.venda.pagamentos.map(g => [g.id, g.forma, g.valor_centavos, g.parcelas]), [['bol', 'BOLETO', 100000, 1], ['cre', 'CREDITO_CLIENTE', 20000, 1], ['pix', 'PIX', 106000, 1]], 'sem os dados de antes (cancelamento antigo): volta com a forma e o valor');
const duasVezes = planejarCancelamento(planoA.venda, normalizarPedidoDeCancelamento({ data: HOJE, motivo: 'Bia também', itens: [{ produto_id: 'h1', passageiro_ids: ['b'] }], zerar_cliente: true, zerar_fornecedor: true }, planoA.venda, HOJE).pedido, { livre: { bol: 12000 }, credito_nao_usado: {} }, 'c7');
const dB = desfazerNoModelo(duasVezes.venda, { id: 'c7', data: HOJE, produtos: duasVezes.produtos, reducoes: duasVezes.reducoes }, planoA.venda.pagamentos);
eq([dB.venda.produtos[0].passageiros.map(x => !!x.cancelado_em), dB.venda.produtos[0].cancelado_em, dB.venda.produtos[0].componentes.filter(c => c.id.startsWith('cx:')).map(c => c.id)],
  [[true, false], null, ['cx:c1:h1:cli', 'cx:c1:h1:forn']], 'desfazer o segundo: a Bia volta e o produto também; o cancelamento da Ana continua');

console.log('--- Carteira de crédito ---');
const cred = (id: string, saldo: number, validade: string, origem_venda_id = '', criado_em = '2026-01-01'): Credito => ({
  id, cliente_id: 'cli', cliente_nome: 'Ana', origem: 'CANCELAMENTO', origem_venda_id, origem_venda_numero: '', valor_centavos: saldo, saldo_centavos: saldo, validade, situacao: 'ATIVO', descricao: '', criado_em,
});
const cs = [cred('x', 30000, '2027-06-01'), cred('y', 20000, '2026-12-01'), cred('z', 50000, ''), cred('v', 10000, '2026-10-01')];
eq(planoDeUso(cs, 40000, HOJE), { partes: [{ credito_id: 'y', valor_centavos: 20000 }, { credito_id: 'x', valor_centavos: 20000 }], usado: 40000, falta: 0 }, 'uso parcial: primeiro o que vence antes; o vencido não entra');
eq(planoDeUso(cs, 150000, HOJE).falta, 50000, 'falta o que a carteira não cobre');
eq(planoDeUso(cs, 10000, HOJE, { preferirVenda: 'VND-9' }).partes[0].credito_id, 'y', 'sem crédito daquela venda: segue a validade');
eq(planoDeUso([...cs, cred('w', 10000, '2027-12-01', 'VND-9')], 10000, HOJE, { preferirVenda: 'vnd-9' }).partes[0].credito_id, 'w', 'a venda de origem indicada vem primeiro');
eq(planoDeDevolucao([{ credito_id: 'y', usado_centavos: 20000, ordem: '1' }, { credito_id: 'x', usado_centavos: 20000, ordem: '2' }], 25000), [{ credito_id: 'x', valor_centavos: 20000 }, { credito_id: 'y', valor_centavos: 5000 }], 'devolução: do último uso para o primeiro');
eq(saldoDoCliente(cs, HOJE), { disponivel: 100000, vencendo: 20000, proxima_validade: '2026-12-01', creditos_ativos: 3 }, 'saldo: o vencido não conta; 200 vencem em 30 dias');
eq([situacaoEm(cs[3], HOJE), situacaoEm({ ...cs[0], saldo_centavos: 0 }, HOJE)], ['VENCIDO', 'USADO'], 'situação calculada');
eq(creditosParaVencer(cs, HOJE).map(c => c.id), ['v'], 'vence o que passou da validade');
eq(creditosParaAvisar([...cs.map(c => ({ ...c, avisado_em: null })), { ...cred('k', 1000, '2026-11-20'), avisado_em: '2026-11-01' }], HOJE).map(c => c.id), ['y'], 'avisa uma vez, só o que vence em 30 dias');
const ext = extratoDoCliente([
  { id: '2', credito_id: 'x', tipo: 'USO', valor_centavos: -1000, saldo_depois_centavos: 0, ref_tipo: '', ref_id: '', ref_chave: '', venda_id: '', descricao: '', usuario: '', criado_em: '2026-11-02' },
  { id: '1', credito_id: 'x', tipo: 'ENTRADA', valor_centavos: 3000, saldo_depois_centavos: 0, ref_tipo: '', ref_id: '', ref_chave: '', venda_id: '', descricao: '', usuario: '', criado_em: '2026-11-01' },
]);
eq(ext.map(l => [l.tipo, l.saldo_carteira_centavos]), [['ENTRADA', 3000], ['USO', 2000]], 'extrato em ordem, com o saldo acumulado');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
