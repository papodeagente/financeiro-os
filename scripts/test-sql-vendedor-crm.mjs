/**
 * Testa a ponte entre o usuário do CRM e o membro da equipe que carrega o
 * plano de comissão, contra um Postgres real (PGlite, Postgres em WASM).
 *
 * Por que este arquivo existe: antes desta correção, a venda vinda do CRM
 * gravava vendedor_id apontando para `usuarios`, e o motor de comissão
 * procurava esse id em `membros`. Tabelas diferentes, espaços de id
 * diferentes: nenhuma venda do CRM gerava comissão. Aqui provamos que:
 *   1. reenviar o mesmo evento não duplica usuário (idempotência);
 *   2. nome e email mudados no CRM chegam ao financeiro (sincronização);
 *   3. quem já existia por email é adotado, não duplicado;
 *   4. o vínculo automático por email liga usuário ao membro certo;
 *   5. vínculo escolhido à mão nunca é sobrescrito pela sincronização;
 *   6. um usuário nunca paga comissão para dois membros;
 *   7. a fila de pendentes mostra exatamente quem vendeu e não tem vínculo;
 *   8. o isolamento por tenant vale em todas as etapas.
 *
 * Uso: node --no-warnings scripts/test-sql-vendedor-crm.mjs
 */
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const db = new PGlite();

await db.exec(`
  CREATE TABLE usuarios (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX idx_usuarios_external_id
    ON usuarios(tenant_id, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
  CREATE TABLE membros (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE vendas_crm (
    id TEXT PRIMARY KEY, cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

const norm = v => String(v ?? '').trim().toLowerCase();
let seq = 0;
const novoId = () => `id${++seq}`;

// ── Réplica fiel de vincularMembroPorEmail (crm-integration.ts) ────────
async function vincularMembroPorEmail(usuarioId, email, tenantId) {
  if (!email) return;
  const { rows } = await db.query(
    `SELECT id FROM membros
      WHERE tenant_id = $1 AND LOWER(TRIM(email)) = $2
        AND COALESCE(data->>'usuario_id', '') = ''
      ORDER BY created_at ASC LIMIT 1`, [tenantId, email]);
  if (rows.length === 0) return;
  const ja = await db.query(
    `SELECT 1 FROM membros WHERE tenant_id = $1 AND data->>'usuario_id' = $2 LIMIT 1`,
    [tenantId, usuarioId]);
  if (ja.rows.length > 0) return;
  await db.query(
    `UPDATE membros SET data = jsonb_set(data, '{usuario_id}', to_jsonb($1::text), true),
            updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [usuarioId, rows[0].id, tenantId]);
}

// ── Réplica fiel de upsertVendedorByExternalId ────────────────────────
async function upsertVendedor(externalId, dados, tenantId) {
  const nome = String(dados.nome ?? '');
  const email = norm(dados.email);

  const byExt = await db.query(
    `SELECT id, data FROM usuarios WHERE external_id = $1 AND tenant_id = $2 LIMIT 1`,
    [externalId, tenantId]);
  if (byExt.rows.length > 0) {
    const id = byExt.rows[0].id;
    const atual = byExt.rows[0].data ?? {};
    const mudou = (nome && String(atual.nome ?? '') !== nome) || (email && norm(atual.email) !== email);
    if (mudou) {
      const data = { ...atual, id, nome: nome || String(atual.nome ?? ''), email: email || norm(atual.email), origem: 'crm', external_id: externalId };
      await db.query(
        `UPDATE usuarios SET nome=$1, email=$2, data=$3, updated_at=NOW() WHERE id=$4 AND tenant_id=$5`,
        [data.nome, data.email, JSON.stringify(data), id, tenantId]);
    }
    await vincularMembroPorEmail(id, email || norm(atual.email), tenantId);
    return id;
  }

  if (email) {
    const byEmail = await db.query(
      `SELECT id, data FROM usuarios
        WHERE tenant_id = $1 AND LOWER(TRIM(email)) = $2 AND COALESCE(external_id,'') = ''
        ORDER BY created_at ASC LIMIT 1`, [tenantId, email]);
    if (byEmail.rows.length > 0) {
      const id = byEmail.rows[0].id;
      const atual = byEmail.rows[0].data ?? {};
      const data = { ...atual, id, nome: nome || String(atual.nome ?? ''), email, external_id: externalId };
      await db.query(
        `UPDATE usuarios SET nome=$1, email=$2, data=$3, external_id=$4, updated_at=NOW() WHERE id=$5 AND tenant_id=$6`,
        [data.nome, email, JSON.stringify(data), externalId, id, tenantId]);
      await vincularMembroPorEmail(id, email, tenantId);
      return id;
    }
  }

  const id = novoId();
  const data = { id, nome, email, origem: 'crm', external_id: externalId, ativo: true };
  await db.query(
    `INSERT INTO usuarios (id, nome, email, data, external_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, email=EXCLUDED.email,
        data=EXCLUDED.data, external_id=EXCLUDED.external_id, updated_at=NOW()
      WHERE usuarios.tenant_id = EXCLUDED.tenant_id`,
    [id, nome, email, JSON.stringify(data), externalId, tenantId]);
  await vincularMembroPorEmail(id, email, tenantId);
  return id;
}

async function criarMembro(id, nome, email, tenantId, extra = {}) {
  const data = { id, nome, email, cargo: 'vendedor', plano_comissao_id: '', usuario_id: '', status: 'ATIVO', ...extra };
  await db.query(
    `INSERT INTO membros (id, nome, cargo, email, data, tenant_id) VALUES ($1,$2,'vendedor',$3,$4,$5)`,
    [id, nome, email, JSON.stringify(data), tenantId]);
}

const T1 = 'tenant-a', T2 = 'tenant-b';

console.log('--- sincronização do usuário do CRM ---');

const u1 = await upsertVendedor('crm_user_10', { nome: 'Ana Souza', email: 'ana@ag.com' }, T1);
eq((await db.query(`SELECT COUNT(*)::int c FROM usuarios WHERE tenant_id=$1`, [T1])).rows[0].c, 1,
   'primeiro evento cria o usuário');

const u1b = await upsertVendedor('crm_user_10', { nome: 'Ana Souza', email: 'ana@ag.com' }, T1);
eq([u1b === u1, (await db.query(`SELECT COUNT(*)::int c FROM usuarios WHERE tenant_id=$1`, [T1])).rows[0].c], [true, 1],
   'reenviar o mesmo evento não duplica (idempotente)');

await upsertVendedor('crm_user_10', { nome: 'Ana Souza Lima', email: 'ana.lima@ag.com' }, T1);
const depois = (await db.query(`SELECT nome, email FROM usuarios WHERE id=$1`, [u1])).rows[0];
eq([depois.nome, depois.email], ['Ana Souza Lima', 'ana.lima@ag.com'],
   'nome e email mudados no CRM chegam ao financeiro');

console.log('\n--- adoção de quem já existia ---');

await db.query(`INSERT INTO usuarios (id, nome, email, data, tenant_id) VALUES ('local1','Bruno Dias','bruno@ag.com','{"id":"local1","nome":"Bruno Dias","email":"bruno@ag.com"}',$1)`, [T1]);
const u2 = await upsertVendedor('crm_user_20', { nome: 'Bruno Dias', email: 'bruno@ag.com' }, T1);
eq([u2, (await db.query(`SELECT external_id FROM usuarios WHERE id='local1'`)).rows[0].external_id],
   ['local1', 'crm_user_20'],
   'usuário que já existia por email é adotado, não duplicado');

console.log('\n--- vínculo com o membro que carrega o plano ---');

await criarMembro('m1', 'Carla Reis', 'carla@ag.com', T1, { plano_comissao_id: 'plano-ouro' });
const u3 = await upsertVendedor('crm_user_30', { nome: 'Carla Reis', email: 'CARLA@AG.COM' }, T1);
eq((await db.query(`SELECT data->>'usuario_id' v FROM membros WHERE id='m1'`)).rows[0].v, u3,
   'vínculo automático liga por email, ignorando maiúscula e espaço');

await criarMembro('m2', 'Diego Alves', 'diego@ag.com', T1, { usuario_id: 'escolhido-a-mao' });
await upsertVendedor('crm_user_40', { nome: 'Diego Alves', email: 'diego@ag.com' }, T1);
eq((await db.query(`SELECT data->>'usuario_id' v FROM membros WHERE id='m2'`)).rows[0].v, 'escolhido-a-mao',
   'vínculo escolhido à mão nunca é sobrescrito pela sincronização');

await criarMembro('m3', 'Carla Reis (2a ficha)', 'carla@ag.com', T1);
await upsertVendedor('crm_user_30', { nome: 'Carla Reis', email: 'carla@ag.com' }, T1);
eq((await db.query(`SELECT COUNT(*)::int c FROM membros WHERE tenant_id=$1 AND data->>'usuario_id'=$2`, [T1, u3])).rows[0].c, 1,
   'um usuário nunca paga comissão para dois membros');

console.log('\n--- isolamento por tenant ---');

await criarMembro('m9', 'Carla Reis', 'carla@ag.com', T2);
const u4 = await upsertVendedor('crm_user_30', { nome: 'Carla Reis', email: 'carla@ag.com' }, T2);
eq(u4 === u3, false, 'mesmo external_id em outro tenant cria usuário próprio');
eq((await db.query(`SELECT data->>'usuario_id' v FROM membros WHERE id='m9'`)).rows[0].v, u4,
   'o vínculo do tenant B aponta para o usuário do tenant B');
eq((await db.query(`SELECT data->>'usuario_id' v FROM membros WHERE id='m1'`)).rows[0].v, u3,
   'sincronizar no tenant B não mexe no vínculo do tenant A');

console.log('\n--- fila de quem vendeu e não tem vínculo ---');

// Élio vende pelo CRM e não tem ficha de membro nenhuma.
const u5 = await upsertVendedor('crm_user_50', { nome: 'Élio Matos', email: 'elio@ag.com' }, T1);
await db.query(`INSERT INTO vendas_crm (id, vendedor_id, status, data, tenant_id)
  VALUES ('v1',$1,'CONFIRMADO','{"valor_total":1500.5,"data_venda":"2026-09-01"}',$2),
         ('v2',$1,'CONFIRMADO','{"valor_total":"nao-numerico","data_venda":"2026-09-02"}',$2)`, [u5, T1]);
// Carla vende e JÁ tem vínculo: não pode aparecer na fila.
await db.query(`INSERT INTO vendas_crm (id, vendedor_id, status, data, tenant_id)
  VALUES ('v3',$1,'CONFIRMADO','{"valor_total":900,"data_venda":"2026-09-03"}',$2)`, [u3, T1]);

const fila = await db.query(`
  SELECT u.id, u.data->>'nome' nome, COUNT(v.id)::int vendas,
         COALESCE(SUM(CASE WHEN v.data->>'valor_total' ~ '^-?[0-9]+(\\.[0-9]+)?$'
                           THEN (v.data->>'valor_total')::numeric ELSE 0 END), 0)::float valor
    FROM usuarios u
    JOIN vendas_crm v ON v.vendedor_id = u.id AND v.tenant_id = u.tenant_id
   WHERE u.tenant_id = $1
     AND NOT EXISTS (SELECT 1 FROM membros m WHERE m.tenant_id = u.tenant_id AND m.data->>'usuario_id' = u.id)
   GROUP BY u.id, u.data->>'nome' ORDER BY COUNT(v.id) DESC`, [T1]);

eq(fila.rows.map(r => r.nome), ['Élio Matos'],
   'a fila mostra só quem vendeu e não tem membro vinculado');
eq(fila.rows[0].vendas, 2, 'conta todas as vendas da pessoa');
eq(fila.rows[0].valor, 1500.5, 'valor não numérico não derruba a soma, entra como zero');

console.log(`\n${total - falhas}/${total} testes do vendedor do CRM passaram`);
process.exit(falhas > 0 ? 1 : 0);
