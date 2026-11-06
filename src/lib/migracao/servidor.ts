/**
 * Mudança de sistema (E4, 05/11/2026): a parte que fala com o banco.
 *
 * Caminho de um lote:
 *   rascunho  → soltar arquivos, conferir o mapeamento (confirmar)
 *   ensaiado  → ensaio feito: cada linha sabe se vai ser criada, vinculada,
 *               recusada (com motivo) ou ignorada. NADA foi gravado nas
 *               tabelas do financeiro.
 *   aplicando → gravando em blocos pela fila do agendador (e um começo na
 *               própria requisição). Tudo dentro de comNadaSai().
 *   aplicado  → gravado; saídas da agência seguradas até concluir.
 *   concluido → "Concluir mudança": régua, avisos e cobrança voltam a sair.
 *   desfeito / desfeito_em_parte → o que o lote criou e ninguém mudou foi
 *               apagado; o resto ficou, com o motivo.
 *
 * Toda função recebe a agência e só lê e grava nela.
 */
import { createHash, randomUUID } from 'node:crypto';
import { emTransacao, moverCaixaOuFalhar, type ExecutorSQL } from '../caixa-atomico';
import { salvarCentro } from '../centros-custo-servidor';
import { createCliente, createContaPagar, createContaReceber, type Cliente } from '../crm-types';
import { cadastroCompleto, nomeComparavel, nomeDoFornecedor } from '../fornecedor-sync';
import { enfileirarTarefa, type TarefaReivindicada } from '../agendador/fila';
import { comNadaSai } from '../nada-sai';
import { num, paraCentavos } from '../money';
import { documentoComparavel } from '../plataformas/conciliacao';
import {
  adivinharLista, camposFaltando, definicaoDaLista, ETAPA_DA_LISTA, LISTAS, rotuloDosFaltando, sugerirMapeamento,
  validarMapeamento, type ListaId, type Mapeamento,
} from './dicionario';
import { STATUS_QUE_SEGURAM } from './estado';
import { indiceVazio, type IndiceDeCadastros, type PapelSimples } from './identidade';
import { interpretarLinhas, type Interpretacao, type Movimento, type RegistroLido } from './interpretar';
import { abaPrincipal, ErroDeLeitura, lerPlanilha, prepararAba, type AvisoDoArquivo, type LinhaPreparada } from './leitor';
import {
  gravadorDeEnsaio, processarRegistro, type ContextoDoPlano, type Decisao, type Enriquecimento, type Gravador, type OrigemDaLinha,
} from './plano';
import { dataBR, lerData, normalizar, texto, type Celula } from './valores';
import { gravadorDoHistorico, type AcaoDoVinculo } from './gravador-historico';
import { agruparVendas, type ProdutoVendidoLido } from './interpretar-historico';

// ---------------------------------------------------------------------------
// Tipos do contrato com as telas

export type StatusDoLote = 'rascunho' | 'ensaiado' | 'aplicando' | 'aplicado' | 'concluido' | 'desfazendo' | 'desfeito' | 'desfeito_em_parte' | 'falhou';
export type PapelPadrao = 'cliente' | 'fornecedor' | 'ambos';

export interface OpcoesDoLote {
  /** Pessoa da lista de pessoas que não aparece em nenhum título nem diz o papel. Padrão: cliente. */
  papel_padrao?: PapelPadrao;
  /** Só estas empresas (como escritas no arquivo). Vazio = todas. */
  empresas?: string[];
  /**
   * E7: "paralelo" = mês em paralelo. O lote só recebe arquivos e compara
   * com o que foi lançado aqui no mesmo mês; nunca ensaia, aplica nem grava
   * no financeiro, e não conta como mudança em andamento.
   */
  modo?: 'mudanca' | 'paralelo';
  /** Mês comparado (AAAA-MM), no modo paralelo. */
  mes?: string;
}

/** O lote é uma comparação do mês em paralelo (não uma mudança)? */
export function ehParalelo(l: { opcoes: OpcoesDoLote }): boolean {
  return l.opcoes.modo === 'paralelo';
}
const SO_MUDANCA = `COALESCE(opcoes->>'modo', 'mudanca') <> 'paralelo'`;

export interface Lote {
  id: string;
  nome: string;
  status: StatusDoLote;
  data_corte: string | null;
  opcoes: OpcoesDoLote;
  resumo: ResumoDoEnsaio | null;
  assinatura: string | null;
  progresso: { total: number; feitas: number; percentual: number };
  erro: string | null;
  criado_por_nome: string;
  criado_em: string;
  ensaiado_em: string | null;
  aplicado_em: string | null;
  concluido_em: string | null;
  desfeito_em: string | null;
  arquivos: number;
  /** Sobe a cada arquivo, mapeamento ou opção mudada; o ensaio guarda a versão em que rodou. */
  versao: number;
  versao_do_ensaio: number | null;
}

export interface ColunaDoArquivo {
  indice: number;
  cabecalho: string;
  /** Campo ligado a esta coluna (null = fica de fora). */
  campo: string | null;
  /** Até 3 valores das primeiras linhas, para a pessoa reconhecer a coluna. */
  exemplos: string[];
}

export interface ArquivoDoLote {
  id: string;
  ordem: number;
  nome: string;
  aba: string;
  tamanho: number;
  formato: string;
  codificacao: string | null;
  separador: string | null;
  lista: ListaId;
  /** false = o leitor não reconheceu a lista: a pessoa precisa escolher. */
  lista_reconhecida: boolean;
  lista_rotulo: string;
  /** Datas mínima e máxima (vencimento nos títulos, data nos saldos). */
  periodo: { de: string; ate: string } | null;
  linha_cabecalho: number;
  colunas: ColunaDoArquivo[];
  mapeamento: Mapeamento;
  mapeamento_confirmado: boolean;
  /** Rótulos dos campos obrigatórios ainda sem coluna. */
  faltando: string[];
  ignoradas: Array<{ indice: number; cabecalho: string }>;
  avisos: AvisoDoArquivo[];
  total_rodape: Record<string, number>;
  linhas: number;
  opcoes: { movimento?: Movimento | null };
}

export interface ContagemDoResultado { linhas: number; criar: number; vincular: number; recusar: number; ignorar: number }

export interface ResumoDoEnsaio {
  por_lista: Partial<Record<ListaId, ContagemDoResultado>>;
  total: ContagemDoResultado;
  motivos: Array<{ codigo: string; rotulo: string; quantidade: number }>;
  titulos: { pagar: { quantidade: number; centavos: number }; receber: { quantidade: number; centavos: number } };
  saldos: { contas: number; centavos: number };
  pessoas_novas_dos_titulos: number;
  problemas: Array<{ codigo: string; mensagem: string; arquivo_id?: string }>;
  avisos: Array<{ codigo: string; mensagem: string; arquivo_id?: string }>;
  pode_aplicar: boolean;
  /** Histórico (E7): o que entra além das contas em aberto. */
  historico?: ResumoDoHistorico;
}

export interface ResumoDoHistorico {
  liquidados: { quantidade: number; centavos: number };
  movimentos: { criar: number; vincular: number; centavos: number };
  vendas: { quantidade: number; produtos: number; centavos: number };
  registros: { faturas: number; notas: number; comissoes_pagas: number };
  metas: number;
  reembolsos: { quantidade: number; centavos: number };
  creditos: { quantidade: number; centavos: number };
}

export function resumoDoHistoricoVazio(): ResumoDoHistorico {
  return {
    liquidados: { quantidade: 0, centavos: 0 }, movimentos: { criar: 0, vincular: 0, centavos: 0 }, vendas: { quantidade: 0, produtos: 0, centavos: 0 },
    registros: { faturas: 0, notas: 0, comissoes_pagas: 0 }, metas: 0, reembolsos: { quantidade: 0, centavos: 0 }, creditos: { quantidade: 0, centavos: 0 },
  };
}

export class ErroMudanca extends Error {
  readonly status: number;
  readonly codigo: string;
  constructor(mensagem: string, status = 400, codigo = 'INVALIDO') {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export interface QuemFez { id: string; nome: string }

/** Tipo da tarefa da fila que aplica um lote (registrar o processador em agendador/tarefas.ts). */
export const TIPO_TAREFA_MIGRACAO = 'migracao-aplicar';

const ROTULO_DO_CODIGO: Record<string, string> = {
  falta_coluna: 'Falta ligar uma coluna obrigatória',
  sem_nome: 'Sem nome',
  sem_valor: 'Sem valor ou valor zero',
  valor_invalido: 'Valor ilegível',
  data_invalida: 'Data ilegível ou sem vencimento',
  sem_movimento: 'Não diz se é a pagar ou a receber',
  liquidado: 'Já liquidado (solte como "Contas já liquidadas")',
  excluido: 'Excluído no sistema anterior',
  moeda_estrangeira: 'Em outra moeda (fica para depois)',
  outra_empresa: 'De outra empresa',
  sem_tipo: 'Categoria sem receita/despesa',
  duplicado_no_arquivo: 'Repetido nos arquivos',
  ja_importado: 'Já trazido por outra mudança',
  pessoa_ambigua: 'Mais de uma pessoa com o mesmo nome',
  conta_nao_encontrada: 'Conta não encontrada',
  conta_com_movimento: 'Conta já tem movimento aqui',
  linha_de_total: 'Linha de total do rodapé',
  linha_de_agrupamento: 'Linha de agrupamento',
  aviso_do_arquivo: 'Aviso de lista cortada',
  erro: 'Erro ao gravar',
  // Histórico (E7)
  depois_do_corte: 'Depois da data de corte (lance aqui)',
  nao_emitida: 'Nota que não foi emitida lá',
  vencido: 'Crédito já vencido',
  transferencia: 'Transferência entre contas',
  venda_invalida: 'Venda incompleta',
  pessoa_sem_funcao: 'Pessoa fora das funções de comissão',
};

export function rotuloDoCodigo(codigo: string): string {
  return ROTULO_DO_CODIGO[codigo] ?? codigo;
}

const txt = (v: unknown) => (v == null ? '' : String(v));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const dataIso = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

// ---------------------------------------------------------------------------
// Lote

function loteDaLinha(r: Record<string, unknown>): Lote {
  const prog = (r.progresso ?? {}) as { total?: number; feitas?: number };
  const total = Number(prog.total ?? 0);
  const feitas = Number(prog.feitas ?? 0);
  const resumo = r.resumo && typeof r.resumo === 'object' && Object.keys(r.resumo as object).length ? (r.resumo as ResumoDoEnsaio) : null;
  return {
    id: txt(r.id), nome: txt(r.nome), status: txt(r.status) as StatusDoLote, data_corte: dataIso(r.data_corte),
    opcoes: (r.opcoes ?? {}) as OpcoesDoLote, resumo, assinatura: r.assinatura == null ? null : txt(r.assinatura),
    progresso: { total, feitas, percentual: total ? Math.min(100, Math.round((feitas / total) * 100)) : (txt(r.status) === 'aplicado' || txt(r.status) === 'concluido' ? 100 : 0) },
    erro: r.erro == null ? null : txt(r.erro), criado_por_nome: txt(r.criado_por_nome), criado_em: iso(r.criado_em) ?? '',
    ensaiado_em: iso(r.ensaiado_em), aplicado_em: iso(r.aplicado_em), concluido_em: iso(r.concluido_em), desfeito_em: iso(r.desfeito_em),
    arquivos: Number(r.qtd_arquivos ?? 0),
    versao: Number(r.versao ?? 1), versao_do_ensaio: r.versao_do_ensaio == null ? null : Number(r.versao_do_ensaio),
  };
}

const COLUNAS_DO_LOTE = `l.*, (SELECT COUNT(*)::int FROM migracao_arquivos a WHERE a.lote_id = l.id) AS qtd_arquivos`;

/** As mudanças da agência (sem as comparações do mês em paralelo, que têm a lista delas). */
export async function listarLotes(exec: ExecutorSQL, tenantId: string, modo: 'mudanca' | 'paralelo' = 'mudanca'): Promise<Lote[]> {
  const filtro = modo === 'paralelo' ? `COALESCE(l.opcoes->>'modo', '') = 'paralelo'` : `COALESCE(l.opcoes->>'modo', 'mudanca') <> 'paralelo'`;
  const { rows } = await exec.query(`SELECT ${COLUNAS_DO_LOTE} FROM migracao_lotes l WHERE l.tenant_id = $1 AND ${filtro} ORDER BY l.criado_em DESC`, [tenantId]);
  return rows.map(loteDaLinha);
}

export async function lerLote(exec: ExecutorSQL, tenantId: string, loteId: string, travar = false): Promise<Lote> {
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_DO_LOTE} FROM migracao_lotes l WHERE l.tenant_id = $1 AND l.id = $2${travar ? ' FOR UPDATE' : ''}`,
    [tenantId, loteId],
  );
  if (!rows.length) throw new ErroMudanca('Mudança não encontrada.', 404, 'NAO_ENCONTRADO');
  return loteDaLinha(rows[0]);
}

function limparOpcoes(entrada: unknown): OpcoesDoLote {
  const o = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const papel = o.papel_padrao === 'fornecedor' || o.papel_padrao === 'ambos' ? o.papel_padrao : 'cliente';
  const empresas = Array.isArray(o.empresas) ? o.empresas.map(e => texto(e)).filter(Boolean).slice(0, 50) : [];
  if (o.modo === 'paralelo') {
    const mes = texto(o.mes);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroMudanca('Escolha o mês a comparar (mês e ano).', 400, 'MES_INVALIDO');
    return { papel_padrao: papel, empresas, modo: 'paralelo', mes };
  }
  return { papel_padrao: papel, empresas };
}

function limparDataCorte(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = lerData(v);
  if (!d) throw new ErroMudanca('A data de corte não é uma data válida.', 400, 'DATA_CORTE_INVALIDA');
  return d;
}

/** Lote "aberto": ainda não concluído nem desfeito. Só um por agência. */
export const STATUS_ABERTOS: StatusDoLote[] = ['rascunho', 'ensaiado', 'aplicando', 'aplicado', 'desfazendo'];

export async function criarLote(
  exec: ExecutorSQL, tenantId: string, entrada: { nome?: unknown; data_corte?: unknown; opcoes?: unknown }, quem: QuemFez,
  chaveIdem?: string | null,
): Promise<Lote> {
  // Uma criação por agência de cada vez (a trava vale até o fim da transação).
  await exec.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`migracao-lote:${tenantId}`]);
  if (chaveIdem) {
    const { rows } = await exec.query(`SELECT id FROM migracao_lotes WHERE tenant_id = $1 AND chave_criacao = $2`, [tenantId, chaveIdem]);
    if (rows.length) return lerLote(exec, tenantId, txt(rows[0].id));
  }
  const opcoes = limparOpcoes(entrada.opcoes);
  const { rows: aberto } = opcoes.modo === 'paralelo' ? { rows: [] } : await exec.query(
    `SELECT nome FROM migracao_lotes WHERE tenant_id = $1 AND status = ANY($2::text[]) AND ${SO_MUDANCA} LIMIT 1`, [tenantId, STATUS_ABERTOS],
  );
  if (aberto.length) {
    throw new ErroMudanca(`Já existe uma mudança em andamento ("${txt(aberto[0].nome)}"). Termine ou desfaça antes de começar outra.`, 409, 'LOTE_ABERTO');
  }
  const id = randomUUID();
  const nome = texto(entrada.nome).slice(0, 120) || (opcoes.modo === 'paralelo' ? `Mês em paralelo ${opcoes.mes}` : 'Mudança do sistema anterior');
  await exec.query(
    `INSERT INTO migracao_lotes (id, tenant_id, nome, data_corte, opcoes, criado_por, criado_por_nome, chave_criacao)
     VALUES ($1, $2, $3, $4::date, $5::jsonb, $6, $7, $8)`,
    [id, tenantId, nome, limparDataCorte(entrada.data_corte), JSON.stringify(opcoes), quem.id, quem.nome, chaveIdem ?? null],
  );
  return lerLote(exec, tenantId, id);
}

const EDITAVEL: StatusDoLote[] = ['rascunho', 'ensaiado'];

function exigirEditavel(l: Lote): void {
  if (!EDITAVEL.includes(l.status)) {
    throw new ErroMudanca('Esta mudança já foi aplicada: comece outra para trazer mais arquivos.', 409, 'LOTE_FECHADO');
  }
}

/** Qualquer mudança no lote ou nos arquivos invalida o ensaio. */
async function voltarParaRascunho(exec: ExecutorSQL, tenantId: string, loteId: string): Promise<void> {
  await exec.query(
    `UPDATE migracao_lotes SET status = 'rascunho', assinatura = NULL, resumo = '{}'::jsonb, versao = versao + 1, atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, loteId],
  );
}

export async function atualizarLote(
  exec: ExecutorSQL, tenantId: string, loteId: string, entrada: { nome?: unknown; data_corte?: unknown; opcoes?: unknown },
): Promise<Lote> {
  const l = await lerLote(exec, tenantId, loteId, true);
  exigirEditavel(l);
  const nome = entrada.nome === undefined ? l.nome : texto(entrada.nome).slice(0, 120) || l.nome;
  const corte = entrada.data_corte === undefined ? l.data_corte : limparDataCorte(entrada.data_corte);
  const opcoes = entrada.opcoes === undefined ? l.opcoes : limparOpcoes({ ...l.opcoes, ...(entrada.opcoes as object), modo: l.opcoes.modo, ...(l.opcoes.modo === 'paralelo' ? { mes: (entrada.opcoes as { mes?: unknown })?.mes ?? l.opcoes.mes } : {}) });
  await exec.query(
    `UPDATE migracao_lotes SET nome = $3, data_corte = $4::date, opcoes = $5::jsonb, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, loteId, nome, corte, JSON.stringify(opcoes)],
  );
  await voltarParaRascunho(exec, tenantId, loteId);
  return lerLote(exec, tenantId, loteId);
}

// ---------------------------------------------------------------------------
// Arquivos

function arquivoDaLinha(r: Record<string, unknown>, exemplos: Map<number, string[]>): ArquivoDoLote {
  const lista = txt(r.lista) as ListaId;
  const cabecalhos = (Array.isArray(r.cabecalhos) ? r.cabecalhos : []) as string[];
  const mapeamento = (r.mapeamento ?? {}) as Mapeamento;
  const porColuna = new Map<number, string>();
  for (const [campo, i] of Object.entries(mapeamento)) porColuna.set(Number(i), campo);
  const def = definicaoDaLista(lista);
  return {
    id: txt(r.id), ordem: Number(r.ordem ?? 0), nome: txt(r.nome), aba: txt(r.aba), tamanho: Number(r.tamanho ?? 0),
    formato: txt(r.formato), codificacao: r.codificacao == null ? null : txt(r.codificacao), separador: r.separador == null ? null : txt(r.separador),
    lista, lista_reconhecida: r.lista_reconhecida !== false, lista_rotulo: def?.rotulo ?? lista,
    periodo: (r.periodo ?? null) as ArquivoDoLote['periodo'], linha_cabecalho: Number(r.linha_cabecalho ?? 1),
    colunas: cabecalhos.map((cabecalho, indice) => ({ indice, cabecalho, campo: porColuna.get(indice) ?? null, exemplos: exemplos.get(indice) ?? [] })),
    mapeamento, mapeamento_confirmado: Boolean(r.mapeamento_confirmado),
    faltando: def ? rotuloDosFaltando(lista, camposFaltando(def, mapeamento)) : [],
    ignoradas: cabecalhos.map((cabecalho, indice) => ({ indice, cabecalho })).filter(c => c.cabecalho && !porColuna.has(c.indice)),
    avisos: (Array.isArray(r.avisos) ? r.avisos : []) as AvisoDoArquivo[],
    total_rodape: (r.total_rodape ?? {}) as Record<string, number>, linhas: Number(r.linhas ?? 0),
    opcoes: (r.opcoes ?? {}) as ArquivoDoLote['opcoes'],
  };
}

async function exemplosDasColunas(exec: ExecutorSQL, tenantId: string, arquivoId: string): Promise<Map<number, string[]>> {
  const { rows } = await exec.query(
    `SELECT celulas FROM migracao_linhas WHERE tenant_id = $1 AND arquivo_id = $2 AND tipo = 'dado' ORDER BY linha LIMIT 3`,
    [tenantId, arquivoId],
  );
  const m = new Map<number, string[]>();
  for (const r of rows) {
    const cel = (Array.isArray(r.celulas) ? r.celulas : []) as Celula[];
    cel.forEach((c, i) => {
      const t = texto(c);
      if (!t) return;
      const lista = m.get(i) ?? [];
      if (lista.length < 3) lista.push(t.slice(0, 60));
      m.set(i, lista);
    });
  }
  return m;
}

export async function listarArquivos(exec: ExecutorSQL, tenantId: string, loteId: string): Promise<ArquivoDoLote[]> {
  const { rows } = await exec.query(
    `SELECT * FROM migracao_arquivos WHERE tenant_id = $1 AND lote_id = $2 ORDER BY ordem, criado_em`,
    [tenantId, loteId],
  );
  const out: ArquivoDoLote[] = [];
  for (const r of rows) out.push(arquivoDaLinha(r, await exemplosDasColunas(exec, tenantId, txt(r.id))));
  return out;
}

async function lerArquivo(exec: ExecutorSQL, tenantId: string, loteId: string, arquivoId: string): Promise<ArquivoDoLote> {
  const { rows } = await exec.query(`SELECT * FROM migracao_arquivos WHERE tenant_id = $1 AND lote_id = $2 AND id = $3`, [tenantId, loteId, arquivoId]);
  if (!rows.length) throw new ErroMudanca('Arquivo não encontrado nesta mudança.', 404, 'NAO_ENCONTRADO');
  return arquivoDaLinha(rows[0], await exemplosDasColunas(exec, tenantId, arquivoId));
}

/** Tamanho máximo de um arquivo solto (as exportações do sistema anterior ficam bem abaixo). */
export const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Lê o arquivo, acha a lista e sugere o mapeamento. Cada aba com dados vira
 * um arquivo do lote. O mesmo arquivo duas vezes no mesmo lote é recusado.
 * Roda numa transação (exec em BEGIN).
 */
export async function adicionarArquivo(
  exec: ExecutorSQL, tenantId: string, loteId: string, nome: string, bytes: Uint8Array,
): Promise<ArquivoDoLote[]> {
  const l = await lerLote(exec, tenantId, loteId, true);
  exigirEditavel(l);
  if (bytes.length > MAX_BYTES) throw new ErroMudanca('O arquivo passa de 15 MB. Exporte em partes (um arquivo por mês).', 413, 'ARQUIVO_GRANDE');
  let planilha;
  try {
    planilha = lerPlanilha(nome, bytes);
  } catch (e) {
    if (e instanceof ErroDeLeitura) throw new ErroMudanca(e.message, 400, e.codigo);
    throw e;
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  const principal = abaPrincipal(planilha);
  const abas = planilha.abas
    .map((a, i) => ({ a, i }))
    .filter(({ a, i }) => i === principal || a.linhas.some(c => c.filter(x => x !== null && x !== '').length > 1));
  const { rows: ord } = await exec.query(`SELECT COALESCE(MAX(ordem), 0)::int AS m FROM migracao_arquivos WHERE lote_id = $1`, [loteId]);
  let ordem = Number(ord[0]?.m ?? 0);
  const criados: string[] = [];
  for (const { a, i } of abas) {
    const prep = prepararAba(a);
    if (!prep.cabecalhos.length) continue;
    const chave = abas.length > 1 ? `${hash}:${i}` : hash;
    const { rows: ja } = await exec.query(`SELECT nome FROM migracao_arquivos WHERE lote_id = $1 AND hash = $2`, [loteId, chave]);
    if (ja.length) throw new ErroMudanca(`Este arquivo já foi solto nesta mudança ("${txt(ja[0].nome)}").`, 409, 'ARQUIVO_REPETIDO');
    const { lista, sugestao } = listaPeloConteudo(prep.cabecalhos, prep.linhas);
    const reconhecida = sugestao.pontos >= 2 && sugestao.faltando.length === 0;
    const id = randomUUID();
    ordem += 1;
    const dados = prep.linhas.filter(x => x.tipo === 'dado').length;
    await exec.query(
      `INSERT INTO migracao_arquivos (id, tenant_id, lote_id, ordem, nome, tamanho, hash, formato, codificacao, separador, aba, abas,
                                      lista, linha_cabecalho, cabecalhos, mapeamento, avisos, total_rodape, linhas, lista_reconhecida)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20)`,
      [id, tenantId, loteId, ordem, nome.slice(0, 200), bytes.length, chave, planilha.formato, planilha.codificacao, planilha.separador,
        a.nome, JSON.stringify(planilha.abas.map(x => x.nome)), lista, prep.linhaCabecalho, JSON.stringify(prep.cabecalhos),
        JSON.stringify(sugestao.mapeamento), JSON.stringify(prep.avisos), JSON.stringify(prep.totalRodape), dados, reconhecida],
    );
    await gravarLinhas(exec, tenantId, loteId, id, ETAPA_DA_LISTA[lista], prep.linhas);
    await atualizarPeriodo(exec, tenantId, id, lista, sugestao.mapeamento);
    criados.push(id);
  }
  if (!criados.length) throw new ErroMudanca('Não achei nenhuma tabela neste arquivo (cabeçalho e linhas).', 400, 'SEM_DADOS');
  await voltarParaRascunho(exec, tenantId, loteId);
  const out: ArquivoDoLote[] = [];
  for (const id of criados) out.push(await lerArquivo(exec, tenantId, loteId, id));
  return out;
}

/**
 * A lista pelo cabeçalho e, para as contas a pagar e a receber, pelo
 * conteúdo: as contas liquidadas e as em aberto saem da MESMA lista do
 * sistema anterior. Com a maior parte das linhas liquidada, o arquivo é o
 * histórico ("Contas já liquidadas"); senão, as contas em aberto da v1.
 */
export function listaPeloConteudo(cabecalhos: string[], linhas: LinhaPreparada[]): { lista: ListaId; sugestao: ReturnType<typeof sugerirMapeamento> } {
  const r = adivinharLista(cabecalhos);
  if (r.lista !== 'titulos') return r;
  const col = r.sugestao.mapeamento.liquidacao;
  if (col === undefined) return r;
  const dados = linhas.filter(l => l.tipo === 'dado');
  const liquidadas = dados.filter(l => lerData(l.celulas[col]) !== null).length;
  if (dados.length && liquidadas * 2 > dados.length) return { lista: 'liquidados', sugestao: sugerirMapeamento(cabecalhos, 'liquidados') };
  return r;
}

async function gravarLinhas(exec: ExecutorSQL, tenantId: string, loteId: string, arquivoId: string, etapa: number, linhas: LinhaPreparada[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += 1000) {
    const parte = linhas.slice(i, i + 1000).map(l => ({ linha: l.numero, tipo: l.tipo, celulas: l.celulas, agrupamento: l.agrupamento ?? null }));
    await exec.query(
      `INSERT INTO migracao_linhas (tenant_id, lote_id, arquivo_id, linha, tipo, celulas, agrupamento, etapa)
       SELECT $1, $2, $3, x.linha, x.tipo, x.celulas, x.agrupamento, $4
         FROM jsonb_to_recordset($5::jsonb) AS x(linha int, tipo text, celulas jsonb, agrupamento jsonb)`,
      [tenantId, loteId, arquivoId, etapa, JSON.stringify(parte)],
    );
  }
}

/** Menor e maior data da coluna principal (vencimento nos títulos, data nos saldos). */
async function atualizarPeriodo(exec: ExecutorSQL, tenantId: string, arquivoId: string, lista: ListaId, mapeamento: Mapeamento): Promise<void> {
  const campo: string | null = ({
    titulos: 'vencimento', saldos: 'data', liquidados: 'liquidacao', movimentos: 'data', vendas: 'data_venda', faturas: 'vencimento',
    notas: 'emissao', comissoes_pagas: 'data_venda',
  } as Partial<Record<ListaId, string>>)[lista] ?? null;
  const col = campo ? mapeamento[campo] : undefined;
  let periodo: { de: string; ate: string } | null = null;
  if (col !== undefined) {
    const { rows } = await exec.query(
      `SELECT celulas->$3::int AS v FROM migracao_linhas WHERE tenant_id = $1 AND arquivo_id = $2 AND tipo = 'dado'`, [tenantId, arquivoId, col],
    );
    for (const r of rows) {
      const d = lerData(r.v as Celula);
      if (!d) continue;
      if (!periodo) periodo = { de: d, ate: d };
      else { if (d < periodo.de) periodo.de = d; if (d > periodo.ate) periodo.ate = d; }
    }
  }
  await exec.query(`UPDATE migracao_arquivos SET periodo = $3::jsonb WHERE tenant_id = $1 AND id = $2`, [tenantId, arquivoId, periodo ? JSON.stringify(periodo) : null]);
}

/** Troca a lista, o mapeamento, confirma, ou muda o "a pagar/a receber" do arquivo inteiro. */
export async function atualizarArquivo(
  exec: ExecutorSQL, tenantId: string, loteId: string, arquivoId: string,
  entrada: { lista?: unknown; mapeamento?: unknown; confirmar?: unknown; opcoes?: unknown },
): Promise<ArquivoDoLote> {
  const l = await lerLote(exec, tenantId, loteId, true);
  exigirEditavel(l);
  const atual = await lerArquivo(exec, tenantId, loteId, arquivoId);
  let lista = atual.lista;
  let mapeamento = atual.mapeamento;
  if (entrada.lista !== undefined) {
    const nova = txt(entrada.lista) as ListaId;
    if (!definicaoDaLista(nova)) throw new ErroMudanca('Lista desconhecida.', 400, 'LISTA_INVALIDA');
    if (nova !== lista) {
      lista = nova;
      mapeamento = sugerirMapeamento(atual.colunas.map(c => c.cabecalho), lista).mapeamento;
    }
  }
  if (entrada.mapeamento !== undefined) {
    const v = validarMapeamento(lista, entrada.mapeamento, atual.colunas.length);
    if (!v.ok) throw new ErroMudanca(v.erro, 400, 'MAPEAMENTO_INVALIDO');
    mapeamento = v.mapeamento;
  }
  const def = definicaoDaLista(lista)!;
  const confirmar = entrada.confirmar === true;
  if (confirmar) {
    const faltando = camposFaltando(def, mapeamento);
    if (faltando.length) {
      throw new ErroMudanca(`Falta ligar: ${rotuloDosFaltando(lista, faltando).join(', ')}.`, 400, 'FALTA_COLUNA');
    }
  }
  let opcoes = atual.opcoes;
  if (entrada.opcoes !== undefined) {
    const o = (entrada.opcoes ?? {}) as Record<string, unknown>;
    const mov = o.movimento === 'pagar' || o.movimento === 'receber' ? o.movimento : null;
    opcoes = { ...opcoes, movimento: mov };
  }
  const mudouAlgo = lista !== atual.lista || JSON.stringify(mapeamento) !== JSON.stringify(atual.mapeamento) || JSON.stringify(opcoes) !== JSON.stringify(atual.opcoes);
  await exec.query(
    `UPDATE migracao_arquivos SET lista = $4, mapeamento = $5::jsonb, opcoes = $6::jsonb,
            mapeamento_confirmado = CASE WHEN $7 THEN true WHEN $8 THEN false ELSE mapeamento_confirmado END,
            lista_reconhecida = CASE WHEN $9 THEN true ELSE lista_reconhecida END
      WHERE tenant_id = $1 AND lote_id = $2 AND id = $3`,
    [tenantId, loteId, arquivoId, lista, JSON.stringify(mapeamento), JSON.stringify(opcoes), confirmar, mudouAlgo, entrada.lista !== undefined],
  );
  if (mudouAlgo) await atualizarPeriodo(exec, tenantId, arquivoId, lista, mapeamento);
  if (lista !== atual.lista) {
    await exec.query(`UPDATE migracao_linhas SET etapa = $3 WHERE tenant_id = $1 AND arquivo_id = $2`, [tenantId, arquivoId, ETAPA_DA_LISTA[lista]]);
  }
  if (mudouAlgo || confirmar) await voltarParaRascunho(exec, tenantId, loteId);
  return lerArquivo(exec, tenantId, loteId, arquivoId);
}

export async function removerArquivo(exec: ExecutorSQL, tenantId: string, loteId: string, arquivoId: string): Promise<void> {
  const l = await lerLote(exec, tenantId, loteId, true);
  exigirEditavel(l);
  await exec.query(`DELETE FROM migracao_linhas WHERE tenant_id = $1 AND lote_id = $2 AND arquivo_id = $3`, [tenantId, loteId, arquivoId]);
  const { rowCount } = await exec.query(`DELETE FROM migracao_arquivos WHERE tenant_id = $1 AND lote_id = $2 AND id = $3`, [tenantId, loteId, arquivoId]);
  if (!rowCount) throw new ErroMudanca('Arquivo não encontrado nesta mudança.', 404, 'NAO_ENCONTRADO');
  await voltarParaRascunho(exec, tenantId, loteId);
}

// ---------------------------------------------------------------------------
// Índice dos cadastros da agência

const SALDO_SQL = (alias: string) => `ROUND((CASE WHEN ${alias}.data->>'saldo_atual' ~ '^-?[0-9]+([.][0-9]+)?$'
  THEN (${alias}.data->>'saldo_atual')::numeric ELSE 0 END) * 100)::bigint`;

function nomeDoCliente(d: Record<string, unknown>, coluna: unknown): string {
  return texto(d.nome_completo) || texto(d.nome_fantasia) || texto(d.razao_social) || texto(d.nome) || texto(coluna);
}

/** Monta o índice do que a agência já tem (e do que este lote já criou, marcado doLote). */
export async function carregarIndice(exec: ExecutorSQL, tenantId: string, loteId: string | null): Promise<IndiceDeCadastros> {
  const indice = indiceVazio();
  const doLote = new Set<string>();
  if (loteId) {
    const { rows } = await exec.query(
      `SELECT tabela, registro_id FROM migracao_vinculos WHERE tenant_id = $1 AND lote_id = $2 AND acao = 'criado'`, [tenantId, loteId],
    );
    for (const r of rows) doLote.add(`${txt(r.tabela)}:${txt(r.registro_id)}`);
  }
  const { rows: cli } = await exec.query(`SELECT id, nome, cpf_cnpj, data FROM clientes WHERE tenant_id = $1`, [tenantId]);
  for (const r of cli) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    indice.pessoas.push({
      id: txt(r.id), papel: 'cliente', nome: nomeDoCliente(d, r.nome), razao_social: texto(d.razao_social),
      documento: documentoComparavel(r.cpf_cnpj) || documentoComparavel(d.cpf) || documentoComparavel(d.cnpj) || documentoComparavel(d.cpf_cnpj),
      email: texto(d.email), telefones: [d.telefone_principal, d.whatsapp, d.telefone_secundario, d.telefone].map(texto).filter(Boolean),
      doLote: doLote.has(`clientes:${txt(r.id)}`),
    });
  }
  const { rows: forn } = await exec.query(`SELECT id, nome_fantasia, cnpj, data FROM fornecedores_crm WHERE tenant_id = $1`, [tenantId]);
  for (const r of forn) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    indice.pessoas.push({
      id: txt(r.id), papel: 'fornecedor',
      nome: nomeDoFornecedor({ nome_fantasia: texto(d.nome_fantasia) || texto(r.nome_fantasia), razao_social: texto(d.razao_social) }),
      razao_social: texto(d.razao_social), documento: documentoComparavel(r.cnpj) || documentoComparavel(d.cnpj),
      email: texto(d.email), telefones: [d.telefone, d.whatsapp].map(texto).filter(Boolean),
      doLote: doLote.has(`fornecedores_crm:${txt(r.id)}`),
    });
  }
  const { rows: cats } = await exec.query(`SELECT id, codigo, descricao, tipo, data FROM plano_contas WHERE tenant_id = $1`, [tenantId]);
  for (const r of cats) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const tipo = (texto(d.tipo) || texto(r.tipo)).toUpperCase();
    if (tipo !== 'RECEITA' && tipo !== 'DESPESA') continue;
    indice.categorias.push({
      id: txt(r.id), nome: texto(d.nome) || texto(r.descricao), tipo, pai_id: texto(d.categoria_pai_id) || null,
      codigo: texto(d.codigo) || texto(r.codigo), doLote: doLote.has(`plano_contas:${txt(r.id)}`),
    });
  }
  const { rows: centros } = await exec.query(`SELECT id, nome, data FROM centros_custo WHERE tenant_id = $1`, [tenantId]);
  for (const r of centros) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    indice.centros.push({ id: txt(r.id), nome: texto(r.nome) || texto(d.nome), doLote: doLote.has(`centros_custo:${txt(r.id)}`) });
  }
  const { rows: contas } = await exec.query(
    `SELECT c.id, c.data, ${SALDO_SQL('c')} AS saldo,
            EXISTS (SELECT 1 FROM contas_receber r WHERE r.tenant_id = c.tenant_id AND r.data->>'conta_bancaria_id' = c.id
                      AND COALESCE(r.data->>'status','') IN ('RECEBIDO','PARCIAL'))
         OR EXISTS (SELECT 1 FROM contas_pagar p WHERE p.tenant_id = c.tenant_id AND p.data->>'conta_bancaria_id' = c.id
                      AND COALESCE(p.data->>'status','') IN ('PAGO','PARCIAL')) AS baixas
       FROM contas_bancarias c WHERE c.tenant_id = $1`,
    [tenantId],
  );
  for (const r of contas) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    indice.contas.push({
      id: txt(r.id), nome: texto(d.nome), banco: texto(d.banco), agencia: texto(d.agencia), numero: texto(d.conta),
      temMovimento: Number(r.saldo ?? 0) !== 0 || paraCentavos(num(d.saldo_inicial)) !== 0 || Boolean(r.baixas),
      doLote: doLote.has(`contas_bancarias:${txt(r.id)}`),
    });
  }
  for (const [tabela, coluna] of [['contas_receber', 'cliente_id'], ['contas_pagar', 'fornecedor_id']] as const) {
    const fim = tabela === 'contas_receber' ? `('RECEBIDO','CANCELADO')` : `('PAGO','CANCELADO')`;
    const { rows } = await exec.query(
      `SELECT id, COALESCE(NULLIF(${coluna}, ''), data->>'${coluna}', '') AS pessoa, data->>'data_vencimento' AS venc,
              data->>'valor_final' AS valor, COALESCE(data->>'numero_documento', '') AS doc
         FROM ${tabela} WHERE tenant_id = $1 AND COALESCE(data->>'status', '') NOT IN ${fim}`,
      [tenantId],
    );
    for (const r of rows) {
      indice.titulos.push({
        id: txt(r.id), tabela, pessoa_id: txt(r.pessoa), vencimento: txt(r.venc).slice(0, 10),
        valor: paraCentavos(num(r.valor)), documento: txt(r.doc),
      });
    }
  }
  const { rows: chaves } = await exec.query(
    `SELECT v.chave, l.criado_em, l.nome FROM migracao_vinculos v JOIN migracao_lotes l ON l.id = v.lote_id
      WHERE v.tenant_id = $1 AND v.chave IS NOT NULL AND NOT v.desfeito AND v.lote_id <> $2
        AND v.tabela IN ('contas_pagar','contas_receber')`,
    [tenantId, loteId ?? ''],
  );
  for (const r of chaves) {
    const quando = r.criado_em ? dataBR(new Date(r.criado_em as string).toISOString()) : '';
    indice.chavesImportadas.set(txt(r.chave), `"${txt(r.nome)}"${quando ? ` de ${quando}` : ''}`);
  }
  await carregarIndiceDoHistorico(exec, tenantId, loteId, indice);
  return indice;
}

async function existeTabela(exec: ExecutorSQL, nome: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${nome}`]);
  return Boolean(rows[0]?.ok);
}

/** O que o histórico (E7) precisa saber: vendas e registros trazidos, funções, baixas e os títulos deste lote. */
async function carregarIndiceDoHistorico(exec: ExecutorSQL, tenantId: string, loteId: string | null, indice: IndiceDeCadastros): Promise<void> {
  const doLote = new Map<string, Record<string, unknown>>();
  if (loteId) {
    const { rows } = await exec.query(
      `SELECT tabela, registro_id, acao, dados FROM migracao_vinculos WHERE tenant_id = $1 AND lote_id = $2 AND NOT desfeito`, [tenantId, loteId],
    );
    for (const r of rows) doLote.set(`${txt(r.tabela)}:${txt(r.registro_id)}:${txt(r.acao)}`, (r.dados ?? {}) as Record<string, unknown>);
  }
  // Vendas trazidas (de qualquer mudança): pelo número que tinham lá.
  const { rows: vendas } = await exec.query(
    `SELECT id, data->>'numero_anterior' AS n FROM vendas_crm WHERE tenant_id = $1 AND COALESCE(data->>'numero_anterior', '') <> ''`, [tenantId],
  );
  for (const r of vendas) indice.vendas.push({ id: txt(r.id), numero_anterior: txt(r.n), doLote: doLote.has(`vendas_crm:${txt(r.id)}:criado`) });
  // Registros do histórico já trazidos por OUTRA mudança: a mesma linha não entra duas vezes.
  const { rows: chaves } = await exec.query(
    `SELECT v.chave, l.nome FROM migracao_vinculos v JOIN migracao_lotes l ON l.id = v.lote_id
      WHERE v.tenant_id = $1 AND v.chave IS NOT NULL AND NOT v.desfeito AND v.lote_id <> $2`,
    [tenantId, loteId ?? ''],
  );
  for (const r of chaves) indice.registros.set(txt(r.chave), `"${txt(r.nome)}"`);
  // Pessoas nas funções de comissão (metas).
  if (await existeTabela(exec, 'comissao_pessoas')) {
    const { rows } = await exec.query(
      `SELECT p.id, p.pessoa_nome, COALESCE(f.nome, '') AS funcao FROM comissao_pessoas p
         LEFT JOIN comissao_funcoes f ON f.tenant_id = p.tenant_id AND f.id = p.funcao_id WHERE p.tenant_id = $1`, [tenantId],
    );
    for (const r of rows) indice.pessoasFuncao.push({ id: txt(r.id), pessoa_nome: txt(r.pessoa_nome), funcao_nome: txt(r.funcao) });
  }
  // Baixas que movimentaram dinheiro (sem as estornadas): o extrato se liga a elas.
  if (await existeTabela(exec, 'baixas')) {
    const { rows } = await exec.query(
      `SELECT b.id, COALESCE(b.conta_bancaria_id, '') AS conta, b.data_baixa::text AS data, b.caixa_centavos, b.titulo_tabela, b.titulo_id,
              COALESCE(NULLIF(r.cliente_id, ''), r.data->>'cliente_id', NULLIF(p.fornecedor_id, ''), p.data->>'fornecedor_id', '') AS pessoa
         FROM baixas b
         LEFT JOIN contas_receber r ON b.titulo_tabela = 'contas_receber' AND r.tenant_id = b.tenant_id AND r.id = b.titulo_id
         LEFT JOIN contas_pagar p ON b.titulo_tabela = 'contas_pagar' AND p.tenant_id = b.tenant_id AND p.id = b.titulo_id
        WHERE b.tenant_id = $1 AND b.tipo = 'baixa'
          AND NOT EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = b.tenant_id AND e.estorna_baixa_id = b.id)`,
      [tenantId],
    );
    for (const r of rows) {
      const id = txt(r.id);
      indice.baixas.push({
        id, conta_id: txt(r.conta), data: txt(r.data).slice(0, 10), valor: Math.abs(Number(r.caixa_centavos ?? 0)),
        entrada: txt(r.titulo_tabela) === 'contas_receber', pessoa_id: txt(r.pessoa), titulo_id: txt(r.titulo_id),
        doLote: doLote.has(`baixas:${id}:historico`), ligada: doLote.has(`baixas:${id}:vinculado`),
      });
    }
  }
  // Títulos que este lote criou (para ligar à venda e ao reembolso).
  if (loteId) {
    for (const tabela of ['contas_receber', 'contas_pagar'] as const) {
      const ids = [...doLote.keys()].filter(k => k.startsWith(`${tabela}:`) && k.endsWith(':criado')).map(k => k.split(':')[1]);
      if (!ids.length) continue;
      const { rows } = await exec.query(`SELECT id, data FROM ${tabela} WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]);
      for (const r of rows) {
        const d = (r.data ?? {}) as Record<string, unknown>;
        const om = (d.origem_migracao ?? {}) as Record<string, unknown>;
        indice.titulosDoLote.push({
          tabela, id: txt(r.id), pessoa_id: txt(tabela === 'contas_receber' ? d.cliente_id : d.fornecedor_id), valor: paraCentavos(num(d.valor_final)),
          venda: txt(om.venda), liquidado: ['RECEBIDO', 'PAGO', 'PARCIAL'].includes(txt(d.status)), reembolso: Boolean(d.reembolso_id),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ensaio

interface ItemDoPlano {
  arquivo: ArquivoDoLote;
  linha: number;
  etapa: number;
  interp: Interpretacao | null;
  /** Resultado direto (linha que não é dado ou arquivo sem coluna obrigatória). */
  fixo?: Decisao;
  enriq: Enriquecimento;
}

function chavesDaPessoa(nome: string, razao: string, doc: string): string[] {
  return [doc ? `d:${doc}` : '', nome ? `n:${nomeComparavel(nome)}` : '', razao ? `n:${nomeComparavel(razao)}` : ''].filter(k => k && k !== 'n:');
}

/** Lê as linhas do lote, interpreta e enriquece (papéis das pessoas, saldo das contas). */
async function montarItens(exec: ExecutorSQL, tenantId: string, lote: Lote, arquivos: ArquivoDoLote[]): Promise<ItemDoPlano[]> {
  const itens: ItemDoPlano[] = [];
  const ordenados = [...arquivos].sort((a, b) => ETAPA_DA_LISTA[a.lista] - ETAPA_DA_LISTA[b.lista] || a.ordem - b.ordem);
  for (const arq of ordenados) {
    const { rows } = await exec.query(
      `SELECT linha, tipo, celulas, agrupamento FROM migracao_linhas WHERE tenant_id = $1 AND arquivo_id = $2 ORDER BY linha`,
      [tenantId, arq.id],
    );
    const preparadas: LinhaPreparada[] = rows.map(r => ({
      numero: Number(r.linha), tipo: txt(r.tipo) as LinhaPreparada['tipo'], celulas: (r.celulas ?? []) as Celula[],
      ...(r.agrupamento ? { agrupamento: r.agrupamento as { rotulo: string; valor: string } } : {}),
    }));
    const etapa = ETAPA_DA_LISTA[arq.lista];
    const def = definicaoDaLista(arq.lista)!;
    const faltando = camposFaltando(def, arq.mapeamento);
    if (faltando.length) {
      const motivo = `O arquivo não tem a coluna ${rotuloDosFaltando(arq.lista, faltando).join(', ')} ligada.`;
      for (const p of preparadas) {
        itens.push({
          arquivo: arq, linha: p.numero, etapa, interp: null, enriq: {},
          fixo: { resultado: p.tipo === 'dado' ? 'recusar' : 'ignorar', codigo: p.tipo === 'dado' ? 'falta_coluna' : p.tipo === 'total' ? 'linha_de_total' : 'linha_de_agrupamento', motivo, avisos: [], alvo_tabela: null, alvo_id: null, chave: null },
        });
      }
      continue;
    }
    const interpretadas = interpretarLinhas(arq.lista, preparadas, arq.mapeamento, {
      dataCorte: lote.data_corte, movimento: arq.opcoes.movimento ?? null, empresas: lote.opcoes.empresas ?? [],
    });
    for (const li of interpretadas) {
      const ignorar = li.tipo !== 'dado';
      itens.push({
        arquivo: arq, linha: li.numero, etapa, interp: li.resultado, enriq: {},
        ...(li.resultado.ok ? {} : {
          fixo: {
            resultado: ignorar ? 'ignorar' : 'recusar', codigo: li.resultado.codigo, motivo: li.resultado.motivo,
            avisos: [], alvo_tabela: null, alvo_id: null, chave: null,
          } as Decisao,
        }),
      });
    }
  }
  // Vendas por produto (E7): as linhas com o mesmo Venda Nº formam UMA venda,
  // montada na primeira delas (na ordem dos arquivos e das linhas).
  const linhasDeVenda: Array<{ linha: number; dados: ProdutoVendidoLido; it: ItemDoPlano }> = [];
  for (const it of itens) {
    if (it.interp?.ok && it.interp.registro.lista === 'vendas') linhasDeVenda.push({ linha: it.linha, dados: it.interp.registro.dados, it });
  }
  if (linhasDeVenda.length) {
    const vendas = agruparVendas(linhasDeVenda);
    const cabeca = new Set<string>();
    for (const l of linhasDeVenda) {
      const chave = normalizar(l.dados.venda);
      if (cabeca.has(chave)) continue;
      cabeca.add(chave);
      const reg = (l.it.interp as { ok: true; registro: RegistroLido }).registro;
      if (reg.lista === 'vendas') reg.venda = vendas.get(chave);
    }
  }
  // Papéis pelo uso: quem aparece a receber é cliente; a pagar, fornecedor.
  const uso = new Map<string, Set<PapelSimples>>();
  const contasComSaldo = new Set<string>();
  for (const it of itens) {
    if (!it.interp?.ok) continue;
    const r = it.interp.registro;
    if (r.lista === 'titulos' || r.lista === 'liquidados') {
      const papel: PapelSimples = r.dados.movimento === 'receber' ? 'cliente' : 'fornecedor';
      for (const k of chavesDaPessoa(r.dados.pessoa, r.dados.razao_social, r.dados.documento_pessoa)) {
        const s = uso.get(k) ?? new Set<PapelSimples>();
        s.add(papel);
        uso.set(k, s);
      }
    }
    if (r.lista === 'saldos') contasComSaldo.add(normalizar(r.dados.conta));
  }
  const padrao = lote.opcoes.papel_padrao ?? 'cliente';
  for (const it of itens) {
    if (!it.interp?.ok) continue;
    const r = it.interp.registro;
    if (r.lista === 'pessoas') {
      const d = r.dados;
      let papeis: PapelSimples[];
      if (d.papel) papeis = d.papel === 'ambos' ? ['cliente', 'fornecedor'] : [d.papel];
      else {
        const s = new Set<PapelSimples>();
        for (const k of chavesDaPessoa(d.nome, d.razao_social, d.documento)) for (const p of uso.get(k) ?? []) s.add(p);
        papeis = s.size ? (['cliente', 'fornecedor'] as const).filter(p => s.has(p)) : padrao === 'ambos' ? ['cliente', 'fornecedor'] : [padrao];
      }
      it.enriq = { papeis };
    }
    if (r.lista === 'contas') {
      it.enriq = { usar_saldo: !(contasComSaldo.has(normalizar(r.dados.nome)) || (r.dados.numero && contasComSaldo.has(normalizar(r.dados.numero)))) };
    }
  }
  return itens;
}

function origemDe(lote: Lote, it: { arquivo: { id: string; nome: string }; linha: number; etapa: number }): OrigemDaLinha {
  return { lote_id: lote.id, arquivo_id: it.arquivo.id, arquivo: it.arquivo.nome, linha: it.linha, etapa: it.etapa };
}

function contagemVazia(): ContagemDoResultado { return { linhas: 0, criar: 0, vincular: 0, recusar: 0, ignorar: 0 }; }

function assinar(lote: Lote, arquivos: ArquivoDoLote[], resumo: ResumoDoEnsaio, quando: string): string {
  const base = {
    lote: lote.id, corte: lote.data_corte, opcoes: lote.opcoes, quando,
    arquivos: arquivos.map(a => ({ id: a.id, lista: a.lista, mapeamento: a.mapeamento, opcoes: a.opcoes, confirmado: a.mapeamento_confirmado })),
    total: resumo.total,
  };
  return createHash('sha256').update(JSON.stringify(base)).digest('hex').slice(0, 32);
}

/**
 * Ensaio: lê, mapeia, identifica e decide cada linha SEM gravar nada nas
 * tabelas do financeiro. O resultado fica nas linhas do lote (para a tela
 * filtrar) e o resumo, no lote. Roda numa transação.
 */
export async function ensaiarLote(exec: ExecutorSQL, tenantId: string, loteId: string): Promise<{ lote: Lote; resumo: ResumoDoEnsaio; assinatura: string }> {
  const lote = await lerLote(exec, tenantId, loteId, true);
  exigirEditavel(lote);
  if (ehParalelo(lote)) throw new ErroMudanca('Este é um mês em paralelo: ele só compara, não grava. Use "Comparar".', 409, 'LOTE_DE_COMPARACAO');
  const arquivos = await listarArquivos(exec, tenantId, loteId);
  if (!arquivos.length) throw new ErroMudanca('Solte pelo menos um arquivo antes do ensaio.', 400, 'SEM_ARQUIVOS');
  const itens = await montarItens(exec, tenantId, lote, arquivos);
  const indice = await carregarIndice(exec, tenantId, null);
  const ctx: ContextoDoPlano = { dataCorte: lote.data_corte, chavesDoLote: new Map(), saldosDoLote: new Set() };
  const g = gravadorDeEnsaio();
  const pessoasAntes = indice.pessoas.length;
  let pessoasDaLista = 0;

  const resumo: ResumoDoEnsaio = {
    por_lista: {}, total: contagemVazia(), motivos: [],
    titulos: { pagar: { quantidade: 0, centavos: 0 }, receber: { quantidade: 0, centavos: 0 } },
    saldos: { contas: 0, centavos: 0 }, pessoas_novas_dos_titulos: 0, problemas: [], avisos: [], pode_aplicar: false,
    historico: resumoDoHistoricoVazio(),
  };
  const h = resumo.historico!;
  const motivos = new Map<string, number>();
  const atualizacoes: Array<Record<string, unknown>> = [];

  await comNadaSai('ensaio da mudança', async () => {
    for (const it of itens) {
      let d: Decisao;
      let dados: Record<string, unknown> | null = null;
      if (it.fixo) d = it.fixo;
      else {
        const registro = (it.interp as { ok: true; registro: RegistroLido; avisos: string[] }).registro;
        const antes = indice.pessoas.length;
        try {
          d = await processarRegistro(registro, it.enriq, indice, ctx, g, origemDe(lote, it));
        } catch (e) {
          d = { resultado: 'recusar', codigo: 'erro', motivo: e instanceof Error ? e.message : String(e), avisos: [], alvo_tabela: null, alvo_id: null, chave: null };
        }
        d.avisos = [...((it.interp as { avisos: string[] }).avisos ?? []), ...d.avisos];
        if (registro.lista === 'pessoas') pessoasDaLista += indice.pessoas.length - antes;
        dados = { registro, enriq: it.enriq };
        if (d.resultado !== 'recusar') {
          if (registro.lista === 'titulos') {
            const t = resumo.titulos[registro.dados.movimento];
            t.quantidade += 1; t.centavos += registro.dados.valor;
          }
          if (registro.lista === 'liquidados' && d.resultado === 'criar') { h.liquidados.quantidade += 1; h.liquidados.centavos += registro.dados.baixa.valor; }
          if (registro.lista === 'movimentos') { h.movimentos[d.resultado === 'criar' ? 'criar' : 'vincular'] += 1; if (d.resultado === 'criar') h.movimentos.centavos += registro.dados.valor; }
          if (registro.lista === 'vendas' && d.resultado === 'criar' && registro.venda) {
            h.vendas.quantidade += 1; h.vendas.produtos += registro.venda.produtos.length;
            h.vendas.centavos += registro.venda.produtos.reduce((a, p) => a + (p.valor_total ?? 0), 0);
          }
          if ((registro.lista === 'faturas' || registro.lista === 'notas' || registro.lista === 'comissoes_pagas') && d.resultado === 'criar') h.registros[registro.lista] += 1;
          if (registro.lista === 'metas' && d.resultado === 'criar') h.metas += 1;
          if (registro.lista === 'reembolsos' && d.resultado === 'criar') { h.reembolsos.quantidade += 1; h.reembolsos.centavos += registro.dados.valor; }
          if (registro.lista === 'creditos' && d.resultado === 'criar') { h.creditos.quantidade += 1; h.creditos.centavos += registro.dados.saldo; }
          if (registro.lista === 'saldos' || (registro.lista === 'contas' && registro.dados.saldo !== null && /Saldo de abertura/.test(d.motivo))) {
            resumo.saldos.contas += 1;
            resumo.saldos.centavos += registro.lista === 'saldos' ? registro.dados.saldo : (registro.dados.saldo ?? 0);
          }
        }
      }
      const lista = it.arquivo.lista;
      const c = (resumo.por_lista[lista] ??= contagemVazia());
      for (const alvo of [c, resumo.total]) { alvo.linhas += 1; alvo[d.resultado] += 1; }
      if (d.codigo && (d.resultado === 'recusar' || d.resultado === 'ignorar')) motivos.set(d.codigo, (motivos.get(d.codigo) ?? 0) + 1);
      atualizacoes.push({
        arquivo_id: it.arquivo.id, linha: it.linha, etapa: it.etapa, resultado: d.resultado, codigo: d.codigo, motivo: d.motivo,
        avisos: d.avisos, dados, chave: d.chave, alvo_tabela: d.alvo_tabela,
        alvo_id: d.alvo_id && !d.alvo_id.startsWith('novo:') ? d.alvo_id : null,
      });
    }
  });
  resumo.pessoas_novas_dos_titulos = Math.max(0, indice.pessoas.length - pessoasAntes - pessoasDaLista);
  resumo.motivos = [...motivos.entries()].map(([codigo, quantidade]) => ({ codigo, rotulo: rotuloDoCodigo(codigo), quantidade })).sort((a, b) => b.quantidade - a.quantidade);

  for (const a of arquivos) {
    for (const av of a.avisos) resumo.avisos.push({ codigo: av.codigo, mensagem: `${a.nome}: ${av.mensagem}`, arquivo_id: a.id });
    if (!a.lista_reconhecida) resumo.problemas.push({ codigo: 'LISTA_NAO_RECONHECIDA', mensagem: `Diga de qual lista é "${a.nome}".`, arquivo_id: a.id });
    if (!a.mapeamento_confirmado) resumo.problemas.push({ codigo: 'MAPEAMENTO_NAO_CONFIRMADO', mensagem: `Confira e confirme as colunas de "${a.nome}".`, arquivo_id: a.id });
    if (a.faltando.length) resumo.problemas.push({ codigo: 'FALTA_COLUNA', mensagem: `"${a.nome}": falta ligar ${a.faltando.join(', ')}.`, arquivo_id: a.id });
    if (a.avisos.some(x => x.codigo === 'lista_cortada')) {
      resumo.problemas.push({ codigo: 'LISTA_CORTADA', mensagem: `"${a.nome}" veio cortada pelo sistema anterior. Exporte em partes menores e troque este arquivo.`, arquivo_id: a.id });
    }
  }
  const temSaldo = itens.some(it => it.interp?.ok && (it.interp.registro.lista === 'saldos' || (it.interp.registro.lista === 'contas' && it.interp.registro.dados.saldo !== null)));
  if (temSaldo && !lote.data_corte) resumo.problemas.push({ codigo: 'SEM_DATA_CORTE', mensagem: 'Informe a data de corte: é nela que os saldos das contas valem.' });
  const temHistorico = itens.some(it => it.interp?.ok && (it.interp.registro.lista === 'liquidados' || it.interp.registro.lista === 'movimentos'));
  if (temHistorico && !lote.data_corte && !resumo.problemas.some(p => p.codigo === 'SEM_DATA_CORTE')) {
    resumo.problemas.push({ codigo: 'SEM_DATA_CORTE', mensagem: 'Informe a data de corte: o histórico liquidado é o que aconteceu até ela.' });
  }
  resumo.pode_aplicar = resumo.problemas.length === 0 && resumo.total.criar + resumo.total.vincular > 0;

  for (let i = 0; i < atualizacoes.length; i += 500) {
    await exec.query(
      `UPDATE migracao_linhas m SET etapa = x.etapa, resultado = x.resultado, codigo = x.codigo, motivo = x.motivo, avisos = COALESCE(x.avisos, '[]'::jsonb),
              dados = x.dados, chave = x.chave, alvo_tabela = x.alvo_tabela, alvo_id = x.alvo_id, aplicada = false, aplicada_em = NULL
         FROM jsonb_to_recordset($3::jsonb) AS x(arquivo_id text, linha int, etapa int, resultado text, codigo text, motivo text,
                                                 avisos jsonb, dados jsonb, chave text, alvo_tabela text, alvo_id text)
        WHERE m.tenant_id = $1 AND m.lote_id = $2 AND m.arquivo_id = x.arquivo_id AND m.linha = x.linha`,
      [tenantId, loteId, JSON.stringify(atualizacoes.slice(i, i + 500))],
    );
  }
  const { rows: agora } = await exec.query(`SELECT NOW() AS t`);
  const quando = iso(agora[0]?.t) ?? new Date().toISOString();
  const assinatura = assinar(lote, arquivos, resumo, quando);
  await exec.query(
    `UPDATE migracao_lotes SET status = 'ensaiado', resumo = $3::jsonb, assinatura = $4, ensaiado_em = $5::timestamptz, atualizado_em = NOW(),
            versao_do_ensaio = versao,
            progresso = jsonb_build_object('total', $6::int, 'feitas', 0)
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, loteId, JSON.stringify(resumo), assinatura, quando, resumo.total.criar + resumo.total.vincular],
  );
  return { lote: await lerLote(exec, tenantId, loteId), resumo, assinatura };
}

// ---------------------------------------------------------------------------
// Linhas (para a tela do ensaio)

export interface LinhaDoLote {
  arquivo_id: string;
  arquivo: string;
  lista: ListaId;
  linha: number;
  tipo: string;
  resultado: string;
  codigo: string | null;
  motivo: string;
  avisos: string[];
  /** Campo → texto da célula, como veio. */
  valores: Record<string, string>;
  alvo_tabela: string | null;
  alvo_id: string | null;
  aplicada: boolean;
  /** O registro já lido (datas, valores) quando a linha foi interpretada. */
  registro?: RegistroLido;
}

export async function listarLinhas(
  exec: ExecutorSQL, tenantId: string, loteId: string,
  filtro: { resultado?: string; lista?: string; arquivo?: string; codigo?: string; busca?: string; pagina?: number; por_pagina?: number; sem_ignoradas?: boolean },
): Promise<{ linhas: LinhaDoLote[]; total: number; pagina: number; por_pagina: number; contagem: Record<string, number> }> {
  await lerLote(exec, tenantId, loteId);
  const pagina = Math.max(1, Math.floor(Number(filtro.pagina) || 1));
  const porPagina = Math.min(500, Math.max(1, Math.floor(Number(filtro.por_pagina) || 100)));
  const conds = ['m.tenant_id = $1', 'm.lote_id = $2'];
  const args: unknown[] = [tenantId, loteId];
  const add = (sql: string, v: unknown) => { args.push(v); conds.push(sql.replace('?', `$${args.length}`)); };
  if (filtro.lista) add('a.lista = ?', filtro.lista);
  if (filtro.arquivo) add('m.arquivo_id = ?', filtro.arquivo);
  if (filtro.codigo) add('m.codigo = ?', filtro.codigo);
  if (filtro.sem_ignoradas) conds.push(`m.resultado <> 'ignorar'`);
  if (filtro.busca) {
    args.push(`%${filtro.busca.replace(/[%_\\]/g, '')}%`);
    conds.push(`(m.celulas::text ILIKE $${args.length} OR COALESCE(m.motivo, '') ILIKE $${args.length})`);
  }
  const base = `FROM migracao_linhas m JOIN migracao_arquivos a ON a.id = m.arquivo_id WHERE ${conds.join(' AND ')}`;
  const { rows: cont } = await exec.query(`SELECT m.resultado, COUNT(*)::int AS n ${base} GROUP BY m.resultado`, args);
  const contagem: Record<string, number> = {};
  for (const r of cont) contagem[txt(r.resultado)] = Number(r.n);
  const argsPag = [...args];
  let where = base;
  if (filtro.resultado) { argsPag.push(filtro.resultado); where += ` AND m.resultado = $${argsPag.length}`; }
  const { rows: tot } = await exec.query(`SELECT COUNT(*)::int AS n ${where}`, argsPag);
  argsPag.push(porPagina, (pagina - 1) * porPagina);
  const { rows } = await exec.query(
    `SELECT m.*, a.nome AS arquivo_nome, a.lista, a.mapeamento ${where}
      ORDER BY m.etapa, a.ordem, m.linha LIMIT $${argsPag.length - 1} OFFSET $${argsPag.length}`,
    argsPag,
  );
  const linhas = rows.map(r => {
    const map = (r.mapeamento ?? {}) as Mapeamento;
    const cel = (r.celulas ?? []) as Celula[];
    const valores: Record<string, string> = {};
    for (const [campo, i] of Object.entries(map)) valores[campo] = texto(cel[Number(i)]);
    return {
      arquivo_id: txt(r.arquivo_id), arquivo: txt(r.arquivo_nome), lista: txt(r.lista) as ListaId, linha: Number(r.linha), tipo: txt(r.tipo),
      resultado: txt(r.resultado), codigo: r.codigo == null ? null : txt(r.codigo), motivo: txt(r.motivo),
      avisos: (Array.isArray(r.avisos) ? r.avisos : []) as string[], valores,
      alvo_tabela: r.alvo_tabela == null ? null : txt(r.alvo_tabela), alvo_id: r.alvo_id == null ? null : txt(r.alvo_id), aplicada: Boolean(r.aplicada),
      ...((r.dados as { registro?: RegistroLido } | null)?.registro ? { registro: (r.dados as { registro: RegistroLido }).registro } : {}),
    };
  });
  return { linhas, total: Number(tot[0]?.n ?? 0), pagina, por_pagina: porPagina, contagem };
}

// ---------------------------------------------------------------------------
// Aplicação

const TABELAS_GRAVAVEIS = new Set([
  'contas_bancarias', 'plano_contas', 'centros_custo', 'clientes', 'fornecedores_crm', 'contas_pagar', 'contas_receber',
  // Histórico (E7)
  'baixas', 'vendas_crm', 'migracao_historico', 'comissao_metas', 'reembolsos', 'creditos_cliente',
]);
/** Tabelas com a coluna `data` (JSONB): o retrato é o md5 dela. As outras guardam o estado em `dados` do vínculo. */
const TABELAS_COM_RETRATO = new Set(['contas_bancarias', 'plano_contas', 'centros_custo', 'clientes', 'fornecedores_crm', 'contas_pagar', 'contas_receber', 'vendas_crm']);

function origemParaGravar(o: OrigemDaLinha) {
  return { lote_id: o.lote_id, arquivo_id: o.arquivo_id, arquivo: o.arquivo, linha: o.linha };
}

/** Gravador de verdade: grava no financeiro e guarda o vínculo (com o retrato) de cada registro. */
export function gravadorDoBanco(exec: ExecutorSQL, tenantId: string, dataCorte: string | null): Gravador {
  const vinculo = async (tabela: string, id: string, acao: AcaoDoVinculo, o: OrigemDaLinha, chave?: string | null, dados?: Record<string, unknown>) => {
    if (!TABELAS_GRAVAVEIS.has(tabela)) throw new Error(`tabela inesperada: ${tabela}`);
    const hash = TABELAS_COM_RETRATO.has(tabela) ? `(SELECT md5(data::text) FROM ${tabela} WHERE tenant_id = $1 AND id = $5)` : 'NULL';
    await exec.query(
      `INSERT INTO migracao_vinculos (tenant_id, lote_id, etapa, tabela, registro_id, acao, arquivo_id, linha, chave, hash, dados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${hash}, $10::jsonb)
       ON CONFLICT (lote_id, tabela, registro_id, acao) DO NOTHING`,
      [tenantId, o.lote_id, o.etapa, tabela, id, acao, o.arquivo_id, o.linha, chave ?? null, JSON.stringify(dados ?? {})],
    );
  };
  const retrato = async (tabela: string, id: string, loteId: string) => {
    if (!TABELAS_COM_RETRATO.has(tabela)) return;
    await exec.query(
      `UPDATE migracao_vinculos SET hash = (SELECT md5(data::text) FROM ${tabela} WHERE tenant_id = $1 AND id = $3)
        WHERE tenant_id = $1 AND lote_id = $2 AND tabela = '${tabela}' AND registro_id = $3 AND acao IN ('criado', 'saldo')`,
      [tenantId, loteId, id],
    );
  };
  return {
    simulado: false,
    ...gravadorDoHistorico(exec, tenantId, vinculo, retrato, origemParaGravar),
    async criarConta(d, o) {
      const id = randomUUID();
      const data = {
        id, nome: d.nome, tipo: d.tipo, banco: d.banco, agencia: d.agencia, conta: d.numero,
        saldo_inicial: 0, saldo_atual: 0, limite: 0, dia_fechamento: d.dia_fechamento, dia_vencimento: d.dia_vencimento,
        ativo: d.ativa, origem_migracao: origemParaGravar(o),
      };
      await exec.query(
        `INSERT INTO contas_bancarias (id, tenant_id, nome, banco, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
        [id, tenantId, d.nome, d.banco, JSON.stringify(data)],
      );
      await vinculo('contas_bancarias', id, 'criado', o);
      return id;
    },
    async aplicarSaldo(contaId, centavos, o) {
      const { rows } = await exec.query(
        `SELECT data, ${SALDO_SQL('c')} AS saldo FROM contas_bancarias c WHERE c.tenant_id = $1 AND c.id = $2 FOR UPDATE`, [tenantId, contaId],
      );
      if (!rows.length) throw new Error('A conta bancária sumiu no meio da mudança.');
      const d = (rows[0].data ?? {}) as Record<string, unknown>;
      const atual = Number(rows[0].saldo ?? 0);
      const antes = { saldo_inicial: d.saldo_inicial ?? 0, data_saldo_inicial: d.data_saldo_inicial ?? null };
      // O saldo inicial é cadastro (o "Recalcular saldos" parte dele); o
      // dinheiro em si entra pelo movimento atômico, que grava no razão.
      await exec.query(
        `UPDATE contas_bancarias SET data = data || jsonb_build_object('saldo_inicial', $3::numeric, 'data_saldo_inicial', $4::text), updated_at = NOW()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, contaId, (centavos / 100).toFixed(2), dataCorte],
      );
      const delta = centavos - atual;
      if (delta) {
        await moverCaixaOuFalhar(tenantId, contaId, delta / 100, exec, {
          tipo: 'abertura', tabela: 'contas_bancarias', id: contaId, descricao: `Saldo de abertura da mudança de sistema (${dataBR(dataCorte)})`,
        });
      }
      await vinculo('contas_bancarias', contaId, 'saldo', o, null, { centavos, delta_centavos: delta, antes, data_corte: dataCorte });
      await retrato('contas_bancarias', contaId, o.lote_id);
    },
    async criarCategoria(c, o) {
      const id = randomUUID();
      const data = {
        id, codigo: c.codigo, nome: c.nome, tipo: c.tipo, categoria_pai_id: c.pai_id, natureza_custo: null,
        is_custo_comercial: false, ativo: true, repasse: c.repasse, origem_migracao: origemParaGravar(o),
      };
      await exec.query(
        `INSERT INTO plano_contas (id, tenant_id, codigo, descricao, tipo, data, created_at, updated_at) VALUES ($1, $2, $3, '', $4, $5::jsonb, NOW(), NOW())`,
        [id, tenantId, c.codigo, c.tipo, JSON.stringify(data)],
      );
      await vinculo('plano_contas', id, 'criado', o);
      return id;
    },
    async criarCentro(nome, o) {
      const id = randomUUID();
      await salvarCentro(exec, tenantId, { id, nome });
      await exec.query(
        `UPDATE centros_custo SET data = data || jsonb_build_object('origem_migracao', $3::jsonb) WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, JSON.stringify(origemParaGravar(o))],
      );
      await vinculo('centros_custo', id, 'criado', o);
      return id;
    },
    async criarPessoa(papel, d, o) {
      const id = randomUUID();
      const obs = d.codigo ? `Código no sistema anterior: ${d.codigo}` : '';
      if (papel === 'cliente') {
        const c: Cliente & Record<string, unknown> = { ...createCliente(), id };
        c.tipo = d.tipo_pessoa;
        if (d.tipo_pessoa === 'PJ') { c.nome_fantasia = d.nome; c.razao_social = d.razao_social || d.nome; c.cnpj = d.documento; }
        else { c.nome_completo = d.nome; c.cpf = d.documento; }
        Object.assign(c, {
          email: d.email, telefone_principal: d.telefone || d.celular, whatsapp: d.celular, cep: d.cep, logradouro: d.endereco,
          numero: d.numero, bairro: d.bairro, cidade: d.cidade, estado: d.uf, observacoes: obs, origem_migracao: origemParaGravar(o),
        });
        await exec.query(
          `INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, tipo, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())`,
          [id, tenantId, d.nome, d.documento, d.tipo_pessoa, JSON.stringify(c)],
        );
        await vinculo('clientes', id, 'criado', o);
      } else {
        const f = {
          ...cadastroCompleto({
            id, nome_fantasia: d.nome, razao_social: d.razao_social || d.nome, cnpj: d.documento, email: d.email,
            telefone: d.telefone || d.celular, whatsapp: d.celular, cidade: d.cidade, estado: d.uf,
            endereco_completo: [d.endereco, d.numero, d.bairro, d.cep].filter(Boolean).join(', '), observacoes: obs,
          }),
          origem_migracao: origemParaGravar(o),
        };
        await exec.query(
          `INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, categoria, data, created_at, updated_at) VALUES ($1, $2, $3, $4, '', $5::jsonb, NOW(), NOW())`,
          [id, tenantId, d.nome, d.documento, JSON.stringify(f)],
        );
        await vinculo('fornecedores_crm', id, 'criado', o);
      }
      return id;
    },
    async criarTitulo(tabela, t, refs, chave, o) {
      const id = randomUUID();
      const reais = t.valor / 100;
      const extras = [
        t.numero && `Nº ${t.numero} no sistema anterior`, t.venda && `Venda Nº ${t.venda}`, t.fatura && `Fatura Nº ${t.fatura}`,
        t.vendedor && `Vendedor: ${t.vendedor}`, t.empresa && `Empresa: ${t.empresa}`, t.forma && `Forma: ${t.forma}`,
      ].filter(Boolean).join(' · ');
      const observacoes = [t.observacoes, extras].filter(Boolean).join('\n');
      const descricao = t.descricao || (t.documento ? `Documento ${t.documento}` : `${t.movimento === 'receber' ? 'A receber de' : 'A pagar a'} ${refs.pessoa_nome}`);
      const origem = {
        ...origemParaGravar(o), chave, numero: t.numero, venda: t.venda, fatura: t.fatura, vendedor: t.vendedor, empresa: t.empresa,
        forma: t.forma, liquidado_depois_do_corte: t.liquidado_depois_do_corte,
      };
      const comum = {
        id, descricao, categoria_id: refs.categoria_id, centro_custo: refs.centro_nome, ...(refs.centro_id ? { centro_custo_id: refs.centro_id } : {}),
        valor_original: reais, valor_final: reais, data_emissao: t.emissao, data_vencimento: t.vencimento,
        conta_bancaria_id: refs.conta_id, parcela_numero: t.parcela_numero, total_parcelas: t.total_parcelas,
        status: 'PENDENTE', observacoes, origem: 'OUTROS', numero_documento: t.documento, origem_migracao: origem,
      };
      if (tabela === 'contas_receber') {
        const c = { ...createContaReceber(), ...comum, cliente_id: refs.pessoa_id, cliente_nome: refs.pessoa_nome };
        await exec.query(
          `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at) VALUES ($1, $2, '', $3, 'PENDENTE', $4::jsonb, NOW(), NOW())`,
          [id, tenantId, refs.pessoa_id, JSON.stringify(c)],
        );
      } else {
        const c = {
          ...createContaPagar(), ...comum, fornecedor_id: refs.pessoa_id, fornecedor_nome: refs.pessoa_nome, valor_brl: reais,
          ...(t.documento_pessoa ? { fornecedor_cnpj: t.documento_pessoa } : {}),
        };
        await exec.query(
          `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, 'PENDENTE', $4::jsonb, NOW(), NOW())`,
          [id, tenantId, refs.pessoa_id, JSON.stringify(c)],
        );
      }
      await vinculo(tabela, id, 'criado', o, chave);
      return id;
    },
    async vincular(tabela, id, o, chave) {
      if (id.startsWith('novo:')) return;
      await vinculo(tabela, id, 'vinculado', o, chave ?? null);
    },
  };
}

/** Começa a aplicar: confere a assinatura do ensaio e põe o lote na fila. Roda numa transação. */
export async function iniciarAplicacao(exec: ExecutorSQL, tenantId: string, loteId: string, assinatura: unknown): Promise<Lote> {
  const lote = await lerLote(exec, tenantId, loteId, true);
  if (ehParalelo(lote)) throw new ErroMudanca('Este é um mês em paralelo: ele só compara, não grava.', 409, 'LOTE_DE_COMPARACAO');
  if (lote.status === 'rascunho') throw new ErroMudanca('Faça o ensaio antes de aplicar.', 409, 'ENSAIO_NECESSARIO');
  if (lote.status !== 'ensaiado') throw new ErroMudanca('Esta mudança já foi aplicada.', 409, 'JA_APLICADO');
  if (!assinatura || assinatura !== lote.assinatura) {
    throw new ErroMudanca('Algo mudou depois do ensaio. Rode o ensaio de novo e confira antes de aplicar.', 409, 'ASSINATURA_VENCIDA');
  }
  const resumo = lote.resumo;
  if (resumo?.problemas.some(p => p.codigo === 'MAPEAMENTO_NAO_CONFIRMADO')) {
    throw new ErroMudanca('Confirme as colunas de todos os arquivos antes de aplicar.', 409, 'MAPEAMENTO_NAO_CONFIRMADO');
  }
  if (resumo?.problemas.length) throw new ErroMudanca(resumo.problemas[0].mensagem, 409, 'PROBLEMAS_NO_ENSAIO');
  const { rows: outra } = await exec.query(
    `SELECT nome FROM migracao_lotes WHERE tenant_id = $1 AND id <> $2 AND status = ANY($3::text[]) LIMIT 1`,
    [tenantId, loteId, [...STATUS_QUE_SEGURAM]],
  );
  if (outra.length) {
    throw new ErroMudanca(`Termine (conclua ou desfaça) a mudança "${txt(outra[0].nome)}" antes de aplicar outra.`, 409, 'OUTRA_MUDANCA_EM_ANDAMENTO');
  }
  const { rows: tot } = await exec.query(
    `SELECT COUNT(*)::int AS n FROM migracao_linhas WHERE tenant_id = $1 AND lote_id = $2 AND resultado IN ('criar','vincular')`, [tenantId, loteId],
  );
  await exec.query(
    `UPDATE migracao_lotes SET status = 'aplicando', erro = NULL, atualizado_em = NOW(),
            progresso = jsonb_build_object('total', $3::int, 'feitas', 0) WHERE tenant_id = $1 AND id = $2`,
    [tenantId, loteId, Number(tot[0]?.n ?? 0)],
  );
  await enfileirarTarefa(exec, { tenantId, tipo: TIPO_TAREFA_MIGRACAO, chaveIdem: `${loteId}#1`, dados: { lote_id: loteId, seq: 1 } });
  return lerLote(exec, tenantId, loteId);
}

/** Tamanho do bloco: linhas gravadas por transação. */
export const TAMANHO_DO_BLOCO = 200;

/**
 * Grava o próximo bloco de linhas do lote numa transação própria, dentro de
 * nadaSai. Cada linha tem um ponto de salvamento: erro numa linha a recusa
 * com o motivo e o bloco segue. Dois chamadores ao mesmo tempo (fila e
 * requisição) se revezam pela trava do lote.
 */
export async function aplicarBloco(tenantId: string, loteId: string, tamanho = TAMANHO_DO_BLOCO): Promise<{ feitas: number; restantes: number; status: StatusDoLote }> {
  return comNadaSai('mudança de sistema', () => emTransacao(async exec => {
    const lote = await lerLote(exec, tenantId, loteId, true);
    if (lote.status !== 'aplicando') return { feitas: 0, restantes: 0, status: lote.status };
    const { rows: linhas } = await exec.query(
      `SELECT m.arquivo_id, m.linha, m.etapa, m.dados, a.nome AS arquivo_nome
         FROM migracao_linhas m JOIN migracao_arquivos a ON a.id = m.arquivo_id
        WHERE m.tenant_id = $1 AND m.lote_id = $2 AND NOT m.aplicada AND m.resultado IN ('criar','vincular')
        ORDER BY m.etapa, a.ordem, m.linha LIMIT $3`,
      [tenantId, loteId, tamanho],
    );
    if (linhas.length) {
      const indice = await carregarIndice(exec, tenantId, loteId);
      const { rows: ch } = await exec.query(
        `SELECT m.chave, m.linha, a.nome FROM migracao_linhas m JOIN migracao_arquivos a ON a.id = m.arquivo_id
          WHERE m.tenant_id = $1 AND m.lote_id = $2 AND m.aplicada AND m.chave IS NOT NULL AND m.resultado IN ('criar','vincular')`,
        [tenantId, loteId],
      );
      const { rows: sd } = await exec.query(
        `SELECT registro_id FROM migracao_vinculos WHERE tenant_id = $1 AND lote_id = $2 AND acao = 'saldo'`, [tenantId, loteId],
      );
      const ctx: ContextoDoPlano = {
        dataCorte: lote.data_corte,
        chavesDoLote: new Map(ch.map(r => [txt(r.chave), `linha ${Number(r.linha)} de "${txt(r.nome)}"`])),
        saldosDoLote: new Set(sd.map(r => txt(r.registro_id))),
      };
      const g = gravadorDoBanco(exec, tenantId, lote.data_corte);
      for (const l of linhas) {
        const dados = (l.dados ?? {}) as { registro?: RegistroLido; enriq?: Enriquecimento };
        const it = { arquivo: { id: txt(l.arquivo_id), nome: txt(l.arquivo_nome) }, linha: Number(l.linha), etapa: Number(l.etapa) };
        let d: Decisao;
        await exec.query('SAVEPOINT mudanca_linha');
        try {
          if (!dados.registro) throw new Error('Linha sem o registro do ensaio.');
          d = await processarRegistro(dados.registro, dados.enriq ?? {}, indice, ctx, g, origemDe(lote, it));
          await exec.query('RELEASE SAVEPOINT mudanca_linha');
        } catch (e) {
          await exec.query('ROLLBACK TO SAVEPOINT mudanca_linha');
          d = { resultado: 'recusar', codigo: 'erro', motivo: `Não gravou: ${e instanceof Error ? e.message : String(e)}`, avisos: [], alvo_tabela: null, alvo_id: null, chave: null };
        }
        await exec.query(
          `UPDATE migracao_linhas SET aplicada = true, aplicada_em = NOW(), resultado = $4, codigo = $5, motivo = $6,
                  avisos = $7::jsonb, alvo_tabela = $8, alvo_id = $9, chave = COALESCE($10, chave)
            WHERE tenant_id = $1 AND arquivo_id = $2 AND linha = $3`,
          [tenantId, it.arquivo.id, it.linha, d.resultado, d.codigo, d.motivo, JSON.stringify(d.avisos), d.alvo_tabela, d.alvo_id, d.chave],
        );
      }
    }
    const { rows: rest } = await exec.query(
      `SELECT COUNT(*) FILTER (WHERE NOT aplicada)::int AS restantes, COUNT(*) FILTER (WHERE aplicada)::int AS feitas
         FROM migracao_linhas WHERE tenant_id = $1 AND lote_id = $2 AND (resultado IN ('criar','vincular') OR aplicada)`,
      [tenantId, loteId],
    );
    const restantes = Number(rest[0]?.restantes ?? 0);
    const feitas = Number(rest[0]?.feitas ?? 0);
    const status: StatusDoLote = restantes === 0 ? 'aplicado' : 'aplicando';
    await exec.query(
      `UPDATE migracao_lotes SET status = $3, progresso = progresso || jsonb_build_object('feitas', $4::int),
              aplicado_em = CASE WHEN $3 = 'aplicado' THEN NOW() ELSE aplicado_em END, atualizado_em = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, loteId, status, feitas],
    );
    return { feitas: linhas.length, restantes, status };
  }));
}

/** Aplica blocos até acabar ou estourar o orçamento de tempo. */
export async function avancarAplicacao(tenantId: string, loteId: string, orcamentoMs = 20_000, relogio: () => number = Date.now): Promise<{ status: StatusDoLote; restantes: number }> {
  const fim = relogio() + orcamentoMs;
  let r = await aplicarBloco(tenantId, loteId);
  while (r.status === 'aplicando' && r.restantes > 0 && relogio() < fim) r = await aplicarBloco(tenantId, loteId);
  return { status: r.status, restantes: r.restantes };
}

/**
 * Processador da fila (registrar como TIPO_TAREFA_MIGRACAO em
 * agendador/tarefas.ts). Aplica por até 20 s e, se sobrar, deixa a próxima
 * tarefa na fila.
 */
export async function processarTarefaMigracao(t: TarefaReivindicada): Promise<Record<string, unknown>> {
  const loteId = txt(t.dados.lote_id);
  const seq = Number(t.dados.seq ?? 1);
  let r: { status: StatusDoLote; restantes: number };
  try {
    r = await avancarAplicacao(t.tenant_id, loteId);
  } catch (e) {
    // A fila tenta de novo com espera; a tela mostra o erro enquanto isso.
    const msg = e instanceof Error ? e.message : String(e);
    await emTransacao(exec => exec.query(
      `UPDATE migracao_lotes SET erro = $3, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
      [t.tenant_id, loteId, `A gravação parou e vai ser retomada sozinha: ${msg}`.slice(0, 500)],
    ));
    throw e;
  }
  if (r.status === 'aplicando' && r.restantes > 0) {
    await emTransacao(exec => enfileirarTarefa(exec, {
      tenantId: t.tenant_id, tipo: TIPO_TAREFA_MIGRACAO, chaveIdem: `${loteId}#${seq + 1}`, dados: { lote_id: loteId, seq: seq + 1 },
    }));
  }
  return { lote_id: loteId, status: r.status, restantes: r.restantes };
}

/** "Concluir mudança": as saídas da agência voltam a valer. */
export async function concluirLote(exec: ExecutorSQL, tenantId: string, loteId: string): Promise<Lote> {
  const lote = await lerLote(exec, tenantId, loteId, true);
  if (lote.status === 'concluido') return lote;
  if (lote.status !== 'aplicado') {
    throw new ErroMudanca(lote.status === 'aplicando' ? 'A mudança ainda está sendo aplicada. Espere terminar.' : 'Só uma mudança aplicada pode ser concluída.', 409, 'NAO_APLICADO');
  }
  await exec.query(
    `UPDATE migracao_lotes SET status = 'concluido', concluido_em = NOW(), atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, loteId],
  );
  return lerLote(exec, tenantId, loteId);
}

/** Lote com os arquivos (GET de um lote). */
export async function detalheDoLote(exec: ExecutorSQL, tenantId: string, loteId: string): Promise<{ lote: Lote; arquivos: ArquivoDoLote[] }> {
  const lote = await lerLote(exec, tenantId, loteId);
  return { lote, arquivos: await listarArquivos(exec, tenantId, loteId) };
}

/** O dicionário para a tela "o que exportar de cada lista" (passo 1) e para o mapeamento. */
export function dicionarioParaTela() {
  return LISTAS.map(l => ({
    id: l.id, rotulo: l.rotulo, etapa: ETAPA_DA_LISTA[l.id], como_exportar: l.comoExportar,
    campos: l.campos.map(c => ({ id: c.id, rotulo: c.rotulo, obrigatorio: Boolean(c.obrigatorio), sinonimos: c.sinonimos, dica: c.dica ?? null })),
    pelo_menos_um_de: l.algumDe ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Idempotência das gravações (Idempotency-Key): a mesma chave devolve a mesma resposta.

export async function respostaGuardada(exec: ExecutorSQL, tenantId: string, loteId: string, chave: string | null | undefined): Promise<unknown | null> {
  if (!chave) return null;
  const { rows } = await exec.query(`SELECT idempotencia->($3::text) AS r FROM migracao_lotes WHERE tenant_id = $1 AND id = $2`, [tenantId, loteId, chave.slice(0, 200)]);
  return rows[0]?.r ?? null;
}

export async function guardarResposta(exec: ExecutorSQL, tenantId: string, loteId: string, chave: string | null | undefined, resposta: unknown): Promise<void> {
  if (!chave) return;
  await exec.query(
    `UPDATE migracao_lotes SET idempotencia = idempotencia || jsonb_build_object($3::text, $4::jsonb) WHERE tenant_id = $1 AND id = $2`,
    [tenantId, loteId, chave.slice(0, 200), JSON.stringify(resposta)],
  );
}
