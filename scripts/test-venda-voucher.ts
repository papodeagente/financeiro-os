/**
 * "Lançar pelo voucher" (E7, fechamento): a parte pura.
 * src/lib/venda-voucher.ts: limpeza do que a IA leu (campo sem trecho de
 * origem fica vazio; resposta malformada nunca quebra), conferência dos
 * trechos no e-mail colado e o rascunho da venda (ABERTA, origem manual, sem
 * id, sem nada inventado).
 *
 * Uso: node --experimental-strip-types scripts/run-tests.mjs scripts/test-venda-voucher.ts
 */
import {
  chaveDoFornecedorLido, conferirFontesNoTexto, fornecedoresDoVoucher, normalizarVoucherLido, rascunhoDoVoucher, reaisLidos,
  SEM_CASAMENTOS, type CasamentosDoVoucher,
} from '../src/lib/venda-voucher.ts';
import { totaisDaVenda } from '../src/lib/venda-modelo.ts';
import { jsonDaResposta } from '../src/lib/leitura-documento.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const HOJE = '2026-11-06';
const f = (valor: unknown, fonte = `fonte de ${String(valor)}`) => ({ valor, fonte });

const HOTEL = {
  tipo_documento: 'voucher',
  operadora: { nome: f('Sol Operadora Ltda', 'Emitido por: Sol Operadora Ltda'), cnpj: f('12.345.678/0001-95', 'CNPJ 12.345.678/0001-95') },
  cliente: { nome: f('Carla Dias', 'Titular: Carla Dias'), documento: f('123.456.789-09', 'CPF 123.456.789-09') },
  data_venda: f('2026-10-20', 'Reserva feita em 20/10/2026'),
  produtos: [{
    tipo: f('HOSPEDAGEM', 'Hospedagem'),
    descricao: f('Hotel Mar Azul 4 noites', 'Hotel Mar Azul - 4 noites'),
    fornecedor: { nome: f('Hotel Mar Azul', 'Hotel Mar Azul'), cnpj: f('', '') },
    localizador: f('HMA-7781', 'Localizador: HMA-7781'),
    data_inicio: f('2026-12-20', 'Check-in 20/12/2026'),
    data_fim: f('2026-12-24', 'Check-out 24/12/2026'),
    moeda: f('BRL', 'R$'),
    cambio: f(null, ''),
    tarifa_total: f(2000, 'Diárias: R$ 2.000,00'),
    taxas_total: f(100, 'Taxas: R$ 100,00'),
    detalhes: { hotel: f('Hotel Mar Azul', 'Hotel Mar Azul'), regime: f('Café da manhã', 'Regime: café da manhã'), inventado: f('x', 'y') },
    passageiros: [
      { nome: f('Carla Dias', 'Hóspede: Carla Dias'), tipo: 'ADT', documento: f('', ''), tarifa: f(null, ''), taxas: f(null, '') },
      { nome: f('Davi Dias', 'Hóspede: Davi Dias'), tipo: 'CHD', documento: f('', ''), tarifa: f(null, ''), taxas: f(null, '') },
    ],
    componentes: [{ tipo: 'COMISSAO', valor: null, percentual: 10, fonte: 'Comissão: 10%' }],
  }],
};

console.log('--- Limpeza do que a IA leu ---');
const lido = normalizarVoucherLido(HOTEL);
eq(lido.tipo_documento, 'voucher', 'tipo do documento');
eq(lido.cliente_documento, { valor: '12345678909', fonte: 'CPF 123.456.789-09' }, 'CPF só com dígitos, com o trecho');
eq(lido.operadora_cnpj.valor, '12345678000195', 'CNPJ da operadora só com dígitos');
eq(lido.produtos[0].tarifa_total, { valor: 2000, fonte: 'Diárias: R$ 2.000,00' }, 'tarifa total com a origem');
eq(Object.keys(lido.produtos[0].detalhes), ['hotel', 'regime'], 'detalhe fora da lista de campos é descartado');
eq(lido.produtos[0].componentes, [{ tipo: 'COMISSAO', valor: null, percentual: 10, fonte: 'Comissão: 10%' }], 'componente por percentual');
eq(lido.produtos[0].passageiros.map(p => p.tipo), ['ADT', 'CHD'], 'tipo de passageiro');

// Sem trecho de origem, o valor não entra (nunca inventado).
const semFonte = normalizarVoucherLido({ ...HOTEL, cliente: { nome: { valor: 'Inventado', fonte: '' } }, data_venda: { valor: '2026-10-20' } });
eq(semFonte.cliente_nome, { valor: '', fonte: '' }, 'nome sem trecho de origem fica vazio');
eq(semFonte.data_venda, { valor: '', fonte: '' }, 'data sem trecho de origem fica vazia');
eq(normalizarVoucherLido({ data_venda: f('2026-02-30') }).data_venda.valor, '', 'data que não existe fica vazia');
eq(normalizarVoucherLido({ cliente: { documento: f('123') } }).cliente_documento.valor, '', 'documento sem 11 ou 14 dígitos fica vazio');
eq(normalizarVoucherLido({ produtos: [{ tipo: f('NAVE ESPACIAL') }] }).produtos.length, 0, 'produto sem nada reconhecível cai');
eq(normalizarVoucherLido({ produtos: [{ tipo: f('aereo'), tarifa_total: f(-5) }] }).produtos[0].tipo.valor, 'AEREO', 'tipo em minúsculas é aceito');
eq(normalizarVoucherLido({ produtos: [{ tipo: f('AEREO'), tarifa_total: f(-5) }] }).produtos[0].tarifa_total.valor, null, 'valor negativo fica vazio');
eq(normalizarVoucherLido({ produtos: [{ tipo: f('AEREO'), componentes: [{ tipo: 'COBRADO_NO_CANCELAMENTO', valor: 5, fonte: 'x' }, { tipo: 'RAV', valor: 30, fonte: 'RAV 30' }] }] })
  .produtos[0].componentes.map(c => c.tipo), ['RAV'], 'componente interno do cancelamento não entra pela leitura');
eq(reaisLidos('R$ 1.234,56'), 1234.56, 'valor em texto brasileiro');
eq(reaisLidos('1234.56'), 1234.56, 'valor com ponto decimal');
eq(reaisLidos('abc'), null, 'texto sem número');

console.log('--- Resposta malformada nunca quebra ---');
for (const [bruto, rotulo] of [
  [null, 'null'], ['texto', 'texto solto'], [[1, 2], 'lista'], [{ produtos: 'x', cliente: 5 }, 'tipos trocados'],
  [{ produtos: [null, 3, 'a', { passageiros: 'x', componentes: [null] }] }, 'produtos lixo'],
] as Array<[unknown, string]>) {
  const l = normalizarVoucherLido(bruto);
  const r = rascunhoDoVoucher(l, SEM_CASAMENTOS, HOJE);
  eq([l.produtos.length, r.venda.produtos.length, r.venda.data_venda], [0, 0, HOJE], `malformado (${rotulo}): rascunho vazio, sem quebrar`);
}
eq(jsonDaResposta('Aqui está: {"tipo_documento": "voucher", "produtos": ['), null, 'JSON cortado não é lido');

console.log('--- Trecho conferido no e-mail colado ---');
const EMAIL = `Prezados, segue a confirmação.
Titular: Carla Dias  CPF 123.456.789-09
Reserva feita em 20/10/2026. Hotel Mar Azul - 4 noites, Localizador: HMA-7781
Check-in 20/12/2026 Check-out 24/12/2026. Diárias: R$ 2.000,00 Taxas: R$ 100,00`;
const conferido = conferirFontesNoTexto(lido, EMAIL);
eq(conferido.lido.cliente_nome.valor, 'Carla Dias', 'trecho presente no e-mail: fica');
eq(conferido.lido.produtos[0].localizador.valor, 'HMA-7781', 'localizador presente: fica');
eq(conferido.lido.operadora_nome.valor, '', 'operadora com trecho que não está no e-mail: sai');
eq(conferido.lido.produtos[0].componentes.length, 0, 'comissão com trecho que não está no e-mail: sai');
eq(conferido.lido.produtos[0].passageiros.length, 0, 'passageiros com trecho ausente: saem');
eq(conferido.descartados > 0, true, 'conta quantos caíram');

console.log('--- Rascunho sem cadastro ---');
const r = rascunhoDoVoucher(lido, SEM_CASAMENTOS, HOJE);
const v = r.venda;
eq([v.id, v.numero, v.origem, v.situacao], ['', '', 'manual', 'ABERTA'], 'venda sem id, sem número, manual e ABERTA');
eq(v.data_venda, '2026-10-20', 'data da venda do documento');
eq(v.cliente, { id: '', nome: 'Carla Dias', documento: '12345678909' }, 'cliente sem cadastro: só o nome e o CPF');
eq(v.pagamentos, [], 'nenhuma forma de pagamento inventada');
const p = v.produtos[0];
eq([p.tipo, p.localizador, p.data_inicio, p.data_fim, p.moeda, p.cambio], ['HOSPEDAGEM', 'HMA-7781', '2026-12-20', '2026-12-24', 'BRL', 1], 'produto lido');
eq(p.fornecedor, { id: '', nome: 'Hotel Mar Azul' }, 'fornecedor do produto sem cadastro');
eq([p.quantidade, p.valor_unitario_centavos, p.taxas_centavos, p.passageiros.length], [1, 200000, 10000, 0], 'sem valor por passageiro: total no produto');
eq(p.componentes.map(c => [c.tipo, c.percentual, c.valor_centavos]), [['COMISSAO', 10, 20000]], 'comissão de 10% vira valor pela tarifa');
eq(p.detalhes, { hotel: 'Hotel Mar Azul', regime: 'Café da manhã', checkin: '2026-12-20', checkout: '2026-12-24' }, 'detalhes do tipo');
eq(totaisDaVenda(v).valor_cliente, 210000, 'total do cliente = tarifa + taxas');
eq(v.observacoes.includes('Carla Dias, Davi Dias'), true, 'nomes dos passageiros vão para as observações');
eq(r.avisos.some(a => a.includes('cliente "Carla Dias" não foi achado')), true, 'aviso: cliente sem cadastro');
eq(r.avisos.some(a => a.includes('fornecedor "Hotel Mar Azul" não está no cadastro')), true, 'aviso: fornecedor sem cadastro');
eq(r.avisos.some(a => a.includes('valor de cada passageiro')), true, 'aviso: sem valor por passageiro');
const loc = r.origens.find(o => o.campo === 'Produto 1 · Localizador');
eq(loc, { campo: 'Produto 1 · Localizador', valor: 'HMA-7781', fonte: 'Localizador: HMA-7781' }, 'cada campo mostra de onde veio');
eq(r.origens.find(o => o.campo === 'Cliente')?.cadastro, 'sem_cadastro', 'cliente marcado sem cadastro');
eq(r.origens.every(o => o.fonte.length > 0), true, 'nenhum campo sem origem');

console.log('--- Rascunho com cadastro ---');
const cas: CasamentosDoVoucher = {
  cliente: { id: 'cli-1', nome: 'Carla Dias Souza', documento: '12345678909', como: 'documento' },
  fornecedores: { [chaveDoFornecedorLido('Hotel Mar Azul', '')]: { id: 'f-mar', nome: 'Hotel Mar Azul', como: 'nome' } },
};
const r2 = rascunhoDoVoucher(lido, cas, HOJE);
eq(r2.venda.cliente, { id: 'cli-1', nome: 'Carla Dias Souza', documento: '12345678909' }, 'cliente do cadastro');
eq(r2.venda.produtos[0].fornecedor, { id: 'f-mar', nome: 'Hotel Mar Azul' }, 'fornecedor do cadastro');
eq(r2.avisos.some(a => a.includes('não foi achado') || a.includes('não está no cadastro')), false, 'sem aviso de cadastro');
eq(r2.origens.find(o => o.campo === 'Cliente')?.cadastro, 'documento', 'cliente casado pelo CPF');

console.log('--- Valor por passageiro, moeda e o que falta ---');
const aereo = normalizarVoucherLido({
  operadora: { nome: f('Consolidadora Azul') },
  produtos: [{
    tipo: f('AEREO'), localizador: f('XYZ123'), moeda: f('USD'),
    passageiros: [
      { nome: f('Ana'), tipo: 'ADT', tarifa: f(500), taxas: f(80) },
      { nome: f('Bia'), tipo: 'INF', tarifa: f(50), taxas: f(10) },
    ],
    componentes: [{ tipo: 'TAXA_DU', valor: 40, fonte: 'DU 40' }],
  }],
});
const r3 = rascunhoDoVoucher(aereo, SEM_CASAMENTOS, HOJE);
const a = r3.venda.produtos[0];
eq(a.passageiros.map(x => [x.nome, x.tipo, x.tarifa_centavos, x.taxas_centavos]), [['Ana', 'ADT', 50000, 8000], ['Bia', 'INF', 5000, 1000]], 'valor por passageiro');
eq([a.valor_unitario_centavos, a.taxas_centavos], [0, 0], 'com valor por passageiro, o produto não repete o total');
eq(a.fornecedor, { id: '', nome: 'Consolidadora Azul' }, 'sem fornecedor no produto: quem emitiu');
eq([a.moeda, a.cambio], ['USD', 1], 'moeda lida; câmbio fica para a pessoa');
eq(r3.avisos.some(x => x.includes('USD') && x.includes('cotação')), true, 'aviso: câmbio fora do documento');
eq(r3.venda.data_venda, HOJE, 'sem data no documento: hoje, com aviso');
eq(r3.avisos.some(x => x.includes('data da venda ficou como hoje')), true, 'aviso da data');
eq(r3.vazios.includes('Data da venda') && r3.vazios.includes('Cliente') && r3.vazios.includes('Produto 1 · Início'), true, 'vazios listados');
eq(fornecedoresDoVoucher(aereo), [{ chave: 'nome:consolidadora azul', nome: 'Consolidadora Azul', documento: '' }], 'fornecedores a procurar');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
