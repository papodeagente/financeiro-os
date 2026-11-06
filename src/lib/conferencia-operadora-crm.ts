/**
 * Extrato da consolidadora que o CRM já importa (E7 frente E, 06/11/2026):
 * o evento `EXTRATO_CONSOLIDADORA` lido no formato da conferência de
 * operadora (`ExtratoLido`). PURO.
 *
 * O CRM lê o extrato de comissão na Conciliação do Studio (planilha ou PDF
 * pela IA) e manda as linhas: localizador, passageiro, bilhete, dia e a
 * COMISSÃO paga (negativa = estorno). Aqui cada linha vira uma linha da
 * conferência só com a comissão (sem bruto nem líquido: o extrato de comissão
 * não os traz), e o estorno vira "cancelamento" (devolve). Linha em outra
 * moeda fica de fora com aviso: a conferência compara em reais.
 *
 * Contrato (reais): { versao, extrato_id, arquivo_nome, formato, impressao,
 * operadora_nome, fornecedor (cadastro do CRM, opcional), moeda, periodo_de,
 * periodo_ate, total_comissao, linhas: [{ ref, localizador,
 * localizador_da_venda, passageiro, bilhete, data, comissao, moeda,
 * crm_venda_id, situacao_no_crm }] }.
 */
import { centavosDe, MAX_LINHAS_DA_CONFERENCIA, normalizarLocalizador, type ExtratoLido, type LinhaLida } from './conferencia-operadora';

export interface ExtratoDoCrmLido {
  /** Chave da conferência (no lugar do hash do arquivo): uma conferência por extrato do CRM. */
  chave: string;
  extrato_id: string;
  arquivo_nome: string;
  operadora_nome: string;
  /** O cadastro do fornecedor como o CRM manda (para `lerFornecedorDaVenda`), quando veio. */
  fornecedor: Record<string, unknown> | null;
  extrato: ExtratoLido;
  avisos: string[];
}

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const dia = (v: unknown): string | null => {
  const s = txt(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};

/** A chave guardada em `conferencias_operadora.arquivo_hash` para o extrato do CRM. */
export function chaveDoExtratoDoCrm(extratoId: string): string {
  return `crm:${extratoId}`;
}

export function lerExtratoDoCrm(payload: Record<string, unknown>): { ok: true; lido: ExtratoDoCrmLido } | { ok: false; motivo: string } {
  const extratoId = txt(payload.extrato_id, 120);
  if (!extratoId) return { ok: false, motivo: 'extrato do CRM sem extrato_id' };
  const brutas = Array.isArray(payload.linhas) ? (payload.linhas as unknown[]).map(obj).filter((l): l is Record<string, unknown> => !!l) : [];
  if (!brutas.length) return { ok: false, motivo: `extrato ${extratoId} do CRM sem linhas` };
  const avisos: string[] = [];
  const moedaDoExtrato = txt(payload.moeda, 3).toUpperCase() || 'BRL';
  const linhas: LinhaLida[] = [];
  let foraDaMoeda = 0;
  for (const l of brutas) {
    const moeda = txt(l.moeda, 3).toUpperCase() || moedaDoExtrato;
    if (moeda !== 'BRL') { foraDaMoeda++; continue; }
    const valor = Number(l.comissao);
    const comissao = centavosDe(Number.isFinite(valor) ? Math.abs(valor) : null);
    const doExtrato = normalizarLocalizador(l.localizador);
    const daVenda = normalizarLocalizador(l.localizador_da_venda);
    const descricao = [
      txt(l.bilhete, 32) ? `Bilhete ${txt(l.bilhete, 32)}` : '',
      daVenda && doExtrato && daVenda !== doExtrato ? `localizador no extrato ${doExtrato}` : '',
      'comissão lida no CRM',
    ].filter(Boolean).join(' · ');
    linhas.push({
      data: dia(l.data),
      // O localizador que a venda guarda casa com ela; o do extrato fica na descrição.
      localizador: daVenda || doExtrato,
      passageiro: txt(l.passageiro, 120),
      descricao: descricao.slice(0, 200),
      tipo: Number.isFinite(valor) && valor < 0 ? 'cancelamento' : 'venda',
      bruto_centavos: null,
      taxas_centavos: null,
      comissao_centavos: comissao,
      liquido_centavos: null,
    });
  }
  if (foraDaMoeda) avisos.push(`${foraDaMoeda} linha(s) em outra moeda ficaram de fora: a conferência compara em reais.`);
  if (linhas.length > MAX_LINHAS_DA_CONFERENCIA) avisos.push(`O extrato tem ${linhas.length} linhas; a conferência leva as ${MAX_LINHAS_DA_CONFERENCIA} primeiras.`);
  if (!linhas.length) return { ok: false, motivo: `extrato ${extratoId} do CRM sem linha em reais` };
  const fornecedor = obj(payload.fornecedor);
  const cnpj = txt(fornecedor?.fornecedor_cnpj, 30).replace(/\D/g, '');
  const total = payload.total_comissao === null || payload.total_comissao === undefined || foraDaMoeda > 0 ? null : Number(payload.total_comissao);
  return {
    ok: true,
    lido: {
      chave: chaveDoExtratoDoCrm(extratoId),
      extrato_id: extratoId,
      arquivo_nome: txt(payload.arquivo_nome, 160) || `Extrato do CRM ${extratoId}`,
      operadora_nome: txt(payload.operadora_nome, 160) || txt(fornecedor?.fornecedor_nome, 160),
      fornecedor,
      extrato: {
        operadora_nome: txt(payload.operadora_nome, 160) || txt(fornecedor?.fornecedor_nome, 160),
        operadora_cnpj: cnpj.length === 14 || cnpj.length === 11 ? cnpj : '',
        periodo_de: dia(payload.periodo_de),
        periodo_ate: dia(payload.periodo_ate),
        total_bruto_centavos: null,
        // Com sinal no CRM; a checagem compara sem sinal.
        total_comissao_centavos: total !== null && Number.isFinite(total) ? Math.round(Math.abs(total) * 100) : null,
        total_liquido_centavos: null,
        linhas: linhas.slice(0, MAX_LINHAS_DA_CONFERENCIA),
      },
      avisos,
    },
  };
}
