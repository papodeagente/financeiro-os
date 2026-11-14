/**
 * Regras puras da versão por agência que são da frente B (14/11/2026):
 *  - código de quem paga só na versão completa (segundo-fator-pagador.ts);
 *  - `versoes_venda` do webhook e a VENDA_FECHADA v2 só com o módulo de venda
 *    (venda-crm-v2.ts);
 *  - a regra de 13/11 (quem recebe do cliente) na v1 e na v2
 *    (venda-crm-itens.ts);
 *  - tipos de notificação da versão simples (notificacoes-config.ts).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-versao-simples-regras.ts
 */
import { situacaoDoPagador } from '../src/lib/segundo-fator-pagador.ts';
import { ehVendaV2, vendaV2Aceita, versoesDaVenda } from '../src/lib/venda-crm-v2.ts';
import { comoALinhaNasce, ehPagoDireto, quemCobraNaVendaDoCrm } from '../src/lib/venda-crm-itens.ts';
import { TIPOS_NOTIFICACAO, tiposDaVersao } from '../src/lib/notificacoes-config.ts';
import { lerVendaV2 } from '../src/lib/venda-crm-v2.ts';

let falhas = 0;
let total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- código de quem paga ---');
const regra = { ligado: true, prazo: '2026-11-23' };
eq(situacaoDoPagador({ perfil: 'OPERADOR', nucleo: false }, regra, '2026-12-01'), 'livre', 'versão simples: pagar não pede o código');
eq(situacaoDoPagador({ perfil: 'OPERADOR', nucleo: true }, regra, '2026-12-01'), 'bloqueio', 'versão completa: pede, depois do prazo');
eq(situacaoDoPagador({ perfil: 'OPERADOR' }, regra, '2026-12-01'), 'bloqueio', 'sem informar a versão: como antes (pede)');

console.log('--- venda v2 e versoes_venda ---');
const v2 = { versao_venda: 2, venda: { produtos: [] } };
eq([versoesDaVenda(false), versoesDaVenda(true)], [[1], [1, 2]], 'versoes_venda: [1] sem o módulo de venda, [1,2] com ele');
eq([ehVendaV2(v2), vendaV2Aceita(v2, false), vendaV2Aceita(v2, true)], [true, false, true], 'a v2 só entra com o módulo; sem ele, lida como v1');
eq(vendaV2Aceita({ versao_venda: 1 }, true), false, 'a v1 continua v1 com o módulo');

console.log('--- regra de 13/11 (quem recebe do cliente) ---');
const modo = (o: Partial<{ pagoAAgencia: boolean; recebe: string[] }> = {}) => ({ pagoAAgencia: !!o.pagoAAgencia, recebeDiretoDoCliente: new Set(o.recebe ?? []) });
eq(ehPagoDireto({ fornecedor_id: 'f1' }, modo()), false, 'padrão: a agência recebe do cliente e paga o fornecedor');
eq(ehPagoDireto({ fornecedor_id: 'f1' }, modo({ recebe: ['f1'] })), true, 'fornecedor marcado "recebe direto do cliente": pago direto');
eq(ehPagoDireto({ fornecedor_id: 'f1', cobrado_pelo_fornecedor: true }, modo()), true, 'item "cobrado pelo fornecedor": pago direto');
eq(ehPagoDireto({ fornecedor_id: 'f1', cobrado_pelo_fornecedor: true }, modo({ recebe: ['f1'], pagoAAgencia: true })), false, 'pago pela plataforma da agência desfaz a exceção');
eq(ehPagoDireto({ fornecedor_id: '', cobrado_pelo_fornecedor: true }, modo()), false, 'sem fornecedor nunca é pago direto');
const linha = { fornecedor_id: 'f1', valor_custo: 312.5, valor_venda: 390.63, sem_fornecedor: false };
eq(comoALinhaNasce(linha, modo()).meio_pagamento, 'proprio', 'v1: a linha nasce própria (a receber + a pagar)');
eq(comoALinhaNasce(linha, modo({ recebe: ['f1'] })), { meio_pagamento: 'fornecedor', comissao_valor: 78.13, comissao_percentual: 20 }, 'v1: pago direto vira só a comissão');
const produtos = [{ fornecedor: { id: 'f1' } }, { fornecedor: { id: 'f2' } }, { fornecedor: null }, { fornecedor: { id: 'f3' } }];
eq(quemCobraNaVendaDoCrm(produtos, [false, true, true, false], modo({ recebe: ['f1'] })), ['FORNECEDOR', 'FORNECEDOR', 'AGENCIA', 'AGENCIA'],
  'v2: cadastro ou item decidem; sem fornecedor ou sem marcação, a agência cobra');
eq(quemCobraNaVendaDoCrm(produtos, [false, true, true, false], modo({ recebe: ['f1'], pagoAAgencia: true })), ['AGENCIA', 'AGENCIA', 'AGENCIA', 'AGENCIA'],
  'v2: pago pela plataforma da agência, a agência cobra tudo');
const lida = lerVendaV2({ crm_venda_id: 'x', venda: { produtos: [
  { ref: 'a', tipo: 'HOTEL', quem_cobra: 'FORNECEDOR', crm_item_ids: [7, 'x', 8] },
  { ref: 'b', tipo: 'HOTEL', cobrado_pelo_fornecedor: true },
  { ref: 'c', tipo: 'HOTEL', quem_cobra: 'AGENCIA' },
] } }, { id: 'v', numero: '1', data_venda: '2026-10-01', cliente: { id: 'c', nome: 'C' }, vendedor: null, grupo_id: null });
eq([lida.cobrado_pelo_fornecedor, lida.crm_item_ids], [[true, true, false], [[7, 8], [], []]], 'v2: a escolha do item e os itens da Cotação são lidos por produto');

console.log('--- notificações da versão simples ---');
const simples = tiposDaVersao(false);
eq(simples, ['PROPOSTA_ACEITA', 'PROPOSTA_FEEDBACK', 'PROPOSTA_VISUALIZADA', 'PROPOSTA_LEAD', 'VENDA_RECEBIMENTO_A_DEFINIR', 'VENDA_VENDEDOR_NAO_CADASTRADO', 'VENDA_CANCELADA_CRM'],
  'a versão simples tem exatamente os tipos de a9fd7cf');
eq(simples.some(t => t === 'APROVACAO_PEDIDA' || t === 'FATURA_CONTESTADA'), false, 'tipos da versão completa não aparecem na simples');
eq(tiposDaVersao(true).length, TIPOS_NOTIFICACAO.length, 'a versão completa vê todos');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
