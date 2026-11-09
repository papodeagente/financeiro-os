/**
 * Comissão do mês que vem do CRM (COMISSAO_DO_MES e COMISSAO_PAGA) contra um
 * Postgres real (PGlite), rodando o código DE PRODUÇÃO: a rota assinada do
 * webhook, processarEventoCRM, o gancho da conta a pagar, a liquidação do
 * servidor (registrarBaixas), a tela antiga (editarContaNoExecutor), o
 * agendador e a trava das faixas. Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (a) evento válido cria UMA comissão (origem crm) e UMA conta a pagar
 *       PENDENTE: descrição, vencimento no dia 10, favorecido, valor em reais;
 *   (b) o mesmo evento repetido não duplica e responde "ja_existia";
 *   (c) versão nova do mês atualiza a pendente; recusa (409) a aprovada e a
 *       paga com outro valor, sem mexer; versão mais antiga não passa;
 *   (d) total zero cancela a conta pendente; sem comissão, não há o que cancelar;
 *   (e) conta que não é o ecossistema recusa (4xx, nada gravado) e a mesma
 *       entrega é aceita depois que a conta vira ecossistema;
 *   (f) payload inválido recusa com o motivo; corrigido, o mesmo id entra;
 *   (g) baixa total (liquidação e tela antiga) põe COMISSAO_PAGA na fila uma
 *       vez só por conta; parcial não; o agendador manda, assinado, e repõe o
 *       aviso que faltou, sem mandar os outros pendentes da conta;
 *   (h) a geração por faixas recusa na conta ecossistema com o texto combinado;
 *   (i) toda consulta nova filtra tenant_id, e uma conta nunca mexe na outra.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-comissao-do-crm.mjs
 */
import { register } from 'node:module';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

delete process.env.INTEGRACOES_MASTER_KEY;
delete process.env.CRM_HMAC_EXIGE_TIMESTAMP;

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}
async function falha(p) { try { await p; return null; } catch (e) { return { nome: e?.name ?? null, status: e?.status ?? null, msg: e?.message ?? String(e) }; } }

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE crm_eventos_entrada (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', processado BOOLEAN NOT NULL DEFAULT false, erro TEXT, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_crm_eventos_entrada_idem_tenant ON crm_eventos_entrada(tenant_id, idempotency_key);
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE membros (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, aprovacao_status TEXT NOT NULL DEFAULT '', aprovacao_pedido_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT, codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
`);

// O pool de produção, trocado pelo PGlite (uma sessão só: BEGIN/COMMIT valem).
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL, registrarBaixas, estornarBaixa, historicoDaConta } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { editarContaNoExecutor } = await import('../src/lib/baixa-de-conta.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { processarEventoCRM } = await import('../src/lib/crm-integration.ts');
const {
  tarefaComissaoPagaAoCrm, fonteDaComissao, trocarFonteDaComissao, reporAvisosDeComissaoPaga, avisarComissaoPaga, MOTIVO_FORA_DO_ECOSSISTEMA,
} = await import('../src/lib/comissao-do-crm-servidor.ts');
const { AVISO_COMISSAO_VEM_DO_CRM, MOTIVO_FONTE_DAS_FAIXAS } = await import('../src/lib/comissao-do-crm.ts');
const { gerarComissoesMrr } = await import('../src/lib/comissao-mrr-servidor.ts');
const rota = await import('../src/app/api/v1/crm/webhook/[tenantId]/route.ts');
const { NextRequest } = await import('next/server.js');

const assinar = (corpo, segredo) => createHmac('sha256', segredo).update(corpo).digest('hex');

// ── O CRM de mentira (a caixa de entrada que recebe o COMISSAO_PAGA) ─────
const SEGREDO_CRM = 'segredo-do-crm-150002';
let modoDoCrm = 'ok';
const recebidos = [];
const servidor = createServer((req, res) => {
  let corpo = '';
  req.on('data', c => { corpo += c; });
  req.on('end', () => {
    const json = JSON.parse(corpo);
    const carimbo = req.headers['x-entur-timestamp'];
    recebidos.push({
      caminho: req.url, tipo: json.tipo, id: json.id, payload: json.payload,
      assinaturaOk: req.headers['x-entur-signature'] === assinar(corpo, SEGREDO_CRM),
      assinaturaComCarimboOk: req.headers['x-entur-signature-ts'] === assinar(`${carimbo}.${corpo}`, SEGREDO_CRM),
    });
    if (modoDoCrm === 'erro') { res.writeHead(500); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ recebido: true, processado: true }));
  });
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const porta = servidor.address().port;

// ── As contas ────────────────────────────────────────────────────────────
const ENTUR = 't-entur', AGENCIA = 't-agencia', NOVA = 't-nova', OUTRA = 't-outra';
await query(`INSERT INTO tenants (id, numero, data) VALUES ($1, 1, '{"perfil":"ecossistema","fonte_da_comissao":"crm"}'), ($2, 2, '{}'), ($3, 3, '{}'), ($4, 4, '{"perfil":"ecossistema","fonte_da_comissao":"crm"}')`, [ENTUR, AGENCIA, NOVA, OUTRA]);
const SEGREDO = { [ENTUR]: 'entra-entur', [AGENCIA]: 'entra-agencia', [NOVA]: 'entra-nova', [OUTRA]: 'entra-outra' };
const urlDoCrm = `http://127.0.0.1:${porta}/api/integracao-financeiro/webhook/150002`;
for (const t of [ENTUR, AGENCIA, NOVA, OUTRA]) {
  const cfg = { ativo: true, api_key_entur: SEGREDO[t], ...(t === AGENCIA ? {} : { api_key_crm: SEGREDO_CRM, webhook_url_crm: urlDoCrm }) };
  await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, $2::jsonb)`, [t, JSON.stringify(cfg)]);
  await query(`INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ($1, $2, '2.6', '{"codigo":"2.6"}')`, [`cat-26-${t}`, t]);
  await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ($1, $2, '{"datas_pagamento_comissao":[1]}')`, [`ag-${t}`, t]);
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, '{"nome":"Inter","saldo_inicial":10000,"saldo_atual":10000}')`, [`b-${t}`, t]);
  await emTransacao(exec => abrirRazaoNoExecutor(exec, t));
}
// Luan já tem cadastro no financeiro da Entur, sem o vínculo com o CRM.
await query(`INSERT INTO usuarios (id, nome, email, data, external_id, tenant_id) VALUES ('u-luan', 'Luan Amador', 'luan@entur.com.br', $1::jsonb, NULL, $2)`,
  [JSON.stringify({ id: 'u-luan', nome: 'Luan Amador', email: 'luan@entur.com.br', perfil: 'VENDEDOR' }), ENTUR]);
// Uma pessoa de mesmo e-mail na outra conta do ecossistema: nunca é usada pela Entur.
await query(`INSERT INTO usuarios (id, nome, email, data, external_id, tenant_id) VALUES ('u-luan-outra', 'Luan (outra)', 'luan@entur.com.br', '{}'::jsonb, NULL, $1)`, [OUTRA]);

// ── Ajudantes ────────────────────────────────────────────────────────────
const COMP = '2026-10';
const extrato = (o = {}) => ({
  tipo: 'COMISSAO_DO_MES', versao: 1, competencia: COMP,
  beneficiario: { usuarioId: 420008, nome: 'Luan Amador', email: 'luan@entur.com.br' },
  brutoCents: 35000, compensadoCents: 5000, totalCents: 30000,
  linhas: [
    { contaId: 9001, conta: 'Agência A', modelo: 'novo', papel: 'vendedor', parcela: 1, tipo: 'comissao', valorCents: 20000, gatilho: '1º recebimento', gatilhoEm: '2026-10-08T12:00:00Z' },
    { contaId: 9002, conta: 'Agência B', modelo: 'novo', papel: 'vendedor', parcela: 2, tipo: 'comissao', valorCents: 15000, gatilho: '2º recebimento', gatilhoEm: '2026-10-20T12:00:00Z' },
  ],
  geradoEm: '2026-11-01T03:00:00.000Z',
  ...o,
});
/** Extrato com um total só (uma linha), para as versões. */
const comTotal = (totalCents, o = {}) => extrato({ brutoCents: totalCents, compensadoCents: 0, totalCents, linhas: totalCents ? [{ contaId: 1, conta: 'A', modelo: 'novo', papel: 'vendedor', parcela: 1, tipo: 'comissao', valorCents: totalCents, gatilho: 'g', gatilhoEm: '2026-10-08T12:00:00Z' }] : [], ...o });

async function chamar(tenant, corpo, assinatura) {
  const texto = JSON.stringify(corpo);
  const req = new NextRequest(`https://fin.test/api/v1/crm/webhook/${tenant}`, {
    method: 'POST', body: texto,
    headers: { 'x-crm-signature': assinatura ?? assinar(texto, SEGREDO[tenant]) },
  });
  const res = await rota.POST(req, { params: Promise.resolve({ tenantId: tenant }) });
  return { status: res.status, corpo: await res.json() };
}
const enviar = (tenant, id, payload) => chamar(tenant, { id, tipo: 'COMISSAO_DO_MES', payload: { eventId: id, ...payload } });

const um = async (sql, v = []) => (await query(sql, v)).rows[0];
const todos = async (sql, v = []) => (await query(sql, v)).rows;
const comissao = (id, tenant = ENTUR) => um(`SELECT id, status, vendedor_id, data FROM comissoes WHERE id = $1 AND tenant_id = $2`, [id, tenant]);
const conta = (id, tenant = ENTUR) => um(`SELECT id, status, fornecedor_id, aprovacao_status, data FROM contas_pagar WHERE id = $1 AND tenant_id = $2`, [id, tenant]);
const contasDaComissao = (id, tenant = ENTUR) => todos(`SELECT id, status FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_comissao_id' = $2`, [tenant, id]);
const saida = (tenant = ENTUR) => todos(`SELECT id, tipo, status, tentativas, data FROM crm_eventos_saida WHERE tenant_id = $1 AND tipo = 'COMISSAO_PAGA' ORDER BY id`, [tenant]);
const entrada = (key, tenant = ENTUR) => um(`SELECT status, processado, erro, data FROM crm_eventos_entrada WHERE tenant_id = $1 AND idempotency_key = $2`, [tenant, key]);
const liquidar = (tenant, contaId, valor, data = '2026-11-10') => emTransacao(exec => registrarBaixas(exec, { tenantId: tenant, usuarioNome: 'Ana', origem: 'tela', politica: null },
  [{ titulo_tabela: 'contas_pagar', titulo_id: contaId, data, conta_bancaria_id: `b-${tenant}`, valor }], { gravar: true }));
const ctxDaTarefa = { exec: pool, emTransacao, agora: new Date(), restanteMs: () => 30_000 };

const LUAN = 'comissao-crm-2026-10-420008';
const CP_LUAN = 'cp-comissao-comissao-crm-2026-10-420008';

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) evento válido: uma comissão e uma conta a pagar ---');
{
  const r = await enviar(ENTUR, 'ev-luan-1', extrato());
  eq([r.status, r.corpo], [200, { ok: true, situacao: 'criada', comissaoId: LUAN, contaPagarId: CP_LUAN }], 'responde 200 com o corpo do contrato: criada, comissaoId e contaPagarId');
  const c = await comissao(LUAN);
  eq([c.status, c.vendedor_id, c.data.origem, c.data.valor_comissao, c.data.valor_base, c.data.vendedor_nome],
    ['CALCULADA', 'u-luan', 'crm', 300, 350, 'Luan Amador'], 'a comissão: origem crm, pessoa achada pelo e-mail, total e bruto em reais');
  eq([c.data.crm.competencia, c.data.crm.evento_id, c.data.crm.bruto_cents, c.data.crm.compensado_cents, c.data.crm.total_cents, c.data.crm.linhas.length, c.data.crm.beneficiario.usuarioId],
    [COMP, 'ev-luan-1', 35000, 5000, 30000, 2, 420008], 'o JSON guarda competência, bruto, compensado, total, as linhas e o eventId');
  const cps = await contasDaComissao(LUAN);
  eq(cps.map(x => [x.id, x.status]), [[CP_LUAN, 'PENDENTE']], 'UMA conta a pagar, PENDENTE, pelo gancho de toda comissão');
  const cp = (await conta(CP_LUAN)).data;
  eq([cp.descricao, cp.data_vencimento, cp.valor_final, cp.valor_brl, cp.moeda, cp.fornecedor_nome, cp.fornecedor_id, cp.categoria_id, cp.is_custo_comercial, cp.venda_id, cp.origem_comissao_id],
    ['Comissão de outubro/2026, Luan Amador', '2026-11-10', 300, 300, 'BRL', 'Luan Amador', '', `cat-26-${ENTUR}`, true, null, LUAN],
    'a conta: descrição combinada, vence no dia 10 do mês seguinte (não na agenda), favorecido pelo nome, R$ 300 em Custos Comerciais');
  eq((await um(`SELECT external_id FROM usuarios WHERE id = 'u-luan'`)).external_id, 'crm_user_420008', 'o cadastro achado pelo e-mail passa a carregar o id do CRM');
  const ev = await entrada('ev-luan-1');
  eq([ev.status, ev.processado, ev.data.resposta.corpo.situacao], ['PROCESSADO', true, 'criada'], 'o evento fica concluído, com a resposta guardada');
  eq((await todos(`SELECT id FROM usuarios WHERE tenant_id = $1`, [ENTUR])).length, 1, 'ninguém foi criado: a pessoa já existia');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) o mesmo evento repetido ---');
{
  const r = await enviar(ENTUR, 'ev-luan-1', extrato());
  eq([r.status, r.corpo], [200, { ok: true, situacao: 'ja_existia', comissaoId: LUAN, contaPagarId: CP_LUAN }], 'repetido: 200 "ja_existia" com os mesmos ids');
  const direto = await processarEventoCRM('COMISSAO_DO_MES', { eventId: 'ev-luan-1', ...extrato() }, 'ev-luan-1', ENTUR);
  eq([direto.processado, direto.resposta?.corpo.situacao], [true, 'ja_existia'], 'pelo processamento direto também');
  eq([(await todos(`SELECT id FROM comissoes WHERE tenant_id = $1`, [ENTUR])).length, (await contasDaComissao(LUAN)).length, (await todos(`SELECT id FROM crm_eventos_entrada WHERE tenant_id = $1 AND idempotency_key = 'ev-luan-1'`, [ENTUR])).length],
    [1, 1, 1], 'nada duplicou: uma comissão, uma conta, um registro do evento');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) versão nova do mesmo mês ---');
{
  const v2 = await enviar(ENTUR, 'ev-luan-2', comTotal(40000, { geradoEm: '2026-11-01T09:00:00.000Z' }));
  eq([v2.status, v2.corpo], [200, { ok: true, situacao: 'atualizada', comissaoId: LUAN, contaPagarId: CP_LUAN }], 'versão nova com a conta pendente: 200 "atualizada"');
  let c = await comissao(LUAN);
  let cp = await conta(CP_LUAN);
  eq([c.data.valor_comissao, c.data.crm.evento_id, c.data.crm.versoes, cp.status, cp.data.valor_final, (await contasDaComissao(LUAN)).length],
    [400, 'ev-luan-2', ['ev-luan-1', 'ev-luan-2'], 'PENDENTE', 400, 1], 'comissão e conta com o valor novo; ainda uma conta só');

  const velha = await enviar(ENTUR, 'ev-luan-1', extrato());
  eq([velha.status, velha.corpo.situacao, (await comissao(LUAN)).data.valor_comissao], [200, 'ja_existia', 400], 'a versão 1 entregue de novo não volta o valor antigo');
  const antiga = await enviar(ENTUR, 'ev-luan-0', comTotal(10000, { geradoEm: '2026-10-31T23:00:00.000Z' }));
  eq([antiga.status, antiga.corpo.ok, /mais nova/.test(antiga.corpo.motivo), (await comissao(LUAN)).data.valor_comissao], [409, false, true, 400], 'versão mais antiga, com id novo, é recusada (409) sem mexer');

  await query(`UPDATE contas_pagar SET aprovacao_status = 'APROVADO' WHERE id = $1 AND tenant_id = $2`, [CP_LUAN, ENTUR]);
  const aprovada = await enviar(ENTUR, 'ev-luan-3', comTotal(45000, { geradoEm: '2026-11-01T10:00:00.000Z' }));
  eq([aprovada.status, aprovada.corpo.ok, /aprovada para pagamento/.test(aprovada.corpo.motivo), (await conta(CP_LUAN)).data.valor_final],
    [409, false, true, 400], 'pagamento já aprovado: recusa (409) e a conta não muda');
  await query(`UPDATE contas_pagar SET aprovacao_status = '' WHERE id = $1 AND tenant_id = $2`, [CP_LUAN, ENTUR]);

  await liquidar(ENTUR, CP_LUAN, 400);
  cp = await conta(CP_LUAN);
  eq([cp.status, cp.data.valor_pago], ['PAGO', 400], 'a conta é paga pela liquidação do servidor');
  const paga = await enviar(ENTUR, 'ev-luan-4', comTotal(45000, { geradoEm: '2026-11-01T11:00:00.000Z' }));
  eq([paga.status, paga.corpo.ok, /já foi paga \(R\$\s400,00\)/.test(paga.corpo.motivo)], [409, false, true], 'versão nova com outro valor depois de paga: 409 com o motivo');
  c = await comissao(LUAN);
  cp = await conta(CP_LUAN);
  eq([c.data.valor_comissao, c.data.crm.evento_id, cp.status, cp.data.valor_final], [400, 'ev-luan-2', 'PAGO', 400], 'nada mexido: comissão, eventId e conta paga como estavam');
  const ev4 = await entrada('ev-luan-4');
  eq([ev4.status, ev4.processado, /^Recusado: A comissão de outubro\/2026/.test(ev4.erro)], ['ERRO', false, true], 'a recusa fica registrada como ERRO, com o motivo (não conclui o evento)');
  const de4 = await enviar(ENTUR, 'ev-luan-4', comTotal(45000, { geradoEm: '2026-11-01T11:00:00.000Z' }));
  eq(de4.status, 409, 'a mesma entrega recusada volta a ser avaliada, e segue recusada');
  const igual = await enviar(ENTUR, 'ev-luan-5', comTotal(40000, { geradoEm: '2026-11-01T12:00:00.000Z' }));
  eq([igual.status, igual.corpo.situacao], [200, 'ja_existia'], 'versão nova com o mesmo valor da paga: 200 "ja_existia", nada muda');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) total zero cancela ---');
const BRUNO = 'comissao-crm-2026-10-150001', CP_BRUNO = 'cp-comissao-comissao-crm-2026-10-150001';
{
  const bruno = { beneficiario: { usuarioId: 150001, nome: 'Bruno Barbosa', email: 'bruno@entur.com.br' } };
  const r1 = await enviar(ENTUR, 'ev-bruno-1', comTotal(15000, bruno));
  eq([r1.status, r1.corpo.situacao, (await conta(CP_BRUNO)).status], [200, 'criada', 'PENDENTE'], 'Bruno: criada, com a conta pendente');
  const pessoa = await um(`SELECT id, external_id, data FROM usuarios WHERE tenant_id = $1 AND external_id = 'crm_user_150001'`, [ENTUR]);
  eq([!!pessoa, pessoa?.data.cadastro_pendente, (await comissao(BRUNO)).vendedor_id === pessoa?.id], [true, true, true], 'sem cadastro: a pessoa nasce como cadastro pendente, como nas vendas do CRM');
  const r2 = await enviar(ENTUR, 'ev-bruno-2', comTotal(0, { ...bruno, geradoEm: '2026-11-02T00:00:00.000Z' }));
  eq([r2.status, r2.corpo], [200, { ok: true, situacao: 'atualizada', comissaoId: BRUNO, contaPagarId: CP_BRUNO }], 'total zero: 200 "atualizada"');
  eq([(await comissao(BRUNO)).status, (await comissao(BRUNO)).data.valor_comissao, (await conta(CP_BRUNO)).status], ['CANCELADA', 0, 'CANCELADO'], 'a comissão é cancelada e a conta pendente também (nunca apagada)');
  const nada = await enviar(ENTUR, 'ev-ninguem', comTotal(0, { beneficiario: { usuarioId: 999, nome: 'Ninguém', email: '' } }));
  eq([nada.status, nada.corpo.ok, /não há comissão deste mês para cancelar/.test(nada.corpo.motivo), !!(await comissao('comissao-crm-2026-10-999')), !!(await um(`SELECT id FROM usuarios WHERE tenant_id = $1 AND external_id = 'crm_user_999'`, [ENTUR]))],
    [409, false, true, false, false], 'total zero sem comissão: recusa, nada criado (nem cadastro de pessoa)');
  const volta = await enviar(ENTUR, 'ev-bruno-3', comTotal(16000, { ...bruno, geradoEm: '2026-11-03T00:00:00.000Z' }));
  eq([volta.corpo.situacao, (await comissao(BRUNO)).status, (await conta(CP_BRUNO)).status, (await conta(CP_BRUNO)).data.valor_final], ['atualizada', 'CALCULADA', 'PENDENTE', 160], 'uma versão nova com valor faz a conta cancelada valer de novo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) conta que não é o ecossistema ---');
{
  const r = await enviar(AGENCIA, 'ev-agencia', extrato({ beneficiario: { usuarioId: 555, nome: 'Vendedora', email: 'v@agencia.com' } }));
  eq([r.status, r.corpo], [404, { ok: false, motivo: MOTIVO_FORA_DO_ECOSSISTEMA }], 'agência: 4xx com { ok: false, motivo }');
  eq([(await todos(`SELECT id FROM comissoes WHERE tenant_id = $1`, [AGENCIA])).length, (await todos(`SELECT id FROM contas_pagar WHERE tenant_id = $1`, [AGENCIA])).length, (await todos(`SELECT id FROM usuarios WHERE tenant_id = $1`, [AGENCIA])).length],
    [0, 0, 0], 'nada gravado na agência (nem cadastro de pessoa)');
  eq([(await entrada('ev-agencia', AGENCIA)).status, (await entrada('ev-agencia', AGENCIA)).erro], ['ERRO', `Recusado: ${MOTIVO_FORA_DO_ECOSSISTEMA}`], 'a recusa fica registrada com o motivo');

  const payload = extrato({ beneficiario: { usuarioId: 600, nome: 'Carla CS', email: 'carla@entur.com.br' } });
  const antes = await enviar(NOVA, 'ev-nova', payload);
  eq(antes.status, 404, 'a conta nova ainda é agência: recusada');
  await query(`UPDATE tenants SET data = '{"perfil":"ecossistema"}' WHERE id = $1`, [NOVA]);
  const nasFaixas = await enviar(NOVA, 'ev-nova', payload);
  eq([nasFaixas.status, nasFaixas.corpo], [409, { ok: false, motivo: MOTIVO_FONTE_DAS_FAIXAS }], 'ecossistema com a fonte padrão (as faixas): o extrato do CRM é recusado, para não pagar duas vezes');
  eq([(await todos(`SELECT id FROM comissoes WHERE tenant_id = $1`, [NOVA])).length, (await todos(`SELECT id FROM contas_pagar WHERE tenant_id = $1`, [NOVA])).length], [0, 0], 'e nada é gravado');
  await trocarFonteDaComissao(pool, NOVA, 'crm');
  const depois = await enviar(NOVA, 'ev-nova', payload);
  eq([depois.status, depois.corpo.situacao, (await entrada('ev-nova', NOVA)).processado], [200, 'criada', true], 'virou ecossistema e a fonte passou ao CRM: a MESMA entrega é aceita');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (f) payload inválido ---');
{
  const base = { beneficiario: { usuarioId: 777, nome: 'Dani', email: 'dani@entur.com.br' } };
  const casos = [
    [{ ...base, totalCents: 29999 }, 'Os números não fecham: brutoCents menos compensadoCents precisa dar totalCents.'],
    [{ ...base, competencia: '10/2026' }, 'A competência precisa estar no formato AAAA-MM (ex.: 2026-11).'],
    [{ beneficiario: null }, 'Falta o beneficiário (usuarioId, nome e email).'],
    [{ ...base, brutoCents: '350' }, 'brutoCents precisa ser um número inteiro de centavos.'],
  ];
  for (const [p, motivo] of casos) {
    const r = await enviar(ENTUR, 'ev-dani', extrato(p));
    eq([r.status, r.corpo], [400, { ok: false, motivo }], `recusa 400: ${motivo}`);
  }
  const trocado = await chamar(ENTUR, { id: 'ev-dani', tipo: 'COMISSAO_DO_MES', payload: { ...extrato(base), eventId: 'outro-id' } });
  eq([trocado.status, trocado.corpo.ok], [400, false], 'eventId do payload diferente do id do evento: 400');
  eq(!!(await comissao('comissao-crm-2026-10-777')), false, 'nada gravado com o extrato inválido');
  const certo = await enviar(ENTUR, 'ev-dani', comTotal(10000, base));
  eq([certo.status, certo.corpo.situacao], [200, 'criada'], 'o CRM corrige e manda o MESMO id: entra');
  const semAssinatura = await chamar(ENTUR, { id: 'ev-x', tipo: 'COMISSAO_DO_MES', payload: extrato() }, 'assinatura-errada');
  eq(semAssinatura.status, 401, 'sem a assinatura do CRM nada passa (401)');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (g) paga: COMISSAO_PAGA na fila, uma vez só ---');
const DANI = 'comissao-crm-2026-10-777', CP_DANI = 'cp-comissao-comissao-crm-2026-10-777';
const BIA = 'comissao-crm-2026-10-888', CP_BIA = 'cp-comissao-comissao-crm-2026-10-888';
{
  let fila = await saida();
  eq(fila.map(x => [x.id, x.status]), [[`comissao-paga:${ENTUR}:${CP_LUAN}`, 'PENDENTE']], 'a liquidação total do Luan pôs UM aviso na fila de saída');
  const ordenar = o => Object.fromEntries(Object.entries(o ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  eq(ordenar(fila[0].data.payload), ordenar({ competencia: COMP, usuarioId: 420008, eventIdOrigem: 'ev-luan-2', pagoEm: '2026-11-10', valorPagoCents: 40000 }),
    'o aviso: competência, usuarioId, eventId de origem (a versão que vale), data e valor pago em centavos');
  eq([fila[0].data.tipo, fila[0].data.id, fila[0].data.origem], ['COMISSAO_PAGA', `comissao-paga:${ENTUR}:${CP_LUAN}`, 'entur-os'], 'no envelope de sempre da fila de saída');
  eq([(await comissao(LUAN)).status, (await comissao(LUAN)).data.data_pagamento], ['PAGA', '2026-11-10'], 'a comissão passa a constar como paga');

  // Parcial não avisa; o resto avisa uma vez.
  await liquidar(ENTUR, CP_DANI, 40);
  eq([(await conta(CP_DANI)).status, (await saida()).length], ['PARCIAL', 1], 'baixa parcial: nada na fila');
  await liquidar(ENTUR, CP_DANI, 60, '2026-11-11');
  fila = await saida();
  const aviso = fila.find(x => x.id === `comissao-paga:${ENTUR}:${CP_DANI}`);
  eq([(await conta(CP_DANI)).status, fila.length, aviso?.data.payload.valorPagoCents, aviso?.data.payload.pagoEm], ['PAGO', 2, 10000, '2026-11-11'], 'quitou: um aviso, com o valor pago inteiro');

  // Estorno e nova baixa: ainda um aviso só por conta.
  const hist = (await historicoDaConta(pool, ENTUR, 'contas_pagar', CP_DANI)).filter(x => x.tipo === 'baixa');
  await emTransacao(exec => estornarBaixa(exec, { tenantId: ENTUR, usuarioNome: 'Ana' }, hist.at(-1).id, { motivo: 'lançado errado' }));
  eq((await conta(CP_DANI)).status, 'PARCIAL', 'o estorno volta a conta a parcial');
  await liquidar(ENTUR, CP_DANI, 60, '2026-11-12');
  eq([(await conta(CP_DANI)).status, (await saida()).filter(x => x.id.endsWith(CP_DANI)).length], ['PAGO', 1], 'paga de novo depois do estorno: continua UM aviso para a conta');

  // A tela antiga (PUT da conta a pagar) também avisa, uma vez.
  const bia = { beneficiario: { usuarioId: 888, nome: 'Bia', email: 'bia@entur.com.br' } };
  eq((await enviar(ENTUR, 'ev-bia', comTotal(5000, bia))).corpo.situacao, 'criada', 'Bia: criada');
  const cpBia = (await conta(CP_BIA)).data;
  const pagarPelaTela = () => emTransacao(exec => editarContaNoExecutor(exec, {
    tabela: 'contas_pagar', colunasIndice: ['fornecedor_id', 'status'], campo: 'valor_pago', sinal: -1, id: CP_BIA, tenantId: ENTUR,
    item: { ...cpBia, status: 'PAGO', valor_pago: 50, data_pagamento: '2026-11-10', conta_bancaria_id: `b-${ENTUR}` },
  }));
  await pagarPelaTela();
  eq([(await conta(CP_BIA)).status, (await saida()).filter(x => x.id.endsWith(CP_BIA)).length], ['PAGO', 1], 'paga pela tela antiga: um aviso');
  const cpBiaPaga = (await conta(CP_BIA)).data;
  await emTransacao(exec => editarContaNoExecutor(exec, {
    tabela: 'contas_pagar', colunasIndice: ['fornecedor_id', 'status'], campo: 'valor_pago', sinal: -1, id: CP_BIA, tenantId: ENTUR,
    item: { ...cpBiaPaga, observacoes: 'comprovante conferido', conta_bancaria_id: `b-${ENTUR}` },
  }));
  eq((await saida()).filter(x => x.id.endsWith(CP_BIA)).length, 1, 'editar a conta paga não avisa de novo');
  eq(await emTransacao(exec => avisarComissaoPaga(exec, ENTUR, CP_BIA)), false, 'chamar o gancho de novo não põe outro aviso');
  eq(await emTransacao(exec => avisarComissaoPaga(exec, ENTUR, 'cp-qualquer')), false, 'conta que não é de comissão do CRM: nada');

  // O agendador manda, assinado; os outros pendentes da conta ficam.
  await query(`INSERT INTO crm_eventos_saida (id, tipo, status, data, tenant_id) VALUES ('ev-velho', 'COMISSAO_APURADA', 'PENDENTE', '{"id":"ev-velho"}'::jsonb, $1)`, [ENTUR]);
  eq(await tarefaComissaoPagaAoCrm.agencias(ctxDaTarefa), [ENTUR, NOVA, OUTRA], 'a tarefa só olha as contas do ecossistema');
  const envio = await tarefaComissaoPagaAoCrm.executar(ctxDaTarefa, ENTUR);
  eq([envio.repostos, envio.enviados, envio.falhas], [0, 3, 0], 'o agendador manda os 3 avisos da Entur');
  eq(recebidos.map(x => [x.caminho, x.tipo, x.assinaturaOk, x.assinaturaComCarimboOk]),
    [['/api/integracao-financeiro/webhook/150002', 'COMISSAO_PAGA', true, true], ['/api/integracao-financeiro/webhook/150002', 'COMISSAO_PAGA', true, true], ['/api/integracao-financeiro/webhook/150002', 'COMISSAO_PAGA', true, true]],
    'chegam ao CRM 150002, assinados (com e sem carimbo de tempo)');
  eq([(await saida()).every(x => x.status === 'ENVIADO'), (await um(`SELECT status FROM crm_eventos_saida WHERE id = 'ev-velho' AND tenant_id = $1`, [ENTUR])).status],
    [true, 'PENDENTE'], 'os avisos ficam ENVIADO; o evento antigo pendente da conta NÃO sai por aqui');
  const deNovo = await tarefaComissaoPagaAoCrm.executar(ctxDaTarefa, ENTUR);
  eq([deNovo.enviados, recebidos.length], [0, 3], 'rodar de novo não manda nada duas vezes');

  // O aviso que, por algum caminho, não entrou na fila é reposto.
  await query(`DELETE FROM crm_eventos_saida WHERE id = $1 AND tenant_id = $2`, [`comissao-paga:${ENTUR}:${CP_BIA}`, ENTUR]);
  modoDoCrm = 'erro';
  const reposto = await tarefaComissaoPagaAoCrm.executar(ctxDaTarefa, ENTUR);
  const linha = (await saida()).find(x => x.id.endsWith(CP_BIA));
  eq([reposto.repostos, reposto.falhas, linha?.status, linha?.tentativas], [1, 1, 'FALHA', 1], 'conta paga sem aviso: reposto; o CRM fora do ar deixa o aviso em FALHA');
  modoDoCrm = 'ok';
  const cedo = await tarefaComissaoPagaAoCrm.executar(ctxDaTarefa, ENTUR);
  eq(cedo.enviados, 0, 'a nova tentativa espera o intervalo');
  await query(`UPDATE crm_eventos_saida SET proxima_tentativa = NOW() - INTERVAL '1 minute' WHERE id = $1 AND tenant_id = $2`, [`comissao-paga:${ENTUR}:${CP_BIA}`, ENTUR]);
  const tarde = await tarefaComissaoPagaAoCrm.executar(ctxDaTarefa, ENTUR);
  eq([tarde.enviados, (await saida()).find(x => x.id.endsWith(CP_BIA))?.status], [1, 'ENVIADO'], 'vencido o intervalo, sai');
  eq(await reporAvisosDeComissaoPaga(pool, ENTUR), 0, 'nada mais a repor');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (h) a geração por faixas recusa na conta ecossistema ---');
{
  const apuracao = { mes: COMP, vendedores: [], foraDasMetas: { mrr: 0, itens: [] }, semVendedor: { mrr: 0, contas: [] }, semCadastro: [], total: { mrr: 0, mrr_nas_metas: 0, comissao: 0 } };
  eq(await fonteDaComissao(pool, ENTUR), 'crm', 'a fonte da comissão da Entur foi trocada para o CRM');
  const e = await falha(gerarComissoesMrr(pool, ENTUR, apuracao, '2026-11-05'));
  eq([e?.nome, e?.status, e?.msg], ['ComissaoVemDoCrm', 409, 'A comissão agora vem do CRM (Área Comercial). As metas de MRR seguem só para acompanhamento.'], 'gerar por faixas recusa com o texto combinado');
  eq(e?.msg, AVISO_COMISSAO_VEM_DO_CRM, 'o mesmo texto que a tela mostra');
  await query(`UPDATE tenants SET data = data || '{"fonte_da_comissao":"mrr"}'::jsonb WHERE id = $1`, [ENTUR]);
  const ok = await gerarComissoesMrr(pool, ENTUR, apuracao, '2026-11-05');
  eq([await fonteDaComissao(pool, ENTUR), ok.gravadas], ['mrr', 0], 'com a fonte trocada para "mrr", as faixas voltam a gerar');
  await query(`UPDATE tenants SET data = data - 'fonte_da_comissao' WHERE id = $1`, [ENTUR]);
  eq(await fonteDaComissao(pool, ENTUR), 'mrr', 'sem a fonte gravada, a comissão sai das faixas (o padrão desde 06/11/2026)');
  await trocarFonteDaComissao(pool, ENTUR, 'crm');
  eq(await fonteDaComissao(pool, ENTUR), 'crm', 'a troca grava a fonte CRM de volta');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (i) tenant_id em toda consulta nova; uma conta nunca mexe na outra ---');
{
  // Mesmo id de evento e mesmo e-mail em outra conta do ecossistema.
  const outro = await enviar(OUTRA, 'ev-luan-1', comTotal(7000, { beneficiario: { usuarioId: 31, nome: 'Luan (outra)', email: 'luan@entur.com.br' } }));
  eq([outro.status, outro.corpo.situacao], [200, 'criada'], 'o mesmo eventId em outra conta é outro evento');
  eq([(await comissao('comissao-crm-2026-10-31', OUTRA)).vendedor_id, (await comissao('comissao-crm-2026-10-31', ENTUR))], ['u-luan-outra', undefined], 'a pessoa achada é a da própria conta');
  const invasao = await enviar(OUTRA, 'ev-invade', comTotal(1, { beneficiario: { usuarioId: 420008, nome: 'Luan Amador', email: 'luan@entur.com.br' }, geradoEm: '2026-11-09T00:00:00.000Z' }));
  eq([invasao.status, invasao.corpo.ok], [409, false], 'outra conta não regrava a comissão da Entur pelo id');
  eq([(await comissao(LUAN)).data.valor_comissao, (await comissao(LUAN)).status, (await conta(CP_LUAN)).status], [400, 'PAGA', 'PAGO'], 'a comissão da Entur ficou intacta');
  await liquidar(OUTRA, 'cp-comissao-comissao-crm-2026-10-31', 70);
  eq([(await saida(OUTRA)).length, (await saida(OUTRA))[0]?.id], [1, `comissao-paga:${OUTRA}:cp-comissao-comissao-crm-2026-10-31`], 'o aviso da outra conta nasce na fila dela');
  const daEntur = await tarefaComissaoPagaAoCrm.executar(ctxDaTarefa, ENTUR);
  eq([daEntur.enviados, (await saida(OUTRA))[0]?.status], [0, 'PENDENTE'], 'o agendador da Entur não manda o aviso da outra conta');

  // Leitura das consultas novas: toda que toca tabela de negócio filtra tenant_id.
  const fonte = await readFile(new URL('../src/lib/comissao-do-crm-servidor.ts', import.meta.url), 'utf8');
  const integracao = await readFile(new URL('../src/lib/crm-integration.ts', import.meta.url), 'utf8');
  const rotaMrr = await readFile(new URL('../src/app/api/comissao-mrr/route.ts', import.meta.url), 'utf8');
  const trecho = (txt, de, ate) => txt.slice(txt.indexOf(de), txt.indexOf(ate, txt.indexOf(de)));
  const blocos = [
    ['comissao-do-crm-servidor.ts', fonte],
    ['crm-integration.ts (COMISSAO_DO_MES)', trecho(integracao, 'case TIPO_COMISSAO_DO_MES', 'default:')],
    ['crm-integration.ts (enviarEventosDaFila)', trecho(integracao, 'export async function enviarEventosDaFila', 'reprocessarVendasLegadas')],
    ['api/comissao-mrr (extratos do CRM)', trecho(rotaMrr, 'fonteDaComissao(ctx.exec, ctx.tenantId),', ']);')],
  ];
  const TABELAS = /\b(comissoes|contas_pagar|crm_eventos_saida|crm_eventos_entrada|usuarios|membros)\b/;
  const semTenant = [];
  let consultas = 0;
  for (const [nome, txt] of blocos) {
    for (const m of txt.matchAll(/`([^`]*)`/g)) {
      const sql = m[1];
      if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(sql) || !TABELAS.test(sql)) continue;
      consultas++;
      if (!/tenant_id/.test(sql)) semTenant.push(`${nome}: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  eq([consultas >= 10, semTenant], [true, []], `as ${consultas} consultas novas em tabelas de negócio filtram tenant_id`);
}

servidor.close();
console.log(`\n${total - falhas}/${total} testes da comissão do CRM (banco) passaram`);
if (falhas > 0) process.exit(1);
