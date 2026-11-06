/**
 * Conexão Asaas unificada (E7, 06/11/2026): servidor.
 *
 * - `planoDeUnificacao`: lê os dois lados (a conta Asaas daqui e o que o CRM
 *   responde) e monta o plano (regras.ts).
 * - `aplicarUnificacao` / `desfazerUnificacao`: só com a confirmação da
 *   pessoa (a assinatura do plano que ela viu). Nada é apagado.
 * - `executarOperacaoDoCrm`: o CRM pede, pela chamada assinada, o que faria
 *   com a chave dele. Lista fechada, idempotente pela referência do CRM,
 *   "nada sai" e disjuntor por agência × provedor (o mesmo da cobrança).
 * - `repassarAvisoAoCrm`: aviso do Asaas de cobrança do CRM vira o evento
 *   `ASAAS_AVISO` (fila do CRM, idempotente pelo id do aviso).
 *
 * Nenhuma chamada ao Asaas acontece dentro de transação; os testes trocam o
 * `fetch` por um Asaas falso (`definirAmbienteDeCobranca`).
 */
import pool from '../db';
import type { ExecutorSQL } from '../caixa-atomico';
import { nadaSai } from '../nada-sai';
import { mudancaSegurandoSaidas } from '../migracao/estado';
import { baseDaChave } from '../plataformas/asaas';
import { carregarCredenciais } from '../plataformas/servico';
import type { EventoNormalizado } from '../plataformas/tipos';
import { criarClienteHttp, type ClienteHttp } from '../cobranca/http';
import { erroAsaas } from '../cobranca/asaas';
import { aguardarVez } from '../cobranca/limitador';
import { pistasDoAviso } from '../cobranca/aviso';
import { disjuntorAbertoAte, registrarFalhaNoDisjuntor, registrarSucessoNoDisjuntor, type QuemFez } from '../cobranca/servidor';
import { ErroProvedor } from '../cobranca/tipos';
import { consultarAsaasDoCrm, emitirEventoCRM, enderecoDoCrm } from '../crm-integration';
import { contaDoCrmNaUrl } from '../crm-do-ecossistema';
import {
  acharAvisoDoFinanceiro, ambienteDaChave, clienteQueJaAtende, cobrancaQueJaAtende, ehReferenciaDoCrm,
  lerOperacao, OPERACOES_QUE_CRIAM, planoDaUnificacao, referenciaDaEmpresa,
  TIPO_ASAAS_AVISO, TIPO_ASAAS_CONEXAO, TIPO_ASAAS_DESUNIFICAR, TIPO_ASAAS_UNIFICAR,
  type EstadoDaUnificacao, type LadoDoCrm, type LadoDoFinanceiro, type OperacaoAsaas, type PlanoDaUnificacao,
} from './regras';

export class ErroUnificacao extends Error {
  constructor(message: string, readonly status = 400, readonly codigo = 'UNIFICACAO') {
    super(message);
    this.name = 'ErroUnificacao';
  }
}

const exec = (): ExecutorSQL => {
  if (!pool) throw new ErroUnificacao('Banco indisponível.', 503, 'SEM_BANCO');
  return pool as unknown as ExecutorSQL;
};

// ---------------------------------------------------------------------------
// Estado

export interface LinhaUnificacao extends EstadoDaUnificacao {
  aviso_id: string | null;
  eventos_antes: string[] | null;
  carteira: string | null;
}

export async function lerUnificacao(e: ExecutorSQL, tenantId: string): Promise<LinhaUnificacao | null> {
  const { rows } = await e.query(
    `SELECT ativo, desde::text AS desde, aplicado_por_nome, carteira, aviso_id, eventos_antes, eventos_incluidos, aviso_do_crm
       FROM asaas_unificacao WHERE tenant_id = $1`,
    [tenantId],
  );
  const r = rows[0];
  if (!r) return null;
  const lista = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    ativo: r.ativo === true,
    desde: (r.desde as string | null) ?? null,
    aplicado_por_nome: (r.aplicado_por_nome as string | null) ?? null,
    carteira: (r.carteira as string | null) ?? null,
    aviso_id: (r.aviso_id as string | null) ?? null,
    eventos_antes: Array.isArray(r.eventos_antes) ? lista(r.eventos_antes) : null,
    eventos_incluidos: lista(r.eventos_incluidos),
    aviso_do_crm: (r.aviso_do_crm as string | null) ?? null,
  };
}

/** A agência está unificada agora? (o CRM usa a conexão daqui) */
export async function unificacaoAtiva(tenantId: string): Promise<boolean> {
  if (!pool) return false;
  try {
    return (await lerUnificacao(exec(), tenantId))?.ativo === true;
  } catch {
    // Banco sem a tabela (boot antes do initDB): nada unificado.
    return false;
  }
}

async function anotar(tenantId: string, entrada: Record<string, unknown>): Promise<void> {
  await exec().query(
    `UPDATE asaas_unificacao SET historico = historico || $2::jsonb, atualizado_em = NOW() WHERE tenant_id = $1`,
    [tenantId, JSON.stringify([{ em: new Date().toISOString(), ...entrada }])],
  );
}

// ---------------------------------------------------------------------------
// A conta Asaas daqui

async function contaAsaasDaqui(tenantId: string): Promise<{ http: ClienteHttp; chave: string } | null> {
  const conf = await carregarCredenciais(tenantId, 'asaas');
  if (!conf || !conf.config.ativo || !conf.cred.api_key) return null;
  const chave = conf.cred.api_key;
  const http = criarClienteHttp({
    base: baseDaChave(chave),
    cabecalhos: { access_token: chave, 'User-Agent': 'EnturOSFin/1.0' },
    nome: 'Asaas',
    lerErro: erroAsaas,
    antesDeChamar: () => aguardarVez(tenantId),
  });
  return { http, chave };
}

async function ladoDoFinanceiro(tenantId: string): Promise<LadoDoFinanceiro> {
  let conta: Awaited<ReturnType<typeof contaAsaasDaqui>> = null;
  try {
    conta = await contaAsaasDaqui(tenantId);
  } catch (e) {
    return { conectado: true, ambiente: null, carteira: null, aviso: null, erro: e instanceof Error ? e.message : 'credencial ilegível' };
  }
  if (!conta) return { conectado: false, ambiente: null, carteira: null, aviso: null, erro: null };
  const ambiente = ambienteDaChave(conta.chave);
  try {
    const carteiras = await conta.http.chamar<{ data?: unknown[] }>('/wallets');
    const carteira = (Array.isArray(carteiras?.data) ? carteiras.data : [])
      .map(w => String((w as Record<string, unknown>)?.id ?? '').trim()).find(Boolean) ?? null;
    const avisos = await conta.http.chamar<{ data?: unknown[] }>('/webhooks?limit=100');
    const aviso = acharAvisoDoFinanceiro(Array.isArray(avisos?.data) ? avisos.data : [], tenantId);
    return { conectado: true, ambiente, carteira, aviso, erro: null };
  } catch (e) {
    return { conectado: true, ambiente, carteira: null, aviso: null, erro: e instanceof Error ? e.message : 'o Asaas não respondeu' };
  }
}

function lerLadoDoCrm(r: Awaited<ReturnType<typeof consultarAsaasDoCrm>>): LadoDoCrm {
  if (r.situacao !== 'ok') {
    return { situacao: r.situacao, detalhe: r.detalhe, conectado: false, ambiente: null, chave_final: null, carteira: null, aviso_automatico: false, pelo_financeiro: false };
  }
  const v = r.valor;
  const amb = String(v.ambiente ?? '');
  return {
    situacao: 'ok', detalhe: '',
    conectado: v.conectado === true,
    ambiente: amb === 'sandbox' || amb === 'producao' ? amb : null,
    chave_final: v.chave_final ? String(v.chave_final) : null,
    carteira: v.carteira ? String(v.carteira) : null,
    aviso_automatico: v.aviso_automatico === true,
    pelo_financeiro: v.pelo_financeiro === true,
  };
}

export interface PlanoComLados extends PlanoDaUnificacao {
  financeiro: LadoDoFinanceiro;
  crm: LadoDoCrm;
  estado: EstadoDaUnificacao | null;
}

/** O plano que a tela mostra (consulta o CRM e a conta Asaas daqui, sem mudar nada). */
export async function planoDeUnificacao(tenantId: string): Promise<PlanoComLados> {
  const estado = await lerUnificacao(exec(), tenantId).catch(() => null);
  const [fin, crm] = await Promise.all([ladoDoFinanceiro(tenantId), consultarAsaasDoCrm(tenantId, TIPO_ASAAS_CONEXAO).then(lerLadoDoCrm)]);
  const est: EstadoDaUnificacao | null = estado
    ? { ativo: estado.ativo, desde: estado.desde, aplicado_por_nome: estado.aplicado_por_nome, eventos_incluidos: estado.eventos_incluidos, aviso_do_crm: estado.aviso_do_crm }
    : null;
  return { ...planoDaUnificacao(fin, crm, est), financeiro: fin, crm, estado: est };
}

// ---------------------------------------------------------------------------
// Aplicar e desfazer

/**
 * Troca os eventos do aviso daqui (`PUT /v3/webhooks/{id}`). Vai junto o
 * endereço que já está lá: a doc não diz que os campos ausentes ficam como
 * estão (confirmar), e o endereço é o único que importa não perder.
 */
async function trocarEventosDoAviso(tenantId: string, avisoId: string, eventos: string[]): Promise<void> {
  const conta = await contaAsaasDaqui(tenantId);
  if (!conta) throw new ErroUnificacao('O Asaas daqui foi desligado no meio do caminho.', 409, 'SEM_CONEXAO');
  const lista = await conta.http.chamar<{ data?: unknown[] }>('/webhooks?limit=100');
  const atual = (Array.isArray(lista?.data) ? lista.data : []).find(w => String((w as Record<string, unknown>)?.id ?? '') === avisoId) as Record<string, unknown> | undefined;
  await conta.http.chamar(`/webhooks/${encodeURIComponent(avisoId)}`, {
    metodo: 'PUT',
    corpo: { ...(atual?.url ? { url: atual.url } : {}), events: eventos },
  });
}

export interface ResultadoDaUnificacao {
  plano: PlanoComLados;
  aviso_do_crm: string;
}

/**
 * Aplica o plano que a pessoa confirmou. Ordem pensada para nunca deixar o
 * CRM sem caminho:
 * 1. o aviso daqui passa a avisar os eventos que o CRM usa (inofensivo);
 * 2. grava "unificado" aqui (o Financeiro já aceita os pedidos do CRM);
 * 3. manda o CRM trocar. Se o CRM recusar, 2 e 1 voltam como eram.
 */
export async function aplicarUnificacao(tenantId: string, assinatura: string, quem: QuemFez): Promise<ResultadoDaUnificacao> {
  const plano = await planoDeUnificacao(tenantId);
  if (plano.situacao === 'unificado') throw new ErroUnificacao('Já está unificado.', 409, 'JA_UNIFICADO');
  if (plano.situacao !== 'pode_unificar') throw new ErroUnificacao(plano.bloqueios[0] || plano.resumo, 409, 'BLOQUEADO');
  if (!assinatura || assinatura !== plano.assinatura) {
    throw new ErroUnificacao('A situação mudou desde que o plano foi mostrado. Confira o plano de novo e confirme.', 409, 'PLANO_MUDOU');
  }
  const aviso = plano.financeiro.aviso!;
  const eventosAntes = [...aviso.eventos];
  const incluidos = [...plano.eventos_a_incluir];
  if (incluidos.length) await trocarEventosDoAviso(tenantId, aviso.id, [...eventosAntes, ...incluidos]);

  await exec().query(
    `INSERT INTO asaas_unificacao (tenant_id, ativo, desde, aplicado_por, aplicado_por_nome, carteira, aviso_id, eventos_antes, eventos_incluidos, aviso_do_crm, atualizado_em)
     VALUES ($1, TRUE, NOW(), $2, $3, $4, $5, $6::jsonb, $7::jsonb, NULL, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET ativo = TRUE, desde = NOW(), aplicado_por = EXCLUDED.aplicado_por,
       aplicado_por_nome = EXCLUDED.aplicado_por_nome, carteira = EXCLUDED.carteira, aviso_id = EXCLUDED.aviso_id,
       eventos_antes = EXCLUDED.eventos_antes, eventos_incluidos = EXCLUDED.eventos_incluidos, aviso_do_crm = NULL, atualizado_em = NOW()`,
    [tenantId, quem.usuarioId ?? null, quem.usuarioNome ?? null, plano.financeiro.carteira, aviso.id,
      JSON.stringify(eventosAntes), JSON.stringify(incluidos)],
  );

  const r = await consultarAsaasDoCrm(tenantId, TIPO_ASAAS_UNIFICAR, { carteira: plano.financeiro.carteira });
  const recusou = r.situacao !== 'ok' ? r.detalhe : r.valor.pelo_financeiro !== true ? String(r.valor.motivo ?? 'o CRM não confirmou a troca') : null;
  if (recusou) {
    await exec().query(`UPDATE asaas_unificacao SET ativo = FALSE, atualizado_em = NOW() WHERE tenant_id = $1`, [tenantId]);
    await anotar(tenantId, { acao: 'unificar_recusado', por: quem.usuarioNome ?? null, motivo: recusou });
    if (incluidos.length) await trocarEventosDoAviso(tenantId, aviso.id, eventosAntes).catch(() => null);
    throw new ErroUnificacao(`O CRM não trocou a conexão: ${recusou}. Nada mudou.`, 502, 'CRM_RECUSOU');
  }
  const avisoDoCrm = String((r as { valor: Record<string, unknown> }).valor.aviso ?? '');
  await exec().query(`UPDATE asaas_unificacao SET aviso_do_crm = $2, atualizado_em = NOW() WHERE tenant_id = $1`, [tenantId, avisoDoCrm || null]);
  await anotar(tenantId, { acao: 'unificado', por: quem.usuarioNome ?? null, eventos_incluidos: incluidos, aviso_do_crm: avisoDoCrm });
  return { plano: await planoDeUnificacao(tenantId), aviso_do_crm: avisoDoCrm };
}

/**
 * Desfaz: primeiro o CRM volta para a chave e o aviso dele (se ele não
 * responder, nada muda aqui e a pessoa tenta de novo); depois o aviso daqui
 * volta aos eventos de antes e a unificação desliga.
 */
export async function desfazerUnificacao(tenantId: string, quem: QuemFez): Promise<PlanoComLados> {
  const estado = await lerUnificacao(exec(), tenantId);
  if (!estado?.ativo) throw new ErroUnificacao('Não está unificado.', 409, 'NAO_UNIFICADO');
  const r = await consultarAsaasDoCrm(tenantId, TIPO_ASAAS_DESUNIFICAR, {});
  if (r.situacao !== 'ok' || r.valor.pelo_financeiro !== false) {
    const motivo = r.situacao !== 'ok' ? r.detalhe : String(r.valor.motivo ?? 'o CRM não confirmou');
    throw new ErroUnificacao(`O CRM não voltou para a conexão dele: ${motivo}. Continua unificado.`, 502, 'CRM_RECUSOU');
  }
  let eventosVoltaram = true;
  if (estado.aviso_id && estado.eventos_antes && estado.eventos_incluidos.length) {
    eventosVoltaram = await trocarEventosDoAviso(tenantId, estado.aviso_id, estado.eventos_antes).then(() => true, () => false);
  }
  await exec().query(`UPDATE asaas_unificacao SET ativo = FALSE, atualizado_em = NOW() WHERE tenant_id = $1`, [tenantId]);
  await anotar(tenantId, {
    acao: 'desfeito', por: quem.usuarioNome ?? null, aviso_do_crm: String(r.valor.aviso ?? ''),
    ...(eventosVoltaram ? {} : { pendencia: 'os eventos do aviso do Financeiro não voltaram; confira no painel do Asaas' }),
  });
  return planoDeUnificacao(tenantId);
}

// ---------------------------------------------------------------------------
// Pedidos do CRM

export interface RespostaAoCrm {
  http: number;
  corpo: Record<string, unknown>;
}

const erroAoCrm = (http: number, codigo: string, erro: string, status = http): RespostaAoCrm =>
  ({ http, corpo: { ok: false, codigo, erro, status } });

/** Falhas que contam para o disjuntor (o Asaas fora do ar ou pedindo para esperar). */
function contaNoDisjuntor(e: ErroProvedor): boolean {
  return e.passageiro || e.tipo === 'credencial';
}

/**
 * Executa um pedido do CRM no Asaas desta agência. Responde sempre um corpo
 * com `ok`; o `status` do erro é o do Asaas (401 chave, 404 não achou, 429
 * limite...) para o CRM escolher a frase certa.
 */
export async function executarOperacaoDoCrm(tenantId: string, payload: unknown): Promise<RespostaAoCrm> {
  if (!(await unificacaoAtiva(tenantId))) {
    return erroAoCrm(409, 'NAO_UNIFICADO', 'O Asaas desta agência não está unificado no Financeiro. Use a conexão do próprio CRM.');
  }
  // A empresa do CRM sai do endereço da integração (.../webhook/<empresa>); sem ela, vale qualquer referência do CRM.
  const empresaCrm = contaDoCrmNaUrl(await enderecoDoCrm(tenantId).catch(() => null));
  const leitura = lerOperacao(payload, empresaCrm);
  if (!leitura.ok) return erroAoCrm(400, 'RECUSADA', leitura.motivo);
  const op = leitura.op;

  if (OPERACOES_QUE_CRIAM.includes(op.tipo)) {
    const motivo = nadaSai() ?? (await mudancaSegurandoSaidas(exec(), tenantId));
    if (motivo) return erroAoCrm(409, 'NADA_SAI', `O Financeiro não cria cobrança agora (${motivo}). Tente de novo quando terminar.`);
  }
  const aberto = await disjuntorAbertoAte(exec(), tenantId, 'asaas');
  if (aberto) {
    return erroAoCrm(503, 'DISJUNTOR', 'O Asaas desta agência falhou várias vezes seguidas e o Financeiro pausou as chamadas por alguns minutos. Tente de novo daqui a pouco.');
  }
  const conta = await contaAsaasDaqui(tenantId).catch(() => null);
  if (!conta) return erroAoCrm(409, 'SEM_CONEXAO', 'O Asaas está desligado no Financeiro. Religue em Configurações › Plataformas ou desfaça a unificação.');

  try {
    const resposta = await executar(conta.http, op, empresaCrm);
    await registrarSucessoNoDisjuntor(exec(), tenantId, 'asaas');
    return { http: 200, corpo: { ok: true, resposta } };
  } catch (e) {
    if (e instanceof ErroProvedor) {
      if (contaNoDisjuntor(e)) await registrarFalhaNoDisjuntor(exec(), tenantId, 'asaas', e.message, e.esperarSegundos).catch(() => null);
      return erroAoCrm(e.status && e.status >= 400 ? (e.status >= 500 ? 502 : e.status) : 504, `ASAAS_${e.tipo.toUpperCase()}`, e.message, e.status ?? 0);
    }
    if (e instanceof ErroUnificacao) return erroAoCrm(e.status, e.codigo, e.message);
    throw e;
  }
}

async function cobrancaDoCrm(http: ClienteHttp, id: string, empresaCrm: number | null): Promise<Record<string, unknown>> {
  const c = await http.chamar<Record<string, unknown>>(`/payments/${encodeURIComponent(id)}`);
  if (!referenciaDaEmpresa(c?.externalReference, empresaCrm)) {
    // Cobrança da agência que não é do CRM (do Financeiro, de outro sistema): o CRM não vê.
    throw new ErroUnificacao('Cobrança não encontrada entre as do CRM.', 404, 'NAO_E_DO_CRM');
  }
  return c;
}

async function executar(http: ClienteHttp, op: OperacaoAsaas, empresaCrm: number | null): Promise<unknown> {
  switch (op.tipo) {
    case 'criar_cliente': {
      const doc = String(op.corpo.cpfCnpj ?? '');
      const achados = await http.chamar<{ data?: unknown[] }>(`/customers?cpfCnpj=${encodeURIComponent(doc)}&limit=20`);
      const ja = clienteQueJaAtende(Array.isArray(achados?.data) ? achados.data : [], op.corpo);
      if (ja) return ja;
      return http.chamar('/customers', { metodo: 'POST', corpo: op.corpo });
    }
    case 'criar_cobranca': {
      // O Asaas não tem chave de idempotência: o pedido repetido (timeout,
      // clique duplo) acha a cobrança viva com a mesma referência.
      const ref = String(op.corpo.externalReference ?? '');
      const achadas = await http.chamar<{ data?: unknown[] }>(`/payments?externalReference=${encodeURIComponent(ref)}&limit=20`);
      const ja = cobrancaQueJaAtende(Array.isArray(achadas?.data) ? achadas.data : [], op.corpo);
      if (ja) return ja;
      return http.chamar('/payments', { metodo: 'POST', corpo: op.corpo });
    }
    case 'ler_cobranca':
      return cobrancaDoCrm(http, op.id, empresaCrm);
    case 'linha_do_boleto':
      await cobrancaDoCrm(http, op.id, empresaCrm);
      return http.chamar(`/payments/${encodeURIComponent(op.id)}/identificationField`);
    case 'pix':
      await cobrancaDoCrm(http, op.id, empresaCrm);
      return http.chamar(`/payments/${encodeURIComponent(op.id)}/pixQrCode`);
    case 'cancelar':
      await cobrancaDoCrm(http, op.id, empresaCrm);
      return http.chamar(`/payments/${encodeURIComponent(op.id)}`, { metodo: 'DELETE' });
    case 'parcelas': {
      const r = await http.chamar<{ data?: unknown[]; totalCount?: number }>(`/payments?installment=${encodeURIComponent(op.parcelamento)}&limit=100`);
      const lista = Array.isArray(r?.data) ? r.data : [];
      if (lista.some(p => !referenciaDaEmpresa((p as Record<string, unknown>)?.externalReference, empresaCrm))) {
        throw new ErroUnificacao('Parcelamento não encontrado entre os do CRM.', 404, 'NAO_E_DO_CRM');
      }
      return r;
    }
  }
}

// ---------------------------------------------------------------------------
// Avisos do Asaas → CRM

/**
 * Depois que o aviso do Asaas foi gravado aqui: se é de uma cobrança do CRM
 * e a agência está unificada, vai ao CRM como `ASAAS_AVISO`. Pela fila de
 * eventos do CRM (retentativa e disjuntor de lá), com a chave do aviso:
 * reenvio do Asaas não vira segundo aviso. Nunca derruba o aviso.
 */
export async function repassarAvisoAoCrm(tenantId: string, plataforma: string, evento: EventoNormalizado): Promise<boolean> {
  if (plataforma !== 'asaas') return false;
  const pistas = pistasDoAviso('asaas', evento);
  const referencia = pistas.referencias.find(ehReferenciaDoCrm);
  if (!referencia || !pistas.idPagamento) return false;
  if (!(await unificacaoAtiva(tenantId))) return false;
  await emitirEventoCRM(TIPO_ASAAS_AVISO, {
    versao: 1,
    pagamento_id: pistas.idPagamento,
    referencia,
    evento: pistas.eventoBruto,
    aviso_id: evento.id_externo,
  }, { tenantId, idempotency_key: `asaas_aviso_${tenantId}_${evento.id_externo}` });
  return true;
}
