/**
 * A venda do CRM numa agência SIMPLES produz exatamente o que a versão simples
 * de `origin/main` (commit a9fd7cf) produzia (14/11/2026).
 *
 * O mesmo roteiro (scripts/roteiro-venda-crm-simples.mjs: regra de 13/11,
 * pago direto, plataforma, sem fornecedor, cartão parcelado, Cotação,
 * pagamento ao fornecedor, v2 sem o módulo, confirmação de pagamento) roda no
 * webhook de hoje, contra um Postgres real (PGlite), numa agência sem
 * módulos. O retrato (vendas, itens, contas a receber e a pagar, saldo,
 * avisos e fila ao CRM) tem de ser igual ao gravado com o código de a9fd7cf
 * em scripts/fixtures/venda-crm-simples-a9fd7cf.json.
 *
 * Depois, a mesma agência ganha o módulo "Venda completa" e a VENDA_FECHADA
 * v2 passa a entrar pelo modelo completo (prova de que o portão é o módulo).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-venda-crm-simples-congelada.mjs
 */
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { TABELAS_SQL, T1, rodar, retrato } from './roteiro-venda-crm-simples.mjs';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(TABELAS_SQL);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.fetch = async () => new Response('{}', { status: 200 });

const { processarEventoCRM, versoesDaVendaDaConta } = await import('../src/lib/crm-integration.ts');
const { esquecerModulos } = await import('../src/lib/modulos-servidor.ts');
const congelado = JSON.parse(await readFile(new URL('./fixtures/venda-crm-simples-a9fd7cf.json', import.meta.url), 'utf8'));

const acoes = await rodar(processarEventoCRM, query);
const agora = await retrato(query);

console.log('--- agência simples × versão simples de a9fd7cf ---');
eq(acoes, congelado.acoes, 'os mesmos eventos, todos processados');
for (const parte of Object.keys(congelado.retrato)) {
  const a = agora[parte];
  const b = congelado.retrato[parte];
  eq(a.length, b.length, `${parte}: a mesma quantidade (${b.length})`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) eq(a[i], b[i], `${parte}[${i}] igual`);
  }
  total++;
}
eq(agora, congelado.retrato, 'o retrato inteiro é o mesmo');
eq(await versoesDaVendaDaConta(T1), [1], 'o webhook responde versoes_venda [1] para a agência simples');
for (const tipo of ['EXTRATO_CONSOLIDADORA', 'COMISSAO_DO_MES']) {
  const r = await processarEventoCRM(tipo, { extrato_id: 'x', linhas: [{ ref: 'a', comissao: 1 }] }, `ev-${tipo}`, T1);
  eq([r.processado, r.acao], [true, `tipo desconhecido: ${tipo}`], `${tipo} na agência simples: como em a9fd7cf (evento que ela não conhece)`);
}

console.log('\n--- com o módulo "Venda completa", a v2 entra pelo modelo completo ---');
{
  await query(`UPDATE tenants SET data = '{"modulos":{"nucleo":true,"venda":true}}' WHERE id = $1`, [T1]);
  esquecerModulos();
  eq(await versoesDaVendaDaConta(T1), [1, 2], 'com o módulo de venda, versoes_venda [1, 2]');
  const r = await processarEventoCRM('VENDA_FECHADA', {
    versao_contrato: 2, crm_venda_id: 'crm_deal_v2', cliente_id: 'crm_contact_1', cliente_nome: 'Bruno Barbosa da Silva',
    valor_total: 100, custo_total: 80, data_venda: '2026-10-09', versao_venda: 2, fornecedores: [],
    venda: { produtos: [{ ref: 'p1', tipo: 'OUTROS', descricao: 'Serviço', quantidade: 1, valor_unitario: 100 }], pagamentos: [] },
  }, 'ev-v2', T1);
  // Este banco de teste não tem as tabelas do modelo completo: chegar nelas
  // (vendas_modelo) já prova que a v2 foi para o caminho da venda completa.
  // O caminho inteiro da v2 está em scripts/test-sql-crm-venda-v2-completa.mjs.
  eq(/contrato v2/.test(r.acao) || /vendas_modelo/.test(String(r.erro ?? '')), true, 'a v2 vai para o caminho da venda completa (não para o da v1)');
}

console.log(`\n${total - falhas}/${total} testes da venda do CRM congelada na versão simples passaram`);
if (falhas > 0) process.exit(1);
