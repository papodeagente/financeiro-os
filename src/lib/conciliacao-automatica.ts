/**
 * CONCILIAÇÃO AUTOMÁTICA (E6, 05/11/2026): ler, gravar e desfazer. A regra
 * está em conciliacao-regras.ts; aqui é o banco.
 *
 *  - APRENDER: depois de cada conciliação feita por uma pessoa com UMA conta,
 *    a regra daquela descrição (ou CNPJ) ganha uma confirmação. Conciliação
 *    1-para-N não ensina nada: não dá para saber qual conta a descrição diz.
 *  - SUGERIR: cada linha a conciliar ganha a decisão da regra (sugerir ou
 *    conciliar sozinha), com o motivo quando não pode ir sozinha.
 *  - CONCILIAR SOZINHA: só a linha cuja decisão é 'sozinha' (regra ligada pela
 *    agência, certeza alta, mesma pessoa, mesmo valor em centavos). A baixa
 *    passa SEMPRE pelo caminho da liquidação no servidor (registrarBaixas), e
 *    antes dela pelo porteiro (direito, conta liberada, alçada, limites): o
 *    que o porteiro recusa continua como sugestão. Cada linha é uma
 *    transação: uma recusa não desfaz as outras.
 *  - DESFAZER: a baixa é estornada pelo estorno da liquidação, a conta criada
 *    pela regra é apagada, a linha volta à fila e a regra para de conciliar
 *    sozinha até a agência ligar de novo.
 *
 * Toda conciliação automática fica em `conciliacoes_automaticas`: é a lista
 * "Conciliado sozinho" da tela, com o desfazer.
 *
 * Não importa nada do Next: os testes rodam contra um Postgres real.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { num, paraCentavos, round2 } from './money';
import { createContaPagar, createContaReceber } from './crm-types';
import { formaDaDescricao } from './conciliacao-plano';
import { contasJaUsadas, desfazerConciliacao, ErroConciliacao, type Vinculo } from './conciliacao-servidor';
import { registrarBaixas, tituloParaBaixa, type ItemBaixa, type ResultadoItem } from './baixas-servidor';
import { saldoDoTitulo, type TituloTabela } from './baixa-calculo';
import {
  aprender, chaveDaRegra, decidir, podeLigar, regraDaLinha, registrarDesfeita, tarifasRecorrentes,
  type Decisao, type DestinoDaRegra, type LinhaParaRegra, type RegraDeConciliacao, type TabelaDoTitulo,
  type TarifaRecorrente, type TituloCandidato,
} from './conciliacao-regras';

export { CONCILIACAO_REGRAS_SCHEMA_SQL } from './conciliacao-regras-schema';

type Dados = Record<string, unknown>;

const TIPO_DA_TABELA: Record<TabelaDoTitulo, 'CONTA_RECEBER' | 'CONTA_PAGAR'> = {
  contas_receber: 'CONTA_RECEBER',
  contas_pagar: 'CONTA_PAGAR',
};
const TABELA_DO_TIPO: Record<string, TabelaDoTitulo> = {
  CONTA_RECEBER: 'contas_receber',
  CONTA_PAGAR: 'contas_pagar',
};
const ABERTAS = ['PENDENTE', 'ATRASADO', 'VENCIDO', 'PARCIAL'];

function pessoaDoTitulo(tabela: TabelaDoTitulo, d: Dados): { id: string; nome: string } {
  return tabela === 'contas_receber'
    ? { id: String(d.cliente_id ?? ''), nome: String(d.cliente_nome ?? '') }
    : { id: String(d.fornecedor_id ?? ''), nome: String(d.fornecedor_nome ?? '') };
}

function deLinhaDoBanco(r: Record<string, unknown>): RegraDeConciliacao {
  return {
    id: String(r.id),
    conta_bancaria_id: String(r.conta_bancaria_id ?? ''),
    sentido: r.sentido === 'SAIDA' ? 'SAIDA' : 'ENTRADA',
    padrao: String(r.padrao ?? ''),
    documento: String(r.documento ?? ''),
    destino: (r.destino === 'CRIAR' ? 'CRIAR' : 'TITULO') as DestinoDaRegra,
    titulo_tabela: r.titulo_tabela === 'contas_pagar' ? 'contas_pagar' : 'contas_receber',
    pessoa_id: String(r.pessoa_id ?? ''),
    pessoa_nome: String(r.pessoa_nome ?? ''),
    categoria_id: String(r.categoria_id ?? ''),
    valores_centavos: (Array.isArray(r.valores_centavos) ? r.valores_centavos : []).map(v => Number(v)),
    confirmacoes: Number(r.confirmacoes ?? 0),
    desfeitas: Number(r.desfeitas ?? 0),
    auto_ligada: r.auto_ligada === true,
    auto_suspensa_motivo: String(r.auto_suspensa_motivo ?? ''),
  };
}

export interface RegraNaTela extends RegraDeConciliacao {
  exemplo: string;
  ultima_em: string | null;
  auto_ligada_por: string | null;
}

export async function listarRegras(exec: ExecutorSQL, tenantId: string): Promise<RegraNaTela[]> {
  const { rows } = await exec.query(
    `SELECT *, ultima_em::text AS ultima_txt FROM conciliacao_regras WHERE tenant_id = $1
      ORDER BY auto_ligada DESC, confirmacoes DESC, ultima_em DESC NULLS LAST, id`,
    [tenantId],
  );
  return rows.map(r => ({
    ...deLinhaDoBanco(r),
    exemplo: String(r.exemplo ?? ''),
    ultima_em: (r.ultima_txt as string | null) ?? null,
    auto_ligada_por: (r.auto_ligada_por as string | null) ?? null,
  }));
}

async function gravarRegra(exec: ExecutorSQL, tenantId: string, r: RegraDeConciliacao, exemplo: string, nova: boolean): Promise<void> {
  const chave = chaveDaRegra(r);
  if (nova) {
    await exec.query(
      `INSERT INTO conciliacao_regras (id, tenant_id, chave, conta_bancaria_id, sentido, padrao, documento, destino, titulo_tabela,
                                       pessoa_id, pessoa_nome, categoria_id, valores_centavos, confirmacoes, desfeitas, auto_ligada,
                                       auto_suspensa_motivo, exemplo, ultima_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::bigint[],$14,$15,$16,$17,$18, NOW())`,
      [r.id, tenantId, chave, r.conta_bancaria_id, r.sentido, r.padrao, r.documento, r.destino, r.titulo_tabela,
        r.pessoa_id, r.pessoa_nome.slice(0, 160), r.categoria_id, r.valores_centavos, r.confirmacoes, r.desfeitas, r.auto_ligada,
        r.auto_suspensa_motivo, exemplo.slice(0, 200)],
    );
    return;
  }
  await exec.query(
    `UPDATE conciliacao_regras
        SET destino = $3, titulo_tabela = $4, pessoa_id = $5, pessoa_nome = $6, categoria_id = $7, valores_centavos = $8::bigint[],
            confirmacoes = $9, desfeitas = $10, auto_ligada = $11, auto_suspensa_motivo = $12,
            auto_ligada_por = CASE WHEN $11 THEN auto_ligada_por ELSE NULL END,
            auto_ligada_em = CASE WHEN $11 THEN auto_ligada_em ELSE NULL END,
            exemplo = CASE WHEN $13 = '' THEN exemplo ELSE $13 END, ultima_em = NOW(), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [r.id, tenantId, r.destino, r.titulo_tabela, r.pessoa_id, r.pessoa_nome.slice(0, 160), r.categoria_id, r.valores_centavos,
      r.confirmacoes, r.desfeitas, r.auto_ligada, r.auto_suspensa_motivo, exemplo.slice(0, 200)],
  );
}

function linhaParaRegra(id: string, d: Dados): LinhaParaRegra {
  return {
    id,
    conta_bancaria_id: String(d.conta_bancaria_id ?? ''),
    data: String(d.data ?? '').slice(0, 10),
    valor: round2(num(d.valor)),
    descricao: String(d.descricao ?? ''),
  };
}

/**
 * Aprende com a conciliação que uma PESSOA acabou de fazer na linha. Chame
 * depois da conciliação gravada, na mesma transação ou noutra. Devolve a
 * regra (ou null quando a conciliação não ensina nada).
 */
export async function aprenderComConciliacao(exec: ExecutorSQL, tenantId: string, extratoId: string): Promise<RegraDeConciliacao | null> {
  const { rows } = await exec.query(
    `SELECT data FROM extrato_bancario WHERE id = $1 AND tenant_id = $2 AND status_conciliacao = 'CONCILIADO'`,
    [extratoId, tenantId],
  );
  if (rows.length === 0) return null;
  const d = rows[0].data as Dados;
  const vinculos = Array.isArray(d.vinculos) ? (d.vinculos as Vinculo[]) : [];
  if (vinculos.length !== 1 || d.conciliado_por === 'regra') return null;
  const v = vinculos[0];
  const tabela = TABELA_DO_TIPO[v.tipo];
  if (!tabela) return null;
  const { rows: t } = await exec.query(`SELECT data FROM ${tabela} WHERE id = $1 AND tenant_id = $2`, [v.id, tenantId]);
  if (t.length === 0) return null;
  const titulo = t[0].data as Dados;
  const pessoa = pessoaDoTitulo(tabela, titulo);
  if (!pessoa.id && !pessoa.nome.trim()) return null;

  const linha = linhaParaRegra(extratoId, d);
  const fato = {
    linha,
    destino: (v.acao === 'CRIADA' ? 'CRIAR' : 'TITULO') as DestinoDaRegra,
    titulo_tabela: tabela,
    pessoa_id: pessoa.id,
    pessoa_nome: pessoa.nome,
    categoria_id: String(titulo.categoria_id ?? ''),
  };
  const provisoria = aprender(null, fato, generateId());
  const chave = chaveDaRegra(provisoria);
  const { rows: existentes } = await exec.query(
    `SELECT * FROM conciliacao_regras WHERE tenant_id = $1 AND chave = $2 FOR UPDATE`,
    [tenantId, chave],
  );
  const existente = existentes[0] ? deLinhaDoBanco(existentes[0]) : null;
  const regra = aprender(existente, fato, provisoria.id);
  await gravarRegra(exec, tenantId, regra, linha.descricao, !existente);
  await exec.query(
    `UPDATE extrato_bancario SET data = data || jsonb_build_object('regra_id', $3::text) WHERE id = $1 AND tenant_id = $2`,
    [extratoId, tenantId, regra.id],
  );
  return regra;
}

/** Liga ou desliga a regra para conciliar sozinha. Só liga com certeza alta. */
export async function ligarRegra(
  exec: ExecutorSQL, tenantId: string, regraId: string, ligar: boolean, quem: { usuarioId?: string; usuarioNome?: string },
): Promise<RegraDeConciliacao> {
  const { rows } = await exec.query(`SELECT * FROM conciliacao_regras WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [regraId, tenantId]);
  if (rows.length === 0) throw new ErroConciliacao('Regra não encontrada.', 404);
  const r = deLinhaDoBanco(rows[0]);
  if (ligar) {
    const pode = podeLigar(r);
    if (!pode.ok) throw new ErroConciliacao(pode.motivo, 409);
  }
  await exec.query(
    `UPDATE conciliacao_regras
        SET auto_ligada = $3, auto_ligada_por = $4, auto_ligada_em = CASE WHEN $3 THEN NOW() ELSE NULL END,
            auto_suspensa_motivo = '', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [regraId, tenantId, ligar, ligar ? (quem.usuarioNome || quem.usuarioId || '') : null],
  );
  return { ...r, auto_ligada: ligar, auto_suspensa_motivo: '' };
}

export async function excluirRegra(exec: ExecutorSQL, tenantId: string, regraId: string): Promise<boolean> {
  const r = await exec.query(`DELETE FROM conciliacao_regras WHERE id = $1 AND tenant_id = $2`, [regraId, tenantId]);
  return (r.rowCount ?? 0) > 0;
}

// ── Sugestões ─────────────────────────────────────────────────────────────

async function titulosEmAberto(exec: ExecutorSQL, tenantId: string): Promise<TituloCandidato[]> {
  const saida: TituloCandidato[] = [];
  for (const tabela of ['contas_receber', 'contas_pagar'] as const) {
    const { rows } = await exec.query(
      `SELECT id, data FROM ${tabela}
        WHERE tenant_id = $1 AND COALESCE(NULLIF(data->>'status', ''), status) = ANY($2::text[])
        ORDER BY data->>'data_vencimento' NULLS LAST LIMIT 5000`,
      [tenantId, ABERTAS],
    );
    for (const r of rows) {
      const d = r.data as Dados;
      const pessoa = pessoaDoTitulo(tabela, d);
      const aberto = saldoDoTitulo(tituloParaBaixa(tabela, d));
      saida.push({
        id: String(r.id), tabela, pessoa_id: pessoa.id, pessoa_nome: pessoa.nome,
        aberto_centavos: paraCentavos(aberto), data_vencimento: String(d.data_vencimento ?? '').slice(0, 10),
        descricao: String(d.descricao ?? ''),
      });
    }
  }
  return saida;
}

export interface SugestaoDaLinha {
  extrato_id: string;
  conta_bancaria_id: string;
  data: string;
  valor: number;
  descricao: string;
  decisao: Decisao;
}

/**
 * A decisão de cada linha a conciliar que tem regra. `contas` restringe às
 * contas bancárias liberadas para a pessoa (null = todas).
 */
export async function sugestoesDasRegras(
  exec: ExecutorSQL, tenantId: string, opcoes: { contas: string[] | null; contaBancariaId?: string | null; limite?: number },
): Promise<SugestaoDaLinha[]> {
  const regras = (await listarRegras(exec, tenantId));
  if (regras.length === 0) return [];
  const { rows } = await exec.query(
    `SELECT id, data FROM extrato_bancario
      WHERE tenant_id = $1 AND status_conciliacao = 'PENDENTE'
        AND ($2::text IS NULL OR conta_bancaria_id = $2 OR data->>'conta_bancaria_id' = $2)
      ORDER BY data->>'data' DESC, id LIMIT $3`,
    [tenantId, opcoes.contaBancariaId || null, opcoes.limite ?? 1000],
  );
  const titulos = await titulosEmAberto(exec, tenantId);
  const saida: SugestaoDaLinha[] = [];
  for (const r of rows) {
    const linha = linhaParaRegra(String(r.id), r.data as Dados);
    if (opcoes.contas && !opcoes.contas.includes(linha.conta_bancaria_id)) continue;
    const regra = regraDaLinha(linha, regras);
    if (!regra) continue;
    saida.push({ extrato_id: linha.id, conta_bancaria_id: linha.conta_bancaria_id, data: linha.data, valor: linha.valor, descricao: linha.descricao, decisao: decidir(linha, regra, titulos) });
  }
  return saida;
}

// ── Conciliar sozinha ─────────────────────────────────────────────────────

export interface QuemConcilia {
  tenantId: string;
  usuarioId?: string;
  usuarioNome?: string;
  /** Contas bancárias liberadas para a pessoa (null = todas). */
  contas: string[] | null;
  /**
   * O porteiro da liquidação (direito, conta, alçada, limites). Lança para
   * recusar. A rota passa conferirBaixa com a sessão.
   */
  conferir: (exec: ExecutorSQL, itens: ItemBaixa[], previa: ResultadoItem[]) => Promise<void>;
}

export interface ResultadoDaAutomatica {
  conciliadas: { extrato_id: string; automatica_id: string; pessoa: string; valor: number }[];
  puladas: { extrato_id: string; motivo: string }[];
}

type Transacao = <T>(fn: (exec: ExecutorSQL) => Promise<T>) => Promise<T>;

async function conciliarUmaSozinha(exec: ExecutorSQL, quem: QuemConcilia, extratoId: string): Promise<{ automatica_id: string; pessoa: string; valor: number }> {
  const tenantId = quem.tenantId;
  const { rows } = await exec.query(
    `SELECT data FROM extrato_bancario WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [extratoId, tenantId],
  );
  if (rows.length === 0) throw new ErroConciliacao('Linha do extrato não encontrada.', 404);
  const dados: Dados = { ...(rows[0].data as Dados), id: extratoId };
  if (String(dados.status_conciliacao ?? 'PENDENTE') !== 'PENDENTE') throw new ErroConciliacao('A linha já não está na fila.', 409);
  const linha = linhaParaRegra(extratoId, dados);
  if (quem.contas && !quem.contas.includes(linha.conta_bancaria_id)) throw new ErroConciliacao('Esta conta bancária não está liberada para você.', 403);

  // A decisão é refeita aqui, com as contas travadas: a tela pode estar velha.
  const regras = await listarRegras(exec, tenantId);
  const regra = regraDaLinha(linha, regras);
  const titulos = await titulosEmAberto(exec, tenantId);
  const decisao = decidir(linha, regra, titulos);
  if (decisao.tipo !== 'sozinha') {
    throw new ErroConciliacao(decisao.tipo === 'sugerir' ? decisao.por_que_nao_sozinha : decisao.motivo, 409);
  }
  const r = decisao.regra;
  const valor = round2(Math.abs(linha.valor));
  let tituloId: string;
  let criada = false;

  if (decisao.titulo) {
    tituloId = decisao.titulo.id;
    const usados = await contasJaUsadas(exec, tenantId, [tituloId], extratoId);
    if (usados.size > 0) throw new ErroConciliacao('A conta já está ligada a outra linha do extrato.', 409);
  } else {
    // Regra que lança a conta que faltava: nasce em aberto e é liquidada
    // pelo caminho de sempre, logo abaixo.
    criada = true;
    tituloId = generateId();
    const observacoes = `Lançada pela conciliação automática (regra aprendida): ${linha.descricao}`;
    if (r.titulo_tabela === 'contas_pagar') {
      const conta = {
        ...createContaPagar(), id: tituloId, origem: 'OUTROS', fornecedor_id: r.pessoa_id, fornecedor_nome: r.pessoa_nome,
        descricao: linha.descricao, categoria_id: r.categoria_id, valor_original: valor, valor_final: valor, valor_brl: valor,
        data_emissao: linha.data, data_vencimento: linha.data, observacoes, conciliacao_automatica: true,
      };
      await exec.query(
        `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, 'PENDENTE', $4::jsonb, NOW(), NOW())`,
        [tituloId, tenantId, r.pessoa_id, JSON.stringify(conta)],
      );
    } else {
      const conta = {
        ...createContaReceber(), id: tituloId, origem: 'OUTROS', cliente_id: r.pessoa_id, cliente_nome: r.pessoa_nome,
        descricao: linha.descricao, categoria_id: r.categoria_id, valor_original: valor, valor_final: valor,
        data_emissao: linha.data, data_vencimento: linha.data, observacoes, conciliacao_automatica: true,
      };
      await exec.query(
        `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at)
         VALUES ($1, $2, '', $3, 'PENDENTE', $4::jsonb, NOW(), NOW())`,
        [tituloId, tenantId, r.pessoa_id, JSON.stringify(conta)],
      );
    }
  }

  const tabela = r.titulo_tabela as TituloTabela;
  const automaticaId = generateId();
  const item: ItemBaixa = {
    titulo_tabela: tabela,
    titulo_id: tituloId,
    data: linha.data,
    conta_bancaria_id: linha.conta_bancaria_id || null,
    forma: formaDaDescricao(linha.descricao),
    valor,
    observacao: 'Conciliada sozinha pela regra aprendida da conciliação bancária.',
  };
  const ctx = {
    tenantId, usuarioId: quem.usuarioId, usuarioNome: quem.usuarioNome ? `${quem.usuarioNome} (conciliação automática)` : 'Conciliação automática',
    origem: 'conciliacao' as const, idempotencia: `auto:${automaticaId}`,
  };
  const previa = await registrarBaixas(exec, ctx, [item], { gravar: false });
  const p = previa.itens[0].plano;
  const quitado = tabela === 'contas_receber' ? 'RECEBIDO' : 'PAGO';
  // Valor diferente nunca vai sozinho: nem como juros, nem como desconto.
  if (p.erros.length > 0) throw new ErroConciliacao(p.erros[0], 409);
  if (p.status_depois !== quitado || p.juros !== 0 || p.multa !== 0 || p.desconto !== 0 || Math.abs(p.diferenca) > 0.005) {
    throw new ErroConciliacao('O valor do banco não quita a conta exatamente.', 409);
  }
  await quem.conferir(exec, [item], previa.itens);
  const gravada = await registrarBaixas(exec, ctx, [item], { gravar: true });
  const baixaId = gravada.itens[0].baixa_id;
  if (!baixaId) throw new ErroConciliacao('A liquidação não foi registrada.', 409);

  await exec.query(
    `UPDATE ${tabela} SET data = data || jsonb_build_object('extrato_conciliado_id', $3::text) WHERE id = $1 AND tenant_id = $2`,
    [tituloId, tenantId, extratoId],
  );
  const vinculos = [{
    id: tituloId, tipo: TIPO_DA_TABELA[tabela], acao: 'BAIXA', aplicado: valor, baixa_id: baixaId, criada, automatica: true,
  }];
  const nova = {
    ...dados,
    status_conciliacao: 'CONCILIADO',
    lancamento_vinculado_id: tituloId,
    lancamento_vinculado_tipo: TIPO_DA_TABELA[tabela],
    vinculos,
    conciliado_em: new Date().toISOString(),
    conciliado_por: 'regra',
    regra_id: r.id,
    conciliacao_automatica_id: automaticaId,
  };
  await exec.query(
    `UPDATE extrato_bancario SET status_conciliacao = 'CONCILIADO', data = $3::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    [extratoId, tenantId, JSON.stringify(nova)],
  );
  await exec.query(
    `INSERT INTO conciliacoes_automaticas (id, tenant_id, extrato_id, regra_id, conta_bancaria_id, data_extrato, descricao, valor_centavos,
                                           pessoa_nome, vinculos, executada_por, executada_por_nome)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10::jsonb,$11,$12)`,
    [automaticaId, tenantId, extratoId, r.id, linha.conta_bancaria_id, linha.data, linha.descricao.slice(0, 200),
      paraCentavos(linha.valor), r.pessoa_nome.slice(0, 160), JSON.stringify(vinculos), quem.usuarioId ?? null, quem.usuarioNome ?? null],
  );
  return { automatica_id: automaticaId, pessoa: r.pessoa_nome, valor: linha.valor };
}

/**
 * Concilia sozinha cada linha cuja decisão é 'sozinha'. Uma transação por
 * linha (`transacao`): a recusa de uma (porteiro, período fechado, valor
 * que mudou) não desfaz as outras e vira um item de `puladas` com o motivo.
 */
export async function executarConciliacaoAutomatica(
  exec: ExecutorSQL, transacao: Transacao, quem: QuemConcilia, opcoes: { contaBancariaId?: string | null } = {},
): Promise<ResultadoDaAutomatica> {
  const sugestoes = await sugestoesDasRegras(exec, quem.tenantId, { contas: quem.contas, contaBancariaId: opcoes.contaBancariaId });
  const resultado: ResultadoDaAutomatica = { conciliadas: [], puladas: [] };
  for (const s of sugestoes) {
    if (s.decisao.tipo !== 'sozinha') continue;
    try {
      const r = await transacao(x => conciliarUmaSozinha(x, quem, s.extrato_id));
      resultado.conciliadas.push({ extrato_id: s.extrato_id, ...r });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : 'Não foi possível conciliar.';
      resultado.puladas.push({ extrato_id: s.extrato_id, motivo });
    }
  }
  return resultado;
}

// ── Desfazer ──────────────────────────────────────────────────────────────

/**
 * Desfaz a conciliação da linha (manual ou automática) e avisa a regra. É o
 * caminho da rota de conciliação para "desfazer": a conciliação feita pela
 * regra também desfaz por aqui.
 */
export async function desfazerComRegras(
  exec: ExecutorSQL, tenantId: string, extratoId: string, quem: { usuarioId?: string; usuarioNome?: string }, motivo = '',
): Promise<{ linha: Dados; restauradas: number }> {
  const { rows } = await exec.query(`SELECT data FROM extrato_bancario WHERE id = $1 AND tenant_id = $2`, [extratoId, tenantId]);
  const antes = (rows[0]?.data ?? {}) as Dados;
  const r = await desfazerConciliacao(exec, tenantId, extratoId, {
    usuarioId: quem.usuarioId, usuarioNome: quem.usuarioNome,
    motivo: motivo.trim() || (antes.conciliado_por === 'regra' ? 'Conciliação automática desfeita' : 'Conciliação desfeita'),
  });
  const automatica = antes.conciliado_por === 'regra';
  if (automatica && antes.conciliacao_automatica_id) {
    await exec.query(
      `UPDATE conciliacoes_automaticas SET desfeita_em = clock_timestamp(), desfeita_por = $3, desfeita_motivo = $4
        WHERE id = $1 AND tenant_id = $2 AND desfeita_em IS NULL`,
      [String(antes.conciliacao_automatica_id), tenantId, quem.usuarioNome || quem.usuarioId || null, motivo.trim() || null],
    );
  }
  const regraId = String(antes.regra_id ?? '');
  if (regraId) {
    const { rows: rr } = await exec.query(`SELECT * FROM conciliacao_regras WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [regraId, tenantId]);
    if (rr[0]) {
      const regra = registrarDesfeita(deLinhaDoBanco(rr[0]), automatica);
      await gravarRegra(exec, tenantId, regra, '', false);
    }
  }
  return r;
}

export interface ConciliacaoAutomaticaNaTela {
  id: string;
  extrato_id: string;
  regra_id: string;
  conta_bancaria_id: string;
  data_extrato: string;
  descricao: string;
  valor: number;
  pessoa_nome: string;
  executada_em: string;
  executada_por_nome: string | null;
  desfeita_em: string | null;
  desfeita_por: string | null;
  criou_conta: boolean;
}

export async function listarAutomaticas(
  exec: ExecutorSQL, tenantId: string, opcoes: { contas: string[] | null; limite?: number },
): Promise<ConciliacaoAutomaticaNaTela[]> {
  const { rows } = await exec.query(
    `SELECT id, extrato_id, regra_id, conta_bancaria_id, data_extrato::text AS data_txt, descricao, valor_centavos, pessoa_nome,
            executada_em::text AS executada_txt, executada_por_nome, desfeita_em::text AS desfeita_txt, desfeita_por, vinculos
       FROM conciliacoes_automaticas WHERE tenant_id = $1
      ORDER BY executada_em DESC, id LIMIT $2`,
    [tenantId, opcoes.limite ?? 300],
  );
  return rows
    .filter(r => !opcoes.contas || opcoes.contas.includes(String(r.conta_bancaria_id ?? '')))
    .map(r => ({
      id: String(r.id), extrato_id: String(r.extrato_id), regra_id: String(r.regra_id),
      conta_bancaria_id: String(r.conta_bancaria_id ?? ''), data_extrato: String(r.data_txt ?? ''),
      descricao: String(r.descricao ?? ''), valor: Number(r.valor_centavos) / 100, pessoa_nome: String(r.pessoa_nome ?? ''),
      executada_em: String(r.executada_txt ?? ''), executada_por_nome: (r.executada_por_nome as string | null) ?? null,
      desfeita_em: (r.desfeita_txt as string | null) ?? null, desfeita_por: (r.desfeita_por as string | null) ?? null,
      criou_conta: Array.isArray(r.vinculos) && (r.vinculos as { criada?: boolean }[]).some(v => v.criada === true),
    }));
}

// ── Tarifas recorrentes ───────────────────────────────────────────────────

export interface TarifaNaTela extends TarifaRecorrente {
  /** Já existe conta a pagar sugerida e aceita para esta tarifa no próximo mês. */
  conta_criada_id: string | null;
}

export async function tarifasSugeridas(exec: ExecutorSQL, tenantId: string, contas: string[] | null): Promise<TarifaNaTela[]> {
  const { rows } = await exec.query(
    `SELECT id, data FROM extrato_bancario
      WHERE tenant_id = $1 AND (data->>'valor')::numeric < 0 AND data->>'data' >= to_char(NOW() - INTERVAL '400 days', 'YYYY-MM-DD')
      ORDER BY data->>'data' DESC LIMIT 5000`,
    [tenantId],
  );
  const linhas = rows
    .map(r => linhaParaRegra(String(r.id), r.data as Dados))
    .filter(l => !contas || contas.includes(l.conta_bancaria_id));
  const tarifas = tarifasRecorrentes(linhas);
  if (tarifas.length === 0) return [];
  const { rows: criadas } = await exec.query(
    `SELECT id, data->>'tarifa_chave' AS chave, data->>'data_vencimento' AS venc FROM contas_pagar
      WHERE tenant_id = $1 AND data->>'tarifa_chave' = ANY($2::text[]) AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
    [tenantId, tarifas.map(t => t.chave)],
  );
  return tarifas.map(t => {
    const achada = criadas.find(c => c.chave === t.chave && String(c.venc ?? '') === t.proximo_vencimento);
    return { ...t, conta_criada_id: achada ? String(achada.id) : null };
  });
}

/**
 * Aceita a sugestão: lança a conta a pagar da tarifa no próximo vencimento,
 * em aberto (quando o banco debitar, a linha concilia com ela). Repetir não
 * cria duas.
 */
export async function criarContaDaTarifa(
  exec: ExecutorSQL, tenantId: string, chave: string, dados: { fornecedor_nome: string; categoria_id?: string; contas: string[] | null },
): Promise<{ id: string; ja_existia: boolean }> {
  const tarifa = (await tarifasSugeridas(exec, tenantId, dados.contas)).find(t => t.chave === chave);
  if (!tarifa) throw new ErroConciliacao('Esta tarifa não aparece mais como recorrente.', 404);
  if (tarifa.conta_criada_id) return { id: tarifa.conta_criada_id, ja_existia: true };
  const nome = dados.fornecedor_nome.trim();
  if (!nome) throw new ErroConciliacao('Informe o banco que cobra a tarifa.');
  const valor = tarifa.valor_tipico_centavos / 100;
  const id = generateId();
  const conta = {
    ...createContaPagar(), id, origem: 'DESPESA_FIXA', fornecedor_nome: nome.slice(0, 160), descricao: tarifa.descricao,
    categoria_id: dados.categoria_id ?? '', valor_original: valor, valor_final: valor, valor_brl: valor,
    data_vencimento: tarifa.proximo_vencimento, conta_bancaria_id: tarifa.conta_bancaria_id || null,
    natureza_custo: 'FIXO', tarifa_chave: tarifa.chave,
    observacoes: `Tarifa que o banco cobra todo mês (${tarifa.meses.length} meses no extrato). Sugerida pela conciliação.`,
  };
  await exec.query(
    `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at)
     VALUES ($1, $2, '', 'PENDENTE', $3::jsonb, NOW(), NOW())`,
    [id, tenantId, JSON.stringify(conta)],
  );
  return { id, ja_existia: false };
}

