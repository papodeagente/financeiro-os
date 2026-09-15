/**
 * As expressões SQL do Dashboard, escritas UMA vez.
 *
 * POR QUE ISTO EXISTE SEPARADO. O dashboard precisa agregar tudo no servidor:
 * o CRUD genérico devolve a tabela INTEIRA do tenant, sem filtro nem paginação
 * (crud-api.ts:52), então montar quarenta indicadores no navegador significa
 * baixar sete tabelas e ficar mais lento a cada mês de operação.
 *
 * Mas mover a conta para o SQL cria um risco novo e pior: uma segunda
 * definição de dinheiro, divergente da que resultado-financeiro.ts já encarna.
 * Foi exatamente esse problema que aquela camada nasceu para acabar. Por isso
 * cada expressão daqui tem um espelho em TypeScript, e o teste compara os
 * dois lado a lado sobre as MESMAS linhas — se alguém mudar uma e esquecer a
 * outra, o teste quebra. Ver scripts/test-sql-dashboard.mjs.
 *
 * TRÊS ARMADILHAS QUE ESTAS EXPRESSÕES EXISTEM PARA DESARMAR:
 *
 *  1. `status = 'RECEBIDO'` NÃO é o realizado. Baixa PARCIAL guarda o
 *     ACUMULADO em valor_recebido e é estado normal, não exceção. Filtrar por
 *     igualdade de status faz o dinheiro de quem paga parcelado sumir.
 *  2. `(data->>'campo')::numeric` estoura a query inteira quando o JSONB traz
 *     texto. Todo cast passa por guarda de regex antes — o mesmo padrão que
 *     /api/folha já usa.
 *  3. Conta a pagar auto-gerada da venda é REPASSE ao fornecedor: já foi
 *     descontada dentro da margem. Somá-la como despesa cobra o custo duas
 *     vezes, e repasse é a maior linha de dinheiro de uma agência.
 */

/** Guarda de cast: JSONB com texto não pode derrubar a agregação. */
export function numerico(campo: string): string {
  return `(CASE WHEN ${campo} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${campo})::numeric ELSE 0 END)`;
}

/**
 * O prefixo da coluna JSONB, com alias quando a query tem JOIN.
 *
 * Existe porque a alternativa — montar o SQL sem alias e prefixar por regex
 * depois — transforma `cp.data->>` em `cp.cp.data->>` na segunda passada. O
 * alias precisa entrar na construção, não na correção.
 */
function campo(nome: string, alias?: string): string {
  return `${alias ? `${alias}.` : ''}data->>'${nome}'`;
}

/**
 * Quanto a conta JÁ moveu no caixa. Espelho SQL de
 * resultado-financeiro.ts:103-113 (valorRealizado).
 *
 * `lado` decide o campo de baixa e o status de quitação, e é a única coisa que
 * muda entre receber e pagar.
 */
export function realizado(lado: 'receber' | 'pagar', alias?: string): string {
  const nomeDaBaixa = lado === 'receber' ? 'valor_recebido' : 'valor_pago';
  const quitado = lado === 'receber' ? 'RECEBIDO' : 'PAGO';
  const baixa = numerico(campo(nomeDaBaixa, alias));
  const total = numerico(campo('valor_final', alias));
  const status = campo('status', alias);
  return `(CASE
      WHEN ${status} = 'CANCELADO' THEN 0
      WHEN ${status} = 'PARCIAL'   THEN ROUND(${baixa}, 2)
      WHEN ${status} = '${quitado}' THEN ROUND(COALESCE(NULLIF(${baixa}, 0), ${total}), 2)
      ELSE 0
    END)`;
}

/** Quanto ainda falta entrar ou sair. Nunca negativo. Espelho de valorEmAberto. */
export function emAberto(lado: 'receber' | 'pagar', alias?: string): string {
  const total = numerico(campo('valor_final', alias));
  return `(CASE
      WHEN ${campo('status', alias)} = 'CANCELADO' THEN 0
      ELSE GREATEST(ROUND(${total} - ${realizado(lado, alias)}, 2), 0)
    END)`;
}

/** A data em que o dinheiro se moveu; sem baixa, cai no vencimento. */
export function dataDoCaixa(lado: 'receber' | 'pagar', alias?: string): string {
  const nome = lado === 'receber' ? 'data_recebimento' : 'data_pagamento';
  return `COALESCE(NULLIF(${campo(nome, alias)}, ''), ${campo('data_vencimento', alias)})`;
}

/** Conta cancelada não existe para efeito de número. */
export function naoCancelada(alias?: string): string {
  return `COALESCE(${campo('status', alias)}, '') <> 'CANCELADO'`;
}
export const NAO_CANCELADA = naoCancelada();

/**
 * Repasse ao fornecedor: a conta a pagar que a própria venda gerou.
 *
 * Ela É o custo que já saiu dentro da margem. Toda soma de DESPESA precisa
 * excluí-la, e toda soma de SAÍDA DE CAIXA precisa incluí-la — são perguntas
 * diferentes, e confundi-las é o erro que derruba o lucro pelo valor inteiro
 * dos fornecedores.
 */
// COALESCE não é decoração aqui: `auto_gerado` ausente faz a comparação valer
// NULL, e `NOT NULL` também é NULL — o que tira a linha do WHERE em silêncio.
// Sem isto, toda conta a pagar criada À MÃO sobre uma venda (que tem origem
// 'VENDA' mas não tem auto_gerado) sumia do total de despesas sem erro nenhum,
// e o total continuava batendo consigo mesmo e mentindo.
export function ehRepasse(alias?: string): string {
  return `(COALESCE(${campo('auto_gerado', alias)}, '') = 'true' AND COALESCE(${campo('origem', alias)}, '') = 'VENDA')`;
}
export const EH_REPASSE = ehRepasse();

/**
 * A origem da conta a receber, com o default explícito.
 *
 * 'VENDA' é dinheiro do cliente, em boa parte repasse. 'COMISSAO_FORNECEDOR' é
 * receita pura da agência. Somar as duas como a mesma coisa é o erro mais caro
 * possível neste sistema. Origem ausente conta como VENDA.
 */
export function origemReceber(alias?: string): string {
  return `COALESCE(NULLIF(${campo('origem', alias)}, ''), 'VENDA')`;
}
export const ORIGEM_RECEBER = origemReceber();

/**
 * A venda que originou a conta.
 *
 * NÃO use origem_item_id: o webhook apaga e recria os itens da venda com ids
 * novos a cada reentrega, então casar por item duplica receita.
 */
export function vendaDeOrigem(lado: 'receber' | 'pagar', alias?: string): string {
  const doJson = `NULLIF(${campo('origem_venda_id', alias)}, '')`;
  // contas_pagar NÃO tem coluna venda_id (db.ts:85 tem, db.ts:96 não): usar a
  // coluna dos dois lados derruba a query com "column does not exist".
  // Os dois lados têm índice parcial sobre data->>'origem_venda_id'
  // (db.ts:1254-1259), então o JSONB é também o caminho rápido.
  if (lado === 'pagar') return doJson;
  return `COALESCE(${doJson}, NULLIF(${alias ? `${alias}.` : ''}venda_id, ''))`;
}

/**
 * A data de vencimento, SÓ quando ela é uma data ISO de verdade.
 *
 * Uma única conta gravada com '30/09/2026' faz qualquer `::date` estourar e
 * derruba a consulta inteira — e, com ela, o painel. O que não casar vira NULL
 * e cai na faixa 'sem data', que já existe e já aparece na tela.
 */
export function vencimentoValido(alias?: string): string {
  const c = campo('data_vencimento', alias);
  return `(CASE WHEN ${c} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN ${c} ELSE NULL END)`;
}

/**
 * A faixa de prazo de uma conta em aberto.
 *
 * ESCRITA UMA VEZ SÓ, de propósito: o gráfico de aging e o drill-down que ele
 * abre precisam usar a MESMA fronteira de dias. Duas cópias divergem na
 * primeira manutenção, e aí clicar em "vencido há 8 a 30 dias" passa a abrir
 * outro conjunto de contas — que é o jeito mais rápido de destruir a confiança
 * no painel inteiro.
 *
 * `$hoje` é o nome do parâmetro que carrega a data civil de hoje na consulta.
 */
export function faixaDeAging(hoje: string, alias?: string): string {
  const venc = vencimentoValido(alias);
  const dias = `(${venc}::date - ${hoje}::date)`;
  return `(CASE
      WHEN ${venc} IS NULL THEN 'sem_data'
      WHEN ${dias} < -30   THEN 'vencido_30'
      WHEN ${dias} < -7    THEN 'vencido_8_30'
      WHEN ${dias} < 0     THEN 'vencido_1_7'
      WHEN ${dias} = 0     THEN 'hoje'
      WHEN ${dias} <= 7    THEN 'ate_7'
      WHEN ${dias} <= 15   THEN 'ate_15'
      WHEN ${dias} <= 30   THEN 'ate_30'
      ELSE                      'acima_30'
    END)`;
}

/** Os rótulos humanos das faixas, na ordem em que a leitura acontece. */
export const FAIXAS_DE_AGING: Array<{ id: string; rotulo: string }> = [
  { id: 'vencido_30', rotulo: 'vencido há mais de 30 dias' },
  { id: 'vencido_8_30', rotulo: 'vencido há 8 a 30 dias' },
  { id: 'vencido_1_7', rotulo: 'vencido há até 7 dias' },
  { id: 'hoje', rotulo: 'vence hoje' },
  { id: 'ate_7', rotulo: 'até 7 dias' },
  { id: 'ate_15', rotulo: '8 a 15 dias' },
  { id: 'ate_30', rotulo: '16 a 30 dias' },
  { id: 'acima_30', rotulo: 'mais de 30 dias' },
  // Não descartar em silêncio: conta sem vencimento é dinheiro que ninguém
  // sabe quando entra, e isso é problema a resolver, não linha a sumir.
  { id: 'sem_data', rotulo: 'sem data de vencimento' },
];

/** Status de venda que conta como realizada, nos três vocabulários do banco. */
export const VENDA_REALIZADA = `UPPER(COALESCE(v.data->>'status', '')) IN ('CONFIRMADO', 'CONCLUIDO', 'FECHADA', 'PAGA', 'CONCLUIDA', 'VENDIDO')`;

/**
 * Driver do Postgres devolve NUMERIC como string decimal SQL ('8000.0000').
 *
 * NÃO passar por num()/parseMoneyBR: o parser pt-BR leria o ponto como
 * separador de milhar e transformaria 8 mil em 80 mil.
 */
export function numeroDoBanco(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(String(valor ?? '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Inteiro vindo de COUNT(). Mesma armadilha, mesmo cuidado. */
export function inteiroDoBanco(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(String(valor ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
