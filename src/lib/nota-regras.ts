/**
 * NOTAS FISCAIS POR REGRA (E5, parte E, 05/11/2026).
 *
 * A nota de antes nasce de UMA conta a receber recebida (nfse-servico.ts) e
 * continua valendo. Esta é a nota que nasce da VENDA: a regra da nota diz,
 * para cada combinação de tipo de produto, fornecedor, representante e
 * pagante, para quem sai nota e sobre o quê:
 *   - ao pagante (o cliente): por exemplo Taxa DU, RAV, Fee e Markup, menos o
 *     Desconto;
 *   - ao fornecedor: a Comissão e o Over que ele paga à agência;
 *   - ao representante: o que o representante paga (ou o que a agência quiser).
 * Cada destino soma os componentes escolhidos e tira os descontos, a partir
 * da receita aberta por componente da venda (venda-modelo/venda-receita).
 *
 * "Gerar notas" compara, por produto, a Receita da venda com o Valor que já
 * está em nota e mostra o Saldo: saldo positivo depois de uma nota vira nota
 * COMPLEMENTAR sugerida; nota acima da receita (produto ou venda cancelada,
 * receita que caiu) vira CANCELAMENTO sugerido, nunca automático.
 *
 * Arquivo puro (sem banco): o servidor (nota-regras-servidor.ts) carrega a
 * venda, as regras, as notas e as retenções e chama `analisarVenda`.
 * Dinheiro em centavos de real.
 */

import {
  COMPONENTES, FORMAS, ROTULO_TIPO_PRODUTO, TIPOS_COMPONENTE, TIPOS_PRODUTO, parteDoAcerto, totaisDoProduto,
  type Centavos, type ParteDaVenda, type ProdutoDaVenda, type TipoComponente, type TipoProduto, type Venda,
} from './venda-modelo';
import { CONFIG_RECEITA_PADRAO, receitaDaVenda, type ConfigReceita } from './venda-receita';
import {
  TRIBUTOS_RETIDOS, dispensarRetencaoPequena, retencaoAplicavel, retencaoDoProduto,
  type BaseDeRetencao, type RetencaoDoCliente, type RetencaoMinima, type TributoRetido,
} from './nota-retencoes';

// ============================================================
// Destinos, campos e gatilhos
// ============================================================

export const DESTINOS_DA_NOTA = ['PAGANTE', 'FORNECEDOR', 'REPRESENTANTE'] as const;
export type DestinoDaNota = (typeof DESTINOS_DA_NOTA)[number];

export const ROTULO_DESTINO: Record<DestinoDaNota, string> = {
  PAGANTE: 'Ao pagante',
  FORNECEDOR: 'Ao fornecedor',
  REPRESENTANTE: 'Ao representante',
};
export const AJUDA_DESTINO: Record<DestinoDaNota, string> = {
  PAGANTE: 'Quem paga a viagem: o cliente da venda, ou a empresa que paga por ele.',
  FORNECEDOR: 'A operadora, a companhia ou o hotel que paga comissão e over à agência.',
  REPRESENTANTE: 'O consolidador ou representante por onde o produto foi comprado.',
};

/** O que uma regra pode somar ou tirar: os componentes de receita e duas bases. */
export const CAMPOS_DA_REGRA = ['TARIFA', 'TAXAS', ...TIPOS_COMPONENTE] as const;
export type CampoDaRegra = (typeof CAMPOS_DA_REGRA)[number];

export function rotuloDoCampo(c: CampoDaRegra): string {
  if (c === 'TARIFA') return 'Valor do produto (tarifa)';
  if (c === 'TAXAS') return 'Taxas e embarque';
  return COMPONENTES[c].rotulo;
}
export function ajudaDoCampo(c: CampoDaRegra): string {
  if (c === 'TARIFA') return 'O preço do produto em si. Só entra em nota quando a agência vende serviço próprio.';
  if (c === 'TAXAS') return 'Taxas que passam ao fornecedor, como a de embarque.';
  return COMPONENTES[c].ajuda;
}

export const GATILHOS_DA_NOTA = ['MANUAL', 'AO_RECEBER', 'AO_FECHAR_FATURA', 'AO_RECEBER_COMISSAO'] as const;
export type GatilhoDaNota = (typeof GATILHOS_DA_NOTA)[number];

export const ROTULO_GATILHO: Record<GatilhoDaNota, string> = {
  MANUAL: 'Só quando eu gerar',
  AO_RECEBER: 'Quando o cliente terminar de pagar',
  AO_FECHAR_FATURA: 'Quando a fatura do cliente fechar',
  AO_RECEBER_COMISSAO: 'Quando a comissão for recebida',
};

export const STATUS_VIVOS = ['RASCUNHO', 'PROCESSANDO', 'AUTORIZADA'] as const;

// ============================================================
// A regra
// ============================================================

export interface DestinoDaRegra {
  ligado: boolean;
  /** Tomador fixo: substitui a pessoa padrão do destino. */
  tomador_fixo: ParteDaVenda | null;
  receitas: CampoDaRegra[];
  descontos: CampoDaRegra[];
  gatilho: GatilhoDaNota;
  /** Texto da nota. Aceita os marcadores de MARCADORES_DA_NOTA. Vazio: o padrão. */
  discriminacao: string;
}

/**
 * Marcadores do texto da nota (E7: passageiros, período e documento além dos
 * de antes). A tela que edita o texto mostra esta lista.
 */
export const MARCADORES_DA_NOTA: ReadonlyArray<{ marcador: string; rotulo: string; exemplo: string }> = [
  { marcador: '{produtos}', rotulo: 'Produtos da nota', exemplo: 'Hotel Mar 4 noites, Aéreo São Paulo–Lisboa' },
  { marcador: '{venda}', rotulo: 'Número da venda', exemplo: 'VND-0042' },
  { marcador: '{cliente}', rotulo: 'Cliente da venda', exemplo: 'Carla Dias' },
  { marcador: '{passageiros}', rotulo: 'Passageiros dos produtos', exemplo: 'Carla Dias, Pedro Dias' },
  { marcador: '{periodo}', rotulo: 'Período da viagem', exemplo: '20/12/2026 a 24/12/2026' },
  { marcador: '{embarque}', rotulo: 'Data do embarque', exemplo: '20/12/2026' },
  { marcador: '{documento}', rotulo: 'Localizador (ou o número da venda, se não houver)', exemplo: 'HM123, XKT9QZ' },
];

// ============================================================
// Data da nota e tributos aproximados (E7, 06/11/2026)
// ============================================================

/** Qual data vai como data (competência) da nota. */
export const DATAS_DA_NOTA = ['DIA', 'VENDA', 'EMBARQUE'] as const;
export type DataDaNota = (typeof DATAS_DA_NOTA)[number];
export const ROTULO_DATA_DA_NOTA: Record<DataDaNota, string> = {
  DIA: 'O dia da emissão',
  VENDA: 'A data da venda',
  EMBARQUE: 'A data do embarque',
};

const dataBR = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/**
 * A data da nota pela escolha da agência. Sem a data pedida (venda sem
 * embarque) ou com ela no futuro (a prefeitura recusa competência que ainda
 * não chegou), a nota sai com a data de hoje e o aviso diz por quê.
 */
export function dataDaNota(modo: DataDaNota, d: { data_venda: string; data_embarque: string }, hoje: string): { data: string; aviso: string | null } {
  if (modo === 'DIA') return { data: hoje, aviso: null };
  const pedida = modo === 'VENDA' ? d.data_venda : d.data_embarque;
  const nome = modo === 'VENDA' ? 'da venda' : 'do embarque';
  if (!pedida) return { data: hoje, aviso: `A venda não tem a data ${nome}: a nota sai com a data de hoje.` };
  if (pedida > hoje) return { data: hoje, aviso: `A data ${nome} (${dataBR(pedida)}) ainda não chegou e a prefeitura não aceita nota com data futura: a nota sai com a data de hoje.` };
  return { data: pedida, aviso: null };
}

/**
 * Texto dos tributos aproximados (Lei 12.741). Os percentuais são os que a
 * agência digita com o contador; sem nenhum percentual, o texto não entra.
 */
export interface TributosAproximados {
  ligado: boolean;
  federal: number | null;
  estadual: number | null;
  municipal: number | null;
  /** Aceita {total}, {percentual}, {federal}, {estadual} e {municipal}. */
  texto: string;
}

export const TEXTO_TRIBUTOS_PADRAO = 'Valor aproximado dos tributos: {total} ({percentual}).';

export const MARCADORES_DOS_TRIBUTOS: ReadonlyArray<{ marcador: string; rotulo: string }> = [
  { marcador: '{total}', rotulo: 'Valor aproximado de todos os tributos' },
  { marcador: '{percentual}', rotulo: 'Soma dos percentuais' },
  { marcador: '{federal}', rotulo: 'Valor federal' },
  { marcador: '{estadual}', rotulo: 'Valor estadual' },
  { marcador: '{municipal}', rotulo: 'Valor municipal' },
];

function percentualOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 10_000) / 10_000 : null;
}

export function normalizarTributosAproximados(v: unknown): TributosAproximados {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    ligado: o.ligado === true,
    federal: percentualOuNulo(o.federal),
    estadual: percentualOuNulo(o.estadual),
    municipal: percentualOuNulo(o.municipal),
    texto: String(o.texto ?? '').trim().slice(0, 300),
  };
}

/** O texto pronto para a nota de `valor` centavos, ou '' quando não se aplica. */
export function textoDosTributos(valor: Centavos, t: TributosAproximados | null | undefined): string {
  if (!t?.ligado || valor <= 0) return '';
  const partes = [t.federal, t.estadual, t.municipal];
  if (partes.every(p => p === null)) return '';
  const de = (p: number | null) => Math.round(valor * (p ?? 0) / 100);
  const total = partes.reduce<number>((s, p) => s + de(p), 0);
  const soma = partes.reduce<number>((s, p) => s + (p ?? 0), 0);
  const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  return preencherTexto(t.texto || TEXTO_TRIBUTOS_PADRAO, {
    total: formatarReais(total), percentual: pct(soma),
    federal: formatarReais(de(t.federal)), estadual: formatarReais(de(t.estadual)), municipal: formatarReais(de(t.municipal)),
  });
}

/** Troca os marcadores {nome} pelos valores (marcador sem valor some). */
export function preencherTexto(modelo: string, valores: Record<string, string>): string {
  return modelo.replace(/\{(\w+)\}/g, (_t, k: string) => valores[k] ?? '').replace(/\s{2,}/g, ' ').trim();
}

/** Os valores dos marcadores do texto para os produtos de uma nota. */
export function valoresDosMarcadores(venda: Pick<Venda, 'id' | 'numero' | 'cliente'>, produtos: ProdutoDaVenda[]): Record<string, string> {
  const nomes = [...new Set(produtos.map(p => p.descricao).filter(Boolean))];
  const passageiros = [...new Set(produtos.flatMap(p => p.passageiros.filter(x => !x.cancelado_em).map(x => x.nome.trim())).filter(Boolean))];
  const inicios = produtos.map(p => p.data_inicio).filter(Boolean).sort();
  const fins = produtos.map(p => p.data_fim || p.data_inicio).filter(Boolean).sort();
  const inicio = inicios[0] ?? '';
  const fim = fins[fins.length - 1] ?? '';
  const periodo = inicio ? (fim && fim !== inicio ? `${dataBR(inicio)} a ${dataBR(fim)}` : dataBR(inicio)) : '';
  const localizadores = [...new Set(produtos.map(p => p.localizador.trim()).filter(Boolean))];
  return {
    produtos: nomes.length ? nomes.join(', ') : 'produtos da venda',
    venda: venda.numero || venda.id,
    cliente: venda.cliente.nome,
    passageiros: passageiros.join(', '),
    periodo,
    embarque: dataBR(inicio),
    documento: localizadores.length ? localizadores.join(', ') : (venda.numero || venda.id),
  };
}

/** Opções da agência que mudam a nota prevista (vêm de agencia.notas_config). */
export interface OpcoesDaAnalise {
  retencao_minima?: RetencaoMinima | null;
  tributos_aproximados?: TributosAproximados | null;
}

/** Campos da reforma tributária. Sem cálculo: confirmar com o contador. */
export interface ReformaDaRegra {
  cst: string;
  classificacao_tributaria: string;
  indicador_operacao: string;
  aliquota_ibs: number | null;
  aliquota_cbs: number | null;
}

export interface RegraDaNota {
  id: string;
  descricao: string;
  ativa: boolean;
  /** Seletores: vazio (null) vale para todos. */
  tipo_produto: TipoProduto | null;
  fornecedor: ParteDaVenda | null;
  representante: ParteDaVenda | null;
  pagante: ParteDaVenda | null;
  destinos: Record<DestinoDaNota, DestinoDaRegra>;
  ibs_cbs: ReformaDaRegra;
}

export const DISCRIMINACAO_PADRAO: Record<DestinoDaNota, string> = {
  PAGANTE: 'Serviços de agenciamento de viagem: {produtos}. Venda {venda}.',
  FORNECEDOR: 'Comissão de intermediação na venda de {produtos} ao cliente {cliente}. Venda {venda}.',
  REPRESENTANTE: 'Comissão de intermediação na venda de {produtos} ao cliente {cliente}. Venda {venda}.',
};

function destinoDesligado(): DestinoDaRegra {
  return { ligado: false, tomador_fixo: null, receitas: [], descontos: [], gatilho: 'MANUAL', discriminacao: '' };
}

export function reformaVazia(): ReformaDaRegra {
  return { cst: '', classificacao_tributaria: '', indicador_operacao: '', aliquota_ibs: null, aliquota_cbs: null };
}

/**
 * A regra que a tela oferece para começar: vale para todas as vendas, nota ao
 * pagante sobre o que ele paga à agência (Taxa DU, RAV, Fee e Markup, menos o
 * Desconto) quando ele termina de pagar, e nota ao fornecedor sobre Comissão
 * e Over (menos a Taxa CC) quando a comissão é recebida.
 */
export function regraSugerida(): RegraDaNota {
  return {
    id: '', descricao: 'Todas as vendas', ativa: true,
    tipo_produto: null, fornecedor: null, representante: null, pagante: null,
    destinos: {
      PAGANTE: { ligado: true, tomador_fixo: null, receitas: ['TAXA_DU', 'RAV', 'FEE', 'MARKUP'], descontos: ['DESCONTO'], gatilho: 'MANUAL', discriminacao: '' },
      FORNECEDOR: { ligado: true, tomador_fixo: null, receitas: ['COMISSAO', 'OVER'], descontos: ['TAXA_CC'], gatilho: 'MANUAL', discriminacao: '' },
      REPRESENTANTE: destinoDesligado(),
    },
    ibs_cbs: reformaVazia(),
  };
}

export interface ErroDaRegra { campo: string; mensagem: string }

function txt(v: unknown, max = 300): string {
  return v === null || v === undefined ? '' : String(v).trim().slice(0, max);
}

function parte(v: unknown): ParteDaVenda | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = txt(o.id, 200);
  const nome = txt(o.nome, 200);
  const id_externo = txt(o.id_externo, 200);
  if (!id && !id_externo) return null;
  const p: ParteDaVenda = { id, nome };
  if (id_externo) p.id_externo = id_externo;
  if (txt(o.documento, 40)) p.documento = txt(o.documento, 40);
  return p;
}

function campos(v: unknown): CampoDaRegra[] {
  const lista = Array.isArray(v) ? v : [];
  const out: CampoDaRegra[] = [];
  for (const x of lista) {
    const c = txt(x).toUpperCase() as CampoDaRegra;
    if ((CAMPOS_DA_REGRA as readonly string[]).includes(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

function aliquotaOuNulo(v: unknown, campo: string, erros: ErroDaRegra[]): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    erros.push({ campo, mensagem: 'Alíquota da reforma tributária precisa estar entre 0 e 100.' });
    return null;
  }
  return Math.round(n * 10000) / 10000;
}

/** Lê a regra da tela ou do banco; devolve os erros que impedem gravar. */
export function normalizarRegra(v: unknown): { regra: RegraDaNota; erros: ErroDaRegra[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const erros: ErroDaRegra[] = [];
  const tipo = txt(o.tipo_produto).toUpperCase();
  const d = (o.destinos && typeof o.destinos === 'object' ? o.destinos : {}) as Record<string, unknown>;
  const destinos = {} as Record<DestinoDaNota, DestinoDaRegra>;
  for (const k of DESTINOS_DA_NOTA) {
    const x = (d[k] && typeof d[k] === 'object' ? d[k] : {}) as Record<string, unknown>;
    const receitas = campos(x.receitas);
    const descontos = campos(x.descontos).filter(c => !receitas.includes(c));
    if (campos(x.descontos).length !== descontos.length) {
      erros.push({ campo: `destinos.${k}`, mensagem: `${ROTULO_DESTINO[k]}: um mesmo item não pode somar e tirar ao mesmo tempo.` });
    }
    const gat = txt(x.gatilho).toUpperCase() as GatilhoDaNota;
    destinos[k] = {
      ligado: x.ligado === true,
      tomador_fixo: parte(x.tomador_fixo),
      receitas,
      descontos,
      gatilho: (GATILHOS_DA_NOTA as readonly string[]).includes(gat) ? gat : 'MANUAL',
      discriminacao: txt(x.discriminacao, 600),
    };
    if (destinos[k].ligado && receitas.length === 0) {
      erros.push({ campo: `destinos.${k}`, mensagem: `${ROTULO_DESTINO[k]}: escolha ao menos um item que soma na nota.` });
    }
  }
  if (!DESTINOS_DA_NOTA.some(k => destinos[k].ligado)) {
    erros.push({ campo: 'destinos', mensagem: 'Ligue ao menos um destino: ao pagante, ao fornecedor ou ao representante.' });
  }
  const r = (o.ibs_cbs && typeof o.ibs_cbs === 'object' ? o.ibs_cbs : {}) as Record<string, unknown>;
  const regra: RegraDaNota = {
    id: txt(o.id, 80),
    descricao: txt(o.descricao, 120),
    ativa: o.ativa !== false,
    tipo_produto: (TIPOS_PRODUTO as readonly string[]).includes(tipo) ? (tipo as TipoProduto) : null,
    fornecedor: parte(o.fornecedor),
    representante: parte(o.representante),
    pagante: parte(o.pagante),
    destinos,
    ibs_cbs: {
      cst: txt(r.cst, 10),
      classificacao_tributaria: txt(r.classificacao_tributaria, 20),
      indicador_operacao: txt(r.indicador_operacao, 20),
      aliquota_ibs: aliquotaOuNulo(r.aliquota_ibs, 'ibs_cbs.aliquota_ibs', erros),
      aliquota_cbs: aliquotaOuNulo(r.aliquota_cbs, 'ibs_cbs.aliquota_cbs', erros),
    },
  };
  if (!regra.descricao) regra.descricao = descricaoAutomatica(regra);
  return { regra, erros };
}

/** "Hospedagem · Hotel Mar · todos os pagantes" a partir dos seletores. */
export function descricaoAutomatica(r: Pick<RegraDaNota, 'tipo_produto' | 'fornecedor' | 'representante' | 'pagante'>): string {
  const partes = [
    r.tipo_produto ? ROTULO_TIPO_PRODUTO[r.tipo_produto] : '',
    r.fornecedor?.nome ?? '',
    r.representante ? `via ${r.representante.nome}` : '',
    r.pagante ? `pago por ${r.pagante.nome}` : '',
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Todas as vendas';
}

/** A combinação de seletores: duas regras ativas não podem ter a mesma. */
export function combinacaoDaRegra(r: Pick<RegraDaNota, 'tipo_produto' | 'fornecedor' | 'representante' | 'pagante'>): string {
  const id = (p: ParteDaVenda | null) => (p ? p.id || `ext:${p.id_externo ?? ''}` : '*');
  return [r.tipo_produto ?? '*', id(r.fornecedor), id(r.representante), id(r.pagante)].join('|');
}

/** Quanto a regra é específica: o pagante pesa mais, depois representante, fornecedor e tipo. */
export function pontosDaRegra(r: Pick<RegraDaNota, 'tipo_produto' | 'fornecedor' | 'representante' | 'pagante'>): number {
  return (r.pagante ? 8 : 0) + (r.representante ? 4 : 0) + (r.fornecedor ? 2 : 0) + (r.tipo_produto ? 1 : 0);
}

function mesmaPessoa(seletor: ParteDaVenda, p: ParteDaVenda | null | undefined): boolean {
  if (!p) return false;
  if (seletor.id && p.id && seletor.id === p.id) return true;
  if (seletor.id_externo && p.id_externo && seletor.id_externo === p.id_externo) return true;
  return false;
}

/**
 * Quem paga a venda: o pagante dos pagamentos que viram conta a receber,
 * quando todos são da mesma pessoa; senão, o cliente.
 */
export function paganteDaVenda(venda: Pick<Venda, 'cliente' | 'pagamentos'>): ParteDaVenda {
  const pagantes = venda.pagamentos
    .filter(p => FORMAS[p.forma].efeito === 'receber_do_cliente' || FORMAS[p.forma].efeito === 'faturar_ao_cliente')
    .map(p => p.pagante);
  if (pagantes.length && pagantes.every(p => p && (p.id || p.nome))) {
    const primeiro = pagantes[0]!;
    if (pagantes.every(p => (p!.id || p!.nome) === (primeiro.id || primeiro.nome))) return primeiro;
  }
  return venda.cliente;
}

/** A regra mais específica que vale para o produto (ou null). */
export function regraDoProduto(regras: RegraDaNota[], venda: Pick<Venda, 'cliente' | 'pagamentos'>, p: ProdutoDaVenda): RegraDaNota | null {
  const pagante = paganteDaVenda(venda);
  let melhor: RegraDaNota | null = null;
  for (const r of regras) {
    if (!r.ativa) continue;
    if (r.tipo_produto && r.tipo_produto !== p.tipo) continue;
    if (r.fornecedor && !mesmaPessoa(r.fornecedor, p.fornecedor)) continue;
    if (r.representante && !mesmaPessoa(r.representante, p.representante)) continue;
    if (r.pagante && !mesmaPessoa(r.pagante, pagante) && !mesmaPessoa(r.pagante, venda.cliente)) continue;
    if (!melhor || pontosDaRegra(r) > pontosDaRegra(melhor)) melhor = r;
  }
  return melhor;
}

// ============================================================
// Valor de cada destino
// ============================================================

export interface LinhaDaFormula { campo: CampoDaRegra; rotulo: string; sinal: 1 | -1; valor: Centavos }

/** Os números de um produto que uma regra pode usar, em centavos de real. */
export function valoresDoProduto(p: ProdutoDaVenda): Record<CampoDaRegra, Centavos> {
  const t = totaisDoProduto(p).brl;
  const out = { TARIFA: t.tarifa, TAXAS: t.taxas } as Record<CampoDaRegra, Centavos>;
  for (const c of TIPOS_COMPONENTE) out[c] = t.componentes[c];
  return out;
}

/** Quanto o destino da regra vale neste produto: soma as receitas e tira os descontos. */
export function valorDoDestino(p: ProdutoDaVenda, cfg: Pick<DestinoDaRegra, 'receitas' | 'descontos'>): { valor: Centavos; linhas: LinhaDaFormula[] } {
  const v = valoresDoProduto(p);
  const linhas: LinhaDaFormula[] = [
    ...cfg.receitas.map(c => ({ campo: c, rotulo: rotuloDoCampo(c), sinal: 1 as const, valor: v[c] })),
    ...cfg.descontos.map(c => ({ campo: c, rotulo: rotuloDoCampo(c), sinal: -1 as const, valor: v[c] })),
  ].filter(l => l.valor !== 0);
  const soma = linhas.reduce((s, l) => s + l.sinal * l.valor, 0);
  return { valor: Math.max(0, soma), linhas };
}

/** A pessoa que recebe a nota do destino (null: o produto não tem essa pessoa). */
export function tomadorDoDestino(destino: DestinoDaNota, cfg: Pick<DestinoDaRegra, 'tomador_fixo'>, venda: Pick<Venda, 'cliente' | 'pagamentos'>, p: ProdutoDaVenda): ParteDaVenda | null {
  if (cfg.tomador_fixo) return cfg.tomador_fixo;
  if (destino === 'PAGANTE') return paganteDaVenda(venda);
  if (destino === 'FORNECEDOR') return p.fornecedor && (p.fornecedor.id || p.fornecedor.nome) ? p.fornecedor : null;
  return p.representante && (p.representante.id || p.representante.nome) ? p.representante : null;
}

export function chaveDaPessoa(p: ParteDaVenda | null | undefined): string {
  if (!p) return '';
  return p.id || (p.id_externo ? `ext:${p.id_externo}` : `nome:${p.nome.trim().toLowerCase()}`);
}

/**
 * Campo da regra → base da retenção na fonte. A base "valor do produto" só
 * entra quando a nota cobra a própria tarifa (serviço próprio): Markup sozinho
 * não põe o preço inteiro do produto na nota.
 */
const BASE_DO_CAMPO: Partial<Record<CampoDaRegra, BaseDeRetencao>> = {
  TARIFA: 'VALOR', FEE: 'TAXA_SERVICO', TAXA_DU: 'DU_RAV', RAV: 'DU_RAV', TAXAS: 'EMBARQUE',
};

export function basesDaNota(receitas: CampoDaRegra[]): BaseDeRetencao[] {
  const out: BaseDeRetencao[] = [];
  for (const c of receitas) {
    const b = BASE_DO_CAMPO[c];
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

// ============================================================
// Gatilhos
// ============================================================

export interface EstadoDaVenda {
  /** Todas as contas a receber do cliente da venda estão recebidas. */
  cliente_quitado: boolean;
  /** A fatura do cliente com esta venda fechou. */
  fatura_fechada: boolean;
  /** Pessoas (chaveDaPessoa) cuja comissão desta venda já foi recebida ou acertada. */
  comissao_acertada: string[];
}

export function gatilhoCumprido(g: GatilhoDaNota, estado: EstadoDaVenda | null, p: ProdutoDaVenda): boolean {
  if (!estado || g === 'MANUAL') return false;
  if (g === 'AO_RECEBER') return estado.cliente_quitado;
  if (g === 'AO_FECHAR_FATURA') return estado.fatura_fechada;
  const acerto = parteDoAcerto(p).parte;
  return Boolean(acerto) && estado.comissao_acertada.includes(chaveDaPessoa(acerto));
}

// ============================================================
// As notas que já existem
// ============================================================

export interface NotaExistente {
  id: string;
  status: string;
  numero: string;
  emitida_em: string;
  /** Valor da nota em centavos. */
  valor_centavos: Centavos;
  /** Nota da regra: destino, tomador e produtos. Ausentes na nota por conta. */
  origem_regra: boolean;
  destino: DestinoDaNota | null;
  tomador_chave: string;
  chave_geracao: string;
  itens: Array<{ produto_id: string; valor_centavos: Centavos }>;
  /** Nota por conta: de que conta veio (VENDA do cliente ou COMISSAO_FORNECEDOR). */
  conta_origem: string;
}

/** Lê o JSON gravado em notas_fiscais.data para a análise. */
export function notaExistenteDe(data: Record<string, unknown>, contaOrigem = ''): NotaExistente {
  const itens = Array.isArray(data.itens) ? data.itens as Array<Record<string, unknown>> : [];
  const destino = txt(data.destino).toUpperCase();
  const tomador = (data.tomador && typeof data.tomador === 'object' ? data.tomador : {}) as Record<string, unknown>;
  return {
    id: txt(data.id, 80),
    status: txt(data.status),
    numero: txt(data.numero, 40),
    emitida_em: txt(data.emitida_em, 40),
    valor_centavos: Math.round((Number(data.valor_servicos) || 0) * 100),
    origem_regra: txt(data.origem) === 'REGRA',
    destino: (DESTINOS_DA_NOTA as readonly string[]).includes(destino) ? (destino as DestinoDaNota) : null,
    tomador_chave: txt(data.tomador_chave, 200) || txt(tomador.cpf_cnpj, 40),
    chave_geracao: txt(data.chave_geracao, 400),
    itens: itens.map(i => ({ produto_id: txt(i.produto_id, 80), valor_centavos: Math.round(Number(i.valor_centavos) || 0) })),
    conta_origem: contaOrigem,
  };
}

const viva = (n: Pick<NotaExistente, 'status'>) => (STATUS_VIVOS as readonly string[]).includes(n.status);

// ============================================================
// A análise da venda: grade, notas a gerar e cancelamentos sugeridos
// ============================================================

export type SituacaoDaLinha = 'SEM_REGRA' | 'SEM_RECEITA' | 'A_EMITIR' | 'COMPLEMENTAR' | 'EMITIDA' | 'ACIMA' | 'CANCELADA';

export const ROTULO_SITUACAO_DA_LINHA: Record<SituacaoDaLinha, string> = {
  SEM_REGRA: 'Sem regra',
  SEM_RECEITA: 'Sem valor a emitir',
  A_EMITIR: 'A emitir',
  COMPLEMENTAR: 'Complementar sugerida',
  EMITIDA: 'Em nota',
  ACIMA: 'Nota acima da receita',
  CANCELADA: 'Cancelada com nota',
};

export interface CelulaDoDestino {
  destino: DestinoDaNota;
  /** O que a regra diz que vai para nota neste destino. */
  previsto: Centavos;
  /** O que já está em nota viva neste destino. */
  emitido: Centavos;
  saldo: Centavos;
  tomador: ParteDaVenda | null;
  gatilho: GatilhoDaNota;
  linhas: LinhaDaFormula[];
}

export interface LinhaDaGrade {
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  cliente_nome: string;
  produto_id: string;
  produto_descricao: string;
  tipo: TipoProduto;
  rotulo_tipo: string;
  cancelado: boolean;
  /** Receita do produto (componentes que a agência conta como receita). */
  receita: Centavos;
  /** Soma das notas vivas que cobrem o produto. */
  valor_notas: Centavos;
  /** Receita − Valor das notas. */
  saldo: Centavos;
  /** O que as regras mandam emitir agora (soma dos saldos positivos). */
  a_emitir: Centavos;
  regra_id: string;
  regra_descricao: string;
  situacao: SituacaoDaLinha;
  destinos: CelulaDoDestino[];
  /** Para os filtros de Gerar notas (E7). */
  data_embarque: string;
  vendedor_id: string;
  fornecedor_id: string;
  fornecedor_nome: string;
  representante_id: string;
  representante_nome: string;
}

export interface ItemDaNotaPrevista {
  produto_id: string;
  descricao: string;
  valor_centavos: Centavos;
  /** A fórmula com números, para a coluna Informações. */
  formula: string;
}

export interface RetencoesDaNota {
  por_tributo: Record<TributoRetido, Centavos>;
  total: Centavos;
  reter_iss: boolean;
  aliquotas_medias: Record<TributoRetido, number>;
}

export interface NotaPrevista {
  /** venda|destino|tomador|nº: a mesma nota nunca sai duas vezes. */
  chave: string;
  venda_id: string;
  venda_numero: string;
  destino: DestinoDaNota;
  tomador: ParteDaVenda | null;
  tomador_chave: string;
  regra_id: string;
  regra_descricao: string;
  gatilho: GatilhoDaNota;
  /** O gatilho da regra já aconteceu (a emissão automática pode mandar). */
  gatilho_cumprido: boolean;
  itens: ItemDaNotaPrevista[];
  valor_centavos: Centavos;
  complementar: boolean;
  complementar_de: string[];
  ja_emitido_centavos: Centavos;
  informacoes: string;
  discriminacao: string;
  retencoes: RetencoesDaNota | null;
  ibs_cbs: ReformaDaRegra;
  /** O que impede a nota (o servidor acrescenta as do tomador e do emissor). */
  pendencias: string[];
  /** Datas para escolher a data da nota (E7). */
  data_venda: string;
  data_embarque: string;
  /** Retenção pequena que não foi retida, explicada (E7). */
  dispensas: string[];
}

export interface SugestaoDeCancelamento {
  nota_id: string;
  numero: string;
  venda_id: string;
  venda_numero: string;
  destino: DestinoDaNota | null;
  valor_centavos: Centavos;
  emitida_em: string;
  motivo: string;
}

export interface AnaliseDaVenda {
  linhas: LinhaDaGrade[];
  previstas: NotaPrevista[];
  cancelar: SugestaoDeCancelamento[];
}

export interface EntradaDaAnalise {
  venda: Venda;
  regras: RegraDaNota[];
  notas: NotaExistente[];
  retencoes?: RetencaoDoCliente[];
  config_receita?: ConfigReceita;
  /** A venda inteira foi cancelada (status da venda). */
  venda_cancelada?: boolean;
  /** Para avaliar os gatilhos; sem estado, nenhum gatilho está cumprido. */
  estado?: EstadoDaVenda | null;
  /** Dispensa de retenção pequena e tributos aproximados (E7). */
  opcoes?: OpcoesDaAnalise;
}

export function formatarReais(c: Centavos): string {
  const neg = c < 0;
  const v = Math.abs(Math.round(c));
  const inteiro = Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}R$ ${inteiro},${String(v % 100).padStart(2, '0')}`;
}

function formula(linhas: LinhaDaFormula[], total: Centavos): string {
  if (!linhas.length) return 'Nenhum item da regra tem valor neste produto.';
  const partes = linhas.map((l, i) => `${i === 0 ? (l.sinal < 0 ? '− ' : '') : (l.sinal < 0 ? ' − ' : ' + ')}${l.rotulo} ${formatarReais(l.valor)}`);
  return `${partes.join('')} = ${formatarReais(total)}`;
}

interface Celula {
  produto: ProdutoDaVenda;
  destino: DestinoDaNota;
  /** false: produto sem regra (a célula só absorve nota antiga). */
  pela_regra: boolean;
  cfg: DestinoDaRegra | null;
  regra: RegraDaNota | null;
  previsto: Centavos;
  emitido: Centavos;
  tomador: ParteDaVenda | null;
  linhas: LinhaDaFormula[];
  notas: Set<string>;
}

/**
 * A análise de uma venda: a grade por produto, as notas que a regra manda
 * gerar agora (com complementar) e as notas que pedem cancelamento.
 */
export function analisarVenda(e: EntradaDaAnalise): AnaliseDaVenda {
  const { venda, regras } = e;
  const receita = receitaDaVenda(venda, e.config_receita ?? CONFIG_RECEITA_PADRAO);
  const receitaPorProduto = new Map(receita.por_produto.map(r => [r.produto_id, r.receita]));
  const vendaCancelada = e.venda_cancelada === true;

  // 1. As células: produto × destino ligado na regra do produto.
  const celulas: Celula[] = [];
  const regraDe = new Map<string, RegraDaNota | null>();
  for (const p of venda.produtos) {
    const regra = regraDoProduto(regras, venda, p);
    regraDe.set(p.id, regra);
    if (!regra) {
      celulas.push({ produto: p, destino: 'PAGANTE', pela_regra: false, cfg: null, regra: null, previsto: Math.max(0, receitaPorProduto.get(p.id) ?? 0), emitido: 0, tomador: null, linhas: [], notas: new Set() });
      continue;
    }
    for (const d of DESTINOS_DA_NOTA) {
      const cfg = regra.destinos[d];
      if (!cfg.ligado) continue;
      const v = vendaCancelada ? { valor: 0, linhas: [] } : valorDoDestino(p, cfg);
      celulas.push({ produto: p, destino: d, pela_regra: true, cfg, regra, previsto: v.valor, emitido: 0, tomador: tomadorDoDestino(d, cfg, venda, p), linhas: v.linhas, notas: new Set() });
    }
  }

  // 2. As notas vivas entram nas células. A nota da regra diz o produto e o
  //    destino; a nota de antes (por conta) cobre a receita da venda e enche
  //    as células do destino dela primeiro, depois as outras.
  const vivas = e.notas.filter(viva);
  const excesso = new Map<string, Centavos>(); // nota → o que não coube
  for (const n of vivas.filter(x => x.origem_regra)) {
    let sobra = 0;
    for (const it of n.itens) {
      const c = celulas.find(x => x.produto.id === it.produto_id && x.destino === n.destino)
        ?? celulas.find(x => x.produto.id === it.produto_id && !x.pela_regra);
      if (!c) { sobra += it.valor_centavos; continue; }
      c.emitido += it.valor_centavos;
      c.notas.add(n.id);
    }
    if (sobra > 0) excesso.set(n.id, sobra);
  }
  for (const n of vivas.filter(x => !x.origem_regra)) {
    const preferido: DestinoDaNota = n.conta_origem === 'COMISSAO_FORNECEDOR' ? 'FORNECEDOR' : 'PAGANTE';
    const ordem = [...celulas.filter(c => c.destino === preferido), ...celulas.filter(c => c.destino !== preferido)];
    let resta = n.valor_centavos;
    for (const c of ordem) {
      if (resta <= 0) break;
      const cabe = Math.max(0, c.previsto - c.emitido);
      const usa = Math.min(cabe, resta);
      if (usa <= 0) continue;
      c.emitido += usa;
      c.notas.add(n.id);
      resta -= usa;
    }
    if (resta > 0) {
      excesso.set(n.id, resta);
      const primeira = ordem[0];
      if (primeira) { primeira.emitido += resta; primeira.notas.add(n.id); }
    }
  }

  // 3. A grade.
  const linhas: LinhaDaGrade[] = venda.produtos.map(p => {
    const minhas = celulas.filter(c => c.produto.id === p.id);
    const regra = regraDe.get(p.id) ?? null;
    const rec = receitaPorProduto.get(p.id) ?? 0;
    const valor_notas = minhas.reduce((s, c) => s + c.emitido, 0);
    const a_emitir = minhas.filter(c => c.pela_regra && c.tomador).reduce((s, c) => s + Math.max(0, c.previsto - c.emitido), 0);
    const acima = minhas.some(c => c.emitido > c.previsto);
    const cancelado = vendaCancelada || Boolean(p.cancelado_em);
    let situacao: SituacaoDaLinha;
    if (cancelado && valor_notas > 0) situacao = 'CANCELADA';
    else if (acima) situacao = 'ACIMA';
    else if (!regra) situacao = valor_notas > 0 ? 'EMITIDA' : rec > 0 ? 'SEM_REGRA' : 'SEM_RECEITA';
    else if (a_emitir > 0) situacao = valor_notas > 0 ? 'COMPLEMENTAR' : 'A_EMITIR';
    else situacao = valor_notas > 0 ? 'EMITIDA' : 'SEM_RECEITA';
    return {
      venda_id: venda.id, venda_numero: venda.numero, data_venda: venda.data_venda, cliente_nome: venda.cliente.nome,
      produto_id: p.id, produto_descricao: p.descricao, tipo: p.tipo, rotulo_tipo: ROTULO_TIPO_PRODUTO[p.tipo],
      cancelado, receita: rec, valor_notas, saldo: rec - valor_notas, a_emitir,
      regra_id: regra?.id ?? '', regra_descricao: regra?.descricao ?? '', situacao,
      destinos: minhas.filter(c => c.pela_regra).map(c => ({
        destino: c.destino, previsto: c.previsto, emitido: c.emitido, saldo: c.previsto - c.emitido,
        tomador: c.tomador, gatilho: c.cfg?.gatilho ?? 'MANUAL', linhas: c.linhas,
      })),
      data_embarque: p.data_inicio || '',
      vendedor_id: venda.vendedor?.id ?? '',
      fornecedor_id: p.fornecedor?.id || p.fornecedor?.id_externo || '',
      fornecedor_nome: p.fornecedor?.nome ?? '',
      representante_id: p.representante?.id || p.representante?.id_externo || '',
      representante_nome: p.representante?.nome ?? '',
    };
  });

  // 4. As notas a gerar: o saldo positivo de cada célula da regra, juntado
  //    por destino, tomador e gatilho (uma nota por pessoa, com os produtos).
  const grupos = new Map<string, Celula[]>();
  for (const c of celulas) {
    if (!c.pela_regra || !c.cfg || vendaCancelada) continue;
    if (c.previsto - c.emitido <= 0) continue;
    const k = `${c.destino}|${chaveDaPessoa(c.tomador) || `sem:${c.produto.id}`}|${c.cfg.gatilho}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(c);
  }
  const proximoNumero = new Map<string, number>();
  for (const n of e.notas) {
    if (!n.chave_geracao) continue;
    const i = n.chave_geracao.lastIndexOf('|');
    const prefixo = n.chave_geracao.slice(0, i);
    const num = Number(n.chave_geracao.slice(i + 1)) || 0;
    proximoNumero.set(prefixo, Math.max(proximoNumero.get(prefixo) ?? 0, num));
  }
  const previstas: NotaPrevista[] = [];
  for (const lista of grupos.values()) {
    const c0 = lista[0];
    const destino = c0.destino;
    const tomador = c0.tomador;
    const tomadorChave = chaveDaPessoa(tomador);
    const prefixo = `${venda.id}|${destino}|${tomadorChave || `sem:${c0.produto.id}`}`;
    const n = (proximoNumero.get(prefixo) ?? 0) + 1;
    proximoNumero.set(prefixo, n);
    const anteriores = vivas.filter(x => lista.some(c => c.notas.has(x.id)) && (x.origem_regra ? x.destino === destino : true));
    const itens: ItemDaNotaPrevista[] = lista.map(c => {
      const valor = c.previsto - c.emitido;
      const base = formula(c.linhas, c.previsto);
      return {
        produto_id: c.produto.id, descricao: c.produto.descricao, valor_centavos: valor,
        formula: c.emitido > 0 ? `${base}; já em nota ${formatarReais(c.emitido)}; nesta nota ${formatarReais(valor)}` : base,
      };
    });
    const valor = itens.reduce((s, i) => s + i.valor_centavos, 0);
    const jaEmitido = lista.reduce((s, c) => s + c.emitido, 0);
    const regra = c0.regra!;
    const pendencias: string[] = [];
    if (!tomador) {
      pendencias.push(destino === 'FORNECEDOR'
        ? `O produto "${c0.produto.descricao || 'sem nome'}" não tem fornecedor: não há para quem emitir.`
        : destino === 'REPRESENTANTE'
          ? `O produto "${c0.produto.descricao || 'sem nome'}" não tem representante: não há para quem emitir.`
          : 'A venda não tem cliente: não há para quem emitir.');
    }
    // Retenção na fonte: só na nota ao pagante, e só sobre as bases que ela cobra.
    let retencoes: RetencoesDaNota | null = null;
    const dispensas: string[] = [];
    if (destino === 'PAGANTE' && e.retencoes?.length && tomador) {
      const por_tributo: Record<TributoRetido, Centavos> = { IR: 0, CSLL: 0, PIS: 0, COFINS: 0 };
      let reter_iss = false;
      for (const c of lista) {
        const r = retencaoAplicavel(e.retencoes, tomador.id, c.produto.tipo) ?? retencaoAplicavel(e.retencoes, venda.cliente.id, c.produto.tipo);
        if (!r) continue;
        if (r.reter_iss) reter_iss = true;
        const rp = retencaoDoProduto(c.produto, r, basesDaNota(c.cfg!.receitas));
        const fator = c.previsto > 0 ? (c.previsto - c.emitido) / c.previsto : 0;
        for (const t of TRIBUTOS_RETIDOS) por_tributo[t] += Math.round(rp.por_tributo[t] * fator);
      }
      // Dispensa de retenção pequena (E7): só com o limite digitado pela agência.
      const dispensa = dispensarRetencaoPequena(por_tributo, e.opcoes?.retencao_minima);
      for (const t of TRIBUTOS_RETIDOS) por_tributo[t] = dispensa.por_tributo[t];
      dispensas.push(...dispensa.dispensas);
      let total = TRIBUTOS_RETIDOS.reduce((s, t) => s + por_tributo[t], 0);
      if (total > valor) {
        // A retenção não pode passar do valor da nota.
        const f = valor / total;
        for (const t of TRIBUTOS_RETIDOS) por_tributo[t] = Math.floor(por_tributo[t] * f);
        total = TRIBUTOS_RETIDOS.reduce((s, t) => s + por_tributo[t], 0);
      }
      if (total > 0 || reter_iss) {
        const medias = { IR: 0, CSLL: 0, PIS: 0, COFINS: 0 } as Record<TributoRetido, number>;
        for (const t of TRIBUTOS_RETIDOS) medias[t] = valor > 0 ? Math.round((por_tributo[t] / valor) * 1_000_000) / 10_000 : 0;
        retencoes = { por_tributo, total, reter_iss, aliquotas_medias: medias };
      }
    }
    const produtosDaNota = lista.map(c => c.produto);
    const modelo = c0.cfg!.discriminacao || DISCRIMINACAO_PADRAO[destino];
    let discriminacao = preencherTexto(modelo, valoresDosMarcadores(venda, produtosDaNota));
    if (anteriores.length) discriminacao = `Nota complementar. ${discriminacao}`;
    const tributos = textoDosTributos(valor, e.opcoes?.tributos_aproximados);
    if (tributos) discriminacao = `${discriminacao} ${tributos}`;
    const embarques = produtosDaNota.map(p => p.data_inicio).filter(Boolean).sort();
    const gatilho = c0.cfg!.gatilho;
    previstas.push({
      chave: `${prefixo}|${n}`,
      venda_id: venda.id, venda_numero: venda.numero, destino, tomador, tomador_chave: tomadorChave,
      regra_id: regra.id, regra_descricao: regra.descricao,
      gatilho, gatilho_cumprido: lista.every(c => gatilhoCumprido(gatilho, e.estado ?? null, c.produto)),
      itens, valor_centavos: valor,
      complementar: anteriores.length > 0, complementar_de: anteriores.map(x => x.id), ja_emitido_centavos: jaEmitido,
      informacoes: `${regra.descricao} · ${ROTULO_DESTINO[destino].toLowerCase()}: ${itens.map(i => `${i.descricao || 'produto'}: ${i.formula}`).join(' | ')}`,
      discriminacao: discriminacao.slice(0, 1000),
      retencoes,
      ibs_cbs: regra.ibs_cbs,
      pendencias,
      data_venda: venda.data_venda || '',
      data_embarque: embarques[0] ?? '',
      dispensas,
    });
  }

  // 5. Cancelamentos sugeridos: venda cancelada leva todas as notas; senão,
  //    a nota acima da receita (mais nova primeiro) até cobrir o excesso.
  const cancelar: SugestaoDeCancelamento[] = [];
  const sugerida = new Set<string>();
  const sugerir = (n: NotaExistente, motivo: string) => {
    if (sugerida.has(n.id)) return;
    sugerida.add(n.id);
    cancelar.push({ nota_id: n.id, numero: n.numero, venda_id: venda.id, venda_numero: venda.numero, destino: n.destino, valor_centavos: n.valor_centavos, emitida_em: n.emitida_em, motivo });
  };
  const maisNovaPrimeiro = (a: NotaExistente, b: NotaExistente) => (b.emitida_em || '').localeCompare(a.emitida_em || '');
  if (vendaCancelada) {
    for (const n of vivas.slice().sort(maisNovaPrimeiro)) sugerir(n, 'A venda foi cancelada e esta nota continua valendo.');
  } else {
    for (const c of celulas) {
      let excessoCelula = c.emitido - c.previsto;
      if (excessoCelula <= 0) continue;
      const canceladoProduto = Boolean(c.produto.cancelado_em);
      for (const n of vivas.filter(x => c.notas.has(x.id)).sort(maisNovaPrimeiro)) {
        if (excessoCelula <= 0) break;
        sugerir(n, canceladoProduto
          ? `O produto "${c.produto.descricao || 'sem nome'}" foi cancelado e esta nota continua valendo.`
          : `A receita de "${c.produto.descricao || 'produto'}" (${ROTULO_DESTINO[c.destino].toLowerCase()}) é ${formatarReais(c.previsto)} e as notas somam ${formatarReais(c.emitido)}. Cancele e emita de novo pelo valor certo.`);
        excessoCelula -= n.valor_centavos;
      }
    }
    for (const [id] of excesso) {
      const n = vivas.find(x => x.id === id);
      if (n) sugerir(n, 'Esta nota passa da receita da venda.');
    }
  }

  return { linhas, previstas, cancelar };
}

/** Assinatura do que a pessoa viu na prévia: a emissão só vale se nada mudou. */
export function assinaturaDaPrevia(previstas: Array<Pick<NotaPrevista, 'chave' | 'valor_centavos'> & { retencoes?: { total: number } | null }>): string {
  const texto = previstas
    .map(p => `${p.chave}=${p.valor_centavos}:${p.retencoes?.total ?? 0}`)
    .sort()
    .join(';');
  // FNV-1a 32 bits, em hexadecimal: curto, estável e sem dependência.
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${previstas.length}-${h.toString(16).padStart(8, '0')}`;
}
