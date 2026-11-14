/**
 * "Saúde da volta" (14/11/2026) contra um Postgres real (PGlite) com o esquema
 * inteiro do initDB, chamando a ROTA de verdade.
 *
 * Prova: os cinco pontos acham o que a versão simples pode ter deixado torto,
 * agência por agência; o segredo do autenticador só é contado, nunca mostrado;
 * só o super admin abre (sem login 401, CS 403).
 *
 * Uso: node --no-warnings scripts/test-sql-saude-da-volta.mjs
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { carregarAplicacao } from './carregar-initdb-isolado.mjs';

let total = 0;
function eq(a, b, label) { total++; assert.deepEqual(a, b, label); console.log(`PASS  ${label}`); }
function ok(c, label) { total++; assert.ok(c, label); console.log(`PASS  ${label}`); }

const pg = new PGlite();
{ const l = console.log; console.log = () => {}; await carregarAplicacao(pg).initDB(); console.log = l; }

const query = async (text, values) => {
  const r = values ? await pg.query(text, values) : (await pg.exec(text)).at(-1);
  return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

const SEGREDO = 'JBSWY3DPEHPK3PXP';
await query(`INSERT INTO tenants (id, slug, nome, cnpj, plano, status, data) VALUES
  ('tA','a','Agência Alfa','','free','ativo','{}'), ('tB','b','Agência Beta','','free','ativo','{}')`);
// a) CRM: segredo só no cofre (a simples lia o texto).
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', 'tA', $1)`,
  [JSON.stringify({ ativo: true, webhook_url_crm: 'https://crm.x/api', api_key_crm_cofre: 'v1:xx', api_key_entur_cofre: 'v1:yy' })]);
// b) Cobrança da completa paga no intervalo, registrada como venda direta.
await query(`INSERT INTO cobrancas (id, tenant_id, titulo_id, provedor, id_externo, referencia, tipo, status, valor_centavos)
  VALUES ('cob1','tA','cr1','asaas','pay_1','f1;tA;cob1','boleto','aberta',25000)`);
await query(`INSERT INTO plataformas_transacoes (id, tenant_id, plataforma, id_transacao, status_conciliacao, data)
  VALUES ('pt1','tA','asaas','pay_1','DIRETA',$1), ('pt2','tA','asaas','pay_9','DIRETA','{}')`,
  [JSON.stringify({ bruto: { payment: { externalReference: 'f1;tA;cob1' } } })]);
// c) Período fechado.
await query(`INSERT INTO periodos_fechados (tenant_id, conta_bancaria_id, fechado_ate) VALUES ('tB', '', '2026-11-10')`);
// d) Autenticador sem máscara no histórico (como a auditoria da simples gravava).
await query(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_protect_insert_v1`);
const evento = alt => JSON.stringify({ alteracoes: alt });
await query(`INSERT INTO audit_log (id, tenant_id, usuario_id, acao, modulo, entidade, entidade_id, data) VALUES
  ('a1','tB','u1','EDITAR','Equipe','usuarios','u1',$1),
  ('a2','tB','u1','EDITAR','Equipe','usuarios','u1',$2),
  ('a3','tB','u1','EDITAR','Equipe','usuarios','u1',$3),
  ('a4','tB','u1','EDITAR','Equipe','usuarios','u1',$4)`,
  [evento([{ campo: 'totp_segredo', valor_anterior: '', valor_novo: SEGREDO }]),
    evento([{ campo: 'totp_cofre', valor_anterior: '', valor_novo: 'v1:abc' }]),
    evento([{ campo: 'totp_ultimo_passo', valor_anterior: '1', valor_novo: '2' }]),
    evento([{ campo: 'totp_segredo', valor_anterior: '', valor_novo: '[PROTEGIDO]' }])]);
await query(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_protect_insert_v1`);
// e) Diferença da reabertura do razão.
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, banco, data) VALUES ('c1','tA','Itaú','', '{"nome":"Itaú"}')`);
await query(`INSERT INTO razao_conferencias (tenant_id, dia, tipo, conta_bancaria_id, saldo_atual_centavos, razao_centavos, diferenca_centavos)
  VALUES ('tA','2026-11-14','reabertura','c1',150000,120000,30000), ('tB','2026-11-14','reabertura','d1',100,100,0)`);

const { GET } = await import('../src/app/api/admin/saude-da-volta/route.ts');
const chamar = async sessao => { globalThis.__SESSAO_DE_TESTE__ = sessao; const r = await GET(); return { status: r.status, corpo: await r.json() }; };

eq((await chamar(null)).status, 401, 'sem login: 401');
eq((await chamar({ plataforma: 'CS', tenantId: '__platform__', userId: 'cs1' })).status, 403, 'CS: 403 (só o super admin)');
eq((await chamar({ userId: 'u9', tenantId: 'tA', perfil: 'ADMIN' })).status, 401, 'admin de agência: recusado');

const r = await chamar({ isSuperAdmin: true, userId: 'sa', tenantId: '__platform__' });
eq(r.status, 200, 'super admin: 200');
const item = id => r.corpo.itens.find(i => i.id === id);
eq(r.corpo.itens.map(i => i.id), ['crm_cofre', 'cobranca_venda_direta', 'periodos_fechados', 'totp_no_historico', 'razao_revisao'], 'cinco pontos, na ordem');
ok(r.corpo.itens.every(i => i.explicacao && i.o_que_fazer && !i.erro), 'cada ponto com explicação e o que fazer, todos rodaram');
eq(item('crm_cofre').linhas.map(l => [l.tenant_id, l.agencia]), [['tA', 'Agência Alfa']], 'a) CRM com segredo só no cofre');
eq(item('cobranca_venda_direta').linhas.map(l => l.tenant_id), ['tA'], 'b) só a transação da cobrança f1; (a venda direta comum fica de fora)');
ok(item('cobranca_venda_direta').linhas[0].detalhe.includes('pay_1'), 'b) cita a transação');
eq(item('periodos_fechados').linhas.map(l => [l.tenant_id, l.detalhe]), [['tB', 'Agência inteira fechada até 10/11/2026.']], 'c) período fechado');
eq(item('totp_no_historico').linhas.map(l => [l.tenant_id, l.numeros]), [['tB', { texto: 1, cifrado: 1, passo: 1 }]], 'd) contagem por tipo; o já mascarado não conta');
ok(!JSON.stringify(r.corpo).includes(SEGREDO) && !JSON.stringify(r.corpo).includes('v1:abc'), 'd) o valor do segredo nunca sai na resposta');
eq(item('razao_revisao').linhas.map(l => [l.tenant_id, l.numeros.diferenca_centavos]), [['tA', 30000]], 'e) só a conta com diferença');
ok(item('razao_revisao').linhas[0].detalhe.startsWith('Itaú: entrou'), 'e) frase com o nome da conta');

await pg.close();
console.log(`\n${total} verificações, todas passaram.`);
