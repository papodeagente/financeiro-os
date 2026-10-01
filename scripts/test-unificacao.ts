/**
 * Unificação do recebimento (src/lib/plataformas/unificacao.ts): o pagamento
 * da plataforma consome as contas pendentes da venda do CRM.
 *
 * O que estes testes guardam: nenhum real some, nenhum real dobra, e o que
 * já foi recebido nunca é tocado.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-unificacao.ts
 */
import { planoDeUnificacao, descreverPlano, carimbo } from '../src/lib/plataformas/unificacao.ts';
import { round2 } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}
const fmt = (v: number) => `R$ ${v.toFixed(2)}`;
const conta = (id: string, valor: number, venc: string, status = 'PENDENTE', extra: Record<string, unknown> = {}) =>
  ({ id, valor_final: valor, data_vencimento: venc, status, ...extra });

{ // pagamento igual à venda: tudo substituído, nada sobra
  const p = planoDeUnificacao([conta('a', 5000, '2026-10-05'), conta('b', 5000, '2026-11-05')], 10000);
  eq(p.acoes.map(a => a.acao), ['CANCELAR', 'CANCELAR'], 'as duas contas são substituídas');
  eq([p.consumido, p.restante, p.excedente], [10000, 0, 0], 'consumiu tudo, nada resta, nada excede');
}
{ // entrada de 50% pela plataforma: a primeira some, a segunda fica
  const p = planoDeUnificacao([conta('a', 5000, '2026-10-05'), conta('b', 5000, '2026-11-05')], 5000);
  eq(p.acoes, [{ id: 'a', acao: 'CANCELAR', valor_original: 5000 }], 'só a parcela mais antiga é substituída');
  eq(p.restante, 5000, 'a segunda continua a receber');
}
{ // pagamento que cai no meio de uma parcela: reduz ao que falta
  const p = planoDeUnificacao([conta('a', 6000, '2026-10-05'), conta('b', 4000, '2026-11-05')], 7500);
  eq(p.acoes, [
    { id: 'a', acao: 'CANCELAR', valor_original: 6000 },
    { id: 'b', acao: 'REDUZIR', valor_original: 4000, valor_novo: 2500 },
  ], 'a primeira some, a segunda fica com os R$ 2.500 que faltam');
  eq([p.consumido, p.restante, p.excedente], [7500, 2500, 0], 'nenhum real some nem dobra');
  eq(round2(p.consumido + p.restante), 10000, 'consumido + restante = o que a venda previa');
}
{ // ORDEM é do vencimento, não da lista
  const p = planoDeUnificacao([conta('tarde', 5000, '2026-12-01'), conta('cedo', 5000, '2026-10-01')], 5000);
  eq(p.acoes[0].id, 'cedo', 'a parcela mais antiga é quitada primeiro');
}
{ // plataforma recebeu MAIS que a venda: o excesso é declarado, não escondido
  const p = planoDeUnificacao([conta('a', 8000, '2026-10-05')], 10000);
  eq(p.acoes.map(a => a.acao), ['CANCELAR'], 'a conta é substituída');
  eq(p.excedente, 2000, 'os R$ 2.000 a mais ficam declarados');
}
{ // o que já foi recebido NUNCA é tocado
  const p = planoDeUnificacao([
    conta('paga', 5000, '2026-09-05', 'RECEBIDO'),
    conta('parcial', 5000, '2026-10-05', 'PARCIAL'),
    conta('cancelada', 5000, '2026-10-05', 'CANCELADO'),
    conta('pendente', 5000, '2026-11-05'),
    conta('atrasada', 5000, '2026-08-05', 'ATRASADO'),
  ], 10000);
  eq(p.acoes.map(a => a.id), ['atrasada', 'pendente'], 'só pendente e atrasada entram; atrasada primeiro (vence antes)');
}
{ // conta que já é da plataforma não entra no plano
  const p = planoDeUnificacao([conta('plat', 5000, '2026-10-05', 'PENDENTE', { plataforma_transacao: 'tx-1' }), conta('crm', 5000, '2026-10-05')], 5000);
  eq(p.acoes.map(a => a.id), ['crm'], 'a conta da própria plataforma nunca é substituída por ela mesma');
}
{ // venda sem conta pendente: plano vazio, excedente inteiro
  const p = planoDeUnificacao([], 3000);
  eq([p.acoes, p.excedente, p.restante], [[], 3000, 0], 'nada a substituir; o recebimento fica como está');
}
{ // centavos
  const p = planoDeUnificacao([conta('a', 100.1, '2026-10-05'), conta('b', 0.05, '2026-10-06')], 100.12);
  eq(p.acoes, [
    { id: 'a', acao: 'CANCELAR', valor_original: 100.1 },
    { id: 'b', acao: 'REDUZIR', valor_original: 0.05, valor_novo: 0.03 },
  ], 'a conta fecha no centavo');
}
{ // a frase para a tela
  const p = planoDeUnificacao([conta('a', 6000, '2026-10-05'), conta('b', 4000, '2026-11-05')], 7500);
  eq(descreverPlano(p, 7500, fmt), 'R$ 7500.00 recebidos: 1 conta pendente da venda será substituída por este recebimento; uma conta terá o valor reduzido ao que ainda falta; ficam R$ 2500.00 a receber.', 'frase com os números');
  eq(descreverPlano(planoDeUnificacao([], 300), 300, fmt), 'R$ 300.00 recebidos: a venda não tem conta pendente para substituir; a plataforma recebeu R$ 300.00 além do que a venda previa.', 'sem conta pendente, diz isso');
}
{ // o carimbo guarda o que a conta era
  const c = carimbo({ id: 'b', acao: 'REDUZIR', valor_original: 4000, valor_novo: 2500 }, 'asaas', 'tx-9', 'PENDENTE');
  eq(c, { plataforma: 'asaas', id_transacao: 'tx-9', acao: 'REDUZIR', valor_original: 4000, status_original: 'PENDENTE' }, 'tudo que o desfazer precisa');
}
console.log(`\n${total - falhas}/${total} testes da unificação passaram`);
if (falhas > 0) process.exit(1);
