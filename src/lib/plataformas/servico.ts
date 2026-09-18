/**
 * Plataformas: configuração por agência, razão de transações e geração
 * das contas a receber.
 *
 * Três regras organizam este arquivo, e todas vêm de dinheiro errado já
 * visto em produção:
 *
 * 1. **O caixa só se move quando o dinheiro cai.** Pagamento confirmado
 *    no cartão não é caixa: é conta a receber com data prevista. Tratar
 *    confirmado como recebido antecipa em 30 dias um dinheiro que a
 *    plataforma ainda pode estornar.
 * 2. **O que entra na conta é o líquido; a taxa fica declarada à parte.**
 *    O extrato do banco tem que bater com o saldo do sistema, e o DRE
 *    precisa ver a taxa como custo, não como receita que nunca existiu.
 * 3. **A reversão devolve exatamente o que foi creditado.** Cada parcela
 *    guarda quanto moveu o caixa (`caixa_creditado`). Estorno debita esse
 *    número, e não o valor recalculado — que pode ter mudado no meio.
 *
 * O caminho de escrita é UM só: webhook e importação por API produzem
 * `TransacaoNormalizada` e caem em `sincronizarTransacao`.
 */
import pool from '../db';
import { generateId } from '../utils';
import { round2, num, hojeISO, addDias } from '../money';
import { emTransacao, aplicarMovimentoCaixaAtomico, type ExecutorSQL } from '../caixa-atomico';
import { cifrar, decifrar, mascarar } from '../cofre';
import { acharAdapter } from './index';
import {
  decidir, type CandidatoVenda, type Decisao, type PagamentoParaConciliar,
} from './conciliacao';
import type {
  CredenciaisPlataforma, EventoNormalizado, ParcelaNormalizada, PlataformaId,
  StatusParcelaPlataforma, TransacaoNormalizada,
} from './tipos';

export interface ConfigPlataforma {
  plataforma: PlataformaId;
  ativo: boolean;
  /** Conta bancária que recebe o dinheiro. Vazio usa a Caixa Geral. */
  conta_bancaria_id: string;
  /** Emitir nota fiscal sozinho quando a venda entra. */
  emitir_nota: boolean;
  /** Vincular à venda do CRM sozinho quando a confiança for alta. */
  conciliacao_automatica: boolean;
  /** Só para exibição. O segredo real fica cifrado. */
  mascaras: Record<string, string>;
  atualizado_em: string;
}

export class ErroPlataforma extends Error {}

/** Como cada estado da plataforma aparece na conta a receber. */
const STATUS_CONTA: Record<StatusParcelaPlataforma, string> = {
  PENDENTE: 'PENDENTE',
  // Pago pelo comprador, ainda não liberado: continua sendo "a receber",
  // e é isso que faz a pergunta "quanto ainda temos a receber" fechar.
  CONFIRMADO: 'PENDENTE',
  ATRASADO: 'ATRASADO',
  RECEBIDO: 'RECEBIDO',
  CANCELADO: 'CANCELADO',
  ESTORNADO: 'CANCELADO',
  CHARGEBACK: 'CANCELADO',
};

function lerConfig(linha: { plataforma: string; ativo: unknown; data: unknown }): ConfigPlataforma {
  const d = (linha.data ?? {}) as Record<string, unknown>;
  return {
    plataforma: linha.plataforma as PlataformaId,
    ativo: linha.ativo === true,
    conta_bancaria_id: String(d.conta_bancaria_id ?? ''),
    emitir_nota: d.emitir_nota === true,
    conciliacao_automatica: d.conciliacao_automatica === true,
    mascaras: (d.mascaras ?? {}) as Record<string, string>,
    atualizado_em: String(d.atualizado_em ?? ''),
  };
}

/** Configuração da agência, sem segredo nenhum: serve para a tela. */
export async function listarConfigs(tenantId: string): Promise<ConfigPlataforma[]> {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT plataforma, ativo, data FROM plataformas_config WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.map(lerConfig);
}

/** Credenciais decifradas. NUNCA sai desta camada para a resposta HTTP. */
export async function carregarCredenciais(
  tenantId: string,
  plataforma: string,
): Promise<{ cred: CredenciaisPlataforma; config: ConfigPlataforma } | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT plataforma, ativo, data FROM plataformas_config
      WHERE tenant_id = $1 AND plataforma = $2 LIMIT 1`,
    [tenantId, plataforma],
  );
  if (rows.length === 0) return null;

  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  let cred: CredenciaisPlataforma = { api_key: '', segredo_webhook: '', extras: {} };
  if (d.credencial) {
    try {
      cred = JSON.parse(decifrar(d.credencial as string)) as CredenciaisPlataforma;
    } catch {
      // Cofre indisponível ou chave mestra trocada. Devolver credencial
      // vazia faria o webhook recusar por "token não confere", escondendo
      // a causa real; por isso o erro é explícito.
      throw new ErroPlataforma(
        'A credencial gravada não pôde ser lida. Cadastre a credencial desta plataforma de novo.',
      );
    }
  }
  return { cred, config: lerConfig(rows[0]) };
}

export async function salvarConfig(
  tenantId: string,
  plataforma: string,
  entrada: {
    ativo: boolean;
    conta_bancaria_id: string;
    emitir_nota: boolean;
    conciliacao_automatica?: boolean;
    /** Só os campos que o usuário digitou agora. Campo em branco mantém o
     *  que já estava: a tela nunca recebe o segredo de volta, então enviar
     *  vazio significa "não mexi nele", e não "apague". */
    credencial: Partial<CredenciaisPlataforma> & { extras?: Record<string, string> };
  },
): Promise<void> {
  if (!pool) throw new ErroPlataforma('Banco indisponível.');
  const adapter = acharAdapter(plataforma);
  if (!adapter) throw new ErroPlataforma(`Plataforma desconhecida: ${plataforma}`);

  const atual = await carregarCredenciais(tenantId, plataforma).catch(() => null);
  const base: CredenciaisPlataforma = atual?.cred ?? { api_key: '', segredo_webhook: '', extras: {} };

  const cred: CredenciaisPlataforma = {
    api_key: entrada.credencial.api_key?.trim() || base.api_key,
    segredo_webhook: entrada.credencial.segredo_webhook?.trim() || base.segredo_webhook,
    extras: { ...base.extras, ...(entrada.credencial.extras ?? {}) },
  };

  const faltando = adapter.camposCredencial()
    .filter(c => c.obrigatorio)
    .filter(c => {
      const v = c.chave === 'api_key' ? cred.api_key
        : c.chave === 'segredo_webhook' ? cred.segredo_webhook
        : cred.extras[c.chave];
      return !String(v ?? '').trim();
    })
    .map(c => c.rotulo);
  if (faltando.length > 0) {
    throw new ErroPlataforma(`Preencha: ${faltando.join(', ')}.`);
  }

  const mascaras: Record<string, string> = {
    api_key: mascarar(cred.api_key),
    segredo_webhook: mascarar(cred.segredo_webhook),
  };
  for (const [k, v] of Object.entries(cred.extras)) mascaras[k] = v;

  const data = {
    credencial: cifrar(JSON.stringify(cred)),
    conta_bancaria_id: entrada.conta_bancaria_id ?? '',
    emitir_nota: entrada.emitir_nota === true,
    conciliacao_automatica: entrada.conciliacao_automatica === true,
    mascaras,
    atualizado_em: new Date().toISOString(),
  };

  await pool.query(
    `INSERT INTO plataformas_config (id, tenant_id, plataforma, ativo, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
     ON CONFLICT (tenant_id, plataforma) DO UPDATE
        SET ativo = EXCLUDED.ativo, data = EXCLUDED.data, updated_at = NOW()`,
    [generateId(), tenantId, plataforma, entrada.ativo === true, JSON.stringify(data)],
  );
}

// ---------------------------------------------------------------------------
// Razão de transações
// ---------------------------------------------------------------------------

/**
 * Funde o retrato novo com o que já se sabia da transação.
 *
 * Existe porque o Asaas manda UMA cobrança por aviso: a parcela 3 de 12
 * chega sozinha, e as outras 11 não podem sumir do retrato. Parcela que
 * o evento não menciona fica como estava.
 */
export function mesclarParcelas(
  atuais: readonly ParcelaNormalizada[],
  novas: readonly ParcelaNormalizada[],
): ParcelaNormalizada[] {
  const porNumero = new Map<number, ParcelaNormalizada>();
  for (const p of atuais) porNumero.set(p.numero, p);
  for (const p of novas) {
    const anterior = porNumero.get(p.numero);
    // Campo que a plataforma não repetiu neste aviso não pode virar vazio:
    // perder a data de pagamento numa atualização de status apagaria a
    // prova de quando o dinheiro entrou.
    porNumero.set(p.numero, anterior ? {
      ...anterior,
      ...p,
      data_vencimento: p.data_vencimento || anterior.data_vencimento,
      data_prevista_recebimento: p.data_prevista_recebimento || anterior.data_prevista_recebimento,
      data_pagamento: p.data_pagamento || anterior.data_pagamento,
      data_recebimento: p.data_recebimento || anterior.data_recebimento,
      valor_taxa: p.valor_taxa || anterior.valor_taxa,
      id_externo: p.id_externo || anterior.id_externo,
    } : p);
  }
  const lista = [...porNumero.values()].sort((a, b) => a.numero - b.numero);
  const total = Math.max(1, ...lista.map(p => p.total), lista.length);
  return lista.map(p => ({ ...p, total }));
}

/** Totais recalculados a partir das parcelas conhecidas. */
export function totaisDaTransacao(parcelas: readonly ParcelaNormalizada[]) {
  const vivo = parcelas.filter(p => p.status !== 'CANCELADO' && p.status !== 'ESTORNADO' && p.status !== 'CHARGEBACK');
  const recebido = parcelas.filter(p => p.status === 'RECEBIDO');
  const aReceber = vivo.filter(p => p.status !== 'RECEBIDO');
  const estornado = parcelas.filter(p => p.status === 'ESTORNADO' || p.status === 'CHARGEBACK');
  const somar = (l: readonly ParcelaNormalizada[], f: (p: ParcelaNormalizada) => number) =>
    round2(l.reduce((a, p) => a + num(f(p)), 0));
  return {
    bruto: somar(vivo, p => p.valor_bruto),
    taxa: somar(vivo, p => p.valor_taxa),
    liquido: somar(vivo, p => p.valor_liquido),
    recebido: somar(recebido, p => p.valor_liquido),
    a_receber: somar(aReceber, p => p.valor_liquido),
    estornado: somar(estornado, p => p.valor_bruto),
  };
}

interface LinhaTransacao {
  venda_id: string;
  status_conciliacao: string;
  transacao: TransacaoNormalizada;
  /** Quanto cada parcela já creditou no caixa, por número. */
  caixa_creditado: Record<string, number>;
}

async function lerTransacao(
  exec: ExecutorSQL, tenantId: string, plataforma: string, idTransacao: string,
): Promise<LinhaTransacao | null> {
  const { rows } = await exec.query(
    `SELECT venda_id, status_conciliacao, data FROM plataformas_transacoes
      WHERE tenant_id = $1 AND plataforma = $2 AND id_transacao = $3 LIMIT 1`,
    [tenantId, plataforma, idTransacao],
  );
  if (rows.length === 0) return null;
  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  return {
    venda_id: String(rows[0].venda_id ?? ''),
    status_conciliacao: String(rows[0].status_conciliacao ?? 'PENDENTE'),
    transacao: (d.transacao ?? null) as TransacaoNormalizada,
    caixa_creditado: (d.caixa_creditado ?? {}) as Record<string, number>,
  };
}

// ---------------------------------------------------------------------------
// Conciliação com o CRM
// ---------------------------------------------------------------------------

/** Dias para trás e para a frente na busca por venda correspondente. */
const JANELA_DIAS = 45;

/**
 * Vendas do CRM que podem corresponder a este pagamento.
 *
 * A janela existe porque venda fechada e pagamento raramente caem no
 * mesmo dia (entrada, boleto, parcelamento), e porque varrer a base
 * inteira a cada webhook não escala.
 */
export async function candidatosDoCrm(
  exec: ExecutorSQL, tenantId: string, transacao: TransacaoNormalizada, dataPagamento: string,
): Promise<CandidatoVenda[]> {
  // Os limites são calculados aqui, em data civil, e comparados como
  // TEXTO. Fazer a conta no SQL devolveria timestamp ('2026-08-01
  // 00:00:00'), e a venda do próprio dia do limite ficaria de fora da
  // janela por comparação de string.
  const referencia = dataPagamento || hojeISO();
  const de = addDias(referencia, -JANELA_DIAS);
  const ate = addDias(referencia, JANELA_DIAS);

  const { rows } = await exec.query(
    `SELECT v.id,
            v.data->>'valor_total'   AS valor_total,
            v.data->>'data_venda'    AS data_venda,
            v.data->>'plataforma_transacao' AS id_transacao_externa,
            v.data->>'plataforma_origem'    AS plataforma_origem,
            c.nome     AS cliente_nome,
            c.cpf_cnpj AS documento,
            c.data->>'email'    AS email,
            c.data->>'telefone' AS telefone
       FROM vendas_crm v
       LEFT JOIN clientes c ON c.id = v.cliente_id AND c.tenant_id = v.tenant_id
      WHERE v.tenant_id = $1
        AND COALESCE(v.status, '') <> 'CANCELADO'
        AND COALESCE(NULLIF(v.data->>'data_venda', ''), to_char(v.created_at, 'YYYY-MM-DD'))
            BETWEEN $2 AND $3
      ORDER BY v.created_at DESC
      LIMIT 300`,
    [tenantId, de, ate],
  );

  return rows.map(r => ({
    venda_id: String(r.id),
    cliente_nome: String(r.cliente_nome ?? ''),
    documento: String(r.documento ?? ''),
    email: String(r.email ?? ''),
    telefone: String(r.telefone ?? ''),
    valor_total: round2(num(r.valor_total)),
    data_venda: String(r.data_venda ?? ''),
    id_transacao_externa: String(r.id_transacao_externa ?? ''),
    ja_conciliada: Boolean(r.plataforma_origem) && String(r.id_transacao_externa ?? '') !== transacao.id_transacao,
  }));
}

// ---------------------------------------------------------------------------
// Sincronização: o único caminho de escrita no financeiro
// ---------------------------------------------------------------------------

export interface ResultadoSincronizacao {
  id_transacao: string;
  criada: boolean;
  parcelas: number;
  caixa_movido: number;
  status_conciliacao: string;
  venda_id: string;
  conciliacao: Decisao | null;
}

/**
 * Grava o estado atual da transação e reflete no financeiro.
 *
 * Idempotente por construção: rodar duas vezes com o mesmo retrato move
 * zero de caixa, porque o movimento é sempre a DIFERENÇA entre o que a
 * parcela já creditou e o que ela deveria ter creditado.
 */
export async function sincronizarTransacao(
  exec: ExecutorSQL,
  tenantId: string,
  plataforma: string,
  entrada: TransacaoNormalizada,
  opcoes: { contaBancariaId: string | null; conciliacaoAutomatica: boolean },
): Promise<ResultadoSincronizacao> {
  const idTransacao = String(entrada.id_transacao ?? '').trim();
  if (!idTransacao) throw new ErroPlataforma('Transação sem identificador na plataforma.');

  const anterior = await lerTransacao(exec, tenantId, plataforma, idTransacao);
  const parcelas = mesclarParcelas(anterior?.transacao?.parcelas ?? [], entrada.parcelas ?? []);
  const totais = totaisDaTransacao(parcelas);

  const transacao: TransacaoNormalizada = {
    ...(anterior?.transacao ?? entrada),
    ...entrada,
    // O comprador do retrato novo pode vir incompleto (consulta de cliente
    // que falhou). Campo vazio nunca apaga o que já se sabia.
    comprador: {
      nome: entrada.comprador.nome || anterior?.transacao?.comprador?.nome || '',
      email: entrada.comprador.email || anterior?.transacao?.comprador?.email || '',
      documento: entrada.comprador.documento || anterior?.transacao?.comprador?.documento || '',
      telefone: entrada.comprador.telefone || anterior?.transacao?.comprador?.telefone || '',
    },
    parcelas,
    valor_bruto: totais.bruto,
    valor_taxa: totais.taxa,
    valor_liquido: totais.liquido,
  };

  const clienteId = await garantirCliente(exec, tenantId, plataforma, transacao);

  // Conciliação: só enquanto ninguém decidiu. Vínculo feito à mão não é
  // revisto por robô a cada aviso de status.
  let vendaId = anterior?.venda_id ?? '';
  let statusConciliacao = anterior?.status_conciliacao ?? 'PENDENTE';
  let decisao: Decisao | null = null;

  if (statusConciliacao === 'PENDENTE' || statusConciliacao === 'SUGERIDA') {
    const dataPagamento = parcelas.find(p => p.data_pagamento)?.data_pagamento
      || transacao.data_venda || hojeISO();
    const pagamento: PagamentoParaConciliar = {
      id_transacao: idTransacao,
      documento: transacao.comprador.documento,
      email: transacao.comprador.email,
      telefone: transacao.comprador.telefone,
      valor: totais.bruto,
      data: dataPagamento,
    };
    const candidatos = await candidatosDoCrm(exec, tenantId, transacao, dataPagamento);
    decisao = decidir(pagamento, candidatos, { vincularAutomatico: opcoes.conciliacaoAutomatica });

    if (decisao.acao === 'VINCULAR' && decisao.escolhida) {
      vendaId = decisao.escolhida.venda_id;
      statusConciliacao = 'VINCULADA';
    } else if (decisao.acao === 'SUGERIR') {
      statusConciliacao = 'SUGERIDA';
    } else {
      // Sem candidato: é venda direta, e isso é uma resposta, não uma
      // falha. Fica marcada para a tela saber separar de "ninguém olhou".
      statusConciliacao = 'DIRETA';
    }
  }

  // Herança da versão anterior da integração: ela criava UMA conta por
  // transação, com id sem o número da parcela, marcada como recebida e
  // creditando o BRUTO no caixa. Ignorar essa linha faria a mesma venda
  // contar duas vezes, na receita e no saldo. Ela é adotada como parcela
  // 1 e o crédito que ela já fez entra no acerto de caixa.
  const legado = anterior === null
    ? await lerContaLegada(exec, tenantId, plataforma, idTransacao)
    : null;

  const contas = await sincronizarContas(
    exec, tenantId, plataforma, transacao, {
      clienteId,
      vendaId,
      contaBancariaId: opcoes.contaBancariaId,
      creditadoAntes: anterior?.caixa_creditado
        ?? (legado ? { '1': legado.creditado } : {}),
      idLegadoParcela1: legado?.id ?? '',
    },
  );

  const dados = {
    transacao,
    totais,
    caixa_creditado: contas.creditado,
    conciliacao: decisao,
    atualizado_em: new Date().toISOString(),
  };

  await exec.query(
    `INSERT INTO plataformas_transacoes
       (id, tenant_id, plataforma, id_transacao, cliente_id, venda_id, status_conciliacao, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW())
     ON CONFLICT (tenant_id, plataforma, id_transacao) DO UPDATE
        SET cliente_id = EXCLUDED.cliente_id,
            venda_id = EXCLUDED.venda_id,
            status_conciliacao = EXCLUDED.status_conciliacao,
            data = EXCLUDED.data,
            updated_at = NOW()`,
    [generateId(), tenantId, plataforma, idTransacao, clienteId, vendaId, statusConciliacao, JSON.stringify(dados)],
  );

  return {
    id_transacao: idTransacao,
    criada: anterior === null,
    parcelas: parcelas.length,
    caixa_movido: contas.movido,
    status_conciliacao: statusConciliacao,
    venda_id: vendaId,
    conciliacao: decisao,
  };
}

/**
 * A conta que a versão anterior da integração criou para esta transação.
 *
 * Só existe para dados gravados antes do modelo por parcela. Devolve o
 * que ela já creditou no caixa para que o acerto seja a DIFERENÇA, e não
 * um segundo crédito.
 */
async function lerContaLegada(
  exec: ExecutorSQL, tenantId: string, plataforma: string, idTransacao: string,
): Promise<{ id: string; creditado: number } | null> {
  const id = `plat-${plataforma}-${idTransacao}`;
  const { rows } = await exec.query(
    `SELECT id, data->>'valor_recebido' AS recebido, data->>'status' AS status
       FROM contas_receber WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [id, tenantId],
  );
  if (rows.length === 0) return null;
  // Só o que estava marcado como recebido moveu caixa na versão antiga.
  const creditado = String(rows[0].status ?? '') === 'RECEBIDO' ? round2(num(rows[0].recebido)) : 0;
  return { id: String(rows[0].id), creditado };
}

/** Cliente do financeiro para o comprador da plataforma. */
async function garantirCliente(
  exec: ExecutorSQL, tenantId: string, plataforma: string, transacao: TransacaoNormalizada,
): Promise<string> {
  const email = transacao.comprador.email.trim().toLowerCase();
  const documento = String(transacao.comprador.documento ?? '').replace(/\D/g, '');

  // Documento antes de e-mail: o mesmo humano compra com e-mails
  // diferentes, mas o CPF é o mesmo, e é por ele que o CRM casa também.
  if (documento) {
    const r = await exec.query(
      `SELECT id FROM clientes
        WHERE tenant_id = $1 AND regexp_replace(COALESCE(cpf_cnpj, ''), '\\D', '', 'g') = $2
        LIMIT 1`,
      [tenantId, documento],
    );
    if (r.rows[0]?.id) return String(r.rows[0].id);
  }
  if (email) {
    const r = await exec.query(
      `SELECT id FROM clientes WHERE tenant_id = $1 AND LOWER(TRIM(data->>'email')) = $2 LIMIT 1`,
      [tenantId, email],
    );
    if (r.rows[0]?.id) return String(r.rows[0].id);
  }

  const clienteId = generateId();
  const cliente = {
    id: clienteId,
    nome: transacao.comprador.nome || email || 'Comprador',
    cpf_cnpj: documento,
    tipo: documento.length === 14 ? 'juridica' : 'fisica',
    email,
    telefone: transacao.comprador.telefone,
    origem: plataforma,
  };
  await exec.query(
    `INSERT INTO clientes (id, nome, cpf_cnpj, tipo, data, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [clienteId, cliente.nome, cliente.cpf_cnpj, cliente.tipo, JSON.stringify(cliente), tenantId],
  );
  return clienteId;
}

/**
 * Uma conta a receber por parcela, e o movimento de caixa da diferença.
 *
 * O id é determinístico (`plat-{plataforma}-{transação}-{parcela}`): é o
 * que faz o reprocessamento atualizar a mesma conta em vez de criar uma
 * segunda. Reprocessar é rotina — plataforma reenvia webhook por desenho.
 */
async function sincronizarContas(
  exec: ExecutorSQL,
  tenantId: string,
  plataforma: string,
  transacao: TransacaoNormalizada,
  ctx: {
    clienteId: string;
    vendaId: string;
    contaBancariaId: string | null;
    creditadoAntes: Record<string, number>;
    /** Id da conta criada pela versão antiga, adotado pela parcela 1. */
    idLegadoParcela1?: string;
  },
): Promise<{ creditado: Record<string, number>; movido: number }> {
  const creditado: Record<string, number> = { ...ctx.creditadoAntes };
  let movido = 0;

  for (const parcela of transacao.parcelas) {
    const contaId = parcela.numero === 1 && ctx.idLegadoParcela1
      ? ctx.idLegadoParcela1
      : `plat-${plataforma}-${transacao.id_transacao}-${parcela.numero}`;
    const statusConta = STATUS_CONTA[parcela.status] ?? 'PENDENTE';
    const chave = String(parcela.numero);

    const sufixo = parcela.total > 1 ? ` (${parcela.numero}/${parcela.total})` : '';
    const conta = {
      id: contaId,
      origem: ctx.vendaId ? 'VENDA' : 'VENDA_DIRETA',
      venda_id: ctx.vendaId || null,
      grupo_id: null,
      cliente_id: ctx.clienteId,
      cliente_nome: transacao.comprador.nome || transacao.comprador.email || 'Comprador',
      descricao: `${transacao.descricao} · ${plataforma}${sufixo}`,
      categoria_id: '',
      centro_custo: '',
      valor_original: parcela.valor_bruto,
      juros: parcela.juros,
      multa: 0,
      desconto: parcela.desconto,
      valor_final: parcela.valor_bruto,
      data_emissao: transacao.data_venda || parcela.data_vencimento,
      data_vencimento: parcela.data_vencimento || transacao.data_venda,
      data_prevista_recebimento: parcela.data_prevista_recebimento,
      data_recebimento: parcela.data_recebimento || '',
      // O que entrou de verdade é o líquido. O bruto fica em valor_final
      // para o DRE ver receita cheia, e a taxa fica declarada ao lado.
      valor_recebido: parcela.status === 'RECEBIDO' ? parcela.valor_liquido : 0,
      conta_bancaria_id: ctx.contaBancariaId,
      forma_recebimento: transacao.forma_pagamento || plataforma,
      parcela_numero: parcela.numero,
      total_parcelas: parcela.total,
      boleto_emitido: false, boleto_codigo: '', boleto_url: '',
      status: statusConta,
      rateio: [], anexos: [],
      observacoes: `Gerada pela integração com ${plataforma}. Transação ${transacao.id_transacao}.`,
      plataforma_origem: plataforma,
      plataforma_transacao: transacao.id_transacao,
      plataforma_parcela_id: parcela.id_externo,
      plataforma_taxa: parcela.valor_taxa,
      plataforma_liquido: parcela.valor_liquido,
      plataforma_status: parcela.status,
      plataforma_antecipada: parcela.antecipada,
      plataforma_assinatura: transacao.id_assinatura,
      moeda: transacao.moeda,
    };

    await exec.query(
      `INSERT INTO contas_receber (id, venda_id, cliente_id, status, data, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE
          SET venda_id = EXCLUDED.venda_id,
              cliente_id = EXCLUDED.cliente_id,
              status = EXCLUDED.status,
              data = EXCLUDED.data,
              updated_at = NOW()`,
      [contaId, ctx.vendaId || '', ctx.clienteId, statusConta, JSON.stringify(conta), tenantId],
    );

    // O caixa persegue um alvo, e não um evento: alvo é o líquido quando
    // a parcela está recebida, e zero em qualquer outro estado. A
    // diferença para o que já foi creditado é o que se move agora — é
    // isso que faz estorno devolver exatamente o que entrou.
    const alvo = parcela.status === 'RECEBIDO' ? round2(num(parcela.valor_liquido)) : 0;
    const jaCreditado = round2(num(creditado[chave]));
    const delta = round2(alvo - jaCreditado);
    if (delta !== 0) {
      await aplicarMovimentoCaixaAtomico(tenantId, ctx.contaBancariaId, delta, exec);
      creditado[chave] = alvo;
      movido = round2(movido + delta);
    }
  }

  return { creditado, movido };
}

// ---------------------------------------------------------------------------
// Entradas: webhook e importação
// ---------------------------------------------------------------------------

export interface ResultadoProcessamento {
  processado: boolean;
  acao: string;
  sincronizacao?: ResultadoSincronizacao;
}

/**
 * Registra o evento e reflete a transação no financeiro.
 *
 * Tudo numa transação só. O índice único (tenant, plataforma, id_externo)
 * é o que segura o reenvio: a plataforma reenvia por desenho quando não
 * recebe 200 a tempo, e sem isso o mesmo aviso entraria duas vezes.
 */
export async function processarEvento(
  tenantId: string,
  plataforma: string,
  evento: EventoNormalizado,
): Promise<ResultadoProcessamento> {
  if (!pool) throw new ErroPlataforma('Banco indisponível.');

  const conf = await carregarCredenciais(tenantId, plataforma);
  const contaBancaria = conf?.config.conta_bancaria_id || null;
  const conciliacaoAutomatica = conf?.config.conciliacao_automatica === true;

  return emTransacao(async (exec: ExecutorSQL) => {
    const ins = await exec.query(
      `INSERT INTO plataformas_eventos (id, tenant_id, plataforma, id_externo, tipo, status, data, created_at)
       VALUES ($1, $2, $3, $4, $5, 'RECEBIDO', $6::jsonb, NOW())
       ON CONFLICT (tenant_id, plataforma, id_externo) DO NOTHING`,
      [generateId(), tenantId, plataforma, evento.id_externo, evento.tipo, JSON.stringify(evento)],
    );
    if ((ins.rowCount ?? 0) === 0) {
      return { processado: false, acao: 'duplicado, ignorado' };
    }

    const marcar = (status: string, erro = '') => exec.query(
      `UPDATE plataformas_eventos SET status = $4, erro = $5
        WHERE tenant_id = $1 AND plataforma = $2 AND id_externo = $3`,
      [tenantId, plataforma, evento.id_externo, status, erro],
    );

    if (evento.tipo === 'IGNORADO') {
      await marcar('IGNORADO');
      return { processado: true, acao: 'evento sem efeito financeiro' };
    }

    const transacao = evento.transacao;

    // Moeda estrangeira não vira real por conta própria: já inflou receita
    // em produção. Fica registrado e aguarda decisão de câmbio.
    if (transacao.moeda && transacao.moeda !== 'BRL') {
      await marcar(
        'PENDENTE_HUMANO',
        `Venda em ${transacao.moeda}. Informe o câmbio e lance manualmente para a receita não sair errada.`,
      );
      return { processado: true, acao: `venda em ${transacao.moeda} separada para conferência` };
    }

    if (round2(num(transacao.valor_bruto)) <= 0) {
      await marcar('IGNORADO', 'Valor zero.');
      return { processado: true, acao: 'valor zero, nada lançado' };
    }

    const r = await sincronizarTransacao(exec, tenantId, plataforma, transacao, {
      contaBancariaId: contaBancaria,
      conciliacaoAutomatica,
    });

    await marcar('PROCESSADO');

    const comoFicou = r.status_conciliacao === 'VINCULADA'
      ? `vinculada à venda ${r.venda_id}`
      : r.status_conciliacao === 'SUGERIDA' ? 'aguardando confirmação da conciliação'
        : 'registrada como venda direta';

    return {
      processado: true,
      acao: `${evento.tipo}: ${r.parcelas} parcela(s), caixa ${r.caixa_movido >= 0 ? '+' : ''}${r.caixa_movido}, ${comoFicou}`,
      sincronizacao: r,
    };
  });
}

export interface ResultadoImportacao {
  plataforma: string;
  encontradas: number;
  novas: number;
  atualizadas: number;
  caixa_movido: number;
  erros: string[];
}

/**
 * Traz o histórico da plataforma e fecha buraco de webhook perdido.
 *
 * Cada transação entra na sua própria transação de banco: uma que falhe
 * não pode derrubar a importação inteira, e o que já entrou fica.
 */
export async function importarPeriodo(
  tenantId: string,
  plataforma: string,
  periodo: { de: string; ate: string },
): Promise<ResultadoImportacao> {
  if (!pool) throw new ErroPlataforma('Banco indisponível.');
  const adapter = acharAdapter(plataforma);
  if (!adapter) throw new ErroPlataforma(`Plataforma desconhecida: ${plataforma}`);
  if (!adapter.importar) {
    throw new ErroPlataforma(`${adapter.nome} não permite importar histórico por API.`);
  }

  const conf = await carregarCredenciais(tenantId, plataforma);
  if (!conf) throw new ErroPlataforma('Credencial não cadastrada para esta plataforma.');

  const transacoes = await adapter.importar(conf.cred, periodo);
  const saida: ResultadoImportacao = {
    plataforma, encontradas: transacoes.length, novas: 0, atualizadas: 0, caixa_movido: 0, erros: [],
  };

  for (const t of transacoes) {
    if (t.moeda && t.moeda !== 'BRL') {
      saida.erros.push(`Transação ${t.id_transacao} em ${t.moeda}: precisa de câmbio informado.`);
      continue;
    }
    try {
      const r = await emTransacao(exec => sincronizarTransacao(exec, tenantId, plataforma, t, {
        contaBancariaId: conf.config.conta_bancaria_id || null,
        conciliacaoAutomatica: conf.config.conciliacao_automatica === true,
      }));
      if (r.criada) saida.novas++; else saida.atualizadas++;
      saida.caixa_movido = round2(saida.caixa_movido + r.caixa_movido);
    } catch (e) {
      saida.erros.push(`Transação ${t.id_transacao}: ${e instanceof Error ? e.message : 'falhou'}`);
    }
  }

  return saida;
}
