/**
 * Conciliação bancária (src/lib/conciliacao-plano.ts): o valor do banco é
 * fato, e o plano diz a que contas ele pertence.
 *
 * O que estes testes guardam: todo real do banco tem dono, nenhuma conta
 * recebe mais do que deve, conta já paga só ganha a prova, e a descrição
 * crua do banco vira um nome que a agência reconhece.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-conciliacao-plano.ts
 */
import {
  planoDaConciliacao, preSelecao, descreverPlanoDaConciliacao, contraparteDaDescricao, formaDaDescricao,
  categoriaPeloHistorico, pontuarCandidata, ordenarCandidatas, painelDoExtrato, mesesDoExtrato, emAberto,
  type ContaConciliavel,
} from '../src/lib/conciliacao-plano.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}
const fmt = (v: number) => `R$ ${v.toFixed(2)}`;
const cr = (id: string, valor: number, venc: string, status = 'PENDENTE', baixado: number | null = null, conta: string | null = null): ContaConciliavel =>
  ({ id, tipo: 'CONTA_RECEBER', status, valor_final: valor, valor_baixado: baixado, data_vencimento: venc, conta_bancaria_id: conta });
const cp = (id: string, valor: number, venc: string, status = 'PENDENTE', baixado: number | null = null): ContaConciliavel =>
  ({ id, tipo: 'CONTA_PAGAR', status, valor_final: valor, valor_baixado: baixado, data_vencimento: venc });

console.log('--- o plano ---');
{
  const p = planoDaConciliacao([cr('a', 1000, '2026-10-05')], 1000);
  eq([p.ok, p.passos.map(x => x.acao), p.sobra, p.falta], [true, ['BAIXAR'], 0, 0], 'valor igual: a conta fica recebida, nada sobra');
  eq((p.passos[0] as { status_novo: string }).status_novo, 'RECEBIDO', 'conta a receber quitada vira RECEBIDO');
}
{
  const p = planoDaConciliacao([cp('a', 497.19, '2026-10-05')], -497.19);
  eq([p.ok, (p.passos[0] as { status_novo: string }).status_novo, p.valor_extrato], [true, 'PAGO', 497.19], 'saída do banco quita conta a pagar como PAGO, valor em módulo');
}
{
  const p = planoDaConciliacao([cr('b', 1000, '2026-11-05'), cr('a', 1000, '2026-10-05')], 1500);
  eq(p.passos.map(x => `${x.id}:${x.acao}:${x.aplicado}`), ['a:BAIXAR:1000', 'b:PARCIAL:500'], 'duas parcelas: a mais antiga quita, a seguinte fica em parte');
  eq([p.ok, p.falta, p.sobra], [true, 500, 0], 'faltam 500 da segunda, nada do banco sobra');
  eq((p.passos[1] as { valor_baixado_novo: number }).valor_baixado_novo, 500, 'a parcial grava o que entrou');
}
{
  const p = planoDaConciliacao([cr('a', 1000, '2026-10-05', 'PARCIAL', 400)], 600);
  eq([p.ok, p.passos[0].acao, (p.passos[0] as { valor_baixado_novo: number }).valor_baixado_novo], [true, 'BAIXAR', 1000], 'parcial de 400 recebe os 600 que faltavam e quita, acumulando 1000');
}
{
  const p = planoDaConciliacao([cr('a', 1000, '2026-10-05')], 1200);
  eq([p.ok, p.motivo, p.sobra, p.aplicado], [false, 'SOBRA', 200, 1000], 'banco maior que a conta: recusa e diz quanto sobra');
}
{
  const p = planoDaConciliacao([cr('a', 1000, '2026-10-05')], 1000.004);
  eq(p.ok, true, 'diferença abaixo do centavo não trava');
}
{
  const p = planoDaConciliacao([cr('a', 1000, '2026-10-05'), cr('b', 1000, '2026-11-05')], 800);
  eq([p.ok, p.motivo, p.conta_do_motivo], [false, 'CONTA_SEM_VALOR', 'b'], 'conta escolhida que não recebe nada é apontada');
}
{
  const p = planoDaConciliacao([cp('a', 497.19, '2026-10-01', 'PAGO', 497.19)], -497.19);
  eq([p.ok, p.passos[0].acao, p.passos[0].aplicado], [true, 'VINCULAR', 497.19], 'conta já paga: só ganha a prova do banco');
}
{
  const p = planoDaConciliacao([cp('a', 500, '2026-10-01', 'PAGO', 500)], -497.19);
  eq([p.ok, p.motivo], [false, 'EXCEDE'], 'conta paga por valor maior que o do banco não pode ser esta');
}
{
  const p = planoDaConciliacao([cp('a', 300, '2026-10-01', 'PAGO', null), cp('b', 400, '2026-09-01')], -700);
  eq(p.passos.map(x => `${x.id}:${x.acao}`), ['a:VINCULAR', 'b:BAIXAR'], 'a já paga entra primeiro, a aberta depois, mesmo vencendo antes');
  eq(p.passos[0].aplicado, 300, 'PAGO sem valor_pago usa o valor_final');
}
{
  eq(planoDaConciliacao([cp('a', 100, '2026-10-01')], 100).motivo, 'TIPO_ERRADO', 'entrada não concilia com conta a pagar');
  eq(planoDaConciliacao([cr('a', 100, '2026-10-01')], -100).motivo, 'TIPO_ERRADO', 'saída não concilia com conta a receber');
  eq(planoDaConciliacao([cr('a', 100, '2026-10-01', 'CANCELADO')], 100).motivo, 'CANCELADA', 'cancelada não recebe baixa');
  eq(planoDaConciliacao([], 100).motivo, 'SEM_CONTA', 'sem conta escolhida não concilia');
}
{
  const p = planoDaConciliacao([cr('a', 1000, '2026-10-01', 'PARCIAL', 400, 'banco-x')], 600, 'banco-y');
  eq([p.ok, p.motivo], [false, 'OUTRA_CONTA_BANCARIA'], 'parcial baixada em outro banco não recebe o resto por este');
  eq(planoDaConciliacao([cr('a', 1000, '2026-10-01', 'PARCIAL', 400, 'banco-y')], 600, 'banco-y').ok, true, 'no mesmo banco, recebe');
}
{
  // Invariante: o que o plano aplica é exatamente o valor do banco, sempre que ok.
  let quebrou = 0;
  for (let v = 1; v <= 3000; v += 37.13) {
    const p = planoDaConciliacao([cr('a', 1000, '2026-10-01'), cr('b', 1000, '2026-11-01'), cr('c', 1000, '2026-12-01')], v);
    if (p.ok && Math.abs(p.passos.reduce((s, x) => s + x.aplicado, 0) - Math.round(v * 100) / 100) > 0.005) quebrou++;
    for (const x of p.passos) if (x.aplicado > 1000.001) quebrou++;
  }
  eq(quebrou, 0, 'invariante: soma aplicada = valor do banco, e nenhuma conta recebe além do valor dela');
}

console.log('--- pré-seleção ---');
{
  eq(preSelecao([cr('a', 1000, '2026-10-05'), cr('b', 497.19, '2026-11-05')], 497.19), ['b'], 'conta de valor igual é a escolhida, mesmo vencendo depois');
  eq(preSelecao([cr('b', 1000, '2026-11-05'), cr('a', 1000, '2026-10-05'), cr('c', 1000, '2026-12-05')], 1500), ['a', 'b'], 'senão, as abertas em ordem até cobrir');
  eq(preSelecao([cr('a', 1000, '2026-10-05', 'RECEBIDO', 1000)], 1000), ['a'], 'sem aberta, a já recebida de valor igual');
  eq(preSelecao([cr('a', 1000, '2026-10-05', 'CANCELADO')], 1000), [], 'cancelada nunca é pré-marcada');
  eq(emAberto(cr('a', 1000, '2026-10-05', 'PARCIAL', 250)), 750, 'em aberto da parcial desconta o já recebido');
}

console.log('--- a frase ---');
{
  const p = planoDaConciliacao([cr('a', 1000, '2026-10-05'), cr('b', 1000, '2026-11-05')], 1500);
  eq(descreverPlanoDaConciliacao(p, fmt, true), '1 conta fica recebida; 1 conta fica recebida em parte, faltando R$ 500.00.', 'diz o que acontece com cada conta');
  const s = planoDaConciliacao([cr('a', 1000, '2026-10-05')], 1200);
  eq(descreverPlanoDaConciliacao(s, fmt, true), 'Sobram R$ 200.00 do banco sem conta. Escolha mais uma conta ou crie uma nova para a diferença.', 'a recusa diz o que fazer');
  const v = planoDaConciliacao([cp('a', 80, '2026-10-01', 'PAGO', 80)], -80);
  eq(descreverPlanoDaConciliacao(v, fmt, false), '1 conta que já constava como paga ganha a prova do banco.', 'vínculo de conta paga tem frase própria');
}

console.log('--- a contraparte ---');
eq(contraparteDaDescricao('Pix enviado: "Cp :00360305-CEF MATRIZ"'), 'CEF Matriz', 'Pix enviado com código de conta');
eq(contraparteDaDescricao('Pix enviado: "Cp :60701190-RECEITA FEDERAL"'), 'Receita Federal', 'Receita Federal');
eq(contraparteDaDescricao('Pagamento de Titulo: "ITAU UNIBANCO HOLDING S.A."'), 'Itau Unibanco Holding S.A.', 'título com sigla S.A.');
eq(contraparteDaDescricao('Pix enviado: "Cp :60701190-PADARIA SABOR DE PAO"'), 'Padaria Sabor de Pao', 'preposição fica minúscula');
eq(contraparteDaDescricao('PIX RECEBIDO - MARIA DA SILVA'), 'Maria da Silva', 'Pix recebido sem aspas');
eq(contraparteDaDescricao('TED RECEBIDA JOAO PEREIRA'), 'Joao Pereira', 'TED recebida');
eq(contraparteDaDescricao('Pix enviado: "Cp :22467086-SOLUCOES ORCODE INOVA SIMPLES LS"'), 'Solucoes Orcode Inova Simples LS', 'sigla curta sem vogal fica maiúscula');
eq(contraparteDaDescricao('12345678'), '', 'só número não é nome');
eq(contraparteDaDescricao(''), '', 'vazio é vazio');
eq([formaDaDescricao('Pix enviado: "x"'), formaDaDescricao('Pagamento de Titulo: "x"'), formaDaDescricao('TED 123'), formaDaDescricao('Tarifa')], ['PIX', 'BOLETO', 'TED', ''], 'forma de pagamento lida da descrição');

console.log('--- a categoria pelo histórico ---');
{
  const hist = [
    { fornecedor_nome: 'Receita Federal', categoria_id: 'imp' },
    { fornecedor_nome: 'RECEITA FEDERAL', categoria_id: 'imp' },
    { fornecedor_nome: 'Receita Federal - DARF', categoria_id: 'outros' },
    { fornecedor_nome: 'Padaria', categoria_id: 'alim' },
    { fornecedor_nome: 'Receita Federal', categoria_id: 'canc', status: 'CANCELADO' },
  ];
  eq(categoriaPeloHistorico('Receita Federal', hist), 'imp', 'a categoria mais usada para o mesmo nome, sem acento nem caixa');
  eq(categoriaPeloHistorico('Ninguém', hist), '', 'nome sem histórico não inventa categoria');
  eq(categoriaPeloHistorico('', hist), '', 'sem contraparte, sem sugestão');
}

console.log('--- candidatas ---');
{
  const c = (chave: string, valor: number, data: string, nome: string) => ({ chave, valor, data, nomes: [nome] });
  eq(pontuarCandidata(c('a', 497.19, '2026-10-05', 'CEF Matriz'), -497.19, '2026-10-05', 'CEF Matriz'), 100, 'valor, nome e data iguais: 100');
  eq(pontuarCandidata(c('a', 100, '2025-01-01', 'Outro'), -497.19, '2026-10-05', 'CEF Matriz'), 0, 'nada em comum: 0');
  const ord = ordenarCandidatas([
    c('longe', 497.19, '2026-07-01', 'Outro'),
    c('nome', 300, '2026-10-04', 'CEF Matriz'),
    c('certa', 497.19, '2026-10-04', 'CEF Matriz'),
  ], -497.19, '2026-10-05', 'CEF Matriz');
  eq(ord.map(x => x.chave), ['certa', 'longe', 'nome'], 'valor igual vem antes de nome parecido; os dois juntos vencem');
}

console.log('--- o painel ---');
{
  const p = painelDoExtrato([
    { data: '2026-10-05', valor: 1000, status_conciliacao: 'CONCILIADO' },
    { data: '2026-10-01', valor: -497.19, status_conciliacao: 'PENDENTE' },
    { data: '2026-10-03', valor: -0.1, status_conciliacao: 'IGNORADO' },
    { data: '2026-10-04', valor: -0.2, status_conciliacao: 'DIVERGENTE' },
    { data: '2026-10-02', valor: 0.1, status_conciliacao: 'PENDENTE' },
  ]);
  eq([p.de, p.ate], ['2026-10-01', '2026-10-05'], 'o período é o das linhas');
  eq([p.entrou, p.saiu, p.resultado], [1000.1, 497.49, 502.61], 'entrou, saiu e o resultado, sem erro de float');
  eq([p.creditos, p.debitos, p.linhas], [2, 3, 5], 'contagem de créditos e débitos');
  eq([p.conferidas, p.a_conferir, p.a_conferir_valor, p.pct_conferido], [2, 3, 497.49, 40], 'ignorada conta como resolvida; divergente ainda não');
  const v = painelDoExtrato([]);
  eq([v.entrou, v.saiu, v.pct_conferido, v.de], [0, 0, 0, ''], 'extrato vazio não divide por zero');
  eq(mesesDoExtrato([{ data: '2026-09-30' }, { data: '2026-10-01' }, { data: '2026-10-05' }]), ['2026-10', '2026-09'], 'meses do mais recente ao mais antigo');
}

console.log(`\n${total - falhas}/${total} testes da conciliação passaram`);
if (falhas > 0) process.exit(1);
