import assert from 'node:assert/strict';
import { resumoDoPedidoSites, type LinhaSites } from '../src/lib/sites-resumo.ts';

const ev = (tipo: string, dados: Record<string, unknown>, versao: number, minuto: number): LinhaSites => ({
  tipo, dados, agregado_versao: versao, criado_em: `2026-10-25T12:${String(minuto).padStart(2, '0')}:00Z`,
});
const eventos = [
  ev('reserva.confirmada', { reservaId: 1, totalCentavos: 50000, moeda: 'BRL' }, 2, 2),
  ev('reserva.criada', { reservaId: 1, totalCentavos: 45000, moeda: 'BRL' }, 1, 1),
  ev('pagamento.recebido', { pagamentoId: 8, valorCentavos: 30000, taxaCentavos: 900, moeda: 'BRL' }, 1, 3),
  ev('pagamento.recebido', { pagamentoId: 8, valorCentavos: 30000, taxaCentavos: 900, moeda: 'BRL' }, 1, 3),
  ev('taxa.ajustada', { pagamentoId: 8, finalCentavos: 700 }, 1, 4),
  ev('reembolso.efetuado', { reembolsoId: 5, valorCentavos: 5000 }, 1, 5),
  ev('custo.registrado', { custoId: 10, realCentavos: 12000 }, 1, 6),
];
assert.deepEqual(resumoDoPedidoSites(eventos), {
  moedas: ['BRL'], totalReservadoCentavos: 50000, recebidoCentavos: 30000, reembolsadoCentavos: 5000,
  taxaCentavos: 700, custoCentavos: 12000, recebidoLiquidoCentavos: 24300, diferencaCentavos: 25000,
  quantidades: { reservas: 1, pagamentos: 1, reembolsos: 1, custos: 1 },
});
assert.equal(resumoDoPedidoSites([ev('pagamento.recebido', { pagamentoId: 1, valorCentavos: 1000 }, 1, 1)]).diferencaCentavos, null);
assert.equal(resumoDoPedidoSites([...eventos, ev('reserva.cancelada', { reservaId: 1, parcial: false }, 3, 7)]).totalReservadoCentavos, 0);
console.log('PASS EnturOS Sites: resumo por pedido, evento antigo, pagamento duplicado, taxa e reembolso');
