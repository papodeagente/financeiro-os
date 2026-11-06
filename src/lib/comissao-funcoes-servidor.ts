/**
 * Comissões por função no banco (E5, parte F): cadastro, cálculo do dia,
 * prévia, Fechar comissões, Pagar comissões e o painel do vendedor.
 *
 * REGRAS QUE CUSTAM DINHEIRO SE QUEBRADAS:
 *  1. Na regra de hoje (config.regra = 'ATUAL') nada daqui grava: a tarefa do
 *     dia pula a agência e Fechar/Pagar recusam. A comissão de quem já usa só
 *     muda quando a agência escolhe a regra nova.
 *  2. Fechar é por pessoa, cada uma na sua transação: o erro de uma (sem
 *     plano, sem meta do mês) não trava as outras.
 *  3. O que se fecha é "liberado − já fechado", lido com a linha travada
 *     (FOR UPDATE): fechar duas vezes seguidas não fecha nada a mais, e a
 *     venda cancelada ou o recebimento estornado voltam como estorno.
 *  4. Pagar gera UMA conta por pessoa (a pagar, ou a receber quando ela fica
 *     devendo), com o detalhe de cada venda, e marca o quanto de cada item foi
 *     pago. Pagar de novo o mesmo item não acontece: só o que está em aberto.
 */
import { generateId } from './utils';
import { hojeISO, deCentavos } from './money';
import type { ExecutorSQL } from './caixa-atomico';
import { vencimentoDaComissao } from './comissao-conta';
import { carregarVenda, lerConfigVenda } from './venda-servidor';
import { lerRecebimentos, lerVendas } from './vendas-leitura';
import type { DefinicaoTarefa } from './agendador/nucleo';
import { janelaDiaria } from './agendador/nucleo';
import {
  CONFIG_COMISSAO_PADRAO, assinaturaDaPrevia, baseDaComissaoManual, calcularComissoesPorFuncao, podeFecharAFuncao, prepararComissaoManual, errosDoPlano, frasesDaExplicacao, funcoesDoSistema,
  itensAFechar, linhasDoFechamento, normalizarConfigComissao, normalizarFuncao, normalizarPessoaDaFuncao, normalizarPlano,
  repartirPagamento, rotuloDoMes, situacaoDoItem,
  type ComissaoManual, type ConfigComissao, type Funcao, type ItemAFechar, type ItemDeComissao, type LancamentoGravado, type LinhaDoFechamento,
  type MetaDoMes, type PessoaDaFuncao, type PlanoPorFuncao, type RecebimentoDoCliente, type ResumoDoParticipante, type SituacaoDoItem,
} from './comissao-funcoes';

export class ErroComissao extends Error {
  constructor(public codigo: string, mensagem: string, public status = 400, public detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroComissao';
  }
}

export interface UsuarioDaAcao { id: string; nome: string }
export type Transacao = <T>(fn: (exec: ExecutorSQL) => Promise<T>) => Promise<T>;

type Linha = Record<string, unknown>;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataISO = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10));
const n = (v: unknown) => Number(v) || 0;

// ============================================================
// Configuração e cadastro
// ============================================================

export async function lerConfigComissao(exec: ExecutorSQL, tenantId: string): Promise<ConfigComissao> {
  const { rows } = await exec.query(`SELECT dados FROM comissao_config WHERE tenant_id = $1`, [tenantId]);
  return rows.length ? normalizarConfigComissao(rows[0].dados) : { ...CONFIG_COMISSAO_PADRAO };
}

/**
 * Grava a escolha da agência. Ao passar para a regra por função sem data
 * inicial, ela vira o primeiro dia do mês: vendas antigas não são
 * recomissionadas pela regra nova sem a agência pedir.
 */
export async function salvarConfigComissao(exec: ExecutorSQL, tenantId: string, entrada: unknown, usuario: UsuarioDaAcao, hoje = hojeISO()): Promise<ConfigComissao> {
  const atual = await lerConfigComissao(exec, tenantId);
  const nova = normalizarConfigComissao({ ...atual, ...(entrada && typeof entrada === 'object' ? entrada : {}) });
  if (nova.regra === 'FUNCOES' && !nova.data_inicial) nova.data_inicial = `${hoje.slice(0, 7)}-01`;
  await exec.query(
    `INSERT INTO comissao_config (tenant_id, dados, atualizado_em, atualizado_por) VALUES ($1, $2::jsonb, NOW(), $3)
     ON CONFLICT (tenant_id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = NOW(), atualizado_por = EXCLUDED.atualizado_por`,
    [tenantId, JSON.stringify(nova), usuario.nome || usuario.id],
  );
  return nova;
}

export interface CadastroDeComissoes {
  funcoes: Funcao[];
  pessoas: PessoaDaFuncao[];
  planos: PlanoPorFuncao[];
  metas: MetaDoMes[];
}

export async function lerCadastro(exec: ExecutorSQL, tenantId: string): Promise<CadastroDeComissoes> {
  const [{ rows: fs }, { rows: ps }, { rows: pl }, { rows: ms }] = await Promise.all([
    exec.query(`SELECT * FROM comissao_funcoes WHERE tenant_id = $1 ORDER BY sistema NULLS LAST, nome`, [tenantId]),
    exec.query(`SELECT * FROM comissao_pessoas WHERE tenant_id = $1 ORDER BY pessoa_nome`, [tenantId]),
    exec.query(`SELECT * FROM comissao_planos WHERE tenant_id = $1 ORDER BY nome`, [tenantId]),
    exec.query(`SELECT * FROM comissao_metas WHERE tenant_id = $1`, [tenantId]),
  ]);
  const funcoes = fs.map(normalizarFuncao);
  // As funções do sistema existem sempre, mesmo antes da primeira gravação.
  for (const s of funcoes.length < 2 ? funcoesDoSistema() : []) if (!funcoes.some(f => f.id === s.id)) funcoes.unshift(s);
  return {
    funcoes: funcoes.sort((a, b) => (a.sistema ? 0 : 1) - (b.sistema ? 0 : 1) || a.nome.localeCompare(b.nome, 'pt-BR')),
    pessoas: ps.map(r => normalizarPessoaDaFuncao({ ...r, data_inicio: dataISO(r.data_inicio) })),
    planos: pl.map(r => normalizarPlano({ id: r.id, nome: r.nome, modo_faixa: r.modo_faixa, faixas: r.faixas, ativo: r.ativo, versao: r.versao })),
    metas: ms.map(r => ({ pessoa_funcao_id: txt(r.pessoa_funcao_id), mes: txt(r.mes), centavos: n(r.valor_centavos) })),
  };
}

async function garantirFuncoesDoSistema(exec: ExecutorSQL, tenantId: string): Promise<void> {
  for (const f of funcoesDoSistema()) {
    await exec.query(
      `INSERT INTO comissao_funcoes (tenant_id, id, nome, sistema) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, id) DO NOTHING`,
      [tenantId, f.id, f.nome, f.sistema],
    );
  }
}

/** Grava a função e quem está nela (a lista enviada substitui a anterior). */
export async function salvarFuncao(exec: ExecutorSQL, tenantId: string, entrada: { funcao: unknown; pessoas?: unknown[] }): Promise<{ funcao: Funcao; pessoas: PessoaDaFuncao[] }> {
  await garantirFuncoesDoSistema(exec, tenantId);
  const f = normalizarFuncao(entrada.funcao);
  const sistema = funcoesDoSistema().find(s => s.id === f.id);
  if (sistema) { f.nome = sistema.nome; f.sistema = sistema.sistema; }
  else {
    f.sistema = null;
    if (!f.nome) throw new ErroComissao('DADOS', 'Dê um nome à função.');
    if (!f.id) f.id = `fn-${generateId()}`;
    if (!f.sobre_pessoas.length && !f.sobre_unidades.length) throw new ErroComissao('DADOS', 'Diga sobre as vendas de quem esta função ganha: pessoas da equipe, unidades ou as duas.');
  }
  // Quem fecha: só pessoas da equipe e perfis de acesso desta agência.
  if (f.quem_fecha.length) {
    const ids = f.quem_fecha.filter(q => !q.startsWith('grupo:'));
    const grupos = f.quem_fecha.filter(q => q.startsWith('grupo:')).map(q => q.slice(6));
    const [{ rows: us }, { rows: gs }] = await Promise.all([
      ids.length ? exec.query(`SELECT id FROM usuarios WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]) : Promise.resolve({ rows: [] as Linha[] }),
      grupos.length ? exec.query(`SELECT id FROM grupos_usuario WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, grupos]).catch(() => ({ rows: [] as Linha[] })) : Promise.resolve({ rows: [] as Linha[] }),
    ]);
    const validos = new Set([...us.map(r => txt(r.id)), ...gs.map(r => `grupo:${txt(r.id)}`)]);
    f.quem_fecha = f.quem_fecha.filter(q => validos.has(q));
  }
  await exec.query(
    `INSERT INTO comissao_funcoes (tenant_id, id, nome, sistema, sobre_pessoas, sobre_unidades, ativo, quem_fecha) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb)
     ON CONFLICT (tenant_id, id) DO UPDATE SET nome = EXCLUDED.nome, sobre_pessoas = EXCLUDED.sobre_pessoas, sobre_unidades = EXCLUDED.sobre_unidades, ativo = EXCLUDED.ativo,
       quem_fecha = EXCLUDED.quem_fecha`,
    [tenantId, f.id, f.nome, f.sistema, JSON.stringify(f.sobre_pessoas), JSON.stringify(f.sobre_unidades), f.ativo, JSON.stringify(f.quem_fecha)],
  );
  if (!entrada.pessoas) return { funcao: f, pessoas: [] };
  const pessoas = entrada.pessoas.map(p => normalizarPessoaDaFuncao({ ...(p as object), funcao_id: f.id })).filter(p => p.pessoa_id);
  const ids = new Set<string>();
  for (const p of pessoas) {
    if (ids.has(p.pessoa_id)) throw new ErroComissao('DADOS', `${p.pessoa_nome || 'Esta pessoa'} aparece duas vezes na função.`);
    ids.add(p.pessoa_id);
    p.id = `${f.id}:${p.pessoa_id}`;
  }
  await exec.query(`DELETE FROM comissao_pessoas WHERE tenant_id = $1 AND funcao_id = $2 AND NOT (pessoa_id = ANY($3::text[]))`, [tenantId, f.id, [...ids]]);
  for (const p of pessoas) {
    await exec.query(
      `INSERT INTO comissao_pessoas (tenant_id, id, funcao_id, pessoa_id, pessoa_nome, plano_id, data_inicio, nao_comissionado)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
       ON CONFLICT (tenant_id, id) DO UPDATE SET pessoa_nome = EXCLUDED.pessoa_nome, plano_id = EXCLUDED.plano_id,
         data_inicio = EXCLUDED.data_inicio, nao_comissionado = EXCLUDED.nao_comissionado`,
      [tenantId, p.id, f.id, p.pessoa_id, p.pessoa_nome, p.plano_id, p.data_inicio || null, p.nao_comissionado],
    );
  }
  return { funcao: f, pessoas };
}

export async function excluirFuncao(exec: ExecutorSQL, tenantId: string, id: string): Promise<void> {
  if (funcoesDoSistema().some(f => f.id === id)) throw new ErroComissao('SISTEMA', 'Vendedor e Intermediário são funções do sistema e não se apagam.', 409);
  const { rows } = await exec.query(
    `SELECT 1 FROM comissao_lancamentos WHERE tenant_id = $1 AND funcao_id = $2 AND (fechado_centavos <> 0 OR fechado_retido_centavos <> 0) LIMIT 1`, [tenantId, id]);
  if (rows.length) throw new ErroComissao('EM_USO', 'Esta função já tem comissões fechadas. Desligue-a em vez de apagar.', 409);
  await exec.query(`DELETE FROM comissao_metas WHERE tenant_id = $1 AND pessoa_funcao_id LIKE $2`, [tenantId, `${id}:%`]);
  await exec.query(`DELETE FROM comissao_pessoas WHERE tenant_id = $1 AND funcao_id = $2`, [tenantId, id]);
  await exec.query(`DELETE FROM comissao_funcoes WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
}

export async function salvarPlano(exec: ExecutorSQL, tenantId: string, entrada: unknown): Promise<PlanoPorFuncao> {
  const p = normalizarPlano(entrada);
  const erros = errosDoPlano(p);
  if (erros.length) throw new ErroComissao('DADOS', erros[0], 400, { erros });
  if (!p.id) p.id = `pl-${generateId()}`;
  const { rows } = await exec.query(
    `INSERT INTO comissao_planos (tenant_id, id, nome, modo_faixa, faixas, ativo, versao) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 1)
     ON CONFLICT (tenant_id, id) DO UPDATE SET nome = EXCLUDED.nome, modo_faixa = EXCLUDED.modo_faixa, faixas = EXCLUDED.faixas,
       ativo = EXCLUDED.ativo, versao = comissao_planos.versao + 1, atualizado_em = NOW()
     RETURNING versao`,
    [tenantId, p.id, p.nome, p.modo_faixa, JSON.stringify(p.faixas), p.ativo],
  );
  p.versao = n(rows[0]?.versao) || 1;
  return p;
}

export async function excluirPlano(exec: ExecutorSQL, tenantId: string, id: string): Promise<void> {
  const { rows } = await exec.query(`SELECT pessoa_nome FROM comissao_pessoas WHERE tenant_id = $1 AND plano_id = $2 LIMIT 3`, [tenantId, id]);
  if (rows.length) throw new ErroComissao('EM_USO', `Este plano está em uso (${rows.map(r => txt(r.pessoa_nome)).join(', ')}). Troque o plano dessas pessoas antes.`, 409);
  await exec.query(`DELETE FROM comissao_planos WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
}

/** Metas do ano de uma pessoa na função: 12 valores em centavos (janeiro a dezembro). */
export async function salvarMetas(exec: ExecutorSQL, tenantId: string, pessoaFuncaoId: string, ano: number, meses: unknown[]): Promise<MetaDoMes[]> {
  if (!pessoaFuncaoId) throw new ErroComissao('DADOS', 'Escolha a pessoa.');
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroComissao('DADOS', 'Ano inválido.');
  const { rows } = await exec.query(`SELECT 1 FROM comissao_pessoas WHERE tenant_id = $1 AND id = $2`, [tenantId, pessoaFuncaoId]);
  if (!rows.length) throw new ErroComissao('NAO_ENCONTRADA', 'Pessoa não encontrada nesta função.', 404);
  const saida: MetaDoMes[] = [];
  for (let i = 0; i < 12; i++) {
    const v = Math.round(Number(meses[i] ?? 0));
    if (!Number.isFinite(v) || v < 0) throw new ErroComissao('DADOS', 'Meta não pode ser negativa.');
    const mes = `${ano}-${String(i + 1).padStart(2, '0')}`;
    if (v === 0) await exec.query(`DELETE FROM comissao_metas WHERE tenant_id = $1 AND pessoa_funcao_id = $2 AND mes = $3`, [tenantId, pessoaFuncaoId, mes]);
    else {
      await exec.query(
        `INSERT INTO comissao_metas (tenant_id, pessoa_funcao_id, mes, valor_centavos) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, pessoa_funcao_id, mes) DO UPDATE SET valor_centavos = EXCLUDED.valor_centavos`,
        [tenantId, pessoaFuncaoId, mes, v],
      );
      saida.push({ pessoa_funcao_id: pessoaFuncaoId, mes, centavos: v });
    }
  }
  return saida;
}

/**
 * A grade de metas do ano (E7): várias pessoas de uma vez, cada uma com os 12
 * meses. Tudo ou nada: uma linha com erro (meta negativa, pessoa que saiu da
 * função) não grava nenhuma, e a frase diz qual.
 */
export async function salvarGradeDeMetas(exec: ExecutorSQL, tenantId: string, ano: number, linhas: Array<{ pessoa_funcao_id?: unknown; meses?: unknown }>): Promise<{ pessoas: number; metas: MetaDoMes[] }> {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroComissao('DADOS', 'Ano inválido.');
  if (!linhas.length) throw new ErroComissao('DADOS', 'Nenhuma meta para salvar.');
  const { rows } = await exec.query(`SELECT id, pessoa_nome FROM comissao_pessoas WHERE tenant_id = $1`, [tenantId]);
  const nomes = new Map(rows.map(r => [txt(r.id), txt(r.pessoa_nome)]));
  for (const l of linhas) {
    const id = txt(l.pessoa_funcao_id);
    if (!nomes.has(id)) throw new ErroComissao('NAO_ENCONTRADA', 'Uma das pessoas saiu da função. Recarregue a grade.', 404);
    const meses = Array.isArray(l.meses) ? l.meses : [];
    if (meses.some(v => !Number.isFinite(Number(v ?? 0)) || Number(v ?? 0) < 0)) {
      throw new ErroComissao('DADOS', `Meta não pode ser negativa (${nomes.get(id) || 'pessoa'}).`);
    }
  }
  const metas: MetaDoMes[] = [];
  for (const l of linhas) metas.push(...await salvarMetas(exec, tenantId, txt(l.pessoa_funcao_id), ano, Array.isArray(l.meses) ? l.meses : []));
  return { pessoas: linhas.length, metas };
}

// ============================================================
// Quem fecha cada função (E7)
// ============================================================

export interface QuemFecha {
  usuario_id: string;
  /** Ids dos perfis de acesso da pessoa. */
  grupos: string[];
  /** Administrador e superadmin fecham todas. */
  admin: boolean;
}

export async function gruposDaPessoa(exec: ExecutorSQL, tenantId: string, usuarioId: string): Promise<string[]> {
  if (!usuarioId) return [];
  const { rows } = await exec.query(`SELECT grupo_id FROM grupo_usuario_membros WHERE tenant_id = $1 AND usuario_id = $2`, [tenantId, usuarioId])
    .catch(() => ({ rows: [] as Linha[] }));
  return rows.map(r => txt(r.grupo_id));
}

// ============================================================
// Comissão manual na venda (E7)
// ============================================================

export interface ComissaoManualNaVenda extends ComissaoManual {
  criado_em: string;
  fechado_centavos: number;
  pago_centavos: number;
  /** Pode excluir: ainda não entrou em nenhum fechamento. */
  pode_excluir: boolean;
}

function lerManual(r: Linha): ComissaoManual {
  return {
    id: txt(r.id), venda_id: txt(r.venda_id), venda_numero: txt(r.venda_numero), cliente_nome: txt(r.cliente_nome),
    pessoa_funcao_id: txt(r.pessoa_funcao_id), pessoa_id: txt(r.pessoa_id), pessoa_nome: txt(r.pessoa_nome),
    funcao_id: txt(r.funcao_id), funcao_nome: txt(r.funcao_nome), descricao: txt(r.descricao),
    tipo: txt(r.tipo) === 'PERCENTUAL' ? 'PERCENTUAL' : 'VALOR', percentual: Number(r.percentual) || 0,
    base_centavos: n(r.base_centavos), valor_centavos: n(r.valor_centavos), data: dataISO(r.data), lancado_por: txt(r.lancado_por),
  };
}

async function lerManuais(exec: ExecutorSQL, tenantId: string, vendaId?: string): Promise<ComissaoManual[]> {
  const args: unknown[] = [tenantId];
  if (vendaId) args.push(vendaId);
  const { rows } = await exec.query(
    `SELECT * FROM comissao_manuais WHERE tenant_id = $1 AND excluida_em IS NULL${vendaId ? ' AND venda_id = $2' : ''} ORDER BY criado_em, id`, args,
  ).catch(() => ({ rows: [] as Linha[] }));
  return rows.map(lerManual);
}

/** As comissões manuais da venda, com quanto já foi fechado e pago. */
export async function comissoesManuaisDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<ComissaoManualNaVenda[]> {
  const lista = await lerManuais(exec, tenantId, vendaId);
  if (!lista.length) return [];
  const chaves = lista.map(m => `manual|${m.id}`);
  const [{ rows: lanc }, { rows: pagos }, { rows: criados }] = await Promise.all([
    exec.query(`SELECT chave, fechado_centavos FROM comissao_lancamentos WHERE tenant_id = $1 AND chave = ANY($2::text[])`, [tenantId, chaves]),
    exec.query(`SELECT chave, SUM(pago_centavos)::bigint AS pago FROM comissao_fechamento_itens WHERE tenant_id = $1 AND chave = ANY($2::text[]) GROUP BY chave`, [tenantId, chaves]),
    exec.query(`SELECT id, criado_em FROM comissao_manuais WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, lista.map(m => m.id)]),
  ]);
  const fechado = new Map(lanc.map(r => [txt(r.chave), n(r.fechado_centavos)]));
  const pago = new Map(pagos.map(r => [txt(r.chave), n(r.pago)]));
  const quando = new Map(criados.map(r => [txt(r.id), r.criado_em instanceof Date ? r.criado_em.toISOString() : txt(r.criado_em)]));
  return lista.map(m => {
    const f = fechado.get(`manual|${m.id}`) ?? 0;
    const p = pago.get(`manual|${m.id}`) ?? 0;
    return { ...m, criado_em: quando.get(m.id) ?? '', fechado_centavos: f, pago_centavos: p, pode_excluir: f === 0 && p === 0 };
  });
}

/**
 * Lança a comissão manual numa venda FECHADA (os números dela já não mudam),
 * para uma pessoa que está numa função de comissão. Só na regra por função:
 * na regra de hoje não há onde ela entrar.
 */
export async function lancarComissaoManual(
  exec: ExecutorSQL, tenantId: string, vendaId: string,
  entrada: { pessoa_funcao_id?: unknown; descricao?: unknown; tipo?: unknown; percentual?: unknown; valor_centavos?: unknown },
  usuario: UsuarioDaAcao, hoje = hojeISO(),
): Promise<ComissaoManualNaVenda> {
  const config = await lerConfigComissao(exec, tenantId);
  if (config.regra !== 'FUNCOES') {
    throw new ErroComissao('REGRA_ATUAL', 'A comissão manual entra no Fechar comissões da regra por função. A agência ainda usa o plano por vendedor (Configurações › Comissões).', 409);
  }
  const carregada = await carregarVenda(exec, tenantId, vendaId);
  if (!carregada) throw new ErroComissao('NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  if (carregada.situacao !== 'FECHADA') throw new ErroComissao('VENDA_ABERTA', 'Feche a venda antes de lançar comissão manual: assim a base não muda depois.', 409);
  if (txt(carregada.cabecalho.status).toUpperCase() === 'CANCELADO') throw new ErroComissao('VENDA_CANCELADA', 'A venda está cancelada.', 409);
  const pfId = txt(entrada.pessoa_funcao_id);
  const cadastro = await lerCadastro(exec, tenantId);
  const pessoa = cadastro.pessoas.find(p => p.id === pfId);
  if (!pessoa) throw new ErroComissao('DADOS', 'Escolha a pessoa (ela precisa estar numa função de comissão).');
  const funcao = cadastro.funcoes.find(f => f.id === pessoa.funcao_id);
  const cfgVenda = await lerConfigVenda(exec, tenantId);
  const base = baseDaComissaoManual(carregada.venda, cfgVenda.receita);
  const p = prepararComissaoManual(entrada, base);
  if (p.erros.length) throw new ErroComissao('DADOS', p.erros[0], 400, { erros: p.erros });
  const id = `cm-${generateId()}`;
  await exec.query(
    `INSERT INTO comissao_manuais (tenant_id, id, venda_id, venda_numero, cliente_nome, pessoa_funcao_id, pessoa_id, pessoa_nome, funcao_id, funcao_nome,
       descricao, tipo, percentual, base_centavos, valor_centavos, data, lancado_por_id, lancado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::date, $17, $18)`,
    [tenantId, id, vendaId, carregada.venda.numero, carregada.venda.cliente?.nome ?? '', pessoa.id, pessoa.pessoa_id, pessoa.pessoa_nome,
      pessoa.funcao_id, funcao?.nome ?? '', p.descricao, p.tipo, p.percentual, p.tipo === 'PERCENTUAL' ? base : 0, p.valor_centavos, hoje,
      usuario.id, usuario.nome || usuario.id],
  );
  await eventoDaVenda(exec, tenantId, vendaId, 'comissao_manual', usuario, { comissao_manual_id: id, pessoa: pessoa.pessoa_nome, descricao: p.descricao, valor_centavos: p.valor_centavos });
  const lista = await comissoesManuaisDaVenda(exec, tenantId, vendaId);
  return lista.find(m => m.id === id)!;
}

/** O histórico da venda (venda_eventos, imutável) ganha a linha da comissão manual. */
async function eventoDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, tipo: string, usuario: UsuarioDaAcao, detalhe: Record<string, unknown>): Promise<void> {
  await exec.query(
    `INSERT INTO venda_eventos (tenant_id, id, venda_id, tipo, usuario_id, usuario_nome, detalhe) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [tenantId, generateId(), vendaId, tipo, usuario.id, usuario.nome, JSON.stringify(detalhe)],
  );
}

/** Exclui a comissão manual que ainda não entrou em nenhum fechamento. */
export async function excluirComissaoManual(exec: ExecutorSQL, tenantId: string, vendaId: string, id: string, usuario: UsuarioDaAcao): Promise<void> {
  const { rows } = await exec.query(
    `SELECT id, descricao, pessoa_nome FROM comissao_manuais WHERE tenant_id = $1 AND venda_id = $2 AND id = $3 AND excluida_em IS NULL FOR UPDATE`, [tenantId, vendaId, id]);
  if (!rows.length) throw new ErroComissao('NAO_ENCONTRADA', 'Comissão manual não encontrada.', 404);
  const { rows: l } = await exec.query(
    `SELECT fechado_centavos FROM comissao_lancamentos WHERE tenant_id = $1 AND chave = $2 FOR UPDATE`, [tenantId, `manual|${id}`]);
  if (n(l[0]?.fechado_centavos) !== 0) {
    throw new ErroComissao('JA_FECHADA', 'Esta comissão já entrou num fechamento e não se exclui mais.', 409);
  }
  await exec.query(`UPDATE comissao_manuais SET excluida_em = NOW(), excluida_por = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, usuario.nome || usuario.id]);
  await exec.query(`DELETE FROM comissao_lancamentos WHERE tenant_id = $1 AND chave = $2 AND fechado_centavos = 0 AND fechado_retido_centavos = 0`, [tenantId, `manual|${id}`]);
  await eventoDaVenda(exec, tenantId, vendaId, 'comissao_manual_excluida', usuario, { comissao_manual_id: id, pessoa: txt(rows[0].pessoa_nome), descricao: txt(rows[0].descricao) });
}

// ============================================================
// Cálculo
// ============================================================

/** Status do cabeçalho que geram comissão (as canceladas entram para estornar). */
const STATUS_QUE_CONTAM = new Set(['CONFIRMADO', 'CONCLUIDO', 'CANCELADO']);

export interface CalculoNoBanco {
  config: ConfigComissao;
  cadastro: CadastroDeComissoes;
  itens: ItemDeComissao[];
  resumos: ResumoDoParticipante[];
  gravados: LancamentoGravado[];
}

async function lerGravados(exec: ExecutorSQL, tenantId: string, config: ConfigComissao): Promise<LancamentoGravado[]> {
  const { rows } = await exec.query(`SELECT * FROM comissao_lancamentos WHERE tenant_id = $1`, [tenantId]);
  return rows
    .map(r => ({
      chave: txt(r.chave), pessoa_funcao_id: txt(r.pessoa_funcao_id), pessoa_id: txt(r.pessoa_id), pessoa_nome: txt(r.pessoa_nome),
      funcao_nome: txt(r.funcao_nome), venda_id: txt(r.venda_id), venda_numero: txt(r.venda_numero), data_venda: dataISO(r.data_venda),
      mes: txt(r.mes), descricao: txt(r.descricao), fechado_centavos: n(r.fechado_centavos), fechado_retido_centavos: n(r.fechado_retido_centavos),
    }))
    // Venda de antes da data inicial fica como está: mudar a data não estorna o que já foi fechado.
    // A comissão manual (manual|...) entra sempre: ela está no cálculo, seja qual for a data.
    .filter(g => g.chave.startsWith('manual|') || !config.data_inicial || !g.data_venda || g.data_venda >= config.data_inicial);
}

export async function calcularNoBanco(exec: ExecutorSQL, tenantId: string, ate: string, opcoes: { so_participantes?: string[] } = {}): Promise<CalculoNoBanco> {
  const [config, cadastro, cfgVenda] = await Promise.all([lerConfigComissao(exec, tenantId), lerCadastro(exec, tenantId), lerConfigVenda(exec, tenantId)]);
  const lidas = (await lerVendas(exec, tenantId, { de: config.data_inicial || undefined, incluir_canceladas: true }))
    .filter(v => STATUS_QUE_CONTAM.has(v.status) || v.versao_modelo === 2);
  let recebimentos: Record<string, RecebimentoDoCliente> | undefined;
  if (config.liberar === 'RECEBIMENTO') {
    recebimentos = Object.fromEntries(await lerRecebimentos(exec, tenantId, lidas.map(v => v.venda.id)));
  }
  const manuais: ComissaoManual[] = await lerManuais(exec, tenantId);
  // A venda da comissão manual pode ser de antes da data inicial: lê só o cancelamento dela.
  const lidasIds = new Set(lidas.map(v => v.venda.id));
  const faltam = [...new Set(manuais.map(m => m.venda_id).filter(id => !lidasIds.has(id)))];
  const canceladasFora = faltam.length
    ? (await exec.query(`SELECT id FROM vendas_crm WHERE tenant_id = $1 AND id = ANY($2::text[]) AND UPPER(COALESCE(data->>'status', status, '')) = 'CANCELADO'`, [tenantId, faltam])).rows.map(r => txt(r.id))
    : [];
  const { itens, resumos } = calcularComissoesPorFuncao({
    vendas: lidas.map(v => ({ venda: v.venda, cancelada: v.cancelada, situacao: v.situacao })),
    vendas_canceladas: canceladasFora,
    funcoes: cadastro.funcoes, pessoas: cadastro.pessoas, planos: cadastro.planos, metas: cadastro.metas,
    config, config_receita: cfgVenda.receita, ate, recebimentos, so_participantes: opcoes.so_participantes, manuais,
  });
  let gravados = await lerGravados(exec, tenantId, config);
  if (opcoes.so_participantes?.length) {
    const so = new Set(opcoes.so_participantes);
    gravados = gravados.filter(g => so.has(g.pessoa_funcao_id));
  }
  return { config, cadastro, itens, resumos, gravados };
}

async function gravarItem(exec: ExecutorSQL, tenantId: string, i: ItemDeComissao): Promise<void> {
  await exec.query(
    `INSERT INTO comissao_lancamentos (tenant_id, chave, venda_id, venda_numero, data_venda, mes, produto_id, descricao, pessoa_funcao_id, pessoa_id,
       pessoa_nome, funcao_id, funcao_nome, plano_id, valor_centavos, retido_centavos, liberado_centavos, liberado_retido_centavos, explicacao, calculado_em)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, NOW())
     ON CONFLICT (tenant_id, chave) DO UPDATE SET venda_numero = EXCLUDED.venda_numero, data_venda = EXCLUDED.data_venda, mes = EXCLUDED.mes,
       descricao = EXCLUDED.descricao, pessoa_nome = EXCLUDED.pessoa_nome, funcao_nome = EXCLUDED.funcao_nome, plano_id = EXCLUDED.plano_id,
       valor_centavos = EXCLUDED.valor_centavos, retido_centavos = EXCLUDED.retido_centavos, liberado_centavos = EXCLUDED.liberado_centavos,
       liberado_retido_centavos = EXCLUDED.liberado_retido_centavos, explicacao = EXCLUDED.explicacao, calculado_em = NOW()`,
    [tenantId, i.chave, i.venda_id, i.venda_numero, i.data_venda || null, i.mes, i.produto_id, i.descricao, i.pessoa_funcao_id, i.pessoa_id,
      i.pessoa_nome, i.funcao_id, i.funcao_nome, i.plano_id, i.valor_centavos, i.retido_centavos, i.liberado_centavos, i.liberado_retido_centavos,
      JSON.stringify(i.explicacao)],
  );
}

/** O que saiu do cálculo: zerado (para o estorno) ou apagado (se nunca foi fechado). */
async function zerarForaDoCalculo(exec: ExecutorSQL, tenantId: string, chaves: string[]): Promise<void> {
  if (!chaves.length) return;
  await exec.query(`DELETE FROM comissao_lancamentos WHERE tenant_id = $1 AND chave = ANY($2::text[]) AND fechado_centavos = 0 AND fechado_retido_centavos = 0`, [tenantId, chaves]);
  await exec.query(
    `UPDATE comissao_lancamentos SET valor_centavos = 0, retido_centavos = 0, liberado_centavos = 0, liberado_retido_centavos = 0,
       explicacao = jsonb_set(explicacao, '{motivo}', '"SAIU_DO_CALCULO"', true), calculado_em = NOW()
     WHERE tenant_id = $1 AND chave = ANY($2::text[])`,
    [tenantId, chaves],
  );
}

/**
 * O cálculo do dia: refaz os lançamentos de todas as pessoas com a liberação
 * até hoje. Não fecha nada; só mantém a prévia e o painel em dia.
 */
export async function recalcularComissoes(exec: ExecutorSQL, tenantId: string, hoje = hojeISO()): Promise<{ regra: ConfigComissao['regra']; itens: number; fora: number; pessoas_com_erro: number }> {
  const config = await lerConfigComissao(exec, tenantId);
  if (config.regra !== 'FUNCOES') return { regra: config.regra, itens: 0, fora: 0, pessoas_com_erro: 0 };
  const c = await calcularNoBanco(exec, tenantId, hoje);
  for (const i of c.itens) await gravarItem(exec, tenantId, i);
  const vistos = new Set(c.itens.map(i => i.chave));
  // Pessoa com erro no mês fica como estava: o erro não pode estornar o que ela já tem.
  // Venda de antes da data inicial também: mudar a data não estorna o que já foi fechado.
  const comErro = new Set(c.resumos.filter(r => r.erros.length).map(r => `${r.pessoa_funcao_id}|${r.mes}`));
  const { rows: todos } = await exec.query(`SELECT chave, pessoa_funcao_id, mes, data_venda FROM comissao_lancamentos WHERE tenant_id = $1`, [tenantId]);
  const fora = todos
    .filter(r => !vistos.has(txt(r.chave)) && !comErro.has(`${txt(r.pessoa_funcao_id)}|${txt(r.mes)}`))
    .filter(r => !(config.data_inicial && dataISO(r.data_venda) && dataISO(r.data_venda) < config.data_inicial))
    .map(r => txt(r.chave));
  await zerarForaDoCalculo(exec, tenantId, fora);
  return { regra: config.regra, itens: c.itens.length, fora: fora.length, pessoas_com_erro: new Set(c.resumos.filter(r => r.erros.length).map(r => r.pessoa_funcao_id)).size };
}

/** Tarefa do agendador: o cálculo do dia, a partir das 4h de Brasília, das agências na regra nova. */
export const tarefaComissoesDoDia: DefinicaoTarefa = {
  nome: 'comissoes-calculo',
  janela: janelaDiaria(4),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(`SELECT tenant_id FROM comissao_config WHERE dados->>'regra' = 'FUNCOES' ORDER BY tenant_id`);
    return rows.map(r => txt(r.tenant_id));
  },
  executar: async ({ emTransacao: tx }, tenantId) => {
    const r = await tx(exec => recalcularComissoes(exec, tenantId));
    return { ...r };
  },
};

// ============================================================
// Fechar comissões
// ============================================================

export interface PreviaDoFechamento {
  ate: string;
  regra: ConfigComissao['regra'];
  linhas: LinhaDoFechamento[];
  assinatura: string;
  /** Vendas do período ainda abertas (não entram quando a agência só comissiona vendas fechadas). */
  vendas_abertas: number;
  so_as_suas: boolean;
  /** Funções que outra pessoa fecha (E7): as linhas delas não aparecem para quem pediu. */
  funcoes_de_outros: string[];
  /** O dia de fechamento das metas (0 = último dia do mês). */
  dia_fechamento_meta: number;
}

/** As funções desta agência que a pessoa NÃO fecha (pela lista "quem fecha" de cada uma). */
function funcoesQueNaoFecha(funcoes: Funcao[], quem: QuemFecha | undefined): Funcao[] {
  if (!quem) return [];
  return funcoes.filter(f => !podeFecharAFuncao(f, quem.usuario_id, quem.grupos, quem.admin));
}

export async function previaDoFechamento(
  exec: ExecutorSQL, tenantId: string, ate: string, filtro: { funcao_id?: string; pessoa_id?: string; quem?: QuemFecha } = {},
): Promise<PreviaDoFechamento> {
  const c = await calcularNoBanco(exec, tenantId, ate);
  let linhas = linhasDoFechamento(c.resumos, itensAFechar(c.itens, c.gravados));
  // Quem não fecha a função não vê as linhas dela aqui; as outras seguem.
  const deOutros = filtro.pessoa_id === undefined ? funcoesQueNaoFecha(c.cadastro.funcoes, filtro.quem) : [];
  if (deOutros.length) {
    const ocultas = new Set(c.cadastro.pessoas.filter(p => deOutros.some(f => f.id === p.funcao_id)).map(p => p.id));
    linhas = linhas.filter(l => !ocultas.has(l.pessoa_funcao_id));
  }
  if (filtro.funcao_id) {
    const daFuncao = new Set(c.cadastro.pessoas.filter(p => p.funcao_id === filtro.funcao_id).map(p => p.id));
    linhas = linhas.filter(l => daFuncao.has(l.pessoa_funcao_id));
  }
  if (filtro.pessoa_id !== undefined) linhas = linhas.filter(l => l.pessoa_id === filtro.pessoa_id);
  let vendas_abertas = 0;
  if (c.config.so_vendas_fechadas) {
    const { rows } = await exec.query(
      `SELECT COUNT(*)::int AS n FROM vendas_modelo WHERE tenant_id = $1 AND situacao = 'ABERTA' AND data_venda <= $2::date AND ($3 = '' OR data_venda >= NULLIF($3, '')::date)`,
      [tenantId, ate, c.config.data_inicial],
    ).catch(() => ({ rows: [{ n: 0 }] }));
    vendas_abertas = n(rows[0]?.n);
  }
  return {
    ate, regra: c.config.regra, linhas, assinatura: assinaturaDaPrevia(ate, linhas), vendas_abertas, so_as_suas: filtro.pessoa_id !== undefined,
    funcoes_de_outros: deOutros.map(f => f.nome), dia_fechamento_meta: c.config.dia_fechamento_meta,
  };
}

export interface ResultadoDoFechamento {
  fechamento_id: string;
  ate: string;
  fechados: Array<{ pessoa_funcao_id: string; pessoa_nome: string; funcao_nome: string; itens: number; saldo_centavos: number }>;
  recusados: Array<{ pessoa_funcao_id: string; pessoa_nome: string; funcao_nome: string; motivo: string }>;
}

/**
 * Fecha as comissões até `ate` das pessoas escolhidas. Cada pessoa na sua
 * transação: a que tem erro (ou falha ao gravar) volta em `recusados`, as
 * outras fecham.
 */
export async function fecharComissoes(
  tx: Transacao, exec: ExecutorSQL, tenantId: string,
  entrada: { ate: string; participantes: string[]; assinatura?: string },
  usuario: UsuarioDaAcao,
  quem?: QuemFecha,
): Promise<ResultadoDoFechamento> {
  const config = await lerConfigComissao(exec, tenantId);
  if (config.regra !== 'FUNCOES') throw new ErroComissao('REGRA_ATUAL', 'A agência usa a regra de comissão de hoje. Escolha a regra por função em Configurações › Comissões para fechar por aqui.', 409);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.ate)) throw new ErroComissao('DADOS', 'Diga até que data fechar.');
  const quer = [...new Set(entrada.participantes.filter(Boolean))];
  if (!quer.length) throw new ErroComissao('DADOS', 'Escolha ao menos uma pessoa para fechar.');
  const c = await calcularNoBanco(exec, tenantId, entrada.ate);
  const todas = linhasDoFechamento(c.resumos, itensAFechar(c.itens, c.gravados));
  if (entrada.assinatura) {
    const vistas = todas.filter(l => quer.includes(l.pessoa_funcao_id));
    if (assinaturaDaPrevia(entrada.ate, vistas) !== entrada.assinatura) {
      throw new ErroComissao('MUDOU', 'Os números mudaram desde a prévia (venda nova, recebimento ou mudança no plano). Confira de novo antes de fechar.', 409);
    }
  }
  const fechamentoId = `fc-${generateId()}`;
  await exec.query(`INSERT INTO comissao_fechamentos (tenant_id, id, ate, usuario_id, usuario_nome) VALUES ($1, $2, $3::date, $4, $5)`,
    [tenantId, fechamentoId, entrada.ate, usuario.id, usuario.nome]);
  const itensPorChave = new Map(c.itens.map(i => [i.chave, i]));
  const resultado: ResultadoDoFechamento = { fechamento_id: fechamentoId, ate: entrada.ate, fechados: [], recusados: [] };
  const naoFecha = new Set(funcoesQueNaoFecha(c.cadastro.funcoes, quem).map(f => f.id));
  for (const id of quer) {
    const linha = todas.find(l => l.pessoa_funcao_id === id);
    const pessoa = c.cadastro.pessoas.find(p => p.id === id);
    const nome = linha?.pessoa_nome ?? pessoa?.pessoa_nome ?? id;
    const funcao = linha?.funcao_nome ?? c.cadastro.funcoes.find(f => f.id === pessoa?.funcao_id)?.nome ?? '';
    // A função da pessoa: pelo cadastro, ou pelo id "funcao:pessoa" quando ela já saiu da função.
    const funcaoId = pessoa?.funcao_id ?? id.split(':')[0];
    if (naoFecha.has(funcaoId)) {
      resultado.recusados.push({ pessoa_funcao_id: id, pessoa_nome: nome, funcao_nome: funcao, motivo: `Quem fecha a função ${funcao || 'desta pessoa'} são outras pessoas (Equipe › Funções).` });
      continue;
    }
    if (!linha) { resultado.recusados.push({ pessoa_funcao_id: id, pessoa_nome: nome, funcao_nome: funcao, motivo: 'Nada a fechar até esta data.' }); continue; }
    if (linha.erros.length) { resultado.recusados.push({ pessoa_funcao_id: id, pessoa_nome: nome, funcao_nome: funcao, motivo: linha.erros.join(' ') }); continue; }
    if (!linha.itens.length) { resultado.recusados.push({ pessoa_funcao_id: id, pessoa_nome: nome, funcao_nome: funcao, motivo: 'Nada a fechar até esta data.' }); continue; }
    try {
      const r = await tx(async e => fecharUmaPessoa(e, tenantId, fechamentoId, linha.itens, itensPorChave));
      if (r.itens) resultado.fechados.push({ pessoa_funcao_id: id, pessoa_nome: nome, funcao_nome: funcao, ...r });
      else resultado.recusados.push({ pessoa_funcao_id: id, pessoa_nome: nome, funcao_nome: funcao, motivo: 'Nada a fechar até esta data (outra pessoa fechou agora há pouco).' });
    } catch (e) {
      resultado.recusados.push({ pessoa_funcao_id: id, pessoa_nome: nome, funcao_nome: funcao, motivo: e instanceof Error ? e.message : 'Erro ao gravar.' });
    }
  }
  await exec.query(`UPDATE comissao_fechamentos SET resumo = $3::jsonb WHERE tenant_id = $1 AND id = $2`,
    [tenantId, fechamentoId, JSON.stringify({ fechados: resultado.fechados, recusados: resultado.recusados })]);
  return resultado;
}

async function fecharUmaPessoa(exec: ExecutorSQL, tenantId: string, fechamentoId: string, itens: ItemAFechar[], calculados: Map<string, ItemDeComissao>): Promise<{ itens: number; saldo_centavos: number }> {
  let qtd = 0;
  let saldo = 0;
  for (const i of itens) {
    const calc = calculados.get(i.chave);
    if (calc) await gravarItem(exec, tenantId, calc);
    // Relê o já fechado com a linha travada: duas pessoas fechando ao mesmo tempo não fecham o mesmo valor duas vezes.
    const { rows } = await exec.query(
      `SELECT fechado_centavos, fechado_retido_centavos FROM comissao_lancamentos WHERE tenant_id = $1 AND chave = $2 FOR UPDATE`, [tenantId, i.chave]);
    const fechado = n(rows[0]?.fechado_centavos);
    const fechadoRetido = n(rows[0]?.fechado_retido_centavos);
    const valor = i.liberado_centavos - fechado;
    const retido = i.liberado_retido_centavos - fechadoRetido;
    if (valor === 0 && retido === 0) continue;
    await exec.query(
      `INSERT INTO comissao_fechamento_itens (tenant_id, id, fechamento_id, chave, pessoa_funcao_id, pessoa_id, pessoa_nome, funcao_nome, venda_id,
         venda_numero, data_venda, descricao, valor_centavos, retido_centavos, saldo_centavos, estorno, explicacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13, $14, $15, $16, $17::jsonb)`,
      [tenantId, `fi-${generateId()}`, fechamentoId, i.chave, i.pessoa_funcao_id, i.pessoa_id, i.pessoa_nome, i.funcao_nome, i.venda_id,
        i.venda_numero, i.data_venda || null, i.descricao, valor, retido, valor - retido, valor - retido < 0, i.explicacao ? JSON.stringify(i.explicacao) : null],
    );
    if (rows.length) {
      await exec.query(`UPDATE comissao_lancamentos SET fechado_centavos = fechado_centavos + $3, fechado_retido_centavos = fechado_retido_centavos + $4 WHERE tenant_id = $1 AND chave = $2`,
        [tenantId, i.chave, valor, retido]);
    }
    qtd++;
    saldo += valor - retido;
  }
  return { itens: qtd, saldo_centavos: saldo };
}

// ============================================================
// Pagar comissões
// ============================================================

export interface ItemAPagar {
  id: string;
  fechamento_id: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  descricao: string;
  funcao_nome: string;
  valor_centavos: number;
  retido_centavos: number;
  saldo_centavos: number;
  pago_centavos: number;
  aberto_centavos: number;
  estorno: boolean;
}

export interface PessoaAPagar {
  pessoa_id: string;
  pessoa_nome: string;
  aberto_centavos: number;
  itens: ItemAPagar[];
}

export async function comissoesAPagar(exec: ExecutorSQL, tenantId: string, filtro: { pessoa_id?: string } = {}): Promise<PessoaAPagar[]> {
  const args: unknown[] = [tenantId];
  let cond = '';
  if (filtro.pessoa_id !== undefined) { args.push(filtro.pessoa_id); cond = ` AND pessoa_id = $2`; }
  const { rows } = await exec.query(
    `SELECT * FROM comissao_fechamento_itens WHERE tenant_id = $1 AND saldo_centavos <> pago_centavos${cond} ORDER BY pessoa_nome, data_venda NULLS LAST, id`, args);
  const mapa = new Map<string, PessoaAPagar>();
  for (const r of rows) {
    const k = txt(r.pessoa_id);
    const p = mapa.get(k) ?? { pessoa_id: k, pessoa_nome: txt(r.pessoa_nome), aberto_centavos: 0, itens: [] };
    const aberto = n(r.saldo_centavos) - n(r.pago_centavos);
    p.itens.push({
      id: txt(r.id), fechamento_id: txt(r.fechamento_id), venda_id: txt(r.venda_id), venda_numero: txt(r.venda_numero), data_venda: dataISO(r.data_venda),
      descricao: txt(r.descricao), funcao_nome: txt(r.funcao_nome), valor_centavos: n(r.valor_centavos), retido_centavos: n(r.retido_centavos),
      saldo_centavos: n(r.saldo_centavos), pago_centavos: n(r.pago_centavos), aberto_centavos: aberto, estorno: r.estorno === true,
    });
    p.aberto_centavos += aberto;
    mapa.set(k, p);
  }
  return [...mapa.values()];
}

export interface ResultadoDoPagamento {
  pagos: Array<{ pessoa_id: string; pessoa_nome: string; pagamento_id: string; valor_centavos: number; conta_tabela: 'contas_pagar' | 'contas_receber'; conta_id: string; vencimento: string }>;
  recusados: Array<{ pessoa_id: string; pessoa_nome: string; motivo: string }>;
}

async function categoriaPadrao(exec: ExecutorSQL, tenantId: string, escolhida: string): Promise<string> {
  if (escolhida) return escolhida;
  const { rows } = await exec.query(`SELECT id FROM plano_contas WHERE tenant_id = $1 AND (codigo = '2.6' OR data->>'codigo' = '2.6') ORDER BY id LIMIT 1`, [tenantId])
    .catch(() => ({ rows: [] as Linha[] }));
  return txt(rows[0]?.id);
}

/**
 * Paga as comissões fechadas: total (todas as pessoas escolhidas) ou parcial
 * (uma pessoa só, um valor). Uma conta por pessoa, com o detalhe das vendas.
 */
export async function pagarComissoes(
  tx: Transacao, exec: ExecutorSQL, tenantId: string,
  entrada: { modo: 'TOTAL' | 'PARCIAL'; pessoas: string[]; valor_centavos?: number },
  usuario: UsuarioDaAcao, hoje = hojeISO(),
): Promise<ResultadoDoPagamento> {
  const config = await lerConfigComissao(exec, tenantId);
  if (config.regra !== 'FUNCOES') throw new ErroComissao('REGRA_ATUAL', 'A agência usa a regra de comissão de hoje: o pagamento é pela tela de Comissões.', 409);
  const pessoas = [...new Set(entrada.pessoas.filter(Boolean))];
  if (!pessoas.length) throw new ErroComissao('DADOS', 'Escolha ao menos uma pessoa.');
  if (entrada.modo === 'PARCIAL') {
    if (pessoas.length !== 1) throw new ErroComissao('DADOS', 'O pagamento parcial é de uma pessoa por vez.');
    if (!Number.isInteger(entrada.valor_centavos) || (entrada.valor_centavos ?? 0) <= 0) throw new ErroComissao('DADOS', 'Diga quanto pagar agora.');
  }
  const { rows: ag } = await exec.query(`SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId])
    .catch(() => ({ rows: [] as Linha[] }));
  const agenda = (ag[0]?.data as Linha | undefined)?.datas_pagamento_comissao;
  const catPagar = await categoriaPadrao(exec, tenantId, config.categoria_pagamento_id);
  const catReceber = config.categoria_recebimento_id || catPagar;
  const resultado: ResultadoDoPagamento = { pagos: [], recusados: [] };
  for (const pessoaId of pessoas) {
    try {
      const r = await tx(async e => {
        const { rows } = await e.query(
          `SELECT id, pessoa_nome, venda_numero, data_venda, descricao, funcao_nome, saldo_centavos, pago_centavos FROM comissao_fechamento_itens
            WHERE tenant_id = $1 AND pessoa_id = $2 AND saldo_centavos <> pago_centavos ORDER BY data_venda NULLS LAST, id FOR UPDATE`,
          [tenantId, pessoaId],
        );
        if (!rows.length) throw new ErroComissao('NADA', 'Nenhuma comissão fechada em aberto. Feche as comissões antes de pagar.');
        const nome = txt(rows[0].pessoa_nome);
        const aberto = rows.reduce((a, x) => a + n(x.saldo_centavos) - n(x.pago_centavos), 0);
        if (entrada.modo === 'PARCIAL') {
          if (aberto <= 0) throw new ErroComissao('DADOS', 'Esta pessoa não tem saldo a receber: não há o que pagar em parte.');
          if ((entrada.valor_centavos ?? 0) > aberto) throw new ErroComissao('DADOS', `O valor passa do que está em aberto (${(aberto / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`);
        }
        const partes = repartirPagamento(
          rows.map(x => ({ id: txt(x.id), data_venda: dataISO(x.data_venda), saldo_centavos: n(x.saldo_centavos), pago_centavos: n(x.pago_centavos) })),
          entrada.modo === 'PARCIAL' ? entrada.valor_centavos ?? 0 : null,
        );
        const total = partes.reduce((a, p) => a + p.centavos, 0);
        if (total === 0) throw new ErroComissao('NADA', 'Os créditos e os estornos desta pessoa se anulam: nada a pagar.');
        for (const p of partes) await e.query(`UPDATE comissao_fechamento_itens SET pago_centavos = pago_centavos + $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, p.id, p.centavos]);
        const pagamentoId = `cpg-${generateId()}`;
        const porId = new Map(rows.map(x => [txt(x.id), x]));
        const detalhe = partes.map(p => {
          const x = porId.get(p.id)!;
          return { item_id: p.id, venda_numero: txt(x.venda_numero), descricao: txt(x.descricao), funcao: txt(x.funcao_nome), centavos: p.centavos };
        });
        const venc = vencimentoDaComissao(agenda, hoje, hoje);
        const linhasObs = detalhe.map(d => `${d.venda_numero || 'sem número'} · ${d.descricao} · ${d.funcao}: ${(d.centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
        const observacoes = [
          `Comissões ${entrada.modo === 'PARCIAL' ? 'pagas em parte' : 'fechadas'} de ${nome}.`,
          ...linhasObs,
          venc.semAgenda ? 'Agenda de pagamento de comissão não configurada: vencimento no fim do mês.' : '',
        ].filter(Boolean).join('\n');
        const valor = deCentavos(Math.abs(total));
        let contaTabela: 'contas_pagar' | 'contas_receber' = 'contas_pagar';
        const contaId = `${total > 0 ? 'cp' : 'cr'}-comissao-pag-${pagamentoId}`;
        if (total > 0) {
          const conta = {
            id: contaId, origem: 'OUTROS', venda_id: null, grupo_id: null, fornecedor_id: '', fornecedor_nome: nome,
            descricao: `Comissões · ${nome}`, categoria_id: catPagar, centro_custo: '', valor_original: valor, juros: 0, multa: 0, desconto: 0,
            valor_final: valor, moeda: 'BRL', cambio: 1, valor_brl: valor, data_emissao: hoje, data_vencimento: venc.data,
            data_pagamento: null, valor_pago: null, conta_bancaria_id: null, forma_pagamento: '', cartao_id: null, comprovante: '',
            parcela_numero: 1, total_parcelas: 1, natureza_custo: 'VARIAVEL', is_custo_comercial: true, status: 'PENDENTE',
            rateio: [], anexos: [], observacoes, auto_gerado: true, origem_comissao_id: pagamentoId, comissao_pagamento_id: pagamentoId,
            comissao_pessoa_id: pessoaId, comissao_detalhe: detalhe,
          };
          await e.query(`INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data) VALUES ($1, $2, '', 'PENDENTE', $3::jsonb)`, [contaId, tenantId, JSON.stringify(conta)]);
        } else {
          contaTabela = 'contas_receber';
          const conta = {
            id: contaId, origem: 'OUTROS', venda_id: null, grupo_id: null, cliente_id: '', cliente_nome: nome,
            descricao: `Comissões a devolver · ${nome}`, categoria_id: catReceber, centro_custo: '', valor_original: valor, juros: 0, multa: 0, desconto: 0,
            valor_final: valor, data_emissao: hoje, data_vencimento: venc.data, data_recebimento: null, valor_recebido: null,
            conta_bancaria_id: null, forma_recebimento: '', taxa: 0, taxa_plataforma: '', parcela_numero: 1, total_parcelas: 1,
            boleto_emitido: false, boleto_codigo: '', boleto_url: '', status: 'PENDENTE', rateio: [], anexos: [],
            observacoes: `${nome} recebeu (ou reteve) mais comissão do que tinha direito depois dos estornos.\n${linhasObs.join('\n')}`,
            auto_gerado: true, comissao_pagamento_id: pagamentoId, comissao_pessoa_id: pessoaId, comissao_detalhe: detalhe,
          };
          await e.query(`INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data) VALUES ($1, $2, '', '', 'PENDENTE', $3::jsonb)`, [contaId, tenantId, JSON.stringify(conta)]);
        }
        await e.query(
          `INSERT INTO comissao_pagamentos (tenant_id, id, pessoa_id, pessoa_nome, modo, valor_centavos, conta_tabela, conta_id, itens, usuario_id, usuario_nome)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
          [tenantId, pagamentoId, pessoaId, nome, entrada.modo, total, contaTabela, contaId, JSON.stringify(detalhe), usuario.id, usuario.nome],
        );
        return { pessoa_id: pessoaId, pessoa_nome: nome, pagamento_id: pagamentoId, valor_centavos: total, conta_tabela: contaTabela, conta_id: contaId, vencimento: venc.data };
      });
      resultado.pagos.push(r);
    } catch (e) {
      if (e instanceof ErroComissao && entrada.modo === 'PARCIAL') throw e;
      const { rows } = await exec.query(`SELECT pessoa_nome FROM comissao_fechamento_itens WHERE tenant_id = $1 AND pessoa_id = $2 LIMIT 1`, [tenantId, pessoaId]).catch(() => ({ rows: [] as Linha[] }));
      resultado.recusados.push({ pessoa_id: pessoaId, pessoa_nome: txt(rows[0]?.pessoa_nome) || pessoaId, motivo: e instanceof Error ? e.message : 'Erro ao gravar.' });
    }
  }
  return resultado;
}

// ============================================================
// Painel do vendedor
// ============================================================

export interface ItemDoPainel {
  chave: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  descricao: string;
  cliente_nome: string;
  funcao_nome: string;
  valor_centavos: number;
  retido_centavos: number;
  liberado_centavos: number;
  fechado_centavos: number;
  pago_centavos: number;
  situacao: SituacaoDoItem;
  por_que: string[];
}

export interface PainelDoVendedor {
  pessoa_id: string;
  mes: string;
  rotulo_mes: string;
  regra: ConfigComissao['regra'];
  resumos: ResumoDoParticipante[];
  itens: ItemDoPainel[];
  totais: { previsto: number; liberado: number; fechado: number; pago: number };
}

export async function painelDoVendedor(exec: ExecutorSQL, tenantId: string, pessoaId: string, mes: string, hoje = hojeISO()): Promise<PainelDoVendedor> {
  const config = await lerConfigComissao(exec, tenantId);
  const vazio: PainelDoVendedor = { pessoa_id: pessoaId, mes, rotulo_mes: rotuloDoMes(mes), regra: config.regra, resumos: [], itens: [], totais: { previsto: 0, liberado: 0, fechado: 0, pago: 0 } };
  if (config.regra !== 'FUNCOES') return vazio;
  const cadastro = await lerCadastro(exec, tenantId);
  const minhas = cadastro.pessoas.filter(p => p.pessoa_id === pessoaId).map(p => p.id);
  if (!minhas.length) return vazio;
  const c = await calcularNoBanco(exec, tenantId, hoje, { so_participantes: minhas });
  const doMes = c.itens.filter(i => i.mes === mes);
  const chaves = doMes.map(i => i.chave);
  const [{ rows: lanc }, { rows: pagos }] = await Promise.all([
    exec.query(`SELECT chave, fechado_centavos FROM comissao_lancamentos WHERE tenant_id = $1 AND chave = ANY($2::text[])`, [tenantId, chaves]),
    exec.query(`SELECT chave, SUM(pago_centavos)::bigint AS pago FROM comissao_fechamento_itens WHERE tenant_id = $1 AND chave = ANY($2::text[]) GROUP BY chave`, [tenantId, chaves]),
  ]);
  const fechado = new Map(lanc.map(r => [txt(r.chave), n(r.fechado_centavos)]));
  const pago = new Map(pagos.map(r => [txt(r.chave), n(r.pago)]));
  const itens: ItemDoPainel[] = doMes.map(i => {
    const f = fechado.get(i.chave) ?? 0;
    const p = pago.get(i.chave) ?? 0;
    return {
      chave: i.chave, venda_id: i.venda_id, venda_numero: i.venda_numero, data_venda: i.data_venda, descricao: i.descricao, cliente_nome: i.cliente_nome,
      funcao_nome: i.funcao_nome, valor_centavos: i.valor_centavos, retido_centavos: i.retido_centavos, liberado_centavos: i.liberado_centavos,
      fechado_centavos: f, pago_centavos: p,
      situacao: situacaoDoItem({ valor_centavos: i.valor_centavos, liberado_centavos: i.liberado_centavos, fechado_centavos: f, pago_centavos: p, motivo: i.explicacao.motivo }),
      por_que: frasesDaExplicacao(i.explicacao, i.valor_centavos),
    };
  });
  const totais = itens.reduce((t, i) => ({
    previsto: t.previsto + i.valor_centavos - i.retido_centavos, liberado: t.liberado + i.liberado_centavos,
    fechado: t.fechado + i.fechado_centavos, pago: t.pago + i.pago_centavos,
  }), { previsto: 0, liberado: 0, fechado: 0, pago: 0 });
  return { ...vazio, resumos: c.resumos.filter(r => r.mes === mes), itens, totais };
}
