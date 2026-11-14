/**
 * Várias empresas dentro da agência: o lado do servidor (06/11/2026, E7 G2).
 *
 * - cadastro (`listarEmpresas`, `salvarEmpresa`), com a principal criada
 *   sozinha a partir dos dados da agência;
 * - o ESCOPO de quem pede (`escopoDaSessao`): empresas ativas, as liberadas
 *   pelo perfil de acesso e o que a pessoa marcou no seletor. Com uma empresa
 *   só, `visiveis = null` e nenhuma lista muda (uma consulta, barata);
 * - configurações por empresa (`lerChavesDaEmpresa`, `gravarChaveDaEmpresa`,
 *   `copiarConfiguracao`): a principal continua lendo e gravando onde sempre
 *   (agencia.data e config_fiscal); as outras guardam só o que mudaram e, no
 *   resto, seguem a principal.
 */
import pool from './db';
import { generateId } from './utils';
import {
  EMPRESA_PRINCIPAL_ID, configParaCopiar, empresasDoRegistro, escopoVisivel, normalizarEmpresa, ordenarEmpresas,
  type Empresa, type EmpresasVisiveis, type SecaoPorEmpresa,
} from './empresas';
import { empresasPermitidas, tenantDaSessao, type SessaoPermissoes } from './permissoes-servidor';
import { listaDeTextos } from './acoes-financeiras';
import {
  CHAVES_DA_SECAO, ErroEmpresa, empresaComConfigPropria, gravarChaveDaEmpresa, lerChavesDaEmpresa,
} from './empresas-config';

// As leituras e gravações de configuração por empresa moram em
// ./empresas-config (sem permissões nem pool), para a baixa, a cobrança, a
// venda e as notas usarem sem arrastar o resto. Reexportadas aqui.
export {
  CHAVES_DA_SECAO, ErroEmpresa, SECAO_DA_CHAVE, empresaComConfigPropria, gravarChaveDaEmpresa, lerChavesDaEmpresa, temConfigPropria,
} from './empresas-config';

export interface ExecutorEmpresas {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}


const str = (v: unknown) => (v == null ? '' : String(v));

// O esquema já rodou? to_regclass nunca falha: um banco antigo (ou o teste
// que não montou a tabela) não envenena a transação de quem chamou.
let tabelaPronta = false;
async function tabelaExiste(exec: ExecutorEmpresas): Promise<boolean> {
  if (tabelaPronta) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.empresas') IS NOT NULL AS ok`);
  tabelaPronta = rows[0]?.ok === true;
  return tabelaPronta;
}

function daLinha(r: Record<string, unknown>): Empresa {
  return {
    id: str(r.id), nome: str(r.nome), razao_social: str(r.razao_social), cnpj: str(r.cnpj),
    principal: r.principal === true, ativa: r.ativa !== false, ordem: Number(r.ordem ?? 100),
  };
}

/** Garante a principal (criada dos dados da agência na primeira vez). */
export async function garantirPrincipal(exec: ExecutorEmpresas, tenantId: string): Promise<void> {
  if (!tenantId) return;
  await exec.query(`SELECT fin_empresa_principal($1)`, [tenantId]);
}

export async function listarEmpresas(
  exec: ExecutorEmpresas, tenantId: string, opcoes: { inativas?: boolean } = {},
): Promise<Empresa[]> {
  if (!(await tabelaExiste(exec))) return [];
  await garantirPrincipal(exec, tenantId);
  const { rows } = await exec.query(
    `SELECT id, nome, razao_social, cnpj, principal, ativa, ordem FROM empresas
      WHERE tenant_id = $1 ${opcoes.inativas ? '' : 'AND ativa'}`,
    [tenantId],
  );
  return ordenarEmpresas(rows.map(daLinha));
}

/** Cria ou altera uma empresa. A principal muda de nome/CNPJ, mas nunca se desativa. */
export async function salvarEmpresa(
  exec: ExecutorEmpresas, tenantId: string, entrada: Record<string, unknown>,
): Promise<Empresa> {
  const r = normalizarEmpresa(entrada);
  if (!r.ok) throw new ErroEmpresa(r.erro);
  await garantirPrincipal(exec, tenantId);
  const idPedido = typeof entrada.id === 'string' ? entrada.id.trim().slice(0, 80) : '';
  let id = idPedido;
  let principal = false;
  if (id) {
    const { rows } = await exec.query(`SELECT principal FROM empresas WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (rows.length === 0) throw new ErroEmpresa('Empresa não encontrada. Recarregue a tela.', 404);
    principal = rows[0].principal === true;
  } else {
    id = `emp_${generateId()}`;
  }
  if (principal && !r.empresa.ativa) {
    throw new ErroEmpresa('A empresa principal não pode ser desativada: os registros de antes ficam nela.', 409);
  }
  const { cnpj, nome } = r.empresa;
  if (cnpj) {
    const { rows } = await exec.query(
      `SELECT nome FROM empresas WHERE tenant_id = $1 AND cnpj = $2 AND id <> $3`, [tenantId, cnpj, id]);
    if (rows.length) throw new ErroEmpresa(`Este CNPJ já está na empresa "${str(rows[0].nome)}".`, 409);
  }
  const { rows: mesmoNome } = await exec.query(
    `SELECT 1 FROM empresas WHERE tenant_id = $1 AND lower(nome) = lower($2) AND id <> $3`, [tenantId, nome, id]);
  if (mesmoNome.length) throw new ErroEmpresa('Já existe uma empresa com esse nome.', 409);

  const { rows } = await exec.query(
    `INSERT INTO empresas (tenant_id, id, nome, razao_social, cnpj, principal, ativa, ordem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 100))
     ON CONFLICT (tenant_id, id) DO UPDATE SET nome = EXCLUDED.nome, razao_social = EXCLUDED.razao_social,
       cnpj = EXCLUDED.cnpj, ativa = EXCLUDED.ativa, ordem = COALESCE($8, empresas.ordem), updated_at = NOW()
     RETURNING id, nome, razao_social, cnpj, principal, ativa, ordem`,
    [tenantId, id, nome, r.empresa.razao_social, cnpj, principal, r.empresa.ativa, r.empresa.ordem ?? null],
  );
  return daLinha(rows[0]);
}

// ---------------------------------------------------------------------------
// Escopo

export interface EscopoDeEmpresas {
  /** Empresas ativas da agência (para o seletor). */
  empresas: Empresa[];
  /** Mais de uma empresa: o seletor e as colunas aparecem. */
  multi: boolean;
  /** Liberadas pelo perfil de acesso (`null` = todas). */
  permitidas: string[] | null;
  /** O que a pessoa marcou no seletor (vazio = todas as que pode ver). */
  selecao: string[];
  /** O recorte que vale agora (`null` = sem recorte). */
  visiveis: EmpresasVisiveis;
}

const SEM_RECORTE: EscopoDeEmpresas = { empresas: [], multi: false, permitidas: null, selecao: [], visiveis: null };

/**
 * O escopo de quem pede. Com uma empresa ativa só (o caso de quase toda
 * agência), uma contagem e pronto: sem recorte.
 */
export async function escopoDaSessao(
  sessao: SessaoPermissoes | null | undefined, exec: ExecutorEmpresas,
): Promise<EscopoDeEmpresas> {
  if (!sessao) return { ...SEM_RECORTE, visiveis: [] };
  const tenantId = tenantDaSessao(sessao);
  if (!tenantId || !(await tabelaExiste(exec))) return SEM_RECORTE;
  const { rows: conta } = await exec.query(
    `SELECT count(*)::int AS n FROM empresas WHERE tenant_id = $1 AND ativa`, [tenantId]);
  if (Number(conta[0]?.n ?? 0) < 2) return SEM_RECORTE;

  const empresas = await listarEmpresas(exec, tenantId);
  const permitidas = await empresasPermitidas(sessao);
  const selecao = await lerSelecao(exec, tenantId, sessao.userId || '');
  const visiveis = escopoVisivel({ todas: empresas.map(e => e.id), permitidas, selecao });
  return { empresas, multi: true, permitidas, selecao, visiveis };
}

export async function lerSelecao(exec: ExecutorEmpresas, tenantId: string, usuarioId: string): Promise<string[]> {
  if (!usuarioId) return [];
  const { rows } = await exec.query(
    `SELECT empresas FROM empresa_selecao WHERE tenant_id = $1 AND usuario_id = $2`, [tenantId, usuarioId]);
  return listaDeTextos(rows[0]?.empresas, 200);
}

/** Grava o que a pessoa marcou (só empresas que existem e que ela pode ver). */
export async function salvarSelecao(
  exec: ExecutorEmpresas, sessao: SessaoPermissoes, pedidas: unknown,
): Promise<string[]> {
  const tenantId = tenantDaSessao(sessao);
  const usuarioId = sessao.userId || '';
  if (!tenantId || !usuarioId) throw new ErroEmpresa('Sessão sem pessoa identificada.', 401);
  const lista = listaDeTextos(pedidas, 200);
  const ativas = (await listarEmpresas(exec, tenantId)).map(e => e.id);
  const permitidas = await empresasPermitidas(sessao);
  const validas = lista.filter(e => ativas.includes(e) && (permitidas === null || permitidas.includes(e)));
  if (lista.length > 0 && validas.length === 0) throw new ErroEmpresa('Nenhuma das empresas escolhidas está liberada para você.', 403);
  // Todas marcadas = nenhuma marcada (vê o que pode); grava vazio.
  const podeVer = permitidas === null ? ativas : ativas.filter(e => permitidas.includes(e));
  const gravar = validas.length === podeVer.length ? [] : [...validas].sort();
  await exec.query(
    `INSERT INTO empresa_selecao (tenant_id, usuario_id, empresas) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, usuario_id) DO UPDATE SET empresas = EXCLUDED.empresas, updated_at = NOW()`,
    [tenantId, usuarioId, JSON.stringify(gravar)],
  );
  return gravar;
}

/** Ids das contas bancárias que aparecem para quem vê `visiveis` (null = todas). */
export async function contasBancariasVisiveis(
  exec: ExecutorEmpresas, tenantId: string, visiveis: EmpresasVisiveis,
): Promise<Set<string> | null> {
  if (visiveis === null) return null;
  const { rows } = await exec.query(
    `SELECT id FROM contas_bancarias
      WHERE tenant_id = $1
        AND (COALESCE(NULLIF(data->>'empresa_id', ''), 'principal') = ANY($2::text[])
             OR (jsonb_typeof(data->'empresas_disponiveis') = 'array'
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(data->'empresas_disponiveis') e WHERE e = ANY($2::text[]))))`,
    [tenantId, [...visiveis]],
  );
  return new Set(rows.map(r => str(r.id)));
}

/**
 * Condição SQL para um título (contas_pagar/receber) entrar no recorte:
 * a empresa dele ou a de alguma linha do rateio. `p` é o número do parâmetro
 * com a lista de empresas (text[]); `alias` é o da tabela.
 */
export function sqlDoTituloNasEmpresas(p: number, alias = ''): string {
  const a = alias ? `${alias}.` : '';
  return `(COALESCE(NULLIF(${a}data->>'empresa_id', ''), 'principal') = ANY($${p}::text[])
    OR (jsonb_typeof(${a}data->'rateio') = 'array' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(${a}data->'rateio') l WHERE l->>'empresa_id' = ANY($${p}::text[]))))`;
}

/** A empresa existe, está ativa e a pessoa pode trabalhar nela? */
export async function empresaLiberada(
  exec: ExecutorEmpresas, sessao: SessaoPermissoes, empresaId: string,
): Promise<boolean> {
  const tenantId = tenantDaSessao(sessao);
  if (!(await tabelaExiste(exec))) return empresaId === EMPRESA_PRINCIPAL_ID;
  const { rows } = await exec.query(
    `SELECT 1 FROM empresas WHERE tenant_id = $1 AND id = $2 AND ativa`, [tenantId, empresaId]);
  if (rows.length === 0) return false;
  const permitidas = await empresasPermitidas(sessao);
  return permitidas === null || permitidas.includes(empresaId);
}

// ---------------------------------------------------------------------------
// Configurações por empresa

export interface AdaptadorDaSecao {
  /** Lê a configuração da seção numa empresa (objeto plano). */
  ler(exec: ExecutorEmpresas, tenantId: string, empresaId: string): Promise<Record<string, unknown>>;
  /** Grava na empresa (a principal grava onde sempre gravou). */
  gravar(exec: ExecutorEmpresas, tenantId: string, empresaId: string, valor: Record<string, unknown>): Promise<void>;
}

/** Adaptador das seções guardadas em agencia.data (financeiro, cobrança, vendas). */
export function adaptadorDeChaves(
  secao: Exclude<SecaoPorEmpresa, 'notas'>,
  gravarNaAgencia: (exec: ExecutorEmpresas, tenantId: string, chave: string, valor: unknown) => Promise<void>,
): AdaptadorDaSecao {
  const chaves = CHAVES_DA_SECAO[secao];
  return {
    ler: (exec, tenantId, empresaId) => lerChavesDaEmpresa(exec, tenantId, empresaId, chaves),
    async gravar(exec, tenantId, empresaId, valor) {
      for (const k of chaves) {
        if (!(k in valor)) continue;
        if (empresaComConfigPropria(empresaId)) await gravarChaveDaEmpresa(exec, tenantId, empresaId, k, valor[k]);
        else await gravarNaAgencia(exec, tenantId, k, valor[k]);
      }
    },
  };
}

/**
 * "Copiar de outra empresa": leva a configuração da seção de `de` para
 * `para`, menos o que é da própria empresa (token, certificado, número do
 * emissor). Devolve o que ficou gravado no destino.
 */
export async function copiarConfiguracao(
  exec: ExecutorEmpresas, tenantId: string, secao: SecaoPorEmpresa, de: string, para: string, adaptador: AdaptadorDaSecao,
): Promise<Record<string, unknown>> {
  if (!de || !para) throw new ErroEmpresa('Escolha a empresa de origem e a de destino.');
  if (de === para) throw new ErroEmpresa('Escolha outra empresa: a origem é a própria empresa.');
  const { rows } = await exec.query(
    `SELECT id FROM empresas WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, [de, para]]);
  if (rows.length !== 2) throw new ErroEmpresa('Uma das empresas não existe mais. Recarregue a tela.', 404);
  const origem = await adaptador.ler(exec, tenantId, de);
  const destino = await adaptador.ler(exec, tenantId, para);
  const copia = configParaCopiar(secao, origem, destino);
  await adaptador.gravar(exec, tenantId, para, copia);
  if (empresaComConfigPropria(para)) {
    await exec.query(
      `INSERT INTO empresa_configuracoes (tenant_id, empresa_id, secao, data, copiada_de) VALUES ($1, $2, $3, '{}'::jsonb, $4)
       ON CONFLICT (tenant_id, empresa_id, secao) DO UPDATE SET copiada_de = EXCLUDED.copiada_de, updated_at = NOW()`,
      [tenantId, para, secao, de]);
  }
  return adaptador.ler(exec, tenantId, para);
}

// ---------------------------------------------------------------------------
// Cartão corporativo: a fatura nasce na empresa do cartão

/**
 * Depois de gravar o cartão: as compras em aberto dele vão para a empresa
 * da fatura (as pagas ficam onde estão: o caixa delas já foi de uma empresa).
 */
export async function moverFaturasAbertasDoCartao(tenantId: string, cartao: Record<string, unknown>): Promise<void> {
  const exec = pool as unknown as ExecutorEmpresas | null;
  if (!exec || typeof cartao.id !== 'string') return;
  const empresa = str(cartao.empresa_id);
  if (!empresa || !(await tabelaExiste(exec))) return;
  await exec.query(
    `UPDATE contas_pagar SET data = jsonb_set(data, '{empresa_id}', to_jsonb($3::text), true), updated_at = NOW()
      WHERE tenant_id = $1 AND data->>'cartao_id' = $2
        AND COALESCE(data->>'status', '') NOT IN ('PAGO', 'PARCIAL', 'CANCELADO')
        AND COALESCE(data->>'empresa_id', '') <> $3`,
    [tenantId, cartao.id, empresa],
  );
}

/**
 * Para as rotas escritas à mão de um título (abrir, editar, baixar): o
 * título é de uma empresa que a pessoa não pode ver? Com uma empresa só, ou
 * sem restrição por empresa, nunca.
 */
export async function tituloForaDasEmpresas(
  exec: ExecutorEmpresas, sessao: SessaoPermissoes | null | undefined, tabela: 'contas_pagar' | 'contas_receber', id: string,
): Promise<boolean> {
  if (!sessao) return false;
  const escopo = await escopoDaSessao(sessao, exec);
  if (!escopo.multi || escopo.permitidas === null) return false;
  const { rows } = await exec.query(`SELECT data FROM ${tabela} WHERE tenant_id = $1 AND id = $2`, [tenantDaSessao(sessao), id]);
  if (rows.length === 0) return false;
  return !empresasDoRegistro((rows[0].data ?? {}) as Record<string, unknown>).some(e => escopo.permitidas!.includes(e));
}
