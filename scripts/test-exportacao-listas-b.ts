/**
 * Exportação (E7, G3) nas listas: Extrato de conta e Movimentações,
 * relatórios por categoria / centro de custo / rateio, Reembolsos, Crédito
 * do cliente e Resultado por categoria (tabela dinâmica). Cada tela monta o
 * MESMO documento do módulo único; aqui se confere colunas, filtros por
 * extenso (que vão no nome do arquivo), totais e unidade do dinheiro.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-exportacao-listas-b.ts
 */
import { matrizDoDocumento, nomeDoArquivo, type DocumentoExportado } from '../src/lib/exportacao/documento.ts';
import { documentoDosMovimentos, type FiltroDeMovimentos, type MovimentoCaixa } from '../src/lib/movimentos-caixa.ts';
import { documentoDasLinhas, filtrosLegiveis, lerFiltros, type LinhaLancamento } from '../src/lib/lancamentos-por-dimensao.ts';
import { documentoDosCreditos, documentoDosReembolsos } from '../src/lib/exportacao/reembolsos-e-creditos.ts';
import { documentoDaTabelaDinamica } from '../src/lib/exportacao/tabela-dinamica.ts';
import { montarTabelaDinamica } from '../src/lib/tabela-dinamica.ts';
import type { Reembolso } from '../src/lib/reembolsos-servidor.ts';
import type { CarteiraDoCliente } from '../src/lib/credito-cliente-servidor.ts';

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
const ids = (d: DocumentoExportado) => d.colunas.map(c => c.id);

// ── Extrato de conta e Movimentações ───────────────────────────────────────
{
  const mov = (o: Partial<MovimentoCaixa>): MovimentoCaixa => ({
    chave: 'cr:1', origem: 'receber', tipo: 'entrada', registro_tabela: 'contas_receber', registro_id: '1', conta_id: 'c1', conta_nome: 'Itaú',
    data: '2026-11-03', valor: 100, numero: '10', descricao: 'Pacote', documento: 'NF 1', pessoa_id: 'p', pessoa_nome: 'Carla', cpf_cnpj: '',
    forma: 'Pix', venda_id: 'v1', venda_numero: 'VND-1', cartao_cheque: '', moeda: 'BRL', valor_origem: null, cambio: null, plataforma: '',
    informacoes: '', saldo_conta: 100, saldo_total: 100, ...o,
  });
  const linhas = [mov({}), mov({ chave: 'cp:2', origem: 'pagar', tipo: 'saida', valor: -30.5, saldo_conta: 69.5, saldo_total: 69.5, venda_numero: '', venda_id: 'v9', moeda: 'USD', valor_origem: -6.1, cambio: 5 })];
  const filtro: FiltroDeMovimentos = {
    contas: ['c1'], de: '2026-11-01', ate: '2026-11-30', tipo: '', origem: 'pagar', forma: '', pessoa: '', busca: '', taxas: false,
    ordem: 'data', direcao: 'asc', agrupar: 'nenhum', pagina: 1, porPagina: 100,
  };
  const ext = documentoDosMovimentos(linhas, 'extrato', filtro);
  eq(ext.titulo, 'Extrato de conta', 'extrato: título da tela');
  eq(ext.colunas.map(c => c.rotulo), ['Data', 'Conta', 'Número', 'Descrição', 'Documento', 'Pessoa', 'CPF/CNPJ', 'Informações', 'Forma', 'Origem', 'Valor', 'Saldo da conta', 'Saldo'], 'extrato: as mesmas colunas do CSV');
  eq(ext.filtros, [{ rotulo: 'Período', valor: '01/11/2026 a 30/11/2026' }, { rotulo: 'Conta', valor: 'Itaú' }, { rotulo: 'Origem', valor: 'Conta a pagar' }, { rotulo: 'Taxas retidas', valor: 'fora' }], 'extrato: filtros por extenso, conta pelo nome');
  eq(ext.totais, { valor: 69.5 }, 'extrato: total líquido do recorte');
  eq(nomeDoArquivo(ext, 'xlsx'), 'extrato-de-conta-2026-11-01-a-2026-11-30-itau-conta-a-pagar-fora.xlsx', 'extrato: filtro no nome do arquivo');
  eq(ext.linhas[1].origem, 'Conta a pagar', 'extrato: origem por extenso');
  const movs = documentoDosMovimentos(linhas, 'movimentacoes', { ...filtro, contas: [], origem: '', taxas: true });
  eq(movs.titulo, 'Movimentações', 'movimentações: título da tela');
  eq(movs.colunas.map(c => c.rotulo), ['Data', 'Número', 'Venda', 'Conta', 'Forma de pagamento', 'Pessoa', 'Documento', 'Cheque/Cartão', 'Moeda', 'Valor origem', 'Câmbio', 'Movimento', 'Valor'], 'movimentações: as mesmas colunas do CSV');
  eq(movs.linhas[1].venda, 'v9', 'movimentações: sem número, a venda pelo id (como no CSV)');
  eq(movs.linhas[1].movimento, 'Saída · Conta a pagar', 'movimentações: movimento por extenso');
  eq(movs.filtros, [{ rotulo: 'Período', valor: '01/11/2026 a 30/11/2026' }], 'movimentações: sem filtro extra, só o período');
  eq(matrizDoDocumento(movs)[2][12], -30.5, 'movimentações: saída negativa como número');
}

// ── Relatórios por categoria, centro de custo e rateio ─────────────────────
{
  const l = (o: Partial<LinhaLancamento>): LinhaLancamento => ({
    chave: 'k', conta_id: 'a', lado: 'pagar', tipo: 'Despesa', numero: '7', venda_numero: '', emissao: '2026-11-01', vencimento: '2026-11-10',
    liquidacao: '', movimentacao: '', pessoa: 'Hotel Mar', moeda: 'BRL', descricao: 'Diárias', documento: '', conta_bancaria: 'Itaú',
    situacao: 'EM_ABERTO', valor_lancamento: 1000, valor_movimentacao: 0, categoria_id: 'cat1', categoria_codigo: '2.1', categoria_nome: 'Hospedagem',
    grupo_nome: 'Custos', centro_custo_id: 'cc1', centro_custo_nome: 'Matriz', percentual: 60, valor: 600, tags: ['grupo'], repasse: false, rateado: true, ...o,
  });
  const linhas = [l({}), l({ chave: 'k2', centro_custo_id: 'cc2', centro_custo_nome: 'Filial', percentual: 40, valor: 400 })];
  const f = lerFiltros(new URLSearchParams('visao=centro&de=2026-11-01&ate=2026-11-30&situacao=EM_ABERTO&centro_custo_id=cc1&agrupar=pessoa'), '2026-11-06');
  const d = documentoDasLinhas(f, linhas);
  eq(d.titulo, 'Relatório por centro de custo', 'centro: título');
  eq(ids(d).includes('percentual') && ids(d).includes('valor_lancamento'), true, 'centro: % no centro e valor do lançamento');
  eq(d.totais, { valor: 1000, valor_lancamento: 1000, valor_movimentacao: 0 }, 'centro: lançamento rateado conta uma vez no total do lançamento');
  eq(d.rotulo_total, 'Total (1 lançamento)', 'centro: total diz quantos lançamentos');
  eq(filtrosLegiveis(f, { centro: 'Matriz' }).map(x => `${x.rotulo}=${x.valor}`), ['Período=01/11/2026 a 30/11/2026', 'Situação=Em aberto', 'Centro de custo=Matriz', 'Agrupado por=Pessoa'], 'centro: filtros por extenso');
  eq(d.filtros?.find(x => x.rotulo === 'Centro de custo')?.valor, 'Matriz', 'centro: centro pelo nome, não pelo id');
  const cat = documentoDasLinhas(lerFiltros(new URLSearchParams('visao=categoria&data_de=MOVIMENTACAO&de=2026-11-01&ate=2026-11-30'), '2026-11-06'), linhas);
  eq(cat.titulo, 'Relatório por categoria', 'categoria: título');
  eq(cat.subtitulo?.startsWith('Valores pelo regime de caixa'), true, 'categoria: avisa o regime de caixa');
  eq(cat.linhas[0].tags, 'grupo', 'categoria: tags juntas');
  const rat = documentoDasLinhas(lerFiltros(new URLSearchParams('visao=rateio'), '2026-11-06'), linhas);
  eq(rat.colunas[0].id, 'tipo', 'rateio: começa pelo tipo, como o CSV');
  eq(rat.linhas[0].categoria, '2.1 Hospedagem', 'rateio: categoria com código');
}

// ── Reembolsos e Crédito do cliente ────────────────────────────────────────
{
  const r = (o: Partial<Reembolso>): Reembolso => ({
    id: 'r1', tipo: 'CLIENTE', situacao: 'SOLICITADO', venda_id: 'v1', venda_numero: 'VND-1', cancelamento_id: '', produto_id: '', pessoa_id: 'p',
    pessoa_nome: 'Carla', valor_centavos: 50000, descricao: 'Cancelamento', prazo: '2026-11-20', centro_custo: '', conta_tabela: '', conta_id: '',
    credito_id: '', vinculado_a: '', pago_em: '', motivo_cancelamento: '', historico: [], criado_por: '', criado_em: '', atrasado: false, ...o,
  });
  const lista = [r({}), r({ id: 'r2', tipo: 'FORNECEDOR', situacao: 'APROVADO', atrasado: true, valor_centavos: 12000 }), r({ id: 'r3', situacao: 'PAGO', credito_id: 'c', valor_centavos: 999 })];
  const d = documentoDosReembolsos(lista, { de: '', ate: '', tipo: 'CLIENTE', situacao: 'em_andamento', busca: ' Carla ' });
  eq(d.titulo, 'Reembolsos', 'reembolsos: título');
  eq(d.filtros, [{ rotulo: 'Situação', valor: 'Em andamento' }, { rotulo: 'Sentido', valor: 'Ao cliente' }, { rotulo: 'Busca', valor: 'Carla' }], 'reembolsos: filtros por extenso, sem prazo quando é tudo');
  eq(d.linhas.map(l => l.situacao), ['Solicitado', 'Prazo vencido', 'Pago (virou crédito)'], 'reembolsos: situação como na tela');
  eq(d.totais, { valor: 62000 }, 'reembolsos: total só do que está em andamento');
  eq(matrizDoDocumento(d)[1][7], 500, 'reembolsos: centavos viram reais na planilha');
  const c: CarteiraDoCliente = { cliente_id: 'p', cliente_nome: 'Carla', disponivel: 30000, vencendo: 10000, proxima_validade: '2026-12-01', creditos_ativos: 2, total_recebido: 50000, total_usado: 20000 };
  const dc = documentoDosCreditos([c, { ...c, cliente_id: 'q', cliente_nome: '', creditos_ativos: 1, disponivel: 100 }], { busca: '', mostrar: 'todos' });
  eq(dc.titulo, 'Crédito do cliente', 'créditos: título');
  eq(dc.filtros, [{ rotulo: 'Mostrar', valor: 'Todos os clientes' }], 'créditos: o que está sendo mostrado');
  eq(dc.linhas[1].cliente, 'Cliente', 'créditos: sem nome, "Cliente"');
  eq(dc.totais?.disponivel, 30100, 'créditos: total disponível');
  eq(dc.totais?.creditos, 3, 'créditos: total de créditos com saldo');
}

// ── Resultado por categoria (tabela dinâmica) ──────────────────────────────
{
  const regs = [
    { campos: { tipo: 'Receitas', categoria: 'Vendas', mes: '2026-01' }, centavos: 10000 },
    { campos: { tipo: 'Receitas', categoria: 'Vendas', mes: '2026-02' }, centavos: 5000 },
    { campos: { tipo: 'Despesas', categoria: 'Aluguel', mes: '2026-01' }, centavos: -3000 },
  ];
  const t = montarTabelaDinamica(regs, ['tipo', 'categoria'], ['mes']);
  const d = documentoDaTabelaDinamica(t, {
    titulo: 'Resultado por categoria', filtros: [{ rotulo: 'Ano', valor: '2026' }],
    rotuloDoCampo: c => ({ tipo: 'Tipo', categoria: 'Categoria', mes: 'Mês' }[c] ?? c),
    rotuloDoValor: (c, v) => (c === 'mes' ? `${v.slice(5)}/${v.slice(0, 4)}` : v),
  });
  eq(d.colunas.map(c => c.rotulo), ['Tipo › Categoria', 'Caminho', '01/2026', '02/2026', 'Total'], 'dinâmica: uma coluna por coluna da grade, mais o total');
  eq(d.linhas.map(l => l.linha), ['Despesas', '    Aluguel', 'Receitas', '    Vendas'], 'dinâmica: linhas achatadas com recuo por nível');
  eq(d.linhas[1].caminho, 'Despesas › Aluguel', 'dinâmica: caminho inteiro para filtrar no Excel');
  eq(d.linhas[0].c1, null, 'dinâmica: célula sem nada fica vazia');
  eq(d.totais, { linha: 'Total geral', c0: 7000, c1: 5000, total: 12000 }, 'dinâmica: total geral por coluna');
  eq(d.dinheiro_em, 'centavos', 'dinâmica: centavos');
  const so = documentoDaTabelaDinamica(montarTabelaDinamica(regs, ['tipo'], []), { titulo: 'X' });
  eq(ids(so), ['linha', 'c0'], 'dinâmica sem coluna: só "Valor", sem total repetido');
  eq(so.colunas[1].rotulo, 'Valor', 'dinâmica sem coluna: rótulo Valor');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
