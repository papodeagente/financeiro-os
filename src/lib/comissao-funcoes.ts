/**
 * COMISSÕES POR FUNÇÃO (E5, parte F, 05/11/2026) — a regra nova, calculada no
 * servidor. Arquivo puro: serve o servidor (cálculo do dia, prévia, Fechar,
 * Pagar), o painel do vendedor e os testes.
 *
 * Convive com a regra de hoje (planos com bases, faixas retroativas, regras
 * por produto; comissao-acumulada.ts e comissao-regras.ts, calculada na tela
 * de Comissões). A agência escolhe em Configurações › Comissões; enquanto
 * estiver na regra de hoje, nada daqui roda e nenhum número muda.
 *
 * O MODELO
 *  - Função: Vendedor e Intermediário (do sistema) e as que a agência criar
 *    (gerente, emissor...). Cada função "ganha sobre" vendas: o Vendedor sobre
 *    as próprias, o Intermediário sobre as que trouxe, as outras sobre as
 *    vendas de pessoas da equipe e/ou de unidades (centros de custo).
 *  - Pessoa na função: com plano, data de início, metas por mês e a marca
 *    "sem comissão".
 *  - Plano em matriz: faixa de meta (% atingido) × produto × função. Cada
 *    regra paga % ou valor, sobre os componentes escolhidos (ou a receita da
 *    agência, o valor de venda, a tarifa), com cálculo próprio quando a venda
 *    tem intermediário. "Todos os produtos" e "todas as funções" valem como
 *    padrão; a regra mais específica vence.
 *  - Faixa POR DEGRAU (a faixa atingida vale para o mês inteiro) ou
 *    PROGRESSIVA (cada pedaço do resultado ganha na faixa em que caiu: 3% até
 *    100% da meta e 5% sobre o que passou).
 *  - Liberação: na venda, ou no recebimento do cliente (proporcional ao que
 *    ele pagou até a data).
 *
 * O QUE GARANTE QUE NINGUÉM RECEBE DUAS VEZES NEM DEIXA DE DEVOLVER
 * Cada lançamento guarda quanto JÁ foi fechado. O que se fecha é sempre
 * "liberado hoje − já fechado": se a venda é cancelada ou o recebimento
 * estornado, o liberado cai e a diferença negativa entra no próximo
 * fechamento (estorno automático). Se o mês sobe de faixa depois de fechado,
 * o complemento entra igual.
 *
 * Dinheiro em centavos inteiros de real.
 */
import { COMPONENTES, TIPOS_COMPONENTE, TIPOS_PRODUTO, ROTULO_TIPO_PRODUTO, totaisDoProduto, type Centavos, type TipoComponente, type TipoProduto, type Venda } from './venda-modelo';
import { CONFIG_RECEITA_PADRAO, type ConfigReceita } from './venda-receita';

// ============================================================
// Tipos do cadastro
// ============================================================

export type SistemaDaFuncao = 'VENDEDOR' | 'INTERMEDIARIO';

export interface Funcao {
  id: string;
  nome: string;
  /** Função do sistema (nome fixo, não se apaga). Null = criada pela agência. */
  sistema: SistemaDaFuncao | null;
  /** Ganha sobre as vendas destas pessoas da equipe (ids de usuário). */
  sobre_pessoas: string[];
  /** Ganha sobre as vendas destas unidades (centros de custo). */
  sobre_unidades: string[];
  ativo: boolean;
}

export interface PessoaDaFuncao {
  /** Id da pessoa NA função (a mesma pessoa pode estar em duas funções). */
  id: string;
  funcao_id: string;
  /** Usuário da equipe (Vendedor e outras) ou fornecedor (Intermediário). */
  pessoa_id: string;
  pessoa_nome: string;
  plano_id: string;
  /** A partir de quando ganha (AAAA-MM-DD). Vazio = desde sempre. */
  data_inicio: string;
  /** Está na função, mas não recebe comissão. */
  nao_comissionado: boolean;
}

export interface MetaDoMes {
  pessoa_funcao_id: string;
  /** AAAA-MM */
  mes: string;
  centavos: Centavos;
}

/** O que entra na base: um componente de receita ou um atalho. */
export const ATALHOS_DA_BASE = ['RECEITA', 'VALOR_VENDA', 'TARIFA'] as const;
export type AtalhoDaBase = (typeof ATALHOS_DA_BASE)[number];
export type ItemDaBase = TipoComponente | AtalhoDaBase;

export const ROTULO_ATALHO: Record<AtalhoDaBase, string> = {
  RECEITA: 'Receita da agência',
  VALOR_VENDA: 'Valor de venda',
  TARIFA: 'Tarifa',
};

export function rotuloDoItemDaBase(i: ItemDaBase): string {
  return (ATALHOS_DA_BASE as readonly string[]).includes(i) ? ROTULO_ATALHO[i as AtalhoDaBase] : COMPONENTES[i as TipoComponente].rotulo;
}

export interface Calculo {
  tipo: 'PERCENTUAL' | 'VALOR';
  /** Até 4 casas. */
  percentual: number;
  /** Valor fixo por produto vendido. */
  valor_centavos: Centavos;
  sobre: ItemDaBase[];
}

export const PRODUTO_TODOS = '*';
export const FUNCAO_TODAS = '*';

export interface RegraDoPlano {
  id: string;
  produto: TipoProduto | typeof PRODUTO_TODOS;
  funcao_id: string;
  calculo: Calculo;
  /** Cálculo próprio quando a venda tem intermediário. Null = o mesmo. */
  com_intermediario: Calculo | null;
}

export interface FaixaDoPlano {
  /** A partir de quanto da meta (0, 80, 100, 120...). */
  percentual_meta: number;
  regras: RegraDoPlano[];
}

export type ModoDaFaixa = 'DEGRAU' | 'PROGRESSIVA';

export interface PlanoPorFuncao {
  id: string;
  nome: string;
  modo_faixa: ModoDaFaixa;
  faixas: FaixaDoPlano[];
  ativo: boolean;
  versao: number;
}

export type Liberacao = 'VENDA' | 'RECEBIMENTO';

export interface ConfigComissao {
  /** ATUAL = a regra de hoje (tela de Comissões). FUNCOES = esta. */
  regra: 'ATUAL' | 'FUNCOES';
  liberar: Liberacao;
  /** Sobre o que se mede a meta. */
  meta_sobre: ItemDaBase[];
  /** Vendas antes desta data não entram (vazio = todas). */
  data_inicial: string;
  /** Só vendas fechadas geram comissão. */
  so_vendas_fechadas: boolean;
  /** Categorias da conta a pagar (e da conta a receber, quando a pessoa fica devendo). Vazio = 2.6. */
  categoria_pagamento_id: string;
  categoria_recebimento_id: string;
}

export const CONFIG_COMISSAO_PADRAO: ConfigComissao = {
  regra: 'ATUAL', liberar: 'VENDA', meta_sobre: ['RECEITA'], data_inicial: '',
  so_vendas_fechadas: false, categoria_pagamento_id: '', categoria_recebimento_id: '',
};

// ============================================================
// Normalização (a entrada vem de tela, do banco ou do teste)
// ============================================================

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;
type O = Record<string, unknown>;
const obj = (v: unknown): O => (v && typeof v === 'object' && !Array.isArray(v) ? (v as O) : {});
const txt = (v: unknown, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const inteiro = (v: unknown) => Math.round(num(v));
const lista = (v: unknown) => (Array.isArray(v) ? v.map(x => txt(x)).filter(Boolean) : []);

export function normalizarSobre(v: unknown): ItemDaBase[] {
  const itens = lista(v).map(s => s.toUpperCase());
  const atalho = itens.find(s => (ATALHOS_DA_BASE as readonly string[]).includes(s));
  // Atalho é a base inteira: misturar com componente contaria o mesmo dinheiro duas vezes.
  if (atalho) return [atalho as AtalhoDaBase];
  return [...new Set(itens.filter(s => (TIPOS_COMPONENTE as readonly string[]).includes(s)))] as TipoComponente[];
}

export function normalizarCalculo(v: unknown): Calculo {
  const o = obj(v);
  const tipo = txt(o.tipo).toUpperCase() === 'VALOR' ? 'VALOR' : 'PERCENTUAL';
  const percentual = Math.round(Math.min(Math.max(num(o.percentual), 0), 100) * 10000) / 10000;
  return { tipo, percentual: tipo === 'PERCENTUAL' ? percentual : 0, valor_centavos: tipo === 'VALOR' ? Math.max(inteiro(o.valor_centavos), 0) : 0, sobre: normalizarSobre(o.sobre) };
}

export function normalizarPlano(v: unknown): PlanoPorFuncao {
  const o = obj(v);
  const faixas: FaixaDoPlano[] = [];
  const vistas = new Set<number>();
  for (const f of Array.isArray(o.faixas) ? o.faixas : []) {
    const fo = obj(f);
    const pm = Math.round(Math.max(num(fo.percentual_meta), 0) * 100) / 100;
    if (vistas.has(pm)) continue;
    vistas.add(pm);
    const regras: RegraDoPlano[] = [];
    for (const [i, r] of (Array.isArray(fo.regras) ? fo.regras : []).entries()) {
      const ro = obj(r);
      const produto = txt(ro.produto).toUpperCase();
      regras.push({
        id: txt(ro.id) || `r${pm}-${i + 1}`,
        produto: (TIPOS_PRODUTO as readonly string[]).includes(produto) ? (produto as TipoProduto) : PRODUTO_TODOS,
        funcao_id: txt(ro.funcao_id) || FUNCAO_TODAS,
        calculo: normalizarCalculo(ro.calculo),
        com_intermediario: ro.com_intermediario ? normalizarCalculo(ro.com_intermediario) : null,
      });
    }
    faixas.push({ percentual_meta: pm, regras });
  }
  faixas.sort((a, b) => a.percentual_meta - b.percentual_meta);
  return {
    id: txt(o.id), nome: txt(o.nome, 120) || 'Plano sem nome',
    modo_faixa: txt(o.modo_faixa).toUpperCase() === 'PROGRESSIVA' ? 'PROGRESSIVA' : 'DEGRAU',
    faixas, ativo: o.ativo !== false, versao: Math.max(1, inteiro(o.versao) || 1),
  };
}

/** Erros do plano antes de gravar (frases para a tela). */
export function errosDoPlano(p: PlanoPorFuncao): string[] {
  const erros: string[] = [];
  if (!p.faixas.length) erros.push('O plano precisa de pelo menos uma faixa de meta.');
  for (const f of p.faixas) {
    for (const r of f.regras) {
      for (const c of [r.calculo, r.com_intermediario].filter(Boolean) as Calculo[]) {
        if (c.tipo === 'PERCENTUAL' && !c.sobre.length) erros.push(`Faixa de ${f.percentual_meta}%: escolha sobre o que o percentual é calculado.`);
      }
    }
    const chaves = f.regras.map(r => `${r.produto}|${r.funcao_id}`);
    if (new Set(chaves).size !== chaves.length) erros.push(`Faixa de ${f.percentual_meta}%: há duas regras para o mesmo produto e a mesma função.`);
  }
  return [...new Set(erros)];
}

export function normalizarFuncao(v: unknown): Funcao {
  const o = obj(v);
  const sistema = txt(o.sistema).toUpperCase();
  return {
    id: txt(o.id), nome: txt(o.nome, 80),
    sistema: sistema === 'VENDEDOR' || sistema === 'INTERMEDIARIO' ? sistema : null,
    sobre_pessoas: [...new Set(lista(o.sobre_pessoas))], sobre_unidades: [...new Set(lista(o.sobre_unidades))],
    ativo: o.ativo !== false,
  };
}

export function normalizarPessoaDaFuncao(v: unknown): PessoaDaFuncao {
  const o = obj(v);
  const di = txt(o.data_inicio).slice(0, 10);
  return {
    id: txt(o.id), funcao_id: txt(o.funcao_id), pessoa_id: txt(o.pessoa_id), pessoa_nome: txt(o.pessoa_nome, 120),
    plano_id: txt(o.plano_id), data_inicio: ISO.test(di) ? di : '', nao_comissionado: o.nao_comissionado === true,
  };
}

export function normalizarConfigComissao(v: unknown): ConfigComissao {
  const o = obj(v);
  const di = txt(o.data_inicial).slice(0, 10);
  const meta = normalizarSobre(o.meta_sobre);
  return {
    regra: txt(o.regra).toUpperCase() === 'FUNCOES' ? 'FUNCOES' : 'ATUAL',
    liberar: txt(o.liberar).toUpperCase() === 'RECEBIMENTO' ? 'RECEBIMENTO' : 'VENDA',
    meta_sobre: meta.length ? meta : ['RECEITA'],
    data_inicial: ISO.test(di) ? di : '',
    so_vendas_fechadas: o.so_vendas_fechadas === true,
    categoria_pagamento_id: txt(o.categoria_pagamento_id), categoria_recebimento_id: txt(o.categoria_recebimento_id),
  };
}

/** As duas funções do sistema. */
export function funcoesDoSistema(): Funcao[] {
  return [
    { id: 'fn-vendedor', nome: 'Vendedor', sistema: 'VENDEDOR', sobre_pessoas: [], sobre_unidades: [], ativo: true },
    { id: 'fn-intermediario', nome: 'Intermediário', sistema: 'INTERMEDIARIO', sobre_pessoas: [], sobre_unidades: [], ativo: true },
  ];
}

// ============================================================
// Base de cálculo
// ============================================================

export interface ParteDaBase { item: ItemDaBase; rotulo: string; centavos: Centavos }

/** O que cada item da base vale num produto (em centavos de real, com sinal). */
export function partesDaBase(produto: Venda['produtos'][number], sobre: ItemDaBase[], cfgReceita: ConfigReceita = CONFIG_RECEITA_PADRAO): ParteDaBase[] {
  const t = totaisDoProduto(produto).brl;
  return sobre.map(item => {
    let centavos = 0;
    if (item === 'RECEITA') {
      for (const k of TIPOS_COMPONENTE) if (cfgReceita.componentes[k]) centavos += COMPONENTES[k].sinal * t.componentes[k];
    } else if (item === 'VALOR_VENDA') centavos = t.valor_cliente;
    else if (item === 'TARIFA') centavos = t.tarifa;
    else centavos = COMPONENTES[item].sinal * t.componentes[item];
    return { item, rotulo: rotuloDoItemDaBase(item), centavos };
  });
}

export function baseDoProduto(produto: Venda['produtos'][number], sobre: ItemDaBase[], cfgReceita?: ConfigReceita): Centavos {
  return partesDaBase(produto, sobre, cfgReceita).reduce((a, p) => a + p.centavos, 0);
}

// ============================================================
// Faixas
// ============================================================

export interface PesoDaFaixa { percentual_meta: number; peso: number }

/**
 * Quanto cada faixa pesa no mês.
 *  - DEGRAU: a maior faixa alcançada pesa 1 (vale para o mês inteiro).
 *  - PROGRESSIVA: cada faixa pesa a fração do resultado que caiu dentro dela
 *    (de onde começa até onde a próxima começa). O pedaço abaixo da primeira
 *    faixa não ganha nada.
 * `percentual` null = o plano não depende de meta (uma faixa só, a partir de 0%).
 * Vazio = meta não atingida.
 */
export function pesosDasFaixas(faixas: Array<Pick<FaixaDoPlano, 'percentual_meta'>>, percentual: number | null, modo: ModoDaFaixa): PesoDaFaixa[] {
  const ordenadas = [...faixas].sort((a, b) => a.percentual_meta - b.percentual_meta);
  if (!ordenadas.length) return [];
  if (percentual === null) return ordenadas[0].percentual_meta === 0 ? [{ percentual_meta: 0, peso: 1 }] : [];
  const alcancadas = ordenadas.filter(f => f.percentual_meta <= percentual);
  if (!alcancadas.length) return [];
  if (modo === 'DEGRAU' || percentual <= 0) return [{ percentual_meta: alcancadas[alcancadas.length - 1].percentual_meta, peso: 1 }];
  const pesos: PesoDaFaixa[] = [];
  for (let i = 0; i < ordenadas.length; i++) {
    const de = ordenadas[i].percentual_meta;
    const ate = i + 1 < ordenadas.length ? ordenadas[i + 1].percentual_meta : Infinity;
    const dentro = Math.min(percentual, ate) - de;
    if (dentro > 0) pesos.push({ percentual_meta: de, peso: dentro / percentual });
  }
  return pesos;
}

/** A regra que vale: produto exato ganha de "todos"; função exata ganha de "todas". */
export function regraDaFaixa(faixa: FaixaDoPlano, tipo: TipoProduto, funcaoId: string): RegraDoPlano | null {
  const nota = (r: RegraDoPlano) => (r.produto === tipo ? 2 : r.produto === PRODUTO_TODOS ? 0 : -9) + (r.funcao_id === funcaoId ? 1 : r.funcao_id === FUNCAO_TODAS ? 0 : -9);
  let melhor: RegraDoPlano | null = null;
  let melhorNota = -1;
  for (const r of faixa.regras) {
    const n = nota(r);
    if (n >= 0 && n > melhorNota) { melhor = r; melhorNota = n; }
  }
  return melhor;
}

export function planoTemRegraPara(plano: PlanoPorFuncao, funcaoId: string): boolean {
  return plano.faixas.some(f => f.regras.some(r => r.funcao_id === funcaoId || r.funcao_id === FUNCAO_TODAS));
}

/** O plano depende de meta? (Uma faixa só, a partir de 0%, não depende.) */
export function planoUsaMeta(plano: PlanoPorFuncao): boolean {
  return !(plano.faixas.length === 1 && plano.faixas[0].percentual_meta === 0);
}

// ============================================================
// O cálculo
// ============================================================

export interface VendaParaComissao {
  venda: Venda;
  cancelada: boolean;
  situacao: 'ABERTA' | 'FECHADA';
}

export interface RecebimentoDoCliente {
  total_centavos: Centavos;
  movimentos: Array<{ data: string; centavos: Centavos }>;
}

export interface EntradaDoCalculo {
  vendas: VendaParaComissao[];
  funcoes: Funcao[];
  pessoas: PessoaDaFuncao[];
  planos: PlanoPorFuncao[];
  metas: MetaDoMes[];
  config: ConfigComissao;
  config_receita?: ConfigReceita;
  /** Liberado até esta data (inclusive). */
  ate: string;
  recebimentos?: Record<string, RecebimentoDoCliente>;
  /** Só estes participantes (ids de pessoa na função). Vazio = todos. */
  so_participantes?: string[];
}

export interface Explicacao {
  venda_numero: string;
  produto: string;
  tipo_produto: string;
  motivo: '' | 'VENDA_CANCELADA' | 'PRODUTO_CANCELADO' | 'META_NAO_ATINGIDA' | 'SEM_REGRA' | 'SAIU_DO_CALCULO' | 'SEM_COMISSAO';
  modo_faixa: ModoDaFaixa;
  com_intermediario: boolean;
  meta: { mes: string; meta_centavos: Centavos | null; atingida_centavos: Centavos; percentual: number | null };
  faixas: Array<{ percentual_meta: number; peso: number; tipo: 'PERCENTUAL' | 'VALOR'; percentual: number; valor_centavos: Centavos; base: ParteDaBase[]; base_centavos: Centavos; resultado_centavos: number }>;
  liberacao: { modo: Liberacao; ate: string; recebido_centavos: Centavos; total_centavos: Centavos; fracao: number };
  retido_centavos: Centavos;
}

export interface ItemDeComissao {
  /** venda|produto|pessoa na função. Estável: recalcular atualiza o mesmo. */
  chave: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  /** AAAA-MM da venda (a meta é do mês da venda). */
  mes: string;
  produto_id: string;
  descricao: string;
  cliente_nome: string;
  pessoa_funcao_id: string;
  pessoa_id: string;
  pessoa_nome: string;
  funcao_id: string;
  funcao_nome: string;
  plano_id: string;
  valor_centavos: Centavos;
  retido_centavos: Centavos;
  /** Liberado até `ate`. */
  liberado_centavos: Centavos;
  liberado_retido_centavos: Centavos;
  explicacao: Explicacao;
}

export interface ResumoDoParticipante {
  pessoa_funcao_id: string;
  pessoa_id: string;
  pessoa_nome: string;
  funcao_id: string;
  funcao_nome: string;
  plano_id: string;
  plano_nome: string;
  mes: string;
  meta_centavos: Centavos | null;
  atingida_centavos: Centavos;
  percentual: number | null;
  faixa_atual: number | null;
  proxima_faixa: number | null;
  /** Quanto falta de resultado (na base da meta) para a próxima faixa. */
  falta_para_proxima_centavos: Centavos | null;
  valor_centavos: Centavos;
  retido_centavos: Centavos;
  saldo_centavos: Centavos;
  liberado_centavos: Centavos;
  meta_nao_atingida: boolean;
  /** O que impede fechar este mês desta pessoa (os outros seguem). */
  erros: string[];
  quantidade_vendas: number;
}

export interface ResultadoDoCalculo {
  itens: ItemDeComissao[];
  resumos: ResumoDoParticipante[];
}

const mesDaData = (d: string) => (d && d.length >= 7 ? d.slice(0, 7) : '');
export function rotuloDoMes(mes: string): string {
  return MES.test(mes) ? `${mes.slice(5, 7)}/${mes.slice(0, 4)}` : mes;
}

/** As vendas sobre as quais a pessoa (na função) ganha. */
export function vendasDoParticipante(funcao: Funcao, pessoa: PessoaDaFuncao, vendas: VendaParaComissao[], config: ConfigComissao): VendaParaComissao[] {
  const desde = [pessoa.data_inicio, config.data_inicial].filter(Boolean).sort().pop() ?? '';
  return vendas.filter(v => {
    if (desde && v.venda.data_venda < desde) return false;
    if (config.so_vendas_fechadas && v.situacao !== 'FECHADA' && !v.cancelada) return false;
    if (funcao.sistema === 'VENDEDOR') return v.venda.vendedor?.id === pessoa.pessoa_id;
    if (funcao.sistema === 'INTERMEDIARIO') return v.venda.intermediario?.id === pessoa.pessoa_id;
    const vendedor = v.venda.vendedor?.id ?? '';
    return (vendedor !== '' && funcao.sobre_pessoas.includes(vendedor)) || (v.venda.centro_custo !== '' && funcao.sobre_unidades.includes(v.venda.centro_custo));
  });
}

/** Recebido até a data, entre 0 e o total. */
export function recebidoAte(rec: RecebimentoDoCliente | undefined, ate: string): Centavos {
  if (!rec) return 0;
  const soma = rec.movimentos.filter(m => m.data && m.data <= ate).reduce((a, m) => a + m.centavos, 0);
  return Math.min(Math.max(soma, 0), Math.max(rec.total_centavos, 0));
}

/** Retido pelo intermediário em cada produto: o repasse, até o que ele reteve do cliente. */
function retidoPorProduto(venda: Venda): Map<string, Centavos> {
  const retido = venda.pagamentos.filter(p => p.forma === 'RETIDO_INTERMEDIARIO').reduce((a, p) => a + p.valor_centavos, 0);
  const repasses = venda.produtos.map(p => ({ id: p.id, r: totaisDoProduto(p).brl.repasse }));
  const total = repasses.reduce((a, x) => a + x.r, 0);
  const mapa = new Map<string, Centavos>();
  if (retido <= 0 || total <= 0) return mapa;
  const fator = Math.min(1, retido / total);
  for (const x of repasses) mapa.set(x.id, Math.round(x.r * fator));
  return mapa;
}

export function calcularComissoesPorFuncao(e: EntradaDoCalculo): ResultadoDoCalculo {
  const cfgReceita = e.config_receita ?? CONFIG_RECEITA_PADRAO;
  const funcoes = new Map(e.funcoes.map(f => [f.id, f]));
  const planos = new Map(e.planos.map(p => [p.id, p]));
  const metas = new Map(e.metas.map(m => [`${m.pessoa_funcao_id}|${m.mes}`, m.centavos]));
  const itens: ItemDeComissao[] = [];
  const resumos: ResumoDoParticipante[] = [];
  const so = new Set(e.so_participantes ?? []);

  for (const pessoa of e.pessoas) {
    if (so.size && !so.has(pessoa.id)) continue;
    const funcao = funcoes.get(pessoa.funcao_id);
    if (!funcao || !funcao.ativo) continue;
    const plano = planos.get(pessoa.plano_id);
    const vendas = vendasDoParticipante(funcao, pessoa, e.vendas, e.config);
    // Mês a mês: a meta e a faixa são do mês da venda.
    const porMes = new Map<string, VendaParaComissao[]>();
    for (const v of vendas) {
      const m = mesDaData(v.venda.data_venda);
      if (!m) continue;
      const l = porMes.get(m); if (l) l.push(v); else porMes.set(m, [v]);
    }
    for (const [mes, doMes] of [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const erros: string[] = [];
      const base: ResumoDoParticipante = {
        pessoa_funcao_id: pessoa.id, pessoa_id: pessoa.pessoa_id, pessoa_nome: pessoa.pessoa_nome,
        funcao_id: funcao.id, funcao_nome: funcao.nome, plano_id: pessoa.plano_id, plano_nome: plano?.nome ?? '',
        mes, meta_centavos: null, atingida_centavos: 0, percentual: null, faixa_atual: null, proxima_faixa: null,
        falta_para_proxima_centavos: null, valor_centavos: 0, retido_centavos: 0, saldo_centavos: 0, liberado_centavos: 0,
        meta_nao_atingida: false, erros, quantidade_vendas: doMes.filter(v => !v.cancelada).length,
      };
      if (pessoa.nao_comissionado) { resumos.push(base); continue; }
      if (!funcao.sistema && !funcao.sobre_pessoas.length && !funcao.sobre_unidades.length) erros.push(`Diga sobre as vendas de quem a função ${funcao.nome} ganha.`);
      if (!plano) erros.push('Plano não definido.');
      else if (!plano.ativo) erros.push(`O plano ${plano.nome} está desligado.`);
      else if (!planoTemRegraPara(plano, funcao.id)) erros.push(`O plano ${plano.nome} não tem regra para a função ${funcao.nome}.`);

      // Meta atingida: a base "meta sobre" das vendas válidas do mês.
      const atingida = doMes.filter(v => !v.cancelada).reduce((a, v) => a + v.venda.produtos.reduce((b, p) => b + baseDoProduto(p, e.config.meta_sobre, cfgReceita), 0), 0);
      base.atingida_centavos = atingida;
      let percentual: number | null = null;
      if (plano && planoUsaMeta(plano)) {
        const meta = metas.get(`${pessoa.id}|${mes}`);
        if (meta === undefined || meta <= 0) erros.push(`Meta de ${rotuloDoMes(mes)} não definida.`);
        else {
          base.meta_centavos = meta;
          percentual = Math.round((atingida / meta) * 10000) / 100;
        }
      }
      base.percentual = percentual;
      if (erros.length || !plano) { resumos.push(base); continue; }

      const pesos = pesosDasFaixas(plano.faixas, percentual, plano.modo_faixa);
      const ordenadas = [...plano.faixas].sort((a, b) => a.percentual_meta - b.percentual_meta);
      base.meta_nao_atingida = pesos.length === 0;
      base.faixa_atual = pesos.length ? pesos[pesos.length - 1].percentual_meta : null;
      if (percentual !== null && base.meta_centavos) {
        const proxima = ordenadas.find(f => f.percentual_meta > percentual!);
        base.proxima_faixa = proxima?.percentual_meta ?? null;
        base.falta_para_proxima_centavos = proxima ? Math.max(Math.ceil((proxima.percentual_meta / 100) * base.meta_centavos - atingida), 0) : null;
      }

      for (const v of doMes) {
        const venda = v.venda;
        const retidos = funcao.sistema === 'INTERMEDIARIO' ? retidoPorProduto(venda) : new Map<string, Centavos>();
        const rec = e.recebimentos?.[venda.id];
        const total = rec?.total_centavos ?? 0;
        const usaRecebimento = e.config.liberar === 'RECEBIMENTO' && total > 0;
        const recebido = usaRecebimento ? recebidoAte(rec, e.ate) : 0;
        const fracao = venda.data_venda > e.ate ? 0 : usaRecebimento ? recebido / total : 1;
        const comIntermediario = Boolean(venda.intermediario && (venda.intermediario.id || venda.intermediario.nome));
        for (const produto of venda.produtos) {
          const explic: Explicacao = {
            venda_numero: venda.numero, produto: produto.descricao || ROTULO_TIPO_PRODUTO[produto.tipo], tipo_produto: ROTULO_TIPO_PRODUTO[produto.tipo],
            motivo: '', modo_faixa: plano.modo_faixa, com_intermediario: false,
            meta: { mes, meta_centavos: base.meta_centavos, atingida_centavos: atingida, percentual },
            faixas: [],
            liberacao: { modo: usaRecebimento ? 'RECEBIMENTO' : 'VENDA', ate: e.ate, recebido_centavos: recebido, total_centavos: total, fracao: Math.round(fracao * 10000) / 10000 },
            retido_centavos: 0,
          };
          let bruto = 0;
          if (v.cancelada) explic.motivo = 'VENDA_CANCELADA';
          else if (produto.cancelado_em) explic.motivo = 'PRODUTO_CANCELADO';
          else if (!pesos.length) explic.motivo = 'META_NAO_ATINGIDA';
          else {
            for (const peso of pesos) {
              const faixa = plano.faixas.find(f => f.percentual_meta === peso.percentual_meta)!;
              const regra = regraDaFaixa(faixa, produto.tipo, funcao.id);
              if (!regra) continue;
              const calc = comIntermediario && regra.com_intermediario ? regra.com_intermediario : regra.calculo;
              if (comIntermediario && regra.com_intermediario) explic.com_intermediario = true;
              const partes = calc.tipo === 'PERCENTUAL' ? partesDaBase(produto, calc.sobre, cfgReceita) : [];
              const baseCent = partes.reduce((a, p) => a + p.centavos, 0);
              const resultado = calc.tipo === 'PERCENTUAL' ? Math.max(baseCent, 0) * calc.percentual / 100 : calc.valor_centavos;
              explic.faixas.push({ percentual_meta: peso.percentual_meta, peso: Math.round(peso.peso * 10000) / 10000, tipo: calc.tipo, percentual: calc.percentual, valor_centavos: calc.valor_centavos, base: partes, base_centavos: baseCent, resultado_centavos: Math.round(resultado * 100) / 100 });
              bruto += resultado * peso.peso;
            }
            if (!explic.faixas.length) explic.motivo = 'SEM_REGRA';
          }
          const valor = Math.round(bruto);
          const retido = v.cancelada || produto.cancelado_em ? 0 : retidos.get(produto.id) ?? 0;
          explic.retido_centavos = retido;
          const item: ItemDeComissao = {
            chave: `${venda.id}|${produto.id}|${pessoa.id}`,
            venda_id: venda.id, venda_numero: venda.numero, data_venda: venda.data_venda, mes,
            produto_id: produto.id, descricao: explic.produto, cliente_nome: venda.cliente.nome,
            pessoa_funcao_id: pessoa.id, pessoa_id: pessoa.pessoa_id, pessoa_nome: pessoa.pessoa_nome,
            funcao_id: funcao.id, funcao_nome: funcao.nome, plano_id: plano.id,
            valor_centavos: valor, retido_centavos: retido,
            liberado_centavos: Math.round(valor * fracao), liberado_retido_centavos: Math.round(retido * fracao),
            explicacao: explic,
          };
          // Item zerado sem retido e sem motivo de estorno não precisa de linha.
          if (item.valor_centavos === 0 && item.retido_centavos === 0 && !explic.motivo) continue;
          itens.push(item);
          base.valor_centavos += item.valor_centavos;
          base.retido_centavos += item.retido_centavos;
          base.liberado_centavos += item.liberado_centavos - item.liberado_retido_centavos;
        }
      }
      base.saldo_centavos = base.valor_centavos - base.retido_centavos;
      resumos.push(base);
    }
  }
  return { itens, resumos };
}

// ============================================================
// Fechar: o que entra agora (liberado − já fechado), por pessoa
// ============================================================

export interface LancamentoGravado {
  chave: string;
  pessoa_funcao_id: string;
  pessoa_id: string;
  pessoa_nome: string;
  funcao_nome: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  mes: string;
  descricao: string;
  fechado_centavos: Centavos;
  fechado_retido_centavos: Centavos;
}

export interface ItemAFechar {
  chave: string;
  pessoa_funcao_id: string;
  pessoa_id: string;
  pessoa_nome: string;
  funcao_nome: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  mes: string;
  descricao: string;
  /** Valor que entra neste fechamento (negativo = estorno). */
  valor_centavos: Centavos;
  retido_centavos: Centavos;
  saldo_centavos: Centavos;
  estorno: boolean;
  explicacao: Explicacao | null;
  /** A comissão inteira do item (para a explicação). */
  comissao_centavos: Centavos;
  /** O item como fica depois de fechar. */
  liberado_centavos: Centavos;
  liberado_retido_centavos: Centavos;
}

/**
 * O que cada lançamento acrescenta ao fechamento. O lançamento gravado que o
 * cálculo não produz mais (a venda sumiu, a pessoa saiu da função) conta como
 * zero: o que já foi fechado dele volta como estorno.
 */
export function itensAFechar(calculados: ItemDeComissao[], gravados: LancamentoGravado[]): ItemAFechar[] {
  const porChave = new Map(gravados.map(g => [g.chave, g]));
  const saida: ItemAFechar[] = [];
  const vistos = new Set<string>();
  for (const c of calculados) {
    vistos.add(c.chave);
    const g = porChave.get(c.chave);
    const valor = c.liberado_centavos - (g?.fechado_centavos ?? 0);
    const retido = c.liberado_retido_centavos - (g?.fechado_retido_centavos ?? 0);
    if (valor === 0 && retido === 0) continue;
    saida.push({
      chave: c.chave, pessoa_funcao_id: c.pessoa_funcao_id, pessoa_id: c.pessoa_id, pessoa_nome: c.pessoa_nome, funcao_nome: c.funcao_nome,
      venda_id: c.venda_id, venda_numero: c.venda_numero, data_venda: c.data_venda, mes: c.mes, descricao: c.descricao,
      valor_centavos: valor, retido_centavos: retido, saldo_centavos: valor - retido, estorno: valor - retido < 0,
      explicacao: c.explicacao, comissao_centavos: c.valor_centavos, liberado_centavos: c.liberado_centavos, liberado_retido_centavos: c.liberado_retido_centavos,
    });
  }
  for (const g of gravados) {
    if (vistos.has(g.chave) || (g.fechado_centavos === 0 && g.fechado_retido_centavos === 0)) continue;
    saida.push({
      chave: g.chave, pessoa_funcao_id: g.pessoa_funcao_id, pessoa_id: g.pessoa_id, pessoa_nome: g.pessoa_nome, funcao_nome: g.funcao_nome,
      venda_id: g.venda_id, venda_numero: g.venda_numero, data_venda: g.data_venda, mes: g.mes, descricao: g.descricao,
      valor_centavos: -g.fechado_centavos, retido_centavos: -g.fechado_retido_centavos, saldo_centavos: g.fechado_retido_centavos - g.fechado_centavos,
      estorno: true, explicacao: null, comissao_centavos: 0, liberado_centavos: 0, liberado_retido_centavos: 0,
    });
  }
  return saida.sort((a, b) => a.pessoa_nome.localeCompare(b.pessoa_nome, 'pt-BR') || a.data_venda.localeCompare(b.data_venda) || a.chave.localeCompare(b.chave));
}

export interface LinhaDoFechamento {
  pessoa_funcao_id: string;
  pessoa_id: string;
  pessoa_nome: string;
  funcao_nome: string;
  plano_nome: string;
  meta_centavos: Centavos | null;
  percentual: number | null;
  meta_nao_atingida: boolean;
  valor_centavos: Centavos;
  retido_centavos: Centavos;
  saldo_centavos: Centavos;
  itens: ItemAFechar[];
  /** Vazio = pode fechar. */
  erros: string[];
}

/** Uma linha por pessoa na função: o que entra no fechamento e o que a impede. */
export function linhasDoFechamento(resumos: ResumoDoParticipante[], aFechar: ItemAFechar[]): LinhaDoFechamento[] {
  const linhas = new Map<string, LinhaDoFechamento>();
  const doMesAtual = new Map<string, ResumoDoParticipante>();
  for (const r of resumos) {
    const atual = doMesAtual.get(r.pessoa_funcao_id);
    if (!atual || r.mes > atual.mes) doMesAtual.set(r.pessoa_funcao_id, r);
  }
  const garantir = (id: string, nome: string, pessoaId: string, funcao: string) => {
    let l = linhas.get(id);
    if (!l) {
      const r = doMesAtual.get(id);
      l = {
        pessoa_funcao_id: id, pessoa_id: pessoaId, pessoa_nome: nome, funcao_nome: funcao, plano_nome: r?.plano_nome ?? '',
        meta_centavos: r?.meta_centavos ?? null, percentual: r?.percentual ?? null, meta_nao_atingida: r?.meta_nao_atingida ?? false,
        valor_centavos: 0, retido_centavos: 0, saldo_centavos: 0, itens: [], erros: [],
      };
      linhas.set(id, l);
    }
    return l;
  };
  for (const r of resumos) {
    if (!r.erros.length) continue;
    const l = garantir(r.pessoa_funcao_id, r.pessoa_nome, r.pessoa_id, r.funcao_nome);
    for (const e of r.erros) if (!l.erros.includes(e)) l.erros.push(e);
  }
  for (const i of aFechar) {
    const l = garantir(i.pessoa_funcao_id, i.pessoa_nome, i.pessoa_id, i.funcao_nome);
    l.itens.push(i);
    l.valor_centavos += i.valor_centavos;
    l.retido_centavos += i.retido_centavos;
    l.saldo_centavos += i.saldo_centavos;
  }
  return [...linhas.values()].sort((a, b) => a.pessoa_nome.localeCompare(b.pessoa_nome, 'pt-BR') || a.funcao_nome.localeCompare(b.funcao_nome, 'pt-BR'));
}

/** Assinatura da prévia: fechar só grava se os números ainda são os que a pessoa viu. */
export function assinaturaDaPrevia(ate: string, linhas: Array<Pick<LinhaDoFechamento, 'pessoa_funcao_id' | 'saldo_centavos' | 'itens'>>): string {
  const partes = linhas.map(l => `${l.pessoa_funcao_id}:${l.saldo_centavos}:${l.itens.length}`).sort();
  let h = 2166136261;
  for (const ch of `${ate}#${partes.join(',')}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

// ============================================================
// Pagar: total ou parcial, uma conta por pessoa
// ============================================================

export interface ItemFechadoEmAberto {
  id: string;
  data_venda: string;
  saldo_centavos: Centavos;
  pago_centavos: Centavos;
}

/**
 * Reparte um pagamento entre os itens fechados da pessoa. Total: tudo o que
 * está em aberto (estornos inclusive). Parcial: os estornos primeiro (eles
 * reduzem o que se paga) e depois os itens mais antigos até o valor acabar.
 */
export function repartirPagamento(itens: ItemFechadoEmAberto[], valor: Centavos | null): Array<{ id: string; centavos: Centavos }> {
  const abertos = itens.map(i => ({ id: i.id, data: i.data_venda, aberto: i.saldo_centavos - i.pago_centavos })).filter(i => i.aberto !== 0);
  if (valor === null) return abertos.map(i => ({ id: i.id, centavos: i.aberto }));
  const saida: Array<{ id: string; centavos: Centavos }> = [];
  const negativos = abertos.filter(i => i.aberto < 0);
  let resta = valor - negativos.reduce((a, i) => a + i.aberto, 0);
  for (const n of negativos) saida.push({ id: n.id, centavos: n.aberto });
  for (const p of abertos.filter(i => i.aberto > 0).sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id))) {
    if (resta <= 0) break;
    const c = Math.min(p.aberto, resta);
    saida.push({ id: p.id, centavos: c });
    resta -= c;
  }
  return saida;
}

// ============================================================
// Situação de cada item e a explicação em frases
// ============================================================

export type SituacaoDoItem = 'PREVISTA' | 'LIBERADA' | 'FECHADA' | 'PAGA' | 'ESTORNADA';

export const ROTULO_SITUACAO_ITEM: Record<SituacaoDoItem, string> = {
  PREVISTA: 'Prevista', LIBERADA: 'Liberada', FECHADA: 'Fechada', PAGA: 'Paga', ESTORNADA: 'Estornada',
};

export function situacaoDoItem(i: { valor_centavos: Centavos; liberado_centavos: Centavos; fechado_centavos: Centavos; pago_centavos: Centavos; motivo?: string }): SituacaoDoItem {
  if (i.motivo === 'VENDA_CANCELADA' || i.motivo === 'PRODUTO_CANCELADO' || i.motivo === 'SAIU_DO_CALCULO') return 'ESTORNADA';
  if (i.fechado_centavos > 0 && i.pago_centavos >= i.fechado_centavos && i.fechado_centavos >= i.valor_centavos) return 'PAGA';
  if (i.fechado_centavos > 0 && i.fechado_centavos >= i.liberado_centavos) return 'FECHADA';
  if (i.liberado_centavos > 0) return 'LIBERADA';
  return 'PREVISTA';
}

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (p: number) => `${p.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;

/** "Por que recebi isto?": a conta aberta, uma frase por passo. */
export function frasesDaExplicacao(e: Explicacao, valorCentavos: Centavos): string[] {
  const f: string[] = [];
  if (e.motivo === 'VENDA_CANCELADA') return ['A venda foi cancelada: a comissão dela é zero. O que já tinha sido fechado volta no próximo fechamento.'];
  if (e.motivo === 'PRODUTO_CANCELADO') return ['Este produto foi cancelado: a comissão dele é zero.'];
  if (e.motivo === 'SAIU_DO_CALCULO') return ['Esta venda não entra mais na sua comissão. O que já tinha sido fechado volta no próximo fechamento.'];
  const meta = e.meta;
  if (meta.meta_centavos !== null && meta.percentual !== null) {
    f.push(`Meta de ${rotuloDoMes(meta.mes)}: ${reais(meta.meta_centavos)}. Você chegou a ${reais(meta.atingida_centavos)} (${pct(meta.percentual)}).`);
  }
  if (e.motivo === 'META_NAO_ATINGIDA') { f.push('A meta não alcançou a primeira faixa do plano: este mês não gera comissão.'); return f; }
  if (e.motivo === 'SEM_REGRA') { f.push('O plano não tem regra para este produto nesta função.'); return f; }
  for (const x of e.faixas) {
    const faixa = x.percentual_meta > 0 ? `faixa a partir de ${pct(x.percentual_meta)} da meta` : 'faixa inicial';
    if (x.tipo === 'VALOR') f.push(`${reais(x.valor_centavos)} fixos por produto (${faixa}).`);
    else {
      const base = x.base.filter(p => p.centavos !== 0).map(p => `${p.rotulo} ${reais(p.centavos)}`).join(' + ') || 'base zero';
      f.push(`Base: ${base} = ${reais(x.base_centavos)}. ${pct(x.percentual)} da base (${faixa}) = ${reais(Math.round(x.resultado_centavos))}.`);
    }
    if (e.modo_faixa === 'PROGRESSIVA' && e.faixas.length > 1) f.push(`Esta faixa vale para ${pct(Math.round(x.peso * 10000) / 100)} do seu resultado no mês.`);
  }
  if (e.com_intermediario) f.push('A venda tem intermediário: valeu o cálculo próprio para vendas com intermediário.');
  f.push(`Comissão deste produto: ${reais(valorCentavos)}.`);
  if (e.retido_centavos) f.push(`O intermediário já reteve ${reais(e.retido_centavos)} ao receber do cliente: isso sai do que ele tem a receber.`);
  if (e.liberacao.modo === 'RECEBIMENTO') {
    f.push(e.liberacao.fracao >= 1
      ? `Liberada inteira: o cliente pagou ${reais(e.liberacao.recebido_centavos)} de ${reais(e.liberacao.total_centavos)}.`
      : `Liberado ${pct(Math.round(e.liberacao.fracao * 10000) / 100)}: o cliente pagou ${reais(e.liberacao.recebido_centavos)} de ${reais(e.liberacao.total_centavos)} até ${e.liberacao.ate.split('-').reverse().join('/')}.`);
  }
  return f;
}
