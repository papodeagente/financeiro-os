/**
 * O retrato do cliente (src/lib/perfil-do-cliente.ts).
 *
 * POR QUE ESTES TESTES IMPORTAM. Uma tela de perfil é onde números de várias
 * partes do sistema se encontram pela primeira vez, e é onde eles podem
 * passar a discordar entre si sem ninguém notar:
 *
 *  1. Se o "pago" do perfil não sair dos MESMOS helpers do contas a receber,
 *     o cliente aparece devendo um valor na ficha e outro na lista.
 *  2. Se ausência virar zero, cliente novo ganha "ticket médio R$ 0,00" e
 *     "comprou há 0 dias" — duas afirmações falsas sobre quem nunca comprou.
 *  3. Se cancelado continuar contando, o volume do cliente infla com venda
 *     que deixou de existir.
 *
 * Roda com: node --experimental-strip-types scripts/test-perfil-do-cliente.ts
 */
import {
  ehCompra, ehNegociacao, montarPerfilDoCliente, tempoDesdeAUltimaCompra,
} from '../src/lib/perfil-do-cliente.ts';
import { valorRealizado } from '../src/lib/resultado-financeiro.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const HOJE = '2026-10-06';

console.log('--- o que conta como compra ---');
eq(ehCompra({ status: 'CONFIRMADO' }), true, 'confirmado é compra');
eq(ehCompra({ status: 'CONCLUIDO' }), true, 'concluído é compra');
eq(ehCompra({ status: 'ORCAMENTO' }), false, 'orçamento ainda é conversa');
eq(ehCompra({ status: 'RESERVADO' }), false, 'reservado ainda é conversa');
eq(ehCompra({ status: 'CANCELADO' }), false, 'cancelado não é compra');
eq(ehCompra({ status: 'confirmado' }), true, 'caixa baixa também conta');
eq(ehNegociacao({ status: 'CANCELADO' }), true, 'cancelada ainda FOI uma negociação');
eq(ehNegociacao({ status: '' }), false, 'sem status não é negociação');

console.log('--- cliente que nunca comprou: ausência, não zero ---');
const novo = montarPerfilDoCliente({ vendas: [], contas: [], notas: [], hoje: HOJE });
eq(novo.negociacoes, 0, 'nenhuma negociação');
eq(novo.compras, 0, 'nenhuma compra');
eq(novo.volume_comprado, 0, 'volume zero é fato: não comprou nada');
// Estes três são o ponto: média e tempo de coisa nenhuma não são zero.
eq(novo.ticket_medio, null, 'ticket médio é null, não R$ 0,00');
eq(novo.taxa_de_conversao, null, 'conversão é null, não 0%');
eq(novo.dias_desde_a_ultima_compra, null, 'dias desde a última é null, não 0');
eq(novo.ultima_compra, null, 'sem data de última compra');
eq(novo.primeira_compra, null, 'sem data de primeira compra');

console.log('--- um cliente de verdade ---');
const perfil = montarPerfilDoCliente({
  vendas: [
    { id: 'v1', status: 'CONCLUIDO',  data_venda: '2025-03-10', valor_final: 8000 },
    { id: 'v2', status: 'CONFIRMADO', data_venda: '2026-09-20', valor_final: 12000 },
    { id: 'v3', status: 'ORCAMENTO',  data_venda: '2026-10-01', valor_final: 5000 },
    { id: 'v4', status: 'CANCELADO',  data_venda: '2026-02-02', valor_final: 99000 },
  ],
  contas: [
    { status: 'RECEBIDO', valor_final: 8000,  valor_recebido: 8000, data_vencimento: '2025-03-20' },
    { status: 'PARCIAL',  valor_final: 12000, valor_recebido: 5000, data_vencimento: '2026-09-30' },
    { status: 'CANCELADO', valor_final: 4000, valor_recebido: 0,    data_vencimento: '2026-01-01' },
  ],
  notas: [
    { id: 'n1', status: 'AUTORIZADA', valor_servicos: 8000 },
    { id: 'n2', status: 'CANCELADO',  valor_servicos: 99000 },
  ],
  hoje: HOJE,
});

eq(perfil.negociacoes, 4, 'as quatro contam como negociação, inclusive a cancelada');
eq(perfil.compras, 2, 'só confirmado e concluído são compra');
eq(perfil.taxa_de_conversao, 50, '2 de 4 = 50%');
// A cancelada de R$ 99.000 NÃO pode entrar no volume.
eq(perfil.volume_comprado, 20000, 'volume soma só as compras');
eq(perfil.ticket_medio, 10000, 'ticket médio é volume ÷ compras');
eq(perfil.primeira_compra, '2025-03-10', 'primeira compra');
eq(perfil.ultima_compra, '2026-09-20', 'última compra');
eq(perfil.dias_desde_a_ultima_compra, 16, 'dias desde a última compra');

console.log('--- o dinheiro vem dos helpers canônicos ---');
eq(perfil.pago, 13000, 'pago = 8000 quitado + 5000 da parcial');
eq(perfil.em_aberto, 7000, 'em aberto = o que falta da parcial');
// A conta CANCELADA não entra em nenhum dos dois.
eq(perfil.pago + perfil.em_aberto, 20000, 'pago + aberto fecha com o volume das compras');
// Prova de que é o MESMO cálculo do contas a receber, e não uma cópia:
eq(
  perfil.pago,
  valorRealizado({ status: 'RECEBIDO', valor_final: 8000, valor_recebido: 8000 }, 'valor_recebido')
  + valorRealizado({ status: 'PARCIAL', valor_final: 12000, valor_recebido: 5000 }, 'valor_recebido'),
  'o pago bate com valorRealizado() somado linha a linha',
);

console.log('--- vencido é o aberto cujo prazo passou ---');
const comAtraso = montarPerfilDoCliente({
  vendas: [],
  contas: [
    { status: 'PENDENTE', valor_final: 1000, valor_recebido: 0, data_vencimento: '2026-09-01' },
    { status: 'PENDENTE', valor_final: 3000, valor_recebido: 0, data_vencimento: '2026-12-01' },
    // Vence HOJE: ainda não está vencida.
    { status: 'PENDENTE', valor_final: 500,  valor_recebido: 0, data_vencimento: HOJE },
    // Já paga e vencida: não deve nada.
    { status: 'RECEBIDO', valor_final: 700,  valor_recebido: 700, data_vencimento: '2026-01-01' },
  ],
  notas: [], hoje: HOJE,
});
eq(comAtraso.vencido, 1000, 'só a que passou do prazo e tem saldo');
eq(comAtraso.em_aberto, 4500, 'em aberto inclui a que ainda vai vencer');

console.log('--- notas: cancelada não foi emitida ---');
eq(perfil.notas_emitidas, 1, 'a cancelada não conta');
eq(perfil.valor_em_notas, 8000, 'nem soma valor');

console.log('--- data mal formada não vira compra fantasma ---');
const datasTortas = montarPerfilDoCliente({
  vendas: [
    { status: 'CONFIRMADO', data_venda: '10/03/2025', valor_final: 1000 },
    { status: 'CONFIRMADO', data_venda: '', valor_final: 2000 },
  ],
  contas: [], notas: [], hoje: HOJE,
});
eq(datasTortas.compras, 2, 'as compras contam mesmo sem data legível');
eq(datasTortas.volume_comprado, 3000, 'e o volume também');
// O que NÃO pode acontecer é inventar uma data a partir de lixo.
eq(datasTortas.ultima_compra, null, 'data fora do formato não vira última compra');
eq(datasTortas.dias_desde_a_ultima_compra, null, 'nem tempo decorrido');

console.log('--- o tempo em linguagem de gente ---');
eq(tempoDesdeAUltimaCompra(null), 'Nunca comprou', 'nunca');
eq(tempoDesdeAUltimaCompra(0), 'Comprou hoje', 'hoje');
eq(tempoDesdeAUltimaCompra(1), 'Comprou ontem', 'ontem');
eq(tempoDesdeAUltimaCompra(16), 'Comprou há 16 dias', 'dias');
eq(tempoDesdeAUltimaCompra(29), 'Comprou há 29 dias', 'ainda em dias');
eq(tempoDesdeAUltimaCompra(30), 'Comprou há 1 mês', 'um mês no singular');
eq(tempoDesdeAUltimaCompra(90), 'Comprou há 3 meses', 'meses');
eq(tempoDesdeAUltimaCompra(365), 'Comprou há 1 ano', 'um ano exato, sem "e 0 meses"');
eq(tempoDesdeAUltimaCompra(428), 'Comprou há 1 ano e 2 meses', 'ano e meses');
eq(tempoDesdeAUltimaCompra(760), 'Comprou há 2 anos e 1 mês', 'plural de ano, singular de mês');

console.log(`\n${total - falhas}/${total} testes do perfil do cliente passaram`);
if (falhas > 0) process.exit(1);
