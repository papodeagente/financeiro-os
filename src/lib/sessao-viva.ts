/**
 * Sessão que pode ser revogada (FIN-05 e FIN2-10, auditoria de 04/11/2026).
 *
 * A sessão é um JWT de cookie. Antes ele valia 7 dias e nada o derrubava:
 * desativar a pessoa, trocar o perfil dela, trocar a senha ou sair do sistema
 * não invalidava o token já emitido. Um vendedor demitido continuava entrando
 * até o token vencer.
 *
 * Agora o token leva `tv`, a versão da sessão do cadastro, e cada leitura da
 * sessão confere no banco (com cache de 30 s por processo) se:
 *   - a pessoa ainda existe e está ativa;
 *   - o perfil ainda dá acesso ao sistema;
 *   - a agência está ativa (não vale para superadmin);
 *   - a versão do token é a versão atual do cadastro.
 * Trocar perfil, senha, e-mail, desativar ou sair sobe a versão.
 */
import pool from './db';
import { runWithAuditContext, SYSTEM_AUDIT_CONTEXT } from './audit-context';
import { perfilCanonico, semAcessoAoSistema } from './permissoes';
import { papelDoCadastro } from './plataforma';

export interface DonoDaSessao {
  userId: string;
  tenantId?: string;
  isSuperAdmin?: boolean;
  /** 'CS' para quem é da plataforma sem ser super admin (ver ./plataforma). */
  plataforma?: string;
  perfil?: string;
  tv?: number;
}

/** Da plataforma: super admin ou CS, os dois em `super_admins`. */
function daPlataforma(p: DonoDaSessao): boolean {
  return p.isSuperAdmin === true || p.plataforma === 'CS';
}

interface Estado { tv: number; ok: boolean; ate: number }

const CACHE_MS = 30_000;
const cache = new Map<string, Estado>();

// O papel entra na chave: o resultado guardado para a sessão de CS não pode
// servir a um token de super admin com o mesmo id (nem o contrário).
function chave(p: DonoDaSessao): string {
  if (p.isSuperAdmin === true) return `sa:${p.userId}`;
  if (p.plataforma === 'CS') return `cs:${p.userId}`;
  return `u:${p.tenantId ?? ''}:${p.userId}`;
}

/** Esquece o que está guardado da pessoa, nos dois papéis da plataforma. */
function esquecer(p: DonoDaSessao): void {
  if (daPlataforma(p)) {
    cache.delete(`sa:${p.userId}`);
    cache.delete(`cs:${p.userId}`);
  } else {
    cache.delete(chave(p));
  }
}

/**
 * A leitura roda como "Sistema": toda consulta ao banco pede à auditoria
 * quem está agindo, e a auditoria pergunta a sessão. Sem isto, conferir a
 * sessão pedia a sessão, que conferia de novo, sem fim (o servidor travava
 * e estourava a memória no primeiro pedido de quem estava logado).
 */
function lerEstado(p: DonoDaSessao): Promise<Estado> {
  return runWithAuditContext(SYSTEM_AUDIT_CONTEXT, () => lerEstadoNoBanco(p));
}

async function lerEstadoNoBanco(p: DonoDaSessao): Promise<Estado> {
  if (!pool) return { tv: Number(p.tv) || 0, ok: true, ate: 0 };
  if (daPlataforma(p)) {
    const { rows } = await pool.query(`SELECT data FROM super_admins WHERE id = $1`, [p.userId]);
    const d = (rows[0]?.data ?? null) as Record<string, unknown> | null;
    // O papel do cadastro tem de ser o da sessão: CS promovido ou super admin
    // rebaixado entra de novo, mesmo que a versão não tivesse subido.
    const papelDaSessao = p.isSuperAdmin === true ? 'SUPER_ADMIN' : 'CS';
    const ok = !!d && d.ativo !== false && papelDoCadastro(d) === papelDaSessao;
    return { tv: Number(d?.token_version) || 0, ok, ate: Date.now() + CACHE_MS };
  }
  const { rows } = await pool.query(
    `SELECT u.data, t.status AS tenant_status
       FROM usuarios u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1 AND u.tenant_id = $2`,
    [p.userId, p.tenantId ?? ''],
  );
  const d = (rows[0]?.data ?? null) as Record<string, unknown> | null;
  const ok = !!d
    && d.ativo !== false
    && !semAcessoAoSistema(d.perfil as string | undefined)
    && rows[0]?.tenant_status === 'ativo';
  return { tv: Number(d?.token_version) || 0, ok, ate: Date.now() + CACHE_MS };
}

/** A versão atual do cadastro, para carimbar num token novo. Sem cache. */
export async function versaoAtualDaSessao(p: DonoDaSessao): Promise<number> {
  // Não guarda em cache: no cadastro, o token é emitido antes de a transação
  // que cria a pessoa terminar, e um "não existe" guardado aqui derrubaria a
  // sessão recém-criada.
  esquecer(p);
  return (await lerEstado(p)).tv;
}

/** O token ainda vale? Falha no banco recusa (fecha em vez de abrir). */
export async function sessaoViva(p: DonoDaSessao): Promise<boolean> {
  if (!p?.userId) return false;
  // Token de administrador emitido antes desta versão (sem `tv`) não passou
  // pelo segundo fator: cai uma vez e a pessoa entra de novo com o código.
  if (p.tv === undefined && (daPlataforma(p) || perfilCanonico(p.perfil) === 'ADMIN')) return false;
  const k = chave(p);
  let estado = cache.get(k);
  if (!estado || estado.ate < Date.now()) {
    try {
      estado = await lerEstado(p);
    } catch (e) {
      console.error('[sessao] não consegui conferir a sessão:', e instanceof Error ? e.message : e);
      return false;
    }
    cache.set(k, estado);
    if (cache.size > 5000) {
      for (const [ck, ce] of cache) if (ce.ate < Date.now()) cache.delete(ck);
    }
  }
  return estado.ok && (Number(p.tv) || 0) === estado.tv;
}

/** Derruba todas as sessões abertas da pessoa (sair, troca de senha...). */
export async function revogarSessoes(p: DonoDaSessao): Promise<void> {
  esquecer(p);
  if (!pool) return;
  const incrementa = `jsonb_set(data, '{token_version}', to_jsonb(COALESCE((data->>'token_version')::int, 0) + 1), true)`;
  if (daPlataforma(p)) {
    await pool.query(`UPDATE super_admins SET data = ${incrementa}, updated_at = NOW() WHERE id = $1`, [p.userId]);
  } else {
    await pool.query(
      `UPDATE usuarios SET data = ${incrementa}, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [p.userId, p.tenantId ?? ''],
    );
  }
}

/** Para o serviço de usuários limpar o cache local depois de subir a versão. */
export function esquecerSessaoEmCache(p: DonoDaSessao): void {
  esquecer(p);
}
