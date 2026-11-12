/**
 * Navegador confiável: depois de digitar o código do aplicativo autenticador
 * uma vez, este navegador não pede o código de novo por 30 dias (12/11/2026,
 * mesmo desenho do "dispositivo confiável" do Entur OS CRM).
 *
 * Regras:
 *  - NUNCA pula a senha, só o código;
 *  - janela FIXA de 30 dias a partir do código digitado (usar não renova);
 *  - o selo é assinado com uma chave derivada só para ele: um selo não vale
 *    como sessão, e uma sessão não vale como selo;
 *  - o selo carrega uma impressão da senha e do segredo do autenticador
 *    atuais. Trocar a senha, zerar ou recadastrar o 2FA invalida todos os
 *    navegadores da pessoa, sem tabela nem campo novo no banco;
 *  - sair do sistema não esquece o navegador (como no CRM).
 *
 * Não importa nada do Next, para os testes rodarem sem o servidor.
 */
import { createHash } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';

export const COOKIE_NAVEGADOR = 'entur-navegador';
export const NAVEGADOR_CONFIAVEL_SEGUNDOS = 30 * 24 * 60 * 60;

export type TabelaDoLogin = 'usuarios' | 'super_admins';

let _chave: Uint8Array | null = null;
function chave(): Uint8Array {
  if (!_chave) {
    const base = process.env.JWT_SECRET;
    if (!base) throw new Error('JWT_SECRET environment variable is required.');
    _chave = new Uint8Array(createHash('sha256').update(`navegador-confiavel:${base}`).digest());
  }
  return _chave;
}

/**
 * Impressão da senha e do segredo do autenticador atuais. Sem segredo
 * cadastrado não há o que lembrar (null).
 */
export function impressaoDoCadastro(dados: Record<string, unknown>): string | null {
  const segredo = String(dados.totp_cofre ?? '') || String(dados.totp_segredo ?? '');
  if (!segredo) return null;
  return createHash('sha256')
    .update(`${String(dados.senha_hash ?? '')}\n${segredo}`)
    .digest('base64url')
    .slice(0, 22);
}

export async function emitirSeloDoNavegador(
  tabela: TabelaDoLogin,
  dados: Record<string, unknown>,
  agoraMs = Date.now(),
): Promise<string | null> {
  const imp = impressaoDoCadastro(dados);
  const id = String(dados.id ?? '');
  if (!imp || !id) return null;
  const agora = Math.floor(agoraMs / 1000);
  return new SignJWT({ tab: tabela, imp })
    .setProtectedHeader({ alg: 'HS256', typ: 'navegador' })
    .setSubject(id)
    .setAudience('navegador-confiavel')
    .setIssuedAt(agora)
    .setExpirationTime(agora + NAVEGADOR_CONFIAVEL_SEGUNDOS)
    .sign(chave());
}

/** O selo vale para esta pessoa, com a senha e o 2FA de agora? Nunca lança. */
export async function navegadorConfiavel(
  selo: string | null | undefined,
  tabela: TabelaDoLogin,
  dados: Record<string, unknown>,
  agoraMs = Date.now(),
): Promise<boolean> {
  if (!selo || selo.length > 1024) return false;
  const imp = impressaoDoCadastro(dados);
  if (!imp) return false;
  try {
    const { payload } = await jwtVerify(selo, chave(), {
      audience: 'navegador-confiavel',
      currentDate: new Date(agoraMs),
    });
    return payload.sub === String(dados.id ?? '') && payload.tab === tabela && payload.imp === imp;
  } catch {
    return false;
  }
}

/** Lê o selo do cabeçalho Cookie sem nunca lançar. */
export function seloDoPedido(headers: Headers): string | null {
  const bruto = (headers.get('cookie') || '')
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(`${COOKIE_NAVEGADOR}=`))
    ?.slice(COOKIE_NAVEGADOR.length + 1);
  if (!bruto) return null;
  try {
    return decodeURIComponent(bruto) || null;
  } catch {
    return null;
  }
}

export function opcoesDoCookieDoNavegador() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: NAVEGADOR_CONFIAVEL_SEGUNDOS,
    path: '/',
  };
}

interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Selo emitido logo depois do código certo. Relê o cadastro: no primeiro
 * acesso o segredo acabou de ser gravado e não está no objeto lido antes.
 */
export async function seloDepoisDoCodigo(
  db: Consulta,
  tabela: TabelaDoLogin,
  id: string,
  tenantId?: string,
): Promise<string | null> {
  try {
    const { rows } = tabela === 'usuarios'
      ? await db.query(`SELECT data FROM usuarios WHERE id = $1 AND tenant_id = $2`, [id, tenantId ?? ''])
      : await db.query(`SELECT data FROM super_admins WHERE id = $1`, [id]);
    const dados = rows[0]?.data as Record<string, unknown> | undefined;
    return dados ? await emitirSeloDoNavegador(tabela, dados) : null;
  } catch (e) {
    // Sem o selo a pessoa só digita o código de novo da próxima vez.
    console.error('[navegador] não emiti o selo:', e instanceof Error ? e.message : e);
    return null;
  }
}
