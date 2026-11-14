/**
 * "Perguntar em texto" (E7, fechamento): as FERRAMENTAS FIXAS.
 *
 * A IA nunca acessa o banco. Ela só escolhe uma destas consultas e preenche
 * os parâmetros; cada uma é escrita aqui, parametrizada, e roda com os
 * direitos de quem perguntou:
 *
 *   contas_a_pagar_e_receber  contas a pagar/receber pela lista unificada
 *                             (lerContas: contas liberadas e empresas visíveis)
 *   cobrancas                 a mesma lista, pela situação da cobrança
 *   saldos_das_contas         saldo de cada conta bancária liberada e o que
 *                             entrou e saiu num período
 *   resultado_do_mes          a DRE do mês (o mesmo cálculo da tela)
 *   vendas_agrupadas          relatório de vendas por vendedor, fornecedor,
 *                             cliente ou unidade (só as próprias vendas para
 *                             quem não vê as da equipe; receita só com o
 *                             direito de ver o ganho da agência)
 *
 * Cada resultado traz o número, o filtro usado por extenso e o link para a
 * tela com o filtro aplicado. Sem o direito, a ferramenta RECUSA e diz qual
 * direito falta: nenhum número sai.
 *
 * Não importa nada do Next, para os testes rodarem contra um Postgres real.
 */
import type { ExecutorSQL } from '../caixa-atomico';
import {
  FiltroInvalido, existeTabelaDeCobranca, lerContas, lerFiltro, tabelasDaLista, type LinhaDeConta, type TotaisDoLado,
} from '../contas-pagar-receber';
import { filtrarPorConta } from '../filtro-de-conta';
import { contasNoRecorte, filtrarPorEmpresa } from '../empresas';
import { contasBancariasVisiveis, type ExecutorEmpresas } from '../empresas-servidor';
import { montarDRE, comissaoNaoCapturadaPorConta, type LinhaDRE } from '../resultado-dre';
import { apenasVendasComLastro, vendasComLancamento } from '../venda-lancamentos';
import { categoriasDosEncargos, linhasDeEncargos } from '../encargos-servidor';
import { encargosPorTitulo, rotulosDasCategorias } from '../encargos-categorias';
import { variacoesDaAgencia } from '../cambio-servidor';
import { variacaoPorTitulo } from '../cambio';
import { CONSULTA_PADRAO, montarRelatorioDeVendas, paramsDaConsulta, type ConsultaDeVendas } from '../relatorios-vendas-servidor';
import type { ContaPagar, ContaReceber, PlanoContas } from '../crm-types';
import { round2 } from '../money';
import {
  dataBR, ehFerramenta, type DireitosDaPergunta, type NomeDaFerramenta, type NumeroDaResposta, type ResultadoDaFerramenta,
} from './definicoes';

// Tipos, nomes e esquemas: ./definicoes.ts (puro).
export * from './definicoes';

export interface ContextoDaPergunta {
  exec: ExecutorSQL;
  tenantId: string;
  /** AAAA-MM-DD em Brasília. */
  hoje: string;
  direitos: DireitosDaPergunta;
}

/** Erro de parâmetro: vira recusa, com a frase para a IA corrigir. */
class ParametroInvalido extends Error {}

// ============================================================
// Ajudantes
// ============================================================

type Entrada = Record<string, unknown>;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function umDe<T extends string>(lista: readonly T[], v: unknown, padrao: T | null, campo: string): T {
  if ((v === undefined || v === null || v === '') && padrao !== null) return padrao;
  if (typeof v === 'string' && (lista as readonly string[]).includes(v)) return v as T;
  throw new ParametroInvalido(`Parâmetro ${campo} inválido: use ${lista.join(', ')}.`);
}

function periodo(e: Entrada): { de: string; ate: string } {
  const de = txt(e.de, 10);
  const ate = txt(e.ate, 10);
  const valida = (s: string) => {
    const ms = Date.parse(`${s}T00:00:00Z`);
    return ISO.test(s) && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
  };
  if (de && !valida(de)) throw new ParametroInvalido('Data inicial inválida: use AAAA-MM-DD.');
  if (ate && !valida(ate)) throw new ParametroInvalido('Data final inválida: use AAAA-MM-DD.');
  if (de && ate && de > ate) throw new ParametroInvalido('A data inicial vem depois da final.');
  return { de, ate };
}

function textoDoPeriodo(rotulo: string, de: string, ate: string): string | null {
  if (de && ate) return de === ate ? `${rotulo} em ${dataBR(de)}` : `${rotulo} de ${dataBR(de)} a ${dataBR(ate)}`;
  if (de) return `${rotulo} a partir de ${dataBR(de)}`;
  if (ate) return `${rotulo} até ${dataBR(ate)}`;
  return `${rotulo}: todo o período`;
}

function recusa(ferramenta: NomeDaFerramenta, titulo: string, motivo: string): ResultadoDaFerramenta {
  return { ferramenta, titulo, recusado: motivo, numeros: [], filtro: [], link: null, linhas: [] };
}

const SEM_DIREITO = {
  financeiro: 'Seu acesso não inclui o financeiro (contas a pagar e a receber).',
  saldos: 'Seu acesso não inclui ver o saldo das contas bancárias.',
  relatorios: 'Seu acesso não inclui abrir relatórios.',
  receita: 'Seu acesso não inclui ver o ganho da agência nas vendas.',
} as const;

async function opcoesDasContas(exec: ExecutorSQL) {
  return { comCobranca: await existeTabelaDeCobranca(exec), tabelas: await tabelasDaLista(exec) };
}

const ROTULO_SITUACAO: Record<string, string> = { em_aberto: 'Em aberto (inclui atrasadas)', em_atraso: 'Em atraso', liquidado: 'Liquidadas', todas: 'Todas as situações' };
const ROTULO_DATA: Record<string, string> = { vencimento: 'Vencimento', emissao: 'Emissão', liquidacao: 'Liquidação' };

function numerosDoLado(lado: 'pagar' | 'receber', t: TotaisDoLado, situacao: string): NumeroDaResposta[] {
  const p = lado === 'pagar' ? 'a pagar' : 'a receber';
  const feito = lado === 'pagar' ? 'Já pago' : 'Já recebido';
  const n: NumeroDaResposta[] = [];
  if (situacao === 'em_aberto' || situacao === 'todas') n.push({ rotulo: `Em aberto ${p}`, valor: t.aberto, tipo: 'dinheiro' });
  if (situacao !== 'liquidado') n.push({ rotulo: `Em atraso ${p}`, valor: t.atraso, tipo: 'dinheiro' });
  if (situacao === 'liquidado' || situacao === 'todas') n.push({ rotulo: feito, valor: t.baixado, tipo: 'dinheiro' });
  n.push({ rotulo: `Contas ${p}`, valor: t.quantidade, tipo: 'contagem' });
  return n;
}

function linhaDaConta(l: LinhaDeConta): { texto: string; valor: number; moeda?: string } {
  const quando = l.situacao === 'liquidado' ? `liquidada em ${dataBR(l.liquidacao)}` : `vence ${dataBR(l.vencimento)}`;
  const quem = l.pessoa ? ` · ${l.pessoa}` : '';
  return { texto: `${l.tipo === 'pagar' ? 'Pagar' : 'Receber'}: ${l.descricao || 'Sem descrição'}${quem} · ${quando}`, valor: l.situacao === 'liquidado' ? l.baixado : l.saldo };
}

// ============================================================
// As ferramentas
// ============================================================

async function contasAPagarEReceber(ctx: ContextoDaPergunta, e: Entrada): Promise<ResultadoDaFerramenta> {
  const titulo = 'Contas a pagar e a receber';
  if (!ctx.direitos.verFinanceiro) return recusa('contas_a_pagar_e_receber', titulo, SEM_DIREITO.financeiro);
  const tipo = umDe(['pagar', 'receber', 'ambos'] as const, e.tipo, 'ambos', 'tipo');
  const situacao = umDe(['em_aberto', 'em_atraso', 'liquidado', 'todas'] as const, e.situacao, 'em_aberto', 'situacao');
  const data = umDe(['vencimento', 'emissao', 'liquidacao'] as const, e.data, 'vencimento', 'data');
  const { de, ate } = periodo(e);
  const pessoa = txt(e.pessoa, 80);
  const categoria = pessoa ? '' : txt(e.categoria, 80);

  const p = new URLSearchParams({ tipo, situacao, data });
  if (de) p.set('de', de);
  if (ate) p.set('ate', ate);
  if (pessoa) { p.set('busca', pessoa); p.set('em', 'pessoa'); }
  else if (categoria) { p.set('busca', categoria); p.set('em', 'categoria'); }
  const filtroDaLista = lerFiltro(new URLSearchParams({ ...Object.fromEntries(p), ordem: 'vencimento', por_pagina: '10' }), ctx.hoje);
  filtroDaLista.empresas = ctx.direitos.empresas;
  const r = await lerContas(ctx.exec, ctx.tenantId, filtroDaLista, ctx.direitos.contasLiberadas, await opcoesDasContas(ctx.exec));

  const numeros = [
    ...(tipo !== 'pagar' ? numerosDoLado('receber', r.totais.receber, situacao) : []),
    ...(tipo !== 'receber' ? numerosDoLado('pagar', r.totais.pagar, situacao) : []),
  ];
  const filtro = [
    tipo === 'ambos' ? 'A pagar e a receber' : tipo === 'pagar' ? 'A pagar' : 'A receber',
    ROTULO_SITUACAO[situacao],
    textoDoPeriodo(ROTULO_DATA[data], de, ate),
    pessoa ? `Pessoa contém "${pessoa}"` : categoria ? `Categoria contém "${categoria}"` : null,
    ctx.direitos.contasLiberadas ? 'Só as contas bancárias liberadas para você' : null,
  ].filter((x): x is string => !!x);
  return { ferramenta: 'contas_a_pagar_e_receber', titulo, numeros, filtro, link: `/financeiro-ag/contas?${p}`, linhas: r.linhas.slice(0, 10).map(linhaDaConta) };
}

const ROTULO_COBRANCA: Record<string, string> = {
  emitida: 'Cobrança emitida, aguardando pagamento', vencida: 'Cobrança vencida', paga: 'Cobrança paga', falhou: 'Cobrança que falhou', sem_boleto: 'Sem boleto ou Pix emitido',
};

async function cobrancas(ctx: ContextoDaPergunta, e: Entrada): Promise<ResultadoDaFerramenta> {
  const titulo = 'Cobranças';
  if (!ctx.direitos.verFinanceiro) return recusa('cobrancas', titulo, SEM_DIREITO.financeiro);
  const cobranca = umDe(['emitida', 'vencida', 'paga', 'falhou', 'sem_boleto'] as const, e.situacao_cobranca, null, 'situacao_cobranca');
  if (!(await existeTabelaDeCobranca(ctx.exec))) return recusa('cobrancas', titulo, 'A agência ainda não emite boleto ou Pix pelo sistema.');
  const { de, ate } = periodo(e);
  const pessoa = txt(e.pessoa, 80);
  const p = new URLSearchParams({ tipo: 'receber', situacao: 'todas', data: 'vencimento', cobranca });
  if (de) p.set('de', de);
  if (ate) p.set('ate', ate);
  if (pessoa) { p.set('busca', pessoa); p.set('em', 'pessoa'); }
  const f = lerFiltro(new URLSearchParams({ ...Object.fromEntries(p), ordem: 'vencimento', por_pagina: '10' }), ctx.hoje);
  f.empresas = ctx.direitos.empresas;
  const r = await lerContas(ctx.exec, ctx.tenantId, f, ctx.direitos.contasLiberadas, await opcoesDasContas(ctx.exec));
  const t = r.totais.receber;
  const numeros: NumeroDaResposta[] = cobranca === 'paga'
    ? [{ rotulo: 'Recebido', valor: t.baixado, tipo: 'dinheiro' }, { rotulo: 'Contas', valor: t.quantidade, tipo: 'contagem' }]
    : [{ rotulo: 'Em aberto', valor: t.aberto, tipo: 'dinheiro' }, { rotulo: 'Em atraso', valor: t.atraso, tipo: 'dinheiro' }, { rotulo: 'Contas', valor: t.quantidade, tipo: 'contagem' }];
  const filtro = [
    'A receber', ROTULO_COBRANCA[cobranca], textoDoPeriodo('Vencimento', de, ate), pessoa ? `Cliente contém "${pessoa}"` : null,
  ].filter((x): x is string => !!x);
  return { ferramenta: 'cobrancas', titulo, numeros, filtro, link: `/financeiro-ag/contas?${p}`, linhas: r.linhas.slice(0, 10).map(linhaDaConta) };
}

async function saldosDasContas(ctx: ContextoDaPergunta, e: Entrada): Promise<ResultadoDaFerramenta> {
  const titulo = 'Saldos das contas bancárias';
  if (!ctx.direitos.verSaldos) return recusa('saldos_das_contas', titulo, SEM_DIREITO.saldos);
  const { de, ate } = periodo(e);
  const busca = txt(e.conta, 80).toLowerCase();
  const { rows } = await ctx.exec.query(
    `SELECT id, COALESCE(NULLIF(data->>'nome', ''), nome, 'Conta') AS nome, data->>'saldo_atual' AS saldo,
            COALESCE(NULLIF(data->>'moeda', ''), 'BRL') AS moeda, COALESCE(data->>'ativo', 'true') AS ativo
       FROM contas_bancarias WHERE tenant_id = $1 ORDER BY 2`,
    [ctx.tenantId],
  );
  const visiveis = await contasBancariasVisiveis(ctx.exec as unknown as ExecutorEmpresas, ctx.tenantId, ctx.direitos.empresas);
  const liberadas = ctx.direitos.contasLiberadas ? new Set(ctx.direitos.contasLiberadas) : null;
  const contas = rows
    .filter(r => String(r.ativo) !== 'false')
    .filter(r => !liberadas || liberadas.has(String(r.id)))
    .filter(r => !visiveis || visiveis.has(String(r.id)))
    .filter(r => !busca || String(r.nome).toLowerCase().includes(busca))
    .map(r => ({ id: String(r.id), nome: String(r.nome), saldo: round2(Number(r.saldo) || 0), moeda: String(r.moeda).toUpperCase() }));

  const porMoeda = new Map<string, number>();
  for (const c of contas) porMoeda.set(c.moeda, round2((porMoeda.get(c.moeda) ?? 0) + c.saldo));
  const numeros: NumeroDaResposta[] = [...porMoeda.entries()].map(([moeda, valor]) => ({
    rotulo: moeda === 'BRL' ? 'Saldo somado em reais' : `Saldo somado em ${moeda}`, valor, tipo: 'dinheiro' as const, ...(moeda !== 'BRL' ? { moeda } : {}),
  }));
  numeros.push({ rotulo: 'Contas bancárias', valor: contas.length, tipo: 'contagem' });
  const filtro = [busca ? `Conta contém "${txt(e.conta, 80)}"` : 'Todas as contas ativas', liberadas ? 'Só as contas liberadas para você' : null]
    .filter((x): x is string => !!x);

  let link = '/financeiro-ag/contas-bancarias';
  if ((de || ate) && ctx.direitos.verFinanceiro) {
    // O que entrou e saiu no período: contas recebidas e pagas (a lista unificada, pela data da liquidação).
    const p = new URLSearchParams({ tipo: 'ambos', situacao: 'todas', data: 'liquidacao' });
    if (de) p.set('de', de);
    if (ate) p.set('ate', ate);
    if (contas.length === 1) p.set('conta', contas[0].id);
    const f = lerFiltro(new URLSearchParams({ ...Object.fromEntries(p), por_pagina: '1' }), ctx.hoje);
    f.empresas = ctx.direitos.empresas;
    const r = await lerContas(ctx.exec, ctx.tenantId, f, ctx.direitos.contasLiberadas, await opcoesDasContas(ctx.exec));
    numeros.push({ rotulo: 'Entrou no período (contas recebidas)', valor: r.totais.receber.baixado, tipo: 'dinheiro' });
    numeros.push({ rotulo: 'Saiu no período (contas pagas)', valor: r.totais.pagar.baixado, tipo: 'dinheiro' });
    filtro.push(textoDoPeriodo('Liquidação', de, ate)!);
    link = `/financeiro-ag/contas?${p}`;
  }
  return {
    ferramenta: 'saldos_das_contas', titulo, numeros, filtro, link,
    linhas: contas.slice(0, 10).map(c => ({ texto: c.nome, valor: c.saldo, ...(c.moeda !== 'BRL' ? { moeda: c.moeda } : {}) })),
  };
}

const LINHAS_DO_RESUMO: ReadonlyArray<[string, string]> = [
  ['RECEITA BRUTA', 'Receita bruta'], ['RECEITA LÍQUIDA', 'Receita líquida'],
  ['(-) DESPESAS OPERACIONAIS', 'Despesas operacionais'], ['LUCRO LÍQUIDO', 'Lucro líquido'],
];

async function resultadoDoMes(ctx: ContextoDaPergunta, e: Entrada): Promise<ResultadoDaFerramenta> {
  const titulo = 'Resultado do mês (DRE)';
  if (!ctx.direitos.relatorios) return recusa('resultado_do_mes', titulo, SEM_DIREITO.relatorios);
  if (!ctx.direitos.verFinanceiro) return recusa('resultado_do_mes', titulo, SEM_DIREITO.financeiro);
  const mes = txt(e.mes, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ParametroInvalido('Mês inválido: use AAAA-MM.');
  const { exec, tenantId, direitos } = ctx;
  // As mesmas listas que a tela DRE lê (contas liberadas e empresas visíveis), e o mesmo cálculo.
  const ler = async (tabela: string) => (await exec.query(`SELECT data FROM ${tabela} WHERE tenant_id = $1`, [tenantId])).rows
    .map(r => ({ ...((r.data ?? {}) as Record<string, unknown>) }));
  const filtroDeConta = { campos: ['conta_bancaria_id'], soBaixados: true };
  const titulos = async (tabela: 'contas_receber' | 'contas_pagar') => contasNoRecorte(
    filtrarPorEmpresa(filtrarPorConta(await ler(tabela), filtroDeConta, direitos.contasLiberadas), { tipo: 'registro' }, direitos.empresas),
    direitos.empresas,
  );
  const [receber, pagar, vendasBrutas, plano, encargos, categorias, variacoes] = await Promise.all([
    titulos('contas_receber') as Promise<unknown[]> as Promise<ContaReceber[]>,
    titulos('contas_pagar') as Promise<unknown[]> as Promise<ContaPagar[]>,
    ler('vendas_crm'),
    ler('plano_contas') as Promise<unknown[]> as Promise<PlanoContas[]>,
    linhasDeEncargos(exec, tenantId),
    categoriasDosEncargos(exec, tenantId).catch(() => ({})),
    variacoesDaAgencia(exec, tenantId),
  ]);
  const vendas = filtrarPorEmpresa(vendasBrutas, { tipo: 'registro' }, direitos.empresas) as unknown as Array<{ id: string }>;
  const comLastro = apenasVendasComLastro(vendas, vendasComLancamento(receber, pagar));
  const linhas: LinhaDRE[] = montarDRE({
    receber, pagar, vendasComLastro: comLastro as never, planoContas: plano,
    comissaoNaoCapturada: comissaoNaoCapturadaPorConta(receber, comLastro as never),
    mes, regime: 'competencia',
    encargos: encargosPorTitulo(encargos), rotulosEncargos: rotulosDasCategorias(categorias, plano),
    variacoes: variacaoPorTitulo(variacoes),
  });
  const achar = (nome: string) => linhas.find(l => l.nome === nome || l.nome.startsWith(nome));
  const numeros: NumeroDaResposta[] = LINHAS_DO_RESUMO.flatMap(([nome, rotulo]) => {
    const l = achar(nome);
    return l ? [{ rotulo, valor: round2(l.valor), tipo: 'dinheiro' as const }] : [];
  });
  const margem = achar('Margem líquida');
  if (margem) numeros.push({ rotulo: 'Margem líquida', valor: round2(margem.valor), tipo: 'percentual' });
  const [ano, m] = mes.split('-');
  return {
    ferramenta: 'resultado_do_mes', titulo, numeros,
    filtro: [`Mês ${m}/${ano}`, 'Regime de competência', 'Todos os centros de custo'],
    link: `/financeiro-ag/dre?mes=${mes}`,
    linhas: linhas.filter(l => l.tipo === 'item' && Math.abs(l.valor) >= 0.01).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
      .slice(0, 10).map(l => ({ texto: l.nome, valor: round2(l.valor) })),
  };
}

const RELATORIO_DO_GRUPO = { vendedor: 'vendedor', fornecedor: 'fornecedor', cliente: 'clientes', unidade: 'unidade' } as const;
const ROTULO_DO_GRUPO = { vendedor: 'Por vendedor', fornecedor: 'Por fornecedor', cliente: 'Por cliente', unidade: 'Por unidade' } as const;

function opcaoPeloNome(opcoes: Array<{ valor: string; rotulo: string }>, nome: string): { valor: string; rotulo: string } | null {
  const alvo = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const achadas = opcoes.filter(o => o.rotulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(alvo));
  return achadas.length === 1 ? achadas[0] : achadas.find(o => o.rotulo.toLowerCase() === nome.toLowerCase()) ?? null;
}

async function vendasAgrupadas(ctx: ContextoDaPergunta, e: Entrada): Promise<ResultadoDaFerramenta> {
  const titulo = 'Vendas';
  if (!ctx.direitos.relatorios) return recusa('vendas_agrupadas', titulo, SEM_DIREITO.relatorios);
  const agrupar = umDe(['vendedor', 'fornecedor', 'cliente', 'unidade'] as const, e.agrupar_por, null, 'agrupar_por');
  const medida = umDe(['faturamento', 'receita'] as const, e.medida, 'faturamento', 'medida');
  // Pedir a receita sem o direito de vê-la é recusa: nem a ordem pela receita sai.
  if (medida === 'receita' && !ctx.direitos.verReceita) return recusa('vendas_agrupadas', titulo, SEM_DIREITO.receita);
  const { de, ate } = periodo(e);
  const consulta: ConsultaDeVendas = {
    ...CONSULTA_PADRAO, relatorio: RELATORIO_DO_GRUPO[agrupar], de, ate, ordem: medida,
    filtro: { ...CONSULTA_PADRAO.filtro },
  };
  const acesso = { verReceita: ctx.direitos.verReceita, vendedorId: ctx.direitos.vendedorId ?? undefined, empresas: ctx.direitos.empresas };
  let r = await montarRelatorioDeVendas(ctx.exec, ctx.tenantId, consulta, acesso);
  const filtroTexto: string[] = [ROTULO_DO_GRUPO[agrupar], textoDoPeriodo('Data da venda', de, ate)!];
  const fornecedor = txt(e.fornecedor, 80);
  const vendedor = txt(e.vendedor, 80);
  if (fornecedor || vendedor) {
    if (fornecedor) {
      const o = opcaoPeloNome(r.opcoes.fornecedores, fornecedor);
      if (!o) return recusa('vendas_agrupadas', titulo, `Nenhum fornecedor único com "${fornecedor}" nas vendas do período.`);
      consulta.filtro.fornecedor = o.valor;
      filtroTexto.push(`Fornecedor: ${o.rotulo}`);
    }
    if (vendedor) {
      const o = opcaoPeloNome(r.opcoes.vendedores, vendedor);
      if (!o) return recusa('vendas_agrupadas', titulo, `Nenhum vendedor único com "${vendedor}" nas vendas do período.`);
      consulta.filtro.vendedor = o.valor;
      filtroTexto.push(`Vendedor: ${o.rotulo}`);
    }
    r = await montarRelatorioDeVendas(ctx.exec, ctx.tenantId, consulta, acesso);
  }
  if (r.so_as_suas) filtroTexto.push('Só as suas vendas');
  const soma = (k: string) => r.linhas.reduce((s, l) => s + (Number(l[k]) || 0), 0);
  const numeros: NumeroDaResposta[] = [
    { rotulo: 'Faturamento', valor: round2(soma('faturamento') / 100), tipo: 'dinheiro' },
    ...(r.ver_receita ? [{ rotulo: 'Receita da agência', valor: round2(soma('receita') / 100), tipo: 'dinheiro' as const }] : []),
    { rotulo: 'Vendas', valor: r.quantidade_vendas, tipo: 'contagem' },
  ];
  const campo = medida === 'receita' && r.ver_receita ? 'receita' : 'faturamento';
  return {
    ferramenta: 'vendas_agrupadas', titulo: `Vendas ${ROTULO_DO_GRUPO[agrupar].toLowerCase()}`, numeros, filtro: filtroTexto,
    link: `/relatorios/vendas?${paramsDaConsulta(consulta)}`,
    linhas: r.linhas.slice(0, 10).map(l => ({
      texto: `${String(l.grupo || 'Sem nome')} · ${Number(l.vendas) || 0} ${Number(l.vendas) === 1 ? 'venda' : 'vendas'}`,
      valor: round2((Number(l[campo]) || 0) / 100),
    })),
  };
}

const EXECUTORES: Record<NomeDaFerramenta, (ctx: ContextoDaPergunta, e: Entrada) => Promise<ResultadoDaFerramenta>> = {
  contas_a_pagar_e_receber: contasAPagarEReceber,
  cobrancas,
  saldos_das_contas: saldosDasContas,
  resultado_do_mes: resultadoDoMes,
  vendas_agrupadas: vendasAgrupadas,
};

const TITULOS: Record<NomeDaFerramenta, string> = {
  contas_a_pagar_e_receber: 'Contas a pagar e a receber', cobrancas: 'Cobranças', saldos_das_contas: 'Saldos das contas bancárias',
  resultado_do_mes: 'Resultado do mês (DRE)', vendas_agrupadas: 'Vendas',
};

/** Roda uma ferramenta pelo nome. Nome desconhecido ou parâmetro inválido viram recusa. */
export async function executarFerramenta(ctx: ContextoDaPergunta, nome: string, entrada: unknown): Promise<ResultadoDaFerramenta> {
  if (!ehFerramenta(nome)) return recusa('contas_a_pagar_e_receber', 'Consulta desconhecida', `Não existe a consulta "${String(nome).slice(0, 60)}".`);
  const e = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? (entrada as Entrada) : {};
  try {
    return await EXECUTORES[nome](ctx, e);
  } catch (err) {
    if (err instanceof ParametroInvalido || err instanceof FiltroInvalido) {
      return recusa(nome, TITULOS[nome], (err as Error).message);
    }
    throw err;
  }
}
