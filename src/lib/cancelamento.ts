/**
 * CANCELAMENTO POR PASSAGEIRO OU PRODUTO (E5, parte D, 05/11/2026). Arquivo puro.
 *
 * O cliente desiste de parte da viagem (um passageiro, um produto, tudo). O
 * que acontece com o dinheiro depende de três escolhas, ditas na tela com as
 * nossas palavras:
 *
 *  - "Tirar do fornecedor o que ainda falta pagar" (zerar_fornecedor): a
 *    agência passa a dever ao fornecedor só a MULTA dele. Sem marcar, o
 *    fornecedor continua recebendo o valor inteiro (tarifa não reembolsável,
 *    ou o reembolso dele vem depois, como "Reembolso do fornecedor").
 *  - "Tirar do cliente o que ainda falta receber" (zerar_cliente): o cliente
 *    passa a dever só a multa cobrada dele (por padrão, a mesma do
 *    fornecedor). Sem marcar, ele continua devendo o valor inteiro.
 *  - "Manter na meta de comissão" (manter_na_meta): o vendedor não perde a
 *    comissão nem a meta por este cancelamento. Sem marcar, a comissão dele
 *    é estornada na proporção da receita que saiu.
 *
 * Como o modelo guarda isto: o passageiro (ou o produto) ganha `cancelado_em`
 * e sai das contas, e o que CONTINUA VALENDO entra como dois componentes do
 * próprio produto — "Cobrado no cancelamento" (soma ao que o cliente paga) e
 * "Retido pelo fornecedor" (soma ao que a agência deve a ele). Assim o
 * gerador de contas de sempre (venda-contas.ts) refaz tudo sozinho, a receita
 * mostra a multa aberta, e um reprocessamento da venda não desfaz nada.
 *
 * Do lado do cliente, o que deixa de ser devido sai dos pagamentos, nesta
 * ordem: primeiro o que ainda está em aberto (contas livres), depois o
 * crédito do cliente ainda não usado, depois o que já foi recebido (essa
 * parte é a SOBRA, que vira reembolso ou crédito do cliente, à escolha) e,
 * por último, crédito já usado (volta sozinho para a carteira).
 *
 * Dinheiro em centavos; multa na moeda do produto.
 */
import { addDias, deCentavos, round2 } from './money';
import {
  COMPONENTES_DO_CANCELAMENTO, FORMAS, ROTULO_TIPO_PRODUTO, dataOuVazio, emReais, totaisDaVenda, totaisDoProduto,
  type Centavos, type ComponenteDeReceita, type PagamentoDaVenda, type ProdutoDaVenda, type Venda,
} from './venda-modelo';

// ============================================================
// Pedido
// ============================================================

export interface ItemDoCancelamento {
  produto_id: string;
  /** null = o produto inteiro (todos os passageiros). */
  passageiro_ids: string[] | null;
}

export interface MultaDoProduto {
  produto_id: string;
  /** Multa do fornecedor, na moeda do produto. */
  fornecedor_centavos: Centavos;
  /** Multa cobrada do cliente, na moeda do produto. null = a mesma do fornecedor. */
  cliente_centavos: Centavos | null;
}

export type DestinoDaSobra = 'reembolso' | 'credito';

export interface PedidoDeCancelamento {
  data: string;
  motivo: string;
  itens: ItemDoCancelamento[];
  multas: MultaDoProduto[];
  zerar_fornecedor: boolean;
  zerar_cliente: boolean;
  manter_na_meta: boolean;
  /** O que fazer com o dinheiro que o cliente já pagou e deixou de ser devido. */
  sobra: DestinoDaSobra;
  /** Prazo do reembolso ao cliente (quando a sobra vira reembolso). */
  prazo_reembolso: string;
  /** Validade do crédito (quando a sobra vira crédito). */
  validade_credito: string;
}

export const MOTIVO_MINIMO_CANCELAMENTO = 5;
/** Prazo padrão para devolver ao cliente. */
export const DIAS_PRAZO_REEMBOLSO_CLIENTE = 7;
/** Prazo padrão para o fornecedor devolver à agência. */
export const DIAS_PRAZO_REEMBOLSO_FORNECEDOR = 30;

export interface ErroDoPedido { campo: string; mensagem: string }

const txt = (v: unknown, max = 500) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const inteiroNaoNegativo = (v: unknown): Centavos => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Lê o pedido da tela e confere contra a venda. */
export function normalizarPedidoDeCancelamento(v: unknown, venda: Venda, hoje: string): { pedido: PedidoDeCancelamento; erros: ErroDoPedido[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const erros: ErroDoPedido[] = [];
  const data = dataOuVazio(o.data) || hoje;
  if (venda.data_venda && data < venda.data_venda) erros.push({ campo: 'data', mensagem: 'A data do cancelamento não pode ser antes da data da venda.' });
  const motivo = txt(o.motivo, 500);
  if (motivo.length < MOTIVO_MINIMO_CANCELAMENTO) erros.push({ campo: 'motivo', mensagem: `Diga o motivo do cancelamento (pelo menos ${MOTIVO_MINIMO_CANCELAMENTO} letras).` });

  const porProduto = new Map(venda.produtos.map(p => [p.id, p]));
  const itens: ItemDoCancelamento[] = [];
  const vistos = new Set<string>();
  for (const x of (Array.isArray(o.itens) ? o.itens : []).slice(0, 300)) {
    const q = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const produto_id = txt(q.produto_id, 80);
    const p = porProduto.get(produto_id);
    if (!p) { erros.push({ campo: 'itens', mensagem: 'Um dos produtos escolhidos não está na venda.' }); continue; }
    if (vistos.has(produto_id)) continue;
    vistos.add(produto_id);
    if (p.cancelado_em) { erros.push({ campo: 'itens', mensagem: `${nomeDoProduto(p)} já foi cancelado.` }); continue; }
    const pedidos = Array.isArray(q.passageiro_ids) ? [...new Set(q.passageiro_ids.map(i => txt(i, 80)).filter(Boolean))] : null;
    if (pedidos && p.passageiros.length) {
      const ativos = new Set(p.passageiros.filter(x => !x.cancelado_em).map(x => x.id));
      const fora = pedidos.filter(id => !ativos.has(id));
      if (fora.length) { erros.push({ campo: 'itens', mensagem: `${nomeDoProduto(p)}: passageiro não encontrado ou já cancelado.` }); continue; }
      if (!pedidos.length) continue;
      // Todos os ativos escolhidos = o produto inteiro.
      itens.push({ produto_id, passageiro_ids: pedidos.length === ativos.size ? null : pedidos });
    } else {
      itens.push({ produto_id, passageiro_ids: null });
    }
  }
  if (!itens.length && !erros.some(e => e.campo === 'itens')) erros.push({ campo: 'itens', mensagem: 'Escolha o passageiro ou o produto que será cancelado.' });

  const multas: MultaDoProduto[] = [];
  for (const x of (Array.isArray(o.multas) ? o.multas : []).slice(0, 300)) {
    const q = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const produto_id = txt(q.produto_id, 80);
    if (!itens.some(i => i.produto_id === produto_id)) continue;
    const cli = q.cliente_centavos === null || q.cliente_centavos === undefined || q.cliente_centavos === '' ? null : inteiroNaoNegativo(q.cliente_centavos);
    multas.push({ produto_id, fornecedor_centavos: inteiroNaoNegativo(q.fornecedor_centavos), cliente_centavos: cli });
  }
  const sobra: DestinoDaSobra = txt(o.sobra) === 'credito' ? 'credito' : 'reembolso';
  return {
    pedido: {
      data, motivo, itens, multas,
      zerar_fornecedor: o.zerar_fornecedor === true,
      zerar_cliente: o.zerar_cliente === true,
      manter_na_meta: o.manter_na_meta === true,
      sobra,
      prazo_reembolso: dataOuVazio(o.prazo_reembolso) || addDias(hoje, DIAS_PRAZO_REEMBOLSO_CLIENTE),
      validade_credito: dataOuVazio(o.validade_credito) || '',
    },
    erros,
  };
}

export function nomeDoProduto(p: Pick<ProdutoDaVenda, 'descricao' | 'tipo'>): string {
  return p.descricao || ROTULO_TIPO_PRODUTO[p.tipo];
}

// ============================================================
// Multa sugerida
// ============================================================

/** Política de cancelamento no cadastro do fornecedor (fornecedores_crm.data.politica_cancelamento). */
export interface PoliticaDeCancelamento {
  /** Cada faixa vale quando faltam ATÉ `dias_antes` dias para o início do serviço. */
  faixas: Array<{ dias_antes: number; percentual: number }>;
}

export interface MultaSugerida {
  /** Na moeda do produto. */
  centavos: Centavos;
  origem: 'reserva' | 'fornecedor' | 'sem_politica';
  explicacao: string;
}

export function normalizarPolitica(v: unknown): PoliticaDeCancelamento | null {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null;
  const faixas = (Array.isArray(o?.faixas) ? o!.faixas : []).flatMap(x => {
    const q = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const dias = Math.floor(Number(q.dias_antes));
    const pct = Number(q.percentual);
    return Number.isFinite(dias) && dias >= 0 && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? [{ dias_antes: dias, percentual: pct }] : [];
  });
  return faixas.length ? { faixas } : null;
}

function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de}T12:00:00Z`);
  const b = Date.parse(`${ate}T12:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : 0;
}

const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pctBR = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/**
 * A multa que o fornecedor deve cobrar, quando dá para saber:
 *  1. a da RESERVA, que o CRM manda nos detalhes do produto
 *     (`multa_cancelamento` em reais/moeda, ou `multa_percentual`, e
 *     `multa_a_partir_de`: antes desta data, cancelar é grátis);
 *  2. a política do cadastro do fornecedor (faixas por dias antes do início);
 *  3. sem nenhuma das duas, zero e a pessoa digita.
 * `base` é o que a agência devia ao fornecedor pela parte cancelada.
 */
export function sugerirMulta(produto: ProdutoDaVenda, base: Centavos, data: string, politica: PoliticaDeCancelamento | null): MultaSugerida {
  const d = produto.detalhes ?? {};
  const aPartir = dataOuVazio(d.multa_a_partir_de);
  const valorReserva = d.multa_cancelamento ? Math.round(round2(Number(String(d.multa_cancelamento).replace(',', '.')) || 0) * 100) : 0;
  const pctReserva = Number(String(d.multa_percentual ?? '').replace(',', '.'));
  const temReserva = valorReserva > 0 || (Number.isFinite(pctReserva) && pctReserva > 0) || Boolean(aPartir);
  if (temReserva) {
    if (aPartir && data < aPartir) {
      return { centavos: 0, origem: 'reserva', explicacao: `A reserva permite cancelar sem multa até ${dataBR(addDias(aPartir, -1))}.` };
    }
    if (valorReserva > 0) {
      const v = Math.min(valorReserva, base);
      return { centavos: v, origem: 'reserva', explicacao: `Multa informada na reserva${aPartir ? ` a partir de ${dataBR(aPartir)}` : ''}.` };
    }
    if (Number.isFinite(pctReserva) && pctReserva > 0) {
      return { centavos: Math.round(base * Math.min(100, pctReserva) / 100), origem: 'reserva', explicacao: `${pctBR(pctReserva)} do valor, como diz a reserva.` };
    }
  }
  if (politica && produto.data_inicio) {
    const faltam = diasEntre(data, produto.data_inicio);
    const valem = politica.faixas.filter(f => faltam <= f.dias_antes).sort((a, b) => a.dias_antes - b.dias_antes);
    if (!valem.length) return { centavos: 0, origem: 'fornecedor', explicacao: `Faltam ${faltam} dias para o início: pela política do fornecedor, sem multa.` };
    const f = valem[0];
    return {
      centavos: Math.round(base * f.percentual / 100), origem: 'fornecedor',
      explicacao: `Faltam ${Math.max(0, faltam)} dias para o início: ${pctBR(f.percentual)} pela política do fornecedor (até ${f.dias_antes} dias antes).`,
    };
  }
  return { centavos: 0, origem: 'sem_politica', explicacao: 'Sem política de cancelamento na reserva nem no cadastro do fornecedor: digite a multa que ele informou.' };
}

// ============================================================
// O plano no modelo
// ============================================================

/** O que já se sabe de cada pagamento antes de cancelar (vem do banco). */
export interface EstadoDosPagamentos {
  /** Centavos ainda em contas livres (em aberto, sem cobrança emitida) por pagamento. */
  livre: Record<string, Centavos>;
  /** Crédito do cliente ainda não tirado da carteira, por pagamento de crédito. */
  credito_nao_usado: Record<string, Centavos>;
}

export type FaixaDaReducao = 'em_aberto' | 'credito_nao_usado' | 'ja_recebido' | 'credito_usado';

export interface ReducaoDePagamento {
  pagamento_id: string;
  forma: PagamentoDaVenda['forma'];
  faixa: FaixaDaReducao;
  centavos: Centavos;
}

export interface CancelamentoDoProduto {
  produto_id: string;
  descricao: string;
  tipo: ProdutoDaVenda['tipo'];
  moeda: string;
  cambio: number;
  quem_cobra: ProdutoDaVenda['quem_cobra'];
  produto_inteiro: boolean;
  passageiros: Array<{ id: string; nome: string }>;
  /** Na moeda do produto: o que a parte cancelada valia. */
  valor_cliente: Centavos;
  valor_fornecedor: Centavos;
  multa_fornecedor: Centavos;
  multa_cliente: Centavos;
  /** O que continua valendo (os dois componentes gravados). */
  retido_cliente: Centavos;
  retido_fornecedor: Centavos;
  /** Em centavos de real: o que deixa de ser cobrado do cliente e de ser devido ao fornecedor. */
  sai_do_cliente_brl: Centavos;
  sai_do_fornecedor_brl: Centavos;
  componentes: ComponenteDeReceita[];
}

export interface AvisoDoCancelamento { codigo: string; mensagem: string; valor_centavos?: Centavos }

export interface PlanoNoModelo {
  venda: Venda;
  produtos: CancelamentoDoProduto[];
  reducoes: ReducaoDePagamento[];
  /** Quanto, em reais, deixou de ser devido pelo cliente. */
  reducao_cliente_centavos: Centavos;
  /** O que já tinha entrado e passou a sobrar (estimativa; o servidor confirma pelas contas). */
  sobra_prevista_centavos: Centavos;
  /** Crédito já usado que volta para a carteira. */
  credito_devolvido_centavos: Centavos;
  todos_cancelados: boolean;
  avisos: AvisoDoCancelamento[];
  erros: ErroDoPedido[];
}

const ehDaAgencia = (pag: PagamentoDaVenda) => {
  const e = FORMAS[pag.forma].efeito;
  return e === 'receber_do_cliente' || e === 'faturar_ao_cliente';
};

/**
 * Aplica o pedido ao modelo da venda (sem banco). `cancelamentoId` dá ids
 * estáveis aos componentes gravados.
 */
export function planejarCancelamento(venda: Venda, pedido: PedidoDeCancelamento, estado: EstadoDosPagamentos, cancelamentoId: string): PlanoNoModelo {
  const erros: ErroDoPedido[] = [];
  const avisos: AvisoDoCancelamento[] = [];
  const nova: Venda = {
    ...venda,
    produtos: venda.produtos.map(p => ({ ...p, passageiros: p.passageiros.map(x => ({ ...x })), componentes: p.componentes.map(c => ({ ...c })) })),
    pagamentos: venda.pagamentos.map(g => ({ ...g })),
  };
  const antesDaVenda = totaisDaVenda(venda);
  const produtos: CancelamentoDoProduto[] = [];

  for (const item of pedido.itens) {
    const p = nova.produtos.find(x => x.id === item.produto_id);
    if (!p) continue;
    const antes = totaisDoProduto(p);
    const escolhidos = item.passageiro_ids === null
      ? p.passageiros.filter(x => !x.cancelado_em)
      : p.passageiros.filter(x => item.passageiro_ids!.includes(x.id) && !x.cancelado_em);
    for (const x of escolhidos) x.cancelado_em = pedido.data;
    const inteiro = item.passageiro_ids === null || p.passageiros.every(x => x.cancelado_em);
    if (inteiro) p.cancelado_em = pedido.data;
    const sem = totaisDoProduto(p);
    const valor_cliente = antes.valor_cliente - sem.valor_cliente;
    const valor_fornecedor = antes.valor_fornecedor - sem.valor_fornecedor;

    const m = pedido.multas.find(x => x.produto_id === p.id);
    const multaForn = m?.fornecedor_centavos ?? 0;
    const multaCli = m?.cliente_centavos ?? multaForn;
    const nome = nomeDoProduto(p);
    if (multaForn > valor_fornecedor && p.quem_cobra === 'AGENCIA') {
      erros.push({ campo: 'multas', mensagem: `${nome}: a multa do fornecedor passa do que a agência devia a ele pela parte cancelada.` });
    }
    if (multaCli > valor_cliente && p.quem_cobra === 'AGENCIA') {
      erros.push({ campo: 'multas', mensagem: `${nome}: a multa do cliente passa do que ele pagaria pela parte cancelada.` });
    }

    let retido_cliente = 0;
    let retido_fornecedor = 0;
    if (p.quem_cobra === 'FORNECEDOR') {
      // O fornecedor cobrou direto: multa e devolução são entre ele e o
      // cliente. Aqui muda só a comissão que a agência tinha a receber.
      avisos.push({ codigo: 'COBRADO_PELO_FORNECEDOR', mensagem: `${nome}: o fornecedor cobra direto do cliente. A multa e a devolução são entre eles; aqui só sai a comissão que a agência tinha a receber.` });
    } else {
      retido_fornecedor = pedido.zerar_fornecedor ? Math.min(multaForn, valor_fornecedor) : valor_fornecedor;
      retido_cliente = pedido.zerar_cliente ? Math.min(multaCli, valor_cliente) : valor_cliente;
    }
    const nomes = escolhidos.map(x => x.nome).filter(Boolean);
    const sobre = inteiro && !nomes.length ? nome : `${nome}${nomes.length ? ` (${nomes.join(', ')})` : ''}`;
    const quando = `${pedido.data.slice(8, 10)}/${pedido.data.slice(5, 7)}/${pedido.data.slice(0, 4)}`;
    const componentes: ComponenteDeReceita[] = [];
    if (retido_cliente > 0) {
      componentes.push({
        id: `cx:${cancelamentoId}:${p.id}:cli`, tipo: 'COBRADO_NO_CANCELAMENTO', valor_centavos: retido_cliente, percentual: null, passageiro_id: null,
        descricao: `Cancelamento de ${quando}: ${sobre}. ${pedido.zerar_cliente ? 'Multa cobrada do cliente.' : 'O cliente segue devendo o valor.'}`.slice(0, 200),
      });
    }
    if (retido_fornecedor > 0) {
      componentes.push({
        id: `cx:${cancelamentoId}:${p.id}:forn`, tipo: 'RETIDO_PELO_FORNECEDOR', valor_centavos: retido_fornecedor, percentual: null, passageiro_id: null,
        descricao: `Cancelamento de ${quando}: ${sobre}. ${pedido.zerar_fornecedor ? 'Multa do fornecedor.' : 'A agência segue devendo o valor ao fornecedor.'}`.slice(0, 200),
      });
    }
    p.componentes.push(...componentes);
    const depois = totaisDoProduto(p);
    produtos.push({
      produto_id: p.id, descricao: nome, tipo: p.tipo, moeda: p.moeda, cambio: p.cambio, quem_cobra: p.quem_cobra,
      produto_inteiro: inteiro, passageiros: escolhidos.map(x => ({ id: x.id, nome: x.nome })),
      valor_cliente, valor_fornecedor, multa_fornecedor: multaForn, multa_cliente: multaCli,
      retido_cliente, retido_fornecedor,
      sai_do_cliente_brl: antes.brl.valor_cliente - depois.brl.valor_cliente,
      sai_do_fornecedor_brl: antes.brl.valor_fornecedor - depois.brl.valor_fornecedor,
      componentes,
    });
  }

  // ---- Cliente: o que deixou de ser devido sai dos pagamentos ----
  const depoisDaVenda = totaisDaVenda(nova);
  const acimaAntes = Math.max(0, -antesDaVenda.saldo_sem_forma);
  const acimaDepois = Math.max(0, -depoisDaVenda.saldo_sem_forma);
  let falta = Math.max(0, acimaDepois - acimaAntes);
  const reducao_cliente_centavos = falta;
  const reducoes: ReducaoDePagamento[] = [];
  const tirar = (g: PagamentoDaVenda, centavos: number, faixa: FaixaDaReducao) => {
    const v = Math.min(centavos, g.valor_centavos, falta);
    if (v <= 0) return;
    g.valor_centavos -= v;
    falta -= v;
    const ja = reducoes.find(r => r.pagamento_id === g.id && r.faixa === faixa);
    if (ja) ja.centavos += v; else reducoes.push({ pagamento_id: g.id, forma: g.forma, faixa, centavos: v });
  };
  const deTrasPraFrente = [...nova.pagamentos].reverse();
  for (const g of deTrasPraFrente) if (ehDaAgencia(g)) tirar(g, estado.livre[g.id] ?? 0, 'em_aberto');
  for (const g of deTrasPraFrente) if (g.forma === 'CREDITO_CLIENTE') tirar(g, estado.credito_nao_usado[g.id] ?? 0, 'credito_nao_usado');
  for (const g of deTrasPraFrente) if (ehDaAgencia(g)) tirar(g, g.valor_centavos, 'ja_recebido');
  for (const g of deTrasPraFrente) if (g.forma === 'CREDITO_CLIENTE') tirar(g, g.valor_centavos, 'credito_usado');
  if (falta > 0) {
    avisos.push({
      codigo: 'PAGO_FORA_DA_AGENCIA', valor_centavos: falta,
      mensagem: `${deCentavos(falta).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} foram pagos direto ao fornecedor ou ficaram com o intermediário: a devolução desse valor é com eles.`,
    });
  }
  nova.pagamentos = nova.pagamentos.filter(g => g.valor_centavos > 0);

  const soma = (f: FaixaDaReducao) => reducoes.filter(r => r.faixa === f).reduce((a, r) => a + r.centavos, 0);
  return {
    venda: nova,
    produtos,
    reducoes,
    reducao_cliente_centavos,
    sobra_prevista_centavos: soma('ja_recebido'),
    credito_devolvido_centavos: soma('credito_usado'),
    todos_cancelados: nova.produtos.length > 0 && nova.produtos.every(p => p.cancelado_em),
    avisos,
    erros,
  };
}

// ============================================================
// Reaplicar (a venda chegou de novo do CRM)
// ============================================================

/** O que um cancelamento gravado deixou no modelo (venda_cancelamentos.plano). */
export interface CancelamentoGravado {
  id: string;
  data: string;
  produtos: Array<Pick<CancelamentoDoProduto, 'produto_id' | 'produto_inteiro' | 'passageiros' | 'componentes'>>;
  reducoes: ReducaoDePagamento[];
}

/**
 * Quando o CRM manda a venda de novo, ela chega sem saber do cancelamento
 * feito aqui. Reaplica os cancelamentos gravados, na ordem, sobre a venda que
 * chegou: passageiros e produtos cancelados, componentes do cancelamento e o
 * que saiu de cada pagamento. Idempotente (componente pelo id).
 */
export function reaplicarCancelamentos(venda: Venda, gravados: CancelamentoGravado[]): Venda {
  if (!gravados.length) return venda;
  const v: Venda = {
    ...venda,
    produtos: venda.produtos.map(p => ({ ...p, passageiros: p.passageiros.map(x => ({ ...x })), componentes: p.componentes.map(c => ({ ...c })) })),
    pagamentos: venda.pagamentos.map(g => ({ ...g })),
  };
  for (const c of gravados) {
    for (const cp of c.produtos) {
      const p = v.produtos.find(x => x.id === cp.produto_id);
      if (!p) continue;
      for (const x of p.passageiros) if (cp.produto_inteiro || cp.passageiros.some(y => y.id === x.id)) x.cancelado_em = x.cancelado_em || c.data;
      if (cp.produto_inteiro || (p.passageiros.length && p.passageiros.every(x => x.cancelado_em))) p.cancelado_em = p.cancelado_em || c.data;
      for (const comp of cp.componentes) {
        if (!COMPONENTES_DO_CANCELAMENTO.has(comp.tipo)) continue;
        if (!p.componentes.some(x => x.id === comp.id)) p.componentes.push({ ...comp });
      }
    }
    for (const r of c.reducoes) {
      const g = v.pagamentos.find(x => x.id === r.pagamento_id);
      if (g) g.valor_centavos = Math.max(0, g.valor_centavos - r.centavos);
    }
    v.pagamentos = v.pagamentos.filter(g => g.valor_centavos > 0);
  }
  return v;
}

// ============================================================
// Comissão do vendedor
// ============================================================

export interface ComissaoParaEstorno {
  id: string;
  status: string;
  valor_comissao: number;
  valor_base: number;
  vendedor_nome: string;
  origem?: string;
}

export type AcaoNaComissao = 'reduzir' | 'cancelar' | 'estornar_paga' | 'manter';

export interface EstornoDeComissao {
  comissao_id: string;
  vendedor_nome: string;
  status: string;
  acao: AcaoNaComissao;
  /** Em reais. */
  valor_antes: number;
  valor_depois: number;
  estorno: number;
  base_depois: number;
}

/**
 * O que acontece com a comissão do vendedor: sai na mesma proporção da
 * receita que o cancelamento tirou. Ainda não paga: o valor cai (ou a
 * comissão é cancelada, se zerar). Já paga: nasce o estorno (a receber do
 * vendedor). "Manter na meta": nada muda.
 */
export function planoDoEstornoDeComissao(comissoes: ComissaoParaEstorno[], receitaAntes: Centavos, receitaDepois: Centavos, manter: boolean): EstornoDeComissao[] {
  const proporcao = receitaAntes > 0 ? Math.max(0, Math.min(1, receitaDepois / receitaAntes)) : 0;
  return comissoes
    .filter(c => c.status !== 'CANCELADA' && c.origem !== 'mrr' && c.origem !== 'estorno' && round2(c.valor_comissao) > 0)
    .map(c => {
      const antes = round2(c.valor_comissao);
      if (manter || receitaDepois >= receitaAntes) {
        return { comissao_id: c.id, vendedor_nome: c.vendedor_nome, status: c.status, acao: 'manter' as const, valor_antes: antes, valor_depois: antes, estorno: 0, base_depois: round2(c.valor_base) };
      }
      const depois = round2(antes * proporcao);
      const estorno = round2(antes - depois);
      const acao: AcaoNaComissao = c.status === 'PAGA' ? 'estornar_paga' : depois <= 0 ? 'cancelar' : 'reduzir';
      return {
        comissao_id: c.id, vendedor_nome: c.vendedor_nome, status: c.status, acao,
        valor_antes: antes, valor_depois: acao === 'estornar_paga' ? antes : depois, estorno,
        base_depois: round2(round2(c.valor_base) * proporcao),
      };
    });
}

/** Centavos de real de um valor na moeda do produto (atalho para a tela). */
export function noReal(valor: Centavos, moeda: string, cambio: number): Centavos {
  return emReais(valor, moeda, cambio);
}

// ============================================================
// Desfazer (reativar) um cancelamento
// ============================================================

export const MOTIVO_MINIMO_DESFAZER = 5;

export interface PagamentoDevolvido {
  pagamento_id: string;
  forma: PagamentoDaVenda['forma'];
  centavos: Centavos;
  /** O pagamento tinha sumido da venda (ficou zerado) e voltou. */
  recriado: boolean;
}

export interface DesfazerNoModelo {
  venda: Venda;
  produtos: Array<{ produto_id: string; descricao: string; produto_inteiro: boolean; passageiros: string[] }>;
  pagamentos: PagamentoDevolvido[];
}

/**
 * O contrário de `planejarCancelamento`, sobre a venda de agora: os
 * passageiros e produtos que ESTE cancelamento cancelou voltam, os
 * componentes que ele gravou (`cx:<id>:…`) saem e o que ele tirou de cada
 * pagamento volta. Pagamento que tinha sumido (ficou zerado) volta com os
 * dados de antes do cancelamento, quando guardados; senão, com a forma e o
 * valor. Cancelamentos anteriores ficam como estão.
 */
export function desfazerNoModelo(venda: Venda, gravado: CancelamentoGravado, pagamentosAntes: readonly PagamentoDaVenda[] = []): DesfazerNoModelo {
  const v: Venda = {
    ...venda,
    produtos: venda.produtos.map(p => ({ ...p, passageiros: p.passageiros.map(x => ({ ...x })), componentes: p.componentes.map(c => ({ ...c })) })),
    pagamentos: venda.pagamentos.map(g => ({ ...g })),
  };
  const prefixo = `cx:${gravado.id}:`;
  const produtos: DesfazerNoModelo['produtos'] = [];
  for (const cp of gravado.produtos) {
    const p = v.produtos.find(x => x.id === cp.produto_id);
    if (!p) continue;
    const ids = new Set(cp.passageiros.map(x => x.id));
    const nomes: string[] = [];
    for (const x of p.passageiros) {
      if (ids.has(x.id) && x.cancelado_em) { x.cancelado_em = null; nomes.push(x.nome); }
    }
    if (cp.produto_inteiro || p.passageiros.some(x => !x.cancelado_em)) p.cancelado_em = null;
    p.componentes = p.componentes.filter(c => !c.id.startsWith(prefixo));
    produtos.push({ produto_id: p.id, descricao: nomeDoProduto(p), produto_inteiro: cp.produto_inteiro, passageiros: nomes });
  }
  const pagamentos: PagamentoDevolvido[] = [];
  for (const r of gravado.reducoes) {
    if (!(r.centavos > 0)) continue;
    let g = v.pagamentos.find(x => x.id === r.pagamento_id);
    let recriado = false;
    if (!g) {
      const antes = pagamentosAntes.find(x => x.id === r.pagamento_id);
      g = antes
        ? { ...antes, valor_centavos: 0 }
        : {
            id: r.pagamento_id, forma: r.forma, valor_centavos: 0, parcelas: 1, primeiro_vencimento: '', intervalo_dias: 0,
            pagante: null, fornecedor: null, conta_bancaria_id: null, cartao_tipo: r.forma === 'CARTAO' ? 'credito' : null, detalhe: '', venda_origem_credito: '',
          } as PagamentoDaVenda;
      v.pagamentos.push(g);
      recriado = true;
    }
    g.valor_centavos += r.centavos;
    const id = g.id;
    const ja = pagamentos.find(x => x.pagamento_id === id);
    if (ja) ja.centavos += r.centavos; else pagamentos.push({ pagamento_id: id, forma: g.forma, centavos: r.centavos, recriado });
  }
  // A ordem de antes do cancelamento, quando conhecida (as parcelas e a tela seguem a mesma).
  if (pagamentosAntes.length) {
    const ordem = new Map(pagamentosAntes.map((x, i) => [x.id, i]));
    v.pagamentos.sort((a, b) => (ordem.get(a.id) ?? 1e9) - (ordem.get(b.id) ?? 1e9));
  }
  return { venda: v, produtos, pagamentos };
}
