// Permissões lidas do banco: perfis de acesso e restrição por usuário
// (05/11/2026). O papel continua sendo o teto (ver ./acoes-financeiras).
//
// Sem grupo e sem restrição, `pode` responde exatamente o que as funções de
// ./permissoes respondiam (o porteiro em scripts/test-sql-permissoes.mjs
// prova isso para todo papel e toda ação). ADMIN e superadmin nem consultam
// o banco.
import pool from './db';
import { generateId } from './utils';
import {
  ACOES_FINANCEIRAS, contasLiberadasPor, decidirAcao, listaDeAcoes, listaDeTextos, nuncaRestringido, tetoDoPapel,
  type AcaoFinanceira, type GrupoDoUsuario, type RestricoesCarregadas,
} from './acoes-financeiras';
import type { SessionLike } from './permissoes';
import { empresasLiberadasPor } from './empresas';

export interface ExecutorPermissoes {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export type SessaoPermissoes = SessionLike & { tenantId?: string; impersonatingTenantId?: string };

export function tenantDaSessao(s: SessaoPermissoes): string {
  return s.impersonatingTenantId || s.tenantId || '';
}

// ---------------------------------------------------------------------------
// Leitura das restrições

let tabelasProntas = false;

async function tabelasExistem(exec: ExecutorPermissoes): Promise<boolean> {
  if (tabelasProntas) return true;
  // to_regclass nunca falha: um banco antigo (antes do initDB) não envenena
  // a transação de quem chamou.
  const { rows } = await exec.query(
    `SELECT to_regclass('public.grupos_usuario') IS NOT NULL AND to_regclass('public.usuario_restricoes') IS NOT NULL AS ok`,
  );
  tabelasProntas = rows[0]?.ok === true;
  return tabelasProntas;
}

/** Restrições da pessoa, ou null quando ninguém configurou nada para ela. */
export async function carregarRestricoesNoExecutor(
  exec: ExecutorPermissoes, tenantId: string, usuarioId: string,
): Promise<RestricoesCarregadas | null> {
  if (!tenantId || !usuarioId) return null;
  if (!(await tabelasExistem(exec))) return null;
  const { rows } = await exec.query(
    `SELECT
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', g.id, 'nome', g.nome,
           'acesso_total', g.acesso_total, 'acoes', g.acoes, 'contas', g.contas,
           'empresas', COALESCE(to_jsonb(g)->'empresas', '[]'::jsonb)) ORDER BY g.nome), '[]'::jsonb)
          FROM grupo_usuario_membros m
          JOIN grupos_usuario g ON g.tenant_id = m.tenant_id AND g.id = m.grupo_id
         WHERE m.tenant_id = $1 AND m.usuario_id = $2) AS grupos,
       (SELECT jsonb_build_object('contas_liberadas', r.contas_liberadas, 'acoes_negadas', r.acoes_negadas,
           'empresas_liberadas', COALESCE(to_jsonb(r)->'empresas_liberadas', '[]'::jsonb))
          FROM usuario_restricoes r WHERE r.tenant_id = $1 AND r.usuario_id = $2) AS usuario`,
    [tenantId, usuarioId],
  );
  const linha = rows[0] ?? {};
  const grupos = (Array.isArray(linha.grupos) ? linha.grupos : []).map((g: Record<string, unknown>): GrupoDoUsuario => ({
    id: String(g.id ?? ''), nome: String(g.nome ?? ''), acesso_total: g.acesso_total === true,
    acoes: listaDeTextos(g.acoes), contas: listaDeTextos(g.contas), empresas: listaDeTextos(g.empresas),
  }));
  const u = linha.usuario as Record<string, unknown> | null | undefined;
  const usuario = u ? {
    contas_liberadas: listaDeTextos(u.contas_liberadas), acoes_negadas: listaDeTextos(u.acoes_negadas),
    empresas_liberadas: listaDeTextos(u.empresas_liberadas),
  } : null;
  const usuarioVazio = !usuario || (usuario.contas_liberadas.length === 0 && usuario.acoes_negadas.length === 0
    && usuario.empresas_liberadas.length === 0);
  if (grupos.length === 0 && usuarioVazio) return null;
  return { grupos, usuario: usuarioVazio ? null : usuario };
}

// Cache por requisição: a mesma sessão (objeto) reaproveita a leitura; outra
// leitura da mesma pessoa em até 2 s também (uma requisição chama getSession
// mais de uma vez). Gravar grupo ou restrição limpa a agência na hora.
const porSessao = new WeakMap<object, { geracao: number; valor: Promise<RestricoesCarregadas | null> }>();
// Sobe a cada gravação: a leitura guardada na sessão fica velha na hora.
let geracao = 0;
const porPessoa = new Map<string, { ate: number; valor: Promise<RestricoesCarregadas | null> }>();
const TTL_MS = 2_000;

export function invalidarPermissoes(tenantId?: string): void {
  geracao++;
  if (!tenantId) { porPessoa.clear(); return; }
  for (const chave of [...porPessoa.keys()]) if (chave.startsWith(`${tenantId}|`)) porPessoa.delete(chave);
}

async function restricoesDa(sessao: SessaoPermissoes, exec?: ExecutorPermissoes): Promise<RestricoesCarregadas | null> {
  if (nuncaRestringido(sessao)) return null;
  const executor = exec ?? (pool as unknown as ExecutorPermissoes | null);
  if (!executor) return null;
  const tenantId = tenantDaSessao(sessao);
  const usuarioId = sessao.userId || '';
  // Executor explícito (transação): lê nele, sem cache, para ver o que a
  // própria transação gravou.
  if (exec) return carregarRestricoesNoExecutor(exec, tenantId, usuarioId);
  const daSessao = porSessao.get(sessao);
  if (daSessao && daSessao.geracao === geracao) return daSessao.valor;
  const chave = `${tenantId}|${usuarioId}`;
  const agora = Date.now();
  const guardado = porPessoa.get(chave);
  if (guardado && guardado.ate > agora) { porSessao.set(sessao, { geracao, valor: guardado.valor }); return guardado.valor; }
  const valor = carregarRestricoesNoExecutor(executor, tenantId, usuarioId);
  porSessao.set(sessao, { geracao, valor });
  porPessoa.set(chave, { ate: agora + TTL_MS, valor });
  valor.catch(() => { porPessoa.delete(chave); porSessao.delete(sessao); });
  if (porPessoa.size > 5_000) for (const [k, v] of porPessoa) if (v.ate <= agora) porPessoa.delete(k);
  return valor;
}

/**
 * Pode fazer `acao`? O papel é o teto; grupos e restrição do usuário só
 * tiram. Com `contaBancariaId`, a conta também precisa estar liberada.
 */
export async function pode(
  session: SessaoPermissoes | null | undefined,
  acao: AcaoFinanceira,
  opcoes?: { contaBancariaId?: string | null; exec?: ExecutorPermissoes },
): Promise<boolean> {
  if (!session) return false;
  if (session.isSuperAdmin) return true;
  if (!tetoDoPapel(session.perfil, acao)) return false;
  if (nuncaRestringido(session)) return true;
  const r = await restricoesDa(session, opcoes?.exec);
  return decidirAcao(session, acao, r, { contaBancariaId: opcoes?.contaBancariaId });
}

/** Contas bancárias liberadas. `null` = todas (sem restrição, como hoje). */
export async function contasPermitidas(
  session: SessaoPermissoes | null | undefined, exec?: ExecutorPermissoes,
): Promise<string[] | null> {
  if (!session) return [];
  if (nuncaRestringido(session)) return null;
  return contasLiberadasPor(session, await restricoesDa(session, exec));
}

/**
 * Empresas liberadas pelo perfil de acesso e pela restrição própria (E7).
 * `null` = todas (sem restrição, como hoje). Administrador nunca é restringido.
 */
export async function empresasPermitidas(
  session: SessaoPermissoes | null | undefined, exec?: ExecutorPermissoes,
): Promise<string[] | null> {
  if (!session) return [];
  if (nuncaRestringido(session)) return null;
  const r = await restricoesDa(session, exec);
  if (!r) return null;
  return empresasLiberadasPor(false,
    r.grupos.map(g => ({ acesso_total: g.acesso_total, empresas: g.empresas ?? [] })),
    r.usuario ? { empresas_liberadas: r.usuario.empresas_liberadas ?? [] } : null);
}

/** Para as telas: o que esta pessoa pode, ação por ação, e as contas. */
export async function resumoDePermissoes(session: SessaoPermissoes): Promise<{
  acoes: Record<string, boolean>; contas: string[] | null; restringido: boolean;
}> {
  const r = nuncaRestringido(session) ? null : await restricoesDa(session);
  const acoes: Record<string, boolean> = {};
  for (const a of ACOES_FINANCEIRAS) acoes[a.id] = session.isSuperAdmin ? true : tetoDoPapel(session.perfil, a.id) && decidirAcao(session, a.id, r);
  return { acoes, contas: contasLiberadasPor(session, r), restringido: r !== null };
}

// ---------------------------------------------------------------------------
// Cadastro dos perfis de acesso (tela Configurações › Perfis de acesso)

export interface GrupoCadastro {
  id: string;
  nome: string;
  acesso_total: boolean;
  acoes: AcaoFinanceira[];
  contas: string[];
  /** Empresas em que o perfil vale (vazio = todas). Só aparece com 2+ empresas. */
  empresas: string[];
  membros: string[];
  updated_at?: string;
}

export class ErroPermissoes extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function listarGrupos(exec: ExecutorPermissoes, tenantId: string): Promise<GrupoCadastro[]> {
  const { rows } = await exec.query(
    `SELECT g.id, g.nome, g.acesso_total, g.acoes, g.contas, COALESCE(to_jsonb(g)->'empresas', '[]'::jsonb) AS empresas, g.updated_at,
            COALESCE((SELECT jsonb_agg(m.usuario_id ORDER BY m.usuario_id) FROM grupo_usuario_membros m
                       WHERE m.tenant_id = g.tenant_id AND m.grupo_id = g.id), '[]'::jsonb) AS membros
       FROM grupos_usuario g WHERE g.tenant_id = $1 ORDER BY lower(g.nome)`,
    [tenantId],
  );
  return rows.map(r => ({
    id: String(r.id), nome: String(r.nome), acesso_total: r.acesso_total === true,
    acoes: listaDeAcoes(r.acoes), contas: listaDeTextos(r.contas), empresas: listaDeTextos(r.empresas), membros: listaDeTextos(r.membros),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? ''),
  }));
}

/** Valida e grava um grupo com os membros. Devolve o grupo gravado. */
export async function salvarGrupo(
  exec: ExecutorPermissoes, tenantId: string, entrada: Record<string, unknown>, autorId: string,
): Promise<GrupoCadastro> {
  const nome = typeof entrada.nome === 'string' ? entrada.nome.trim().slice(0, 80) : '';
  if (!nome) throw new ErroPermissoes('Dê um nome ao perfil.');
  const id = typeof entrada.id === 'string' && entrada.id.trim() ? entrada.id.trim().slice(0, 80) : `gu_${generateId()}`;
  const acessoTotal = entrada.acesso_total === true;
  const acoes = listaDeAcoes(entrada.acoes);
  // Acesso completo vê todas as contas: lista de contas não se aplica.
  const contas = acessoTotal ? [] : listaDeTextos(entrada.contas);
  const membros = listaDeTextos(entrada.membros);
  // Empresas (E7): só quando a tela manda; ausente = não mexe.
  const empresas = Array.isArray(entrada.empresas) ? listaDeTextos(entrada.empresas) : null;
  if (empresas && empresas.length > 0) {
    const { rows } = await exec.query(
      `SELECT id FROM empresas WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, empresas]);
    if (rows.length !== empresas.length) throw new ErroPermissoes('Uma das empresas escolhidas não existe mais. Recarregue a tela.');
  }

  if (contas.length > 0) {
    const { rows } = await exec.query(
      `SELECT id FROM contas_bancarias WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, contas]);
    if (rows.length !== contas.length) throw new ErroPermissoes('Uma das contas escolhidas não existe mais. Recarregue a tela.');
  }
  if (membros.length > 0) {
    const { rows } = await exec.query(
      `SELECT id FROM usuarios WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, membros]);
    if (rows.length !== membros.length) throw new ErroPermissoes('Uma das pessoas escolhidas não está mais na agência. Recarregue a tela.');
  }
  const { rows: mesmoNome } = await exec.query(
    `SELECT id FROM grupos_usuario WHERE tenant_id = $1 AND lower(nome) = lower($2) AND id <> $3`, [tenantId, nome, id]);
  if (mesmoNome.length > 0) throw new ErroPermissoes('Já existe um perfil com esse nome.', 409);

  await exec.query(
    `INSERT INTO grupos_usuario (tenant_id, id, nome, acesso_total, acoes, contas, criado_por)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     ON CONFLICT (tenant_id, id) DO UPDATE SET nome = EXCLUDED.nome, acesso_total = EXCLUDED.acesso_total,
       acoes = EXCLUDED.acoes, contas = EXCLUDED.contas, updated_at = NOW()`,
    [tenantId, id, nome, acessoTotal, JSON.stringify(acoes), JSON.stringify(contas), autorId],
  );
  if (empresas) {
    await exec.query(`UPDATE grupos_usuario SET empresas = $3::jsonb WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, JSON.stringify(empresas)]);
  }
  await exec.query(
    `DELETE FROM grupo_usuario_membros WHERE tenant_id = $1 AND grupo_id = $2 AND NOT (usuario_id = ANY($3::text[]))`,
    [tenantId, id, membros]);
  if (membros.length > 0) {
    await exec.query(
      `INSERT INTO grupo_usuario_membros (tenant_id, grupo_id, usuario_id)
       SELECT $1, $2, u FROM unnest($3::text[]) AS u ON CONFLICT DO NOTHING`,
      [tenantId, id, membros]);
  }
  invalidarPermissoes(tenantId);
  let empresasGravadas = empresas ?? [];
  if (!empresas) {
    const { rows } = await exec.query(
      `SELECT COALESCE(to_jsonb(g)->'empresas', '[]'::jsonb) AS e FROM grupos_usuario g WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    empresasGravadas = listaDeTextos(rows[0]?.e);
  }
  return { id, nome, acesso_total: acessoTotal, acoes, contas, empresas: empresasGravadas, membros };
}

export async function excluirGrupo(exec: ExecutorPermissoes, tenantId: string, id: string): Promise<boolean> {
  const r = await exec.query(`DELETE FROM grupos_usuario WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  invalidarPermissoes(tenantId);
  return (r.rowCount ?? 0) > 0;
}

export interface RestricaoCadastro { usuario_id: string; contas_liberadas: string[]; acoes_negadas: AcaoFinanceira[]; empresas_liberadas: string[] }

export async function listarRestricoesDeUsuarios(exec: ExecutorPermissoes, tenantId: string): Promise<RestricaoCadastro[]> {
  const { rows } = await exec.query(
    `SELECT usuario_id, contas_liberadas, acoes_negadas, COALESCE(to_jsonb(r)->'empresas_liberadas', '[]'::jsonb) AS empresas_liberadas
       FROM usuario_restricoes r WHERE tenant_id = $1`, [tenantId]);
  return rows.map(r => ({
    usuario_id: String(r.usuario_id), contas_liberadas: listaDeTextos(r.contas_liberadas), acoes_negadas: listaDeAcoes(r.acoes_negadas),
    empresas_liberadas: listaDeTextos(r.empresas_liberadas),
  }));
}

/** Grava (ou apaga, quando vazia) a restrição de uma pessoa. */
export async function salvarRestricaoDeUsuario(
  exec: ExecutorPermissoes, tenantId: string, entrada: Record<string, unknown>,
): Promise<RestricaoCadastro> {
  const usuarioId = typeof entrada.usuario_id === 'string' ? entrada.usuario_id.trim() : '';
  if (!usuarioId) throw new ErroPermissoes('Escolha a pessoa.');
  const { rows } = await exec.query(`SELECT 1 FROM usuarios WHERE tenant_id = $1 AND id = $2`, [tenantId, usuarioId]);
  if (rows.length === 0) throw new ErroPermissoes('Pessoa não encontrada nesta agência.', 404);
  const contas = listaDeTextos(entrada.contas_liberadas);
  const negadas = listaDeAcoes(entrada.acoes_negadas);
  // Empresas (E7): só quando a tela manda; ausente = mantém as de antes.
  let empresas: string[] = [];
  const mandouEmpresas = Array.isArray(entrada.empresas_liberadas);
  if (mandouEmpresas) {
    empresas = listaDeTextos(entrada.empresas_liberadas);
    if (empresas.length > 0) {
      const { rows: existem } = await exec.query(
        `SELECT id FROM empresas WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, empresas]);
      if (existem.length !== empresas.length) throw new ErroPermissoes('Uma das empresas escolhidas não existe mais. Recarregue a tela.');
    }
  } else {
    const { rows: antes } = await exec.query(
      `SELECT COALESCE(to_jsonb(r)->'empresas_liberadas', '[]'::jsonb) AS e FROM usuario_restricoes r WHERE tenant_id = $1 AND usuario_id = $2`,
      [tenantId, usuarioId]);
    empresas = listaDeTextos(antes[0]?.e);
  }
  if (contas.length > 0) {
    const { rows: existentes } = await exec.query(
      `SELECT id FROM contas_bancarias WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, contas]);
    if (existentes.length !== contas.length) throw new ErroPermissoes('Uma das contas escolhidas não existe mais. Recarregue a tela.');
  }
  if (contas.length === 0 && negadas.length === 0 && empresas.length === 0) {
    await exec.query(`DELETE FROM usuario_restricoes WHERE tenant_id = $1 AND usuario_id = $2`, [tenantId, usuarioId]);
  } else {
    await exec.query(
      `INSERT INTO usuario_restricoes (tenant_id, usuario_id, contas_liberadas, acoes_negadas)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)
       ON CONFLICT (tenant_id, usuario_id) DO UPDATE SET contas_liberadas = EXCLUDED.contas_liberadas,
         acoes_negadas = EXCLUDED.acoes_negadas, updated_at = NOW()`,
      [tenantId, usuarioId, JSON.stringify(contas), JSON.stringify(negadas)]);
    if (mandouEmpresas) {
      await exec.query(`UPDATE usuario_restricoes SET empresas_liberadas = $3::jsonb WHERE tenant_id = $1 AND usuario_id = $2`,
        [tenantId, usuarioId, JSON.stringify(empresas)]);
    }
  }
  invalidarPermissoes(tenantId);
  return { usuario_id: usuarioId, contas_liberadas: contas, acoes_negadas: negadas, empresas_liberadas: empresas };
}

/** Membros (ids de usuário) de um grupo, para resolver aprovadores 'grupo:<id>'. */
export async function membrosDoGrupo(exec: ExecutorPermissoes, tenantId: string, grupoId: string): Promise<string[]> {
  const { rows } = await exec.query(
    `SELECT usuario_id FROM grupo_usuario_membros WHERE tenant_id = $1 AND grupo_id = $2`, [tenantId, grupoId]);
  return rows.map(r => String(r.usuario_id));
}
