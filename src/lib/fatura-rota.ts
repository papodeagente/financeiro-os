/**
 * Peças das rotas das faturas e das regras de faturamento (E5, parte B).
 * Arquivo de rota só exporta handlers; o resto mora aqui.
 *
 * Contrato (dinheiro em CENTAVOS, campos `*_centavos`; datas 'AAAA-MM-DD'):
 *   GET  /api/faturas?de=&ate=&campo=vencimento|emissao|criacao&situacao=em_aberto|ABERTA|FECHADA|EM_ATRASO|PARCIAL|PAGA|CANCELADA&pessoa_id=&busca=
 *        → { faturas: ResumoDaFatura[], totais }
 *   POST /api/faturas/alocar { venda_id?, pessoa_id? } → ResultadoDaAlocacao   (junta os itens soltos pela regra)
 *   GET  /api/faturas/a-faturar?pessoa_id= → { itens: ItemAFaturar[], notas: AjusteDaFatura[] }
 *   POST /api/faturas/avulsa { conta_ids, vencimento? } | { pessoa_id, notas: true, vencimento? } → { fatura }
 *   GET  /api/faturas/[id] → FichaDaFatura (DetalheDaFatura + permissões)
 *   PATCH /api/faturas/[id] { modelo?, campos?, observacoes?, retencoes? } → FichaDaFatura
 *   POST /api/faturas/[id]/fechar → FichaDaFatura                       (direito fechar_fatura)
 *   POST /api/faturas/[id]/reabrir { motivo } → FichaDaFatura            (direito reabrir_fatura)
 *   POST /api/faturas/[id]/cobrar { provedor?, tipo? } + Idempotency-Key → { ficha, cobranca }  (fecha e emite boleto+Pix)
 *   POST /api/faturas/[id]/itens { acao: mover|avulso|adicionar|tirar|corrigir|conferido|responder, conta_ids, ... } → FichaDaFatura
 *   POST /api/faturas/[id]/notas { tipo, valor_centavos, motivo, proxima? } → FichaDaFatura;  DELETE ?nota=<id>
 *   POST /api/faturas/[id]/saldo → FichaDaFatura (leva o saldo do pagamento parcial à próxima, com nota)
 *   POST /api/faturas/[id]/conferencia { linhas: [{ referencia, valor_centavos? }], arquivo? } → { relatorio, ficha }
 *   GET  /api/faturas/[id]/exportar?formato=csv|xlsx → arquivo                  (direito exportar)
 *   GET|POST /api/regras-faturamento ; GET|PUT|DELETE /api/regras-faturamento/[id]
 *   POST /api/regras-faturamento/previa { regra } → { descricao, proximas, erros }
 *   POST /api/regras-faturamento/recalcular { pessoa_id, aplicar? } → { mudancas, faturas_afetadas, aplicado }
 *   GET  /api/vendas/completa/[id]/nota-de-debito → NotaDeDebito
 *   Portal (público): GET /api/portal/[token]/faturas ; POST /api/portal/[token]/faturas/[id] { acao: aprovar|contestar, itens?, nome? }
 * Erros: { error, codigo, detalhes? } com 400, 403, 404, 409 e 423.
 */
import { NextResponse } from 'next/server';
import type { SessionPayload } from './auth';
import type { ExecutorSQL } from './caixa-atomico';
import { pode } from './permissoes-servidor';
import { podeEditarFinanceiro } from './permissoes';
import { respostaPeriodoFechado } from './guarda-rota';
import { ErroCobranca, ErroProvedor } from './cobranca/tipos';
import { respostaDeErroDaCobranca } from './cobranca/rota';
import { ErroFatura, detalheDaFatura, type DetalheDaFatura, type UsuarioDaFatura } from './fatura-servidor';
import { emitenteDaAgencia, sacadoDoCliente, type Emitente, type Sacado } from './fatura-documento';

export function usuarioDaFatura(sessao: SessionPayload | null): UsuarioDaFatura {
  return { id: sessao?.userId ?? '', nome: sessao?.nome ?? '' };
}

export function respostaDeErroDaFatura(e: unknown): NextResponse {
  if (e instanceof ErroFatura) {
    return NextResponse.json({ error: e.message, codigo: e.codigo, ...(e.detalhes ? { detalhes: e.detalhes } : {}) }, { status: e.status });
  }
  if (e instanceof ErroCobranca || e instanceof ErroProvedor) return respostaDeErroDaCobranca(e, 'fatura');
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  console.error('[faturas]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir agora. Nada foi gravado pela metade; tente de novo.', codigo: 'ERRO' }, { status: 500 });
}

export interface PermissoesDaFatura {
  editar: boolean;
  fechar: boolean;
  reabrir: boolean;
  cobrar: boolean;
  exportar: boolean;
}

export async function permissoesDaFatura(sessao: SessionPayload | null, exec: ExecutorSQL): Promise<PermissoesDaFatura> {
  return {
    editar: !!sessao && podeEditarFinanceiro(sessao) && await pode(sessao, 'editar_financeiro', { exec }),
    fechar: await pode(sessao, 'fechar_fatura', { exec }),
    reabrir: await pode(sessao, 'reabrir_fatura', { exec }),
    cobrar: await pode(sessao, 'gerar_boletos', { exec }),
    exportar: await pode(sessao, 'exportar', { exec }),
  };
}

export type FichaDaFatura = DetalheDaFatura & { permissoes: PermissoesDaFatura; emitente: Emitente; sacado: Sacado; instrucoes: string };

/** Agência (emitente), cliente (sacado) e as instruções da fatura (agencia.data.instrucoes_fatura). */
export async function cabecalhoDoDocumento(exec: ExecutorSQL, tenantId: string, clienteId: string, nomeNaFatura: string): Promise<{ emitente: Emitente; sacado: Sacado; agencia: Record<string, unknown> }> {
  const { rows: ag } = await exec.query(`SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [tenantId])
    .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const { rows: cli } = clienteId
    ? await exec.query(`SELECT nome, cpf_cnpj, data FROM clientes WHERE tenant_id = $1 AND id = $2`, [tenantId, clienteId]).catch(() => ({ rows: [] as Array<Record<string, unknown>> }))
    : { rows: [] as Array<Record<string, unknown>> };
  const agencia = (ag[0]?.data ?? {}) as Record<string, unknown>;
  return {
    emitente: emitenteDaAgencia(agencia),
    sacado: sacadoDoCliente(clienteId, String(cli[0]?.nome ?? '') || nomeNaFatura, String(cli[0]?.cpf_cnpj ?? ''), (cli[0]?.data ?? null) as Record<string, unknown> | null),
    agencia,
  };
}

export async function montarFichaDaFatura(exec: ExecutorSQL, tenantId: string, id: string, sessao: SessionPayload | null): Promise<FichaDaFatura | null> {
  const d = await detalheDaFatura(exec, tenantId, id);
  if (!d) return null;
  const cab = await cabecalhoDoDocumento(exec, tenantId, d.fatura.pessoa_id, d.fatura.pessoa_nome);
  return {
    ...d, permissoes: await permissoesDaFatura(sessao, exec), emitente: cab.emitente, sacado: cab.sacado,
    instrucoes: typeof cab.agencia.instrucoes_fatura === 'string' ? cab.agencia.instrucoes_fatura.slice(0, 2000) : '',
  };
}

export async function lerJson<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

export function chaveDeIdempotencia(req: Request): string | undefined {
  const v = req.headers.get('idempotency-key')?.trim();
  return v ? v.slice(0, 200) : undefined;
}
