/**
 * COMISSÃO DO MÊS QUE VEM DO CRM (decisões D31 a D40, 05/11/2026).
 *
 * A Área Comercial do CRM (conta 150002) apura a comissão da equipe comercial
 * da Entur (vendedor pelo ACV, CS pelos 3 primeiros meses) e, no dia 1º de
 * cada mês, manda UM extrato por pessoa e competência: o evento
 * COMISSAO_DO_MES. Ele só entra na conta de perfil ecossistema (o financeiro
 * da Entur, perfil-da-conta.ts) e vira uma linha em `comissoes` (origem
 * 'crm') e UMA conta a pagar PENDENTE pelo gancho de toda comissão
 * (comissao-conta.ts). Quando essa conta é paga por inteiro, o aviso
 * COMISSAO_PAGA volta ao CRM pela fila de saída (crm_eventos_saida).
 *
 * A comissão por faixas da meta de MRR (comissao-mrr.ts) deixa de gerar
 * comissão enquanto a fonte da comissão da conta for o CRM, que é o padrão:
 * a meta fica só como acompanhamento.
 *
 * Contrato completo, com exemplos: docs/integracao-crm.md.
 * O lado do banco: comissao-do-crm-servidor.ts.
 *
 * Só regra: nada de banco, nada de rede, nada de relógio.
 */
import { addMeses, deCentavos, num, paraCentavos, somaPor, ultimoDiaDoMes } from './money';

export const TIPO_COMISSAO_DO_MES = 'COMISSAO_DO_MES';
export const TIPO_COMISSAO_PAGA = 'COMISSAO_PAGA';
/** A versão do extrato que este financeiro entende. */
export const VERSAO_DO_EXTRATO = 1;
export const PREFIXO_DA_COMISSAO_DO_CRM = 'comissao-crm-';

// ============================================================
// De onde vem a comissão da conta
// ============================================================

/**
 * 'crm' (padrão): a comissão chega pronta do CRM e a geração por faixas da
 * meta de MRR recusa. 'mrr': as faixas voltam a valer. Mora em
 * `tenants.data.fonte_da_comissao`; só 'mrr' gravado ali troca a fonte.
 */
export type FonteDaComissao = 'crm' | 'mrr';

export const AVISO_COMISSAO_VEM_DO_CRM = 'A comissão agora vem do CRM (Área Comercial). As metas de MRR seguem só para acompanhamento.';

export function fonteDosDados(data: unknown): FonteDaComissao {
  return data && typeof data === 'object' && (data as Record<string, unknown>).fonte_da_comissao === 'mrr' ? 'mrr' : 'crm';
}

/** A recusa da geração por faixas enquanto a comissão vem do CRM. */
export class ComissaoVemDoCrm extends Error {
  readonly status = 409;
  constructor() {
    super(AVISO_COMISSAO_VEM_DO_CRM);
    this.name = 'ComissaoVemDoCrm';
  }
}

// ============================================================
// O extrato
// ============================================================

export interface LinhaDoExtrato {
  /** A conta do cliente no CRM. */
  contaId: number | string | null;
  conta: string;
  /** Modelo de comissão da venda (o novo, pelo ACV, ou o anterior). */
  modelo: string;
  /** 'vendedor' ou 'cs'. */
  papel: string;
  parcela: number | string | null;
  tipo: string;
  /** Em centavos; negativa quando é estorno. */
  valorCents: number;
  gatilho: string;
  gatilhoEm: string;
}

export interface BeneficiarioDoExtrato {
  /** O id do usuário no CRM, como veio (número ou texto). */
  usuarioId: number | string;
  nome: string;
  email: string;
}

export interface ExtratoDoMes {
  eventId: string;
  versao: number;
  /** 'AAAA-MM'. */
  competencia: string;
  beneficiario: BeneficiarioDoExtrato;
  /** O id do usuário no CRM em texto, sem o prefixo crm_user_: é o que vai no id da comissão. */
  usuarioId: string;
  brutoCents: number;
  compensadoCents: number;
  totalCents: number;
  linhas: LinhaDoExtrato[];
  geradoEm: string;
}

export type Leitura<T> = { ok: true; valor: T } | { ok: false; motivo: string };

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_DO_USUARIO = /^[A-Za-z0-9_-]{1,64}$/;
/** R$ 10 bilhões: acima disso é número quebrado, não comissão. */
const LIMITE_DE_CENTAVOS = 1_000_000_000_000;
const MAXIMO_DE_LINHAS = 2000;

const texto = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';

const centavos = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= LIMITE_DE_CENTAVOS ? v : null;

export const reais = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Lê o payload do COMISSAO_DO_MES. Nada é presumido: campo faltando ou conta
 * que não fecha é recusa com o motivo em palavras, para o CRM mostrar.
 *
 * `eventId` é o id do evento (o do envelope, que é a chave de idempotência);
 * o `eventId` do payload, quando vem, precisa ser o mesmo. `mesAtual` barra
 * competência que ainda não começou.
 */
export function lerExtratoDoCrm(bruto: unknown, ctx: { eventId: string; mesAtual?: string }): Leitura<ExtratoDoMes> {
  const recusa = (motivo: string): Leitura<ExtratoDoMes> => ({ ok: false, motivo });
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return recusa('O extrato não veio: o payload precisa ser um objeto.');
  const p = bruto as Record<string, unknown>;

  if (p.tipo !== undefined && p.tipo !== TIPO_COMISSAO_DO_MES) return recusa(`O payload diz ser "${texto(p.tipo, 60)}", e não ${TIPO_COMISSAO_DO_MES}.`);
  const versao = p.versao === undefined ? VERSAO_DO_EXTRATO : p.versao;
  if (versao !== VERSAO_DO_EXTRATO) return recusa(`Versão do extrato não suportada (${texto(versao, 20) || 'vazia'}): este financeiro entende a versão ${VERSAO_DO_EXTRATO}.`);

  const doEnvelope = texto(ctx.eventId, 500);
  const doPayload = p.eventId === undefined || p.eventId === null ? '' : texto(p.eventId, 500);
  const eventId = doPayload || doEnvelope;
  if (!eventId) return recusa('Falta o eventId do extrato.');
  if (eventId.length > 200) return recusa('O eventId precisa ter até 200 caracteres.');
  if (doPayload && doEnvelope && doPayload !== doEnvelope) return recusa(`O eventId do extrato (${doPayload}) não é o id do evento (${doEnvelope}): os dois precisam ser iguais.`);

  if (typeof p.competencia !== 'string' || !MES.test(p.competencia)) return recusa('A competência precisa estar no formato AAAA-MM (ex.: 2026-11).');
  const competencia = p.competencia;
  if (ctx.mesAtual && competencia > ctx.mesAtual) return recusa(`A competência ${competencia} ainda não começou.`);

  const b = p.beneficiario;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return recusa('Falta o beneficiário (usuarioId, nome e email).');
  const ben = b as Record<string, unknown>;
  let usuarioId = '';
  if (typeof ben.usuarioId === 'number' && Number.isSafeInteger(ben.usuarioId) && ben.usuarioId > 0) usuarioId = String(ben.usuarioId);
  else if (typeof ben.usuarioId === 'string') usuarioId = ben.usuarioId.trim().replace(/^crm_user_/, '');
  if (!ID_DO_USUARIO.test(usuarioId)) return recusa('O usuarioId do beneficiário precisa ser o id do usuário no CRM.');
  const nome = texto(ben.nome, 120);
  if (!nome) return recusa('Falta o nome do beneficiário.');
  const email = texto(ben.email, 200).toLowerCase();

  const brutoCents = centavos(p.brutoCents);
  const compensadoCents = centavos(p.compensadoCents);
  const totalCents = centavos(p.totalCents);
  if (brutoCents === null) return recusa('brutoCents precisa ser um número inteiro de centavos.');
  if (compensadoCents === null) return recusa('compensadoCents precisa ser um número inteiro de centavos.');
  if (totalCents === null) return recusa('totalCents precisa ser um número inteiro de centavos.');
  if (compensadoCents < 0) return recusa('compensadoCents não pode ser negativo: é o quanto do bruto cobriu saldo negativo de mês anterior.');
  if (totalCents < 0) return recusa('totalCents não pode ser negativo.');
  if (brutoCents - compensadoCents !== totalCents) return recusa('Os números não fecham: brutoCents menos compensadoCents precisa dar totalCents.');

  if (!Array.isArray(p.linhas)) return recusa('linhas precisa ser uma lista (pode ser vazia).');
  if (p.linhas.length > MAXIMO_DE_LINHAS) return recusa(`Linhas demais no extrato (até ${MAXIMO_DE_LINHAS}).`);
  const linhas: LinhaDoExtrato[] = [];
  for (const [i, l] of (p.linhas as unknown[]).entries()) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) return recusa(`A linha ${i + 1} do extrato não é um objeto.`);
    const r = l as Record<string, unknown>;
    const valorCents = centavos(r.valorCents);
    if (valorCents === null) return recusa(`A linha ${i + 1} do extrato não tem valorCents inteiro.`);
    linhas.push({
      contaId: typeof r.contaId === 'number' && Number.isFinite(r.contaId) ? r.contaId : texto(r.contaId, 64) || null,
      conta: texto(r.conta, 160),
      modelo: texto(r.modelo, 40),
      papel: texto(r.papel, 40),
      parcela: typeof r.parcela === 'number' && Number.isFinite(r.parcela) ? r.parcela : texto(r.parcela, 20) || null,
      tipo: texto(r.tipo, 40),
      valorCents,
      gatilho: texto(r.gatilho, 200),
      gatilhoEm: texto(r.gatilhoEm, 40),
    });
  }
  const somaDasLinhas = somaPor(linhas, l => deCentavos(l.valorCents));
  if (somaDasLinhas !== deCentavos(brutoCents)) {
    return recusa(`A soma das linhas (${reais(somaDasLinhas)}) não é o bruto do extrato (${reais(deCentavos(brutoCents))}).`);
  }

  const geradoEm = texto(p.geradoEm, 40);
  if (!geradoEm || !Number.isFinite(Date.parse(geradoEm))) return recusa('Falta geradoEm (data e hora em que o CRM gerou o extrato, ISO 8601).');

  return {
    ok: true,
    valor: {
      eventId, versao: VERSAO_DO_EXTRATO, competencia,
      beneficiario: { usuarioId: typeof ben.usuarioId === 'number' ? ben.usuarioId : usuarioId, nome, email },
      usuarioId, brutoCents, compensadoCents, totalCents, linhas, geradoEm,
    },
  };
}

// ============================================================
// Nomes, datas e textos
// ============================================================

export const idDaComissaoDoCrm = (competencia: string, usuarioId: string) => `${PREFIXO_DA_COMISSAO_DO_CRM}${competencia}-${usuarioId}`;

export const ehComissaoDoCrm = (id: unknown): boolean => typeof id === 'string' && id.startsWith(PREFIXO_DA_COMISSAO_DO_CRM);

/** O id do aviso COMISSAO_PAGA na fila de saída: um por conta a pagar. */
export const idDoAvisoDeComissaoPaga = (tenantId: string, contaPagarId: string) => `comissao-paga:${tenantId}:${contaPagarId}`;

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** '2026-11' → 'novembro/2026'. */
export function mesPorExtenso(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return `${MESES[m - 1] ?? competencia}/${a}`;
}

/** "Comissão de novembro/2026, Luan Amador": a descrição da conta a pagar. */
export function descricaoDaComissaoDoCrm(competencia: string, nome: string): string {
  return `Comissão de ${mesPorExtenso(competencia)}, ${nome.trim() || 'pessoa da equipe comercial'}`;
}

/** Vence no dia 10 do mês seguinte à competência. */
export function vencimentoDaComissaoDoCrm(competencia: string): string {
  return addMeses(`${competencia}-10`, 1);
}

function ultimoDiaDaCompetencia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return `${competencia}-${String(ultimoDiaDoMes(a, m)).padStart(2, '0')}`;
}

// ============================================================
// A linha em `comissoes`
// ============================================================

/** O que a comissão do CRM guarda além do que toda comissão guarda. */
export interface DetalheDaComissaoDoCrm {
  competencia: string;
  usuario_id: string;
  beneficiario: BeneficiarioDoExtrato;
  /** O eventId da versão que vale (vai de volta no COMISSAO_PAGA). */
  evento_id: string;
  versao: number;
  bruto_cents: number;
  compensado_cents: number;
  total_cents: number;
  linhas: LinhaDoExtrato[];
  gerado_em: string;
  recebido_em: string;
  /** Os eventIds aceitos para esta comissão, do mais antigo ao que vale. */
  versoes: string[];
}

export interface LinhaDeComissaoDoCrm {
  id: string;
  venda_id: string;
  venda_numero: string;
  vendedor_id: string;
  vendedor_nome: string;
  plano_comissao_id: string;
  plano_nome: string;
  data_venda: string;
  valor_base: number;
  percentual_aplicado: number;
  valor_comissao: number;
  status: 'CALCULADA' | 'CANCELADA';
  data_aprovacao: null;
  data_pagamento: null;
  observacoes: string;
  origem: 'crm';
  crm: DetalheDaComissaoDoCrm;
}

/** "bruto R$ 350,00, compensado R$ 50,00, total R$ 300,00". */
function numerosDoExtrato(d: Pick<DetalheDaComissaoDoCrm, 'bruto_cents' | 'compensado_cents' | 'total_cents'>): string {
  return `bruto ${reais(deCentavos(d.bruto_cents))}, compensado ${reais(deCentavos(d.compensado_cents))}, total ${reais(deCentavos(d.total_cents))}`;
}

/** A observação da conta a pagar (comissao-conta.ts). */
export function observacaoDaContaDoCrm(d: DetalheDaComissaoDoCrm): string {
  return `Extrato de ${mesPorExtenso(d.competencia)} da Área Comercial do CRM: ${numerosDoExtrato(d)}. Evento ${d.evento_id}.`;
}

export function linhaDaComissaoDoCrm(
  e: ExtratoDoMes,
  ctx: { vendedorId: string; recebidoEm: string; versoesAnteriores?: readonly string[] },
): LinhaDeComissaoDoCrm {
  const [a, m] = e.competencia.split('-');
  const detalhe: DetalheDaComissaoDoCrm = {
    competencia: e.competencia,
    usuario_id: e.usuarioId,
    beneficiario: e.beneficiario,
    evento_id: e.eventId,
    versao: e.versao,
    bruto_cents: e.brutoCents,
    compensado_cents: e.compensadoCents,
    total_cents: e.totalCents,
    linhas: e.linhas,
    gerado_em: e.geradoEm,
    recebido_em: ctx.recebidoEm,
    versoes: [...(ctx.versoesAnteriores ?? []).filter(v => v !== e.eventId), e.eventId].slice(-20),
  };
  return {
    id: idDaComissaoDoCrm(e.competencia, e.usuarioId),
    venda_id: `crm-${e.competencia}`,
    venda_numero: `CRM ${m}/${a}`,
    vendedor_id: ctx.vendedorId,
    vendedor_nome: e.beneficiario.nome,
    plano_comissao_id: '',
    plano_nome: 'Área Comercial do CRM',
    data_venda: ultimoDiaDaCompetencia(e.competencia),
    valor_base: deCentavos(e.brutoCents),
    percentual_aplicado: 0,
    valor_comissao: deCentavos(e.totalCents),
    status: e.totalCents > 0 ? 'CALCULADA' : 'CANCELADA',
    data_aprovacao: null,
    data_pagamento: null,
    observacoes: `Extrato de ${mesPorExtenso(e.competencia)} da Área Comercial do CRM: ${numerosDoExtrato(detalhe)} (${e.linhas.length} ${e.linhas.length === 1 ? 'linha' : 'linhas'}).`,
    origem: 'crm',
    crm: detalhe,
  };
}

/** O detalhe do CRM de uma linha gravada em `comissoes`, ou null se ela não é do CRM. */
export function detalheDaComissaoDoCrm(data: unknown): DetalheDaComissaoDoCrm | null {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  if (!d || d.origem !== 'crm' || !d.crm || typeof d.crm !== 'object') return null;
  const c = d.crm as Record<string, unknown>;
  const ben = (c.beneficiario && typeof c.beneficiario === 'object' ? c.beneficiario : {}) as Record<string, unknown>;
  return {
    competencia: String(c.competencia ?? ''),
    usuario_id: String(c.usuario_id ?? ''),
    beneficiario: {
      usuarioId: typeof ben.usuarioId === 'number' ? ben.usuarioId : String(ben.usuarioId ?? c.usuario_id ?? ''),
      nome: String(ben.nome ?? ''),
      email: String(ben.email ?? ''),
    },
    evento_id: String(c.evento_id ?? ''),
    versao: Number(c.versao) || VERSAO_DO_EXTRATO,
    bruto_cents: Number(c.bruto_cents) || 0,
    compensado_cents: Number(c.compensado_cents) || 0,
    total_cents: Number(c.total_cents) || 0,
    linhas: Array.isArray(c.linhas) ? (c.linhas as LinhaDoExtrato[]) : [],
    gerado_em: String(c.gerado_em ?? ''),
    recebido_em: String(c.recebido_em ?? ''),
    versoes: Array.isArray(c.versoes) ? (c.versoes as unknown[]).map(String) : [],
  };
}

// ============================================================
// Versão nova do mesmo mês
// ============================================================

export type DecisaoDaVersao =
  | { acao: 'gravar' }
  | { acao: 'ja_existia' }
  | { acao: 'recusar'; motivo: string };

/**
 * O que fazer com o extrato que chegou, dado o que já está gravado:
 *  - o mesmo eventId (ou um já aceito antes): já existia, nada muda;
 *  - versão mais antiga que a que vale (geradoEm menor): recusa;
 *  - conta a pagar paga (ou paga em parte), ou aprovada para pagamento:
 *    com o mesmo total, já existia; com outro total, recusa sem mexer;
 *  - total zero sem comissão gravada: recusa (não há o que cancelar);
 *  - o resto grava: cria, atualiza a pendente ou, com total zero, cancela.
 */
export function decidirVersao(
  atual: { status: string; detalhe: DetalheDaComissaoDoCrm | null } | null,
  conta: { status: string; aprovacao: string } | null,
  novo: ExtratoDoMes,
): DecisaoDaVersao {
  const quem = `${mesPorExtenso(novo.competencia)} de ${novo.beneficiario.nome}`;
  const d = atual?.detalhe ?? null;
  if (d && (d.evento_id === novo.eventId || d.versoes.includes(novo.eventId))) return { acao: 'ja_existia' };
  if (d && d.gerado_em && Date.parse(novo.geradoEm) < Date.parse(d.gerado_em)) {
    return { acao: 'recusar', motivo: `Já vale uma versão mais nova do extrato de ${quem} (gerada em ${d.gerado_em}): esta, mais antiga, não passa por cima dela.` };
  }
  const paga = !!conta && (conta.status === 'PAGO' || conta.status === 'PARCIAL');
  const aprovada = (!!conta && conta.aprovacao === 'APROVADO') || atual?.status === 'APROVADA';
  if (paga || aprovada) {
    if (d && d.total_cents === novo.totalCents) return { acao: 'ja_existia' };
    const antes = d ? ` (${reais(deCentavos(d.total_cents))})` : '';
    return {
      acao: 'recusar',
      motivo: `A comissão de ${quem} já foi ${paga ? 'paga' : 'aprovada para pagamento'}${antes} e esta versão muda o total para ${reais(deCentavos(novo.totalCents))}. Nada foi alterado: a diferença entra no extrato do mês seguinte.`,
    };
  }
  if (!atual && novo.totalCents === 0) return { acao: 'recusar', motivo: `O extrato de ${quem} veio com total zero e não há comissão deste mês para cancelar.` };
  return { acao: 'gravar' };
}

// ============================================================
// O aviso de volta: COMISSAO_PAGA
// ============================================================

export interface AvisoDeComissaoPaga {
  competencia: string;
  usuarioId: number | string;
  eventIdOrigem: string;
  /** 'AAAA-MM-DD'. */
  pagoEm: string;
  valorPagoCents: number;
}

/** O payload do COMISSAO_PAGA, a partir da comissão e da conta a pagar já paga. */
export function avisoDeComissaoPaga(
  d: DetalheDaComissaoDoCrm,
  conta: { data_pagamento?: unknown; valor_pago?: unknown; valor_final?: unknown },
): AvisoDeComissaoPaga {
  const pago = num(conta.valor_pago) > 0 ? num(conta.valor_pago) : num(conta.valor_final);
  return {
    competencia: d.competencia,
    usuarioId: d.beneficiario.usuarioId,
    eventIdOrigem: d.evento_id,
    pagoEm: String(conta.data_pagamento ?? '').slice(0, 10),
    valorPagoCents: paraCentavos(pago),
  };
}
