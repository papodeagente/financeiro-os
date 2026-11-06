/**
 * Fechamento da E7, frente B (06/11/2026): portal do cliente, envio por
 * e-mail com a fatura e resumo de vencimentos pelo WhatsApp, contra um
 * Postgres real (PGlite), chamando as ROTAS de produção com provedor FALSO
 * (sem rede).
 *
 * O que se prova:
 *   (1) PORTAL · notas fiscais: o cliente vê só as notas AUTORIZADAS dele
 *       (nunca a de outro cliente, de outra agência, a do fornecedor, a
 *       rascunho ou a cancelada); o arquivo pelo portal é 404 para nota de
 *       outro cliente e 409 quando o emissor não guardou o arquivo;
 *   (2) PORTAL · 2ª via pelo cliente: só boleto vencido sem o link atualizado
 *       do provedor; valor com juros e multa da política até o próximo dia
 *       útil; idempotente (pedir de novo não gera outra); "nada sai" recusa;
 *       limite por link; conta de outro cliente: 404; o pagamento entra na
 *       baixa com juros e multa separados;
 *   (3) PORTAL · documento da fatura: só fatura FECHADA do cliente do link,
 *       recortada (sem ids internos, documento mascarado);
 *   (4) ENVIO com a escolha Boleto / Fatura / Boleto e fatura: sem a escolha,
 *       o payload ao CRM é o de antes (sem campo novo); com Fatura, o link do
 *       documento pelo portal; cobrança que não é de fatura recusa; WhatsApp
 *       com fatura recusa; a ficha da fatura sem boleto manda só a fatura;
 *   (5) AVISO pelo WhatsApp para a equipe: desligado não muda nada (o sino
 *       segue igual); ligado manda UM evento por dia com o resumo; "nada sai"
 *       segura; configuração recusa número inválido.
 *
 * Uso: node --no-warnings scripts/test-sql-portal-e7b.mjs
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

process.env.INTEGRACOES_MASTER_KEY = 'c'.repeat(64);
process.env.PUBLIC_APP_URL = 'https://fin.exemplo.com';

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE clientes (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (tenant_id, id));
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE notas_fiscais (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_receber_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RASCUNHO', referencia_gateway TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, usuario_id TEXT, acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-portal-e7b';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { FATURA_SCHEMA_SQL } = await import('../src/lib/fatura-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { CREDITO_CLIENTE_SCHEMA_SQL } = await import('../src/lib/credito-cliente-servidor.ts');
for (const sql of [PERMISSOES_SCHEMA_SQL, BAIXAS_SCHEMA_SQL, PERIODO_SCHEMA_SQL, COBRANCA_SCHEMA_SQL, FATURA_SCHEMA_SQL, RAZAO_SCHEMA_SQL, NOTIFICACOES_SCHEMA_SQL, CREDITO_CLIENTE_SCHEMA_SQL]) await pg.exec(sql);

const P = await import('../src/lib/permissoes-servidor.ts');
const { limparLimitePublicoParaTeste } = await import('../src/lib/limite-publico.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { criarLink } = await import('../src/lib/cobranca/portal-servidor.ts');
const srv = await import('../src/lib/cobranca/servidor.ts');
const { comNadaSai } = await import('../src/lib/nada-sai.ts');
const { aplicarAviso } = await import('../src/lib/cobranca/aviso.ts').catch(() => ({}));
const { avisarVencimentos } = await import('../src/lib/avisos-vencimento-servidor.ts');
const RPortal = await import('../src/app/api/portal/[token]/route.ts');
const RNota = await import('../src/app/api/portal/[token]/nota/[id]/route.ts');
const RSegunda = await import('../src/app/api/portal/[token]/segunda-via/route.ts');
const RFaturaPortal = await import('../src/app/api/portal/[token]/faturas/[id]/route.ts');
const REnviar = await import('../src/app/api/cobrancas/[id]/enviar/route.ts');
const REnviarFatura = await import('../src/app/api/faturas/[id]/enviar/route.ts');
const RConfig = await import('../src/app/api/config/financeiro/route.ts');
void aplicarAviso;

const T = 'ag-1', T2 = 'ag-2';
const HOJE = srv.hojeEmBrasilia();
const { addDias } = await import('../src/lib/money.ts');
const D = n => addDias(HOJE, n);
const um = async (sql, v) => (await query(sql, v)).rows[0];
const todos = async (sql, v) => (await query(sql, v)).rows;
const sessao = (perfil, t = T) => ({ userId: `u-${perfil}-${t}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: t, tenantSlug: t });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo, cab = {}) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json', 'x-real-ip': '10.0.0.9', ...cab },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json().catch(() => null) });
const tokenDe = c => String(c ?? '').split('/c/')[1] ?? '';
const eventosCrm = async (t, tipo) => (await todos(`SELECT id, data FROM crm_eventos_saida WHERE tenant_id = $1 AND tipo = $2 ORDER BY created_at, id`, [t, tipo]));

// Fetch de verdade proibido (o CRM "não responde": o envio fica na fila).
globalThis.fetch = async url => { throw new Error(`rede de verdade proibida no teste: ${url}`); };

// ---------------------------------------------------------------------------
// Cadastro: agência 1 (Ana, Bruno), agência 2 (cliente com o MESMO id da Ana).
for (const [id, t] of [['u-ADMIN-ag-1', T], ['u-ADMIN-ag-2', T2]]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, t, JSON.stringify({ id, nome: id, perfil: 'ADMIN', ativo: true })]);
}
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('a1', $1, $2), ('a2', $3, '{"nome_fantasia":"Outra"}')`, [
  T, JSON.stringify({ nome_fantasia: 'Boas Viagens', telefone: '(11) 98888-7777', politica_cobranca: { juros_am_pct: 3, multa_pct: 2, tolerancia_dias: 0 }, cobranca: { provedor_padrao: 'asaas' } }), T2,
]);
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data, external_id) VALUES
  ('cli-a', $1, 'Ana Souza', '12345678909', '{"nome":"Ana Souza","email":"ana@exemplo.com"}', 'crm_contact_7'),
  ('cli-b', $1, 'Bruno Lima', '98765432100', '{"nome":"Bruno Lima","email":"bruno@exemplo.com"}', 'crm_contact_8'),
  ('cli-a', $2, 'Ana de Outra', '11144477735', '{"nome":"Ana de Outra"}', NULL)`, [T, T2]);
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('c1', $1, '{"ativo":true,"webhook_url_crm":"https://crm.exemplo.com/webhook","api_key_crm":"k"}')`, [T]);
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('cb-1', $1, '{"nome":"Conta Asaas","saldo_inicial":0,"saldo_atual":0}')`, [T]);
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));
const cr = (t, id, cliente, d) => query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ($1, $2, $3, 'PENDENTE', $4)`,
  [id, t, cliente, JSON.stringify({ id, cliente_id: cliente, cliente_nome: cliente, descricao: `Pacote ${id}`, status: 'PENDENTE', valor_final: 1000, data_vencimento: D(-10), ...d })]);

const linkA = await criarLink(pool, T, 'cli-a', 'u-ADMIN-ag-1');
const linkB = await criarLink(pool, T, 'cli-b', 'u-ADMIN-ag-1');
const linkOutra = await criarLink(pool, T2, 'cli-a', 'u-ADMIN-ag-2');
const tokA = tokenDe(linkA.caminho), tokB = tokenDe(linkB.caminho), tokOutra = tokenDe(linkOutra.caminho);
const portal = async tok => { limparLimitePublicoParaTeste?.(); return json(await RPortal.GET(req(`/api/portal/${tok}`), { params: Promise.resolve({ token: tok }) })); };

// ---------------------------------------------------------------------------
console.log('--- (1) Portal: notas fiscais ---');
const nota = (id, t, cliente, status, d = {}) => query(`INSERT INTO notas_fiscais (id, tenant_id, cliente_id, status, data) VALUES ($1, $2, $3, $4, $5)`,
  [id, t, cliente, status, JSON.stringify({ id, numero: id.toUpperCase(), status, valor_servicos: 300, autorizada_em: `${D(-3)}T10:00:00Z`, link_pdf: 'https://emissor/pdf', link_xml: 'https://emissor/xml', ...d })]);
await nota('nf-a1', T, 'cli-a', 'AUTORIZADA');
await nota('nf-a2', T, 'cli-a', 'AUTORIZADA', { link_pdf: '', link_xml: '', emitida_fora: true });
await nota('nf-a3', T, 'cli-a', 'CANCELADA');
await nota('nf-a4', T, 'cli-a', 'RASCUNHO');
await nota('nf-a5', T, 'cli-a', 'AUTORIZADA', { destino: 'FORNECEDOR' });
await nota('nf-b1', T, 'cli-b', 'AUTORIZADA');
await nota('nf-outra', T2, 'cli-a', 'AUTORIZADA');
let r = await portal(tokA);
eq(r.status, 200, 'portal abre');
eq(r.corpo.notas.map(n => [n.ref, n.numero, n.tem_pdf, n.tem_xml]).sort(), [['nf-a1', 'NF-A1', true, true], ['nf-a2', 'NF-A2', false, false]], 'só as autorizadas da Ana (nunca a do Bruno, de outra agência, do fornecedor, cancelada ou rascunho)');
eq(Object.keys(r.corpo.notas[0]).sort(), ['emitida_em', 'numero', 'ref', 'tem_pdf', 'tem_xml', 'valor'], 'nota no portal: só os campos da lista (sem link do emissor)');
eq(JSON.stringify(r.corpo).includes('emissor/pdf'), false, 'o link cru do emissor nunca chega ao navegador');
const arquivo = async (tok, id, tipo = 'pdf') => { limparLimitePublicoParaTeste?.(); return json(await RNota.GET(req(`/api/portal/${tok}/nota/${id}?tipo=${tipo}`), { params: Promise.resolve({ token: tok, id }) })); };
eq((await arquivo(tokA, 'nf-b1')).status, 404, 'arquivo da nota de outro cliente: 404');
eq((await arquivo(tokA, 'nf-outra')).status, 404, 'arquivo da nota de outra agência: 404');
eq((await arquivo(tokA, 'nf-a3')).status, 404, 'arquivo da nota cancelada pelo portal: 404');
eq((await arquivo(tokA, 'nf-a5')).status, 404, 'arquivo da nota do fornecedor: 404');
eq((await arquivo(tokA, 'nf-a2')).status, 409, 'nota sem arquivo guardado: 409 (peça à agência)');
eq((await arquivo(tokA, 'nf-a1', 'exe')).status, 400, 'tipo de arquivo fora de pdf/xml: 400');
eq((await portal(tokOutra)).corpo.notas.map(n => n.ref), ['nf-outra'], 'a outra agência vê só a dela');

// ---------------------------------------------------------------------------
console.log('--- (2) Portal: 2ª via pelo cliente ---');
const chamadas = { alterar: [], emitir: 0 };
const adapterFalso = {
  provedor: 'asaas', nome: 'Asaas', capacidades: { boletoComPix: true, carne: true, jurosMulta: true, desconto: true, link: true, estornoPix: true },
  async acharOuCriarCliente() { return 'cus_1'; },
  async emitir(_c, _cli, p) { chamadas.emitir++; return { id_externo: `pay_${chamadas.emitir}`, status: 'aberta', valor_centavos: p.valor_centavos, vencimento: p.vencimento, referencia: p.referencia, id_carne: '', numero_parcela: 0, url_boleto: 'https://b/1', url_fatura: '', bruto: {} }; },
  async consultar() { return null; }, async consultarPorReferencia() { return null; },
  async dadosDePagamento(c) { return { linha_digitavel: `34191.79001 ${c.vencimento}`, codigo_barras: '', pix_copia_cola: `000201PIX${c.valor_centavos}`, pix_qrcode_url: '', url_boleto: c.url_boleto, url_fatura: '' }; },
  async alterar(id, m) { chamadas.alterar.push({ id, ...m }); return { id_externo: id, status: 'aberta', valor_centavos: m.valor_centavos, vencimento: m.vencimento, referencia: '', id_carne: '', numero_parcela: 0, url_boleto: 'https://b/2', url_fatura: '', bruto: {} }; },
  async cancelar() {},
};
srv.definirFabricaDeAdapter(async () => adapterFalso);
await cr(T, 'cr-venc', 'cli-a', { valor_final: 1000, data_vencimento: D(-10) });
await cr(T, 'cr-link', 'cli-a', { valor_final: 500, data_vencimento: D(-5) });
await cr(T, 'cr-bruno', 'cli-b', { valor_final: 700, data_vencimento: D(-5) });
const cob = (id, conta, cliente, d) => query(
  `INSERT INTO cobrancas (id, tenant_id, titulo_tabela, titulo_id, cliente_id, provedor, id_externo, referencia, tipo, status, valor_centavos, vencimento, linha_digitavel, pix_copia_cola, url_boleto, url_fatura, conta_bancaria_id)
   VALUES ($1, $2, 'contas_receber', $3, $4, 'asaas', $5, $6, $7, $8, $9, $10, 'linha', 'pix', 'https://b/0', $11, 'cb-1')`,
  [id, T, conta, cliente, `pay_${id}`, `f1;${T};${id}`, d.tipo ?? 'boleto_pix', d.status ?? 'vencida', d.valor ?? 100000, d.venc ?? D(-10), d.url_fatura ?? '']);
await cob('cob-venc', 'cr-venc', 'cli-a', {});
await cob('cob-link', 'cr-link', 'cli-a', { valor: 50000, venc: D(-5), url_fatura: 'https://asaas/i/1' });
await cob('cob-bruno', 'cr-bruno', 'cli-b', { valor: 70000, venc: D(-5) });
r = await portal(tokA);
const itemVenc = r.corpo.em_aberto.find(i => i.ref === 'cr-venc');
const itemLink = r.corpo.em_aberto.find(i => i.ref === 'cr-link');
const { vencimentoDaSegundaVia } = await import('../src/lib/cobranca/portal-regras.ts');
const novoVenc = vencimentoDaSegundaVia(HOJE);
const diasAtraso = Math.round((Date.parse(`${novoVenc}T12:00:00Z`) - Date.parse(`${D(-10)}T12:00:00Z`)) / 86400000);
const juros = Math.round(1000 * 0.03 / 30 * diasAtraso * 100) / 100;
eq(itemVenc.cobranca.segunda_via, { vencimento: novoVenc, valor: Math.round((1000 + juros + 20) * 100) / 100, juros, multa: 20 }, 'vencido sem o link atualizado: a 2ª via aparece com juros e multa da política até o próximo dia útil');
eq(itemLink.cobranca.segunda_via, null, 'com o link do provedor (valor atualizado): sem 2ª via aqui');
const segunda = async (tok, conta, ip = '10.0.0.9') => {
  limparLimitePublicoParaTeste?.();
  return json(await RSegunda.POST(req(`/api/portal/${tok}/segunda-via`, 'POST', { conta }, { 'x-real-ip': ip }), { params: Promise.resolve({ token: tok }) }));
};
eq((await segunda(tokA, 'cr-bruno')).status, 404, 'conta de outro cliente: 404 (nada muda)');
eq((await segunda(tokOutra, 'cr-venc')).status, 404, 'link de outra agência: 404');
eq((await segunda(tokA, 'cr-link')).corpo.codigo, 'SEM_SEGUNDA_VIA', 'com o link atualizado do provedor: não gera');
const naoJson = await RSegunda.POST(new Request(`http://localhost/api/portal/${tokA}/segunda-via`, { method: 'POST', body: 'conta=cr-venc' }), { params: Promise.resolve({ token: tokA }) });
eq(naoJson.status, 415, 'formulário de outro site (sem JSON): 415');
let rNadaSai;
await comNadaSai('teste', async () => { rNadaSai = await segunda(tokA, 'cr-venc'); });
eq([rNadaSai.status, rNadaSai.corpo.codigo, chamadas.alterar.length], [409, 'NADA_SAI', 0], 'nada sai: recusa sem chamar o provedor');
eq((await um(`SELECT dados->>'portal_2via' AS r FROM cobrancas WHERE id = 'cob-venc'`)).r, null, 'a reserva do dia é desfeita quando não sai');
r = await segunda(tokA, 'cr-venc');
eq([r.status, r.corpo.gerada, r.corpo.vencimento, r.corpo.valor], [200, true, novoVenc, itemVenc.cobranca.segunda_via.valor], '2ª via gerada pelo cliente com o valor atualizado');
eq(chamadas.alterar.map(c => [c.id, c.vencimento, c.valor_centavos]), [['pay_cob-venc', novoVenc, Math.round(itemVenc.cobranca.segunda_via.valor * 100)]], 'pelo caminho da 2ª via de sempre (alterar no provedor), uma chamada');
const depois = await um(`SELECT status, vencimento::text AS v, valor_centavos::int AS c, dados FROM cobrancas WHERE id = 'cob-venc'`);
eq([depois.status, depois.v, depois.dados.encargos_segunda_via], ['aberta', novoVenc, { base_centavos: 100000, juros_centavos: Math.round(juros * 100), multa_centavos: 2000 }], 'cobrança aberta de novo, com juros e multa guardados para a baixa');
r = await segunda(tokA, 'cr-venc');
eq([r.status, r.corpo.gerada, chamadas.alterar.length], [200, false, 1], 'pedir de novo no mesmo dia não gera outra (idempotente)');
const ev = await todos(`SELECT tipo, usuario_nome, detalhe FROM cobranca_eventos WHERE cobranca_id = 'cob-venc' AND tipo = 'segunda_via_portal'`);
eq([ev.length, ev[0]?.usuario_nome, ev[0]?.detalhe.link_id ? 'tem' : 'não'], [1, 'Cliente pelo portal', 'tem'], 'fica no histórico da cobrança: quem (o cliente pelo portal) e por qual link');
// Limite por link: 3 por 24 h.
for (let i = 1; i <= 2; i++) {
  await cr(T, `cr-l${i}`, 'cli-a', { valor_final: 100, data_vencimento: D(-3) });
  await cob(`cob-l${i}`, `cr-l${i}`, 'cli-a', { valor: 10000, venc: D(-3) });
  await segunda(tokA, `cr-l${i}`);
}
await cr(T, 'cr-l3', 'cli-a', { valor_final: 100, data_vencimento: D(-3) });
await cob('cob-l3', 'cr-l3', 'cli-a', { valor: 10000, venc: D(-3) });
r = await segunda(tokA, 'cr-l3');
eq([r.status, r.corpo.codigo], [429, 'LIMITE_DO_PORTAL'], 'limite por link: a 4ª 2ª via do dia é recusada');

// O pagamento da 2ª via: juros e multa separados na baixa.
const { encargosDaSegundaVia } = await import('../src/lib/cobranca/aviso.ts');
eq(encargosDaSegundaVia({ juros_centavos: 450, multa_centavos: 2000 }, 0), { juros: 4.5, multa: 20 }, 'a baixa do aviso usa os juros e a multa da 2ª via');
eq(encargosDaSegundaVia({ juros_centavos: 450, multa_centavos: 2000 }, 3), { juros: 0, multa: 0 }, 'se o provedor já mandou juros, não conta duas vezes');

// ---------------------------------------------------------------------------
console.log('--- (3) Portal: documento da fatura ---');
const fatura = async (id, numero, cliente, situacao, titulo) => {
  await query(`INSERT INTO faturas (tenant_id, id, numero, pessoa_id, pessoa_nome, chave, vencimento, situacao, titulo_id, total_centavos, total_itens_centavos, observacoes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 150000, 150000, 'Pagar até o vencimento.')`, [T, id, numero, cliente, cliente === 'cli-a' ? 'Ana Souza' : 'Bruno Lima', `avulsa|${id}`, D(10), situacao, titulo]);
  await query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ($1, $2, $3, 'PENDENTE', $4)`,
    [titulo, T, cliente, JSON.stringify({ id: titulo, origem: 'FATURA', cliente_id: cliente, descricao: `Fatura Nº ${numero}`, status: 'PENDENTE', valor_final: 1500, data_vencimento: D(10), fatura_id: id, fatura_numero: numero, fatura_situacao: situacao })]);
};
await fatura('fat-1', 41, 'cli-a', 'FECHADA', 'cr-fat-1');
await fatura('fat-2', 42, 'cli-a', 'ABERTA', 'cr-fat-2');
await fatura('fat-3', 43, 'cli-b', 'FECHADA', 'cr-fat-3');
await fatura('fat-4', 44, 'cli-a', 'FECHADA', 'cr-fat-4');
const docFatura = async (tok, id) => { limparLimitePublicoParaTeste?.(); return json(await RFaturaPortal.GET(req(`/api/portal/${tok}/faturas/${id}`), { params: Promise.resolve({ token: tok, id }) })); };
r = await docFatura(tokA, 'fat-1');
eq([r.status, r.corpo.fatura.numero, r.corpo.sacado.documento, r.corpo.sacado.id], [200, 41, '***.456.789-**', ''], 'fatura fechada da Ana: abre, documento mascarado, sem id interno');
eq(Object.keys(r.corpo).sort(), ['cobranca', 'emitente', 'fatura', 'instrucoes', 'itens', 'notas', 'sacado', 'totais'], 'só os campos da folha');
eq(['regra', 'eventos', 'permissoes', 'pessoa_id', 'titulo_id'].filter(k => JSON.stringify(r.corpo).includes(`"${k}"`)), [], 'sem regra, histórico, permissões nem ids');
eq((await docFatura(tokA, 'fat-2')).status, 404, 'fatura aberta: 404');
eq((await docFatura(tokA, 'fat-3')).status, 404, 'fatura de outro cliente: 404');
eq((await docFatura(tokOutra, 'fat-1')).status, 404, 'link de outra agência: 404');

// ---------------------------------------------------------------------------
console.log('--- (4) Enviar por e-mail: Boleto / Fatura / Boleto e fatura ---');
como(sessao('ADMIN'));
await cob('cob-fat-1', 'cr-fat-1', 'cli-a', { status: 'aberta', valor: 150000, venc: D(10) });
const enviar = async (id, corpo, chave) => json(await REnviar.POST(req(`/api/cobrancas/${id}/enviar`, 'POST', corpo, chave ? { 'Idempotency-Key': chave } : {}), { params: Promise.resolve({ id }) }));
r = await enviar('cob-fat-1', { canal: 'email' }, 'k-0');
eq(r.status, 200, 'sem escolha: envia como sempre');
let ev4 = await eventosCrm(T, 'COBRANCA_ENVIAR');
eq(['documentos', 'fatura_documento'].filter(k => k in ev4.at(-1).data.payload), [], 'sem escolha: o payload ao CRM não ganha campo novo (o e-mail de sempre)');
r = await enviar('cob-fat-1', { canal: 'email', documentos: 'boleto_e_fatura' }, 'k-1');
ev4 = await eventosCrm(T, 'COBRANCA_ENVIAR');
const p4 = ev4.at(-1).data.payload;
eq([r.status, p4.documentos, p4.fatura_documento.numero, p4.fatura_documento.url.startsWith('https://fin.exemplo.com/c/'), p4.fatura_documento.url.endsWith('/fatura/fat-1')],
  [200, 'boleto_e_fatura', 41, true, true], 'boleto e fatura: o link do documento pelo portal do cliente');
eq(tokenDe(p4.fatura_documento.url).split('/fatura/')[0], tokA, 'o link é o MESMO portal do cliente (não cria outro)');
r = await enviar('cob-venc', { canal: 'email', documentos: 'fatura' }, 'k-2');
eq([r.status, r.corpo.error], [409, 'Esta cobrança não é de uma fatura. Escolha "Boleto".'], 'cobrança que não é de fatura: recusa a escolha Fatura');
r = await enviar('cob-fat-1', { canal: 'whatsapp', documentos: 'fatura' }, 'k-3');
eq(r.status, 400, 'WhatsApp com fatura: recusa (a fatura vai por e-mail)');
r = await enviar('cob-fat-1', { canal: 'email', documentos: 'tudo' }, 'k-4');
eq(r.status, 400, 'escolha desconhecida: 400');
// Ficha da fatura sem boleto: só a fatura.
const enviarFatura = async (id, corpo, chave) => json(await REnviarFatura.POST(req(`/api/faturas/${id}/enviar`, 'POST', corpo, chave ? { 'Idempotency-Key': chave } : {}), { params: Promise.resolve({ id }) }));
r = await enviarFatura('fat-4', { documentos: 'boleto' }, 'f-1');
eq([r.status, r.corpo.error], [409, 'Esta fatura não tem boleto em aberto. Envie só a fatura, ou gere o boleto em "Fechar e cobrar".'], 'fatura sem boleto: boleto não dá');
const antes = (await eventosCrm(T, 'COBRANCA_ENVIAR')).length;
r = await enviarFatura('fat-4', { documentos: 'fatura', copia_para: 'fin@cliente.com' }, 'f-2');
const pf = (await eventosCrm(T, 'COBRANCA_ENVIAR')).at(-1).data.payload;
eq([r.status, r.corpo.com_boleto, pf.cobranca_id, pf.documentos, pf.fatura_documento.numero, pf.copia_para, pf.canal, pf.descricao],
  [200, false, 'fatura:fat-4', 'fatura', 44, ['fin@cliente.com'], 'email', 'Fatura Nº 44'], 'só a fatura: pedido de envio no modo fatura, com cópia');
r = await enviarFatura('fat-4', { documentos: 'fatura' }, 'f-2');
eq([r.corpo.repetido, (await eventosCrm(T, 'COBRANCA_ENVIAR')).length], [true, antes + 1], 'a mesma chave não manda duas vezes');
eq((await um(`SELECT COUNT(*)::int AS n FROM fatura_eventos WHERE fatura_id = 'fat-4' AND tipo = 'enviada_por_email'`)).n, 1, 'fica no histórico da fatura');
r = await enviarFatura('fat-1', { documentos: 'fatura' }, 'f-3');
eq([r.status, r.corpo.com_boleto, (await eventosCrm(T, 'COBRANCA_ENVIAR')).at(-1).data.payload.cobranca_id], [200, false, 'cob-fat-1'], 'fatura com boleto em aberto: vai pelo envio da cobrança');
eq((await enviarFatura('fat-2', { documentos: 'fatura' }, 'f-4')).status, 409, 'fatura aberta: feche antes de enviar');
como(sessao('VENDEDOR'));
eq((await enviarFatura('fat-4', { documentos: 'fatura' }, 'f-5')).status, 403, 'sem o direito de emitir boletos: 403');
como(sessao('ADMIN'));

// ---------------------------------------------------------------------------
console.log('--- (5) Resumo de vencimentos pelo WhatsApp ---');
await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('cp-1', $1, 'PENDENTE', $2), ('cp-2', $1, 'PENDENTE', $3)`, [T,
  JSON.stringify({ descricao: 'Hotel Lisboa', fornecedor_nome: 'Operadora X', status: 'PENDENTE', valor_final: 800, data_vencimento: HOJE }),
  JSON.stringify({ descricao: 'Aéreo', status: 'PENDENTE', valor_final: 200, data_vencimento: D(-2) })]);
const agora = new Date(`${HOJE}T13:00:00Z`);
let res = await avisarVencimentos(pool, T, agora);
eq('whatsapp' in res, false, 'desligado: o resultado é o de sempre (sem WhatsApp)');
eq((await eventosCrm(T, 'FINANCEIRO_AVISO_VENCIMENTOS')).length, 0, 'desligado: nada vai ao CRM');
const put = async corpo => json(await RConfig.PUT(req('/api/config/financeiro', 'PUT', corpo)));
r = await put({ avisos_vencimento_whatsapp: { ligado: true, telefones: [{ nome: 'Marina', telefone: '98888-77' }] } });
eq([r.status, String(r.corpo?.error ?? JSON.stringify(r.corpo)).includes('98888-77')], [400, true], 'número inválido: recusa dizendo qual');
r = await put({ avisos_vencimento_whatsapp: { ligado: true, telefones: [] } });
eq(r.status, 400, 'ligado sem número: recusa');
r = await put({ avisos_vencimento_whatsapp: { ligado: true, telefones: [{ nome: 'Marina', telefone: '(11) 98888-7777' }, { nome: 'Caio', telefone: '+55 21 97777-6666' }] } });
eq([r.status, r.corpo.avisos_vencimento_whatsapp], [200, { ligado: true, telefones: [{ nome: 'Marina', telefone: '5511988887777' }, { nome: 'Caio', telefone: '5521977776666' }] }], 'grava normalizado');
r = await json(await RConfig.GET(req('/api/config/financeiro')));
eq(r.corpo.avisos_vencimento_whatsapp.telefones.length, 2, 'a tela lê de volta');
await comNadaSai('teste', async () => { res = await avisarVencimentos(pool, T, agora); });
eq([res.motivo.startsWith('nada sai'), (await eventosCrm(T, 'FINANCEIRO_AVISO_VENCIMENTOS')).length], [true, 0], 'nada sai: nenhum aviso');
res = await avisarVencimentos(pool, T, agora);
const avisos = await eventosCrm(T, 'FINANCEIRO_AVISO_VENCIMENTOS');
eq([res.whatsapp, avisos.length, avisos[0]?.id], [{ enviado: true, destinos: 2 }, 1, `aviso-vencimento-whatsapp:${T}:${HOJE}`], 'ligado: um evento por dia, para os 2 números');
const pa = avisos[0].data.payload;
eq([pa.data, pa.destinatarios.length, pa.resumo.pagar_hoje.quantidade, pa.resumo.pagar_hoje.total, pa.resumo.pagar_atrasadas.quantidade], [HOJE, 2, 1, 800, 1], 'o resumo: o que vence hoje e o que está em atraso');
eq([/A pagar hoje: 1 conta, R\$\s800,00/.test(pa.texto), pa.texto.includes('Hotel Lisboa'), pa.texto.includes('Ana Souza'), pa.texto.includes('12345678909')], [true, true, false, false], 'texto com totais e a maior conta do dia, sem nome de cliente nem documento');
res = await avisarVencimentos(pool, T, agora);
eq([res.whatsapp, (await eventosCrm(T, 'FINANCEIRO_AVISO_VENCIMENTOS')).length], [{ enviado: false, motivo: 'já enviado hoje' }, 1], 'rodar de novo no mesmo dia não repete');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
