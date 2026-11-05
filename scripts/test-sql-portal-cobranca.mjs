/**
 * E3 · Portal do cliente e telas de cobrança contra um Postgres real
 * (PGlite), chamando as ROTAS de produção com sessões de teste (05/11/2026).
 *
 * As tabelas `cobrancas` e a do link do portal são da parte A (núcleo de
 * cobrança); aqui elas nascem com o esquema que esta parte assume
 * (ESQUEMA_ASSUMIDO_DO_PORTAL), para provar o recorte:
 *
 *  1. LINK por cliente: só quem emite boleto cria/revoga; o banco guarda só o
 *     hash do token; criar de novo derruba o anterior; revogar fecha na hora.
 *  2. ISOLAMENTO: o token de um cliente não vê conta de outro cliente da
 *     mesma agência, nem de outra agência (nem com o MESMO id de cliente),
 *     nem conta cancelada ou comissão de fornecedor; o recibo pelo portal
 *     segue a mesma regra.
 *  3. NADA SENSÍVEL na resposta: sem CPF inteiro, sem id de cliente/agência,
 *     sem margem, observação ou categoria.
 *  4. LIMITES: formato errado e token inexistente dão o mesmo 404; quem erra
 *     demais do mesmo IP leva 429 antes de ir ao banco; outro IP segue.
 *  5. LISTA Contas a Pagar/Receber: coluna e filtro "Boleto não emitido".
 *  6. RECIBO interno: valor por extenso, documento inteiro, só da agência.
 *
 * Uso: node --no-warnings scripts/test-sql-portal-cobranca.mjs
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
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE clientes (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id));
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, usuario_id TEXT, acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT,
    data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
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
process.env.JWT_SECRET = 'segredo-de-teste-portal';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { ESQUEMA_ASSUMIDO_DO_PORTAL, hashDoToken } = await import('../src/lib/cobranca/portal-servidor.ts');
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(ESQUEMA_ASSUMIDO_DO_PORTAL);

const P = await import('../src/lib/permissoes-servidor.ts');
const { limparLimitePublicoParaTeste } = await import('../src/lib/limite-publico.ts');
const { hojeISO, addDias } = await import('../src/lib/money.ts');
const RLinks = await import('../src/app/api/portal-links/route.ts');
const RPortal = await import('../src/app/api/portal/[token]/route.ts');
const RReciboPortal = await import('../src/app/api/portal/[token]/recibo/[conta]/route.ts');
const RRecibo = await import('../src/app/api/recibos/[conta]/route.ts');
const RLista = await import('../src/app/api/contas-pagar-receber/route.ts');

const T = 'ag-1';
const T2 = 'ag-2';
const HOJE = hojeISO();
const D = n => addDias(HOJE, n);
const sessao = (perfil, tenant = T, userId = `u-${perfil}-${tenant}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo, ip = '10.0.0.1') => new Request(`http://localhost${url}`, {
  method: metodo,
  headers: { 'content-type': 'application/json', 'x-real-ip': ip },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json(), headers: r.headers });
const portal = (token, ip) => RPortal.GET(req(`/api/portal/${token}`, 'GET', undefined, ip), { params: Promise.resolve({ token }) }).then(json);
const reciboPortal = (token, conta, ip) => RReciboPortal.GET(req(`/api/portal/${token}/recibo/${conta}`, 'GET', undefined, ip), { params: Promise.resolve({ token, conta }) }).then(json);
const links = (metodo, cliente) => (metodo === 'GET'
  ? RLinks.GET(req(`/api/portal-links?cliente_id=${cliente}`))
  : RLinks[metodo](req('/api/portal-links', metodo, { cliente_id: cliente }))).then(json);
const tokenDe = url => String(url ?? '').split('/c/')[1] ?? '';

// ---------------------------------------------------------------------------
// Cadastro: agência 1 com Ana e Bruno; agência 2 com um cliente de MESMO id da Ana.
for (const [id, t, perfil] of [['u-ADMIN-ag-1', T, 'ADMIN'], ['u-VENDEDOR-ag-1', T, 'VENDEDOR'], ['u-ADMIN-ag-2', T2, 'ADMIN']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, t, JSON.stringify({ id, nome: id, perfil, ativo: true })]);
}
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('a1', $1, $2), ('a2', $3, $4)`, [
  T, JSON.stringify({ razao_social: 'Boas Viagens Ltda', nome_fantasia: 'Boas Viagens', cnpj: '11222333000181', telefone: '(11) 98888-7777', endereco: { cidade: 'São Paulo' } }),
  T2, JSON.stringify({ razao_social: 'Outra Agência', nome_fantasia: 'Outra', cnpj: '99888777000166' }),
]);
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data) VALUES
  ('cli-a', $1, 'Ana Souza', '12345678909', '{"nome":"Ana Souza","observacoes":"prefere janela"}'),
  ('cli-b', $1, 'Bruno Lima', '98765432100', '{"nome":"Bruno Lima"}'),
  ('cli-a', $2, 'Ana de Outra Agência', '11144477735', '{"nome":"Ana de Outra Agência"}')`, [T, T2]);
const cr = (id, cliente, data, t = T) => query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ($1,$2,$3,$4,$5)`,
  [id, t, cliente, data.status ?? 'PENDENTE', JSON.stringify({ id, cliente_id: cliente, status: 'PENDENTE', ...data })]);
await cr('a1', 'cli-a', { cliente_nome: 'Ana Souza', descricao: 'Pacote Lisboa', valor_final: 1000, data_vencimento: D(10), parcela_numero: 1, total_parcelas: 2, margem_agencia: 321, observacoes: 'segredo interno' });
await cr('a2', 'cli-a', { status: 'RECEBIDO', cliente_nome: 'Ana Souza', descricao: 'Seguro viagem', valor_final: 500, valor_recebido: 500, data_recebimento: D(-3), data_vencimento: D(-3), forma_recebimento: 'PIX' });
await cr('a3', 'cli-a', { status: 'CANCELADO', cliente_nome: 'Ana Souza', descricao: 'Cancelada', valor_final: 77 });
await cr('a4', 'cli-a', { origem: 'COMISSAO_FORNECEDOR', cliente_nome: 'Operadora X', descricao: 'Comissão', valor_final: 150, data_vencimento: D(5) });
await cr('a5', 'cli-a', { cliente_nome: 'Ana Souza', descricao: 'Ingressos', valor_final: 300, data_vencimento: D(-2) });
await cr('a6', 'cli-a', { cliente_nome: 'Ana Souza', descricao: 'Transfer', valor_final: 120, data_vencimento: D(20) });
await cr('b1', 'cli-b', { cliente_nome: 'Bruno Lima', descricao: 'Cruzeiro', valor_final: 700, data_vencimento: D(7) });
await cr('z1', 'cli-a', { cliente_nome: 'Ana de Outra Agência', descricao: 'Outra viagem', valor_final: 999, data_vencimento: D(3) }, T2);
const cob = (id, titulo, status, t = T, extra = {}) => query(
  `INSERT INTO cobrancas (id, tenant_id, titulo_id, provedor, tipo, status, valor_centavos, vencimento, linha_digitavel, pix_copia_cola, url_boleto, url_fatura, criado_em)
   VALUES ($1,$2,$3,'asaas','boleto_pix',$4,$5,$6,$7,$8,$9,$10,$11)`,
  [id, t, titulo, status, extra.valor ?? 100000, extra.venc ?? D(10), '23793381286000782713695000063305975520000370000', `pix-${id}`, `https://asaas/b/${id}.pdf`, `https://asaas/i/${id}`, extra.criado ?? new Date().toISOString()],
);
await cob('cob-a1-velha', 'a1', 'cancelada', T, { criado: '2026-01-01T00:00:00Z' });
await cob('cob-a1', 'a1', 'aberta');
await cob('cob-a6', 'a6', 'falhou', T, { valor: 12000 });
await cob('cob-b1', 'b1', 'aberta', T, { valor: 70000 });
await cob('cob-z1', 'z1', 'aberta', T2, { valor: 99900 });
// Baixa da conta recebida (recibo)
await query(`INSERT INTO baixas (id, tenant_id, titulo_tabela, titulo_id, data_baixa, forma, valor_centavos, origem)
  VALUES ('bx-a2', $1, 'contas_receber', 'a2', $2, 'PIX', 50000, 'plataforma')`, [T, D(-3)]);

// ---------------------------------------------------------------------------
console.log('--- 1. Link do portal por cliente ---');
como(sessao('VENDEDOR'));
let r = await links('POST', 'cli-a');
eq(r.status, 403, 'quem não emite boleto não cria link');
como(sessao('ADMIN'));
r = await links('POST', 'cli-x');
eq(r.status, 404, 'cliente que não existe na agência: 404');
como(sessao('ADMIN', T2));
r = await links('POST', 'cli-b');
eq(r.status, 404, 'agência 2 não cria link para cliente da agência 1');
como(sessao('ADMIN'));
r = await links('GET', 'cli-a');
eq([r.status, r.corpo.ativo], [200, false], 'antes de criar: sem link');
r = await links('POST', 'cli-a');
eq([r.status, r.corpo.ativo, /\/c\/[A-Za-z0-9_-]{43}$/.test(r.corpo.url)], [201, true, true], 'cria o link com token de 43 caracteres');
let tokenAna = tokenDe(r.corpo.url);
const linha = (await query(`SELECT * FROM cobranca_portal_links WHERE tenant_id = $1 AND cliente_id = 'cli-a' AND revogado_em IS NULL`, [T])).rows[0];
eq([linha.token_hash === hashDoToken(tokenAna), JSON.stringify(linha).includes(tokenAna)], [true, false], 'o banco guarda só o hash do token');
r = await links('GET', 'cli-a');
eq([r.corpo.ativo, r.corpo.acessos], [true, 0], 'link ativo, ainda não aberto');
eq((await query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE entidade = 'portal_do_cliente'`)).rows[0].n, 1, 'criar o link fica no registro de atividades');

como(sessao('ADMIN', T2));
r = await links('POST', 'cli-a');
const tokenOutra = tokenDe(r.corpo.url);
eq([r.status, tokenOutra !== tokenAna], [201, true], 'agência 2 cria o link do cliente dela (mesmo id de cliente)');

// ---------------------------------------------------------------------------
console.log('--- 2. Isolamento pelo token ---');
como(null);
limparLimitePublicoParaTeste();
r = await portal(tokenAna);
eq(r.status, 200, 'portal abre sem login');
eq(r.corpo.em_aberto.map(i => i.ref), ['a5', 'a1', 'a6'], 'só as contas em aberto da Ana nesta agência (sem cancelada nem comissão de fornecedor)');
eq(r.corpo.pagas.map(i => i.ref), ['a2'], 'pagas da Ana');
eq(r.corpo.em_aberto.find(i => i.ref === 'a1').cobranca.pix_copia_cola, 'pix-cob-a1', 'a cobrança viva da conta (não a cancelada)');
eq(r.corpo.em_aberto.find(i => i.ref === 'a6').cobranca, null, 'cobrança que falhou não vira botão de pagar');
eq(r.corpo.em_aberto.find(i => i.ref === 'a5').situacao, 'em_atraso', 'vencida aparece em atraso');
eq(r.corpo.total_em_aberto, 1420, 'total em aberto');
eq([r.corpo.cliente.primeiro_nome, r.corpo.cliente.documento, r.corpo.agencia.nome], ['Ana', '***.456.789-**', 'Boas Viagens'], 'primeiro nome, CPF mascarado, nome da agência');
const texto = JSON.stringify(r.corpo);
eq(['b1', 'z1', 'cob-b1', 'pix-cob-z1', 'Cruzeiro', 'Outra viagem', '12345678909', 'cli-a', 'ag-1', 'segredo interno', '321', 'prefere janela', '11222333000181', 'a3', 'a4']
  .filter(t => texto.includes(`"${t}"`) || (t.length > 4 && texto.includes(t))), [], 'nada de outro cliente, outra agência, CPF inteiro, ids internos, margem ou observação');
eq([r.headers.get('cache-control'), r.headers.get('referrer-policy'), r.headers.get('x-robots-tag')], ['private, no-store', 'no-referrer', 'noindex, nofollow, noarchive'], 'sem cache, sem Referer, sem indexação');
r = await portal(tokenOutra);
eq([r.corpo.em_aberto.map(i => i.ref), r.corpo.pagas.length, r.corpo.agencia.nome], [['z1'], 0, 'Outra'], 'o token da agência 2 vê só a conta dela, mesmo com o mesmo id de cliente');
como(sessao('ADMIN'));
r = await links('GET', 'cli-a');
eq(r.corpo.acessos, 1, 'a visita conta');
como(null);

console.log('--- 2b. Recibo pelo portal ---');
r = await reciboPortal(tokenAna, 'a2');
eq([r.status, r.corpo.valor, r.corpo.valor_por_extenso, r.corpo.pagador.documento], [200, 500, 'Quinhentos reais', '***.456.789-**'], 'recibo da conta paga, com CPF mascarado');
eq((await reciboPortal(tokenAna, 'b1')).status, 404, 'conta de outro cliente: 404');
eq((await reciboPortal(tokenAna, 'z1')).status, 404, 'conta de outra agência: 404');
eq((await reciboPortal(tokenOutra, 'a2')).status, 404, 'token da agência 2 não abre recibo da agência 1');
eq((await reciboPortal(tokenAna, 'a4')).status, 404, 'comissão de fornecedor: 404');
eq((await reciboPortal(tokenAna, 'a1')).status, 422, 'conta em aberto: sem recibo, com o motivo');

// ---------------------------------------------------------------------------
console.log('--- 3. Revogar e gerar de novo ---');
como(sessao('ADMIN'));
r = await links('DELETE', 'cli-a');
eq([r.status, r.corpo.ativo], [200, false], 'revoga');
como(null);
limparLimitePublicoParaTeste();
eq((await portal(tokenAna)).status, 404, 'link revogado não abre');
eq((await reciboPortal(tokenAna, 'a2')).status, 404, 'nem o recibo');
como(sessao('ADMIN'));
const novo = tokenDe((await links('POST', 'cli-a')).corpo.url);
const outroNovo = tokenDe((await links('POST', 'cli-a')).corpo.url);
como(null);
eq([(await portal(novo)).status, (await portal(outroNovo)).status], [404, 200], 'gerar outro derruba o anterior');
eq((await query(`SELECT COUNT(*)::int AS n FROM cobranca_portal_links WHERE tenant_id = $1 AND cliente_id = 'cli-a' AND revogado_em IS NULL`, [T])).rows[0].n, 1, 'um link ativo por cliente');
tokenAna = outroNovo;

// ---------------------------------------------------------------------------
console.log('--- 4. Limites e respostas iguais ---');
limparLimitePublicoParaTeste();
const formatoErrado = await portal("x' OR '1'='1");
const naoExiste = await portal('A'.repeat(43));
eq([formatoErrado.status, naoExiste.status, formatoErrado.corpo.error === naoExiste.corpo.error], [404, 404, true], 'formato errado e token inexistente: a mesma resposta');
limparLimitePublicoParaTeste();
for (let i = 0; i < 10; i++) await portal(`chute${String(i).padStart(40, '0')}`, '10.9.9.9');
eq((await portal(tokenAna, '10.9.9.9')).status, 429, 'depois de 10 tokens errados, o IP espera (nem o certo passa)');
eq((await portal(tokenAna, '10.1.1.1')).status, 200, 'outro IP segue normal');
limparLimitePublicoParaTeste();
let ultimo = 0;
for (let i = 0; i < 61; i++) ultimo = (await portal(tokenAna, '10.2.2.2')).status;
eq(ultimo, 429, 'mais de 60 leituras em 10 minutos do mesmo IP: espera');
limparLimitePublicoParaTeste();

// ---------------------------------------------------------------------------
console.log('--- 5. Lista Contas a Pagar/Receber: "Boleto não emitido" ---');
como(sessao('ADMIN'));
const lista = async (p = {}) => json(await RLista.GET(req(`/api/contas-pagar-receber?${new URLSearchParams({ por_pagina: '500', ...p })}`)));
r = await lista({ tipo: 'receber' });
const porId = Object.fromEntries(r.corpo.linhas.map(l => [l.id, l.cobranca_status]));
eq([porId.a1, porId.a6, porId.b1, porId.a5, porId.a2], ['aberta', 'falhou', 'aberta', '', ''], 'cada conta traz a situação da cobrança (a viva vence a cancelada)');
r = await lista({ cobranca: 'sem_boleto' });
eq(r.corpo.linhas.map(l => l.id).sort(), ['a4', 'a5', 'a6'], 'Boleto não emitido: a receber em aberto sem cobrança viva (a que falhou entra)');
r = await lista({ cobranca: 'emitida' });
eq(r.corpo.linhas.map(l => l.id).sort(), ['a1', 'b1'], 'Boleto emitido');
eq((await lista({ cobranca: 'qualquer' })).status, 400, 'filtro desconhecido: 400');
eq(r.corpo.linhas.some(l => l.id === 'z1'), false, 'outra agência nunca entra');

// ---------------------------------------------------------------------------
console.log('--- 6. Recibo interno ---');
const recibo = (conta, baixa) => RRecibo.GET(req(`/api/recibos/${conta}${baixa ? `?baixa=${baixa}` : ''}`), { params: Promise.resolve({ conta }) }).then(json);
r = await recibo('a2');
eq([r.status, r.corpo.valor, r.corpo.pagador.documento, r.corpo.emitente.documento, r.corpo.forma], [200, 500, '123.456.789-09', 'CNPJ 11.222.333/0001-81', 'Pix'], 'recibo da conta recebida, com o documento inteiro para a agência');
r = await recibo('a2', 'bx-a2');
eq([r.status, r.corpo.valor], [200, 500], 'recibo de um recebimento');
eq((await recibo('a1')).status, 422, 'conta em aberto: sem recibo');
eq((await recibo('z1')).status, 404, 'conta de outra agência: 404');
como(sessao('VENDEDOR'));
eq((await recibo('a2')).status >= 400, true, 'quem não vê o financeiro não abre recibo');
como(null);
eq((await recibo('a2')).status >= 400, true, 'sem login, não abre');

console.log(`\n${total - falhas}/${total} testes do portal e das telas de cobrança passaram`);
if (falhas > 0) process.exit(1);
