/**
 * Movimentos de caixa: a fonte única do Extrato de conta e das Movimentações
 * (05/11/2026).
 *
 * Cada real que entrou ou saiu de uma conta bancária vira UMA linha, com
 * conta, data, pessoa, documento, forma, origem e link para o registro:
 *   · conta a receber baixada (quitada ou PARCIAL, pelo acumulado) → entrada;
 *     inclui o crédito das plataformas (Asaas, Pagar.me, Hotmart), que a
 *     integração grava como conta RECEBIDA com o líquido em valor_recebido;
 *   · taxa retida informada na baixa (`taxa`) → saída "Taxa retida", opcional;
 *   · conta a pagar baixada (quitada ou PARCIAL) → saída;
 *   · transferência EFETIVADA → saída na origem e entrada no destino.
 * Baixa sem conta bancária cai na Caixa Geral, como no "Recalcular saldos".
 *
 * A REGRA É A DE `reconstruirSaldos` (razao.ts). O teste
 * scripts/test-sql-movimentos-caixa.mjs prova que, sem as linhas de taxa,
 * saldo inicial + Σ movimentos = saldo reconstruído, conta por conta; e que,
 * com elas, bate com o "Em caixa hoje" (calcularSaldoBancario).
 *
 * QUANDO O SALDO GRAVADO (saldo_atual) DIFERE DO SALDO DO EXTRATO:
 *  1. taxa retida informada na baixa: o saldo gravado e o reconstruído não a
 *     descontam; o extrato (com a linha de taxa) e o "Em caixa hoje" descontam;
 *  2. movimento sem título por trás: saldo editado à mão, saldo inicial
 *     trocado depois dos movimentos, estorno de transação duplicada de
 *     plataforma, recálculo antigo, título apagado sem estorno;
 *  3. baixa apontando para uma conta bancária que não existe mais (o
 *     reconstruído ignora; o gravado da conta antiga ficou com o valor);
 *  4. data da baixa vazia: entra no saldo anterior de qualquer período.
 * A resposta traz, por conta, gravado × reconstruído e a diferença, para a
 * tela avisar em vez de esconder. Nada é ajustado aqui.
 *
 * Dinheiro em centavos inteiros na soma (BIGINT no SQL); reais só na borda.
 * Datas civis 'YYYY-MM-DD'.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { realizado, taxaRetida, numerico } from './dashboard-sql';
import { deCentavos, num, paraCentavos, round2 } from './money';
import { valorMovimentado } from './saldo-bancario';
import { taxaRealizada } from './taxa-plataforma';
import { auditCsvCell } from './audit-query';

export const CAIXA_GERAL = 'Caixa Geral';

export type OrigemDoMovimento = 'receber' | 'pagar' | 'transferencia' | 'taxa';
export type TipoDoMovimento = 'entrada' | 'saida';

export interface MovimentoCaixa {
  /** Única por linha: 'cr:<id>', 'crt:<id>', 'cp:<id>', 'tr:<id>:s', 'tr:<id>:e'. */
  chave: string;
  origem: OrigemDoMovimento;
  tipo: TipoDoMovimento;
  registro_tabela: 'contas_receber' | 'contas_pagar' | 'transferencias';
  registro_id: string;
  conta_id: string;
  conta_nome: string;
  /** 'YYYY-MM-DD' ou '' (baixa sem data: conta como "antes de tudo"). */
  data: string;
  /** Com sinal: entrada positiva, saída negativa. */
  valor: number;
  numero: string;
  descricao: string;
  documento: string;
  pessoa_id: string;
  pessoa_nome: string;
  cpf_cnpj: string;
  forma: string;
  venda_id: string;
  venda_numero: string;
  /** Cartão (final) ou cheque, quando houver. */
  cartao_cheque: string;
  moeda: string;
  valor_origem: number | null;
  cambio: number | null;
  plataforma: string;
  informacoes: string;
  /** Saldo da conta depois desta linha (ordem cronológica). */
  saldo_conta: number;
  /** Saldo das contas escolhidas, somadas, depois desta linha. */
  saldo_total: number;
}

// ─── Filtros ────────────────────────────────────────────────────────────────

export const ORDENS = ['data', 'valor', 'pessoa', 'descricao', 'conta', 'forma', 'numero'] as const;
export type OrdemDoExtrato = (typeof ORDENS)[number];
export const AGRUPAMENTOS = ['nenhum', 'dia', 'conta', 'pessoa', 'forma', 'origem'] as const;
export type AgrupamentoDoExtrato = (typeof AGRUPAMENTOS)[number];

export interface FiltroDeMovimentos {
  /** Contas escolhidas; vazio = todas. */
  contas: string[];
  de: string;
  ate: string;
  tipo: TipoDoMovimento | '';
  origem: OrigemDoMovimento | '';
  forma: string;
  pessoa: string;
  busca: string;
  /** Linhas de taxa retida (padrão ligado: o extrato bate com o banco). */
  taxas: boolean;
  ordem: OrdemDoExtrato;
  direcao: 'asc' | 'desc';
  agrupar: AgrupamentoDoExtrato;
  pagina: number;
  porPagina: number;
}

export class FiltroInvalido extends Error {}

export const POR_PAGINA_PADRAO = 100;
export const POR_PAGINA_MAX = 500;
export const EXPORTACAO_MAX = 50_000;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Lê e valida os parâmetros da URL. Valor nenhum vira SQL. */
export function lerFiltro(p: URLSearchParams, hoje: string): FiltroDeMovimentos {
  const texto = (k: string, max = 200) => {
    const v = (p.get(k) ?? '').trim();
    if (v.length > max) throw new FiltroInvalido(`Filtro ${k} muito longo.`);
    return v;
  };
  const contas = texto('contas', 4000).split(',').map(s => s.trim()).filter(Boolean);
  if (contas.length > 100) throw new FiltroInvalido('Escolha até 100 contas.');
  const de = texto('de') || `${hoje.slice(0, 7)}-01`;
  const ate = texto('ate') || hoje;
  if (!DATA.test(de) || !DATA.test(ate)) throw new FiltroInvalido('Data inválida.');
  if (de > ate) throw new FiltroInvalido('A data inicial deve ser anterior à final.');
  const tipo = texto('tipo');
  if (tipo && tipo !== 'entrada' && tipo !== 'saida') throw new FiltroInvalido('Tipo inválido.');
  const origem = texto('origem');
  if (origem && !['receber', 'pagar', 'transferencia', 'taxa'].includes(origem)) throw new FiltroInvalido('Origem inválida.');
  const ordem = (texto('ordem') || 'data') as OrdemDoExtrato;
  if (!ORDENS.includes(ordem)) throw new FiltroInvalido('Ordem inválida.');
  const direcao = texto('direcao') === 'desc' ? 'desc' : 'asc';
  const agrupar = (texto('agrupar') || 'nenhum') as AgrupamentoDoExtrato;
  if (!AGRUPAMENTOS.includes(agrupar)) throw new FiltroInvalido('Agrupamento inválido.');
  const inteiro = (k: string, padrao: number, max: number) => {
    const v = p.get(k);
    if (!v) return padrao;
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > max) throw new FiltroInvalido(`Parâmetro ${k} inválido.`);
    return Number(v);
  };
  return {
    contas, de, ate,
    tipo: tipo as FiltroDeMovimentos['tipo'],
    origem: origem as FiltroDeMovimentos['origem'],
    forma: texto('forma'),
    pessoa: texto('pessoa'),
    busca: texto('busca'),
    taxas: p.get('taxas') !== '0',
    ordem, direcao, agrupar,
    pagina: inteiro('pagina', 1, 1_000_000),
    porPagina: inteiro('por_pagina', POR_PAGINA_PADRAO, POR_PAGINA_MAX),
  };
}

// ─── SQL ────────────────────────────────────────────────────────────────────

const STATUS_RECEBER = `(r.data->>'status') IN ('RECEBIDO','PARCIAL')`;
const STATUS_PAGAR = `(p.data->>'status') IN ('PAGO','PARCIAL')`;
const dataCivil = (expr: string) => `LEFT(COALESCE(${expr}, ''), 10)`;
const texto = (alias: string, campo: string) => `COALESCE(${alias}.data->>'${campo}', '')`;

/**
 * Todos os movimentos das contas escolhidas, com o saldo linha a linha.
 * $1 tenant, $2 contas (text[] ou NULL = todas), $3 taxas (boolean).
 * A janela de saldo corre sobre o histórico inteiro, ANTES de qualquer filtro
 * de período ou de busca: o saldo de cada linha é o da conta naquele ponto.
 */
export function sqlDosMovimentos(): string {
  return `
WITH cb AS (
  SELECT c.id, COALESCE(c.data->>'nome', '') AS nome,
         ROUND(${numerico("c.data->>'saldo_inicial'")} * 100)::bigint AS inicial_c,
         ROUND(${numerico("c.data->>'saldo_atual'")} * 100)::bigint AS atual_c
    FROM contas_bancarias c
   WHERE c.tenant_id = $1
), cg AS (
  SELECT id FROM cb WHERE nome = '${CAIXA_GERAL}' ORDER BY id LIMIT 1
), sel AS (
  SELECT * FROM cb WHERE $2::text[] IS NULL OR id = ANY($2::text[])
), brutos AS (
  SELECT 'cr:' || r.id AS chave, 'receber'::text AS origem, 'contas_receber'::text AS tabela, r.id AS registro_id,
         COALESCE(NULLIF(r.data->>'conta_bancaria_id', ''), (SELECT id FROM cg)) AS conta_id,
         ${dataCivil(`COALESCE(NULLIF(r.data->>'data_recebimento', ''), NULLIF(r.data->>'data_vencimento', ''))`)} AS data,
         ROUND(${realizado('receber', 'r')} * 100)::bigint AS centavos,
         ${texto('r', 'descricao')} AS descricao,
         COALESCE(NULLIF(r.data->>'cliente_id', ''), r.cliente_id, '') AS pessoa_id,
         ${texto('r', 'cliente_nome')} AS pessoa_nome,
         'cliente'::text AS pessoa_tipo,
         COALESCE(NULLIF(r.data->>'forma_recebimento', ''), NULLIF(r.data->>'plataforma_forma', ''), '') AS forma,
         COALESCE(NULLIF(r.data->>'venda_id', ''), NULLIF(r.data->>'origem_venda_id', ''), '') AS venda_id,
         COALESCE(NULLIF(r.data->>'documento', ''), NULLIF(r.data->>'boleto_codigo', ''), NULLIF(r.data->>'plataforma_transacao', ''), '') AS documento,
         ${texto('r', 'parcela_numero')} AS parcela, ${texto('r', 'total_parcelas')} AS parcelas,
         COALESCE(NULLIF(r.data->>'plataforma_cartao_final', ''), NULLIF(r.data->>'numero_cheque', ''), '') AS cartao_cheque,
         'BRL'::text AS moeda, NULL::numeric AS valor_origem, NULL::numeric AS cambio,
         ${texto('r', 'plataforma_origem')} AS plataforma,
         ${texto('r', 'observacoes')} AS informacoes,
         0 AS ordem
    FROM contas_receber r
   WHERE r.tenant_id = $1 AND ${STATUS_RECEBER}
  UNION ALL
  SELECT 'crt:' || r.id, 'taxa', 'contas_receber', r.id,
         COALESCE(NULLIF(r.data->>'conta_bancaria_id', ''), (SELECT id FROM cg)),
         ${dataCivil(`COALESCE(NULLIF(r.data->>'data_recebimento', ''), NULLIF(r.data->>'data_vencimento', ''))`)},
         -ROUND(${taxaRetida('r')} * 100)::bigint,
         'Taxa retida' || CASE WHEN COALESCE(r.data->>'taxa_plataforma', '') <> '' THEN ' (' || (r.data->>'taxa_plataforma') || ')' ELSE '' END
           || CASE WHEN ${texto('r', 'descricao')} <> '' THEN ': ' || (r.data->>'descricao') ELSE '' END,
         COALESCE(NULLIF(r.data->>'cliente_id', ''), r.cliente_id, ''), ${texto('r', 'cliente_nome')}, 'cliente',
         COALESCE(NULLIF(r.data->>'forma_recebimento', ''), ''),
         COALESCE(NULLIF(r.data->>'venda_id', ''), NULLIF(r.data->>'origem_venda_id', ''), ''),
         '', ${texto('r', 'parcela_numero')}, ${texto('r', 'total_parcelas')}, '',
         'BRL', NULL, NULL, ${texto('r', 'taxa_plataforma')}, '', 1
    FROM contas_receber r
   WHERE r.tenant_id = $1 AND $3::boolean AND ${STATUS_RECEBER}
  UNION ALL
  SELECT 'cp:' || p.id, 'pagar', 'contas_pagar', p.id,
         COALESCE(NULLIF(p.data->>'conta_bancaria_id', ''), (SELECT id FROM cg)),
         ${dataCivil(`COALESCE(NULLIF(p.data->>'data_pagamento', ''), NULLIF(p.data->>'data_vencimento', ''))`)},
         -ROUND(${realizado('pagar', 'p')} * 100)::bigint,
         ${texto('p', 'descricao')},
         COALESCE(NULLIF(p.data->>'fornecedor_id', ''), p.fornecedor_id, ''),
         ${texto('p', 'fornecedor_nome')}, 'fornecedor',
         COALESCE(NULLIF(p.data->>'forma_pagamento', ''), ''),
         COALESCE(NULLIF(p.data->>'venda_id', ''), NULLIF(p.data->>'origem_venda_id', ''), ''),
         COALESCE(NULLIF(p.data->>'documento', ''), NULLIF(p.data->>'numero_documento', ''), ''),
         ${texto('p', 'parcela_numero')}, ${texto('p', 'total_parcelas')},
         COALESCE(NULLIF(p.data->>'numero_cheque', ''), NULLIF(p.data->>'cartao_final', ''), ''),
         COALESCE(NULLIF(p.data->>'moeda', ''), 'BRL'),
         CASE WHEN COALESCE(p.data->>'moeda', 'BRL') NOT IN ('', 'BRL') THEN ${numerico("p.data->>'valor_final'")} END,
         CASE WHEN COALESCE(p.data->>'moeda', 'BRL') NOT IN ('', 'BRL') THEN ${numerico("p.data->>'cambio'")} END,
         '', ${texto('p', 'observacoes')}, 1
    FROM contas_pagar p
   WHERE p.tenant_id = $1 AND ${STATUS_PAGAR}
  UNION ALL
  SELECT 'tr:' || t.id || ':s', 'transferencia', 'transferencias', t.id,
         COALESCE(t.data->>'conta_origem_id', ''),
         ${dataCivil(`COALESCE(NULLIF(t.data->>'data_efetivacao', ''), NULLIF(t.data->>'data', ''))`)},
         -ROUND(${numerico("t.data->>'valor'")} * 100)::bigint,
         'Transferência para ' || COALESCE(NULLIF(t.data->>'conta_destino_nome', ''), 'outra conta')
           || CASE WHEN ${texto('t', 'descricao')} <> '' THEN ': ' || (t.data->>'descricao') ELSE '' END,
         '', '', '', 'Transferência', '', '', '', '', '', 'BRL', NULL, NULL, '', '', 1
    FROM transferencias t
   WHERE t.tenant_id = $1 AND (t.data->>'status') = 'EFETIVADA' AND ${numerico("t.data->>'valor'")} > 0
  UNION ALL
  SELECT 'tr:' || t.id || ':e', 'transferencia', 'transferencias', t.id,
         COALESCE(t.data->>'conta_destino_id', ''),
         ${dataCivil(`COALESCE(NULLIF(t.data->>'data_efetivacao', ''), NULLIF(t.data->>'data', ''))`)},
         ROUND(${numerico("t.data->>'valor'")} * 100)::bigint,
         'Transferência de ' || COALESCE(NULLIF(t.data->>'conta_origem_nome', ''), 'outra conta')
           || CASE WHEN ${texto('t', 'descricao')} <> '' THEN ': ' || (t.data->>'descricao') ELSE '' END,
         '', '', '', 'Transferência', '', '', '', '', '', 'BRL', NULL, NULL, '', '', 0
    FROM transferencias t
   WHERE t.tenant_id = $1 AND (t.data->>'status') = 'EFETIVADA' AND ${numerico("t.data->>'valor'")} > 0
), mov AS (
  SELECT b.*, s.nome AS conta_nome, s.inicial_c
    FROM brutos b JOIN sel s ON s.id = b.conta_id
   WHERE b.centavos <> 0
), acum AS (
  SELECT m.*,
         m.inicial_c + SUM(m.centavos) OVER (PARTITION BY m.conta_id ORDER BY m.data, m.ordem, m.chave ROWS UNBOUNDED PRECEDING) AS saldo_conta_c,
         (SELECT COALESCE(SUM(inicial_c), 0) FROM sel)
           + SUM(m.centavos) OVER (ORDER BY m.data, m.ordem, m.chave ROWS UNBOUNDED PRECEDING) AS saldo_total_c
    FROM mov m
)`;
}

const COLUNA_DA_ORDEM: Record<OrdemDoExtrato, string> = {
  data: 'a.data',
  valor: 'a.centavos',
  pessoa: 'LOWER(a.pessoa_nome)',
  descricao: 'LOWER(a.descricao)',
  conta: 'LOWER(a.conta_nome)',
  forma: 'LOWER(a.forma)',
  numero: 'a.registro_id',
};

/** A chave do grupo, a mesma no SQL e na tela. */
export const CHAVE_DO_GRUPO: Record<Exclude<AgrupamentoDoExtrato, 'nenhum'>, string> = {
  dia: 'a.data',
  conta: 'a.conta_nome',
  pessoa: 'a.pessoa_nome',
  forma: 'a.forma',
  origem: 'a.origem',
};

/** WHERE dos filtros que valem DEPOIS do saldo (período, tipo, busca...). */
export function filtrosPosteriores(f: FiltroDeMovimentos, valores: unknown[]): string {
  const clausulas: string[] = [];
  const add = (expr: string, v: unknown) => { valores.push(v); clausulas.push(expr.replace('?', `$${valores.length}`)); };
  add('a.data >= ?', f.de);
  add('a.data <= ?', f.ate);
  if (f.tipo === 'entrada') clausulas.push('a.centavos > 0');
  if (f.tipo === 'saida') clausulas.push('a.centavos < 0');
  if (f.origem) add('a.origem = ?', f.origem);
  if (f.forma) add('a.forma = ?', f.forma);
  const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;
  if (f.pessoa) add('a.pessoa_nome ILIKE ?', like(f.pessoa));
  if (f.busca) {
    add(`concat_ws(' ', a.descricao, a.pessoa_nome, a.documento, a.cpf_cnpj, a.informacoes, a.registro_id, a.venda_numero, a.forma, a.conta_nome, a.cartao_cheque, a.plataforma) ILIKE ?`, like(f.busca));
  }
  return clausulas.join(' AND ');
}

function ordemSql(f: FiltroDeMovimentos): string {
  const dir = f.direcao === 'desc' ? 'DESC' : 'ASC';
  const partes: string[] = [];
  if (f.agrupar !== 'nenhum') partes.push(`${CHAVE_DO_GRUPO[f.agrupar]} ${f.agrupar === 'dia' ? dir : 'ASC'}`);
  partes.push(`${COLUNA_DA_ORDEM[f.ordem]} ${dir}`);
  // Desempate cronológico estável: a mesma ordem da janela do saldo.
  partes.push(`a.data ${dir}`, `a.ordem ${dir}`, `a.chave ${dir}`);
  return partes.join(', ');
}

/** Pessoa, documento e venda, ligados depois do saldo (só nas linhas da página). */
const ENRIQUECER = `
  SELECT m.*,
         COALESCE(cl.doc, fo.doc, '') AS cpf_cnpj,
         COALESCE(v.numero, '') AS venda_numero
    FROM acum m
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(c.cpf_cnpj, ''), NULLIF(c.data->>'cpf_cnpj', ''), NULLIF(c.data->>'cpf', ''), NULLIF(c.data->>'cnpj', '')) AS doc
        FROM clientes c WHERE m.pessoa_tipo = 'cliente' AND m.pessoa_id <> '' AND c.tenant_id = $1 AND c.id = m.pessoa_id LIMIT 1
    ) cl ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(f.cnpj, ''), NULLIF(f.data->>'cnpj', ''), NULLIF(f.data->>'cpf', '')) AS doc
        FROM fornecedores_crm f WHERE m.pessoa_tipo = 'fornecedor' AND m.pessoa_id <> '' AND f.tenant_id = $1 AND f.id = m.pessoa_id LIMIT 1
    ) fo ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(vc.data->>'numero', '') AS numero
        FROM vendas_crm vc WHERE m.venda_id <> '' AND vc.tenant_id = $1 AND vc.id = m.venda_id LIMIT 1
    ) v ON TRUE`;

// ─── Leitura ────────────────────────────────────────────────────────────────

export interface ResumoDaConta {
  id: string;
  nome: string;
  saldo_inicial: number;
  saldo_anterior: number;
  saldo_final: number;
  /** saldo_atual gravado na conta. */
  saldo_gravado: number;
  /** saldo_inicial + movimentos sem as linhas de taxa (regra do "Recalcular saldos"). */
  saldo_reconstruido: number;
  /** Taxas retidas informadas nas baixas (o banco já as descontou). */
  taxas: number;
  /** gravado − reconstruído. Diferente de zero: ver o topo deste arquivo. */
  diferenca: number;
}

export interface GrupoDoExtrato {
  chave: string;
  entradas: number;
  saidas: number;
  quantidade: number;
}

export interface ResultadoDoExtrato {
  linhas: MovimentoCaixa[];
  total: number;
  pagina: number;
  por_pagina: number;
  total_paginas: number;
  de: string;
  ate: string;
  saldo_anterior: number;
  saldo_final: number;
  /** Do recorte inteiro filtrado, não só da página. */
  totais: { entradas: number; saidas: number; liquido: number; quantidade: number };
  grupos: GrupoDoExtrato[];
  contas: ResumoDaConta[];
  formas: string[];
}

function linhaDoBanco(r: Record<string, unknown>): MovimentoCaixa {
  const s = (k: string) => String(r[k] ?? '');
  const parcela = Number(r.parcela) || 0;
  const parcelas = Number(r.parcelas) || 0;
  const centavos = Number(r.centavos ?? 0);
  const valorOrigem = r.valor_origem === null || r.valor_origem === undefined ? null : round2(Number(r.valor_origem));
  const cambio = r.cambio === null || r.cambio === undefined ? null : Number(r.cambio);
  return {
    chave: s('chave'),
    origem: s('origem') as OrigemDoMovimento,
    tipo: centavos >= 0 ? 'entrada' : 'saida',
    registro_tabela: s('tabela') as MovimentoCaixa['registro_tabela'],
    registro_id: s('registro_id'),
    conta_id: s('conta_id'),
    conta_nome: s('conta_nome'),
    data: s('data'),
    valor: deCentavos(centavos),
    numero: parcelas > 1 ? `${parcela}/${parcelas}` : '',
    descricao: s('descricao'),
    documento: s('documento'),
    pessoa_id: s('pessoa_id'),
    pessoa_nome: s('pessoa_nome'),
    cpf_cnpj: s('cpf_cnpj'),
    forma: s('forma'),
    venda_id: s('venda_id'),
    venda_numero: s('venda_numero'),
    cartao_cheque: s('cartao_cheque'),
    moeda: s('moeda') || 'BRL',
    valor_origem: valorOrigem,
    cambio: cambio !== null && Number.isFinite(cambio) && cambio > 0 ? cambio : null,
    plataforma: s('plataforma'),
    informacoes: s('informacoes'),
    saldo_conta: deCentavos(r.saldo_conta_c as number),
    saldo_total: deCentavos(r.saldo_total_c as number),
  };
}

/**
 * O extrato filtrado e paginado. Tudo numa leitura só (o chamador pode
 * envolver em REPEATABLE READ para total e página verem o mesmo retrato).
 */
export async function lerMovimentos(exec: ExecutorSQL, tenantId: string, f: FiltroDeMovimentos): Promise<ResultadoDoExtrato> {
  const base = sqlDosMovimentos();
  const contas = f.contas.length ? f.contas : null;
  const valores: unknown[] = [tenantId, contas, f.taxas];
  const where = filtrosPosteriores(f, valores);
  const enriquecido = `${base}, enr AS (${ENRIQUECER}) `;

  const { rows: tot } = await exec.query(
    `${enriquecido}
     SELECT COUNT(*)::int AS n,
            COALESCE(SUM(CASE WHEN a.centavos > 0 THEN a.centavos END), 0)::bigint AS ent,
            COALESCE(SUM(CASE WHEN a.centavos < 0 THEN -a.centavos END), 0)::bigint AS sai
       FROM enr a WHERE ${where}`,
    valores,
  );
  const total = Number(tot[0]?.n ?? 0);
  const totalPaginas = Math.max(1, Math.ceil(total / f.porPagina));
  const pagina = Math.min(f.pagina, totalPaginas);

  const { rows } = await exec.query(
    `${enriquecido}
     SELECT a.* FROM enr a WHERE ${where}
      ORDER BY ${ordemSql(f)}
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, f.porPagina, (pagina - 1) * f.porPagina],
  );

  let grupos: GrupoDoExtrato[] = [];
  if (f.agrupar !== 'nenhum') {
    const { rows: g } = await exec.query(
      `${enriquecido}
       SELECT ${CHAVE_DO_GRUPO[f.agrupar]} AS chave, COUNT(*)::int AS n,
              COALESCE(SUM(CASE WHEN a.centavos > 0 THEN a.centavos END), 0)::bigint AS ent,
              COALESCE(SUM(CASE WHEN a.centavos < 0 THEN -a.centavos END), 0)::bigint AS sai
         FROM enr a WHERE ${where} GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      valores,
    );
    grupos = g.map(r => ({ chave: String(r.chave ?? ''), quantidade: Number(r.n), entradas: deCentavos(r.ent as number), saidas: deCentavos(r.sai as number) }));
  }

  // Por conta: saldo anterior, final, gravado e reconstruído (sem filtros de busca).
  const { rows: porConta } = await exec.query(
    `${base}
     SELECT s.id, s.nome, s.inicial_c, s.atual_c,
            s.inicial_c + COALESCE(SUM(m.centavos) FILTER (WHERE m.data < $4), 0) AS anterior_c,
            s.inicial_c + COALESCE(SUM(m.centavos) FILTER (WHERE m.data <= $5), 0) AS final_c,
            s.inicial_c + COALESCE(SUM(m.centavos) FILTER (WHERE m.origem <> 'taxa'), 0) AS reconstruido_c,
            COALESCE(-SUM(m.centavos) FILTER (WHERE m.origem = 'taxa'), 0) AS taxas_c
       FROM sel s LEFT JOIN mov m ON m.conta_id = s.id
      GROUP BY s.id, s.nome, s.inicial_c, s.atual_c
      ORDER BY LOWER(s.nome), s.id`,
    [tenantId, contas, f.taxas, f.de, f.ate],
  );
  const resumo: ResumoDaConta[] = porConta.map(r => {
    const gravado = Number(r.atual_c ?? 0);
    const reconstruido = Number(r.reconstruido_c ?? 0);
    return {
      id: String(r.id), nome: String(r.nome ?? ''),
      saldo_inicial: deCentavos(r.inicial_c as number),
      saldo_anterior: deCentavos(r.anterior_c as number),
      saldo_final: deCentavos(r.final_c as number),
      saldo_gravado: deCentavos(gravado),
      saldo_reconstruido: deCentavos(reconstruido),
      taxas: deCentavos(r.taxas_c as number),
      diferenca: deCentavos(gravado - reconstruido),
    };
  });

  const { rows: fs } = await exec.query(
    `${base} SELECT DISTINCT forma FROM mov WHERE forma <> '' ORDER BY forma LIMIT 200`,
    [tenantId, contas, f.taxas],
  );

  const ent = Number(tot[0]?.ent ?? 0);
  const sai = Number(tot[0]?.sai ?? 0);
  return {
    linhas: rows.map(linhaDoBanco),
    total, pagina, por_pagina: f.porPagina, total_paginas: totalPaginas,
    de: f.de, ate: f.ate,
    saldo_anterior: round2(resumo.reduce((s, c) => s + c.saldo_anterior, 0)),
    saldo_final: round2(resumo.reduce((s, c) => s + c.saldo_final, 0)),
    totais: { entradas: deCentavos(ent), saidas: deCentavos(sai), liquido: deCentavos(ent - sai), quantidade: total },
    grupos,
    contas: resumo,
    formas: fs.map(r => String(r.forma)),
  };
}

/** Todas as linhas do recorte filtrado, para exportar (até EXPORTACAO_MAX + 1). */
export async function lerParaExportar(exec: ExecutorSQL, tenantId: string, f: FiltroDeMovimentos): Promise<MovimentoCaixa[]> {
  const valores: unknown[] = [tenantId, f.contas.length ? f.contas : null, f.taxas];
  const where = filtrosPosteriores(f, valores);
  const { rows } = await exec.query(
    `${sqlDosMovimentos()}, enr AS (${ENRIQUECER})
     SELECT a.* FROM enr a WHERE ${where} ORDER BY ${ordemSql(f)} LIMIT $${valores.length + 1}`,
    [...valores, EXPORTACAO_MAX + 1],
  );
  return rows.map(linhaDoBanco);
}

// ─── Exportação ─────────────────────────────────────────────────────────────

export type LeiauteDeExportacao = 'extrato' | 'movimentacoes';

const ROTULO_ORIGEM: Record<OrigemDoMovimento, string> = {
  receber: 'Conta a receber',
  pagar: 'Conta a pagar',
  transferencia: 'Transferência',
  taxa: 'Taxa retida',
};

export function rotuloDaOrigem(o: OrigemDoMovimento): string {
  return ROTULO_ORIGEM[o] ?? o;
}

/** Número em formato brasileiro, sem milhar: o Excel lê como número. */
function numeroBR(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '';
  return v.toFixed(2).replace('.', ',');
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
}

/**
 * CSV que o Excel abre direto (BOM, ';', vírgula decimal). Todo texto passa
 * por auditCsvCell (aspas, quebras e fórmulas neutralizadas); número sai como
 * número, para a planilha somar.
 */
export function csvDosMovimentos(linhas: readonly MovimentoCaixa[], leiaute: LeiauteDeExportacao): string {
  const cel = (v: unknown) => auditCsvCell(v);
  const numCel = (v: number | null) => (v === null ? '""' : `"${numeroBR(v)}"`);
  if (leiaute === 'extrato') {
    const cab = ['Data', 'Conta', 'Número', 'Descrição', 'Documento', 'Pessoa', 'CPF/CNPJ', 'Informações', 'Forma', 'Origem', 'Valor', 'Saldo da conta', 'Saldo'];
    const corpo = linhas.map(l => [cel(dataBR(l.data)), cel(l.conta_nome), cel(l.numero), cel(l.descricao), cel(l.documento), cel(l.pessoa_nome),
      cel(l.cpf_cnpj), cel(l.informacoes), cel(l.forma), cel(rotuloDaOrigem(l.origem)), numCel(l.valor), numCel(l.saldo_conta), numCel(l.saldo_total)].join(';'));
    return '﻿' + [cab.map(cel).join(';'), ...corpo].join('\r\n');
  }
  const cab = ['Data', 'Número', 'Venda', 'Conta', 'Forma de pagamento', 'Pessoa', 'Documento', 'Cheque/Cartão', 'Moeda', 'Valor origem', 'Câmbio', 'Movimento', 'Valor'];
  const corpo = linhas.map(l => [cel(dataBR(l.data)), cel(l.numero), cel(l.venda_numero || l.venda_id), cel(l.conta_nome), cel(l.forma), cel(l.pessoa_nome),
    cel(l.documento), cel(l.cartao_cheque), cel(l.moeda), numCel(l.valor_origem), l.cambio === null ? '""' : `"${String(l.cambio).replace('.', ',')}"`,
    cel(`${l.tipo === 'entrada' ? 'Entrada' : 'Saída'} · ${rotuloDaOrigem(l.origem)}`), numCel(l.valor)].join(';'));
  return '﻿' + [cab.map(cel).join(';'), ...corpo].join('\r\n');
}

// ─── Espelho em TypeScript (para o teste comparar com o SQL) ───────────────

export interface EntradaDoEspelho {
  contas: Array<{ id: string; data: Record<string, unknown> }>;
  receber: Array<Record<string, unknown>>;
  pagar: Array<Record<string, unknown>>;
  transferencias: Array<Record<string, unknown>>;
  taxas: boolean;
}

/**
 * A mesma regra do SQL, linha a linha, em TypeScript puro. Existe só para o
 * teste provar que as duas definições (e reconstruirSaldos) não divergem.
 */
export function movimentosEspelho(e: EntradaDoEspelho): Array<{ chave: string; conta_id: string; data: string; centavos: number; origem: OrigemDoMovimento }> {
  const ids = new Set(e.contas.map(c => c.id));
  const caixaGeral = [...e.contas].sort((a, b) => a.id.localeCompare(b.id)).find(c => String(c.data.nome ?? '') === CAIXA_GERAL)?.id ?? '';
  const dia = (d: Record<string, unknown>, campo: string) => String((d[campo] as string) || (d.data_vencimento as string) || '').slice(0, 10);
  const saida: Array<{ chave: string; conta_id: string; data: string; centavos: number; origem: OrigemDoMovimento }> = [];
  const push = (chave: string, conta: string, data: string, centavos: number, origem: OrigemDoMovimento) => {
    if (centavos !== 0 && ids.has(conta)) saida.push({ chave, conta_id: conta, data, centavos, origem });
  };
  for (const d of e.receber) {
    const st = String(d.status ?? '');
    if (st !== 'RECEBIDO' && st !== 'PARCIAL') continue;
    const conta = (d.conta_bancaria_id as string) || caixaGeral;
    push(`cr:${d.id}`, conta, dia(d, 'data_recebimento'), paraCentavos(valorMovimentado(d as never, 'valor_recebido')), 'receber');
    if (e.taxas) push(`crt:${d.id}`, conta, dia(d, 'data_recebimento'), -paraCentavos(taxaRealizada(d as never)), 'taxa');
  }
  for (const d of e.pagar) {
    const st = String(d.status ?? '');
    if (st !== 'PAGO' && st !== 'PARCIAL') continue;
    push(`cp:${d.id}`, (d.conta_bancaria_id as string) || caixaGeral, dia(d, 'data_pagamento'), -paraCentavos(valorMovimentado(d as never, 'valor_pago')), 'pagar');
  }
  for (const d of e.transferencias) {
    if (String(d.status ?? '') !== 'EFETIVADA') continue;
    const v = paraCentavos(num(d.valor));
    if (v <= 0) continue;
    const data = String((d.data_efetivacao as string) || (d.data as string) || '').slice(0, 10);
    push(`tr:${d.id}:s`, String(d.conta_origem_id ?? ''), data, -v, 'transferencia');
    push(`tr:${d.id}:e`, String(d.conta_destino_id ?? ''), data, v, 'transferencia');
  }
  return saida;
}
