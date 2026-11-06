/**
 * Razão financeiro (05/11/2026) — parte pura, sem banco.
 *
 * Todo dinheiro que entra ou sai de uma conta bancária vira um LANÇAMENTO com
 * partidas dobradas: uma perna na conta bancária (BANCO) e a outra na
 * contrapartida que explica o movimento (CLIENTES, FORNECEDORES...). A soma
 * das partidas é sempre zero. Valores em centavos inteiros.
 *
 * Nesta fase o razão roda "em sombra": o saldo que as telas mostram continua
 * sendo o saldo_atual de sempre, e o razão é conferido contra ele todo dia.
 */
import { num, paraCentavos, round2 } from './money';
import { pernasDaTransferencia } from './cambio';

/** Contas de sistema do razão (a perna que não é o banco). */
export type ContaDoRazao =
  | 'BANCO'
  | 'CLIENTES'
  | 'FORNECEDORES'
  | 'TRANSFERENCIAS'
  | 'PLATAFORMAS'
  | 'ABERTURA'
  | 'AJUSTE_A_REVISAR';

/** De onde veio o movimento de caixa. Obrigatório em todo movimento. */
export type TipoDeMovimento =
  | 'baixa_receber'      // recebimento (inclui parcial, troca de conta, desfazer pela edição)
  | 'baixa_pagar'        // pagamento
  | 'exclusao_receber'   // conta a receber baixada que foi apagada (estorno)
  | 'exclusao_pagar'     // conta a pagar baixada que foi apagada (estorno)
  | 'transferencia'      // uma perna de transferência entre contas
  | 'plataforma'         // líquido de Asaas/Pagar.me/Hotmart creditado ou estornado
  | 'crm_pagamento'      // pagamento confirmado pelo CRM
  | 'conciliacao'        // baixa feita pela conciliação do extrato
  | 'ajuste'             // recálculo de saldos que mudou o saldo
  | 'abertura';          // saldo de partida da conta no razão

export interface OrigemDoMovimento {
  tipo: TipoDeMovimento;
  /** Tabela do registro que causou o movimento (contas_receber, transferencias...). */
  tabela?: string;
  /** Id do registro que causou o movimento. */
  id?: string;
  /** Cliente ou fornecedor, quando houver. */
  pessoaId?: string;
  descricao?: string;
  /**
   * O valor já está na moeda da conta bancária (E6): só a liquidação nova e a
   * transferência entre moedas conferem isso. Sem esta marca, o movimento é
   * em reais e conta em moeda estrangeira recusa.
   */
  naMoedaDaConta?: boolean;
}

export interface PartidaDoRazao {
  conta: ContaDoRazao;
  conta_bancaria_id: string | null;
  valor_centavos: number; // débito positivo, crédito negativo
  titulo_tabela: string | null;
  titulo_id: string | null;
  pessoa_id: string | null;
}

export interface LancamentoDoRazao {
  chave_natural: string;
  tipo_evento: TipoDeMovimento;
  origem_tabela: string | null;
  origem_id: string | null;
  descricao: string;
  partidas: PartidaDoRazao[];
}

/** A conta que explica o movimento, pela origem. */
export function contrapartidaDe(origem: OrigemDoMovimento): ContaDoRazao {
  switch (origem.tipo) {
    case 'baixa_receber':
    case 'exclusao_receber':
    case 'crm_pagamento':
      return 'CLIENTES';
    case 'baixa_pagar':
    case 'exclusao_pagar':
      return 'FORNECEDORES';
    case 'transferencia':
      return 'TRANSFERENCIAS';
    case 'plataforma':
      return 'PLATAFORMAS';
    case 'abertura':
      return 'ABERTURA';
    case 'ajuste':
      return 'AJUSTE_A_REVISAR';
    case 'conciliacao':
      if (origem.tabela === 'contas_pagar') return 'FORNECEDORES';
      if (origem.tabela === 'contas_receber') return 'CLIENTES';
      return 'AJUSTE_A_REVISAR';
  }
}

const DESCRICOES: Record<TipoDeMovimento, string> = {
  baixa_receber: 'Recebimento',
  baixa_pagar: 'Pagamento',
  exclusao_receber: 'Estorno de recebimento (conta excluída)',
  exclusao_pagar: 'Estorno de pagamento (conta excluída)',
  transferencia: 'Transferência entre contas',
  plataforma: 'Recebimento por plataforma de pagamento',
  crm_pagamento: 'Pagamento confirmado pelo CRM',
  conciliacao: 'Baixa pela conciliação do extrato',
  ajuste: 'Ajuste de saldo pelo recálculo',
  abertura: 'Saldo de abertura da conta',
};

/**
 * Monta o lançamento de um movimento de caixa: entrada (delta > 0) debita o
 * banco e credita a contrapartida; saída faz o contrário. Devolve null quando
 * o valor é zero.
 *
 * `sufixoDaChave` deixa a chave natural única por movimento (o servidor usa o
 * id da transação do banco + a conta bancária). Sem ele, a chave é a da
 * origem — o que vale para lançamentos que só podem existir uma vez
 * (abertura da conta).
 */
export function lancamentoDeMovimento(
  contaBancariaId: string,
  deltaReais: number,
  origem: OrigemDoMovimento,
  sufixoDaChave?: string,
): LancamentoDoRazao | null {
  const centavos = paraCentavos(num(deltaReais));
  if (!centavos || !contaBancariaId) return null;
  const tituloTabela = origem.tabela ?? null;
  const tituloId = origem.id ?? null;
  const pessoa = origem.pessoaId ?? null;
  const base = `${origem.tipo}:${tituloTabela ?? '-'}:${tituloId ?? '-'}`;
  return {
    chave_natural: sufixoDaChave ? `${base}:${sufixoDaChave}` : base,
    tipo_evento: origem.tipo,
    origem_tabela: tituloTabela,
    origem_id: tituloId,
    descricao: origem.descricao || DESCRICOES[origem.tipo],
    partidas: [
      { conta: 'BANCO', conta_bancaria_id: contaBancariaId, valor_centavos: centavos,
        titulo_tabela: tituloTabela, titulo_id: tituloId, pessoa_id: pessoa },
      { conta: contrapartidaDe(origem), conta_bancaria_id: contaBancariaId, valor_centavos: -centavos,
        titulo_tabela: tituloTabela, titulo_id: tituloId, pessoa_id: pessoa },
    ],
  };
}

/** Lançamento fecha em zero? (o banco também confere). */
export function fechaEmZero(l: Pick<LancamentoDoRazao, 'partidas'>): boolean {
  return l.partidas.reduce((s, p) => s + p.valor_centavos, 0) === 0 && l.partidas.length >= 2;
}

// ---------------------------------------------------------------------------
// Reconstrução do saldo a partir do histórico (regra única, usada pelo
// "Recalcular saldos" e pela conferência da abertura do razão).
// ---------------------------------------------------------------------------

export interface ValorMovimentadoFn {
  (d: Record<string, unknown>, campo: 'valor_recebido' | 'valor_pago'): number;
}

export interface EntradaReconstrucao {
  contas: Array<{ id: string; data: Record<string, unknown> }>;
  receber: Array<Record<string, unknown>>;
  pagar: Array<Record<string, unknown>>;
  transferencias: Array<Record<string, unknown>>;
  caixaGeralId: string | null;
  valorMovimentado: ValorMovimentadoFn;
}

export interface ResultadoReconstrucao {
  saldos: Record<string, number>;
  total_recebido: number;
  total_pago: number;
  total_transferido: number;
}

/**
 * saldo = saldo_inicial + Σ recebidos − Σ pagos − transferências que saíram +
 * transferências que entraram. Baixa sem conta bancária cai na Caixa Geral.
 * É exatamente a conta que o "Recalcular saldos" sempre fez.
 */
export function reconstruirSaldos(e: EntradaReconstrucao): ResultadoReconstrucao {
  const saldos: Record<string, number> = {};
  for (const c of e.contas) saldos[c.id] = num(c.data.saldo_inicial);
  let total_recebido = 0;
  let total_pago = 0;
  let total_transferido = 0;

  for (const d of e.receber) {
    const valor = e.valorMovimentado(d, 'valor_recebido');
    const contaId = (d.conta_bancaria_id as string) || e.caixaGeralId || '';
    if (contaId && contaId in saldos) {
      saldos[contaId] = round2(saldos[contaId] + valor);
      total_recebido = round2(total_recebido + valor);
    }
  }
  for (const d of e.pagar) {
    const valor = e.valorMovimentado(d, 'valor_pago');
    const contaId = (d.conta_bancaria_id as string) || e.caixaGeralId || '';
    if (contaId && contaId in saldos) {
      saldos[contaId] = round2(saldos[contaId] - valor);
      total_pago = round2(total_pago + valor);
    }
  }
  for (const d of e.transferencias) {
    const valor = num(d.valor);
    if (valor <= 0) continue;
    // Entre moedas (05/11/2026): chega `valor_destino` e a tarifa sai da
    // origem. Sem esses campos (todas as antigas), o mesmo valor nas duas.
    const { entra, tarifa } = pernasDaTransferencia(d);
    const origemId = (d.conta_origem_id as string) || '';
    const destinoId = (d.conta_destino_id as string) || '';
    let movimentou = false;
    if (origemId && origemId in saldos) {
      saldos[origemId] = round2(saldos[origemId] - valor - tarifa);
      movimentou = true;
    }
    if (destinoId && destinoId in saldos) {
      saldos[destinoId] = round2(saldos[destinoId] + entra);
      movimentou = true;
    }
    if (movimentou) total_transferido = round2(total_transferido + valor);
  }
  for (const id of Object.keys(saldos)) saldos[id] = round2(saldos[id]);
  return { saldos, total_recebido, total_pago, total_transferido };
}
