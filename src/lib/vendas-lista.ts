/**
 * A LISTA DE VENDAS (/vendas), lógica pura (E7, fechamento da paridade).
 *
 * Uma linha por venda, lida no modelo da venda completa (vendas-leitura.ts):
 * cliente, vendedor, unidade (o centro de custo, o mesmo "Unidade" dos
 * relatórios de vendas), os tipos de produto, os fornecedores e
 * representantes, o faturamento e, só para quem pode ver, a receita da
 * agência. Os filtros (fornecedor, tipo de produto, vendedor, unidade,
 * situação e busca) e a exportação moram aqui para a tela e a rota darem o
 * MESMO recorte.
 *
 * Dinheiro em centavos de real.
 */
import { ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO, totaisDaVenda, type Centavos, type TipoProduto } from './venda-modelo';
import { CONFIG_RECEITA_PADRAO, receitaDaVenda, type ConfigReceita } from './venda-receita';
import type { VendaLida } from './vendas-leitura';
import { colunasPermitidas, type ColunaDoRelatorio, type LinhaDoRelatorio } from './relatorios-vendas';

export type SituacaoNaLista = 'ABERTA' | 'FECHADA' | 'CANCELADA';

export const ROTULO_SITUACAO_NA_LISTA: Record<SituacaoNaLista, string> = {
  ABERTA: 'Aberta',
  FECHADA: 'Fechada',
  CANCELADA: 'Cancelada',
};

/** Valor das escolhas "sem vendedor" / "sem unidade" nos filtros. */
export const SEM = '__sem__';

export interface PessoaNaLista { chave: string; nome: string }

export interface LinhaDaLista {
  venda_id: string;
  numero: string;
  data_venda: string;
  cliente: string;
  vendedor_chave: string;
  vendedor: string;
  unidade: string;
  situacao: SituacaoNaLista;
  /** Status do cabeçalho (CONFIRMADO, RESERVADO, CONCLUIDO...). */
  status: string;
  origem: 'crm' | 'manual';
  versao_modelo: 1 | 2;
  /** Fornecedores e representantes dos produtos (sem repetir). */
  fornecedores: PessoaNaLista[];
  tipos: TipoProduto[];
  produtos: string;
  localizadores: string[];
  passageiros: number;
  faturamento: Centavos;
  /** null para quem não pode ver o ganho da agência. */
  receita: Centavos | null;
  percentual_receita: number | null;
  /** Tudo o que a busca procura, sem acento e em minúsculas. */
  texto_busca: string;
}

export interface FiltroDaLista {
  busca?: string;
  /** Chave do fornecedor/representante (`id:…` ou `nome:…`). */
  fornecedor?: string;
  tipo?: string;
  /** Id do vendedor, ou SEM. */
  vendedor?: string;
  /** Nome da unidade, ou SEM. */
  unidade?: string;
  /** '' (todas), ABERTA, FECHADA, CANCELADA ou ATIVAS (abertas e fechadas). */
  situacao?: string;
}

export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Chave estável de uma pessoa do produto: o id, senão o nome. */
export function chaveDaPessoa(p: { id?: string; nome?: string } | null | undefined): string {
  if (!p) return '';
  if (p.id) return `id:${p.id}`;
  const n = semAcento(p.nome ?? '');
  return n ? `nome:${n}` : '';
}

const pct = (receita: number, faturamento: number) => (faturamento ? Math.round((receita / faturamento) * 10000) / 100 : 0);

/** Uma venda lida vira uma linha da lista. */
export function linhaDaVenda(lida: VendaLida, cfg: ConfigReceita = CONFIG_RECEITA_PADRAO, verReceita = true): LinhaDaLista {
  const v = lida.venda;
  const t = totaisDaVenda(v);
  const fornecedores: PessoaNaLista[] = [];
  const vistos = new Set<string>();
  for (const p of v.produtos) {
    for (const pessoa of [p.fornecedor, p.representante]) {
      const chave = chaveDaPessoa(pessoa);
      if (!chave || vistos.has(chave)) continue;
      vistos.add(chave);
      fornecedores.push({ chave, nome: (pessoa?.nome ?? '').trim() || 'Fornecedor sem nome' });
    }
  }
  const tipos = [...new Set(v.produtos.map(p => p.tipo))];
  const localizadores = [...new Set(v.produtos.map(p => p.localizador.trim()).filter(Boolean))];
  const passageiros = v.produtos.flatMap(p => p.passageiros.filter(x => !x.cancelado_em).map(x => x.nome));
  const produtos = v.produtos.map(p => p.descricao.trim() || ROTULO_TIPO_PRODUTO[p.tipo]).join(' + ');
  const situacao: SituacaoNaLista = lida.cancelada ? 'CANCELADA' : lida.situacao === 'FECHADA' ? 'FECHADA' : 'ABERTA';
  const receita = verReceita ? receitaDaVenda(v, cfg).receita : null;
  const cliente = v.cliente.nome.trim() || 'Cliente sem nome';
  const vendedor = (v.vendedor?.nome ?? '').trim();
  return {
    venda_id: v.id,
    numero: v.numero,
    data_venda: v.data_venda,
    cliente,
    vendedor_chave: v.vendedor?.id || '',
    vendedor: vendedor || (v.vendedor?.id ? 'Vendedor sem nome' : 'Sem vendedor'),
    unidade: v.centro_custo.trim(),
    situacao,
    status: lida.status,
    origem: v.origem,
    versao_modelo: lida.versao_modelo,
    fornecedores,
    tipos,
    produtos,
    localizadores,
    passageiros: passageiros.length,
    faturamento: t.valor_cliente,
    receita,
    percentual_receita: receita === null ? null : pct(receita, t.valor_cliente),
    texto_busca: semAcento([v.numero, cliente, vendedor, produtos, ...localizadores, ...passageiros, v.observacoes, v.crm_venda_id].join(' ')),
  };
}

/** O recorte da lista. Cada filtro vazio deixa passar tudo. */
export function filtrarLinhas(linhas: readonly LinhaDaLista[], f: FiltroDaLista): LinhaDaLista[] {
  const termos = semAcento(f.busca ?? '').split(/\s+/).filter(Boolean);
  return linhas.filter(l => {
    if (termos.length && !termos.every(t => l.texto_busca.includes(t))) return false;
    if (f.fornecedor && !l.fornecedores.some(p => p.chave === f.fornecedor)) return false;
    if (f.tipo && !l.tipos.includes(f.tipo as TipoProduto)) return false;
    if (f.vendedor) {
      if (f.vendedor === SEM ? l.vendedor_chave !== '' : l.vendedor_chave !== f.vendedor) return false;
    }
    if (f.unidade) {
      if (f.unidade === SEM ? l.unidade !== '' : l.unidade !== f.unidade) return false;
    }
    if (f.situacao === 'ATIVAS' && l.situacao === 'CANCELADA') return false;
    if ((f.situacao === 'ABERTA' || f.situacao === 'FECHADA' || f.situacao === 'CANCELADA') && l.situacao !== f.situacao) return false;
    return true;
  });
}

export interface Opcao { valor: string; rotulo: string }

/** As escolhas de cada filtro, a partir das vendas do período (as que existem). */
export function opcoesDaLista(linhas: readonly LinhaDaLista[]): { fornecedores: Opcao[]; tipos: Opcao[]; vendedores: Opcao[]; unidades: Opcao[] } {
  const porNome = (a: Opcao, b: Opcao) => a.rotulo.localeCompare(b.rotulo, 'pt-BR');
  const forn = new Map<string, string>();
  const vend = new Map<string, string>();
  const unid = new Set<string>();
  const tipos = new Set<TipoProduto>();
  let semVendedor = false;
  let semUnidade = false;
  for (const l of linhas) {
    for (const p of l.fornecedores) if (!forn.has(p.chave)) forn.set(p.chave, p.nome);
    for (const t of l.tipos) tipos.add(t);
    if (l.vendedor_chave) { if (!vend.has(l.vendedor_chave)) vend.set(l.vendedor_chave, l.vendedor); } else semVendedor = true;
    if (l.unidade) unid.add(l.unidade); else semUnidade = true;
  }
  return {
    fornecedores: [...forn].map(([valor, rotulo]) => ({ valor, rotulo })).sort(porNome),
    tipos: TIPOS_PRODUTO.filter(t => tipos.has(t)).map(t => ({ valor: t, rotulo: ROTULO_TIPO_PRODUTO[t] })),
    vendedores: [...[...vend].map(([valor, rotulo]) => ({ valor, rotulo })).sort(porNome), ...(semVendedor ? [{ valor: SEM, rotulo: 'Sem vendedor' }] : [])],
    unidades: [...[...unid].map(u => ({ valor: u, rotulo: u })).sort(porNome), ...(semUnidade ? [{ valor: SEM, rotulo: 'Sem unidade' }] : [])],
  };
}

export interface ResumoDaLista {
  vendas: number;
  faturamento: Centavos;
  ticket_medio: Centavos;
  /** null quando a pessoa não vê o ganho. */
  receita: Centavos | null;
  percentual_receita: number | null;
}

export function resumoDaLista(linhas: readonly LinhaDaLista[], verReceita: boolean): ResumoDaLista {
  const ativas = linhas.filter(l => l.situacao !== 'CANCELADA');
  const faturamento = ativas.reduce((a, l) => a + l.faturamento, 0);
  const receita = verReceita ? ativas.reduce((a, l) => a + (l.receita ?? 0), 0) : null;
  return {
    vendas: ativas.length,
    faturamento,
    ticket_medio: ativas.length ? Math.round(faturamento / ativas.length) : 0,
    receita,
    percentual_receita: receita === null ? null : pct(receita, faturamento),
  };
}

// ============================================================
// Exportação (CSV e Excel, pelo mesmo caminho dos relatórios de vendas)
// ============================================================

const col = (id: string, rotulo: string, tipo: ColunaDoRelatorio['tipo'], o: Partial<ColunaDoRelatorio> = {}): ColunaDoRelatorio => ({ id, rotulo, tipo, padrao: true, ...o });

export const COLUNAS_DA_LISTA: ColunaDoRelatorio[] = [
  col('numero', 'Venda', 'texto'),
  col('data_venda', 'Data da venda', 'data'),
  col('situacao', 'Situação', 'texto'),
  col('cliente', 'Cliente', 'texto'),
  col('vendedor', 'Vendedor', 'texto'),
  col('unidade', 'Unidade', 'texto'),
  col('tipos', 'Tipos de produto', 'texto'),
  col('produtos', 'Produtos', 'texto'),
  col('fornecedores', 'Fornecedores', 'texto'),
  col('localizadores', 'Localizadores', 'texto'),
  col('passageiros', 'Passageiros', 'numero'),
  col('faturamento', 'Faturamento', 'dinheiro'),
  col('receita', 'Receita da agência', 'dinheiro', { sensivel: true }),
  col('percentual_receita', '% de receita', 'percentual', { sensivel: true }),
];

/** As colunas que saem na exportação para quem pode (ou não) ver o ganho. */
export function colunasDaExportacao(verReceita: boolean): ColunaDoRelatorio[] {
  return colunasPermitidas(COLUNAS_DA_LISTA, verReceita);
}

/** As linhas no formato da exportação dos relatórios (matrizParaExportar). */
export function linhasParaExportar(linhas: readonly LinhaDaLista[], verReceita: boolean): LinhaDoRelatorio[] {
  return linhas.map(l => {
    const r: LinhaDoRelatorio = {
      venda_id: l.venda_id,
      numero: l.numero,
      data_venda: l.data_venda,
      situacao: ROTULO_SITUACAO_NA_LISTA[l.situacao],
      cliente: l.cliente,
      vendedor: l.vendedor,
      unidade: l.unidade || 'Sem unidade',
      tipos: l.tipos.map(t => ROTULO_TIPO_PRODUTO[t]).join(', '),
      produtos: l.produtos,
      fornecedores: l.fornecedores.map(p => p.nome).join(', '),
      localizadores: l.localizadores.join(', '),
      passageiros: l.passageiros,
      faturamento: l.faturamento,
    };
    if (verReceita) {
      r.receita = l.receita ?? 0;
      r.percentual_receita = l.percentual_receita ?? 0;
    }
    return r;
  });
}

/** Para mandar à tela: sem o ganho de quem não pode ver (o número nem sai do servidor). */
export function linhaParaTela(l: LinhaDaLista, verReceita: boolean): LinhaDaLista {
  return verReceita ? l : { ...l, receita: null, percentual_receita: null };
}
