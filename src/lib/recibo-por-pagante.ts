/**
 * Recibo da venda e recibo da fatura (E7, 06/11/2026) — regras puras.
 *
 * Recibo da VENDA, um por pagante:
 *   · "recebemos" = o que a agência recebeu daquele pagante: as baixas que
 *     valem das contas a receber da venda (a conta que está numa fatura entra
 *     pelo recebimento da fatura) e o crédito do cliente já usado;
 *   · pago direto ao fornecedor aparece à parte (não passou pela agência),
 *     mas entra no "total quitado";
 *   · com saldo em aberto o recibo sai PARCIAL: cobre só o que já foi pago e
 *     diz quanto falta (melhor que recusar: o cliente que pagou o sinal
 *     precisa do comprovante);
 *   · sem nada pago: sem recibo, com o motivo escrito.
 *
 * Recibo da FATURA (consolidado): cada recebimento da conta da fatura (data,
 * forma, conta, valor) e o total. Fatura cancelada, ainda aberta ou sem
 * recebimento: sem recibo.
 *
 * O texto da declaração é da agência (Configurações › Vendas), com
 * marcadores simples entre chaves. Dinheiro somado em centavos; o recibo sai
 * em reais, como o recibo da conta (./cobranca/recibo.ts).
 */
import { formatarDocumento } from './cliente-documento';
import { comMaiuscula, valorPorExtenso } from './cobranca/extenso';
import { emitenteDoRecibo, rotuloDaForma, type AgenciaDoRecibo, type BaixaDoRecibo, type Recibo } from './cobranca/recibo';
import { marcaDoDocumento, type MarcaDoDocumento } from './marca-da-agencia';
import { FORMAS, ROTULO_TIPO_PRODUTO, type FormaDaVenda, type ParteDaVenda, type Venda } from './venda-modelo';

// ============================================================
// Texto configurável
// ============================================================

export interface ConfigDoRecibo {
  /** A declaração, com marcadores. Vazio = o texto padrão. */
  texto: string;
  /** Linha a mais no fim (política de cancelamento, contato, observação fixa). */
  complemento: string;
}

export const TEXTO_DO_RECIBO_PADRAO =
  '{agencia} declara que recebeu de {pagante} a importância de {valor} ({valor_extenso}), referente aos serviços de turismo da venda {venda}, descritos abaixo e pagos nas formas indicadas, pela qual dá quitação.';

export const CONFIG_DO_RECIBO_PADRAO: ConfigDoRecibo = { texto: '', complemento: '' };

export const MARCADORES_DO_RECIBO: ReadonlyArray<{ marca: string; rotulo: string; exemplo: string }> = [
  { marca: '{agencia}', rotulo: 'Nome da agência', exemplo: 'Viagens Exemplo Ltda.' },
  { marca: '{pagante}', rotulo: 'Quem pagou', exemplo: 'Carla Dias' },
  { marca: '{documento}', rotulo: 'CPF ou CNPJ de quem pagou', exemplo: '123.456.789-09' },
  { marca: '{valor}', rotulo: 'Valor recebido', exemplo: 'R$ 1.500,00' },
  { marca: '{valor_extenso}', rotulo: 'Valor recebido por extenso', exemplo: 'mil e quinhentos reais' },
  { marca: '{venda}', rotulo: 'Número da venda', exemplo: '1042' },
  { marca: '{data_venda}', rotulo: 'Data da venda', exemplo: '01/11/2026' },
  { marca: '{periodo}', rotulo: 'Período da viagem', exemplo: '20/12/2026 a 27/12/2026' },
];

const LIMITE_TEXTO = 1500;
const LIMITE_COMPLEMENTO = 600;

export function normalizarConfigDoRecibo(v: unknown): ConfigDoRecibo {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const limpar = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
  return { texto: limpar(o.texto, LIMITE_TEXTO), complemento: limpar(o.complemento, LIMITE_COMPLEMENTO) };
}

/** Marcadores escritos que o recibo não conhece (a tela avisa antes de salvar). */
export function marcadoresDesconhecidos(texto: string): string[] {
  const conhecidos = new Set(MARCADORES_DO_RECIBO.map(m => m.marca));
  return [...new Set((texto.match(/\{[^{}\s]{1,30}\}/g) ?? []).filter(m => !conhecidos.has(m)))];
}

/** Troca os marcadores pelos valores; o que não é marcador fica como está. */
export function preencherTexto(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{([a-z_]{1,30})\}/g, (m, chave: string) => (chave in valores ? valores[chave] : m));
}

// ============================================================
// Utilitários
// ============================================================

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
const reais = (centavos: number) => Math.round(centavos) / 100;
const emCentavos = (reaisValor: unknown) => Math.round((Number(reaisValor) || 0) * 100);

export function dataBR(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function periodoDe(inicio: string, fim: string): string {
  if (inicio && fim && inicio !== fim) return `${dataBR(inicio)} a ${dataBR(fim)}`;
  return dataBR(inicio || fim);
}

const ROTULO_DA_BAIXA: Record<string, string> = {
  CREDITO_CLIENTE: 'Crédito do cliente',
  CARTAO: 'Cartão',
  OUTROS: 'Outros',
  FATURAR: 'Fatura',
};

function formaDaBaixa(forma: string): string {
  const k = String(forma ?? '').trim().toUpperCase();
  return ROTULO_DA_BAIXA[k] ?? (FORMAS[k as FormaDaVenda]?.rotulo || rotuloDaForma(forma));
}

/** Chave estável de uma pessoa: o cadastro; sem cadastro, o nome. */
export function chaveDoPagante(id: string | null | undefined, nome: string | null | undefined): string {
  const i = String(id ?? '').trim();
  if (i) return `id:${i}`;
  return `nome:${String(nome ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

// ============================================================
// Recibo da venda
// ============================================================

/** Uma conta a receber da venda, como contasDaVendaNoBanco a devolve, com as baixas dela. */
export interface ContaDoReciboDaVenda {
  id: string;
  origem: string;
  status: string;
  cliente_id: string;
  cliente_nome: string;
  valor_final: number;
  valor_recebido: number | null;
  data_recebimento: string | null;
  forma_recebimento: string;
  parcela_numero: number;
  total_parcelas: number;
  venda_pagamento_id: string;
  /** A conta está numa fatura: o recebimento vem dela (já projetado no status). */
  fatura_numero: number | null;
  /** Conta de reembolso ou de estorno de comissão ligada à venda: não é pagamento do cliente. */
  fora_do_recibo: boolean;
  baixas: readonly BaixaDoRecibo[];
}

/** Lê a conta no formato do banco (data JSONB já aberto). */
export function contaParaRecibo(c: Record<string, unknown>, baixas: readonly BaixaDoRecibo[]): ContaDoReciboDaVenda {
  const fora = Boolean(c.reembolso_id) || Boolean(c.estorno_de_comissao) || String(c.tipo_titulo ?? '') === 'REEMBOLSO';
  return {
    id: String(c.id ?? ''),
    origem: String(c.origem ?? ''),
    status: String(c.status ?? ''),
    cliente_id: String(c.cliente_id ?? ''),
    cliente_nome: String(c.cliente_nome ?? ''),
    valor_final: Number(c.valor_final) || 0,
    valor_recebido: c.valor_recebido == null ? null : Number(c.valor_recebido) || 0,
    data_recebimento: (c.data_recebimento as string | null) ?? null,
    forma_recebimento: String(c.forma_recebimento ?? ''),
    parcela_numero: Number(c.parcela_numero) || 0,
    total_parcelas: Number(c.total_parcelas) || 0,
    venda_pagamento_id: String(c.venda_pagamento_id ?? ''),
    fatura_numero: c.na_fatura && typeof c.na_fatura === 'object' ? (Number(c.fatura_numero) || Number((c.na_fatura as Record<string, unknown>).numero) || 0) : null,
    fora_do_recibo: fora,
    baixas,
  };
}

export interface EntradaDoReciboDaVenda {
  agencia: AgenciaDoRecibo | null;
  venda: Venda;
  contas: readonly ContaDoReciboDaVenda[];
  /** Pagamentos com crédito do cliente já usados (a pendência foi resolvida pela carteira). */
  creditos_usados: ReadonlySet<string>;
  /** Documento (CPF/CNPJ) de cada pagante pelo cadastro, por chave. */
  documentos?: Readonly<Record<string, string>>;
  config: ConfigDoRecibo;
  hoje: string;
}

export interface PaganteDoRecibo {
  chave: string;
  nome: string;
  recebido_centavos: number;
  em_aberto_centavos: number;
  tem_recibo: boolean;
}

export interface LinhaRecebida {
  data: string;
  forma: string;
  referencia: string;
  valor: number;
}

export interface ServicoDoRecibo {
  tipo: string;
  descricao: string;
  periodo: string;
  localizador: string;
  passageiros: string[];
}

/**
 * Identidade da agência no documento (14/11/2026): as cores do cadastro
 * (Configurações › Dados da agência), como no recibo da versão simples
 * (marca-da-agencia.ts). Sem cor cadastrada, o padrão.
 */
export function marcaDoRecibo(agencia: AgenciaDoRecibo | null): MarcaDoDocumento {
  return marcaDoDocumento(agencia as { cores?: { primaria?: string; destaque?: string } } | null);
}

export interface ReciboDaVenda {
  numero: string;
  emitente: Recibo['emitente'];
  /** Cores da agência (o logo já vem em `emitente.logo`). */
  marca: MarcaDoDocumento;
  pagador: { nome: string; documento: string };
  venda: { numero: string; data: string };
  declaracao: string;
  complemento: string;
  /** Recebido pela agência (dinheiro e crédito do cliente). */
  valor: number;
  valor_por_extenso: string;
  recebimentos: LinhaRecebida[];
  /** Pago direto ao fornecedor ou com crédito no fornecedor: quitado, mas não passou pela agência. */
  pagos_ao_fornecedor: LinhaRecebida[];
  total_quitado: number;
  em_aberto: number;
  parcial: boolean;
  servicos: ServicoDoRecibo[];
  /** AAAA-MM-DD: o último recebimento. */
  data: string;
  cidade: string;
  /** Recibo emitido que este substitui (E7: a venda mudou depois de emitido). */
  substitui?: string | null;
}

export type ResultadoDoReciboDaVenda =
  | { ok: true; recibo: ReciboDaVenda; pagantes: PaganteDoRecibo[] }
  | { ok: false; motivo: string; pagantes: PaganteDoRecibo[] };

const DO_CLIENTE = (c: ContaDoReciboDaVenda) => c.origem === 'VENDA' && !c.fora_do_recibo;

function linhasDaConta(c: ContaDoReciboDaVenda): LinhaRecebida[] {
  const parcela = c.total_parcelas > 1 ? `Parcela ${c.parcela_numero}/${c.total_parcelas}` : '';
  if (c.fatura_numero !== null) {
    const v = Number(c.valor_recebido) || 0;
    return v > 0 ? [{ data: String(c.data_recebimento ?? '').slice(0, 10), forma: `Fatura Nº ${c.fatura_numero}`, referencia: 'Paga na fatura', valor: v }] : [];
  }
  if (c.status === 'CANCELADO') return [];
  const valendo = c.baixas.filter(b => b.tipo !== 'estorno' && !b.estornada && b.valor > 0);
  if (valendo.length) {
    return valendo.map(b => ({ data: b.data.slice(0, 10), forma: formaDaBaixa(b.forma), referencia: parcela, valor: b.valor }));
  }
  // Recebida antes do histórico de baixas: o valor recebido gravado na conta.
  const v = Number(c.valor_recebido) || 0;
  if (v > 0 && (c.status === 'RECEBIDO' || c.status === 'PARCIAL')) {
    return [{ data: String(c.data_recebimento ?? '').slice(0, 10), forma: formaDaBaixa(c.forma_recebimento), referencia: parcela, valor: v }];
  }
  return [];
}

function emAbertoDaConta(c: ContaDoReciboDaVenda): number {
  if (c.status === 'CANCELADO' || c.status === 'RECEBIDO') return 0;
  const recebido = linhasDaConta(c).reduce((s, l) => s + emCentavos(l.valor), 0);
  return Math.max(0, emCentavos(c.valor_final) - recebido);
}

interface ContaDoPagante {
  chave: string;
  nome: string;
  documento: string;
  recebidos: LinhaRecebida[];
  fornecedor: LinhaRecebida[];
  em_aberto: number;
}

/** Agrupa por pagante tudo o que conta para o recibo. */
function porPagante(e: EntradaDoReciboDaVenda): ContaDoPagante[] {
  const mapa = new Map<string, ContaDoPagante>();
  const pegar = (id: string, nome: string, documento = '') => {
    const chave = chaveDoPagante(id, nome);
    let p = mapa.get(chave);
    if (!p) {
      p = { chave, nome: nome.trim() || 'Cliente', documento, recebidos: [], fornecedor: [], em_aberto: 0 };
      mapa.set(chave, p);
    }
    if (!p.documento && documento) p.documento = documento;
    return p;
  };
  const cliente = e.venda.cliente;
  // O cliente da venda sempre vem primeiro (ordem estável → número estável).
  pegar(cliente.id, cliente.nome, cliente.documento ?? '');
  const paganteDo = (pg: ParteDaVenda | null): ParteDaVenda => (pg && (pg.id || pg.nome) ? pg : cliente);

  for (const c of e.contas) {
    if (!DO_CLIENTE(c)) continue;
    const pag = e.venda.pagamentos.find(x => x.id === c.venda_pagamento_id);
    const parte = pag ? paganteDo(pag.pagante) : null;
    const p = parte && chaveDoPagante(parte.id, parte.nome) === chaveDoPagante(c.cliente_id, c.cliente_nome)
      ? pegar(parte.id, parte.nome, parte.documento ?? '')
      : pegar(c.cliente_id, c.cliente_nome || cliente.nome);
    p.recebidos.push(...linhasDaConta(c));
    p.em_aberto += emAbertoDaConta(c);
  }
  for (const pg of e.venda.pagamentos) {
    const parte = paganteDo(pg.pagante);
    if (pg.forma === 'CREDITO_CLIENTE' && e.creditos_usados.has(pg.id) && pg.valor_centavos > 0) {
      pegar(parte.id, parte.nome, parte.documento ?? '').recebidos.push({
        data: e.venda.data_venda, forma: 'Crédito do cliente',
        referencia: pg.venda_origem_credito ? `Crédito da venda ${pg.venda_origem_credito}` : 'Crédito que o cliente tinha com a agência',
        valor: reais(pg.valor_centavos),
      });
    }
    if ((pg.forma === 'PAGO_DIRETO_FORNECEDOR' || pg.forma === 'CREDITO_FORNECEDOR') && pg.valor_centavos > 0) {
      pegar(parte.id, parte.nome, parte.documento ?? '').fornecedor.push({
        data: e.venda.data_venda, forma: FORMAS[pg.forma].rotulo,
        referencia: pg.fornecedor?.nome ? pg.fornecedor.nome : '',
        valor: reais(pg.valor_centavos),
      });
    }
  }
  return [...mapa.values()];
}

/** Quem pagou (ou deve) nesta venda, com quanto já entrou: a tela escolhe o pagante. */
export function pagantesDoRecibo(e: EntradaDoReciboDaVenda): PaganteDoRecibo[] {
  return porPagante(e)
    .map(p => {
      const recebido = p.recebidos.reduce((s, l) => s + emCentavos(l.valor), 0) + p.fornecedor.reduce((s, l) => s + emCentavos(l.valor), 0);
      return { chave: p.chave, nome: p.nome, recebido_centavos: recebido, em_aberto_centavos: p.em_aberto, tem_recibo: recebido > 0 };
    })
    .filter(p => p.recebido_centavos > 0 || p.em_aberto_centavos > 0);
}

function servicosDa(venda: Venda): ServicoDoRecibo[] {
  return venda.produtos
    .filter(p => !p.cancelado_em)
    .map(p => ({
      tipo: ROTULO_TIPO_PRODUTO[p.tipo] ?? 'Serviço',
      descricao: p.descricao.trim() || ROTULO_TIPO_PRODUTO[p.tipo] || 'Serviço de turismo',
      periodo: periodoDe(p.data_inicio, p.data_fim),
      localizador: p.localizador,
      passageiros: p.passageiros.filter(x => !x.cancelado_em && x.nome.trim()).map(x => x.nome.trim()),
    }));
}

function periodoDaViagem(venda: Venda): string {
  const ativos = venda.produtos.filter(p => !p.cancelado_em);
  const inicios = ativos.map(p => p.data_inicio).filter(Boolean).sort();
  const fins = ativos.map(p => p.data_fim || p.data_inicio).filter(Boolean).sort();
  return inicios.length ? periodoDe(inicios[0], fins[fins.length - 1] ?? inicios[0]) : '';
}

export function numeroDoReciboDaVenda(venda: Venda, indice: number, quantos: number): string {
  const base = (venda.numero || venda.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)).toUpperCase();
  return quantos > 1 ? `RV-${base}-${indice + 1}` : `RV-${base}`;
}

/**
 * Monta o recibo do pagante pedido (sem pedido: o único pagante, ou o
 * cliente da venda quando houver mais de um).
 */
export function montarReciboDaVenda(e: EntradaDoReciboDaVenda, pagantePedido?: string | null): ResultadoDoReciboDaVenda {
  const pagantes = pagantesDoRecibo(e);
  const grupos = porPagante(e).filter(g => pagantes.some(p => p.chave === g.chave));
  if (!grupos.length) {
    return { ok: false, motivo: 'Esta venda ainda não tem nada a receber de ninguém: confira os pagamentos na ficha.', pagantes };
  }
  const pedido = pagantePedido ? grupos.find(g => g.chave === pagantePedido) : null;
  if (pagantePedido && !pedido) return { ok: false, motivo: 'Esta pessoa não paga nada nesta venda.', pagantes };
  const g = pedido ?? grupos[0];
  const indice = grupos.indexOf(g);
  const recebidoCentavos = g.recebidos.reduce((s, l) => s + emCentavos(l.valor), 0);
  const fornecedorCentavos = g.fornecedor.reduce((s, l) => s + emCentavos(l.valor), 0);
  if (recebidoCentavos + fornecedorCentavos <= 0) {
    return {
      ok: false,
      motivo: `Ainda não entrou nenhum pagamento de ${g.nome} nesta venda. O recibo fica disponível assim que o primeiro pagamento for baixado.`,
      pagantes,
    };
  }
  const ordenar = (l: LinhaRecebida[]) => [...l].sort((a, b) => a.data.localeCompare(b.data));
  const recebimentos = ordenar(g.recebidos);
  const ultima = [...recebimentos, ...g.fornecedor].map(l => l.data).filter(Boolean).sort().pop() || e.hoje;
  const emitente = emitenteDoRecibo(e.agencia);
  const docBruto = e.documentos?.[g.chave] || g.documento || '';
  const documento = docBruto ? formatarDocumento(docBruto) : '';
  const valor = reais(recebidoCentavos);
  const extenso = valorPorExtenso(valor);
  const texto = e.config.texto || TEXTO_DO_RECIBO_PADRAO;
  const declaracao = preencherTexto(texto, {
    agencia: emitente.nome,
    pagante: documento ? `${g.nome} (CPF/CNPJ ${documento})` : g.nome,
    documento,
    valor: brl(recebidoCentavos),
    valor_extenso: extenso,
    venda: e.venda.numero || '',
    data_venda: dataBR(e.venda.data_venda),
    periodo: periodoDaViagem(e.venda),
  });
  return {
    ok: true,
    pagantes,
    recibo: {
      numero: numeroDoReciboDaVenda(e.venda, indice, grupos.length),
      emitente,
      marca: marcaDoRecibo(e.agencia),
      pagador: { nome: g.nome, documento },
      venda: { numero: e.venda.numero, data: e.venda.data_venda },
      declaracao,
      complemento: e.config.complemento,
      valor,
      valor_por_extenso: comMaiuscula(extenso),
      recebimentos,
      pagos_ao_fornecedor: ordenar(g.fornecedor),
      total_quitado: reais(recebidoCentavos + fornecedorCentavos),
      em_aberto: reais(g.em_aberto),
      parcial: g.em_aberto > 0,
      servicos: servicosDa(e.venda),
      data: ultima.slice(0, 10),
      cidade: e.agencia?.endereco?.cidade ?? '',
    },
  };
}

// ============================================================
// Recibo consolidado da fatura
// ============================================================

export interface BaixaDaFatura extends BaixaDoRecibo {
  conta_nome: string;
}

export interface EntradaDoReciboDaFatura {
  agencia: AgenciaDoRecibo | null;
  fatura: {
    id: string;
    numero: number;
    situacao: string;
    pessoa_nome: string;
    total_centavos: number;
    periodo_inicio: string | null;
    periodo_fim: string | null;
    vencimento: string;
  };
  /** Números das vendas da fatura (para o "referente a"). */
  vendas: readonly string[];
  documento: string;
  baixas: readonly BaixaDaFatura[];
  hoje: string;
}

export interface ReciboDaFatura {
  numero: string;
  emitente: Recibo['emitente'];
  /** Cores da agência (o logo já vem em `emitente.logo`). */
  marca: MarcaDoDocumento;
  pagador: { nome: string; documento: string };
  referente: string;
  recebimentos: Array<LinhaRecebida & { conta: string; juros: number; multa: number; desconto: number }>;
  valor: number;
  valor_por_extenso: string;
  total_da_fatura: number;
  em_aberto: number;
  parcial: boolean;
  data: string;
  cidade: string;
}

export type ResultadoDoReciboDaFatura = { ok: true; recibo: ReciboDaFatura } | { ok: false; motivo: string };

export function montarReciboDaFatura(e: EntradaDoReciboDaFatura): ResultadoDoReciboDaFatura {
  const f = e.fatura;
  if (f.situacao === 'CANCELADA') return { ok: false, motivo: 'A fatura foi cancelada: não há recibo.' };
  if (f.situacao === 'ABERTA') return { ok: false, motivo: 'A fatura ainda está aberta. Feche e receba a fatura para tirar o recibo.' };
  const valendo = e.baixas.filter(b => b.tipo !== 'estorno' && !b.estornada && b.valor > 0)
    .sort((a, b) => a.data.localeCompare(b.data));
  if (!valendo.length) return { ok: false, motivo: 'Esta fatura ainda não tem recebimento. O recibo fica disponível depois do primeiro pagamento baixado.' };
  const recebidoCentavos = valendo.reduce((s, b) => s + emCentavos(b.valor), 0);
  const emAberto = Math.max(0, f.total_centavos - recebidoCentavos);
  const periodo = periodoDe(f.periodo_inicio ?? '', f.periodo_fim ?? '');
  const vendas = [...new Set(e.vendas.filter(Boolean))];
  const partes = [
    `Fatura Nº ${f.numero}`,
    periodo ? `período de ${periodo}` : '',
    vendas.length ? `${vendas.length === 1 ? 'venda' : 'vendas'} ${vendas.slice(0, 12).join(', ')}${vendas.length > 12 ? ` e mais ${vendas.length - 12}` : ''}` : '',
  ].filter(Boolean);
  const valor = reais(recebidoCentavos);
  return {
    ok: true,
    recibo: {
      numero: `RF-${String(f.numero).padStart(4, '0')}`,
      emitente: emitenteDoRecibo(e.agencia),
      marca: marcaDoRecibo(e.agencia),
      pagador: { nome: f.pessoa_nome.trim() || 'Cliente', documento: e.documento ? formatarDocumento(e.documento) : '' },
      referente: partes.join(', '),
      recebimentos: valendo.map(b => ({
        data: b.data.slice(0, 10), forma: formaDaBaixa(b.forma), referencia: '', valor: b.valor,
        conta: b.conta_nome, juros: b.juros, multa: b.multa, desconto: b.desconto,
      })),
      valor,
      valor_por_extenso: comMaiuscula(valorPorExtenso(valor)),
      total_da_fatura: reais(f.total_centavos),
      em_aberto: reais(emAberto),
      parcial: emAberto > 0,
      data: valendo[valendo.length - 1].data.slice(0, 10),
      cidade: e.agencia?.endereco?.cidade ?? '',
    },
  };
}
