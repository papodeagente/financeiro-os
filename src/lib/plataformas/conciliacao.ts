/**
 * Conciliação entre o recebimento da plataforma e a venda do CRM.
 *
 * Função pura de propósito: é a parte do sistema onde errar tem o custo
 * mais alto (pagamento colado na venda de outro cliente), e é a única
 * forma de testar as combinações sem banco.
 *
 * A regra que organiza tudo: **valor e data não identificam ninguém.**
 * Duas pessoas pagando R$ 1.200 no mesmo dia é rotina. Por isso nenhum
 * vínculo automático acontece sem ao menos uma prova de identidade
 * (documento, e-mail ou o próprio id da transação gravado na venda), por
 * mais alta que a pontuação fique.
 */
import { round2, num } from '../money';

export type Confianca = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface PagamentoParaConciliar {
  id_transacao: string;
  documento: string;
  email: string;
  telefone: string;
  valor: number;
  /** Data civil 'YYYY-MM-DD' do pagamento. */
  data: string;
}

export interface CandidatoVenda {
  venda_id: string;
  cliente_nome: string;
  documento: string;
  email: string;
  telefone: string;
  valor_total: number;
  /** Data civil 'YYYY-MM-DD' da venda. */
  data_venda: string;
  /** Id da transação da plataforma já gravado nesta venda, quando existe. */
  id_transacao_externa: string;
  /** A venda já está conciliada com outro recebimento. */
  ja_conciliada: boolean;
}

export interface Pontuacao {
  venda_id: string;
  pontos: number;
  confianca: Confianca;
  motivos: string[];
  /** Houve prova de identidade (documento, e-mail ou id da transação). */
  tem_identidade: boolean;
}

export const PESOS = {
  ID_TRANSACAO: 100,
  DOCUMENTO: 35,
  EMAIL: 25,
  TELEFONE: 15,
  VALOR_EXATO: 15,
  VALOR_PROXIMO: 8,
  MESMO_DIA: 10,
  ATE_7_DIAS: 6,
  ATE_30_DIAS: 3,
} as const;

export const CORTE_ALTA = 70;
/**
 * O corte de "vale mostrar" é generoso de propósito.
 *
 * Os dois erros têm custos muito diferentes: sugestão errada custa um
 * clique de quem confere; correspondência escondida faz o recebimento
 * virar venda direta em silêncio, e a pergunta "qual venda do CRM gerou
 * este dinheiro" passa a ter resposta errada no relatório. Por isso
 * telefone + valor + mesmo dia (40) já aparece para um humano decidir,
 * enquanto vincular sozinho continua exigindo identidade e 70.
 */
export const CORTE_MEDIA = 35;

export function soDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** CPF com 11 ou CNPJ com 14. Qualquer outro tamanho não identifica. */
export function documentoComparavel(v: unknown): string {
  const d = soDigitos(v);
  return d.length === 11 || d.length === 14 ? d : '';
}

export function emailComparavel(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * Últimos 8 dígitos do telefone.
 *
 * É o único pedaço estável: o mesmo celular aparece com e sem 55, com e
 * sem o nono dígito, com e sem DDD, conforme quem digitou.
 */
export function telefoneComparavel(v: unknown): string {
  const d = soDigitos(v);
  return d.length >= 8 ? d.slice(-8) : '';
}

function diasEntre(a: string, b: string): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const x = Date.parse(`${a}T12:00:00Z`);
  const y = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((x - y) / 86400000));
}

/** Pontua um candidato. Não decide nada: decidir é outra função. */
export function pontuar(pagamento: PagamentoParaConciliar, venda: CandidatoVenda): Pontuacao {
  const motivos: string[] = [];
  let pontos = 0;
  let identidade = false;

  const idPag = String(pagamento.id_transacao ?? '').trim();
  const idVenda = String(venda.id_transacao_externa ?? '').trim();
  if (idPag && idVenda && idPag === idVenda) {
    pontos += PESOS.ID_TRANSACAO;
    identidade = true;
    motivos.push('a venda já aponta para esta transação');
  }

  const docPag = documentoComparavel(pagamento.documento);
  const docVenda = documentoComparavel(venda.documento);
  if (docPag && docPag === docVenda) {
    pontos += PESOS.DOCUMENTO;
    identidade = true;
    motivos.push('mesmo CPF/CNPJ');
  }

  const emailPag = emailComparavel(pagamento.email);
  const emailVenda = emailComparavel(venda.email);
  if (emailPag && emailPag === emailVenda) {
    pontos += PESOS.EMAIL;
    identidade = true;
    motivos.push('mesmo e-mail');
  }

  const telPag = telefoneComparavel(pagamento.telefone);
  const telVenda = telefoneComparavel(venda.telefone);
  if (telPag && telPag === telVenda) {
    pontos += PESOS.TELEFONE;
    // Telefone sozinho não é identidade: número de escritório e de
    // familiar se repetem entre clientes diferentes.
    motivos.push('mesmo telefone');
  }

  const valorPag = round2(num(pagamento.valor));
  const valorVenda = round2(num(venda.valor_total));
  if (valorPag > 0 && valorVenda > 0) {
    const diferenca = Math.abs(valorPag - valorVenda);
    if (diferenca <= 0.02) {
      pontos += PESOS.VALOR_EXATO;
      motivos.push('mesmo valor');
    } else if (diferenca <= valorVenda * 0.01) {
      pontos += PESOS.VALOR_PROXIMO;
      motivos.push('valor a menos de 1% de diferença');
    }
  }

  const dias = diasEntre(pagamento.data, venda.data_venda);
  if (dias === 0) { pontos += PESOS.MESMO_DIA; motivos.push('mesmo dia'); }
  else if (dias <= 7) { pontos += PESOS.ATE_7_DIAS; motivos.push(`${dias} dia(s) de diferença`); }
  else if (dias <= 30) { pontos += PESOS.ATE_30_DIAS; motivos.push(`${dias} dias de diferença`); }

  const confianca: Confianca =
    identidade && pontos >= CORTE_ALTA ? 'ALTA'
      : pontos >= CORTE_MEDIA ? 'MEDIA'
        : 'BAIXA';

  return { venda_id: venda.venda_id, pontos, confianca, motivos, tem_identidade: identidade };
}

export type AcaoConciliacao = 'VINCULAR' | 'SUGERIR' | 'VENDA_DIRETA';

export interface Decisao {
  acao: AcaoConciliacao;
  escolhida: Pontuacao | null;
  /** Ordenadas da melhor para a pior, só as que valem a pena mostrar. */
  candidatas: Pontuacao[];
  motivo: string;
}

/**
 * Decide o que fazer com o pagamento.
 *
 * `vincularAutomatico` é a configuração da agência. Mesmo ligada, existem
 * dois freios que não dependem dela:
 *
 * 1. Sem prova de identidade não há vínculo automático, nunca.
 * 2. Empate técnico entre duas vendas de confiança alta vira sugestão.
 *    Escolher a primeira da lista seria decidir por sorteio com o
 *    dinheiro do cliente.
 */
export function decidir(
  pagamento: PagamentoParaConciliar,
  candidatos: readonly CandidatoVenda[],
  opcoes: { vincularAutomatico: boolean },
): Decisao {
  const pontuadas = candidatos
    .map(c => pontuar(pagamento, c))
    .sort((a, b) => b.pontos - a.pontos);

  const relevantes = pontuadas.filter(p => p.confianca !== 'BAIXA');
  if (relevantes.length === 0) {
    return {
      acao: 'VENDA_DIRETA',
      escolhida: null,
      candidatas: [],
      motivo: 'Nenhuma venda do CRM se parece com este recebimento.',
    };
  }

  const melhor = relevantes[0];
  const segunda = relevantes[1];

  if (melhor.confianca !== 'ALTA') {
    return {
      acao: 'SUGERIR',
      escolhida: melhor,
      candidatas: relevantes,
      motivo: 'Parecido, mas sem prova suficiente para vincular sozinho.',
    };
  }

  if (segunda && segunda.confianca === 'ALTA' && melhor.pontos - segunda.pontos < 15) {
    return {
      acao: 'SUGERIR',
      escolhida: melhor,
      candidatas: relevantes,
      motivo: 'Duas vendas empatam na mesma confiança. Escolher sozinho seria chute.',
    };
  }

  if (!opcoes.vincularAutomatico) {
    return {
      acao: 'SUGERIR',
      escolhida: melhor,
      candidatas: relevantes,
      motivo: 'Confiança alta, mas esta agência pediu para confirmar antes de vincular.',
    };
  }

  return {
    acao: 'VINCULAR',
    escolhida: melhor,
    candidatas: relevantes,
    motivo: melhor.motivos.join('; '),
  };
}
