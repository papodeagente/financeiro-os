/**
 * Notas fiscais, fechamento de paridade (E7, 06/11/2026): a lógica pura.
 *
 * O que se prova:
 *  - marcadores novos no texto da nota: passageiros, período, embarque e
 *    documento (localizador; sem ele, o número da venda);
 *  - a data da nota: o dia, a venda ou o embarque; sem a data ou com ela no
 *    futuro, a de hoje com o aviso;
 *  - tributos aproximados (Lei 12.741) só com percentual digitado;
 *  - dispensa de retenção pequena só com o limite digitado (vazio = retém);
 *  - a análise da venda com as opções (linha com embarque/fornecedor/vendedor;
 *    nota prevista com as datas, a dispensa e o texto dos tributos);
 *  - nota emitida fora: validação e chave (prestador|série|número);
 *  - acompanhamento sozinho: intervalo crescente e o aviso de recusa.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-notas-e7.ts
 */
import { normalizarVenda, type Venda } from '../src/lib/venda-modelo.ts';
import {
  analisarVenda, dataDaNota, normalizarRegra, normalizarTributosAproximados, preencherTexto, regraSugerida, textoDosTributos,
  valoresDosMarcadores, MARCADORES_DA_NOTA, DISCRIMINACAO_PADRAO,
  type RegraDaNota,
} from '../src/lib/nota-regras.ts';
import { dispensarRetencaoPequena, normalizarRetencao, normalizarRetencaoMinima } from '../src/lib/nota-retencoes.ts';
import { chaveDaNotaDeFora, normalizarNotaDeFora, notaFiscalDeFora } from '../src/lib/nota-externa.ts';
import { avisoDeRecusa, horaDeConsultar, primeiraConsulta, proximaConsulta } from '../src/lib/nota-acompanhamento.ts';

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

function venda(): Venda {
  const { venda: v, erros } = normalizarVenda({
    id: 'v1', numero: 'VND-0042', data_venda: '2026-11-01',
    cliente: { id: 'cli-1', nome: 'Carla Dias' },
    vendedor: { id: 'u-5', nome: 'Bia' },
    produtos: [
      {
        id: 'p-aereo', tipo: 'AEREO', descricao: 'GRU-LIS', fornecedor: { id: 'f-cia', nome: 'Cia Aérea' },
        localizador: 'XKT9QZ', data_inicio: '2026-12-20', data_fim: '2026-12-28',
        passageiros: [
          { id: 'a', nome: 'Carla Dias', tipo: 'ADT', tarifa_centavos: 100000 },
          { id: 'b', nome: 'Pedro Dias', tipo: 'ADT', tarifa_centavos: 100000 },
          { id: 'c', nome: 'Ana Cancelada', tipo: 'ADT', tarifa_centavos: 0, cancelado_em: '2026-11-02' },
        ],
        componentes: [{ tipo: 'TAXA_DU', valor_centavos: 8000 }, { tipo: 'RAV', valor_centavos: 2000 }],
      },
      {
        id: 'p-hotel', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' },
        representante: { id: 'r-cons', nome: 'Consolidadora' },
        localizador: 'HM123', data_inicio: '2026-12-21', data_fim: '2026-12-27',
        quantidade: 1, valor_unitario_centavos: 200000,
        componentes: [{ tipo: 'FEE', valor_centavos: 5000 }],
      },
    ],
    pagamentos: [{ id: 'pg', forma: 'PIX', valor_centavos: 100000 }],
  });
  if (erros.length) throw new Error(JSON.stringify(erros));
  return v;
}

console.log('--- Marcadores do texto da nota ---');
const v = venda();
const m = valoresDosMarcadores(v, v.produtos);
eq([m.passageiros, m.periodo, m.embarque, m.documento], ['Carla Dias, Pedro Dias', '20/12/2026 a 28/12/2026', '20/12/2026', 'XKT9QZ, HM123'], 'passageiros (sem o cancelado), período, embarque e localizadores');
const semLoc = { ...v.produtos[1], localizador: '', data_inicio: '', data_fim: '', passageiros: [] };
const m2 = valoresDosMarcadores(v, [semLoc]);
eq([m2.documento, m2.periodo, m2.passageiros], ['VND-0042', '', ''], 'sem localizador: o número da venda; sem datas: período vazio');
eq(preencherTexto('Viagem de {passageiros} ({periodo}). Doc {documento}. {inexistente}', m), 'Viagem de Carla Dias, Pedro Dias (20/12/2026 a 28/12/2026). Doc XKT9QZ, HM123.', 'marcador desconhecido some, sem espaço duplo');
eq(MARCADORES_DA_NOTA.map(x => x.marcador), ['{produtos}', '{venda}', '{cliente}', '{passageiros}', '{periodo}', '{embarque}', '{documento}'], 'a lista que a tela mostra');
eq(preencherTexto(DISCRIMINACAO_PADRAO.PAGANTE, m), 'Serviços de agenciamento de viagem: GRU-LIS, Hotel Mar. Venda VND-0042.', 'texto padrão de antes continua igual');

console.log('--- Data da nota ---');
const datas = { data_venda: '2026-11-01', data_embarque: '2026-10-20' };
eq(dataDaNota('DIA', datas, '2026-11-06'), { data: '2026-11-06', aviso: null }, 'o dia');
eq(dataDaNota('VENDA', datas, '2026-11-06'), { data: '2026-11-01', aviso: null }, 'a data da venda');
eq(dataDaNota('EMBARQUE', datas, '2026-11-06'), { data: '2026-10-20', aviso: null }, 'a data do embarque');
eq(dataDaNota('EMBARQUE', { data_venda: '2026-11-01', data_embarque: '2026-12-20' }, '2026-11-06').data, '2026-11-06', 'embarque no futuro: hoje');
eq(Boolean(dataDaNota('EMBARQUE', { data_venda: '2026-11-01', data_embarque: '' }, '2026-11-06').aviso), true, 'sem embarque: hoje, com aviso');

console.log('--- Tributos aproximados (Lei 12.741) ---');
const t0 = normalizarTributosAproximados({ ligado: true });
eq(textoDosTributos(100000, t0), '', 'ligado sem percentual: o texto não entra (nada inventado)');
const t1 = normalizarTributosAproximados({ ligado: true, federal: '13,45', municipal: 2 });
eq(textoDosTributos(100000, t1), 'Valor aproximado dos tributos: R$ 154,50 (15,45%).', 'texto padrão com os percentuais da agência');
eq(textoDosTributos(100000, { ...t1, texto: 'Federal {federal}; municipal {municipal}.' }), 'Federal R$ 134,50; municipal R$ 20,00.', 'texto próprio com os campos');
eq(textoDosTributos(100000, { ...t1, ligado: false }), '', 'desligado: nada');
eq(normalizarTributosAproximados({ federal: 120 }).federal, null, 'percentual fora de 0–100: vazio');

console.log('--- Dispensa de retenção pequena ---');
eq(normalizarRetencaoMinima({}), { ir_centavos: null, csll_pis_cofins_centavos: null }, 'padrão: sem limite (retém sempre)');
const base = { IR: 900, CSLL: 300, PIS: 200, COFINS: 400 };
eq(dispensarRetencaoPequena(base, null).total, 1800, 'sem limite: nada muda');
const d1 = dispensarRetencaoPequena(base, { ir_centavos: 1000, csll_pis_cofins_centavos: 1000 });
eq([d1.por_tributo, d1.total, d1.dispensas.length], [{ IR: 0, CSLL: 0, PIS: 0, COFINS: 0 }, 0, 2], 'IR (9,00) e CSLL+PIS+COFINS (9,00) até o limite de 10,00: nada se retém, cada um explicado');
const d2 = dispensarRetencaoPequena(base, { ir_centavos: null, csll_pis_cofins_centavos: 900 });
eq([d2.por_tributo, d2.total], [{ IR: 900, CSLL: 0, PIS: 0, COFINS: 0 }, 900], 'CSLL + PIS + COFINS juntos até o limite (inclusive): não se retém');
const d3 = dispensarRetencaoPequena(base, { ir_centavos: 899, csll_pis_cofins_centavos: 899 });
eq(d3.total, 1800, 'um centavo acima do limite: retém tudo');

console.log('--- A análise com as opções ---');
const regra: RegraDaNota = { ...regraSugerida(), id: 'r-geral' };
const comTexto = normalizarRegra({
  id: 'r-texto', descricao: 'Aéreo', tipo_produto: 'AEREO',
  destinos: { PAGANTE: { ligado: true, receitas: ['TAXA_DU', 'RAV'], gatilho: 'MANUAL', discriminacao: 'Agenciamento para {passageiros}, {periodo}. Localizador {documento}.' } },
}).regra;
const ret = normalizarRetencao({ id: 'rt', cliente: { id: 'cli-1', nome: 'Carla' }, tipo_produto: 'AEREO', nacional: { DU_RAV: { IR: 1.5, CSLL: 1, PIS: 0.65, COFINS: 3 } } }).retencao;
const a0 = analisarVenda({ venda: v, regras: [regra, comTexto], notas: [], retencoes: [ret] });
const aereo0 = a0.previstas.find(p => p.itens.some(i => i.produto_id === 'p-aereo') && p.destino === 'PAGANTE')!;
eq(aereo0.retencoes?.por_tributo, { IR: 150, CSLL: 100, PIS: 65, COFINS: 300 }, 'sem opções: retenção como antes');
eq(aereo0.discriminacao, 'Agenciamento para Carla Dias, Pedro Dias, 20/12/2026 a 28/12/2026. Localizador XKT9QZ, HM123.', 'o texto da regra com os marcadores novos (a nota junta o aéreo e o hotel do mesmo pagante)');
eq([aereo0.data_venda, aereo0.data_embarque, aereo0.dispensas], ['2026-11-01', '2026-12-20', []], 'a nota prevista leva as datas');
const a1 = analisarVenda({
  venda: v, regras: [regra, comTexto], notas: [], retencoes: [ret],
  opcoes: { retencao_minima: { ir_centavos: 1000, csll_pis_cofins_centavos: null }, tributos_aproximados: normalizarTributosAproximados({ ligado: true, municipal: 5 }) },
});
const aereo1 = a1.previstas.find(p => p.itens.some(i => i.produto_id === 'p-aereo') && p.destino === 'PAGANTE')!;
eq([aereo1.retencoes?.por_tributo.IR, aereo1.retencoes?.total, aereo1.dispensas.length], [0, 465, 1], 'com limite: o IR pequeno sai da nota, explicado');
eq(aereo1.discriminacao.slice(aereo1.discriminacao.indexOf('Valor aproximado')), 'Valor aproximado dos tributos: R$ 7,50 (5%).', 'o texto dos tributos vai no fim da nota (5% de 150,00)');
const linhaHotel = a1.linhas.find(l => l.produto_id === 'p-hotel')!;
eq([linhaHotel.data_embarque, linhaHotel.vendedor_id, linhaHotel.fornecedor_id, linhaHotel.representante_id], ['2026-12-21', 'u-5', 'f-hotel', 'r-cons'], 'linha da grade com embarque, vendedor, fornecedor e representante');

console.log('--- Nota emitida fora ---');
const ok = normalizarNotaDeFora({ numero: ' 00123 ', serie: 'a1', data_emissao: '2026-11-03', valor_centavos: 15000, tomador: { nome: 'Carla Dias', cpf_cnpj: '123.456.789-09' } }, '2026-11-06');
eq([ok.erros, ok.nota.numero, ok.nota.serie, ok.nota.tomador.cpf_cnpj], [[], '00123', 'A1', '12345678909'], 'normaliza número, série e documento');
eq(chaveDaNotaDeFora({ ...ok.nota, prestador_cnpj: '11222333000181' }), 'fora:11222333000181|A1|123', 'chave sem zeros à esquerda: 00123 e 123 são a mesma nota');
eq(normalizarNotaDeFora({ numero: '1', data_emissao: '2026-12-01', valor_centavos: 100, tomador: { nome: 'X', cpf_cnpj: '12345678909' } }, '2026-11-06').erros, ['A data de emissão não pode ser depois de hoje.'], 'data futura: recusa');
eq(normalizarNotaDeFora({ numero: '1', data_emissao: '2026-11-01', valor_centavos: 100, tomador: { nome: 'X' } }, '2026-11-06').erros.length, 1, 'sem CPF/CNPJ e sem ser do exterior: recusa');
const ext = normalizarNotaDeFora({ numero: '9', data_emissao: '2026-11-01', valor_centavos: 100, tomador: { nome: 'John Smith', estrangeiro: true, documento_estrangeiro: 'P1234', pais: 'Estados Unidos' } }, '2026-11-06');
eq([ext.erros, ext.nota.tomador.estrangeiro, ext.nota.tomador.documento_estrangeiro], [[], true, 'P1234'], 'tomador do exterior sem CPF/CNPJ: aceito');
const nf = notaFiscalDeFora({ ...ok.nota, prestador_cnpj: '11222333000181', aliquota_iss: 2 }, { id: 'n1', autor: 'Ana', origem: 'TELA', venda_id: 'v1', cliente_id: 'cli-1', agora: '2026-11-06T12:00:00Z' });
eq([nf.status, nf.emitida_fora, nf.valor_servicos, nf.valor_iss, nf.data_competencia, nf.emitida_em.slice(0, 10), nf.chave_externa], ['AUTORIZADA', true, 150, 3, '2026-11-03', '2026-11-03', 'fora:11222333000181|A1|123'], 'vira nota autorizada, de fora, com a data do documento');

console.log('--- Acompanhamento sozinho ---');
const agora = new Date('2026-11-06T12:00:00Z');
const mins = (iso: string) => Math.round((Date.parse(iso) - agora.getTime()) / 60000);
eq([0, 1, 2, 3, 4, 5, 9].map(i => mins(proximaConsulta(i, agora))), [5, 15, 60, 240, 720, 1440, 1440], 'intervalo crescente: 5 min, 15, 1 h, 4 h, 12 h e depois um dia');
eq(primeiraConsulta('2026-11-06T11:50:00Z', agora), '2026-11-06T11:55:00.000Z', 'a primeira consulta: 5 minutos depois da emissão');
eq(horaDeConsultar({ emitida_em: '2026-11-06T11:58:00Z' }, agora), false, 'emitida há 2 minutos: ainda não');
eq(horaDeConsultar({ emitida_em: '2026-11-06T11:00:00Z', acompanhamento: { tentativas: 2, proxima_em: '2026-11-06T13:00:00Z', ultima_em: '' } }, agora), false, 'próxima consulta marcada para depois: espera');
eq(horaDeConsultar({ emitida_em: '2026-11-06T11:00:00Z', acompanhamento: { tentativas: 2, proxima_em: '2026-11-06T11:59:00Z', ultima_em: '' } }, agora), true, 'hora chegou: consulta');
const av = avisoDeRecusa({ id: 'n1', numero: '', tomador: { razao_social: 'Carla Dias' } as never, valor_servicos: 65, erro: 'CPF do tomador inválido.', venda_id: 'v1' });
eq([av.titulo, av.descricao.includes('CPF do tomador inválido.'), av.link], ['A prefeitura recusou a nota para Carla Dias', true, '/financeiro-ag/notas'], 'o aviso de recusa diz para quem e o motivo');

console.log(`\n${total - falhas}/${total} testes passaram`);
if (falhas) process.exit(1);
