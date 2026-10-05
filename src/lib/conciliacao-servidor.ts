/**
 * Conciliação bancária no banco de dados. A regra está em
 * conciliacao-plano.ts; aqui é ler, travar, gravar e mover o caixa, sempre
 * dentro da transação de quem chama (a rota usa emTransacao).
 *
 * Antes disto a tela fazia dois PUTs (extrato e conta) e tentava desfazer o
 * primeiro à mão se o segundo falhasse. Agora é uma transação só: ou a linha
 * fica conciliada com todas as baixas, ou nada muda.
 *
 * O caixa se move pelas mesmas funções da baixa manual (calcularMovimentos e
 * aplicarMovimentoCaixaAtomico), então baixa parcial, troca de conta e
 * estorno seguem a regra que já está testada.
 *
 * Cada conta tocada fica registrada em `vinculos` na linha do extrato, com o
 * que ela era ANTES e o que virou DEPOIS. É isso que deixa desfazer: se a
 * conta mudou de novo depois da conciliação (outra baixa, outra edição), o
 * desfazer recusa em vez de apagar o trabalho de alguém.
 */
import {
  aplicarMovimentoCaixaAtomico,
  atualizarContaComGuarda,
  calcularMovimentos,
  estornarBaixaDaConta,
  type ExecutorSQL,
} from './caixa-atomico';
import { createContaPagar, createContaReceber } from './crm-types';
import { formatBRL, generateId } from './utils';
import { num, round2 } from './money';
import {
  descreverPlanoDaConciliacao,
  formaDaDescricao,
  planoDaConciliacao,
  type ContaConciliavel,
  type PlanoDaConciliacao,
  type TipoLancamento,
} from './conciliacao-plano';

export class ErroConciliacao extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

interface Tabela {
  tabela: 'contas_receber' | 'contas_pagar';
  indice: string[];
  campo: 'valor_recebido' | 'valor_pago';
  campoData: 'data_recebimento' | 'data_pagamento';
  sinal: 1 | -1;
}

const TABELAS: Record<TipoLancamento, Tabela> = {
  CONTA_RECEBER: { tabela: 'contas_receber', indice: ['venda_id', 'cliente_id', 'status'], campo: 'valor_recebido', campoData: 'data_recebimento', sinal: 1 },
  CONTA_PAGAR: { tabela: 'contas_pagar', indice: ['fornecedor_id', 'status'], campo: 'valor_pago', campoData: 'data_pagamento', sinal: -1 },
};

export interface Vinculo {
  id: string;
  tipo: TipoLancamento;
  acao: 'VINCULAR' | 'BAIXAR' | 'PARCIAL' | 'CRIADA' | 'LEGADO';
  aplicado: number;
  antes?: { status: string; valor_baixado: number | null; data_baixa: string | null; conta_bancaria_id: string | null } | null;
  depois?: { status: string; valor_baixado: number } | null;
}

type Dados = Record<string, unknown>;

async function travarLinha(exec: ExecutorSQL, tenantId: string, extratoId: string): Promise<Dados> {
  const { rows } = await exec.query(
    `SELECT data FROM extrato_bancario WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [extratoId, tenantId],
  );
  if (rows.length === 0) throw new ErroConciliacao('Linha do extrato não encontrada.', 404);
  return { ...(rows[0].data as Dados), id: extratoId };
}

async function gravarLinha(exec: ExecutorSQL, tenantId: string, linha: Dados): Promise<void> {
  await exec.query(
    `UPDATE extrato_bancario SET status_conciliacao = $3, data = $4::jsonb, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [linha.id, tenantId, linha.status_conciliacao, JSON.stringify(linha)],
  );
}

/** Contas que outra linha CONCILIADA do extrato já usa (por qualquer dos dois formatos). */
export async function contasJaUsadas(exec: ExecutorSQL, tenantId: string, ids: string[], exceto: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await exec.query(
    `SELECT data FROM extrato_bancario
      WHERE tenant_id = $1 AND status_conciliacao = 'CONCILIADO' AND id <> $2
        AND (data->>'lancamento_vinculado_id' = ANY($3::text[])
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(data->'vinculos') = 'array' THEN data->'vinculos' ELSE '[]'::jsonb END) v
                        WHERE v->>'id' = ANY($3::text[])))`,
    [tenantId, exceto, ids],
  );
  const usados = new Set<string>();
  for (const r of rows) {
    const d = (r.data ?? {}) as Dados;
    if (ids.includes(String(d.lancamento_vinculado_id ?? ''))) usados.add(String(d.lancamento_vinculado_id));
    for (const v of Array.isArray(d.vinculos) ? (d.vinculos as Vinculo[]) : []) if (ids.includes(v.id)) usados.add(v.id);
  }
  return usados;
}

function tipoDaLinha(linha: Dados): TipoLancamento {
  return num(linha.valor) >= 0 ? 'CONTA_RECEBER' : 'CONTA_PAGAR';
}

function paraConciliavel(id: string, tipo: TipoLancamento, d: Dados): ContaConciliavel {
  const t = TABELAS[tipo];
  const baixado = d[t.campo];
  return {
    id,
    tipo,
    status: String(d.status ?? ''),
    valor_final: round2(num(d.valor_final)),
    valor_baixado: baixado === null || baixado === undefined || baixado === '' ? null : round2(num(baixado)),
    data_vencimento: String(d.data_vencimento ?? ''),
    conta_bancaria_id: (d.conta_bancaria_id as string | null | undefined) ?? null,
  };
}

async function moverCaixa(exec: ExecutorSQL, tenantId: string, prev: Dados, novo: Dados, t: Tabela): Promise<void> {
  const movimentos = calcularMovimentos(prev, novo, t.campo, t.sinal);
  // Ordem fixa por conta, igual às rotas de baixa: evita travar em ordem cruzada.
  movimentos.sort((a, b) => String(a.conta).localeCompare(String(b.conta)));
  for (const m of movimentos) await aplicarMovimentoCaixaAtomico(tenantId, m.conta, m.delta, exec);
}

function linhaConciliada(linha: Dados, vinculos: Vinculo[]): Dados {
  return {
    ...linha,
    status_conciliacao: 'CONCILIADO',
    lancamento_vinculado_id: vinculos[0]?.id ?? null,
    lancamento_vinculado_tipo: vinculos[0]?.tipo ?? null,
    vinculos,
    conciliado_em: new Date().toISOString(),
  };
}

export interface ResultadoConciliacao {
  linha: Dados;
  plano: PlanoDaConciliacao | null;
  vinculos: Vinculo[];
}

/** Concilia a linha com contas que já existem (em aberto ou já baixadas). */
export async function conciliarComContas(
  exec: ExecutorSQL,
  tenantId: string,
  extratoId: string,
  alvos: { tipo: TipoLancamento; id: string }[],
): Promise<ResultadoConciliacao> {
  const linha = await travarLinha(exec, tenantId, extratoId);
  if (linha.status_conciliacao === 'CONCILIADO') throw new ErroConciliacao('Esta linha do extrato já está conciliada.', 409);

  const unicos = [...new Map(alvos.filter(a => a && a.id && TABELAS[a.tipo]).map(a => [`${a.tipo}:${a.id}`, a])).values()];
  if (unicos.length === 0) throw new ErroConciliacao('Escolha a conta que este valor quita.');

  const usados = await contasJaUsadas(exec, tenantId, unicos.map(a => a.id), extratoId);
  if (usados.size > 0) throw new ErroConciliacao('Uma das contas escolhidas já está conciliada com outra linha do extrato.', 409);

  const lidas: { alvo: { tipo: TipoLancamento; id: string }; data: Dados; versao: string }[] = [];
  for (const a of [...unicos].sort((x, y) => x.id.localeCompare(y.id))) {
    const t = TABELAS[a.tipo];
    const { rows } = await exec.query(
      `SELECT data, xmin::text AS versao FROM ${t.tabela} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [a.id, tenantId],
    );
    if (rows.length === 0) throw new ErroConciliacao('Uma das contas escolhidas não existe mais.', 404);
    lidas.push({ alvo: a, data: rows[0].data as Dados, versao: String(rows[0].versao) });
  }

  const contaBancaria = (linha.conta_bancaria_id as string | null) ?? null;
  const plano = planoDaConciliacao(lidas.map(l => paraConciliavel(l.alvo.id, l.alvo.tipo, l.data)), num(linha.valor), contaBancaria);
  if (!plano.ok) {
    throw new ErroConciliacao(descreverPlanoDaConciliacao(plano, formatBRL, tipoDaLinha(linha) === 'CONTA_RECEBER'), 422);
  }

  const vinculos: Vinculo[] = [];
  for (const passo of plano.passos) {
    const lida = lidas.find(l => l.alvo.id === passo.id && l.alvo.tipo === passo.tipo)!;
    const t = TABELAS[passo.tipo];
    const prev = lida.data;
    if (passo.acao === 'VINCULAR') {
      const novo = { ...prev, extrato_conciliado_id: extratoId };
      const ok = await atualizarContaComGuarda({ exec, tabela: t.tabela, colunasIndice: t.indice, id: passo.id, tenantId, item: novo, versaoAnterior: lida.versao, statusAlvo: null });
      if (!ok) throw new ErroConciliacao('A conta mudou enquanto você conciliava. Abra a linha de novo.', 409);
      vinculos.push({ id: passo.id, tipo: passo.tipo, acao: 'VINCULAR', aplicado: passo.aplicado, antes: null, depois: null });
      continue;
    }
    const novo: Dados = {
      ...prev,
      status: passo.status_novo,
      [t.campo]: passo.valor_baixado_novo,
      [t.campoData]: linha.data,
      conta_bancaria_id: contaBancaria,
      extrato_conciliado_id: extratoId,
    };
    const ok = await atualizarContaComGuarda({ exec, tabela: t.tabela, colunasIndice: t.indice, id: passo.id, tenantId, item: novo, versaoAnterior: lida.versao, statusAlvo: null });
    if (!ok) throw new ErroConciliacao('A conta mudou enquanto você conciliava. Abra a linha de novo.', 409);
    await moverCaixa(exec, tenantId, prev, novo, t);
    const baixadoAntes = prev[t.campo];
    vinculos.push({
      id: passo.id,
      tipo: passo.tipo,
      acao: passo.acao,
      aplicado: passo.aplicado,
      antes: {
        status: String(prev.status ?? ''),
        valor_baixado: baixadoAntes === null || baixadoAntes === undefined || baixadoAntes === '' ? null : round2(num(baixadoAntes)),
        data_baixa: (prev[t.campoData] as string | null | undefined) ?? null,
        conta_bancaria_id: (prev.conta_bancaria_id as string | null | undefined) ?? null,
      },
      depois: { status: passo.status_novo, valor_baixado: passo.valor_baixado_novo },
    });
  }

  const nova = linhaConciliada(linha, vinculos);
  await gravarLinha(exec, tenantId, nova);
  return { linha: nova, plano, vinculos };
}

export interface DadosDaContaNova {
  /** Conta a pagar: para quem foi. Conta a receber: de quem veio. */
  nome: string;
  descricao: string;
  categoria_id?: string;
  /** Só conta a receber: a venda a que o recebimento pertence. */
  venda_id?: string;
  cliente_id?: string;
}

/**
 * Cria a conta que faltava, já baixada com a data e o valor do banco, e
 * concilia. Gravada e baixada na mesma transação, com o movimento de caixa
 * derivado da mesma regra da baixa manual.
 */
export async function conciliarCriandoConta(
  exec: ExecutorSQL,
  tenantId: string,
  extratoId: string,
  dados: DadosDaContaNova,
): Promise<ResultadoConciliacao & { conta: Dados }> {
  const linha = await travarLinha(exec, tenantId, extratoId);
  if (linha.status_conciliacao === 'CONCILIADO') throw new ErroConciliacao('Esta linha do extrato já está conciliada.', 409);
  const tipo = tipoDaLinha(linha);
  const t = TABELAS[tipo];
  const valor = round2(Math.abs(num(linha.valor)));
  const data = String(linha.data ?? '');
  const nome = String(dados.nome ?? '').trim();
  const descricao = String(dados.descricao ?? '').trim() || String(linha.descricao ?? '');
  if (valor <= 0) throw new ErroConciliacao('Linha de valor zero não gera conta.');
  if (!nome) throw new ErroConciliacao(tipo === 'CONTA_PAGAR' ? 'Informe para quem foi o pagamento.' : 'Informe de quem veio o dinheiro.');

  let natureza: unknown = null;
  let comercial = false;
  if (dados.categoria_id) {
    const { rows } = await exec.query(`SELECT data FROM plano_contas WHERE id = $1 AND tenant_id = $2`, [dados.categoria_id, tenantId]);
    if (rows.length === 0) throw new ErroConciliacao('Categoria não encontrada.', 404);
    const c = rows[0].data as Dados;
    natureza = c.natureza_custo ?? null;
    comercial = c.is_custo_comercial === true;
  }

  const contaBancaria = (linha.conta_bancaria_id as string | null) ?? null;
  const observacoes = `Criada na conciliação do extrato: ${String(linha.descricao ?? '')}`;
  let conta: Dados;
  if (tipo === 'CONTA_PAGAR') {
    conta = {
      ...createContaPagar(),
      id: generateId(),
      origem: 'OUTROS',
      fornecedor_nome: nome,
      descricao,
      categoria_id: dados.categoria_id ?? '',
      natureza_custo: natureza,
      is_custo_comercial: comercial,
      valor_original: valor,
      valor_final: valor,
      valor_brl: valor,
      data_emissao: data,
      data_vencimento: data,
      status: 'PAGO',
      data_pagamento: data,
      valor_pago: valor,
      conta_bancaria_id: contaBancaria,
      forma_pagamento: formaDaDescricao(String(linha.descricao ?? '')),
      observacoes,
      extrato_conciliado_id: extratoId,
    };
    await exec.query(
      `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
      [conta.id, tenantId, '', 'PAGO', JSON.stringify(conta)],
    );
  } else {
    let vendaId = '';
    if (dados.venda_id) {
      const { rows } = await exec.query(`SELECT id FROM vendas_crm WHERE id = $1 AND tenant_id = $2`, [dados.venda_id, tenantId]);
      if (rows.length === 0) throw new ErroConciliacao('Venda não encontrada.', 404);
      vendaId = dados.venda_id;
    }
    conta = {
      ...createContaReceber(),
      id: generateId(),
      origem: vendaId ? 'VENDA' : 'OUTROS',
      venda_id: vendaId || null,
      ...(vendaId ? { origem_venda_id: vendaId } : {}),
      cliente_id: dados.cliente_id ?? '',
      cliente_nome: nome,
      descricao,
      categoria_id: dados.categoria_id ?? '',
      valor_original: valor,
      valor_final: valor,
      data_emissao: data,
      data_vencimento: data,
      status: 'RECEBIDO',
      data_recebimento: data,
      valor_recebido: valor,
      conta_bancaria_id: contaBancaria,
      forma_recebimento: formaDaDescricao(String(linha.descricao ?? '')),
      observacoes,
      extrato_conciliado_id: extratoId,
    };
    await exec.query(
      `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())`,
      [conta.id, tenantId, vendaId, String(dados.cliente_id ?? ''), 'RECEBIDO', JSON.stringify(conta)],
    );
  }
  await moverCaixa(exec, tenantId, {}, conta, t);

  const vinculos: Vinculo[] = [{ id: String(conta.id), tipo, acao: 'CRIADA', aplicado: valor, antes: null, depois: null }];
  const nova = linhaConciliada(linha, vinculos);
  await gravarLinha(exec, tenantId, nova);
  return { linha: nova, plano: null, vinculos, conta };
}

/**
 * Devolve a linha à fila e as contas ao que eram. Conta criada pela
 * conciliação é apagada (com estorno do caixa); conta baixada volta ao
 * estado anterior; conta só vinculada perde o vínculo. Se uma conta mudou
 * depois da conciliação, recusa: desfazer não pode apagar baixa de outra
 * pessoa.
 */
export async function desfazerConciliacao(exec: ExecutorSQL, tenantId: string, extratoId: string): Promise<{ linha: Dados; restauradas: number }> {
  const linha = await travarLinha(exec, tenantId, extratoId);
  if (linha.status_conciliacao !== 'CONCILIADO') throw new ErroConciliacao('Esta linha não está conciliada.', 409);

  const legado = !Array.isArray(linha.vinculos);
  const vinculos: Vinculo[] = legado
    ? (linha.lancamento_vinculado_id && TABELAS[linha.lancamento_vinculado_tipo as TipoLancamento]
        ? [{ id: String(linha.lancamento_vinculado_id), tipo: linha.lancamento_vinculado_tipo as TipoLancamento, acao: 'LEGADO', aplicado: round2(Math.abs(num(linha.valor))) }]
        : [])
    : (linha.vinculos as Vinculo[]);

  let restauradas = 0;
  for (const v of vinculos) {
    const t = TABELAS[v.tipo];
    if (!t) continue;
    const { rows } = await exec.query(
      `SELECT data, xmin::text AS versao FROM ${t.tabela} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [v.id, tenantId],
    );
    if (rows.length === 0) continue; // apagada por alguém: nada a devolver
    const prev = rows[0].data as Dados;
    const versao = String(rows[0].versao);

    if (v.acao === 'CRIADA') {
      const { rows: apagadas } = await exec.query(
        `DELETE FROM ${t.tabela} WHERE id = $1 AND tenant_id = $2 RETURNING data`,
        [v.id, tenantId],
      );
      if (apagadas[0]) await estornarBaixaDaConta(tenantId, t.tabela, apagadas[0].data as Dados, exec);
      restauradas++;
      continue;
    }

    let restaurado: Dados;
    if ((v.acao === 'BAIXAR' || v.acao === 'PARCIAL') && v.antes && v.depois) {
      const mudou = String(prev.status ?? '') !== v.depois.status || Math.abs(round2(num(prev[t.campo])) - v.depois.valor_baixado) > 0.005;
      if (mudou) {
        throw new ErroConciliacao('Uma das contas mudou depois desta conciliação (nova baixa ou edição). Desfaça pela tela de contas.', 409);
      }
      restaurado = {
        ...prev,
        status: v.antes.status,
        [t.campo]: v.antes.valor_baixado,
        [t.campoData]: v.antes.data_baixa,
        conta_bancaria_id: v.antes.conta_bancaria_id,
      };
    } else if (v.acao === 'LEGADO') {
      // A conciliação antiga gravava exatamente isto. Só se ainda for isto,
      // a conta volta a aberta; senão apenas perde o vínculo.
      const quitado = v.tipo === 'CONTA_RECEBER' ? 'RECEBIDO' : 'PAGO';
      const igual = prev.status === quitado
        && Math.abs(round2(num(prev[t.campo])) - v.aplicado) <= 0.005
        && String(prev[t.campoData] ?? '') === String(linha.data ?? '');
      restaurado = igual ? { ...prev, status: 'PENDENTE', [t.campo]: null, [t.campoData]: null } : { ...prev };
    } else {
      restaurado = { ...prev };
    }
    delete restaurado.extrato_conciliado_id;

    const ok = await atualizarContaComGuarda({ exec, tabela: t.tabela, colunasIndice: t.indice, id: v.id, tenantId, item: restaurado, versaoAnterior: versao, statusAlvo: null });
    if (!ok) throw new ErroConciliacao('A conta mudou enquanto você desfazia. Tente de novo.', 409);
    await moverCaixa(exec, tenantId, prev, restaurado, t);
    restauradas++;
  }

  const { vinculos: _v, conciliado_em: _c, ...resto } = linha;
  const nova: Dados = {
    ...resto,
    status_conciliacao: 'PENDENTE',
    lancamento_vinculado_id: null,
    lancamento_vinculado_tipo: null,
    desfeito_em: new Date().toISOString(),
  };
  await gravarLinha(exec, tenantId, nova);
  return { linha: nova, restauradas };
}
