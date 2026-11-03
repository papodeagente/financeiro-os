import assert from 'node:assert/strict';
import { projetarMovimentoSites, projetarReservaSites } from '../src/lib/sites-ledger.ts';
import type { EnvelopeSites } from '../src/lib/sites-integration.ts';

const evento = (tipo: string, dados: Record<string, unknown>, versao = 1): EnvelopeSites => ({
  id: `d0d9a84c-ccdf-48aa-9c1a-4a2cd93395${String(versao).padStart(2, '0')}`,
  tipo, versaoDoEsquema: 1, criadoEm: `2026-10-25T12:0${versao}:00.000Z`, empresaId: 42,
  agregado: { tipo: tipo.startsWith('reserva.') ? 'reserva' : 'pedido', id: tipo.startsWith('reserva.') ? '7' : '123', versao },
  dados: { pedidoId: 123, pedidoCodigo: 'ET-123', ...dados },
});

const reserva = projetarReservaSites(evento('reserva.confirmada', {
  reservaId: 7, numero: 19, totalCentavos: 50000, moeda: 'BRL', servicoId: 3,
}, 2));
assert.deepEqual(reserva && {
  id: reserva.reservaId, pedido: reserva.pedidoCodigo, versao: reserva.versao,
  situacao: reserva.situacao, total: reserva.totalCentavos,
}, { id: '7', pedido: 'ET-123', versao: 2, situacao: 'confirmada', total: 50000 });
assert.equal(projetarReservaSites(evento('reserva.cancelada', { reservaId: 7, parcial: false }, 3))?.totalCentavos, 0);

const pagamento = projetarMovimentoSites(evento('pagamento.recebido', {
  pagamentoId: 88, valorCentavos: 30000, taxaCentavos: 900, moeda: 'BRL',
}));
assert.deepEqual(pagamento && {
  chave: pagamento.chaveNatural, categoria: pagamento.categoria, valor: pagamento.valorCentavos,
  taxa: pagamento.taxaCentavos, liquido: pagamento.liquidoCentavos, efetivo: pagamento.efetivo,
}, { chave: 'pagamento:88', categoria: 'recebimento', valor: 30000, taxa: 900, liquido: 29100, efetivo: true });

const quitacao = projetarMovimentoSites(evento('saldo.pago', { pagamentoId: 88, valorCentavos: 30000 }));
assert.equal(quitacao?.efetivo, false, 'saldo.pago não duplica o pagamento recebido');
const taxa = projetarMovimentoSites(evento('taxa.ajustada', { pagamentoId: 88, finalCentavos: 700 }));
assert.deepEqual([taxa?.chaveNatural, taxa?.valorCentavos], ['taxa:88', 700]);
const reembolso = projetarMovimentoSites(evento('reembolso.efetuado', { reembolsoId: 5, valorCentavos: 4000 }));
assert.deepEqual([reembolso?.categoria, reembolso?.estado, reembolso?.efetivo], ['reembolso', 'efetuado', true]);
const reembolsoPendente = projetarMovimentoSites(evento('reembolso.emitido', { reembolsoId: 5, valorCentavos: 4000 }));
assert.equal(reembolsoPendente?.chaveNatural, reembolso?.chaveNatural, 'o ciclo do reembolso atualiza um único movimento');
const disputaAberta = projetarMovimentoSites(evento('disputa.aberta', { disputa: 'dp_1', valorCentavos: 4000 }));
const disputaEncerrada = projetarMovimentoSites(evento('disputa.encerrada', { disputa: 'dp_1', valorCentavos: 4000, resultado: 'ganha' }));
assert.equal(disputaAberta?.chaveNatural, disputaEncerrada?.chaveNatural, 'o ciclo da disputa atualiza um único movimento');
assert.equal(projetarMovimentoSites(evento('reserva.confirmada', { reservaId: 7 })), null);

console.log('PASS EnturOS Sites: projeção idempotente de reserva e movimentos');
