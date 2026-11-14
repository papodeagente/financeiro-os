/**
 * "Ler boleto ou nota" (05/11/2026) contra um Postgres real (PGlite),
 * rodando a ROTA de produção com a sessão de teste e a IA trocada por um
 * falso (o `fetch` global responde no lugar da Anthropic; nada sai para a
 * rede).
 *
 * Prova:
 *  1. GUARDAS — sem login, perfil sem financeiro e agência sem chave de IA
 *     são recusados antes de chamar a IA; arquivo que não é PDF/foto ou
 *     grande demais também.
 *  2. LEITURA — o boleto lido é conferido pelo leitor puro; divergência não
 *     preenche o valor; nada é gravado nas contas; o arquivo fica guardado
 *     na pasta privada da agência para virar anexo.
 *  3. UMA CHAMADA POR ARQUIVO — o mesmo arquivo de novo devolve a mesma
 *     leitura sem chamar a IA; leitura em curso responde 409; reserva
 *     esquecida expira; falha da IA libera a chave; limite por hora.
 *  4. FORNECEDOR — casa pelo CNPJ (mesmo formatado), pelo nome só quando é
 *     único e sem CNPJ em conflito; sem casamento sugere criar e não cria.
 *  5. CATEGORIA — as categorias já usadas para o fornecedor (cadastro, CNPJ
 *     ou nome), da mais usada; excluída ou desativada fica fora.
 *  6. ISOLAMENTO — outra agência não vê a leitura, o fornecedor nem o
 *     histórico da primeira.
 *
 * Uso: node --no-warnings scripts/test-sql-leitura-documento.mjs
 */
import { register } from 'node:module';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
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
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome_fantasia TEXT NOT NULL DEFAULT '',
    cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT,
    crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE config_apis (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT NOT NULL DEFAULT '',
    acao TEXT NOT NULL DEFAULT '', modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '',
    entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

const { LEITURA_DOCUMENTO_SCHEMA_SQL, LIMITE_DE_LEITURAS_POR_HORA } = await import('../src/lib/leitura-documento-servidor.ts');
const rota = await import('../src/app/api/leitura-documento/route.ts');
await pg.exec(LEITURA_DOCUMENTO_SCHEMA_SQL);
await pg.exec(LEITURA_DOCUMENTO_SCHEMA_SQL); // roda a cada boot

// --- A IA falsa ------------------------------------------------------------
const BOLETO = '23793381286000782713695000063305975520000370000'; // R$ 3.700,00, 11/06/2018
let chamadas = [];
let proxima = null; // { status, corpo } ou função
const respostaIa = (json, extra = {}) => ({
  status: 200,
  corpo: {
    model: 'claude-opus-5-5', stop_reason: 'end_turn',
    // Com raciocínio ligado o primeiro bloco não é o texto.
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '```json\n' + JSON.stringify(json) + '\n```' }],
    ...extra,
  },
});
const LIDO_PADRAO = {
  tipo_documento: 'boleto', fornecedor_nome: 'Operadora Sol Turismo Ltda', fornecedor_cnpj: '12.345.678/0001-95',
  descricao: 'Hospedagem do grupo Chile', valor: 3700, vencimento: '2018-06-11', numero_documento: '000633',
  linha_digitavel: BOLETO, chave_pix: '',
};
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error(`rede bloqueada no teste: ${url}`);
  const corpo = JSON.parse(init.body);
  chamadas.push({ chave: init.headers['x-api-key'], modelo: corpo.model, bloco: corpo.messages[0].content[0].type,
    mime: corpo.messages[0].content[0].source.media_type });
  const r = typeof proxima === 'function' ? proxima() : (proxima ?? respostaIa(LIDO_PADRAO));
  return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
};

// --- Ajudantes --------------------------------------------------------------
const sessao = (perfil, tenantId) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: '', perfil, permissoes: {}, tenantId, tenantSlug: tenantId });
const como = (perfil, tenantId = 'leitura-t1') => { globalThis.__SESSAO_DE_TESTE__ = sessao(perfil, tenantId); };
const pdf = (texto) => new File([new TextEncoder().encode(`%PDF-1.4\n${texto}\n%%EOF`)], 'boleto sol.pdf', { type: 'application/pdf' });
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'foto.png', { type: 'image/png' });
async function ler(arquivo) {
  const form = new FormData();
  if (arquivo) form.append('file', arquivo);
  const r = await rota.POST(new Request('http://localhost/api/leitura-documento', { method: 'POST', body: form }));
  return { status: r.status, corpo: await r.json() };
}
const um = async (sql, v) => (await query(sql, v)).rows[0];
const n = async (sql, v) => Number((await um(sql, v)).n);
const chaveIa = (tenantId, data) => query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ('apis-config-singleton', $1, $2)`, [tenantId, JSON.stringify(data)]);
const inserir = (tabela, id, t, data, extra = {}) => {
  const cols = ['id', 'tenant_id', 'data', ...Object.keys(extra)];
  const vals = [id, t, JSON.stringify({ id, ...data }), ...Object.values(extra)];
  return query(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
};
const PASTAS = ['leitura-t1', 'leitura-t2'].map(t => path.join(process.cwd(), '.data', 'comprovantes', t));

// --- Dados -----------------------------------------------------------------
await inserir('fornecedores_crm', 'f-sol', 'leitura-t1', { nome_fantasia: 'Sol Operadora', razao_social: 'Operadora Sol Turismo Ltda', cnpj: '12.345.678/0001-95' }, { nome_fantasia: 'Sol Operadora', cnpj: '12.345.678/0001-95' });
await inserir('fornecedores_crm', 'f-mar', 'leitura-t1', { nome_fantasia: 'Hotel Mar Azul', cnpj: '' }, { nome_fantasia: 'Hotel Mar Azul', cnpj: '' });
await inserir('fornecedores_crm', 'f-lua', 'leitura-t1', { nome_fantasia: 'Pousada Lua', cnpj: '11.111.111/0001-91' }, { nome_fantasia: 'Pousada Lua', cnpj: '11.111.111/0001-91' });
await inserir('plano_contas', 'cat-hosp', 'leitura-t1', { codigo: '2.1', nome: 'Hospedagem', tipo: 'DESPESA', ativo: true }, { codigo: '2.1', tipo: 'despesa' });
await inserir('plano_contas', 'cat-aereo', 'leitura-t1', { codigo: '2.2', nome: 'Aéreo', tipo: 'DESPESA', ativo: true }, { codigo: '2.2', tipo: 'despesa' });
await inserir('plano_contas', 'cat-velha', 'leitura-t1', { codigo: '2.9', nome: 'Antiga', tipo: 'DESPESA', ativo: false }, { codigo: '2.9', tipo: 'despesa' });
// Histórico de contas a pagar.
await inserir('contas_pagar', 'cp1', 'leitura-t1', { fornecedor_id: 'f-sol', fornecedor_nome: 'Sol Operadora', categoria_id: 'cat-hosp', status: 'PAGO' });
await inserir('contas_pagar', 'cp2', 'leitura-t1', { fornecedor_nome: 'OPERADORA SOL TURISMO LTDA.', categoria_id: 'cat-hosp', status: 'PENDENTE' });
await inserir('contas_pagar', 'cp3', 'leitura-t1', { fornecedor_nome: 'Outro nome', fornecedor_cnpj: '12345678000195', categoria_id: 'cat-aereo', status: 'PENDENTE' });
await inserir('contas_pagar', 'cp4', 'leitura-t1', { fornecedor_id: 'f-sol', categoria_id: 'cat-velha', status: 'PAGO' });
await inserir('contas_pagar', 'cp5', 'leitura-t1', { fornecedor_id: 'f-sol', categoria_id: 'cat-sumiu', status: 'PAGO' });
await inserir('contas_pagar', 'cp6', 'leitura-t1', { fornecedor_id: 'f-sol', categoria_id: 'cat-aereo', status: 'CANCELADO' });
await inserir('contas_pagar', 'cp7', 'leitura-t1', { fornecedor_nome: 'Agência de passagens', categoria_id: 'cat-aereo', status: 'PAGO' });
await inserir('contas_pagar', 'cpT2', 'leitura-t2', { fornecedor_nome: 'Operadora Sol Turismo', fornecedor_cnpj: '12345678000195', categoria_id: 'cat-t2', status: 'PAGO' });
const contasAntes = await n(`SELECT COUNT(*)::int AS n FROM contas_pagar`);

try {
  // -------------------------------------------------------------------------
  console.log('--- 1. Guardas ---');
  globalThis.__SESSAO_DE_TESTE__ = null;
  let r = await ler(pdf('a'));
  eq(r.status, 401, 'sem login: recusado');
  como('VENDEDOR');
  r = await ler(pdf('a'));
  eq(r.status, 403, 'perfil sem financeiro: recusado');
  como('OPERADOR');
  r = await ler(null);
  eq([r.status, r.corpo.error], [400, 'Envie o arquivo do boleto ou da nota.'], 'sem arquivo');
  r = await ler(new File([new TextEncoder().encode('nome,valor\nA,1')], 'planilha.pdf', { type: 'application/pdf' }));
  eq([r.status, r.corpo.error], [415, 'Aceito PDF ou foto (JPG, PNG ou WEBP).'], 'arquivo que diz ser PDF mas não é: recusado pelos bytes');
  const grande = new Uint8Array(8 * 1024 * 1024 + 10); grande.set(new TextEncoder().encode('%PDF-1.4'));
  r = await ler(new File([grande], 'grande.pdf', { type: 'application/pdf' }));
  eq(r.status, 413, 'PDF acima de 8MB: recusado');
  r = await ler(pdf('boleto sol'));
  eq([r.status, r.corpo.codigo, chamadas.length], [400, 'sem_chave_ia', 0], 'agência sem chave de IA: erro claro, IA não chamada');
  eq(await n(`SELECT COUNT(*)::int AS n FROM leituras_de_documento`), 0, 'sem chave: a reserva é desfeita');
  await chaveIa('leitura-t1', { anthropic: { ativo: false, api_key: 'sk-t1' } });
  r = await ler(pdf('boleto sol'));
  eq(r.corpo.codigo, 'sem_chave_ia', 'chave cadastrada mas desligada: mesma coisa');
  await query(`UPDATE config_apis SET data = $1 WHERE tenant_id = 'leitura-t1'`, [JSON.stringify({ anthropic: { ativo: true, api_key: 'sk-t1' } })]);

  // -------------------------------------------------------------------------
  console.log('--- 2. Leitura de um boleto ---');
  r = await ler(pdf('boleto sol'));
  eq(r.status, 200, 'lido');
  const L = r.corpo.leitura;
  eq([L.valor, L.valor_origem, L.vencimento, L.vencimento_origem, L.boleto.confere, L.fornecedor_cnpj, L.numero_documento],
    [3700, 'boleto', '2018-06-11', 'boleto', true, '12345678000195', '000633'], 'valor e vencimento conferidos pelo boleto');
  eq([chamadas.length, chamadas[0].chave, chamadas[0].modelo, chamadas[0].bloco], [1, 'sk-t1', 'claude-opus-5-5', 'document'],
    'uma chamada, com a chave da agência, o modelo padrão e o PDF como documento');
  eq([r.corpo.gravado, r.corpo.repetida, await n(`SELECT COUNT(*)::int AS n FROM contas_pagar`)], [false, false, contasAntes], 'nada gravado nas contas');
  const anexo = r.corpo.anexo;
  eq([anexo.nome, /^\/api\/comprovantes\/leitura-[0-9a-f]{40}\.pdf$/.test(anexo.url)], ['boleto sol.pdf', true], 'o arquivo vira anexo privado da agência');
  eq((await stat(path.join(PASTAS[0], anexo.url.split('/').pop()))).isFile(), true, 'arquivo gravado na pasta da agência');
  eq(await n(`SELECT COUNT(*)::int AS n FROM audit_log WHERE tenant_id='leitura-t1' AND entidade='leituras_de_documento'`), 1, 'a leitura fica no registro de atividades');

  console.log('--- 4/5. Fornecedor e categoria ---');
  const S = r.corpo.sugestoes;
  eq([S.fornecedor?.id, S.fornecedor?.como, S.sugerir_criar], ['f-sol', 'documento', false], 'casou pelo CNPJ formatado do cadastro');
  eq(S.categorias.map(c => [c.id, c.vezes]), [['cat-hosp', 2], ['cat-aereo', 1]],
    'categorias do fornecedor (cadastro, nome sem sufixo, CNPJ), mais usada primeiro; desativada, excluída e cancelada ficam fora');

  // -------------------------------------------------------------------------
  console.log('--- 3. Uma chamada por arquivo ---');
  r = await ler(pdf('boleto sol'));
  eq([r.status, r.corpo.repetida, r.corpo.leitura.valor, chamadas.length], [200, true, 3700, 1], 'mesmo arquivo de novo: mesma leitura, sem chamar a IA');
  eq(r.corpo.anexo.url, anexo.url, 'e o mesmo anexo, sem duplicar arquivo');

  const hashEmCurso = 'a'.repeat(64);
  await query(`INSERT INTO leituras_de_documento (tenant_id, hash, estado) VALUES ('leitura-t1', $1, 'lendo')`, [hashEmCurso]);
  const { reservarLeitura } = await import('../src/lib/leitura-documento-servidor.ts');
  const args = { tenantId: 'leitura-t1', hash: hashEmCurso, nomeOriginal: 'x.pdf', mime: 'application/pdf', tamanho: 1, usuarioId: 'u' };
  eq((await reservarLeitura({ query }, args)).tipo, 'em_curso', 'leitura em curso: a segunda espera (a rota responde 409)');
  await query(`UPDATE leituras_de_documento SET updated_at = NOW() - INTERVAL '10 minutes' WHERE hash = $1`, [hashEmCurso]);
  eq((await reservarLeitura({ query }, args)).tipo, 'reservada', 'reserva esquecida há 10 minutos expira');
  eq((await reservarLeitura({ query }, args)).tipo, 'em_curso', 'e quem pegou de volta segura a chave');

  proxima = { status: 500, corpo: { error: { message: 'erro interno do provedor com detalhe' } } };
  r = await ler(pdf('falha'));
  eq([r.status, /código 500/.test(r.corpo.error), /detalhe/.test(r.corpo.error)], [502, true, false], 'IA falhou: 502 com frase nossa, sem repassar o detalhe');
  proxima = null;
  r = await ler(pdf('falha'));
  eq([r.status, chamadas.length], [200, 3], 'a falha liberou a chave: a próxima tentativa lê');

  proxima = { status: 401, corpo: {} };
  r = await ler(pdf('chave errada'));
  eq(r.corpo.error, 'A chave de IA da agência foi recusada. Confira em Configurações, Integração com IA.', 'chave recusada pelo provedor');
  proxima = respostaIa({}, { stop_reason: 'refusal', content: [] });
  r = await ler(pdf('recusado'));
  eq(r.status, 422, 'IA se recusou: 422');
  proxima = { status: 200, corpo: { content: [{ type: 'text', text: 'não sei' }] } };
  r = await ler(pdf('sem json'));
  eq(r.status, 502, 'resposta sem JSON: 502');
  proxima = null;

  r = await ler(png());
  eq([r.status, chamadas.at(-1).bloco, chamadas.at(-1).mime], [200, 'image', 'image/png'], 'foto vai para a IA como imagem');

  // -------------------------------------------------------------------------
  console.log('--- 2. Divergência e fornecedor sem cadastro ---');
  proxima = respostaIa({ ...LIDO_PADRAO, valor: 3900, fornecedor_nome: 'Receptivo Andes', fornecedor_cnpj: '22.222.222/0001-91' });
  r = await ler(pdf('divergente'));
  eq([r.corpo.leitura.valor, r.corpo.leitura.divergencias.map(d => d.campo)], [null, ['valor']], 'IA e boleto discordam: valor em branco e divergência na tela');
  eq([r.corpo.sugestoes.fornecedor, r.corpo.sugestoes.sugerir_criar], [null, true], 'fornecedor novo: sugere criar');
  eq(await n(`SELECT COUNT(*)::int AS n FROM fornecedores_crm`), 3, 'e não cria sozinho');

  proxima = respostaIa({ tipo_documento: 'nota_fiscal', fornecedor_nome: 'Hotel Mar Azul', valor: 850, vencimento: '2026-12-01' });
  r = await ler(pdf('nota mar'));
  eq([r.corpo.sugestoes.fornecedor?.id, r.corpo.sugestoes.fornecedor?.como, r.corpo.leitura.valor_origem], ['f-mar', 'nome', 'documento'], 'sem CNPJ: casa pelo nome único');
  proxima = respostaIa({ tipo_documento: 'nota_fiscal', fornecedor_nome: 'Pousada Lua', fornecedor_cnpj: '33.333.333/0001-91', valor: 90 });
  r = await ler(pdf('nota lua'));
  eq([r.corpo.sugestoes.fornecedor, r.corpo.sugestoes.sugerir_criar], [null, true], 'mesmo nome mas CNPJ diferente: não junta');
  proxima = null;

  // -------------------------------------------------------------------------
  console.log('--- 6. Isolamento ---');
  como('ADMIN', 'leitura-t2');
  await chaveIa('leitura-t2', { anthropic: { ativo: true, api_key: 'sk-t2', modelo: 'claude-3-5-sonnet-20240620' } });
  const antes = chamadas.length;
  r = await ler(pdf('boleto sol'));
  eq([r.status, r.corpo.repetida, chamadas.length - antes, chamadas.at(-1).chave, chamadas.at(-1).modelo], [200, false, 1, 'sk-t2', 'claude-opus-5-5'],
    'o mesmo arquivo em outra agência é outra leitura, com a chave dela (o modelo antigo gravado não vale: usa o atual)');
  eq([r.corpo.sugestoes.fornecedor, r.corpo.sugestoes.categorias], [null, []], 'não vê o fornecedor da outra agência; categoria excluída dela também não aparece');
  eq((await stat(path.join(PASTAS[1], r.corpo.anexo.url.split('/').pop()))).isFile(), true, 'arquivo na pasta da agência dela');

  // -------------------------------------------------------------------------
  console.log('--- 3. Limite por hora ---');
  for (let i = 0; i < LIMITE_DE_LEITURAS_POR_HORA; i++) {
    await query(`INSERT INTO leituras_de_documento (tenant_id, hash, estado) VALUES ('leitura-t2', $1, 'pronto')`, [`h${i}`]);
  }
  r = await ler(pdf('mais um'));
  eq(r.status, 429, 'passou do limite de leituras novas na hora: 429');
  r = await ler(pdf('boleto sol'));
  eq([r.status, r.corpo.repetida], [200, true], 'arquivo já lido continua saindo da guarda, sem custo');
} finally {
  for (const p of PASTAS) await rm(p, { recursive: true, force: true });
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
