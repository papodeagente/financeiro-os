/**
 * LIQUIDAR SOZINHO O QUE JÁ ENTROU (E7, 06/11/2026).
 *
 * Em Configurações › Vendas a agência pode ligar, para Dinheiro e para
 * Cheque, "Liquidar automaticamente" com uma conta padrão (o caixa da loja,
 * a conta onde os cheques são depositados). Ligado, a conta a receber da
 * venda daquela forma é baixada sozinha quando vence (dinheiro: no dia da
 * venda; cheque: no dia de cada cheque, pela tarefa do dia).
 *
 * A baixa é SEMPRE a de sempre (`registrarBaixas`, o mesmo motor do
 * POST /api/baixas): razão, caixa, período fechado e idempotência valem
 * igual. O que não dá para baixar (período fechado, sem conta) fica em
 * aberto e volta como aviso — nunca derruba a venda.
 *
 * Só contas da venda completa (v2), geradas por ela, em aberto, sem baixa.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { deCentavos, num, paraCentavos } from './money';
import { horaDeBrasilia, janelaDiaria, type DefinicaoTarefa } from './agendador/nucleo';

export const FORMAS_LIQUIDAVEIS = ['DINHEIRO', 'CHEQUE'] as const;
export type FormaLiquidavel = (typeof FORMAS_LIQUIDAVEIS)[number];

export interface RegraDeLiquidar {
  ligado: boolean;
  /** Conta bancária onde a baixa cai (o pagamento pode dizer outra). */
  conta_bancaria_id: string;
}

export type LiquidarAutomaticamente = Record<FormaLiquidavel, RegraDeLiquidar>;

export const LIQUIDAR_PADRAO: LiquidarAutomaticamente = {
  DINHEIRO: { ligado: false, conta_bancaria_id: '' },
  CHEQUE: { ligado: false, conta_bancaria_id: '' },
};

export function normalizarLiquidar(v: unknown): LiquidarAutomaticamente {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const saida = { ...LIQUIDAR_PADRAO };
  for (const f of FORMAS_LIQUIDAVEIS) {
    const r = (o[f] && typeof o[f] === 'object' ? o[f] : {}) as Record<string, unknown>;
    const conta = typeof r.conta_bancaria_id === 'string' ? r.conta_bancaria_id.trim().slice(0, 80) : '';
    saida[f] = { ligado: r.ligado === true && conta !== '', conta_bancaria_id: conta };
  }
  return saida;
}

export interface ContaParaLiquidar {
  id: string;
  forma: FormaLiquidavel;
  valor: number;
  data: string;
  conta_bancaria_id: string;
  forma_recebimento: string;
}

/**
 * Das contas a receber de uma venda (o JSON como está no banco, com id e
 * status), quais se baixam sozinhas hoje. Arquivo puro: a regra se testa sem
 * banco.
 */
export function contasParaLiquidar(contas: ReadonlyArray<Record<string, unknown>>, cfg: LiquidarAutomaticamente, hoje: string): ContaParaLiquidar[] {
  const saida: ContaParaLiquidar[] = [];
  for (const c of contas) {
    const forma = String(c.venda_forma ?? '') as FormaLiquidavel;
    if (!FORMAS_LIQUIDAVEIS.includes(forma)) continue;
    const regra = cfg[forma];
    if (!regra?.ligado) continue;
    if (String(c.venda_modelo ?? '') !== '2' || c.auto_gerado !== true) continue;
    if (String(c.status ?? '') !== 'PENDENTE') continue;
    if (num(c.valor_recebido) > 0) continue;
    const venc = String(c.data_vencimento ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || venc > hoje) continue;
    const valor = num(c.valor_final);
    if (!(valor > 0)) continue;
    const conta = String(c.conta_bancaria_id ?? '') || regra.conta_bancaria_id;
    if (!conta) continue;
    saida.push({ id: String(c.id), forma, valor, data: venc, conta_bancaria_id: conta, forma_recebimento: String(c.forma_recebimento ?? '') || forma });
  }
  return saida.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
}

export interface ResultadoDaLiquidacao {
  liquidadas: Array<{ id: string; valor: number; data: string }>;
  /** Não deu para baixar (período fechado, conta sem permissão...): fica em aberto. */
  recusadas: Array<{ id: string; motivo: string }>;
}

/**
 * Baixa sozinha as contas da venda que a regra pede. Cada baixa num
 * SAVEPOINT próprio: a que falhar volta atrás sem levar a venda junto.
 */
export async function liquidarContasDaVenda(
  exec: ExecutorSQL, tenantId: string, vendaId: string, cfg: LiquidarAutomaticamente, hoje: string,
  quem: { id: string; nome: string } | null = null,
): Promise<ResultadoDaLiquidacao> {
  const r: ResultadoDaLiquidacao = { liquidadas: [], recusadas: [] };
  if (!FORMAS_LIQUIDAVEIS.some(f => cfg[f].ligado)) return r;
  const { rows } = await exec.query(
    `SELECT id, status, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true'
        AND data->>'venda_forma' = ANY($3::text[])`,
    [tenantId, vendaId, [...FORMAS_LIQUIDAVEIS]],
  );
  const contas = rows.map(x => ({ ...(x.data as Record<string, unknown>), id: String(x.id), status: String((x.data as Record<string, unknown>)?.status ?? x.status) }));
  const alvo = contasParaLiquidar(contas, cfg, hoje);
  if (!alvo.length) return r;
  const { registrarBaixas } = await import('./baixas-servidor');
  for (const c of alvo) {
    const ponto = `liquidar_auto_${r.liquidadas.length + r.recusadas.length}`;
    let comPonto = true;
    try { await exec.query(`SAVEPOINT ${ponto}`); } catch { comPonto = false; }
    try {
      await registrarBaixas(exec, {
        tenantId, usuarioId: quem?.id || 'sistema', usuarioNome: quem?.nome || 'Liquidação automática', origem: 'venda',
        idempotencia: `venda-auto:${c.id}`,
      }, [{
        titulo_tabela: 'contas_receber', titulo_id: c.id, data: c.data, conta_bancaria_id: c.conta_bancaria_id, forma: c.forma_recebimento,
        valor: c.valor, observacao: `Liquidada sozinha (${c.forma === 'DINHEIRO' ? 'dinheiro' : 'cheque'}), pela regra de Configurações › Vendas.`,
      }], { gravar: true });
      if (comPonto) await exec.query(`RELEASE SAVEPOINT ${ponto}`);
      r.liquidadas.push({ id: c.id, valor: c.valor, data: c.data });
    } catch (e) {
      if (comPonto) await exec.query(`ROLLBACK TO SAVEPOINT ${ponto}`).catch(() => undefined);
      r.recusadas.push({ id: c.id, motivo: e instanceof Error ? e.message : 'Não foi possível liquidar.' });
      if (!comPonto) break; // sem ponto de volta, uma falha pode ter sujado a transação: para aqui.
    }
  }
  return r;
}

/** Soma em centavos (para avisos). */
export function totalLiquidado(r: ResultadoDaLiquidacao): number {
  return r.liquidadas.reduce((a, x) => a + paraCentavos(x.valor), 0);
}

export function textoDoTotal(r: ResultadoDaLiquidacao): string {
  return deCentavos(totalLiquidado(r)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Tarefa do dia: os cheques (e o dinheiro) que vencem hoje nas vendas com a
 * regra ligada. Registrar em src/lib/agendador/tarefas.ts.
 */
export const tarefaLiquidarAutomaticamente: DefinicaoTarefa = {
  nome: 'liquidar-automaticamente',
  janela: janelaDiaria(6),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(
      `SELECT DISTINCT tenant_id FROM agencia
        WHERE tenant_id <> '' AND (data->'venda_config'->'liquidar_automaticamente'->'DINHEIRO'->>'ligado' = 'true'
           OR data->'venda_config'->'liquidar_automaticamente'->'CHEQUE'->>'ligado' = 'true')
        ORDER BY tenant_id`,
    );
    return rows.map(x => String(x.tenant_id));
  },
  executar: async ({ exec, emTransacao, agora }, tenantId) => {
    const hoje = horaDeBrasilia(agora).data;
    const { lerConfigVenda } = await import('./venda-servidor');
    const cfg = (await lerConfigVenda(exec, tenantId)).liquidar_automaticamente;
    const { rows } = await exec.query(
      `SELECT DISTINCT data->>'origem_venda_id' AS v FROM contas_receber
        WHERE tenant_id = $1 AND data->>'auto_gerado' = 'true' AND COALESCE(data->>'venda_modelo', '') = '2'
          AND data->>'venda_forma' = ANY($2::text[]) AND COALESCE(data->>'status', '') = 'PENDENTE'
          AND COALESCE(data->>'data_vencimento', '') <> '' AND data->>'data_vencimento' <= $3
        LIMIT 2000`,
      [tenantId, FORMAS_LIQUIDAVEIS.filter(f => cfg[f].ligado), hoje],
    );
    let liquidadas = 0, recusadas = 0;
    for (const x of rows) {
      const res = await emTransacao(tx => liquidarContasDaVenda(tx, tenantId, String(x.v), cfg, hoje));
      liquidadas += res.liquidadas.length;
      recusadas += res.recusadas.length;
    }
    return { vendas: rows.length, liquidadas, recusadas };
  },
};
