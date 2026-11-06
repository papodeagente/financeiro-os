/**
 * Mudança v2 (E7, 06/11/2026), a parte pura: o dicionário das listas do
 * histórico (e as liquidadas reconhecidas pelo conteúdo), a leitura de cada
 * lista, a venda montada no modelo completo, o ensaio do histórico, a
 * comparação do mês em paralelo e as perguntas que recriam o plano de
 * comissão e a regra de faturamento.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-migracao-historico.ts
 */
import { adivinharLista, sugerirMapeamento, type ListaId } from '../src/lib/migracao/dicionario.ts';
import { interpretarLinha } from '../src/lib/migracao/interpretar.ts';
import { agruparVendas, tipoDoProduto, lerPassageiros } from '../src/lib/migracao/interpretar-historico.ts';
import { indiceVazio } from '../src/lib/migracao/identidade.ts';
import { gravadorDeEnsaio, processarRegistro, type ContextoDoPlano } from '../src/lib/migracao/plano.ts';
import { vendaDoModelo } from '../src/lib/migracao/plano-historico.ts';
import { compararMes, janelaDoMes, type ItemDoMes } from '../src/lib/migracao/comparar-mes.ts';
import { exemploDoPlano, PLANO_EM_BRANCO, planoDasRespostas, REGRA_EM_BRANCO, regraDasRespostas } from '../src/lib/migracao/telas/recriar.ts';
import { normalizarPlano, errosDoPlano } from '../src/lib/comissao-funcoes.ts';
import { normalizarRegra } from '../src/lib/fatura-regras.ts';
import { receitaDaVenda } from '../src/lib/venda-receita.ts';
import { totaisDaVenda } from '../src/lib/venda-modelo.ts';
import type { LinhaPreparada } from '../src/lib/migracao/leitor.ts';

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

/** Interpreta uma linha com o mapeamento sugerido pelos cabeçalhos. */
function ler(lista: ListaId, cab: string[], linha: Array<string | number | null>, opcoes = {}) {
  const map = sugerirMapeamento(cab, lista).mapeamento;
  return interpretarLinha(lista, linha, map, opcoes);
}

console.log('--- Dicionário ---');
const guess = (cab: string[]) => adivinharLista(cab).lista;
eq(guess(['Data', 'Conta', 'Pessoa', 'Descrição', 'Valor']), 'movimentos', 'extrato: Data, Conta, Pessoa, Descrição, Valor');
eq(guess(['Data', 'Número', 'Número Venda', 'Número Fatura', 'Empresa', 'Conta', 'Forma Pagamento', 'Pessoa - Nome', 'Pessoa - CPF/CNPJ', 'Descrição', 'Documento', 'Moeda', 'Movimento', 'Valor']), 'movimentos', 'movimentações (colunas da grade)');
eq(guess(['Venda Nº', 'Data Venda', 'Situação', 'Produto', 'Pagante', 'CPF', 'Fornecedor', 'Passageiros', 'Total Produtos', 'Taxa DU', 'Valor Total']), 'vendas', 'vendas por produto');
eq(guess(['Número', 'Série', 'Data de Emissão', 'Tomador', 'CPF/CNPJ', 'Valor Total Serviços', 'Valor ISS', 'Situação']), 'notas', 'notas emitidas');
eq(guess(['Pessoa', 'Venda Nº', 'Data Venda', 'Pagante', 'Descrição/Produto', 'Valor', 'Valor Retido', 'Pago em']), 'comissoes_pagas', 'comissões pagas');
eq(guess(['Pessoa', 'Função', 'Plano', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']), 'metas', 'metas (12 meses)');
eq(guess(['Pessoa', 'CPF/CNPJ', 'Tipo', 'Venda Nº', 'Valor', 'Prazo', 'Descrição']), 'reembolsos', 'reembolsos em aberto');
eq(guess(['Cliente', 'CPF/CNPJ', 'Saldo', 'Validade', 'Venda de origem']), 'creditos', 'créditos de clientes');
// O que a v1 reconhecia continua igual.
eq(guess(['Pessoa', 'CPF/CNPJ', 'Documento', 'Vencimento', 'Movimento', 'Valor Final', 'Categoria', 'Grupo', 'Parcelas']), 'titulos', 'contas em aberto continuam da v1');
eq(guess(['Conta', 'Saldo', 'Data']), 'saldos', 'saldos continuam da v1');
eq(guess(['Nome', 'Razão social', 'CPF', 'CNPJ', 'E-mail', 'Telefone']), 'pessoas', 'pessoas continuam da v1');

console.log('--- Contas já liquidadas ---');
const cabLiq = ['Pessoa', 'Movimento', 'Documento', 'Vencimento', 'Liquidação', 'Valor Final', 'Juros', 'Conta', 'Forma de pagamento'];
const corte = { dataCorte: '2026-10-31' };
const l1 = ler('liquidados', cabLiq, ['Ana', 'Receber', 'NF 1', '05/10/2026', '07/10/2026', '1.000,00', '20,00', 'Itaú', 'Pix'], corte);
eq(l1.ok && l1.registro.lista === 'liquidados' ? [l1.registro.dados.valor, l1.registro.dados.baixa] : l1,
  [100000, { data: '2026-10-07', conta: 'Itaú', valor: 102000, juros: 2000, multa: 0, desconto: 0, taxa: 0, forma: 'Pix' }], 'liquidada até o corte: a conta e a baixa (com os juros)');
const l2 = ler('liquidados', cabLiq, ['Ana', 'Receber', 'NF 2', '05/11/2026', '06/11/2026', '500,00', '', 'Itaú', ''], corte);
eq(l2.ok ? [l2.registro.lista, (l2.registro.dados as { liquidado_depois_do_corte: string | null }).liquidado_depois_do_corte] : l2, ['titulos', '2026-11-06'], 'liquidada depois do corte: em aberto (regra da v1)');
const l3 = ler('liquidados', cabLiq, ['Ana', 'Receber', 'NF 3', '05/12/2026', '', '300,00', '', '', ''], corte);
eq(l3.ok ? l3.registro.lista : l3, 'titulos', 'sem liquidação: em aberto');
const v1 = ler('titulos', ['Pessoa', 'Movimento', 'Vencimento', 'Liquidação', 'Valor Final'], ['Ana', 'Receber', '05/10/2026', '07/10/2026', '1.000,00'], corte);
eq(v1.ok ? v1 : [v1.codigo, v1.motivo.includes('Contas já liquidadas')], ['liquidado', true], 'na lista da v1, a liquidada continua de fora e diz como trazer');

console.log('--- Extrato ---');
const cabMov = ['Data', 'Conta', 'Pessoa', 'Descrição', 'Valor'];
const m1 = ler('movimentos', cabMov, ['20/10/2026', 'Itaú', '', 'Tarifa', '-35,90'], corte);
eq(m1.ok && m1.registro.lista === 'movimentos' ? [m1.registro.dados.valor, m1.registro.dados.entrada] : m1, [3590, false], 'valor negativo é saída');
const m2 = ler('movimentos', ['Data', 'Conta', 'Movimento', 'Valor'], ['20/10/2026', 'Itaú', 'Crédito', '10,00'], corte);
eq(m2.ok && m2.registro.lista === 'movimentos' ? m2.registro.dados.entrada : m2, true, 'coluna Crédito/Débito decide o lado');
const m3 = ler('movimentos', cabMov, ['03/11/2026', 'Itaú', '', 'x', '10,00'], corte);
eq(m3.ok ? m3 : m3.codigo, 'depois_do_corte', 'depois do corte: fora, com o motivo');

console.log('--- Vendas ---');
eq(['Aéreo', 'Hotel', 'Pacote Nordeste', 'Seguro viagem', 'Locação de carro', 'Transfer', 'Ingresso parque', 'Cruzeiro', 'Bilhete agência', 'Outro'].map(tipoDoProduto),
  ['AEREO', 'HOSPEDAGEM', 'PACOTE', 'SEGURO', 'LOCACAO', 'RECEPTIVO', 'INGRESSO', 'CRUZEIRO', 'AEREO_AGENCIA', 'OUTROS'], 'tipo do produto pelo nome');
eq(lerPassageiros('Maria Souza, João Souza; Ana'), ['Maria Souza', 'João Souza', 'Ana'], 'passageiros separados');
const cabV = ['Venda Nº', 'Data Venda', 'Produto', 'Pagante', 'CPF', 'Fornecedor', 'Passageiros', 'Total Produtos', 'Total Taxas', 'Taxa DU', 'Comissão', 'Desconto', 'Valor Total', 'Receitas'];
const p1 = ler('vendas', cabV, ['900', '01/10/2026', 'Hospedagem', 'Maria', '123.456.789-09', 'Hotel Sol', 'Maria, João', '1.000,00', '0', '0', '100,00', '0', '1.000,00', '100,00']);
const p2 = ler('vendas', cabV, ['900', '01/10/2026', 'Aéreo', 'Maria', '', 'Cia', 'Maria', '700,00', '80,00', '20,00', '0', '10,00', '790,00', '10,00']);
const lidos = [p1, p2].map((p, i) => ({ linha: i + 2, dados: (p as { registro: { dados: never } }).registro.dados }));
const agrupadas = agruparVendas(lidos);
const v = agrupadas.get('900')!;
eq([agrupadas.size, v.produtos.length, v.cliente.documento, v.linhas], [1, 2, '12345678909', [2, 3]], 'as linhas com o mesmo Venda Nº formam uma venda');
const indice = indiceVazio();
const cliente = { id: 'c1', papel: 'cliente' as const, nome: 'Maria', razao_social: '', documento: '12345678909', email: '', telefones: [], doLote: true };
const forn = new Map([['hotel sol', { ...cliente, id: 'f1', papel: 'fornecedor' as const, nome: 'Hotel Sol', documento: '' }]]);
const montada = vendaDoModelo(v, cliente, forn, 'venda:900');
const t = totaisDaVenda(montada.venda);
eq([montada.erros, montada.avisos, montada.venda.origem, montada.venda.pagamentos.length, t.valor_cliente], [[], [], 'mudanca', 0, 179000], 'venda no modelo: origem mudança, sem pagamentos (nenhuma conta nasce), total certo');
eq(montada.venda.produtos[0].passageiros.map(x => [x.nome, x.tarifa_centavos]), [['Maria', 50000], ['João', 50000]], 'tarifa repartida pelos passageiros');
eq(receitaDaVenda(montada.venda).receita, 11000, 'receita pelos componentes: comissão 100 + Taxa DU 20 − desconto 10');
eq(montada.venda.produtos[0].fornecedor?.id, 'f1', 'fornecedor ligado ao cadastro');
const errada = vendaDoModelo({ ...v, produtos: [{ ...v.produtos[0], valor_total: 99900 }] }, cliente, forn, 'venda:900');
eq(errada.avisos.length, 1, 'valor total diferente do de lá: aviso para conferir');

console.log('--- Ensaio do histórico (gravador de ensaio) ---');
const ctx: ContextoDoPlano = { dataCorte: '2026-10-31', chavesDoLote: new Map(), saldosDoLote: new Set() };
const g = gravadorDeEnsaio();
const o = (linha: number) => ({ lote_id: 'L', arquivo_id: 'A', arquivo: 'x.xlsx', linha, etapa: 6 });
indice.contas.push({ id: 'cb', nome: 'Itaú', banco: '', agencia: '', numero: '', temMovimento: false, doLote: false });
const dLiq = await processarRegistro((l1 as { registro: never }).registro, {}, indice, ctx, g, o(2));
eq([dLiq.resultado, indice.baixas.length, indice.baixas[0]?.valor], ['criar', 1, 102000], 'liquidada: cria a conta e a baixa');
const dLiq2 = await processarRegistro((l1 as { registro: never }).registro, {}, indice, ctx, g, o(3));
eq([dLiq2.resultado, dLiq2.codigo], ['recusar', 'duplicado_no_arquivo'], 'a mesma liquidada duas vezes: só uma');
const mov = ler('movimentos', cabMov, ['07/10/2026', 'Itaú', 'Ana', 'Recebimento', '1.020,00'], corte);
const dMov = await processarRegistro((mov as { registro: never }).registro, {}, indice, ctx, g, o(4));
eq([dMov.resultado, dMov.alvo_tabela], ['vincular', 'baixas'], 'o extrato que já é baixa se liga a ela (não duplica)');
const mov2 = ler('movimentos', cabMov, ['25/10/2026', 'Itaú', '', 'Transferência para a poupança', '-100,00'], corte);
eq((await processarRegistro((mov2 as { registro: never }).registro, {}, indice, ctx, g, o(5))).codigo, 'transferencia', 'transferência entre contas fica de fora');

console.log('--- Mês em paralelo ---');
const item = (p: Partial<ItemDoMes>): ItemDoMes => ({
  ref: 'x', movimento: 'receber', pessoa: 'Ana', documento: '', valor: 10000, vencimento: '2026-11-10', liquidacao: null, conta: 'Itaú', categoria: 'Pacotes', descricao: '', numero_documento: '', ...p,
});
const la = [
  item({ ref: 'bate' }),
  item({ ref: 'data', pessoa: 'Bia', liquidacao: '2026-11-12' }),
  item({ ref: 'valor', pessoa: 'Caio', valor: 12000 }),
  item({ ref: 'so_la', pessoa: 'Duda', movimento: 'pagar', categoria: 'Hotel' }),
];
const aqui = [
  item({ ref: 'bate' }),
  item({ ref: 'data', pessoa: 'Bia', liquidacao: null }),
  item({ ref: 'valor', pessoa: 'Caio', valor: 11000 }),
  item({ ref: 'so_aqui', pessoa: 'Eva', vencimento: '2026-11-20' }),
  item({ ref: 'outro mes', pessoa: 'Fábio', vencimento: '2026-12-05' }),
];
const s = compararMes(la, aqui, '2026-11', 'contas');
eq(s.contagem, { bate: 1, data: 1, valor: 1, so_la: 1, so_aqui: 1 }, 'cada tipo de diferença (o do mês seguinte não conta como "só aqui")');
eq(s.pares.find(p => p.tipo === 'data')?.detalhe, 'liquidado lá em 12/11/2026, em aberto aqui', 'a diferença de data diz o que mudou');
eq(s.pares.find(p => p.tipo === 'valor')?.diferenca, 1000, 'a diferença de valor em centavos');
eq([s.total.anterior, s.total.enturos], [10000 + 10000 + 12000 - 10000, 10000 + 10000 + 11000 + 10000], 'totais do mês (recebido − pago)');
eq(s.por_categoria.map(gp => [gp.rotulo, gp.diferenca]).sort(), [['Hotel', -10000], ['Pacotes', -9000]].sort(), 'totais por categoria');
eq(s.por_pessoa.find(gp => gp.rotulo === 'Caio')?.diferenca, 1000, 'totais por pessoa');
eq(janelaDoMes('2026-01'), { de: '2025-12-01', ate: '2026-03-01' }, 'a janela de busca pega o mês vizinho');

console.log('--- Recriar: plano de comissão ---');
const r = { ...PLANO_EM_BRANCO, nome: 'Plano dos consultores', percentual: 10, por_produto: [{ produto: 'SEGURO' as const, percentual: 20 }], faixas: [{ a_partir: 100, percentual: 12 }], com_intermediario: 5 };
const pl = planoDasRespostas(r);
const normal = normalizarPlano(pl.plano);
eq([pl.erros, errosDoPlano(normal), normal.faixas.map(f => f.percentual_meta)], [[], [], [0, 100]], 'o plano sai no formato que as telas da E5 gravam, sem erro');
eq(normal.faixas[1].regras.map(x => [x.produto, x.calculo.percentual, x.com_intermediario?.percentual]), [['*', 12, 6], ['SEGURO', 24, 6]], 'na faixa de cima, os produtos sobem na mesma proporção');
eq(normal.faixas[0].regras[0].calculo.sobre, ['RECEITA'], 'sobre a receita da agência');
eq(pl.frases.includes('Seguro viagem paga 20%.'), true, 'o resumo em frases');
eq(planoDasRespostas({ ...PLANO_EM_BRANCO }).erros, ['Dê um nome ao plano (ex.: "Plano dos consultores").'], 'sem nome não grava');
eq(exemploDoPlano(r).replace(/\s/g, ' ').includes('R$ 150,00'), true, 'exemplo: 10% de R$ 1.500 de receita = R$ 150');

console.log('--- Recriar: regra de faturamento ---');
const rg = regraDasRespostas({ ...REGRA_EM_BRANCO, pessoa: { id: 'c1', nome: 'Empresa X' }, periodo: 'SEMANAL_IATA', prazo_dias: 7 });
const nr = normalizarRegra(rg.regra);
eq([rg.erros, nr.erros, nr.regra.pessoa_tipo, nr.regra.periodo, nr.regra.prazo_dias, nr.regra.considerar_feriados], [[], [], 'CLIENTE', 'SEMANAL_IATA', 7, true], 'a regra sai no formato da tela de Regras de faturamento');
eq(regraDasRespostas(REGRA_EM_BRANCO).erros, ['Escolha o cliente da regra.'], 'sem cliente não grava');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
