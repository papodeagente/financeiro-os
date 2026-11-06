/**
 * Trava do título gerado pela venda (06/11/2026, E7) — regra pura.
 *
 * A conta que nasceu de uma venda (origem_venda_id) é refeita pela própria
 * venda: pessoa, valor (moeda e câmbio juntos) e vencimento só mudam lá.
 * Observação, categoria, centro de custo, anexos, campos personalizados e a
 * liquidação continuam pela conta. A edição que tenta mudar um campo travado
 * é recusada (409) com o link para abrir a venda.
 *
 * Campo travado que não veio no pedido fica como está (nunca é apagado por
 * um PUT parcial).
 */
import { num, round2 } from './money';

export type TabelaDoTitulo = 'contas_pagar' | 'contas_receber';

const PESSOA: Record<TabelaDoTitulo, string[]> = {
  contas_pagar: ['fornecedor_id', 'fornecedor_nome'],
  contas_receber: ['cliente_id', 'cliente_nome'],
};
const VALOR: Record<TabelaDoTitulo, string[]> = {
  contas_pagar: ['valor_final', 'valor_brl', 'valor_original'],
  contas_receber: ['valor_final', 'valor_original'],
};
const TEXTO_DO_VALOR = ['moeda'];
const NUMERO_EXTRA = ['cambio'];
const DATA = ['data_vencimento'];

/** A venda de onde a conta nasceu, ou null. */
export function vendaDeOrigem(d: Record<string, unknown> | null | undefined): string | null {
  const v = typeof d?.origem_venda_id === 'string' ? d.origem_venda_id.trim() : '';
  return v || null;
}

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const numero = (v: unknown) => round2(num(v));
const dia = (v: unknown) => texto(v).slice(0, 10);

export interface ResultadoDaTrava {
  /** Rótulos do que mudaria e não pode ("pessoa", "valor", "vencimento"). */
  mudou: string[];
  /** O item com os campos travados ausentes preenchidos a partir do atual. */
  item: Record<string, unknown>;
}

/**
 * Compara o pedido com a conta atual. Só vale para conta de venda: para as
 * outras devolve `mudou: []` e o item como veio.
 */
export function conferirTravaDaVenda(
  tabela: TabelaDoTitulo, atual: Record<string, unknown>, pedido: Record<string, unknown>,
): ResultadoDaTrava {
  if (!vendaDeOrigem(atual)) return { mudou: [], item: pedido };
  const item = { ...pedido };
  const mudou = new Set<string>();
  const conferir = (campos: string[], rotulo: string, comparar: (a: unknown, b: unknown) => boolean) => {
    for (const c of campos) {
      if (!(c in item)) {
        if (c in atual) item[c] = atual[c];
        continue;
      }
      if (!comparar(atual[c], item[c])) mudou.add(rotulo);
    }
  };
  conferir(PESSOA[tabela], 'pessoa', (a, b) => texto(a) === texto(b));
  conferir(VALOR[tabela], 'valor', (a, b) => numero(a) === numero(b));
  conferir(TEXTO_DO_VALOR, 'valor', (a, b) => (texto(a) || 'BRL') === (texto(b) || 'BRL'));
  conferir(NUMERO_EXTRA, 'valor', (a, b) => numero(a) === numero(b) || (!texto(a) && numero(b) === 1) || (!texto(b) && numero(a) === 1));
  conferir(DATA, 'vencimento', (a, b) => dia(a) === dia(b));
  // A venda de origem também não se troca nem se apaga pela conta.
  if ('origem_venda_id' in item && texto(item.origem_venda_id) !== texto(atual.origem_venda_id)) mudou.add('venda de origem');
  item.origem_venda_id = atual.origem_venda_id;
  return { mudou: [...mudou], item };
}

/** A frase da recusa, com o que tentou mudar. */
export function mensagemDaTrava(mudou: readonly string[]): string {
  const lista = mudou.length <= 1 ? (mudou[0] ?? 'estes campos')
    : `${mudou.slice(0, -1).join(', ')} e ${mudou[mudou.length - 1]}`;
  return `Esta conta nasceu de uma venda: ${lista} só mudam pela venda. Abra a venda para alterar; observação, categoria, centro de custo e anexos continuam editáveis aqui.`;
}
