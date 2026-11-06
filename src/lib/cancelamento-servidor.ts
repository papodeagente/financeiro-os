/**
 * Cancelamento no banco (E5, parte D, 05/11/2026): prévia e gravação.
 *
 * Um caminho só, `executarCancelamento`, faz TUDO dentro da transação de
 * quem chama: marca o cancelamento no modelo (cancelamento.ts), regrava a
 * venda pelo `salvarVenda` de sempre (as contas se refazem sozinhas, o que já
 * foi baixado fica), acerta as parcelas já pagas em parte, transforma a sobra
 * em reembolso ou crédito do cliente, pede ao fornecedor o que a agência
 * pagou a mais, estorna a comissão do vendedor e guarda o registro.
 *
 * A PRÉVIA é esse mesmo caminho rodado numa transação que é desfeita no fim:
 * a pessoa vê exatamente as contas que vão mudar (antes → depois), sem uma
 * segunda regra que pudesse divergir. A gravação refaz e confere a
 * assinatura da prévia: se algo mudou no meio, recusa e pede nova prévia.
 */
import { createHash } from 'node:crypto';
import { generateId } from './utils';
import { addDias, deCentavos, hojeISO, paraCentavos, round2 } from './money';
import { STATUS_BAIXADOS, emTransacao, type ExecutorSQL } from './caixa-atomico';
import type { ComissaoVenda } from './crm-types';
import { sincronizarContaDaComissao, vencimentoDaComissao } from './comissao-conta';
import { receitaDaVenda } from './venda-receita';
import type { Venda } from './venda-modelo';
import {
  DIAS_PRAZO_REEMBOLSO_FORNECEDOR, normalizarPedidoDeCancelamento, normalizarPolitica, planejarCancelamento,
  planoDoEstornoDeComissao, reaplicarCancelamentos,
  type AvisoDoCancelamento, type CancelamentoDoProduto, type CancelamentoGravado, type EstornoDeComissao,
  type PedidoDeCancelamento, type PoliticaDeCancelamento, type ReducaoDePagamento,
} from './cancelamento';
import { ErroVenda, carregarVenda, contasDaVendaNoBanco, ladoDaConta, lerConfigVenda, registrarEventoDaVenda, salvarVenda, type UsuarioDaAcao } from './venda-servidor';
import { creditoNaoUsadoPorPagamento, criarCredito, saldoDisponivel } from './credito-cliente-servidor';
import { criarReembolso } from './reembolsos-servidor';

export { PARTE_D_SCHEMA_SQL, VENDA_CANCELAMENTOS_SCHEMA_SQL } from './cancelamento-schema';

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataISO = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10));
const BRL = (c: number) => deCentavos(c).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ============================================================
// Tipos do contrato
// ============================================================

export interface MudancaDeConta {
  tabela: 'contas_receber' | 'contas_pagar';
  /** null na conta criada (o id só existe depois de gravar). */
  id: string | null;
  tipo: 'criada' | 'alterada' | 'removida';
  pessoa: string;
  descricao: string;
  vencimento: string;
  /** Em reais. */
  antes: number | null;
  depois: number | null;
  status_antes: string | null;
  status_depois: string | null;
}

export interface ReembolsoDoCancelamento { id: string | null; tipo: 'CLIENTE' | 'FORNECEDOR'; pessoa: string; valor_centavos: number; prazo: string }

export interface ResultadoDoCancelamento {
  cancelamento_id: string;
  venda_id: string;
  venda_numero: string;
  data: string;
  produtos: CancelamentoDoProduto[];
  reducoes: ReducaoDePagamento[];
  mudancas: MudancaDeConta[];
  reembolsos: ReembolsoDoCancelamento[];
  credito: { id: string | null; valor_centavos: number; validade: string } | null;
  credito_devolvido_centavos: number;
  comissoes: EstornoDeComissao[];
  receita_antes_centavos: number;
  receita_depois_centavos: number;
  todos_cancelados: boolean;
  avisos: AvisoDoCancelamento[];
  assinatura: string;
}

export interface ContextoDoCancelamento {
  venda_id: string;
  versao_modelo: 1 | 2;
  /** Política de cancelamento do fornecedor de cada produto (para a multa sugerida). */
  politicas: Record<string, PoliticaDeCancelamento | null>;
  saldo_credito_cliente_centavos: number;
  cancelamentos: Array<{ id: string; data: string; motivo: string; usuario_nome: string; criado_em: string; resumo: Record<string, unknown> }>;
}

// ============================================================
// Leitura
// ============================================================

async function tabelaExiste(exec: ExecutorSQL, nome: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${nome}`]);
  return rows[0]?.ok === true;
}

export async function cancelamentosGravados(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<Array<CancelamentoGravado & { motivo: string; usuario_nome: string; criado_em: string; resultado: Record<string, unknown> }>> {
  if (!(await tabelaExiste(exec, 'venda_cancelamentos'))) return [];
  const { rows } = await exec.query(`SELECT * FROM venda_cancelamentos WHERE tenant_id = $1 AND venda_id = $2 ORDER BY criado_em, id`, [tenantId, vendaId]);
  return rows.map(r => {
    const plano = (r.plano ?? {}) as Record<string, unknown>;
    return {
      id: txt(r.id), data: dataISO(r.data),
      produtos: (Array.isArray(plano.produtos) ? plano.produtos : []) as CancelamentoGravado['produtos'],
      reducoes: (Array.isArray(plano.reducoes) ? plano.reducoes : []) as ReducaoDePagamento[],
      motivo: txt(r.motivo), usuario_nome: txt(r.usuario_nome),
      criado_em: r.criado_em instanceof Date ? r.criado_em.toISOString() : txt(r.criado_em),
      resultado: (r.resultado ?? {}) as Record<string, unknown>,
    };
  });
}

/** Para salvarVenda: a venda que chegou do CRM recebe de volta os cancelamentos feitos aqui. */
export async function reaplicarCancelamentosGravados(exec: ExecutorSQL, tenantId: string, venda: Venda): Promise<Venda> {
  return reaplicarCancelamentos(venda, await cancelamentosGravados(exec, tenantId, venda.id));
}

export async function contextoDoCancelamento(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<ContextoDoCancelamento | null> {
  const c = await carregarVenda(exec, tenantId, vendaId);
  if (!c) return null;
  const ids = [...new Set(c.venda.produtos.flatMap(p => [p.representante?.id ?? '', p.fornecedor?.id ?? '']).filter(Boolean))];
  const politicaDe = new Map<string, PoliticaDeCancelamento | null>();
  if (ids.length) {
    const { rows } = await exec.query(`SELECT id, data FROM fornecedores_crm WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]);
    for (const r of rows) politicaDe.set(txt(r.id), normalizarPolitica(((r.data ?? {}) as Record<string, unknown>).politica_cancelamento));
  }
  const politicas: Record<string, PoliticaDeCancelamento | null> = {};
  for (const p of c.venda.produtos) {
    politicas[p.id] = politicaDe.get(p.fornecedor?.id ?? '') ?? politicaDe.get(p.representante?.id ?? '') ?? null;
  }
  return {
    venda_id: vendaId,
    versao_modelo: c.versao_modelo,
    politicas,
    saldo_credito_cliente_centavos: await saldoDisponivel(exec, tenantId, c.venda.cliente.id),
    cancelamentos: (await cancelamentosGravados(exec, tenantId, vendaId)).map(x => ({
      id: x.id, data: x.data, motivo: x.motivo, usuario_nome: x.usuario_nome, criado_em: x.criado_em, resumo: x.resultado,
    })).reverse(),
  };
}

// ============================================================
// Estado antes de cancelar
// ============================================================

async function travadasPorCobranca(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<Set<string>> {
  const s = new Set<string>();
  if (!(await tabelaExiste(exec, 'cobrancas'))) return s;
  const { rows } = await exec.query(
    `SELECT c.titulo_id FROM cobrancas c JOIN contas_receber r ON r.tenant_id = c.tenant_id AND r.id = c.titulo_id
      WHERE c.tenant_id = $1 AND c.titulo_tabela = 'contas_receber' AND r.data->>'origem_venda_id' = $2 AND c.status IN ('emitindo','aberta','vencida')`,
    [tenantId, vendaId],
  );
  for (const r of rows) s.add(txt(r.titulo_id));
  return s;
}

async function livrePorPagamento(exec: ExecutorSQL, tenantId: string, vendaId: string, travadas: Set<string>): Promise<Record<string, number>> {
  const { rows } = await exec.query(
    `SELECT id, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true'`,
    [tenantId, vendaId],
  );
  const livre: Record<string, number> = {};
  for (const r of rows) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const pag = txt(d.venda_pagamento_id);
    const st = txt(d.status);
    if (!pag || travadas.has(txt(r.id)) || st === 'CANCELADO' || (STATUS_BAIXADOS as readonly string[]).includes(st)) continue;
    livre[pag] = (livre[pag] ?? 0) + paraCentavos(Number(d.valor_final) || 0);
  }
  return livre;
}

interface Retrato { tabela: 'contas_receber' | 'contas_pagar'; id: string; d: Record<string, unknown> }

async function retratoDasContas(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<Retrato[]> {
  const { contas_receber, contas_pagar } = await contasDaVendaNoBanco(exec, tenantId, vendaId);
  return [
    ...contas_receber.map(d => ({ tabela: 'contas_receber' as const, id: txt(d.id), d })),
    ...contas_pagar.map(d => ({ tabela: 'contas_pagar' as const, id: txt(d.id), d })),
  ];
}

function diferencas(antes: Retrato[], depois: Retrato[]): MudancaDeConta[] {
  const chave = (r: Retrato) => `${r.tabela}:${r.id}`;
  const a = new Map(antes.map(r => [chave(r), r]));
  const b = new Map(depois.map(r => [chave(r), r]));
  const pessoa = (r: Retrato) => txt(r.tabela === 'contas_receber' ? r.d.cliente_nome : r.d.fornecedor_nome);
  const valor = (r: Retrato) => round2(Number(r.d.valor_final) || 0);
  const out: MudancaDeConta[] = [];
  for (const [k, x] of a) {
    const y = b.get(k);
    if (!y) {
      out.push({ tabela: x.tabela, id: x.id, tipo: 'removida', pessoa: pessoa(x), descricao: txt(x.d.descricao), vencimento: txt(x.d.data_vencimento).slice(0, 10), antes: valor(x), depois: null, status_antes: txt(x.d.status), status_depois: null });
    } else if (valor(x) !== valor(y) || txt(x.d.status) !== txt(y.d.status)) {
      out.push({ tabela: x.tabela, id: x.id, tipo: 'alterada', pessoa: pessoa(y), descricao: txt(y.d.descricao), vencimento: txt(y.d.data_vencimento).slice(0, 10), antes: valor(x), depois: valor(y), status_antes: txt(x.d.status), status_depois: txt(y.d.status) });
    }
  }
  for (const [k, y] of b) {
    if (a.has(k)) continue;
    out.push({ tabela: y.tabela, id: y.id, tipo: 'criada', pessoa: pessoa(y), descricao: txt(y.d.descricao), vencimento: txt(y.d.data_vencimento).slice(0, 10), antes: null, depois: valor(y), status_antes: null, status_depois: txt(y.d.status) });
  }
  const ordem = { removida: 0, alterada: 1, criada: 2 };
  return out.sort((p, q) => p.tabela.localeCompare(q.tabela) || ordem[p.tipo] - ordem[q.tipo] || p.descricao.localeCompare(q.descricao));
}

/**
 * Parte de uma conta já paga em parte que deixou de ser devida: o valor da
 * conta desce até o que entrou (ou o necessário). Devolve quanto desceu.
 */
async function reduzirParciais(exec: ExecutorSQL, tenantId: string, vendaId: string, tabela: 'contas_receber' | 'contas_pagar', lado: string, excesso: number): Promise<number> {
  if (excesso <= 0) return 0;
  const campo = tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago';
  const quitado = tabela === 'contas_receber' ? 'RECEBIDO' : 'PAGO';
  const { rows } = await exec.query(
    `SELECT id, data FROM ${tabela} WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'auto_gerado' = 'true' AND COALESCE(data->>'status','') = 'PARCIAL' ORDER BY data->>'data_vencimento' DESC, id`,
    [tenantId, vendaId],
  );
  let resta = excesso;
  for (const r of rows) {
    if (resta <= 0) break;
    const d = (r.data ?? {}) as Record<string, unknown>;
    if (ladoDaConta(tabela, d) !== lado) continue;
    const final = paraCentavos(Number(d.valor_final) || 0);
    const pago = paraCentavos(Number(d[campo]) || 0);
    const aberto = final - pago;
    if (aberto <= 0) continue;
    const tira = Math.min(aberto, resta);
    resta -= tira;
    const novo = { ...d };
    novo.valor_final = deCentavos(final - tira);
    novo.valor_original = round2((Number(d.valor_original) || deCentavos(final)) - deCentavos(tira));
    if (d.valor_base_encargos !== undefined && d.valor_base_encargos !== null) novo.valor_base_encargos = round2((Number(d.valor_base_encargos) || 0) - deCentavos(tira));
    if ('valor_brl' in d) novo.valor_brl = novo.valor_final;
    if (final - tira - pago <= 0) novo.status = quitado;
    novo.observacoes = `${txt(d.observacoes) ? `${txt(d.observacoes)} · ` : ''}Cancelamento: ${BRL(tira)} deixaram de ser devidos.`;
    await exec.query(`UPDATE ${tabela} SET data = $3::jsonb, status = $4, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, txt(r.id), JSON.stringify(novo), txt(novo.status)]);
  }
  return excesso - resta;
}

/** O que está em aberto em contas com boleto/Pix emitido (não se mexe nelas sozinho). */
async function abertoComCobranca(exec: ExecutorSQL, tenantId: string, vendaId: string, travadas: Set<string>): Promise<Array<{ id: string; descricao: string; aberto: number }>> {
  if (!travadas.size) return [];
  const { rows } = await exec.query(`SELECT id, data FROM contas_receber WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, [...travadas]]);
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return { id: txt(r.id), descricao: txt(d.descricao), aberto: paraCentavos(Number(d.valor_final) || 0) - paraCentavos(Number(d.valor_recebido) || 0) };
  }).filter(x => x.aberto > 0 && ladoDaConta('contas_receber', rows.find(r => txt(r.id) === x.id)?.data as Record<string, unknown>) === 'cliente');
}

// ============================================================
// Comissão do vendedor
// ============================================================

async function aplicarEstornoDeComissao(
  exec: ExecutorSQL, tenantId: string, vendaId: string, vendaNumero: string, cancelamentoId: string, plano: EstornoDeComissao[], data: string,
): Promise<void> {
  const hoje = hojeISO();
  for (const e of plano) {
    if (e.acao === 'manter') continue;
    const { rows } = await exec.query(`SELECT data FROM comissoes WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, e.comissao_id]);
    if (!rows.length) continue;
    const c = { ...(rows[0].data as Record<string, unknown>) } as unknown as ComissaoVenda & Record<string, unknown>;
    const estornos = Array.isArray(c.estornos) ? [...(c.estornos as unknown[])] : [];
    const nota = `Cancelamento de ${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}: estorno de ${BRL(paraCentavos(e.estorno))}.`;
    if (e.acao === 'estornar_paga') {
      // Já paga: o vendedor devolve (a receber dele), descontável da próxima comissão.
      const contaId = `cr-estorno-comissao-${cancelamentoId}-${e.comissao_id}`.slice(0, 200);
      const { rows: ag } = await exec.query(`SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId]).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
      const venc = vencimentoDaComissao((ag[0]?.data as Record<string, unknown> | undefined)?.datas_pagamento_comissao, data, hoje);
      const conta = {
        id: contaId, origem: 'OUTROS', venda_id: vendaId, grupo_id: null, cliente_id: '', cliente_nome: e.vendedor_nome || 'Vendedor',
        vendedor_id: txt(c.vendedor_id), comissao_id: e.comissao_id, descricao: `Estorno de comissão · ${e.vendedor_nome || 'vendedor'} · venda ${vendaNumero}`,
        categoria_id: '', centro_custo: '', valor_original: e.estorno, juros: 0, multa: 0, desconto: 0, valor_final: e.estorno,
        data_emissao: hoje, data_vencimento: venc.data, data_recebimento: null, valor_recebido: null, conta_bancaria_id: null,
        forma_recebimento: '', taxa: 0, taxa_plataforma: '', boleto_emitido: false, boleto_codigo: '', boleto_url: '', status: 'PENDENTE',
        parcela_numero: 1, total_parcelas: 1, rateio: [], anexos: [],
        observacoes: `A comissão desta venda já foi paga. ${nota} Desconte da próxima comissão ou receba do vendedor.`,
        origem_venda_id: vendaId, auto_gerado: false, estorno_de_comissao: true,
      };
      await exec.query(
        `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, '', 'PENDENTE', $4::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [contaId, tenantId, vendaId, JSON.stringify(conta)],
      );
      estornos.push({ cancelamento_id: cancelamentoId, valor: e.estorno, conta_id: contaId, em: hoje });
      c.estornos = estornos;
      c.observacoes = `${txt(c.observacoes) ? `${txt(c.observacoes)} | ` : ''}${nota} Já paga: estorno lançado a receber do vendedor.`;
      await exec.query(`UPDATE comissoes SET data = $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, e.comissao_id, JSON.stringify(c)]);
      continue;
    }
    estornos.push({ cancelamento_id: cancelamentoId, valor: e.estorno, em: hoje });
    c.estornos = estornos;
    c.valor_comissao = e.valor_depois;
    c.valor_base = e.base_depois;
    if (e.acao === 'cancelar') c.status = 'CANCELADA';
    c.observacoes = `${txt(c.observacoes) ? `${txt(c.observacoes)} | ` : ''}${nota}`;
    await exec.query(`UPDATE comissoes SET data = $3::jsonb, status = $4, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, e.comissao_id, JSON.stringify(c), c.status]);
    await sincronizarContaDaComissao(tenantId, c, exec);
  }
}

// ============================================================
// O caminho único
// ============================================================

export async function executarCancelamento(
  exec: ExecutorSQL, tenantId: string, vendaId: string, pedidoBruto: unknown, usuario: UsuarioDaAcao,
  opcoes: { cancelamentoId?: string } = {},
): Promise<ResultadoDoCancelamento> {
  const hoje = hojeISO();
  const carregada = await carregarVenda(exec, tenantId, vendaId);
  if (!carregada) throw new ErroVenda('NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  if (carregada.versao_modelo !== 2) {
    throw new ErroVenda('MODELO_ANTERIOR', 'Esta venda está no formato anterior. Salve-a na ficha da venda completa (ela passa a ter produtos e passageiros) e cancele por aqui.', 409);
  }
  const venda = carregada.venda;
  const { pedido, erros } = normalizarPedidoDeCancelamento(pedidoBruto, venda, hoje);
  if (erros.length) throw new ErroVenda('DADOS', erros[0].mensagem, 400, { erros });
  const cancelamentoId = opcoes.cancelamentoId || generateId();

  const travadas = await travadasPorCobranca(exec, tenantId, vendaId);
  const estado = {
    livre: await livrePorPagamento(exec, tenantId, vendaId, travadas),
    credito_nao_usado: await creditoNaoUsadoPorPagamento(exec, tenantId, vendaId),
  };
  const plano = planejarCancelamento(venda, pedido, estado, cancelamentoId);
  if (plano.erros.length) throw new ErroVenda('DADOS', plano.erros[0].mensagem, 400, { erros: plano.erros });
  const avisos: AvisoDoCancelamento[] = [...plano.avisos];

  const config = await lerConfigVenda(exec, tenantId);
  const receitaAntes = receitaDaVenda(venda, config.receita).receita;
  const receitaDepois = receitaDaVenda(plano.venda, config.receita).receita;

  const antes = await retratoDasContas(exec, tenantId, vendaId);
  // Mesmo caminho da tela e do CRM: as contas se refazem sozinhas; o que já
  // foi baixado fica. 'manual' aqui só evita reaplicar o que o CRM faria.
  const gravacao = await salvarVenda(exec, tenantId, plano.venda, {
    usuario, origem: 'manual', ignorarFechamento: true, semEvento: true,
  });

  // ---- O que já se moveu a mais, lado a lado ----
  let sobraCliente = 0;
  const sobraFornecedor = new Map<string, number>();
  for (const a of gravacao.avisos) {
    if (a.codigo !== 'MOVIDO_ACIMA_DO_PREVISTO' || !a.lado || !a.valor_centavos) continue;
    if (a.lado === 'cliente') {
      let e = a.valor_centavos;
      e -= await reduzirParciais(exec, tenantId, vendaId, 'contas_receber', 'cliente', e);
      for (const x of await abertoComCobranca(exec, tenantId, vendaId, travadas)) {
        const parte = Math.min(e, x.aberto);
        if (parte <= 0) continue;
        e -= parte;
        avisos.push({ codigo: 'COBRANCA_EMITIDA', valor_centavos: parte, mensagem: `"${x.descricao}" tem boleto ou Pix emitido: cancele a cobrança e reduza a conta em ${BRL(parte)}. Ela não foi mexida.` });
      }
      sobraCliente += Math.max(0, e);
    } else if (a.lado.startsWith('forn:')) {
      let e = a.valor_centavos;
      e -= await reduzirParciais(exec, tenantId, vendaId, 'contas_pagar', a.lado, e);
      if (e > 0) sobraFornecedor.set(a.lado, (sobraFornecedor.get(a.lado) ?? 0) + e);
    } else {
      avisos.push({ codigo: 'ACERTO_A_FAZER', valor_centavos: a.valor_centavos, mensagem: a.mensagem });
    }
  }

  // ---- Fornecedor: o que a agência pagou a mais volta como reembolso ----
  const reembolsos: ReembolsoDoCancelamento[] = [];
  let reembolsoFornecedorId = '';
  for (const [lado, valor] of sobraFornecedor) {
    const conta = antes.find(r => r.tabela === 'contas_pagar' && ladoDaConta('contas_pagar', r.d) === lado);
    const pessoaId = txt(conta?.d.fornecedor_id);
    const pessoaNome = txt(conta?.d.fornecedor_nome) || 'Fornecedor';
    const prazo = addDias(pedido.data, DIAS_PRAZO_REEMBOLSO_FORNECEDOR);
    const r = await criarReembolso(exec, tenantId, {
      tipo: 'FORNECEDOR', venda_id: vendaId, venda_numero: venda.numero, cancelamento_id: cancelamentoId,
      pessoa_id: pessoaId, pessoa_nome: pessoaNome, valor_centavos: valor, prazo, centro_custo: venda.centro_custo,
      descricao: `Cancelamento da venda ${venda.numero}: a agência já tinha pago ${BRL(valor)} além do que ficou devido.`,
    }, usuario.nome || usuario.id);
    reembolsoFornecedorId = reembolsoFornecedorId || r.id;
    reembolsos.push({ id: r.id, tipo: 'FORNECEDOR', pessoa: pessoaNome, valor_centavos: valor, prazo });
  }

  // ---- Cliente: a sobra vira reembolso ou crédito ----
  let credito: ResultadoDoCancelamento['credito'] = null;
  if (sobraCliente > 0) {
    if (pedido.sobra === 'credito') {
      const c = await criarCredito(exec, tenantId, {
        cliente_id: venda.cliente.id, cliente_nome: venda.cliente.nome, origem: 'CANCELAMENTO', valor_centavos: sobraCliente,
        validade: pedido.validade_credito || undefined, descricao: `Cancelamento na venda ${venda.numero}: ${pedido.motivo}`.slice(0, 300),
        origem_venda_id: vendaId, origem_venda_numero: venda.numero, origem_ref: `cancelamento:${cancelamentoId}`,
      }, usuario.nome || usuario.id);
      credito = { id: c.id, valor_centavos: sobraCliente, validade: c.validade };
    } else {
      const r = await criarReembolso(exec, tenantId, {
        tipo: 'CLIENTE', venda_id: vendaId, venda_numero: venda.numero, cancelamento_id: cancelamentoId,
        pessoa_id: venda.cliente.id, pessoa_nome: venda.cliente.nome, valor_centavos: sobraCliente, prazo: pedido.prazo_reembolso,
        centro_custo: venda.centro_custo, vinculado_a: reembolsoFornecedorId,
        descricao: `Cancelamento na venda ${venda.numero}: ${pedido.motivo}`.slice(0, 300),
      }, usuario.nome || usuario.id);
      reembolsos.push({ id: r.id, tipo: 'CLIENTE', pessoa: venda.cliente.nome, valor_centavos: sobraCliente, prazo: pedido.prazo_reembolso });
    }
  }

  // ---- Comissão do vendedor ----
  const { rows: com } = await exec.query(`SELECT id, status, data FROM comissoes WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId])
    .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const comissoes = planoDoEstornoDeComissao(com.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return { id: txt(r.id), status: txt(d.status ?? r.status), valor_comissao: Number(d.valor_comissao) || 0, valor_base: Number(d.valor_base) || 0, vendedor_nome: txt(d.vendedor_nome), origem: txt(d.origem) };
  }), receitaAntes, receitaDepois, pedido.manter_na_meta);
  await aplicarEstornoDeComissao(exec, tenantId, vendaId, venda.numero, cancelamentoId, comissoes, pedido.data);

  // Manter na meta: o que saiu continua contando para a comissão e a meta.
  const totAntes = plano.produtos.reduce((a, p) => a + p.sai_do_cliente_brl, 0);
  const forAntes = plano.produtos.reduce((a, p) => a + p.sai_do_fornecedor_brl, 0);
  if (pedido.manter_na_meta && (totAntes || forAntes)) {
    await exec.query(
      `UPDATE vendas_crm SET data = jsonb_set(data, '{meta_mantida}', jsonb_build_object(
          'valor_final', COALESCE((data->'meta_mantida'->>'valor_final')::numeric, 0) + $3::numeric,
          'valor_total_custo', COALESCE((data->'meta_mantida'->>'valor_total_custo')::numeric, 0) + $4::numeric), true), updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, vendaId, deCentavos(totAntes), deCentavos(forAntes)],
    );
  }
  // Tudo cancelado e sem manter na meta: a venda deixa de contar como venda.
  if (plano.todos_cancelados && !pedido.manter_na_meta) {
    await exec.query(
      `UPDATE vendas_crm SET status = 'CANCELADO', data = data || jsonb_build_object('status', 'CANCELADO', 'cancelada_em', $3::text), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, vendaId, pedido.data],
    );
  }

  const depois = await retratoDasContas(exec, tenantId, vendaId);
  const mudancas = diferencas(antes, depois);
  const assinatura = createHash('sha256').update(JSON.stringify([
    pedido, mudancas.map(m => [m.tabela, m.tipo === 'criada' ? null : m.id, m.tipo, m.antes, m.depois, m.status_depois]),
    reembolsos.map(r => [r.tipo, r.valor_centavos]), credito?.valor_centavos ?? 0, comissoes.map(c => [c.comissao_id, c.acao, c.estorno]),
  ])).digest('hex').slice(0, 32);

  const resultado: ResultadoDoCancelamento = {
    cancelamento_id: cancelamentoId, venda_id: vendaId, venda_numero: venda.numero, data: pedido.data,
    produtos: plano.produtos, reducoes: plano.reducoes, mudancas, reembolsos, credito,
    credito_devolvido_centavos: plano.credito_devolvido_centavos, comissoes,
    receita_antes_centavos: receitaAntes, receita_depois_centavos: receitaDepois,
    todos_cancelados: plano.todos_cancelados, avisos, assinatura,
  };
  await exec.query(
    `INSERT INTO venda_cancelamentos (tenant_id, id, venda_id, data, motivo, pedido, plano, resultado, usuario_id, usuario_nome)
     VALUES ($1,$2,$3,$4::date,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
    [tenantId, cancelamentoId, vendaId, pedido.data, pedido.motivo, JSON.stringify(pedido),
      JSON.stringify({ produtos: plano.produtos, reducoes: plano.reducoes }),
      JSON.stringify(resumoDoResultado(resultado, pedido)), usuario.id, usuario.nome],
  );
  await registrarEventoDaVenda(exec, tenantId, vendaId, 'cancelamento', {
    usuario, motivo: pedido.motivo, detalhe: { cancelamento_id: cancelamentoId, contas: gravacao.contas, ...resumoDoResultado(resultado, pedido) },
  });
  return resultado;
}

function resumoDoResultado(r: ResultadoDoCancelamento, pedido: PedidoDeCancelamento): Record<string, unknown> {
  return {
    data: r.data,
    itens: r.produtos.map(p => ({ produto: p.descricao, produto_inteiro: p.produto_inteiro, passageiros: p.passageiros.map(x => x.nome) })),
    multa_fornecedor_centavos: r.produtos.reduce((a, p) => a + p.multa_fornecedor, 0),
    escolhas: { zerar_fornecedor: pedido.zerar_fornecedor, zerar_cliente: pedido.zerar_cliente, manter_na_meta: pedido.manter_na_meta, sobra: pedido.sobra },
    contas_mudaram: r.mudancas.length,
    reembolsos: r.reembolsos.map(x => ({ id: x.id, tipo: x.tipo, valor_centavos: x.valor_centavos })),
    credito: r.credito,
    credito_devolvido_centavos: r.credito_devolvido_centavos,
    comissao_estornada: round2(r.comissoes.reduce((a, c) => a + c.estorno, 0)),
    receita_antes_centavos: r.receita_antes_centavos,
    receita_depois_centavos: r.receita_depois_centavos,
  };
}

// ============================================================
// Prévia e gravação
// ============================================================

class DesfazerPrevia extends Error {
  resultado: ResultadoDoCancelamento;
  constructor(resultado: ResultadoDoCancelamento) { super('previa'); this.resultado = resultado; }
}

/** Roda o cancelamento inteiro e desfaz: a prévia é a gravação, sem gravar. */
export async function previaDoCancelamento(tenantId: string, vendaId: string, pedido: unknown, usuario: UsuarioDaAcao): Promise<ResultadoDoCancelamento> {
  try {
    await emTransacao(async exec => { throw new DesfazerPrevia(await executarCancelamento(exec, tenantId, vendaId, pedido, usuario)); });
  } catch (e) {
    if (e instanceof DesfazerPrevia) {
      const r = e.resultado;
      // Na prévia nada existe ainda: ids de reembolso e crédito não valem.
      return { ...r, reembolsos: r.reembolsos.map(x => ({ ...x, id: null })), credito: r.credito ? { ...r.credito, id: null } : null, mudancas: r.mudancas.map(m => (m.tipo === 'criada' ? { ...m, id: null } : m)) };
    }
    throw e;
  }
  throw new Error('prévia sem resultado');
}

/** Grava. Com `assinatura`, recusa se o resultado não for o mesmo da prévia. */
export async function gravarCancelamento(tenantId: string, vendaId: string, pedido: unknown, usuario: UsuarioDaAcao, assinatura?: string): Promise<ResultadoDoCancelamento> {
  return emTransacao(async exec => {
    const r = await executarCancelamento(exec, tenantId, vendaId, pedido, usuario);
    if (assinatura && assinatura !== r.assinatura) {
      throw new ErroVenda('MUDOU', 'A venda ou as contas mudaram desde a prévia. Veja a prévia de novo antes de confirmar.', 409);
    }
    return r;
  });
}
