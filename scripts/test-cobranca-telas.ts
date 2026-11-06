/**
 * E3 · Cobrança — regras puras das telas e do portal (05/11/2026):
 * valor por extenso, recibo, ações de cada cobrança, quem entra num lote de
 * boletos ou num carnê, erro do provedor em palavras simples, configuração,
 * e o recorte do portal do cliente (o que sai e o que nunca sai).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-cobranca-telas.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { inteiroPorExtenso, valorPorExtenso } from '../src/lib/cobranca/extenso.ts';
import { dataPorExtenso, montarRecibo, numeroDoRecibo, rotuloDaForma, type BaixaDoRecibo } from '../src/lib/cobranca/recibo.ts';
import {
  acoesDaCobranca, descricaoDeExemplo, errosDaConfig, linhaEmBlocos, mensagemDeErro, motivoSemCarne,
  normalizarDiasDaRegua, PROVEDORES, rotuloDoDiaDaRegua, separarParaBoleto, situacaoNaConta, type ContaParaCobrar,
} from '../src/lib/cobranca/regras-telas.ts';
import {
  documentoMascarado, montarPortal, primeiroNome, tokenComFormatoValido,
} from '../src/lib/cobranca/portal-regras.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}
function lanca(fn: () => unknown): boolean { try { fn(); return false; } catch { return true; } }

// ─── Valor por extenso ─────────────────────────────────────────────────────
console.log('--- Valor por extenso ---');
const casos: Array<[number, string]> = [
  [0.01, 'um centavo'],
  [0.5, 'cinquenta centavos'],
  [1, 'um real'],
  [2, 'dois reais'],
  [15, 'quinze reais'],
  [21, 'vinte e um reais'],
  [100, 'cem reais'],
  [101, 'cento e um reais'],
  [110, 'cento e dez reais'],
  [199.99, 'cento e noventa e nove reais e noventa e nove centavos'],
  [1000, 'mil reais'],
  [1001, 'mil e um reais'],
  [1100, 'mil e cem reais'],
  [1234.56, 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos'],
  [2030, 'dois mil e trinta reais'],
  [12500, 'doze mil e quinhentos reais'],
  [100000, 'cem mil reais'],
  [1000000, 'um milhão de reais'],
  [2000000, 'dois milhões de reais'],
  [1500000, 'um milhão e quinhentos mil reais'],
  [1234567.89, 'um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete reais e oitenta e nove centavos'],
  [1000001, 'um milhão e um reais'],
];
for (const [v, t] of casos) eq(valorPorExtenso(v), t, `${v} → ${t}`);
eq(valorPorExtenso(0.1 + 0.2), 'trinta centavos', 'flutuante não vira 29 centavos');
eq(valorPorExtenso(0), 'zero real', 'zero');
eq(inteiroPorExtenso(16), 'dezesseis', 'dezesseis');
eq([lanca(() => valorPorExtenso(-1)), lanca(() => valorPorExtenso(Number.NaN))], [true, true], 'negativo e NaN são recusados');

// ─── Recibo ────────────────────────────────────────────────────────────────
console.log('--- Recibo ---');
const agencia = { razao_social: 'Viagens Boas Ltda', cnpj: '11222333000181', telefone: '(11) 3333-4444', endereco: { cidade: 'São Paulo', estado: 'SP' } };
const contaBase = {
  id: 'cr-abc12345', status: 'RECEBIDO', cliente_nome: 'Ana Souza', descricao: 'Pacote Lisboa', valor_final: 1500,
  valor_recebido: 1500, data_recebimento: '2026-11-03', forma_recebimento: 'PIX', parcela_numero: 2, total_parcelas: 3,
};
const b = (id: string, valor: number, extra: Partial<BaixaDoRecibo> = {}): BaixaDoRecibo => ({
  id, tipo: 'baixa', data: '2026-11-03', forma: 'PIX', valor, juros: 0, multa: 0, desconto: 0, estornada: false, ...extra,
});
const r1 = montarRecibo({ agencia, conta: contaBase, documentoDoPagador: '123.456.789-09', baixas: [b('bx1', 1000), b('bx2', 500, { data: '2026-11-04', forma: 'BOLETO', juros: 5 }), b('bx3', 200, { estornada: true })], hoje: '2026-11-05' });
eq(r1.ok, true, 'conta recebida tem recibo');
if (r1.ok) {
  eq(r1.recibo.valor, 1500, 'valor = soma das baixas que valem (estornada fora)');
  eq(r1.recibo.valor_por_extenso, 'Mil e quinhentos reais', 'por extenso com maiúscula');
  eq(r1.recibo.referente, 'Pacote Lisboa (parcela 2/3)', 'referente com a parcela');
  eq(r1.recibo.forma, 'Pix e Boleto', 'formas usadas');
  eq(r1.recibo.data, '2026-11-04', 'data = último recebimento');
  eq(r1.recibo.emitente.documento, 'CNPJ 11.222.333/0001-81', 'CNPJ formatado');
  eq(r1.recibo.encargos, [{ rotulo: 'Juros', valor: 5 }], 'encargos que houve');
  eq(r1.recibo.numero, numeroDoRecibo('cr-abc12345'), 'número estável pela conta');
}
const rBaixa = montarRecibo({ agencia, conta: { ...contaBase, status: 'PARCIAL' }, baixas: [b('bx1', 1000, { desconto: 20 })], baixaId: 'bx1', hoje: '2026-11-05' });
eq(rBaixa.ok && [rBaixa.recibo.valor, rBaixa.recibo.encargos, rBaixa.recibo.numero], [1000, [{ rotulo: 'Desconto', valor: -20 }], numeroDoRecibo('bx1')], 'recibo de um recebimento, mesmo com saldo na conta');
eq(montarRecibo({ agencia, conta: { ...contaBase, status: 'PARCIAL' }, baixas: [b('bx1', 1000)], hoje: '2026-11-05' }).ok, false, 'conta com saldo: sem recibo da conta inteira');
eq(montarRecibo({ agencia, conta: contaBase, baixas: [b('bx1', 1000, { estornada: true })], baixaId: 'bx1', hoje: '2026-11-05' }).ok, false, 'baixa estornada: sem recibo');
eq(montarRecibo({ agencia, conta: { ...contaBase, status: 'CANCELADO' }, baixas: [], hoje: '2026-11-05' }).ok, false, 'cancelada: sem recibo');
eq(montarRecibo({ agencia, conta: { ...contaBase, status: 'PENDENTE', valor_recebido: 0 }, baixas: [], hoje: '2026-11-05' }), { ok: false, motivo: 'A conta ainda não foi recebida.' }, 'em aberto: motivo escrito');
const semBaixas = montarRecibo({ agencia: null, conta: contaBase, baixas: [], hoje: '2026-11-05' });
eq(semBaixas.ok && [semBaixas.recibo.valor, semBaixas.recibo.forma, semBaixas.recibo.data, semBaixas.recibo.emitente.nome], [1500, 'Pix', '2026-11-03', 'Agência'], 'conta antiga sem histórico usa o valor recebido gravado');
eq([rotuloDaForma('TED'), rotuloDaForma('cartao_credito'), rotuloDaForma(''), rotuloDaForma('vale viagem')], ['Transferência bancária', 'Cartão de crédito', 'Não informada', 'Vale viagem'], 'nome da forma');
eq(dataPorExtenso('2026-11-05', 'São Paulo'), 'São Paulo, 5 de novembro de 2026', 'data por extenso');

// ─── Ações da cobrança ─────────────────────────────────────────────────────
console.log('--- Ações da cobrança ---');
const cob = { status: 'aberta' as const, tipo: 'boleto_pix' as const, provedor: 'asaas' as const, linha_digitavel: '1'.repeat(47), pix_copia_cola: '000201...', url_boleto: 'https://x/b.pdf', url_fatura: 'https://x/f' };
const ids = (a: ReturnType<typeof acoesDaCobranca>) => a.map(x => x.id);
eq(ids(acoesDaCobranca(cob, { emitir: true })), ['copiar_linha', 'copiar_pix', 'abrir_boleto', 'abrir_fatura', 'segunda_via', 'enviar_email', 'enviar_whatsapp', 'cancelar'], 'boleto com Pix aberto: todas as ações, sempre na mesma ordem');
eq(acoesDaCobranca(cob, { emitir: true }).every(a => a.bloqueio === null), true, 'aberta: tudo disponível');
eq(ids(acoesDaCobranca({ ...cob, tipo: 'pix', linha_digitavel: null, url_boleto: null }, { emitir: true })).includes('copiar_linha'), false, 'Pix puro não oferece linha digitável');
const paga = acoesDaCobranca({ ...cob, status: 'paga' }, { emitir: true });
eq(['segunda_via', 'cancelar', 'copiar_pix'].map(id => paga.find(a => a.id === id)?.bloqueio !== null), [true, true, true], 'paga: 2ª via, cancelar e copiar ficam bloqueados com motivo');
eq(ids(acoesDaCobranca({ ...cob, status: 'falhou', linha_digitavel: null, pix_copia_cola: null, url_boleto: null, url_fatura: null }, { emitir: true })).includes('emitir_de_novo'), true, 'não emitida: oferece emitir de novo');
eq(acoesDaCobranca(cob, { emitir: false }).find(a => a.id === 'cancelar')?.bloqueio, 'Seu acesso não inclui emitir boleto e Pix.', 'sem o direito: o motivo é o acesso');
eq(acoesDaCobranca(cob, { emitir: false }).find(a => a.id === 'copiar_pix')?.bloqueio, null, 'sem o direito, copiar continua (não grava nada)');
eq(acoesDaCobranca({ ...cob, status: 'emitindo', linha_digitavel: null }, { emitir: true }).find(a => a.id === 'copiar_linha')?.bloqueio, 'O provedor ainda está gerando o boleto.', 'emitindo: diz que está gerando');

// ─── Lote de boletos e carnê ───────────────────────────────────────────────
console.log('--- Lote e carnê ---');
const conta = (id: string, extra: Partial<ContaParaCobrar> = {}): ContaParaCobrar => ({
  id, tipo: 'receber', situacao: 'em_aberto', saldo: 100, pessoa: 'Ana', cliente_id: 'cli-1', vencimento: `2026-12-${id.padStart(2, '0')}`, cobranca: 'sem_boleto', ...extra,
});
const sep = separarParaBoleto([
  conta('1'), conta('2', { tipo: 'pagar' }), conta('3', { situacao: 'liquidado' }), conta('4', { cobranca: 'emitida' }),
  conta('5', { saldo: 0 }), conta('6', { situacao: 'em_atraso', cobranca: 'falhou' }), conta('7', { situacao: 'cancelado' }),
]);
eq(sep.prontas.map(c => c.id), ['1', '6'], 'só a receber, em aberto/atraso, com saldo e sem cobrança viva');
eq(sep.fora.map(f => f.conta.id), ['2', '3', '4', '5', '7'], 'o resto fica de fora');
eq(sep.fora[0].motivo.startsWith('É conta a pagar'), true, 'cada uma com o motivo');
eq(motivoSemCarne([conta('1'), conta('2')], 'pagarme'), 'O Pagar.me não gera carnê. Gere os boletos um a um.', 'Pagar.me não faz carnê');
eq(motivoSemCarne([conta('1'), conta('2')], ''), 'Conecte o Asaas em Configurações › Cobrança para gerar carnê.', 'sem provedor');
eq(motivoSemCarne([conta('1')], 'asaas') !== null, true, 'uma parcela só não é carnê');
eq(motivoSemCarne([conta('1'), conta('2', { cliente_id: 'cli-2' })], 'asaas'), 'O carnê é de um cliente só: as parcelas marcadas são de clientes diferentes.', 'clientes diferentes');
eq(motivoSemCarne([conta('1'), conta('2', { vencimento: '2026-12-01' })], 'asaas') !== null, true, 'duas no mesmo dia');
eq(motivoSemCarne([conta('1'), conta('2'), conta('3')], 'asaas'), null, 'Asaas, mesmo cliente, três parcelas: pode');
eq(motivoSemCarne([conta('1', { cliente_id: '' }), conta('2', { cliente_id: '' })], 'asaas'), null, 'sem ficha, compara pelo nome');

// ─── Situação na lista de contas ───────────────────────────────────────────
eq([
  situacaoNaConta({ tipo: 'receber', situacao: 'em_aberto' }, null),
  situacaoNaConta({ tipo: 'receber', situacao: 'em_atraso' }, 'cancelada'),
  situacaoNaConta({ tipo: 'receber', situacao: 'em_aberto' }, 'aberta'),
  situacaoNaConta({ tipo: 'receber', situacao: 'em_atraso' }, 'vencida'),
  situacaoNaConta({ tipo: 'receber', situacao: 'liquidado' }, 'paga'),
  situacaoNaConta({ tipo: 'receber', situacao: 'liquidado' }, null),
  situacaoNaConta({ tipo: 'pagar', situacao: 'em_aberto' }, null),
], ['sem_boleto', 'sem_boleto', 'emitida', 'vencida', 'paga', 'nao_se_aplica', 'nao_se_aplica'], 'situação da cobrança vista da conta ("Boleto não emitido")');

// ─── Erro em palavras simples ──────────────────────────────────────────────
console.log('--- Erros ---');
eq(mensagemDeErro('CLIENTE_SEM_DOCUMENTO', 'invalid cpfCnpj'), 'O cliente está sem CPF ou CNPJ válido. Boleto registrado exige o documento: complete a ficha do cliente.', 'código vira frase');
eq(mensagemDeErro(null, '{"errors":[{"code":"invalid_value"}]}'), 'O provedor recusou o pedido. Nada foi cobrado; tente de novo ou fale com o suporte.', 'JSON cru nunca vai para a tela');
eq(mensagemDeErro(null, 'Error: ETIMEDOUT at Socket.connect (net.js:1)'), 'O provedor recusou o pedido. Nada foi cobrado; tente de novo ou fale com o suporte.', 'erro técnico vira frase');
eq(mensagemDeErro(null, 'O vencimento precisa ser futuro.'), 'O vencimento precisa ser futuro.', 'frase legível passa');
eq(mensagemDeErro(null, 'x', 0), 'Sem resposta do servidor. Nada foi alterado; tente de novo.', 'sem rede');
eq(mensagemDeErro(null, '', 429), 'O provedor pediu uma pausa por excesso de pedidos. As cobranças seguem na fila sozinhas.', '429');

// ─── Configuração ──────────────────────────────────────────────────────────
console.log('--- Configuração ---');
eq(PROVEDORES.asaas.capacidades.carne && PROVEDORES.asaas.capacidades.boletoComPix, true, 'Asaas: boleto com Pix e carnê');
eq([PROVEDORES.pagarme.capacidades.carne, PROVEDORES.pagarme.capacidades.boletoComPix, PROVEDORES.pagarme.tipos], [false, false, ['boleto', 'pix']], 'Pagar.me: boleto OU Pix, sem carnê');
eq(PROVEDORES.pagarme.frase.includes('um de cada vez'), true, 'a frase do porquê');
const cfg = { provedor_padrao: 'pagarme', tipo_padrao: 'boleto_pix' as const, juros_am_pct: 1, multa_pct: 2, desconto_pct: 0, desconto_dias: 0, descricao_modelo: '' };
eq(Object.keys(errosDaConfig(cfg)), ['tipo_padrao'], 'Pagar.me não aceita boleto com Pix');
eq(Object.keys(errosDaConfig({ ...cfg, provedor_padrao: 'asaas', juros_am_pct: 12, desconto_dias: 1.5 })), ['juros_am_pct', 'desconto_dias'], 'faixas de juros e dias');
eq(normalizarDiasDaRegua([3, -5, 0, 3, 99, 1.5, -5]), [-5, 0, 3], 'régua: ordena, tira repetido e fora da faixa');
eq([rotuloDoDiaDaRegua(-5), rotuloDoDiaDaRegua(0), rotuloDoDiaDaRegua(1)], ['5 dias antes', 'No dia do vencimento', '1 dia depois'], 'rótulos da régua');
eq(descricaoDeExemplo('Viagem {descricao} {parcela} · {agencia}', 'Boas'), 'Viagem Pacote Lisboa e Porto 2/6 · Boas', 'prévia da descrição');
eq(linhaEmBlocos('23793381286000782713695000063305975520000370000'), '23793.38128 60007.827136 95000.063305 9 75520000370000', 'linha digitável em blocos');

// ─── Portal do cliente ─────────────────────────────────────────────────────
console.log('--- Portal (regras) ---');
eq([tokenComFormatoValido('a'.repeat(43)), tokenComFormatoValido('a'.repeat(31)), tokenComFormatoValido("abc' OR 1=1 --".padEnd(40, 'x')), tokenComFormatoValido(null)], [true, false, false, false], 'formato do token');
eq([documentoMascarado('123.456.789-09'), documentoMascarado('11222333000181'), documentoMascarado('123')], ['***.456.789-**', '**.222.333/0001-**', ''], 'documento sempre mascarado');
eq([primeiroNome('  ana MARIA souza '), primeiroNome('')], ['Ana', ''], 'só o primeiro nome');

const portal = montarPortal({
  agencia: { razao_social: 'Viagens Boas Ltda', nome_fantasia: 'Boas Viagens', telefone: '(11) 98888-7777', email: 'oi@boas.com', logo: 'http://inseguro/logo.png', cnpj: '11222333000181', bloqueios_financeiros: { x: 1 } },
  cliente: { nome: 'Ana Souza', documento: '12345678909' },
  contas: [
    { id: 'c1', status: 'PENDENTE', data: { descricao: 'Pacote', valor_final: 1000, valor_recebido: 0, data_vencimento: '2026-11-20', parcela_numero: 1, total_parcelas: 2, margem: 300, observacoes: 'cliente difícil', categoria_id: 'cat' } },
    { id: 'c2', status: 'PARCIAL', data: { descricao: '', valor_final: 500, valor_recebido: 200, data_vencimento: '2026-11-01' } },
    { id: 'c3', status: 'RECEBIDO', data: { descricao: 'Seguro', valor_final: 80, valor_recebido: 80, data_recebimento: '2026-10-10' } },
    { id: 'c4', status: 'CANCELADO', data: { descricao: 'Cancelada', valor_final: 99 } },
  ],
  cobrancas: [
    { titulo_id: 'c1', tipo: 'boleto_pix', status: 'cancelada', valor_centavos: 100000, vencimento: '2026-11-10', linha_digitavel: 'velha', pix_copia_cola: 'velho', url_boleto: 'https://a/velho', url_fatura: null },
    { titulo_id: 'c1', tipo: 'boleto_pix', status: 'aberta', valor_centavos: 100000, vencimento: '2026-11-20', linha_digitavel: '1'.repeat(47), pix_copia_cola: 'pix', url_boleto: 'javascript:alert(1)', url_fatura: 'https://a/f' },
    { titulo_id: 'c3', tipo: 'pix', status: 'paga', valor_centavos: 8000, vencimento: '2026-10-10', linha_digitavel: null, pix_copia_cola: 'pix-pago', url_boleto: null, url_fatura: null },
  ],
  hoje: '2026-11-05',
});
eq(portal.em_aberto.map(i => [i.ref, i.situacao, i.saldo]), [['c2', 'em_atraso', 300], ['c1', 'em_aberto', 1000]], 'em aberto: saldo, atraso e ordem por vencimento');
eq(portal.pagas.map(i => [i.ref, i.tem_recibo, i.cobranca?.pix_copia_cola ?? null]), [['c3', true, null]], 'paga: com recibo e sem código para copiar');
eq(portal.total_em_aberto, 1300, 'total em aberto');
eq(portal.em_aberto[1].cobranca?.linha_digitavel?.length, 47, 'vale a cobrança viva, não a cancelada');
eq([portal.em_aberto[1].cobranca?.url_boleto, portal.em_aberto[1].cobranca?.url_fatura], [null, 'https://a/f'], 'só endereço https vai para o cliente');
eq(portal.agencia.logo, '', 'logo fora de https não sai');
eq(portal.cliente, { primeiro_nome: 'Ana', documento: '***.456.789-**' }, 'cliente: primeiro nome e documento mascarado');
eq(portal.agencia.whatsapp, '5511988887777', 'WhatsApp da agência com o país');
eq(portal.em_aberto[0].descricao, 'Serviços de turismo', 'sem descrição: texto neutro');
const texto = JSON.stringify(portal);
eq(['margem', 'cliente difícil', 'cat', '11222333000181', '12345678909', 'bloqueios', 'Viagens Boas Ltda', 'Cancelada', 'velho'].filter(t => texto.includes(t)), [], 'nada fora da lista sai: margem, observação, categoria, CNPJ, CPF inteiro, conta cancelada, cobrança antiga');
const chaves = (o: object) => Object.keys(o).sort();
eq(chaves(portal.em_aberto[0]), ['cobranca', 'descricao', 'pago_em', 'parcela', 'ref', 'saldo', 'situacao', 'tem_recibo', 'valor', 'vencimento'], 'campos do item: só os da lista');

// ─── Vocabulário: nenhum termo proibido nos textos novos ───────────────────
console.log('--- Vocabulário ---');
const PROIBIDOS = [
  'lei kandir', 'cartao passagem', 'fornecimento', 'consulta global de log', 'resumo geral', 'grupos de usuario', 'acesso total',
  'saldo excluido', 'gerar lancamento', 'parcelas adicionais', 'demonstrativo por categorias', 'processar retorno', 'gerar remessa',
  'reenviar remessa',
];
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? arquivos(p) : /\.tsx?$/.test(p) ? [p] : []; });
}
const raiz = new URL('../src/', import.meta.url).pathname;
const novos = [
  ...arquivos(join(raiz, 'lib/cobranca')), ...arquivos(join(raiz, 'components/financeiro/cobranca')),
  ...arquivos(join(raiz, 'app/financeiro-ag/cobrancas')), ...arquivos(join(raiz, 'app/config/cobranca')), ...arquivos(join(raiz, 'app/c')),
  ...arquivos(join(raiz, 'app/recibo')),
];
eq(novos.length > 10, true, `varre os arquivos novos (${novos.length})`);
const achados = novos.flatMap(p => PROIBIDOS.filter(t => norm(readFileSync(p, 'utf8')).includes(t)).map(t => `${p.split('/src/')[1]}: ${t}`));
eq(achados, [], 'nenhum termo proibido');

console.log(`\n${total - falhas}/${total} testes da cobrança (telas) passaram`);
if (falhas > 0) process.exit(1);
