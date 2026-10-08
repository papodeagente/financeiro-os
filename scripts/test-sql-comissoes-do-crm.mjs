/**
 * Comissão calculada pelo CRM (evento COMISSAO_APURADA, contrato v1) contra
 * um Postgres real (PGlite), pelo webhook DE PRODUÇÃO: a rota assinada,
 * processarEventoCRM, a identidade do vendedor, a gravação da comissão e o
 * gancho que programa a conta a pagar. Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (c) a apuração cria a comissão e UMA conta a pagar na agenda da agência;
 *       valor novo regrava a CALCULADA; APROVADA e PAGA não são regravadas e
 *       uma pessoa é avisada (uma vez por mudança); zero cancela a que não foi
 *       paga e não cria nada sem comissão; o mesmo evento de novo não muda
 *       nada; apuração atrasada não volta o mês para trás; contrato quebrado
 *       responde 500 para o CRM tentar de novo; a agência fica marcada como
 *       "comissão pelo CRM" e a outra agência não.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-comissoes-do-crm.mjs
 */
import { register } from 'node:module';
import { createHmac } from 'node:crypto';
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
  CREATE TABLE crm_eventos_entrada (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', processado BOOLEAN NOT NULL DEFAULT false, erro TEXT, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_crm_eventos_entrada_idem_tenant ON crm_eventos_entrada(tenant_id, idempotency_key);
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE membros (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE agencia (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_notificacoes_deduplicacao ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { processarEventoCRM } = await import('../src/lib/crm-integration.ts');
const { gravarComissao } = await import('../src/lib/comissao-do-crm-gravar.ts');
const { hojeISO } = await import('../src/lib/money.ts');
const rota = await import('../src/app/api/v1/crm/webhook/[tenantId]/route.ts');
const { NextRequest } = await import('next/server.js');

const T1 = 'agencia-a', T2 = 'agencia-b';
const exec = { query };
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, '{"ativo":true,"api_key_entur":"segredo-a"}'), ('singleton', $2, '{"ativo":true,"api_key_entur":"segredo-b"}')`, [T1, T2]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag-a', $1, '{"datas_pagamento_comissao":[1,18]}')`, [T1]);
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('26', $1, '2.6', '{"codigo":"2.6"}')`, [T1]);
// A Ana já está cadastrada no financeiro, sem vínculo com o CRM.
await query(`INSERT INTO usuarios (id, nome, email, data, tenant_id) VALUES ('u-ana', 'Ana Lima', 'ana@x.com', '{"id":"u-ana","nome":"Ana Lima","email":"ana@x.com","plano_comissao_id":"p-local"}', $1)`, [T1]);

const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const comissaoDo = (id, tenant = T1) => um(`SELECT id, status, venda_id, vendedor_id, data FROM comissoes WHERE id = $1 AND tenant_id = $2`, [id, tenant]);
const contasDa = (comissaoId, tenant = T1) => todos(`SELECT id, status, data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_comissao_id' = $2 ORDER BY id`, [tenant, comissaoId]);
const avisos = (comissaoId) => todos(`SELECT titulo, descricao, link, vendedor_id FROM notificacoes WHERE tenant_id = $1 AND tipo = 'COMISSAO_CRM_ALTERADA' AND data->>'comissao_id' = $2 ORDER BY created_at`, [T1, comissaoId]);
const acaoDo = async (chave, tenant = T1) => (await um(`SELECT status, data->>'acao' AS acao, erro FROM crm_eventos_entrada WHERE tenant_id = $1 AND idempotency_key = $2`, [tenant, chave]));

const apuracao = (o = {}) => ({
  versao_contrato: 1, competencia: '2026-09',
  vendedor_id: 'crm_user_7', vendedor_nome: 'Ana Lima', vendedor_email: 'ANA@x.com',
  valor_comissao: 420, valor_base: 3500,
  linhas: [
    { conta_id: 11, conta_nome: 'Pousada Sol', dia: '2026-09-05', valor: 2000, plano: 'Mensal', percentual: 12, comissao: 240, negociacao_id: 'crm_deal_91', provedor: 'asaas', transacao: 'pay_1' },
    { conta_id: 12, conta_nome: 'Hotel Mar', dia: '2026-09-20', valor: 1500, plano: 'Mensal', percentual: 12, comissao: 180, negociacao_id: 'crm_deal_92', provedor: null, transacao: null },
  ],
  apurado_em: '2026-10-01T03:00:00.000Z',
  ...o,
});
const evento = (id, payload, tenant = T1) => processarEventoCRM('COMISSAO_APURADA', payload, id, tenant);
const webhook = async (corpo, tenant = T1, segredo = 'segredo-a') => {
  const texto = JSON.stringify(corpo);
  const req = new NextRequest(`https://fin.test/api/v1/crm/webhook/${tenant}`, {
    method: 'POST', body: texto, headers: { 'x-crm-signature': createHmac('sha256', segredo).update(texto).digest('hex') },
  });
  const res = await rota.POST(req, { params: Promise.resolve({ tenantId: tenant }) });
  return { status: res.status, corpo: await res.json() };
};

const ID_ANA = 'comissao-crm-7-2026-09';
const hoje = hojeISO();

// ══════════════════════════════════════════════════════════════════════
console.log('--- (c) a apuração cria a comissão e uma conta a pagar ---');
{
  const r = await webhook({ id: 'cmc-1', tipo: 'COMISSAO_APURADA', payload: apuracao() });
  eq([r.status, r.corpo.processado], [200, true], 'o webhook assinado aceita o evento');
  const c = await comissaoDo(ID_ANA);
  eq([c.status, c.venda_id, c.vendedor_id], ['CALCULADA', 'crm-competencia-2026-09', 'u-ana'], 'a comissão nasce CALCULADA, do mês, na Ana que já existia (adotada pelo e-mail)');
  eq((await um(`SELECT external_id FROM usuarios WHERE id = 'u-ana'`)).external_id, 'crm_user_7', 'a Ana passa a carregar o id do CRM');
  eq([c.data.origem, c.data.competencia, c.data.valor_comissao, c.data.valor_base, c.data.percentual_aplicado, c.data.data_venda],
    ['crm', '2026-09', 420, 3500, 12, '2026-09-30'], 'origem, mês, valores, percentual efetivo e o último dia do mês');
  eq(c.data.descricao, 'Comissão de setembro de 2026 pelo dinheiro recebido (CRM)', 'a descrição que a tela mostra');
  eq([c.data.linhas.length, c.data.linhas[0].conta_nome, c.data.apurado_em, c.data.crm_vendedor_id], [2, 'Pousada Sol', '2026-10-01T03:00:00.000Z', 'crm_user_7'], 'as contas recebidas e o carimbo da apuração');

  const cps = await contasDa(ID_ANA);
  eq(cps.map(x => [x.id, x.status, x.data.valor_final]), [[`cp-comissao-${ID_ANA}`, 'PENDENTE', 420]], 'UMA conta a pagar, pendente, de R$ 420');
  const venc = cps[0].data.data_vencimento;
  eq([venc >= hoje, ['01', '18'].includes(venc.slice(8, 10))], [true, true], 'vencendo na próxima data da agenda da agência (1 ou 18)');
  eq([cps[0].data.venda_id, cps[0].data.origem_venda_id ?? null, cps[0].data.categoria_id], [null, null, '26'], 'a conta não aponta para venda nenhuma e cai em 2.6');
  eq(/setembro de 2026/.test(cps[0].data.descricao) && /recebidos/.test(cps[0].data.observacoes), true, 'e diz de que mês é');

  const cfg = await um(`SELECT data FROM crm_config WHERE tenant_id = $1`, [T1]);
  eq([cfg.data.comissao_pelo_crm, typeof cfg.data.comissao_pelo_crm_desde, cfg.data.api_key_entur], [true, 'string', 'segredo-a'], 'a agência fica marcada como "comissão pelo CRM", sem perder a configuração');
  eq((await um(`SELECT data FROM crm_config WHERE tenant_id = $1`, [T2])).data.comissao_pelo_crm, undefined, 'a outra agência não');
  eq(/criada/.test((await acaoDo('cmc-1')).acao), true, 'o evento diz o que fez');
}

console.log('\n--- (c) o mesmo evento de novo não muda nada ---');
{
  const antes = [await comissaoDo(ID_ANA), await contasDa(ID_ANA)];
  const r = await webhook({ id: 'cmc-1', tipo: 'COMISSAO_APURADA', payload: apuracao() });
  eq([r.status, r.corpo.acao], [200, 'duplicata ignorada'], 'a reentrega é duplicata');
  eq([await comissaoDo(ID_ANA), await contasDa(ID_ANA)], antes, 'comissão e conta iguais');
  const igual = await evento('cmc-1-bis', apuracao());
  eq([igual.processado, /sem mudança/.test(igual.acao)], [true, true], 'conteúdo igual com outro id também não regrava');
  eq((await comissaoDo(ID_ANA)).data.crm_evento_id, 'cmc-1', 'a comissão continua sendo a do primeiro evento');
}

console.log('\n--- (c) valor novo regrava a CALCULADA ---');
{
  const r = await evento('cmc-2', apuracao({ valor_comissao: 380, valor_base: 3200, apurado_em: '2026-10-05T03:00:00.000Z' }));
  eq(r.processado, true, 'o mês que mudou chega como evento novo');
  const c = await comissaoDo(ID_ANA);
  eq([c.status, c.data.valor_comissao, c.data.valor_base, c.data.crm_evento_id], ['CALCULADA', 380, 3200, 'cmc-2'], 'a comissão é regravada com o valor novo');
  eq(/Atualizada pelo CRM/.test(c.data.observacoes), true, 'com a nota do que mudou');
  eq((await contasDa(ID_ANA)).map(x => [x.status, x.data.valor_final]), [['PENDENTE', 380]], 'a MESMA conta a pagar acompanha');
  eq(/regravada/.test(r.acao), true, 'o evento diz que regravou');

  const velho = await evento('cmc-0', apuracao({ valor_comissao: 999, apurado_em: '2026-09-30T23:00:00.000Z' }));
  eq([velho.processado, /mais antiga/.test(velho.acao), (await comissaoDo(ID_ANA)).data.valor_comissao], [true, true, 380], 'a nova tentativa de uma apuração mais antiga é ignorada');
}

console.log('\n--- (c) APROVADA não é regravada; alguém é avisado ---');
{
  const c = await comissaoDo(ID_ANA);
  await gravarComissao(exec, T1, { ...c.data, status: 'APROVADA', data_aprovacao: '2026-10-06' });
  const r = await evento('cmc-3', apuracao({ valor_comissao: 450, apurado_em: '2026-10-07T03:00:00.000Z' }));
  const depois = await comissaoDo(ID_ANA);
  eq([depois.status, depois.data.valor_comissao], ['APROVADA', 380], 'a aprovada fica como estava');
  eq((await contasDa(ID_ANA)).map(x => x.data.valor_final), [380], 'e a conta dela também');
  eq([/diferença \+R\$\s70,00/.test(r.acao), /não regravada/.test(r.acao)], [true, true], 'a diferença fica escrita no evento');
  const n = await avisos(ID_ANA);
  eq(n.length, 1, 'uma pessoa é avisada');
  eq([/Ana Lima em setembro de 2026 mudou no CRM de R\$\s380,00 para R\$\s450,00/.test(n[0].titulo), n[0].link, n[0].vendedor_id], [true, '/equipe/comissoes?mes=2026-09', ''], 'com os dois valores, o link do mês, e só para quem vê o financeiro');
  eq(/—/.test(n[0].titulo + n[0].descricao), false, 'sem travessão');
  await evento('cmc-3-bis', apuracao({ valor_comissao: 450, apurado_em: '2026-10-07T04:00:00.000Z' }));
  eq((await avisos(ID_ANA)).length, 1, 'a mesma mudança não avisa duas vezes');
}

console.log('\n--- (c) PAGA não é regravada, nem zerada ---');
{
  const ID = 'comissao-crm-8-2026-09';
  await evento('cmb-1', apuracao({ vendedor_id: 'crm_user_8', vendedor_nome: 'Beto', vendedor_email: 'beto@x.com', valor_comissao: 200, valor_base: 2000 }));
  const nasceu = await comissaoDo(ID);
  eq([nasceu.status, nasceu.vendedor_id !== ''], ['CALCULADA', true], 'vendedor novo: a comissão nasce, com o cadastro pendente');
  eq(/sem cadastro completo/.test((await acaoDo('cmb-1')).acao), true, 'e o evento avisa que falta cadastrar');
  await gravarComissao(exec, T1, { ...nasceu.data, status: 'PAGA', data_pagamento: '2026-10-07' });
  await query(`UPDATE contas_pagar SET status = 'PAGO', data = data || '{"status":"PAGO","valor_pago":200}' WHERE id = $1`, [`cp-comissao-${ID}`]);
  const r = await evento('cmb-2', apuracao({ vendedor_id: 'crm_user_8', vendedor_nome: 'Beto', valor_comissao: 0, valor_base: 0, linhas: [], apurado_em: '2026-10-07T05:00:00.000Z' }));
  const c = await comissaoDo(ID);
  eq([c.status, c.data.valor_comissao], ['PAGA', 200], 'zero não cancela a comissão paga');
  eq((await contasDa(ID)).map(x => [x.status, x.data.valor_pago]), [['PAGO', 200]], 'a conta paga não é tocada');
  eq([/foi paga a mais/.test((await avisos(ID))[0]?.descricao ?? ''), /diferença -R\$\s200,00/.test(r.acao)], [true, true], 'e alguém é avisado de que foi pago a mais');
}

console.log('\n--- (c) zero cancela o que não foi pago ---');
{
  const ID = 'comissao-crm-9-2026-09';
  await evento('cmd-1', apuracao({ vendedor_id: 'crm_user_9', vendedor_nome: 'Carla', vendedor_email: '', valor_comissao: 150, valor_base: 1500 }));
  const r = await evento('cmd-2', apuracao({ vendedor_id: 'crm_user_9', vendedor_nome: 'Carla', valor_comissao: 0, valor_base: 0, linhas: [], apurado_em: '2026-10-02T03:00:00.000Z' }));
  const c = await comissaoDo(ID);
  eq([c.status, c.data.cancelada_pelo_crm, /zerada no CRM/.test(r.acao)], ['CANCELADA', true, true], 'a CALCULADA zerada no CRM é cancelada');
  eq((await contasDa(ID)).map(x => x.status), ['CANCELADO'], 'e a conta a pagar dela também (cancelada, não excluída)');
  await evento('cmd-3', apuracao({ vendedor_id: 'crm_user_9', vendedor_nome: 'Carla', valor_comissao: 90, valor_base: 900, apurado_em: '2026-10-03T03:00:00.000Z' }));
  const volta = await comissaoDo(ID);
  eq([volta.status, volta.data.valor_comissao, volta.data.cancelada_pelo_crm], ['CALCULADA', 90, false], 'o dinheiro voltou no CRM: a comissão cancelada pelo CRM reabre');
  eq((await contasDa(ID)).map(x => [x.status, x.data.valor_final]), [['PENDENTE', 90]], 'com a mesma conta, de volta em aberto');
}
{
  const ID = 'comissao-crm-10-2026-09';
  await evento('cme-1', apuracao({ vendedor_id: 'crm_user_10', vendedor_nome: 'Davi', valor_comissao: 75, valor_base: 750 }));
  await gravarComissao(exec, T1, { ...(await comissaoDo(ID)).data, status: 'APROVADA' });
  await evento('cme-2', apuracao({ vendedor_id: 'crm_user_10', vendedor_nome: 'Davi', valor_comissao: 0, valor_base: 0, linhas: [], apurado_em: '2026-10-02T03:00:00.000Z' }));
  eq([(await comissaoDo(ID)).status, (await contasDa(ID)).map(x => x.status)], ['CANCELADA', ['CANCELADO']], 'a APROVADA ainda não paga, zerada, é cancelada com a conta');
  eq(/zerada no CRM e cancelada aqui/.test((await avisos(ID))[0]?.titulo ?? ''), true, 'e alguém é avisado, porque ela já tinha sido aprovada');
}
{
  const ID = 'comissao-crm-11-2026-09';
  await evento('cmf-1', apuracao({ vendedor_id: 'crm_user_11', vendedor_nome: 'Eva', valor_comissao: 60, valor_base: 600 }));
  // Alguém cancelou aqui, na tela.
  await gravarComissao(exec, T1, { ...(await comissaoDo(ID)).data, status: 'CANCELADA' });
  await evento('cmf-2', apuracao({ vendedor_id: 'crm_user_11', vendedor_nome: 'Eva', valor_comissao: 65, valor_base: 650, apurado_em: '2026-10-02T03:00:00.000Z' }));
  eq((await comissaoDo(ID)).status, 'CANCELADA', 'o CRM não desfaz o cancelamento feito por uma pessoa');
  eq((await avisos(ID)).length, 1, 'mas avisa');
}
{
  const r = await evento('cmg-1', apuracao({ vendedor_id: 'crm_user_12', vendedor_nome: 'Fábio', valor_comissao: 0, valor_base: 0, linhas: [] }));
  eq([r.processado, /nada a fazer/.test(r.acao)], [true, true], 'zero sem comissão: nada a fazer');
  eq([await comissaoDo('comissao-crm-12-2026-09'), (await contasDa('comissao-crm-12-2026-09')).length], [undefined, 0], 'nenhuma comissão e nenhuma conta nascem');
}

console.log('\n--- (c) contrato quebrado pede nova tentativa ---');
{
  const semMes = await webhook({ id: 'cmx-1', tipo: 'COMISSAO_APURADA', payload: apuracao({ competencia: '2026-9' }) });
  eq([semMes.status, semMes.corpo.processado, /AAAA-MM/.test(semMes.corpo.erro)], [500, false, true], 'competência fora do formato responde 500');
  eq((await acaoDo('cmx-1')).status, 'ERRO', 'e o evento fica como ERRO (reprocessável)');
  const versao = await webhook({ id: 'cmx-2', tipo: 'COMISSAO_APURADA', payload: apuracao({ versao_contrato: 2 }) });
  eq([versao.status, /não suportada/.test(versao.corpo.erro)], [500, true], 'versão de contrato desconhecida também');
  const negativo = await webhook({ id: 'cmx-3', tipo: 'COMISSAO_APURADA', payload: apuracao({ valor_comissao: -5 }) });
  eq(negativo.status, 500, 'valor negativo também');
  const semVendedor = await webhook({ id: 'cmx-4', tipo: 'COMISSAO_APURADA', payload: apuracao({ vendedor_id: '' }) });
  eq(semVendedor.status, 500, 'e sem vendedor');
}

console.log('\n--- (c) a outra agência ---');
{
  await evento('cmh-1', apuracao({ vendedor_id: 'crm_user_70', vendedor_nome: 'Gil', vendedor_email: 'gil@x.com' }), T2);
  const c2 = await comissaoDo('comissao-crm-70-2026-09', T2);
  eq([c2.status, c2.data.valor_comissao], ['CALCULADA', 420], 'a outra agência recebe a dela');
  eq((await um(`SELECT data FROM crm_config WHERE tenant_id = $1`, [T2])).data.comissao_pelo_crm, true, 'e fica marcada quando recebe a primeira');
  // O id da comissão é o do usuário no CRM, único lá. Se duas agências daqui
  // recebessem o mesmo usuário, a segunda não pode escrever por cima.
  const antes = await comissaoDo(ID_ANA);
  const r = await evento('cmh-2', apuracao(), T2);
  eq([r.processado, /outra agência/.test(r.erro ?? '')], [false, true], 'o mesmo id de comissão em outra agência falha com o motivo (e o CRM tenta de novo)');
  eq([await comissaoDo(ID_ANA), await comissaoDo(ID_ANA, T2)], [antes, undefined], 'a comissão da primeira agência não muda e nada vaza');
  eq((await todos(`SELECT id FROM contas_pagar WHERE tenant_id = $1`, [T2])).map(x => x.id), ['cp-comissao-comissao-crm-70-2026-09'], 'nem conta a pagar órfã nasce');
}

console.log(`\n${total - falhas}/${total} testes da comissão calculada pelo CRM passaram`);
if (falhas > 0) process.exit(1);
