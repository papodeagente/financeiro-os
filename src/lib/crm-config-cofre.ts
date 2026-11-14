/**
 * Segredo da integração com o CRM guardado cifrado (auditoria 04/11/2026,
 * FIN-11, a parte que ficou da Entrega A).
 *
 * `crm_config.data` guardava `api_key_entur` e `api_key_crm` (o segredo do
 * HMAC das duas direções) em texto puro: um dump do banco dava a qualquer um
 * o poder de assinar eventos de venda para qualquer agência.
 *
 * Agora o segredo vai num envelope do cofre (`<campo>_cofre`, AES-256-GCM,
 * chave em INTEGRACOES_MASTER_KEY). Todo leitor passa por `abrirCrmConfig`;
 * todo gravador por `selarCrmConfig`. Registro antigo em texto continua
 * funcionando e é regravado cifrado na primeira leitura.
 * Sem a chave mestra no ambiente, grava como antes (texto), com aviso.
 */
import { cifrar, cofreDisponivel, decifrar } from './cofre';
import { ehAgenciaDemo } from './demo/saidas';

const SEGREDOS = ['api_key_entur', 'api_key_crm'] as const;
const SUFIXO = '_cofre';

export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

type Dados = Record<string, unknown>;

/** Devolve a config com os segredos em claro (só para uso no servidor). */
export function abrirCrmConfig<T extends Dados | null | undefined>(gravado: T): T {
  if (!gravado || typeof gravado !== 'object') return gravado;
  const d: Dados = { ...gravado };
  for (const campo of SEGREDOS) {
    const envelope = d[campo + SUFIXO];
    if (!envelope) continue;
    try {
      d[campo] = decifrar(envelope);
    } catch (e) {
      console.error(`[crm-config] não decifrou ${campo}:`, e instanceof Error ? e.message : e);
      d[campo] = '';
    }
  }
  return d as T;
}

/** Prepara para gravar: segredo em envelope, sem o texto. */
export function selarCrmConfig(aberta: Dados, anterior?: Dados | null): Dados {
  const d: Dados = { ...aberta };
  const podeCifrar = cofreDisponivel();
  for (const campo of SEGREDOS) {
    const valor = d[campo];
    if (typeof valor === 'string' && valor) {
      if (podeCifrar) {
        d[campo + SUFIXO] = cifrar(valor);
        delete d[campo];
      } else {
        delete d[campo + SUFIXO];
      }
    } else {
      // Sem valor novo: mantém o envelope que já estava (inclusive o que não
      // decifrou por chave mestra trocada), nunca apaga o segredo calado.
      delete d[campo];
      const antigo = anterior?.[campo + SUFIXO];
      if (antigo) d[campo + SUFIXO] = antigo;
      else delete d[campo + SUFIXO];
    }
  }
  if (!podeCifrar) console.warn('[crm-config] INTEGRACOES_MASTER_KEY ausente: segredo do CRM gravado sem cifra.');
  return d;
}

/** Lê a config do tenant, já aberta, e regrava cifrado o registro antigo em texto. */
export async function lerCrmConfig(db: Consulta, tenantId: string): Promise<Dados | null> {
  // Agência de demonstração (14/11/2026): nunca tem CRM. Todo envio ao CRM
  // (e-mail, WhatsApp, avisos) lê a config por aqui e não acha nada.
  if (await ehAgenciaDemo(db, tenantId)) return null;
  const { rows } = await db.query(
    "SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
    [tenantId],
  );
  if (rows.length === 0) return null;
  const gravado = (rows[0].data ?? {}) as Dados;
  const aberta = abrirCrmConfig(gravado);
  const temTexto = SEGREDOS.some(c => typeof gravado[c] === 'string' && gravado[c]);
  if (temTexto && cofreDisponivel()) {
    try {
      await db.query(
        // Só se ninguém gravou no meio: senão esta regravação devolveria o
        // segredo antigo por cima do novo que o administrador acabou de salvar.
        "UPDATE crm_config SET data = $2::jsonb, updated_at = NOW() WHERE id = 'singleton' AND tenant_id = $1 AND data = $3::jsonb",
        [tenantId, JSON.stringify(selarCrmConfig(aberta, gravado)), JSON.stringify(gravado)],
      );
    } catch (e) {
      console.error('[crm-config] não regravou cifrado:', e instanceof Error ? e.message : e);
    }
  }
  return aberta;
}
