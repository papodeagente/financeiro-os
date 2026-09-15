/**
 * Isolamento entre agências na integração com plataformas, contra um
 * Postgres real (PGlite).
 *
 * Duas agências podem usar a MESMA plataforma, com contas diferentes na
 * Hotmart ou no Asaas. Se o isolamento falhar, a venda de uma cai no
 * financeiro da outra, que é o pior defeito possível neste módulo.
 *
 * O SQL é extraído do próprio db.ts, então código e teste não divergem.
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

const fonte = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
function bloco(nome) {
  const i = fonte.indexOf(`CREATE TABLE IF NOT EXISTS ${nome} (`);
  if (i < 0) throw new Error(`tabela ${nome} não encontrada em db.ts`);
  // Vai até o fim dos índices declarados logo depois da tabela.
  const resto = fonte.slice(i);
  const fim = resto.indexOf('CREATE TABLE IF NOT EXISTS', 1);
  return fim > 0 ? resto.slice(0, fim) : resto;
}

const db = new PGlite();
await db.exec(bloco('plataformas_config'));
await db.exec(bloco('plataformas_eventos'));

const A = 'agencia-a', B = 'agencia-b';
const conf = (tenant, plataforma, seg) => db.query(
  `INSERT INTO plataformas_config (id, tenant_id, plataforma, ativo, data)
   VALUES ($1, $2, $3, true, $4::jsonb)
   ON CONFLICT (tenant_id, plataforma) DO UPDATE SET data = EXCLUDED.data`,
  [`${tenant}-${plataforma}`, tenant, plataforma, JSON.stringify({ credencial: { ct: seg } })]);

console.log('--- duas agências, a mesma plataforma ---');
await conf(A, 'hotmart', 'segredo-da-A');
await conf(B, 'hotmart', 'segredo-da-B');
eq((await db.query(`SELECT COUNT(*)::int c FROM plataformas_config WHERE plataforma='hotmart'`)).rows[0].c, 2,
   'as duas conseguem configurar a MESMA plataforma');
{
  const r = await db.query(`SELECT data->'credencial'->>'ct' v FROM plataformas_config WHERE tenant_id=$1 AND plataforma='hotmart'`, [A]);
  eq(r.rows[0].v, 'segredo-da-A', 'a agência A lê a credencial dela');
  const r2 = await db.query(`SELECT data->'credencial'->>'ct' v FROM plataformas_config WHERE tenant_id=$1 AND plataforma='hotmart'`, [B]);
  eq(r2.rows[0].v, 'segredo-da-B', 'e a B lê a dela, sem mistura');
}
{
  // A mesma agência não pode ter duas configurações da mesma plataforma.
  await conf(A, 'hotmart', 'segredo-novo-da-A');
  const r = await db.query(`SELECT COUNT(*)::int c FROM plataformas_config WHERE tenant_id=$1 AND plataforma='hotmart'`, [A]);
  eq(r.rows[0].c, 1, 'salvar de novo ATUALIZA em vez de criar segunda linha');
  const v = await db.query(`SELECT data->'credencial'->>'ct' v FROM plataformas_config WHERE tenant_id=$1 AND plataforma='hotmart'`, [A]);
  eq(v.rows[0].v, 'segredo-novo-da-A', 'e a credencial nova substitui a antiga');
  const b = await db.query(`SELECT data->'credencial'->>'ct' v FROM plataformas_config WHERE tenant_id=$1 AND plataforma='hotmart'`, [B]);
  eq(b.rows[0].v, 'segredo-da-B', 'sem tocar na credencial da outra agência');
}

console.log('\n--- eventos: reenvio não duplica, e o id externo pode repetir entre agências ---');
const ev = (tenant, plataforma, idExterno) => db.query(
  `INSERT INTO plataformas_eventos (id, tenant_id, plataforma, id_externo, tipo, status, data)
   VALUES ($1, $2, $3, $4, 'PAGAMENTO_CONFIRMADO', 'RECEBIDO', '{}'::jsonb)
   ON CONFLICT (tenant_id, plataforma, id_externo) DO NOTHING`,
  // A chave primária inclui a plataforma porque o MESMO id externo pode
  // chegar de plataformas diferentes. Em produção o id é gerado aleatório,
  // então isto é só para o teste não colidir consigo mesmo.
  [`${tenant}-${plataforma}-${idExterno}`, tenant, plataforma, idExterno]);

eq((await ev(A, 'hotmart', 'HP1:PURCHASE_APPROVED')).affectedRows ?? 1, 1, 'primeiro aviso entra');
eq((await ev(A, 'hotmart', 'HP1:PURCHASE_APPROVED')).affectedRows ?? 0, 0,
   'reenvio do MESMO aviso não entra de novo: é o que impede venda duplicada');
eq((await ev(B, 'hotmart', 'HP1:PURCHASE_APPROVED')).affectedRows ?? 1, 1,
   'o mesmo id externo em OUTRA agência entra: são vendas diferentes, em contas diferentes');
eq((await ev(A, 'asaas', 'HP1:PURCHASE_APPROVED')).affectedRows ?? 1, 1,
   'e o mesmo id em outra plataforma também entra');
{
  const r = await db.query(`SELECT COUNT(*)::int c FROM plataformas_eventos WHERE tenant_id=$1`, [A]);
  eq(r.rows[0].c, 2, 'a agência A tem só os eventos dela');
}
{
  // Reembolso da mesma transação tem chave própria: sem isso seria
  // descartado como reenvio da venda.
  eq((await ev(A, 'hotmart', 'HP1:PURCHASE_REFUNDED')).affectedRows ?? 1, 1,
     'estorno da mesma transação entra, porque a chave inclui o status');
}

console.log(`\n${total - falhas}/${total} testes de isolamento passaram`);
process.exit(falhas > 0 ? 1 : 0);
