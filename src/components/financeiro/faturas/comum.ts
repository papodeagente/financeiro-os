/**
 * Peças comuns das telas de faturas (E5, parte B): datas, dinheiro, o motivo
 * de cada item a faturar e a frase de cada evento do histórico.
 */
import type { EventoDaFatura, ItemAFaturar } from '@/lib/fatura-servidor';
import { deCentavos } from '@/lib/money';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos → "R$ 1.234,56". */
export function reais(centavos: number | null | undefined): string {
  return BRL.format(deCentavos(Number(centavos) || 0));
}

export function dataBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—';
}

export function quandoBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : '—';
}

/** "01/11 a 30/11/2026", "05/11/2026" ou "Sem período". */
export function periodoBR(inicio: string | null | undefined, fim: string | null | undefined): string {
  if (!inicio && !fim) return 'Sem período';
  if (!fim || inicio === fim) return dataBR(inicio ?? fim);
  if (!inicio) return dataBR(fim);
  const mesmoAno = inicio.slice(0, 4) === fim.slice(0, 4);
  return `${mesmoAno ? dataBR(inicio).slice(0, 5) : dataBR(inicio)} a ${dataBR(fim)}`;
}

/** Hoje no fuso de Brasília, 'AAAA-MM-DD'. */
export function hojeBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, m - 1, d + dias, 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Por que o item ainda não está numa fatura, em uma frase. */
export const MOTIVO_DO_ITEM: Record<ItemAFaturar['motivo'], { rotulo: string; frase: string }> = {
  SEM_REGRA: { rotulo: 'Sem regra', frase: 'O pagante não tem regra de faturamento: o item fica com o vencimento da venda até você faturar à mão ou criar a regra.' },
  TIRADO_DA_FATURA: { rotulo: 'Tirado da fatura', frase: 'Alguém tirou este item de uma fatura. Ele só volta se você faturar à mão.' },
  COBRANCA_EMITIDA: { rotulo: 'Boleto emitido', frase: 'Já tem boleto ou Pix valendo para este item sozinho. Cancele a cobrança para juntar na fatura.' },
  AGUARDANDO: { rotulo: 'Na fila', frase: 'Tem regra e entra na fatura na próxima montagem (ou agora, em "Montar faturas agora").' },
};

const qtd = (n: unknown, um: string, varios: string) => {
  const v = Array.isArray(n) ? n.length : Number(n) || 0;
  return `${v} ${v === 1 ? um : varios}`;
};

/** A frase de cada evento do histórico da fatura. */
export function fraseDoEvento(e: EventoDaFatura): string {
  const d = e.detalhe ?? {};
  const valor = typeof d.valor_centavos === 'number' ? ` (${reais(d.valor_centavos)})` : '';
  switch (e.tipo) {
    case 'criada': return d.avulsa ? 'Fatura avulsa criada.' : d.complementar_de ? 'Fatura complementar criada: a deste período já estava fechada.' : 'Fatura criada pela regra de faturamento.';
    case 'itens_incluidos': return `${qtd(d.contas, 'item entrou', 'itens entraram')} na fatura${d.manual ? ' à mão' : ''}.`;
    case 'notas_anexadas': return `${qtd(d.quantidade, 'nota que esperava', 'notas que esperavam')} a próxima fatura ${Number(d.quantidade) === 1 ? 'entrou' : 'entraram'} aqui.`;
    case 'fechada': return `Fatura fechada${typeof d.total_centavos === 'number' ? ` em ${reais(d.total_centavos)}` : ''}. Os itens não mudam mais e o cliente pode conferir no portal.`;
    case 'reaberta': return `Fatura reaberta.${d.cliente_ja_tinha_recebido ? ' O cliente já tinha recebido a fatura para conferir.' : ''}${d.juntou_complementar ? ' A fatura complementar do período voltou para esta.' : ''}`;
    case 'juntada': return e.motivo || 'Os itens voltaram para a fatura reaberta.';
    case 'itens_movidos': return `${qtd(d.contas, 'item foi movido', 'itens foram movidos')} para a fatura Nº ${d.para}${valor}.`;
    case 'itens_recebidos': return `${qtd(d.contas, 'item veio', 'itens vieram')} da fatura Nº ${d.de}${valor}.`;
    case 'faturado_avulso': return `${qtd(d.contas, 'item foi faturado', 'itens foram faturados')} à parte, na fatura Nº ${d.para}${valor}.`;
    case 'itens_retirados': return `${qtd(d.contas, 'item saiu', 'itens saíram')} da fatura e ${Array.isArray(d.contas) && d.contas.length === 1 ? 'voltou' : 'voltaram'} a ser conta a receber solta.`;
    case 'nota_lancada': return `${d.tipo === 'DEBITO' ? 'Nota de débito' : 'Nota de crédito'} lançada${valor}.`;
    case 'nota_para_proxima': return `${d.tipo === 'DEBITO' ? 'Nota de débito' : 'Nota de crédito'}${valor} ${d.destino ? `foi para a fatura Nº ${d.destino}` : 'espera a próxima fatura do cliente'}.`;
    case 'nota_removida': return `${d.tipo === 'DEBITO' ? 'Nota de débito' : 'Nota de crédito'} removida${valor}.`;
    case 'saldo_levado': return `Saldo do pagamento parcial${valor} levado para a próxima fatura, como nota de débito.`;
    case 'vencimentos_recalculados': return `Vencimentos recalculados pela regra: ${qtd(d.contas, 'item mudou', 'itens mudaram')} de fatura.`;
    case 'conferida_por_arquivo': return `Conferida com o arquivo do cliente${d.arquivo ? ` (${d.arquivo})` : ''}: ${d.conferidos ?? 0} bateram, ${d.divergentes ?? 0} com diferença.`;
    case 'item_atualizado_pela_venda': return `A venda mudou e o item passou de ${reais(Number(d.de))} para ${reais(Number(d.para))}.`;
    case 'item_saiu_pela_venda': return 'A venda mudou e um item saiu da fatura.';
    case 'aprovada_pelo_cliente': return 'O cliente conferiu e aprovou a fatura no portal.';
    case 'contestada_pelo_cliente': return `O cliente contestou ${qtd(d.itens, 'item', 'itens')} no portal.`;
    case 'contestacao_respondida': return 'A agência respondeu a contestação do cliente.';
    case 'cobranca_emitida': return 'Boleto e Pix emitidos para a fatura.';
    case 'cancelada_sem_itens': return 'A fatura ficou sem itens e sem notas, e foi cancelada.';
    case 'ajustada': return 'Modelo, colunas, observações ou retenções da fatura ajustados.';
    default: return e.motivo || 'Alteração na fatura.';
  }
}
