/**
 * Segundo fator (TOTP, RFC 6238) para quem administra (FIN-12, auditoria de
 * 04/11/2026). Vale para o ADMIN da agência e para o superadmin da plataforma.
 *
 * Fluxo no login, sem estado guardado no servidor entre as etapas:
 *  1. senha certa e a pessoa ainda não tem 2FA: a resposta traz um segredo
 *     novo (`precisa_cadastrar`). A tela mostra o segredo para o app
 *     autenticador;
 *  2. a tela reenvia e-mail, senha, o segredo e o primeiro código. A senha é
 *     conferida de novo; o código prova que o app foi configurado; o segredo
 *     é gravado no cofre e a sessão sai;
 *  3. dali em diante, senha certa sem código responde `precisa_codigo`.
 *
 * Cada código vale uma vez só (guarda o último passo usado), e aceita um passo
 * de folga para relógio de celular adiantado ou atrasado.
 *
 * Não importa nada do Next, para os testes rodarem contra um Postgres real.
 */
import { createHmac, randomBytes } from 'crypto';
import { cifrar, decifrar, cofreDisponivel } from './cofre';
import { perfilCanonico } from './permissoes';

export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

const PASSO_S = 30;
const DIGITOS = 6;
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function exigeSegundoFator(perfil: string | undefined, isSuperAdmin = false): boolean {
  return isSuperAdmin || perfilCanonico(perfil) === 'ADMIN';
}

/**
 * O login pede o código? Administrador sempre (FIN-12); quem não é
 * administrador, só depois de cadastrar o aplicativo (para pagar, E7). Quem
 * não cadastrou entra com a senha e é levado a cadastrar na hora de pagar.
 */
export function loginPedeSegundoFator(usuario: Record<string, unknown>): boolean {
  return exigeSegundoFator(usuario.perfil as string | undefined) || segredoGravado(usuario) !== null;
}

export function base32(bytes: Uint8Array): string {
  let bits = 0, valor = 0, saida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, valor = 0;
  const saida: number[] = [];
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error('Segredo inválido.');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

export function gerarSegredo(): string {
  return base32(randomBytes(20));
}

export function codigoDoPasso(segredo: string, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', deBase32(segredo)).update(contador).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

/** Devolve o passo do código, se ele vale agora (±1 passo); senão null. */
export function passoDoCodigo(segredo: string, codigo: string, agoraMs = Date.now()): number | null {
  const c = String(codigo ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const atual = Math.floor(agoraMs / 1000 / PASSO_S);
  for (const passo of [atual, atual - 1, atual + 1]) {
    if (codigoDoPasso(segredo, passo) === c) return passo;
  }
  return null;
}

export function uriOtpauth(segredo: string, conta: string, emissor = 'Entur OS Financeiro'): string {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=30`;
}

/** Segredo gravado da pessoa, ou null se ela ainda não cadastrou. */
export function segredoGravado(dados: Record<string, unknown>): string | null {
  if (dados.totp_cofre) {
    try { return decifrar(dados.totp_cofre); } catch { return null; }
  }
  return typeof dados.totp_segredo === 'string' && dados.totp_segredo ? dados.totp_segredo : null;
}

function camposDoSegredo(segredo: string): Record<string, unknown> {
  return cofreDisponivel() ? { totp_cofre: cifrar(segredo) } : { totp_segredo: segredo };
}

export type ResultadoSegundoFator =
  | { ok: true }
  | { ok: false; status: 401; corpo: Record<string, unknown>; contaComoFalha: boolean };

/**
 * Etapa do 2FA depois da senha conferida. `tabela` é 'usuarios' ou
 * 'super_admins'. Grava o segredo no cadastro e marca o passo usado.
 */
export async function etapaSegundoFator(
  db: Consulta,
  tabela: 'usuarios' | 'super_admins',
  dados: Record<string, unknown>,
  corpo: { codigo?: unknown; segredo_novo?: unknown },
  agoraMs = Date.now(),
): Promise<ResultadoSegundoFator> {
  const id = String(dados.id ?? '');
  const codigo = typeof corpo.codigo === 'string' ? corpo.codigo : '';
  const gravado = segredoGravado(dados);

  if (!gravado) {
    const novo = typeof corpo.segredo_novo === 'string' ? corpo.segredo_novo.replace(/\s+/g, '').toUpperCase() : '';
    if (!novo || !/^[A-Z2-7]{32}$/.test(novo) || !codigo) {
      const segredo = gerarSegredo();
      return {
        ok: false, status: 401, contaComoFalha: false,
        corpo: {
          precisa_cadastrar: true,
          segredo,
          uri: uriOtpauth(segredo, String(dados.email ?? '')),
          error: 'Administradores entram com senha e código do aplicativo autenticador. Cadastre agora.',
        },
      };
    }
    const passo = passoDoCodigo(novo, codigo, agoraMs);
    if (passo === null) {
      return {
        ok: false, status: 401, contaComoFalha: true,
        corpo: { precisa_cadastrar: true, segredo: novo, uri: uriOtpauth(novo, String(dados.email ?? '')), error: 'Código inválido. Confira o aplicativo e tente de novo.' },
      };
    }
    // Só grava se ninguém cadastrou no meio do caminho.
    const r = await db.query(
      `UPDATE ${tabela} SET data = data || $2::jsonb, updated_at = NOW()
        WHERE id = $1 AND data->'totp_cofre' IS NULL AND COALESCE(data->>'totp_segredo', '') = ''`,
      [id, JSON.stringify({ ...camposDoSegredo(novo), totp_ultimo_passo: passo })],
    );
    if ((r.rowCount ?? 0) === 0) {
      return { ok: false, status: 401, contaComoFalha: true, corpo: { precisa_codigo: true, error: 'Digite o código do aplicativo autenticador.' } };
    }
    return { ok: true };
  }

  if (!codigo) {
    return { ok: false, status: 401, contaComoFalha: false, corpo: { precisa_codigo: true, error: 'Digite o código do aplicativo autenticador.' } };
  }
  const passo = passoDoCodigo(gravado, codigo, agoraMs);
  if (passo === null) {
    return { ok: false, status: 401, contaComoFalha: true, corpo: { precisa_codigo: true, error: 'Código inválido.' } };
  }
  // Código já usado (ou um anterior a ele) não vale de novo.
  const r = await db.query(
    `UPDATE ${tabela}
        SET data = jsonb_set(data, '{totp_ultimo_passo}', to_jsonb($2::bigint), true), updated_at = NOW()
      WHERE id = $1 AND COALESCE((data->>'totp_ultimo_passo')::bigint, 0) < $2::bigint`,
    [id, passo],
  );
  if ((r.rowCount ?? 0) === 0) {
    return { ok: false, status: 401, contaComoFalha: true, corpo: { precisa_codigo: true, error: 'Este código já foi usado. Espere o próximo.' } };
  }
  return { ok: true };
}
