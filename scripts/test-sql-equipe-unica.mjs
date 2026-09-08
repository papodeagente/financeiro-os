/**
 * Absorção do cadastro antigo `membros` dentro de `usuarios`, contra um
 * Postgres real (PGlite).
 *
 * Por que existe: o time real do sistema vive em `usuarios`, mas comissão
 * e metas liam um cadastro paralelo em `membros`. As duas listas nunca se
 * encontravam — a tela de comissões oferecia um vendedor que não era
 * ninguém do time. Esta migração funde as duas e roda a cada initDB, então
 * precisa ser idempotente e nunca sobrescrever escolha humana.
 *
 * Uso: node --no-warnings scripts/test-sql-equipe-unica.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

// Extrai o SQL do PRÓPRIO db.ts: se alguém editar a migração e não o teste,
// o teste testa a versão nova, e não uma cópia que envelheceu em silêncio.
const fonte = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const bloco = fonte.split('MIGRACAO_EQUIPE_UNICA_INICIO')[1].split('MIGRACAO_EQUIPE_UNICA_FIM')[0];
const MIGRACAO = bloco.slice(bloco.indexOf('`') + 1, bloco.lastIndexOf('`'));
if (!MIGRACAO.includes('membro_ids_legado')) {
  console.log('FAIL  não consegui extrair a migração de src/lib/db.ts');
  process.exit(1);
}
const db = new PGlite();

await db.exec(`
  CREATE TABLE usuarios (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE membros (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);

const T1 = 'ag-1', T2 = 'ag-2';
const u = (id, nome, email, tenant, extra = {}) => db.query(
  `INSERT INTO usuarios (id,nome,email,data,tenant_id) VALUES ($1,$2,$3,$4,$5)`,
  [id, nome, email, JSON.stringify({ id, nome, email, plano_comissao_id: '', meta_mensal_vendas: 0, meta_mensal_quantidade: 0, membro_ids_legado: [], ...extra }), tenant]);
const m = (id, nome, email, tenant, extra = {}) => db.query(
  `INSERT INTO membros (id,nome,cargo,email,data,tenant_id) VALUES ($1,$2,'vendedor',$3,$4,$5)`,
  [id, nome, email, JSON.stringify({ id, nome, email, plano_comissao_id: '', meta_mensal_vendas: 0, meta_mensal_quantidade: 0, ...extra }), tenant]);
const ler = async id => (await db.query(`SELECT data FROM usuarios WHERE id=$1`, [id])).rows[0].data;

// Karen tem ficha antiga com plano e meta; o usuário está zerado.
await u('user-karen', 'Karen Vendedor', 'karen@entur.com.br', T1);
await m('memb-karen', 'Karen', 'KAREN@entur.com.br ', T1, { plano_comissao_id: 'plano-ouro', meta_mensal_vendas: 50000, meta_mensal_quantidade: 12 });
// Luan já tem plano escolhido na tela nova; a ficha antiga diz outra coisa.
await u('user-luan', 'Luan Amador', 'luan@entur.com.br', T1, { plano_comissao_id: 'plano-novo', meta_mensal_vendas: 30000 });
await m('memb-luan', 'Luan', 'luan@entur.com.br', T1, { plano_comissao_id: 'plano-velho', meta_mensal_vendas: 99999 });
// Viviane só existe no cadastro antigo: não há usuário para receber.
await m('memb-viviane', 'Viviane Assis', 'viviane@entur.com.br', T1, { plano_comissao_id: 'plano-ouro' });
// Homônima em outra agência: não pode atravessar tenant.
await u('user-karen-t2', 'Karen Outra', 'karen@entur.com.br', T2);

await db.exec(MIGRACAO);

console.log('--- absorção ---');
const karen = await ler('user-karen');
eq([karen.plano_comissao_id, Number(karen.meta_mensal_vendas), Number(karen.meta_mensal_quantidade)],
   ['plano-ouro', 50000, 12], 'plano e metas da ficha antiga entram no usuário vazio');
eq(karen.membro_ids_legado, ['memb-karen'], 'guarda o id antigo para venda histórica resolver');

const luan = await ler('user-luan');
eq([luan.plano_comissao_id, Number(luan.meta_mensal_vendas)], ['plano-novo', 30000],
   'escolha já feita no usuário NÃO é sobrescrita pela ficha antiga');
eq(luan.membro_ids_legado, ['memb-luan'], 'mas o id antigo é guardado mesmo assim');

console.log('\n--- isolamento por tenant ---');
const karenT2 = await ler('user-karen-t2');
eq([karenT2.plano_comissao_id, karenT2.membro_ids_legado], ['', []],
   'homônima de outra agência não recebe nada');

console.log('\n--- idempotência (initDB roda a cada request) ---');
await db.exec(MIGRACAO);
await db.exec(MIGRACAO);
const karen3 = await ler('user-karen');
eq(karen3.membro_ids_legado, ['memb-karen'], 'rodar três vezes não duplica o id legado');
eq([karen3.plano_comissao_id, Number(karen3.meta_mensal_vendas)], ['plano-ouro', 50000],
   'rodar de novo não muda valor já absorvido');

console.log('\n--- órfão do cadastro antigo ---');
const orfaos = await db.query(`
  SELECT m.id, m.nome FROM membros m
   WHERE m.tenant_id = $1
     AND NOT EXISTS (SELECT 1 FROM usuarios u
                      WHERE u.tenant_id = m.tenant_id
                        AND u.data->'membro_ids_legado' ? m.id)
   ORDER BY m.nome`, [T1]);
eq(orfaos.rows.map(r => r.nome), ['Viviane Assis'],
   'quem não tem usuário fica visível como órfão, não some calado');

console.log(`\n${total - falhas}/${total} testes da equipe única passaram`);
process.exit(falhas > 0 ? 1 : 0);
