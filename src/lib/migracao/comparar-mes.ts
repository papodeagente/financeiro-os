/**
 * Mês em paralelo (E7, 06/11/2026): a comparação em si. Puro, sem banco
 * (o servidor está em paralelo.ts). Ver lá o que cada tipo quer dizer.
 */
import { nomeComparavel } from '../fornecedor-sync';
import { dataBR, normalizar, reais } from './valores';

export type FonteDoMes = 'contas' | 'extrato';
export type TipoDaComparacao = 'bate' | 'data' | 'valor' | 'so_la' | 'so_aqui';

export const ROTULO_DA_COMPARACAO: Record<TipoDaComparacao, string> = {
  bate: 'Bate', data: 'Data diferente', valor: 'Valor diferente', so_la: 'Só no sistema anterior', so_aqui: 'Só no EnturOS',
};

export interface ItemDoMes {
  /** Onde está: "linha 4 de abril.xlsx" ou o id da conta aqui. */
  ref: string;
  /** Tabela e id aqui (lado EnturOS). */
  tabela?: string;
  id?: string;
  movimento: 'pagar' | 'receber';
  pessoa: string;
  documento: string;
  /** Centavos. */
  valor: number;
  vencimento: string | null;
  liquidacao: string | null;
  conta: string;
  categoria: string;
  descricao: string;
  numero_documento: string;
}

export interface ParDoMes {
  tipo: TipoDaComparacao;
  anterior: ItemDoMes | null;
  enturos: ItemDoMes | null;
  /** anterior − EnturOS, em centavos. */
  diferenca: number;
  detalhe: string;
}

export interface TotalDoGrupo {
  chave: string;
  rotulo: string;
  anterior: number;
  enturos: number;
  diferenca: number;
  contagem: Record<TipoDaComparacao, number>;
}

export interface SecaoDoMes {
  fonte: FonteDoMes;
  rotulo: string;
  pares: ParDoMes[];
  contagem: Record<TipoDaComparacao, number>;
  total: { anterior: number; enturos: number; diferenca: number };
  por_conta: TotalDoGrupo[];
  por_pessoa: TotalDoGrupo[];
  por_categoria: TotalDoGrupo[];
}

export interface RelatorioDoMes {
  lote_id: string;
  mes: string;
  gerado_em: string;
  secoes: SecaoDoMes[];
  /** Linhas dos arquivos que não deu para ler (com o motivo). */
  fora: Array<{ arquivo: string; linha: number; motivo: string }>;
  /** Tudo bateu? */
  tudo_bate: boolean;
}

const contagemVazia = (): Record<TipoDaComparacao, number> => ({ bate: 0, data: 0, valor: 0, so_la: 0, so_aqui: 0 });

function mesmaPessoa(a: ItemDoMes, b: ItemDoMes): boolean {
  if (a.documento && b.documento) return a.documento === b.documento;
  const na = nomeComparavel(a.pessoa);
  const nb = nomeComparavel(b.pessoa);
  // Linha do extrato sem pessoa: vale pela data, conta e valor.
  if (!na || !nb) return true;
  return na === nb;
}

const dataRef = (i: ItemDoMes) => i.liquidacao ?? i.vencimento ?? '';

function proximoMes(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** A janela de busca do lado EnturOS: o mês, o anterior e o seguinte (para achar a data diferente). */
export function janelaDoMes(mes: string): { de: string; ate: string } {
  const fim = proximoMes(mes, 2);
  return { de: `${proximoMes(mes, -1)}-01`, ate: `${fim}-01` };
}

function detalheDaData(a: ItemDoMes, b: ItemDoMes): string {
  const partes: string[] = [];
  if (a.vencimento !== b.vencimento) partes.push(`vencimento ${dataBR(a.vencimento) || '—'} lá × ${dataBR(b.vencimento) || '—'} aqui`);
  if (a.liquidacao !== b.liquidacao) {
    if (a.liquidacao && !b.liquidacao) partes.push(`liquidado lá em ${dataBR(a.liquidacao)}, em aberto aqui`);
    else if (!a.liquidacao && b.liquidacao) partes.push(`em aberto lá, liquidado aqui em ${dataBR(b.liquidacao)}`);
    else partes.push(`liquidação ${dataBR(a.liquidacao)} lá × ${dataBR(b.liquidacao)} aqui`);
  }
  return partes.join('; ');
}

function agrupar(pares: ParDoMes[], chaveDe: (i: ItemDoMes) => { chave: string; rotulo: string }): TotalDoGrupo[] {
  const m = new Map<string, TotalDoGrupo>();
  for (const p of pares) {
    const base = p.anterior ?? p.enturos!;
    const { chave, rotulo } = chaveDe(base);
    let g = m.get(chave);
    if (!g) { g = { chave, rotulo, anterior: 0, enturos: 0, diferenca: 0, contagem: contagemVazia() }; m.set(chave, g); }
    const sinal = base.movimento === 'receber' ? 1 : -1;
    g.anterior += (p.anterior?.valor ?? 0) * sinal;
    g.enturos += (p.enturos?.valor ?? 0) * sinal;
    g.diferenca = g.anterior - g.enturos;
    g.contagem[p.tipo] += 1;
  }
  return [...m.values()].sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/**
 * Compara as linhas de lá com as de cá. `enturos` pode trazer o mês vizinho
 * (para achar a data diferente); o que sobra de cá só conta como "só no
 * EnturOS" se a data dele cair no mês comparado.
 */
export function compararMes(anterior: ItemDoMes[], enturos: ItemDoMes[], mes: string, fonte: FonteDoMes): SecaoDoMes {
  const livres = new Set(enturos.map((_, i) => i));
  const pares: ParDoMes[] = [];
  const pendentes: ItemDoMes[] = [];
  const achar = (a: ItemDoMes, ok: (b: ItemDoMes) => boolean): number => {
    let melhor = -1;
    let dist = Infinity;
    for (const i of livres) {
      const b = enturos[i];
      if (b.movimento !== a.movimento || !mesmaPessoa(a, b) || !ok(b)) continue;
      const d = Math.abs(Date.parse(dataRef(a) || '1970-01-01') - Date.parse(dataRef(b) || '1970-01-01'));
      if (d < dist) { dist = d; melhor = i; }
    }
    return melhor;
  };
  // 1. Bate tudo.
  for (const a of anterior) {
    const i = achar(a, b => b.valor === a.valor && b.vencimento === a.vencimento && (b.liquidacao ?? null) === (a.liquidacao ?? null)
      && (fonte === 'contas' || normalizar(b.conta) === normalizar(a.conta)));
    if (i >= 0) { livres.delete(i); pares.push({ tipo: 'bate', anterior: a, enturos: enturos[i], diferenca: 0, detalhe: '' }); }
    else pendentes.push(a);
  }
  // 2. Mesmo valor, outra data.
  const semPar: ItemDoMes[] = [];
  for (const a of pendentes) {
    const i = achar(a, b => b.valor === a.valor && (fonte === 'contas' || normalizar(b.conta) === normalizar(a.conta)));
    if (i >= 0) { livres.delete(i); pares.push({ tipo: 'data', anterior: a, enturos: enturos[i], diferenca: 0, detalhe: detalheDaData(a, enturos[i]) }); }
    else semPar.push(a);
  }
  // 3. Mesmo vencimento (ou documento), outro valor.
  for (const a of semPar) {
    const i = achar(a, b => (Boolean(a.vencimento) && b.vencimento === a.vencimento) || (Boolean(a.numero_documento) && normalizar(b.numero_documento) === normalizar(a.numero_documento)));
    if (i >= 0) {
      livres.delete(i);
      const b = enturos[i];
      pares.push({ tipo: 'valor', anterior: a, enturos: b, diferenca: a.valor - b.valor, detalhe: `${reais(a.valor)} lá × ${reais(b.valor)} aqui` });
    } else pares.push({ tipo: 'so_la', anterior: a, enturos: null, diferenca: a.valor, detalhe: '' });
  }
  for (const i of livres) {
    const b = enturos[i];
    if (dataRef(b).slice(0, 7) !== mes) continue;
    pares.push({ tipo: 'so_aqui', anterior: null, enturos: b, diferenca: -b.valor, detalhe: '' });
  }
  const ordem: Record<TipoDaComparacao, number> = { valor: 0, data: 1, so_la: 2, so_aqui: 3, bate: 4 };
  pares.sort((x, y) => ordem[x.tipo] - ordem[y.tipo] || dataRef(x.anterior ?? x.enturos!).localeCompare(dataRef(y.anterior ?? y.enturos!)));
  const contagem = contagemVazia();
  for (const p of pares) contagem[p.tipo] += 1;
  const sinal = (i: ItemDoMes | null) => (i ? (i.movimento === 'receber' ? i.valor : -i.valor) : 0);
  const totalAnt = pares.reduce((s, p) => s + sinal(p.anterior), 0);
  const totalAqui = pares.reduce((s, p) => s + sinal(p.enturos), 0);
  return {
    fonte, rotulo: fonte === 'contas' ? 'Contas a pagar e a receber' : 'Extrato das contas',
    pares, contagem, total: { anterior: totalAnt, enturos: totalAqui, diferenca: totalAnt - totalAqui },
    por_conta: agrupar(pares, i => ({ chave: normalizar(i.conta) || '-', rotulo: i.conta || '(sem conta)' })),
    por_pessoa: agrupar(pares, i => ({ chave: i.documento || nomeComparavel(i.pessoa) || '-', rotulo: i.pessoa || '(sem pessoa)' })),
    por_categoria: agrupar(pares, i => ({ chave: normalizar(i.categoria) || '-', rotulo: i.categoria || '(sem categoria)' })),
  };
}

