/**
 * CHEQUES EMITIDOS no servidor (E7, frente C, 06/11/2026).
 *
 * Tabelas (idempotentes; o initDB roda antes do razão e da auditoria, as duas
 * são auditadas):
 *  - `cheques_emitidos`: um cheque do talão da agência (número único por
 *    conta bancária), o favorecido, o valor, a data, o "bom para", a cidade,
 *    a situação (Emitido, Compensado, Devolvido, Cancelado), de onde ele
 *    nasceu (emitido a partir de uma conta a pagar, ou registrado pela
 *    liquidação com forma cheque) e a linha do extrato do banco em que ele
 *    foi compensado, quando a pessoa liga.
 *  - `cheque_baixas`: as liquidações pagas com o cheque. Um cheque pode pagar
 *    várias contas (liquidação em lote com o mesmo número), por isso a
 *    ligação é uma tabela própria, uma linha por baixa.
 *
 * Ligação com a liquidação (baixas-servidor.ts): a baixa de conta a pagar
 * com forma cheque e número chama `chequeDaLiquidacao` na MESMA transação.
 * Se o cheque daquele número já existe na conta (emitido antes, para
 * imprimir), a baixa se liga a ele; se não existe, o cheque nasce da
 * liquidação, com o valor pago. O estorno da baixa chama `desligarDaBaixa`:
 * a ligação sai; o cheque que nasceu da liquidação perde o valor daquela
 * conta e, sem nenhuma conta mais, fica Cancelado ("liquidação estornada");
 * o cheque emitido antes continua Emitido, pronto para outra liquidação ou
 * para ser cancelado.
 *
 * Nada aqui move dinheiro: quem move o caixa é a liquidação (registrarBaixas).
 * Compensar só diz que o banco descontou o cheque.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { hojeISO, num } from './money';
import {
  normalizarConfigDoCheque, proximoNumero, recusaDaTransicao, recusaDoMotivo, SITUACOES_DO_CHEQUE,
  type AcaoDoCheque, type ConfigDoCheque, type PedidoDeEmissao, type SituacaoDoCheque, TRANSICOES_DO_CHEQUE,
} from './cheques';

export const CHEQUES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cheques_emitidos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    numero TEXT NOT NULL,
    conta_bancaria_id TEXT NOT NULL,
    favorecido TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL,
    emissao DATE NOT NULL,
    bom_para DATE,
    cidade TEXT NOT NULL DEFAULT '',
    situacao TEXT NOT NULL DEFAULT 'EMITIDO',
    origem TEXT NOT NULL DEFAULT 'titulo',
    titulo_tabela TEXT,
    titulo_id TEXT,
    extrato_id TEXT,
    compensado_em DATE,
    motivo TEXT NOT NULL DEFAULT '',
    impresso_em TIMESTAMPTZ,
    impressoes INTEGER NOT NULL DEFAULT 0,
    situacao_em TIMESTAMPTZ,
    situacao_por TEXT,
    criado_por TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT cheques_emitidos_situacao_ok CHECK (situacao IN ('EMITIDO','COMPENSADO','DEVOLVIDO','CANCELADO')),
    CONSTRAINT cheques_emitidos_origem_ok CHECK (origem IN ('titulo','liquidacao')),
    CONSTRAINT cheques_emitidos_valor_ok CHECK (valor_centavos >= 0)
  );
  -- 000123 e 123 são o mesmo cheque: o número único ignora os zeros à esquerda.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cheques_emitidos_numero ON cheques_emitidos(tenant_id, conta_bancaria_id, (ltrim(numero, '0')));
  CREATE INDEX IF NOT EXISTS idx_cheques_emitidos_situacao ON cheques_emitidos(tenant_id, situacao, emissao);
  CREATE INDEX IF NOT EXISTS idx_cheques_emitidos_titulo ON cheques_emitidos(tenant_id, titulo_id) WHERE titulo_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS cheque_baixas (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    cheque_id TEXT NOT NULL,
    baixa_id TEXT NOT NULL,
    titulo_tabela TEXT NOT NULL,
    titulo_id TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cheque_baixas_baixa ON cheque_baixas(tenant_id, baixa_id);
  CREATE INDEX IF NOT EXISTS idx_cheque_baixas_cheque ON cheque_baixas(tenant_id, cheque_id);
`;

export class ErroCheque extends Error {
  status: number;
  constructor(mensagem: string, status = 400) { super(mensagem); this.status = status; this.name = 'ErroCheque'; }
}

type Linha = Record<string, unknown>;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const dataISO = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const quando = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export interface LigacaoDoCheque { baixa_id: string; titulo_tabela: string; titulo_id: string; valor_centavos: number; descricao: string }

export interface Cheque {
  id: string;
  numero: string;
  conta_bancaria_id: string;
  conta_nome: string;
  favorecido: string;
  valor_centavos: number;
  emissao: string;
  bom_para: string | null;
  cidade: string;
  situacao: SituacaoDoCheque;
  origem: 'titulo' | 'liquidacao';
  titulo_tabela: string | null;
  titulo_id: string | null;
  titulo_descricao: string;
  extrato_id: string | null;
  compensado_em: string | null;
  motivo: string;
  impresso_em: string | null;
  impressoes: number;
  situacao_em: string | null;
  criado_por: string;
  criado_em: string | null;
  liquidacoes: LigacaoDoCheque[];
}

async function tabelaExiste(exec: ExecutorSQL): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass('public.cheques_emitidos') IS NOT NULL AS ok`);
  return rows[0]?.ok === true;
}

function daLinha(r: Linha, ligacoes: LigacaoDoCheque[] = []): Cheque {
  const sit = txt(r.situacao).toUpperCase() as SituacaoDoCheque;
  return {
    id: txt(r.id), numero: txt(r.numero), conta_bancaria_id: txt(r.conta_bancaria_id), conta_nome: txt(r.conta_nome),
    favorecido: txt(r.favorecido), valor_centavos: Number(r.valor_centavos) || 0,
    emissao: dataISO(r.emissao) ?? '', bom_para: dataISO(r.bom_para), cidade: txt(r.cidade),
    situacao: (SITUACOES_DO_CHEQUE as readonly string[]).includes(sit) ? sit : 'EMITIDO',
    origem: txt(r.origem) === 'liquidacao' ? 'liquidacao' : 'titulo',
    titulo_tabela: txt(r.titulo_tabela) || null, titulo_id: txt(r.titulo_id) || null, titulo_descricao: txt(r.titulo_descricao),
    extrato_id: txt(r.extrato_id) || null, compensado_em: dataISO(r.compensado_em), motivo: txt(r.motivo),
    impresso_em: quando(r.impresso_em), impressoes: Number(r.impressoes) || 0, situacao_em: quando(r.situacao_em),
    criado_por: txt(r.criado_por), criado_em: quando(r.criado_em), liquidacoes: ligacoes,
  };
}

const SELECT_CHEQUE = `
  SELECT c.*, COALESCE(b.data->>'nome', '') AS conta_nome, COALESCE(t.data->>'descricao', '') AS titulo_descricao
    FROM cheques_emitidos c
    LEFT JOIN contas_bancarias b ON b.id = c.conta_bancaria_id AND b.tenant_id = c.tenant_id
    LEFT JOIN contas_pagar t ON t.id = c.titulo_id AND t.tenant_id = c.tenant_id`;

async function ligacoesDe(exec: ExecutorSQL, tenantId: string, ids: string[]): Promise<Map<string, LigacaoDoCheque[]>> {
  const mapa = new Map<string, LigacaoDoCheque[]>();
  if (!ids.length) return mapa;
  const { rows } = await exec.query(
    `SELECT l.cheque_id, l.baixa_id, l.titulo_tabela, l.titulo_id, l.valor_centavos, COALESCE(t.data->>'descricao', '') AS descricao
       FROM cheque_baixas l LEFT JOIN contas_pagar t ON t.id = l.titulo_id AND t.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1 AND l.cheque_id = ANY($2::text[]) ORDER BY l.criado_em, l.id`,
    [tenantId, ids],
  );
  for (const r of rows) {
    const k = txt(r.cheque_id);
    const lista = mapa.get(k) ?? [];
    lista.push({ baixa_id: txt(r.baixa_id), titulo_tabela: txt(r.titulo_tabela), titulo_id: txt(r.titulo_id), valor_centavos: Number(r.valor_centavos) || 0, descricao: txt(r.descricao) });
    mapa.set(k, lista);
  }
  return mapa;
}

export async function lerCheque(exec: ExecutorSQL, tenantId: string, id: string): Promise<Cheque | null> {
  const { rows } = await exec.query(`${SELECT_CHEQUE} WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, id]);
  if (!rows.length) return null;
  const lig = await ligacoesDe(exec, tenantId, [id]);
  return daLinha(rows[0], lig.get(id) ?? []);
}

// ============================================================
// Configuração por conta bancária (contas_bancarias.data.cheque)
// ============================================================

export async function lerConfigDoCheque(exec: ExecutorSQL, tenantId: string, contaId: string): Promise<{ conta_nome: string; config: ConfigDoCheque; proximo_numero: string } | null> {
  const { rows } = await exec.query(`SELECT data FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`, [tenantId, contaId]);
  if (!rows.length) return null;
  const d = (rows[0].data ?? {}) as Linha;
  const config = normalizarConfigDoCheque(d.cheque);
  let ultimo = config.ultimo_numero;
  if (await tabelaExiste(exec)) {
    // O maior número já usado nesta conta também conta (cheque registrado pela liquidação).
    const { rows: m } = await exec.query(
      `SELECT numero FROM cheques_emitidos WHERE tenant_id = $1 AND conta_bancaria_id = $2 ORDER BY length(numero) DESC, numero DESC LIMIT 1`,
      [tenantId, contaId],
    );
    const maior = txt(m[0]?.numero);
    if (maior && (maior.length > ultimo.length || (maior.length === ultimo.length && maior > ultimo))) ultimo = maior;
  }
  return { conta_nome: txt(d.nome), config, proximo_numero: proximoNumero(ultimo) };
}

/** Grava o ajuste da conta. Só o pedaço `cheque` do JSON muda; o resto da conta fica como está. */
export async function salvarConfigDoCheque(exec: ExecutorSQL, tenantId: string, contaId: string, entrada: unknown): Promise<ConfigDoCheque> {
  const { rows } = await exec.query(`SELECT data FROM contas_bancarias WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, contaId]);
  if (!rows.length) throw new ErroCheque('Conta bancária não encontrada.', 404);
  const atual = normalizarConfigDoCheque(((rows[0].data ?? {}) as Linha).cheque);
  const nova = normalizarConfigDoCheque({ ...atual, ...(entrada && typeof entrada === 'object' ? entrada : {}) });
  await exec.query(
    `UPDATE contas_bancarias SET data = jsonb_set(data, '{cheque}', $3::jsonb, true), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, contaId, JSON.stringify(nova)],
  );
  return nova;
}

async function anotarUltimoNumero(exec: ExecutorSQL, tenantId: string, contaId: string, numero: string): Promise<void> {
  const { rows } = await exec.query(`SELECT data->'cheque' AS c FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`, [tenantId, contaId]);
  if (!rows.length) return;
  const cfg = normalizarConfigDoCheque(rows[0].c);
  const u = cfg.ultimo_numero;
  if (u && (u.length > numero.length || (u.length === numero.length && u >= numero))) return;
  await exec.query(
    `UPDATE contas_bancarias SET data = jsonb_set(data, '{cheque}', $3::jsonb, true) WHERE tenant_id = $1 AND id = $2`,
    [tenantId, contaId, JSON.stringify({ ...cfg, ultimo_numero: numero })],
  );
}

// ============================================================
// Emitir a partir de uma conta a pagar
// ============================================================

export interface QuemFaz { id: string; nome: string }

/**
 * Emite (registra para imprimir) um cheque para uma conta a pagar em aberto.
 * `contasLiberadas`: as contas bancárias que a pessoa pode usar (null = todas).
 */
export async function emitirChequeDoTitulo(
  exec: ExecutorSQL, tenantId: string, p: PedidoDeEmissao, quem: QuemFaz, contasLiberadas: ReadonlySet<string> | null,
): Promise<Cheque> {
  if (contasLiberadas && !contasLiberadas.has(p.conta_bancaria_id)) throw new ErroCheque('Esta conta bancária não está liberada para você.', 403);
  const { rows: contas } = await exec.query(`SELECT data FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`, [tenantId, p.conta_bancaria_id]);
  if (!contas.length) throw new ErroCheque('A conta bancária escolhida não existe nesta agência.', 404);
  const { rows: ts } = await exec.query(`SELECT data, status FROM contas_pagar WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, p.titulo_id]);
  if (!ts.length) throw new ErroCheque('Conta a pagar não encontrada.', 404);
  const d = (ts[0].data ?? {}) as Linha;
  const status = (txt(d.status) || txt(ts[0].status)).toUpperCase();
  if (status === 'CANCELADO') throw new ErroCheque('Esta conta a pagar está cancelada: não se emite cheque para ela.', 409);
  const saldo = Math.round((num(d.valor_final ?? d.valor_original) - num(d.valor_pago)) * 100);
  if (status === 'PAGO' || saldo <= 0) {
    throw new ErroCheque('Esta conta a pagar já está paga. O cheque se emite antes da liquidação; para registrar o cheque de uma conta paga, informe o número ao liquidar.', 409);
  }
  const valor = p.valor_centavos ?? saldo;
  if (valor > saldo) throw new ErroCheque(`O cheque não pode passar do que falta pagar nesta conta (R$ ${(saldo / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`);
  const { rows: ja } = await exec.query(
    `SELECT situacao FROM cheques_emitidos WHERE tenant_id = $1 AND conta_bancaria_id = $2 AND ltrim(numero, '0') = ltrim($3, '0')`,
    [tenantId, p.conta_bancaria_id, p.numero],
  );
  if (ja.length) throw new ErroCheque(`O cheque nº ${p.numero} desta conta já foi registrado (${txt(ja[0].situacao).toLowerCase()}). Use o próximo número do talão.`, 409);
  const cfg = normalizarConfigDoCheque(((contas[0].data ?? {}) as Linha).cheque);
  const id = `chq_${generateId()}`;
  const favorecido = p.favorecido || txt(d.fornecedor_nome) || txt(d.descricao);
  await exec.query(
    `INSERT INTO cheques_emitidos (tenant_id, id, numero, conta_bancaria_id, favorecido, valor_centavos, emissao, bom_para, cidade,
       situacao, origem, titulo_tabela, titulo_id, criado_por, situacao_em, situacao_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,NULLIF($8,'')::date,$9,'EMITIDO','titulo','contas_pagar',$10,$11,NOW(),$11)`,
    [tenantId, id, p.numero, p.conta_bancaria_id, favorecido, valor, p.emissao, p.bom_para ?? '', p.cidade || cfg.cidade_padrao, p.titulo_id, quem.nome || quem.id],
  );
  await anotarUltimoNumero(exec, tenantId, p.conta_bancaria_id, p.numero);
  return (await lerCheque(exec, tenantId, id))!;
}

// ============================================================
// Lista
// ============================================================

export interface FiltroDosCheques {
  conta_bancaria_id?: string;
  situacao?: SituacaoDoCheque | '';
  /** Período pela data do cheque ou pelo "bom para". */
  data_de?: 'emissao' | 'bom_para';
  de?: string;
  ate?: string;
  /** Favorecido ou número. */
  busca?: string;
  titulo_id?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function listarCheques(
  exec: ExecutorSQL, tenantId: string, f: FiltroDosCheques, contasVisiveis: ReadonlySet<string> | null,
): Promise<Cheque[]> {
  if (!(await tabelaExiste(exec))) return [];
  const cond = ['c.tenant_id = $1'];
  const args: unknown[] = [tenantId];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (contasVisiveis) add('c.conta_bancaria_id = ANY(?::text[])', [...contasVisiveis]);
  if (f.conta_bancaria_id) add('c.conta_bancaria_id = ?', f.conta_bancaria_id);
  if (f.situacao) add('c.situacao = ?', f.situacao);
  if (f.titulo_id) add('c.titulo_id = ?', f.titulo_id);
  const campo = f.data_de === 'bom_para' ? 'COALESCE(c.bom_para, c.emissao)' : 'c.emissao';
  if (f.de && ISO.test(f.de)) add(`${campo} >= ?::date`, f.de);
  if (f.ate && ISO.test(f.ate)) add(`${campo} <= ?::date`, f.ate);
  if (f.busca && f.busca.trim()) {
    args.push(`%${f.busca.trim().slice(0, 80)}%`);
    cond.push(`(c.favorecido ILIKE $${args.length} OR c.numero ILIKE $${args.length})`);
  }
  const { rows } = await exec.query(`${SELECT_CHEQUE} WHERE ${cond.join(' AND ')} ORDER BY c.emissao DESC, c.criado_em DESC LIMIT 2000`, args);
  const lig = await ligacoesDe(exec, tenantId, rows.map(r => txt(r.id)));
  return rows.map(r => daLinha(r, lig.get(txt(r.id)) ?? []));
}

/** Totais da lista por situação (centavos). */
export function totaisDosCheques(lista: readonly Cheque[]): Record<SituacaoDoCheque | 'TODOS', { quantidade: number; valor_centavos: number }> {
  const t = Object.fromEntries([...SITUACOES_DO_CHEQUE, 'TODOS'].map(s => [s, { quantidade: 0, valor_centavos: 0 }])) as Record<SituacaoDoCheque | 'TODOS', { quantidade: number; valor_centavos: number }>;
  for (const c of lista) {
    t[c.situacao].quantidade++; t[c.situacao].valor_centavos += c.valor_centavos;
    t.TODOS.quantidade++; t.TODOS.valor_centavos += c.valor_centavos;
  }
  return t;
}

// ============================================================
// Mudar a situação
// ============================================================

export interface PedidoDeSituacao { acao: AcaoDoCheque; data?: string; motivo?: string; extrato_id?: string | null }

export async function mudarSituacao(
  exec: ExecutorSQL, tenantId: string, id: string, p: PedidoDeSituacao, quem: QuemFaz,
): Promise<{ cheque: Cheque; aviso: string | null }> {
  if (!(p.acao in TRANSICOES_DO_CHEQUE)) throw new ErroCheque('Ação desconhecida.');
  const { rows } = await exec.query(`SELECT * FROM cheques_emitidos WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
  if (!rows.length) throw new ErroCheque('Cheque não encontrado.', 404);
  const atual = daLinha(rows[0]);
  const recusa = recusaDaTransicao(p.acao, atual.situacao);
  if (recusa) throw new ErroCheque(recusa, 409);
  const semMotivo = recusaDoMotivo(p.acao, p.motivo);
  if (semMotivo) throw new ErroCheque(semMotivo);
  const { rows: lig } = await exec.query(`SELECT count(*)::int AS n FROM cheque_baixas WHERE tenant_id = $1 AND cheque_id = $2`, [tenantId, id]);
  const ligado = Number(lig[0]?.n ?? 0) > 0;
  if (p.acao === 'cancelar' && ligado) {
    throw new ErroCheque('Este cheque pagou uma conta. Estorne a liquidação na conta a pagar antes de cancelar o cheque.', 409);
  }
  const para = TRANSICOES_DO_CHEQUE[p.acao].para;
  let compensado: string | null = null;
  let extrato: string | null = null;
  if (p.acao === 'compensar') {
    compensado = p.data && ISO.test(p.data) ? p.data : hojeISO();
    if (compensado < atual.emissao) throw new ErroCheque('A compensação não pode ser antes da data do cheque.');
    if (p.extrato_id) {
      const { rows: ex } = await exec.query(
        `SELECT id FROM extrato_bancario WHERE tenant_id = $1 AND id = $2 AND (conta_bancaria_id = $3 OR data->>'conta_bancaria_id' = $3)`,
        [tenantId, p.extrato_id, atual.conta_bancaria_id],
      ).catch(() => ({ rows: [] as Linha[] }));
      if (!ex.length) throw new ErroCheque('A linha do extrato escolhida não é desta conta bancária.');
      extrato = txt(ex[0].id);
    }
  }
  await exec.query(
    `UPDATE cheques_emitidos SET situacao = $3, compensado_em = CASE WHEN $3 = 'COMPENSADO' THEN $4::date ELSE compensado_em END,
       extrato_id = CASE WHEN $3 = 'COMPENSADO' THEN $5 ELSE extrato_id END,
       motivo = CASE WHEN $6 <> '' THEN $6 ELSE motivo END, situacao_em = NOW(), situacao_por = $7, atualizado_em = NOW()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, para, compensado, extrato, String(p.motivo ?? '').trim().slice(0, 300), quem.nome || quem.id],
  );
  const aviso = p.acao === 'devolver' && ligado
    ? 'A conta paga com este cheque continua liquidada. Se o fornecedor não recebeu, estorne a liquidação na conta a pagar.'
    : null;
  return { cheque: (await lerCheque(exec, tenantId, id))!, aviso };
}

export async function marcarImpresso(exec: ExecutorSQL, tenantId: string, id: string): Promise<Cheque> {
  const { rowCount } = await exec.query(
    `UPDATE cheques_emitidos SET impresso_em = NOW(), impressoes = impressoes + 1, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2 AND situacao <> 'CANCELADO'`,
    [tenantId, id],
  );
  if (!rowCount) {
    const c = await lerCheque(exec, tenantId, id);
    if (!c) throw new ErroCheque('Cheque não encontrado.', 404);
    throw new ErroCheque('Cheque cancelado não se imprime.', 409);
  }
  return (await lerCheque(exec, tenantId, id))!;
}

/** Linhas do extrato importado que podem ser a compensação: mesma conta, saída do mesmo valor, na data do cheque ou depois. */
export async function sugestoesDoExtrato(exec: ExecutorSQL, tenantId: string, cheque: Cheque): Promise<Array<{ id: string; data: string; valor: number; descricao: string }>> {
  const { rows } = await exec.query(
    `SELECT id, data FROM extrato_bancario
      WHERE tenant_id = $1 AND (conta_bancaria_id = $2 OR data->>'conta_bancaria_id' = $2)
        AND LEFT(COALESCE(data->>'data', ''), 10) >= $3
        AND ROUND(ABS(COALESCE(NULLIF(data->>'valor', '')::numeric, 0)) * 100) = $4
        AND (COALESCE(NULLIF(data->>'valor', '')::numeric, 0) < 0 OR UPPER(COALESCE(data->>'tipo', '')) IN ('DEBITO', 'SAIDA', 'D'))
      ORDER BY data->>'data', id LIMIT 20`,
    [tenantId, cheque.conta_bancaria_id, cheque.emissao, cheque.valor_centavos],
  ).catch(() => ({ rows: [] as Linha[] }));
  const usadas = new Set<string>();
  const { rows: ja } = await exec.query(`SELECT extrato_id FROM cheques_emitidos WHERE tenant_id = $1 AND extrato_id IS NOT NULL AND id <> $2`, [tenantId, cheque.id]);
  for (const r of ja) usadas.add(txt(r.extrato_id));
  return rows.filter(r => !usadas.has(txt(r.id))).map(r => {
    const d = (r.data ?? {}) as Linha;
    return { id: txt(r.id), data: txt(d.data).slice(0, 10), valor: num(d.valor), descricao: txt(d.descricao) };
  });
}

// ============================================================
// Ligação com a liquidação (chamado por baixas-servidor.ts)
// ============================================================

export interface BaixaComCheque {
  baixa_id: string;
  titulo_tabela: string;
  titulo_id: string;
  conta_bancaria_id: string | null;
  numero: string;
  valor_centavos: number;
  data: string;
  favorecido: string;
  usuario: string;
}

/**
 * A liquidação de conta a pagar com cheque: liga ao cheque do mesmo número
 * na mesma conta, ou registra o cheque. Sem a tabela (base antiga), nada.
 * Roda dentro da transação da baixa: tudo ou nada.
 */
export async function chequeDaLiquidacao(exec: ExecutorSQL, tenantId: string, b: BaixaComCheque): Promise<string | null> {
  if (b.titulo_tabela !== 'contas_pagar' || !b.conta_bancaria_id || !b.numero) return null;
  if (!(await tabelaExiste(exec))) return null;
  const { rows } = await exec.query(
    `SELECT id, situacao, origem FROM cheques_emitidos WHERE tenant_id = $1 AND conta_bancaria_id = $2 AND ltrim(numero, '0') = ltrim($3, '0') FOR UPDATE`,
    [tenantId, b.conta_bancaria_id, b.numero],
  );
  let chequeId: string;
  if (rows.length) {
    const sit = txt(rows[0].situacao);
    if (sit === 'CANCELADO') {
      throw new ErroCheque(`O cheque nº ${b.numero} desta conta está cancelado. Use outro número.`, 409);
    }
    chequeId = txt(rows[0].id);
    // Cheque que nasceu da liquidação: cada conta paga com ele soma ao valor.
    if (txt(rows[0].origem) === 'liquidacao') {
      await exec.query(`UPDATE cheques_emitidos SET valor_centavos = valor_centavos + $3, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, chequeId, b.valor_centavos]);
    }
  } else {
    chequeId = `chq_${generateId()}`;
    await exec.query(
      `INSERT INTO cheques_emitidos (tenant_id, id, numero, conta_bancaria_id, favorecido, valor_centavos, emissao, situacao, origem,
         titulo_tabela, titulo_id, criado_por, situacao_em, situacao_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,'EMITIDO','liquidacao',$8,$9,$10,NOW(),$10)`,
      [tenantId, chequeId, b.numero, b.conta_bancaria_id, b.favorecido, b.valor_centavos, b.data, b.titulo_tabela, b.titulo_id, b.usuario],
    );
    await anotarUltimoNumero(exec, tenantId, b.conta_bancaria_id, b.numero);
  }
  await exec.query(
    `INSERT INTO cheque_baixas (tenant_id, id, cheque_id, baixa_id, titulo_tabela, titulo_id, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, baixa_id) DO NOTHING`,
    [tenantId, `chb_${generateId()}`, chequeId, b.baixa_id, b.titulo_tabela, b.titulo_id, b.valor_centavos],
  );
  return chequeId;
}

/**
 * O estorno da baixa: a ligação sai. O cheque que nasceu da liquidação perde
 * o valor dessa conta e, sem conta nenhuma, fica Cancelado (só se ainda
 * estava Emitido); o cheque emitido antes continua como está.
 */
export async function desligarDaBaixa(exec: ExecutorSQL, tenantId: string, baixaId: string, usuario: string): Promise<void> {
  if (!(await tabelaExiste(exec))) return;
  const { rows } = await exec.query(`DELETE FROM cheque_baixas WHERE tenant_id = $1 AND baixa_id = $2 RETURNING cheque_id, valor_centavos`, [tenantId, baixaId]);
  if (!rows.length) return;
  const chequeId = txt(rows[0].cheque_id);
  const { rows: ch } = await exec.query(`SELECT origem, situacao FROM cheques_emitidos WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, chequeId]);
  if (!ch.length || txt(ch[0].origem) !== 'liquidacao') return;
  const { rows: resto } = await exec.query(`SELECT count(*)::int AS n FROM cheque_baixas WHERE tenant_id = $1 AND cheque_id = $2`, [tenantId, chequeId]);
  const semNenhuma = Number(resto[0]?.n ?? 0) === 0;
  await exec.query(
    `UPDATE cheques_emitidos SET valor_centavos = GREATEST(0, valor_centavos - $3), atualizado_em = NOW(),
       situacao = CASE WHEN $4 AND situacao = 'EMITIDO' THEN 'CANCELADO' ELSE situacao END,
       motivo = CASE WHEN $4 AND situacao = 'EMITIDO' THEN 'Liquidação estornada' ELSE motivo END,
       situacao_em = CASE WHEN $4 AND situacao = 'EMITIDO' THEN NOW() ELSE situacao_em END,
       situacao_por = CASE WHEN $4 AND situacao = 'EMITIDO' THEN $5 ELSE situacao_por END
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, chequeId, Number(rows[0].valor_centavos) || 0, semNenhuma, usuario],
  );
}
