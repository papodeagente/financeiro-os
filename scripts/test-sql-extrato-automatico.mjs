/**
 * Extrato automático (06/11/2026, E6 parte B) contra um Postgres real
 * (PGlite), rodando o código DE PRODUÇÃO: cifra das credenciais, leitura
 * serial e idempotente por janela, deduplicação pelo identificador do banco
 * (no mesmo lugar do FITID), erro do banco com nova tentativa, certificado
 * vencendo, isolamento entre agências, permissão por conta bancária e a
 * tarefa do agendador.
 *
 * O banco é simulado com as respostas da documentação oficial do Inter; o
 * fetch global explode se alguém tentar sair para a internet.
 *
 * Uso: node --no-warnings scripts/test-sql-extrato-automatico.mjs
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

let fetchReal = 0;
globalThis.fetch = async () => { fetchReal++; throw new Error('o teste não pode chamar a internet'); };
// O cliente mTLS de verdade usa node:https: aqui ele explode e conta.
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
https.request = () => { fetchReal++; throw new Error('o teste não pode chamar o banco de verdade'); };
syncBuiltinESMExports();

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
const CHAVE_MESTRA = 'e'.repeat(64);
process.env.INTEGRACOES_MASTER_KEY = CHAVE_MESTRA;
process.env.JWT_SECRET = 'segredo-de-teste-extrato';

const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const X = await import('../src/lib/extrato-importacao.ts');
const S = await import('../src/lib/extrato-automatico/servidor.ts');
const { limparEspacamentoInter } = await import('../src/lib/extrato-automatico/adaptador-inter.ts');
const { decifrar } = await import('../src/lib/cofre.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { conciliarComContas } = await import('../src/lib/conciliacao-servidor.ts');
const { rodarAgendador } = await import('../src/lib/agendador/nucleo.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const { gerarParPemDeTeste } = await import('./cert-pem-de-teste.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(X.EXTRATO_FITID_UNICO_SQL);
await pg.exec(S.EXTRATO_AUTOMATICO_SCHEMA_SQL);
await pg.exec(S.EXTRATO_AUTOMATICO_SCHEMA_SQL); // idempotente
await pg.exec(X.EXTRATO_ID_EXTERNO_UNICO_SQL);
await pg.exec(X.EXTRATO_ID_EXTERNO_UNICO_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);

const T = 'ag-1', T2 = 'ag-2';
for (const [id, t, nome] of [['b1', T, 'Inter da agência'], ['b2', T, 'Inter reserva'], ['b3', T, 'Inter antigo'], ['c1', T2, 'Inter da outra']]) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, t, JSON.stringify({ id, nome, saldo_inicial: 0, saldo_atual: 0 })]);
}
for (const [id, perfil, t] of [['u-ADMIN', 'ADMIN', T], ['u-OPERADOR', 'OPERADOR', T], ['u-op2', 'OPERADOR', T], ['u-ADMIN2', 'ADMIN', T2]]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, t, JSON.stringify({ id, nome: id, perfil, ativo: true })]);
}
await query(`INSERT INTO vendas_crm (id, tenant_id, data) VALUES ('v1', $1, '{"numero":"V1"}')`, [T]);

const um = async (sql, v) => (await query(sql, v)).rows[0];
const contar = async (sql, v) => Number((await um(sql, v)).n);

// ── O banco simulado ───────────────────────────────────────────────────────
const par = gerarParPemDeTeste({ inicio: new Date('2026-01-10T12:00:00Z'), dias: 365 });
const parVencendo = gerarParPemDeTeste({ inicio: new Date('2025-12-01T12:00:00Z'), dias: 365 }); // vence 01/12/2026
const SEGREDO = 'client-secret-que-nao-pode-vazar';
const cred = (p = par, extra = {}) => ({ clientId: 'cli-ag1', clientSecret: SEGREDO, certificadoPem: p.certificadoPem, chavePrivadaPem: p.chavePrivadaPem, extras: {}, ...extra });

let AGORA = new Date('2026-11-06T12:00:00Z');
const banco = {
  pedidos: [],
  transacoes: [],
  extratoStatus: 200,
  tokenStatus: 200,
};
const http = async p => {
  banco.pedidos.push(p);
  const u = new URL(p.url);
  if (u.pathname === '/oauth/v2/token') {
    if (banco.tokenStatus !== 200) return { status: banco.tokenStatus, texto: '{"error":"invalid_client"}' };
    return { status: 200, texto: JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'extrato.read' }) };
  }
  if (u.pathname === '/banking/v2/extrato/completo') {
    if (banco.extratoStatus !== 200) return { status: banco.extratoStatus, texto: '{"title":"Serviço indisponível"}' };
    const de = u.searchParams.get('dataInicio'), ate = u.searchParams.get('dataFim');
    const doPeriodo = banco.transacoes.filter(t => t.dataTransacao >= de && t.dataTransacao <= ate);
    return { status: 200, texto: JSON.stringify({ totalPaginas: 1, ultimaPagina: true, primeiraPagina: true, numeroDeElementos: doPeriodo.length, transacoes: doPeriodo }) };
  }
  if (u.pathname === '/banking/v2/saldo') return { status: 200, texto: JSON.stringify({ disponivel: 4321.09, bloqueadoCheque: 0, limite: 0 }) };
  return { status: 404, texto: '{}' };
};
const ambiente = { http, agora: () => AGORA.getTime(), esperar: async () => {} };
const tx = (id, data, valor, tipo, titulo, descricao, tipoTransacao = 'PIX') => ({
  idTransacao: id, dataInclusao: data, dataTransacao: data, tipoTransacao, tipoOperacao: tipo, valor, titulo, descricao,
});
const ler = (tenant, conexao, origem = 'agendada', extra = {}) => {
  limparEspacamentoInter();
  return S.sincronizarConexao(pool, tenant, conexao, { origem, ambiente, emTransacao, agora: AGORA, ...extra });
};
const conexao = async id => um(`SELECT *, expira_em::text AS expira, ultima_janela_de::text AS de, ultima_janela_ate::text AS ate FROM conexoes_bancarias WHERE id = $1`, [id]);
const linhasDa = async conta => (await query(`SELECT id, status_conciliacao, data FROM extrato_bancario WHERE tenant_id = $1 AND conta_bancaria_id = $2 ORDER BY data->>'data', id`, [T, conta])).rows;

console.log('--- 1. Cifra: o segredo gravado é ilegível ---');
const c1 = await S.salvarConexao(pool, { tenantId: T, contaId: 'b1', provedor: 'inter', credencial: cred(), expiraEm: '2027-01-10', apelido: 'Inter PJ', usuario: 'u-ADMIN', agora: AGORA });
eq(c1.renovada, false, 'conexão nova');
{
  const bruto = JSON.stringify((await query(`SELECT * FROM conexoes_bancarias_segredo`)).rows);
  eq([bruto.includes(SEGREDO), bruto.includes('BEGIN CERTIFICATE'), bruto.includes('PRIVATE KEY'), bruto.includes('cli-ag1')], [false, false, false, false],
    'SELECT * no segredo não mostra ClientSecret, certificado, chave nem ClientId');
  const conx = JSON.stringify((await query(`SELECT * FROM conexoes_bancarias`)).rows);
  eq(conx.includes(SEGREDO) || conx.includes('BEGIN'), false, 'a linha da conexão não tem material sensível');
  const env = (await um(`SELECT envelope FROM conexoes_bancarias_segredo WHERE conexao_id = $1`, [c1.id])).envelope;
  eq(JSON.parse(decifrar(env)).clientSecret, SEGREDO, 'com a chave mestra, decifra de volta');
  eq([env.v, typeof env.iv, typeof env.tag], [1, 'string', 'string'], 'envelope AES-256-GCM {v, iv, tag, ct}');
}

console.log('--- 2. Primeira leitura: 90 dias, linhas entram na conciliação ---');
banco.transacoes = [
  tx('it-1', '2026-11-03', '1500.00', 'C', 'Pix recebido', 'PIX RECEBIDO - MARIA SILVA'),
  tx('it-2', '2026-11-04', '12.90', 'D', 'Tarifa', 'Manutenção de conta', 'TARIFA'),
  tx('it-3', '2026-10-01', '800.00', 'D', 'Pagamento', 'Boleto operadora', 'PAGAMENTO'),
];
let r = await ler(T, c1.id);
eq([r.resultado, r.inseridas, r.duplicadas, r.janela], ['ok', 3, 0, { de: '2026-08-09', ate: '2026-11-06' }], 'leu os 90 dias e gravou 3 linhas');
{
  const ls = await linhasDa('b1');
  eq(ls.map(l => [l.data.id_externo, l.data.valor, l.status_conciliacao, l.data.origem]), [
    ['it-3', -800, 'PENDENTE', 'SINCRONIZACAO'], ['it-1', 1500, 'PENDENTE', 'SINCRONIZACAO'], ['it-2', -12.9, 'PENDENTE', 'SINCRONIZACAO'],
  ], 'em reais, com sinal, pendentes de conciliação e marcadas como vindas do banco');
  eq(ls[0].data.arquivo_origem, 'Leitura automática · Banco Inter Empresas', 'a tela atual mostra a procedência');
  const c = await conexao(c1.id);
  eq([c.status, c.de, c.ate, Number(c.saldo_banco_centavos), c.falhas_consecutivas], ['ATIVA', '2026-08-09', '2026-11-06', 432109, 0], 'conexão: janela lida e saldo do banco');
  eq(new Date(c.proxima_sincronizacao_em).toISOString(), '2026-11-07T12:00:00.000Z', 'próxima leitura em 24 horas');
  const h = (await query(`SELECT status, inseridas, origem FROM sincronizacoes_bancarias WHERE conexao_id = $1`, [c1.id])).rows;
  eq(h, [{ status: 'OK', inseridas: 3, origem: 'agendada' }], 'histórico da leitura');
}

console.log('--- 3. Idempotente por janela ---');
let antes = banco.pedidos.length;
r = await ler(T, c1.id);
eq([r.resultado, banco.pedidos.length - antes], ['ja_feita', 0], 'a mesma hora não lê de novo (nem chama o banco)');
AGORA = new Date('2026-11-06T12:00:40Z');
r = await ler(T, c1.id, 'manual');
eq([r.resultado, r.inseridas, r.duplicadas, r.janela.de], ['ok', 0, 2, '2026-11-03'], 'pedida na tela: relê os últimos dias e nada duplica');
r = await ler(T, c1.id, 'manual');
eq(r.resultado, 'ja_feita', 'dois cliques no mesmo minuto: uma leitura só');

console.log('--- 4. Dia seguinte: sobreposição de 3 dias sem duplicar ---');
AGORA = new Date('2026-11-07T12:05:00Z');
banco.transacoes.push(tx('it-4', '2026-11-07', '250.00', 'C', 'Pix recebido', 'PIX RECEBIDO - JOAO'));
antes = banco.pedidos.length;
r = await ler(T, c1.id);
eq([r.resultado, r.inseridas, r.duplicadas, r.janela], ['ok', 1, 2, { de: '2026-11-03', ate: '2026-11-07' }], 'relê de 03/11 (3 dias antes do fim da última) e só a nova entra');
const extratoPedido = banco.pedidos.slice(antes).find(p => p.url.includes('/extrato/completo'));
eq(new URL(extratoPedido.url).searchParams.get('dataInicio'), '2026-11-03', 'o banco recebeu o período certo');
eq(await contar(`SELECT COUNT(*) n FROM extrato_bancario WHERE conta_bancaria_id = 'b1'`), 4, '4 linhas, nenhuma repetida');

console.log('--- 5. Pendente que vira efetivado preserva a conciliação ---');
{
  const origem = { conexao_id: c1.id, sincronizacao_id: 's-x', rotulo: 'Leitura automática' };
  await emTransacao(t => X.gravarExtratoSincronizado(t, T, 'b1', origem, [{ id_externo: 'pend-1', data: '2026-11-05', valor: 700, descricao: 'Pix agendado', pendente: true, saldo: null, categoria_origem: 'PIX' }]));
  const linha = (await um(`SELECT id FROM extrato_bancario WHERE data->>'id_externo' = 'pend-1'`)).id;
  await query(`INSERT INTO contas_receber (id, tenant_id, venda_id, status, data) VALUES ('r1', $1, 'v1', 'PENDENTE', $2)`,
    [T, JSON.stringify({ id: 'r1', status: 'PENDENTE', valor_final: 700, data_vencimento: '2026-11-05', valor_recebido: null, data_recebimento: null, conta_bancaria_id: null, venda_id: 'v1' })]);
  await emTransacao(t => conciliarComContas(t, T, linha, [{ tipo: 'CONTA_RECEBER', id: 'r1' }]));
  const g = await emTransacao(t => X.gravarExtratoSincronizado(t, T, 'b1', origem, [{ id_externo: 'pend-1', data: '2026-11-05', valor: 700, descricao: 'PIX RECEBIDO - CLIENTE', pendente: false, saldo: null, categoria_origem: 'PIX' }]));
  const d = await um(`SELECT id, status_conciliacao, data FROM extrato_bancario WHERE data->>'id_externo' = 'pend-1'`);
  eq([g.atualizadas, g.inseridas, d.id === linha, d.status_conciliacao, d.data.pendente, d.data.descricao, d.data.vinculos?.[0]?.id],
    [1, 0, true, 'CONCILIADO', false, 'PIX RECEBIDO - CLIENTE', 'r1'], 'atualiza a mesma linha, mantém CONCILIADO e o vínculo');
  const g2 = await emTransacao(t => X.gravarExtratoSincronizado(t, T, 'b1', origem, [{ id_externo: 'pend-1', data: '2026-11-05', valor: 700, descricao: 'outra', pendente: false, saldo: null, categoria_origem: null }]));
  eq([g2.atualizadas, g2.duplicadas], [0, 1], 'efetivada não muda mais');
}

console.log('--- 6. Arquivo e leitura automática não duplicam um ao outro ---');
{
  // Antes de conectar, a agência importou o OFX da conta b2.
  const arq = await emTransacao(t => X.importarExtrato(t, T, 'b2', 'extrato.ofx', [
    { data: '2026-11-04', descricao: 'PIX MARIA', valor: 300, fitid: 'OFX-1' },
    { data: '2026-11-04', descricao: 'PIX MARIA', valor: 300, fitid: 'OFX-2' },
  ]));
  eq(arq.inseridas, 2, 'arquivo com duas linhas iguais de FITIDs diferentes');
  const c2 = await S.salvarConexao(pool, { tenantId: T, contaId: 'b2', provedor: 'inter', credencial: cred(), expiraEm: '2027-01-10', agora: AGORA });
  const salvo = banco.transacoes;
  banco.transacoes = [tx('X-1', '2026-11-04', '300.00', 'C', 'Pix', 'PIX MARIA'), tx('X-2', '2026-11-04', '300.00', 'C', 'Pix', 'PIX MARIA'), tx('X-3', '2026-11-04', '300.00', 'C', 'Pix', 'PIX MARIA')];
  r = await ler(T, c2.id);
  eq([r.inseridas, r.duplicadas], [1, 2], 'as duas do arquivo são reconhecidas (data + valor, uma por uma) e só a terceira entra');
  eq((await linhasDa('b2')).filter(l => l.data.fitid).map(l => l.data.id_externo).sort(), ['X-1', 'X-2'], 'as linhas do arquivo ganham o identificador do banco');
  AGORA = new Date('2026-11-07T13:10:00Z');
  r = await ler(T, c2.id, 'manual');
  eq([r.inseridas, r.duplicadas], [0, 3], 'na próxima, o identificador do banco já reconhece direto');
  const reimp = await emTransacao(t => X.importarExtrato(t, T, 'b2', 'extrato.ofx', [
    { data: '2026-11-04', descricao: 'PIX MARIA', valor: 300, fitid: 'OFX-1' },
    { data: '2026-11-04', descricao: 'PIX MARIA', valor: 300, fitid: 'OFX-2' },
    { data: '2026-11-04', descricao: 'PIX MARIA', valor: 300, fitid: 'OFX-3' },
  ]));
  eq([reimp.inseridas, reimp.duplicadas], [0, 3], 'o OFX baixado depois não duplica o que chegou sozinho');
  eq(await contar(`SELECT COUNT(*) n FROM extrato_bancario WHERE conta_bancaria_id = 'b2'`), 3, 'b2 com 3 linhas, como no banco');
  banco.transacoes = salvo;
  globalThis.__c2 = c2.id;
}

console.log('--- 7. Serial por conta ---');
{
  AGORA = new Date('2026-11-07T14:00:00Z');
  await query(`INSERT INTO sincronizacoes_bancarias (id, tenant_id, conexao_id, origem, status, iniciada_em) VALUES ('presa', $1, $2, 'manual', 'EXECUTANDO', $3)`,
    [T, c1.id, new Date(AGORA.getTime() - 5 * 60_000).toISOString()]);
  antes = banco.pedidos.length;
  r = await ler(T, c1.id, 'manual');
  eq([r.resultado, banco.pedidos.length - antes], ['em_andamento', 0], 'com uma leitura em andamento, a segunda não roda');
  AGORA = new Date('2026-11-07T14:11:00Z');
  r = await ler(T, c1.id, 'manual');
  eq([r.resultado, (await um(`SELECT status FROM sincronizacoes_bancarias WHERE id = 'presa'`)).status], ['ok', 'ABANDONADA'], 'leitura parada há mais de 15 minutos é liberada');
}

console.log('--- 8. Erro do banco: nova tentativa, Atenção e aviso ---');
{
  banco.extratoStatus = 503;
  const avisosAntes = await contar(`SELECT COUNT(*) n FROM notificacoes WHERE tipo = 'EXTRATO_AUTOMATICO'`);
  AGORA = new Date('2026-11-08T12:00:00Z');
  r = await ler(T, c1.id);
  let c = await conexao(c1.id);
  eq([r.resultado, r.motivo, c.status, c.falhas_consecutivas], ['falhou', 'INDISPONIVEL', 'ATIVA', 1], '1ª falha: continua ativa');
  eq(new Date(c.proxima_sincronizacao_em).getTime() - AGORA.getTime(), 3_600_000, 'tenta de novo em 1 hora');
  eq(c.ultimo_erro.mensagem.includes('fora do ar'), true, 'erro em palavras simples');
  eq((await um(`SELECT status, motivo FROM sincronizacoes_bancarias WHERE conexao_id = $1 ORDER BY iniciada_em DESC LIMIT 1`, [c1.id])), { status: 'FALHOU', motivo: 'INDISPONIVEL' }, 'histórico registra a falha');
  AGORA = new Date('2026-11-08T13:00:00Z');
  await ler(T, c1.id);
  AGORA = new Date('2026-11-08T17:00:00Z');
  await ler(T, c1.id);
  c = await conexao(c1.id);
  eq([c.status, c.falhas_consecutivas, new Date(c.proxima_sincronizacao_em).getTime() - AGORA.getTime()], ['ATENCAO', 3, 24 * 3_600_000], '3 falhas: Atenção e próxima em 24 horas');
  eq(await contar(`SELECT COUNT(*) n FROM notificacoes WHERE tipo = 'EXTRATO_AUTOMATICO'`) - avisosAntes, 1, 'um aviso no sino');
  const lista = await S.listarConexoes(pool, T, null, AGORA);
  eq(lista.find(x => x.id === c1.id).saude.titulo, 'Atenção, 3 falhas seguidas', 'a tela mostra a saúde');
  banco.extratoStatus = 200;
  AGORA = new Date('2026-11-09T17:30:00Z');
  r = await ler(T, c1.id);
  c = await conexao(c1.id);
  eq([r.resultado, c.status, c.falhas_consecutivas, c.ultimo_erro], ['ok', 'ATIVA', 0, null], 'voltou: zera as falhas');
}

console.log('--- 9. Credencial recusada e chave mestra trocada param a leitura ---');
{
  banco.tokenStatus = 401;
  AGORA = new Date('2026-11-10T18:00:00Z');
  r = await ler(T, c1.id);
  let c = await conexao(c1.id);
  eq([r.motivo, c.status, c.proxima_sincronizacao_em], ['CREDENCIAL_INVALIDA', 'EXPIRADA', null], 'ClientSecret recusado: expirada até reconectar');
  eq((await S.conexoesNaHora(pool, T, new Date('2026-12-30T00:00:00Z'))).includes(c1.id), false, 'expirada sai da fila');
  banco.tokenStatus = 200;
  // Renovar: só os arquivos novos; ClientId e ClientSecret vêm do segredo gravado.
  const novo = await S.completarComSegredoGravado(pool, T, 'b1', { clientId: '', clientSecret: '', certificadoPem: par.certificadoPem, chavePrivadaPem: par.chavePrivadaPem, extras: {} });
  eq([novo.clientId, novo.clientSecret === SEGREDO], ['cli-ag1', true], 'na renovação o ClientId e o ClientSecret continuam');
  const ren = await S.salvarConexao(pool, { tenantId: T, contaId: 'b1', provedor: 'inter', credencial: novo, expiraEm: '2027-01-10', agora: AGORA });
  c = await conexao(c1.id);
  eq([ren.id, ren.renovada, c.status, c.de, c.ate], [c1.id, true, 'ATIVA', '2026-11-04', '2026-11-09'], 'renovar mantém a conexão e o histórico');
  process.env.INTEGRACOES_MASTER_KEY = 'f'.repeat(64);
  AGORA = new Date('2026-11-10T19:00:00Z');
  r = await ler(T, c1.id);
  eq([r.motivo, r.mensagem.includes('Conecte a conta de novo')], ['CREDENCIAL_INVALIDA', true], 'chave mestra trocada: pede para reconectar, sem quebrar');
  process.env.INTEGRACOES_MASTER_KEY = CHAVE_MESTRA;
  await S.salvarConexao(pool, { tenantId: T, contaId: 'b1', provedor: 'inter', credencial: cred(), expiraEm: '2027-01-10', agora: AGORA });
}

console.log('--- 10. Certificado vencendo e vencido ---');
{
  AGORA = new Date('2026-11-06T12:00:00Z');
  const c3 = await S.salvarConexao(pool, { tenantId: T, contaId: 'b3', provedor: 'inter', credencial: cred(parVencendo), expiraEm: '2026-12-01', agora: AGORA });
  globalThis.__c3 = c3.id;
  const n0 = await contar(`SELECT COUNT(*) n FROM notificacoes WHERE data IS NOT NULL AND titulo LIKE 'O certificado%'`);
  eq(await S.avisarCertificados(pool, T, AGORA), 1, '25 dias: um aviso');
  await S.avisarCertificados(pool, T, new Date('2026-11-07T12:00:00Z'));
  eq(await contar(`SELECT COUNT(*) n FROM notificacoes WHERE titulo LIKE 'O certificado%'`) - n0, 1, 'no dia seguinte não repete');
  await S.avisarCertificados(pool, T, new Date('2026-11-25T12:00:00Z'));
  eq(await contar(`SELECT COUNT(*) n FROM notificacoes WHERE titulo LIKE 'O certificado%'`) - n0, 2, 'a 6 dias: o aviso urgente');
  const lista = await S.listarConexoes(pool, T, null, new Date('2026-11-25T12:00:00Z'));
  eq(lista.find(x => x.id === c3.id).saude.certificado.nivel, 'urgente', 'a tela mostra o certificado vencendo');
  AGORA = new Date('2026-12-02T12:00:00Z');
  antes = banco.pedidos.length;
  r = await ler(T, c3.id);
  eq([r.motivo, (await conexao(c3.id)).status, banco.pedidos.length - antes], ['CERTIFICADO_EXPIRADO', 'EXPIRADA', 0], 'vencido: para sem chamar o banco');
}

console.log('--- 11. Isolamento entre agências ---');
{
  AGORA = new Date('2026-11-11T12:00:00Z');
  r = await ler(T2, c1.id);
  eq(r.resultado, 'nao_encontrada', 'a outra agência não lê a conexão desta');
  eq((await S.listarConexoes(pool, T2, null)).length, 0, 'nem vê');
  eq(await S.lerConexao(pool, T2, c1.id), null, 'nem abre');
  let erro = null;
  try { await S.salvarConexao(pool, { tenantId: T2, contaId: 'b1', provedor: 'inter', credencial: cred(), expiraEm: '2027-01-10' }); } catch (e) { erro = e.status; }
  eq(erro, 404, 'não conecta conta de outra agência');
  eq(await S.desconectar(pool, T2, c1.id), false, 'nem desconecta');
  erro = null;
  try { await emTransacao(t => X.gravarExtratoSincronizado(t, T2, 'b1', { conexao_id: 'x', sincronizacao_id: 'y', rotulo: 'z' }, [])); } catch (e) { erro = e.message; }
  eq(erro, 'Conta bancária não encontrada nesta agência.', 'linha do banco não entra em conta alheia');
  const cOutra = await S.salvarConexao(pool, { tenantId: T2, contaId: 'c1', provedor: 'inter', credencial: cred(par, { clientId: 'cli-ag2' }), expiraEm: '2027-01-10', agora: AGORA });
  banco.transacoes.push(tx('it-1', '2026-11-03', '1500.00', 'C', 'Pix', 'mesmo id em outra agência'));
  r = await ler(T2, cOutra.id);
  eq([r.resultado, r.inseridas > 0], ['ok', true], 'o mesmo identificador do banco em outra agência é outra linha');
}

console.log('--- 12. Rotas: permissão por conta bancária ---');
{
  const sessao = (perfil, userId = `u-${perfil}`, tenant = T) => ({ userId, nome: userId, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
  const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
  const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const json = async resp => ({ status: resp.status, corpo: await resp.json() });
  const R = await import('../src/app/api/extrato-automatico/route.ts');
  const RI = await import('../src/app/api/extrato-automatico/[id]/route.ts');
  const RS = await import('../src/app/api/extrato-automatico/[id]/sincronizar/route.ts');
  const ctx = id => ({ params: Promise.resolve({ id }) });

  como(null);
  eq((await R.GET()).status, 401, 'sem login, nada');
  como(sessao('VENDEDOR'));
  eq((await R.GET()).status, 403, 'vendedor não vê o extrato automático');
  como(sessao('ADMIN'));
  let g = await json(await R.GET());
  eq([g.status, g.corpo.conexoes.length, g.corpo.provedores.map(p => p.id), g.corpo.cofre_disponivel], [200, 3, ['inter'], true], 'admin vê as 3 conexões e o banco disponível');
  const corpoTexto = JSON.stringify(g.corpo);
  eq(corpoTexto.includes(SEGREDO) || corpoTexto.includes('BEGIN') || corpoTexto.includes('cli-ag1'), false, 'a resposta nunca traz segredo nem ClientId');
  eq(g.corpo.conexoes.every(c => typeof c.saude?.titulo === 'string'), true, 'cada conexão com a saúde em palavras');

  // Operador 2 só enxerga a conta b3.
  const PA = await import('../src/app/api/perfis-de-acesso/route.ts');
  const rr = await json(await PA.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op2', contas_liberadas: ['b3'], acoes_negadas: [] } })));
  eq(rr.status, 200, 'admin restringe o operador 2 à conta b3');
  como(sessao('OPERADOR', 'u-op2'));
  g = await json(await R.GET());
  eq(g.corpo.conexoes.map(c => c.conta_bancaria_id), ['b3'], 'operador 2 só vê a conexão da conta liberada');
  let s = await json(await RS.POST(req(`/api/extrato-automatico/${c1.id}/sincronizar`, 'POST'), ctx(c1.id)));
  eq([s.status, s.corpo.error], [403, 'Esta conta bancária não está liberada para você.'], 'não lê o extrato de conta não liberada');
  eq((await RI.GET(req(`/api/extrato-automatico/${c1.id}`), ctx(c1.id))).status, 403, 'nem o histórico');
  // A rota usa o relógio de verdade: o certificado desta conexão venceu há anos.
  await query(`UPDATE conexoes_bancarias SET expira_em = '2020-01-01' WHERE id = $1`, [globalThis.__c3]);
  s = await json(await RS.POST(req(`/api/extrato-automatico/${globalThis.__c3}/sincronizar`, 'POST'), ctx(globalThis.__c3)));
  eq([s.status, s.corpo.resultado, s.corpo.motivo, s.corpo.conexao.saude.nivel], [200, 'falhou', 'CERTIFICADO_EXPIRADO', 'critico'], 'na conta liberada, lê (o certificado vencido para antes do banco)');
  let p = await json(await R.POST(req('/api/extrato-automatico', 'POST', { conta_bancaria_id: 'b3', provedor: 'inter', credencial: cred() })));
  eq(p.status, 403, 'operador não conecta conta (só administrador)');
  eq((await RI.DELETE(req(`/api/extrato-automatico/${globalThis.__c3}`, 'DELETE'), ctx(globalThis.__c3))).status, 403, 'nem desconecta');

  como(sessao('ADMIN'));
  p = await json(await R.POST(req('/api/extrato-automatico', 'POST', { conta_bancaria_id: 'b3', provedor: 'inter', credencial: { clientId: 'a', clientSecret: 'b', certificadoPem: 'PK\u0003\u0004zip', chavePrivadaPem: par.chavePrivadaPem } })));
  eq([p.status, p.corpo.error.includes('não o arquivo compactado')], [422, true], 'ZIP enviado: recusa com a frase certa, sem chamar o banco');
  p = await json(await R.POST(req('/api/extrato-automatico', 'POST', { conta_bancaria_id: 'b3', provedor: 'inter', credencial: { clientId: 'a', clientSecret: 'b', certificadoPem: par.chavePrivadaPem, chavePrivadaPem: par.certificadoPem } })));
  eq([p.status, p.corpo.error.includes('trocados')], [422, true], 'arquivos trocados');
  p = await json(await R.POST(req('/api/extrato-automatico', 'POST', { conta_bancaria_id: 'c1', provedor: 'inter', credencial: cred() })));
  eq(p.status, 404, 'conta de outra agência: não encontrada');
  p = await json(await R.POST(req('/api/extrato-automatico', 'POST', { conta_bancaria_id: 'b3', provedor: 'arquivo', credencial: cred() })));
  eq(p.status, 400, 'provedor sem leitura automática: recusa');
  const h = await json(await RI.GET(req(`/api/extrato-automatico/${c1.id}`), ctx(c1.id)));
  eq([h.status, h.corpo.historico.length > 3, JSON.stringify(h.corpo).includes(SEGREDO)], [200, true, false], 'histórico de leituras sem segredo');
  como(sessao('ADMIN', 'u-ADMIN2', T2));
  eq((await RI.DELETE(req(`/api/extrato-automatico/${c1.id}`, 'DELETE'), ctx(c1.id))).status, 404, 'admin de outra agência não desconecta');
  eq((await RS.POST(req(`/api/extrato-automatico/${c1.id}/sincronizar`, 'POST'), ctx(c1.id))).status, 404, 'nem lê');
  como(sessao('ADMIN'));
  const d = await json(await RI.DELETE(req(`/api/extrato-automatico/${globalThis.__c2}`, 'DELETE'), ctx(globalThis.__c2)));
  eq(d.status, 200, 'admin desconecta a conta b2');
  eq([await contar(`SELECT COUNT(*) n FROM conexoes_bancarias_segredo WHERE conexao_id = $1`, [globalThis.__c2]), await contar(`SELECT COUNT(*) n FROM extrato_bancario WHERE conta_bancaria_id = 'b2'`)],
    [0, 3], 'o segredo some na hora; o extrato já lido fica');
  r = await ler(T, globalThis.__c2, 'manual');
  eq(r.resultado, 'desconectada', 'desconectada não lê mais');
  como(null);
}

console.log('--- 13. Tarefa do agendador ---');
{
  limparEspacamentoInter();
  await query(`UPDATE conexoes_bancarias SET proxima_sincronizacao_em = $1 WHERE id = $2`, ['2026-11-20T00:00:00Z', c1.id]);
  const tarefa = S.criarTarefaExtratoAutomatico(() => ambiente);
  const conexaoAg = async () => ({ exec: pool, liberar() {} });
  const quando = new Date('2026-11-20T15:00:00Z');
  AGORA = quando;
  banco.transacoes.push(tx('it-9', '2026-11-19', '99.90', 'C', 'Pix', 'PIX JOSE'));
  let res = await rodarAgendador({ tarefas: [tarefa], conexao: conexaoAg, emTransacao, agora: quando });
  eq([res['extrato-automatico'].feitas, res['extrato-automatico'].falhas], [2, 0], 'a hora roda as duas agências com leitura na hora');
  eq(await contar(`SELECT COUNT(*) n FROM extrato_bancario WHERE data->>'id_externo' = 'it-9' AND tenant_id = $1`, [T]), 1, 'a linha nova chegou sozinha');
  antes = banco.pedidos.length;
  res = await rodarAgendador({ tarefas: [tarefa], conexao: conexaoAg, emTransacao, agora: new Date('2026-11-20T15:40:00Z') });
  eq([res['extrato-automatico'].feitas, banco.pedidos.length - antes], [0, 0], 'na mesma hora a tarefa não roda de novo');
  eq((await S.conexoesNaHora(pool, T, new Date('2026-11-20T16:00:00Z'))).length, 0, 'e nada mais está na hora até amanhã');
}

eq(fetchReal, 0, 'nenhuma chamada saiu para a internet');
{
  const { clienteHttpMtls } = await import('../src/lib/extrato-automatico/http-mtls.ts');
  let recusou = false;
  try { await clienteHttpMtls({ metodo: 'GET', url: 'https://cdpj.partners.bancointer.com.br/banking/v2/saldo', headers: {}, certificadoPem: null, chavePrivadaPem: null }); } catch { recusou = true; }
  eq([recusou, fetchReal], [true, 1], 'a trava do teste pega o cliente mTLS de verdade (prova de que nada acima saiu)');
}
console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
