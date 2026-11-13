import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { AUDIT_SCHEMA_SQL } from '../src/lib/audit-schema.ts';

const db = new PGlite();
let checks = 0;
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}
const count = async () => (await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
const latest = async () => (await db.query('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 1')).rows[0];
const setContext = async context => db.query('SELECT set_config($1, $2, false)', ['app.audit_context', JSON.stringify(context)]);
const save = async (id, tenant, data) => db.query(
  `INSERT INTO clientes (id, tenant_id, data) VALUES ($1,$2,$3)
   ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [id, tenant, JSON.stringify(data)]);

try {
  await db.exec(`
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT,
      acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT, data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, data JSONB, updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, data JSONB);
    CREATE TABLE config_apis (id TEXT, tenant_id TEXT NOT NULL, data JSONB, PRIMARY KEY(id,tenant_id));
    CREATE TABLE grupo_passageiros (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, data JSONB);
    CREATE TABLE grupo_eventos (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, data JSONB);
    CREATE TABLE api_cache (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, data JSONB);
    CREATE TABLE tenants (id TEXT PRIMARY KEY, data JSONB);
    CREATE TABLE saas_config (key TEXT PRIMARY KEY, data JSONB);
  `);
  await save('old', 'tenant-a', { nome: 'Preexistente' });
  await db.exec(AUDIT_SCHEMA_SQL);
  eq(await count(), 0, 'não inventa histórico para dados anteriores à ativação');
  const activation = (await db.query("SELECT created_at, data FROM audit_config WHERE id = 'capture-v1'")).rows[0];
  eq(activation.data.tables.includes('grupo_passageiros'), true, 'tabelas filhas incluídas');
  eq(activation.data.tables.includes('api_cache'), false, 'cache excluído');
  eq(activation.data.tables.includes('grupo_eventos'), false, 'histórico duplicado excluído');

  await setContext({ userId: 'u1', userName: 'Ana', tenantId: 'tenant-a', perfil: 'ADMIN', source: 'USUARIO', requestId: 'r1', path: '/api/clientes', method: 'POST' });
  await save('c1', 'tenant-a', { nome: 'Cliente', valor: 0, ativo: false });
  let entry = await latest();
  eq([entry.acao, entry.tenant_id, entry.usuario_id, entry.data.usuario_nome, entry.data.perfil], ['CRIAR','tenant-a','u1','Ana','ADMIN'], 'CRUD recebe ator real e tenant da linha');
  eq([entry.data.origem, entry.data.request_id, entry.data.rota, entry.data.metodo], ['USUARIO','r1','/api/clientes','POST'], 'contexto da requisição preservado');
  eq(entry.data.alteracoes.find(a => a.campo === 'data.valor').valor_novo, '0', 'valor zero preservado');
  eq(entry.data.alteracoes.find(a => a.campo === 'data.ativo').valor_novo, 'false', 'booleano false preservado');
  eq(Number.isNaN(Date.parse(entry.data.timestamp)), false, 'timestamp do servidor é ISO válido');

  await save('c1', 'tenant-a', { nome: 'Atualizado', valor: 15, ativo: true });
  entry = await latest();
  eq(entry.acao, 'EDITAR', 'upsert gera edição, não criação duplicada');
  eq(entry.data.alteracoes.find(a => a.campo === 'data.valor'), { campo:'data.valor',valor_anterior:'0',valor_novo:'15' }, 'diff mostra antes/depois reais');
  let previous = await count();
  await save('c1', 'tenant-a', { nome: 'Atualizado', valor: 15, ativo: true });
  await db.exec("UPDATE clientes SET updated_at=now(), data=data || jsonb_build_object('atualizado_em',now()) WHERE id='c1'");
  eq(await count(), previous, 'upsert sem alteração e timestamps não geram ruído');

  await db.exec('BEGIN');
  await save('rolled-back', 'tenant-a', { nome:'Não deve persistir' });
  eq(await count(), previous + 1, 'auditoria participa da transação');
  await db.exec('ROLLBACK');
  eq(await count(), previous, 'rollback remove também o evento');
  await db.exec('BEGIN');
  await save('committed', 'tenant-a', { nome:'Confirmado' });
  await db.exec('COMMIT');
  eq((await latest()).usuario_id, 'u1', 'transação mantém contexto');

  await setContext({ userId:'u2',userName:'Outra agência',tenantId:'tenant-b',perfil:'ADMIN',source:'USUARIO' });
  await save('c2', 'tenant-b', { nome:'Cliente B' });
  eq([(await latest()).tenant_id,(await latest()).usuario_id], ['tenant-b','u2'], 'não reutiliza ator/tenant da conexão anterior');
  await db.exec("UPDATE clientes SET tenant_id='tenant-b' WHERE id='c1'");
  eq((await latest()).tenant_id, 'tenant-a', 'troca de tenant fica auditada na origem');
  eq((await latest()).data.alteracoes.some(a=>a.campo==='tenant_id'), true, 'troca de tenant possui diff');
  await db.exec("DELETE FROM clientes WHERE id='old'");
  eq([(await latest()).acao,(await latest()).tenant_id], ['EXCLUIR','tenant-a'], 'DELETE registra tenant original independentemente do ator');

  const confidential = {
    nome:'Usuário', senha_hash:'senha-inicial-super-secreta',
    nested:{ apiKey:'api-secreta', token:'token-secreto', certificado:'certificado-secreto', ativo:true },
    payload:{ public:'conteúdo-raw-proibido' },
    dataString:JSON.stringify({ senha:'senha-json-secreta', valor:42 }),
    anexos:[{ password:'senha-array-secreta' }],
    descricao:'Bearer segredo-no-texto',
    url:'https://example.com/?token=segredo-na-url',
  };
  await db.query('INSERT INTO usuarios VALUES ($1,$2,$3)', ['u-secret','tenant-a',JSON.stringify(confidential)]);
  entry = await latest();
  for (const secret of ['senha-inicial-super-secreta','api-secreta','token-secreto','certificado-secreto','conteúdo-raw-proibido','senha-json-secreta','senha-array-secreta','segredo-no-texto','segredo-na-url']) {
    eq(JSON.stringify(entry).includes(secret), false, `redação de ${secret.split('-').slice(0,2).join('-')}`);
  }
  previous = await count();
  await db.exec("UPDATE usuarios SET data=jsonb_set(data,'{senha_hash}','\"nova-senha-secreta\"') WHERE id='u-secret'");
  eq(await count(), previous + 1, 'alteração só de senha continua auditada');
  eq((await latest()).data.alteracoes, [{campo:'data.senha_hash',valor_anterior:'[PROTEGIDO]',valor_novo:'[PROTEGIDO]'}], 'diff registra mudança sem revelar segredo');

  await db.query('SELECT set_config($1,$2,false)', ['app.audit_context','']);
  await save('system', 'tenant-a', { nome:'Sistema' });
  eq([(await latest()).usuario_id,(await latest()).data.origem], ['','SISTEMA'], 'execução sem request identificada como sistema');
  await db.exec("INSERT INTO tenants VALUES ('new-tenant','{}');");
  eq((await latest()).tenant_id, 'new-tenant', 'mudança no tenant usa seu próprio id');
  await db.exec("INSERT INTO saas_config VALUES ('global','{}');");
  eq([(await latest()).tenant_id,(await latest()).entidade_id], ['__platform__','global'], 'config global pertence à administração da plataforma');

  await db.query('INSERT INTO audit_log(id,tenant_id,data) VALUES ($1,$2,$3)', ['explicit','tenant-a',JSON.stringify({
    descricao:'Evento explícito', alteracoes:[{campo:'senha',valor_anterior:'segredo-antes',valor_novo:'segredo-depois'}],
  })]);
  const explicit = (await db.query("SELECT data FROM audit_log WHERE id='explicit'")).rows[0].data;
  eq(explicit.alteracoes[0], {campo:'senha',valor_anterior:'[PROTEGIDO]',valor_novo:'[PROTEGIDO]'}, 'INSERT explícito passa pelo mesmo protetor de segredos');

  const beforeReinstall = await count();
  await db.exec(AUDIT_SCHEMA_SQL);
  eq(await count(), beforeReinstall, 'reinstalação não gera registros falsos');
  const activationAgain = (await db.query("SELECT created_at FROM audit_config WHERE id='capture-v1'")).rows[0];
  eq(activationAgain.created_at, activation.created_at, 'reinstalação preserva data real de ativação');
  await save('once', 'tenant-a', { nome:'Só um' });
  eq(await count(), beforeReinstall + 1, 'reinstalação não duplica triggers');

  for (const sql of ['UPDATE audit_log SET acao=acao','DELETE FROM audit_log','TRUNCATE audit_log']) {
    await assert.rejects(db.exec(sql), /imutável/, 'histórico deve ser append-only');
    checks += 1;
  }
  eq(await count(), beforeReinstall + 1, 'proteção preserva todos os eventos');
  console.log(`${checks} verificações SQL de auditoria passaram.`);
} finally {
  await db.close();
}
