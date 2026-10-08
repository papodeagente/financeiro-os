/**
 * COMISSÃO CALCULADA PELO CRM (evento COMISSAO_APURADA): as regras puras.
 *
 * Na agência que paga o time de vendas sobre o dinheiro RECEBIDO, quem sabe
 * quanto entrou de cada conta vendida por cada vendedor é o CRM. Ele apura o
 * mês do vendedor e manda o valor pronto; o financeiro guarda, programa a
 * conta a pagar e deixa aprovar e pagar como qualquer comissão.
 *
 * O contrato (versão 1), assinado pelo mesmo webhook das vendas:
 *
 *   { versao_contrato: 1, competencia: 'AAAA-MM', vendedor_id: 'crm_user_<id>',
 *     vendedor_nome, vendedor_email, valor_comissao, valor_base,
 *     linhas: [{ conta_id, conta_nome, dia, valor, plano, percentual,
 *                comissao, negociacao_id, provedor, transacao }],
 *     apurado_em }
 *
 * O id do evento é determinístico por (vendedor, mês, conteúdo): um mês que
 * muda (pagamento atrasado, estorno) chega como evento NOVO, e a reentrega do
 * mesmo evento é barrada pela idempotência de crm_eventos_entrada.
 *
 * UMA comissão por (vendedor do CRM, mês), id `comissao-crm-<id>-<AAAA-MM>`.
 * Regras de cada chegada (decidirComissaoDoCrm):
 *  - CALCULADA: regrava com os valores novos;
 *  - APROVADA ou PAGA com valor diferente: NÃO regrava; avisa uma pessoa;
 *  - valor 0: cancela a que ainda não foi paga; sem comissão, nada;
 *  - apuração mais antiga que a gravada (evento atrasado): ignora.
 *
 * O motor de comissão da tela (que calcula pelos planos daqui) nunca toca
 * uma linha `origem: 'crm'` e, com a agência marcada como "comissão pelo
 * CRM", não calcula as vendas que vieram do CRM: o CRM já pagou sobre o
 * dinheiro delas. Venda lançada à mão no financeiro segue nos planos daqui.
 *
 * Sem banco aqui: a tela usa a regra do motor.
 */
import type { ComissaoVenda, LinhaComissaoCrm } from './crm-types';
import { divSegura, round2 } from './money';
import { formatBRL } from './utils';

export const VERSAO_CONTRATO_COMISSAO = 1;

export interface ApuracaoDoCrm {
  versao_contrato: number;
  competencia: string;
  vendedor_id: string;
  vendedor_nome: string;
  vendedor_email: string;
  valor_comissao: number;
  valor_base: number;
  linhas: LinhaComissaoCrm[];
  apurado_em: string;
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Número de dinheiro do contrato: number, ou string com ponto decimal. */
function numero(v: unknown, campo: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(`COMISSAO_APURADA com ${campo} inválido`);
  return n;
}

/** "setembro de 2026". */
export function nomeDaCompetencia(competencia: string): string {
  const m = COMPETENCIA.exec(competencia);
  if (!m) return competencia;
  return `${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** O último dia do mês da competência: é a "data" da comissão nas telas. */
export function ultimoDiaDaCompetencia(competencia: string): string {
  const m = COMPETENCIA.exec(competencia);
  if (!m) return '';
  const ultimo = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}`;
}

/** `comissao-crm-<id do usuário no CRM>-<AAAA-MM>`. */
export function idDaComissaoDoCrm(crmVendedorId: string, competencia: string): string {
  const pessoa = texto(crmVendedorId).replace(/^crm_user_/, '').replace(/[^A-Za-z0-9_-]/g, '');
  return `comissao-crm-${pessoa}-${competencia}`;
}

/** A "venda" da comissão do CRM: o mês, não uma venda de verdade. */
export function vendaDaCompetencia(competencia: string): string {
  return `crm-competencia-${competencia}`;
}

/**
 * Lê e valida o payload. Contrato quebrado lança erro: o evento fica como
 * ERRO, o webhook responde 500 e o CRM tenta de novo, em vez de a comissão
 * sumir em silêncio. Versão desconhecida também: melhor esperar o
 * financeiro aprender do que ler uma versão nova com as regras da antiga.
 */
export function lerApuracaoDoCrm(payload: Record<string, unknown>): ApuracaoDoCrm {
  const versao = payload.versao_contrato == null ? VERSAO_CONTRATO_COMISSAO : Number(payload.versao_contrato);
  if (versao !== VERSAO_CONTRATO_COMISSAO) {
    throw new Error(`COMISSAO_APURADA versao_contrato ${texto(payload.versao_contrato)} não suportada (o financeiro lê a versão ${VERSAO_CONTRATO_COMISSAO})`);
  }
  const competencia = texto(payload.competencia);
  if (!COMPETENCIA.test(competencia)) throw new Error('COMISSAO_APURADA sem competencia no formato AAAA-MM');
  const vendedorId = texto(payload.vendedor_id);
  if (!vendedorId) throw new Error('COMISSAO_APURADA sem vendedor_id');
  const valorComissao = round2(numero(payload.valor_comissao, 'valor_comissao'));
  const valorBase = round2(numero(payload.valor_base ?? 0, 'valor_base'));
  if (valorComissao < 0) throw new Error('COMISSAO_APURADA com valor_comissao negativo');
  if (valorBase < 0) throw new Error('COMISSAO_APURADA com valor_base negativo');

  const brutas = Array.isArray(payload.linhas) ? payload.linhas : [];
  const linhas: LinhaComissaoCrm[] = brutas
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map(l => ({
      conta_id: Number(l.conta_id) || 0,
      conta_nome: texto(l.conta_nome),
      dia: texto(l.dia).slice(0, 10),
      valor: round2(Number(l.valor) || 0),
      plano: texto(l.plano),
      percentual: round2(Number(l.percentual) || 0),
      comissao: round2(Number(l.comissao) || 0),
      negociacao_id: texto(l.negociacao_id),
      provedor: l.provedor == null ? null : texto(l.provedor),
      transacao: l.transacao == null ? null : texto(l.transacao),
    }));

  return {
    versao_contrato: versao,
    competencia,
    vendedor_id: vendedorId,
    vendedor_nome: texto(payload.vendedor_nome),
    vendedor_email: texto(payload.vendedor_email).toLowerCase(),
    valor_comissao: valorComissao,
    valor_base: valorBase,
    linhas,
    apurado_em: texto(payload.apurado_em),
  };
}

/** A linha de comissão como ela fica gravada, ainda sem decidir nada. */
export function montarComissaoDoCrm(
  ap: ApuracaoDoCrm,
  vendedor: { id: string; nome?: string },
  eventoId: string,
): ComissaoVenda {
  const [ano, mes] = ap.competencia.split('-');
  return {
    id: idDaComissaoDoCrm(ap.vendedor_id, ap.competencia),
    venda_id: vendaDaCompetencia(ap.competencia),
    venda_numero: `CRM ${mes}/${ano}`,
    vendedor_id: vendedor.id,
    vendedor_nome: ap.vendedor_nome || vendedor.nome || 'Vendedor do CRM',
    plano_comissao_id: '',
    plano_nome: 'Calculada pelo CRM',
    data_venda: ultimoDiaDaCompetencia(ap.competencia),
    valor_base: ap.valor_base,
    // O percentual EFETIVO do mês: as linhas podem ter planos diferentes.
    percentual_aplicado: round2(divSegura(ap.valor_comissao, ap.valor_base) * 100),
    valor_comissao: ap.valor_comissao,
    status: 'CALCULADA',
    data_aprovacao: null,
    data_pagamento: null,
    observacoes: '',
    origem: 'crm',
    competencia: ap.competencia,
    descricao: `Comissão de ${nomeDaCompetencia(ap.competencia)} pelo dinheiro recebido (CRM)`,
    linhas: ap.linhas,
    apurado_em: ap.apurado_em,
    crm_vendedor_id: ap.vendedor_id,
    vendedor_email: ap.vendedor_email,
    crm_evento_id: eventoId,
  };
}

/** O aviso para uma pessoa, quando a regra não deixa mudar sozinho. */
export interface AvisoDaComissao {
  titulo: string;
  descricao: string;
  /** Mesma mudança, um aviso só. */
  chave: string;
}

export type DecisaoDoCrm =
  | { tipo: 'nada'; acao: string }
  | { tipo: 'gravar'; comissao: ComissaoVenda; acao: string }
  | { tipo: 'cancelar'; comissao: ComissaoVenda; acao: string; aviso?: AvisoDaComissao }
  | { tipo: 'avisar'; acao: string; aviso: AvisoDaComissao; diferenca: number };

function juntar(obs: unknown, nota: string): string {
  return [texto(obs), nota].filter(Boolean).join(' | ');
}

/** JSON com as chaves em ordem: o JSONB do banco devolve as chaves em outra
 *  ordem, e a mesma linha pareceria diferente. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonico(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function mesmoConteudo(a: ComissaoVenda, b: ComissaoVenda): boolean {
  return round2(Number(a.valor_comissao) || 0) === b.valor_comissao
    && round2(Number(a.valor_base) || 0) === b.valor_base
    && canonico(a.linhas ?? []) === canonico(b.linhas ?? [])
    && texto(a.vendedor_nome) === texto(b.vendedor_nome)
    && texto(a.vendedor_id) === texto(b.vendedor_id);
}

/**
 * O que fazer com a apuração que chegou, dada a comissão que já existe.
 * Só decide; quem grava é comissao-do-crm-gravar.ts.
 */
export function decidirComissaoDoCrm(
  anterior: ComissaoVenda | null,
  nova: ComissaoVenda,
  hoje: string,
): DecisaoDoCrm {
  const mes = nomeDaCompetencia(nova.competencia ?? '');
  const quem = nova.vendedor_nome;
  const valorNovo = round2(Number(nova.valor_comissao) || 0);

  if (!anterior) {
    if (valorNovo <= 0) return { tipo: 'nada', acao: `comissão de ${quem} em ${mes} veio zerada e não existe aqui: nada a fazer` };
    return {
      tipo: 'gravar',
      comissao: nova,
      acao: `comissão de ${quem} em ${mes} criada: ${formatBRL(valorNovo)} sobre ${formatBRL(nova.valor_base)} recebidos`,
    };
  }

  // Evento atrasado (uma nova tentativa que chegou depois de uma apuração
  // mais nova) não volta o mês para trás.
  const antes = texto(anterior.apurado_em);
  const agora = texto(nova.apurado_em);
  if (antes && agora && agora < antes) {
    return { tipo: 'nada', acao: `apuração de ${agora} é mais antiga que a já gravada (${antes}): ignorada` };
  }

  const valorAnt = round2(Number(anterior.valor_comissao) || 0);
  const diferenca = round2(valorNovo - valorAnt);
  const status = anterior.status;
  const mudou = `mudou no CRM de ${formatBRL(valorAnt)} para ${formatBRL(valorNovo)}`;

  if (status === 'CALCULADA') {
    if (valorNovo <= 0) {
      return {
        tipo: 'cancelar',
        comissao: {
          ...anterior, status: 'CANCELADA', cancelada_pelo_crm: true,
          apurado_em: nova.apurado_em, crm_evento_id: nova.crm_evento_id,
          observacoes: juntar(anterior.observacoes, `Cancelada em ${hoje}: o CRM zerou a comissão de ${mes}.`),
        },
        acao: `comissão de ${quem} em ${mes} zerada no CRM: cancelada (era ${formatBRL(valorAnt)})`,
      };
    }
    if (mesmoConteudo(anterior, nova)) return { tipo: 'nada', acao: `comissão de ${quem} em ${mes} sem mudança` };
    return {
      tipo: 'gravar',
      comissao: {
        ...nova,
        observacoes: diferenca !== 0
          ? juntar(anterior.observacoes, `Atualizada pelo CRM em ${hoje}: ${formatBRL(valorAnt)} para ${formatBRL(valorNovo)}.`)
          : texto(anterior.observacoes),
      },
      acao: diferenca !== 0
        ? `comissão de ${quem} em ${mes} ${mudou}: regravada`
        : `comissão de ${quem} em ${mes} regravada (valor igual, base ou contas mudaram)`,
    };
  }

  if (status === 'CANCELADA') {
    if (valorNovo <= 0) return { tipo: 'nada', acao: `comissão de ${quem} em ${mes} continua cancelada` };
    if (anterior.cancelada_pelo_crm) {
      // Foi o próprio CRM que zerou: o dinheiro voltou, a comissão volta.
      return {
        tipo: 'gravar',
        comissao: {
          ...nova, cancelada_pelo_crm: false,
          observacoes: juntar(anterior.observacoes, `Reaberta pelo CRM em ${hoje}: ${formatBRL(valorNovo)}.`),
        },
        acao: `comissão de ${quem} em ${mes} reaberta pelo CRM: ${formatBRL(valorNovo)}`,
      };
    }
    // Alguém cancelou aqui. O CRM não desfaz a decisão de uma pessoa.
    return {
      tipo: 'avisar',
      diferenca: valorNovo,
      acao: `comissão de ${quem} em ${mes} foi cancelada aqui e o CRM apurou ${formatBRL(valorNovo)}: mantida cancelada, aviso criado`,
      aviso: {
        titulo: `A comissão de ${quem} em ${mes} foi cancelada aqui, mas o CRM apurou ${formatBRL(valorNovo)}`,
        descricao: 'Ninguém mudou nada sozinho. Se a comissão é devida, reabra pelo CRM ou lance o valor à mão.',
        chave: `comissao-crm:${nova.id}:cancelada:${valorNovo.toFixed(2)}`,
      },
    };
  }

  // APROVADA ou PAGA.
  if (status === 'APROVADA' && valorNovo <= 0) {
    return {
      tipo: 'cancelar',
      comissao: {
        ...anterior, status: 'CANCELADA', cancelada_pelo_crm: true,
        apurado_em: nova.apurado_em, crm_evento_id: nova.crm_evento_id,
        observacoes: juntar(anterior.observacoes, `Cancelada em ${hoje}: o CRM zerou a comissão de ${mes}, que estava aprovada.`),
      },
      acao: `comissão APROVADA de ${quem} em ${mes} zerada no CRM: cancelada (era ${formatBRL(valorAnt)}), aviso criado`,
      aviso: {
        titulo: `A comissão aprovada de ${quem} em ${mes} foi zerada no CRM e cancelada aqui`,
        descricao: `Era ${formatBRL(valorAnt)}. A conta a pagar dela foi cancelada junto, se ainda não tinha sido paga.`,
        chave: `comissao-crm:${nova.id}:zerada`,
      },
    };
  }
  if (diferenca === 0) return { tipo: 'nada', acao: `comissão ${status} de ${quem} em ${mes} sem mudança de valor` };

  const ja = status === 'PAGA' ? 'paga' : 'aprovada';
  return {
    tipo: 'avisar',
    diferenca,
    acao: `comissão ${status} de ${quem} em ${mes} ${mudou} (diferença ${diferenca > 0 ? '+' : '-'}${formatBRL(Math.abs(diferenca))}): não regravada, aviso criado`,
    aviso: {
      titulo: `A comissão de ${quem} em ${mes} ${mudou}`,
      descricao: `A comissão já estava ${ja} aqui e não foi alterada. A diferença de ${formatBRL(Math.abs(diferenca))} ${diferenca > 0 ? 'ainda é devida ao vendedor' : 'foi paga a mais'} e precisa ser acertada à mão.`,
      chave: `comissao-crm:${nova.id}:${valorNovo.toFixed(2)}`,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// A regra do motor da tela
// ──────────────────────────────────────────────────────────────────────

/** A comissão veio calculada do CRM. */
export function ehComissaoDoCrm(c: { origem?: unknown } | null | undefined): boolean {
  return c?.origem === 'crm';
}

/**
 * A venda veio do CRM: id `crmv-…` (vendas desde a idempotência do webhook)
 * ou, nas mais antigas de id aleatório, a marca de origem que o webhook grava.
 */
export function ehVendaDoCrm(v: { id?: unknown; origem?: unknown; crm_venda_id?: unknown } | null | undefined): boolean {
  if (!v) return false;
  return String(v.id ?? '').startsWith('crmv-') || v.origem === 'crm' || texto(v.crm_venda_id) !== '';
}

interface ComissaoDoMotor { id: string; venda_id: string; status: string; origem?: unknown }
interface VendaDoMotor { id: string; origem?: unknown; crm_venda_id?: unknown }

/**
 * O que o motor de comissão da tela pode tocar.
 *
 *  - `paraConciliar`: as comissões que o passo "venda sumiu ou foi
 *    cancelada" pode cancelar. Nunca as do CRM: a "venda" delas é o mês.
 *  - `vendasParaCalcular`: as vendas que geram comissão pelos planos daqui.
 *    Com a comissão pelo CRM ligada, as vendas do CRM ficam de fora: o CRM
 *    já pagou sobre o dinheiro delas, e calcular aqui também pagaria duas
 *    vezes o mesmo dinheiro.
 *  - `comissoesDoMotor`: as que o recálculo pode comparar e regravar.
 *  - `anterioresEmVendaDoCrm`: comissões calculadas aqui sobre venda do CRM
 *    antes de o CRM passar a calcular, ainda não pagas. O motor não as mexe;
 *    a tela mostra para alguém conferir que não vão ser pagas duas vezes.
 */
export function recorteDoMotor<C extends ComissaoDoMotor, V extends VendaDoMotor>(
  comissoes: readonly C[],
  vendas: readonly V[],
  comissaoPeloCrm: boolean,
): { paraConciliar: C[]; comissoesDoMotor: C[]; vendasParaCalcular: V[]; anterioresEmVendaDoCrm: C[] } {
  const doMotor = comissoes.filter(c => !ehComissaoDoCrm(c));
  if (!comissaoPeloCrm) {
    return { paraConciliar: doMotor, comissoesDoMotor: doMotor, vendasParaCalcular: [...vendas], anterioresEmVendaDoCrm: [] };
  }
  const idsDoCrm = new Set(vendas.filter(ehVendaDoCrm).map(v => v.id));
  return {
    paraConciliar: doMotor,
    comissoesDoMotor: doMotor.filter(c => !idsDoCrm.has(c.venda_id)),
    vendasParaCalcular: vendas.filter(v => !ehVendaDoCrm(v)),
    anterioresEmVendaDoCrm: doMotor.filter(c => idsDoCrm.has(c.venda_id) && (c.status === 'CALCULADA' || c.status === 'APROVADA')),
  };
}
