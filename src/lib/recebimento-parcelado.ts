/**
 * Venda do CRM parcelada no cartão ou no boleto: receber mês a mês ou
 * antecipar tudo (13/11/2026).
 *
 * Bruno: "Quando o pagamento for parcelado em boleto ou cartão, pergunte no
 * financeiro se deseja receber mês a mês ou se vai antecipar tudo. Permita
 * incluir taxas mensais ou de antecipação completa, caso haja."
 *
 * Como fica no dinheiro (a mesma convenção das plataformas de pagamento,
 * ver src/lib/taxa-plataforma.ts e plataformas/servico.ts):
 *   - `valor_final` da conta continua o valor CHEIO: o DRE vê a receita cheia;
 *   - `taxa` guarda o que fica com a operadora ou o banco, e
 *     `taxa_plataforma` diz quem cobrou; a baixa espera o líquido;
 *   - MÊS A MÊS: cada parcela leva a sua taxa (o % sobre a parcela);
 *   - ANTECIPAR: as parcelas de cada fornecedor viram UMA conta, que vence na
 *     data da antecipação, com a taxa sobre o total. As parcelas originais
 *     ficam guardadas na própria conta, para voltar ao mês a mês sem perder
 *     datas e valores.
 *
 * Enquanto ninguém escolhe, as parcelas nascem mês a mês sem taxa e marcadas
 * `recebimento_a_definir`, que é o que põe a pergunta nas pendências.
 *
 * Módulo puro: sem banco e sem React.
 */
import { round2 } from './money';

export type ModoDeRecebimento = 'pendente' | 'mensal' | 'antecipado';

export interface RecebimentoDaVenda {
  modo: ModoDeRecebimento;
  /** Percentual da taxa (mensal: sobre cada parcela; antecipado: sobre o total). */
  taxa_pct: number;
  /** Só no antecipado: quando o dinheiro cai. */
  data_antecipacao?: string;
  decidido_em?: string;
  decidido_por?: string;
}

export type FormaDaVendaCRM = 'AVISTA_PIX' | 'CARTAO' | 'BOLETO' | 'FATURADO' | 'MISTO';

/**
 * A forma de pagamento que o CRM mandou, no vocabulário do Financeiro.
 * null = o CRM não disse ("nao_definida", vazio ou desconhecida).
 */
export function formaDoCrm(bruto: unknown): FormaDaVendaCRM | null {
  const t = String(bruto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  if (!t || t === 'nao_definida' || t === 'nao definida') return null;
  if (/cart|credit/.test(t)) return 'CARTAO';
  if (/boleto|carne/.test(t)) return 'BOLETO';
  if (/pix|transfer|ted|debito|dinheiro|deposito/.test(t)) return 'AVISTA_PIX';
  return null;
}

/** Só parcelado no cartão ou no boleto pede a escolha. */
export function precisaEscolherRecebimento(forma: unknown, parcelas: unknown): boolean {
  const n = Math.floor(Number(parcelas) || 0);
  return (forma === 'CARTAO' || forma === 'BOLETO') && n > 1;
}

function decisaoValida(v: unknown): RecebimentoDaVenda | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.modo !== 'mensal' && r.modo !== 'antecipado') return null;
  const taxa = Number(r.taxa_pct);
  return {
    modo: r.modo,
    taxa_pct: Number.isFinite(taxa) && taxa >= 0 ? taxa : 0,
    ...(r.modo === 'antecipado' && typeof r.data_antecipacao === 'string' ? { data_antecipacao: r.data_antecipacao } : {}),
    ...(typeof r.decidido_em === 'string' ? { decidido_em: r.decidido_em } : {}),
    ...(typeof r.decidido_por === 'string' ? { decidido_por: r.decidido_por } : {}),
  };
}

/**
 * O recebimento da venda quando ela (re)chega do CRM: a escolha já feita
 * vale enquanto a venda continuar parcelada no cartão ou no boleto; sem
 * escolha, fica pendente; à vista ou Pix não pergunta nada.
 */
export function recebimentoAoChegar(anterior: unknown, forma: unknown, parcelas: unknown): RecebimentoDaVenda | undefined {
  if (!precisaEscolherRecebimento(forma, parcelas)) return undefined;
  return decisaoValida(anterior) ?? { modo: 'pendente', taxa_pct: 0 };
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** A escolha enviada pela tela, validada. Data passada vale: a antecipação pode já ter acontecido. */
export function lerEscolha(corpo: unknown): { ok: true; valor: RecebimentoDaVenda } | { ok: false; erro: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (c.modo !== 'mensal' && c.modo !== 'antecipado') return { ok: false, erro: 'Escolha receber mês a mês ou antecipar tudo.' };
  const taxa = c.taxa_pct === '' || c.taxa_pct == null ? 0 : Number(c.taxa_pct);
  if (!Number.isFinite(taxa) || taxa < 0) return { ok: false, erro: 'A taxa precisa ser um número igual ou maior que zero.' };
  if (taxa >= 50) return { ok: false, erro: 'A taxa parece alta demais. Informe o percentual, por exemplo 3,5.' };
  if (c.modo === 'mensal') return { ok: true, valor: { modo: 'mensal', taxa_pct: round2(taxa) } };
  const data = typeof c.data_antecipacao === 'string' ? c.data_antecipacao.slice(0, 10) : '';
  if (!DATA.test(data)) return { ok: false, erro: 'Informe a data em que o dinheiro da antecipação cai.' };
  return { ok: true, valor: { modo: 'antecipado', taxa_pct: round2(taxa), data_antecipacao: data } };
}

/** Quem cobra a taxa, para o relatório por plataforma. */
export function rotuloDaTaxa(forma: unknown): string {
  return forma === 'BOLETO' ? 'Boleto' : 'Cartão de crédito';
}

/** O mínimo da conta a receber que esta regra lê e escreve. */
export interface ContaDoRecebimento {
  id: string;
  origem?: string;
  descricao: string;
  valor_original: number;
  valor_final: number;
  data_vencimento: string;
  parcela_numero?: number;
  total_parcelas?: number;
  taxa?: number;
  taxa_plataforma?: string;
  origem_fornecedor_id?: string;
  origem_item_id?: string;
  recebimento_a_definir?: boolean;
  recebimento_antecipado?: boolean;
  parcelas_originais?: ParcelaOriginal[];
}

export interface ParcelaOriginal {
  id: string;
  numero: number;
  total: number;
  valor: number;
  vencimento: string;
  descricao: string;
}

const SUFIXO_DE_PARCELA = /\s*(?:-|—)\s*Parcela \d+\/\d+$/;

/** Desfaz uma antecipação: volta às parcelas guardadas. */
function expandir<T extends ContaDoRecebimento>(c: T): T[] {
  if (!c.recebimento_antecipado || !Array.isArray(c.parcelas_originais) || c.parcelas_originais.length === 0) return [c];
  return c.parcelas_originais.map(p => {
    const { parcelas_originais: _po, recebimento_antecipado: _ra, ...resto } = c;
    void _po; void _ra;
    return {
      ...(resto as unknown as T),
      id: p.id,
      descricao: p.descricao,
      valor_original: p.valor,
      valor_final: p.valor,
      data_vencimento: p.vencimento,
      parcela_numero: p.numero,
      total_parcelas: p.total,
      taxa: 0,
      taxa_plataforma: '',
    };
  });
}

/**
 * Aplica o recebimento às contas a receber da venda (só às de origem VENDA,
 * ainda não baixadas: quem chama filtra). Comissão e contas de outra origem
 * passam intactas. Sempre parte das parcelas originais, então aplicar a
 * mesma escolha duas vezes dá o mesmo resultado.
 */
export function aplicarRecebimento<T extends ContaDoRecebimento>(
  contas: readonly T[],
  rec: RecebimentoDaVenda | undefined,
  forma: unknown,
): T[] {
  const daVenda = (c: T) => (c.origem ?? 'VENDA') === 'VENDA';
  const base = contas.flatMap(c => (daVenda(c) ? expandir(c) : [c]));
  const rotulo = rotuloDaTaxa(forma);

  if (!rec) {
    return base.map(c => (daVenda(c) ? { ...c, recebimento_a_definir: undefined } : c));
  }
  if (rec.modo === 'pendente') {
    return base.map(c => (daVenda(c) ? { ...c, taxa: 0, taxa_plataforma: '', recebimento_a_definir: true } : c));
  }
  if (rec.modo === 'mensal') {
    return base.map(c => {
      if (!daVenda(c)) return c;
      const taxa = round2((Number(c.valor_final) || 0) * (rec.taxa_pct / 100));
      return { ...c, taxa, taxa_plataforma: taxa > 0 ? rotulo : '', recebimento_a_definir: undefined };
    });
  }

  // Antecipado: as parcelas de cada fornecedor viram uma conta só.
  const outras: T[] = [];
  const grupos = new Map<string, T[]>();
  for (const c of base) {
    if (!daVenda(c)) { outras.push(c); continue; }
    const chave = c.origem_fornecedor_id || c.origem_item_id || 'venda';
    const g = grupos.get(chave);
    if (g) g.push(c); else grupos.set(chave, [c]);
  }
  const juntas: T[] = [];
  for (const g of grupos.values()) {
    const ordenadas = [...g].sort((a, b) => (a.parcela_numero ?? 0) - (b.parcela_numero ?? 0));
    const primeira = ordenadas[0];
    const total = round2(ordenadas.reduce((s, c) => s + (Number(c.valor_final) || 0), 0));
    const n = ordenadas.length;
    const descricaoBase = primeira.descricao.replace(SUFIXO_DE_PARCELA, '');
    juntas.push({
      ...primeira,
      descricao: n > 1 ? `${descricaoBase} - Antecipado (${n} parcelas)` : `${descricaoBase} - Antecipado`,
      valor_original: total,
      valor_final: total,
      data_vencimento: rec.data_antecipacao || primeira.data_vencimento,
      parcela_numero: 1,
      total_parcelas: 1,
      taxa: round2(total * (rec.taxa_pct / 100)),
      taxa_plataforma: rec.taxa_pct > 0 ? rotulo : '',
      recebimento_a_definir: undefined,
      recebimento_antecipado: true,
      parcelas_originais: ordenadas.map(c => ({
        id: c.id,
        numero: c.parcela_numero ?? 1,
        total: c.total_parcelas ?? n,
        valor: Number(c.valor_final) || 0,
        vencimento: c.data_vencimento,
        descricao: c.descricao,
      })),
    });
  }
  return [...outras, ...juntas];
}
