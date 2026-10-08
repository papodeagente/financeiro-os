/**
 * O pagamento da plataforma que a venda do CRM diz ser dela.
 *
 * POR QUE EXISTE. O CRM gera o link de pagamento (Hotmart, Asaas, Pagar.me)
 * dentro da negociação, e sabe o id da transação. Sem esse id, o financeiro
 * só podia adivinhar pelo CPF, e-mail, valor e data, e o pagamento que
 * chegava antes da venda virava "venda direta" ou ficava esperando alguém
 * conferir. Com ele, o vínculo é PROVA: a venda e o pagamento se juntam pelo
 * mesmo caminho do vínculo feito na tela (`vincularNaTransacao`), e a
 * unificação faz o pagamento consumir as contas a receber da venda uma vez só.
 *
 * As duas ordens funcionam:
 *   - pagamento ANTES da venda: a venda fechada procura a transação já
 *     importada e sem dono, e vincula (aqui);
 *   - pagamento DEPOIS da venda: a transação nova acha a venda pelo id
 *     gravado nela (`candidatosDoCrm`, pontuação de prova).
 *
 * O carimbo feito à mão no financeiro vence o que o CRM informar depois. Se
 * os dois discordam, nada é vinculado e o conflito fica escrito no evento:
 * decidir entre a pessoa e o CRM é trabalho de gente.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { vincularNaTransacao } from './plataformas/fila';
import { unificarRecebimento } from './plataformas/unificar-db';
import { acharAdapter } from './plataformas';
import { candidatosDoCrm } from './plataformas/servico';
import { decidir, type PagamentoParaConciliar } from './plataformas/conciliacao';
import type { TransacaoNormalizada } from './plataformas/tipos';
import { addDias, num, round2 } from './money';

const txt = (v: unknown): string =>
  (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();

/** 'Hotmart', 'pagar.me', 'Pagar.me ' viram 'hotmart', 'pagarme'. */
export function normalizarPlataforma(v: unknown): string {
  return txt(v).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface PlataformaDaVendaCRM {
  plataforma: string;
  /** A transação principal, como a plataforma a informa. */
  transacao: string;
  /** Todas as transações conhecidas desta venda (inclui a principal). */
  transacoes: string[];
}

export function lerPlataformaDoPayload(p: Record<string, unknown>): PlataformaDaVendaCRM {
  const transacao = txt(p.plataforma_transacao);
  const lista = Array.isArray(p.plataforma_transacoes) ? p.plataforma_transacoes.map(txt) : [];
  const transacoes = [...new Set([transacao, ...lista].filter(Boolean))].slice(0, 50);
  return { plataforma: normalizarPlataforma(p.plataforma_origem), transacao, transacoes };
}

export interface CarimboDaVenda {
  /** O carimbo efetivo, lido pela conciliação. */
  plataforma_origem: string;
  plataforma_transacao: string;
  plataforma_transacoes: string[];
  /** O que o CRM disse por último, para saber de quem é o carimbo. */
  crm_plataforma_origem: string;
  crm_plataforma_transacao: string;
  /** As transações que este evento pede para vincular. Vazio no conflito. */
  vincular: string[];
  conflito: string;
}

/**
 * Decide o carimbo da venda a partir do que ela já tinha e do que o CRM
 * mandou agora. Função pura.
 *
 * O carimbo é "do CRM" quando é igual ao último que o CRM mandou; qualquer
 * outro foi feito à mão (vínculo na tela) e vence. Vazio nunca apaga.
 */
export function decidirCarimbo(
  anterior: Record<string, unknown> | null,
  crm: PlataformaDaVendaCRM,
): CarimboDaVenda {
  const a = anterior ?? {};
  const carimbo = txt(a.plataforma_transacao);
  const origem = txt(a.plataforma_origem);
  const doCrmAntes = txt(a.crm_plataforma_transacao);
  const listaAntes = Array.isArray(a.plataforma_transacoes) ? a.plataforma_transacoes.map(txt).filter(Boolean) : [];

  if (crm.transacoes.length === 0) {
    // Payload sem plataforma (contrato antigo, ou o CRM não sabe): tudo fica
    // como estava. Vazio nunca apaga.
    return {
      plataforma_origem: origem || crm.plataforma,
      plataforma_transacao: carimbo,
      plataforma_transacoes: listaAntes,
      crm_plataforma_origem: crm.plataforma || txt(a.crm_plataforma_origem),
      crm_plataforma_transacao: doCrmAntes,
      vincular: [],
      conflito: '',
    };
  }

  const principal = crm.transacao || crm.transacoes[0];
  const manual = carimbo !== '' && carimbo !== doCrmAntes;
  const base = {
    plataforma_transacoes: crm.transacoes,
    crm_plataforma_origem: crm.plataforma,
    crm_plataforma_transacao: principal,
  };

  if (manual && !crm.transacoes.includes(carimbo)) {
    return {
      ...base,
      plataforma_origem: origem,
      plataforma_transacao: carimbo,
      vincular: [],
      conflito: `a venda já aponta para a transação ${carimbo} (vínculo feito no financeiro) e o CRM informou ${crm.transacoes.join(', ')}: nada foi vinculado, confira na fila de recebimentos`,
    };
  }

  const fica = manual ? carimbo : principal;
  return {
    ...base,
    plataforma_origem: manual ? (origem || crm.plataforma) : (crm.plataforma || origem),
    plataforma_transacao: fica,
    vincular: crm.transacoes,
    conflito: '',
  };
}

export interface ResultadoPagamentosDaVenda {
  vinculadas: string[];
  ja_vinculadas: string[];
  /** Transações que o CRM informou e ainda não chegaram: ligam quando chegarem. */
  aguardando: string[];
  conflitos: string[];
  /** Vínculos antigos refeitos sobre as contas que a venda acabou de regerar. */
  reunificadas: number;
}

/**
 * Vincula à venda as transações que o CRM informou e que já estão aqui sem
 * dono, e refaz a unificação dos vínculos que a venda já tinha.
 *
 * O refazer importa porque a venda fechada REGERA as contas a receber dela a
 * cada reentrega: as contas que o pagamento tinha consumido voltam como novas
 * e, sem refazer, a mesma viagem apareceria duas vezes (a conta do CRM e a da
 * plataforma). A unificação é idempotente: refazer sobre contas já consumidas
 * não consome nada.
 *
 * O id informado pelo CRM é prova, não palpite: vincula mesmo com a
 * conciliação automática desligada. Nenhum caixa se move aqui.
 */
export async function vincularPagamentosDaVendaCRM(
  exec: ExecutorSQL,
  tenantId: string,
  vendaId: string,
  pedido: { plataforma: string; transacoes: string[] },
): Promise<ResultadoPagamentosDaVenda> {
  const saida: ResultadoPagamentosDaVenda = { vinculadas: [], ja_vinculadas: [], aguardando: [], conflitos: [], reunificadas: 0 };
  const ids = [...new Set(pedido.transacoes.map(txt).filter(Boolean))];
  // Plataforma que existe aqui filtra a busca; nome desconhecido não filtra.
  const plataforma = acharAdapter(pedido.plataforma) ? pedido.plataforma : '';

  if (ids.length > 0) {
    // O CRM pode guardar qualquer um dos ids da venda: o link de pagamento
    // (pl_...), o pedido (or_...) ou a cobrança (ch_...). A transação daqui
    // é achada por qualquer um deles.
    const { rows } = await exec.query(
      `SELECT plataforma, id_transacao, venda_id, status_conciliacao,
              COALESCE(data->'transacao'->'ids_alternativos', '[]'::jsonb) AS ids
         FROM plataformas_transacoes
        WHERE tenant_id = $1 AND status_conciliacao <> 'ABSORVIDA'
          AND (id_transacao = ANY($2::text[])
               OR COALESCE(data->'transacao'->'ids_alternativos', '[]'::jsonb) ?| $2::text[])
          AND ($3::text = '' OR plataforma = $3::text)
        ORDER BY id_transacao, plataforma
        FOR UPDATE`,
      [tenantId, ids, plataforma],
    );
    const tratadas = new Set<string>();
    for (const id of ids) {
      const linhas = rows.filter(r => String(r.id_transacao) === id
        || (Array.isArray(r.ids) && r.ids.map(String).includes(id)));
      if (linhas.length === 0) { saida.aguardando.push(id); continue; }
      if (linhas.length > 1) {
        saida.conflitos.push(`a transação ${id} existe em mais de uma plataforma (${linhas.map(r => r.plataforma).join(', ')}): informe a plataforma`);
        continue;
      }
      const t = linhas[0];
      const chave = `${t.plataforma}|${t.id_transacao}`;
      // Dois ids da mesma venda (link e pedido) apontam para a mesma linha.
      if (tratadas.has(chave)) continue;
      tratadas.add(chave);
      const dono = String(t.venda_id ?? '');
      const idAqui = String(t.id_transacao);
      if (dono === vendaId) { saida.ja_vinculadas.push(idAqui); continue; }
      if (dono) {
        saida.conflitos.push(`a transação ${idAqui} já está vinculada à venda ${dono}: nada mudou`);
        continue;
      }
      await vincularNaTransacao(exec, tenantId, String(t.plataforma), idAqui, vendaId, { manterCarimbo: true });
      saida.vinculadas.push(idAqui);
    }
  }

  const { rows: ligadas } = await exec.query(
    `SELECT plataforma, id_transacao FROM plataformas_transacoes
      WHERE tenant_id = $1 AND venda_id = $2 AND status_conciliacao = 'VINCULADA'
      ORDER BY created_at ASC, id ASC`,
    [tenantId, vendaId],
  );
  for (const t of ligadas) {
    const id = String(t.id_transacao);
    if (saida.vinculadas.includes(id)) continue;
    await unificarRecebimento(exec, tenantId, { vendaId, plataforma: String(t.plataforma), idTransacao: id });
    saida.reunificadas++;
  }
  return saida;
}

/** A frase do evento sobre o pagamento. Vazia quando não houve nada a dizer. */
export function descreverPagamentos(r: ResultadoPagamentosDaVenda, conflitoDoCarimbo: string): string {
  const partes: string[] = [];
  if (r.vinculadas.length > 0) partes.push(`pagamento vinculado pela transação informada pelo CRM (${r.vinculadas.join(', ')})`);
  if (r.ja_vinculadas.length > 0) partes.push(`já vinculada: ${r.ja_vinculadas.join(', ')}`);
  if (r.aguardando.length > 0) partes.push(`transação ainda não importada, vincula quando chegar: ${r.aguardando.join(', ')}`);
  if (r.reunificadas > 0) partes.push(`${r.reunificadas} vínculo(s) refeito(s) sobre as contas regeradas`);
  if (conflitoDoCarimbo) partes.push(`conflito: ${conflitoDoCarimbo}`);
  for (const c of r.conflitos) partes.push(`conflito: ${c}`);
  return partes.join('; ');
}

export interface ResultadoReconciliacao {
  vinculadas: string[];
  sugeridas: string[];
}

/** Janela, em dias, em volta da data da venda. A mesma da conciliação. */
const JANELA_DIAS = 45;

/**
 * A venda do CRM que chegou DEPOIS do pagamento procura o pagamento.
 *
 * Sem o id da transação no payload, o pagamento que chegou antes caía em
 * "venda direta" e ninguém o reabria (Bruna Moura, Pagar.me, 08/10/2026: o
 * pagamento às 12h05 e a venda ganha no CRM logo depois, cada um de um
 * lado). Aqui a venda nova repassa os pagamentos sem dono da janela pela
 * MESMA decisão da conciliação (`decidir`):
 *
 *   - prova (o id da venda é um dos ids da transação): vincula;
 *   - confiança alta (exige CPF/CNPJ ou e-mail em comum, e na prática o
 *     documento) com a opção automática ligada: vincula;
 *   - parecido, sem prova suficiente: vira sugestão na fila de recebimentos.
 *
 * "Venda direta" marcada por uma pessoa não é reaberta. A que o robô marcou
 * só quer dizer "ninguém parecido na hora": é exatamente o caso de quem
 * chega depois, e segue a mesma régua.
 */
export async function reconciliarPagamentosSemDono(
  exec: ExecutorSQL,
  tenantId: string,
  vendaId: string,
): Promise<ResultadoReconciliacao> {
  const saida: ResultadoReconciliacao = { vinculadas: [], sugeridas: [] };
  const { rows: vr } = await exec.query(
    `SELECT COALESCE(NULLIF(data->>'data_venda', ''), to_char(created_at, 'YYYY-MM-DD')) AS data_venda, status
       FROM vendas_crm WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [vendaId, tenantId],
  );
  if (vr.length === 0 || String(vr[0].status ?? '') === 'CANCELADO') return saida;
  const dataVenda = String(vr[0].data_venda ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataVenda)) return saida;

  const { rows: txs } = await exec.query(
    `SELECT t.plataforma, t.id_transacao, t.status_conciliacao, t.data,
            COALESCE(c.data->>'conciliacao_automatica', 'false') = 'true' AS automatica
       FROM plataformas_transacoes t
       LEFT JOIN plataformas_config c ON c.tenant_id = t.tenant_id AND c.plataforma = t.plataforma
      WHERE t.tenant_id = $1
        AND COALESCE(t.venda_id, '') = ''
        AND t.status_conciliacao IN ('PENDENTE', 'SUGERIDA', 'DIRETA')
        AND COALESCE(t.data->>'direta_por_pessoa', 'false') <> 'true'
        AND COALESCE(NULLIF(t.data->'transacao'->>'data_venda', ''), to_char(t.created_at, 'YYYY-MM-DD'))
            BETWEEN $2 AND $3
      ORDER BY t.created_at DESC
      LIMIT 200
      FOR UPDATE OF t`,
    [tenantId, addDias(dataVenda, -JANELA_DIAS), addDias(dataVenda, JANELA_DIAS)],
  );

  for (const t of txs) {
    const transacao = ((t.data ?? {}) as Record<string, unknown>).transacao as TransacaoNormalizada | undefined;
    if (!transacao) continue;
    const idTransacao = String(t.id_transacao);
    const dataPagamento = transacao.parcelas?.find(p => p.data_pagamento)?.data_pagamento
      || transacao.data_venda || dataVenda;
    const pagamento: PagamentoParaConciliar = {
      id_transacao: idTransacao,
      ids: transacao.ids_alternativos,
      documento: transacao.comprador?.documento ?? '',
      email: transacao.comprador?.email ?? '',
      telefone: transacao.comprador?.telefone ?? '',
      valor: round2(num(transacao.valor_bruto)),
      data: dataPagamento,
    };
    const candidatos = await candidatosDoCrm(exec, tenantId, { ...transacao, id_transacao: idTransacao }, dataPagamento);
    const decisao = decidir(pagamento, candidatos, { vincularAutomatico: t.automatica === true });
    // Só mexe se ESTA venda é uma candidata de verdade: o pagamento pode
    // ser de outra venda, e aí a conversa é dela.
    if (!decisao.candidatas.some(c => c.venda_id === vendaId)) continue;

    if (decisao.acao === 'VINCULAR' && decisao.escolhida?.venda_id === vendaId) {
      await vincularNaTransacao(exec, tenantId, String(t.plataforma), idTransacao, vendaId, { manterCarimbo: true });
      saida.vinculadas.push(idTransacao);
      continue;
    }
    if (decisao.acao !== 'VENDA_DIRETA') {
      await exec.query(
        `UPDATE plataformas_transacoes
            SET status_conciliacao = 'SUGERIDA',
                data = data || jsonb_build_object('conciliacao', $4::jsonb),
                updated_at = NOW()
          WHERE tenant_id = $1 AND plataforma = $2 AND id_transacao = $3`,
        [tenantId, String(t.plataforma), idTransacao, JSON.stringify(decisao)],
      );
      saida.sugeridas.push(idTransacao);
    }
  }
  return saida;
}

/** A frase do evento sobre a procura. Vazia quando não achou nada. */
export function descreverReconciliacao(r: ResultadoReconciliacao): string {
  const partes: string[] = [];
  if (r.vinculadas.length > 0) partes.push(`pagamento que tinha chegado antes vinculado (${r.vinculadas.join(', ')})`);
  if (r.sugeridas.length > 0) partes.push(`pagamento parecido sugerido na fila de recebimentos (${r.sugeridas.join(', ')})`);
  return partes.join('; ');
}
