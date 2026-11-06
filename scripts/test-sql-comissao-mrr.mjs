/**
 * Comissão por MRR contra um Postgres real (PGlite, pool trocado por
 * scripts/db-de-teste-hook.mjs). Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (a) o perfil da conta: só a marcada como ecossistema passa na trava;
 *   (b) metas: gravar, editar, produto em duas metas barrado, vendedor de
 *       outra empresa descartado, meta de outra empresa intocável, copiar mês;
 *   (c) gerar: uma comissão por vendedor e mês, com UMA conta a pagar (a do
 *       gancho), descrita como comissão por MRR e sem apontar para venda;
 *   (d) gerar de novo: igual não muda nada; calculada é regravada; aprovada
 *       com valor diferente não é reescrita e avisa; zerada é cancelada com a
 *       conta; quem sumiu da apuração tem a linha zerada;
 *   (e) uma empresa nunca enxerga nem grava a meta ou a comissão da outra;
 *   (f) D31 (05/11/2026): com a comissão vindo do CRM (o padrão da conta),
 *       gerar por faixas recusa sem gravar nada. Os cenários (c) e (d) rodam
 *       com a fonte trocada para "mrr" (tenants.data.fonte_da_comissao).
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-comissao-mrr.mjs
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
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', external_id TEXT, tenant_id TEXT, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE planos_comissao (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', tenant_id TEXT, data JSONB NOT NULL);
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, tenant_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE metas_mrr (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, mes TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE agencia (id TEXT PRIMARY KEY, tenant_id TEXT, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT, codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT, fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const exec = { query };
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { perfilDaConta, exigirEcossistema } = await import('../src/lib/perfil-da-conta.ts');
const { gravarMetaMrr, listarMetasMrr, apagarMetaMrr, copiarMetasDoMes, apurarMes, gerarComissoesMrr } = await import('../src/lib/comissao-mrr-servidor.ts');

const ENTUR = 't-entur', AGENCIA = 't-agencia', MES = '2026-11';
await query(`INSERT INTO tenants (id, numero, data) VALUES ($1, 1, '{"perfil":"ecossistema","fonte_da_comissao":"mrr"}'), ($2, 2, '{}')`, [ENTUR, AGENCIA]);
for (const [id, tenant, nome, email, ext, plano] of [
  ['u-karen', ENTUR, 'Karen', 'karen@entur.com.br', 'crm_user_7', 'p-mrr'],
  ['u-joao', ENTUR, 'João', 'joao@entur.com.br', 'crm_user_8', 'p-mrr'],
  ['u-outra', AGENCIA, 'Vendedora da agência', 'v@agencia.com', 'crm_user_7', 'p-ag'],
]) {
  await query(`INSERT INTO usuarios (id, nome, email, external_id, tenant_id, data) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [id, nome, email, ext, tenant, JSON.stringify({ id, nome, email, perfil: 'VENDEDOR', plano_comissao_id: plano })]);
}
const FAIXAS = [{ ate_pct: 70, percentual: 20 }, { ate_pct: 100, percentual: 40 }, { ate_pct: null, percentual: 60 }];
await query(`INSERT INTO planos_comissao (id, nome, tenant_id, data) VALUES ('p-mrr', 'SDR MRR', $1, $2::jsonb)`, [ENTUR, JSON.stringify({ id: 'p-mrr', nome: 'SDR MRR', ativo: true, base_calculo: 'MRR_GERADO', mrr: { faixas: FAIXAS } })]);
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('cat-26', $1, '2.6', '{"codigo":"2.6"}')`, [ENTUR]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag-1', $1, '{"datas_pagamento_comissao":[10]}')`, [ENTUR]);

const venda = (o) => ({
  conta_id: 1, conta_nome: 'Agência A', dia: '2026-11-04', tipo: 'nova', mrr: 297,
  itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 297 }],
  vendedor: { id: 'crm_user_7', nome: 'Karen', email: 'karen@entur.com.br' }, negociacao_id: 'crm_deal_1', ...o,
});
const comissoes = async (tenant = ENTUR) => (await query(`SELECT id, status, data FROM comissoes WHERE tenant_id = $1 ORDER BY id`, [tenant])).rows;
const contas = async (tenant = ENTUR) => (await query(`SELECT id, status, data FROM contas_pagar WHERE tenant_id = $1 ORDER BY id`, [tenant])).rows;

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) o perfil da conta ---');
eq([await perfilDaConta(ENTUR, exec), await perfilDaConta(AGENCIA, exec), await perfilDaConta('nao-existe', exec)], ['ecossistema', 'agencia', 'agencia'], 'só a conta marcada é ecossistema; sem nada gravado é agência');
eq([await exigirEcossistema(ENTUR, exec), (await exigirEcossistema(AGENCIA, exec))?.status], [null, 404], 'a trava deixa passar o ecossistema e dá 404 para a agência');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) metas ---');
const r1 = await gravarMetaMrr(exec, ENTUR, {
  mes: MES, nome: 'Planos', produtos: ['plano:essencial', 'plano:performance', 'plano:essencial'],
  produtos_nomes: { 'plano:essencial': 'Essencial', 'plano:performance': 'Performance' },
  valores: { 'u-karen': 1000, 'u-joao': '500', 'u-outra': 9999, 'u-vazio': '' },
});
eq([r1.ok, r1.meta?.produtos, r1.meta?.valores], [true, ['plano:essencial', 'plano:performance'], { 'u-karen': 1000, 'u-joao': 500 }], 'grava: produto repetido vira um, vendedora de outra empresa sai, valor vazio é ignorado');
const r2 = await gravarMetaMrr(exec, ENTUR, { mes: MES, nome: 'Upsell', produtos: ['plano:performance'], valores: {} });
eq([r2.ok, r2.erro], [false, 'Um produto só pode contar para uma meta do mês: ele já está na meta "Planos".'], 'produto que já está noutra meta do mês é barrado');
const r3 = await gravarMetaMrr(exec, ENTUR, { mes: MES, nome: 'Adicionais', produtos: ['adicional:whatsapp_number'], valores: { 'u-karen': 100 } });
eq(r3.ok, true, 'outra meta com outros produtos grava');
const editada = await gravarMetaMrr(exec, ENTUR, { ...r1.meta, valores: { 'u-karen': 1000, 'u-joao': 400 } });
eq([editada.ok, (await listarMetasMrr(exec, ENTUR, MES)).length], [true, 2], 'editar a meta não cria outra');
const intrusa = await gravarMetaMrr(exec, AGENCIA, { ...r1.meta, nome: 'Roubada' });
eq([intrusa.ok, (await listarMetasMrr(exec, ENTUR, MES)).find(m => m.id === r1.meta.id).nome], [false, 'Planos'], 'a agência não edita a meta da Entur, nem pelo id');
eq((await listarMetasMrr(exec, AGENCIA, MES)).length, 0, 'e não enxerga as metas da Entur');
eq(await apagarMetaMrr(exec, AGENCIA, r3.meta.id), false, 'nem apaga');
const copia = await copiarMetasDoMes(exec, ENTUR, MES, '2026-12');
eq([copia.ok, copia.copiadas, (await listarMetasMrr(exec, ENTUR, '2026-12')).map(m => m.nome)], [true, 2, ['Planos', 'Adicionais']], 'copiar para dezembro: as duas metas');
eq((await copiarMetasDoMes(exec, ENTUR, MES, '2026-12')).ok, false, 'copiar de novo para um mês com metas é barrado');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) gerar ---');
const vendasNov = [
  venda({ conta_id: 1, mrr: 346, itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 297 }, { chave: 'adicional:whatsapp_number', nome: 'Número de WhatsApp', classe: 'adicional', mrr: 49 }] }),
  venda({ conta_id: 2, conta_nome: 'Agência B', mrr: 497, itens: [{ chave: 'plano:performance', nome: 'Performance', classe: 'plano', mrr: 497 }] }),
  venda({ conta_id: 3, conta_nome: 'Agência C', mrr: 200, vendedor: { id: 'crm_user_8', nome: 'João', email: 'joao@entur.com.br' }, itens: [{ chave: 'plano:essencial', nome: 'Essencial', classe: 'plano', mrr: 200 }] }),
];
let ap = await apurarMes(exec, ENTUR, MES, vendasNov);
const karen = ap.vendedores.find(v => v.vendedor_id === 'u-karen');
eq([karen.metas.map(m => [m.nome, m.realizado, m.pct, m.percentual, m.comissao]), karen.comissao], [[['Planos', 794, 79.4, 40, 317.6], ['Adicionais', 49, 49, 20, 9.8]], 327.4], 'Karen: Planos 79,4% (faixa 40%) e Adicionais 49% (faixa 20%)');
let g = await gerarComissoesMrr(exec, ENTUR, ap, '2026-11-20');
eq([g.gravadas, g.canceladas], [2, 0], 'grava a comissão da Karen e a do João');
let linhas = await comissoes();
eq(linhas.map(l => [l.id, l.status, l.data.valor_comissao, l.data.origem]), [['comissao-mrr-u-joao-2026-11', 'CALCULADA', 40, 'mrr'], ['comissao-mrr-u-karen-2026-11', 'CALCULADA', 327.4, 'mrr']], 'uma linha por vendedor e mês, origem mrr (João: R$ 200 de R$ 400, 50%, faixa 20%: R$ 40)');
let cps = await contas();
eq(cps.map(c => [c.id, c.status, c.data.valor_final, c.data.venda_id]), [['cp-comissao-comissao-mrr-u-joao-2026-11', 'PENDENTE', 40, null], ['cp-comissao-comissao-mrr-u-karen-2026-11', 'PENDENTE', 327.4, null]], 'UMA conta a pagar por comissão, pelo gancho, sem apontar para venda');
eq(cps[1].data.descricao, 'Comissão por MRR · Karen · 11/2026', 'a conta diz que é comissão por MRR');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) gerar de novo ---');
g = await gerarComissoesMrr(exec, ENTUR, ap, '2026-11-20');
eq([g.gravadas, g.sem_mudanca], [2, 0], 'calculada é sempre regravada (é o número da vez)');
await query(`UPDATE comissoes SET status = 'APROVADA', data = jsonb_set(data, '{status}', '"APROVADA"') WHERE id = 'comissao-mrr-u-karen-2026-11'`);
ap = await apurarMes(exec, ENTUR, MES, [...vendasNov, venda({ conta_id: 9, conta_nome: 'Agência Z', mrr: 297 })]);
g = await gerarComissoesMrr(exec, ENTUR, ap, '2026-11-20');
linhas = await comissoes();
eq([linhas.find(l => l.id.includes('karen')).data.valor_comissao, g.avisos.some(a => /já foi aprovada/.test(a))], [327.4, true], 'aprovada com valor novo NÃO é reescrita, e alguém é avisado');
ap = await apurarMes(exec, ENTUR, MES, vendasNov.filter(v => v.vendedor.id !== 'crm_user_8'));
g = await gerarComissoesMrr(exec, ENTUR, ap, '2026-11-20');
linhas = await comissoes();
cps = await contas();
eq([ap.vendedores.find(v => v.vendedor_id === 'u-joao').metas[0].pct, linhas.find(l => l.id.includes('joao')).status, cps.find(c => c.id.includes('joao')).status], [0, 'CANCELADA', 'CANCELADO'], 'João sem venda mas com meta: aparece a 0%, e a comissão calculada que zerou é cancelada com a conta');
ap = await apurarMes(exec, ENTUR, MES, vendasNov);
g = await gerarComissoesMrr(exec, ENTUR, ap, '2026-11-20');
linhas = await comissoes();
cps = await contas();
eq([linhas.find(l => l.id.includes('joao')).status, linhas.find(l => l.id.includes('joao')).data.valor_comissao, cps.find(c => c.id.includes('joao')).status], ['CALCULADA', 40, 'PENDENTE'], 'a venda dele voltou: a comissão volta a valer, com a conta');
// Tira a meta do João: ele sai da apuração; a linha calculada dele tem de zerar.
const planos = (await listarMetasMrr(exec, ENTUR, MES)).find(m => m.nome === 'Planos');
await gravarMetaMrr(exec, ENTUR, { ...planos, valores: { 'u-karen': 1000 } });
ap = await apurarMes(exec, ENTUR, MES, vendasNov.filter(v => v.vendedor.id !== 'crm_user_8'));
g = await gerarComissoesMrr(exec, ENTUR, ap, '2026-11-20');
linhas = await comissoes();
cps = await contas();
eq([ap.vendedores.some(v => v.vendedor_id === 'u-joao'), linhas.find(l => l.id.includes('joao')).status, cps.find(c => c.id.includes('joao')).status], [false, 'CANCELADA', 'CANCELADO'], 'sem meta e sem venda ele sai da apuração, e a comissão calculada é cancelada, com a conta');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) uma empresa, as suas comissões ---');
eq([(await comissoes(AGENCIA)).length, (await contas(AGENCIA)).length], [0, 0], 'nada da comissão por MRR cai na agência (mesmo com vendedora de external_id igual)');
const apAgencia = await apurarMes(exec, AGENCIA, MES, vendasNov);
eq([apAgencia.vendedores.length, apAgencia.total.mrr_nas_metas], [0, 0], 'a apuração da agência não usa as metas da Entur');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (f) a comissão vem do CRM: as faixas não geram ---');
await query(`UPDATE tenants SET data = data - 'fonte_da_comissao' WHERE id = $1`, [ENTUR]);
const antes = JSON.stringify(await comissoes());
let recusa = null;
try { await gerarComissoesMrr(exec, ENTUR, await apurarMes(exec, ENTUR, MES, vendasNov), '2026-11-20'); } catch (e) { recusa = e; }
eq([recusa?.name, recusa?.status, recusa?.message], ['ComissaoVemDoCrm', 409, 'A comissão agora vem do CRM (Área Comercial). As metas de MRR seguem só para acompanhamento.'], 'sem a fonte gravada (o padrão é o CRM), gerar recusa com o texto combinado');
eq(JSON.stringify(await comissoes()), antes, 'e nada é gravado');
eq((await listarMetasMrr(exec, ENTUR, MES)).length, 2, 'as metas seguem lá, para acompanhamento');

console.log(`\n${total - falhas}/${total} testes da comissão por MRR (banco) passaram`);
if (falhas > 0) process.exit(1);
