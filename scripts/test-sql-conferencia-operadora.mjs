/**
 * Conferência do extrato de operadora (E6, 05/11/2026) contra um Postgres
 * real (PGlite), rodando as ROTAS de produção com sessões de teste e a IA
 * trocada por um falso (o `fetch` global responde no lugar da Anthropic;
 * nada sai para a rede).
 *
 * Prova:
 *  1. LEITURA — PDF vai como documento, planilha/CSV e e-mail como texto, com
 *     a chave da agência e o modelo atual; sem chave, erro claro.
 *  2. UMA VEZ SÓ — o mesmo arquivo de novo não chama a IA; ler não grava
 *     conferência (só a prévia); o mesmo arquivo não vira duas conferências.
 *  3. CASAMENTO — pelo localizador; divergência com a diferença explicada;
 *     não encontrado; e as regras de soma e data (Válido).
 *  4. CANCELAMENTO PROPOSTO — nunca aplicado: a venda e as contas ficam como
 *     estavam; cancelada a venda, a proposta se resolve ao casar de novo.
 *  5. FECHAR — recusa com os motivos; aceitar com motivo, ligar à mão e
 *     descartar a proposta; fechada, trava; reabrir pede motivo e o direito.
 *  6. COMISSÃO — esperada × informada × recebida.
 *  7. ISOLAMENTO — outra agência não vê nem usa a leitura ou a conferência.
 *
 * Uso: node --no-warnings scripts/test-sql-conferencia-operadora.mjs
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
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT DEFAULT '', vendedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '',
    sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
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
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
process.env.JWT_SECRET = 'segredo-de-teste-conferencia';

const { LEITURA_DOCUMENTO_SCHEMA_SQL } = await import('../src/lib/leitura-documento-servidor.ts');
const { CONFERENCIA_OPERADORA_SCHEMA_SQL } = await import('../src/lib/conferencia-operadora-schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
await pg.exec(LEITURA_DOCUMENTO_SCHEMA_SQL);
await pg.exec(CONFERENCIA_OPERADORA_SCHEMA_SQL);
await pg.exec(CONFERENCIA_OPERADORA_SCHEMA_SQL); // roda a cada boot
await pg.exec(PERMISSOES_SCHEMA_SQL);
const LER = await import('../src/app/api/conferencia-operadora/ler/route.ts');
const LISTA = await import('../src/app/api/conferencia-operadora/route.ts');
const UMA = await import('../src/app/api/conferencia-operadora/[id]/route.ts');

// --- A IA falsa ------------------------------------------------------------
let chamadas = [];
const EXTRATO = {
  operadora_nome: 'Operadora Sol Turismo Ltda', operadora_cnpj: '12.345.678/0001-95', periodo_de: '2026-10-01', periodo_ate: '2026-10-31',
  total_bruto: null, total_comissao: null, total_liquido: 2150.00,
  linhas: [
    { data: '2026-10-05', localizador: 'ABC123', passageiro: 'SILVA/MARIA', tipo: 'venda', valor_bruto: 1000, taxas: 0, comissao: 100, valor_liquido: 900 },
    { data: '2026-10-06', localizador: 'DEF456', passageiro: 'LIMA/JOAO', tipo: 'venda', valor_bruto: 1300, taxas: 0, comissao: 100, valor_liquido: 1200 },
    { data: '2026-10-07', localizador: 'GHI789', passageiro: 'ROCHA/ANA', tipo: 'cancelamento', valor_bruto: 500, taxas: 0, comissao: 0, valor_liquido: 500 },
    { data: '2026-10-08', localizador: 'ZZZ000', passageiro: 'NINGUEM/X', tipo: 'venda', valor_bruto: 600, taxas: 0, comissao: 50, valor_liquido: 550 },
  ],
};
let resposta = EXTRATO;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error(`rede bloqueada no teste: ${url}`);
  const corpo = JSON.parse(init.body);
  const blocos = corpo.messages[0].content;
  chamadas.push({ chave: init.headers['x-api-key'], modelo: corpo.model, tipo: blocos[0].type, texto: blocos[0].type === 'text' ? blocos[0].text : '' });
  return new Response(JSON.stringify({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(resposta) }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};

// --- Ajudantes --------------------------------------------------------------
const sessao = (perfil, t = 'op-t1') => ({ userId: `u-${perfil}-${t}`, nome: `Pessoa ${perfil}`, email: '', perfil, permissoes: {}, tenantId: t, tenantSlug: t });
const como = (perfil, t = 'op-t1') => { globalThis.__SESSAO_DE_TESTE__ = sessao(perfil, t); };
const pdf = texto => new File([new TextEncoder().encode(`%PDF-1.4\n${texto}\n%%EOF`)], 'extrato sol.pdf', { type: 'application/pdf' });
const csv = texto => new File([new TextEncoder().encode(texto)], 'extrato.csv', { type: 'text/csv' });
async function ler(arquivo) {
  const form = new FormData();
  form.append('file', arquivo);
  const r = await LER.POST(new Request('http://x/api/conferencia-operadora/ler', { method: 'POST', body: form }));
  return { status: r.status, corpo: await r.json() };
}
async function lerTexto(texto) {
  const r = await LER.POST(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto }) }));
  return { status: r.status, corpo: await r.json() };
}
const post = async (corpo) => { const r = await LISTA.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(corpo) })); return { status: r.status, corpo: await r.json() }; };
const lista = async (qs = '') => (await LISTA.GET(new Request(`http://x/api/conferencia-operadora${qs}`))).json();
const ctx = id => ({ params: Promise.resolve({ id }) });
const detalhe = async id => { const r = await UMA.GET(new Request('http://x'), ctx(id)); return { status: r.status, corpo: await r.json() }; };
const acao = async (id, corpo) => { const r = await UMA.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(corpo) }), ctx(id)); return { status: r.status, corpo: await r.json() }; };
const n = async (sql, v) => Number((await query(sql, v)).rows[0].n);
const inserir = (tabela, id, t, data, extra = {}) => {
  const cols = ['id', 'tenant_id', 'data', ...Object.keys(extra)];
  const vals = [id, t, JSON.stringify({ id, ...data }), ...Object.values(extra)];
  return query(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
};

// --- Dados -----------------------------------------------------------------
const T = 'op-t1';
await inserir('fornecedores_crm', 'f-sol', T, { nome_fantasia: 'Sol Operadora', cnpj: '12.345.678/0001-95' }, { nome_fantasia: 'Sol Operadora', cnpj: '12.345.678/0001-95' });
const venda = (id, numero, pax, status = 'CONFIRMADO', t = T) => inserir('vendas_crm', id, t,
  { numero, status, data_venda: '2026-10-01', cliente_nome: pax, passageiros: [{ nome: pax }] }, { status });
const it = (id, vendaId, loc, extra = {}, t = T) => inserir('itens_venda', id, t,
  { tipo: 'AEREO', descricao: `Aéreo ${loc}`, fornecedor_nome: 'Sol Operadora', meio_pagamento: 'proprio', valor_custo: 900, valor_venda: 1100,
    comissao_percentual: 0, comissao_valor: 0, moeda: 'BRL', cambio: 1, localizador: loc, data_inicio: '2026-12-01', ...extra },
  { venda_id: vendaId, fornecedor_id: 'f-sol' });
await venda('v1', 'V-1', 'Maria Silva'); await it('i1', 'v1', 'ABC123', { comissao_valor: 100 });
await venda('v2', 'V-2', 'João Lima'); await it('i2', 'v2', 'DEF456', { comissao_valor: 100 });
await venda('v3', 'V-3', 'Ana Rocha'); await it('i3', 'v3', 'GHI789');
await venda('v4', 'V-4', 'Pedro Novo'); await it('i4', 'v4', 'QQQ111', { valor_custo: 550, comissao_valor: 50 });
await inserir('contas_pagar', 'cp3', T, { origem: 'VENDA', origem_item_id: 'i3', valor_final: 500, status: 'PENDENTE', fornecedor_nome: 'Sol Operadora' });
await inserir('contas_receber', 'cc1', T, { origem: 'COMISSAO_FORNECEDOR', origem_item_id: 'i1', valor_final: 100, valor_recebido: 100, status: 'RECEBIDO' });
await venda('v9', 'V-9', 'Maria Silva', 'CONFIRMADO', 'op-t2'); await it('i9', 'v9', 'ABC123', {}, 'op-t2');

try {
  console.log('--- 1. leitura ---');
  como('ADMIN');
  let r = await ler(pdf('extrato outubro'));
  eq([r.status, r.corpo.codigo, chamadas.length], [400, 'sem_chave_ia', 0], 'sem chave de IA da agência: erro claro, IA não chamada');
  await query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ('apis-config-singleton', $1, $2)`, [T, JSON.stringify({ anthropic: { ativo: true, api_key: 'sk-op1' } })]);
  r = await ler(pdf('extrato outubro'));
  eq(r.status, 200, 'lido');
  eq([chamadas.length, chamadas[0].chave, chamadas[0].modelo, chamadas[0].tipo], [1, 'sk-op1', 'claude-opus-5-5', 'document'], 'uma chamada, chave da agência, modelo atual, PDF como documento');
  eq([r.corpo.gravado, r.corpo.repetida, await n(`SELECT COUNT(*)::int AS n FROM conferencias_operadora`)], [false, false, 0], 'ler não grava conferência: é só a prévia');
  eq([r.corpo.operadora_sugerida?.id, r.corpo.extrato.total_linhas], ['f-sol', 4], 'a operadora do cadastro, pelo CNPJ');
  const pv = r.corpo.previa;
  eq([pv.resumo.CONFERIDO, pv.resumo.DIVERGENTE, pv.resumo.NAO_ENCONTRADO, pv.resumo.propostas], [1, 2, 1, 1], 'a prévia já diz conferido, divergente, não encontrado e propostas');
  eq(pv.checagem.soma_confere, true, 'a soma das linhas bate com o total líquido do documento');
  const hash = r.corpo.hash;

  r = await ler(pdf('extrato outubro'));
  eq([r.status, r.corpo.repetida, chamadas.length], [200, true, 1], 'mesmo arquivo de novo: mesma leitura, sem chamar a IA');

  r = await ler(csv('data;localizador;passageiro;valor\n05/10/2026;ABC123;SILVA/MARIA;900,00'));
  eq([r.status, chamadas.length, chamadas[1].tipo, /ABC123/.test(chamadas[1].texto), /<documento>/.test(chamadas[1].texto)], [200, 2, 'text', true, true], 'CSV vai como texto, dentro da marca de documento');
  r = await lerTexto('Prezados, segue o extrato de outubro: ABC123 SILVA/MARIA 900,00 líquido.');
  eq([r.status, r.corpo.origem, /E-mail/.test(chamadas[2].texto)], [200, 'email', true], 'e-mail colado também');
  r = await lerTexto('curto');
  eq(r.status, 400, 'texto curto demais é recusado');

  console.log('--- 2. gravar a conferência ---');
  r = await post({ hash: 'f'.repeat(64), fornecedor_id: 'f-sol', fornecedor_nome: 'Sol Operadora' });
  eq(r.status, 404, 'hash sem leitura: não grava nada');
  r = await post({ hash, fornecedor_id: 'f-sol', fornecedor_nome: 'Sol Operadora' });
  eq(r.status, 201, 'confirmado: a conferência nasce');
  const id = r.corpo.id;
  eq(await n(`SELECT COUNT(*)::int AS n FROM conferencias_operadora_linhas WHERE conferencia_id = $1`, [id]), 4, 'com as 4 linhas da leitura guardada');
  r = await post({ hash, fornecedor_id: 'f-sol', fornecedor_nome: 'Sol Operadora' });
  eq([r.status, /já foi conferido/.test(r.corpo.error)], [409, true], 'o mesmo arquivo não vira duas conferências');

  console.log('--- 3. casamento e diferenças ---');
  let d = (await detalhe(id)).corpo;
  const L = loc => d.linhas.find(l => l.localizador === loc);
  eq([L('ABC123').situacao, L('ABC123').como_casou, L('ABC123').venda_numero, L('ABC123').valido], ['CONFERIDO', 'localizador', 'V-1', true], 'ABC123: conferido pelo localizador');
  eq([L('DEF456').situacao, L('DEF456').diferencas[0].tipo, L('DEF456').diferencas[0].diferenca_centavos], ['DIVERGENTE', 'valor', 30000], 'DEF456: divergente, a operadora cobra 300,00 a mais');
  eq(/R\$\s?1\.200,00.*R\$\s?900,00/.test(L('DEF456').diferencas[0].texto), true, 'e a diferença vem explicada em reais');
  eq([L('ZZZ000').situacao, L('ZZZ000').venda_id], ['NAO_ENCONTRADO', ''], 'ZZZ000: não encontrado');
  eq([d.conferencia.status, d.conferencia.fornecedor_nome, d.conferencia.periodo_de], ['ABERTA', 'Sol Operadora', '2026-10-01'], 'a conferência guarda a operadora e o período');

  console.log('--- 4. cancelamento só proposto ---');
  eq([L('GHI789').situacao, L('GHI789').proposta_status, L('GHI789').proposta.venda_id, L('GHI789').diferencas[0].tipo], ['DIVERGENTE', 'proposta', 'v3', 'cancelamento'], 'GHI789: cancelamento na operadora vira proposta');
  const v3 = (await query(`SELECT status, data->>'status' AS s FROM vendas_crm WHERE id = 'v3'`)).rows[0];
  const cp3 = (await query(`SELECT data->>'status' AS s FROM contas_pagar WHERE id = 'cp3'`)).rows[0];
  eq([v3.status, v3.s, cp3.s], ['CONFIRMADO', 'CONFIRMADO', 'PENDENTE'], 'a venda e a conta a pagar continuam como estavam');

  console.log('--- 6. comissão esperada × recebida ---');
  eq([d.comissao.esperada_centavos, d.comissao.informada_centavos, d.comissao.recebida_centavos], [20000, 20000, 10000], 'esperada pelas vendas, informada pela operadora e recebida no financeiro');
  como('VENDEDOR');
  eq((await detalhe(id)).status, 403, 'quem não tem o financeiro não abre a conferência');

  console.log('--- 5. fechar ---');
  como('ADMIN');
  r = await acao(id, { acao: 'fechar' });
  eq([r.status, /cancelamento proposto/.test(r.corpo.error), /não estão conferidas/.test(r.corpo.error)], [409, true, true], 'com proposta e linhas pendentes, não fecha, e diz por quê');
  r = await acao(id, { acao: 'aceitar', linha_id: L('DEF456').id, motivo: '' });
  eq(r.status, 400, 'aceitar sem motivo é recusado');
  r = await acao(id, { acao: 'aceitar', linha_id: L('DEF456').id, motivo: 'Reemissão com diferença tarifária combinada' });
  eq(r.status, 200, 'aceitar com motivo');
  r = await acao(id, { acao: 'ligar', linha_id: L('ZZZ000').id, item_id: 'i4' });
  d = (await detalhe(id)).corpo;
  eq([L('ZZZ000').situacao, L('ZZZ000').como_casou, L('ZZZ000').venda_numero], ['CONFERIDO', 'manual', 'V-4'], 'ligada à venda à mão, a linha é comparada de novo');
  r = await acao(id, { acao: 'ligar', linha_id: L('ZZZ000').id, item_id: 'i9' });
  eq(r.status, 404, 'não liga a item de outra agência');
  // A venda foi cancelada no sistema: casar de novo resolve a proposta.
  await query(`UPDATE vendas_crm SET status = 'CANCELADO', data = jsonb_set(data, '{status}', '"CANCELADO"') WHERE id = 'v3'`);
  r = await acao(id, { acao: 'recasar' });
  d = (await detalhe(id)).corpo;
  eq([r.status, L('GHI789').situacao, L('GHI789').proposta_status], [200, 'CONFERIDO', 'resolvida'], 'venda cancelada no sistema: a proposta fica resolvida');
  eq([L('ZZZ000').como_casou, L('DEF456').aceita_motivo !== null], ['manual', true], 'casar de novo mantém o que foi decidido à mão');
  eq(d.fechar.ok, true, 'agora dá para fechar');
  como('VENDEDOR');
  eq((await acao(id, { acao: 'fechar' })).status, 403, 'sem o direito de fechar caixa, não fecha');
  como('ADMIN');
  r = await acao(id, { acao: 'fechar' });
  eq(r.status, 200, 'fechada');
  d = (await detalhe(id)).corpo;
  eq([d.conferencia.status, !!d.conferencia.fechada_em], ['FECHADA', true], 'fica fechada, com quando');
  r = await acao(id, { acao: 'desfazer_aceite', linha_id: L('DEF456').id });
  eq([r.status, /fechada/.test(r.corpo.error)], [409, true], 'fechada: nenhuma linha muda');
  como('OPERADOR');
  eq((await acao(id, { acao: 'reabrir', motivo: 'Erro' })).status, 403, 'operador não reabre');
  como('ADMIN');
  eq((await acao(id, { acao: 'reabrir', motivo: '' })).status, 400, 'reabrir pede motivo');
  r = await acao(id, { acao: 'reabrir', motivo: 'A operadora mandou um extrato corrigido' });
  d = (await detalhe(id)).corpo;
  eq([r.status, d.conferencia.status, d.conferencia.reaberta_motivo], [200, 'ABERTA', 'A operadora mandou um extrato corrigido'], 'reaberta com o motivo guardado');

  console.log('--- regras de soma e data ---');
  resposta = { ...EXTRATO, total_liquido: 9999, linhas: [
    { data: '2026-11-15', localizador: 'ABC123', passageiro: 'SILVA/MARIA', tipo: 'venda', valor_bruto: 1000, comissao: 100, valor_liquido: 900 },
    { data: '2026-10-09', localizador: 'DEF456', passageiro: 'LIMA/JOAO', tipo: 'venda', valor_bruto: 1000, comissao: 100, valor_liquido: 800 },
  ] };
  r = await ler(pdf('extrato com erro'));
  const p2 = r.corpo.previa;
  eq([p2.checagem.soma_confere, p2.linhas.map(l => l.valido), p2.resumo.invalidas], [false, [false, false], 2], 'total que não bate, data fora do período e linha que não fecha são apontados');
  r = await post({ hash: r.corpo.hash, fornecedor_id: 'f-sol', fornecedor_nome: 'Sol Operadora' });
  const id2 = r.corpo.id;
  d = (await detalhe(id2)).corpo;
  eq([d.fechar.ok, d.fechar.motivos.some(m => /anterior/.test(m)) === false], [false, true], 'linha inválida não deixa fechar');
  eq(d.linhas.every(l => !l.resolvida), true, 'linha que não é válida não conta como conferida, mesmo casando com a venda');

  console.log('--- 7. isolamento ---');
  como('ADMIN', 'op-t2');
  eq((await lista()).conferencias.length, 0, 'outra agência não vê as conferências');
  eq((await detalhe(id)).status, 404, 'nem abre a conferência pelo id');
  eq((await acao(id, { acao: 'fechar' })).status, 404, 'nem fecha');
  eq((await post({ hash, fornecedor_id: '', fornecedor_nome: 'Sol' })).status, 404, 'nem usa a leitura guardada da primeira pelo hash');
  como('ADMIN');
  const l1 = await lista();
  eq([l1.conferencias.length, l1.comissao.length >= 1], [2, true], 'a lista da agência traz as duas e a comissão por operadora');
  const busca = await lista('?venda=ABC');
  eq(busca.itens.map(i => i.item_id), ['i1'], 'a busca para ligar à mão só traz vendas da agência');
} finally {
  console.log(`\n${total - falhas}/${total} passaram`);
  if (falhas > 0) process.exit(1);
}
