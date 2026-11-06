/**
 * Cobrança — fechamento de paridade (E7, 06/11/2026): regras puras.
 *   · taxa de boleto repassada (taxa-boleto.ts) e a configuração;
 *   · o plano da pendência da baixa automática (pendencia.ts);
 *   · envio com cópia, assunto e mensagem (envio.ts);
 *   · as contas da venda para "Emitir boletos" (regras-telas.ts).
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-cobranca-e7.ts
 */
import { dividirPagamento, idDaContaDaTaxa, levaTaxaDeBoleto } from '../src/lib/cobranca/taxa-boleto.ts';
import { conferirMotivo, lerPagamentoDaPendencia, planejarPendencia } from '../src/lib/cobranca/pendencia.ts';
import { camposDoEnvio, lerEnvioPersonalizado, separarEmails } from '../src/lib/cobranca/envio.ts';
import { contasDaVendaParaCobrar, separarParaBoleto } from '../src/lib/cobranca/regras-telas.ts';
import { configDaTela, configParaTela } from '../src/lib/cobranca/config-tela.ts';
import { CONFIG_COBRANCA_PADRAO, normalizarConfigCobranca } from '../src/lib/cobranca/config.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
function erroDe(f: () => unknown): string | null {
  try { f(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

console.log('--- Taxa de boleto ---');
eq([levaTaxaDeBoleto('boleto_pix', 350, true), levaTaxaDeBoleto('boleto', 350, true), levaTaxaDeBoleto('pix', 350, true),
  levaTaxaDeBoleto('link', 350, true), levaTaxaDeBoleto('boleto', 0, true), levaTaxaDeBoleto('boleto', 350, false)],
[true, true, false, false, false, false], 'só boleto, com taxa ligada e cliente marcado');
eq(dividirPagamento(10350, 10350, 350), { conta: 10000, taxa: 350 }, 'pagou tudo: a conta pelo valor dela e a taxa à parte');
eq(dividirPagamento(10100, 10350, 350), { conta: 10000, taxa: 100 }, 'pagou a menos: primeiro a conta, a taxa com o que sobra');
eq(dividirPagamento(9000, 10350, 350), { conta: 9000, taxa: 0 }, 'não cobriu a conta: nada para a taxa');
eq(dividirPagamento(11000, 10350, 350), { conta: 10650, taxa: 350 }, 'pagou a mais: a sobra fica na conta (regra da baixa)');
eq(dividirPagamento(5000, 5000, 0), { conta: 5000, taxa: 0 }, 'sem taxa: tudo na conta');
eq(idDaContaDaTaxa('c1'), 'taxa-boleto-c1', 'id fixo da conta da taxa');
eq(normalizarConfigCobranca({}).taxa_boleto_centavos, 0, 'padrão: não repassa');
eq([normalizarConfigCobranca({ taxa_boleto_centavos: 349.6 }).taxa_boleto_centavos, normalizarConfigCobranca({ taxa_boleto_centavos: 99999 }).taxa_boleto_centavos,
  normalizarConfigCobranca({ taxa_boleto_centavos: -5 }).taxa_boleto_centavos], [350, 10000, 0], 'arredonda e limita (até R$ 100)');
const telaCfg = configParaTela({ ...CONFIG_COBRANCA_PADRAO, taxa_boleto_centavos: 290 }, null, []);
eq(telaCfg.taxa_boleto, 2.9, 'tela vê a taxa em reais');
eq(configDaTela(CONFIG_COBRANCA_PADRAO, null, { taxa_boleto: 3.49 }).taxa_boleto_centavos, 349, 'tela grava a taxa em centavos');
eq(configDaTela({ ...CONFIG_COBRANCA_PADRAO, taxa_boleto_centavos: 300 }, null, { dias_link: 5 }).taxa_boleto_centavos, 300, 'o que não veio fica como está');

console.log('--- Pendência ---');
const pag = { valor_centavos: 8000, taxa_centavos: 199, juros: 0, desconto: 0, data: '2026-11-06', conta_bancaria_id: 'cb', forma: 'Boleto', id_pagamento: 'pay_1' };
const cob = (extra: Record<string, unknown> = {}, valor = 8000) => ({ valor_centavos: valor, dados: { pendencia: 'x', pendencia_tipo: 'pagamento', pendencia_pagamento: pag, ...extra } });
let pl = planejarPendencia(cob(), { status: 'RECEBIDO', saldo: 0, cliente_id: 'cli' });
eq([pl.escolhas.corrigir.pode, pl.escolhas.credito.pode, pl.escolhas.credito.credito, pl.escolhas.ignorar.pode], [false, true, 80, true], 'conta já recebida: crédito do pagamento inteiro');
eq(pl.escolhas.corrigir.frase.includes('já está recebida'), true, 'corrigir explica por que não');
pl = planejarPendencia(cob(), { status: 'PENDENTE', saldo: 80, cliente_id: 'cli' });
eq([pl.escolhas.corrigir.pode, pl.escolhas.credito.pode, pl.conta_aberta], [true, false, true], 'conta aberta sem sobra: corrigir sim, crédito não');
eq(pl.escolhas.corrigir.frase.includes('fica recebida'), true, 'frase diz que a conta fecha');
pl = planejarPendencia(cob(), { status: 'PARCIAL', saldo: 50, cliente_id: 'cli' });
eq([pl.escolhas.corrigir.frase.includes('acréscimo'), pl.escolhas.credito.credito], [true, 30], 'sobra: corrigir vira acréscimo; crédito guarda R$ 30');
pl = planejarPendencia(cob(), { status: 'PENDENTE', saldo: 100, cliente_id: 'cli' });
eq(pl.escolhas.corrigir.frase.includes('faltam'), true, 'pagou menos que o saldo: a conta fica em parte');
pl = planejarPendencia(cob(), { status: 'CANCELADO', saldo: 80, cliente_id: 'cli' });
eq([pl.escolhas.corrigir.pode, pl.escolhas.credito.pode, pl.conta_aberta], [false, true, false], 'conta cancelada: só crédito ou resolvida');
pl = planejarPendencia(cob(), { status: 'RECEBIDO', saldo: 0, cliente_id: '' });
eq(pl.escolhas.credito.pode, false, 'sem cliente cadastrado: não há carteira');
pl = planejarPendencia(cob(), null);
eq([pl.escolhas.corrigir.pode, pl.escolhas.credito.pode], [false, false], 'conta apagada: só resolvida');
pl = planejarPendencia(cob({ pendencia_tipo: 'estorno' }), { status: 'RECEBIDO', saldo: 0, cliente_id: 'cli' });
eq([pl.tipo, pl.escolhas.corrigir.pode, pl.escolhas.credito.pode, pl.escolhas.ignorar.pode], ['estorno', false, false, true], 'estorno: só marcar como resolvida');
pl = planejarPendencia(cob({ taxa_boleto_centavos: 350 }, 8350), { status: 'RECEBIDO', saldo: 0, cliente_id: 'cli' });
eq([pl.divisao, pl.escolhas.credito.credito], [{ conta: 8000, taxa_boleto: 0 }, 80], 'pendência com taxa de boleto: aviso pagou só 80, a taxa fica sem nada');
eq(lerPagamentoDaPendencia({ valor_centavos: 0 }), null, 'pagamento sem valor: nada a lançar');
eq([conferirMotivo('ignorar', 'curto'), conferirMotivo('ignorar', 'Já baixado à mão.'), conferirMotivo('corrigir', '')], [conferirMotivo('ignorar', ''), null, null], 'resolvida pede 10 letras de motivo');

console.log('--- Envio com cópia ---');
eq(separarEmails('A@x.com; b@y.com,  a@x.com\nc@z.com'), ['a@x.com', 'b@y.com', 'c@z.com'], 'separa, normaliza e tira repetidos');
eq(lerEnvioPersonalizado('email', { copia_para: ['fin@x.com'], assunto: '  Olá   ali ', mensagem: ' Texto\r\nnovo ' }), { copia_para: ['fin@x.com'], assunto: 'Olá ali', mensagem: 'Texto\nnovo' }, 'limpa assunto e mensagem');
eq(lerEnvioPersonalizado('whatsapp', {}), { copia_para: [], assunto: '', mensagem: '' }, 'WhatsApp sem nada próprio: ok');
eq(erroDe(() => lerEnvioPersonalizado('whatsapp', { assunto: 'x' }))?.includes('modelo aprovado'), true, 'WhatsApp com assunto: recusa');
eq(erroDe(() => lerEnvioPersonalizado('email', { copia_para: 'a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com' }))?.includes('Até 5'), true, 'mais de 5 cópias: recusa');
eq(erroDe(() => lerEnvioPersonalizado('email', { copia_para: 'sem-arroba' }))?.includes('não parece'), true, 'e-mail inválido: recusa');
eq(erroDe(() => lerEnvioPersonalizado('email', { assunto: 'x'.repeat(151) }))?.includes('150'), true, 'assunto longo: recusa');
eq(camposDoEnvio({ copia_para: [], assunto: '', mensagem: 'oi' }), { mensagem: 'oi' }, 'payload só com o preenchido');

console.log('--- Emitir boletos da venda ---');
const contas = [
  { id: 'r1', status: 'PENDENTE', valor_final: 100, cliente_id: 'c', cliente_nome: 'Ana', data_vencimento: '2026-12-01', descricao: 'Parcela 1' },
  { id: 'r2', status: 'PARCIAL', valor_final: 100, valor_recebido: 40, cliente_id: 'c', cliente_nome: 'Ana', data_vencimento: '2026-11-01', descricao: 'Parcela 2' },
  { id: 'r3', status: 'RECEBIDO', valor_final: 100, cliente_id: 'c', data_vencimento: '2026-10-01' },
  { id: 'r4', status: 'PENDENTE', valor_final: 100, cliente_id: 'c', data_vencimento: '2026-12-01', cobranca: { status: 'aberta' } },
  { id: 'r5', status: 'PENDENTE', valor_final: 30, origem: 'COMISSAO_FORNECEDOR' },
  { id: 'r6', status: 'PENDENTE', valor_final: 30, faturar: true },
];
const lista = contasDaVendaParaCobrar(contas, '2026-11-06');
eq(lista.map(c => [c.id, c.situacao, c.saldo, c.cobranca]), [
  ['r1', 'em_aberto', 100, 'sem_boleto'], ['r2', 'em_atraso', 60, 'sem_boleto'], ['r3', 'liquidado', 100, 'nao_se_aplica'], ['r4', 'em_aberto', 100, 'emitida'],
], 'contas da venda: sem a comissão do fornecedor nem o que vai para a fatura; saldo da parcial');
eq(separarParaBoleto(lista).prontas.map(c => c.id), ['r1', 'r2'], 'prontas para boleto: as em aberto sem cobrança');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
