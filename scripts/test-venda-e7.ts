/**
 * Venda e fornecedor no fechamento de paridade (E7), lógica pura:
 *   - Abatimento do fornecedor baixa os dois lados e não mexe na receita;
 *   - base do Over (tarifa, tarifa com taxas, comissão);
 *   - taxa do cartão da agência: congelada da forma, acompanha o valor, sai
 *     da receita numa linha própria (configurável) e decide o vencimento;
 *   - campos do cheque e do cartão (nunca o número inteiro do cartão);
 *   - "Outros" com a forma própria da agência; operação própria;
 *   - liquidar sozinho: quais contas entram;
 *   - conta avulsa: leitura do pedido; cópia do produto.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-venda-e7.ts
 */
import {
  basePercentualDoComponente, congelarTaxaDoCartao, diariasEntre, normalizarPagamento, normalizarVenda, taxaDoCartao,
  taxaDoCartaoIndefinida, textoDosCampos, totaisDoProduto, vencimentoDaParcela,
} from '../src/lib/venda-modelo.ts';
import { receitaDaVenda, normalizarConfigReceita } from '../src/lib/venda-receita.ts';
import { contasDaVenda } from '../src/lib/venda-contas.ts';
import { contasParaLiquidar, normalizarLiquidar } from '../src/lib/venda-liquidar-auto.ts';
import { normalizarAvulsa, partesDoAcerto } from '../src/lib/venda-avulsas-modelo.ts';

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

const HOJE = '2026-11-06';
const venda = (o: Record<string, unknown> = {}) => normalizarVenda({
  id: 'v7', numero: 'VND-0700', data_venda: '2026-11-01', cliente: { id: 'c1', nome: 'Ana' },
  produtos: [{
    id: 'p1', tipo: 'HOSPEDAGEM', descricao: 'Hotel', fornecedor: { id: 'f1', nome: 'Hotel Mar' },
    passageiros: [{ id: 'a', nome: 'Ana', tarifa_centavos: 100000, taxas_centavos: 10000 }],
    componentes: [{ id: 'cm', tipo: 'COMISSAO', percentual: 10 }],
  }],
  ...o,
}).venda;

console.log('--- Abatimento do fornecedor ---');
{
  const v = venda({ produtos: [{
    id: 'p1', tipo: 'HOSPEDAGEM', fornecedor: { id: 'f1', nome: 'Hotel Mar' },
    passageiros: [{ id: 'a', nome: 'Ana', tarifa_centavos: 100000, taxas_centavos: 10000 }],
    componentes: [{ id: 'cm', tipo: 'COMISSAO', valor_centavos: 10000 }, { id: 'ab', tipo: 'ABATIMENTO', valor_centavos: 5000 }],
  }] });
  const t = totaisDoProduto(v.produtos[0]);
  eq([t.valor_cliente, t.valor_fornecedor, t.receita_bruta], [105000, 95000, 10000], 'cliente paga 50 a menos, fornecedor recebe 50 a menos, receita igual');
  const r = receitaDaVenda(v);
  eq([r.receita, r.linhas.map(l => l.tipo)], [10000, ['COMISSAO']], 'o abatimento não aparece como linha de receita');
  const c = contasDaVenda({ versao: 2, venda: v, hoje: HOJE });
  eq([c.contas_receber[0].valor_final, c.contas_pagar[0].valor_final], [1050, 950], 'as contas seguem os dois lados');
}

console.log('--- Base do Over ---');
{
  const prod = (base?: string) => venda({ produtos: [{
    id: 'p1', tipo: 'PACOTE', fornecedor: { id: 'f1', nome: 'Operadora' },
    passageiros: [{ id: 'a', nome: 'Ana', tarifa_centavos: 100000, taxas_centavos: 20000 }],
    componentes: [{ id: 'cm', tipo: 'COMISSAO', percentual: 10 }, { id: 'ov', tipo: 'OVER', percentual: 5, ...(base ? { base } : {}) }],
  }] }).produtos[0];
  eq(prod().componentes.map(c => c.valor_centavos), [10000, 5000], 'sem base: over sobre a tarifa (como sempre)');
  eq(prod('TARIFA_TAXAS').componentes.map(c => c.valor_centavos), [10000, 6000], 'over sobre a tarifa com as taxas');
  eq(prod('COMISSAO').componentes.map(c => c.valor_centavos), [10000, 500], 'over sobre a comissão');
  eq(prod('COMISSAO').componentes[1].base, 'COMISSAO', 'a base fica guardada');
  eq(prod('XYZ').componentes[1].base, undefined, 'base desconhecida volta à tarifa');
  const p = prod('COMISSAO');
  eq(basePercentualDoComponente(p, p.componentes[1]), 10000, 'a tela calcula a mesma base');
  const comissao = venda({ produtos: [{ id: 'p1', tipo: 'PACOTE', passageiros: [{ id: 'a', nome: 'A', tarifa_centavos: 100000 }], componentes: [{ id: 'cm', tipo: 'COMISSAO', percentual: 10, base: 'COMISSAO' }] }] }).produtos[0];
  eq([comissao.componentes[0].valor_centavos, comissao.componentes[0].base], [10000, undefined], 'só o Over escolhe a base');
}

console.log('--- Taxa do cartão da agência ---');
{
  const forma = { taxa_pct: 3.5, taxa_fixa: 0.5, dias_para_cair: 30 };
  const pag = normalizarPagamento({ forma: 'CARTAO', valor_centavos: 110000, parcelas: 2 }, 0)!;
  eq(taxaDoCartaoIndefinida(pag), true, 'pagamento novo: taxa indefinida');
  const cong = congelarTaxaDoCartao(pag, forma);
  eq([cong.taxa_cartao_percentual, cong.taxa_cartao_fixa_centavos, cong.dias_para_cair, taxaDoCartao(cong)], [3.5, 50, 30, 3900], 'congelada da forma: 3,5% + R$ 0,50 = R$ 39,00; cai em 30 dias');
  eq(taxaDoCartao({ ...cong, valor_centavos: 50000 }), 1800, 'a taxa acompanha o valor do pagamento');
  eq(congelarTaxaDoCartao(cong, { taxa_pct: 9, taxa_fixa: 0, dias_para_cair: 2 }), cong, 'já congelada: mudar a forma depois não muda a venda');
  eq(taxaDoCartao({ ...cong, taxa_cartao_centavos: 1234 }), 1234, 'taxa digitada à mão vale');
  eq(congelarTaxaDoCartao(pag, { taxa_pct: 0, taxa_fixa: 0, dias_para_cair: 0 }).dias_para_cair, undefined, 'forma sem dias não mexe no vencimento de sempre');
  eq(taxaDoCartao(normalizarPagamento({ forma: 'PIX', valor_centavos: 1000, taxa_cartao_percentual: 5 }, 0)!), 0, 'só cartão tem taxa');
  eq([vencimentoDaParcela(cong, '2026-11-01', 1), vencimentoDaParcela(cong, '2026-11-01', 2)], ['2026-12-01', '2027-01-01'], 'vencimentos pelos dias da forma, depois de mês em mês');
  eq(vencimentoDaParcela({ ...cong, dias_para_cair: 2 }, '2026-11-01', 1), '2026-11-03', 'débito que cai em 2 dias');
  eq(vencimentoDaParcela(pag, '2026-11-01', 1), '2026-12-01', 'sem dias: o de sempre (um mês)');

  const v = venda({ pagamentos: [cong] });
  const r = receitaDaVenda(v);
  eq([r.taxa_cartao, r.receita], [{ valor: 3900, entra: true }, 10000 - 3900], 'a taxa sai da receita, numa linha própria');
  const r2 = receitaDaVenda(v, normalizarConfigReceita({ taxa_cartao: false }));
  eq([r2.receita, r2.fora_da_receita, r2.taxa_cartao.entra], [10000, -3900, false], 'desligada em Configurações: fica fora da receita');
  eq(normalizarConfigReceita({}).taxa_cartao, true, 'padrão: a taxa sai da receita');
  const c = contasDaVenda({ versao: 2, venda: v, hoje: HOJE });
  eq(c.contas_receber.map(x => [x.valor_final, x.data_vencimento, x.taxa_cartao_prevista]), [[550, '2026-12-01', 19.5], [550, '2027-01-01', 19.5]], 'o cliente paga o mesmo; cada parcela leva a taxa prevista');
}

console.log('--- Campos do cheque e do cartão ---');
{
  const car = normalizarPagamento({ forma: 'CARTAO', valor_centavos: 1000, campos: { final_cartao: '4111 1111 1111 1234', bandeira: 'Visa', autorizacao: '99', banco: 'x' } }, 0)!;
  eq(car.campos, { autorizacao: '99', bandeira: 'Visa', final_cartao: '1234' }, 'cartão: só os 4 últimos números; campo de cheque ignorado');
  const che = normalizarPagamento({ forma: 'CHEQUE', valor_centavos: 1000, campos: { banco: 'Itaú', numero_cheque: '000123', emitente_documento: '123.456.789-00 ', final_cartao: '1234' } }, 0)!;
  eq(che.campos, { banco: 'Itaú', numero_cheque: '000123', emitente_documento: '123.456.789-00' }, 'cheque: banco, número e emitente');
  eq(textoDosCampos(che.campos), 'Itaú · nº 000123 · emitente 123.456.789-00', 'texto curto dos campos');
  const v = venda({ pagamentos: [che] });
  eq(contasDaVenda({ versao: 2, venda: v, hoje: HOJE }).contas_receber[0].observacoes, 'Itaú · nº 000123 · emitente 123.456.789-00', 'os campos vão para a observação da conta');
  eq(normalizarPagamento({ forma: 'PIX', valor_centavos: 1000, campos: { banco: 'x' } }, 0)!.campos, undefined, 'outras formas não guardam campos');
}

console.log('--- Outros com a forma da agência ---');
{
  const v = venda({ pagamentos: [{ forma: 'OUTROS', valor_centavos: 110000, forma_agencia: 'vale_viagem' }] });
  eq(v.pagamentos[0].forma_agencia, 'VALE_VIAGEM', 'código da forma própria guardado');
  eq(contasDaVenda({ versao: 2, venda: v, hoje: HOJE }).contas_receber[0].forma_recebimento, 'VALE_VIAGEM', 'a conta a receber leva a forma própria');
  eq(contasDaVenda({ versao: 2, venda: venda({ pagamentos: [{ forma: 'OUTROS', valor_centavos: 110000 }] }), hoje: HOJE }).contas_receber[0].forma_recebimento, 'OUTROS', 'sem forma própria: Outros, como sempre');
}

console.log('--- Operação própria ---');
{
  const semForn = (op: boolean) => venda({ operacao_propria: op, produtos: [{ id: 'p1', tipo: 'PACOTE', passageiros: [{ id: 'a', nome: 'A', tarifa_centavos: 100000 }], componentes: [{ id: 'mk', tipo: 'MARKUP', valor_centavos: 20000 }] }] });
  const comum = contasDaVenda({ versao: 2, venda: semForn(false), hoje: HOJE });
  eq([comum.contas_pagar.length, comum.avisos.some(a => a.codigo === 'PRODUTO_SEM_FORNECEDOR')], [1, true], 'venda comum: conta a pagar marcada para preencher');
  const propria = contasDaVenda({ versao: 2, venda: semForn(true), hoje: HOJE });
  eq([propria.contas_pagar.length, propria.avisos.some(a => a.codigo === 'PRODUTO_SEM_FORNECEDOR'), propria.contas_receber[0].valor_final], [0, false, 1200], 'operação própria: sem conta a pagar a ninguém; o cliente paga igual');
  eq(semForn(true).operacao_propria, true, 'a marca fica na venda');
}

console.log('--- Produtos removidos e diárias ---');
{
  const v = venda({ produtos_removidos: [{ id: 'px', tipo: 'SEGURO', quantidade: 1, valor_unitario_centavos: 9000 }] });
  eq([v.produtos_removidos?.length, contasDaVenda({ versao: 2, venda: v, hoje: HOJE }).contas_receber.reduce((a, c) => a + c.valor_final, 0)], [1, 1100], 'produto removido fica guardado e não entra em conta nenhuma');
  eq([diariasEntre('2026-12-20', '2026-12-24'), diariasEntre('2026-12-20', ''), diariasEntre('2026-12-24', '2026-12-20')], [4, 0, 0], 'diárias pelas datas');
}

console.log('--- Liquidar sozinho ---');
{
  const cfg = normalizarLiquidar({ DINHEIRO: { ligado: true, conta_bancaria_id: 'caixa' }, CHEQUE: { ligado: true, conta_bancaria_id: '' } });
  eq([cfg.DINHEIRO.ligado, cfg.CHEQUE.ligado], [true, false], 'sem conta, a regra não liga');
  const conta = (o: Record<string, unknown>) => ({ id: 'x', venda_forma: 'DINHEIRO', venda_modelo: 2, auto_gerado: true, status: 'PENDENTE', data_vencimento: '2026-11-01', valor_final: 100, forma_recebimento: 'DINHEIRO', ...o });
  eq(contasParaLiquidar([conta({})], cfg, HOJE).map(c => [c.id, c.conta_bancaria_id, c.data, c.valor]), [['x', 'caixa', '2026-11-01', 100]], 'dinheiro vencido: liquida na conta padrão, na data do vencimento');
  eq(contasParaLiquidar([conta({ conta_bancaria_id: 'outra' })], cfg, HOJE)[0].conta_bancaria_id, 'outra', 'a conta prevista no pagamento vence a padrão');
  eq(contasParaLiquidar([
    conta({ data_vencimento: '2026-12-01' }), conta({ status: 'RECEBIDO' }), conta({ venda_modelo: undefined }), conta({ auto_gerado: false }),
    conta({ venda_forma: 'PIX' }), conta({ venda_forma: 'CHEQUE' }), conta({ valor_recebido: 10 }),
  ], cfg, HOJE).length, 0, 'futuro, baixado, venda de antes, avulsa, outra forma, regra desligada ou com recebimento: nada');
}

console.log('--- Conta avulsa ---');
{
  const { pedido, erros } = normalizarAvulsa({ tipo: 'pagamento_fornecedor', pessoa: { id: 'f1', nome: 'Hotel' }, valor_centavos: 30000 }, HOJE);
  eq([erros.length, pedido.vencimento, pedido.valor_centavos], [0, HOJE, 30000], 'pagamento ao fornecedor: vence hoje se não disser');
  eq(normalizarAvulsa({ tipo: 'receber', pessoa: { id: 'c1' }, valor_centavos: 100 }, HOJE).pedido.vencimento, '2026-11-13', 'a receber: uma semana');
  eq(normalizarAvulsa({ tipo: 'x', valor_centavos: 0 }, HOJE).erros.map(e => e.campo), ['tipo', 'pessoa', 'valor_centavos'], 'pede tipo, pessoa e valor');
  const v = venda({ produtos: [
    { id: 'p1', tipo: 'AEREO', fornecedor: { id: 'cia', nome: 'Cia' }, representante: { id: 'cons', nome: 'Consolidadora' }, quantidade: 1, valor_unitario_centavos: 1000 },
    { id: 'p2', tipo: 'HOSPEDAGEM', fornecedor: { id: 'f1', nome: 'Hotel' }, quantidade: 1, valor_unitario_centavos: 1000 },
  ] });
  eq(partesDoAcerto(v).map(p => p.id), ['cons', 'f1'], 'o pagamento avulso vai para quem a venda acerta (representante, senão fornecedor)');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
