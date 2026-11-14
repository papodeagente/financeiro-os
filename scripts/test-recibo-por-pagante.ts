/**
 * Recibo da venda (por pagante), recibo consolidado da fatura e o resumo
 * fiscal da ficha (E7, 06/11/2026): a conta pura.
 *
 * Prova: só o que foi pago entra; baixa estornada não; a conta na fatura
 * entra pelo recebimento da fatura; crédito do cliente usado entra no
 * "recebemos", pago direto ao fornecedor fica à parte mas no total quitado;
 * saldo em aberto = recibo parcial (com quanto falta); sem pagamento =
 * recusa escrita; dois pagantes = dois recibos com números estáveis; o texto
 * da agência com os campos preenchidos; o recibo da fatura recusa aberta,
 * cancelada e sem recebimento; notas e retenção da venda.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-recibo-por-pagante.ts
 */
import {
  contaParaRecibo, marcadoresDesconhecidos, montarReciboDaFatura, montarReciboDaVenda, normalizarConfigDoRecibo,
  pagantesDoRecibo, preencherTexto, TEXTO_DO_RECIBO_PADRAO, chaveDoPagante,
  type ContaDoReciboDaVenda, type EntradaDoReciboDaVenda,
} from '../src/lib/recibo-por-pagante.ts';
import { resumoFiscalDaVenda } from '../src/lib/venda-fiscal.ts';
import { normalizarVenda } from '../src/lib/venda-modelo.ts';
import type { BaixaDoRecibo } from '../src/lib/cobranca/recibo.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else console.log(`PASS  ${label}`);
}

const agencia = { razao_social: 'Viagens Teste Ltda', cnpj: '44555666000154', endereco: { cidade: 'Campinas', estado: 'SP' } };
const venda = normalizarVenda({
  id: 'v1', numero: '1042', data_venda: '2026-11-01', cliente: { id: 'c1', nome: 'Carla Dias', documento: '12345678909' },
  produtos: [
    { id: 'p1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar 4 noites', fornecedor: { id: 'f1', nome: 'Hotel Mar' }, localizador: 'HM1', data_inicio: '2026-12-20', data_fim: '2026-12-24',
      passageiros: [{ id: 'a', nome: 'Carla Dias', tarifa_centavos: 200000 }, { id: 'b', nome: 'Rui Dias', tarifa_centavos: 100000 }] },
    { id: 'p2', tipo: 'SEGURO', descricao: 'Seguro', quantidade: 1, valor_unitario_centavos: 30000, cancelado_em: '2026-11-03' },
  ],
  pagamentos: [
    { id: 'g1', forma: 'BOLETO', valor_centavos: 200000, parcelas: 2 },
    { id: 'g2', forma: 'CREDITO_CLIENTE', valor_centavos: 50000, venda_origem_credito: '0999' },
    { id: 'g3', forma: 'PAGO_DIRETO_FORNECEDOR', valor_centavos: 30000, fornecedor: { id: 'f1', nome: 'Hotel Mar' } },
    { id: 'g4', forma: 'PIX', valor_centavos: 20000, pagante: { id: 'c2', nome: 'Empresa X' } },
  ],
}).venda;

const baixa = (id: string, data: string, valor: number, o: Partial<BaixaDoRecibo> = {}): BaixaDoRecibo =>
  ({ id, tipo: 'baixa', data, forma: 'BOLETO', valor, juros: 0, multa: 0, desconto: 0, estornada: false, ...o });
const conta = (o: Partial<ContaDoReciboDaVenda>): ContaDoReciboDaVenda => ({
  id: 'x', origem: 'VENDA', status: 'PENDENTE', cliente_id: 'c1', cliente_nome: 'Carla Dias', valor_final: 0, valor_recebido: null,
  data_recebimento: null, forma_recebimento: '', parcela_numero: 1, total_parcelas: 1, venda_pagamento_id: '', fatura_numero: null,
  fora_do_recibo: false, baixas: [], ...o,
});
const contas: ContaDoReciboDaVenda[] = [
  conta({ id: 'cr1', valor_final: 1000, status: 'RECEBIDO', valor_recebido: 1000, parcela_numero: 1, total_parcelas: 2, venda_pagamento_id: 'g1',
    baixas: [baixa('b1', '2026-11-05', 600), baixa('b2', '2026-11-06', 400), baixa('b3', '2026-11-04', 999, { estornada: true })] }),
  conta({ id: 'cr2', valor_final: 1000, status: 'PENDENTE', parcela_numero: 2, total_parcelas: 2, venda_pagamento_id: 'g1' }),
  conta({ id: 'cr3', valor_final: 200, status: 'PENDENTE', cliente_id: 'c2', cliente_nome: 'Empresa X', venda_pagamento_id: 'g4' }),
  conta({ id: 'com', origem: 'COMISSAO_FORNECEDOR', cliente_id: 'f1', cliente_nome: 'Hotel Mar', valor_final: 300, status: 'RECEBIDO', valor_recebido: 300 }),
  conta({ id: 'reemb', valor_final: 100, status: 'RECEBIDO', valor_recebido: 100, fora_do_recibo: true }),
];
const entrada = (o: Partial<EntradaDoReciboDaVenda> = {}): EntradaDoReciboDaVenda => ({
  agencia, venda, contas, creditos_usados: new Set(['g2']), documentos: { 'id:c1': '12345678909' },
  config: { texto: '', complemento: '' }, hoje: '2026-11-06', ...o,
});

console.log('--- Recibo da venda ---');
let r = montarReciboDaVenda(entrada());
eq(r.ok, true, 'o cliente pagou parte: há recibo');
if (r.ok) {
  const rc = r.recibo;
  eq([rc.numero, rc.pagador.nome, rc.pagador.documento], ['RV-1042-1', 'Carla Dias', '123.456.789-09'], 'número estável com dois pagantes; documento formatado');
  eq(rc.recebimentos.map(l => [l.data, l.forma, l.valor]), [['2026-11-01', 'Crédito do cliente', 500], ['2026-11-05', 'Boleto', 600], ['2026-11-06', 'Boleto', 400]], 'só o que vale: a baixa estornada fica fora; o crédito usado entra');
  eq([rc.valor, rc.pagos_ao_fornecedor.map(l => [l.forma, l.referencia, l.valor]), rc.total_quitado], [1500, [['Pago direto ao fornecedor', 'Hotel Mar', 300]], 1800], 'recebido 1.500; o pago ao hotel à parte; quitado 1.800');
  eq([rc.parcial, rc.em_aberto, rc.data], [true, 1000, '2026-11-06'], 'parcela 2 em aberto: recibo parcial, falta 1.000');
  eq(rc.servicos.map(s => [s.tipo, s.periodo, s.passageiros.join('|'), s.localizador]), [['Hospedagem', '20/12/2026 a 24/12/2026', 'Carla Dias|Rui Dias', 'HM1']], 'serviços sem o produto cancelado, com período e passageiros');
  eq(rc.declaracao, 'Viagens Teste Ltda declara que recebeu de Carla Dias (CPF/CNPJ 123.456.789-09) a importância de R$ 1.500,00 (mil e quinhentos reais), referente aos serviços de turismo da venda 1042, descritos abaixo e pagos nas formas indicadas, pela qual dá quitação.', 'texto padrão preenchido');
  eq(rc.valor_por_extenso, 'Mil e quinhentos reais', 'valor por extenso');
}
eq(r.pagantes.map(p => [p.chave, p.recebido_centavos, p.em_aberto_centavos, p.tem_recibo]), [['id:c1', 180000, 100000, true], ['id:c2', 0, 20000, false]], 'pagantes: Carla com recibo; Empresa X ainda sem pagamento');

r = montarReciboDaVenda(entrada(), 'id:c2');
eq([r.ok, !r.ok && /Ainda não entrou nenhum pagamento de Empresa X/.test(r.motivo)], [false, true], 'pagante sem pagamento: recusa escrita');
r = montarReciboDaVenda(entrada(), 'id:zz');
eq(r.ok ? '' : r.motivo, 'Esta pessoa não paga nada nesta venda.', 'pagante que não está na venda');

const pagaEmpresa = contas.map(c => (c.id === 'cr3' ? { ...c, status: 'RECEBIDO', valor_recebido: 200, baixas: [baixa('b9', '2026-11-07', 200, { forma: 'PIX' })] } : c));
r = montarReciboDaVenda(entrada({ contas: pagaEmpresa }), 'id:c2');
eq(r.ok && [r.recibo.numero, r.recibo.valor, r.recibo.parcial, r.recibo.recebimentos[0].forma, r.recibo.pagos_ao_fornecedor.length], ['RV-1042-2', 200, false, 'Pix', 0], 'Empresa X pagou tudo: recibo dela, sem faixa de parcial');

r = montarReciboDaVenda(entrada({ config: { texto: 'Recebi de {pagante} {valor} ({valor_extenso}) da venda {venda}, viagem {periodo}. {xpto}', complemento: 'Plantão 24h.' } }));
eq(r.ok && [r.recibo.declaracao, r.recibo.complemento], ['Recebi de Carla Dias (CPF/CNPJ 123.456.789-09) R$ 1.500,00 (mil e quinhentos reais) da venda 1042, viagem 20/12/2026 a 24/12/2026. {xpto}', 'Plantão 24h.'], 'texto da agência: campos trocados, o desconhecido fica como está');

const semNada = contas.map(c => ({ ...c, status: c.origem === 'VENDA' ? 'PENDENTE' : c.status, valor_recebido: null, baixas: [] }));
const vendaSemExtras = { ...venda, pagamentos: venda.pagamentos.filter(p => p.forma === 'BOLETO' || p.forma === 'PIX') };
r = montarReciboDaVenda(entrada({ contas: semNada, venda: vendaSemExtras, creditos_usados: new Set() }));
eq([r.ok, !r.ok && /Ainda não entrou nenhum pagamento de Carla Dias/.test(r.motivo)], [false, true], 'venda sem pagamento recebido: sem recibo, com o motivo');

// A conta na fatura entra pelo recebimento da fatura (já projetado na conta).
const naFatura = [conta({ id: 'cf', valor_final: 500, status: 'RECEBIDO', valor_recebido: 500, data_recebimento: '2026-11-20', fatura_numero: 7, venda_pagamento_id: 'g1' })];
r = montarReciboDaVenda(entrada({ contas: naFatura, venda: vendaSemExtras, creditos_usados: new Set() }));
eq(r.ok && r.recibo.recebimentos.map(l => [l.data, l.forma, l.valor]), [['2026-11-20', 'Fatura Nº 7', 500]], 'conta na fatura: o recebimento vem da fatura');

// Conta recebida antes do histórico de baixas: o valor gravado.
const legada = [conta({ id: 'lg', valor_final: 300, status: 'RECEBIDO', valor_recebido: 300, data_recebimento: '2026-10-01', forma_recebimento: 'PIX', venda_pagamento_id: 'g1' })];
r = montarReciboDaVenda(entrada({ contas: legada, venda: vendaSemExtras, creditos_usados: new Set() }));
eq(r.ok && [r.recibo.recebimentos[0].forma, r.recibo.valor], ['Pix', 300], 'recebida antes do histórico: entra pelo valor gravado');

eq(pagantesDoRecibo(entrada({ contas: [], venda: { ...venda, pagamentos: [] }, creditos_usados: new Set() })).length, 0, 'sem contas nem pagamentos: ninguém');
const linhaBanco = contaParaRecibo({ id: 'k', origem: 'VENDA', status: 'CANCELADO', na_fatura: { fatura_id: 'f', numero: 3 }, fatura_numero: 3, valor_final: 10, reembolso_id: '' }, []);
eq([linhaBanco.fatura_numero, linhaBanco.fora_do_recibo], [3, false], 'contaParaRecibo lê o carimbo da fatura');
eq(contaParaRecibo({ id: 'k', origem: 'VENDA', reembolso_id: 'r1' }, []).fora_do_recibo, true, 'conta de reembolso não é pagamento');
eq(chaveDoPagante('', '  Ana  Lima '), 'nome:ana lima', 'pagante sem cadastro: pelo nome');

console.log('--- Texto configurável ---');
eq(normalizarConfigDoRecibo({ texto: '  Oi {pagante}\r\n ', complemento: 5 }), { texto: 'Oi {pagante}', complemento: '' }, 'normaliza o texto');
eq(normalizarConfigDoRecibo({ texto: 'x'.repeat(2000) }).texto.length, 1500, 'texto com limite');
eq(marcadoresDesconhecidos('{pagante} {valor} {cpf} {cpf}'), ['{cpf}'], 'campo desconhecido avisado uma vez');
eq(marcadoresDesconhecidos(TEXTO_DO_RECIBO_PADRAO), [], 'o texto padrão só usa campos conhecidos');
eq(preencherTexto('{a}{b}', { a: '1' }), '1{b}', 'preencher deixa o que não conhece');

console.log('--- Recibo da fatura ---');
const fatura = { id: 'f1', numero: 12, situacao: 'FECHADA', pessoa_nome: 'Empresa Alfa', total_centavos: 150000, periodo_inicio: '2026-11-01', periodo_fim: '2026-11-15', vencimento: '2026-11-16' };
const bf = (id: string, data: string, valor: number, o: Record<string, unknown> = {}) => ({ ...baixa(id, data, valor), conta_nome: 'Banco Inter', ...o });
let rf = montarReciboDaFatura({ agencia, fatura, vendas: ['1042', '1043', '1042'], documento: '11222333000181', baixas: [bf('x1', '2026-11-16', 1000, { juros: 10 }), bf('x2', '2026-11-20', 300, { estornada: true })], hoje: '2026-11-21' });
eq(rf.ok && [rf.recibo.numero, rf.recibo.valor, rf.recibo.parcial, rf.recibo.em_aberto, rf.recibo.pagador.documento], ['RF-0012', 1000, true, 500, '11.222.333/0001-81'], 'fatura paga em parte: recibo parcial do que entrou');
eq(rf.ok && rf.recibo.referente, 'Fatura Nº 12, período de 01/11/2026 a 15/11/2026, vendas 1042, 1043', 'referente: número, período e vendas');
eq(rf.ok && rf.recibo.recebimentos.map(l => [l.data, l.conta, l.juros, l.valor]), [['2026-11-16', 'Banco Inter', 10, 1000]], 'cada recebimento com a conta; o estornado fica fora');
rf = montarReciboDaFatura({ agencia, fatura, vendas: [], documento: '', baixas: [bf('x1', '2026-11-16', 1000), bf('x3', '2026-11-18', 500, { forma: 'PIX' })], hoje: '2026-11-21' });
eq(rf.ok && [rf.recibo.valor, rf.recibo.parcial, rf.recibo.data, rf.recibo.valor_por_extenso], [1500, false, '2026-11-18', 'Mil e quinhentos reais'], 'fatura quitada: total e data do último recebimento');
rf = montarReciboDaFatura({ agencia, fatura: { ...fatura, situacao: 'ABERTA' }, vendas: [], documento: '', baixas: [], hoje: '2026-11-21' });
eq(rf.ok ? '' : rf.motivo, 'A fatura ainda está aberta. Feche e receba a fatura para tirar o recibo.', 'fatura aberta: sem recibo');
rf = montarReciboDaFatura({ agencia, fatura: { ...fatura, situacao: 'CANCELADA' }, vendas: [], documento: '', baixas: [], hoje: '2026-11-21' });
eq(rf.ok ? '' : rf.motivo, 'A fatura foi cancelada: não há recibo.', 'fatura cancelada: sem recibo');
rf = montarReciboDaFatura({ agencia, fatura, vendas: [], documento: '', baixas: [bf('x2', '2026-11-20', 300, { estornada: true })], hoje: '2026-11-21' });
eq(rf.ok ? '' : rf.motivo, 'Esta fatura ainda não tem recebimento. O recibo fica disponível depois do primeiro pagamento baixado.', 'só recebimento estornado: sem recibo');

console.log('--- Notas e retenção na ficha ---');
const fiscal = resumoFiscalDaVenda(
  [
    { id: 'n1', status: 'AUTORIZADA', data: { numero: '311', valor_servicos: 150, tomador: { razao_social: 'Carla Dias' }, autorizada_em: '2026-11-03T10:00:00Z', link_pdf: 'https://emissor/x.pdf' } },
    { id: 'n2', status: 'PROCESSANDO', data: { valor_servicos: 40, tomador: { nome: 'Carla' } }, criado_em: '2026-11-05 10:00:00+00' },
    { id: 'n3', status: 'REJEITADA', data: { valor_servicos: 40, erro: 'CNPJ do tomador inválido', link_pdf: 'javascript:alert(1)' }, criado_em: '2026-11-04' },
  ],
  [
    { id: 'cr1', status: 'PENDENTE', descricao: 'Parcela 1/2', cliente_nome: 'Empresa X', retencao_na_fonte: { valor_bruto: 1000, total: 61.5, IR: 15, CSLL: 10, PIS: 6.5, COFINS: 30 } },
    { id: 'cr2', status: 'CANCELADO', retencao_na_fonte: { valor_bruto: 1000, total: 61.5, IR: 15, CSLL: 10, PIS: 6.5, COFINS: 30 } },
    { id: 'cr3', status: 'PENDENTE', retencao_na_fonte: { valor_bruto: 500, total: 0 } },
  ],
);
eq(fiscal.notas.map(n => [n.id, n.rotulo, n.tom, n.data]), [['n2', 'Na prefeitura', 'aviso', '2026-11-05'], ['n3', 'Recusada', 'negativo', '2026-11-04'], ['n1', 'Autorizada', 'positivo', '2026-11-03']], 'notas da mais nova à mais antiga, com a situação em palavras');
eq([fiscal.notas[2].link_pdf, fiscal.notas[1].link_pdf, fiscal.notas[1].erro, fiscal.notas[0].tomador], ['https://emissor/x.pdf', '', 'CNPJ do tomador inválido', 'Carla'], 'só link http(s); o motivo da recusa aparece');
eq([fiscal.totais.autorizado, fiscal.totais.em_andamento], [150, 40], 'totais: autorizado e na prefeitura');
eq([fiscal.retencoes.length, fiscal.retencoes[0].liquido, fiscal.totais.retido, fiscal.totais.COFINS], [1, 938.5, 61.5, 30], 'retenção só das contas vivas e com valor');

// Identidade da agência no recibo da versão completa (14/11/2026): as cores
// do cadastro, como no recibo da versão simples (marca-da-agencia.ts).
{
  const { marcaDoRecibo } = await import('../src/lib/recibo-por-pagante.ts');
  const comCores = { ...agencia, logo: 'https://x/logo.png', cores: { primaria: '#ffcc00', destaque: '#123' } } as typeof agencia;
  const m = marcaDoRecibo(comCores);
  eq([m.primaria, m.destaque, m.textoSobrePrimaria], ['#FFCC00', '#112233', '#111827'], 'recibo completo: cores da agência, com texto legível sobre a principal');
  eq(marcaDoRecibo(agencia).primaria, '#004AAD', 'sem cor cadastrada: o padrão');
  eq(marcaDoRecibo({ ...agencia, cores: { primaria: 'red; background:url(x)' } } as typeof agencia).primaria, '#004AAD', 'cor fora do formato não vira CSS');
  const rv = montarReciboDaVenda({ agencia: comCores, venda, contas, creditos_usados: new Set(['g2']), documentos: {}, config: normalizarConfigDoRecibo(null), hoje: '2026-11-21' });
  eq(rv.ok ? [rv.recibo.marca.primaria, rv.recibo.emitente.logo] : null, ['#FFCC00', 'https://x/logo.png'], 'o recibo da venda leva o logo e as cores');
  const rf2 = montarReciboDaFatura({ agencia: comCores, fatura, vendas: [], documento: '', baixas: [bf('x1', '2026-11-16', 1000)], hoje: '2026-11-21' });
  eq(rf2.ok ? rf2.recibo.marca.primaria : null, '#FFCC00', 'o recibo da fatura também');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
