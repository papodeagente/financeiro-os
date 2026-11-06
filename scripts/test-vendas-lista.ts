/**
 * A lista de vendas (/vendas), lógica pura: a linha de cada venda, os
 * filtros (fornecedor, tipo, vendedor, unidade, situação, busca), as
 * escolhas dos filtros, o resumo e a exportação com e sem o ganho da agência.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-vendas-lista.ts
 */
import { normalizarVenda } from '../src/lib/venda-modelo.ts';
import { matrizParaExportar } from '../src/lib/relatorios-vendas.ts';
import {
  SEM, colunasDaExportacao, filtrarLinhas, linhaDaVenda, linhaParaTela, linhasParaExportar, opcoesDaLista, resumoDaLista,
} from '../src/lib/vendas-lista.ts';
import type { VendaLida } from '../src/lib/vendas-leitura.ts';

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

const lida = (o: Record<string, unknown>, extra: Partial<VendaLida> = {}): VendaLida => {
  const venda = normalizarVenda(o).venda;
  return { venda, status: 'CONFIRMADO', cancelada: false, situacao: 'ABERTA', versao_modelo: 2, pagamentos: venda.pagamentos, ...extra };
};

const vendas = [
  lida({
    id: 'a', numero: 'VND-1', data_venda: '2026-10-02', origem: 'crm', cliente: { id: 'c1', nome: 'Carla Dias' }, vendedor: { id: 'u1', nome: 'Bia' }, centro_custo: 'Matriz',
    produtos: [
      { id: 'p1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', localizador: 'HM123', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' }, quantidade: 1, valor_unitario_centavos: 100000,
        componentes: [{ tipo: 'COMISSAO', valor_centavos: 10000 }, { tipo: 'RAV', valor_centavos: 3000 }] },
      { id: 'p2', tipo: 'AEREO', descricao: 'Voo', fornecedor: { id: '', nome: 'Cia Azul' }, representante: { id: 'r-cons', nome: 'Consolidadora' },
        passageiros: [{ id: 'x1', nome: 'João Ávila', tarifa_centavos: 50000 }], componentes: [{ tipo: 'TAXA_DU', valor_centavos: 4000 }] },
    ],
  }),
  lida({
    id: 'b', numero: 'VND-2', data_venda: '2026-11-04', cliente: { id: 'c2', nome: 'Davi' }, vendedor: { id: 'u2', nome: 'Leo' },
    produtos: [{ id: 'p3', tipo: 'SEGURO', descricao: 'Seguro', fornecedor: { id: 'f-seg', nome: 'Segura' }, quantidade: 2, valor_unitario_centavos: 10000, componentes: [{ tipo: 'MARKUP', valor_centavos: 4000 }] }],
  }, { situacao: 'FECHADA' }),
  lida({
    id: 'c', numero: 'VND-3', data_venda: '2026-11-05', cliente: { id: 'c3', nome: 'Eva' },
    produtos: [{ id: 'p4', tipo: 'HOSPEDAGEM', descricao: 'Pousada', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' }, quantidade: 1, valor_unitario_centavos: 30000 }],
  }, { cancelada: true, status: 'CANCELADO' }),
];

const linhas = vendas.map(v => linhaDaVenda(v));
const [a, b, c] = linhas;

// ---- A linha ----
eq([a.numero, a.cliente, a.vendedor, a.unidade, a.situacao, a.origem], ['VND-1', 'Carla Dias', 'Bia', 'Matriz', 'ABERTA', 'crm'], 'linha: cabeçalho da venda');
eq(a.fornecedores, [{ chave: 'id:f-hotel', nome: 'Hotel Mar' }, { chave: 'nome:cia azul', nome: 'Cia Azul' }, { chave: 'id:r-cons', nome: 'Consolidadora' }], 'linha: fornecedores e representante, sem repetir; sem id vale o nome');
eq(a.tipos, ['HOSPEDAGEM', 'AEREO'], 'linha: tipos de produto');
eq(a.localizadores, ['HM123'], 'linha: localizadores');
eq(a.passageiros, 1, 'linha: passageiros ativos');
eq(a.faturamento, 100000 + 3000 + 50000 + 4000, 'linha: faturamento = o que o cliente paga');
eq(a.receita, 10000 + 3000 + 4000, 'linha: receita da agência pela regra');
eq(a.percentual_receita, Math.round((17000 / 157000) * 10000) / 100, 'linha: % de receita');
eq([b.situacao, c.situacao], ['FECHADA', 'CANCELADA'], 'linha: fechada e cancelada');
eq([b.vendedor, c.vendedor, c.vendedor_chave], ['Leo', 'Sem vendedor', ''], 'linha: sem vendedor');
const semGanho = linhaDaVenda(vendas[0], undefined, false);
eq([semGanho.receita, semGanho.percentual_receita], [null, null], 'linha: sem o direito, a receita nem é calculada');
eq(linhaParaTela(a, false).receita, null, 'tela: sem o direito, a receita não vai');

// ---- Filtros ----
const ids = (ls: typeof linhas) => ls.map(l => l.venda_id);
eq(ids(filtrarLinhas(linhas, {})), ['a', 'b', 'c'], 'filtro vazio deixa tudo');
eq(ids(filtrarLinhas(linhas, { fornecedor: 'id:f-hotel' })), ['a', 'c'], 'filtro: fornecedor');
eq(ids(filtrarLinhas(linhas, { fornecedor: 'id:r-cons' })), ['a'], 'filtro: representante conta como fornecedor');
eq(ids(filtrarLinhas(linhas, { tipo: 'SEGURO' })), ['b'], 'filtro: tipo de produto');
eq(ids(filtrarLinhas(linhas, { vendedor: 'u1' })), ['a'], 'filtro: vendedor');
eq(ids(filtrarLinhas(linhas, { vendedor: SEM })), ['c'], 'filtro: sem vendedor');
eq(ids(filtrarLinhas(linhas, { unidade: 'Matriz' })), ['a'], 'filtro: unidade');
eq(ids(filtrarLinhas(linhas, { unidade: SEM })), ['b', 'c'], 'filtro: sem unidade');
eq(ids(filtrarLinhas(linhas, { situacao: 'ATIVAS' })), ['a', 'b'], 'filtro: sem as canceladas');
eq(ids(filtrarLinhas(linhas, { situacao: 'FECHADA' })), ['b'], 'filtro: fechadas');
eq(ids(filtrarLinhas(linhas, { situacao: 'CANCELADA' })), ['c'], 'filtro: canceladas');
eq(ids(filtrarLinhas(linhas, { busca: 'joao avila' })), ['a'], 'busca: passageiro sem acento, todas as palavras');
eq(ids(filtrarLinhas(linhas, { busca: 'hm123' })), ['a'], 'busca: localizador');
eq(ids(filtrarLinhas(linhas, { busca: 'vnd-2' })), ['b'], 'busca: número');
eq(ids(filtrarLinhas(linhas, { busca: 'carla eva' })), [], 'busca: exige todas as palavras');
eq(ids(filtrarLinhas(linhas, { tipo: 'HOSPEDAGEM', situacao: 'ATIVAS', fornecedor: 'id:f-hotel' })), ['a'], 'filtros juntos');

// ---- Escolhas dos filtros ----
const op = opcoesDaLista(linhas);
eq(op.fornecedores.map(o => o.rotulo), ['Cia Azul', 'Consolidadora', 'Hotel Mar', 'Segura'], 'escolhas: fornecedores em ordem');
eq(op.tipos.map(o => o.valor), ['AEREO', 'HOSPEDAGEM', 'SEGURO'], 'escolhas: só os tipos que existem, na ordem do mercado');
eq(op.vendedores, [{ valor: 'u1', rotulo: 'Bia' }, { valor: 'u2', rotulo: 'Leo' }, { valor: SEM, rotulo: 'Sem vendedor' }], 'escolhas: vendedores e "sem vendedor"');
eq(op.unidades, [{ valor: 'Matriz', rotulo: 'Matriz' }, { valor: SEM, rotulo: 'Sem unidade' }], 'escolhas: unidades e "sem unidade"');

// ---- Resumo ----
const r = resumoDaLista(linhas, true);
eq([r.vendas, r.faturamento, r.ticket_medio, r.receita], [2, 157000 + 24000, Math.round(181000 / 2), 17000 + 4000], 'resumo: canceladas ficam fora');
eq(resumoDaLista(linhas, false).receita, null, 'resumo: sem o direito, sem receita');

// ---- Exportação ----
const comGanho = matrizParaExportar(colunasDaExportacao(true), linhasParaExportar([a], true));
eq(comGanho[0].includes('Receita da agência'), true, 'exportação: com o direito sai a receita');
eq(comGanho[1].slice(0, 4), ['VND-1', '02/10/2026', 'Aberta', 'Carla Dias'], 'exportação: data em dd/mm/aaaa e situação por extenso');
eq(comGanho[1][comGanho[0].indexOf('Faturamento')], 1570, 'exportação: dinheiro em reais');
const semDireito = matrizParaExportar(colunasDaExportacao(false), linhasParaExportar([a], false));
eq([semDireito[0].includes('Receita da agência'), semDireito[0].includes('% de receita')], [false, false], 'exportação: sem o direito, nem a coluna');
eq(semDireito[1][semDireito[0].indexOf('Fornecedores')], 'Hotel Mar, Cia Azul, Consolidadora', 'exportação: fornecedores juntos');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
