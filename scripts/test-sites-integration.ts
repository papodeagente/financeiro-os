import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { lerEnvelopeSites, verificarAssinaturaSites } from '../src/lib/sites-integration.ts';
import { isPublicBasePath } from '../src/lib/public-paths.ts';
import {
  limparRateLimitSitesParaTeste,
  origemDoWebhook,
  permitirWebhookSites,
} from '../src/lib/sites-webhook-rate-limit.ts';

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
assert.equal(lerEnvelopeSites({ ...evento, agregado: { tipo: '', id: '', versao: 1 } }, 42), null);
assert.equal(lerEnvelopeSites({ ...evento, agregado: { tipo: 'pedido', id: '1', versao: 2_147_483_648 } }, 42), null);
assert.equal(lerEnvelopeSites({ ...evento, tipo: 'reserva.confirmada', dados: {} }, 42), null);
assert.equal(lerEnvelopeSites({ ...evento, tipo: 'pagamento.recebido', dados: { pagamentoId: 9 } }, 42), null);
assert.equal(lerEnvelopeSites({ ...evento, tipo: 'pagamento.recebido', dados: { pagamentoId: 9, valorCentavos: 1000, moeda: 'BRL' } }, 42)?.tipo, 'pagamento.recebido');
assert.equal(lerEnvelopeSites({ ...evento, tipo: 'reembolso.emitido', agregado: { tipo: 'reembolso', id: '9', versao: 1 }, dados: { ...evento.dados, reembolsoId: 9 } }, 42)?.tipo, 'reembolso.emitido');

assert.equal(isPublicBasePath('/api/v1/sites/webhook/agencia-1'), true);
assert.equal(isPublicBasePath('/api/health'), true);
assert.equal(isPublicBasePath('/api/v1/sites/config'), false);
assert.equal(isPublicBasePath('/api/v1/sites/webhook-malicioso/agencia-1'), false);
assert.equal(isPublicBasePath('/api/planos-comissao'), false);

limparRateLimitSitesParaTeste();
for (let i = 0; i < 120; i += 1) assert.equal(permitirWebhookSites('tenant-a', '203.0.113.10', agora), true);
assert.equal(permitirWebhookSites('tenant-a', '203.0.113.10', agora), false);
assert.equal(permitirWebhookSites('tenant-a', '203.0.113.10', agora + 60_001), true);
assert.equal(permitirWebhookSites('tenant-b', '203.0.113.10', agora), true);
assert.equal(origemDoWebhook(new Headers({ 'x-real-ip': '198.51.100.7', 'cf-connecting-ip': '203.0.113.11' })), '198.51.100.7');
assert.equal(origemDoWebhook(new Headers({ 'cf-connecting-ip': '203.0.113.11' })), '203.0.113.11');
assert.equal(origemDoWebhook(new Headers({ 'x-forwarded-for': '198.51.100.5, 10.0.0.1' })), 'desconhecida');
assert.equal(origemDoWebhook(new Headers({ 'x-forwarded-for': 'texto-invalido' })), 'desconhecida');

limparRateLimitSitesParaTeste();
for (let i = 0; i < 1_000; i += 1) assert.equal(permitirWebhookSites(`tenant-${i}`, '203.0.113.20', agora), true);
assert.equal(permitirWebhookSites('tenant-origem-excedida', '203.0.113.20', agora), false);

limparRateLimitSitesParaTeste();
for (let i = 0; i < 5_000; i += 1) assert.equal(permitirWebhookSites(`tenant-${i}`, `198.51.${Math.floor(i / 256)}.${i % 256}`, agora), true);
assert.equal(permitirWebhookSites('tenant-global-excedido', '192.0.2.1', agora), false);

console.log('PASS EnturOS Sites: acesso publico restrito, rate limit, assinatura, replay, tenant e envelope');
