/**
 * Cadastro de usuários da agência (FIN-01 da auditoria de 04/11/2026).
 *
 * Antes, /api/usuarios era o CRUD genérico: qualquer pessoa logada lia a
 * lista com o `senha_hash` de todo mundo e gravava o que quisesse por cima,
 * inclusive o próprio perfil. Um vendedor virava administrador com um PUT.
 *
 * Aqui:
 *  - criar, alterar e excluir exigem quem gerencia usuários (ADMIN);
 *  - a resposta nunca leva `senha_hash`;
 *  - só os campos da lista abaixo são aceitos do corpo; o resto é ignorado;
 *  - a senha chega em texto (`senha`) e o hash é feito aqui, no servidor;
 *  - a agência nunca fica sem administrador ativo;
 *  - o e-mail é único no sistema inteiro, porque o login procura por e-mail
 *    sem saber a agência;
 *  - mudar perfil, senha, e-mail ou desativar invalida as sessões abertas
 *    da pessoa (token_version, conferido em getSession).
 *
 * Não importa nada do Next, para os testes rodarem contra um Postgres real.
 */
import { podeGerenciarUsuarios, podeEditarFinanceiro, perfilCanonico, permissoesParaPerfil, type SessionLike } from './permissoes';
import { hashPassword } from './senha';
import { esquecerSessaoEmCache } from './sessao-viva';
import type { PerfilUsuario } from './crm-types';

export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export class ErroUsuarios extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409, mensagem: string) {
    super(mensagem);
  }
}

export const SENHA_MINIMA = 8;

/** Perfis que a tela oferece. Legados existentes continuam valendo, mas não se atribuem. */
const PERFIS_ATRIBUIVEIS = new Set(['ADMIN', 'OPERADOR', 'VENDEDOR', 'COLABORADOR']);

/** Os únicos campos que o corpo da requisição pode trazer. */
const CAMPOS_TEXTO = ['nome', 'telefone', 'foto', 'plano_comissao_id'] as const;
const CAMPOS_NUMERO = ['meta_mensal_vendas', 'meta_mensal_quantidade'] as const;

type Dados = Record<string, unknown>;

/** O que sai para a tela: tudo menos o segredo. */
export function semSegredos(u: Dados): Dados {
  const { senha_hash, totp_cofre, totp_segredo, totp_ultimo_passo: _passo, ...resto } = u;
  void _passo;
  return {
    ...resto,
    tem_senha: typeof senha_hash === 'string' && senha_hash.length > 0,
    tem_2fa: Boolean(totp_cofre || totp_segredo),
  };
}

function exigirGestor(sessao: SessionLike | null | undefined) {
  if (!sessao) throw new ErroUsuarios(401, 'Sessão necessária.');
  if (!podeGerenciarUsuarios(sessao)) {
    throw new ErroUsuarios(403, 'Apenas administradores podem gerenciar usuários.');
  }
}

function normalizarEmail(v: unknown): string {
  const email = String(v ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ErroUsuarios(400, 'E-mail inválido.');
  }
  return email;
}

function validarPerfil(v: unknown): PerfilUsuario {
  const perfil = String(v ?? '');
  if (!PERFIS_ATRIBUIVEIS.has(perfil)) throw new ErroUsuarios(400, 'Perfil inválido.');
  return perfil as PerfilUsuario;
}

async function senhaParaHash(v: unknown): Promise<string> {
  const senha = String(v ?? '');
  if (senha.length < SENHA_MINIMA) {
    throw new ErroUsuarios(400, `A senha deve ter no mínimo ${SENHA_MINIMA} caracteres.`);
  }
  if (senha.length > 200) throw new ErroUsuarios(400, 'Senha longa demais.');
  return hashPassword(senha);
}

function copiarCamposSimples(corpo: Dados, destino: Dados) {
  for (const c of CAMPOS_TEXTO) {
    if (corpo[c] !== undefined) destino[c] = String(corpo[c] ?? '').slice(0, c === 'foto' ? 2_000_000 : 500);
  }
  for (const c of CAMPOS_NUMERO) {
    if (corpo[c] !== undefined) {
      const n = Number(corpo[c]);
      destino[c] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
  }
}

async function emailEmUso(db: Consulta, email: string, ignorarId: string | null): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM usuarios
      WHERE lower(trim(data->>'email')) = $1 AND ($2::text IS NULL OR id <> $2)
      LIMIT 1`,
    [email, ignorarId],
  );
  return rows.length > 0;
}

function eAdminAtivo(u: Dados): boolean {
  return perfilCanonico(u.perfil as string) === 'ADMIN' && u.ativo !== false;
}

async function contarAdminsAtivos(db: Consulta, tenantId: string, excetoId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT data FROM usuarios WHERE tenant_id = $1 AND id <> $2`,
    [tenantId, excetoId],
  );
  return rows.filter(r => eAdminAtivo((r.data ?? {}) as Dados)).length;
}

function novoId(): string {
  return `usr_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Folha (salário, encargos) e comissão dos outros só para quem cuida disso. */
function paraQuemLe(u: Dados, sessao: SessionLike): Dados {
  const limpo = semSegredos(u);
  delete limpo.token_version;
  if (podeGerenciarUsuarios(sessao) || podeEditarFinanceiro(sessao) || sessao.userId === u.id) return limpo;
  delete limpo.vinculo;
  delete limpo.plano_comissao_id;
  delete limpo.meta_mensal_vendas;
  delete limpo.meta_mensal_quantidade;
  return limpo;
}

export async function listarUsuarios(db: Consulta, sessao: SessionLike | null | undefined, tenantId: string) {
  if (!sessao) throw new ErroUsuarios(401, 'Sessão necessária.');
  const { rows } = await db.query(
    `SELECT data FROM usuarios WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows.map(r => paraQuemLe((r.data ?? {}) as Dados, sessao));
}

export async function lerUsuario(db: Consulta, sessao: SessionLike | null | undefined, tenantId: string, id: string) {
  if (!sessao) throw new ErroUsuarios(401, 'Sessão necessária.');
  const { rows } = await db.query(`SELECT data FROM usuarios WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (rows.length === 0) throw new ErroUsuarios(404, 'Usuário não encontrado.');
  return paraQuemLe((rows[0].data ?? {}) as Dados, sessao);
}

export async function criarUsuario(db: Consulta, sessao: SessionLike | null | undefined, tenantId: string, corpo: Dados) {
  exigirGestor(sessao);
  const nome = String(corpo.nome ?? '').trim();
  if (!nome) throw new ErroUsuarios(400, 'Informe o nome.');
  const email = normalizarEmail(corpo.email);
  const perfil = validarPerfil(corpo.perfil ?? 'VENDEDOR');
  if (await emailEmUso(db, email, null)) throw new ErroUsuarios(409, 'Este e-mail já está cadastrado.');

  const id = novoId();
  const dados: Dados = {
    id,
    nome,
    email,
    perfil,
    permissoes: permissoesParaPerfil(perfil),
    ativo: corpo.ativo !== false,
    plano_comissao_id: '',
    meta_mensal_vendas: 0,
    meta_mensal_quantidade: 0,
    membro_ids_legado: [],
    token_version: 1,
  };
  copiarCamposSimples(corpo, dados);
  dados.nome = nome;
  // Colaborador não entra no sistema: senha é opcional para ele.
  if (perfil !== 'COLABORADOR' || corpo.senha) {
    dados.senha_hash = await senhaParaHash(corpo.senha);
  } else {
    dados.senha_hash = '';
  }

  await db.query(
    `INSERT INTO usuarios (id, tenant_id, nome, email, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [id, tenantId, nome, email, JSON.stringify(dados)],
  );
  return semSegredos(dados);
}

export async function atualizarUsuario(
  db: Consulta, sessao: SessionLike | null | undefined, tenantId: string, id: string, corpo: Dados,
) {
  exigirGestor(sessao);
  const { rows } = await db.query(`SELECT data FROM usuarios WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (rows.length === 0) throw new ErroUsuarios(404, 'Usuário não encontrado.');
  const atual = (rows[0].data ?? {}) as Dados;
  const novo: Dados = { ...atual };
  let invalidaSessoes = false;
  const proprio = sessao?.userId === id && !sessao?.isSuperAdmin;

  copiarCamposSimples(corpo, novo);
  if (corpo.nome !== undefined && !String(corpo.nome).trim()) throw new ErroUsuarios(400, 'Informe o nome.');
  if (corpo.nome !== undefined) novo.nome = String(corpo.nome).trim();

  if (corpo.email !== undefined) {
    const email = normalizarEmail(corpo.email);
    if (email !== String(atual.email ?? '').trim().toLowerCase()) {
      if (await emailEmUso(db, email, id)) throw new ErroUsuarios(409, 'Este e-mail já está cadastrado.');
      novo.email = email;
      invalidaSessoes = true;
    }
  }

  if (corpo.perfil !== undefined && corpo.perfil !== atual.perfil) {
    if (proprio) throw new ErroUsuarios(403, 'Você não pode alterar o seu próprio perfil.');
    const perfil = validarPerfil(corpo.perfil);
    novo.perfil = perfil;
    novo.permissoes = permissoesParaPerfil(perfil);
    invalidaSessoes = true;
  }

  if (corpo.ativo !== undefined && Boolean(corpo.ativo) !== (atual.ativo !== false)) {
    if (proprio && corpo.ativo === false) throw new ErroUsuarios(403, 'Você não pode desativar a si mesmo.');
    novo.ativo = Boolean(corpo.ativo);
    invalidaSessoes = true;
  }

  if (typeof corpo.senha === 'string' && corpo.senha.length > 0) {
    novo.senha_hash = await senhaParaHash(corpo.senha);
    invalidaSessoes = true;
  }

  // Zerar o 2FA de quem perdeu o celular: no próximo login a pessoa cadastra
  // o aplicativo de novo. Só outro administrador faz isso.
  if (corpo.resetar_2fa === true) {
    if (proprio) throw new ErroUsuarios(403, 'Peça a outro administrador para zerar o seu segundo fator.');
    delete novo.totp_cofre;
    delete novo.totp_segredo;
    delete novo.totp_ultimo_passo;
    invalidaSessoes = true;
  }

  if (eAdminAtivo(atual) && !eAdminAtivo(novo) && (await contarAdminsAtivos(db, tenantId, id)) === 0) {
    throw new ErroUsuarios(409, 'A agência precisa de pelo menos um administrador ativo.');
  }

  // Grava só o que mudou, por cima do que está no banco AGORA. Regravar o
  // `data` inteiro lido antes desfazia o que outra requisição fez no meio:
  // um "sair" (token_version), um cadastro de 2FA ou o último código usado.
  const patch: Dados = {};
  for (const [k, v] of Object.entries(novo)) {
    if (JSON.stringify(v) !== JSON.stringify(atual[k])) patch[k] = v;
  }
  delete patch.token_version;
  const remover = ['totp_cofre', 'totp_segredo', 'totp_ultimo_passo'].filter(k => k in atual && !(k in novo));
  const { rows: gravadas } = await db.query(
    `UPDATE usuarios
        SET data = CASE WHEN $5::boolean
                     THEN jsonb_set((data || $3::jsonb) - $4::text[], '{token_version}',
                                    to_jsonb(COALESCE((data->>'token_version')::int, 0) + 1), true)
                     ELSE (data || $3::jsonb) - $4::text[] END,
            nome = $6, email = $7, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING data`,
    [id, tenantId, JSON.stringify(patch), remover, invalidaSessoes, String(novo.nome ?? ''), String(novo.email ?? '')],
  );
  if (gravadas.length > 0) Object.assign(novo, { token_version: (gravadas[0].data as Dados)?.token_version });
  if (invalidaSessoes) esquecerSessaoEmCache({ userId: id, tenantId });
  return semSegredos(novo);
}

export async function excluirUsuario(db: Consulta, sessao: SessionLike | null | undefined, tenantId: string, id: string) {
  exigirGestor(sessao);
  if (sessao?.userId === id && !sessao?.isSuperAdmin) {
    throw new ErroUsuarios(403, 'Você não pode excluir a si mesmo.');
  }
  const { rows } = await db.query(`SELECT data FROM usuarios WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (rows.length === 0) throw new ErroUsuarios(404, 'Usuário não encontrado.');
  const atual = (rows[0].data ?? {}) as Dados;
  if (eAdminAtivo(atual) && (await contarAdminsAtivos(db, tenantId, id)) === 0) {
    throw new ErroUsuarios(409, 'A agência precisa de pelo menos um administrador ativo.');
  }
  await db.query(`DELETE FROM usuarios WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  esquecerSessaoEmCache({ userId: id, tenantId });
  return { ok: true };
}
