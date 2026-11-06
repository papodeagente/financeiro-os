/**
 * Recibo da venda e recibo consolidado da fatura no servidor (E7,
 * 06/11/2026): junta a agência, a venda, as contas e as baixas e devolve o
 * recibo pronto (regras em ./recibo-da-venda.ts). Só leitura.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { historicoDaConta } from './baixas-servidor';
import { agenciaDoTenant, documentoDoCliente } from './cobranca/recibo-servidor';
import { carregarFatura, tituloDa } from './fatura-servidor';
import { carregarVenda, contasDaVendaNoBanco, lerConfigVenda } from './venda-servidor';
import {
  chaveDoPagante, contaParaRecibo, montarReciboDaFatura, montarReciboDaVenda,
  type BaixaDaFatura, type ResultadoDoReciboDaFatura, type ResultadoDoReciboDaVenda,
} from './recibo-da-venda';

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export async function lerReciboDaVenda(
  exec: ExecutorSQL, tenantId: string, vendaId: string, opcoes: { pagante?: string | null; hoje: string },
): Promise<ResultadoDoReciboDaVenda | null> {
  const carregada = await carregarVenda(exec, tenantId, vendaId);
  if (!carregada) return null;
  const venda = carregada.venda;
  const [{ contas_receber }, agencia, config] = await Promise.all([
    contasDaVendaNoBanco(exec, tenantId, vendaId),
    agenciaDoTenant(exec, tenantId),
    lerConfigVenda(exec, tenantId),
  ]);
  const contas = [];
  for (const c of contas_receber) {
    // A conta na fatura não tem baixa própria: o recebimento vem da fatura (já projetado).
    const baixas = c.na_fatura ? [] : await historicoDaConta(exec, tenantId, 'contas_receber', txt(c.id));
    contas.push(contaParaRecibo(c, baixas));
  }
  const creditos_usados = new Set(
    carregada.pendencias
      .filter(p => p.tipo === 'CREDITO_CLIENTE' && p.situacao === 'RESOLVIDA')
      .map(p => p.chave.replace(/^v2:credito:/, '')),
  );
  // Documento de cada pessoa que paga, pelo cadastro (o recibo é da agência: inteiro).
  const documentos: Record<string, string> = {};
  const pessoas = new Map<string, string>();
  for (const c of contas) if (c.cliente_id) pessoas.set(chaveDoPagante(c.cliente_id, c.cliente_nome), c.cliente_id);
  for (const pg of venda.pagamentos) if (pg.pagante?.id) pessoas.set(chaveDoPagante(pg.pagante.id, pg.pagante.nome), pg.pagante.id);
  if (venda.cliente.id) pessoas.set(chaveDoPagante(venda.cliente.id, venda.cliente.nome), venda.cliente.id);
  for (const [chave, id] of pessoas) {
    const doc = await documentoDoCliente(exec, tenantId, id).catch(() => '');
    if (doc) documentos[chave] = doc;
  }
  return montarReciboDaVenda(
    { agencia, venda, contas, creditos_usados, documentos, config: config.recibo, hoje: opcoes.hoje },
    opcoes.pagante ?? null,
  );
}

export interface ReciboDaFaturaLido {
  resultado: ResultadoDoReciboDaFatura;
  /** Conta bancária do título da fatura (a rota confere as contas liberadas). */
  conta_bancaria_id: string;
}

export async function lerReciboDaFatura(exec: ExecutorSQL, tenantId: string, faturaId: string, hoje: string): Promise<ReciboDaFaturaLido | null> {
  const f = await carregarFatura(exec, tenantId, faturaId);
  if (!f) return null;
  const titulo = await tituloDa(exec, tenantId, f);
  const historico = f.titulo_id ? await historicoDaConta(exec, tenantId, 'contas_receber', f.titulo_id) : [];
  const idsContas = [...new Set(historico.map(b => b.conta_bancaria_id).filter((x): x is string => Boolean(x)))];
  const nomes = new Map<string, string>();
  if (idsContas.length) {
    const { rows } = await exec.query(`SELECT id, nome, data FROM contas_bancarias WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, idsContas])
      .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
    for (const r of rows) nomes.set(txt(r.id), txt(r.nome) || txt((r.data as Record<string, unknown> | null)?.nome) || 'Conta');
  }
  const baixas: BaixaDaFatura[] = historico.map(b => ({
    id: b.id, tipo: b.tipo, data: b.data, forma: b.forma, valor: b.valor, juros: b.juros, multa: b.multa, desconto: b.desconto,
    estornada: b.estornada, conta_nome: b.conta_bancaria_id ? nomes.get(b.conta_bancaria_id) ?? '' : '',
  }));
  const { rows: vendas } = await exec.query(
    `SELECT DISTINCT venda_numero FROM fatura_itens WHERE tenant_id = $1 AND fatura_id = $2 AND venda_numero <> '' ORDER BY venda_numero`,
    [tenantId, faturaId],
  ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const { rows: tit } = f.titulo_id
    ? await exec.query(`SELECT data->>'conta_bancaria_id' AS banco FROM contas_receber WHERE tenant_id = $1 AND id = $2`, [tenantId, f.titulo_id])
    : { rows: [] as Array<Record<string, unknown>> };
  const [agencia, documento] = await Promise.all([agenciaDoTenant(exec, tenantId), documentoDoCliente(exec, tenantId, f.pessoa_id)]);
  const total = titulo && titulo.valor_final > 0 ? Math.round(titulo.valor_final * 100) : f.total_centavos;
  return {
    conta_bancaria_id: txt(tit[0]?.banco),
    resultado: montarReciboDaFatura({
      agencia,
      fatura: {
        id: f.id, numero: f.numero, situacao: f.situacao, pessoa_nome: f.pessoa_nome, total_centavos: total,
        periodo_inicio: f.periodo_inicio, periodo_fim: f.periodo_fim, vencimento: f.vencimento,
      },
      vendas: vendas.map(r => txt(r.venda_numero)),
      documento,
      baixas,
      hoje,
    }),
  };
}
