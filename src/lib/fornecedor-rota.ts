/**
 * Peças das rotas do lado do fornecedor (/api/fornecedores/*, E5 parte C).
 * Arquivo de rota só exporta handlers; o resto mora aqui.
 *
 * Contrato (dinheiro em CENTAVOS de real; datas AAAA-MM-DD):
 *   GET  /api/fornecedores/faturas/a-faturar                → { partes: ResumoDaParte[] }
 *   GET  /api/fornecedores/faturas/a-faturar?parte_id=X     → AFaturarDaParte (itens, sugeridos, regra, próximas 3, sinais)
 *   POST /api/fornecedores/faturas/previa  { parte_id, conta_ids, corte?, vencimento?, modo?: 'SALDO'|'BRUTO' } → { previa, assinatura, periodo }
 *        (modo BRUTO = "Bruto": paga Comissão + Over junto e cria a conta a receber delas, ligada à fatura)
 *   POST /api/fornecedores/faturas         { …o mesmo, assinatura, observacoes? }      → 201 DetalheDaFatura | 409 PREVIA_MUDOU/ITENS_MUDARAM
 *   GET  /api/fornecedores/faturas?parte_id=&situacao=&de=&ate=                         → { faturas: FaturaResumo[] }
 *   GET  /api/fornecedores/faturas/[id]                                                 → DetalheDaFatura
 *   POST /api/fornecedores/faturas/[id]/conferido { conta_pagar_id, conferido: boolean } → DetalheDaFatura (marca o item conferido)
 *   POST /api/fornecedores/faturas/[id]/desfazer { motivo }                              → DetalheDaFatura | 409 FATURA_PAGA/COMISSAO_RECEBIDA
 *   GET|PUT /api/fornecedores/regra-faturamento?parte_id=X  { periodicidade: MENSAL|DIARIO|SEMANAL|DECENDIAL|QUINZENAL, inicio_semana (0–6),
 *                                                             prazo_dias, dia_corte, dia_vencimento, ajuste_vencimento, data_base, gerar_sozinha }
 *                                                            → { regra: RegraDoFornecedor, proximas: PeriodoDaFatura[] }
 *   POST /api/fornecedores/taxa-cc { venda_id, produto_id, lado: 'DU'|'RAV', valor_centavos, motivo } → { de, para }
 *   GET  /api/fornecedores/sinais?parte_id=&situacao=       → { sinais: SinalComSaldo[] }
 *   POST /api/fornecedores/sinais { parte_id, valor_centavos, vencimento, venda_id?, descricao? } → 201 SinalComSaldo
 *   POST /api/fornecedores/sinais/[id]/cancelar { motivo }  → SinalComSaldo
 *   GET  /api/fornecedores/acordos?fornecedor_id=           → { acordos: AcordoGravado[] }
 *   POST /api/fornecedores/acordos  AcordoComFornecedor      → 201 AcordoGravado | 409 VIGENCIA_SOBREPOSTA
 *   PUT|DELETE /api/fornecedores/acordos/[id]
 *   GET  /api/fornecedores/comissoes?de=&ate=               → ComissoesPorOperadora & { de, ate, extrato_disponivel }
 *   GET  /api/fornecedores/opcoes                            → { fornecedores: [{ id, nome, tipo }] }
 * Erros: { error, codigo, detalhes? } com 400, 403, 404, 409, 423.
 */
import { NextResponse } from 'next/server';
import { getSession, type SessionPayload } from './auth';
import { respostaPeriodoFechado } from './guarda-rota';
import { ErroFornecedor } from './fornecedor-servidor';
import { ErroVenda } from './venda-servidor';
import { getTenantId } from './tenant';

export function respostaDeErroDoFornecedor(e: unknown): NextResponse {
  if (e instanceof ErroFornecedor || e instanceof ErroVenda) {
    return NextResponse.json({ error: e.message, codigo: e.codigo, ...(e.detalhes ? { detalhes: e.detalhes } : {}) }, { status: e.status });
  }
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  console.error('[fornecedor]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir agora. Tente de novo.', codigo: 'ERRO' }, { status: 500 });
}

export interface ContextoDaRota {
  sessao: SessionPayload | null;
  tenantId: string;
  usuario: { id: string; nome: string };
}

export async function contexto(): Promise<ContextoDaRota> {
  const sessao = await getSession();
  const tenantId = await getTenantId();
  return { sessao, tenantId, usuario: { id: sessao?.userId ?? '', nome: sessao?.nome ?? '' } };
}

export async function corpo(req: Request): Promise<Record<string, unknown>> {
  const c = await req.json().catch(() => null);
  return c && typeof c === 'object' && !Array.isArray(c) ? c as Record<string, unknown> : {};
}

export const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
