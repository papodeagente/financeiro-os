/**
 * Do total até o lançamento: o drill-down do Dashboard Financeiro.
 *
 * POR QUE UMA CONSULTA PRÓPRIA. Um número agregado sem caminho de volta é um
 * número em que a pessoa tem que acreditar. "R$ 18.400 vencidos" só vira
 * decisão quando dá para ver QUEM, QUANTO e HÁ QUANTO TEMPO — e é aí que o
 * dono liga para o cliente.
 *
 * A alternativa seria baixar a tabela inteira e filtrar no navegador, que é
 * exatamente o que este trabalho saiu de fazer. Aqui o recorte vai ao banco.
 *
 * O RECORTE É UM ENUM, NÃO UM PEDAÇO DE SQL. O cliente manda um nome de uma
 * lista fechada e, quando precisa, um id que vai como PARÂMETRO. Nenhum texto
 * vindo do navegador entra na consulta por concatenação.
 */

import { round2 } from './money';
import {
  type ExecutorSQL,
} from './dashboard-financeiro';
import {
  dataDoCaixa, ehRepasse, emAberto, inteiroDoBanco, naoCancelada, numeroDoBanco,
  origemReceber, realizado, vendaDeOrigem,
} from './dashboard-sql';

export type LadoDoLancamento = 'receber' | 'pagar';

export type RecorteDoDetalhe =
  /** Tudo que ainda falta entrar ou sair. */
  | 'em-aberto'
  /** Em aberto com vencimento anterior a hoje. */
  | 'vencido'
  /** Em aberto vencendo exatamente hoje. */
  | 'vence-hoje'
  /** O que se moveu no caixa dentro do período. */
  | 'realizado'
  /** Em aberto de um fornecedor (a pagar) ou cliente (a receber). */
  | 'contraparte'
  /** Realizado de uma categoria do plano de contas. */
  | 'categoria'
  /** Realizado de uma origem de receita. */
  | 'origem'
  /** Tudo ligado a uma venda. */
  | 'venda';

export const RECORTES: RecorteDoDetalhe[] = [
  'em-aberto', 'vencido', 'vence-hoje', 'realizado', 'contraparte', 'categoria', 'origem', 'venda',
];

export interface LancamentoDetalhado {
  id: string;
  lado: LadoDoLancamento;
  descricao: string;
  contraparte: string;
  vencimento: string;
  /** Quando o dinheiro de fato se moveu, se já se moveu. */
  baixa: string | null;
  status: string;
  valorTotal: number;
  valorRealizado: number;
  valorEmAberto: number;
  /** Negativo quando ainda vai vencer. Null sem data de vencimento. */
  diasDeAtraso: number | null;
  vendaId: string | null;
}

export interface EntradaDoDetalhe {
  tenantId: string;
  lado: LadoDoLancamento;
  recorte: RecorteDoDetalhe;
  /** O id da contraparte, categoria, origem ou venda, conforme o recorte. */
  referencia?: string;
  de: string;
  ate: string;
  hoje: string;
  limite?: number;
}

/** Teto de linhas. Drill-down é para investigar, não para exportar a base. */
const LIMITE_PADRAO = 200;
const LIMITE_MAXIMO = 500;

export async function listarLancamentos(
  exec: ExecutorSQL,
  e: EntradaDoDetalhe,
): Promise<{ linhas: LancamentoDetalhado[]; total: number; truncado: boolean }> {
  const tabela = e.lado === 'receber' ? 'contas_receber' : 'contas_pagar';
  const nomeDaContraparte = e.lado === 'receber' ? 'cliente_nome' : 'fornecedor_nome';
  const colunaDaContraparte = e.lado === 'receber' ? 'cliente_id' : 'fornecedor_id';
  const campoDaBaixa = e.lado === 'receber' ? 'data_recebimento' : 'data_pagamento';
  const aberto = emAberto(e.lado);
  const feito = realizado(e.lado);
  const venc = `COALESCE(data->>'data_vencimento', '')`;

  // $1 tenant, $2 de, $3 ate, $4 hoje, $5 referência. Os cinco são SEMPRE
  // passados, mesmo quando não usados: parâmetro órfão faz o Postgres recusar
  // a query inteira com "could not determine data type", então cada ramo usa
  // todos, nem que seja numa comparação inócua.
  const referencia = e.referencia ?? '';

  const condicoes: Record<RecorteDoDetalhe, string> = {
    'em-aberto': `${aberto} > 0 AND ($2 <= $3) AND ($4 = $4) AND ($5 = $5)`,
    vencido: `${aberto} > 0 AND ${venc} <> '' AND ${venc} < $4 AND ($2 <= $3) AND ($5 = $5)`,
    'vence-hoje': `${aberto} > 0 AND ${venc} = $4 AND ($2 <= $3) AND ($5 = $5)`,
    realizado: `${feito} <> 0 AND ${dataDoCaixa(e.lado)} BETWEEN $2 AND $3 AND ($4 = $4) AND ($5 = $5)`,
    contraparte: `${aberto} > 0 AND COALESCE(NULLIF(${colunaDaContraparte}, ''), 'pendente') = $5 AND ($2 <= $3) AND ($4 = $4)`,
    // O drill-down aplica EXATAMENTE o mesmo filtro do número que ele abre.
    // Sem excluir o repasse aqui, clicar em "Não categorizadas R$ 900" abriria
    // R$ 12.900 — e um detalhe que não fecha com o total destrói a confiança
    // no painel inteiro, não só naquele card.
    categoria: `${feito} <> 0 AND COALESCE(NULLIF(data->>'categoria_id', ''), 'sem-categoria') = $5 AND ${dataDoCaixa(e.lado)} BETWEEN $2 AND $3 AND ($4 = $4)${e.lado === 'pagar' ? ` AND NOT ${ehRepasse()}` : ''}`,
    origem:
      e.lado === 'receber'
        ? `${feito} <> 0 AND ${origemReceber()} = $5 AND ${dataDoCaixa('receber')} BETWEEN $2 AND $3 AND ($4 = $4)`
        : `${feito} <> 0 AND COALESCE(NULLIF(data->>'origem', ''), 'OUTROS') = $5 AND ${dataDoCaixa('pagar')} BETWEEN $2 AND $3 AND ($4 = $4)`,
    venda: `${vendaDeOrigem(e.lado)} = $5 AND ($2 <= $3) AND ($4 = $4)`,
  };

  const condicao = condicoes[e.recorte] ?? condicoes['em-aberto'];
  const limite = Math.min(LIMITE_MAXIMO, Math.max(1, e.limite ?? LIMITE_PADRAO));
  const parametros = [e.tenantId, e.de, e.ate, e.hoje, referencia];

  const [linhas, contagem] = await Promise.all([
    exec.query(
      `SELECT id,
              COALESCE(NULLIF(data->>'descricao', ''), '') AS descricao,
              COALESCE(NULLIF(data->>'${nomeDaContraparte}', ''), '') AS contraparte,
              ${venc} AS vencimento,
              NULLIF(data->>'${campoDaBaixa}', '') AS baixa,
              COALESCE(data->>'status', '') AS status,
              ${realizado(e.lado)} AS realizado,
              ${aberto} AS em_aberto,
              (CASE WHEN data->>'valor_final' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ROUND((data->>'valor_final')::numeric, 2) ELSE 0 END) AS total,
              ${vendaDeOrigem(e.lado)} AS venda
         FROM ${tabela}
        WHERE tenant_id = $1 AND ${naoCancelada()} AND ${condicao}
        ORDER BY ${venc} ASC NULLS LAST, id ASC
        LIMIT ${limite}`,
      parametros,
    ),
    exec.query(
      `SELECT COUNT(*) AS n FROM ${tabela}
        WHERE tenant_id = $1 AND ${naoCancelada()} AND ${condicao}`,
      parametros,
    ),
  ]);

  const total = inteiroDoBanco(contagem.rows[0]?.n);
  const hoje = e.hoje;

  return {
    total,
    truncado: total > limite,
    linhas: linhas.rows.map(r => {
      const vencimento = String(r.vencimento ?? '');
      return {
        id: String(r.id),
        lado: e.lado,
        descricao: String(r.descricao),
        contraparte: String(r.contraparte),
        vencimento,
        baixa: r.baixa ? String(r.baixa) : null,
        status: String(r.status),
        valorTotal: numeroDoBanco(r.total),
        valorRealizado: numeroDoBanco(r.realizado),
        valorEmAberto: numeroDoBanco(r.em_aberto),
        // Positivo = atrasado, negativo = ainda vai vencer. A conta é feita em
        // data civil, por diferença de milissegundos ao meio-dia, para o fuso
        // não empurrar o resultado um dia.
        diasDeAtraso: vencimento
          ? Math.round(
              (Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${vencimento}T12:00:00Z`)) / 86_400_000,
            )
          : null,
        vendaId: r.venda ? String(r.venda) : null,
      };
    }),
  };
}

/** Soma do recorte, para a tela conferir que o detalhe fecha com o total. */
export function somarDetalhe(linhas: LancamentoDetalhado[], campo: 'valorEmAberto' | 'valorRealizado'): number {
  return round2(linhas.reduce((t, l) => round2(t + l[campo]), 0));
}
