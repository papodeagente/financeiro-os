/**
 * Cadastro de moedas da agência e assistente inicial (E7, frente D,
 * 06/11/2026), lógica pura:
 *  1. o de sempre continua igual sem catálogo (as oito do sistema; código
 *     desconhecido = real);
 *  2. moeda da agência: validação ISO 4217, sugestão de nome/símbolo/casas,
 *     catálogo, formatação com as casas, câmbio e transferência;
 *  3. assistente: modo (sozinho / oferta / pronto), o que falta, reaproveitar
 *     a marcada, plano padrão com as mães ligadas.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-moedas-e-assistente.ts
 */
import {
  MOEDAS, MOEDAS_ESTRANGEIRAS, MOEDAS_PTAX_DISPONIVEIS, formatarNaMoeda, infoDaMoeda, moedaDe, planoDaTransferencia,
  saldosEmReais, valorNaMoedaDoTitulo, cambioDaLiquidacao,
} from '../src/lib/cambio.ts';
import {
  catalogoCompleto, comoVemOCambio, conferirMoedaDoCadastro, moedasParaEscolher, sugestaoDaMoeda, validarMoedaDaAgencia,
} from '../src/lib/moedas.ts';
import {
  CATEGORIAS_PADRAO_DOS_TITULOS, chavesSemCategoria, modoDoAssistente, planoDeLigacao, planoPadraoComIdsNovos, planoTemCategoriasProprias,
} from '../src/lib/assistente-inicial.ts';
import { CATEGORIAS_DOS_TITULOS } from '../src/lib/categorias-padrao-titulos.ts';
import { getPlanoContasPadrao } from '../src/lib/crm-types.ts';
import { contaDoTitulo } from '../src/lib/fluxo-comparativo.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

console.log('--- 1. Sem catálogo: o de sempre ---');
eq(MOEDAS.map(m => m.codigo), ['BRL', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'], 'as oito do sistema, na mesma ordem');
eq(MOEDAS_ESTRANGEIRAS.length, 7, 'sete estrangeiras (a consulta da PTAX de sempre)');
eq([moedaDe('ARS'), moedaDe('xyz'), moedaDe('usd'), moedaDe(undefined)], ['BRL', 'BRL', 'USD', 'BRL'], 'sem catálogo, código desconhecido continua real');
eq([formatarNaMoeda(1234.5, 'USD'), formatarNaMoeda(1234.5, 'JPY'), formatarNaMoeda(10, 'BRL')],
  [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(1234.5),
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'JPY' }).format(1234.5),
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(10)],
  'formatação das oito igual à de antes (o iene sem centavos)');
eq(MOEDAS_PTAX_DISPONIVEIS, ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'DKK', 'NOK', 'SEK'], 'PTAX publicada pelo Banco Central (conferida na Olinda)');

console.log('--- 2. Moedas da agência ---');
const ars = sugestaoDaMoeda('ars');
eq([ars?.casas, /peso/i.test(ars?.nome ?? '')], [2, true], 'ARS: sugestão com nome de peso e 2 casas');
eq(sugestaoDaMoeda('CLP')?.casas, 0, 'CLP: o padrão é sem casas');
const kwd = sugestaoDaMoeda('KWD');
eq([kwd?.casas, kwd?.casas_iso], [2, 3], 'KWD: o padrão tem 3 casas; o Financeiro guarda até 2');
eq([sugestaoDaMoeda('XYZ'), sugestaoDaMoeda('AB')], [null, null], 'código fora do padrão ISO: sem sugestão');

const vazio: never[] = [];
eq(validarMoedaDaAgencia({ codigo: 'usd' }, vazio), { ok: false, erro: 'USD já vem pronta no sistema.' }, 'moeda do sistema não se cadastra de novo');
eq(validarMoedaDaAgencia({ codigo: 'XYZ' }, vazio).ok, false, 'código que não é ISO 4217: recusado');
eq(validarMoedaDaAgencia({ codigo: 'A1B' }, vazio).ok, false, 'código com número: recusado');
eq(validarMoedaDaAgencia({ codigo: 'CLP', casas: 3 }, vazio), { ok: false, erro: 'Casas decimais vão de 0 a 2.' }, 'casas acima de 2: recusado');
const clp = validarMoedaDaAgencia({ codigo: ' clp ', nome: '  Peso   chileno ', simbolo: 'CLP$' }, vazio);
eq(clp, { ok: true, moeda: { codigo: 'CLP', nome: 'Peso chileno', simbolo: 'CLP$', casas: 0, ativo: true } }, 'CLP: nome limpo, casas do padrão');
eq(validarMoedaDaAgencia({ codigo: 'CLP' }, [{ codigo: 'CLP', nome: 'x', simbolo: 'x', casas: 0, ativo: true }]).ok, false, 'a mesma moeda duas vezes: recusado');
eq(validarMoedaDaAgencia({ ativo: false }, [{ codigo: 'CLP', nome: 'Peso chileno', simbolo: '$', casas: 0, ativo: true }], 'CLP'),
  { ok: true, moeda: { codigo: 'CLP', nome: 'Peso chileno', simbolo: '$', casas: 0, ativo: false } }, 'editar só a situação mantém o resto');

const cat = catalogoCompleto([
  { codigo: 'DKK', nome: 'Coroa dinamarquesa', simbolo: 'kr', casas: 2, ativo: true },
  { codigo: 'ARS', nome: 'Peso argentino', simbolo: '$', casas: 2, ativo: true },
  { codigo: 'CLP', nome: 'Peso chileno', simbolo: '$', casas: 0, ativo: false },
]);
eq(cat.map(m => m.codigo), ['BRL', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'ARS', 'CLP', 'DKK'], 'catálogo: as oito e as da agência em ordem');
eq([comoVemOCambio(infoDaMoeda('DKK', cat)), comoVemOCambio(infoDaMoeda('ARS', cat)), comoVemOCambio(infoDaMoeda('USD', cat))],
  ['PTAX ao vivo', 'Câmbio digitado', 'Turismo e PTAX ao vivo'], 'cotação ao vivo só para as que a fonte publica');
eq(moedasParaEscolher(cat).map(m => m.codigo).includes('CLP'), false, 'desativada some das escolhas');
eq(moedasParaEscolher(cat, 'CLP').map(m => m.codigo).includes('CLP'), true, '...menos quando é a já gravada');
eq([moedaDe('ars', cat), moedaDe('CLP', cat), moedaDe('MXN', cat)], ['ARS', 'CLP', 'BRL'], 'com catálogo: as da agência (mesmo desativada) valem');
eq(formatarNaMoeda(1234.5, 'CLP', cat), new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(1234.5), 'formata com as casas da moeda');
eq([conferirMoedaDoCadastro('', cat), conferirMoedaDoCadastro('ars', cat), 'erro' in conferirMoedaDoCadastro('MXN', cat)],
  [{ moeda: 'BRL' }, { moeda: 'ARS' }, true], 'cadastro: vazio é real, a da agência vale, a desconhecida é recusada');

const titulo = { moeda: 'ARS', valor_original: 100000, cambio: 0.006 };
eq(valorNaMoedaDoTitulo(titulo, 600), null, 'sem catálogo, título em ARS continua lido como antes (sem valor na moeda)');
eq(valorNaMoedaDoTitulo(titulo, 600, cat), { moeda: 'ARS', valor: 100000, cambio: 0.006 }, 'com catálogo, o título em ARS tem valor na moeda');
const liq = cambioDaLiquidacao({ tabela: 'contas_pagar', titulo, base_reais: 600, valor_baixado: 0, valor: 650, cambio_pago: 0.0065, catalogo: cat });
eq([liq?.moeda, liq?.variacao.resultado], ['ARS', -50], 'liquidação em ARS com câmbio por parcela: variação calculada (perda de R$ 50)');
const tr = planoDaTransferencia({ valor: 1000, moeda_origem: 'BRL', moeda_destino: 'ARS', cambio: 0.005 }, cat);
eq([tr.moeda_destino, tr.valor_destino, tr.erros], ['ARS', 200000, []], 'transferência de reais para ARS');
eq(planoDaTransferencia({ valor: 1000, moeda_origem: 'BRL', moeda_destino: 'ARS' }).moeda_destino, 'BRL', 'sem catálogo: a de sempre');
eq(saldosEmReais([{ id: 'c', moeda: 'ARS', saldo_atual: 1000 }], [], cat)[0].saldo_reais, null, 'conta em ARS sem PTAX: sem valor em reais (nunca outra cotação)');

console.log('--- 3. Assistente inicial ---');
eq(CATEGORIAS_DOS_TITULOS.every(d => CATEGORIAS_PADRAO_DOS_TITULOS[d.chave].tipo === d.tipo), true, 'cada categoria padrão tem o tipo que a conta gerada pede');
eq(modoDoAssistente({ planoProprio: false, temContas: false, faltam: 6, encargosFaltam: 4 }), 'automatico', 'agência nova: roda sozinho');
eq(modoDoAssistente({ planoProprio: true, temContas: false, faltam: 2, encargosFaltam: 0 }), 'oferecer', 'com plano próprio: oferece');
eq(modoDoAssistente({ planoProprio: false, temContas: true, faltam: 2, encargosFaltam: 0 }), 'oferecer', 'com contas lançadas: oferece');
eq(modoDoAssistente({ planoProprio: true, temContas: true, faltam: 0, encargosFaltam: 0 }), 'pronto', 'tudo ligado: não aparece');
const plano = [
  { id: 'a', codigo: '1', tipo: 'RECEITA', ativo: true },
  { id: 'b', codigo: '2', tipo: 'DESPESA', ativo: false },
  { id: 'enc', codigo: '1.6', tipo: 'RECEITA', ativo: true, marca_encargo: 'receita_financeira' },
  { id: 'mt', codigo: '2.5.01', tipo: 'DESPESA', ativo: true, marca_titulo: 'reembolso_pagar' },
];
eq([planoTemCategoriasProprias(plano), planoTemCategoriasProprias(plano.slice(2))], [true, false], 'plano só com as do sistema não é "próprio"');
eq(chavesSemCategoria({ receita_venda: 'a', pagamento_fornecedor: 'b', restituicao: 'sumiu' }, plano),
  ['pagamento_fornecedor', 'fatura_fornecedor', 'reembolso_pagar', 'reembolso_receber', 'restituicao'],
  'falta: sem escolha, escolha desativada ou que sumiu (a válida fica)');
eq(planoDeLigacao(['reembolso_pagar', 'restituicao'], plano), [{ chave: 'reembolso_pagar', reaproveitar: 'mt' }, { chave: 'restituicao', reaproveitar: null }],
  'reaproveita a categoria marcada; cria só a que não existe');
let n = 0;
const novo = planoPadraoComIdsNovos(getPlanoContasPadrao(), () => `n${++n}`);
const ids = new Set(novo.map(c => c.id));
eq([novo.length === getPlanoContasPadrao().length, novo.every(c => c.categoria_pai_id === null || ids.has(c.categoria_pai_id))], [true, true],
  'plano padrão: ids novos e cada mãe aponta para uma categoria que existe');
const porCodigo = new Map(novo.map(c => [c.codigo, c]));
eq(porCodigo.get('2.1.01')?.categoria_pai_id, porCodigo.get('2.1')?.id, 'a mãe de 2.1.01 é 2.1');

console.log('--- 4. Conta previsão por empresa no fluxo ---');
const t = { status: 'PENDENTE', conta_bancaria_id: '', empresa_id: 'loja-b' };
eq([contaDoTitulo(t, 'pagar', null, 'cx-ag'), contaDoTitulo(t, 'pagar', null, 'cx-ag', { 'loja-b': 'cx-b' }),
  contaDoTitulo({ ...t, empresa_id: 'principal' }, 'pagar', null, 'cx-ag', { 'loja-b': 'cx-b' })],
['cx-ag', 'cx-b', 'cx-ag'], 'título da empresa usa a conta previsão dela; sem escolha própria, a da agência');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
