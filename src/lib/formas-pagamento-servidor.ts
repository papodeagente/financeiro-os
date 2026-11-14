/**
 * Formas de pagamento no banco (05/11/2026). A regra mora em
 * ./formas-pagamento.ts; aqui só se lê e grava.
 *
 * A tabela guarda apenas o que a agência mudou: o ajuste de uma forma de
 * sempre (conta, dias, taxa, ligada ou não) e as formas próprias. Agência sem
 * linha nenhuma vê as formas de sempre, como antes.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { deCentavos, num, paraCentavos, round2 } from './money';
import {
  codigoParaNome,
  ehFormaDoSistema,
  formasDaAgencia,
  validarAjuste,
  type AjusteDaForma,
  type FormaPagamento,
} from './formas-pagamento';

export const FORMAS_PAGAMENTO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS formas_pagamento (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    nome TEXT NOT NULL DEFAULT '',
    sistema BOOLEAN NOT NULL DEFAULT FALSE,
    uso TEXT NOT NULL DEFAULT 'ambos',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    conta_bancaria_id TEXT,
    dias_para_cair INTEGER NOT NULL DEFAULT 0,
    taxa_pct NUMERIC(7,4) NOT NULL DEFAULT 0,
    taxa_fixa_centavos BIGINT NOT NULL DEFAULT 0,
    informacoes TEXT NOT NULL DEFAULT '',
    ordem INTEGER NOT NULL DEFAULT 1000,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );
`;

export class ErroForma extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ErroForma';
  }
}

function linhaParaAjuste(r: Record<string, unknown>): AjusteDaForma {
  return {
    codigo: String(r.id),
    nome: String(r.nome ?? ''),
    uso: (String(r.uso ?? 'ambos') as AjusteDaForma['uso']),
    ativo: r.ativo !== false,
    conta_bancaria_id: (r.conta_bancaria_id as string | null) || null,
    dias_para_cair: Number(r.dias_para_cair) || 0,
    // NUMERIC chega como texto "3.4900": Number(), nunca num() (que lê o
    // ponto como separador de milhar).
    taxa_pct: Number(r.taxa_pct) || 0,
    taxa_fixa: deCentavos(r.taxa_fixa_centavos as string | number),
    informacoes: String(r.informacoes ?? ''),
    ordem: Number(r.ordem) || 0,
  };
}

/** Todas as formas da agência (as de sempre já com o ajuste dela). */
export async function listarFormas(exec: ExecutorSQL, tenantId: string): Promise<FormaPagamento[]> {
  let rows: Record<string, unknown>[] = [];
  try {
    ({ rows } = await exec.query(
      `SELECT id, nome, uso, ativo, conta_bancaria_id, dias_para_cair, taxa_pct, taxa_fixa_centavos, informacoes, ordem
         FROM formas_pagamento WHERE tenant_id = $1`,
      [tenantId],
    ));
  } catch {
    // Tabela ainda não criada: as formas de sempre continuam valendo.
    rows = [];
  }
  return formasDaAgencia(rows.map(linhaParaAjuste));
}

async function contaExiste(exec: ExecutorSQL, tenantId: string, id: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT 1 FROM contas_bancarias WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return rows.length > 0;
}

/**
 * Cria (sem `codigo`) ou ajusta (com `codigo`) uma forma. Forma de sempre:
 * nome e uso não mudam. Forma própria: nome único na agência.
 */
export async function salvarForma(
  exec: ExecutorSQL,
  tenantId: string,
  corpo: Record<string, unknown>,
  codigoDaRota?: string,
): Promise<FormaPagamento> {
  const codigoPedido = String(codigoDaRota ?? corpo.codigo ?? '').trim();
  const sistema = codigoPedido !== '' && ehFormaDoSistema(codigoPedido);
  const atuais = await listarFormas(exec, tenantId);
  let codigo = codigoPedido;
  let existente = codigo ? atuais.find(f => f.codigo === codigo) ?? null : null;
  if (codigo && !existente) throw new ErroForma('Forma de pagamento não encontrada.', 404);
  const recusa = validarAjuste(corpo as Partial<AjusteDaForma>, sistema);
  if (recusa) throw new ErroForma(recusa);

  const nome = sistema ? existente!.nome : String(corpo.nome ?? '').trim();
  if (!sistema) {
    const repetida = atuais.find(f => f.codigo !== codigo && f.nome.localeCompare(nome, 'pt-BR', { sensitivity: 'base' }) === 0);
    if (repetida) throw new ErroForma(`Já existe a forma "${repetida.nome}".`, 409);
  }
  if (!codigo) {
    codigo = codigoParaNome(nome, atuais.map(f => f.codigo));
    existente = null;
  }

  const contaId = typeof corpo.conta_bancaria_id === 'string' && corpo.conta_bancaria_id.trim() ? corpo.conta_bancaria_id.trim() : null;
  if (contaId && !(await contaExiste(exec, tenantId, contaId))) {
    throw new ErroForma('A conta bancária escolhida não existe nesta agência.', 409);
  }
  const uso = sistema
    ? existente!.uso
    : corpo.uso === 'pagar' || corpo.uso === 'receber' ? corpo.uso : 'ambos';
  const ativo = corpo.ativo === undefined ? (existente?.ativo ?? true) : corpo.ativo !== false;
  const ordem = existente?.ordem ?? 1000 + atuais.filter(f => !f.sistema).length;

  await exec.query(
    `INSERT INTO formas_pagamento (tenant_id, id, nome, sistema, uso, ativo, conta_bancaria_id, dias_para_cair,
                                   taxa_pct, taxa_fixa_centavos, informacoes, ordem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (tenant_id, id) DO UPDATE SET
       nome = EXCLUDED.nome, uso = EXCLUDED.uso, ativo = EXCLUDED.ativo, conta_bancaria_id = EXCLUDED.conta_bancaria_id,
       dias_para_cair = EXCLUDED.dias_para_cair, taxa_pct = EXCLUDED.taxa_pct, taxa_fixa_centavos = EXCLUDED.taxa_fixa_centavos,
       informacoes = EXCLUDED.informacoes, atualizado_em = NOW()`,
    [tenantId, codigo, nome, sistema, uso, ativo, contaId,
      Math.round(Math.min(365, Math.max(0, num(corpo.dias_para_cair)))),
      round2(Math.max(0, num(corpo.taxa_pct))), paraCentavos(Math.max(0, num(corpo.taxa_fixa))),
      typeof corpo.informacoes === 'string' ? corpo.informacoes.trim().slice(0, 500) : '', ordem],
  );
  const salvas = await listarFormas(exec, tenantId);
  return salvas.find(f => f.codigo === codigo)!;
}

/** Quantos títulos e baixas usam a forma (para não apagar o que tem história). */
export async function usosDaForma(exec: ExecutorSQL, tenantId: string, codigo: string): Promise<number> {
  const conta = async (sql: string) => {
    try {
      const { rows } = await exec.query(sql, [tenantId, codigo]);
      return Number(rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  };
  const [r, p, b] = await Promise.all([
    conta(`SELECT COUNT(*)::int AS n FROM contas_receber WHERE tenant_id = $1 AND data->>'forma_recebimento' = $2`),
    conta(`SELECT COUNT(*)::int AS n FROM contas_pagar WHERE tenant_id = $1 AND data->>'forma_pagamento' = $2`),
    conta(`SELECT COUNT(*)::int AS n FROM baixas WHERE tenant_id = $1 AND forma = $2`),
  ]);
  return r + p + b;
}

/**
 * Apaga uma forma própria sem uso. Forma de sempre não se apaga (desliga-se);
 * forma já usada também não: desligar tira das escolhas e preserva a história.
 */
export async function excluirForma(exec: ExecutorSQL, tenantId: string, codigo: string): Promise<void> {
  if (ehFormaDoSistema(codigo)) throw new ErroForma('As formas de sempre não podem ser apagadas. Desligue-a para sair das escolhas.', 409);
  const usos = await usosDaForma(exec, tenantId, codigo);
  if (usos > 0) {
    throw new ErroForma(`Esta forma já foi usada em ${usos} ${usos === 1 ? 'lançamento' : 'lançamentos'}. Desligue-a para sair das escolhas; o que já foi lançado continua igual.`, 409);
  }
  const { rows } = await exec.query(`DELETE FROM formas_pagamento WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantId, codigo]);
  if (!rows.length) throw new ErroForma('Forma de pagamento não encontrada.', 404);
}
