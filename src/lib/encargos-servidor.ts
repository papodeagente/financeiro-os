/**
 * Encargos da liquidação no banco (05/11/2026). A regra mora em
 * ./encargos-categorias.ts.
 *
 * - categoriasDosEncargos(): a categoria escolhida para cada encargo
 *   (agencia.data.categorias_encargos).
 * - garantirCategoriasDeEncargos(): na primeira vez, cria as categorias
 *   padrão no plano de contas da agência. Idempotente: trava por agência,
 *   reaproveita a categoria marcada (data.padrao_encargo) e nunca duplica;
 *   nunca troca o que a agência escolheu.
 * - linhasDeEncargos(): as baixas com encargo, para o DRE.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { deCentavos } from './money';
import {
  CATEGORIAS_PADRAO_ENCARGOS, CHAVES_ENCARGO, codigoLivre,
  type CategoriasEncargos, type ChaveEncargo, type LinhaDeBaixaComEncargo,
} from './encargos-categorias';

export class ErroEncargos extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ErroEncargos';
  }
}

async function agenciaDe(exec: ExecutorSQL, tenantId: string): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const { rows } = await exec.query(
    `SELECT id, data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return rows.length ? { id: String(rows[0].id), data: (rows[0].data ?? {}) as Record<string, unknown> } : null;
}

/** Grava uma chave em agencia.data sem tocar o resto (cria a linha se faltar). */
export async function gravarChaveDaAgencia(exec: ExecutorSQL, tenantId: string, chave: string, valor: unknown): Promise<void> {
  const ag = await agenciaDe(exec, tenantId);
  if (ag) {
    await exec.query(
      `UPDATE agencia SET data = jsonb_set(COALESCE(data, '{}'::jsonb), $3::text[], $4::jsonb, true), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [ag.id, tenantId, [chave], JSON.stringify(valor)],
    );
  } else {
    await exec.query(
      `INSERT INTO agencia (id, tenant_id, data, updated_at) VALUES ($1, $2, $3::jsonb, NOW())`,
      [`agencia-${tenantId}`, tenantId, JSON.stringify({ [chave]: valor })],
    );
  }
}

function limparMapa(v: unknown): CategoriasEncargos {
  const m: CategoriasEncargos = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return m;
  for (const k of CHAVES_ENCARGO) {
    const id = (v as Record<string, unknown>)[k];
    if (typeof id === 'string' && id.trim()) m[k] = id.trim();
  }
  return m;
}

export async function categoriasDosEncargos(exec: ExecutorSQL, tenantId: string): Promise<CategoriasEncargos> {
  const ag = await agenciaDe(exec, tenantId);
  return limparMapa(ag?.data.categorias_encargos);
}

type LinhaPlano = { id: string; codigo: string; nome: string; tipo: string; marca: string };

async function planoDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<LinhaPlano[]> {
  const { rows } = await exec.query(
    `SELECT id, COALESCE(NULLIF(data->>'codigo', ''), codigo, '') AS codigo, COALESCE(data->>'nome', '') AS nome,
            COALESCE(data->>'tipo', tipo, '') AS tipo, COALESCE(data->>'padrao_encargo', '') AS marca
       FROM plano_contas WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.map(r => ({ id: String(r.id), codigo: String(r.codigo), nome: String(r.nome), tipo: String(r.tipo).toUpperCase(), marca: String(r.marca) }));
}

/**
 * Deixa cada encargo com uma categoria. O que a agência escolheu fica; o que
 * falta usa a categoria padrão já criada (marcada) ou cria agora. Rodar duas
 * vezes, ou duas ao mesmo tempo, dá o mesmo resultado.
 */
export async function garantirCategoriasDeEncargos(exec: ExecutorSQL, tenantId: string): Promise<CategoriasEncargos> {
  if (!tenantId) throw new ErroEncargos('Agência não informada.');
  // Trava desta agência até o fim da transação: duas liquidações ao mesmo
  // tempo não criam a categoria duas vezes.
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext('encargos-categorias'), hashtext($1))`, [tenantId]);
  const escolhidas = await categoriasDosEncargos(exec, tenantId);
  const plano = await planoDaAgencia(exec, tenantId);
  const existe = new Set(plano.map(p => p.id));
  const mapa: CategoriasEncargos = {};
  let mudou = false;
  const codigos = plano.map(p => p.codigo);

  for (const k of CHAVES_ENCARGO) {
    const escolhida = escolhidas[k];
    if (escolhida && existe.has(escolhida)) { mapa[k] = escolhida; continue; }
    mudou = true;
    const marcada = plano.find(p => p.marca === k);
    if (marcada) { mapa[k] = marcada.id; continue; }
    const pad = CATEGORIAS_PADRAO_ENCARGOS[k];
    const pai = plano.find(p => p.codigo === pad.pai) ?? null;
    const codigo = codigoLivre(pad.codigo, codigos);
    codigos.push(codigo);
    const id = generateId();
    const dados = {
      id, codigo, nome: pad.nome, tipo: pad.tipo, categoria_pai_id: pai?.id ?? null,
      natureza_custo: pad.tipo === 'DESPESA' ? 'VARIAVEL' : null, is_custo_comercial: false, ativo: true,
      padrao_encargo: k,
    };
    await exec.query(
      `INSERT INTO plano_contas (id, tenant_id, codigo, descricao, tipo, data, created_at, updated_at)
       VALUES ($1, $2, $3, '', $4, $5::jsonb, NOW(), NOW())`,
      [id, tenantId, codigo, pad.tipo, JSON.stringify(dados)],
    );
    mapa[k] = id;
  }
  if (mudou) await gravarChaveDaAgencia(exec, tenantId, 'categorias_encargos', mapa);
  return mapa;
}

/** Grava a escolha da tela. Cada categoria precisa ser desta agência e do tipo certo. */
export async function salvarCategoriasDosEncargos(exec: ExecutorSQL, tenantId: string, pedido: unknown): Promise<CategoriasEncargos> {
  const novo = limparMapa(pedido);
  const plano = await planoDaAgencia(exec, tenantId);
  for (const k of Object.keys(novo) as ChaveEncargo[]) {
    const p = plano.find(x => x.id === novo[k]);
    if (!p) throw new ErroEncargos('Uma das categorias escolhidas não existe no plano de contas desta agência.', 409);
    const tipo = CATEGORIAS_PADRAO_ENCARGOS[k].tipo;
    if (p.tipo && p.tipo !== tipo) {
      throw new ErroEncargos(`"${p.nome}" é uma categoria de ${p.tipo === 'RECEITA' ? 'receita' : 'despesa'}; escolha uma de ${tipo === 'RECEITA' ? 'receita' : 'despesa'}.`);
    }
  }
  const atual = await categoriasDosEncargos(exec, tenantId);
  const mapa = { ...atual, ...novo };
  await gravarChaveDaAgencia(exec, tenantId, 'categorias_encargos', mapa);
  return mapa;
}

/** As baixas com juros, multa, desconto ou taxa, com a marca de estornada. */
export async function linhasDeEncargos(exec: ExecutorSQL, tenantId: string): Promise<LinhaDeBaixaComEncargo[]> {
  try {
    const { rows } = await exec.query(
      `SELECT b.titulo_tabela, b.titulo_id, b.tipo, b.juros_centavos, b.multa_centavos, b.desconto_centavos, b.taxa_centavos,
              EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = b.tenant_id AND e.estorna_baixa_id = b.id) AS estornada
         FROM baixas b
        WHERE b.tenant_id = $1 AND b.tipo = 'baixa'
          AND (b.juros_centavos <> 0 OR b.multa_centavos <> 0 OR b.desconto_centavos <> 0 OR b.taxa_centavos <> 0)`,
      [tenantId],
    );
    return rows.map(r => ({
      titulo_tabela: String(r.titulo_tabela), titulo_id: String(r.titulo_id), tipo: String(r.tipo), estornada: Boolean(r.estornada),
      juros: deCentavos(r.juros_centavos as string), multa: deCentavos(r.multa_centavos as string),
      desconto: deCentavos(r.desconto_centavos as string), taxa: deCentavos(r.taxa_centavos as string),
    }));
  } catch {
    // Sem a tabela de baixas ainda: nenhum encargo, o DRE de antes.
    return [];
  }
}
