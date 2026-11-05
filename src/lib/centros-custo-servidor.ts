/**
 * Centros de custo em árvore, regras de rateio salvas e junção de
 * categorias, no servidor (05/11/2026). Tudo recebe o executor (pool ou
 * transação) e a agência: nada lê nem grava fora do tenant_id.
 */
import type { ExecutorSQL } from './caixa-atomico';
import type { CentroCusto, RegraRateio } from './crm-types';
import {
  criaCiclo,
  recusaDaJuncao,
  trocarCategoriaNaConta,
  trocarCategoriaNaRegra,
  validarRateio,
  type CategoriaParaJuntar,
} from './dimensoes';
import { num, round2 } from './money';

/**
 * Esquema: a tabela das regras de rateio e a migração única que cria os
 * centros a partir dos textos livres já usados em contas e vendas. O texto
 * antigo fica onde está; a conta só ganha o `centro_custo_id`. Idempotente:
 * o id do centro criado é derivado da agência e do nome, e o marco impede
 * rodar de novo. Roda no initDB antes do razão.
 */
export const CENTROS_CUSTO_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS regras_rateio (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  nome TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regras_rateio_tenant ON regras_rateio (tenant_id);
CREATE INDEX IF NOT EXISTS idx_centros_custo_tenant ON centros_custo (tenant_id);
CREATE TABLE IF NOT EXISTS marcos_de_migracao (
  chave TEXT PRIMARY KEY,
  em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $centros_dos_textos$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM marcos_de_migracao WHERE chave = 'centros_custo_dos_textos') THEN
    WITH textos AS (
      SELECT tenant_id, btrim(data->>'centro_custo') AS nome FROM contas_pagar
       WHERE COALESCE(btrim(data->>'centro_custo'), '') <> ''
      UNION ALL
      SELECT tenant_id, btrim(data->>'centro_custo') FROM contas_receber
       WHERE COALESCE(btrim(data->>'centro_custo'), '') <> ''
      UNION ALL
      SELECT tenant_id, btrim(data->>'centro_custo') FROM vendas_crm
       WHERE COALESCE(btrim(data->>'centro_custo'), '') <> ''
      UNION ALL
      SELECT v.tenant_id, btrim(p->>'centro_custo') FROM vendas_crm v
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(v.data->'produtos') = 'array' THEN v.data->'produtos' ELSE '[]'::jsonb END) p
       WHERE COALESCE(btrim(p->>'centro_custo'), '') <> ''
    ), unicos AS (
      -- Uma grafia por nome: a mais usada; no empate, a que não é toda maiúscula.
      SELECT DISTINCT ON (tenant_id, lower(nome)) tenant_id, lower(nome) AS chave, left(nome, 60) AS nome
        FROM (SELECT tenant_id, nome, COUNT(*) AS n FROM textos
               WHERE COALESCE(tenant_id, '') <> '' GROUP BY tenant_id, nome) g
       ORDER BY tenant_id, lower(nome), n DESC, (nome = upper(nome)), nome
    )
    INSERT INTO centros_custo (id, tenant_id, nome, data, created_at, updated_at)
    SELECT 'cc-' || md5(u.tenant_id || '|' || u.chave), u.tenant_id, u.nome,
           jsonb_build_object(
             'id', 'cc-' || md5(u.tenant_id || '|' || u.chave), 'nome', u.nome, 'tipo', '',
             'codigo', '', 'centro_pai_id', NULL, 'ativo', true, 'responsavel', '',
             'orcamento_mensal', NULL, 'origem', 'texto_livre'),
           NOW(), NOW()
      FROM unicos u
     WHERE NOT EXISTS (
       SELECT 1 FROM centros_custo c
        WHERE c.tenant_id = u.tenant_id
          AND lower(btrim(COALESCE(NULLIF(c.nome, ''), c.data->>'nome', ''))) = u.chave)
    ON CONFLICT (id) DO NOTHING;

    UPDATE contas_pagar x SET data = x.data || jsonb_build_object('centro_custo_id', c.id)
      FROM centros_custo c
     WHERE c.tenant_id = x.tenant_id
       AND COALESCE(x.data->>'centro_custo_id', '') = ''
       AND COALESCE(btrim(x.data->>'centro_custo'), '') <> ''
       AND lower(btrim(COALESCE(NULLIF(c.nome, ''), c.data->>'nome', ''))) = lower(btrim(x.data->>'centro_custo'));
    UPDATE contas_receber x SET data = x.data || jsonb_build_object('centro_custo_id', c.id)
      FROM centros_custo c
     WHERE c.tenant_id = x.tenant_id
       AND COALESCE(x.data->>'centro_custo_id', '') = ''
       AND COALESCE(btrim(x.data->>'centro_custo'), '') <> ''
       AND lower(btrim(COALESCE(NULLIF(c.nome, ''), c.data->>'nome', ''))) = lower(btrim(x.data->>'centro_custo'));
    UPDATE vendas_crm x SET data = x.data || jsonb_build_object('centro_custo_id', c.id)
      FROM centros_custo c
     WHERE c.tenant_id = x.tenant_id
       AND COALESCE(x.data->>'centro_custo_id', '') = ''
       AND COALESCE(btrim(x.data->>'centro_custo'), '') <> ''
       AND lower(btrim(COALESCE(NULLIF(c.nome, ''), c.data->>'nome', ''))) = lower(btrim(x.data->>'centro_custo'));

    INSERT INTO marcos_de_migracao (chave) VALUES ('centros_custo_dos_textos') ON CONFLICT DO NOTHING;
  END IF;
END $centros_dos_textos$;
`;

/** Erro com o status HTTP que a rota devolve. */
export class ErroCadastro extends Error {
  readonly status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.status = status;
  }
}

const str = (v: unknown) => (v == null ? '' : String(v));

function centroDaLinha(row: Record<string, unknown>): CentroCusto {
  const d = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
  const orc = d.orcamento_mensal;
  return {
    id: str(row.id),
    nome: str(row.nome) || str(d.nome),
    tipo: str(d.tipo),
    ativo: d.ativo !== false,
    codigo: str(d.codigo),
    centro_pai_id: str(d.centro_pai_id) || null,
    responsavel: str(d.responsavel),
    orcamento_mensal: orc == null || orc === '' ? null : round2(num(orc)),
  };
}

export async function listarCentros(exec: ExecutorSQL, tenantId: string): Promise<CentroCusto[]> {
  const { rows } = await exec.query(
    `SELECT id, nome, data FROM centros_custo WHERE tenant_id = $1 ORDER BY lower(nome)`,
    [tenantId],
  );
  return rows.map(centroDaLinha);
}

/**
 * Cria ou altera um centro. O nome é único na agência (sem diferenciar
 * maiúsculas), o pai precisa existir na mesma agência e não pode ficar
 * dentro do próprio centro.
 */
export async function salvarCentro(
  exec: ExecutorSQL,
  tenantId: string,
  entrada: Record<string, unknown>,
  idExistente?: string,
): Promise<CentroCusto> {
  const id = idExistente ?? str(entrada.id).trim();
  if (!id || id.length > 100) throw new ErroCadastro('Identificador do centro inválido.');
  const nome = str(entrada.nome).replace(/\s+/g, ' ').trim();
  if (!nome) throw new ErroCadastro('Informe o nome do centro de custo.');
  if (nome.length > 60) throw new ErroCadastro('O nome do centro de custo pode ter até 60 letras.');
  const codigo = str(entrada.codigo).trim().slice(0, 20);
  const responsavel = str(entrada.responsavel).trim().slice(0, 80);
  const paiId = str(entrada.centro_pai_id).trim() || null;
  const orcBruto = entrada.orcamento_mensal;
  const orcamento = orcBruto == null || orcBruto === '' ? null : round2(num(orcBruto));
  if (orcamento != null && orcamento < 0) throw new ErroCadastro('O orçamento mensal não pode ser negativo.');

  const todos = await listarCentros(exec, tenantId);
  const atual = todos.find(c => c.id === id);
  if (idExistente && !atual) throw new ErroCadastro('Centro de custo não encontrado.', 404);
  if (!idExistente) {
    // Id de outra agência ou já usado: nada é sobrescrito.
    const { rows } = await exec.query(`SELECT 1 FROM centros_custo WHERE id = $1`, [id]);
    if (rows.length > 0) throw new ErroCadastro('Esse identificador de centro já está em uso.', 409);
  }
  const chave = nome.toLocaleLowerCase('pt-BR');
  if (todos.some(c => c.id !== id && c.nome.trim().toLocaleLowerCase('pt-BR') === chave)) {
    throw new ErroCadastro('Já existe um centro de custo com esse nome.', 409);
  }
  if (paiId && !todos.some(c => c.id === paiId)) throw new ErroCadastro('O centro de cima não existe.');
  if (criaCiclo(id, paiId, todos)) throw new ErroCadastro('Um centro não pode ficar dentro dele mesmo.');

  const centro: CentroCusto = {
    id,
    nome,
    tipo: atual?.tipo ?? '',
    ativo: entrada.ativo !== false,
    codigo,
    centro_pai_id: paiId,
    responsavel,
    orcamento_mensal: orcamento,
  };
  if (idExistente) {
    await exec.query(
      `UPDATE centros_custo SET nome = $3, data = data || $4::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, nome, JSON.stringify(centro)],
    );
    // O nome antigo continua no texto das contas; o vínculo é pelo id.
  } else {
    await exec.query(
      `INSERT INTO centros_custo (id, tenant_id, nome, data, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
      [id, tenantId, nome, JSON.stringify(centro)],
    );
  }
  return centro;
}

/** Quantos lançamentos e regras usam o centro (pelo id ou pelo nome antigo). */
export async function usoDoCentro(exec: ExecutorSQL, tenantId: string, id: string, nome: string): Promise<number> {
  let total = 0;
  for (const tabela of ['contas_pagar', 'contas_receber']) {
    const { rows } = await exec.query(
      `SELECT COUNT(*)::int AS n FROM ${tabela}
        WHERE tenant_id = $1
          AND (data->>'centro_custo_id' = $2
               OR ($3 <> '' AND COALESCE(data->>'centro_custo_id', '') = '' AND lower(btrim(data->>'centro_custo')) = lower($3))
               OR (jsonb_typeof(data->'rateio') = 'array'
                   AND EXISTS (SELECT 1 FROM jsonb_array_elements(data->'rateio') l WHERE l->>'centro_custo_id' = $2)))`,
      [tenantId, id, nome.trim()],
    );
    total += Number(rows[0]?.n) || 0;
  }
  const { rows } = await exec.query(
    `SELECT COUNT(*)::int AS n FROM regras_rateio
      WHERE tenant_id = $1 AND jsonb_typeof(data->'linhas') = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(data->'linhas') l WHERE l->>'centro_custo_id' = $2)`,
    [tenantId, id],
  );
  return total + (Number(rows[0]?.n) || 0);
}

/**
 * Exclui um centro sem filhos e sem uso. Com lançamentos, a saída é
 * inativar: o histórico continua apontando para ele.
 */
export async function excluirCentro(exec: ExecutorSQL, tenantId: string, id: string): Promise<void> {
  const todos = await listarCentros(exec, tenantId);
  const centro = todos.find(c => c.id === id);
  if (!centro) throw new ErroCadastro('Centro de custo não encontrado.', 404);
  if (todos.some(c => c.centro_pai_id === id)) {
    throw new ErroCadastro('Este centro tem centros abaixo dele. Mova ou exclua os de baixo antes.', 409);
  }
  const uso = await usoDoCentro(exec, tenantId, id, centro.nome);
  if (uso > 0) {
    throw new ErroCadastro(
      `Este centro está em ${uso} ${uso === 1 ? 'lançamento ou regra' : 'lançamentos ou regras'}. Inative em vez de excluir.`,
      409,
    );
  }
  await exec.query(`DELETE FROM centros_custo WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
}

// ---------------------------------------------------------------------------
// Regras de rateio
// ---------------------------------------------------------------------------

function regraDaLinha(row: Record<string, unknown>): RegraRateio {
  const d = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
  const linhas = Array.isArray(d.linhas) ? d.linhas as Array<Record<string, unknown>> : [];
  return {
    id: str(row.id),
    nome: str(row.nome) || str(d.nome),
    linhas: linhas.map(l => ({
      centro_custo_id: str(l.centro_custo_id),
      ...(str(l.categoria_id) ? { categoria_id: str(l.categoria_id) } : {}),
      percentual: num(l.percentual),
    })),
  };
}

export async function listarRegras(exec: ExecutorSQL, tenantId: string): Promise<RegraRateio[]> {
  const { rows } = await exec.query(
    `SELECT id, nome, data FROM regras_rateio WHERE tenant_id = $1 ORDER BY lower(nome)`,
    [tenantId],
  );
  return rows.map(regraDaLinha);
}

export async function salvarRegra(
  exec: ExecutorSQL,
  tenantId: string,
  entrada: Record<string, unknown>,
  idExistente?: string,
): Promise<RegraRateio> {
  const id = idExistente ?? str(entrada.id).trim();
  if (!id || id.length > 100) throw new ErroCadastro('Identificador da regra inválido.');
  const nome = str(entrada.nome).replace(/\s+/g, ' ').trim();
  if (!nome) throw new ErroCadastro('Dê um nome para a regra, como "Aluguel".');
  if (nome.length > 80) throw new ErroCadastro('O nome da regra pode ter até 80 letras.');
  const conferido = validarRateio(100, entrada.linhas);
  if (!conferido.ok) throw new ErroCadastro(conferido.erro);
  if (conferido.linhas.length === 0) throw new ErroCadastro('A regra precisa de pelo menos uma linha.');
  const centros = new Set((await listarCentros(exec, tenantId)).map(c => c.id));
  const fora = conferido.linhas.find(l => !centros.has(l.centro_custo_id));
  if (fora) throw new ErroCadastro('Um dos centros da regra não existe nesta agência.');

  const regra: RegraRateio = {
    id,
    nome,
    linhas: conferido.linhas.map(l => ({
      centro_custo_id: l.centro_custo_id,
      ...(l.categoria_id ? { categoria_id: l.categoria_id } : {}),
      percentual: l.percentual,
    })),
  };
  if (idExistente) {
    const r = await exec.query(
      `UPDATE regras_rateio SET nome = $3, data = $4::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, nome, JSON.stringify(regra)],
    );
    if (!r.rowCount) throw new ErroCadastro('Regra não encontrada.', 404);
  } else {
    const { rows } = await exec.query(`SELECT 1 FROM regras_rateio WHERE id = $1`, [id]);
    if (rows.length > 0) throw new ErroCadastro('Esse identificador de regra já está em uso.', 409);
    await exec.query(
      `INSERT INTO regras_rateio (id, tenant_id, nome, data, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
      [id, tenantId, nome, JSON.stringify(regra)],
    );
  }
  return regra;
}

export async function excluirRegra(exec: ExecutorSQL, tenantId: string, id: string): Promise<void> {
  const r = await exec.query(`DELETE FROM regras_rateio WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!r.rowCount) throw new ErroCadastro('Regra não encontrada.', 404);
}

// ---------------------------------------------------------------------------
// Juntar categorias
// ---------------------------------------------------------------------------

/**
 * Onde uma categoria é referenciada. Tabela que não existe (recorrências
 * ainda por vir) é pulada; `rateio` diz se as linhas do rateio também
 * carregam categoria.
 */
const REFERENCIAS: ReadonlyArray<{ tabela: string; rotulo: string; rateio: boolean }> = [
  { tabela: 'contas_pagar', rotulo: 'Contas a pagar', rateio: true },
  { tabela: 'contas_receber', rotulo: 'Contas a receber', rateio: true },
  { tabela: 'vendas_crm', rotulo: 'Vendas', rateio: false },
  { tabela: 'recorrencias', rotulo: 'Recorrências', rateio: true },
];

export interface PreviaJuncao {
  origem: { id: string; codigo: string; nome: string; tipo: string };
  destino: { id: string; codigo: string; nome: string; tipo: string };
  contagens: Array<{ tabela: string; rotulo: string; registros: number }>;
  regras: number;
  total: number;
}

function categoriaDaLinha(row: Record<string, unknown>): CategoriaParaJuntar & { nome: string } {
  const d = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
  return {
    id: str(row.id),
    codigo: str(row.codigo) || str(d.codigo),
    nome: str(d.nome) || str(row.descricao),
    tipo: (str(d.tipo) || str(row.tipo)).toUpperCase(),
    categoria_pai_id: str(d.categoria_pai_id) || null,
  };
}

async function tabelaExiste(exec: ExecutorSQL, tabela: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${tabela}`]);
  return rows[0]?.ok === true;
}

function sqlDaReferencia(tabela: string, rateio: boolean): string {
  const noRateio = rateio
    ? ` OR (jsonb_typeof(data->'rateio') = 'array' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(data->'rateio') l
           WHERE l->>'categoria_id' = $2 OR ($3 <> '' AND l->>'categoria_id' = $3)))`
    : '';
  return `FROM ${tabela} WHERE tenant_id = $1
    AND (data->>'categoria_id' = $2 OR ($3 <> '' AND data->>'categoria_id' = $3)${noRateio})`;
}

async function carregarPar(exec: ExecutorSQL, tenantId: string, origemId: string, destinoId: string) {
  const { rows } = await exec.query(
    `SELECT id, codigo, descricao, tipo, data FROM plano_contas WHERE tenant_id = $1`,
    [tenantId],
  );
  const todas = rows.map(categoriaDaLinha);
  const origem = todas.find(c => c.id === origemId) ?? null;
  const destino = todas.find(c => c.id === destinoId) ?? null;
  const recusa = recusaDaJuncao(origem, destino, todas);
  if (recusa) throw new ErroCadastro(recusa, origem && destino ? 409 : 404);
  return { origem: origem!, destino: destino! };
}

/** Quantos registros mudam se `origem` for juntada em `destino`. Não grava. */
export async function previaDaJuncao(
  exec: ExecutorSQL,
  tenantId: string,
  origemId: string,
  destinoId: string,
): Promise<PreviaJuncao> {
  const { origem, destino } = await carregarPar(exec, tenantId, origemId, destinoId);
  const contagens: PreviaJuncao['contagens'] = [];
  for (const ref of REFERENCIAS) {
    if (!(await tabelaExiste(exec, ref.tabela))) continue;
    const { rows } = await exec.query(
      `SELECT COUNT(*)::int AS n ${sqlDaReferencia(ref.tabela, ref.rateio)}`,
      [tenantId, origem.id, origem.codigo ?? ''],
    );
    contagens.push({ tabela: ref.tabela, rotulo: ref.rotulo, registros: Number(rows[0]?.n) || 0 });
  }
  const regras = (await listarRegras(exec, tenantId))
    .filter(r => trocarCategoriaNaRegra(r.linhas, origem, destino.id) !== null).length;
  const resumo = (c: typeof origem) => ({ id: c.id, codigo: c.codigo ?? '', nome: c.nome, tipo: c.tipo ?? '' });
  return {
    origem: resumo(origem),
    destino: resumo(destino),
    contagens,
    regras,
    total: contagens.reduce((s, c) => s + c.registros, 0) + regras,
  };
}

export interface AutorDaJuncao { userId: string; nome: string; perfil: string }

/**
 * Move tudo de `origem` para `destino` e exclui `origem`, numa transação
 * que o chamador abre. Grava um evento de auditoria com o que mudou (além
 * do que o gatilho da auditoria já registra linha a linha).
 */
export async function juntarCategorias(
  exec: ExecutorSQL,
  tenantId: string,
  origemId: string,
  destinoId: string,
  autor: AutorDaJuncao,
): Promise<PreviaJuncao> {
  const previa = await previaDaJuncao(exec, tenantId, origemId, destinoId);
  const origem = { id: previa.origem.id, codigo: previa.origem.codigo };

  for (const ref of REFERENCIAS) {
    if (!previa.contagens.some(c => c.tabela === ref.tabela && c.registros > 0)) continue;
    const { rows } = await exec.query(
      `SELECT id, data ${sqlDaReferencia(ref.tabela, ref.rateio)} FOR UPDATE`,
      [tenantId, origem.id, origem.codigo],
    );
    for (const row of rows) {
      const nova = trocarCategoriaNaConta(row.data as Record<string, unknown>, origem, previa.destino.id);
      if (!nova) continue;
      await exec.query(
        `UPDATE ${ref.tabela} SET data = $3::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [row.id, tenantId, JSON.stringify(nova)],
      );
    }
  }
  for (const regra of await listarRegras(exec, tenantId)) {
    const linhas = trocarCategoriaNaRegra(regra.linhas, origem, previa.destino.id);
    if (!linhas) continue;
    await exec.query(
      `UPDATE regras_rateio SET data = $3::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [regra.id, tenantId, JSON.stringify({ ...regra, linhas })],
    );
  }
  await exec.query(`DELETE FROM plano_contas WHERE id = $1 AND tenant_id = $2`, [origem.id, tenantId]);

  const nomeDe = (c: PreviaJuncao['origem']) => `${c.codigo ? `${c.codigo} ` : ''}${c.nome}`.trim();
  const descricao = `Juntou a categoria "${nomeDe(previa.origem)}" em "${nomeDe(previa.destino)}": `
    + `${previa.total} ${previa.total === 1 ? 'registro movido' : 'registros movidos'}; a categoria de origem foi excluída.`;
  const alteracoes = [
    { campo: 'categoria', valor_anterior: nomeDe(previa.origem), valor_novo: nomeDe(previa.destino) },
    ...previa.contagens.map(c => ({ campo: c.rotulo, valor_anterior: '', valor_novo: String(c.registros) })),
    { campo: 'Regras de rateio', valor_anterior: '', valor_novo: String(previa.regras) },
  ];
  const id = `unif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await exec.query(
    `INSERT INTO audit_log (id, tenant_id, usuario_id, acao, modulo, entidade, entidade_id, data, created_at)
     VALUES ($1, $2, $3, 'EXCLUIR', 'Financeiro', 'plano_contas', $4,
       $5::jsonb || jsonb_build_object('timestamp', clock_timestamp()), clock_timestamp())`,
    [id, tenantId, autor.userId, origem.id, JSON.stringify({
      id, usuario_id: autor.userId, usuario_nome: autor.nome || 'Usuário', perfil: autor.perfil,
      acao: 'EXCLUIR', modulo: 'Financeiro', entidade: 'plano_contas', entidade_id: origem.id,
      entidade_nome: nomeDe(previa.origem), descricao, origem: 'USUARIO', alteracoes,
      operacao: 'JUNTAR_CATEGORIAS', destino_id: previa.destino.id,
    })],
  );
  return previa;
}
