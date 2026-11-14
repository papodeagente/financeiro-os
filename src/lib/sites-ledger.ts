/**
 * Projeção financeira dos eventos do EnturOS Sites.
 *
 * O evento bruto continua sendo a prova recebida. Estas projeções são o
 * índice operacional do Financeiro: uma reserva tem apenas o retrato de maior
 * versão e cada movimento tem uma chave natural estável. Assim, um retry ou
 * um evento equivalente com outro UUID nunca vira uma segunda entrada.
 *
 * Não criamos outra `vendas_crm` aqui. A venda fechada nasce no CRM; o Sites é
 * a fonte dos recebimentos, taxas, reembolsos, repasses, disputas, custos e
 * acertos que acontecem depois dela.
 */
import type { EnvelopeSites } from './sites-integration';

const inteiro = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
const centavos = (v: unknown): number | null => {
  const n = inteiro(v);
  return n !== null && n >= 0 ? n : null;
};
const texto = (v: unknown, max = 160): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const moeda = (v: unknown): string | null =>
  typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : null;

export interface ReservaProjetadaSites {
  reservaId: string;
  pedidoId: string | null;
  pedidoCodigo: string | null;
  numero: string | null;
  versao: number;
  situacao: string;
  totalCentavos: number | null;
  moeda: string | null;
  servicoId: string | null;
  inicio: string | null;
  fim: string | null;
  ocorridoEm: string;
  eventoId: string;
  dados: Record<string, unknown>;
}

export type CategoriaMovimentoSites =
  | 'recebimento' | 'cobranca_falhou' | 'quitacao' | 'taxa'
  | 'reembolso_pendente' | 'reembolso' | 'reembolso_falhou'
  | 'repasse' | 'disputa' | 'custo' | 'acerto';

export interface MovimentoProjetadoSites {
  chaveNatural: string;
  categoria: CategoriaMovimentoSites;
  referencia: string;
  pedidoId: string | null;
  pedidoCodigo: string | null;
  reservaId: string | null;
  valorCentavos: number | null;
  taxaCentavos: number | null;
  liquidoCentavos: number | null;
  moeda: string | null;
  estado: string;
  /** Movimento de dinheiro real; falso para tentativa/provisão/aviso. */
  efetivo: boolean;
  ocorridoEm: string;
  eventoId: string;
  tipo: string;
  dados: Record<string, unknown>;
}

const SITUACAO: Record<string, string> = {
  'reserva.criada': 'criada',
  'reserva.pendente': 'pendente',
  'reserva.confirmada': 'confirmada',
  'reserva.recusada': 'recusada',
  'reserva.remarcada': 'remarcada',
  'reserva.cancelada': 'cancelada',
  'reserva.alterada': 'alterada',
};

export function projetarReservaSites(e: EnvelopeSites): ReservaProjetadaSites | null {
  const situacao = SITUACAO[e.tipo];
  if (!situacao) return null;
  const d = e.dados;
  const reservaId = texto(d.reservaId ?? (e.agregado.tipo === 'reserva' ? e.agregado.id : null), 100);
  if (!reservaId) return null;
  const cancelamentoTotal = e.tipo === 'reserva.cancelada' && d.parcial !== true;
  const recusada = e.tipo === 'reserva.recusada';
  const depois = d.depois && typeof d.depois === 'object' && !Array.isArray(d.depois)
    ? d.depois as Record<string, unknown> : undefined;
  return {
    reservaId,
    pedidoId: texto(d.pedidoId, 100),
    pedidoCodigo: texto(d.pedidoCodigo, 100),
    numero: texto(d.numero, 100),
    versao: e.agregado.versao,
    situacao: typeof d.situacao === 'string' ? d.situacao.slice(0, 40) : situacao,
    totalCentavos: cancelamentoTotal || recusada ? 0 : centavos(d.totalCentavos),
    moeda: moeda(d.moeda),
    servicoId: texto(d.servicoId, 100),
    inicio: texto(d.inicio ?? depois?.inicio, 40),
    fim: texto(d.fim ?? depois?.fim, 40),
    ocorridoEm: e.criadoEm,
    eventoId: e.id,
    dados: d,
  };
}

function referenciaDe(d: Record<string, unknown>, nomes: string[], fallback: string): string {
  for (const nome of nomes) {
    const valor = texto(d[nome], 160);
    if (valor) return valor;
  }
  return fallback;
}

function referenciaObrigatoria(d: Record<string, unknown>, nomes: string[]): string | null {
  for (const nome of nomes) {
    const valor = texto(d[nome], 160);
    if (valor) return valor;
  }
  return null;
}

/**
 * Normaliza somente eventos que pertencem ao livro financeiro. Eventos de
 * reserva ficam em `sites_reservas`; `saldo.pago` é informativo (a entrada
 * real é `pagamento.recebido`) e por isso não duplica caixa.
 */
export function projetarMovimentoSites(e: EnvelopeSites): MovimentoProjetadoSites | null {
  const d = e.dados;
  let categoria: CategoriaMovimentoSites;
  let referencia: string;
  let chaveNatural: string;
  let valor: number | null = null;
  let taxa: number | null = null;
  let liquido: number | null = null;
  let estado = 'registrado';
  let efetivo = false;

  switch (e.tipo) {
    case 'pagamento.recebido': {
      const ref = referenciaObrigatoria(d, ['pagamentoId', 'idExterno']);
      valor = centavos(d.valorCentavos);
      if (!ref || valor === null || !moeda(d.moeda)) return null;
      categoria = 'recebimento'; referencia = ref;
      chaveNatural = `pagamento:${referencia}`;
      taxa = centavos(d.taxaCentavos);
      liquido = centavos(d.liquidoCentavos) ?? (valor !== null && taxa !== null ? valor - taxa : null);
      estado = 'recebido'; efetivo = true; break;
    }
    case 'pagamento.falhou': {
      const ref = referenciaObrigatoria(d, ['cobrancaId']);
      if (!ref) return null;
      categoria = 'cobranca_falhou'; referencia = ref;
      chaveNatural = `cobranca:${referencia}`;
      valor = centavos(d.valorCentavos); estado = 'falhou'; break;
    }
    case 'saldo.pago': {
      const ref = referenciaObrigatoria(d, ['pagamentoId']);
      valor = centavos(d.valorCentavos);
      if (!ref || valor === null || !moeda(d.moeda)) return null;
      categoria = 'quitacao'; referencia = ref;
      chaveNatural = `quitacao:${referencia}`;
      estado = 'quitado'; break;
    }
    case 'taxa.ajustada': {
      const ref = referenciaObrigatoria(d, ['pagamentoId']);
      valor = centavos(d.finalCentavos);
      if (!ref || valor === null) return null;
      categoria = 'taxa'; referencia = ref;
      chaveNatural = `taxa:${referencia}`;
      estado = 'ajustada'; efetivo = true; break;
    }
    case 'reembolso.emitido': {
      const ref = referenciaObrigatoria(d, ['reembolsoId']);
      valor = centavos(d.valorCentavos);
      if (!ref || valor === null) return null;
      categoria = 'reembolso_pendente'; referencia = ref;
      chaveNatural = `reembolso:${referencia}`;
      estado = texto(d.estado, 40) ?? 'emitido'; break;
    }
    case 'reembolso.efetuado': {
      const ref = referenciaObrigatoria(d, ['reembolsoId']);
      valor = centavos(d.valorCentavos);
      if (!ref || valor === null) return null;
      categoria = 'reembolso'; referencia = ref;
      chaveNatural = `reembolso:${referencia}`;
      estado = 'efetuado'; efetivo = true; break;
    }
    case 'reembolso.falhou': {
      const ref = referenciaObrigatoria(d, ['reembolsoId']);
      valor = centavos(d.valorCentavos);
      if (!ref || valor === null) return null;
      categoria = 'reembolso_falhou'; referencia = ref;
      chaveNatural = `reembolso:${referencia}`;
      estado = 'falhou'; break;
    }
    case 'repasse.recebido': {
      const ref = referenciaObrigatoria(d, ['repasse']);
      valor = centavos(d.valorCentavos);
      if (!ref || valor === null || !moeda(d.moeda)) return null;
      categoria = 'repasse'; referencia = ref;
      chaveNatural = `repasse:${referencia}`;
      estado = 'recebido'; efetivo = true; break;
    }
    case 'disputa.aberta': {
      const ref = referenciaObrigatoria(d, ['disputa']);
      valor = centavos(d.valorCentavos);
      if (!ref || valor === null) return null;
      categoria = 'disputa'; referencia = ref;
      chaveNatural = `disputa:${referencia}`;
      estado = 'aberta'; break;
    }
    case 'disputa.encerrada': {
      const ref = referenciaObrigatoria(d, ['disputa']);
      valor = centavos(d.valorCentavos);
      const resultado = texto(d.resultado, 40);
      if (!ref || valor === null || !resultado) return null;
      categoria = 'disputa'; referencia = ref;
      chaveNatural = `disputa:${referencia}`;
      estado = resultado; efetivo = true; break;
    }
    case 'custo.registrado': {
      const ref = referenciaObrigatoria(d, ['custoId']);
      valor = centavos(d.realCentavos);
      if (!ref || valor === null) return null;
      categoria = 'custo'; referencia = ref;
      chaveNatural = `custo:${referencia}`;
      estado = 'registrado'; efetivo = true; break;
    }
    case 'acerto.fechado': {
      const ref = referenciaObrigatoria(d, ['acertoId']);
      const receber = centavos(d.aReceberCentavos);
      const pagar = centavos(d.aPagarCentavos);
      if (!ref || receber === null || pagar === null || !moeda(d.moeda)) return null;
      categoria = 'acerto'; referencia = ref;
      chaveNatural = `acerto.fechamento:${referencia}`;
      valor = receber || pagar; estado = 'fechado'; break;
    }
    case 'acerto.pago':
      valor = centavos(d.valorCentavos);
      if (valor === null || !moeda(d.moeda)) return null;
      categoria = 'acerto'; referencia = referenciaDe(d, ['referencia'], e.id);
      chaveNatural = `acerto.pagamento:${referencia}`;
      estado = d.quitado === true ? 'quitado' : 'parcial'; efetivo = true; break;
    default: return null;
  }

  return {
    chaveNatural,
    categoria, referencia,
    pedidoId: texto(d.pedidoId, 100),
    pedidoCodigo: texto(d.pedidoCodigo, 100),
    reservaId: texto(d.reservaId, 100),
    valorCentavos: valor, taxaCentavos: taxa, liquidoCentavos: liquido,
    moeda: moeda(d.moeda), estado, efetivo,
    ocorridoEm: e.criadoEm, eventoId: e.id, tipo: e.tipo, dados: d,
  };
}

export const TIPOS_FINANCEIROS_SITES = new Set([
  'pagamento.recebido', 'pagamento.falhou', 'saldo.pago', 'taxa.ajustada',
  'reembolso.emitido', 'reembolso.efetuado', 'reembolso.falhou',
  'repasse.recebido', 'disputa.aberta', 'disputa.encerrada',
  'custo.registrado', 'acerto.fechado', 'acerto.pago',
]);
