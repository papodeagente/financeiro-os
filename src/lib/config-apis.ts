/**
 * Chaves de API da agência (Anthropic, OpenAI, Amadeus, Google...),
 * guardadas em `config_apis` (FIN-04 e FIN-11, auditoria de 04/11/2026).
 *
 * Antes: a rota devolvia o JSON inteiro, com as chaves em texto, para
 * qualquer pessoa logada, e aceitava qualquer substituição. No banco, as
 * chaves ficavam em texto puro.
 *
 * Agora:
 *  - a tela recebe só a máscara (`sk-a••••••1234`) e `<campo>_definida`;
 *  - mandar a máscara de volta mantém a chave gravada; mandar valor novo troca;
 *    mandar vazio apaga;
 *  - no banco, cada segredo vira `<campo>_cofre` (AES-256-GCM, ./cofre).
 *    Registro antigo em texto é lido e regravado cifrado na primeira leitura.
 *    Sem INTEGRACOES_MASTER_KEY o comportamento antigo continua (texto), com
 *    aviso no log, para a agência não perder as integrações de uma hora para
 *    outra.
 *
 * Não importa nada do Next, para os testes rodarem contra um Postgres real.
 */
import { cifrar, decifrar, cofreDisponivel, mascarar } from './cofre';

export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export const CONFIG_ID = 'apis-config-singleton';
const CAMPOS_SECRETOS = ['api_key', 'api_secret', 'client_secret', 'secret', 'token', 'password'];
const SUFIXO = '_cofre';

type Provedor = Record<string, unknown>;
export type ConfigApis = Record<string, Provedor>;

function eObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Valor que a tela mostra no lugar da chave. Nunca é uma chave de verdade. */
function eMascara(v: unknown): boolean {
  return typeof v === 'string' && v.includes('•');
}

/** Decifra os envelopes. Texto antigo passa como está. */
export function abrir(gravado: unknown): ConfigApis {
  const saida: ConfigApis = {};
  if (!eObjeto(gravado)) return saida;
  for (const [nome, prov] of Object.entries(gravado)) {
    if (!eObjeto(prov)) continue;
    const p: Provedor = {};
    for (const [campo, valor] of Object.entries(prov)) {
      if (campo.endsWith(SUFIXO)) {
        const base = campo.slice(0, -SUFIXO.length);
        try {
          p[base] = decifrar(valor);
        } catch (e) {
          console.error(`[config-apis] não decifrou ${nome}.${base}:`, e instanceof Error ? e.message : e);
          p[base] = '';
        }
      } else if (!(campo in p)) {
        p[campo] = valor;
      }
    }
    saida[nome] = p;
  }
  return saida;
}

/** Cifra os segredos para gravar. Sem cofre, grava como antes (texto). */
export function selar(aberta: ConfigApis): ConfigApis {
  const podeCifrar = cofreDisponivel();
  const saida: ConfigApis = {};
  for (const [nome, prov] of Object.entries(aberta)) {
    const p: Provedor = {};
    for (const [campo, valor] of Object.entries(prov)) {
      if (CAMPOS_SECRETOS.includes(campo) && typeof valor === 'string' && valor && podeCifrar) {
        p[campo + SUFIXO] = cifrar(valor);
      } else {
        p[campo] = valor;
      }
    }
    saida[nome] = p;
  }
  if (!podeCifrar) console.warn('[config-apis] INTEGRACOES_MASTER_KEY ausente: chaves gravadas sem cifra.');
  return saida;
}

/** O que a tela recebe: segredos mascarados. */
export function paraTela(aberta: ConfigApis): ConfigApis {
  const saida: ConfigApis = {};
  for (const [nome, prov] of Object.entries(aberta)) {
    const p: Provedor = { ...prov };
    for (const campo of CAMPOS_SECRETOS) {
      if (campo in p) {
        const valor = String(p[campo] ?? '');
        p[campo] = mascarar(valor);
        p[`${campo}_definida`] = valor.length > 0;
      }
    }
    saida[nome] = p;
  }
  return saida;
}

/**
 * Junta o que a tela mandou com o que está gravado. Máscara de volta mantém
 * a chave atual; provedor que a tela não mandou fica como está.
 */
export function mesclar(recebido: unknown, atual: ConfigApis): ConfigApis {
  const saida: ConfigApis = {};
  for (const [nome, prov] of Object.entries(atual)) saida[nome] = { ...prov };
  if (!eObjeto(recebido)) return saida;
  for (const [nome, prov] of Object.entries(recebido)) {
    if (!eObjeto(prov) || nome.length > 60) continue;
    const p: Provedor = { ...(saida[nome] ?? {}) };
    for (const [campo, valor] of Object.entries(prov)) {
      if (campo.endsWith('_definida') || campo.endsWith(SUFIXO)) continue;
      if (CAMPOS_SECRETOS.includes(campo)) {
        if (eMascara(valor)) continue;
        p[campo] = typeof valor === 'string' ? valor.trim() : '';
      } else if (valor === null || ['string', 'number', 'boolean'].includes(typeof valor)) {
        p[campo] = typeof valor === 'string' ? valor.slice(0, 500) : valor;
      }
    }
    saida[nome] = p;
  }
  return saida;
}

function temTextoSolto(gravado: unknown): boolean {
  if (!eObjeto(gravado)) return false;
  return Object.values(gravado).some(prov =>
    eObjeto(prov) && CAMPOS_SECRETOS.some(c => typeof prov[c] === 'string' && (prov[c] as string).length > 0));
}

async function gravar(db: Consulta, tenantId: string, selada: ConfigApis) {
  // UPDATE e, se não existir, INSERT (ver o histórico da PK composta na rota).
  const r = await db.query(
    `UPDATE config_apis SET data = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    [CONFIG_ID, tenantId, JSON.stringify(selada)],
  );
  if ((r.rowCount ?? 0) === 0) {
    await db.query(
      `INSERT INTO config_apis (id, tenant_id, data, updated_at) VALUES ($1, $2, $3, NOW())`,
      [CONFIG_ID, tenantId, JSON.stringify(selada)],
    );
  }
}

/** Configuração decifrada da agência, para uso no servidor. */
export async function lerConfigApis(db: Consulta, tenantId: string): Promise<ConfigApis> {
  if (!tenantId) return {};
  const { rows } = await db.query(
    `SELECT data FROM config_apis WHERE id = $1 AND tenant_id = $2`,
    [CONFIG_ID, tenantId],
  );
  if (rows.length === 0) return {};
  const gravado = rows[0].data;
  const aberta = abrir(gravado);
  // Registro antigo em texto: regrava cifrado. Falha aqui não impede a leitura.
  if (temTextoSolto(gravado) && cofreDisponivel()) {
    try {
      await gravar(db, tenantId, selar(aberta));
    } catch (e) {
      console.error('[config-apis] migração para o cofre falhou:', e instanceof Error ? e.message : e);
    }
  }
  return aberta;
}

export async function salvarConfigApis(db: Consulta, tenantId: string, recebido: unknown): Promise<ConfigApis> {
  const atual = await lerConfigApis(db, tenantId);
  const nova = mesclar(recebido, atual);
  await gravar(db, tenantId, selar(nova));
  return paraTela(nova);
}

/** Chave da Anthropic da agência, se ligada. */
export async function chaveAnthropic(db: Consulta, tenantId: string, modeloPadrao: string) {
  const cfg = await lerConfigApis(db, tenantId);
  const a = cfg.anthropic;
  if (!a?.ativo || !a.api_key) return null;
  return { api_key: String(a.api_key), modelo: String(a.modelo || modeloPadrao) };
}

/** Chave da OpenAI da agência, se ligada. */
export async function chaveOpenAI(db: Consulta, tenantId: string) {
  const cfg = await lerConfigApis(db, tenantId);
  const o = cfg.openai;
  if (!o?.ativo || !o.api_key) return null;
  return { ...o, api_key: String(o.api_key) } as Provedor & { api_key: string };
}
