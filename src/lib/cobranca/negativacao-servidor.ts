/**
 * Negativação (Serasa) de cobrança vencida, no servidor (E7, 06/11/2026).
 *
 * Caminho, sempre pela pessoa (nunca automático):
 *   1. prévia: a cobrança precisa ser do Asaas e estar vencida; o provedor
 *      simula (pode? taxa? quando começa?) e o cadastro do cliente é
 *      conferido; sai uma assinatura dos números mostrados;
 *   2. pedir com a assinatura: se algo mudou (valor, cadastro, taxa), a
 *      assinatura não bate e a pessoa vê a prévia nova;
 *   3. a negativação fica em `cobrancas.dados.negativacao` e cada passo vira
 *      evento da cobrança (histórico). Atualizar consulta o provedor;
 *      cancelar só quando o provedor diz que pode.
 *
 * Uma negativação viva por cobrança: o pedido "reserva" a vaga numa gravação
 * curta (status PEDINDO) antes de falar com o provedor, para o duplo clique
 * não pedir duas vezes. Timeout: antes de liberar a vaga, pergunta ao
 * provedor se a negativação nasceu (o Asaas não tem chave de idempotência).
 * "Nada sai" (mudança de sistema) segura o pedido.
 */
import { createHash } from 'node:crypto';
import pool from '../db';
import { emTransacao, type ExecutorSQL } from '../caixa-atomico';
import { nadaSai } from '../nada-sai';
import { mudancaSegurandoSaidas } from '../migracao/estado';
import { lerConfigCobranca } from './config';
import { devedorDoCliente, faltasParaNegativar, negativacaoViva, recusaDaCobranca, rotuloDaNegativacao } from './negativacao';
import {
  adapterDaAgencia, capacidadesDe, carregarCobranca, clienteDaConta, COLUNAS_DA_COBRANCA, lerLinha,
  nomeDoProvedor, registrarEvento, type LinhaCobranca, type QuemFez,
} from './servidor';
import {
  ErroCobranca, ErroProvedor,
  type DevedorDaNegativacao, type NegativacaoNoProvedor, type SimulacaoDeNegativacao,
} from './tipos';

/** O que fica gravado na cobrança. */
export interface NegativacaoGravada {
  id: string;
  numero: string;
  status: string;
  taxa_centavos: number;
  pode_cancelar: boolean;
  motivo_recusa: string;
  reenviar_documentos: boolean;
  pedida_em: string;
  pedida_por: string;
  atualizada_em: string;
}

export interface PreviaDaNegativacao {
  cobranca_id: string;
  provedor: string;
  valor_centavos: number;
  vencimento: string;
  /** Pode pedir agora? Senão, `motivos` diz por quê. */
  pode: boolean;
  motivos: string[];
  faltas: string[];
  devedor: DevedorDaNegativacao | null;
  simulacao: SimulacaoDeNegativacao | null;
  atual: NegativacaoGravada | null;
  atual_rotulo: string;
  assinatura: string;
}

function assinar(partes: unknown): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex').slice(0, 24);
}

function gravadaDe(c: LinhaCobranca): NegativacaoGravada | null {
  const n = c.dados?.negativacao as NegativacaoGravada | undefined;
  return n && typeof n === 'object' && n.status ? n : null;
}

async function motivoDeNadaSai(exec: ExecutorSQL, tenantId: string): Promise<string | null> {
  return nadaSai() ?? (await mudancaSegurandoSaidas(exec, tenantId));
}

async function devedorDaCobranca(exec: ExecutorSQL, tenantId: string, c: LinhaCobranca): Promise<DevedorDaNegativacao> {
  const { rows } = await exec.query(`SELECT data->>'cliente_nome' AS nome FROM contas_receber WHERE tenant_id = $1 AND id = $2`, [tenantId, c.titulo_id]);
  return devedorDoCliente(await clienteDaConta(exec, tenantId, c.cliente_id ?? '', String(rows[0]?.nome ?? '')));
}

export async function previaDaNegativacao(exec: ExecutorSQL, tenantId: string, cobrancaId: string): Promise<PreviaDaNegativacao> {
  const c = await carregarCobranca(exec, tenantId, cobrancaId);
  if (!c) throw new ErroCobranca('Cobrança não encontrada.', 404);
  const atual = gravadaDe(c);
  const base = {
    cobranca_id: c.id, provedor: c.provedor, valor_centavos: c.valor_centavos, vencimento: c.vencimento,
    atual, atual_rotulo: rotuloDaNegativacao(atual?.status),
  };
  const motivos: string[] = [];
  const recusa = recusaDaCobranca(c, capacidadesDe(c.provedor).negativacao === true);
  if (recusa) motivos.push(recusa);
  if (atual && negativacaoViva(atual.status)) motivos.push(`Esta cobrança já tem negativação: ${rotuloDaNegativacao(atual.status).toLowerCase()}.`);
  const nada = await motivoDeNadaSai(exec, tenantId);
  if (nada) motivos.push(`Nada sai agora (${nada}).`);
  if (recusa) {
    return { ...base, pode: false, motivos, faltas: [], devedor: null, simulacao: null, assinatura: '' };
  }
  const devedor = await devedorDaCobranca(exec, tenantId, c);
  const faltas = faltasParaNegativar(devedor);
  let simulacao: SimulacaoDeNegativacao | null = null;
  if (!motivos.length) {
    const { config } = await lerConfigCobranca(exec, tenantId);
    const adapter = await adapterDaAgencia(c.provedor, tenantId, config);
    if (!adapter.simularNegativacao) throw new ErroCobranca(`O ${adapter.nome} não negativa pela integração.`, 409);
    simulacao = await adapter.simularNegativacao(c.id_externo!);
    if (!simulacao.permitida) motivos.push(simulacao.motivo || `O ${adapter.nome} não permite negativar esta cobrança agora.`);
  }
  const pode = !motivos.length && !faltas.length;
  return {
    ...base, pode, motivos, faltas, devedor, simulacao,
    assinatura: pode ? assinar([c.id, c.valor_centavos, c.vencimento, c.status, devedor, simulacao?.taxa_centavos, simulacao?.inicio_previsto]) : '',
  };
}

function paraGravar(n: NegativacaoNoProvedor, antes: Partial<NegativacaoGravada>, quem?: QuemFez): NegativacaoGravada {
  const agora = new Date().toISOString();
  return {
    id: n.id_externo, numero: n.numero, status: n.status, taxa_centavos: n.taxa_centavos, pode_cancelar: n.pode_cancelar,
    motivo_recusa: n.motivo_recusa, reenviar_documentos: n.reenviar_documentos,
    pedida_em: antes.pedida_em || agora, pedida_por: antes.pedida_por || quem?.usuarioNome || '', atualizada_em: agora,
  };
}

async function gravar(exec: ExecutorSQL, tenantId: string, id: string, n: NegativacaoGravada | null): Promise<LinhaCobranca> {
  const { rows } = await exec.query(
    `UPDATE cobrancas SET dados = CASE WHEN $3::jsonb IS NULL THEN dados - 'negativacao' ELSE dados || jsonb_build_object('negativacao', $3::jsonb) END,
            atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUNAS_DA_COBRANCA}`,
    [tenantId, id, n ? JSON.stringify(n) : null],
  );
  return lerLinha(rows[0]);
}

/**
 * Pede a negativação com a assinatura da prévia. A mesma `idempotencia`
 * repetida devolve o que já foi feito.
 */
export async function pedirNegativacao(
  tenantId: string, cobrancaId: string, o: { assinatura: string; quem?: QuemFez; idempotencia?: string },
): Promise<{ negativacao: NegativacaoGravada; repetido?: boolean }> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const exec = pool as unknown as ExecutorSQL;
  if (o.idempotencia) {
    const { rows } = await exec.query(
      `SELECT 1 FROM cobranca_eventos WHERE tenant_id = $1 AND cobranca_id = $2 AND tipo = 'negativacao_pedida' AND detalhe->>'idempotencia' = $3 LIMIT 1`,
      [tenantId, cobrancaId, o.idempotencia.slice(0, 200)],
    );
    const c = rows.length ? await carregarCobranca(exec, tenantId, cobrancaId) : null;
    const g = c ? gravadaDe(c) : null;
    if (g) return { negativacao: g, repetido: true };
  }
  const previa = await previaDaNegativacao(exec, tenantId, cobrancaId);
  if (!previa.pode) {
    const nada = previa.motivos.find(m => m.startsWith('Nada sai'));
    if (nada) throw new ErroCobranca(nada, 409, 'NADA_SAI');
    throw new ErroCobranca([...previa.motivos, ...(previa.faltas.length ? [`Complete o cadastro do cliente: falta ${previa.faltas.join(', ')}.`] : [])].join(' '), 409);
  }
  if (!o.assinatura || o.assinatura !== previa.assinatura) {
    throw new ErroCobranca('Os dados mudaram desde a prévia. Confira de novo antes de negativar.', 409, 'ASSINATURA_VENCIDA');
  }
  const c = (await carregarCobranca(exec, tenantId, cobrancaId))!;
  const antes = gravadaDe(c);
  // Reserva a vaga: só uma negativação viva por cobrança, mesmo com duplo clique.
  const reservada = await exec.query(
    `UPDATE cobrancas SET dados = dados || jsonb_build_object('negativacao', $3::jsonb), atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2
        AND COALESCE(dados->'negativacao'->>'status', '') NOT IN ('PEDINDO','PENDING','AWAITING_APPROVAL','AWAITING_CANCELLATION','PROCESSED','PARTIALLY_PAID')
      RETURNING id`,
    [tenantId, c.id, JSON.stringify({ status: 'PEDINDO', pedida_em: new Date().toISOString(), pedida_por: o.quem?.usuarioNome ?? '' })],
  );
  if (!reservada.rows.length) throw new ErroCobranca('Já há um pedido de negativação para esta cobrança.', 409);

  const { config } = await lerConfigCobranca(exec, tenantId);
  const adapter = await adapterDaAgencia(c.provedor, tenantId, config);
  let n: NegativacaoNoProvedor;
  try {
    n = await adapter.negativar!({
      cobranca_externa: c.id_externo!, devedor: previa.devedor!,
      descricao: c.descricao || 'Serviços de turismo',
    });
  } catch (e) {
    // Sem resposta: a negativação pode ter nascido. Pergunta antes de liberar a vaga.
    const achada = e instanceof ErroProvedor && e.passageiro && adapter.negativacaoDaCobranca
      ? await adapter.negativacaoDaCobranca(c.id_externo!).catch(() => null)
      : null;
    if (!achada) {
      await gravar(exec, tenantId, c.id, antes);
      throw e;
    }
    n = achada;
  }
  const gravada = paraGravar(n, { pedida_por: o.quem?.usuarioNome ?? '' }, o.quem);
  await emTransacao(async tx => {
    await gravar(tx, tenantId, c.id, gravada);
    await registrarEvento(tx, tenantId, c.id, 'negativacao_pedida', c.status, c.status, {
      negativacao_id: n.id_externo, status: n.status, taxa_centavos: n.taxa_centavos,
      ...(o.idempotencia ? { idempotencia: o.idempotencia.slice(0, 200) } : {}),
    }, o.quem);
  });
  return { negativacao: gravada };
}

/** Busca a situação no provedor e grava. */
export async function atualizarNegativacao(tenantId: string, cobrancaId: string, o: { quem?: QuemFez } = {}): Promise<NegativacaoGravada> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const exec = pool as unknown as ExecutorSQL;
  const c = await carregarCobranca(exec, tenantId, cobrancaId);
  if (!c) throw new ErroCobranca('Cobrança não encontrada.', 404);
  const atual = gravadaDe(c);
  if (!atual?.id) throw new ErroCobranca('Esta cobrança não tem negativação.', 409);
  const { config } = await lerConfigCobranca(exec, tenantId);
  const adapter = await adapterDaAgencia(c.provedor, tenantId, config);
  const n = await adapter.consultarNegativacao!(atual.id);
  const nova = paraGravar(n, atual, o.quem);
  await emTransacao(async tx => {
    await gravar(tx, tenantId, c.id, nova);
    if (nova.status !== atual.status) {
      await registrarEvento(tx, tenantId, c.id, 'negativacao_situacao', c.status, c.status, { de: atual.status, para: nova.status }, o.quem);
    }
  });
  return nova;
}

/** Cancela no provedor (só quando ele diz que pode). */
export async function cancelarNegativacao(
  tenantId: string, cobrancaId: string, o: { motivo: string; quem?: QuemFez },
): Promise<NegativacaoGravada> {
  if (!pool) throw new ErroCobranca('Banco indisponível.', 503);
  const motivo = String(o.motivo ?? '').trim();
  if (motivo.length < 3) throw new ErroCobranca('Informe o motivo do cancelamento.');
  const exec = pool as unknown as ExecutorSQL;
  const c = await carregarCobranca(exec, tenantId, cobrancaId);
  if (!c) throw new ErroCobranca('Cobrança não encontrada.', 404);
  const atual = gravadaDe(c);
  if (!atual?.id) throw new ErroCobranca('Esta cobrança não tem negativação.', 409);
  if (atual.status === 'CANCELLED' || atual.status === 'AWAITING_CANCELLATION') return atual;
  const { config } = await lerConfigCobranca(exec, tenantId);
  const adapter = await adapterDaAgencia(c.provedor, tenantId, config);
  // A palavra final é do provedor: consulta antes (o `canBeCancelled` muda com o andamento).
  const agora = await adapter.consultarNegativacao!(atual.id);
  if (!agora.pode_cancelar) {
    await gravar(exec, tenantId, c.id, paraGravar(agora, atual, o.quem));
    throw new ErroCobranca(agora.motivo_recusa || `O ${nomeDoProvedor(c.provedor)} não permite cancelar esta negativação agora.`, 409);
  }
  const n = await adapter.cancelarNegativacao!(atual.id);
  const nova = paraGravar(n, atual, o.quem);
  await emTransacao(async tx => {
    await gravar(tx, tenantId, c.id, nova);
    await registrarEvento(tx, tenantId, c.id, 'negativacao_cancelada', c.status, c.status, { motivo, status: nova.status }, o.quem);
  });
  return nova;
}

