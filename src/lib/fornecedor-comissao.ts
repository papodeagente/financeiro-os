/**
 * COMISSÃO ESPERADA × RECEBIDA POR OPERADORA (E5, parte C, 05/11/2026).
 *
 * Para cada pessoa que paga comissão à agência (o representante do produto,
 * senão o fornecedor) e um período de vendas:
 *  - ESPERADA: o que o acordo vigente na data de cada venda manda (Comissão +
 *    Over). Produto sem acordo espera o que foi lançado (e é contado em
 *    "sem acordo");
 *  - LANÇADA: Comissão + Over que estão na venda;
 *  - RECEBIDA: o que já entrou de fato. Comissão vem de dois jeitos:
 *      · retida no pagamento: a agência paga o líquido ao fornecedor; conta
 *        como recebida na proporção do que já foi pago a ele;
 *      · a receber do fornecedor (o cliente pagou direto a ele): conta
 *        quando a conta de comissão é baixada;
 *  - INFORMADA NO EXTRATO: o que a operadora diz que pagou (a conferência de
 *    extrato da E6 grava em fornecedor_extrato_comissoes; vazio até lá).
 * Alertas: lançado abaixo do acordo, comissão a receber em atraso, extrato
 * diferente do lançado, produtos sem acordo.
 *
 * Arquivo puro; centavos de real.
 */
import { paraCentavos, num } from './money';
import { emReais, parteDoAcerto, totaisDoProduto, type Centavos, type Venda } from './venda-modelo';
import type { PosicaoDaVenda } from './venda-posicao';
import { esperadoDoProduto, type AcordoComFornecedor } from './fornecedor-acordos';

export interface VendaParaComissao {
  venda: Venda;
  posicao: PosicaoDaVenda;
  /** JSON das contas a receber da venda (para a comissão em atraso). */
  contas_receber: ReadonlyArray<Record<string, unknown>>;
}

export interface LinhaDoExtrato {
  parte_id: string;
  venda_id: string | null;
  localizador: string;
  valor_centavos: Centavos;
}

export interface LinhaDeComissao {
  parte_id: string;
  parte_nome: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  produto_id: string;
  produto: string;
  localizador: string;
  tarifa: Centavos;
  esperada: Centavos;
  lancada: Centavos;
  recebida: Centavos;
  sem_acordo: boolean;
  motivo_acordo: string;
}

export type CodigoAlertaComissao = 'ABAIXO_DO_ACORDO' | 'ACIMA_DO_ACORDO' | 'COMISSAO_EM_ATRASO' | 'EXTRATO_DIVERGENTE' | 'SEM_ACORDO';

export interface AlertaDeComissao {
  codigo: CodigoAlertaComissao;
  gravidade: 'aviso' | 'atencao';
  mensagem: string;
  valor?: Centavos;
}

export interface ComissaoDaOperadora {
  parte_id: string;
  nome: string;
  vendas: number;
  produtos: number;
  tarifa: Centavos;
  esperada: Centavos;
  lancada: Centavos;
  recebida: Centavos;
  /** Contas de comissão a receber ainda em aberto. */
  a_receber: Centavos;
  em_atraso: Centavos;
  /** null: nenhum extrato conferido para esta operadora no período. */
  informada: Centavos | null;
  /** lançada − esperada (negativo: lançou menos que o acordo). */
  diferenca_acordo: Centavos;
  /** lançada − recebida. */
  falta_receber: Centavos;
  sem_acordo: number;
  alertas: AlertaDeComissao[];
}

export interface ComissoesPorOperadora {
  operadoras: ComissaoDaOperadora[];
  linhas: LinhaDeComissao[];
  totais: { esperada: Centavos; lancada: Centavos; recebida: Centavos; a_receber: Centavos; em_atraso: Centavos; alertas: number };
}

const brl = (v: unknown): Centavos => paraCentavos(num(v));
const reaisTxt = (c: Centavos) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** A diferença que chama atenção: mais de R$ 1,00 e de 1% do esperado. */
export function diferencaRelevante(diferenca: Centavos, base: Centavos): boolean {
  return Math.abs(diferenca) > Math.max(100, Math.round(Math.abs(base) / 100));
}

export function comissoesPorOperadora(e: {
  vendas: readonly VendaParaComissao[];
  acordos: readonly AcordoComFornecedor[];
  extrato?: readonly LinhaDoExtrato[];
  hoje: string;
}): ComissoesPorOperadora {
  const linhas: LinhaDeComissao[] = [];
  const ops = new Map<string, ComissaoDaOperadora & { _vendas: Set<string> }>();
  const op = (id: string, nome: string) => {
    const k = id || `nome:${nome.toLowerCase()}`;
    let o = ops.get(k);
    if (!o) {
      o = {
        parte_id: id, nome: nome || 'Fornecedor não informado', vendas: 0, produtos: 0, tarifa: 0, esperada: 0, lancada: 0, recebida: 0,
        a_receber: 0, em_atraso: 0, informada: null, diferenca_acordo: 0, falta_receber: 0, sem_acordo: 0, alertas: [], _vendas: new Set(),
      };
      ops.set(k, o);
    }
    return o;
  };

  for (const { venda, posicao, contas_receber } of e.vendas) {
    // Produtos por pessoa do acerto.
    const porParte = new Map<string, { id: string; nome: string; linhas: LinhaDeComissao[] }>();
    for (const p of venda.produtos) {
      if (p.cancelado_em) continue;
      const t = totaisDoProduto(p);
      const lancada = t.brl.componentes.COMISSAO + t.brl.componentes.OVER;
      const esp = esperadoDoProduto(p, venda.data_venda, e.acordos);
      if (lancada === 0 && !esp) continue;
      const esperada = esp ? emReais(esp.comissao + esp.over, p.moeda, p.cambio) : lancada;
      const { parte } = parteDoAcerto(p);
      const id = parte?.id ?? '';
      const nome = parte?.nome ?? '';
      const k = id || `nome:${nome.toLowerCase()}`;
      if (!porParte.has(k)) porParte.set(k, { id, nome, linhas: [] });
      const linha: LinhaDeComissao = {
        parte_id: id, parte_nome: nome, venda_id: venda.id, venda_numero: venda.numero, data_venda: venda.data_venda,
        produto_id: p.id, produto: p.descricao || p.tipo, localizador: p.localizador, tarifa: t.brl.tarifa,
        esperada, lancada, recebida: 0, sem_acordo: !esp, motivo_acordo: esp?.motivo ?? 'Sem acordo vigente na data da venda.',
      };
      porParte.get(k)!.linhas.push(linha);
    }
    for (const g of porParte.values()) {
      const lado = posicao.fornecedores.find(f => f.papel === 'fornecedor' && (g.id ? f.parte_id === g.id : f.nome.toLowerCase() === g.nome.toLowerCase()));
      const lancada = g.linhas.reduce((a, l) => a + l.lancada, 0);
      const aReceber = lado?.a_receber ?? 0;
      const recebidoConta = Math.min(lado?.recebido ?? 0, aReceber);
      const retida = Math.max(0, lancada - aReceber);
      const aPagar = lado?.a_pagar ?? 0;
      const fracaoPaga = aPagar > 0 ? Math.min(1, (lado?.pago ?? 0) / aPagar) : 1;
      const recebida = Math.min(lancada, recebidoConta + Math.round(retida * fracaoPaga));
      // Reparte o recebido pelos produtos, na proporção do lançado.
      let resto = recebida;
      g.linhas.forEach((l, i) => {
        const v = i === g.linhas.length - 1 ? resto : (lancada > 0 ? Math.round(recebida * l.lancada / lancada) : 0);
        l.recebida = Math.max(0, Math.min(v, resto));
        resto -= l.recebida;
      });
      // Comissão a receber vencida e não recebida.
      let atraso = 0;
      for (const d of contas_receber) {
        if (String(d.origem ?? '') !== 'COMISSAO_FORNECEDOR' || String(d.status ?? '') === 'CANCELADO') continue;
        const quem = String(d.fornecedor_id ?? d.cliente_id ?? '');
        if (g.id ? quem !== g.id : String(d.fornecedor_nome ?? d.cliente_nome ?? '').toLowerCase() !== g.nome.toLowerCase()) continue;
        const venc = String(d.data_vencimento ?? '').slice(0, 10);
        if (!venc || venc >= e.hoje) continue;
        const valor = brl(d.valor_final);
        const st = String(d.status ?? '');
        const pago = st === 'RECEBIDO' ? valor : st === 'PARCIAL' ? Math.min(valor, brl(d.valor_recebido)) : 0;
        atraso += Math.max(0, valor - pago);
      }
      const o = op(g.id, g.nome);
      o._vendas.add(venda.id);
      o.produtos += g.linhas.length;
      o.tarifa += g.linhas.reduce((a, l) => a + l.tarifa, 0);
      o.esperada += g.linhas.reduce((a, l) => a + l.esperada, 0);
      o.lancada += lancada;
      o.recebida += recebida;
      o.a_receber += Math.max(0, aReceber - recebidoConta);
      o.em_atraso += atraso;
      o.sem_acordo += g.linhas.filter(l => l.sem_acordo).length;
      linhas.push(...g.linhas);
    }
  }

  // Extrato da operadora (E6).
  for (const x of e.extrato ?? []) {
    const o = [...ops.values()].find(v => v.parte_id === x.parte_id);
    if (!o) continue;
    o.informada = (o.informada ?? 0) + x.valor_centavos;
  }

  const operadoras: ComissaoDaOperadora[] = [...ops.values()].map(({ _vendas, ...o }) => {
    const r: ComissaoDaOperadora = { ...o, vendas: _vendas.size, diferenca_acordo: o.lancada - o.esperada, falta_receber: o.lancada - o.recebida, alertas: [] };
    if (r.diferenca_acordo < 0 && diferencaRelevante(r.diferenca_acordo, r.esperada)) {
      r.alertas.push({ codigo: 'ABAIXO_DO_ACORDO', gravidade: 'atencao', valor: -r.diferenca_acordo, mensagem: `Lançado ${reaisTxt(-r.diferenca_acordo)} abaixo do que o acordo prevê. Confira a comissão nas vendas.` });
    } else if (r.diferenca_acordo > 0 && diferencaRelevante(r.diferenca_acordo, r.esperada)) {
      r.alertas.push({ codigo: 'ACIMA_DO_ACORDO', gravidade: 'aviso', valor: r.diferenca_acordo, mensagem: `Lançado ${reaisTxt(r.diferenca_acordo)} acima do acordo. Se o fornecedor pagar pelo acordo, faltará esse valor.` });
    }
    if (r.em_atraso > 0) {
      r.alertas.push({ codigo: 'COMISSAO_EM_ATRASO', gravidade: 'atencao', valor: r.em_atraso, mensagem: `${reaisTxt(r.em_atraso)} de comissão vencida e não recebida.` });
    }
    if (r.informada !== null && diferencaRelevante(r.informada - r.lancada, r.lancada)) {
      r.alertas.push({ codigo: 'EXTRATO_DIVERGENTE', gravidade: 'atencao', valor: r.informada - r.lancada, mensagem: `O extrato da operadora mostra ${reaisTxt(r.informada)}; as vendas somam ${reaisTxt(r.lancada)}.` });
    }
    if (r.sem_acordo > 0) {
      r.alertas.push({ codigo: 'SEM_ACORDO', gravidade: 'aviso', mensagem: `${r.sem_acordo === 1 ? '1 produto' : `${r.sem_acordo} produtos`} sem acordo vigente: o esperado é o lançado.` });
    }
    return r;
  }).sort((a, b) => b.lancada - a.lancada || a.nome.localeCompare(b.nome));

  const soma = (k: 'esperada' | 'lancada' | 'recebida' | 'a_receber' | 'em_atraso') => operadoras.reduce((a, o) => a + o[k], 0);
  return {
    operadoras,
    linhas: linhas.sort((a, b) => a.parte_nome.localeCompare(b.parte_nome) || (a.data_venda < b.data_venda ? -1 : a.data_venda > b.data_venda ? 1 : 0)),
    totais: { esperada: soma('esperada'), lancada: soma('lancada'), recebida: soma('recebida'), a_receber: soma('a_receber'), em_atraso: soma('em_atraso'), alertas: operadoras.reduce((a, o) => a + o.alertas.filter(x => x.gravidade === 'atencao').length, 0) },
  };
}
