/**
 * A equipe da plataforma: super admins e CS (tela /admin/equipe). Regras de
 * papel em ./plataforma.
 *
 * Quem cria a pessoa recebe uma senha provisória, mostrada uma vez só. No
 * primeiro acesso a pessoa cadastra o aplicativo autenticador (o login da
 * plataforma sempre pede o código) e pode trocar a senha em Minha conta.
 *
 * Travas:
 *  - só super admin mexe na equipe (a rota confere);
 *  - ninguém tira o próprio acesso (desativar a si mesmo ou virar CS);
 *  - sempre sobra ao menos um super admin ativo;
 *  - trocar papel, desativar, gerar senha ou zerar o autenticador derrubam
 *    as sessões abertas da pessoa (sobe `token_version`).
 *
 * Sem Next: recebe quem executa o SQL, para ser testado contra Postgres.
 */
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './senha';
import { papelDoCadastro, SENHA_MINIMA_DA_PLATAFORMA, type PapelDaPlataforma } from './plataforma';

export interface Executor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export class ErroEquipe extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PessoaDaPlataforma {
  id: string;
  nome: string;
  email: string;
  papel: PapelDaPlataforma;
  ativo: boolean;
  autenticador: boolean;
  criado_em: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPOS_DO_AUTENTICADOR = ['totp_cofre', 'totp_segredo', 'totp_ultimo_passo'];

function paraTela(d: Record<string, unknown>, criadoEm?: unknown): PessoaDaPlataforma {
  return {
    id: String(d.id ?? ''),
    nome: String(d.nome ?? ''),
    email: String(d.email ?? ''),
    papel: papelDoCadastro(d),
    ativo: d.ativo !== false,
    autenticador: !!(d.totp_cofre || d.totp_segredo),
    criado_em: criadoEm ? new Date(String(criadoEm)).toISOString() : null,
  };
}

/** Senha provisória: 16 caracteres sem os que se confundem (0/O, 1/l/I). */
export function senhaProvisoria(): string {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  let s = '';
  for (const b of bytes) s += alfabeto[b % alfabeto.length];
  return s;
}

function papelValido(v: unknown): PapelDaPlataforma {
  if (v === 'SUPER_ADMIN' || v === 'CS') return v;
  throw new ErroEquipe(400, 'Escolha o papel: Super admin ou CS.');
}

export async function listarEquipe(db: Executor): Promise<PessoaDaPlataforma[]> {
  const { rows } = await db.query(`SELECT data, created_at FROM super_admins ORDER BY created_at ASC`);
  return rows.map(r => paraTela(r.data as Record<string, unknown>, r.created_at));
}

async function lerPessoa(db: Executor, id: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query(`SELECT data FROM super_admins WHERE id = $1`, [id]);
  if (rows.length === 0) throw new ErroEquipe(404, 'Pessoa não encontrada.');
  return rows[0].data as Record<string, unknown>;
}

async function gravar(db: Executor, d: Record<string, unknown>): Promise<void> {
  await db.query(
    `UPDATE super_admins SET data = $2::jsonb, nome = $3, email = $4, updated_at = NOW() WHERE id = $1`,
    [d.id, JSON.stringify(d), d.nome, d.email],
  );
}

/** Super admins ativos, sem contar `excetoId`. */
async function outrosSuperAdminsAtivos(db: Executor, excetoId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM super_admins
      WHERE id <> $1 AND COALESCE(data->>'ativo', 'true') <> 'false' AND COALESCE(data->>'papel', 'SUPER_ADMIN') <> 'CS'`,
    [excetoId],
  );
  return Number(rows[0]?.n) || 0;
}

export async function criarPessoaDaPlataforma(
  db: Executor,
  corpo: { nome?: unknown; email?: unknown; papel?: unknown },
): Promise<{ pessoa: PessoaDaPlataforma; senha: string }> {
  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
  const email = typeof corpo.email === 'string' ? corpo.email.trim().toLowerCase() : '';
  if (!nome) throw new ErroEquipe(400, 'Informe o nome.');
  if (nome.length > 120) throw new ErroEquipe(400, 'Nome longo demais.');
  if (!EMAIL.test(email)) throw new ErroEquipe(400, 'Informe um e-mail válido.');
  const papel = papelValido(corpo.papel);

  // O login procura por data->>'email' em minúsculas; o cadastro antigo pode
  // ter a coluna com outra caixa.
  const { rows: existe } = await db.query(
    `SELECT 1 FROM super_admins WHERE LOWER(data->>'email') = $1 OR LOWER(email) = $1 LIMIT 1`,
    [email],
  );
  if (existe.length > 0) throw new ErroEquipe(409, 'Já existe alguém da plataforma com este e-mail.');

  const senha = senhaProvisoria();
  const id = 'sa-' + randomBytes(9).toString('hex');
  const dados = { id, nome, email, papel, ativo: true, senha_hash: await hashPassword(senha), token_version: 0 };
  const { rows } = await db.query(
    `INSERT INTO super_admins (id, email, nome, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW()) RETURNING created_at`,
    [id, email, nome, JSON.stringify(dados)],
  );
  return { pessoa: paraTela(dados, rows[0]?.created_at), senha };
}

export interface MudancaNaPessoa {
  papel?: unknown;
  ativo?: unknown;
  nova_senha?: unknown;
  zerar_autenticador?: unknown;
}

/**
 * Aplica uma mudança e devolve a pessoa como ficou, mais a senha nova quando
 * pedida. `autorId` é quem está mexendo. Rodar dentro de uma transação: o
 * FOR UPDATE impede dois super admins de se rebaixarem ao mesmo tempo e
 * deixarem a plataforma sem nenhum.
 */
export async function alterarPessoaDaPlataforma(
  db: Executor,
  id: string,
  mudanca: MudancaNaPessoa,
  autorId: string,
): Promise<{ pessoa: PessoaDaPlataforma; senha?: string; descricao: string[] }> {
  await db.query(`SELECT id FROM super_admins FOR UPDATE`);
  const d = { ...(await lerPessoa(db, id)) };
  const descricao: string[] = [];
  let derrubaSessoes = false;
  let senha: string | undefined;

  const tiraSuperAdmin = (papelNovo: PapelDaPlataforma, ativoNovo: boolean) =>
    papelDoCadastro(d) === 'SUPER_ADMIN' && d.ativo !== false && (papelNovo !== 'SUPER_ADMIN' || !ativoNovo);

  const papelNovo = mudanca.papel === undefined ? papelDoCadastro(d) : papelValido(mudanca.papel);
  const ativoNovo = mudanca.ativo === undefined ? d.ativo !== false : mudanca.ativo === true;
  if (mudanca.ativo !== undefined && typeof mudanca.ativo !== 'boolean') throw new ErroEquipe(400, 'Ativo é sim ou não.');

  if (id === autorId && (papelNovo !== papelDoCadastro(d) || !ativoNovo)) {
    throw new ErroEquipe(400, 'Você não pode tirar o próprio acesso. Peça a outro super admin.');
  }
  if (tiraSuperAdmin(papelNovo, ativoNovo) && (await outrosSuperAdminsAtivos(db, id)) === 0) {
    throw new ErroEquipe(400, 'A plataforma precisa de ao menos um super admin ativo.');
  }

  if (papelNovo !== papelDoCadastro(d)) {
    d.papel = papelNovo;
    descricao.push(`papel: ${papelNovo === 'CS' ? 'CS' : 'Super admin'}`);
    derrubaSessoes = true;
  }
  if (ativoNovo !== (d.ativo !== false)) {
    d.ativo = ativoNovo;
    descricao.push(ativoNovo ? 'reativado' : 'desativado');
    derrubaSessoes = true;
  }
  if (mudanca.nova_senha === true) {
    senha = senhaProvisoria();
    d.senha_hash = await hashPassword(senha);
    descricao.push('senha nova gerada');
    derrubaSessoes = true;
  }
  if (mudanca.zerar_autenticador === true) {
    for (const c of CAMPOS_DO_AUTENTICADOR) delete d[c];
    descricao.push('autenticador zerado');
    derrubaSessoes = true;
  }
  if (descricao.length === 0) throw new ErroEquipe(400, 'Nada para mudar.');
  if (derrubaSessoes) d.token_version = (Number(d.token_version) || 0) + 1;

  await gravar(db, d);
  return { pessoa: paraTela(d), senha, descricao };
}

/** A própria pessoa troca a senha (Minha conta). Derruba as sessões abertas. */
export async function trocarMinhaSenha(
  db: Executor,
  id: string,
  corpo: { senha_atual?: unknown; senha_nova?: unknown },
): Promise<void> {
  const atual = typeof corpo.senha_atual === 'string' ? corpo.senha_atual : '';
  const nova = typeof corpo.senha_nova === 'string' ? corpo.senha_nova : '';
  const d = { ...(await lerPessoa(db, id)) };
  if (!atual || !d.senha_hash || !(await verifyPassword(atual, String(d.senha_hash)))) {
    throw new ErroEquipe(400, 'A senha atual não confere.');
  }
  if (nova.length < SENHA_MINIMA_DA_PLATAFORMA) {
    throw new ErroEquipe(400, `A senha nova precisa ter ao menos ${SENHA_MINIMA_DA_PLATAFORMA} caracteres.`);
  }
  if (nova.length > 200) throw new ErroEquipe(400, 'Senha longa demais.');
  if (nova === atual) throw new ErroEquipe(400, 'A senha nova é igual à atual.');
  d.senha_hash = await hashPassword(nova);
  d.token_version = (Number(d.token_version) || 0) + 1;
  await gravar(db, d);
}
