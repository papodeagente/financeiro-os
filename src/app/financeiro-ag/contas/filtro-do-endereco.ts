/**
 * Filtros da lista de Contas a Pagar/Receber vindos do endereço (E7,
 * fechamento): o "Perguntar em texto" manda para cá com o filtro que usou
 * (`?tipo=receber&situacao=em_aberto&data=vencimento&de=…&ate=…&busca=…&em=pessoa`).
 *
 * Puro, para o teste. Regras:
 *  - sem nenhum parâmetro conhecido, os filtros ficam como estão (a tela de sempre);
 *  - só `?cobranca=` (atalho da tela Cobranças): a situação da cobrança em todo
 *    o período, como sempre foi;
 *  - com `de`/`ate`, o período é personalizado; sem eles, todo o período;
 *  - valor que não vale é ignorado (fica o padrão).
 */
import {
  CAMPOS_DA_BUSCA, COBRANCAS_DO_FILTRO, DATAS_DO_FILTRO, SITUACOES_DO_FILTRO,
  type CampoDaBusca, type CobrancaDoFiltro, type DataDoFiltro, type SituacaoDoFiltro,
} from '@/lib/contas-pagar-receber';

export interface FiltrosDoEndereco {
  periodo: string; de: string; ate: string; data: DataDoFiltro; situacao: SituacaoDoFiltro;
  tipo: 'ambos' | 'pagar' | 'receber'; busca: string; em: CampoDaBusca; categoria: string; centro: string; conta: string;
  cobranca: CobrancaDoFiltro;
}

const CHAVES = ['tipo', 'situacao', 'data', 'de', 'ate', 'busca', 'em', 'categoria', 'centro', 'conta', 'cobranca'] as const;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function filtrosDoEndereco<F extends FiltrosDoEndereco>(busca: string, atual: F): F {
  const p = new URLSearchParams(busca);
  const presentes = CHAVES.filter(k => p.has(k));
  if (!presentes.length) return atual;
  // Só o atalho da cobrança, e sem valor que filtre: a tela de sempre (como antes).
  const cobrancaDoAtalho = p.get('cobranca') ?? '';
  if (presentes.length === 1 && presentes[0] === 'cobranca'
    && (cobrancaDoAtalho === 'todas' || !(COBRANCAS_DO_FILTRO as readonly string[]).includes(cobrancaDoAtalho))) return atual;
  const de0 = p.get('de') ?? '';
  const ate0 = p.get('ate') ?? '';
  const de = DATA.test(de0) ? de0 : '';
  const ate = DATA.test(ate0) ? ate0 : '';
  const um = <T extends string>(lista: readonly T[], v: string | null, padrao: T): T => (v && (lista as readonly string[]).includes(v) ? (v as T) : padrao);
  const tipo = p.get('tipo');
  const texto = (k: string) => (p.get(k) ?? '').slice(0, 200);
  return {
    ...atual,
    periodo: de || ate ? 'PERSONALIZADO' : 'TUDO',
    de, ate,
    data: um(DATAS_DO_FILTRO, p.get('data'), atual.data),
    situacao: um(SITUACOES_DO_FILTRO, p.get('situacao'), atual.situacao),
    tipo: tipo === 'pagar' || tipo === 'receber' || tipo === 'ambos' ? tipo : atual.tipo,
    busca: p.has('busca') ? texto('busca') : atual.busca,
    em: um(CAMPOS_DA_BUSCA, p.get('em'), atual.em),
    categoria: p.has('categoria') ? texto('categoria') : atual.categoria,
    centro: p.has('centro') ? texto('centro') : atual.centro,
    conta: p.has('conta') ? texto('conta') : atual.conta,
    cobranca: um(COBRANCAS_DO_FILTRO, p.get('cobranca'), atual.cobranca),
  };
}
