/**
 * Acertos de dados da volta da versão completa (14/11/2026).
 *
 * O banco de produção é um só. A versão completa rodou de 05/11 a 12/11
 * (criou tabelas, gatilhos e o razão); a versão simples rodou de 12/11 até a
 * publicação em cima dele. Quando o código completo volta, três coisas
 * precisam ser acertadas, uma vez, cada uma com o seu marco em
 * `marcos_de_migracao`:
 *
 * 1. Gatilho de auditoria fora do lugar: o instalador da versão simples pôs
 *    `audit_capture_row_v1` em toda tabela com tenant_id, inclusive nas que a
 *    completa deixa de fora de propósito (razão, fila, histórico imutável,
 *    segredo bancário...). Aqui eles saem. Roda a cada boot (é barato e
 *    idempotente): se alguém republicar a simples e voltar, sai de novo.
 * 2. Propostas criadas sem token na versão simples continuam abrindo pelo
 *    link antigo (pelo id) por 180 dias, como as anteriores ao link por token.
 *    Só uma vez: proposta nova da versão completa nunca abre pelo id.
 * 3. Razão: o dinheiro que se moveu de 12/11 até a publicação não passou pelo
 *    razão. Cada agência com razão aberto é REABERTA na data da publicação: a
 *    diferença de cada conta (saldo de hoje × saldo do razão) entra numa
 *    contrapartida "a revisar" e fica listada em `razao_conferencias` (tipo
 *    'reabertura'). O saldo da conta não é tocado. A conferência das 3h
 *    passa a bater e a diferença do intervalo vai para a lista de revisão
 *    (Super Admin › Saúde da volta).
 *
 * Roda no initDB, depois dos esquemas e antes do instalador da auditoria.
 * Nunca derruba o boot: cada acerto que falha fica sem marco e é tentado de
 * novo no próximo.
 */
import { lancamentoDeMovimento } from './razao';

/** Dia em que a versão simples entrou no ar (início do intervalo a revisar). */
export const INICIO_DA_VERSAO_SIMPLES = '2026-11-12';

/**
 * Tabelas com tenant_id que a auditoria da versão completa deixa de fora
 * (a lista NOT IN de audit-schema.ts, menos as quatro que a simples também
 * deixava). O teste confere que esta lista é a mesma do instalador.
 */
export const TABELAS_FORA_DA_AUDITORIA = [
  'razao_estado', 'razao_lancamentos', 'razao_partidas', 'razao_falhas', 'razao_conferencias',
  'retrato_saldos', 'agendador_execucoes', 'agendador_estado', 'tarefas', 'leituras_de_documento',
  'cobranca_eventos', 'cobranca_lembretes', 'cobranca_disjuntor', 'cobranca_portal_links',
  'migracao_lotes', 'migracao_arquivos', 'migracao_linhas', 'migracao_vinculos', 'migracao_historico',
  'variacoes_cambiais', 'venda_eventos', 'comissao_lancamentos', 'comissao_fechamentos',
  'creditos_cliente_movimentos', 'fatura_eventos', 'conciliacoes_automaticas',
  'conferencias_operadora_linhas', 'conexoes_bancarias_segredo', 'sincronizacoes_bancarias',
  'relatorios_leituras', 'relatorios_envios', 'empresa_selecao',
  'contas_excluidas', 'titulos_numeros', 'titulos_numeracao', 'preferencias_usuario', 'perguntas_ia',
] as const;

export const MARCO_GATILHOS = 'volta_completa_gatilhos_de_auditoria';
export const MARCO_PROPOSTAS = 'volta_completa_propostas_link_por_id';
export const MARCO_RAZAO = 'volta_completa_razao_reaberto';

/** Contrapartida da diferença do intervalo (já existe no razão). */
const CONTA_A_REVISAR = 'AJUSTE_A_REVISAR';

export interface Executor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface BancoDosAcertos extends Executor {
  /** Conexão própria para a transação de cada agência (pool do pg). */
  connect?: () => Promise<Executor & { release: () => void }>;
}

export interface ResumoDosAcertos {
  gatilhos_removidos: number;
  propostas_com_link_antigo: number | null;
  razao: { agencias: number; contas_com_diferenca: number; falhas: string[] } | null;
  erros: string[];
}

const MARCOS_SQL = `CREATE TABLE IF NOT EXISTS marcos_de_migracao (
  chave TEXT PRIMARY KEY,
  em TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

async function temMarco(db: Executor, chave: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM marcos_de_migracao WHERE chave = $1`, [chave]);
  return rows.length > 0;
}

async function marcar(db: Executor, chave: string): Promise<void> {
  await db.query(`INSERT INTO marcos_de_migracao (chave) VALUES ($1) ON CONFLICT DO NOTHING`, [chave]);
}

async function existeTabela(db: Executor, nome: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${nome}`]);
  return rows[0]?.ok === true;
}

/** 1. Tira o gatilho de auditoria das tabelas que a versão completa deixa de fora. */
export async function tirarGatilhosForaDoLugar(db: Executor): Promise<number> {
  const { rows } = await db.query(
    `SELECT c.relname AS tabela
       FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND g.tgname = 'audit_capture_row_v1' AND NOT g.tgisinternal
        AND c.relname = ANY($1::text[])`,
    [[...TABELAS_FORA_DA_AUDITORIA]],
  );
  for (const r of rows) {
    // O nome vem do catálogo e da lista fixa acima; aspas pelo próprio banco.
    const { rows: q } = await db.query(`SELECT quote_ident($1) AS t`, [String(r.tabela)]);
    await db.query(`DROP TRIGGER IF EXISTS audit_capture_row_v1 ON public.${String(q[0].t)}`);
  }
  await marcar(db, MARCO_GATILHOS);
  return rows.length;
}

/** 2. Propostas sem token continuam abrindo pelo link antigo por 180 dias (uma vez só). */
export async function manterLinkAntigoDasPropostas(db: Executor): Promise<number | null> {
  if (await temMarco(db, MARCO_PROPOSTAS)) return null;
  if (!(await existeTabela(db, 'propostas'))) return null;
  const { rows } = await db.query(
    `WITH feitas AS (
       UPDATE propostas SET link_por_id_ate = NOW() + INTERVAL '180 days'
        WHERE token_publico_hash IS NULL AND link_por_id_ate IS NULL
       RETURNING 1)
     SELECT COUNT(*)::int AS n FROM feitas`,
  );
  await marcar(db, MARCO_PROPOSTAS);
  return Number(rows[0]?.n ?? 0);
}

const SALDO_SQL = `ROUND((CASE WHEN data->>'saldo_atual' ~ '^-?[0-9]+([.][0-9]+)?$'
                         THEN (data->>'saldo_atual')::numeric ELSE 0 END) * 100)::bigint`;
const INICIAL_SQL = SALDO_SQL.replace(/saldo_atual/g, 'saldo_inicial');

/** Lançamento da diferença do intervalo: banco × "a revisar". */
export function lancamentoDaReabertura(tenantId: string, contaId: string, diferencaCentavos: number, hoje: string) {
  return {
    chave_natural: `reabertura:volta-completa:contas_bancarias:${contaId}`,
    tipo_evento: 'reabertura',
    origem_tabela: 'contas_bancarias',
    origem_id: contaId,
    data_competencia: hoje,
    descricao: `Reabertura do razão na volta da versão completa: diferença de ${INICIO_DA_VERSAO_SIMPLES} até ${hoje}, a revisar`,
    dados: { intervalo_de: INICIO_DA_VERSAO_SIMPLES, intervalo_ate: hoje, tenant_id: tenantId },
    partidas: [
      { conta: 'BANCO', conta_bancaria_id: contaId, valor_centavos: diferencaCentavos, titulo_tabela: 'contas_bancarias', titulo_id: contaId, pessoa_id: null },
      { conta: CONTA_A_REVISAR, conta_bancaria_id: contaId, valor_centavos: -diferencaCentavos, titulo_tabela: 'contas_bancarias', titulo_id: contaId, pessoa_id: null },
    ],
  };
}

async function lancar(exec: Executor, tenantId: string, lanc: unknown): Promise<void> {
  const { rows } = await exec.query(`SELECT razao_lancar($1, $2::jsonb, true) AS r`, [tenantId, JSON.stringify(lanc)]);
  const r = String(rows[0]?.r ?? 'falha');
  if (r !== 'ok' && r !== 'duplicado') throw new Error(`razão recusou o lançamento (${r})`);
}

/**
 * Reabre o razão de UMA agência (exec já em transação). Devolve quantas contas
 * ficaram com diferença para revisar. Idempotente: depois da reabertura o
 * razão bate com o saldo e a chave natural não grava duas vezes.
 */
export async function reabrirRazaoDaAgencia(exec: Executor, tenantId: string): Promise<number> {
  await exec.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`razao-abertura:${tenantId}`]);
  const { rows: contas } = await exec.query(
    `SELECT id, ${SALDO_SQL} AS saldo_centavos, ${INICIAL_SQL} AS inicial_centavos
       FROM contas_bancarias WHERE tenant_id = $1 ORDER BY id FOR UPDATE`,
    [tenantId],
  );
  const { rows: dia } = await exec.query(`SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d`);
  const hoje = String(dia[0]?.d ?? '');
  let comDiferenca = 0;
  const diferencas: Array<{ conta_bancaria_id: string; diferenca_centavos: number }> = [];
  for (const c of contas) {
    const id = String(c.id);
    const { rows: rz } = await exec.query(
      `SELECT COALESCE(SUM(valor_centavos), 0)::bigint AS s, COUNT(*)::int AS n
         FROM razao_partidas WHERE tenant_id = $1 AND conta = 'BANCO' AND conta_bancaria_id = $2`,
      [tenantId, id],
    );
    let razao = Number(rz[0]?.s ?? 0);
    const atual = Number(c.saldo_centavos ?? 0);
    // Conta criada na versão simples: nunca entrou no razão. O saldo inicial
    // dela é a abertura de sempre (mesma chave de garantirAberturaDaConta);
    // só o que se moveu depois vai para a revisão.
    if (Number(rz[0]?.n ?? 0) === 0) {
      const inicial = Number(c.inicial_centavos ?? 0);
      const abertura = lancamentoDeMovimento(id, inicial / 100, { tipo: 'abertura', tabela: 'contas_bancarias', id });
      if (abertura) {
        await lancar(exec, tenantId, abertura);
        razao += inicial;
      }
    }
    const diferenca = atual - razao;
    if (diferenca !== 0) {
      await lancar(exec, tenantId, lancamentoDaReabertura(tenantId, id, diferenca, hoje));
      comDiferenca++;
      diferencas.push({ conta_bancaria_id: id, diferenca_centavos: diferenca });
    }
    await exec.query(
      `INSERT INTO razao_conferencias (tenant_id, dia, tipo, conta_bancaria_id, saldo_atual_centavos, razao_centavos, diferenca_centavos, dados)
       VALUES ($1, $2::date, 'reabertura', $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (tenant_id, dia, tipo, conta_bancaria_id) DO NOTHING`,
      [tenantId, hoje, id, atual, razao, diferenca,
        JSON.stringify({ diferenca_para_revisar_centavos: diferenca, intervalo_de: INICIO_DA_VERSAO_SIMPLES, intervalo_ate: hoje })],
    );
  }
  await exec.query(
    `UPDATE razao_estado
        SET dados = COALESCE(dados, '{}'::jsonb) || jsonb_build_object('reabertura', $2::jsonb)
      WHERE tenant_id = $1 AND NOT (COALESCE(dados, '{}'::jsonb) ? 'reabertura')`,
    [tenantId, JSON.stringify({ em: hoje, intervalo_de: INICIO_DA_VERSAO_SIMPLES, contas: contas.length, diferencas })],
  );
  return comDiferenca;
}

/** 3. Reabre o razão de todas as agências que já tinham razão (uma vez só). */
export async function reabrirRazaoDeTodas(db: BancoDosAcertos): Promise<ResumoDosAcertos['razao']> {
  if (await temMarco(db, MARCO_RAZAO)) return null;
  if (!(await existeTabela(db, 'razao_estado'))) return null;
  const { rows } = await db.query(`SELECT tenant_id FROM razao_estado ORDER BY tenant_id`);
  const falhas: string[] = [];
  let contasComDiferenca = 0;
  for (const r of rows) {
    const tenantId = String(r.tenant_id);
    const conexao = db.connect ? await db.connect() : null;
    const exec: Executor = conexao ?? db;
    try {
      await exec.query('BEGIN');
      contasComDiferenca += await reabrirRazaoDaAgencia(exec, tenantId);
      await exec.query('COMMIT');
    } catch (e) {
      try { await exec.query('ROLLBACK'); } catch { /* conexão perdida */ }
      falhas.push(`${tenantId}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      conexao?.release();
    }
  }
  // Agência que falhou fica sem marco geral: o próximo boot tenta de novo (as
  // que deram certo não mudam, a chave natural segura).
  if (falhas.length === 0) await marcar(db, MARCO_RAZAO);
  return { agencias: rows.length, contas_com_diferenca: contasComDiferenca, falhas };
}

/** Os três acertos, em ordem. Nunca lança: o que falhar fica para o próximo boot. */
export async function aplicarAcertosDaVolta(db: BancoDosAcertos): Promise<ResumoDosAcertos> {
  const resumo: ResumoDosAcertos = { gatilhos_removidos: 0, propostas_com_link_antigo: null, razao: null, erros: [] };
  try {
    await db.query(MARCOS_SQL);
  } catch (e) {
    resumo.erros.push(`marcos: ${e instanceof Error ? e.message : String(e)}`);
    return resumo;
  }
  try {
    resumo.gatilhos_removidos = await tirarGatilhosForaDoLugar(db);
  } catch (e) {
    resumo.erros.push(`gatilhos: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    resumo.propostas_com_link_antigo = await manterLinkAntigoDasPropostas(db);
  } catch (e) {
    resumo.erros.push(`propostas: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    resumo.razao = await reabrirRazaoDeTodas(db);
    if (resumo.razao?.falhas.length) resumo.erros.push(...resumo.razao.falhas.map(f => `razão ${f}`));
  } catch (e) {
    resumo.erros.push(`razão: ${e instanceof Error ? e.message : String(e)}`);
  }
  return resumo;
}
