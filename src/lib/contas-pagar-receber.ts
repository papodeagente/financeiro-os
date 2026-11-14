/**
 * Contas a Pagar/Receber numa lista só (05/11/2026): a leitura no servidor da
 * visão unificada. As telas de Contas a pagar e de Contas a receber continuam
 * como estão; esta lista é adicional e lê as MESMAS linhas, com as MESMAS
 * regras de valor, saldo e situação delas:
 *
 *   valor     a pagar: valor_final (em reais) ou valor_brl quando falta;
 *             a receber: valor_final. É o "Total das contas listadas".
 *   baixado   o que já saiu/entrou: PARCIAL pelo acumulado; PAGO/RECEBIDO pelo
 *             valor baixado (ou o valor da conta, se o campo ficou vazio);
 *             cancelada, zero. Mesma regra de `realizado` (dashboard-sql.ts).
 *   saldo     em aberto: valor − o que já foi baixado. Liquidada ou
 *             cancelada, zero.
 *   situação  Cancelado (status CANCELADO), Pago/Recebido (PAGO/RECEBIDO),
 *             senão Em aberto; Em atraso é a parte em aberto com vencimento
 *             anterior a hoje. "Em atraso" é derivado da data, nunca gravado.
 *
 * Paginação, ordem, filtros e totais no servidor, numa leitura só (a rota
 * envolve em REPEATABLE READ: total, página e totais veem o mesmo retrato).
 * Contas liberadas: a linha já baixada numa conta bancária que a pessoa não
 * enxerga some, a mesma regra do CRUD (filtro-de-conta.ts, soBaixados).
 * Dinheiro somado em centavos inteiros; reais só na borda.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { numerico } from './dashboard-sql';
import { STATUS_DE_BAIXA } from './guarda-baixa';
import { deCentavos, num, round2 } from './money';
import { auditCsvCell } from './audit-query';
import { tituloGeradoPeloSistema, tituloSemBaixa } from './recorrencia';
import { rotuloDoPeriodo, type ColunaExportada, type DocumentoExportado, type FiltroAplicado } from './exportacao/documento';

export type TabelaDaConta = 'contas_pagar' | 'contas_receber';
export type TipoDaConta = 'pagar' | 'receber';
export type Situacao = 'em_aberto' | 'em_atraso' | 'liquidado' | 'cancelado' | 'excluido';

/**
 * "Excluído" (06/11/2026, E7) lê só os títulos guardados em contas_excluidas;
 * "Todas" nunca mostra excluídos (eles saíram das contas).
 */
export const SITUACOES_DO_FILTRO = ['todas', 'em_aberto', 'em_atraso', 'liquidado', 'cancelado', 'excluido'] as const;
export type SituacaoDoFiltro = (typeof SITUACOES_DO_FILTRO)[number];
export const DATAS_DO_FILTRO = ['emissao', 'vencimento', 'liquidacao'] as const;
export type DataDoFiltro = (typeof DATAS_DO_FILTRO)[number];
export const CAMPOS_DA_BUSCA = ['tudo', 'numero', 'descricao', 'pessoa', 'documento', 'categoria', 'centro', 'venda'] as const;
export type CampoDaBusca = (typeof CAMPOS_DA_BUSCA)[number];
export const ORDENS = [
  'vencimento', 'emissao', 'liquidacao', 'valor', 'saldo', 'pessoa', 'descricao', 'documento',
  'categoria', 'centro', 'conta', 'situacao', 'tipo', 'numero', 'venda', 'vendedor', 'cadastrado',
] as const;
export type OrdemDaLista = (typeof ORDENS)[number];
/**
 * Situação da cobrança (boleto/Pix) da conta a receber (E3, 05/11/2026).
 * "sem_boleto" = a receber em aberto sem cobrança viva nem paga ("Boleto não
 * emitido"). Filtrar por cobrança deixa só contas a receber.
 */
export const COBRANCAS_DO_FILTRO = ['todas', 'sem_boleto', 'emitida', 'vencida', 'paga', 'falhou'] as const;
export type CobrancaDoFiltro = (typeof COBRANCAS_DO_FILTRO)[number];

export interface LinhaDeConta {
  /** 'cp:<id>' ou 'cr:<id>': única entre as duas tabelas. */
  chave: string;
  tabela: TabelaDaConta;
  tipo: TipoDaConta;
  id: string;
  /** Status gravado (PENDENTE, PARCIAL, PAGO...). A tela mostra `situacao`. */
  status: string;
  situacao: Situacao;
  /** Já tem parte paga ou recebida. */
  parcial: boolean;
  dias_atraso: number;
  descricao: string;
  pessoa: string;
  documento: string;
  /** "2/6" quando é parcela; vazio quando não. */
  parcela: string;
  categoria_id: string;
  categoria: string;
  centro_custo_id: string;
  centro_custo: string;
  conta_bancaria_id: string;
  conta_bancaria: string;
  emissao: string;
  vencimento: string;
  liquidacao: string;
  valor: number;
  baixado: number;
  saldo: number;
  forma: string;
  venda_id: string;
  origem: string;
  moeda: string;
  serie_id: string;
  /** Dividida entre centros (ou categorias) por rateio. */
  rateio: boolean;
  /** Nasceu de venda, grupo, comissão, plataforma ou fatura: refeita pela origem. */
  gerada_pelo_sistema: boolean;
  /** Em aberto e sem nenhuma baixa: pode mudar o vencimento. */
  sem_baixa: boolean;
  /**
   * Status da cobrança que vale para a conta (a viva; senão a mais recente):
   * emitindo, aberta, vencida, paga, cancelada, estornada, falhou. Vazio =
   * nenhuma cobrança (ou conta a pagar).
   */
  cobranca_status: string;
  /** Nº do título: sequencial por agência, único entre pagar e receber. Null = ainda sem número. */
  numero: number | null;
  /** Nº da venda de origem (vazio quando não veio de venda). */
  venda_numero: string;
  /** Nº da fatura (ao cliente ou do fornecedor) em que a conta está. */
  fatura_numero: string;
  /** Vendedor da venda de origem. */
  vendedor: string;
  /** Quando a conta foi cadastrada (AAAA-MM-DDTHH:MM, Brasília). */
  cadastrado_em: string;
  /** Quem cadastrou (vazio = o sistema). */
  cadastrado_por: string;
  /** Só na situação Excluído: quando e quem excluiu (AAAA-MM-DDTHH:MM, Brasília). */
  excluido_em: string;
  excluido_por: string;
  /** Só na situação Excluído: o que tinha sido pago/recebido e voltou ao caixa na exclusão. */
  estornado_na_exclusao: number;
  /** Campos personalizados da agência (id → valor). */
  campos_personalizados: Record<string, unknown>;
  /** Empresa do título (E7). A coluna só aparece com 2+ empresas. */
  empresa_id: string;
}

export interface FiltroDaLista {
  de: string;
  ate: string;
  data: DataDoFiltro;
  situacao: SituacaoDoFiltro;
  tipo: TipoDaConta | 'ambos';
  busca: string;
  em: CampoDaBusca;
  categoria: string;
  centro: string;
  conta: string;
  cobranca: CobrancaDoFiltro;
  ordem: OrdemDaLista;
  direcao: 'asc' | 'desc';
  pagina: number;
  porPagina: number;
  /** AAAA-MM-DD em Brasília: o "hoje" do atraso. */
  hoje: string;
  /**
   * Empresas no recorte (E7): as marcadas no seletor e liberadas. Ausente ou
   * null = todas (agência de uma empresa só, ou quem vê todas).
   */
  empresas?: readonly string[] | null;
}

export class FiltroInvalido extends Error {}

export const POR_PAGINA_PADRAO = 100;
export const POR_PAGINA_MAX = 500;
export const EXPORTACAO_MAX = 50_000;
/** "Selecionar todas do filtro" traz até isto de chaves. */
export const SELECAO_MAX = 2_000;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function deUmaLista<T extends string>(lista: readonly T[], v: string, padrao: T, rotulo: string): T {
  if (!v) return padrao;
  if (!(lista as readonly string[]).includes(v)) throw new FiltroInvalido(`${rotulo} inválido.`);
  return v as T;
}

/** Lê e valida os parâmetros da URL. Nenhum valor vira SQL. */
export function lerFiltro(p: URLSearchParams, hoje: string): FiltroDaLista {
  const texto = (k: string, max = 200) => {
    const v = (p.get(k) ?? '').trim();
    if (v.length > max) throw new FiltroInvalido(`Filtro ${k} muito longo.`);
    return v;
  };
  const de = texto('de');
  const ate = texto('ate');
  if ((de && !DATA.test(de)) || (ate && !DATA.test(ate))) throw new FiltroInvalido('Data inválida.');
  if (de && ate && de > ate) throw new FiltroInvalido('A data inicial deve ser anterior à final.');
  const tipo = texto('tipo') || 'ambos';
  if (tipo !== 'ambos' && tipo !== 'pagar' && tipo !== 'receber') throw new FiltroInvalido('Tipo inválido.');
  const inteiro = (k: string, padrao: number, max: number) => {
    const v = p.get(k);
    if (!v) return padrao;
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > max) throw new FiltroInvalido(`Parâmetro ${k} inválido.`);
    return Number(v);
  };
  if (!DATA.test(hoje)) throw new FiltroInvalido('Data de hoje inválida.');
  return {
    de, ate,
    data: deUmaLista(DATAS_DO_FILTRO, texto('data'), 'vencimento', 'Campo de data'),
    situacao: deUmaLista(SITUACOES_DO_FILTRO, texto('situacao'), 'todas', 'Situação'),
    tipo: tipo as FiltroDaLista['tipo'],
    busca: texto('busca'),
    em: deUmaLista(CAMPOS_DA_BUSCA, texto('em'), 'tudo', 'Campo da busca'),
    categoria: texto('categoria', 100),
    centro: texto('centro', 100),
    conta: texto('conta', 100),
    cobranca: deUmaLista(COBRANCAS_DO_FILTRO, texto('cobranca'), 'todas', 'Situação da cobrança'),
    ordem: deUmaLista(ORDENS, texto('ordem'), 'vencimento', 'Ordem'),
    direcao: texto('direcao') === 'desc' ? 'desc' : 'asc',
    pagina: inteiro('pagina', 1, 1_000_000),
    porPagina: inteiro('por_pagina', POR_PAGINA_PADRAO, POR_PAGINA_MAX),
    hoje,
  };
}

// ─── Regras puras (as mesmas das telas atuais) ─────────────────────────────

const ABERTOS_NUNCA = new Set(['PAGO', 'RECEBIDO', 'CANCELADO']);

/** Valor da conta em reais, como as telas atuais. */
export function valorDaConta(tabela: TabelaDaConta, d: Record<string, unknown>): number {
  if (tabela === 'contas_pagar') {
    const final = num(d.valor_final);
    return round2(final || num(d.valor_brl));
  }
  return round2(num(d.valor_final));
}

/** O que já foi pago/recebido (regra de `realizado`). */
export function baixadoDaConta(tabela: TabelaDaConta, d: Record<string, unknown>): number {
  const status = String(d.status ?? '');
  const campo = tabela === 'contas_pagar' ? d.valor_pago : d.valor_recebido;
  if (status === 'CANCELADO') return 0;
  if (status === 'PARCIAL') return round2(num(campo));
  if (status === 'PAGO' || status === 'RECEBIDO') return round2(num(campo) || valorDaConta(tabela, d));
  return 0;
}

/** Saldo em aberto: o que ainda falta pagar ou receber. */
export function saldoDaConta(tabela: TabelaDaConta, d: Record<string, unknown>): number {
  if (ABERTOS_NUNCA.has(String(d.status ?? ''))) return 0;
  const campo = tabela === 'contas_pagar' ? d.valor_pago : d.valor_recebido;
  return round2(valorDaConta(tabela, d) - num(campo));
}

export function situacaoDaConta(d: Record<string, unknown>, hoje: string): Situacao {
  const status = String(d.status ?? '');
  if (status === 'CANCELADO') return 'cancelado';
  if (status === 'PAGO' || status === 'RECEBIDO') return 'liquidado';
  const venc = String(d.data_vencimento ?? '').slice(0, 10);
  return venc && venc < hoje ? 'em_atraso' : 'em_aberto';
}

/** Dias entre o vencimento e hoje (0 quando não está atrasada). */
export function diasDeAtraso(vencimento: string, hoje: string): number {
  if (!DATA.test(vencimento) || !DATA.test(hoje) || vencimento >= hoje) return 0;
  const t = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((t(hoje) - t(vencimento)) / 86_400_000);
}

const ROTULOS: Record<TipoDaConta, Record<Situacao | 'parcial', string>> = {
  pagar: { em_aberto: 'Em aberto', em_atraso: 'Em atraso', liquidado: 'Pago', cancelado: 'Cancelado', excluido: 'Excluído', parcial: 'Pago em parte' },
  receber: { em_aberto: 'Em aberto', em_atraso: 'Em atraso', liquidado: 'Recebido', cancelado: 'Cancelado', excluido: 'Excluído', parcial: 'Recebido em parte' },
};

/** Rótulo da situação na tela e na planilha. */
export function rotuloDaSituacao(l: Pick<LinhaDeConta, 'tipo' | 'situacao' | 'parcial'>): string {
  if (l.situacao === 'em_aberto' && l.parcial) return ROTULOS[l.tipo].parcial;
  return ROTULOS[l.tipo][l.situacao];
}

export const ROTULO_DO_TIPO: Record<TipoDaConta, string> = { pagar: 'A pagar', receber: 'A receber' };

// ─── SQL ────────────────────────────────────────────────────────────────────

const centavos = (expr: string) => `ROUND(${expr} * 100)::bigint`;
const txt = (campo: string) => `COALESCE(d->>'${campo}', '')`;
const dia = (expr: string) => `LEFT(COALESCE(${expr}, ''), 10)`;
const quandoBR = (expr: string) => `COALESCE(to_char((${expr}) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'), '')`;

/**
 * Tabelas que enriquecem a lista (06/11/2026, E7). Cada uma só entra na
 * consulta quando existe neste banco: sem ela, a coluna fica vazia e a lista
 * funciona como antes.
 */
export interface TabelasDaLista {
  /** titulos_numeros: Nº e "cadastrado por". */
  numeros: boolean;
  /** vendas_modelo e vendas_crm: Nº da venda e vendedor. */
  vendasModelo: boolean;
  vendasCrm: boolean;
  usuarios: boolean;
  /** faturas + fatura_itens: Nº da fatura ao cliente. */
  faturas: boolean;
  /** faturas_fornecedor + fatura_fornecedor_itens: Nº da fatura do fornecedor. */
  faturasFornecedor: boolean;
  /** contas_excluidas: a situação Excluído. */
  excluidas: boolean;
}

export const SEM_TABELAS_EXTRAS: TabelasDaLista = {
  numeros: false, vendasModelo: false, vendasCrm: false, usuarios: false, faturas: false, faturasFornecedor: false, excluidas: false,
};

let tabelasConhecidas: TabelasDaLista | null = null;
/** Quais tabelas extras existem (o que já existe não é perguntado de novo). */
export async function tabelasDaLista(exec: ExecutorSQL): Promise<TabelasDaLista> {
  if (tabelasConhecidas && Object.values(tabelasConhecidas).every(Boolean)) return tabelasConhecidas;
  try {
    const { rows } = await exec.query(
      `SELECT to_regclass('titulos_numeros') IS NOT NULL AS numeros,
              to_regclass('vendas_modelo') IS NOT NULL AS vendas_modelo,
              to_regclass('vendas_crm') IS NOT NULL AS vendas_crm,
              to_regclass('usuarios') IS NOT NULL AS usuarios,
              (to_regclass('faturas') IS NOT NULL AND to_regclass('fatura_itens') IS NOT NULL) AS faturas,
              (to_regclass('faturas_fornecedor') IS NOT NULL AND to_regclass('fatura_fornecedor_itens') IS NOT NULL) AS faturas_fornecedor,
              to_regclass('contas_excluidas') IS NOT NULL AS excluidas`,
    );
    const r = rows[0] ?? {};
    tabelasConhecidas = {
      numeros: r.numeros === true, vendasModelo: r.vendas_modelo === true, vendasCrm: r.vendas_crm === true,
      usuarios: r.usuarios === true, faturas: r.faturas === true, faturasFornecedor: r.faturas_fornecedor === true,
      excluidas: r.excluidas === true,
    };
  } catch {
    tabelasConhecidas = { ...SEM_TABELAS_EXTRAS };
  }
  return tabelasConhecidas;
}

/** Uma tabela no formato comum. $1 = agência. `excluidas` lê a guarda dos excluídos. */
function lado(tabela: TabelaDaConta, excluidas: boolean): string {
  const pagar = tabela === 'contas_pagar';
  const campoBaixa = pagar ? 'valor_pago' : 'valor_recebido';
  const quitado = pagar ? 'PAGO' : 'RECEBIDO';
  const valor = pagar
    ? `(CASE WHEN ${numerico("d->>'valor_final'")} <> 0 THEN ${numerico("d->>'valor_final'")} ELSE ${numerico("d->>'valor_brl'")} END)`
    : numerico("d->>'valor_final'");
  const baixa = numerico(`d->>'${campoBaixa}'`);
  const fonte = excluidas
    ? `FROM contas_excluidas t, LATERAL (SELECT t.data AS d,
              COALESCE(NULLIF(t.data->>'status', ''), t.linha->>'status', '') AS st,
              COALESCE(CASE WHEN COALESCE(t.linha->>'created_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                            THEN (t.linha->>'created_at')::timestamptz END, t.excluido_em) AS criado) x
   WHERE t.tenant_id = $1 AND t.tabela = '${tabela}'`
    : `FROM ${tabela} t, LATERAL (SELECT t.data AS d, COALESCE(NULLIF(t.data->>'status', ''), t.status, '') AS st, t.created_at AS criado) x
   WHERE t.tenant_id = $1`;
  const marcasDaExclusao = excluidas
    ? `TRUE AS excluido, ${quandoBR('t.excluido_em')} AS excluido_em, COALESCE(t.excluido_por_nome, '') AS excluido_por,
         ${centavos(`ROUND(${numerico("t.baixa_estornada->>'valor'")}, 2)`)} AS estornado_c`
    : `FALSE AS excluido, ''::text AS excluido_em, ''::text AS excluido_por, 0::bigint AS estornado_c`;
  return `
  SELECT '${pagar ? 'cp' : 'cr'}:' || t.id AS chave, '${tabela}'::text AS tabela, '${pagar ? 'pagar' : 'receber'}'::text AS tipo,
         t.id, d, st AS status,
         ${centavos(`ROUND(${valor}, 2)`)} AS valor_c,
         ${centavos(`ROUND(${baixa}, 2)`)} AS campo_baixa_c,
         ${centavos(`(CASE WHEN st = 'CANCELADO' THEN 0
                    WHEN st = 'PARCIAL' THEN ROUND(${baixa}, 2)
                    WHEN st = '${quitado}' THEN ROUND(COALESCE(NULLIF(${baixa}, 0), ${valor}), 2)
                    ELSE 0 END)`)} AS baixado_c,
         ${dia(`d->>'data_vencimento'`)} AS vencimento,
         ${dia(`COALESCE(NULLIF(d->>'data_emissao', ''), to_char(x.criado AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'))`)} AS emissao,
         ${dia(`d->>'${pagar ? 'data_pagamento' : 'data_recebimento'}'`)} AS liquidacao,
         ${txt(pagar ? 'fornecedor_nome' : 'cliente_nome')} AS pessoa,
         COALESCE(NULLIF(d->>'documento', ''), NULLIF(d->>'numero_documento', ''), NULLIF(d->>'boleto_codigo', ''),
                  NULLIF(d->>'plataforma_transacao', ''), '') AS documento,
         ${txt(pagar ? 'forma_pagamento' : 'forma_recebimento')} AS forma,
         COALESCE(NULLIF(d->>'moeda', ''), 'BRL') AS moeda,
         COALESCE(NULLIF(d->>'origem_venda_id', ''), NULLIF(d->>'venda_id', ''), '') AS venda_ref,
         ${quandoBR('x.criado')} AS cadastrado_em,
         ${marcasDaExclusao}
    ${fonte}`;
}

/** Cobranças vivas primeiro; depois a mais recente. */
const COBRANCA_DA_CONTA = `
    LEFT JOIN LATERAL (
      SELECT c.status FROM cobrancas c
       WHERE c.tenant_id = $1 AND c.titulo_id = b.id
       ORDER BY (c.status IN ('emitindo', 'aberta', 'vencida')) DESC, c.criado_em DESC
       LIMIT 1
    ) cobr ON b.tabela = 'contas_receber'`;

let tabelaDeCobrancaExiste = false;
/**
 * A tabela `cobrancas` (E3, parte A) existe neste banco? Enquanto não existir
 * a lista funciona igual a antes e o filtro "Boleto não emitido" vale para
 * toda conta a receber em aberto. Depois que existe, não pergunta mais.
 */
export async function existeTabelaDeCobranca(exec: ExecutorSQL): Promise<boolean> {
  if (tabelaDeCobrancaExiste) return true;
  try {
    const { rows } = await exec.query(`SELECT to_regclass('cobrancas') IS NOT NULL AS ok`);
    tabelaDeCobrancaExiste = rows[0]?.ok === true;
  } catch {
    tabelaDeCobrancaExiste = false;
  }
  return tabelaDeCobrancaExiste;
}

export interface OpcoesDaLeitura {
  comCobranca?: boolean;
  /** Tabelas extras (Nº, venda, fatura, vendedor, excluídos). Ausente = nenhuma. */
  tabelas?: TabelasDaLista;
}

/** Nº da fatura de cada conta: a fatura que a conta representa, senão a fatura em que ela é item. */
function sqlDasFaturas(t: TabelasDaLista): string | null {
  const partes: string[] = [];
  if (t.faturas) {
    partes.push(`SELECT 'contas_receber'::text AS tabela, f.titulo_id AS conta, f.numero::text AS numero, 0 AS pri, f.criado_em AS quando
        FROM faturas f WHERE f.tenant_id = $1 AND f.titulo_id <> '' AND f.situacao <> 'CANCELADA'`);
    partes.push(`SELECT 'contas_receber'::text, i.conta_id, f.numero::text, 1, f.criado_em
        FROM fatura_itens i JOIN faturas f ON f.tenant_id = i.tenant_id AND f.id = i.fatura_id
       WHERE i.tenant_id = $1 AND f.situacao <> 'CANCELADA'`);
  }
  if (t.faturasFornecedor) {
    partes.push(`SELECT 'contas_pagar'::text, ff.conta_pagar_id, ff.numero, 0, ff.criada_em
        FROM faturas_fornecedor ff WHERE ff.tenant_id = $1 AND COALESCE(ff.conta_pagar_id, '') <> '' AND ff.situacao <> 'DESFEITA'`);
    partes.push(`SELECT 'contas_pagar'::text, it.conta_pagar_id, ff.numero, 1, ff.criada_em
        FROM fatura_fornecedor_itens it JOIN faturas_fornecedor ff ON ff.tenant_id = it.tenant_id AND ff.id = it.fatura_id
       WHERE it.tenant_id = $1 AND it.ativo AND ff.situacao <> 'DESFEITA'`);
  }
  if (!partes.length) return null;
  return `SELECT DISTINCT ON (tabela, conta) tabela, conta, numero
      FROM (${partes.join('\n      UNION ALL ')}) x
     ORDER BY tabela, conta, pri, quando DESC`;
}

/**
 * Todas as contas da agência no formato comum, com categoria, centro e conta
 * bancária pelo nome. $1 = agência, $2 = hoje. Com `comCobranca`, traz o
 * status da cobrança de cada conta a receber (tabela da E3). Com
 * `excluidas`, lê SÓ os títulos excluídos (situação Excluído).
 */
export function sqlDasContas(opcoes: boolean | OpcoesDaLeitura = false, excluidas = false): string {
  const o: OpcoesDaLeitura = typeof opcoes === 'boolean' ? { comCobranca: opcoes } : opcoes;
  const comCobranca = Boolean(o.comCobranca);
  const t = o.tabelas ?? SEM_TABELAS_EXTRAS;
  const soExcluidas = excluidas && t.excluidas;
  const faturas = sqlDasFaturas(t);
  // Sem a tabela dos excluídos, a situação Excluído é uma lista vazia.
  const brutos = excluidas && !soExcluidas
    ? `${lado('contas_pagar', false)} AND FALSE\n  UNION ALL ${lado('contas_receber', false)} AND FALSE`
    : `${lado('contas_pagar', soExcluidas)}\n  UNION ALL ${lado('contas_receber', soExcluidas)}`;
  const idVendedor = [
    t.vendasModelo ? `NULLIF(vm.vendedor->>'id', '')` : null,
    t.vendasCrm ? `NULLIF(vc.vendedor_id, '')` : null,
    t.vendasCrm ? `NULLIF(vc.data->>'vendedor_id', '')` : null,
  ].filter(Boolean).join(', ');
  const vendaNumero = [
    t.vendasModelo ? `NULLIF(vm.numero, '')` : null,
    t.vendasCrm ? `NULLIF(vc.data->>'numero', '')` : null,
  ].filter(Boolean);
  const vendedor = [
    t.vendasModelo ? `NULLIF(vm.vendedor->>'nome', '')` : null,
    t.usuarios && idVendedor ? `NULLIF(COALESCE(NULLIF(us.nome, ''), us.data->>'nome'), '')` : null,
    t.vendasCrm ? `NULLIF(vc.data->>'vendedor_nome', '')` : null,
    `NULLIF(b.d->>'vendedor_nome', '')`,
  ].filter(Boolean);
  return `
WITH cat AS (
  SELECT id, COALESCE(NULLIF(data->>'nome', ''), descricao, '') AS nome, COALESCE(NULLIF(data->>'codigo', ''), codigo, '') AS codigo
    FROM plano_contas WHERE tenant_id = $1
), cen AS (
  SELECT id, COALESCE(NULLIF(nome, ''), data->>'nome', '') AS nome FROM centros_custo WHERE tenant_id = $1
), cb AS (
  SELECT id, COALESCE(NULLIF(data->>'nome', ''), nome, '') AS nome FROM contas_bancarias WHERE tenant_id = $1
),${faturas ? ` fat AS (\n  ${faturas}\n),` : ''} brutos AS (${brutos}
), base AS (
  SELECT b.*,
         CASE WHEN b.excluido THEN 'excluido'
              WHEN b.status = 'CANCELADO' THEN 'cancelado'
              WHEN b.status IN ('PAGO', 'RECEBIDO') THEN 'liquidado'
              WHEN b.vencimento <> '' AND b.vencimento < $2 THEN 'em_atraso'
              ELSE 'em_aberto' END AS situacao,
         CASE WHEN b.excluido OR b.status IN ('PAGO', 'RECEBIDO', 'CANCELADO') THEN 0 ELSE b.valor_c - b.campo_baixa_c END AS saldo_c,
         COALESCE(b.d->>'categoria_id', '') AS categoria_id,
         COALESCE(NULLIF(TRIM(concat_ws(' · ', NULLIF(cat.codigo, ''), NULLIF(cat.nome, ''))), ''), '') AS categoria,
         COALESCE(b.d->>'centro_custo_id', '') AS centro_custo_id,
         COALESCE(NULLIF(cen.nome, ''), b.d->>'centro_custo', '') AS centro_custo,
         COALESCE(b.d->>'conta_bancaria_id', '') AS conta_bancaria_id,
         COALESCE(cb.nome, '') AS conta_bancaria,
         CASE WHEN jsonb_typeof(b.d->'rateio') = 'array' THEN b.d->'rateio' ELSE '[]'::jsonb END AS rateio_j,
         ${comCobranca ? `COALESCE(cobr.status, '')` : `''::text`} AS cobranca_status,
         ${t.numeros ? 'num.numero' : 'NULL::bigint'} AS numero,
         ${t.numeros ? `COALESCE(num.cadastrado_por_nome, '')` : `''::text`} AS cadastrado_por,
         ${vendaNumero.length ? `COALESCE(${vendaNumero.join(', ')}, '')` : `''::text`} AS venda_numero,
         COALESCE(${vendedor.join(', ')}, '') AS vendedor,
         ${faturas ? `COALESCE(fat.numero, '')` : `''::text`} AS fatura_numero
    FROM brutos b
    LEFT JOIN cat ON cat.id = b.d->>'categoria_id'
    LEFT JOIN cen ON cen.id = b.d->>'centro_custo_id'
    LEFT JOIN cb ON cb.id = b.d->>'conta_bancaria_id'${comCobranca ? COBRANCA_DA_CONTA : ''}${t.numeros ? `
    LEFT JOIN titulos_numeros num ON num.tenant_id = $1 AND num.tabela = b.tabela AND num.id = b.id` : ''}${t.vendasModelo ? `
    LEFT JOIN vendas_modelo vm ON vm.tenant_id = $1 AND b.venda_ref <> '' AND vm.venda_id = b.venda_ref` : ''}${t.vendasCrm ? `
    LEFT JOIN vendas_crm vc ON vc.tenant_id = $1 AND b.venda_ref <> '' AND vc.id = b.venda_ref` : ''}${t.usuarios && idVendedor ? `
    LEFT JOIN usuarios us ON us.tenant_id = $1 AND us.id = COALESCE(${idVendedor})` : ''}${faturas ? `
    LEFT JOIN fat ON fat.tabela = b.tabela AND fat.conta = b.id` : ''}
)`;
}

const COLUNA_DA_DATA: Record<DataDoFiltro, string> = { emissao: 'a.emissao', vencimento: 'a.vencimento', liquidacao: 'a.liquidacao' };

const COLUNA_DA_ORDEM: Record<OrdemDaLista, string> = {
  vencimento: `NULLIF(a.vencimento, '')`,
  emissao: `NULLIF(a.emissao, '')`,
  liquidacao: `NULLIF(a.liquidacao, '')`,
  valor: 'a.valor_c',
  saldo: 'a.saldo_c',
  pessoa: 'LOWER(a.pessoa)',
  descricao: `LOWER(COALESCE(a.d->>'descricao', ''))`,
  documento: 'LOWER(a.documento)',
  categoria: 'LOWER(a.categoria)',
  centro: 'LOWER(a.centro_custo)',
  conta: 'LOWER(a.conta_bancaria)',
  situacao: `CASE a.situacao WHEN 'em_atraso' THEN 0 WHEN 'em_aberto' THEN 1 WHEN 'liquidado' THEN 2 ELSE 3 END`,
  tipo: 'a.tipo',
  numero: 'a.numero',
  // Nº de venda costuma ser número: ordena pelo número quando é, senão pelo texto.
  venda: `NULLIF(LPAD(a.venda_numero, 20, '0'), '')`,
  vendedor: `NULLIF(LOWER(a.vendedor), '')`,
  cadastrado: `NULLIF(a.cadastrado_em, '')`,
};

const CAMPO_DA_BUSCA: Record<Exclude<CampoDaBusca, 'tudo'>, string> = {
  numero: `COALESCE(a.numero::text, '')`,
  descricao: `COALESCE(a.d->>'descricao', '')`,
  pessoa: 'a.pessoa',
  documento: `concat_ws(' ', a.documento, a.id)`,
  categoria: 'a.categoria',
  centro: 'a.centro_custo',
  venda: 'a.venda_numero',
};

/** WHERE dos filtros. `valores` já traz $1 (agência) e $2 (hoje). */
export function clausulas(f: FiltroDaLista, contasLiberadas: readonly string[] | null, valores: unknown[]): string {
  const partes: string[] = [];
  const p = (v: unknown) => { valores.push(v); return `$${valores.length}`; };
  if (f.tipo !== 'ambos') partes.push(`a.tipo = ${p(f.tipo)}`);
  const coluna = COLUNA_DA_DATA[f.data];
  if (f.de || f.ate) partes.push(`${coluna} <> ''`);
  if (f.de) partes.push(`${coluna} >= ${p(f.de)}`);
  if (f.ate) partes.push(`${coluna} <= ${p(f.ate)}`);
  if (f.situacao === 'em_aberto') partes.push(`a.situacao IN ('em_aberto', 'em_atraso')`);
  else if (f.situacao !== 'todas') partes.push(`a.situacao = ${p(f.situacao)}`);
  if (f.categoria) {
    const c = p(f.categoria);
    partes.push(`(a.categoria_id = ${c} OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.rateio_j) e WHERE e->>'categoria_id' = ${c}))`);
  }
  if (f.centro) {
    const c = p(f.centro);
    partes.push(`(a.centro_custo_id = ${c} OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.rateio_j) e WHERE e->>'centro_custo_id' = ${c}))`);
  }
  if (f.conta) partes.push(`a.conta_bancaria_id = ${p(f.conta)}`);
  if (f.cobranca && f.cobranca !== 'todas') {
    const aberta = `a.tipo = 'receber' AND a.situacao IN ('em_aberto', 'em_atraso')`;
    if (f.cobranca === 'sem_boleto') partes.push(`(${aberta} AND a.cobranca_status NOT IN ('emitindo', 'aberta', 'vencida', 'paga'))`);
    else if (f.cobranca === 'emitida') partes.push(`(${aberta} AND a.cobranca_status IN ('emitindo', 'aberta'))`);
    else if (f.cobranca === 'vencida') partes.push(`(${aberta} AND a.cobranca_status = 'vencida')`);
    else if (f.cobranca === 'falhou') partes.push(`(${aberta} AND a.cobranca_status = 'falhou')`);
    else partes.push(`(a.tipo = 'receber' AND a.cobranca_status = 'paga')`);
  }
  if (f.empresas) {
    // Várias empresas (E7): a empresa do título ou a de uma linha do rateio.
    const e = p([...f.empresas]);
    partes.push(`(COALESCE(NULLIF(a.d->>'empresa_id', ''), 'principal') = ANY(${e}::text[])
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.rateio_j) re WHERE re->>'empresa_id' = ANY(${e}::text[])))`);
  }
  if (contasLiberadas !== null) {
    // Mesma regra do CRUD (filtro-de-conta.ts, soBaixados): só some a linha
    // já baixada numa conta bancária que a pessoa não enxerga.
    partes.push(`NOT (a.status = ANY(${p(STATUS_DE_BAIXA)}::text[]) AND a.conta_bancaria_id <> '' AND NOT (a.conta_bancaria_id = ANY(${p(contasLiberadas)}::text[])))`);
  }
  if (f.busca) {
    const like = p(`%${f.busca.replace(/[\\%_]/g, '\\$&')}%`);
    const alvo = f.em === 'tudo'
      ? `concat_ws(' ', a.d->>'descricao', a.pessoa, a.documento, a.id, a.categoria, a.centro_custo, a.conta_bancaria, a.d->>'observacoes',
                   a.numero::text, a.venda_numero, a.fatura_numero, a.vendedor)`
      : CAMPO_DA_BUSCA[f.em];
    partes.push(`${alvo} ILIKE ${like}`);
  }
  return partes.length ? partes.join(' AND ') : 'TRUE';
}

function ordemSql(f: FiltroDaLista): string {
  const dir = f.direcao === 'desc' ? 'DESC' : 'ASC';
  // Vazios no fim, nos dois sentidos; desempate estável.
  return `${COLUNA_DA_ORDEM[f.ordem]} ${dir} NULLS LAST, NULLIF(a.vencimento, '') ${dir} NULLS LAST, a.chave ${dir}`;
}

const COLUNAS_DA_LINHA = `a.chave, a.tabela, a.tipo, a.id, a.status, a.situacao, a.valor_c, a.baixado_c, a.saldo_c, a.campo_baixa_c,
  a.vencimento, a.emissao, a.liquidacao, a.pessoa, a.documento, a.forma, a.moeda,
  a.categoria_id, a.categoria, a.centro_custo_id, a.centro_custo, a.conta_bancaria_id, a.conta_bancaria,
  jsonb_array_length(a.rateio_j) > 0 AS tem_rateio, a.cobranca_status,
  a.numero, a.venda_numero, a.fatura_numero, a.vendedor, a.cadastrado_em, a.cadastrado_por,
  a.excluido_em, a.excluido_por, a.estornado_c,
  jsonb_build_object(
    'status', a.status, 'descricao', a.d->'descricao', 'parcela_numero', a.d->'parcela_numero', 'total_parcelas', a.d->'total_parcelas',
    'origem', a.d->'origem', 'serie_id', a.d->'serie_id', 'venda_id', a.d->'venda_id', 'origem_venda_id', a.d->'origem_venda_id',
    'origem_comissao_id', a.d->'origem_comissao_id', 'grupo_id', a.d->'grupo_id', 'auto_gerado', a.d->'auto_gerado',
    'plataforma_origem', a.d->'plataforma_origem', 'compra_id', a.d->'compra_id', 'fatura_id', a.d->'fatura_id',
    'valor_pago', a.d->'valor_pago', 'valor_recebido', a.d->'valor_recebido',
    'data_pagamento', a.d->'data_pagamento', 'data_recebimento', a.d->'data_recebimento',
    'campos_personalizados', a.d->'campos_personalizados',
    'empresa_id', a.d->'empresa_id'
  ) AS marcas`;

function linhaDoBanco(r: Record<string, unknown>, hoje: string): LinhaDeConta {
  const s = (k: string) => String(r[k] ?? '');
  const m = (r.marcas ?? {}) as Record<string, unknown>;
  const tabela = s('tabela') as TabelaDaConta;
  const parcela = Number(m.parcela_numero) || 0;
  const parcelas = Number(m.total_parcelas) || 0;
  const vencimento = s('vencimento');
  const situacao = s('situacao') as Situacao;
  const baixadoCampo = Number(r.campo_baixa_c ?? 0);
  const numero = r.numero === null || r.numero === undefined || r.numero === '' ? null : Number(r.numero);
  const campos = m.campos_personalizados;
  return {
    chave: s('chave'),
    tabela,
    tipo: s('tipo') as TipoDaConta,
    id: s('id'),
    status: s('status'),
    situacao,
    parcial: (situacao === 'em_aberto' || situacao === 'em_atraso') && baixadoCampo > 0,
    dias_atraso: situacao === 'em_atraso' ? diasDeAtraso(vencimento, hoje) : 0,
    descricao: String(m.descricao ?? ''),
    pessoa: s('pessoa'),
    documento: s('documento'),
    parcela: parcelas > 1 ? `${parcela}/${parcelas}` : '',
    categoria_id: s('categoria_id'),
    categoria: s('categoria'),
    centro_custo_id: s('centro_custo_id'),
    centro_custo: s('centro_custo'),
    conta_bancaria_id: s('conta_bancaria_id'),
    conta_bancaria: s('conta_bancaria'),
    emissao: s('emissao'),
    vencimento,
    liquidacao: s('liquidacao'),
    valor: deCentavos(r.valor_c as number),
    baixado: deCentavos(r.baixado_c as number),
    saldo: deCentavos(r.saldo_c as number),
    forma: s('forma'),
    venda_id: String(m.origem_venda_id || m.venda_id || ''),
    origem: String(m.origem ?? ''),
    moeda: s('moeda') || 'BRL',
    serie_id: String(m.serie_id ?? ''),
    rateio: r.tem_rateio === true,
    gerada_pelo_sistema: tituloGeradoPeloSistema(tabela, m),
    sem_baixa: tituloSemBaixa(tabela, m),
    cobranca_status: s('cobranca_status'),
    numero: Number.isFinite(numero) ? numero : null,
    venda_numero: s('venda_numero'),
    fatura_numero: s('fatura_numero'),
    vendedor: s('vendedor'),
    cadastrado_em: s('cadastrado_em'),
    cadastrado_por: s('cadastrado_por'),
    excluido_em: s('excluido_em'),
    excluido_por: s('excluido_por'),
    estornado_na_exclusao: deCentavos(r.estornado_c as number),
    campos_personalizados: campos && typeof campos === 'object' && !Array.isArray(campos) ? campos as Record<string, unknown> : {},
    empresa_id: String(m.empresa_id ?? '') || 'principal',
  };
}

// ─── Leitura ────────────────────────────────────────────────────────────────

export interface TotaisDoLado {
  quantidade: number;
  /** Soma do valor das contas listadas, sem as canceladas e as excluídas. */
  valor: number;
  /** Saldo em aberto (inclui o atrasado). */
  aberto: number;
  /** Saldo em aberto com vencimento anterior a hoje. */
  atraso: number;
  /** Tudo o que já foi pago/recebido, inclusive em parte. */
  baixado: number;
  /** Pago/recebido só das contas quitadas. */
  liquidado: number;
}

export interface TotaisDaLista {
  pagar: TotaisDoLado;
  receber: TotaisDoLado;
  /** A receber − a pagar, pelo valor das contas listadas. */
  saldo: number;
  /** A receber − a pagar, pelo que ainda está em aberto. */
  saldo_aberto: number;
  /** Quantas canceladas estão na lista (ficam fora dos totais). */
  canceladas: number;
  /** Quantas excluídas estão na lista (ficam fora dos totais). */
  excluidas: number;
}

export interface ResultadoDaLista {
  linhas: LinhaDeConta[];
  total: number;
  pagina: number;
  por_pagina: number;
  total_paginas: number;
  totais: TotaisDaLista;
  hoje: string;
}

function totaisDoLado(r: Record<string, unknown> | undefined): TotaisDoLado {
  return {
    quantidade: Number(r?.n ?? 0),
    valor: deCentavos(r?.valor as number),
    aberto: deCentavos(r?.aberto as number),
    atraso: deCentavos(r?.atraso as number),
    baixado: deCentavos(r?.baixado as number),
    liquidado: deCentavos(r?.liquidado as number),
  };
}

export async function lerContas(
  exec: ExecutorSQL, tenantId: string, f: FiltroDaLista, contasLiberadas: readonly string[] | null,
  opcoes: OpcoesDaLeitura = {},
): Promise<ResultadoDaLista> {
  const valores: unknown[] = [tenantId, f.hoje];
  const where = clausulas(f, contasLiberadas, valores);
  const base = sqlDasContas(opcoes, f.situacao === 'excluido');

  const { rows: tot } = await exec.query(
    `${base}
     SELECT a.tipo, COUNT(*)::int AS n,
            COALESCE(SUM(a.valor_c) FILTER (WHERE a.situacao NOT IN ('cancelado', 'excluido')), 0)::bigint AS valor,
            COALESCE(SUM(a.saldo_c) FILTER (WHERE a.situacao IN ('em_aberto', 'em_atraso')), 0)::bigint AS aberto,
            COALESCE(SUM(a.saldo_c) FILTER (WHERE a.situacao = 'em_atraso'), 0)::bigint AS atraso,
            COALESCE(SUM(a.baixado_c) FILTER (WHERE a.situacao <> 'excluido'), 0)::bigint AS baixado,
            COALESCE(SUM(a.baixado_c) FILTER (WHERE a.situacao = 'liquidado'), 0)::bigint AS liquidado,
            COUNT(*) FILTER (WHERE a.situacao = 'cancelado')::int AS canceladas,
            COUNT(*) FILTER (WHERE a.situacao = 'excluido')::int AS excluidas
       FROM base a WHERE ${where} GROUP BY a.tipo`,
    valores,
  );
  const porTipo = new Map(tot.map(r => [String(r.tipo), r]));
  const pagar = totaisDoLado(porTipo.get('pagar'));
  const receber = totaisDoLado(porTipo.get('receber'));
  const total = pagar.quantidade + receber.quantidade;
  const totalPaginas = Math.max(1, Math.ceil(total / f.porPagina));
  const pagina = Math.min(f.pagina, totalPaginas);

  const { rows } = await exec.query(
    `${base}
     SELECT ${COLUNAS_DA_LINHA} FROM base a WHERE ${where}
      ORDER BY ${ordemSql(f)}
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, f.porPagina, (pagina - 1) * f.porPagina],
  );

  return {
    linhas: rows.map(r => linhaDoBanco(r, f.hoje)),
    total, pagina, por_pagina: f.porPagina, total_paginas: totalPaginas,
    totais: {
      pagar, receber,
      saldo: round2(receber.valor - pagar.valor),
      saldo_aberto: round2(receber.aberto - pagar.aberto),
      canceladas: tot.reduce((s, r) => s + Number(r.canceladas ?? 0), 0),
      excluidas: tot.reduce((s, r) => s + Number(r.excluidas ?? 0), 0),
    },
    hoje: f.hoje,
  };
}

/** Todas as linhas do recorte (até `limite`), para exportar ou selecionar tudo. */
export async function lerTodas(
  exec: ExecutorSQL, tenantId: string, f: FiltroDaLista, contasLiberadas: readonly string[] | null, limite: number,
  opcoes: OpcoesDaLeitura = {},
): Promise<LinhaDeConta[]> {
  const valores: unknown[] = [tenantId, f.hoje];
  const where = clausulas(f, contasLiberadas, valores);
  const { rows } = await exec.query(
    `${sqlDasContas(opcoes, f.situacao === 'excluido')}
     SELECT ${COLUNAS_DA_LINHA} FROM base a WHERE ${where} ORDER BY ${ordemSql(f)} LIMIT $${valores.length + 1}`,
    [...valores, limite],
  );
  return rows.map(r => linhaDoBanco(r, f.hoje));
}

// ─── Campos personalizados (item 10, lado da lista) ─────────────────────────

export type TipoDoCampo = 'texto' | 'numero' | 'data' | 'sim_nao' | 'lista';

/** Campo personalizado da agência, como a lista precisa dele. */
export interface CampoDaLista {
  id: string;
  nome: string;
  tipo: TipoDoCampo;
  aplica_a: 'ambos' | 'pagar' | 'receber';
}

const TIPOS_DO_CAMPO = new Set<TipoDoCampo>(['texto', 'numero', 'data', 'sim_nao', 'lista']);

/**
 * Lê a resposta de Configurações › Financeiro › Campos personalizados
 * (`{ campos: [...] }` ou a lista direto) sem confiar no formato: só os
 * ativos, com id e nome. Nunca lança.
 */
export function camposDaConfig(json: unknown): CampoDaLista[] {
  const lista = Array.isArray(json) ? json
    : json && typeof json === 'object' && Array.isArray((json as { campos?: unknown }).campos) ? (json as { campos: unknown[] }).campos : [];
  const vistos = new Set<string>();
  const saida: CampoDaLista[] = [];
  for (const c of lista) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const nome = typeof o.nome === 'string' ? o.nome.trim() : '';
    if (!id || !nome || vistos.has(id) || o.ativo === false) continue;
    vistos.add(id);
    const tipo = TIPOS_DO_CAMPO.has(o.tipo as TipoDoCampo) ? o.tipo as TipoDoCampo : 'texto';
    const aplica = o.aplica_a === 'pagar' || o.aplica_a === 'receber' ? o.aplica_a : 'ambos';
    saida.push({ id: id.slice(0, 80), nome: nome.slice(0, 80), tipo, aplica_a: aplica });
  }
  return saida;
}

/** O valor do campo por extenso, como aparece na lista e na planilha. */
export function textoDoCampo(campo: Pick<CampoDaLista, 'tipo'>, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '';
  if (campo.tipo === 'sim_nao') {
    if (valor === true || valor === 'true' || valor === 'sim') return 'Sim';
    if (valor === false || valor === 'false' || valor === 'nao') return 'Não';
    return '';
  }
  if (campo.tipo === 'data' && typeof valor === 'string' && DATA.test(valor.slice(0, 10))) return dataBR(valor.slice(0, 10));
  if (campo.tipo === 'numero') {
    const v = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
    return Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : '';
  }
  if (typeof valor === 'object') return '';
  return String(valor).slice(0, 500);
}

// ─── Exportação ─────────────────────────────────────────────────────────────

function numeroBR(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '';
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
}

/** AAAA-MM-DDTHH:MM → DD/MM/AAAA HH:MM. */
export function dataHoraBR(v: string): string {
  if (!v) return '';
  const [d, h] = v.split('T');
  return h ? `${dataBR(d)} ${h.slice(0, 5)}` : dataBR(d);
}

/**
 * CSV que o Excel abre direto (BOM, ';', vírgula decimal). Texto passa por
 * auditCsvCell (aspas, quebras e fórmulas neutralizadas); número sai como
 * número, para a planilha somar. Os campos personalizados ativos entram no fim.
 */
export function csvDasContas(linhas: readonly LinhaDeConta[], campos: readonly CampoDaLista[] = []): string {
  const cel = (v: unknown) => auditCsvCell(v);
  const n = (v: number) => `"${numeroBR(v)}"`;
  const excluidas = linhas.some(l => l.situacao === 'excluido');
  const cab = ['Nº', 'Tipo', 'Situação', 'Vencimento', 'Emissão', 'Liquidação', 'Pessoa', 'Descrição', 'Documento', 'Parcela',
    'Categoria', 'Centro de custo', 'Conta bancária', 'Forma', 'Moeda', 'Valor', 'Pago/Recebido', 'Saldo em aberto', 'Dias de atraso',
    'Venda Nº', 'Fatura Nº', 'Vendedor', 'Cadastrado em', 'Cadastrado por',
    ...(excluidas ? ['Excluído em', 'Excluído por'] : []),
    ...campos.map(c => c.nome)];
  const corpo = linhas.map(l => [
    `"${l.numero ?? ''}"`,
    cel(ROTULO_DO_TIPO[l.tipo]), cel(rotuloDaSituacao(l)), cel(dataBR(l.vencimento)), cel(dataBR(l.emissao)), cel(dataBR(l.liquidacao)),
    cel(l.pessoa), cel(l.descricao), cel(l.documento), cel(l.parcela), cel(l.categoria), cel(l.centro_custo), cel(l.conta_bancaria),
    cel(l.forma), cel(l.moeda), n(l.valor), n(l.baixado), n(l.saldo), `"${l.dias_atraso || ''}"`,
    cel(l.venda_numero), cel(l.fatura_numero), cel(l.vendedor), cel(dataHoraBR(l.cadastrado_em)), cel(l.cadastrado_por || 'Sistema'),
    ...(excluidas ? [cel(dataHoraBR(l.excluido_em)), cel(l.excluido_por)] : []),
    ...campos.map(c => cel(c.aplica_a === 'ambos' || c.aplica_a === l.tipo ? textoDoCampo(c, l.campos_personalizados[c.id]) : '')),
  ].join(';'));
  return '﻿' + [cab.map(cel).join(';'), ...corpo].join('\r\n');
}

// ─── Exportação em Excel e PDF (E7, G3) ─────────────────────────────────────

const ROTULO_DA_DATA: Record<DataDoFiltro, string> = { emissao: 'Emissão', vencimento: 'Vencimento', liquidacao: 'Liquidação' };
const ROTULO_DA_SITUACAO_DO_FILTRO: Record<SituacaoDoFiltro, string> = {
  todas: 'Todas', em_aberto: 'Em aberto', em_atraso: 'Em atraso', liquidado: 'Pago ou recebido', cancelado: 'Cancelado', excluido: 'Excluído',
};
const ROTULO_DA_COBRANCA_DO_FILTRO: Record<CobrancaDoFiltro, string> = {
  todas: 'Todas', sem_boleto: 'Boleto não emitido', emitida: 'Cobrança emitida', vencida: 'Cobrança vencida', paga: 'Cobrança paga', falhou: 'Cobrança com falha',
};

/** O filtro por extenso (vai no topo do arquivo e no nome dele). Nomes de categoria, centro e conta saem das linhas. */
export function filtrosLegiveisDasContas(f: FiltroDaLista, linhas: readonly LinhaDeConta[]): FiltroAplicado[] {
  const out: FiltroAplicado[] = [];
  if (f.tipo !== 'ambos') out.push({ rotulo: 'Tipo', valor: f.tipo === 'pagar' ? 'A pagar' : 'A receber' });
  if (f.de || f.ate) out.push({ rotulo: ROTULO_DA_DATA[f.data], valor: rotuloDoPeriodo(f.de || null, f.ate || null) });
  if (f.situacao !== 'todas') out.push({ rotulo: 'Situação', valor: ROTULO_DA_SITUACAO_DO_FILTRO[f.situacao] });
  if (f.cobranca !== 'todas') out.push({ rotulo: 'Cobrança', valor: ROTULO_DA_COBRANCA_DO_FILTRO[f.cobranca] });
  if (f.busca) out.push({ rotulo: 'Busca', valor: f.busca });
  const nome = (id: string, campo: 'categoria' | 'centro_custo' | 'conta_bancaria', campoId: 'categoria_id' | 'centro_custo_id' | 'conta_bancaria_id') =>
    linhas.find(l => l[campoId] === id)?.[campo] || id;
  if (f.categoria) out.push({ rotulo: 'Categoria', valor: nome(f.categoria, 'categoria', 'categoria_id') });
  if (f.centro) out.push({ rotulo: 'Centro de custo', valor: nome(f.centro, 'centro_custo', 'centro_custo_id') });
  if (f.conta) out.push({ rotulo: 'Conta bancária', valor: nome(f.conta, 'conta_bancaria', 'conta_bancaria_id') });
  return out;
}

/** As mesmas colunas da planilha CSV, em documento para Excel (.xlsx), PDF e impressão. */
export function documentoDasContas(linhas: readonly LinhaDeConta[], f: FiltroDaLista): DocumentoExportado {
  const titulo = f.tipo === 'pagar' ? 'Contas a pagar' : f.tipo === 'receber' ? 'Contas a receber' : 'Contas a pagar e receber';
  // As mesmas colunas da planilha CSV, na mesma ordem (Nº, moeda, venda, fatura,
  // vendedor e cadastro desde a E7, G1).
  const colunas: ColunaExportada[] = [
    { id: 'numero', rotulo: 'Nº', tipo: 'inteiro' },
    { id: 'tipo', rotulo: 'Tipo', tipo: 'texto' }, { id: 'situacao', rotulo: 'Situação', tipo: 'texto' },
    { id: 'vencimento', rotulo: 'Vencimento', tipo: 'data' }, { id: 'emissao', rotulo: 'Emissão', tipo: 'data' },
    { id: 'liquidacao', rotulo: 'Liquidação', tipo: 'data' }, { id: 'pessoa', rotulo: 'Pessoa', tipo: 'texto' },
    { id: 'descricao', rotulo: 'Descrição', tipo: 'texto' }, { id: 'documento', rotulo: 'Documento', tipo: 'texto' },
    { id: 'parcela', rotulo: 'Parcela', tipo: 'texto' }, { id: 'categoria', rotulo: 'Categoria', tipo: 'texto' },
    { id: 'centro_custo', rotulo: 'Centro de custo', tipo: 'texto' }, { id: 'conta_bancaria', rotulo: 'Conta bancária', tipo: 'texto' },
    { id: 'forma', rotulo: 'Forma', tipo: 'texto' }, { id: 'moeda', rotulo: 'Moeda', tipo: 'texto' },
    { id: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
    { id: 'baixado', rotulo: 'Pago/Recebido', tipo: 'dinheiro' }, { id: 'saldo', rotulo: 'Saldo em aberto', tipo: 'dinheiro' },
    { id: 'dias_atraso', rotulo: 'Dias de atraso', tipo: 'inteiro' },
    { id: 'venda_numero', rotulo: 'Venda Nº', tipo: 'texto' }, { id: 'fatura_numero', rotulo: 'Fatura Nº', tipo: 'texto' },
    { id: 'vendedor', rotulo: 'Vendedor', tipo: 'texto' }, { id: 'cadastrado_em', rotulo: 'Cadastrado em', tipo: 'texto' },
    { id: 'cadastrado_por', rotulo: 'Cadastrado por', tipo: 'texto' },
  ];
  const soma = (k: 'valor' | 'baixado' | 'saldo') => round2(linhas.reduce((a, l) => a + (l[k] || 0), 0));
  return {
    titulo,
    filtros: filtrosLegiveisDasContas(f, linhas),
    colunas,
    linhas: linhas.map(l => ({
      tipo: ROTULO_DO_TIPO[l.tipo], situacao: rotuloDaSituacao(l), vencimento: l.vencimento, emissao: l.emissao, liquidacao: l.liquidacao,
      pessoa: l.pessoa, descricao: l.descricao, documento: l.documento, parcela: l.parcela, categoria: l.categoria,
      centro_custo: l.centro_custo, conta_bancaria: l.conta_bancaria, forma: l.forma, valor: l.valor, baixado: l.baixado,
      saldo: l.saldo, dias_atraso: l.dias_atraso || null,
      numero: l.numero, moeda: l.moeda, venda_numero: l.venda_numero, fatura_numero: l.fatura_numero, vendedor: l.vendedor,
      cadastrado_em: dataHoraBR(l.cadastrado_em), cadastrado_por: l.cadastrado_por || 'Sistema',
    })),
    totais: linhas.length ? { valor: soma('valor'), baixado: soma('baixado'), saldo: soma('saldo') } : null,
    dinheiro_em: 'reais',
    orientacao: 'paisagem',
  };
}
