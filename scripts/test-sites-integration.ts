import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { lerEnvelopeSites, verificarAssinaturaSites } from '../src/lib/sites-integration.ts';

const agora = Date.UTC(2026, 9, 25, 12, 0, 0);
const t = Math.floor(agora / 1000);
const segredo = 'whsec_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const evento = {
  id: 'd0d9a84c-ccdf-48aa-9c1a-4a2cd933954c', tipo: 'pagamento.recebido', versaoDoEsquema: 1,
  criadoEm: '2026-10-25T12:00:00.000Z', empresaId: 42,
  agregado: { tipo: 'pedido', id: '123', versao: 3 },
  dados: { pedidoId: 123, pedidoCodigo: 'ET-123', pagamentoId: 99, valorCentavos: 25000, moeda: 'BRL' },
};
const corpo = JSON.stringify(evento);
const assinatura = `t=${t},v1=${createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex')}`;

assert.equal(verificarAssinaturaSites(corpo, assinatura, segredo, agora), true);
assert.equal(verificarAssinaturaSites(corpo + ' ', assinatura, segredo, agora), false);
assert.equal(verificarAssinaturaSites(corpo, assinatura, 'outro-segredo', agora), false);
assert.equal(verificarAssinaturaSites(corpo, assinatura, segredo, agora + 301_000), false);
assert.equal(verificarAssinaturaSites(corpo, 't=0,v1=abc', segredo, agora), false);
assert.deepEqual(lerEnvelopeSites(evento, 42), evento);
assert.equal(lerEnvelopeSites(evento, 43), null);
assert.equal(lerEnvelopeSites({ ...evento, dados: { teste: true } }, 42), null);
assert.equal(lerEnvelopeSites({ ...evento, tipo: 'lead.recebido' }, 42), null);
assert.equal(lerEnvelopeSites({ ...evento, versaoDoEsquema: 99 }, 42), null);

console.log('PASS EnturOS Sites: assinatura, replay, tenant e envelope');
