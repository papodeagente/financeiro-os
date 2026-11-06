/**
 * Configurações › Cobrança (05/11/2026). Guardada em `agencia.data.cobranca`.
 *
 * Juros, multa e desconto: por padrão os da política de cobrança de
 * Configurações › Financeiro (a mesma que a liquidação sugere), para o
 * boleto e a baixa falarem a mesma língua. A agência pode escolher outros
 * só para o documento.
 */
import { normalizarPolitica, type PoliticaCobranca } from '../baixa-calculo';
import { num } from '../money';
import type { ExecutorSQL } from '../caixa-atomico';
import { ehProvedorCobranca, type EncargosDaCobranca, type ProvedorCobranca, type TipoEmissao } from './tipos';
import { empresaComConfigPropria, lerChavesDaEmpresa } from '../empresas-config';

export type CanalCobranca = 'email' | 'whatsapp';

export interface ReguaDeCobranca {
  /** Só avisa quando a agência ligar. */
  ligada: boolean;
  /** Dias em relação ao vencimento: −5 = cinco dias antes; 0 = no dia; 3 = três dias depois. */
  dias: number[];
  canais: CanalCobranca[];
}

export interface ConfigCobranca {
  /** '' = nenhum escolhido ainda (a tela pede). */
  provedor_padrao: ProvedorCobranca | '';
  tipo_padrao: TipoEmissao;
  /** Conta bancária onde a baixa entra. Vazio = a conta da integração. */
  conta_bancaria_id: string;
  /** true: juros, multa e desconto vêm da política de Configurações › Financeiro. */
  usar_politica: boolean;
  juros_am_pct: number;
  multa_pct: number;
  tolerancia_dias: number;
  desconto: { pct: number; dias: number } | null;
  /** A conta Pagar.me liquida pelo Pagar.me (PSP): só assim juros, multa e desconto vão no boleto. */
  pagarme_conta_psp: boolean;
  /** Deixa o provedor mandar os avisos dele ao cliente (padrão: não; a régua é pelo CRM). */
  notificacoes_do_provedor: boolean;
  /** Modelo da descrição da cobrança: aceita {descricao}, {parcela} e {agencia}; sem marcador, abre a descrição. */
  descricao_modelo: string;
  /** Validade do link de pagamento, em dias. */
  dias_link: number;
  regua: ReguaDeCobranca;
}

export const DIAS_DA_REGUA_PADRAO = [-5, 0, 1, 3, 7];

export const CONFIG_COBRANCA_PADRAO: ConfigCobranca = {
  provedor_padrao: '',
  tipo_padrao: 'boleto_pix',
  conta_bancaria_id: '',
  usar_politica: true,
  juros_am_pct: 0,
  multa_pct: 0,
  tolerancia_dias: 0,
  desconto: null,
  pagarme_conta_psp: false,
  notificacoes_do_provedor: false,
  descricao_modelo: '',
  dias_link: 7,
  regua: { ligada: false, dias: DIAS_DA_REGUA_PADRAO, canais: ['email'] },
};

const limitar = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, num(v)));

export function normalizarRegua(v: unknown): ReguaDeCobranca {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<ReguaDeCobranca>;
  const dias = Array.isArray(r.dias)
    ? [...new Set(r.dias.map(d => Math.round(num(d))).filter(d => d >= -30 && d <= 60))].sort((a, b) => a - b).slice(0, 10)
    : DIAS_DA_REGUA_PADRAO;
  const canais = Array.isArray(r.canais)
    ? [...new Set(r.canais.filter((c): c is CanalCobranca => c === 'email' || c === 'whatsapp'))]
    : ['email' as CanalCobranca];
  return { ligada: r.ligada === true, dias, canais };
}

export function normalizarConfigCobranca(v: unknown): ConfigCobranca {
  const c = (v && typeof v === 'object' ? v : {}) as Partial<ConfigCobranca>;
  const tipo = c.tipo_padrao === 'boleto' || c.tipo_padrao === 'pix' || c.tipo_padrao === 'boleto_pix' ? c.tipo_padrao : 'boleto_pix';
  const d = c.desconto;
  return {
    provedor_padrao: ehProvedorCobranca(c.provedor_padrao) ? c.provedor_padrao : '',
    tipo_padrao: tipo,
    conta_bancaria_id: typeof c.conta_bancaria_id === 'string' ? c.conta_bancaria_id.trim() : '',
    usar_politica: c.usar_politica !== false,
    juros_am_pct: limitar(c.juros_am_pct, 0, 20),
    multa_pct: limitar(c.multa_pct, 0, 20),
    tolerancia_dias: Math.round(limitar(c.tolerancia_dias, 0, 60)),
    desconto: d && num(d.pct) > 0 && num(d.dias) > 0
      ? { pct: limitar(d.pct, 0, 50), dias: Math.round(limitar(d.dias, 1, 60)) }
      : null,
    pagarme_conta_psp: c.pagarme_conta_psp === true,
    notificacoes_do_provedor: c.notificacoes_do_provedor === true,
    descricao_modelo: typeof c.descricao_modelo === 'string' ? c.descricao_modelo.trim().slice(0, 200) : '',
    dias_link: Math.round(limitar(c.dias_link ?? 7, 1, 90)),
    regua: normalizarRegua(c.regua),
  };
}

/** Juros, multa e desconto que vão no documento. Null quando nada vai. */
export function encargosDaCobranca(config: ConfigCobranca, politica: PoliticaCobranca | null): EncargosDaCobranca | null {
  const fonte = config.usar_politica
    ? (() => {
        const p = normalizarPolitica(politica ?? {});
        return {
          juros_am_pct: num(p.juros_am_pct), multa_pct: num(p.multa_pct),
          tolerancia_dias: num(p.tolerancia_dias), desconto: p.desconto_antecipacao ?? null,
        };
      })()
    : { juros_am_pct: config.juros_am_pct, multa_pct: config.multa_pct, tolerancia_dias: config.tolerancia_dias, desconto: config.desconto };
  if (fonte.juros_am_pct <= 0 && fonte.multa_pct <= 0 && !fonte.desconto) return null;
  return fonte;
}

/** Configuração e política da agência, numa leitura. */
export async function lerConfigCobranca(
  exec: ExecutorSQL, tenantId: string, empresaId?: string | null,
): Promise<{ config: ConfigCobranca; politica: PoliticaCobranca | null; nome_agencia: string }> {
  // Empresa com configuração própria (E7): a cobrança e a política dela; no
  // resto, as da agência. Uma empresa só: exatamente a leitura de sempre.
  if (empresaComConfigPropria(empresaId)) {
    const c = await lerChavesDaEmpresa(exec, tenantId, empresaId, ['cobranca', 'politica_cobranca', 'nome_fantasia', 'nome', 'razao_social']);
    const { rows: emp } = await exec.query(`SELECT nome FROM empresas WHERE tenant_id = $1 AND id = $2`, [tenantId, empresaId]);
    return {
      config: normalizarConfigCobranca(c.cobranca ?? null),
      politica: (c.politica_cobranca as PoliticaCobranca | null) ?? null,
      nome_agencia: String(emp[0]?.nome ?? c.nome_fantasia ?? c.nome ?? c.razao_social ?? ''),
    };
  }
  const { rows } = await exec.query(
    `SELECT data->'cobranca' AS c, data->'politica_cobranca' AS p,
            COALESCE(data->>'nome_fantasia', data->>'nome', data->>'razao_social', '') AS nome
       FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return {
    config: normalizarConfigCobranca(rows[0]?.c ?? null),
    politica: (rows[0]?.p as PoliticaCobranca | null) ?? null,
    nome_agencia: String(rows[0]?.nome ?? ''),
  };
}
