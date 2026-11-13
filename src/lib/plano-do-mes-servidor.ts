/**
 * O lado do banco do acompanhamento do plano do mês (ver plano-do-mes.ts).
 *
 * carregarRealizadoDoMes: o que aconteceu no mês, com a MESMA régua do
 * relatório Lucro real (vendas com lançamento, comissão = venda menos custo
 * dos fornecedores, custo fixo pelas contas a pagar do mês). O acompanhamento
 * não inventa outra conta: se os números divergissem do Lucro real, ninguém
 * saberia em qual acreditar.
 *
 * Registros de progresso: o que a pessoa anota porque o sistema não mede
 * (hoje, atendimentos). Moram em planejamento_progresso, separados do plano:
 * salvar o plano substitui o documento dele inteiro e não pode apagar um
 * registro. Toda consulta é por empresa.
 */
import type { ExecutorSQL } from './caixa-atomico';
import type { ComissaoVenda, ContaPagar, ContaReceber, PlanoContas, VendaCRM } from './crm-types';
import { contasDoCustoFixo, escadaDoMes } from './lucro-real';
import { apenasVendasComLastro, vendasComLancamento } from './venda-lancamentos';
import { valorRealizado } from './resultado-financeiro';
import { round2 } from './money';
import { generateId } from './utils';
import type { ContaDoMes, RealizadoDoMes, RegistroDeProgresso } from './plano-do-mes';

/** O que o sistema não mede sozinho e aceita registro. */
export const CHAVES_REGISTRAVEIS = ['atendimentos'] as const;
export type ChaveRegistravel = (typeof CHAVES_REGISTRAVEIS)[number];

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

async function todos<T>(exec: ExecutorSQL, tabela: string, tenantId: string): Promise<T[]> {
  const { rows } = await exec.query(`SELECT data FROM ${tabela} WHERE tenant_id = $1`, [tenantId]);
  return rows.map(r => r.data as T);
}

function lerRegistro(r: Record<string, unknown>): RegistroDeProgresso {
  const d = (r.data ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    chave: String(r.chave ?? d.chave ?? ''),
    valor: Number(d.valor) || 0,
    data: String(d.data ?? ''),
    observacao: String(d.observacao ?? ''),
    autor: String(d.autor ?? ''),
    criado_em: String(d.criado_em ?? ''),
  };
}

export async function listarRegistros(exec: ExecutorSQL, tenantId: string, mes: string): Promise<RegistroDeProgresso[]> {
  const { rows } = await exec.query(
    `SELECT id, chave, data FROM planejamento_progresso
      WHERE tenant_id = $1 AND mes = $2
      ORDER BY data->>'data' DESC, created_at DESC`,
    [tenantId, mes],
  );
  return rows.map(lerRegistro);
}

export interface EntradaDeRegistro {
  chave: string;
  valor: unknown;
  data: string;
  observacao?: unknown;
}

/** Confere o registro. Devolve a mensagem para a pessoa, ou null quando está certo. */
export function validarRegistro(e: EntradaDeRegistro, hoje: string): string | null {
  if (!(CHAVES_REGISTRAVEIS as readonly string[]).includes(e.chave)) return 'Este item não aceita registro manual.';
  const valor = Number(e.valor);
  if (!Number.isInteger(valor) || valor < 0 || valor > 1_000_000) return 'Informe um número inteiro de atendimentos.';
  if (!DIA.test(String(e.data ?? ''))) return 'Informe o dia a que o número se refere.';
  if (e.data > hoje) return 'O registro não pode ser de um dia que ainda não chegou.';
  if (typeof e.observacao === 'string' && e.observacao.length > 280) return 'A observação passa de 280 caracteres.';
  return null;
}

export async function gravarRegistro(
  exec: ExecutorSQL,
  tenantId: string,
  e: EntradaDeRegistro,
  autor: string,
  hoje: string,
): Promise<{ ok: true; registro: RegistroDeProgresso } | { ok: false; erro: string }> {
  const erro = validarRegistro(e, hoje);
  if (erro) return { ok: false, erro };
  const id = generateId();
  const data = {
    id,
    chave: e.chave,
    valor: Number(e.valor),
    data: e.data,
    observacao: typeof e.observacao === 'string' ? e.observacao.trim() : '',
    autor,
    criado_em: new Date().toISOString(),
  };
  await exec.query(
    `INSERT INTO planejamento_progresso (id, tenant_id, mes, chave, data, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [id, tenantId, e.data.slice(0, 7), e.chave, JSON.stringify(data)],
  );
  return { ok: true, registro: lerRegistro({ id, chave: e.chave, data }) };
}

export async function apagarRegistro(exec: ExecutorSQL, tenantId: string, id: string): Promise<boolean> {
  const { rows } = await exec.query(
    `DELETE FROM planejamento_progresso WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [id, tenantId],
  );
  return rows.length > 0;
}

/** O que aconteceu no mês, pronto para o acompanhamento. */
export async function carregarRealizadoDoMes(
  exec: ExecutorSQL,
  tenantId: string,
  mes: string,
  hoje: string,
  aliquotaIss: number | null,
): Promise<RealizadoDoMes> {
  if (!MES.test(mes)) throw new Error('Mês de referência inválido.');
  const [vendas, contasReceber, contasPagar, planoContas, comissoes, registros] = await Promise.all([
    todos<VendaCRM>(exec, 'vendas_crm', tenantId),
    todos<ContaReceber>(exec, 'contas_receber', tenantId),
    todos<ContaPagar>(exec, 'contas_pagar', tenantId),
    todos<PlanoContas>(exec, 'plano_contas', tenantId),
    todos<ComissaoVenda>(exec, 'comissoes', tenantId),
    listarRegistros(exec, tenantId, mes),
  ]);

  // Mesma régua do Lucro real e do DRE: venda só conta enquanto tiver lançamento.
  const comLastro = apenasVendasComLastro(vendas, vendasComLancamento(contasReceber, contasPagar));
  const escada = escadaDoMes({
    mes, hoje, vendas: comLastro, contasReceber, contasPagar, planoContas, comissoes,
    aliquotaIssConfig: aliquotaIss,
  });

  // O custo fixo da escada, conta a conta, separado em estrutura e marketing.
  const categoriaComercial = new Set(planoContas.filter(p => p.is_custo_comercial).map(p => p.id));
  const { fixas } = contasDoCustoFixo(contasPagar, planoContas, mes);
  const contas: ContaDoMes[] = fixas.map(cp => ({
    id: String(cp.id),
    descricao: String(cp.descricao ?? ''),
    fornecedor: String(cp.fornecedor_nome ?? ''),
    valor: round2(Number(cp.valor_final) || 0),
    pago: valorRealizado(cp, 'valor_pago'),
    vencimento: String(cp.data_vencimento ?? '').slice(0, 10),
    grupo: cp.is_custo_comercial || categoriaComercial.has(cp.categoria_id) ? 'marketing' : 'fixo',
  }));

  return {
    mes,
    hoje,
    vendas: escada.n_vendas,
    faturamento: escada.faturamento,
    comissao: escada.comissao,
    comissao_vendedor: escada.comissao_vendedor,
    taxa_plataforma: escada.taxa_plataforma,
    impostos: escada.impostos,
    impostos_estimados: escada.impostos_estimados,
    contribuicao: escada.contribuicao,
    custo_fixo: escada.custo_fixo,
    lucro: escada.lucro,
    equilibrio: {
      atingido: escada.equilibrio.atingido,
      na_venda: escada.equilibrio.na_venda,
      data: escada.equilibrio.data,
      faltam: escada.equilibrio.faltam,
    },
    contas,
    registros,
  };
}
