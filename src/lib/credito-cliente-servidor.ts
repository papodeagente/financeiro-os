/**
 * Carteira de crédito do cliente no banco (E5, parte D, 05/11/2026).
 *
 * - `creditos_cliente`: um crédito por origem (cancelamento, pagamento a
 *   mais, reembolso convertido, lançado à mão), com saldo e validade.
 * - `creditos_cliente_movimentos`: o extrato, IMUTÁVEL (gatilho recusa
 *   UPDATE; fica fora da auditoria por ser ele próprio o registro). O saldo
 *   do crédito é sempre a soma dos movimentos dele.
 *
 * Quem usa a carteira:
 *  - a venda com a forma "Crédito do cliente" (parte A deixa a pendência
 *    CREDITO_CLIENTE; `sincronizarCreditosDaVenda` tira da carteira e chama
 *    `resolverPendencia`; se o pagamento cai ou some, devolve);
 *  - a liquidação (E2): a sobra de um recebimento vira crédito
 *    (`creditoDaSobraDaBaixa`), e uma conta a receber pode ser liquidada com
 *    crédito (`usarCreditoNaConta`), sem dinheiro entrar no caixa;
 *  - o cancelamento (sobra vira crédito) e o reembolso convertido.
 * Quem chama abre a transação.
 */
import { generateId } from './utils';
import { addDias, deCentavos, hojeISO, paraCentavos, round2 } from './money';
import type { ExecutorSQL } from './caixa-atomico';
import {
  DIAS_DE_FOLGA_NA_DEVOLUCAO, creditosParaAvisar, creditosParaVencer, extratoDoCliente, planoDeDevolucao, planoDeUso,
  saldoDoCliente, situacaoEm, validadePadrao,
  type Centavos, type Credito, type LinhaDoExtrato, type MovimentoDoCredito, type OrigemDoCredito, type SaldoDoCliente,
  type SituacaoDoCredito, type TipoDeMovimento,
} from './credito-cliente';

export const CREDITO_CLIENTE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS creditos_cliente (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    cliente_id TEXT NOT NULL DEFAULT '',
    cliente_nome TEXT NOT NULL DEFAULT '',
    origem TEXT NOT NULL,
    origem_venda_id TEXT NOT NULL DEFAULT '',
    origem_venda_numero TEXT NOT NULL DEFAULT '',
    origem_ref TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL,
    saldo_centavos BIGINT NOT NULL,
    validade DATE,
    situacao TEXT NOT NULL DEFAULT 'ATIVO',
    descricao TEXT NOT NULL DEFAULT '',
    criado_por TEXT NOT NULL DEFAULT '',
    avisado_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT creditos_cliente_origem_ok CHECK (origem IN ('CANCELAMENTO','SOBRA_DE_PAGAMENTO','REEMBOLSO_CONVERTIDO','AJUSTE')),
    CONSTRAINT creditos_cliente_situacao_ok CHECK (situacao IN ('ATIVO','USADO','VENCIDO','CANCELADO')),
    CONSTRAINT creditos_cliente_valores_ok CHECK (valor_centavos > 0 AND saldo_centavos >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_creditos_cliente_pessoa ON creditos_cliente(tenant_id, cliente_id, situacao);
  CREATE INDEX IF NOT EXISTS idx_creditos_cliente_validade ON creditos_cliente(tenant_id, validade) WHERE situacao = 'ATIVO';
  CREATE UNIQUE INDEX IF NOT EXISTS uq_creditos_cliente_origem ON creditos_cliente(tenant_id, origem, origem_ref) WHERE origem_ref <> '';

  CREATE TABLE IF NOT EXISTS creditos_cliente_movimentos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    credito_id TEXT NOT NULL,
    cliente_id TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL,
    saldo_depois_centavos BIGINT NOT NULL,
    ref_tipo TEXT NOT NULL DEFAULT '',
    ref_id TEXT NOT NULL DEFAULT '',
    ref_chave TEXT NOT NULL DEFAULT '',
    venda_id TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    usuario TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT creditos_mov_tipo_ok CHECK (tipo IN ('ENTRADA','USO','DEVOLUCAO','VENCIMENTO','AJUSTE'))
  );
  CREATE INDEX IF NOT EXISTS idx_creditos_mov_credito ON creditos_cliente_movimentos(tenant_id, credito_id, criado_em);
  CREATE INDEX IF NOT EXISTS idx_creditos_mov_cliente ON creditos_cliente_movimentos(tenant_id, cliente_id, criado_em);
  CREATE INDEX IF NOT EXISTS idx_creditos_mov_ref ON creditos_cliente_movimentos(tenant_id, ref_tipo, ref_id);

  CREATE OR REPLACE FUNCTION creditos_mov_imutavel() RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    RAISE EXCEPTION 'O extrato do crédito do cliente não pode ser alterado.';
  END;
  $fn$;
  DO $creditosmov$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'creditos_cliente_movimentos'::regclass AND tgname = 'creditos_mov_imutavel_v1' AND NOT tgisinternal) THEN
      CREATE TRIGGER creditos_mov_imutavel_v1 BEFORE UPDATE ON creditos_cliente_movimentos
        FOR EACH ROW EXECUTE FUNCTION creditos_mov_imutavel();
    END IF;
  END;
  $creditosmov$;
`;

export class ErroCredito extends Error {
  codigo: string;
  status: number;
  constructor(codigo: string, mensagem: string, status = 400) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
    this.name = 'ErroCredito';
  }
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataISO = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10));
const quando = (v: unknown) => (v instanceof Date ? v.toISOString() : txt(v));

let pronta = false;
/** A carteira existe neste banco? (Teste antigo, ou antes do initDB.) */
export async function carteiraDisponivel(exec: ExecutorSQL): Promise<boolean> {
  if (pronta) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.creditos_cliente_movimentos') IS NOT NULL AS ok`);
  pronta = rows[0]?.ok === true;
  return pronta;
}

function credito(r: Record<string, unknown>): Credito & { avisado_em: string | null } {
  return {
    id: txt(r.id), cliente_id: txt(r.cliente_id), cliente_nome: txt(r.cliente_nome), origem: txt(r.origem) as OrigemDoCredito,
    origem_venda_id: txt(r.origem_venda_id), origem_venda_numero: txt(r.origem_venda_numero),
    valor_centavos: Number(r.valor_centavos) || 0, saldo_centavos: Number(r.saldo_centavos) || 0,
    validade: r.validade ? dataISO(r.validade) : '', situacao: txt(r.situacao) as SituacaoDoCredito,
    descricao: txt(r.descricao), criado_em: quando(r.criado_em), avisado_em: r.avisado_em ? quando(r.avisado_em) : null,
  };
}

function movimento(r: Record<string, unknown>): MovimentoDoCredito {
  return {
    id: txt(r.id), credito_id: txt(r.credito_id), tipo: txt(r.tipo) as TipoDeMovimento,
    valor_centavos: Number(r.valor_centavos) || 0, saldo_depois_centavos: Number(r.saldo_depois_centavos) || 0,
    ref_tipo: txt(r.ref_tipo), ref_id: txt(r.ref_id), ref_chave: txt(r.ref_chave), venda_id: txt(r.venda_id),
    descricao: txt(r.descricao), usuario: txt(r.usuario), criado_em: quando(r.criado_em),
  };
}

async function travarCliente(exec: ExecutorSQL, tenantId: string, clienteId: string): Promise<void> {
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [tenantId, `credito:${clienteId}`]);
}

interface Referencia { tipo: string; id: string; chave?: string; venda_id?: string }

/** Grava um movimento e o novo saldo do crédito (sempre juntos). */
async function mover(
  exec: ExecutorSQL, tenantId: string, c: Credito, tipo: TipoDeMovimento, valor: Centavos, ref: Referencia, descricao: string, usuario: string,
  extra: { validade?: string } = {},
): Promise<Credito> {
  const saldo = c.saldo_centavos + valor;
  if (saldo < 0) throw new ErroCredito('SALDO', 'O crédito não tem saldo para isto.', 409);
  const hoje = hojeISO();
  const validade = extra.validade ?? c.validade;
  const situacao: SituacaoDoCredito = tipo === 'VENCIMENTO' ? 'VENCIDO'
    : saldo <= 0 ? 'USADO'
      : validade && validade < hoje ? 'VENCIDO' : 'ATIVO';
  await exec.query(
    `INSERT INTO creditos_cliente_movimentos (tenant_id, id, credito_id, cliente_id, tipo, valor_centavos, saldo_depois_centavos, ref_tipo, ref_id, ref_chave, venda_id, descricao, usuario)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [tenantId, generateId(), c.id, c.cliente_id, tipo, valor, saldo, ref.tipo, ref.id, ref.chave ?? '', ref.venda_id ?? '', descricao.slice(0, 300), usuario],
  );
  await exec.query(
    `UPDATE creditos_cliente SET saldo_centavos = $3, situacao = $4, validade = NULLIF($5,'')::date, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, c.id, saldo, situacao, validade],
  );
  return { ...c, saldo_centavos: saldo, situacao, validade };
}

// ============================================================
// Entrada
// ============================================================

export interface NovoCredito {
  cliente_id: string;
  cliente_nome: string;
  origem: OrigemDoCredito;
  valor_centavos: Centavos;
  validade?: string;
  descricao: string;
  origem_venda_id?: string;
  origem_venda_numero?: string;
  /** Chave da origem (cancelamento, baixa, reembolso): repetir não cria outro. */
  origem_ref?: string;
}

export async function criarCredito(exec: ExecutorSQL, tenantId: string, n: NovoCredito, usuario: string): Promise<Credito> {
  if (!tenantId) throw new ErroCredito('SEM_EMPRESA', 'Empresa não identificada.');
  const valor = Math.round(n.valor_centavos);
  if (!(valor > 0)) throw new ErroCredito('VALOR', 'O crédito precisa de valor maior que zero.');
  if (!n.cliente_id && !n.cliente_nome) throw new ErroCredito('CLIENTE', 'Diga de qual cliente é o crédito.');
  const ref = (n.origem_ref ?? '').slice(0, 200);
  if (ref) {
    const { rows } = await exec.query(`SELECT * FROM creditos_cliente WHERE tenant_id = $1 AND origem = $2 AND origem_ref = $3`, [tenantId, n.origem, ref]);
    if (rows.length) return credito(rows[0]);
  }
  const hoje = hojeISO();
  const validade = n.validade === undefined ? validadePadrao(hoje) : n.validade;
  if (validade && validade < hoje) throw new ErroCredito('VALIDADE', 'A validade do crédito não pode ser no passado.');
  const id = generateId();
  await exec.query(
    `INSERT INTO creditos_cliente (tenant_id, id, cliente_id, cliente_nome, origem, origem_venda_id, origem_venda_numero, origem_ref, valor_centavos, saldo_centavos, validade, situacao, descricao, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,NULLIF($10,'')::date,'ATIVO',$11,$12)`,
    [tenantId, id, n.cliente_id, n.cliente_nome, n.origem, n.origem_venda_id ?? '', n.origem_venda_numero ?? '', ref, valor, validade, n.descricao.slice(0, 300), usuario],
  );
  const base: Credito = {
    id, cliente_id: n.cliente_id, cliente_nome: n.cliente_nome, origem: n.origem, origem_venda_id: n.origem_venda_id ?? '',
    origem_venda_numero: n.origem_venda_numero ?? '', valor_centavos: valor, saldo_centavos: 0, validade, situacao: 'ATIVO',
    descricao: n.descricao, criado_em: new Date().toISOString(),
  };
  return mover(exec, tenantId, base, 'ENTRADA', valor, { tipo: n.origem.toLowerCase(), id: ref || id, venda_id: n.origem_venda_id }, n.descricao, usuario);
}

// ============================================================
// Leitura
// ============================================================

export async function creditosDoCliente(exec: ExecutorSQL, tenantId: string, clienteId: string): Promise<Array<Credito & { avisado_em: string | null }>> {
  const { rows } = await exec.query(`SELECT * FROM creditos_cliente WHERE tenant_id = $1 AND cliente_id = $2 ORDER BY validade NULLS LAST, criado_em, id`, [tenantId, clienteId]);
  return rows.map(credito);
}

export interface CarteiraDoCliente extends SaldoDoCliente {
  cliente_id: string;
  cliente_nome: string;
  total_recebido: Centavos;
  total_usado: Centavos;
}

/** Uma linha por cliente com crédito (para a tela Crédito do cliente). */
export async function listarCarteiras(exec: ExecutorSQL, tenantId: string, hoje = hojeISO(), filtro: { busca?: string; so_com_saldo?: boolean } = {}): Promise<CarteiraDoCliente[]> {
  if (!(await carteiraDisponivel(exec))) return [];
  const { rows } = await exec.query(`SELECT * FROM creditos_cliente WHERE tenant_id = $1 ORDER BY cliente_nome, criado_em`, [tenantId]);
  const porCliente = new Map<string, Credito[]>();
  for (const r of rows) {
    const c = credito(r);
    const k = c.cliente_id || `nome:${c.cliente_nome.toLowerCase()}`;
    if (!porCliente.has(k)) porCliente.set(k, []);
    porCliente.get(k)!.push(c);
  }
  const { rows: usos } = await exec.query(
    `SELECT cliente_id, SUM(CASE WHEN tipo = 'USO' THEN -valor_centavos WHEN tipo = 'DEVOLUCAO' THEN -valor_centavos ELSE 0 END) AS usado
       FROM creditos_cliente_movimentos WHERE tenant_id = $1 GROUP BY cliente_id`, [tenantId],
  );
  const usado = new Map(usos.map(u => [txt(u.cliente_id), Number(u.usado) || 0]));
  const busca = (filtro.busca ?? '').trim().toLowerCase();
  const lista: CarteiraDoCliente[] = [];
  for (const cs of porCliente.values()) {
    const s = saldoDoCliente(cs, hoje);
    const linha: CarteiraDoCliente = {
      ...s, cliente_id: cs[0].cliente_id, cliente_nome: cs[0].cliente_nome,
      total_recebido: cs.reduce((a, c) => a + c.valor_centavos, 0),
      total_usado: usado.get(cs[0].cliente_id) ?? 0,
    };
    if (filtro.so_com_saldo && s.disponivel <= 0) continue;
    if (busca && !linha.cliente_nome.toLowerCase().includes(busca)) continue;
    lista.push(linha);
  }
  return lista.sort((a, b) => b.disponivel - a.disponivel || a.cliente_nome.localeCompare(b.cliente_nome));
}

export interface ExtratoCompleto {
  cliente_id: string;
  cliente_nome: string;
  saldo: SaldoDoCliente;
  creditos: Array<Credito & { situacao_hoje: SituacaoDoCredito }>;
  extrato: LinhaDoExtrato[];
}

export async function extratoDoClienteNoBanco(exec: ExecutorSQL, tenantId: string, clienteId: string, hoje = hojeISO()): Promise<ExtratoCompleto> {
  const creditos = await creditosDoCliente(exec, tenantId, clienteId);
  const { rows } = await exec.query(`SELECT * FROM creditos_cliente_movimentos WHERE tenant_id = $1 AND cliente_id = $2 ORDER BY criado_em, id`, [tenantId, clienteId]);
  return {
    cliente_id: clienteId,
    cliente_nome: creditos[0]?.cliente_nome ?? '',
    saldo: saldoDoCliente(creditos, hoje),
    creditos: creditos.map(c => ({ ...c, situacao_hoje: situacaoEm(c, hoje) })),
    extrato: extratoDoCliente(rows.map(movimento)),
  };
}

export async function saldoDisponivel(exec: ExecutorSQL, tenantId: string, clienteId: string, hoje = hojeISO()): Promise<Centavos> {
  if (!clienteId || !(await carteiraDisponivel(exec))) return 0;
  return saldoDoCliente(await creditosDoCliente(exec, tenantId, clienteId), hoje).disponivel;
}

// ============================================================
// Uso e devolução, por referência
// ============================================================

/** Quanto um uso (pela referência) ainda tem fora da carteira, por crédito. */
async function usosDaReferencia(exec: ExecutorSQL, tenantId: string, ref: Referencia): Promise<Array<{ credito_id: string; usado_centavos: Centavos; ordem: string }>> {
  const { rows } = await exec.query(
    `SELECT credito_id, -SUM(valor_centavos) AS usado, MAX(criado_em)::text AS ordem
       FROM creditos_cliente_movimentos
      WHERE tenant_id = $1 AND ref_tipo = $2 AND ref_id = $3 AND ($4 = '' OR ref_chave = $4) AND tipo IN ('USO','DEVOLUCAO')
      GROUP BY credito_id`,
    [tenantId, ref.tipo, ref.id, ref.chave ?? ''],
  );
  return rows.map(r => ({ credito_id: txt(r.credito_id), usado_centavos: Number(r.usado) || 0, ordem: txt(r.ordem) })).filter(u => u.usado_centavos > 0);
}

export async function usadoNaReferencia(exec: ExecutorSQL, tenantId: string, ref: Referencia): Promise<Centavos> {
  return (await usosDaReferencia(exec, tenantId, ref)).reduce((a, u) => a + u.usado_centavos, 0);
}

/** Tira até `valor` da carteira do cliente. Devolve quanto saiu. */
export async function usarCredito(
  exec: ExecutorSQL, tenantId: string, clienteId: string, valor: Centavos, ref: Referencia, descricao: string, usuario: string,
  opcoes: { data?: string; preferirVenda?: string; exigirTudo?: boolean } = {},
): Promise<{ usado: Centavos; falta: Centavos }> {
  if (!clienteId || valor <= 0) return { usado: 0, falta: Math.max(0, valor) };
  await travarCliente(exec, tenantId, clienteId);
  const creditos = await creditosDoCliente(exec, tenantId, clienteId);
  const plano = planoDeUso(creditos, valor, opcoes.data ?? hojeISO(), { preferirVenda: opcoes.preferirVenda });
  if (opcoes.exigirTudo && plano.falta > 0) {
    throw new ErroCredito('SALDO', `O cliente tem ${deCentavos(plano.usado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de crédito disponível.`, 409);
  }
  for (const parte of plano.partes) {
    const c = creditos.find(x => x.id === parte.credito_id)!;
    await mover(exec, tenantId, c, 'USO', -parte.valor_centavos, ref, descricao, usuario);
  }
  return { usado: plano.usado, falta: plano.falta };
}

/** Devolve à carteira até `valor` do que a referência usou (nos mesmos créditos). */
export async function devolverUso(exec: ExecutorSQL, tenantId: string, clienteId: string, valor: Centavos, ref: Referencia, descricao: string, usuario: string): Promise<Centavos> {
  if (valor <= 0) return 0;
  if (clienteId) await travarCliente(exec, tenantId, clienteId);
  const usos = await usosDaReferencia(exec, tenantId, ref);
  const hoje = hojeISO();
  let devolvido = 0;
  for (const parte of planoDeDevolucao(usos, valor)) {
    const { rows } = await exec.query(`SELECT * FROM creditos_cliente WHERE tenant_id = $1 AND id = $2`, [tenantId, parte.credito_id]);
    if (!rows.length) continue;
    const c = credito(rows[0]);
    // Volta a um crédito vencido: o cliente ganha uma folga para usar.
    const validade = c.validade && c.validade < hoje ? addDias(hoje, DIAS_DE_FOLGA_NA_DEVOLUCAO) : c.validade;
    await mover(exec, tenantId, c, 'DEVOLUCAO', parte.valor_centavos, ref, descricao, usuario, { validade });
    devolvido += parte.valor_centavos;
  }
  return devolvido;
}

// ============================================================
// Venda: a forma "Crédito do cliente" (pendência da parte A)
// ============================================================

/**
 * Acerta a carteira com as pendências CREDITO_CLIENTE da venda: tira o que
 * falta usar (e resolve a pendência quando cobre tudo) e devolve o que a
 * venda não usa mais (pagamento reduzido ou removido). Rodar de novo não
 * muda nada.
 */
export async function sincronizarCreditosDaVenda(
  exec: ExecutorSQL, tenantId: string, vendaId: string, usuario: { id: string; nome: string },
): Promise<{ usado: Centavos; devolvido: Centavos; faltando: Centavos }> {
  const saida = { usado: 0, devolvido: 0, faltando: 0 };
  if (!(await carteiraDisponivel(exec))) return saida;
  const { rows } = await exec.query(
    `SELECT p.chave, p.pessoa_id, p.pessoa_nome, p.valor_centavos, p.situacao, p.dados, m.numero
       FROM venda_pendencias p LEFT JOIN vendas_modelo m ON m.tenant_id = p.tenant_id AND m.venda_id = p.venda_id
      WHERE p.tenant_id = $1 AND p.venda_id = $2 AND p.tipo = 'CREDITO_CLIENTE'`,
    [tenantId, vendaId],
  );
  const quem = usuario.nome || usuario.id;
  for (const r of rows) {
    const chave = txt(r.chave);
    const ref: Referencia = { tipo: 'venda', id: vendaId, chave, venda_id: vendaId };
    const alvo = txt(r.situacao) === 'CANCELADA' ? 0 : Number(r.valor_centavos) || 0;
    const usado = await usadoNaReferencia(exec, tenantId, ref);
    const numero = txt(r.numero) || vendaId;
    const pessoa = txt(r.pessoa_id);
    if (usado > alvo) {
      saida.devolvido += await devolverUso(exec, tenantId, pessoa, usado - alvo, ref, `Venda ${numero}: o pagamento com crédito diminuiu ou saiu`, quem);
    } else if (usado < alvo && pessoa) {
      const dados = (r.dados ?? {}) as Record<string, unknown>;
      const u = await usarCredito(exec, tenantId, pessoa, alvo - usado, ref, `Venda ${numero} paga com crédito do cliente`, quem, { preferirVenda: txt(dados.venda_origem_credito) });
      saida.usado += u.usado;
      saida.faltando += u.falta;
    } else if (usado < alvo) {
      saida.faltando += alvo - usado;
    }
    const agora = await usadoNaReferencia(exec, tenantId, ref);
    if (alvo > 0 && agora >= alvo && txt(r.situacao) === 'ABERTA') {
      await exec.query(
        `UPDATE venda_pendencias SET situacao = 'RESOLVIDA', resolvido_em = NOW(), resolvido_por = $4, atualizado_em = NOW()
          WHERE tenant_id = $1 AND venda_id = $2 AND chave = $3 AND situacao = 'ABERTA'`,
        [tenantId, vendaId, chave, quem],
      );
    } else if (alvo > 0 && agora < alvo && txt(r.situacao) === 'RESOLVIDA') {
      await exec.query(`UPDATE venda_pendencias SET situacao = 'ABERTA', resolvido_em = NULL, atualizado_em = NOW() WHERE tenant_id = $1 AND venda_id = $2 AND chave = $3`, [tenantId, vendaId, chave]);
    }
    if (alvo > 0) {
      await exec.query(
        `UPDATE venda_pendencias SET dados = dados || jsonb_build_object('usado_centavos', $4::bigint), atualizado_em = NOW() WHERE tenant_id = $1 AND venda_id = $2 AND chave = $3`,
        [tenantId, vendaId, chave, agora],
      );
    }
  }
  return saida;
}

/** Quanto do crédito de cada pagamento "Crédito do cliente" ainda não saiu da carteira. */
export async function creditoNaoUsadoPorPagamento(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<Record<string, Centavos>> {
  const saida: Record<string, Centavos> = {};
  const { rows } = await exec.query(
    `SELECT chave, valor_centavos, situacao, dados FROM venda_pendencias WHERE tenant_id = $1 AND venda_id = $2 AND tipo = 'CREDITO_CLIENTE' AND situacao <> 'CANCELADA'`,
    [tenantId, vendaId],
  );
  const temCarteira = await carteiraDisponivel(exec);
  for (const r of rows) {
    const pagamentoId = txt(((r.dados ?? {}) as Record<string, unknown>).pagamento_id);
    if (!pagamentoId) continue;
    const usado = temCarteira ? await usadoNaReferencia(exec, tenantId, { tipo: 'venda', id: vendaId, chave: txt(r.chave) }) : 0;
    saida[pagamentoId] = Math.max(0, (Number(r.valor_centavos) || 0) - usado);
  }
  return saida;
}

// ============================================================
// Liquidação (E2)
// ============================================================

/** A sobra de um recebimento vira crédito do cliente (tratamento 'credito' da baixa). */
export async function creditoDaSobraDaBaixa(
  exec: ExecutorSQL, tenantId: string, p: { baixa_id: string; conta: Record<string, unknown>; credito_reais: number; usuario: string },
): Promise<Credito | null> {
  const valor = paraCentavos(p.credito_reais);
  if (valor <= 0) return null;
  if (!(await carteiraDisponivel(exec))) throw new ErroCredito('SEM_CARTEIRA', 'A carteira de crédito do cliente ainda não está pronta neste banco.', 409);
  const d = p.conta;
  const clienteId = txt(d.cliente_da_venda_id) || txt(d.cliente_id);
  const nome = txt(d.cliente_da_venda_nome) || txt(d.cliente_nome);
  if (!clienteId && !nome) throw new ErroCredito('CLIENTE', 'Esta conta não diz de qual cliente é: a sobra não pode virar crédito.', 409);
  return criarCredito(exec, tenantId, {
    cliente_id: clienteId, cliente_nome: nome, origem: 'SOBRA_DE_PAGAMENTO', valor_centavos: valor,
    descricao: `Pagamento a mais em ${txt(d.descricao) || 'conta a receber'}`,
    origem_venda_id: txt(d.origem_venda_id) || txt(d.venda_id), origem_ref: `baixa:${p.baixa_id}`,
  }, p.usuario);
}

/**
 * O estorno de uma baixa desfaz o que ela fez na carteira: a sobra que virou
 * crédito sai (se ainda não foi usada), e o crédito usado para liquidar volta.
 */
export async function desfazerCreditoDaBaixa(exec: ExecutorSQL, tenantId: string, baixaId: string, usuario: string): Promise<void> {
  if (!(await carteiraDisponivel(exec))) return;
  const { rows } = await exec.query(`SELECT * FROM creditos_cliente WHERE tenant_id = $1 AND origem = 'SOBRA_DE_PAGAMENTO' AND origem_ref = $2`, [tenantId, `baixa:${baixaId}`]);
  for (const r of rows) {
    const c = credito(r);
    await travarCliente(exec, tenantId, c.cliente_id);
    const atual = credito((await exec.query(`SELECT * FROM creditos_cliente WHERE tenant_id = $1 AND id = $2`, [tenantId, c.id])).rows[0]);
    if (atual.saldo_centavos < atual.valor_centavos) {
      throw new ErroCredito('CREDITO_USADO', 'A sobra desta baixa virou crédito e o cliente já usou parte dele. Devolva o uso antes de estornar.', 409);
    }
    await mover(exec, tenantId, atual, 'AJUSTE', -atual.saldo_centavos, { tipo: 'baixa', id: baixaId }, 'Baixa estornada: a sobra deixou de existir', usuario);
    await exec.query(`UPDATE creditos_cliente SET situacao = 'CANCELADO' WHERE tenant_id = $1 AND id = $2`, [tenantId, c.id]);
  }
  const ref: Referencia = { tipo: 'conta_receber_baixa', id: baixaId };
  const usado = await usadoNaReferencia(exec, tenantId, ref);
  if (usado > 0) {
    const { rows: m } = await exec.query(`SELECT cliente_id FROM creditos_cliente_movimentos WHERE tenant_id = $1 AND ref_tipo = $2 AND ref_id = $3 LIMIT 1`, [tenantId, ref.tipo, ref.id]);
    await devolverUso(exec, tenantId, txt(m[0]?.cliente_id), usado, ref, 'Baixa com crédito estornada: o crédito volta', usuario);
  }
}

/**
 * Liquida (no todo ou em parte) uma conta a receber com o crédito do
 * cliente. Nenhum dinheiro entra no caixa: a conta é baixada e a carteira
 * diminui. Fica no histórico de baixas como forma "Crédito do cliente", com
 * estorno pelo caminho de sempre.
 */
export async function usarCreditoNaConta(
  exec: ExecutorSQL, tenantId: string, p: { conta_receber_id: string; valor_centavos: Centavos; data?: string; usuario: { id: string; nome: string } },
): Promise<{ baixa_id: string; status_depois: string; usado: Centavos }> {
  if (!(await carteiraDisponivel(exec))) throw new ErroCredito('SEM_CARTEIRA', 'A carteira de crédito ainda não está pronta.', 409);
  const { rows } = await exec.query(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, p.conta_receber_id]);
  if (!rows.length) throw new ErroCredito('NAO_ENCONTRADA', 'Conta a receber não encontrada.', 404);
  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  const status = txt(d.status);
  if (status === 'CANCELADO') throw new ErroCredito('CANCELADA', 'Esta conta está cancelada.', 409);
  const recebido = status === 'RECEBIDO' ? round2(Number(d.valor_recebido) || Number(d.valor_final) || 0) : round2(Number(d.valor_recebido) || 0);
  const emAberto = paraCentavos(round2((Number(d.valor_final) || 0) - recebido));
  if (emAberto <= 0) throw new ErroCredito('QUITADA', 'Esta conta já está liquidada.', 409);
  const valor = Math.min(Math.round(p.valor_centavos), emAberto);
  if (valor <= 0) throw new ErroCredito('VALOR', 'Informe quanto do crédito usar.');
  const clienteId = txt(d.cliente_id);
  if (!clienteId) throw new ErroCredito('CLIENTE', 'Esta conta não está ligada a um cliente cadastrado.', 409);
  const baixaId = generateId();
  const data = (p.data || hojeISO()).slice(0, 10);
  await usarCredito(exec, tenantId, clienteId, valor, { tipo: 'conta_receber_baixa', id: baixaId, venda_id: txt(d.origem_venda_id) || txt(d.venda_id) },
    `Usado em ${txt(d.descricao) || 'conta a receber'}`, p.usuario.nome || p.usuario.id, { data, exigirTudo: true });
  const novoRecebido = round2(recebido + deCentavos(valor));
  const quitou = paraCentavos(round2((Number(d.valor_final) || 0) - novoRecebido)) <= 0;
  const novo = { ...d, valor_recebido: novoRecebido, status: quitou ? 'RECEBIDO' : 'PARCIAL', data_recebimento: data, ...(txt(d.forma_recebimento) ? {} : { forma_recebimento: 'CREDITO_CLIENTE' }) };
  await exec.query(`UPDATE contas_receber SET data = $3::jsonb, status = $4, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, p.conta_receber_id, JSON.stringify(novo), novo.status]);
  await exec.query(
    `INSERT INTO baixas (id, tenant_id, tipo, titulo_tabela, titulo_id, data_baixa, conta_bancaria_id, forma, valor_centavos, caixa_centavos, origem, usuario_id, usuario_nome, observacao, dados)
     VALUES ($1, $2, 'baixa', 'contas_receber', $3, $4::date, NULL, 'CREDITO_CLIENTE', $5, 0, 'tela', $6, $7, $8, $9::jsonb)`,
    [baixaId, tenantId, p.conta_receber_id, data, valor, p.usuario.id || null, p.usuario.nome || null, 'Liquidada com crédito do cliente', JSON.stringify({ uso_de_credito: true })],
  );
  return { baixa_id: baixaId, status_depois: novo.status, usado: valor };
}

/** Ajuste à mão (com motivo): soma ou tira saldo de um crédito. */
export async function ajustarCredito(exec: ExecutorSQL, tenantId: string, creditoId: string, valorCentavos: Centavos, motivo: string, usuario: string): Promise<Credito> {
  if (txt(motivo).trim().length < 5) throw new ErroCredito('MOTIVO', 'Diga o motivo do ajuste (pelo menos 5 letras).');
  const { rows } = await exec.query(`SELECT * FROM creditos_cliente WHERE tenant_id = $1 AND id = $2`, [tenantId, creditoId]);
  if (!rows.length) throw new ErroCredito('NAO_ENCONTRADO', 'Crédito não encontrado.', 404);
  const c = credito(rows[0]);
  await travarCliente(exec, tenantId, c.cliente_id);
  return mover(exec, tenantId, c, 'AJUSTE', Math.round(valorCentavos), { tipo: 'manual', id: creditoId }, motivo.trim(), usuario);
}

// ============================================================
// Agendador: vencer e avisar
// ============================================================

/** Vence os créditos com validade passada e avisa (uma vez por crédito) os que vencem em breve. */
export async function vencerEAvisarCreditos(
  exec: ExecutorSQL, tenantId: string, hoje: string,
  notificar: (n: { titulo: string; descricao: string; link: string; chave: string; data: Record<string, unknown> }) => Promise<void>,
): Promise<{ vencidos: number; avisados: number }> {
  if (!(await carteiraDisponivel(exec))) return { vencidos: 0, avisados: 0 };
  const { rows } = await exec.query(`SELECT * FROM creditos_cliente WHERE tenant_id = $1 AND situacao = 'ATIVO' AND saldo_centavos > 0`, [tenantId]);
  const creditos = rows.map(credito);
  let vencidos = 0;
  for (const c of creditosParaVencer(creditos, hoje)) {
    await travarCliente(exec, tenantId, c.cliente_id);
    await mover(exec, tenantId, c, 'VENCIMENTO', -c.saldo_centavos, { tipo: 'validade', id: c.id }, `Venceu em ${c.validade}`, 'sistema');
    vencidos++;
  }
  let avisados = 0;
  for (const c of creditosParaAvisar(creditos.filter(x => !(x.validade && x.validade < hoje)), hoje)) {
    const br = `${c.validade.slice(8, 10)}/${c.validade.slice(5, 7)}/${c.validade.slice(0, 4)}`;
    await notificar({
      titulo: `Crédito de ${c.cliente_nome || 'cliente'} vence em ${br}`,
      descricao: `${deCentavos(c.saldo_centavos).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de crédito ainda não usado. Lembre o cliente ou ofereça a próxima viagem antes de vencer.`,
      link: `/financeiro-ag/creditos?cliente=${encodeURIComponent(c.cliente_id)}`,
      chave: `credito-vencendo:${c.id}`,
      data: { credito_id: c.id, cliente_id: c.cliente_id },
    });
    await exec.query(`UPDATE creditos_cliente SET avisado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, c.id]);
    avisados++;
  }
  return { vencidos, avisados };
}
