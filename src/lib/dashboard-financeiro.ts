/**
 * A Central de Inteligência Financeira: uma leitura, quinze agregações, zero
 * tabela baixada para o navegador.
 *
 * POR QUE NO SERVIDOR. O CRUD genérico devolve a tabela INTEIRA do tenant, sem
 * filtro e sem paginação (crud-api.ts:52). O dashboard antigo baixava clientes,
 * vendas, contas a receber, contas a pagar, bancos, CAC e equipe inteiros e
 * somava em JavaScript — o que fica mais lento a cada mês de operação e torna
 * impossível responder quarenta perguntas sem travar o aparelho de quem abre.
 *
 * O QUE ESTE MÓDULO NÃO FAZ. Ele não inventa definição de dinheiro. Cada
 * expressão SQL vem de dashboard-sql.ts, que é espelho verificado do
 * TypeScript canônico de resultado-financeiro.ts — e scripts/test-sql-dashboard.mjs
 * roda os dois caminhos sobre as MESMAS linhas para provar que concordam.
 *
 * REGIME: duas perguntas diferentes, dois cortes diferentes.
 *   CAIXA       — o que de fato entrou e saiu, cortado pela data da BAIXA.
 *   COMPETÊNCIA — o que está prometido, cortado pela data de VENCIMENTO.
 * Confundir os dois é o erro clássico: "recebi 80 mil" quando 80 mil apenas
 * venceram. A tela diz qual regime está usando em cada bloco.
 */

import { divSegura, round2, variacaoPct } from './money';
import {
  EH_REPASSE,
  NAO_CANCELADA,
  ORIGEM_RECEBER,
  ehRepasse,
  naoCancelada,
  vendaDeOrigem,
  VENDA_REALIZADA,
  dataDoCaixa,
  emAberto,
  inteiroDoBanco,
  numerico,
  numeroDoBanco,
  realizado,
} from './dashboard-sql';

/** O mínimo que este módulo precisa de um cliente Postgres. Injetável para o
 *  teste rodar a query DE PRODUÇÃO contra um banco real, não contra um mock. */
export interface ExecutorSQL {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface EntradaDashboard {
  tenantId: string;
  /** Janela do período analisado, em data civil YYYY-MM-DD. */
  de: string;
  ate: string;
  /** Hoje no fuso do tenant. Vem de fora para SQL e JS nunca discordarem. */
  hoje: string;
  /** Janela anterior, do mesmo tamanho, para a comparação. */
  deAnterior: string;
  ateAnterior: string;
}

// ══════════════════════════════════════════════════════════════════════
// O formato da resposta
// ══════════════════════════════════════════════════════════════════════

export interface Comparavel {
  atual: number;
  anterior: number;
  /** null quando a base é zero: não existe variação sobre nada. Nunca +100%. */
  variacao: number | null;
}

export interface FaixaDeAging {
  id: string;
  rotulo: string;
  valor: number;
  contas: number;
}

export interface PontoDaSerie {
  mes: string;
  entradas: number;
  saidas: number;
  resultado: number;
}

export interface PontoDaProjecao {
  dias: number;
  data: string;
  entradas: number;
  saidas: number;
  saldoProjetado: number;
}

export interface LinhaNomeada {
  id: string;
  nome: string;
  valor: number;
  contas: number;
}

export interface LinhaDeMargem {
  id: string;
  nome: string;
  venda: number;
  custo: number;
  margem: number;
  margemPct: number | null;
}

export interface LancamentoDaAgenda {
  id: string;
  data: string;
  lado: 'receber' | 'pagar';
  valor: number;
  descricao: string;
  contraparte: string;
  vencido: boolean;
}

export interface VendaDescasada {
  vendaId: string;
  numero: string;
  cliente: string;
  primeiroPagamento: string;
  primeiroRecebimento: string;
  diasDeGap: number;
  valorAdiantado: number;
}

export interface DashboardFinanceiro {
  periodo: { de: string; ate: string; hoje: string; deAnterior: string; ateAnterior: string };
  caixa: {
    saldo: number;
    saldoInicialDasContas: number;
    entradas: Comparavel;
    saidas: Comparavel;
    resultado: Comparavel;
    /** A parte das saídas que é repasse ao fornecedor, não despesa da agência. */
    repasses: number;
    despesasProprias: Comparavel;
  };
  posicao: {
    receber: { emAberto: number; vencido: number; venceHoje: number; aVencer: number; contas: number; contasVencidas: number };
    pagar: { emAberto: number; vencido: number; venceHoje: number; aVencer: number; contas: number; contasVencidas: number };
  };
  aging: { receber: FaixaDeAging[]; pagar: FaixaDeAging[] };
  serie: PontoDaSerie[];
  projecao: PontoDaProjecao[];
  receitaPorOrigem: LinhaNomeada[];
  despesaPorCategoria: LinhaNomeada[];
  fornecedores: LinhaNomeada[];
  margemPorFornecedor: LinhaDeMargem[];
  clientes: LinhaNomeada[];
  agenda: LancamentoDaAgenda[];
  descasamento: VendaDescasada[];
  vendas: {
    volume: number;
    receitaAgencia: number;
    custo: number;
    quantidade: number;
    margemPct: number | null;
    ticketVolume: number;
    ticketReceita: number;
    semLastro: { quantidade: number; volume: number };
  };
  atencao: {
    pagarVencido: { valor: number; contas: number };
    receberVencido: { valor: number; contas: number };
    venceHoje: { receber: number; pagar: number };
    semFornecedor: number;
    semVencimento: number;
    naoCategorizadas: { valor: number; contas: number };
  };
  /** Quantos meses o caixa de hoje cobre, no ritmo de despesa própria do período. */
  cobertura: { meses: number | null; despesaMensal: number };
}

// ══════════════════════════════════════════════════════════════════════
// Consultas
// ══════════════════════════════════════════════════════════════════════

/**
 * Entradas e saídas do período, em REGIME DE CAIXA.
 *
 * O corte é pela data da baixa, com o vencimento como retaguarda para
 * lançamento antigo sem data de baixa gravada. As saídas vêm em duas linhas:
 * o repasse ao fornecedor (que saiu mesmo, mas já estava descontado dentro da
 * margem) e a despesa própria da agência.
 */
async function movimentoDeCaixa(
  exec: ExecutorSQL, tenantId: string, de: string, ate: string,
): Promise<{ entradas: number; saidas: number; repasses: number; despesasProprias: number }> {
  const [r, p] = await Promise.all([
    exec.query(
      `SELECT COALESCE(ROUND(SUM(${realizado('receber')}), 2), 0) AS total
         FROM contas_receber
        WHERE tenant_id = $1 AND ${NAO_CANCELADA}
          AND ${dataDoCaixa('receber')} BETWEEN $2 AND $3`,
      [tenantId, de, ate],
    ),
    exec.query(
      `SELECT
         COALESCE(ROUND(SUM(${realizado('pagar')}), 2), 0) AS total,
         COALESCE(ROUND(SUM(CASE WHEN ${EH_REPASSE} THEN ${realizado('pagar')} ELSE 0 END), 2), 0) AS repasses
         FROM contas_pagar
        WHERE tenant_id = $1 AND ${NAO_CANCELADA}
          AND ${dataDoCaixa('pagar')} BETWEEN $2 AND $3`,
      [tenantId, de, ate],
    ),
  ]);
  const entradas = numeroDoBanco(r.rows[0]?.total);
  const saidas = numeroDoBanco(p.rows[0]?.total);
  const repasses = numeroDoBanco(p.rows[0]?.repasses);
  return { entradas, saidas, repasses, despesasProprias: round2(saidas - repasses) };
}

/**
 * Saldo em caixa HOJE.
 *
 * COMPUTADO a partir do histórico de baixas, não do campo saldo_atual
 * persistido — essa é a definição que saldo-bancario.ts já encarna, e o campo
 * gravado é derivado. O total é confiável; a distribuição POR BANCO não é, e
 * por isso não está aqui: conta_bancaria_id nasce nulo em todos os criadores e
 * nenhuma das telas de baixa o grava.
 */
async function saldoEmCaixa(exec: ExecutorSQL, tenantId: string): Promise<{ saldo: number; inicial: number }> {
  const [b, r, p] = await Promise.all([
    exec.query(
      `SELECT COALESCE(ROUND(SUM(${numerico(`data->>'saldo_inicial'`)}), 2), 0) AS total
         FROM contas_bancarias WHERE tenant_id = $1 AND COALESCE(data->>'ativo', 'true') <> 'false'`,
      [tenantId],
    ),
    exec.query(
      `SELECT COALESCE(ROUND(SUM(${realizado('receber')}), 2), 0) AS total
         FROM contas_receber WHERE tenant_id = $1 AND ${NAO_CANCELADA}`,
      [tenantId],
    ),
    exec.query(
      `SELECT COALESCE(ROUND(SUM(${realizado('pagar')}), 2), 0) AS total
         FROM contas_pagar WHERE tenant_id = $1 AND ${NAO_CANCELADA}`,
      [tenantId],
    ),
  ]);
  const inicial = numeroDoBanco(b.rows[0]?.total);
  return { saldo: round2(inicial + numeroDoBanco(r.rows[0]?.total) - numeroDoBanco(p.rows[0]?.total)), inicial };
}

/**
 * A posição de recebíveis e pagáveis: quanto ainda falta entrar e sair.
 *
 * VENCIDO é estritamente anterior a hoje. Conta que vence HOJE tem coluna
 * própria — as duas definições que convivem no sistema divergem justamente em
 * um dia, e um painel que misture as duas nunca fecha com a tabela de aging.
 */
async function posicao(
  exec: ExecutorSQL, tabela: 'contas_receber' | 'contas_pagar', lado: 'receber' | 'pagar',
  tenantId: string, hoje: string,
) {
  const aberto = emAberto(lado);
  const venc = `COALESCE(data->>'data_vencimento', '')`;
  const { rows } = await exec.query(
    `SELECT
       COALESCE(ROUND(SUM(${aberto}), 2), 0) AS em_aberto,
       COALESCE(ROUND(SUM(CASE WHEN ${venc} <> '' AND ${venc} <  $2 THEN ${aberto} ELSE 0 END), 2), 0) AS vencido,
       COALESCE(ROUND(SUM(CASE WHEN ${venc} =  $2 THEN ${aberto} ELSE 0 END), 2), 0) AS vence_hoje,
       COALESCE(ROUND(SUM(CASE WHEN ${venc} >  $2 THEN ${aberto} ELSE 0 END), 2), 0) AS a_vencer,
       COUNT(*) FILTER (WHERE ${aberto} > 0) AS contas,
       COUNT(*) FILTER (WHERE ${aberto} > 0 AND ${venc} <> '' AND ${venc} < $2) AS contas_vencidas
       FROM ${tabela}
      WHERE tenant_id = $1 AND ${NAO_CANCELADA}`,
    [tenantId, hoje],
  );
  const l = rows[0] ?? {};
  return {
    emAberto: numeroDoBanco(l.em_aberto),
    vencido: numeroDoBanco(l.vencido),
    venceHoje: numeroDoBanco(l.vence_hoje),
    aVencer: numeroDoBanco(l.a_vencer),
    contas: inteiroDoBanco(l.contas),
    contasVencidas: inteiroDoBanco(l.contas_vencidas),
  };
}

/**
 * Aging: o saldo EM ABERTO por faixa de prazo, nunca o valor cheio da parcela.
 *
 * Somar o valor cheio de uma conta já baixada pela metade infla a inadimplência
 * pelo que já entrou.
 */
async function aging(
  exec: ExecutorSQL, tabela: 'contas_receber' | 'contas_pagar', lado: 'receber' | 'pagar',
  tenantId: string, hoje: string,
): Promise<FaixaDeAging[]> {
  const aberto = emAberto(lado);
  const venc = `NULLIF(data->>'data_vencimento', '')`;
  // Dias de distância até o vencimento: negativo = já venceu.
  const dias = `(${venc}::date - $2::date)`;
  const { rows } = await exec.query(
    `SELECT
       CASE
         WHEN ${venc} IS NULL                 THEN 'sem_data'
         WHEN ${dias} < -30                   THEN 'vencido_30'
         WHEN ${dias} < -7                    THEN 'vencido_8_30'
         WHEN ${dias} < 0                     THEN 'vencido_1_7'
         WHEN ${dias} = 0                     THEN 'hoje'
         WHEN ${dias} <= 7                    THEN 'ate_7'
         WHEN ${dias} <= 15                   THEN 'ate_15'
         WHEN ${dias} <= 30                   THEN 'ate_30'
         ELSE                                      'acima_30'
       END AS faixa,
       COALESCE(ROUND(SUM(${aberto}), 2), 0) AS valor,
       COUNT(*) AS contas
       FROM ${tabela}
      WHERE tenant_id = $1 AND ${NAO_CANCELADA} AND ${aberto} > 0
      GROUP BY 1`,
    [tenantId, hoje],
  );
  const ROTULOS: Record<string, string> = {
    vencido_30: 'vencido há mais de 30 dias',
    vencido_8_30: 'vencido há 8 a 30 dias',
    vencido_1_7: 'vencido há até 7 dias',
    hoje: 'vence hoje',
    ate_7: 'até 7 dias',
    ate_15: '8 a 15 dias',
    ate_30: '16 a 30 dias',
    acima_30: 'mais de 30 dias',
    // Não descartar em silêncio: conta sem vencimento é dinheiro que ninguém
    // sabe quando entra, e isso é um problema a resolver, não uma linha a sumir.
    sem_data: 'sem data de vencimento',
  };
  const ORDEM = ['vencido_30', 'vencido_8_30', 'vencido_1_7', 'hoje', 'ate_7', 'ate_15', 'ate_30', 'acima_30', 'sem_data'];
  const mapa = new Map(rows.map(r => [String(r.faixa), r]));
  return ORDEM.filter(id => mapa.has(id)).map(id => ({
    id,
    rotulo: ROTULOS[id],
    valor: numeroDoBanco(mapa.get(id)!.valor),
    contas: inteiroDoBanco(mapa.get(id)!.contas),
  }));
}

/**
 * Série mensal do realizado.
 *
 * ATENÇÃO, E A TELA PRECISA DIZER ISTO: não é histórico, é PROJEÇÃO PARA TRÁS.
 * Os meses passados são reconstruídos com o estado ATUAL das contas, porque não
 * existe nenhuma tabela de snapshot no sistema. Uma baixa lançada hoje com data
 * retroativa muda o passado do gráfico.
 */
async function serieMensal(
  exec: ExecutorSQL, tenantId: string, de: string, ate: string,
): Promise<PontoDaSerie[]> {
  const mesDe = (lado: 'receber' | 'pagar') => `substring(${dataDoCaixa(lado)}, 1, 7)`;
  const [r, p] = await Promise.all([
    exec.query(
      `SELECT ${mesDe('receber')} AS mes, COALESCE(ROUND(SUM(${realizado('receber')}), 2), 0) AS total
         FROM contas_receber
        WHERE tenant_id = $1 AND ${NAO_CANCELADA} AND ${dataDoCaixa('receber')} BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 1`,
      [tenantId, de, ate],
    ),
    exec.query(
      `SELECT ${mesDe('pagar')} AS mes, COALESCE(ROUND(SUM(${realizado('pagar')}), 2), 0) AS total
         FROM contas_pagar
        WHERE tenant_id = $1 AND ${NAO_CANCELADA} AND ${dataDoCaixa('pagar')} BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 1`,
      [tenantId, de, ate],
    ),
  ]);
  const entradas = new Map(r.rows.map(x => [String(x.mes), numeroDoBanco(x.total)]));
  const saidas = new Map(p.rows.map(x => [String(x.mes), numeroDoBanco(x.total)]));
  const meses = [...new Set([...entradas.keys(), ...saidas.keys()])].filter(Boolean).sort();
  return meses.map(mes => {
    const e = entradas.get(mes) ?? 0;
    const s = saidas.get(mes) ?? 0;
    return { mes, entradas: e, saidas: s, resultado: round2(e - s) };
  });
}

/**
 * Projeção de caixa: o saldo de hoje mais tudo que está em aberto, por janela.
 *
 * É ARITMÉTICA DO QUE JÁ ESTÁ LANÇADO, não previsão estatística. O que está
 * vencido e ainda em aberto entra na primeira janela: ele já deveria ter
 * acontecido, e fingir que entra "algum dia" é o que faz uma projeção mentir
 * para melhor.
 */
async function projecao(
  exec: ExecutorSQL, tenantId: string, hoje: string, saldoHoje: number,
): Promise<PontoDaProjecao[]> {
  const JANELAS = [7, 15, 30, 60, 90];
  const aberto = (lado: 'receber' | 'pagar') => emAberto(lado);
  const venc = `COALESCE(data->>'data_vencimento', '')`;

  const somaAte = async (tabela: 'contas_receber' | 'contas_pagar', lado: 'receber' | 'pagar', ate: string) => {
    const { rows } = await exec.query(
      `SELECT COALESCE(ROUND(SUM(${aberto(lado)}), 2), 0) AS total
         FROM ${tabela}
        WHERE tenant_id = $1 AND ${NAO_CANCELADA}
          AND ${venc} <> '' AND ${venc} <= $2`,
      [tenantId, ate],
    );
    return numeroDoBanco(rows[0]?.total);
  };

  const pontos: PontoDaProjecao[] = [];
  for (const dias of JANELAS) {
    const limite = new Date(`${hoje}T12:00:00`);
    limite.setDate(limite.getDate() + dias);
    const ate = limite.toISOString().slice(0, 10);
    const [entradas, saidas] = await Promise.all([
      somaAte('contas_receber', 'receber', ate),
      somaAte('contas_pagar', 'pagar', ate),
    ]);
    pontos.push({
      dias,
      data: ate,
      entradas,
      saidas,
      saldoProjetado: round2(saldoHoje + entradas - saidas),
    });
  }
  return pontos;
}

/** Receita por origem: venda e comissão de operadora não são a mesma coisa. */
async function receitaPorOrigem(
  exec: ExecutorSQL, tenantId: string, de: string, ate: string,
): Promise<LinhaNomeada[]> {
  const ROTULOS: Record<string, string> = {
    VENDA: 'Do cliente (inclui repasse)',
    COMISSAO_FORNECEDOR: 'Comissão de operadora',
    FEE: 'Taxa de serviço',
    OUTROS: 'Outras entradas',
  };
  const { rows } = await exec.query(
    `SELECT ${ORIGEM_RECEBER} AS origem,
            COALESCE(ROUND(SUM(${realizado('receber')}), 2), 0) AS valor,
            COUNT(*) AS contas
       FROM contas_receber
      WHERE tenant_id = $1 AND ${NAO_CANCELADA} AND ${dataDoCaixa('receber')} BETWEEN $2 AND $3
      GROUP BY 1 ORDER BY 2 DESC`,
    [tenantId, de, ate],
  );
  return rows
    .map(r => ({
      id: String(r.origem),
      nome: ROTULOS[String(r.origem)] ?? String(r.origem),
      valor: numeroDoBanco(r.valor),
      contas: inteiroDoBanco(r.contas),
    }))
    .filter(l => l.valor !== 0);
}

/**
 * Despesa por categoria do plano de contas, com o balde honesto.
 *
 * `categoria_id` nasce vazio em TODA conta gerada por venda e o formulário
 * manual não exige categoria. Sem a linha "não categorizadas" bem visível,
 * este gráfico esconderia a maior parte do dinheiro e pareceria completo.
 */
async function despesaPorCategoria(
  exec: ExecutorSQL, tenantId: string, de: string, ate: string,
): Promise<LinhaNomeada[]> {
  const { rows } = await exec.query(
    `SELECT COALESCE(NULLIF(pc.data->>'descricao', ''), 'Não categorizadas') AS nome,
            COALESCE(NULLIF(cp.data->>'categoria_id', ''), 'sem-categoria') AS id,
            COALESCE(ROUND(SUM(${realizado('pagar', 'cp')}), 2), 0) AS valor,
            COUNT(*) AS contas
       FROM contas_pagar cp
       LEFT JOIN plano_contas pc
              ON pc.id = NULLIF(cp.data->>'categoria_id', '') AND pc.tenant_id = cp.tenant_id
      WHERE cp.tenant_id = $1 AND ${naoCancelada('cp')}
        AND NOT ${ehRepasse('cp')}
        AND ${dataDoCaixa('pagar', 'cp')} BETWEEN $2 AND $3
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    [tenantId, de, ate],
  );
  return rows
    .map(r => ({ id: String(r.id), nome: String(r.nome), valor: numeroDoBanco(r.valor), contas: inteiroDoBanco(r.contas) }))
    .filter(l => l.valor > 0);
}

/** Para onde o dinheiro vai: ranking de fornecedores pelo que saiu no período. */
async function fornecedores(
  exec: ExecutorSQL, tenantId: string, de: string, ate: string,
): Promise<LinhaNomeada[]> {
  const { rows } = await exec.query(
    `SELECT COALESCE(NULLIF(fornecedor_id, ''), 'pendente') AS id,
            COALESCE(NULLIF(data->>'fornecedor_nome', ''), 'Fornecedor não identificado') AS nome,
            COALESCE(ROUND(SUM(${realizado('pagar')}), 2), 0) AS valor,
            COUNT(*) AS contas
       FROM contas_pagar
      WHERE tenant_id = $1 AND ${NAO_CANCELADA}
        AND ${dataDoCaixa('pagar')} BETWEEN $2 AND $3
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
    [tenantId, de, ate],
  );
  return rows
    .map(r => ({ id: String(r.id), nome: String(r.nome), valor: numeroDoBanco(r.valor), contas: inteiroDoBanco(r.contas) }))
    .filter(l => l.valor > 0);
}

/**
 * Margem por fornecedor — a pergunta de agência de viagens.
 *
 * Quem dá volume não é necessariamente quem dá resultado. Sai do item da venda,
 * que é onde valor de venda e custo convivem por fornecedor.
 */
async function margemPorFornecedor(
  exec: ExecutorSQL, tenantId: string, de: string, ate: string,
): Promise<LinhaDeMargem[]> {
  const cambio = `COALESCE(NULLIF(${numerico(`i.data->>'cambio'`)}, 0), 1)`;
  const { rows } = await exec.query(
    `SELECT COALESCE(NULLIF(i.fornecedor_id, ''), 'pendente') AS id,
            COALESCE(NULLIF(i.data->>'fornecedor_nome', ''), 'Fornecedor não identificado') AS nome,
            COALESCE(ROUND(SUM(${numerico(`i.data->>'valor_venda'`)} * ${cambio}), 2), 0) AS venda,
            COALESCE(ROUND(SUM(${numerico(`i.data->>'valor_custo'`)} * ${cambio}), 2), 0) AS custo
       FROM itens_venda i
       JOIN vendas_crm v ON v.id = i.venda_id AND v.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1
        AND COALESCE(i.status, '') <> 'cancelado'
        AND ${VENDA_REALIZADA}
        AND COALESCE(v.data->>'data_venda', '') BETWEEN $2 AND $3
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
    [tenantId, de, ate],
  );
  return rows
    .map(r => {
      const venda = numeroDoBanco(r.venda);
      const custo = numeroDoBanco(r.custo);
      const margem = round2(venda - custo);
      return {
        id: String(r.id),
        nome: String(r.nome),
        venda,
        custo,
        margem,
        margemPct: venda > 0 ? round2(divSegura(margem, venda) * 100) : null,
      };
    })
    .filter(l => l.venda > 0 || l.custo > 0);
}

/**
 * Ranking de clientes pelo que a agência cobrou.
 *
 * EXCLUI origem COMISSAO_FORNECEDOR de propósito: nessa conta os campos
 * cliente_id e cliente_nome guardam o FORNECEDOR, e sem o filtro o ranking
 * passa a listar operadoras como se fossem clientes.
 */
async function clientes(
  exec: ExecutorSQL, tenantId: string, de: string, ate: string,
): Promise<LinhaNomeada[]> {
  const { rows } = await exec.query(
    `SELECT COALESCE(NULLIF(cliente_id, ''), 'sem-cliente') AS id,
            COALESCE(NULLIF(data->>'cliente_nome', ''), 'Cliente não identificado') AS nome,
            COALESCE(ROUND(SUM(${realizado('receber')}), 2), 0) AS valor,
            COUNT(*) AS contas
       FROM contas_receber
      WHERE tenant_id = $1 AND ${NAO_CANCELADA}
        AND ${ORIGEM_RECEBER} <> 'COMISSAO_FORNECEDOR'
        AND ${dataDoCaixa('receber')} BETWEEN $2 AND $3
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
    [tenantId, de, ate],
  );
  return rows
    .map(r => ({ id: String(r.id), nome: String(r.nome), valor: numeroDoBanco(r.valor), contas: inteiroDoBanco(r.contas) }))
    .filter(l => l.valor > 0);
}

/** Os próximos movimentos, dia a dia, incluindo o que já venceu e não entrou. */
async function agenda(
  exec: ExecutorSQL, tenantId: string, hoje: string, ate: string,
): Promise<LancamentoDaAgenda[]> {
  const consulta = (tabela: string, lado: 'receber' | 'pagar', nome: string) =>
    `SELECT id, data->>'data_vencimento' AS venc, '${lado}' AS lado,
            ${emAberto(lado)} AS valor,
            COALESCE(NULLIF(data->>'descricao', ''), '') AS descricao,
            COALESCE(NULLIF(data->>'${nome}', ''), '') AS contraparte
       FROM ${tabela}
      WHERE tenant_id = $1 AND ${NAO_CANCELADA}
        AND ${emAberto(lado)} > 0
        AND COALESCE(data->>'data_vencimento', '') <> ''
        AND data->>'data_vencimento' <= $2`;
  // `hoje` não entra como parâmetro: ele só marca o que já venceu, e isso é
  // decidido em JS. Parâmetro declarado e não usado faz o Postgres recusar a
  // query inteira com "could not determine data type".
  const { rows } = await exec.query(
    `${consulta('contas_receber', 'receber', 'cliente_nome')}
     UNION ALL
     ${consulta('contas_pagar', 'pagar', 'fornecedor_nome')}
     ORDER BY venc ASC, valor DESC LIMIT 60`,
    [tenantId, ate],
  );
  return rows.map(r => ({
    id: String(r.id),
    data: String(r.venc),
    lado: r.lado === 'receber' ? 'receber' : 'pagar',
    valor: numeroDoBanco(r.valor),
    descricao: String(r.descricao),
    contraparte: String(r.contraparte),
    vencido: String(r.venc) < hoje,
  }));
}

/**
 * Descasamento entre pagar o fornecedor e receber do cliente, na MESMA venda.
 *
 * É o aperto de capital de giro de uma agência escrito em números: a operadora
 * cobra antes de o cliente terminar de pagar, e a diferença sai do bolso da
 * agência. Nenhuma tela do sistema mostra isso hoje.
 */
async function descasamento(
  exec: ExecutorSQL, tenantId: string,
): Promise<VendaDescasada[]> {
  const { rows } = await exec.query(
    `WITH pagar AS (
       SELECT ${vendaDeOrigem('pagar')} AS venda, MIN(data->>'data_vencimento') AS primeiro,
              COALESCE(ROUND(SUM(${emAberto('pagar')}), 2), 0) AS aberto
         FROM contas_pagar
        WHERE tenant_id = $1 AND ${NAO_CANCELADA} AND ${emAberto('pagar')} > 0
          AND COALESCE(data->>'data_vencimento', '') <> ''
        GROUP BY 1
     ), receber AS (
       SELECT ${vendaDeOrigem('receber')} AS venda, MIN(data->>'data_vencimento') AS primeiro
         FROM contas_receber
        WHERE tenant_id = $1 AND ${NAO_CANCELADA} AND ${emAberto('receber')} > 0
          AND ${ORIGEM_RECEBER} <> 'COMISSAO_FORNECEDOR'
          AND COALESCE(data->>'data_vencimento', '') <> ''
        GROUP BY 1
     )
     -- tenant-ok: as duas CTEs acima já filtram tenant_id = $1, então cada
     -- lado deste JOIN é de uma agência só e casar por venda basta. O LEFT
     -- JOIN em vendas_crm, esse sim, repete a cláusula: ele toca a tabela.
     SELECT p.venda, p.primeiro AS primeiro_pagamento, r.primeiro AS primeiro_recebimento, p.aberto,
            COALESCE(NULLIF(v.data->>'numero', ''), '') AS numero,
            COALESCE(NULLIF(v.data->>'cliente_nome', ''), '') AS cliente,
            (r.primeiro::date - p.primeiro::date) AS gap
       FROM pagar p
       JOIN receber r ON r.venda = p.venda
       LEFT JOIN vendas_crm v ON v.id = p.venda AND v.tenant_id = $1
      WHERE p.venda IS NOT NULL AND p.venda <> ''
        AND r.primeiro > p.primeiro
      ORDER BY gap DESC, p.aberto DESC LIMIT 8`,
    [tenantId],
  );
  return rows.map(r => ({
    vendaId: String(r.venda),
    numero: String(r.numero || r.venda).slice(0, 20),
    cliente: String(r.cliente),
    primeiroPagamento: String(r.primeiro_pagamento),
    primeiroRecebimento: String(r.primeiro_recebimento),
    diasDeGap: inteiroDoBanco(r.gap),
    valorAdiantado: numeroDoBanco(r.aberto),
  }));
}

/**
 * Volume, custo e receita das vendas do período, e quanto disso não tem lastro.
 *
 * Venda sem NENHUMA conta viva é receita que não existe no caixa: a regra já é
 * lei em venda-lancamentos.ts e o número precisa aparecer, porque é um problema
 * de cadastro que ninguém vê.
 */
async function vendasDoPeriodo(
  exec: ExecutorSQL, tenantId: string, de: string, ate: string,
) {
  const valor = numerico(`COALESCE(v.data->>'valor_final', v.data->>'valor_total_venda', v.data->>'valor_total')`);
  const custo = numerico(`COALESCE(v.data->>'valor_total_custo', v.data->>'custo_total')`);
  const temLastro = (lado: 'receber' | 'pagar') =>
    `EXISTS (SELECT 1 FROM contas_${lado} c
              WHERE c.tenant_id = v.tenant_id
                AND ${naoCancelada('c')}
                AND ${vendaDeOrigem(lado, 'c')} = v.id)`;
  const { rows } = await exec.query(
    `SELECT
       COUNT(*) AS quantidade,
       COALESCE(ROUND(SUM(${valor}), 2), 0) AS volume,
       COALESCE(ROUND(SUM(${custo}), 2), 0) AS custo,
       COALESCE(ROUND(SUM(GREATEST(${valor} - ${custo}, 0)), 2), 0) AS receita,
       COUNT(*) FILTER (WHERE NOT (${temLastro('receber')} OR ${temLastro('pagar')})) AS sem_lastro,
       COALESCE(ROUND(SUM(CASE WHEN NOT (${temLastro('receber')} OR ${temLastro('pagar')}) THEN ${valor} ELSE 0 END), 2), 0) AS volume_sem_lastro
       FROM vendas_crm v
      WHERE v.tenant_id = $1 AND ${VENDA_REALIZADA}
        AND COALESCE(v.data->>'data_venda', '') BETWEEN $2 AND $3`,
    [tenantId, de, ate],
  );
  const l = rows[0] ?? {};
  const quantidade = inteiroDoBanco(l.quantidade);
  const volume = numeroDoBanco(l.volume);
  const receitaAgencia = numeroDoBanco(l.receita);
  return {
    volume,
    receitaAgencia,
    custo: numeroDoBanco(l.custo),
    quantidade,
    margemPct: volume > 0 ? round2(divSegura(receitaAgencia, volume) * 100) : null,
    ticketVolume: round2(divSegura(volume, quantidade)),
    ticketReceita: round2(divSegura(receitaAgencia, quantidade)),
    semLastro: { quantidade: inteiroDoBanco(l.sem_lastro), volume: numeroDoBanco(l.volume_sem_lastro) },
  };
}

/** As pendências que custam dinheiro, contadas numa consulta só por lado. */
async function atencao(exec: ExecutorSQL, tenantId: string) {
  const abertoP = emAberto('pagar');
  const abertoR = emAberto('receber');
  const [p, r] = await Promise.all([
    exec.query(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(data->>'fornecedor_pendente', '') = 'true' AND ${abertoP} > 0) AS sem_fornecedor,
         COUNT(*) FILTER (WHERE COALESCE(data->>'data_vencimento', '') = '' AND ${abertoP} > 0) AS sem_vencimento,
         COALESCE(ROUND(SUM(CASE WHEN COALESCE(NULLIF(data->>'categoria_id', ''), '') = ''
                                  AND NOT ${EH_REPASSE} THEN ${realizado('pagar')} ELSE 0 END), 2), 0) AS nao_categorizadas,
         COUNT(*) FILTER (WHERE COALESCE(NULLIF(data->>'categoria_id', ''), '') = '' AND NOT ${EH_REPASSE}) AS nao_categorizadas_contas
         FROM contas_pagar WHERE tenant_id = $1 AND ${NAO_CANCELADA}`,
      [tenantId],
    ),
    exec.query(
      `SELECT COUNT(*) FILTER (WHERE ${abertoR} > 0 AND COALESCE(data->>'data_vencimento', '') = '') AS sem_vencimento
         FROM contas_receber WHERE tenant_id = $1 AND ${NAO_CANCELADA}`,
      [tenantId],
    ),
  ]);
  return {
    semFornecedor: inteiroDoBanco(p.rows[0]?.sem_fornecedor),
    semVencimento: inteiroDoBanco(p.rows[0]?.sem_vencimento) + inteiroDoBanco(r.rows[0]?.sem_vencimento),
    naoCategorizadas: {
      valor: numeroDoBanco(p.rows[0]?.nao_categorizadas),
      contas: inteiroDoBanco(p.rows[0]?.nao_categorizadas_contas),
    },
  };
}

function comparar(atual: number, anterior: number): Comparavel {
  return { atual, anterior, variacao: variacaoPct(atual, anterior) };
}

// ══════════════════════════════════════════════════════════════════════
// O orquestrador
// ══════════════════════════════════════════════════════════════════════

export async function carregarDashboard(
  exec: ExecutorSQL,
  e: EntradaDashboard,
): Promise<DashboardFinanceiro> {
  const { tenantId, de, ate, hoje, deAnterior, ateAnterior } = e;

  // Trinta dias à frente para a agenda; a projeção vai mais longe.
  const limiteAgenda = new Date(`${hoje}T12:00:00`);
  limiteAgenda.setDate(limiteAgenda.getDate() + 30);
  const ateAgenda = limiteAgenda.toISOString().slice(0, 10);

  const [
    caixaAtual, caixaAnterior, saldo,
    posReceber, posPagar,
    agingReceber, agingPagar,
    serie, origens, categorias, forns, margens, clis, ag, desc, vendas, alertas,
  ] = await Promise.all([
    movimentoDeCaixa(exec, tenantId, de, ate),
    movimentoDeCaixa(exec, tenantId, deAnterior, ateAnterior),
    saldoEmCaixa(exec, tenantId),
    posicao(exec, 'contas_receber', 'receber', tenantId, hoje),
    posicao(exec, 'contas_pagar', 'pagar', tenantId, hoje),
    aging(exec, 'contas_receber', 'receber', tenantId, hoje),
    aging(exec, 'contas_pagar', 'pagar', tenantId, hoje),
    serieMensal(exec, tenantId, de, ate),
    receitaPorOrigem(exec, tenantId, de, ate),
    despesaPorCategoria(exec, tenantId, de, ate),
    fornecedores(exec, tenantId, de, ate),
    margemPorFornecedor(exec, tenantId, de, ate),
    clientes(exec, tenantId, de, ate),
    agenda(exec, tenantId, hoje, ateAgenda),
    descasamento(exec, tenantId),
    vendasDoPeriodo(exec, tenantId, de, ate),
    atencao(exec, tenantId),
  ]);

  const proj = await projecao(exec, tenantId, hoje, saldo.saldo);

  const resultadoAtual = round2(caixaAtual.entradas - caixaAtual.saidas);
  const resultadoAnterior = round2(caixaAnterior.entradas - caixaAnterior.saidas);

  // Quantos meses o caixa de hoje cobre, no ritmo de despesa PRÓPRIA do
  // período. Repasse fica de fora: ele só sai quando entrou a venda que o
  // gerou, então contá-lo como despesa recorrente encurtaria o fôlego de
  // mentira.
  const diasDoPeriodo = Math.max(
    1,
    Math.round((Date.parse(`${ate}T12:00:00`) - Date.parse(`${de}T12:00:00`)) / 86_400_000) + 1,
  );
  const despesaMensal = round2(divSegura(caixaAtual.despesasProprias, diasDoPeriodo) * 30);

  return {
    periodo: { de, ate, hoje, deAnterior, ateAnterior },
    caixa: {
      saldo: saldo.saldo,
      saldoInicialDasContas: saldo.inicial,
      entradas: comparar(caixaAtual.entradas, caixaAnterior.entradas),
      saidas: comparar(caixaAtual.saidas, caixaAnterior.saidas),
      resultado: comparar(resultadoAtual, resultadoAnterior),
      repasses: caixaAtual.repasses,
      despesasProprias: comparar(caixaAtual.despesasProprias, caixaAnterior.despesasProprias),
    },
    posicao: { receber: posReceber, pagar: posPagar },
    aging: { receber: agingReceber, pagar: agingPagar },
    serie,
    projecao: proj,
    receitaPorOrigem: origens,
    despesaPorCategoria: categorias,
    fornecedores: forns,
    margemPorFornecedor: margens,
    clientes: clis,
    agenda: ag,
    descasamento: desc,
    vendas,
    atencao: {
      pagarVencido: { valor: posPagar.vencido, contas: posPagar.contasVencidas },
      receberVencido: { valor: posReceber.vencido, contas: posReceber.contasVencidas },
      venceHoje: { receber: posReceber.venceHoje, pagar: posPagar.venceHoje },
      ...alertas,
    },
    cobertura: {
      meses: despesaMensal > 0 ? round2(divSegura(saldo.saldo, despesaMensal)) : null,
      despesaMensal,
    },
  };
}

/** Exportado para o teste conferir que nada some entre a consulta e o payload. */
export const CONSULTAS_INTERNAS = {
  movimentoDeCaixa, saldoEmCaixa, posicao, aging, serieMensal, projecao,
  receitaPorOrigem, despesaPorCategoria, fornecedores, margemPorFornecedor,
  clientes, agenda, descasamento, vendasDoPeriodo, atencao,
};
