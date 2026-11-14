/**
 * Agência de demonstração (14/11/2026): a conta de teste do Fernando.
 *
 * "Horizonte Viagens e Turismo (teste)", CNPJ fictício com dígito válido,
 * marcada `demo: true` (fora das métricas da plataforma e de toda saída,
 * ver ./saidas.ts), versão completa com todos os módulos e plano Founder Pro.
 * O administrador entra com `fernando+teste@entur.com.br` e uma senha forte
 * gerada aqui, mostrada UMA vez na tela e nunca gravada em texto nem no log.
 * Como todo ADMIN, cadastra a verificação em duas etapas no primeiro acesso.
 *
 * Mesmo caminho do cadastro de agência (api/auth/signup e api/admin/tenants):
 * tenant + usuário + agência numa transação; o assistente inicial (plano de
 * contas padrão) depois, sem derrubar a criação.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { esquecerDemo } from './saidas';

export interface Consulta {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface BancoDaDemo extends Consulta {
  connect?: () => Promise<Consulta & { release: () => void }>;
}

export const NOME_DA_DEMO = 'Horizonte Viagens e Turismo (teste)';
export const SLUG_DA_DEMO = 'horizonte-viagens-teste';
export const EMAIL_DA_DEMO = 'fernando+teste@entur.com.br';
export const PLANO_DA_DEMO = 'founder-pro';

/** Dígitos verificadores de CPF/CNPJ (módulo 11). */
function digito(base: string, pesos: number[]): string {
  const soma = base.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0);
  const resto = soma % 11;
  return String(resto < 2 ? 0 : 11 - resto);
}
export function cnpjComDigitos(base12: string): string {
  const d1 = digito(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base12 + d1 + d2;
}
export function cpfComDigitos(base9: string): string {
  const d1 = digito(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(base9 + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base9 + d1 + d2;
}
export function formatarCnpj(c: string): string {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/** CNPJ fictício da matriz (raiz 45.678.912) e da filial (0002). */
export const CNPJ_DA_DEMO = cnpjComDigitos('456789120001');
export const CNPJ_DA_FILIAL = cnpjComDigitos('456789120002');

/** Senha forte: 20 caracteres, com maiúscula, minúscula, número e símbolo. */
export function gerarSenhaForte(): string {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_'];
  const todos = grupos.join('');
  const chars = grupos.map(g => g[randomInt(g.length)]);
  const bytes = randomBytes(16);
  for (let i = 0; i < 16; i++) chars.push(todos[bytes[i] % todos.length]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function novoId(): string {
  return Date.now().toString(36) + randomBytes(5).toString('hex');
}

export interface SituacaoDaDemo {
  existe: boolean;
  tenant: { id: string; nome: string; slug: string; cnpj: string; plano: string; fin_versao: string } | null;
  admin: { id: string; email: string; ativo: boolean; tem_2fa: boolean } | null;
  dados: { semeado_em: string | null; resumo: Record<string, unknown> | null };
}

export async function acharAgenciaDemo(db: Consulta): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const { rows } = await db.query(
    `SELECT id, data FROM tenants WHERE (data->>'demo') = 'true' ORDER BY created_at LIMIT 1`,
  );
  return rows[0] ? { id: String(rows[0].id), data: (rows[0].data ?? {}) as Record<string, unknown> } : null;
}

export async function situacaoDaDemo(db: Consulta): Promise<SituacaoDaDemo> {
  const t = await acharAgenciaDemo(db);
  if (!t) return { existe: false, tenant: null, admin: null, dados: { semeado_em: null, resumo: null } };
  const { rows: us } = await db.query(
    `SELECT id, data FROM usuarios WHERE tenant_id = $1 AND LOWER(data->>'email') = $2 LIMIT 1`,
    [t.id, EMAIL_DA_DEMO],
  );
  const u = us[0] ? ((us[0].data ?? {}) as Record<string, unknown>) : null;
  return {
    existe: true,
    tenant: {
      id: t.id, nome: String(t.data.nome ?? ''), slug: String(t.data.slug ?? ''), cnpj: String(t.data.cnpj ?? ''),
      plano: String(t.data.plano ?? ''), fin_versao: String(t.data.fin_versao ?? ''),
    },
    admin: u ? {
      id: String(us[0].id), email: String(u.email ?? ''), ativo: u.ativo !== false,
      tem_2fa: Boolean(u.totp_cofre || u.totp_segredo),
    } : null,
    dados: {
      semeado_em: typeof t.data.demo_semeado_em === 'string' ? t.data.demo_semeado_em : null,
      resumo: (t.data.demo_resumo && typeof t.data.demo_resumo === 'object') ? t.data.demo_resumo as Record<string, unknown> : null,
    },
  };
}

export class ErroDaDemo extends Error {
  status: number;
  constructor(mensagem: string, status = 400) {
    super(mensagem);
    this.name = 'ErroDaDemo';
    this.status = status;
  }
}

export interface ResultadoDaCriacao {
  criada: boolean;
  situacao: SituacaoDaDemo;
  /** Só na criação: a senha, para a tela mostrar uma vez. Nunca gravada. */
  senha?: string;
  aviso_assistente?: string;
}

/**
 * Cria a agência de demonstração. Idempotente: se já existe, devolve a
 * situação e não mexe em nada (a tela oferece "Recriar dados").
 */
export async function criarAgenciaDemo(
  db: BancoDaDemo,
  o: {
    hashPassword: (senha: string) => Promise<string>;
    prepararAgencia?: (tenantId: string) => Promise<void>;
  },
): Promise<ResultadoDaCriacao> {
  const ja = await situacaoDaDemo(db);
  if (ja.existe) return { criada: false, situacao: ja };

  const { rows: emailUsado } = await db.query(
    `SELECT 1 FROM usuarios WHERE LOWER(data->>'email') = $1 LIMIT 1`, [EMAIL_DA_DEMO],
  );
  if (emailUsado.length) throw new ErroDaDemo(`O e-mail ${EMAIL_DA_DEMO} já está em outra agência. Tire-o de lá antes de criar a demonstração.`, 409);
  const { rows: slugUsado } = await db.query(`SELECT 1 FROM tenants WHERE slug = $1 LIMIT 1`, [SLUG_DA_DEMO]);
  if (slugUsado.length) throw new ErroDaDemo(`Já existe uma agência com o endereço ${SLUG_DA_DEMO} que não é de demonstração.`, 409);

  const { rows: planos } = await db.query(
    `SELECT nome, limites, features FROM planos WHERE slug = $1 LIMIT 1`, [PLANO_DA_DEMO],
  );
  const plano = planos[0] ?? {};
  const limites = (plano.limites ?? {}) as Record<string, number>;

  const tenantId = novoId();
  const userId = novoId();
  const senha = gerarSenhaForte();
  const senhaHash = await o.hashPassword(senha);
  const agora = new Date().toISOString();

  const tenantData = {
    id: tenantId, slug: SLUG_DA_DEMO, nome: NOME_DA_DEMO, cnpj: CNPJ_DA_DEMO,
    plano: PLANO_DA_DEMO, plano_nome: String(plano.nome ?? 'Founder Pro'), status: 'ativo',
    max_usuarios: limites.usuarios ?? 10, max_grupos: limites.grupos ?? 100, features: plano.features ?? [],
    criado_via: 'demonstracao', created_at: agora,
    // Fora das métricas e da cobrança da plataforma; nada sai (demo/saidas.ts).
    demo: true,
    // Versão completa, todos os módulos (src/lib/modulos.ts).
    fin_versao: 'completa',
  };
  const permissoes = {
    ver_vendas_todos: true, ver_financeiro: true, editar_financeiro: true, ver_comissoes: true,
    acessar_relatorios: true, gerenciar_usuarios: true, pode_excluir: true, pode_exportar: true,
    ver_extrato_contas: [] as string[],
  };
  const userData = {
    id: userId, nome: 'Fernando (teste)', email: EMAIL_DA_DEMO, senha_hash: senhaHash,
    perfil: 'ADMIN', permissoes, ativo: true, criado_via: 'demonstracao', tenant_id: tenantId, created_at: agora,
  };
  const agenciaData = {
    nome: NOME_DA_DEMO, nome_fantasia: NOME_DA_DEMO, razao_social: 'Horizonte Viagens e Turismo Ltda (teste)',
    cnpj: CNPJ_DA_DEMO, email_contato: 'contato@exemplo.com.br', telefone: '(11) 4000-0000',
    cidade: 'São Paulo', estado: 'SP',
  };

  const conexao = db.connect ? await db.connect() : null;
  const exec: Consulta = conexao ?? db;
  try {
    await exec.query('BEGIN');
    await exec.query(
      `INSERT INTO tenants (id, slug, nome, cnpj, plano, status, data) VALUES ($1, $2, $3, $4, $5, 'ativo', $6)`,
      [tenantId, SLUG_DA_DEMO, NOME_DA_DEMO, CNPJ_DA_DEMO, PLANO_DA_DEMO, JSON.stringify(tenantData)],
    );
    await exec.query(
      `INSERT INTO usuarios (id, tenant_id, nome, email, data) VALUES ($1, $2, $3, $4, $5)`,
      [userId, tenantId, userData.nome, EMAIL_DA_DEMO, JSON.stringify(userData)],
    );
    await exec.query(
      `INSERT INTO agencia (id, tenant_id, data) VALUES ('singleton-' || $1, $1, $2) ON CONFLICT DO NOTHING`,
      [tenantId, JSON.stringify(agenciaData)],
    );
    await exec.query('COMMIT');
  } catch (e) {
    try { await exec.query('ROLLBACK'); } catch { /* conexão perdida */ }
    throw e;
  } finally {
    conexao?.release();
  }
  esquecerDemo(tenantId);

  // Assistente inicial: plano de contas padrão (como no cadastro). Não derruba.
  let aviso: string | undefined;
  if (o.prepararAgencia) {
    try {
      await o.prepararAgencia(tenantId);
    } catch (e) {
      aviso = `O plano de contas padrão não foi criado agora (${e instanceof Error ? e.message : 'erro'}); "Criar dados" cria.`;
    }
  }
  return { criada: true, situacao: await situacaoDaDemo(db), senha, aviso_assistente: aviso };
}
