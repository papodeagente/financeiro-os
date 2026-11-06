/**
 * Mudança v2 (E7, 06/11/2026): as provas do histórico.
 *
 *  1. Dinheiro em dobro: para cada conta que recebeu histórico e cujo saldo
 *     na data de corte veio do sistema anterior, o saldo NA DATA DE CORTE
 *     refeito aqui (saldo inicial + toda liquidação até o corte) tem de ser
 *     o informado. Se o histórico tivesse entrado no saldo, a diferença
 *     seria o próprio histórico.
 *  2. Liquidado por mês: o que o arquivo diz que foi pago/recebido em cada
 *     mês × as liquidações que existem aqui para essas contas.
 *  3. Receita por mês (quando vieram vendas): faturamento e receita que o
 *     sistema anterior mostrava × o que as vendas trazidas somam aqui
 *     (receita pelos componentes de mercado, `receitaDaVenda`).
 * Cada diferença com o motivo (linha recusada, desfeita, alterada depois).
 */
import type { ExecutorSQL } from '../caixa-atomico';
import { num, paraCentavos } from '../money';
import type { RegistroLido } from './interpretar';
import type { ExplicacaoDaDiferenca, LinhaDaProva } from './provas';
import { rotuloDoCodigo, type Lote } from './servidor';

const txt = (v: unknown) => (v == null ? '' : String(v));

export interface ProvaDeContaNoCorte extends LinhaDaProva {
  conta_id: string;
  /** Liquidações do histórico (desta mudança) nesta conta. */
  historico_centavos: number;
  /** Saldo de hoje (o histórico não o muda). */
  saldo_hoje_centavos: number;
}

export interface ProvaDoMesLiquidado extends LinhaDaProva { movimento: 'pagar' | 'receber'; mes: string }

export interface ProvaDaReceitaDoMes {
  mes: string;
  vendas: number;
  faturamento: LinhaDaProva;
  /** null = o arquivo não trouxe a coluna de receita. */
  receita: LinhaDaProva | null;
}

export interface ProvaDoHistorico {
  contas_no_corte: ProvaDeContaNoCorte[];
  liquidados: ProvaDoMesLiquidado[];
  receita: ProvaDaReceitaDoMes[];
  registros: { faturas: number; notas: number; comissoes_pagas: number; metas: number; reembolsos: number; creditos: number; movimentos_ligados: number; movimentos_criados: number };
}

interface Acc { rotulo: string; anterior: number; enturos: number; explic: Map<string, ExplicacaoDaDiferenca> }
const novo = (rotulo: string): Acc => ({ rotulo, anterior: 0, enturos: 0, explic: new Map() });
function explicar(a: Acc, codigo: string, motivo: string, centavos: number) {
  const e = a.explic.get(codigo) ?? { codigo, motivo, quantidade: 0, centavos: 0 };
  e.quantidade += 1; e.centavos += centavos;
  a.explic.set(codigo, e);
}
function fechar(chave: string, a: Acc): LinhaDaProva {
  const diferenca = a.anterior - a.enturos;
  const explicacoes = [...a.explic.values()];
  return {
    chave, rotulo: a.rotulo, anterior_centavos: a.anterior, enturos_centavos: a.enturos, diferenca_centavos: diferenca, explicacoes,
    explicada: explicacoes.reduce((s, e) => s + e.centavos, 0) === diferenca && !a.explic.has('sem_motivo'),
  };
}
const nomeDoMes = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;

/** Monta as provas do histórico a partir das linhas do lote (já lidas por provasDoLote). Só lê. */
export async function provasDoHistorico(exec: ExecutorSQL, tenantId: string, lote: Lote, linhas: Array<Record<string, unknown>>): Promise<ProvaDoHistorico> {
  const registros = { faturas: 0, notas: 0, comissoes_pagas: 0, metas: 0, reembolsos: 0, creditos: 0, movimentos_ligados: 0, movimentos_criados: 0 };
  const corte = lote.data_corte;

  // Liquidações que existem aqui agora, por título (sem as estornadas).
  const titulosLiq: string[] = [];
  for (const l of linhas) {
    const reg = (l.dados as { registro?: RegistroLido } | null)?.registro;
    if (reg?.lista === 'liquidados' && l.alvo_id) titulosLiq.push(txt(l.alvo_id));
  }
  const pagoAqui = new Map<string, number>();
  const { rows: temBaixas } = await exec.query(`SELECT to_regclass('public.baixas') IS NOT NULL AS ok`);
  if (titulosLiq.length && temBaixas[0]?.ok) {
    const { rows } = await exec.query(
      `SELECT b.titulo_id, SUM(b.valor_centavos)::bigint AS v FROM baixas b
        WHERE b.tenant_id = $1 AND b.tipo = 'baixa' AND b.titulo_id = ANY($2::text[])
          AND NOT EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = b.tenant_id AND e.estorna_baixa_id = b.id)
        GROUP BY b.titulo_id`,
      [tenantId, titulosLiq],
    );
    for (const r of rows) pagoAqui.set(txt(r.titulo_id), Number(r.v));
  }

  // Vendas trazidas: faturamento e receita aqui.
  const vendaIds = linhas.filter(l => txt(l.alvo_tabela) === 'vendas_crm' && l.alvo_id && (l.dados as { registro?: { venda?: unknown } } | null)?.registro?.venda).map(l => txt(l.alvo_id));
  const vendaAqui = new Map<string, { total: number; receita: number }>();
  const { rows: temModelo } = await exec.query(`SELECT to_regclass('public.vendas_modelo') IS NOT NULL AS ok`);
  if (vendaIds.length && temModelo[0]?.ok) {
    const { rows } = await exec.query(
      `SELECT venda_id, total_cliente_centavos, receita_centavos FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = ANY($2::text[])`, [tenantId, vendaIds],
    );
    for (const r of rows) vendaAqui.set(txt(r.venda_id), { total: Number(r.total_cliente_centavos), receita: Number(r.receita_centavos) });
  }

  const liq = new Map<string, Acc & { movimento: 'pagar' | 'receber'; mes: string }>();
  const fat = new Map<string, { vendas: number; faturamento: Acc; receita: Acc; temReceita: boolean }>();
  for (const l of linhas) {
    const reg = (l.dados as { registro?: RegistroLido } | null)?.registro;
    if (!reg) continue;
    const resultado = txt(l.resultado);
    const codigo = l.codigo == null ? null : txt(l.codigo);
    const recusada = resultado === 'recusar';
    if (reg.lista === 'liquidados') {
      const t = reg.dados;
      const mes = t.baixa.data.slice(0, 7);
      const k = `${t.movimento}|${mes}`;
      let a = liq.get(k);
      if (!a) { a = { ...novo(`${t.movimento === 'receber' ? 'Recebido' : 'Pago'} em ${nomeDoMes(mes)}`), movimento: t.movimento, mes }; liq.set(k, a); }
      a.anterior += t.baixa.valor;
      if (recusada) { explicar(a, codigo ?? 'recusado', rotuloDoCodigo(codigo ?? 'recusado'), t.baixa.valor); continue; }
      if (!l.alvo_id) { explicar(a, 'nao_aplicado', 'Ainda não aplicado', t.baixa.valor); continue; }
      const aqui = pagoAqui.get(txt(l.alvo_id)) ?? 0;
      a.enturos += aqui;
      if (aqui !== t.baixa.valor) explicar(a, aqui === 0 ? 'apagado' : 'alterado_depois', aqui === 0 ? 'A liquidação não existe mais aqui (mudança desfeita ou estorno)' : 'A liquidação foi mudada aqui depois da mudança', t.baixa.valor - aqui);
    }
    if (reg.lista === 'vendas' && reg.venda) {
      const v = reg.venda;
      const mes = v.data_venda.slice(0, 7);
      let f = fat.get(mes);
      if (!f) { f = { vendas: 0, faturamento: novo(`Vendas de ${nomeDoMes(mes)}`), receita: novo(`Receita de ${nomeDoMes(mes)}`), temReceita: false }; fat.set(mes, f); }
      const totalLa = v.produtos.reduce((s, p) => s + (p.valor_total ?? 0), 0);
      const receitaLa = v.produtos.reduce((s, p) => s + (p.receita ?? 0), 0);
      if (v.produtos.some(p => p.receita !== null)) f.temReceita = true;
      f.faturamento.anterior += totalLa;
      f.receita.anterior += receitaLa;
      if (recusada) {
        explicar(f.faturamento, codigo ?? 'recusado', rotuloDoCodigo(codigo ?? 'recusado'), totalLa);
        explicar(f.receita, codigo ?? 'recusado', rotuloDoCodigo(codigo ?? 'recusado'), receitaLa);
        continue;
      }
      f.vendas += 1;
      const aqui = l.alvo_id ? vendaAqui.get(txt(l.alvo_id)) : undefined;
      if (!aqui) {
        explicar(f.faturamento, 'apagado', 'A venda não existe mais aqui (mudança desfeita)', totalLa);
        explicar(f.receita, 'apagado', 'A venda não existe mais aqui (mudança desfeita)', receitaLa);
        continue;
      }
      f.faturamento.enturos += aqui.total;
      f.receita.enturos += aqui.receita;
      if (aqui.total !== totalLa) explicar(f.faturamento, 'sem_motivo', 'O total da venda aqui não bate com o de lá: confira os componentes na ficha da venda', totalLa - aqui.total);
      if (aqui.receita !== receitaLa) explicar(f.receita, 'sem_motivo', 'A receita aqui (pelos componentes de mercado) não bate com a de lá: confira na ficha da venda', receitaLa - aqui.receita);
    }
    if (!recusada) {
      if (reg.lista === 'faturas' || reg.lista === 'notas' || reg.lista === 'comissoes_pagas') registros[reg.lista] += 1;
      if (reg.lista === 'metas') registros.metas += 1;
      if (reg.lista === 'reembolsos') registros.reembolsos += 1;
      if (reg.lista === 'creditos') registros.creditos += 1;
      if (reg.lista === 'movimentos') registros[resultado === 'vincular' ? 'movimentos_ligados' : 'movimentos_criados'] += 1;
    }
  }

  // Saldo na data de corte, refeito, nas contas que receberam histórico.
  const contasNoCorte: ProvaDeContaNoCorte[] = [];
  const { rows: vincs } = await exec.query(
    `SELECT registro_id, acao, dados FROM migracao_vinculos WHERE tenant_id = $1 AND lote_id = $2 AND NOT desfeito AND acao IN ('saldo','historico')`,
    [tenantId, lote.id],
  );
  const informado = new Map<string, number>();
  const historicoDaConta = new Map<string, number>();
  for (const v of vincs) {
    const d = (v.dados ?? {}) as Record<string, unknown>;
    if (txt(v.acao) === 'saldo') informado.set(txt(v.registro_id), Number(d.centavos ?? 0));
    else historicoDaConta.set(txt(d.conta_id), (historicoDaConta.get(txt(d.conta_id)) ?? 0) + Number(d.caixa_centavos ?? 0));
  }
  if (corte && temBaixas[0]?.ok) {
    for (const [contaId, hist] of historicoDaConta) {
      if (!informado.has(contaId)) continue;
      const { rows: c } = await exec.query(`SELECT data FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`, [tenantId, contaId]);
      if (!c.length) continue;
      const d = (c[0].data ?? {}) as Record<string, unknown>;
      const { rows: s } = await exec.query(
        `SELECT COALESCE(SUM(caixa_centavos), 0)::bigint AS s FROM baixas WHERE tenant_id = $1 AND conta_bancaria_id = $2 AND data_baixa <= $3::date`,
        [tenantId, contaId, corte],
      );
      const a: Acc = { ...novo(txt(d.nome) || contaId), anterior: informado.get(contaId)!, enturos: paraCentavos(num(d.saldo_inicial)) + Number(s[0]?.s ?? 0) };
      if (a.anterior !== a.enturos) explicar(a, 'sem_motivo', 'O saldo na data de corte refeito aqui não é o informado: confira as liquidações e transferências até o corte', a.anterior - a.enturos);
      contasNoCorte.push({ ...fechar(`corte:${contaId}`, a), conta_id: contaId, historico_centavos: hist, saldo_hoje_centavos: paraCentavos(num(d.saldo_atual)) });
    }
  }

  return {
    contas_no_corte: contasNoCorte,
    liquidados: [...liq.entries()].map(([k, a]) => ({ ...fechar(k, a), movimento: a.movimento, mes: a.mes }))
      .sort((x, y) => x.mes.localeCompare(y.mes) || x.movimento.localeCompare(y.movimento)),
    receita: [...fat.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, f]) => ({
      mes, vendas: f.vendas, faturamento: fechar(`fat:${mes}`, f.faturamento), receita: f.temReceita ? fechar(`rec:${mes}`, f.receita) : null,
    })),
    registros,
  };
}

/** Quantas linhas das provas do histórico têm diferença sem motivo. */
export function semExplicacaoNoHistorico(h: ProvaDoHistorico): number {
  return [...h.contas_no_corte, ...h.liquidados, ...h.receita.flatMap(r => [r.faturamento, ...(r.receita ? [r.receita] : [])])].filter(l => !l.explicada).length;
}
