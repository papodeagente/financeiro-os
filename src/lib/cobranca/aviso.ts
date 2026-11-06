/**
 * Aviso do provedor sobre uma cobrança NOSSA → baixa sozinha (05/11/2026).
 *
 * `processarEvento` (plataformas/servico.ts) pergunta aqui antes de tratar o
 * aviso como venda: se a referência começa com `f1;` (ou o id externo é de
 * uma cobrança emitida por nós), o aviso vem para cá e NÃO vira venda
 * direta. Quando não é nosso, devolve null e o caminho das vendas segue
 * exatamente como antes.
 *
 * Efeitos (regra pura em calculo.ts › efeitoDoAviso):
 * - pago → `registrarBaixas` uma vez só (idempotência pelo id do pagamento),
 *   com a taxa (bruto − líquido) e a data do pagamento, na conta da
 *   cobrança (ou da integração);
 * - vencido / alterado / cancelado → só a situação;
 * - estornado → `estornarBaixa` com o motivo "Estornado no <provedor>".
 *
 * Problema de regra na baixa (período fechado já é tratado; conta mexida à
 * mão, por exemplo) não derruba o aviso: fica anotado na cobrança para uma
 * pessoa resolver. Responder erro faria o provedor repetir para sempre.
 */
import pool from '../db';
import type { ExecutorSQL } from '../caixa-atomico';
import { ErroBaixa, estornarBaixa, registrarBaixas } from '../baixas-servidor';
import { dataForaDoFechamento } from '../periodo-fechado';
import { emTransacao } from '../caixa-atomico';
import { garantirCategoriasDeEncargos } from '../encargos-servidor';
import { paraCentavos, round2 } from '../money';
import { em, texto } from '../plataformas/comum';
import type { EventoNormalizado } from '../plataformas/tipos';
import { efeitoDoAviso } from './calculo';
import { dividirPagamento } from './taxa-boleto';
import { avisarPendencia, completarCategoriaDaTaxa, itensDoPagamento } from './pagamento-servidor';
import { avisarCrm } from './crm';
import { lerReferencia, PREFIXO_REFERENCIA } from './referencia';
import {
  capacidadesDe, cobrancaParaCrm, COLUNAS_DA_COBRANCA, hojeEmBrasilia, lerLinha, marcarNaConta, nomeDoProvedor,
  registrarEvento, TAREFA_ATUALIZAR, type LinhaCobranca,
} from './servidor';
import { enfileirarTarefa } from '../agendador/fila';
import { ehProvedorCobranca, type StatusCobranca } from './tipos';

export interface PistasDoAviso {
  /** Valores que podem ser a nossa referência. */
  referencias: string[];
  /** Ids externos que podem ser de uma cobrança nossa. */
  ids: string[];
  /** Id do pagamento no provedor (chave de idempotência da baixa). */
  idPagamento: string;
  /** Parcelamento (carnê) e número da parcela, quando o aviso traz. */
  idCarne: string;
  numeroParcela: number;
  /** Nome do evento no provedor (PAYMENT_UPDATED, charge.paid...). */
  eventoBruto: string;
  /** Quanto foi pago, em centavos, quando o provedor diz (pago a menor/maior). */
  pagoCentavos: number | null;
  formaPaga: 'pix' | 'boleto' | '';
  /** Vencimento e valor que o aviso traz (para "alterada"). */
  vencimento: string;
  valorCentavos: number | null;
}

const limpar = (l: unknown[]) => [...new Set(l.map(v => String(v ?? '').trim()).filter(Boolean))];

/** Tudo o que o aviso traz para achar a cobrança nossa. Puro. */
export function pistasDoAviso(plataforma: string, evento: EventoNormalizado): PistasDoAviso {
  const t = evento.transacao;
  const bruto = t?.bruto;
  const parcela = t?.parcelas?.[0];
  if (plataforma === 'asaas') {
    // Webhook: { event, payment }; importação: a própria cobrança.
    const p = em(bruto, 'payment') ?? (texto(bruto, 'object') === 'payment' || texto(bruto, 'id').startsWith('pay_') ? bruto : {});
    const billing = texto(p, 'billingType').toUpperCase();
    return {
      referencias: limpar([texto(p, 'externalReference'), ...(t?.itens ?? []).map(i => i.id_externo)]),
      ids: limpar([texto(p, 'id'), texto(p, 'paymentLink'), parcela?.id_externo]),
      idPagamento: texto(p, 'id') || parcela?.id_externo || '',
      idCarne: texto(p, 'installment'),
      numeroParcela: Number(em(p, 'installmentNumber') ?? 0) || 0,
      eventoBruto: texto(bruto, 'event'),
      pagoCentavos: em(p, 'value') !== undefined ? paraCentavos(Number(em(p, 'value'))) : null,
      formaPaga: texto(p, 'pixTransaction') || billing === 'PIX' ? 'pix' : billing === 'BOLETO' ? 'boleto' : '',
      vencimento: texto(p, 'dueDate').slice(0, 10),
      valorCentavos: em(p, 'value') !== undefined ? paraCentavos(Number(em(p, 'value'))) : null,
    };
  }
  if (plataforma === 'pagarme') {
    const d = em(bruto, 'data') ?? {};
    const tipo = texto(bruto, 'type');
    const cobrancas = (em(d, 'charges') as unknown[]) ?? [];
    const charge = tipo.startsWith('charge.') ? d : (cobrancas[0] ?? {});
    const metodo = texto(charge, 'payment_method', 'last_transaction.transaction_type').toLowerCase();
    const pago = Number(em(charge, 'paid_amount') ?? 0);
    return {
      referencias: limpar([texto(d, 'code'), texto(d, 'order.code'), ...cobrancas.map(c => texto(c, 'code')), ...(t?.ids_alternativos ?? [])]),
      ids: limpar([texto(d, 'id'), texto(d, 'order.id'), texto(d, 'order_id'), ...cobrancas.map(c => texto(c, 'id')), ...(t?.ids_alternativos ?? [])]),
      idPagamento: texto(charge, 'id'),
      idCarne: '',
      numeroParcela: 0,
      eventoBruto: tipo,
      pagoCentavos: pago > 0 ? Math.round(pago) : null,
      formaPaga: metodo === 'pix' ? 'pix' : metodo === 'boleto' ? 'boleto' : '',
      vencimento: (texto(charge, 'last_transaction.due_at', 'due_at') || '').slice(0, 10),
      valorCentavos: em(charge, 'amount') !== undefined ? Math.round(Number(em(charge, 'amount'))) : null,
    };
  }
  return { referencias: [], ids: [], idPagamento: '', idCarne: '', numeroParcela: 0, eventoBruto: '', pagoCentavos: null, formaPaga: '', vencimento: '', valorCentavos: null };
}

let tabelaExiste = false;

async function temTabela(exec: ExecutorSQL): Promise<boolean> {
  if (tabelaExiste) return true;
  // to_regclass nunca falha: banco sem o esquema da cobrança não envenena a
  // transação do aviso, e o caminho das vendas segue como antes.
  const { rows } = await exec.query(`SELECT to_regclass('public.cobrancas') IS NOT NULL AS ok`);
  tabelaExiste = rows[0]?.ok === true;
  return tabelaExiste;
}

async function acharCobranca(
  exec: ExecutorSQL, tenantId: string, plataforma: string, pistas: PistasDoAviso,
): Promise<{ linha: LinhaCobranca | null; nossa: boolean; outraAgencia: boolean }> {
  const refs = pistas.referencias.map(lerReferencia).filter((r): r is NonNullable<typeof r> => r !== null);
  const nossa = refs.length > 0 || pistas.referencias.some(r => r.startsWith(PREFIXO_REFERENCIA));
  const daAgencia = refs.filter(r => r.tenantId === tenantId);
  if (refs.length && !daAgencia.length) return { linha: null, nossa: true, outraAgencia: true };

  const sel = `SELECT ${COLUNAS_DA_COBRANCA} FROM cobrancas WHERE tenant_id = $1`;
  for (const r of daAgencia) {
    if (r.cobrancaId) {
      const { rows } = await exec.query(`${sel} AND id = $2 FOR UPDATE`, [tenantId, r.cobrancaId]);
      if (rows.length) return { linha: lerLinha(rows[0]), nossa: true, outraAgencia: false };
    }
    if (r.carneId) {
      const { rows } = await exec.query(
        `${sel} AND carne_id = $2 AND (id_externo = ANY($3::text[]) OR carne_parcela = $4) ORDER BY (id_externo = ANY($3::text[])) DESC NULLS LAST LIMIT 1 FOR UPDATE`,
        [tenantId, r.carneId, pistas.ids, pistas.numeroParcela],
      );
      if (rows.length) return { linha: lerLinha(rows[0]), nossa: true, outraAgencia: false };
    }
  }
  if (pistas.ids.length) {
    const { rows } = await exec.query(`${sel} AND provedor = $2 AND id_externo = ANY($3::text[]) ORDER BY criado_em DESC LIMIT 1 FOR UPDATE`,
      [tenantId, plataforma, pistas.ids]);
    if (rows.length) return { linha: lerLinha(rows[0]), nossa: true, outraAgencia: false };
  }
  if (pistas.idCarne && pistas.numeroParcela) {
    const { rows } = await exec.query(`${sel} AND provedor = $2 AND carne_id_externo = $3 AND carne_parcela = $4 LIMIT 1 FOR UPDATE`,
      [tenantId, plataforma, pistas.idCarne, pistas.numeroParcela]);
    if (rows.length) return { linha: lerLinha(rows[0]), nossa: true, outraAgencia: false };
  }
  return { linha: null, nossa, outraAgencia: false };
}

/**
 * A transação importada do provedor é uma cobrança do financeiro? (A
 * importação de histórico pula essas: não são venda.)
 */
export async function transacaoEhDeCobranca(
  exec: ExecutorSQL, tenantId: string, plataforma: string, transacao: EventoNormalizado['transacao'],
): Promise<boolean> {
  if (!ehProvedorCobranca(plataforma)) return false;
  const pistas = pistasDoAviso(plataforma, { tipo: 'PAGAMENTO_CRIADO', id_externo: '', transacao, parcela_afetada: 0 });
  if (pistas.referencias.some(r => r.startsWith(PREFIXO_REFERENCIA))) return true;
  if (!pistas.ids.length || !(await temTabela(exec))) return false;
  const { rows } = await exec.query(
    `SELECT 1 FROM cobrancas WHERE tenant_id = $1 AND provedor = $2 AND (id_externo = ANY($3::text[]) OR carne_id_externo = NULLIF($4, '')) LIMIT 1`,
    [tenantId, plataforma, pistas.ids, pistas.idCarne],
  );
  return rows.length > 0;
}

export interface ResultadoDoDesvio {
  acao: string;
  cobranca_id: string | null;
  status?: StatusCobranca;
  baixa_id?: string | null;
  /** Avisos ao CRM e categorias de encargos: depois do COMMIT do aviso. */
  depois?: () => Promise<void>;
}

/**
 * O aviso é de uma cobrança nossa? Se for, aplica e devolve o resultado;
 * se não for, devolve null (o caminho das vendas segue intocado).
 */
export async function desviarAvisoDeCobranca(
  exec: ExecutorSQL,
  tenantId: string,
  plataforma: string,
  evento: EventoNormalizado,
  opcoes: { contaBancariaId: string | null; hoje?: string },
): Promise<ResultadoDoDesvio | null> {
  if (!ehProvedorCobranca(plataforma)) return null;
  if (!(await temTabela(exec))) return null;
  const pistas = pistasDoAviso(plataforma, evento);
  const achado = await acharCobranca(exec, tenantId, plataforma, pistas);
  if (achado.outraAgencia) return { acao: 'cobrança de outra agência: ignorado', cobranca_id: null };
  if (!achado.linha) {
    // Referência nossa sem cobrança aqui (apagada, reset da conta): não vira venda.
    return achado.nossa ? { acao: 'cobrança do financeiro não encontrada: nada lançado', cobranca_id: null } : null;
  }
  return aplicarAviso(exec, tenantId, achado.linha, evento, pistas, opcoes);
}

async function aplicarAviso(
  exec: ExecutorSQL,
  tenantId: string,
  c: LinhaCobranca,
  evento: EventoNormalizado,
  pistas: PistasDoAviso,
  opcoes: { contaBancariaId: string | null; hoje?: string },
): Promise<ResultadoDoDesvio> {
  const hoje = opcoes.hoje ?? hojeEmBrasilia();
  const caps = capacidadesDe(c.provedor);
  const nome = nomeDoProvedor(c.provedor);
  const parcela = evento.transacao?.parcelas?.[0];
  const efeito = efeitoDoAviso(c.status, evento.tipo, caps, {
    // Pendência já resolvida por uma pessoa (crédito, "resolvida"): o aviso repetido não baixa de novo.
    jaBaixada: Boolean(c.baixa_id) || Boolean(c.dados?.pendencia_resolvida),
    estornoParcial: pistas.eventoBruto === 'PAYMENT_PARTIALLY_REFUNDED',
    vencimentoNoAviso: pistas.vencimento,
    hoje,
  });
  const quem = { usuarioNome: `Aviso do ${nome}` };
  const detalhe: Record<string, unknown> = { evento: pistas.eventoBruto, id_evento: evento.id_externo };
  const dados: Record<string, unknown> = {};
  let baixaId: string | null = c.baixa_id;
  let pagoCentavos: number | null = c.pago_centavos;
  let taxaCentavos: number | null = c.taxa_centavos;
  let pagoEm: string | null = c.pago_em;
  let pendencia: string | null = null;
  let novaBaixa = false;
  let contaDaTaxaNova = false;
  let valorCentavos = c.valor_centavos;
  let vencimento = c.vencimento;

  if (pistas.idPagamento && c.tipo === 'link') dados.pagamento_id = pistas.idPagamento;
  if (pistas.formaPaga && (efeito.baixar || efeito.aguardandoCredito || efeito.status === 'paga')) dados.forma_paga = pistas.formaPaga;
  if (efeito.aguardandoCredito) {
    // Pago, crédito por vir: já registra quanto e quando o cliente pagou.
    dados.aguardando_credito = true;
    pagoCentavos = pistas.pagoCentavos ?? c.valor_centavos;
    pagoEm = (parcela?.data_pagamento || hoje).slice(0, 10);
  }

  if (efeito.baixar) {
    const bruto = pistas.pagoCentavos ?? paraCentavos(Number(parcela?.valor_bruto ?? 0)) ?? c.valor_centavos;
    const valor = round2((bruto || c.valor_centavos) / 100);
    const taxa = round2(Math.max(0, Number(parcela?.valor_taxa ?? 0)));
    const juros = round2(Math.max(0, Number(parcela?.juros ?? 0)));
    const desconto = round2(Math.max(0, Number(parcela?.desconto ?? 0)));
    const dataPedida = (parcela?.data_pagamento || parcela?.data_recebimento || hoje).slice(0, 10);
    const conta = c.conta_bancaria_id || opcoes.contaBancariaId || null;
    const data = await dataForaDoFechamento(exec, tenantId, conta, dataPedida);
    const forma = pistas.formaPaga === 'pix' ? 'Pix' : 'Boleto';
    // Taxa de boleto repassada ao cliente (E7): a parte dela vai para a conta própria da taxa.
    const divisao = dividirPagamento(paraCentavos(valor), c.valor_centavos, Number(c.dados?.taxa_boleto_centavos ?? 0));
    await exec.query('SAVEPOINT cobranca_baixa');
    try {
      const itens = await itensDoPagamento(exec, tenantId, c, {
        contaCentavos: divisao.conta, taxaBoletoCentavos: divisao.taxa, taxaProvedorCentavos: paraCentavos(taxa),
        juros, desconto, data, conta_bancaria_id: conta, forma,
      });
      const r = await registrarBaixas(exec, {
        tenantId, usuarioNome: `Aviso do ${nome}`, origem: 'plataforma',
        idempotencia: `cobranca:${c.provedor}:${pistas.idPagamento || c.id_externo || c.id}`,
      }, itens, { gravar: true });
      await exec.query('RELEASE SAVEPOINT cobranca_baixa');
      baixaId = r.itens[0]?.baixa_id ?? null;
      novaBaixa = !r.itens[0]?.ja_existia;
      contaDaTaxaNova = divisao.taxa > 0 && !r.itens[1]?.ja_existia;
      pagoCentavos = paraCentavos(valor);
      taxaCentavos = paraCentavos(taxa);
      pagoEm = data;
      detalhe.baixa_id = baixaId;
      detalhe.valor = valor;
      detalhe.taxa = taxa;
      detalhe.data = data;
      if (divisao.taxa > 0) detalhe.taxa_boleto = round2(divisao.taxa / 100);
      dados.aguardando_credito = false;
      // A baixa entrou agora (o aviso repetido depois de alguém arrumar a conta): a pendência some.
      if (c.dados?.pendencia) { dados.pendencia = null; dados.pendencia_tipo = null; }
    } catch (e) {
      await exec.query('ROLLBACK TO SAVEPOINT cobranca_baixa');
      if (!(e instanceof ErroBaixa)) throw e;
      pendencia = `O ${nome} avisou o pagamento, mas a baixa não entrou: ${e.message} Dê a baixa à mão.`;
      // O pagamento fica guardado para a pessoa resolver com um clique (pendencia.ts).
      dados.pendencia_tipo = 'pagamento';
      dados.pendencia_pagamento = {
        valor_centavos: paraCentavos(valor), taxa_centavos: paraCentavos(taxa), juros, desconto, data: dataPedida,
        conta_bancaria_id: conta, forma, id_pagamento: pistas.idPagamento,
      };
      pagoCentavos = paraCentavos(valor);
      taxaCentavos = paraCentavos(taxa);
      pagoEm = dataPedida;
    }
  }

  if (efeito.estornar && c.baixa_id) {
    await exec.query('SAVEPOINT cobranca_estorno');
    try {
      await estornarBaixa(exec, { tenantId, usuarioNome: `Aviso do ${nome}` }, c.baixa_id, { motivo: `Estornado no ${nome}`, data: hoje });
      await exec.query('RELEASE SAVEPOINT cobranca_estorno');
      detalhe.estornou_baixa = c.baixa_id;
    } catch (e) {
      await exec.query('ROLLBACK TO SAVEPOINT cobranca_estorno');
      if (!(e instanceof ErroBaixa) && !/PERIODO_FECHADO|período/i.test(e instanceof Error ? e.message : '')) throw e;
      pendencia = `O ${nome} avisou o estorno, mas a baixa não pôde ser desfeita: ${e instanceof Error ? e.message : e} Estorne a baixa à mão.`;
      dados.pendencia_tipo = 'estorno';
    }
  }
  if (pistas.eventoBruto === 'PAYMENT_PARTIALLY_REFUNDED') {
    pendencia = `O ${nome} avisou uma devolução PARCIAL. Confira o valor devolvido e lance o ajuste.`;
    dados.pendencia_tipo = 'devolucao_parcial';
  }

  // "Alterada" no provedor: valor e vencimento do aviso; linha e QR mudam, a fila busca de novo.
  let buscarDeNovo = false;
  // (Link: o pagamento gerado pelo link tem vencimento e valor próprios; o link não muda.)
  if (evento.tipo === 'PAGAMENTO_CRIADO' && c.tipo !== 'link' && (c.status === 'aberta' || c.status === 'vencida')) {
    if (pistas.vencimento && pistas.vencimento !== c.vencimento) { vencimento = pistas.vencimento; buscarDeNovo = true; }
    if (pistas.valorCentavos && pistas.valorCentavos !== c.valor_centavos) { valorCentavos = pistas.valorCentavos; buscarDeNovo = true; }
    if (buscarDeNovo) detalhe.alterada = { valor_centavos: valorCentavos, vencimento };
  }
  const pendenciaNova = Boolean(pendencia) && pendencia !== c.dados?.pendencia;
  if (pendencia) {
    dados.pendencia = pendencia;
    detalhe.pendencia = pendencia;
    if (pendenciaNova) dados.pendencia_em = new Date().toISOString();
  }

  const { rows } = await exec.query(
    `UPDATE cobrancas SET status = $3, baixa_id = $4, pago_centavos = $5, taxa_centavos = $6, pago_em = $7::date,
            valor_centavos = $8, vencimento = $9::date, dados = dados || $10::jsonb,
            id_externo = COALESCE(id_externo, NULLIF($11, '')), atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUNAS_DA_COBRANCA}`,
    [tenantId, c.id, efeito.status, efeito.estornar && detalhe.estornou_baixa ? null : baixaId, pagoCentavos, taxaCentavos, pagoEm,
      valorCentavos, vencimento, JSON.stringify(dados), c.tipo === 'link' ? '' : pistas.idPagamento],
  );
  const nova = lerLinha(rows[0]);
  await registrarEvento(exec, tenantId, c.id, efeito.evento, c.status, nova.status, detalhe, quem);
  await marcarNaConta(exec, nova);
  if (buscarDeNovo) {
    await enfileirarTarefa(exec, { tenantId, tipo: TAREFA_ATUALIZAR, chaveIdem: `${c.id}:${evento.id_externo}`, dados: { cobranca_id: c.id } });
  }

  const ficouPaga = nova.status === 'paga' && c.status !== 'paga';
  const comTaxa = (novaBaixa && (taxaCentavos ?? 0) > 0) || contaDaTaxaNova;
  const depois = ficouPaga || comTaxa || pendenciaNova
    ? async () => {
        if (comTaxa) {
          await emTransacao(tx => garantirCategoriasDeEncargos(tx, tenantId))
            .catch(e => console.error('[cobranca] categorias dos encargos:', e instanceof Error ? e.message : e));
        }
        if (contaDaTaxaNova) {
          await completarCategoriaDaTaxa(tenantId, c.id)
            .catch(e => console.error('[cobranca] categoria da taxa de boleto:', e instanceof Error ? e.message : e));
        }
        if (ficouPaga) {
          if (pool) await avisarCrm(pool as unknown as ExecutorSQL, tenantId, 'COBRANCA_PAGA', cobrancaParaCrm(nova), `cobranca-paga:${tenantId}:${nova.id}`);
        }
        // Aviso no sino fora da transação do aviso: falhar aqui nunca desfaz a baixa.
        if (pendenciaNova && pendencia) {
          await avisarPendencia(tenantId, nova, pendencia, efeito.evento)
            .catch(e => console.error('[cobranca] aviso da pendência:', e instanceof Error ? e.message : e));
        }
      }
    : undefined;

  return {
    acao: `cobrança ${c.id}: ${efeito.evento}${novaBaixa ? `, baixa de R$ ${((pagoCentavos ?? 0) / 100).toFixed(2)}` : ''}${pendencia ? ' (pendência anotada)' : ''}`,
    cobranca_id: c.id,
    status: nova.status,
    baixa_id: nova.baixa_id,
    depois,
  };
}
