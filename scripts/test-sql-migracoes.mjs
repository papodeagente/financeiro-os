/**
 * Testa as MIGRAÇÕES da auditoria de 2026-09-06 contra um Postgres real
 * (PGlite, Postgres compilado em WASM — sem servidor externo).
 *
 * Por que este arquivo existe: initDB roda a cada request. Uma migração com
 * SQL inválido, ou um CREATE UNIQUE INDEX que estoura num banco que já tem
 * duplicatas, derrubaria a aplicação inteira em vez de sinalizar o problema.
 * Aqui provamos que:
 *   1. o SQL é válido;
 *   2. a chave natural realmente barra a duplicata de parcela;
 *   3. lançamento manual continua livre;
 *   4. banco com duplicata preexistente NÃO quebra (o DO/EXCEPTION segura);
 *   5. a PK composta permite uma linha por tenant.
 *
 * Uso: node --no-warnings scripts/test-sql-migracoes.mjs
 */
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

// ── DDL copiado de src/lib/db.ts (bloco da auditoria) ──────────────────
const DDL_CHAVE_NATURAL_CR = `
  DO $$
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_receber_venda_parcela
      ON contas_receber (
        tenant_id,
        (data->>'origem_venda_id'),
        (data->>'origem_item_id'),
        (data->>'parcela_numero')
      )
      WHERE data->>'auto_gerado' = 'true'
        AND COALESCE(data->>'origem_venda_id', '') <> ''
        AND COALESCE(data->>'status', '') <> 'CANCELADO';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'chave natural nao criada: %', SQLERRM;
  END
  $$;
`;

const criarTabelas = `
  CREATE TABLE contas_receber (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '',
    venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '', status TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE config_apis (
    id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

const inserirCR = (pg, id, tenant, data) =>
  pg.query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1,$2,$3,$4)`,
    [id, tenant, data.status ?? '', JSON.stringify(data)]);

const parcelaAuto = (over = {}) => ({
  origem_venda_id: 'venda-1',
  origem_item_id: '',
  parcela_numero: 1,
  auto_gerado: 'true',
  status: 'PENDENTE',
  valor_final: 1000,
  ...over,
});

// ══════════════════════════════════════════════════════════════════════
console.log('--- chave natural barra a parcela duplicada ---');
{
  const pg = new PGlite();
  await pg.exec(criarTabelas);
  await pg.exec(DDL_CHAVE_NATURAL_CR);

  await inserirCR(pg, 'cr1', 't1', parcelaAuto());
  let erro = null;
  try {
    await inserirCR(pg, 'cr2', 't1', parcelaAuto());
  } catch (e) { erro = String(e.message || e); }
  eq(erro !== null, true, 'segunda parcela 1 da mesma venda é recusada pelo banco');

  const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM contas_receber`);
  eq(rows[0].n, 1, 'só uma linha sobrevive');

  // Parcelas diferentes da mesma venda convivem.
  await inserirCR(pg, 'cr3', 't1', parcelaAuto({ parcela_numero: 2 }));
  await inserirCR(pg, 'cr4', 't1', parcelaAuto({ parcela_numero: 3 }));
  const { rows: r2 } = await pg.query(`SELECT COUNT(*)::int AS n FROM contas_receber`);
  eq(r2[0].n, 3, 'parcelas 2 e 3 entram normalmente');

  // Outro tenant com a mesma venda e parcela não colide.
  await inserirCR(pg, 'cr5', 't2', parcelaAuto());
  const { rows: r3 } = await pg.query(`SELECT COUNT(*)::int AS n FROM contas_receber WHERE tenant_id = 't2'`);
  eq(r3[0].n, 1, 'tenants diferentes não colidem entre si');

  // Item de venda distinto na mesma parcela também convive (fluxo próprio
  // gera uma conta por item).
  await inserirCR(pg, 'cr6', 't1', parcelaAuto({ origem_item_id: 'item-a' }));
  await inserirCR(pg, 'cr7', 't1', parcelaAuto({ origem_item_id: 'item-b' }));
  const { rows: r4 } = await pg.query(`SELECT COUNT(*)::int AS n FROM contas_receber WHERE tenant_id = 't1'`);
  eq(r4[0].n, 5, 'contas de itens diferentes convivem');
}

console.log('--- o índice não engessa o uso legítimo ---');
{
  const pg = new PGlite();
  await pg.exec(criarTabelas);
  await pg.exec(DDL_CHAVE_NATURAL_CR);

  // Lançamento manual (sem auto_gerado) fica fora do índice parcial.
  await inserirCR(pg, 'm1', 't1', { descricao: 'Taxa de emissão', valor_final: 350, status: 'PENDENTE' });
  await inserirCR(pg, 'm2', 't1', { descricao: 'Taxa de emissão', valor_final: 350, status: 'PENDENTE' });
  const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM contas_receber`);
  eq(rows[0].n, 2, 'duas contas manuais iguais são permitidas');

  // Cancelar libera o espaço: a venda pode gerar a parcela de novo.
  await inserirCR(pg, 'a1', 't1', parcelaAuto({ status: 'CANCELADO' }));
  await inserirCR(pg, 'a2', 't1', parcelaAuto({ status: 'PENDENTE' }));
  const { rows: r2 } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM contas_receber WHERE data->>'origem_venda_id' = 'venda-1'`);
  eq(r2[0].n, 2, 'parcela cancelada e a nova convivem (histórico preservado)');
}

console.log('--- banco com duplicata preexistente NÃO derruba o app ---');
{
  // Este é o teste que protege a produção: se a agência já tem duplicatas,
  // o CREATE UNIQUE INDEX falha. Sem o DO/EXCEPTION, initDB lançaria a cada
  // request e o sistema inteiro ficaria fora do ar.
  const pg = new PGlite();
  await pg.exec(criarTabelas);
  await inserirCR(pg, 'd1', 't1', parcelaAuto());
  await inserirCR(pg, 'd2', 't1', parcelaAuto());   // duplicata já existente

  let erro = null;
  try {
    await pg.exec(DDL_CHAVE_NATURAL_CR);
  } catch (e) { erro = String(e.message || e); }
  eq(erro, null, 'migração não lança em banco com duplicata');

  const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM contas_receber`);
  eq(rows[0].n, 2, 'as duplicatas continuam lá para serem tratadas à mão');

  const { rows: idx } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_contas_receber_venda_parcela'`);
  eq(idx[0].n, 0, 'o índice não foi criado, e o app segue de pé');
}

console.log('--- PK composta: uma linha de config por tenant ---');
{
  const pg = new PGlite();
  await pg.exec(criarTabelas);
  await pg.exec(`ALTER TABLE config_apis ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`);

  // Estado ANTIGO: PK só em id, id constante. Uma linha no banco inteiro.
  await pg.query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ($1,$2,$3)`,
    ['apis-config-singleton', 't1', JSON.stringify({ chave: 'do tenant 1' })]);
  let erro = null;
  try {
    await pg.query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ($1,$2,$3)`,
      ['apis-config-singleton', 't2', JSON.stringify({ chave: 'do tenant 2' })]);
  } catch (e) { erro = String(e.message || e); }
  eq(erro !== null, true, 'antes da migração, o segundo tenant não conseguia ter linha própria');

  // Migração para PK composta (mesmo SQL de db.ts).
  await pg.exec(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'config_apis'::regclass
          AND contype = 'p'
          AND pg_get_constraintdef(oid) NOT LIKE '%tenant_id%'
      ) THEN
        ALTER TABLE config_apis DROP CONSTRAINT config_apis_pkey;
        ALTER TABLE config_apis ADD PRIMARY KEY (id, tenant_id);
      END IF;
    END
    $$;
  `);

  await pg.query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ($1,$2,$3)`,
    ['apis-config-singleton', 't2', JSON.stringify({ chave: 'do tenant 2' })]);

  const { rows } = await pg.query(`SELECT tenant_id, data->>'chave' AS chave FROM config_apis ORDER BY tenant_id`);
  eq(rows.map(r => [r.tenant_id, r.chave]),
    [['t1', 'do tenant 1'], ['t2', 'do tenant 2']],
    'cada tenant passa a ter a própria linha, sem sobrescrever a do outro');

  // O upsert por (id, tenant_id) atualiza só a linha do próprio tenant.
  await pg.query(
    `INSERT INTO config_apis (id, tenant_id, data, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (id, tenant_id) DO UPDATE SET data = $3, updated_at = NOW()`,
    ['apis-config-singleton', 't2', JSON.stringify({ chave: 'trocada pelo 2' })]);
  const { rows: r2 } = await pg.query(`SELECT tenant_id, data->>'chave' AS chave FROM config_apis ORDER BY tenant_id`);
  eq(r2.map(r => [r.tenant_id, r.chave]),
    [['t1', 'do tenant 1'], ['t2', 'trocada pelo 2']],
    'salvar num tenant não toca no outro');

  // Rodar a migração de novo é inofensivo.
  let erro2 = null;
  try {
    await pg.exec(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'config_apis'::regclass
            AND contype = 'p'
            AND pg_get_constraintdef(oid) NOT LIKE '%tenant_id%'
        ) THEN
          ALTER TABLE config_apis DROP CONSTRAINT config_apis_pkey;
          ALTER TABLE config_apis ADD PRIMARY KEY (id, tenant_id);
        END IF;
      END
      $$;
    `);
  } catch (e) { erro2 = String(e.message || e); }
  eq(erro2, null, 'migração é idempotente (initDB roda a cada request)');
}

console.log('--- guarda de tenant no upsert ---');
{
  const pg = new PGlite();
  await pg.exec(criarTabelas);

  // O id vem do corpo da requisição. Sem a guarda, o tenant 2 sobrescreve a
  // linha do tenant 1 e o dono passa a ver dados alheios como próprios.
  await inserirCR(pg, 'venda-alheia', 't1', { descricao: 'do tenant 1', valor_final: 1000 });

  await pg.query(
    `INSERT INTO contas_receber (id, tenant_id, data) VALUES ($1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET data = $3
     WHERE contas_receber.tenant_id = EXCLUDED.tenant_id`,
    ['venda-alheia', 't2', JSON.stringify({ descricao: 'invadida', valor_final: 999999 })]);

  const { rows } = await pg.query(`SELECT tenant_id, data->>'descricao' AS d FROM contas_receber WHERE id = 'venda-alheia'`);
  eq(rows.map(r => [r.tenant_id, r.d]), [['t1', 'do tenant 1']], 'a guarda impede a sobrescrita entre tenants');

  // O próprio dono continua conseguindo atualizar.
  await pg.query(
    `INSERT INTO contas_receber (id, tenant_id, data) VALUES ($1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET data = $3
     WHERE contas_receber.tenant_id = EXCLUDED.tenant_id`,
    ['venda-alheia', 't1', JSON.stringify({ descricao: 'atualizada pelo dono', valor_final: 1200 })]);
  const { rows: r2 } = await pg.query(`SELECT data->>'descricao' AS d FROM contas_receber WHERE id = 'venda-alheia'`);
  eq(r2[0].d, 'atualizada pelo dono', 'o dono atualiza normalmente');
}

console.log(`\n${total - falhas}/${total} testes de migração passaram`);
if (falhas > 0) process.exit(1);
