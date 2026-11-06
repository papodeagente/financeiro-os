/**
 * Configurações › Cobrança no formato da tela (parte B, contrato-telas.ts)
 * e de volta. Puro: testado em scripts/test-cobranca.ts.
 *
 * Na tela, juros/multa/desconto aparecem sempre como números; quando nada
 * foi gravado ainda, são os da política de Configurações › Financeiro
 * (`encargos_da_politica: true`). Gravar com números = a cobrança passa a
 * ter os próprios.
 */
import { normalizarPolitica, type PoliticaCobranca } from '../baixa-calculo';
import { num } from '../money';
import { CAPACIDADES_ASAAS } from './asaas';
import { CAPACIDADES_PAGARME } from './pagarme';
import { encargosDaCobranca, type CanalCobranca, type ConfigCobranca } from './config';
import type { CapacidadesCobranca, ProvedorCobranca, TipoEmissao } from './tipos';

export interface ConfigNaTela {
  provedor_padrao: ProvedorCobranca | '';
  tipo_padrao: TipoEmissao;
  conta_bancaria_id: string;
  juros_am_pct: number;
  multa_pct: number;
  desconto_pct: number;
  desconto_dias: number;
  encargos_da_politica: boolean;
  regua: { ligada: boolean; dias: number[]; canais: { email: boolean; whatsapp: boolean } };
  descricao_modelo: string;
  provedores: Array<{ id: ProvedorCobranca; conectado: boolean; capacidades: CapacidadesCobranca; conta_bancaria_id: string }>;
  tolerancia_dias: number;
  pagarme_conta_psp: boolean;
  notificacoes_do_provedor: boolean;
  dias_link: number;
  encargos: ReturnType<typeof encargosDaCobranca>;
  politica_cobranca: PoliticaCobranca | null;
}

export function configParaTela(
  config: ConfigCobranca,
  politica: PoliticaCobranca | null,
  integracoes: Array<{ plataforma: string; ativo: boolean; conta_bancaria_id: string }>,
): ConfigNaTela {
  const p = normalizarPolitica(politica ?? {});
  const dePolitica = config.usar_politica;
  const desconto = dePolitica ? p.desconto_antecipacao : config.desconto;
  const integracao = (id: ProvedorCobranca) => integracoes.find(i => i.plataforma === id);
  return {
    provedor_padrao: config.provedor_padrao,
    tipo_padrao: config.tipo_padrao,
    conta_bancaria_id: config.conta_bancaria_id,
    juros_am_pct: dePolitica ? num(p.juros_am_pct) : config.juros_am_pct,
    multa_pct: dePolitica ? num(p.multa_pct) : config.multa_pct,
    desconto_pct: desconto ? desconto.pct : 0,
    desconto_dias: desconto ? desconto.dias : 0,
    encargos_da_politica: dePolitica,
    regua: {
      ligada: config.regua.ligada,
      dias: config.regua.dias,
      canais: { email: config.regua.canais.includes('email'), whatsapp: config.regua.canais.includes('whatsapp') },
    },
    descricao_modelo: config.descricao_modelo,
    provedores: (['asaas', 'pagarme'] as const).map(id => ({
      id,
      conectado: integracao(id)?.ativo === true,
      capacidades: id === 'asaas' ? CAPACIDADES_ASAAS : CAPACIDADES_PAGARME,
      conta_bancaria_id: integracao(id)?.conta_bancaria_id ?? '',
    })),
    tolerancia_dias: dePolitica ? num(p.tolerancia_dias) : config.tolerancia_dias,
    pagarme_conta_psp: config.pagarme_conta_psp,
    notificacoes_do_provedor: config.notificacoes_do_provedor,
    dias_link: config.dias_link,
    encargos: encargosDaCobranca(config, politica),
    politica_cobranca: politica,
  };
}

/** O que a tela mandou, sobre a configuração atual (o que não veio fica como está). */
export function configDaTela(
  atual: ConfigCobranca,
  politica: PoliticaCobranca | null,
  corpo: Partial<ConfigNaTela> & Partial<ConfigCobranca>,
): ConfigCobranca {
  const nova: ConfigCobranca = { ...atual };
  const copiar = <K extends keyof ConfigCobranca>(k: K) => { if (corpo[k] !== undefined) nova[k] = corpo[k] as ConfigCobranca[K]; };
  for (const k of ['provedor_padrao', 'tipo_padrao', 'conta_bancaria_id', 'pagarme_conta_psp', 'notificacoes_do_provedor',
    'descricao_modelo', 'dias_link'] as const) copiar(k);

  const mexeuEncargos = ['juros_am_pct', 'multa_pct', 'desconto_pct', 'desconto_dias', 'tolerancia_dias', 'desconto']
    .some(k => (corpo as Record<string, unknown>)[k] !== undefined);
  if (corpo.usar_politica === true) {
    nova.usar_politica = true;
  } else if (mexeuEncargos || corpo.usar_politica === false) {
    // Passa a ter números próprios: o que não veio parte da política (o que a tela mostrava).
    const base = atual.usar_politica ? normalizarPolitica(politica ?? {}) : null;
    nova.usar_politica = false;
    nova.juros_am_pct = num(corpo.juros_am_pct ?? (base ? base.juros_am_pct : atual.juros_am_pct));
    nova.multa_pct = num(corpo.multa_pct ?? (base ? base.multa_pct : atual.multa_pct));
    nova.tolerancia_dias = num(corpo.tolerancia_dias ?? (base ? base.tolerancia_dias : atual.tolerancia_dias));
    const descAtual = base ? base.desconto_antecipacao ?? null : atual.desconto;
    const pct = corpo.desconto_pct ?? corpo.desconto?.pct ?? descAtual?.pct ?? 0;
    const dias = corpo.desconto_dias ?? corpo.desconto?.dias ?? descAtual?.dias ?? 0;
    nova.desconto = num(pct) > 0 && num(dias) > 0 ? { pct: num(pct), dias: num(dias) } : null;
  }

  if (corpo.regua) {
    const r = corpo.regua as { ligada?: boolean; dias?: number[]; canais?: unknown };
    const canais: CanalCobranca[] = Array.isArray(r.canais)
      ? r.canais.filter((c): c is CanalCobranca => c === 'email' || c === 'whatsapp')
      : r.canais && typeof r.canais === 'object'
        ? (['email', 'whatsapp'] as const).filter(c => (r.canais as Record<string, unknown>)[c] === true)
        : atual.regua.canais;
    nova.regua = {
      ligada: r.ligada ?? atual.regua.ligada,
      dias: Array.isArray(r.dias) ? r.dias : atual.regua.dias,
      canais,
    };
  }
  return nova;
}
