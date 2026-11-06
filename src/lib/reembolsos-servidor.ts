/**
 * REEMBOLSOS (E5, parte D, 05/11/2026).
 *
 * Dois sentidos, com as palavras do mercado:
 *  - Reembolso ao cliente: a agência devolve dinheiro ao cliente. Aprovado,
 *    vira conta a PAGAR (para o cliente), com vencimento no prazo.
 *  - Reembolso do fornecedor: o fornecedor devolve à agência. Aprovado, vira
 *    conta a RECEBER (do fornecedor), com vencimento no prazo.
 *
 * Situação: Solicitado → Aprovado → Pago (ou Cancelado). "Pago" acontece
 * quando a conta gerada é liquidada pelo caminho de sempre (POST
 * /api/baixas): a leitura da lista acerta a situação sozinha. O reembolso ao
 * cliente também pode virar crédito do cliente, em vez de dinheiro.
 *
 * As contas geradas NÃO são `auto_gerado`: a regeração da venda nunca mexe
 * nelas. Levam `origem_venda_id` para aparecer na venda e `reembolso_id`.
 */
import { generateId } from './utils';
import { addDias, deCentavos, hojeISO, round2 } from './money';
import type { ExecutorSQL } from './caixa-atomico';
import { criarCredito } from './credito-cliente-servidor';

export const REEMBOLSOS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS reembolsos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    situacao TEXT NOT NULL DEFAULT 'SOLICITADO',
    venda_id TEXT NOT NULL DEFAULT '',
    venda_numero TEXT NOT NULL DEFAULT '',
    cancelamento_id TEXT NOT NULL DEFAULT '',
    produto_id TEXT NOT NULL DEFAULT '',
    pessoa_id TEXT NOT NULL DEFAULT '',
    pessoa_nome TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    prazo DATE,
    centro_custo TEXT NOT NULL DEFAULT '',
    conta_tabela TEXT NOT NULL DEFAULT '',
    conta_id TEXT NOT NULL DEFAULT '',
    credito_id TEXT NOT NULL DEFAULT '',
    vinculado_a TEXT NOT NULL DEFAULT '',
    pago_em DATE,
    motivo_cancelamento TEXT NOT NULL DEFAULT '',
    historico JSONB NOT NULL DEFAULT '[]'::jsonb,
    criado_por TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    avisado_em TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT reembolsos_tipo_ok CHECK (tipo IN ('CLIENTE','FORNECEDOR')),
    CONSTRAINT reembolsos_situacao_ok CHECK (situacao IN ('SOLICITADO','APROVADO','PAGO','CANCELADO')),
    CONSTRAINT reembolsos_valor_ok CHECK (valor_centavos > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_reembolsos_situacao ON reembolsos(tenant_id, situacao, prazo);
  CREATE INDEX IF NOT EXISTS idx_reembolsos_venda ON reembolsos(tenant_id, venda_id);
`;

export type TipoDeReembolso = 'CLIENTE' | 'FORNECEDOR';
export type SituacaoDoReembolso = 'SOLICITADO' | 'APROVADO' | 'PAGO' | 'CANCELADO';

export const ROTULO_TIPO_REEMBOLSO: Record<TipoDeReembolso, string> = {
  CLIENTE: 'Ao cliente',
  FORNECEDOR: 'Do fornecedor',
};
export const ROTULO_SITUACAO_REEMBOLSO: Record<SituacaoDoReembolso, string> = {
  SOLICITADO: 'Solicitado',
  APROVADO: 'Aprovado',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
};

export interface Reembolso {
  id: string;
  tipo: TipoDeReembolso;
  situacao: SituacaoDoReembolso;
  venda_id: string;
  venda_numero: string;
  cancelamento_id: string;
  produto_id: string;
  pessoa_id: string;
  pessoa_nome: string;
  valor_centavos: number;
  descricao: string;
  prazo: string;
  centro_custo: string;
  conta_tabela: '' | 'contas_receber' | 'contas_pagar';
  conta_id: string;
  credito_id: string;
  vinculado_a: string;
  pago_em: string;
  motivo_cancelamento: string;
  historico: Array<{ em: string; quem: string; de: string; para: string; nota: string }>;
  criado_por: string;
  criado_em: string;
  /** Calculado na leitura. */
  atrasado: boolean;
}

export class ErroReembolso extends Error {
  codigo: string;
  status: number;
  constructor(codigo: string, mensagem: string, status = 400) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
    this.name = 'ErroReembolso';
  }
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataISO = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function linha(r: Record<string, unknown>, hoje: string): Reembolso {
  const situacao = txt(r.situacao) as SituacaoDoReembolso;
  const prazo = r.prazo ? dataISO(r.prazo) : '';
  return {
    id: txt(r.id), tipo: txt(r.tipo) as TipoDeReembolso, situacao, venda_id: txt(r.venda_id), venda_numero: txt(r.venda_numero),
    cancelamento_id: txt(r.cancelamento_id), produto_id: txt(r.produto_id), pessoa_id: txt(r.pessoa_id), pessoa_nome: txt(r.pessoa_nome),
    valor_centavos: Number(r.valor_centavos) || 0, descricao: txt(r.descricao), prazo, centro_custo: txt(r.centro_custo),
    conta_tabela: txt(r.conta_tabela) as Reembolso['conta_tabela'], conta_id: txt(r.conta_id), credito_id: txt(r.credito_id),
    vinculado_a: txt(r.vinculado_a), pago_em: r.pago_em ? dataISO(r.pago_em) : '', motivo_cancelamento: txt(r.motivo_cancelamento),
    historico: Array.isArray(r.historico) ? r.historico as Reembolso['historico'] : [], criado_por: txt(r.criado_por),
    criado_em: r.criado_em instanceof Date ? r.criado_em.toISOString() : txt(r.criado_em),
    atrasado: (situacao === 'SOLICITADO' || situacao === 'APROVADO') && Boolean(prazo) && prazo < hoje,
  };
}

async function historico(exec: ExecutorSQL, tenantId: string, id: string, de: string, para: string, quem: string, nota = ''): Promise<void> {
  await exec.query(
    `UPDATE reembolsos SET historico = historico || $3::jsonb, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, JSON.stringify([{ em: new Date().toISOString(), quem, de, para, nota }])],
  );
}

export interface NovoReembolso {
  tipo: TipoDeReembolso;
  venda_id?: string;
  venda_numero?: string;
  cancelamento_id?: string;
  produto_id?: string;
  pessoa_id: string;
  pessoa_nome: string;
  valor_centavos: number;
  descricao: string;
  prazo?: string;
  centro_custo?: string;
  vinculado_a?: string;
  /** Já nasce aprovado (gera a conta na hora). */
  aprovar?: boolean;
}

export const DIAS_PADRAO_DO_PRAZO: Record<TipoDeReembolso, number> = { CLIENTE: 7, FORNECEDOR: 30 };

export async function criarReembolso(exec: ExecutorSQL, tenantId: string, n: NovoReembolso, usuario: string): Promise<Reembolso> {
  if (n.tipo !== 'CLIENTE' && n.tipo !== 'FORNECEDOR') throw new ErroReembolso('TIPO', 'Diga se o reembolso é ao cliente ou do fornecedor.');
  const valor = Math.round(n.valor_centavos);
  if (!(valor > 0)) throw new ErroReembolso('VALOR', 'O reembolso precisa de valor maior que zero.');
  if (!n.pessoa_id && !n.pessoa_nome.trim()) throw new ErroReembolso('PESSOA', n.tipo === 'CLIENTE' ? 'Diga para quem devolver.' : 'Diga qual fornecedor devolve.');
  const hoje = hojeISO();
  const prazo = n.prazo && ISO.test(n.prazo) ? n.prazo : addDias(hoje, DIAS_PADRAO_DO_PRAZO[n.tipo]);
  const id = generateId();
  await exec.query(
    `INSERT INTO reembolsos (tenant_id, id, tipo, situacao, venda_id, venda_numero, cancelamento_id, produto_id, pessoa_id, pessoa_nome, valor_centavos, descricao, prazo, centro_custo, vinculado_a, criado_por, historico)
     VALUES ($1,$2,$3,'SOLICITADO',$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13,$14,$15,$16::jsonb)`,
    [tenantId, id, n.tipo, n.venda_id ?? '', n.venda_numero ?? '', n.cancelamento_id ?? '', n.produto_id ?? '', n.pessoa_id, n.pessoa_nome.trim(), valor,
      n.descricao.slice(0, 300), prazo, n.centro_custo ?? '', n.vinculado_a ?? '', usuario,
      JSON.stringify([{ em: new Date().toISOString(), quem: usuario, de: '', para: 'SOLICITADO', nota: '' }])],
  );
  if (n.aprovar) return aprovarReembolso(exec, tenantId, id, usuario);
  return (await lerReembolso(exec, tenantId, id))!;
}

export async function lerReembolso(exec: ExecutorSQL, tenantId: string, id: string): Promise<Reembolso | null> {
  const { rows } = await exec.query(`SELECT * FROM reembolsos WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows.length ? linha(rows[0], hojeISO()) : null;
}

async function travar(exec: ExecutorSQL, tenantId: string, id: string): Promise<Reembolso> {
  const { rows } = await exec.query(`SELECT * FROM reembolsos WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
  if (!rows.length) throw new ErroReembolso('NAO_ENCONTRADO', 'Reembolso não encontrado.', 404);
  return linha(rows[0], hojeISO());
}

/** Aprovar gera a conta: a pagar ao cliente, ou a receber do fornecedor. */
export async function aprovarReembolso(exec: ExecutorSQL, tenantId: string, id: string, usuario: string, opcoes: { prazo?: string } = {}): Promise<Reembolso> {
  const r = await travar(exec, tenantId, id);
  if (r.situacao !== 'SOLICITADO') throw new ErroReembolso('SITUACAO', 'Só se aprova reembolso solicitado.', 409);
  const prazo = opcoes.prazo && ISO.test(opcoes.prazo) ? opcoes.prazo : r.prazo || addDias(hojeISO(), DIAS_PADRAO_DO_PRAZO[r.tipo]);
  const valor = round2(deCentavos(r.valor_centavos));
  const hoje = hojeISO();
  const contaId = generateId();
  const descricao = r.tipo === 'CLIENTE'
    ? `Reembolso ao cliente · ${r.pessoa_nome}${r.venda_numero ? ` · Venda ${r.venda_numero}` : ''}`
    : `Reembolso do fornecedor · ${r.pessoa_nome}${r.venda_numero ? ` · Venda ${r.venda_numero}` : ''}`;
  const comum = {
    id: contaId, descricao, valor_original: valor, valor_final: valor, juros: 0, multa: 0, desconto: 0,
    data_emissao: hoje, data_vencimento: prazo, status: 'PENDENTE', categoria_id: '', centro_custo: r.centro_custo,
    rateio: [], anexos: [], observacoes: r.descricao, origem: 'OUTROS', reembolso_id: r.id,
    venda_id: r.venda_id || null, grupo_id: null, origem_venda_id: r.venda_id || undefined, auto_gerado: false,
    parcela_numero: 1, total_parcelas: 1, conta_bancaria_id: null,
  };
  if (r.tipo === 'CLIENTE') {
    const conta = {
      ...comum, fornecedor_id: '', fornecedor_nome: r.pessoa_nome, cliente_id: r.pessoa_id, cliente_nome: r.pessoa_nome,
      moeda: 'BRL', cambio: 1, valor_brl: valor, data_pagamento: null, valor_pago: null, forma_pagamento: '', cartao_id: null, comprovante: '',
      natureza_custo: 'VARIAVEL', is_custo_comercial: false,
    };
    await exec.query(
      `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at) VALUES ($1, $2, '', 'PENDENTE', $3::jsonb, NOW(), NOW())`,
      [contaId, tenantId, JSON.stringify(conta)],
    );
  } else {
    const conta = {
      ...comum, cliente_id: r.pessoa_id, cliente_nome: r.pessoa_nome, fornecedor_id: r.pessoa_id, fornecedor_nome: r.pessoa_nome,
      data_recebimento: null, valor_recebido: null, forma_recebimento: '', taxa: 0, taxa_plataforma: '',
      boleto_emitido: false, boleto_codigo: '', boleto_url: '',
    };
    await exec.query(
      `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, $4, 'PENDENTE', $5::jsonb, NOW(), NOW())`,
      [contaId, tenantId, r.venda_id, r.pessoa_id, JSON.stringify(conta)],
    );
  }
  await exec.query(
    `UPDATE reembolsos SET situacao = 'APROVADO', prazo = $3::date, conta_tabela = $4, conta_id = $5, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, prazo, r.tipo === 'CLIENTE' ? 'contas_pagar' : 'contas_receber', contaId],
  );
  await historico(exec, tenantId, id, 'SOLICITADO', 'APROVADO', usuario, r.tipo === 'CLIENTE' ? 'Conta a pagar ao cliente gerada.' : 'Conta a receber do fornecedor gerada.');
  return (await lerReembolso(exec, tenantId, id))!;
}

/** Cancela o reembolso. A conta gerada, se ainda em aberto, é cancelada junto; já paga, recusa. */
export async function cancelarReembolso(exec: ExecutorSQL, tenantId: string, id: string, motivo: string, usuario: string): Promise<Reembolso> {
  if (motivo.trim().length < 5) throw new ErroReembolso('MOTIVO', 'Diga o motivo (pelo menos 5 letras).');
  const r = await travar(exec, tenantId, id);
  if (r.situacao === 'PAGO' || r.situacao === 'CANCELADO') throw new ErroReembolso('SITUACAO', r.situacao === 'PAGO' ? 'Reembolso já pago: para desfazer, estorne a baixa da conta.' : 'Reembolso já cancelado.', 409);
  if (r.conta_id && r.conta_tabela) {
    const { rows } = await exec.query(`SELECT data FROM ${r.conta_tabela} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, r.conta_id]);
    const st = txt((rows[0]?.data as Record<string, unknown> | undefined)?.status);
    if (['PAGO', 'RECEBIDO', 'PARCIAL'].includes(st)) throw new ErroReembolso('CONTA_BAIXADA', 'A conta deste reembolso já tem pagamento. Estorne a baixa antes de cancelar.', 409);
    if (rows.length) {
      await exec.query(
        `UPDATE ${r.conta_tabela} SET data = jsonb_set(data, '{status}', '"CANCELADO"', true), status = 'CANCELADO', updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, r.conta_id],
      );
    }
  }
  await exec.query(`UPDATE reembolsos SET situacao = 'CANCELADO', motivo_cancelamento = $3, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, motivo.trim()]);
  await historico(exec, tenantId, id, r.situacao, 'CANCELADO', usuario, motivo.trim());
  return (await lerReembolso(exec, tenantId, id))!;
}

/** Reembolso ao cliente vira crédito na carteira, em vez de dinheiro. */
export async function converterEmCredito(exec: ExecutorSQL, tenantId: string, id: string, usuario: string, opcoes: { validade?: string } = {}): Promise<Reembolso> {
  const r = await travar(exec, tenantId, id);
  if (r.tipo !== 'CLIENTE') throw new ErroReembolso('TIPO', 'Só o reembolso ao cliente vira crédito.');
  if (r.situacao !== 'SOLICITADO' && r.situacao !== 'APROVADO') throw new ErroReembolso('SITUACAO', 'Este reembolso já foi pago ou cancelado.', 409);
  if (r.conta_id && r.conta_tabela) {
    const { rows } = await exec.query(`SELECT data FROM ${r.conta_tabela} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, r.conta_id]);
    const st = txt((rows[0]?.data as Record<string, unknown> | undefined)?.status);
    if (['PAGO', 'PARCIAL'].includes(st)) throw new ErroReembolso('CONTA_BAIXADA', 'A conta deste reembolso já tem pagamento: não dá para virar crédito.', 409);
    if (rows.length) {
      await exec.query(
        `UPDATE ${r.conta_tabela} SET data = jsonb_set(data, '{status}', '"CANCELADO"', true) || '{"observacoes":"Reembolso convertido em crédito do cliente."}'::jsonb, status = 'CANCELADO', updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, r.conta_id],
      );
    }
  }
  const c = await criarCredito(exec, tenantId, {
    cliente_id: r.pessoa_id, cliente_nome: r.pessoa_nome, origem: 'REEMBOLSO_CONVERTIDO', valor_centavos: r.valor_centavos,
    validade: opcoes.validade, descricao: `Reembolso convertido em crédito${r.venda_numero ? ` (venda ${r.venda_numero})` : ''}`,
    origem_venda_id: r.venda_id, origem_venda_numero: r.venda_numero, origem_ref: `reembolso:${r.id}`,
  }, usuario);
  await exec.query(`UPDATE reembolsos SET situacao = 'PAGO', pago_em = $3::date, credito_id = $4, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, hojeISO(), c.id]);
  await historico(exec, tenantId, id, r.situacao, 'PAGO', usuario, 'Virou crédito do cliente.');
  return (await lerReembolso(exec, tenantId, id))!;
}

/** Aprovado cuja conta foi liquidada passa a Pago (a baixa é pelo caminho de sempre). */
export async function acertarSituacoes(exec: ExecutorSQL, tenantId: string): Promise<number> {
  const { rows } = await exec.query(
    `SELECT r.id, r.conta_tabela, COALESCE(cp.data, cr.data) AS conta
       FROM reembolsos r
       LEFT JOIN contas_pagar cp ON r.conta_tabela = 'contas_pagar' AND cp.tenant_id = r.tenant_id AND cp.id = r.conta_id
       LEFT JOIN contas_receber cr ON r.conta_tabela = 'contas_receber' AND cr.tenant_id = r.tenant_id AND cr.id = r.conta_id
      WHERE r.tenant_id = $1 AND r.situacao = 'APROVADO' AND r.conta_id <> ''`,
    [tenantId],
  );
  let n = 0;
  for (const x of rows) {
    const d = (x.conta ?? {}) as Record<string, unknown>;
    const st = txt(d.status);
    if (st !== 'PAGO' && st !== 'RECEBIDO') continue;
    const data = txt(d.data_pagamento || d.data_recebimento).slice(0, 10);
    await exec.query(`UPDATE reembolsos SET situacao = 'PAGO', pago_em = $3::date, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2 AND situacao = 'APROVADO'`,
      [tenantId, txt(x.id), ISO.test(data) ? data : hojeISO()]);
    await historico(exec, tenantId, txt(x.id), 'APROVADO', 'PAGO', 'sistema', 'A conta foi liquidada.');
    n++;
  }
  return n;
}

export interface FiltroDeReembolsos {
  tipo?: TipoDeReembolso | '';
  situacao?: SituacaoDoReembolso | 'em_andamento' | '';
  de?: string;
  ate?: string;
  busca?: string;
  venda_id?: string;
}

export interface ListaDeReembolsos {
  reembolsos: Reembolso[];
  totais: {
    a_devolver_ao_cliente: number;
    a_receber_do_fornecedor: number;
    atrasados: number;
    pagos_no_periodo: number;
  };
}

export async function listarReembolsos(exec: ExecutorSQL, tenantId: string, f: FiltroDeReembolsos = {}, hoje = hojeISO()): Promise<ListaDeReembolsos> {
  await acertarSituacoes(exec, tenantId);
  const cond = ['tenant_id = $1'];
  const args: unknown[] = [tenantId];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (f.tipo) add('tipo = ?', f.tipo);
  if (f.situacao === 'em_andamento') cond.push(`situacao IN ('SOLICITADO','APROVADO')`);
  else if (f.situacao) add('situacao = ?', f.situacao);
  if (f.venda_id) add('venda_id = ?', f.venda_id);
  if (f.de && ISO.test(f.de)) add('COALESCE(prazo, criado_em::date) >= ?::date', f.de);
  if (f.ate && ISO.test(f.ate)) add('COALESCE(prazo, criado_em::date) <= ?::date', f.ate);
  if (f.busca?.trim()) add(`(pessoa_nome ILIKE ? OR venda_numero ILIKE $${args.length + 1} OR descricao ILIKE $${args.length + 1})`, `%${f.busca.trim()}%`);
  const { rows } = await exec.query(`SELECT * FROM reembolsos WHERE ${cond.join(' AND ')} ORDER BY COALESCE(prazo, criado_em::date), criado_em LIMIT 2000`, args);
  const lista = rows.map(r => linha(r, hoje));
  const andamento = (r: Reembolso) => r.situacao === 'SOLICITADO' || r.situacao === 'APROVADO';
  return {
    reembolsos: lista,
    totais: {
      a_devolver_ao_cliente: lista.filter(r => r.tipo === 'CLIENTE' && andamento(r)).reduce((a, r) => a + r.valor_centavos, 0),
      a_receber_do_fornecedor: lista.filter(r => r.tipo === 'FORNECEDOR' && andamento(r)).reduce((a, r) => a + r.valor_centavos, 0),
      atrasados: lista.filter(r => r.atrasado).length,
      pagos_no_periodo: lista.filter(r => r.situacao === 'PAGO').reduce((a, r) => a + r.valor_centavos, 0),
    },
  };
}

/** Reembolsos ao cliente aprovados perto do prazo: um aviso por reembolso. */
export async function avisarReembolsosNoPrazo(
  exec: ExecutorSQL, tenantId: string, hoje: string,
  notificar: (n: { titulo: string; descricao: string; link: string; chave: string; data: Record<string, unknown> }) => Promise<void>,
): Promise<number> {
  const { rows } = await exec.query(
    `SELECT * FROM reembolsos WHERE tenant_id = $1 AND situacao IN ('SOLICITADO','APROVADO') AND avisado_em IS NULL AND prazo IS NOT NULL AND prazo <= $2::date`,
    [tenantId, addDias(hoje, 2)],
  );
  for (const x of rows) {
    const r = linha(x, hoje);
    const br = `${r.prazo.slice(8, 10)}/${r.prazo.slice(5, 7)}`;
    const valor = deCentavos(r.valor_centavos).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await notificar({
      titulo: r.tipo === 'CLIENTE' ? `Reembolso a ${r.pessoa_nome} vence ${r.prazo < hoje ? 'atrasado desde' : 'em'} ${br}` : `Reembolso de ${r.pessoa_nome} esperado até ${br}`,
      descricao: r.tipo === 'CLIENTE'
        ? `${valor} a devolver${r.venda_numero ? ` (venda ${r.venda_numero})` : ''}. ${r.situacao === 'SOLICITADO' ? 'Ainda falta aprovar.' : 'Já aprovado: falta pagar.'}`
        : `${valor} que o fornecedor deve devolver${r.venda_numero ? ` (venda ${r.venda_numero})` : ''}. Cobre o fornecedor se ainda não caiu.`,
      link: `/financeiro-ag/reembolsos?abrir=${encodeURIComponent(r.id)}`,
      chave: `reembolso-prazo:${r.id}`,
      data: { reembolso_id: r.id, venda_id: r.venda_id },
    });
    await exec.query(`UPDATE reembolsos SET avisado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, r.id]);
  }
  return rows.length;
}
