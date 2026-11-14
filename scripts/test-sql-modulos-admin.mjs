/**
 * Super Admin: versão e módulos da agência e liberação para todas
 * (14/11/2026), chamando as rotas de verdade contra PGlite.
 *
 * O que se prova:
 *   (a) a ficha (PUT /api/admin/tenants/[id]) confere o pedido, grava em
 *       tenants.data sem apagar outras chaves, esvazia o cache da agência (ela
 *       vê a mudança na hora) e registra na auditoria da plataforma; o CS lê e
 *       não grava;
 *   (b) /api/admin/modulos conta as agências com cada módulo e quantas mudam;
 *       "Liberar para todas" grava saas_config, esvazia o cache de todas e
 *       registra; o CS lê e não grava;
 *   (c) de passagem: a ficha devolve stats.userCount.
 *
 * Uso: node --no-warnings scripts/test-sql-modulos-admin.mjs
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

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, nome TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '',
    plano TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE saas_config (key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE grupos (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, usuario_id TEXT, acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT,
    data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
  INSERT INTO tenants (id, slug, nome, plano, data) VALUES
    ('ag1', 'ag1', 'Boas Viagens', 'founder', '{"id":"ag1","nome":"Boas Viagens","plano":"founder","perfil":"agencia","logo":"/x.png","cnpj":"11222333000181","status":"ativo"}'),
    ('ag2', 'ag2', 'Mar Azul', 'basic', '{"id":"ag2","nome":"Mar Azul","cnpj":"","status":"ativo","modulos":{"nucleo":true}}'),
    ('ag3', 'ag3', 'Serra', 'basic', '{"id":"ag3","nome":"Serra","fin_versao":"completa"}');
  INSERT INTO usuarios (id, tenant_id) VALUES ('u1', 'ag1'), ('u2', 'ag1');
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

const SA = { userId: 'sa-bruno', nome: 'Bruno', email: 'bruno@entur.com.br', perfil: 'SUPER_ADMIN', permissoes: {}, tenantId: '__platform__', tenantSlug: '__platform__', isSuperAdmin: true, plataforma: 'SUPER_ADMIN', tv: 0 };
const CS = { userId: 'cs-carla', nome: 'Carla', email: 'carla@entur.com.br', perfil: 'CS', permissoes: {}, tenantId: '__platform__', tenantSlug: '__platform__', plataforma: 'CS', tv: 0 };
const AGENCIA = { userId: 'u1', nome: 'Ana', email: 'ana@x.com', perfil: 'ADMIN', permissoes: {}, tenantId: 'ag1', tenantSlug: 'ag1' };
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; };
const json = (url, method, corpo) => new Request('http://localhost' + url, { method, headers: { 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const ctx = id => ({ params: Promise.resolve({ id }) });

const Ficha = await import('../src/app/api/admin/tenants/[id]/route.ts');
const Modulos = await import('../src/app/api/admin/modulos/route.ts');
const { modulosDaConta, temModulo } = await import('../src/lib/modulos-servidor.ts');
const dadosDe = async id => (await query(`SELECT data FROM tenants WHERE id = $1`, [id])).rows[0].data;
const auditoria = async () => (await query(`SELECT tenant_id, entidade, entidade_id, data->>'descricao' AS d FROM audit_log ORDER BY created_at, id`)).rows;

console.log('--- (a) ficha da agência ---');
como(SA);
let r = await Ficha.GET(json('/api/admin/tenants/ag1', 'GET'), ctx('ag1'));
let d = await r.json();
eq([r.status, d.stats.userCount, d.modulos_da_conta, d.modulos_liberados], [200, 2, { versao: 'simples', ligados: [], telasCompletas: false }, []],
  'a ficha traz a contagem de usuários (stats.userCount), a versão que vale e a liberação geral');

eq((await modulosDaConta('ag1')).ligados, [], 'antes: a agência está na simples (e isso fica no cache de 30 s)');
r = await Ficha.PUT(json('/api/admin/tenants/ag1', 'PUT', { fin_versao: 'simples', modulos: { nucleo: true, cobranca: true, cheques: false } }), ctx('ag1'));
eq(r.status, 200, "super admin grava versão e módulos");
d = await dadosDe('ag1');
eq([d.fin_versao, d.modulos, d.nome, d.perfil, d.logo, d.plano], ['simples', { nucleo: true, cheques: false, cobranca: true }, 'Boas Viagens', 'agencia', '/x.png', 'founder'],
  'grava em tenants.data sem apagar as outras chaves');
eq((await modulosDaConta('ag1')).ligados, ['nucleo', 'cobranca'], 'o cache da agência esvaziou: ela vê a mudança na hora');
let a = await auditoria();
eq(a.map(x => [x.tenant_id, x.entidade, x.entidade_id, x.d]), [['__platform__', 'tenants', 'ag1',
  'Versão e módulos de Boas Viagens: Núcleo completo: padrão → ligado; Cobrança e portal do cliente: padrão → ligado; Cheques: padrão → desligado.']],
  'registrado na auditoria da plataforma (não na da agência), com o que mudou');

r = await Ficha.PUT(json('/api/admin/tenants/ag1', 'PUT', { nome: 'Boas Viagens Turismo' }), ctx('ag1'));
d = await dadosDe('ag1');
eq([r.status, d.nome, d.modulos], [200, 'Boas Viagens Turismo', { nucleo: true, cheques: false, cobranca: true }], 'editar o nome não mexe nos módulos');
eq((await auditoria()).length, 1, 'e não gera registro de módulos');

r = await Ficha.PUT(json('/api/admin/tenants/ag1', 'PUT', { modulos: { nucleo: true } }), ctx('ag1'));
eq([r.status, (await dadosDe('ag1')).modulos, (await dadosDe('ag1')).fin_versao], [200, { nucleo: true }, 'simples'],
  'só os módulos: os fora da lista voltam ao padrão, a versão fica');

for (const [corpo, msg] of [
  [{ modulos: { xyz: true } }, 'Módulo desconhecido: xyz.'],
  [{ fin_versao: 'premium' }, 'Versão inválida: use simples ou completa.'],
  [{ modulos: { nucleo: 'sim' } }, 'Escolha inválida no módulo nucleo: use ligado, desligado ou padrão.'],
  [{ modulos: ['nucleo'] }, 'Módulos inválidos.'],
]) {
  r = await Ficha.PUT(json('/api/admin/tenants/ag1', 'PUT', corpo), ctx('ag1'));
  eq([r.status, (await r.json()).error], [400, msg], `pedido inválido recusado: ${JSON.stringify(corpo)}`);
}
eq((await dadosDe('ag1')).modulos, { nucleo: true }, 'nada gravado nos pedidos recusados');

como(CS);
r = await Ficha.GET(json('/api/admin/tenants/ag1', 'GET'), ctx('ag1'));
eq([r.status, (await r.json()).modulos_da_conta.ligados], [200, ['nucleo']], 'o CS lê a ficha com os módulos');
r = await Ficha.PUT(json('/api/admin/tenants/ag1', 'PUT', { fin_versao: 'completa' }), ctx('ag1'));
eq([r.status, (await dadosDe('ag1')).fin_versao], [403, 'simples'], 'o CS não grava');
como(AGENCIA);
eq((await Ficha.PUT(json('/api/admin/tenants/ag1', 'PUT', { fin_versao: 'completa' }), ctx('ag1'))).status, 401, 'a agência não se promove');

console.log('--- (b) liberar para todas ---');
como(SA);
r = await Modulos.GET();
d = await r.json();
const linha = id => d.modulos.find(m => m.id === id);
eq([r.status, d.total_agencias, d.pode_editar], [200, 3, true], 'três agências; o super admin edita');
eq([linha('nucleo').agencias_com, linha('cobranca').agencias_com, linha('cobranca').depende], [3, 1, ['Núcleo completo']],
  'núcleo em todas (ag1 e ag2 ligaram, ag3 completa); cobrança só na completa; dependência pelo nome');
eq([linha('cobranca').mudam_se_liberar, linha('cobranca').mudam_se_retirar], [2, 0], 'liberar a cobrança muda 2 agências (as que têm o núcleo); retirar, nenhuma');

eq(await temModulo('ag2', 'cobranca'), false, 'antes: ag2 sem cobrança (no cache)');
r = await Modulos.POST(json('/api/admin/modulos', 'POST', { modulo: 'cobranca', liberar: true }));
d = await r.json();
eq([r.status, d.mudaram, d.liberados, linha('cobranca').liberado, linha('cobranca').agencias_com], [200, 2, ['cobranca'], true, 3],
  'liberada para todas: grava, devolve quantas mudaram e a contagem nova');
eq((await query(`SELECT data FROM saas_config WHERE key = 'modulos_liberados'`)).rows[0].data, { modulos: ['cobranca'] }, 'gravado em saas_config');
eq(await temModulo('ag2', 'cobranca'), true, 'o cache de todas esvaziou: ag2 tem a cobrança na hora');
a = await auditoria();
eq(a.at(-1).d, 'Liberou para todas: Cobrança e portal do cliente (2 agências mudaram).', 'registrado na auditoria da plataforma');

await Modulos.POST(json('/api/admin/modulos', 'POST', { modulo: 'cobranca', liberar: false }));
eq([await temModulo('ag2', 'cobranca'), (await query(`SELECT data FROM saas_config WHERE key = 'modulos_liberados'`)).rows[0].data],
  [false, { modulos: [] }], 'retirar de todas desfaz');
eq((await Modulos.POST(json('/api/admin/modulos', 'POST', { modulo: 'xyz', liberar: true }))).status, 400, 'módulo desconhecido: 400');

como(CS);
r = await Modulos.GET();
eq([r.status, (await r.json()).pode_editar], [200, false], 'o CS consulta os módulos');
eq((await Modulos.POST(json('/api/admin/modulos', 'POST', { modulo: 'cobranca', liberar: true }))).status, 403, 'o CS não libera');
como(AGENCIA);
eq((await Modulos.GET()).status, 401, 'a agência não abre a tela da plataforma');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
