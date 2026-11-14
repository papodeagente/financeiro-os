/**
 * Cadastro de usuários (FIN-01 e FIN-15 da auditoria de 04/11/2026), contra
 * um Postgres real (PGlite), rodando o serviço DE PRODUÇÃO.
 *
 * O ataque que existia: um VENDEDOR fazia PUT /api/usuarios/<seu id> com
 * perfil ADMIN e virava administrador; o GET devolvia o senha_hash de todos.
 *
 * Uso: node --no-warnings scripts/test-sql-usuarios.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}
async function erro(promessa) {
  try { await promessa; return null; } catch (e) { return e.status ?? e.message; }
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const S = await import('../src/lib/usuarios-servico.ts');
const { perfilCanonico, permissoesParaPerfil } = await import('../src/lib/permissoes.ts');
const { verifyPassword } = await import('../src/lib/senha.ts');
const db = { query };

const T1 = 'ag-1', T2 = 'ag-2';
const ins = (id, tenant, perfil, extra = {}) => query(
  `INSERT INTO usuarios (id, tenant_id, nome, email, data) VALUES ($1,$2,$1,$3,$4)`,
  [id, tenant, `${id}@x.com`, JSON.stringify({ id, nome: id, email: `${id}@x.com`, perfil, ativo: true, senha_hash: 'aa:bb', token_version: 1, ...extra })]);
await ins('admin1', T1, 'ADMIN');
await ins('vend1', T1, 'VENDEDOR');
await ins('oper1', T1, 'OPERADOR');
await ins('admin2', T2, 'ADMIN');

const admin = { userId: 'admin1', perfil: 'ADMIN' };
const vendedor = { userId: 'vend1', perfil: 'VENDEDOR' };
const operador = { userId: 'oper1', perfil: 'OPERADOR' };
const ler = async id => (await query(`SELECT data FROM usuarios WHERE id=$1`, [id])).rows[0]?.data;

console.log('--- leitura nunca devolve o hash ---');
{
  const lista = await S.listarUsuarios(db, vendedor, T1);
  eq(lista.length, 3, 'só usuários da própria agência');
  eq(lista.some(u => 'senha_hash' in u), false, 'nenhum senha_hash na lista');
  eq(lista.every(u => u.tem_senha === true), true, 'tem_senha informa sem expor');
  eq(await erro(S.lerUsuario(db, admin, T1, 'admin2')), 404, 'usuário de outra agência não existe para mim');
  eq(await erro(S.listarUsuarios(db, null, T1)), 401, 'sem sessão, 401');
}

console.log('--- vendedor e operador não gerenciam usuários ---');
{
  eq(await erro(S.atualizarUsuario(db, vendedor, T1, 'vend1', { perfil: 'ADMIN' })), 403, 'vendedor não se promove a admin');
  eq((await ler('vend1')).perfil, 'VENDEDOR', 'perfil continua VENDEDOR no banco');
  eq(await erro(S.atualizarUsuario(db, operador, T1, 'admin1', { senha: 'trocada123' })), 403, 'operador não troca senha de outro');
  eq(await erro(S.criarUsuario(db, vendedor, T1, { nome: 'X', email: 'x@x.com', perfil: 'ADMIN', senha: '12345678' })), 403, 'vendedor não cria admin');
  eq(await erro(S.excluirUsuario(db, operador, T1, 'vend1')), 403, 'operador não exclui');
  eq(await erro(S.atualizarUsuario(db, admin, T2, 'vend1', { perfil: 'ADMIN' })), 404, 'admin não alcança usuário de outra agência pelo id');
}

console.log('--- admin cria com campos controlados ---');
{
  const novo = await S.criarUsuario(db, admin, T1, {
    nome: ' Ana ', email: ' ANA@Agencia.com ', perfil: 'OPERADOR', senha: 'senhaforte1',
    senha_hash: 'aa:bb', permissoes: { gerenciar_usuarios: true }, id: 'admin1', tenant_id: T2,
  });
  const gravado = await ler(novo.id);
  eq(novo.id !== 'admin1', true, 'id vem do servidor, não do corpo');
  eq(gravado.email, 'ana@agencia.com', 'e-mail normalizado');
  const ord = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  eq(ord(gravado.permissoes), ord(permissoesParaPerfil('OPERADOR')), 'permissões derivadas do perfil, não do corpo');
  eq(gravado.senha_hash === 'aa:bb', false, 'senha_hash do corpo ignorado');
  eq(await verifyPassword('senhaforte1', gravado.senha_hash), true, 'hash gerado no servidor confere');
  eq((await query(`SELECT tenant_id FROM usuarios WHERE id=$1`, [novo.id])).rows[0].tenant_id, T1, 'tenant da sessão, não do corpo');
  eq(await erro(S.criarUsuario(db, admin, T1, { nome: 'B', email: 'admin2@x.com', perfil: 'VENDEDOR', senha: '12345678' })), 409, 'e-mail de outra agência recusado (login é por e-mail)');
  eq(await erro(S.criarUsuario(db, admin, T1, { nome: 'B', email: 'b@x.com', perfil: 'SUPERADMIN', senha: '12345678' })), 400, 'perfil inventado recusado');
  eq(await erro(S.criarUsuario(db, admin, T1, { nome: 'B', email: 'b@x.com', perfil: 'VENDEDOR', senha: '123' })), 400, 'senha curta recusada');
}

console.log('--- troca de perfil invalida sessões; agência nunca fica sem admin ---');
{
  await S.atualizarUsuario(db, admin, T1, 'vend1', { perfil: 'OPERADOR' });
  eq((await ler('vend1')).token_version, 2, 'mudar perfil sobe token_version');
  await S.atualizarUsuario(db, admin, T1, 'vend1', { nome: 'Vendedor Um' });
  eq((await ler('vend1')).token_version, 2, 'mudar só o nome não derruba a sessão');
  eq(await erro(S.atualizarUsuario(db, admin, T1, 'admin1', { perfil: 'VENDEDOR' })), 403, 'admin não muda o próprio perfil');
  eq(await erro(S.atualizarUsuario(db, admin, T1, 'admin1', { ativo: false })), 403, 'admin não se desativa');
  eq(await erro(S.excluirUsuario(db, admin, T1, 'admin1')), 403, 'admin não se exclui');
  const superadmin = { userId: 'sa', isSuperAdmin: true };
  eq(await erro(S.atualizarUsuario(db, superadmin, T1, 'admin1', { perfil: 'OPERADOR' })), 409, 'último admin não é rebaixado');
  eq(await erro(S.excluirUsuario(db, superadmin, T1, 'admin1')), 409, 'último admin não é excluído');
  await S.atualizarUsuario(db, admin, T1, 'oper1', { perfil: 'ADMIN' });
  await S.atualizarUsuario(db, superadmin, T1, 'admin1', { perfil: 'OPERADOR' });
  eq((await ler('admin1')).perfil, 'OPERADOR', 'com outro admin ativo, rebaixar passa');
}

console.log('--- FIN-15: perfil desconhecido não vira OPERADOR ---');
{
  eq(perfilCanonico('HACKER'), 'COLABORADOR', 'perfil desconhecido = sem acesso');
  eq(perfilCanonico(undefined), 'COLABORADOR', 'perfil ausente = sem acesso');
  eq(perfilCanonico('GERENTE'), 'OPERADOR', 'legado conhecido continua OPERADOR');
  eq(perfilCanonico('owner'), 'ADMIN', 'owner continua ADMIN');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
