/**
 * Tabela dinâmica genérica (05/11/2026) — conta pura, roda no navegador.
 *
 * Recebe registros com campos de texto e um valor em CENTAVOS inteiros, e
 * cruza: campos de linha em hierarquia (Tipo › Grupo › Categoria), campos de
 * coluna em hierarquia (Ano › Mês). Cada nó de linha que não é folha é o
 * subtotal dos filhos; há total por linha, por coluna e geral. Somar em
 * centavos garante que subtotal + subtotal = total, sem centavo perdido.
 *
 * Ordem estável: cada campo pode ter um comparador; sem ele, ordem alfabética
 * em pt-BR com números naturais ("2" antes de "10").
 */

export interface RegistroDinamico<R = unknown> {
  campos: Record<string, string>;
  /** Centavos inteiros (paraCentavos). Sinal livre: despesa pode ser negativa. */
  centavos: number;
  /** O que o clique na célula mostra (o lançamento de origem). */
  ref?: R;
}

export interface OpcoesDinamica {
  /** Comparador por campo; o padrão é pt-BR com números naturais. */
  ordem?: Record<string, (a: string, b: string) => number>;
}

export interface LinhaDinamica {
  /** Caminho dos valores até aqui, unido por SEPARADOR. Único na tabela. */
  chave: string;
  caminho: string[];
  /** 0 = primeiro campo de linha. */
  nivel: number;
  campo: string;
  valor: string;
  folha: boolean;
  /** Centavos por coluna-folha (chave da coluna). Ausente = nada. */
  celulas: Record<string, number>;
  total: number;
  quantidade: number;
}

export interface ColunaDinamica {
  chave: string;
  caminho: string[];
}

/** Um nível do cabeçalho de colunas: grupos com quantas folhas cobrem. */
export interface GrupoDeCabecalho {
  valor: string;
  campo: string;
  /** Quantas colunas-folha este grupo cobre. */
  span: number;
  caminho: string[];
}

export interface TabelaDinamica {
  camposLinha: string[];
  camposColuna: string[];
  linhas: LinhaDinamica[];
  colunas: ColunaDinamica[];
  cabecalho: GrupoDeCabecalho[][];
  totaisPorColuna: Record<string, number>;
  totalGeral: number;
  quantidade: number;
}

export const SEPARADOR = '\u001f';
/** Chave da coluna única quando não há campo de coluna. */
export const COLUNA_TOTAL = '__total__';

const COLADOR = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function comparador(campo: string, o?: OpcoesDinamica) {
  return o?.ordem?.[campo] ?? ((a: string, b: string) => COLADOR.compare(a, b));
}

function chaveDe(caminho: readonly string[]): string {
  return caminho.join(SEPARADOR);
}

function valorDe<R>(r: RegistroDinamico<R>, campo: string): string {
  return String(r.campos[campo] ?? '');
}

function chaveDaColuna<R>(r: RegistroDinamico<R>, camposColuna: readonly string[]): string {
  return camposColuna.length === 0 ? COLUNA_TOTAL : chaveDe(camposColuna.map(c => valorDe(r, c)));
}

export function montarTabelaDinamica<R>(
  registros: readonly RegistroDinamico<R>[],
  camposLinha: readonly string[],
  camposColuna: readonly string[],
  opcoes?: OpcoesDinamica,
): TabelaDinamica {
  // Colunas-folha: as combinações que existem, em ordem campo a campo.
  const combos = new Map<string, string[]>();
  for (const r of registros) {
    const caminho = camposColuna.map(c => valorDe(r, c));
    combos.set(chaveDaColuna(r, camposColuna), caminho);
  }
  const colunas: ColunaDinamica[] = [...combos.entries()]
    .map(([chave, caminho]) => ({ chave, caminho }))
    .sort((a, b) => {
      for (let i = 0; i < camposColuna.length; i++) {
        const c = comparador(camposColuna[i], opcoes)(a.caminho[i], b.caminho[i]);
        if (c !== 0) return c;
      }
      return 0;
    });
  if (colunas.length === 0) colunas.push({ chave: COLUNA_TOTAL, caminho: [] });

  // Cabeçalho: em cada nível, folhas vizinhas com o mesmo prefixo viram um grupo.
  const cabecalho: GrupoDeCabecalho[][] = camposColuna.map((campo, nivel) => {
    const grupos: GrupoDeCabecalho[] = [];
    for (const col of colunas) {
      const prefixo = col.caminho.slice(0, nivel + 1);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && chaveDe(ultimo.caminho) === chaveDe(prefixo)) ultimo.span += 1;
      else grupos.push({ valor: col.caminho[nivel], campo, span: 1, caminho: prefixo });
    }
    return grupos;
  });

  // Linhas: árvore, pai antes dos filhos.
  const linhas: LinhaDinamica[] = [];
  function descer(regs: readonly RegistroDinamico<R>[], nivel: number, caminho: string[]) {
    if (nivel >= camposLinha.length) return;
    const campo = camposLinha[nivel];
    const grupos = new Map<string, RegistroDinamico<R>[]>();
    for (const r of regs) {
      const v = valorDe(r, campo);
      const lista = grupos.get(v);
      if (lista) lista.push(r); else grupos.set(v, [r]);
    }
    const valores = [...grupos.keys()].sort(comparador(campo, opcoes));
    for (const v of valores) {
      const doGrupo = grupos.get(v)!;
      const meuCaminho = [...caminho, v];
      const celulas: Record<string, number> = {};
      let tot = 0;
      for (const r of doGrupo) {
        const k = chaveDaColuna(r, camposColuna);
        celulas[k] = (celulas[k] ?? 0) + Math.round(r.centavos);
        tot += Math.round(r.centavos);
      }
      linhas.push({
        chave: chaveDe(meuCaminho), caminho: meuCaminho, nivel, campo, valor: v,
        folha: nivel === camposLinha.length - 1, celulas, total: tot, quantidade: doGrupo.length,
      });
      descer(doGrupo, nivel + 1, meuCaminho);
    }
  }
  descer(registros, 0, []);

  const totaisPorColuna: Record<string, number> = {};
  let totalGeral = 0;
  for (const r of registros) {
    const k = chaveDaColuna(r, camposColuna);
    totaisPorColuna[k] = (totaisPorColuna[k] ?? 0) + Math.round(r.centavos);
    totalGeral += Math.round(r.centavos);
  }

  return {
    camposLinha: [...camposLinha], camposColuna: [...camposColuna],
    linhas, colunas, cabecalho, totaisPorColuna, totalGeral, quantidade: registros.length,
  };
}

/**
 * Os registros por trás de uma célula: a linha (por prefixo do caminho) e a
 * coluna (folha, ou COLUNA_TOTAL/null para todas). Linha null = todas.
 */
export function registrosDaCelula<R>(
  registros: readonly RegistroDinamico<R>[],
  tabela: Pick<TabelaDinamica, 'camposLinha' | 'camposColuna'>,
  caminhoLinha: readonly string[] | null,
  chaveColuna: string | null,
): RegistroDinamico<R>[] {
  return registros.filter(r => {
    if (caminhoLinha) {
      for (let i = 0; i < caminhoLinha.length; i++) {
        if (valorDe(r, tabela.camposLinha[i]) !== caminhoLinha[i]) return false;
      }
    }
    if (chaveColuna && chaveColuna !== COLUNA_TOTAL) {
      if (chaveDaColuna(r, tabela.camposColuna) !== chaveColuna) return false;
    }
    return true;
  });
}

/** Linhas visíveis quando alguns nós estão recolhidos (os filhos somem). */
export function linhasVisiveis(linhas: readonly LinhaDinamica[], recolhidas: ReadonlySet<string>): LinhaDinamica[] {
  const saida: LinhaDinamica[] = [];
  for (const l of linhas) {
    let escondida = false;
    for (let i = 1; i < l.caminho.length; i++) {
      if (recolhidas.has(chaveDe(l.caminho.slice(0, i)))) { escondida = true; break; }
    }
    if (!escondida) saida.push(l);
  }
  return saida;
}
