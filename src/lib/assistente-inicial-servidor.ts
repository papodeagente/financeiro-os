/**
 * Assistente inicial no servidor (E7, frente D, 06/11/2026). Regra pura em
 * ./assistente-inicial.ts.
 *
 * - situacaoDoAssistente: o que falta e se a agência é nova.
 * - aplicarAssistente: cria o plano padrão (só se a agência não tem plano
 *   próprio), as categorias das contas geradas e as dos encargos que faltam, e
 *   liga só o que não está escolhido. Nunca muda o que já está gravado.
 *   Rodar duas vezes (ou duas ao mesmo tempo) dá o mesmo resultado.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { getPlanoContasPadrao } from './crm-types';
import { generateId } from './utils';
import {
  CATEGORIAS_PADRAO_DOS_TITULOS, chavesSemCategoria, modoDoAssistente, planoDeLigacao, planoPadraoComIdsNovos,
  planoTemCategoriasProprias, type LinhaDoPlanoParaAssistente, type ModoDoAssistente,
} from './assistente-inicial';
import { CHAVE_DA_AGENCIA, type ChaveCategoriaDoTitulo, type CategoriasDosTitulos } from './categorias-padrao-titulos';
import { lerCategoriasDosTitulos } from './categorias-padrao-titulos-servidor';
import { categoriasDosEncargos, garantirCategoriasDeEncargos, gravarChaveDaAgencia } from './encargos-servidor';
import { CHAVES_ENCARGO, codigoLivre } from './encargos-categorias';

export interface SituacaoDoAssistente {
  modo: ModoDoAssistente;
  plano_proprio: boolean;
  tem_contas: boolean;
  faltam: ChaveCategoriaDoTitulo[];
  encargos_faltam: string[];
}

export interface ResultadoDoAssistente {
  plano_criado: boolean;
  categorias_criadas: number;
  ligadas: ChaveCategoriaDoTitulo[];
  encargos_ligados: number;
}

async function lerPlano(exec: ExecutorSQL, tenantId: string): Promise<LinhaDoPlanoParaAssistente[]> {
  const { rows } = await exec.query(
    `SELECT id, COALESCE(NULLIF(data->>'codigo', ''), codigo, '') AS codigo, COALESCE(data->>'tipo', tipo, '') AS tipo,
            COALESCE(data->>'ativo', 'true') <> 'false' AS ativo,
            COALESCE(data->>'padrao_encargo', '') AS me, COALESCE(data->>'padrao_titulo', '') AS mt
       FROM plano_contas WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.map(r => ({
    id: String(r.id), codigo: String(r.codigo), tipo: String(r.tipo).toUpperCase(), ativo: r.ativo !== false,
    ...(r.me ? { marca_encargo: String(r.me) } : {}), ...(r.mt ? { marca_titulo: String(r.mt) } : {}),
  }));
}

async function temContas(exec: ExecutorSQL, tenantId: string): Promise<boolean> {
  const { rows } = await exec.query(
    `SELECT EXISTS (SELECT 1 FROM contas_pagar WHERE tenant_id = $1) OR EXISTS (SELECT 1 FROM contas_receber WHERE tenant_id = $1) AS t`,
    [tenantId],
  );
  return rows[0]?.t === true;
}

export async function situacaoDoAssistente(exec: ExecutorSQL, tenantId: string): Promise<SituacaoDoAssistente> {
  const plano = await lerPlano(exec, tenantId);
  const escolha = await lerCategoriasDosTitulos(exec, tenantId);
  const faltam = chavesSemCategoria(escolha, plano);
  const encargos = await categoriasDosEncargos(exec, tenantId);
  const ids = new Set(plano.map(p => p.id));
  const encargosFaltam = CHAVES_ENCARGO.filter(k => !encargos[k] || !ids.has(encargos[k]!));
  const planoProprio = planoTemCategoriasProprias(plano);
  const contas = await temContas(exec, tenantId);
  return {
    modo: modoDoAssistente({ planoProprio, temContas: contas, faltam: faltam.length, encargosFaltam: encargosFaltam.length }),
    plano_proprio: planoProprio, tem_contas: contas, faltam, encargos_faltam: encargosFaltam,
  };
}

async function inserirCategoria(exec: ExecutorSQL, tenantId: string, dados: Record<string, unknown> & { id: string; codigo: string; tipo: string }): Promise<void> {
  await exec.query(
    `INSERT INTO plano_contas (id, tenant_id, codigo, descricao, tipo, data, created_at, updated_at)
     VALUES ($1, $2, $3, '', $4, $5::jsonb, NOW(), NOW())`,
    [dados.id, tenantId, dados.codigo, dados.tipo, JSON.stringify(dados)],
  );
}

/** Faz o que o assistente faz. Só cria o que falta e só liga o que está vazio. */
export async function aplicarAssistente(exec: ExecutorSQL, tenantId: string): Promise<ResultadoDoAssistente> {
  // Uma vez por agência de cada vez (duas abas, ou o cadastro e a tela juntos).
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext('assistente-inicial'), hashtext($1))`, [tenantId]);
  let plano = await lerPlano(exec, tenantId);
  let criadas = 0;
  let planoCriado = false;

  // 1) Plano padrão, só para quem ainda não tem plano próprio.
  if (!planoTemCategoriasProprias(plano)) {
    const usados = new Set(plano.map(p => p.codigo));
    for (const c of planoPadraoComIdsNovos(getPlanoContasPadrao(), generateId)) {
      if (usados.has(c.codigo)) continue;
      await inserirCategoria(exec, tenantId, { ...c, criada_pelo_assistente: true } as unknown as Record<string, unknown> & { id: string; codigo: string; tipo: string });
      criadas++;
    }
    planoCriado = true;
    plano = await lerPlano(exec, tenantId);
  }

  // 2) As categorias das contas geradas que faltam (reaproveita a marcada).
  const escolha = await lerCategoriasDosTitulos(exec, tenantId);
  const faltam = chavesSemCategoria(escolha, plano);
  const novaEscolha: CategoriasDosTitulos = { ...escolha };
  const codigos = plano.map(p => p.codigo);
  for (const { chave, reaproveitar } of planoDeLigacao(faltam, plano)) {
    if (reaproveitar) { novaEscolha[chave] = reaproveitar; continue; }
    const pad = CATEGORIAS_PADRAO_DOS_TITULOS[chave];
    const pai = plano.find(p => p.codigo === pad.pai) ?? null;
    const codigo = codigoLivre(pad.codigo, codigos);
    codigos.push(codigo);
    const id = generateId();
    await inserirCategoria(exec, tenantId, {
      id, codigo, nome: pad.nome, tipo: pad.tipo, categoria_pai_id: pai?.id ?? null,
      natureza_custo: pad.tipo === 'DESPESA' ? 'VARIAVEL' : null, is_custo_comercial: false, ativo: true,
      padrao_titulo: chave,
    });
    criadas++;
    novaEscolha[chave] = id;
  }
  if (faltam.length) await gravarChaveDaAgencia(exec, tenantId, CHAVE_DA_AGENCIA, novaEscolha);

  // 3) Os encargos da liquidação (a rotina de sempre: cria o que falta).
  const antes = await categoriasDosEncargos(exec, tenantId);
  const depois = await garantirCategoriasDeEncargos(exec, tenantId);
  const encargosLigados = CHAVES_ENCARGO.filter(k => depois[k] && depois[k] !== antes[k]).length;

  return { plano_criado: planoCriado, categorias_criadas: criadas, ligadas: faltam, encargos_ligados: encargosLigados };
}

/**
 * Para a agência que acabou de nascer (cadastro) ou que abre o Financeiro
 * pela primeira vez sem nada: roda sozinho. Agência com dados: não faz nada
 * (a tela oferece). Devolve o resultado quando rodou.
 */
export async function prepararAgenciaNova(exec: ExecutorSQL, tenantId: string): Promise<ResultadoDoAssistente | null> {
  const s = await situacaoDoAssistente(exec, tenantId);
  if (s.modo !== 'automatico') return null;
  return aplicarAssistente(exec, tenantId);
}
