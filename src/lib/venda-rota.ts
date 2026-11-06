/**
 * Peças das rotas da venda completa (/api/vendas/completa/*). Arquivo de rota
 * só exporta handlers; o resto mora aqui.
 *
 * Contrato das rotas (valores do MODELO em centavos, como em venda-modelo.ts;
 * as contas como estão no banco, em reais):
 *   POST /api/vendas/completa            { venda } → 201 FichaDaVenda (lançar à mão)
 *   POST /api/vendas/completa/previa     { venda } → PreviaDaVenda (nada é gravado)
 *   GET  /api/vendas/completa/[id]                 → FichaDaVenda
 *   PUT  /api/vendas/completa/[id]       { venda } → FichaDaVenda
 *   POST /api/vendas/completa/[id]/fechar  { confirmar? } → FichaDaVenda | 409 { codigo, detalhes }
 *   POST /api/vendas/completa/[id]/reabrir { motivo }     → FichaDaVenda
 *   GET/PUT /api/config/vendas  { receita: { componentes: { COMISSAO: true, ... } } }
 * Erros: { error, codigo, detalhes? } com 400 (dados), 403, 404, 409 (fechada,
 * não fecha, confirmar), 423 (período fechado).
 */
import { NextResponse } from 'next/server';
import type { SessionPayload } from './auth';
import type { ExecutorSQL } from './caixa-atomico';
import { pode } from './permissoes-servidor';
import { podeEditarFinanceiro } from './permissoes';
import { respostaPeriodoFechado } from './guarda-rota';
import {
  ErroVenda, posicaoDaVendaNoBanco, lerConfigVenda,
  type EventoDaVenda, type PendenciaGravada, type UsuarioDaAcao, type VendaCarregada,
} from './venda-servidor';
import { totaisDaVenda, totaisDoProduto, type TotaisDaVenda, type TotaisDoProduto, type Venda } from './venda-modelo';
import { contasDaVenda, type ContasDaVenda } from './venda-contas';
import { receitaDaVenda, type ConfigReceita, type ReceitaDaVenda } from './venda-receita';
import type { PosicaoDaVenda } from './venda-posicao';

export function usuarioDa(sessao: SessionPayload | null): UsuarioDaAcao {
  return { id: sessao?.userId ?? '', nome: sessao?.nome ?? '' };
}

export function respostaDeErroDaVenda(e: unknown): NextResponse {
  if (e instanceof ErroVenda) {
    return NextResponse.json({ error: e.message, codigo: e.codigo, ...(e.detalhes ? { detalhes: e.detalhes } : {}) }, { status: e.status });
  }
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  const msg = e instanceof Error ? e.message : 'Erro interno';
  return NextResponse.json({ error: msg, codigo: 'ERRO' }, { status: 500 });
}

export interface PermissoesDaFicha {
  editar: boolean;
  fechar: boolean;
  reabrir: boolean;
  /** Cancelar produto ou passageiro (parte D). */
  cancelar: boolean;
  /** Contas, posição e fornecedor. */
  ver_financeiro: boolean;
  /** Receita e comissão da agência. */
  ver_receita: boolean;
}

export interface FichaDaVenda {
  venda: Venda;
  versao_modelo: 1 | 2;
  situacao: 'ABERTA' | 'FECHADA';
  fechada_em: string | null;
  fechada_por: string | null;
  totais: TotaisDaVenda;
  totais_por_produto: Record<string, TotaisDoProduto>;
  receita: ReceitaDaVenda | null;
  posicao: PosicaoDaVenda | null;
  contas_receber: Array<Record<string, unknown>>;
  contas_pagar: Array<Record<string, unknown>>;
  pendencias: PendenciaGravada[];
  eventos: EventoDaVenda[];
  /** Comissões de vendedor ligadas à venda (tabela comissoes). */
  comissoes: Array<Record<string, unknown>>;
  config_receita: ConfigReceita;
  permissoes: PermissoesDaFicha;
}

export async function permissoesDaFicha(sessao: SessionPayload | null, exec: ExecutorSQL): Promise<PermissoesDaFicha> {
  return {
    editar: !!sessao && podeEditarFinanceiro(sessao) && await pode(sessao, 'editar_financeiro', { exec }),
    fechar: await pode(sessao, 'fechar_venda', { exec }),
    reabrir: await pode(sessao, 'reabrir_venda', { exec }),
    cancelar: await pode(sessao, 'cancelar_produto', { exec }),
    ver_financeiro: await pode(sessao, 'ver_aba_financeiro', { exec }),
    ver_receita: await pode(sessao, 'ver_colunas_comissao', { exec }),
  };
}

export async function montarFicha(exec: ExecutorSQL, tenantId: string, vendaId: string, sessao: SessionPayload | null): Promise<FichaDaVenda | null> {
  const p = await posicaoDaVendaNoBanco(exec, tenantId, vendaId);
  if (!p) return null;
  const perm = await permissoesDaFicha(sessao, exec);
  const { carregada } = p;
  const config = await lerConfigVenda(exec, tenantId);
  const { rows: com } = await exec.query(`SELECT id, status, data FROM comissoes WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId])
    .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const porProduto: Record<string, TotaisDoProduto> = {};
  for (const pr of carregada.venda.produtos) porProduto[pr.id] = totaisDoProduto(pr);
  return fichaDe(carregada, {
    totais: totaisDaVenda(carregada.venda),
    totais_por_produto: porProduto,
    receita: perm.ver_receita ? p.posicao.receita : null,
    posicao: perm.ver_financeiro ? { ...p.posicao, receita: perm.ver_receita ? p.posicao.receita : receitaVazia() } : null,
    contas_receber: perm.ver_financeiro ? p.contas_receber : [],
    contas_pagar: perm.ver_financeiro ? p.contas_pagar : [],
    comissoes: perm.ver_receita ? com.map(r => ({ ...(r.data as Record<string, unknown>), id: r.id, status: (r.data as Record<string, unknown>)?.status ?? r.status })) : [],
    config_receita: config.receita,
    permissoes: perm,
  });
}

function receitaVazia(): ReceitaDaVenda {
  return { linhas: [], por_produto: [], receita: 0, fora_da_receita: 0, faturamento: 0, percentual: 0 };
}

function fichaDe(c: VendaCarregada, resto: Omit<FichaDaVenda, 'venda' | 'versao_modelo' | 'situacao' | 'fechada_em' | 'fechada_por' | 'pendencias' | 'eventos'>): FichaDaVenda {
  return {
    venda: c.venda, versao_modelo: c.versao_modelo, situacao: c.situacao, fechada_em: c.fechada_em, fechada_por: c.fechada_por,
    pendencias: c.pendencias, eventos: c.eventos, ...resto,
  };
}

export interface PreviaDaVenda {
  totais: TotaisDaVenda;
  totais_por_produto: Record<string, TotaisDoProduto>;
  receita: ReceitaDaVenda;
  contas: Pick<ContasDaVenda, 'contas_receber' | 'contas_pagar' | 'pendencias' | 'avisos' | 'resumo'>;
}

export function previaDe(venda: Venda, config: ConfigReceita, contas?: ContasDaVenda): PreviaDaVenda {
  const c = contas ?? contasDaVenda({ versao: 2, venda });
  const porProduto: Record<string, TotaisDoProduto> = {};
  for (const pr of venda.produtos) porProduto[pr.id] = totaisDoProduto(pr);
  return {
    totais: totaisDaVenda(venda), totais_por_produto: porProduto, receita: receitaDaVenda(venda, config),
    contas: { contas_receber: c.contas_receber, contas_pagar: c.contas_pagar, pendencias: c.pendencias, avisos: c.avisos, resumo: c.resumo },
  };
}
