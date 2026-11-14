/**
 * Regras do lançamento de uma conta a pagar ou a receber (06/11/2026, E7).
 * Lógica pura: serve à tela e ao servidor (PUT/POST das contas).
 *
 *   · Emissão: a data em que a conta nasceu (nota, fatura, combinado). Pode
 *     ser editada, mas nunca fica depois do vencimento nem da liquidação.
 *   · Vencimento em fim de semana ou feriado: só um AVISO, com o próximo dia
 *     útil sugerido. Quem decide é a pessoa (o boleto vence quando vence).
 *   · Conta prevista: a conta bancária onde se espera pagar ou receber.
 *     Vale para o fluxo de caixa por conta enquanto o título está em aberto;
 *     quando o título não tem, vale a padrão da agência.
 *   · Conta que nasceu de uma venda: pessoa, valor, moeda e vencimento são
 *     da venda. Mudam pela venda; o resto continua editável aqui.
 */
import { CALENDARIO_NACIONAL, motivoDeNaoSerUtil, proximoDiaUtil, type Calendario } from './feriados';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** 'AAAA-MM-DD' de um dia que existe no calendário, ou ''. */
const dia = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  if (!DATA.test(s)) return '';
  const [a, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : '';
};

/**
 * Confere a emissão contra o vencimento e a liquidação. Devolve a frase da
 * recusa, ou null. Sem emissão (contas antigas) não há o que conferir.
 */
export function conferirEmissao(p: { emissao?: unknown; vencimento?: unknown; liquidacao?: unknown }): string | null {
  const emissao = dia(p.emissao);
  if (!emissao) {
    if (String(p.emissao ?? '').trim()) return 'A data de emissão é inválida.';
    return null;
  }
  const vencimento = dia(p.vencimento);
  if (vencimento && emissao > vencimento) {
    return `A emissão (${dataBR(emissao)}) ficou depois do vencimento (${dataBR(vencimento)}). Corrija uma das duas datas.`;
  }
  const liquidacao = dia(p.liquidacao);
  if (liquidacao && emissao > liquidacao) {
    return `A emissão (${dataBR(emissao)}) ficou depois da data em que a conta foi liquidada (${dataBR(liquidacao)}).`;
  }
  return null;
}

/**
 * Para o servidor: confere a emissão de uma conta que vai ser gravada.
 * `tabela` diz qual campo é a liquidação. Devolve a recusa (400) ou null.
 */
export function conferirEmissaoDaConta(
  tabela: 'contas_pagar' | 'contas_receber',
  item: Record<string, unknown>,
): string | null {
  return conferirEmissao({
    emissao: item.data_emissao,
    vencimento: item.data_vencimento,
    liquidacao: tabela === 'contas_pagar' ? item.data_pagamento : item.data_recebimento,
  });
}

export interface AvisoDeDiaNaoUtil {
  /** "sábado", "domingo" ou o nome do feriado. */
  motivo: string;
  /** Primeiro dia útil depois do vencimento. */
  proximo: string;
  mensagem: string;
}

/** O vencimento cai num dia em que o banco não abre? Aviso com a sugestão, ou null. */
export function avisoDeDiaNaoUtil(iso: unknown, cal: Calendario = CALENDARIO_NACIONAL): AvisoDeDiaNaoUtil | null {
  const d = dia(iso);
  if (!d) return null;
  const motivo = motivoDeNaoSerUtil(d, cal);
  if (!motivo) return null;
  const proximo = proximoDiaUtil(d, cal);
  const quando = motivo === 'sábado' || motivo === 'domingo' ? `num ${motivo}` : `no feriado de ${motivo}`;
  return {
    motivo,
    proximo,
    mensagem: `Este vencimento cai ${quando}. O primeiro dia útil depois é ${dataBR(proximo)}.`,
  };
}

/**
 * A conta bancária PREVISTA de um título em aberto: a escolhida no título
 * (conta_previsao_id) ou, sem ela, a padrão da agência. Null quando não há.
 */
export function contaPrevistaDoTitulo(t: { conta_previsao_id?: unknown }, padrao?: string | null): string | null {
  const propria = String(t.conta_previsao_id ?? '').trim();
  if (propria) return propria;
  const p = String(padrao ?? '').trim();
  return p || null;
}

/** Id da venda que gerou a conta (só a venda muda pessoa, valor e vencimento), ou null. */
export function vendaQueTravaATitulo(d: { origem_venda_id?: unknown } | null | undefined): string | null {
  const v = typeof d?.origem_venda_id === 'string' ? d.origem_venda_id.trim() : '';
  return v || null;
}

/** Explicação curta do que está travado pela venda (para a tela). */
export const EXPLICA_TRAVA_DA_VENDA =
  'Esta conta nasceu de uma venda. Pessoa, valor e vencimento mudam pela venda; observação, categoria, centro de custo, anexos e campos personalizados continuam editáveis aqui.';
