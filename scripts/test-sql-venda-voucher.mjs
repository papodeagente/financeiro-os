/**
 * "Lançar pelo voucher" (E7, fechamento) contra um Postgres real (PGlite),
 * rodando a ROTA de produção com a sessão de teste e a IA dublada (o `fetch`
 * global responde no lugar da Anthropic; nada sai para a rede).
 *
 * Prova:
 *  1. GUARDAS — sem login, perfil sem financeiro e agência sem chave de IA são
 *     recusados antes de chamar a IA; arquivo que não é PDF/foto e texto curto
 *     também.
 *  2. RESPOSTA RUIM — resposta malformada, erro do provedor e recusa não
 *     gravam nada e liberam a leitura para a próxima tentativa.
 *  3. RASCUNHO — o voucher vira o rascunho da venda (cliente pelo CPF,
 *     fornecedor pelo CNPJ, cada campo com o trecho de origem) e NADA é
 *     gravado: nem venda, nem conta.
 *  4. UMA CHAMADA POR DOCUMENTO — o mesmo arquivo de novo não chama a IA; a
 *     ficha reabre o rascunho por GET ?hash=; outra agência não vê.
 *  5. E-MAIL COLADO — o trecho citado precisa estar no texto.
 *  6. CONFIRMAR — o rascunho salvo pelo caminho de sempre (POST
 *     /api/vendas/completa) vira venda ABERTA, origem manual, com as contas.
 *
 * Uso: node --no-warnings scripts/test-sql-venda-voucher.mjs
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
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE membros (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_contas_receber_venda_parcela ON contas_receber (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE UNIQUE INDEX idx_contas_pagar_venda_item ON contas_pagar (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE config_apis (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT NOT NULL DEFAULT '', acao TEXT NOT NULL DEFAULT '', modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '', entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

const { VENDA_SCHEMA_SQL } = await import('../src/lib/venda-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { LEITURA_DOCUMENTO_SCHEMA_SQL } = await import('../src/lib/leitura-documento-servidor.ts');
for (const sql of [BAIXAS_SCHEMA_SQL, PERIODO_SCHEMA_SQL, COBRANCA_SCHEMA_SQL, PERMISSOES_SCHEMA_SQL, VENDA_SCHEMA_SQL, RAZAO_SCHEMA_SQL, LEITURA_DOCUMENTO_SCHEMA_SQL]) await pg.exec(sql);

const rota = await import('../src/app/api/vendas/voucher/route.ts');
const rotaVenda = await import('../src/app/api/vendas/completa/route.ts');

// --- A IA dublada -------------------------------------------------------------
const T1 = 'voucher-t1', T2 = 'voucher-t2';
let chamadas = [];
let proxima = null;
const f = (valor, fonte = `trecho ${valor}`) => ({ valor, fonte });
const VOUCHER = {
  tipo_documento: 'voucher',
  operadora: { nome: f('Sol Operadora Ltda', 'Emitido por Sol Operadora Ltda'), cnpj: f('12.345.678/0001-95', 'CNPJ 12.345.678/0001-95') },
  cliente: { nome: f('Carla Dias', 'Titular: Carla Dias'), documento: f('123.456.789-09', 'CPF 123.456.789-09') },
  data_venda: f('2026-10-20', 'Reserva em 20/10/2026'),
  produtos: [{
    tipo: f('PACOTE', 'Pacote'), descricao: f('Pacote Chile 5 noites', 'Pacote Chile - 5 noites'),
    fornecedor: { nome: f('', ''), cnpj: f('', '') },
    localizador: f('SOL-55821', 'Localizador SOL-55821'),
    data_inicio: f('2027-01-10', 'Saída 10/01/2027'), data_fim: f('2027-01-15', 'Retorno 15/01/2027'),
    moeda: f('BRL', 'R$'), cambio: f(null, ''),
    tarifa_total: f(null, ''), taxas_total: f(null, ''),
    detalhes: { destino: f('Santiago', 'Destino: Santiago') },
    passageiros: [
      { nome: f('Carla Dias', 'Pax 1: Carla Dias'), tipo: 'ADT', documento: f('', ''), tarifa: f(3000, 'Pax 1 R$ 3.000,00'), taxas: f(150, 'Taxas pax 1 R$ 150,00') },
      { nome: f('Davi Dias', 'Pax 2: Davi Dias'), tipo: 'ADT', documento: f('', ''), tarifa: f(3000, 'Pax 2 R$ 3.000,00'), taxas: f(150, 'Taxas pax 2 R$ 150,00') },
    ],
    componentes: [{ tipo: 'COMISSAO', valor: 600, percentual: null, fonte: 'Comissão agência R$ 600,00' }],
  }],
};
const respostaIa = (json, extra = {}) => ({
  status: 200,
  corpo: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '```json\n' + JSON.stringify(json) + '\n```' }], ...extra },
});
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error(`rede bloqueada no teste: ${url}`);
  const corpo = JSON.parse(init.body);
  const bloco = corpo.messages[0].content[0];
  chamadas.push({ chave: init.headers['x-api-key'], modelo: corpo.model, bloco: bloco.type, texto: bloco.type === 'text' ? bloco.text : '' });
  const r = typeof proxima === 'function' ? proxima() : (proxima ?? respostaIa(VOUCHER));
  return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
};

// --- Ajudantes -------------------------------------------------------------------
const sessao = (perfil, tenantId) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: '', perfil, permissoes: {}, tenantId, tenantSlug: tenantId });
const como = (perfil, tenantId = T1) => { globalThis.__SESSAO_DE_TESTE__ = sessao(perfil, tenantId); };
const pdf = (texto) => new File([new TextEncoder().encode(`%PDF-1.4\n${texto}\n%%EOF`)], 'voucher sol.pdf', { type: 'application/pdf' });
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])], 'foto.png', { type: 'image/png' });
async function ler(arquivo) {
  const form = new FormData();
  if (arquivo) form.append('file', arquivo);
  const r = await rota.POST(new Request('http://localhost/api/vendas/voucher', { method: 'POST', body: form }));
  return { status: r.status, corpo: await r.json() };
}
async function colar(texto) {
  const r = await rota.POST(new Request('http://localhost/api/vendas/voucher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto }) }));
  return { status: r.status, corpo: await r.json() };
}
async function abrir(hash) {
  const r = await rota.GET(new Request(`http://localhost/api/vendas/voucher?hash=${hash}`));
  return { status: r.status, corpo: await r.json() };
}
const n = async (sql, v) => Number((await query(sql, v)).rows[0].n);
const chaveIa = (t) => query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ('apis-config-singleton', $1, $2)`, [t, JSON.stringify({ anthropic: { ativo: true, api_key: `sk-${t}` } })]);
const inserir = (tabela, id, t, data, extra = {}) => {
  const cols = ['id', 'tenant_id', 'data', ...Object.keys(extra)];
  const vals = [id, t, JSON.stringify({ id, ...data }), ...Object.values(extra)];
  return query(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
};

await inserir('clientes', 'cli-carla', T1, { nome: 'Carla Dias Souza', cpf: '123.456.789-09' }, { nome: 'Carla Dias Souza', cpf_cnpj: '123.456.789-09' });
await inserir('clientes', 'cli-outra', T2, { nome: 'Carla Dias' }, { nome: 'Carla Dias', cpf_cnpj: '12345678909' });
await inserir('fornecedores_crm', 'f-sol', T1, { nome_fantasia: 'Sol Operadora', razao_social: 'Sol Operadora Ltda', cnpj: '12.345.678/0001-95' }, { nome_fantasia: 'Sol Operadora', cnpj: '12.345.678/0001-95' });
const vendas = () => n(`SELECT COUNT(*)::int AS n FROM vendas_crm`);
const contas = async () => (await n(`SELECT COUNT(*)::int AS n FROM contas_receber`)) + (await n(`SELECT COUNT(*)::int AS n FROM contas_pagar`));

try {
  console.log('--- 1. Guardas ---');
  let r = await ler(pdf('a'));
  eq(r.status, 401, 'sem login: recusado');
  como('VENDEDOR');
  eq((await ler(pdf('a'))).status, 403, 'perfil sem financeiro: recusado');
  eq((await abrir('a'.repeat(64))).status, 403, 'perfil sem financeiro também não abre rascunho');
  como('OPERADOR');
  r = await ler(null);
  eq(r.status, 400, 'sem arquivo');
  r = await ler(new File([new TextEncoder().encode('a,b\n1,2')], 'x.pdf', { type: 'application/pdf' }));
  eq(r.status, 415, 'arquivo que diz ser PDF mas não é: recusado pelos bytes');
  eq((await colar('curto')).status, 400, 'texto curto demais');
  r = await ler(pdf('voucher sol'));
  eq([r.status, r.corpo.codigo, chamadas.length], [400, 'sem_chave_ia', 0], 'agência sem chave de IA: erro claro, IA não chamada');
  eq(await n(`SELECT COUNT(*)::int AS n FROM leituras_de_documento`), 0, 'sem chave: a reserva é desfeita');
  await chaveIa(T1);

  console.log('--- 2. Resposta ruim da IA ---');
  proxima = { status: 200, corpo: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Desculpe, segue: {"produtos": [ {"tipo": ' }] } };
  r = await ler(pdf('voucher sol'));
  eq([r.status, /formato/.test(r.corpo.error), chamadas.length], [502, true, 1], 'resposta malformada (JSON cortado): 502, sem rascunho');
  eq([await n(`SELECT COUNT(*)::int AS n FROM leituras_de_documento`), await vendas()], [0, 0], 'nada guardado, nada gravado');
  proxima = { status: 200, corpo: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '[1, 2, 3]' }] } };
  r = await ler(pdf('voucher sol'));
  eq(r.status, 502, 'resposta que não é objeto: 502');
  proxima = respostaIa({ produtos: 'nenhum', cliente: 7, data_venda: { valor: '2026-13-45' } });
  r = await ler(pdf('lixo'));
  eq([r.status, r.corpo.rascunho.venda.produtos.length, r.corpo.rascunho.venda.cliente.nome, r.corpo.gravado], [200, 0, '', false],
    'JSON com tipos trocados: rascunho vazio, nada inventado');
  eq(r.corpo.rascunho.avisos.some(a => a.includes('nenhum serviço')), true, 'e o aviso de que não há o que lançar');
  proxima = { status: 500, corpo: { error: { message: 'detalhe interno do provedor' } } };
  r = await ler(pdf('falha'));
  eq([r.status, /código 500/.test(r.corpo.error), /detalhe/.test(r.corpo.error)], [502, true, false], 'IA falhou: frase nossa, sem o detalhe do provedor');
  proxima = { status: 200, corpo: { model: 'claude-opus-5-5', stop_reason: 'refusal', content: [] } };
  eq((await ler(pdf('recusa'))).status, 422, 'IA recusou: 422');
  proxima = { status: 401, corpo: {} };
  r = await ler(pdf('chave'));
  eq(/chave de IA da agência foi recusada/.test(r.corpo.error), true, 'chave recusada pelo provedor: frase clara');
  proxima = null;

  console.log('--- 3. Rascunho ---');
  const antes = chamadas.length;
  r = await ler(pdf('voucher sol'));
  eq([r.status, r.corpo.gravado, r.corpo.repetida, chamadas.length - antes], [200, false, false, 1], 'lido com uma chamada');
  eq([chamadas.at(-1).chave, chamadas.at(-1).modelo, chamadas.at(-1).bloco], ['sk-voucher-t1', 'claude-opus-5-5', 'document'], 'chave da agência, modelo atual, PDF como documento');
  const R = r.corpo.rascunho;
  const V = R.venda;
  eq([V.id, V.origem, V.situacao, V.data_venda], ['', 'manual', 'ABERTA', '2026-10-20'], 'rascunho manual, ABERTO, sem id');
  eq(V.cliente, { id: 'cli-carla', nome: 'Carla Dias Souza', documento: '12345678909' }, 'cliente casado pelo CPF (formatado no cadastro)');
  eq(V.produtos[0].fornecedor, { id: 'f-sol', nome: 'Sol Operadora', documento: '12345678000195' }, 'sem fornecedor no produto: a operadora, casada pelo CNPJ');
  eq(V.produtos[0].passageiros.map(p => [p.nome, p.tarifa_centavos, p.taxas_centavos]), [['Carla Dias', 300000, 15000], ['Davi Dias', 300000, 15000]], 'passageiros com valor');
  eq(V.produtos[0].componentes.map(c => [c.tipo, c.valor_centavos]), [['COMISSAO', 60000]], 'comissão declarada');
  eq(R.origens.find(o => o.campo === 'Cliente'), { campo: 'Cliente', valor: 'Carla Dias', fonte: 'Titular: Carla Dias', cadastro: 'documento' }, 'cada campo com o trecho de origem');
  eq(R.origens.find(o => o.campo === 'Produto 1 · Fornecedor')?.cadastro, 'documento', 'fornecedor casado pelo CNPJ');
  eq(R.avisos.some(a => a.includes('não foi achado') || a.includes('não está no cadastro')), false, 'sem aviso de cadastro');
  eq([await vendas(), await contas()], [0, 0], 'NADA gravado: nem venda, nem conta');
  eq(await n(`SELECT COUNT(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND entidade = 'leituras_de_documento'`, [T1]), 2, 'cada leitura nova fica no registro de atividades');

  console.log('--- 4. Uma chamada por documento; a ficha reabre ---');
  const hash = r.corpo.hash;
  const antes2 = chamadas.length;
  r = await ler(pdf('voucher sol'));
  eq([r.status, r.corpo.repetida, chamadas.length - antes2, r.corpo.rascunho.venda.cliente.id], [200, true, 0, 'cli-carla'], 'mesmo arquivo: sem chamar a IA');
  const aberto = await abrir(hash);
  eq([aberto.status, aberto.corpo.rascunho.venda.produtos[0].localizador, aberto.corpo.gravado], [200, 'SOL-55821', false], 'GET ?hash= reabre o rascunho');
  eq((await abrir('nao-e-hash')).status, 404, 'hash inválido: 404');
  eq((await abrir('b'.repeat(64))).status, 404, 'hash desconhecido: 404');
  como('ADMIN', T2);
  eq((await abrir(hash)).status, 404, 'outra agência não abre a leitura da primeira');
  como('OPERADOR');

  console.log('--- foto ---');
  r = await ler(png());
  eq([r.status, chamadas.at(-1).bloco], [200, 'image'], 'foto vai como imagem');

  console.log('--- 5. E-mail colado ---');
  const EMAIL = `Olá! Confirmamos a reserva.
Titular: Carla Dias  CPF 123.456.789-09
Reserva em 20/10/2026 · Pacote Chile - 5 noites · Localizador SOL-55821
Saída 10/01/2027 Retorno 15/01/2027 · Destino: Santiago
Pax 1: Carla Dias  Pax 1 R$ 3.000,00  Taxas pax 1 R$ 150,00
Pax 2: Davi Dias  Pax 2 R$ 3.000,00  Taxas pax 2 R$ 150,00`;
  r = await colar(EMAIL);
  eq([r.status, r.corpo.origem, chamadas.at(-1).bloco, chamadas.at(-1).texto.includes('Localizador SOL-55821')], [200, 'email', 'text', true], 'e-mail vai como texto');
  const RE = r.corpo.rascunho;
  eq(RE.venda.produtos[0].localizador, 'SOL-55821', 'campo com trecho no e-mail: fica');
  eq(RE.venda.produtos[0].componentes.length, 0, 'comissão citada com trecho que não está no e-mail: fica de fora');
  eq(RE.venda.produtos[0].fornecedor, null, 'operadora com trecho fora do e-mail: fica de fora (nada inventado)');
  eq(RE.avisos[0].includes('não foram achados no texto do e-mail'), true, 'aviso dos campos que caíram');

  console.log('--- 6. Confirmar: salvar o rascunho pelo caminho de sempre ---');
  const salvar = await rotaVenda.POST(new Request('http://localhost/api/vendas/completa', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ venda: V }),
  }));
  const ficha = await salvar.json();
  eq(salvar.status, 201, 'a pessoa salva: venda criada');
  const modelo = (await query(`SELECT origem, situacao FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [T1, ficha.venda.id])).rows[0];
  eq([modelo.origem, modelo.situacao, ficha.venda.produtos[0].localizador], ['manual', 'ABERTA', 'SOL-55821'], 'origem manual, ABERTA, com o que foi lido');
  eq(await n(`SELECT COUNT(*)::int AS n FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T1, ficha.venda.id]) > 0, true, 'as contas nascem só agora, ao salvar');
  eq(await n(`SELECT COUNT(*)::int AS n FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T1, ficha.venda.id]) > 0, true, 'inclusive a do fornecedor');
} catch (e) {
  falhas++;
  console.log('ERRO', e);
}

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
