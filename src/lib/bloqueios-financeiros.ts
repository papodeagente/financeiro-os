// Bloqueios do financeiro (05/11/2026). Função pura: quem liquida ou edita
// chama `verificarBloqueios` e, quando a resposta pede aprovação, abre um
// pedido (ver ./aprovacoes-servidor) em vez de gravar.
//
// Configuração em agencia.data.bloqueios_financeiros. Sem configuração (o
// padrão de todas as agências hoje), nada é bloqueado.
//
// CONTRATO (para a liquidação e a edição de títulos):
//   const r = verificarBloqueios({ config, hoje, desconto, acrescimo, valor_base,
//     data_movimentacao, vencimento_atual, vencimento_novo, dispensaAprovacao });
//   if (!r.ok) → não gravar; criarPedidoAprovacao({ tipo, motivo: r.motivo, payload, ... })
//     e responder 409 com { exigeAprovacao: true, motivo: r.motivo, pedido_id }.
//   Valores em reais (o cálculo é feito em centavos). Datas AAAA-MM-DD, `hoje`
//   em Brasília (quem chama passa; a função não lê relógio).
//   `dispensaAprovacao` = await pode(sessao, 'aprovar_excecao') (quem aprova
//   exceções não precisa pedir para si).

export type PoliticaVencimento = 'livre' | 'so_adiantar' | 'aprovacao';

export interface BloqueiosFinanceiros {
  /** Desconto ou acréscimo acima deste valor (R$) pede aprovação. */
  desconto_max_reais: number | null;
  /** Desconto acima deste percentual do valor original pede aprovação. */
  desconto_max_pct: number | null;
  /** Data da movimentação distante de hoje mais que N dias (para trás ou para frente). */
  retroagir_dias_max: number | null;
  /** Mudança de vencimento: livre, só adiantar, ou sempre com aprovação. */
  vencimento: PoliticaVencimento;
  /** Com 'livre' ou 'so_adiantar': mudar mais que N dias pede aprovação. */
  vencimento_dias_max: number | null;
}

export const BLOQUEIOS_PADRAO: BloqueiosFinanceiros = {
  desconto_max_reais: null,
  desconto_max_pct: null,
  retroagir_dias_max: null,
  vencimento: 'livre',
  vencimento_dias_max: null,
};

function numeroOuNulo(v: unknown, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

/** Lê o que está gravado (ou o que a tela mandou) sem confiar em nada. */
export function normalizarBloqueios(valor: unknown): BloqueiosFinanceiros {
  const v = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
  const vencimento: PoliticaVencimento = v.vencimento === 'so_adiantar' || v.vencimento === 'aprovacao' ? v.vencimento : 'livre';
  const dias = (x: unknown) => { const n = numeroOuNulo(x, 3650); return n === null ? null : Math.floor(n); };
  const reais = numeroOuNulo(v.desconto_max_reais, 1e9);
  return {
    desconto_max_reais: reais === null ? null : Math.round(reais * 100) / 100,
    desconto_max_pct: numeroOuNulo(v.desconto_max_pct, 100),
    retroagir_dias_max: dias(v.retroagir_dias_max),
    vencimento,
    vencimento_dias_max: dias(v.vencimento_dias_max),
  };
}

export function bloqueiosLigados(c: BloqueiosFinanceiros): boolean {
  return c.desconto_max_reais !== null || c.desconto_max_pct !== null || c.retroagir_dias_max !== null
    || c.vencimento !== 'livre' || c.vencimento_dias_max !== null;
}

export interface ContextoBloqueio {
  config: unknown;
  /** AAAA-MM-DD em Brasília. */
  hoje: string;
  desconto?: number | null;
  acrescimo?: number | null;
  /** Base do percentual de desconto (valor original do título). */
  valor_base?: number | null;
  data_movimentacao?: string | null;
  vencimento_atual?: string | null;
  vencimento_novo?: string | null;
  /** Quem aprova exceções lança sem gerar pedido. */
  dispensaAprovacao?: boolean;
}

export type Violacao = 'desconto' | 'desconto_pct' | 'acrescimo' | 'data_movimentacao' | 'vencimento';

export type ResultadoBloqueio =
  | { ok: true }
  | { ok: false; exigeAprovacao: true; motivo: string; violacoes: Violacao[] };

const cent = (v: number | null | undefined) => Math.round((Number(v) || 0) * 100);
const brl = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function diaJuliano(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
}

const dias = (n: number) => `${n} dia${n === 1 ? '' : 's'}`;

export function verificarBloqueios(ctx: ContextoBloqueio): ResultadoBloqueio {
  if (ctx.dispensaAprovacao) return { ok: true };
  const c = normalizarBloqueios(ctx.config);
  if (!bloqueiosLigados(c)) return { ok: true };
  const motivos: string[] = [];
  const violacoes: Violacao[] = [];

  const desconto = Math.max(0, cent(ctx.desconto));
  const acrescimo = Math.max(0, cent(ctx.acrescimo));
  if (c.desconto_max_reais !== null) {
    const limite = cent(c.desconto_max_reais);
    if (desconto > limite) { violacoes.push('desconto'); motivos.push(`Desconto de ${brl(desconto)} acima do limite de ${brl(limite)}.`); }
    if (acrescimo > limite) { violacoes.push('acrescimo'); motivos.push(`Acréscimo de ${brl(acrescimo)} acima do limite de ${brl(limite)}.`); }
  }
  const base = cent(ctx.valor_base);
  if (c.desconto_max_pct !== null && desconto > 0 && base > 0) {
    // Comparação em centavos inteiros: desconto/base > pct/100.
    if (desconto * 10_000 > Math.round(c.desconto_max_pct * 100) * base) {
      violacoes.push('desconto_pct');
      const pct = (desconto / base * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
      motivos.push(`Desconto de ${pct}% acima do limite de ${c.desconto_max_pct.toLocaleString('pt-BR')}%.`);
    }
  }

  const hoje = diaJuliano(ctx.hoje);
  const mov = diaJuliano(ctx.data_movimentacao);
  if (c.retroagir_dias_max !== null && hoje !== null && mov !== null) {
    const diff = Math.abs(hoje - mov);
    if (diff > c.retroagir_dias_max) {
      violacoes.push('data_movimentacao');
      motivos.push(`Data da movimentação a ${dias(diff)} de hoje; o limite é ${dias(c.retroagir_dias_max)}.`);
    }
  }

  const atual = diaJuliano(ctx.vencimento_atual);
  const novo = diaJuliano(ctx.vencimento_novo);
  if (atual !== null && novo !== null && atual !== novo) {
    const diff = novo - atual;
    if (c.vencimento === 'aprovacao') {
      violacoes.push('vencimento');
      motivos.push('Mudar o vencimento pede aprovação.');
    } else if (c.vencimento === 'so_adiantar' && diff > 0) {
      violacoes.push('vencimento');
      motivos.push(`O vencimento só pode ser adiantado; este foi adiado em ${dias(diff)}.`);
    } else if (c.vencimento_dias_max !== null && Math.abs(diff) > c.vencimento_dias_max) {
      violacoes.push('vencimento');
      motivos.push(`Vencimento mudou ${dias(Math.abs(diff))}; o limite é ${dias(c.vencimento_dias_max)}.`);
    }
  }

  if (violacoes.length === 0) return { ok: true };
  return { ok: false, exigeAprovacao: true, motivo: motivos.join(' '), violacoes };
}
