/**
 * Aba Histórico (06/11/2026, E7): regra pura de historico-do-registro.ts.
 * Rótulos legíveis, ruído escondido, antes → depois no formato da tela,
 * criação resumida e exclusão/restauração reconhecidas.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-historico-do-registro.ts
 */
import {
  ENTIDADES_DO_HISTORICO, VAZIO, campoDe, ehRuido, entidadeDoHistorico, eventosDoHistorico, formatarValor,
  quandoEmTexto, referenciasCitadas, rotuloDoCampo,
} from '../src/lib/historico-do-registro.ts';
import type { LogAuditoria } from '../src/lib/crm-types.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
// Espaço sem quebra do Intl ("R$ 1.234,56") normalizado para comparar.
const n = (s: string) => s.replace(/ /g, ' ');

console.log('--- Entidades ---');
eq(Object.keys(ENTIDADES_DO_HISTORICO).sort(), ['centros_custo', 'clientes', 'contas_bancarias', 'contas_pagar', 'contas_receber', 'faturas_fornecedor', 'formas_pagamento', 'fornecedor_acordos', 'fornecedores_crm', 'plano_contas'], 'lista fechada (com acordos e faturas do fornecedor, E7 frente D)');
eq([entidadeDoHistorico('fornecedor_acordos')?.grupo, entidadeDoHistorico('faturas_fornecedor')?.grupo], ['financeiro', 'financeiro'], 'acordo e fatura do fornecedor: financeiro');
eq([rotuloDoCampo('fornecedor_acordos', 'comissao_percentual'), rotuloDoCampo('faturas_fornecedor', 'valor_centavos'), rotuloDoCampo('faturas_fornecedor', 'vencimento')],
  ['Comissão', 'Valor a pagar', 'Vencimento'], 'rótulos do acordo e da fatura do fornecedor');
eq(entidadeDoHistorico('usuarios'), null, 'tabela fora da lista: nada');
eq(entidadeDoHistorico('toString'), null, 'nome de propriedade do objeto não passa');
eq(entidadeDoHistorico('contas_pagar')?.grupo, 'financeiro', 'título é do financeiro');
eq(entidadeDoHistorico('clientes')?.grupo, 'cadastro', 'cliente é cadastro');

console.log('--- Rótulos ---');
eq(rotuloDoCampo('contas_pagar', 'data.data_vencimento'), 'Vencimento', 'vencimento');
eq(rotuloDoCampo('contas_receber', 'data.valor_final'), 'Valor', 'valor');
eq(rotuloDoCampo('contas_pagar', 'status'), 'Situação', 'coluna status');
eq(rotuloDoCampo('contas_bancarias', 'data.titular'), 'Titular', 'titular da conta bancária');
eq(rotuloDoCampo('formas_pagamento', 'taxa_fixa_centavos'), 'Taxa fixa', 'coluna da forma');
eq(rotuloDoCampo('contas_pagar', 'data.campos_personalizados.numero_do_pedido'), 'Campo personalizado: Numero do pedido', 'campo personalizado');
eq(rotuloDoCampo('contas_pagar', 'data.algo_novo'), 'Algo novo', 'desconhecido: por extenso');

console.log('--- Ruído ---');
for (const c of ['updated_at', 'created_at', 'tenant_id', 'id', 'data._versao', 'data._status_lido', 'data.updated_at',
  'data.fornecedor_id', 'data.origem_venda_id', 'data.saldo_atual', 'data.serie_id', 'atualizado_em', 'data.cadastrado_por']) {
  eq(ehRuido(c), true, `${c} escondido`);
}
for (const c of ['data.valor_final', 'data.descricao', 'status', 'data.categoria_id', 'nome']) eq(ehRuido(c), false, `${c} aparece`);

console.log('--- Formatação antes → depois ---');
eq(n(formatarValor('contas_pagar', 'data.valor_final', '1234.5')), 'R$ 1.234,50', 'dinheiro em R$');
eq(n(formatarValor('formas_pagamento', 'taxa_fixa_centavos', '350')), 'R$ 3,50', 'centavos em R$');
eq(formatarValor('contas_pagar', 'data.data_vencimento', '2026-11-30'), '30/11/2026', 'data dd/mm/aaaa');
eq(formatarValor('contas_bancarias', 'data.ativo', 'false'), 'Não', 'booleano Não');
eq(formatarValor('contas_bancarias', 'data.ativo', 'true'), 'Sim', 'booleano Sim');
eq(formatarValor('contas_pagar', 'data.status', 'PENDENTE'), 'Em aberto', 'situação em aberto');
eq(formatarValor('contas_receber', 'data.status', 'PARCIAL'), 'Recebido em parte', 'receber em parte');
eq(formatarValor('contas_pagar', 'data.status', 'PARCIAL'), 'Pago em parte', 'pagar em parte');
eq(formatarValor('contas_pagar', 'data.descricao', ''), VAZIO, 'vazio');
eq(formatarValor('contas_pagar', 'data.descricao', null), VAZIO, 'nulo é vazio');
eq(formatarValor('contas_bancarias', 'data.tipo', 'CORRENTE'), 'Conta corrente', 'tipo da conta');
eq(formatarValor('formas_pagamento', 'taxa_pct', '2.5'), '2,5%', 'percentual');
eq(formatarValor('contas_pagar', 'data.rateio', '[{"a":1},{"b":2}]'), 'dividida em 2 partes', 'rateio resumido');
const nomes = new Map([['categoria:cat-1', '2.1 · Aluguel'], ['conta:b1', 'Inter']]);
eq(formatarValor('contas_pagar', 'data.categoria_id', 'cat-1', nomes), '2.1 · Aluguel', 'categoria pelo nome');
eq(formatarValor('contas_pagar', 'data.conta_bancaria_id', 'b1', nomes), 'Inter', 'conta pelo nome');
eq(formatarValor('contas_pagar', 'data.categoria_id', 'sumiu', nomes), 'cadastro removido', 'referência sem cadastro');
eq(campoDe('contas_pagar', 'data.categoria_id').ref, 'categoria', 'categoria é referência');

console.log('--- Eventos ---');
const log = (id: string, acao: LogAuditoria['acao'], ts: string, alteracoes: LogAuditoria['alteracoes'], quem = 'Ana'): LogAuditoria => ({
  id, timestamp: ts, usuario_id: 'u1', usuario_nome: quem, perfil: 'ADMIN', acao, modulo: 'Financeiro',
  entidade: 'contas_pagar', entidade_id: 't1', descricao: '', origem: 'USUARIO', alteracoes,
});
const logs = [
  log('a1', 'CRIAR', '2026-11-06T12:00:00.000Z', [
    { campo: 'id', valor_anterior: '', valor_novo: 't1' },
    { campo: 'status', valor_anterior: '', valor_novo: 'PENDENTE' },
    { campo: 'data.status', valor_anterior: '', valor_novo: 'PENDENTE' },
    { campo: 'data.valor_final', valor_anterior: '', valor_novo: '100' },
    { campo: 'data.descricao', valor_anterior: '', valor_novo: 'Aluguel' },
    { campo: 'data.observacoes', valor_anterior: '', valor_novo: 'nota longa' },
  ]),
  log('a2', 'EDITAR', '2026-11-06T13:00:00.000Z', [
    { campo: 'data.valor_final', valor_anterior: '100', valor_novo: '150' },
    { campo: 'data.categoria_id', valor_anterior: '', valor_novo: 'cat-1' },
    { campo: 'data._versao', valor_anterior: '1', valor_novo: '2' },
  ], 'Bruno'),
  log('a3', 'EDITAR', '2026-11-06T13:30:00.000Z', [{ campo: 'data.saldo_atual', valor_anterior: '1', valor_novo: '2' }]),
  log('a4', 'EXCLUIR', '2026-11-06T14:00:00.000Z', []),
  log('a5', 'CRIAR', '2026-11-06T15:00:00.000Z', [{ campo: 'data.valor_final', valor_anterior: '', valor_novo: '150' }]),
];
const ev = eventosDoHistorico('contas_pagar', [...logs].reverse(), nomes);
eq(ev.map(e => e.tipo), ['restaurou', 'excluiu', 'alterou', 'criou'], 'mais novo primeiro; gravação só técnica some; criação depois da exclusão = restauração');
eq(ev[0].titulo, 'Restaurou a conta a pagar', 'título da restauração');
eq(ev[0].alteracoes, [], 'restauração sem lista de campos');
eq(ev[1].titulo, 'Excluiu a conta a pagar', 'título da exclusão');
eq(ev[2].quem, 'Bruno', 'quem alterou');
eq(ev[2].titulo, 'Alterou 2 campos', 'quantos campos mudaram');
eq(ev[2].alteracoes.map(a => [a.rotulo, n(a.antes), n(a.depois)]), [
  ['Valor', 'R$ 100,00', 'R$ 150,00'], ['Categoria', VAZIO, '2.1 · Aluguel'],
], 'antes → depois legível, sem _versao');
eq(ev[3].alteracoes.map(a => a.rotulo), ['Descrição', 'Valor', 'Situação'], 'criação: só o resumo, na ordem, situação uma vez só');
eq(ev[3].origem, 'pela tela', 'origem legível');
eq(quandoEmTexto('2026-11-06T15:05:00.000Z'), '06/11/2026 às 12:05', 'horário de Brasília');
eq(referenciasCitadas('contas_pagar', logs), { categoria: ['cat-1'], centro: [], conta: [] }, 'ids para buscar o nome');

console.log(`\n${total - falhas}/${total} testes do histórico passaram`);
if (falhas) process.exit(1);
