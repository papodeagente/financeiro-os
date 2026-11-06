/**
 * Contas avulsas ligadas à venda (E7): a parte pura (tipos, leitura do
 * pedido, pessoas do acerto). Serve a tela e o servidor (venda-avulsas.ts).
 */
import { addDias } from './money';
import { parteDoAcerto, type Centavos, type ParteDaVenda, type Venda } from './venda-modelo';

export type TipoDeAvulsa = 'pagamento_fornecedor' | 'pagar' | 'receber';

export const ROTULO_AVULSA: Record<TipoDeAvulsa, string> = {
  pagamento_fornecedor: 'Pagamento avulso ao fornecedor',
  pagar: 'Conta a pagar avulsa',
  receber: 'Conta a receber avulsa',
};

export interface PedidoDeAvulsa {
  tipo: TipoDeAvulsa;
  pessoa: ParteDaVenda;
  valor_centavos: Centavos;
  vencimento: string;
  descricao: string;
  categoria_id: string;
  observacoes: string;
}

export interface ErroDaAvulsa { campo: string; mensagem: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v: unknown, max = 300) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));

/** Lê o pedido da tela. Puro. */
export function normalizarAvulsa(v: unknown, hoje: string): { pedido: PedidoDeAvulsa; erros: ErroDaAvulsa[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const erros: ErroDaAvulsa[] = [];
  const tipo = (['pagamento_fornecedor', 'pagar', 'receber'] as const).find(t => t === o.tipo) ?? null;
  if (!tipo) erros.push({ campo: 'tipo', mensagem: 'Diga se é pagamento ao fornecedor, conta a pagar ou conta a receber.' });
  const p = (o.pessoa && typeof o.pessoa === 'object' ? o.pessoa : {}) as Record<string, unknown>;
  const pessoa: ParteDaVenda = { id: txt(p.id, 200), nome: txt(p.nome, 200) };
  if (!pessoa.id && !pessoa.nome) erros.push({ campo: 'pessoa', mensagem: tipo === 'receber' ? 'Diga de quem receber.' : 'Diga a quem pagar.' });
  const valor = Math.round(Number(o.valor_centavos));
  if (!(Number.isFinite(valor) && valor > 0)) erros.push({ campo: 'valor_centavos', mensagem: 'Informe um valor maior que zero.' });
  const venc = txt(o.vencimento, 10);
  return {
    pedido: {
      tipo: tipo ?? 'pagar', pessoa, valor_centavos: Number.isFinite(valor) && valor > 0 ? valor : 0,
      vencimento: ISO.test(venc) ? venc : addDias(hoje, tipo === 'receber' ? 7 : 0),
      descricao: txt(o.descricao, 300), categoria_id: txt(o.categoria_id, 120), observacoes: txt(o.observacoes, 1000),
    },
    erros,
  };
}

/** As pessoas do acerto da venda (fornecedor ou representante), para o pagamento avulso. */
export function partesDoAcerto(venda: Venda): ParteDaVenda[] {
  const vistos = new Map<string, ParteDaVenda>();
  for (const p of venda.produtos) {
    if (p.cancelado_em) continue;
    const { parte } = parteDoAcerto(p);
    if (parte?.id) vistos.set(parte.id, parte);
  }
  return [...vistos.values()];
}

