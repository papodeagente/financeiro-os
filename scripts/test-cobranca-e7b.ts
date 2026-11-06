/**
 * Fechamento da E7, frente B (06/11/2026): regras puras.
 *   · portal: 2ª via pelo cliente (quando há, valor, vencimento no dia útil),
 *     notas fiscais (o recorte) e o portal de antes sem mudança;
 *   · envio por e-mail com a escolha Boleto / Fatura / Boleto e fatura;
 *   · resumo de vencimentos pelo WhatsApp (configuração, resumo e texto).
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-cobranca-e7b.ts
 */
import {
  diaUtilAPartirDe, montarPortal, notasDoPortal, segundaViaPossivel, vencimentoDaSegundaVia,
} from '../src/lib/cobranca/portal-regras.ts';
import { camposDoEnvio, lerEnvioPersonalizado } from '../src/lib/cobranca/envio.ts';
import {
  normalizarAvisoWhatsApp, resumoDoDia, resumoVazio, telefoneDoAviso, telefonesInvalidos, textoDoResumo,
} from '../src/lib/avisos-vencimento-whatsapp.ts';

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

console.log('--- Portal: 2ª via pelo cliente ---');
// 06/11/2026 é sexta: o próximo dia útil é segunda, 09/11. 14/11 (sábado) → 16/11 (segunda, sem feriado);
// 19/11 (quinta) → 20/11 é feriado (Consciência Negra) → 23/11.
eq([vencimentoDaSegundaVia('2026-11-06'), vencimentoDaSegundaVia('2026-11-13'), vencimentoDaSegundaVia('2026-11-19'), vencimentoDaSegundaVia('2026-11-10')],
  ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-11'], 'vencimento da 2ª via: o próximo dia útil (sem fim de semana nem feriado)');
eq(diaUtilAPartirDe('2026-12-25'), '2026-12-28', 'Natal na sexta: segunda');
const base = { tipo: 'boleto_pix', status: 'vencida', valor_centavos: 100000, vencimento: '2026-10-27', url_fatura: null };
const pol = { juros_am_pct: 3, multa_pct: 2, tolerancia_dias: 0 };
eq(segundaViaPossivel(base, '2026-11-06', pol), { vencimento: '2026-11-09', valor: 1033, juros: 13, multa: 20 }, 'vencida: juros de 13 dias (3% a.m.) + multa de 2% sobre o documento');
eq(segundaViaPossivel(base, '2026-11-06', null), { vencimento: '2026-11-09', valor: 1000, juros: 0, multa: 0 }, 'sem política: só a data nova');
eq(segundaViaPossivel(base, '2026-11-06', { ...pol, tolerancia_dias: 30 })?.valor, 1000, 'dentro da tolerância: sem encargos');
eq(segundaViaPossivel({ ...base, status: 'aberta' }, '2026-11-06', pol)?.vencimento, '2026-11-09', 'aberta com vencimento passado (o aviso de vencido não chegou): também');
eq(segundaViaPossivel({ ...base, status: 'aberta', vencimento: '2026-11-20' }, '2026-11-06', pol), null, 'ainda no prazo: nada a gerar');
eq(segundaViaPossivel({ ...base, url_fatura: 'https://asaas/i/1' }, '2026-11-06', pol), null, 'com o link do provedor que cobra o valor atualizado: nada a gerar');
eq(segundaViaPossivel({ ...base, url_fatura: 'http://inseguro' }, '2026-11-06', pol)?.valor, 1033, 'link fora de https não conta como link');
eq(segundaViaPossivel({ ...base, tipo: 'link' }, '2026-11-06', pol), null, 'link de pagamento: sem 2ª via');
eq(['paga', 'cancelada', 'emitindo', 'falhou'].map(s => segundaViaPossivel({ ...base, status: s }, '2026-11-06', pol)), [null, null, null, null], 'paga, cancelada, emitindo ou falhou: sem 2ª via');

console.log('--- Portal: notas fiscais ---');
const notas = notasDoPortal([
  { id: 'n1', status: 'AUTORIZADA', data: { numero: '101', valor_servicos: 300, autorizada_em: '2026-10-01T10:00:00Z', link_pdf: 'https://e/p', link_xml: '' } },
  { id: 'n2', status: 'AUTORIZADA', data: { numero: '102', valor_recebido: 150.5, emitida_em: '2026-11-01', destino: 'PAGANTE' } },
  { id: 'n3', status: 'CANCELADA', data: { numero: '103' } },
  { id: 'n4', status: 'AUTORIZADA', data: { numero: '104', destino: 'FORNECEDOR' } },
  { id: 'n5', status: 'AUTORIZADA', data: { numero: '105', destino: 'REPRESENTANTE' } },
  { id: 'n6', status: 'PROCESSANDO', data: { numero: '' } },
]);
eq(notas, [
  { ref: 'n2', numero: '102', emitida_em: '2026-11-01', valor: 150.5, tem_pdf: false, tem_xml: false },
  { ref: 'n1', numero: '101', emitida_em: '2026-10-01', valor: 300, tem_pdf: true, tem_xml: false },
], 'só autorizada e emitida para o cliente, da mais nova para a mais velha, sem o link do emissor');
const semNada = montarPortal({ agencia: null, cliente: { nome: 'Ana', documento: '' }, contas: [], cobrancas: [], hoje: '2026-11-06' });
eq(semNada.notas, [], 'portal sem notas informadas: lista vazia (quem chama como antes não quebra)');

console.log('--- Envio: Boleto / Fatura / Boleto e fatura ---');
eq(lerEnvioPersonalizado('email', {}), { copia_para: [], assunto: '', mensagem: '' }, 'sem escolha: o envio de sempre (sem campo novo)');
eq(lerEnvioPersonalizado('email', { documentos: 'boleto' }), { copia_para: [], assunto: '', mensagem: '' }, 'Boleto: o envio de sempre');
eq(lerEnvioPersonalizado('email', { documentos: 'fatura' }).documentos, 'fatura', 'Fatura');
eq(lerEnvioPersonalizado('email', { documentos: 'boleto_e_fatura' }).documentos, 'boleto_e_fatura', 'Boleto e fatura');
eq(erroDe(() => lerEnvioPersonalizado('email', { documentos: 'tudo' })), 'Escolha o que vai no e-mail: boleto, fatura ou os dois.', 'escolha desconhecida: recusa');
eq(erroDe(() => lerEnvioPersonalizado('whatsapp', { documentos: 'fatura' }))?.includes('vai por e-mail'), true, 'WhatsApp com fatura: recusa');
eq(lerEnvioPersonalizado('whatsapp', { documentos: 'boleto' }), { copia_para: [], assunto: '', mensagem: '' }, 'WhatsApp com boleto: como sempre');
eq(camposDoEnvio({ copia_para: [], assunto: '', mensagem: '', documentos: 'boleto' }), {}, 'Boleto não vai no payload');
eq(camposDoEnvio({ copia_para: [], assunto: '', mensagem: '', documentos: 'fatura' }), { documentos: 'fatura' }, 'Fatura vai no payload');

console.log('--- Resumo de vencimentos pelo WhatsApp ---');
eq([telefoneDoAviso('(11) 98888-7777'), telefoneDoAviso('+55 11 98888-7777'), telefoneDoAviso('0055 11 3333-4444'), telefoneDoAviso('+1 415 555 0100'), telefoneDoAviso('98888-77')],
  ['5511988887777', '5511988887777', '551133334444', '', ''], 'telefone: Brasil com DDD, com o 55; estrangeiro e curto ficam de fora');
eq(normalizarAvisoWhatsApp(null), { ligado: false, telefones: [] }, 'padrão: desligado e sem número (opt-in)');
eq(normalizarAvisoWhatsApp({ ligado: true, lixo: 1, telefones: [{ nome: '  Marina   Souza ', telefone: '11988887777' }, { nome: 'dup', telefone: '5511988887777' }, { telefone: 'x' }] }),
  { ligado: true, telefones: [{ nome: 'Marina Souza', telefone: '5511988887777' }] }, 'grava só o que conhece, sem repetir e sem inválido');
eq(normalizarAvisoWhatsApp({ ligado: true, telefones: Array.from({ length: 8 }, (_, i) => ({ telefone: `1199999000${i}` })) }).telefones.length, 5, 'até 5 números');
eq(telefonesInvalidos({ telefones: [{ telefone: '11988887777' }, { telefone: '123' }, { telefone: '' }] }), ['123'], 'a tela sabe qual número não serviu');
const contas = [
  { tabela: 'contas_pagar' as const, id: 'p1', descricao: 'Hotel Lisboa', pessoa: 'Operadora X', vencimento: '2026-11-06', saldo: 800 },
  { tabela: 'contas_pagar' as const, id: 'p2', descricao: '', pessoa: 'Cia Aérea', vencimento: '2026-11-06', saldo: 1200 },
  { tabela: 'contas_pagar' as const, id: 'p3', descricao: 'Seguro', pessoa: '', vencimento: '2026-11-01', saldo: 90 },
  { tabela: 'contas_receber' as const, id: 'r1', descricao: 'Pacote', pessoa: 'Ana Souza', vencimento: '2026-10-20', saldo: 500 },
  { tabela: 'contas_receber' as const, id: 'r2', descricao: 'Pacote', pessoa: 'Bruno', vencimento: '2026-11-06', saldo: 0 },
  { tabela: 'contas_pagar' as const, id: 'p4', descricao: 'Futura', pessoa: '', vencimento: '2026-11-20', saldo: 70 },
];
const resumo = resumoDoDia(contas, '2026-11-06');
eq([resumo.pagar_hoje, resumo.pagar_atrasadas, resumo.receber_hoje, resumo.receber_atrasadas],
  [{ quantidade: 2, total: 2000 }, { quantidade: 1, total: 90 }, { quantidade: 0, total: 0 }, { quantidade: 1, total: 500 }], 'o resumo: hoje e em atraso, a pagar e a receber (saldo zero e futura ficam de fora)');
eq(resumo.maiores_a_pagar_hoje.map(c => c.descricao), ['Cia Aérea', 'Hotel Lisboa'], 'as maiores a pagar hoje, pela descrição (ou pela pessoa)');
const texto = textoDoResumo(resumo, '2026-11-06', 'Boas Viagens', 'https://fin.exemplo.com/financeiro-ag');
eq(texto.split('\n')[0], 'Financeiro · Boas Viagens · 06/11', 'abre com a agência e o dia');
eq([/A pagar hoje: 2 contas, R\$\s2\.000,00/.test(texto), /A receber em atraso: 1 conta, R\$\s500,00/.test(texto), texto.includes('A receber hoje'), texto.includes('Ana Souza'), texto.endsWith('https://fin.exemplo.com/financeiro-ag')],
  [true, true, false, false, true], 'texto: totais, sem linha vazia, sem nome de cliente, com o link');
eq(resumoVazio(resumoDoDia([contas[5]], '2026-11-06')), true, 'nada hoje nem em atraso: não manda');
eq(textoDoResumo(resumoDoDia(Array.from({ length: 50 }, (_, i) => ({ ...contas[0], id: `x${i}`, descricao: 'x'.repeat(200) })), '2026-11-06'), '2026-11-06', 'A', 'u').length <= 1500, true, 'texto até 1500 letras');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
