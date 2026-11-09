/**
 * O lado do banco da comissão do mês que vem do CRM (regras em
 * comissao-do-crm.ts; contrato em docs/integracao-crm.md).
 *
 *  - receberComissaoDoMes: o evento COMISSAO_DO_MES (crm-integration.ts) vira
 *    a linha em `comissoes` e a conta a pagar, numa transação, e devolve o
 *    corpo da resposta ao CRM.
 *  - avisarComissaoPaga: chamada pela baixa (baixas-servidor.ts), dentro da
 *    transação dela. A conta de comissão do CRM paga por inteiro põe o
 *    COMISSAO_PAGA na fila de saída para o CRM (crm_eventos_saida), uma vez
 *    só por conta a pagar.
 *  - tarefaComissaoPagaAoCrm: o agendador manda esses avisos ao CRM e repõe
 *    o aviso de conta paga que, por algum caminho, não entrou na fila.
 *  - fonteDaComissao: 'mrr' (padrão, as faixas) ou 'crm' (o extrato do CRM), em
 *    tenants.data; trocarFonteDaComissao grava a escolha.
 *
 * Toda consulta de negócio filtra tenant_id.
 */
import pool from './db';
import { emTransacao, type ExecutorSQL } from './caixa-atomico';
import { idDaContaDaComissao, sincronizarContaDaComissao } from './comissao-conta';
import { exigirEcossistema } from './perfil-da-conta';
import { hojeISO, mesDe } from './money';
import type { ComissaoVenda } from './crm-types';
import { janelaDeMinutos, type DefinicaoTarefa } from './agendador/nucleo';
import {
  ComissaoVemDoCrm, MOTIVO_FONTE_DAS_FAIXAS, PREFIXO_DA_COMISSAO_DO_CRM, TIPO_COMISSAO_PAGA, avisoDeComissaoPaga, decidirVersao,
  detalheDaComissaoDoCrm, fonteDosDados, idDaComissaoDoCrm, idDoAvisoDeComissaoPaga, lerExtratoDoCrm, linhaDaComissaoDoCrm,
  type DecisaoDaVersao, type FonteDaComissao,
} from './comissao-do-crm';

// ============================================================
// A fonte da comissão da conta
// ============================================================

export async function fonteDaComissao(exec: ExecutorSQL, tenantId: string): Promise<FonteDaComissao> {
  const { rows } = await exec.query(`SELECT data FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]);
  return fonteDosDados(rows[0]?.data);
}

/** Grava de onde vem a comissão da conta (só na conta do ecossistema, quem chama confere). */
export async function trocarFonteDaComissao(exec: ExecutorSQL, tenantId: string, fonte: FonteDaComissao): Promise<void> {
  await exec.query(`UPDATE tenants SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('fonte_da_comissao', $2::text) WHERE id = $1`, [tenantId, fonte]);
}

/** Recusa (ComissaoVemDoCrm) a geração por faixas enquanto a comissão vem do CRM. */
export async function exigirComissaoPorFaixas(exec: ExecutorSQL, tenantId: string): Promise<void> {
  if ((await fonteDaComissao(exec, tenantId)) === 'crm') throw new ComissaoVemDoCrm();
}

// ============================================================
// COMISSAO_DO_MES: o extrato que chega
// ============================================================

export type CorpoAceito = { ok: true; situacao: 'criada' | 'atualizada' | 'ja_existia'; comissaoId: string; contaPagarId: string | null };
export type CorpoRecusado = { ok: false; motivo: string };
/** O que a rota do webhook devolve ao CRM: o status HTTP e o corpo. */
export type RespostaDaComissaoDoMes = { status: number; corpo: CorpoAceito | CorpoRecusado };

export const MOTIVO_FORA_DO_ECOSSISTEMA =
  'A comissão do CRM só entra na conta do ecossistema (o financeiro da Entur). Esta conta do financeiro é de agência.';

/** Acha (ou cria) o cadastro da pessoa: em produção, upsertVendedorByExternalId. */
export type ResolverPessoa = (externalId: string, dados: { nome: string; email: string }) => Promise<{ id: string }>;

/**
 * Recebe o extrato do mês de uma pessoa. Recusas (4xx, nada gravado): conta
 * que não é o ecossistema, extrato inválido, versão que mudaria comissão já
 * paga ou aprovada, versão mais antiga que a que vale, total zero sem nada a
 * cancelar. Aceito (200): criada, atualizada ou já existia.
 *
 * Uma prévia sem trava responde recusa e "já existia" sem tocar em cadastro
 * nenhum. Só o extrato que vai ser gravado procura a pessoa (pelo id do CRM,
 * depois pelo e-mail, como as vendas do CRM fazem); a decisão é refeita com a
 * comissão e a conta a pagar travadas, e as duas são gravadas juntas.
 */
export async function receberComissaoDoMes(
  tenantId: string,
  payload: unknown,
  eventId: string,
  opcoes: { pessoa: ResolverPessoa; hoje?: string; agora?: () => string },
): Promise<RespostaDaComissaoDoMes> {
  const exec = pool as unknown as ExecutorSQL;
  const fora = await exigirEcossistema(tenantId, exec);
  if (fora) return { status: fora.status, corpo: { ok: false, motivo: MOTIVO_FORA_DO_ECOSSISTEMA } };
  // Com a comissão saindo das faixas (o padrão), o extrato do CRM pagaria a mesma venda de novo.
  if ((await fonteDaComissao(exec, tenantId)) !== 'crm') return { status: 409, corpo: { ok: false, motivo: MOTIVO_FONTE_DAS_FAIXAS } };

  const hoje = opcoes.hoje ?? hojeISO();
  const lido = lerExtratoDoCrm(payload, { eventId, mesAtual: mesDe(hoje) });
  if (!lido.ok) return { status: 400, corpo: { ok: false, motivo: lido.motivo } };
  const extrato = lido.valor;
  const comissaoId = idDaComissaoDoCrm(extrato.competencia, extrato.usuarioId);
  const contaId = idDaContaDaComissao(comissaoId);

  const lerEstado = async (q: ExecutorSQL, travar: boolean) => {
    const trava = travar ? ' FOR UPDATE' : '';
    const { rows: linhas } = await q.query(
      `SELECT status, data FROM comissoes WHERE id = $1 AND tenant_id = $2${trava}`,
      [comissaoId, tenantId],
    );
    // A aprovação do pagamento mora numa coluna fora do JSON (permissoes-schema.ts).
    const { rows: contas } = await q.query(
      `SELECT COALESCE(NULLIF(cp.status, ''), cp.data->>'status', '') AS status,
              COALESCE(to_jsonb(cp)->>'aprovacao_status', '') AS aprovacao
         FROM contas_pagar cp WHERE cp.id = $1 AND cp.tenant_id = $2${trava}`,
      [contaId, tenantId],
    );
    return {
      atual: linhas[0] ? { status: String(linhas[0].status ?? ''), detalhe: detalheDaComissaoDoCrm(linhas[0].data) } : null,
      conta: contas[0] ? { status: String(contas[0].status ?? ''), aprovacao: String(contas[0].aprovacao ?? '') } : null,
    };
  };
  const semGravar = (decisao: Exclude<DecisaoDaVersao, { acao: 'gravar' }>, temConta: boolean): RespostaDaComissaoDoMes =>
    decisao.acao === 'recusar'
      ? { status: 409, corpo: { ok: false, motivo: decisao.motivo } }
      : { status: 200, corpo: { ok: true, situacao: 'ja_existia', comissaoId, contaPagarId: temConta ? contaId : null } };

  const previa = await lerEstado(exec, false);
  const decisaoPrevia = decidirVersao(previa.atual, previa.conta, extrato);
  if (decisaoPrevia.acao !== 'gravar') return semGravar(decisaoPrevia, !!previa.conta);

  const pessoa = await opcoes.pessoa(`crm_user_${extrato.usuarioId}`, { nome: extrato.beneficiario.nome, email: extrato.beneficiario.email });

  return emTransacao(async tx => {
    // Duas versões do mesmo mês chegando juntas: uma de cada vez.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [tenantId, comissaoId]);
    const { atual, conta } = await lerEstado(tx, true);
    const decisao = decidirVersao(atual, conta, extrato);
    if (decisao.acao !== 'gravar') return semGravar(decisao, !!conta);

    const nova = linhaDaComissaoDoCrm(extrato, {
      vendedorId: pessoa.id,
      recebidoEm: opcoes.agora ? opcoes.agora() : new Date().toISOString(),
      versoesAnteriores: atual?.detalhe?.versoes,
    });
    const { rows: gravadas } = await tx.query(
      `INSERT INTO comissoes (id, tenant_id, venda_id, vendedor_id, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, venda_id = EXCLUDED.venda_id,
         vendedor_id = EXCLUDED.vendedor_id, updated_at = NOW()
       WHERE comissoes.tenant_id = EXCLUDED.tenant_id
       RETURNING id`,
      [nova.id, tenantId, nova.venda_id, nova.vendedor_id, nova.status, JSON.stringify(nova)],
    );
    if (gravadas.length === 0) return { status: 409, corpo: { ok: false, motivo: 'Já existe uma comissão com este id em outra conta do financeiro.' } };

    // A conta a pagar pelo mesmo gancho de toda comissão (comissao-conta.ts):
    // total zero cancela a pendente; a paga nunca é tocada.
    const sinc = await sincronizarContaDaComissao(tenantId, nova as unknown as ComissaoVenda, tx, hoje);
    return {
      status: 200,
      corpo: { ok: true, situacao: atual ? 'atualizada' : 'criada', comissaoId, contaPagarId: sinc.acao === 'nenhuma' ? null : sinc.id },
    };
  });
}

/**
 * A resposta a um COMISSAO_DO_MES repetido (o mesmo eventId, já concluído):
 * o que foi feito da primeira vez, como "já existia".
 */
export async function respostaDaComissaoRepetida(tenantId: string, eventId: string): Promise<RespostaDaComissaoDoMes> {
  const exec = pool as unknown as ExecutorSQL;
  const { rows } = await exec.query(
    `SELECT data->'resposta' AS resposta FROM crm_eventos_entrada WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
    [tenantId, eventId],
  );
  const guardada = rows[0]?.resposta as RespostaDaComissaoDoMes | null | undefined;
  if (guardada?.corpo?.ok === true) return { status: 200, corpo: { ...guardada.corpo, situacao: 'ja_existia' } };
  return {
    status: 409,
    corpo: { ok: false, motivo: 'Este evento chegou antes de o financeiro tratar a comissão do CRM e ficou sem efeito. Mande o extrato de novo com um eventId novo.' },
  };
}

// ============================================================
// COMISSAO_PAGA: o aviso que volta ao CRM
// ============================================================

/**
 * Contas a pagar de comissão do CRM têm id `cp-comissao-comissao-crm-…`.
 * Calculado na hora, nunca no carregamento: db.ts carrega a baixa, que
 * carrega este módulo, antes de comissao-conta.ts terminar de carregar.
 */
const prefixoDaConta = () => idDaContaDaComissao(PREFIXO_DA_COMISSAO_DO_CRM);

/**
 * Põe o COMISSAO_PAGA na fila de saída se a conta é de comissão do CRM e está
 * PAGA (baixa total). Uma vez só por conta: o id do aviso é fixo. A comissão
 * passa a constar como paga. Devolve true quando o aviso entrou agora.
 */
export async function enfileirarComissaoPaga(exec: ExecutorSQL, tenantId: string, contaPagarId: string, agora?: string): Promise<boolean> {
  const { rows } = await exec.query(
    `SELECT COALESCE(NULLIF(cp.status, ''), cp.data->>'status', '') AS status, cp.data AS conta, c.id AS comissao_id, c.data AS comissao
       FROM contas_pagar cp
       JOIN comissoes c ON c.tenant_id = cp.tenant_id AND c.id = cp.data->>'origem_comissao_id'
      WHERE cp.tenant_id = $1 AND cp.id = $2`,
    [tenantId, contaPagarId],
  );
  const r = rows[0];
  if (!r || String(r.status) !== 'PAGO') return false;
  const detalhe = detalheDaComissaoDoCrm(r.comissao);
  if (!detalhe) return false;
  const conta = (r.conta ?? {}) as Record<string, unknown>;
  const aviso = avisoDeComissaoPaga(detalhe, conta);
  const id = idDoAvisoDeComissaoPaga(tenantId, contaPagarId);
  // O mesmo envelope de emitirEventoCRM (crm-integration.ts).
  const corpo = { id, tipo: TIPO_COMISSAO_PAGA, timestamp: agora ?? new Date().toISOString(), versao: 'v1', origem: 'entur-os', payload: aviso };
  const { rows: novos } = await exec.query(
    `INSERT INTO crm_eventos_saida (id, tipo, status, tentativas, data, tenant_id, created_at, updated_at)
     VALUES ($1, $2, 'PENDENTE', 0, $3::jsonb, $4, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [id, TIPO_COMISSAO_PAGA, JSON.stringify(corpo), tenantId],
  );
  await exec.query(
    `UPDATE comissoes
        SET status = 'PAGA', data = data || jsonb_build_object('status', 'PAGA', 'data_pagamento', $3::text), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND status <> 'PAGA'`,
    [String(r.comissao_id), tenantId, aviso.pagoEm || null],
  );
  return novos.length > 0;
}

/**
 * O gancho da baixa: chamado depois que uma conta a pagar foi baixada, na
 * mesma transação. Conta que não é de comissão do CRM sai na hora, sem
 * consulta. Nunca derruba a baixa: um erro aqui fica no log, e o agendador
 * repõe o aviso que faltar (tarefaComissaoPagaAoCrm).
 */
export async function avisarComissaoPaga(exec: ExecutorSQL, tenantId: string, contaPagarId: string): Promise<boolean> {
  if (!tenantId || typeof contaPagarId !== 'string' || !contaPagarId.startsWith(prefixoDaConta())) return false;
  let comPonto = false;
  try { await exec.query('SAVEPOINT comissao_paga_crm'); comPonto = true; } catch { comPonto = false; }
  try {
    const entrou = await enfileirarComissaoPaga(exec, tenantId, contaPagarId);
    if (comPonto) await exec.query('RELEASE SAVEPOINT comissao_paga_crm');
    return entrou;
  } catch (e) {
    if (comPonto) { try { await exec.query('ROLLBACK TO SAVEPOINT comissao_paga_crm'); } catch { /* conexão perdida */ } }
    console.error('[comissao-do-crm] aviso de comissão paga fora da fila:', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Contas de comissão do CRM pagas e sem o aviso na fila (até 100 por vez).
 * Repõe cada uma numa transação (aviso e comissão paga juntos) e devolve quantas.
 */
export async function reporAvisosDeComissaoPaga(
  exec: ExecutorSQL,
  tenantId: string,
  transacao: <T>(fn: (tx: ExecutorSQL) => Promise<T>) => Promise<T> = emTransacao,
): Promise<number> {
  const { rows } = await exec.query(
    `SELECT cp.id FROM contas_pagar cp
      WHERE cp.tenant_id = $1 AND cp.id LIKE $2
        AND COALESCE(NULLIF(cp.status, ''), cp.data->>'status', '') = 'PAGO'
        AND NOT EXISTS (
          SELECT 1 FROM crm_eventos_saida s
           WHERE s.tenant_id = cp.tenant_id AND s.id = 'comissao-paga:' || cp.tenant_id || ':' || cp.id)
      ORDER BY cp.id LIMIT 100`,
    [tenantId, `${prefixoDaConta()}%`],
  );
  let repostos = 0;
  for (const r of rows) if (await transacao(tx => enfileirarComissaoPaga(tx, tenantId, String(r.id)))) repostos++;
  return repostos;
}

/**
 * A cada 5 minutos, nas contas do ecossistema: repõe o aviso que faltar e
 * manda ao CRM os COMISSAO_PAGA da fila (pendentes e falhas com nova
 * tentativa vencida). Os outros eventos pendentes da conta não saem por
 * aqui: seguem esperando o "Disparar pendentes" da integração.
 */
export const tarefaComissaoPagaAoCrm: DefinicaoTarefa = {
  nome: 'comissao-paga-crm',
  janela: janelaDeMinutos(5),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(`SELECT id FROM tenants WHERE data->>'perfil' = 'ecossistema' ORDER BY id`);
    return rows.map(r => String(r.id));
  },
  executar: async ({ exec, emTransacao: transacao }, tenantId) => {
    const repostos = await reporAvisosDeComissaoPaga(exec, tenantId, transacao);
    // Carregado na hora: quem só usa a baixa não arrasta o módulo inteiro do CRM.
    const { enviarEventosDaFila } = await import('./crm-integration');
    const envio = await enviarEventosDaFila(tenantId, TIPO_COMISSAO_PAGA);
    return { repostos, ...envio };
  },
};
