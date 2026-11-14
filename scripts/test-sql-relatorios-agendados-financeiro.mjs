/**
 * Envio agendado do DRE, do Fluxo de caixa e da Visão geral (E7, fechamento)
 * contra um Postgres real (PGlite), pelas ROTAS e pela tarefa do agendador.
 *
 * O que se prova:
 *   (a) agendar: DRE, fluxo e visão geral pelas rotas; período que não serve
 *       ao relatório recusado; sem "Acessar o financeiro" não agenda;
 *   (b) a tarefa manda o DRE do mês passado UMA vez, com os números do DRE da
 *       tela (mesmas regras), e o link abre só aquele relatório;
 *   (c) os direitos de HOJE de quem salvou: só as contas bancárias liberadas
 *       (o recebido numa conta fechada some), a folha só para quem a vê;
 *   (d) quem salvou perdeu o direito (exportar) ou saiu da agência: o envio
 *       NÃO sai e o motivo fica no histórico; conta salva que sumiu também;
 *   (e) a visão geral: a foto do dia do envio;
 *   (f) "nada sai": durante a mudança de sistema, nada é enviado.
 *
 * Uso: node --no-warnings scripts/test-sql-relatorios-agendados-financeiro.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, status TEXT DEFAULT 'ativo', data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX notificacoes_dedup ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, usuario_id TEXT, acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE migracao_lotes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, status TEXT NOT NULL);
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.__SESSAO_DE_TESTE__ = null;
register('./sessao-de-teste-hook.mjs', import.meta.url);
globalThis.fetch = async url => { throw new Error(`rede de verdade proibida no teste: ${url}`); };

const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RELATORIOS_AGENDADOS_SCHEMA_SQL } = await import('../src/lib/relatorios-agendados/schema.ts');
for (const s of [BAIXAS_SCHEMA_SQL, PERMISSOES_SCHEMA_SQL, RELATORIOS_AGENDADOS_SCHEMA_SQL]) await pg.exec(s);

const { salvarRestricaoDeUsuario, invalidarPermissoes } = await import('../src/lib/permissoes-servidor.ts');
const { enviarAgendamento, enviosDaVez, lerAgendamento } = await import('../src/lib/relatorios-agendados/servidor.ts');
const { montarDRE } = await import('../src/lib/resultado-dre.ts');
const R = {
  lista: await import('../src/app/api/relatorios/agendados/route.ts'),
  um: await import('../src/app/api/relatorios/agendados/[id]/route.ts'),
  enviar: await import('../src/app/api/relatorios/agendados/[id]/enviar/route.ts'),
  leitura: await import('../src/app/api/leitura/[token]/route.ts'),
};

const T = 'agencia-f';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const sessao = (perfil, userId) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; };
const p = id => ({ params: Promise.resolve({ id }) });
const pt = token => ({ params: Promise.resolve({ token }) });
const ADMIN = sessao('ADMIN', 'u-admin');
const OPE = sessao('OPERADOR', 'u-ope');
const BASE = 'https://fin.exemplo.com';
const tokenDe = url => url.split('/r/')[1];
const abrir = async url => { como(null); const t = tokenDe(url); return json(await R.leitura.GET(pedir('GET', `/api/leitura/${t}`), pt(t))); };

await query(`INSERT INTO usuarios (id, nome, data, tenant_id) VALUES
  ('u-admin', 'Ana', '{"perfil":"ADMIN","ativo":true}', $1),
  ('u-ope', 'Otto', '{"perfil":"OPERADOR","ativo":true}', $1),
  ('u-fol', 'Fábio', '{"perfil":"OPERADOR","ativo":true,"vinculo":{"tipo":"CLT","salario_base":3000}}', $1)`, [T]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, '{"nome_fantasia":"Viagens Lua"}')`, [T]);
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('c221', $1, '2.2.1', '{"id":"c221","codigo":"2.2.1","nome":"Aluguel"}')`, [T]);
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES
  ('cb1', $1, 'Banco Um', '{"id":"cb1","nome":"Banco Um","saldo_inicial":1000,"saldo_atual":1000}'),
  ('cb2', $1, 'Banco Dois', '{"id":"cb2","nome":"Banco Dois","saldo_inicial":500,"saldo_atual":500}')`, [T]);
const cr = (id, d) => query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1, $2, $3, $4::jsonb)`, [id, T, d.status ?? 'PENDENTE', JSON.stringify({ id, status: 'PENDENTE', taxa: 0, ...d })]);
const cp = (id, d) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1, $2, $3, $4::jsonb)`, [id, T, d.status ?? 'PENDENTE', JSON.stringify({ id, status: 'PENDENTE', ...d })]);
// Outubro: fee de 1.000 (recebido no Banco Dois) e aluguel de 400 (pago no Banco Um).
await cr('r-out', { origem: 'FEE', descricao: 'Fee', cliente_nome: 'Carla', data_vencimento: '2026-10-10', valor_final: 1000, status: 'RECEBIDO', valor_recebido: 1000, data_recebimento: '2026-10-10', conta_bancaria_id: 'cb2' });
await cp('p-out', { categoria_id: 'c221', descricao: 'Aluguel', fornecedor_nome: 'Imobiliária', data_vencimento: '2026-10-05', valor_final: 400, status: 'PAGO', valor_pago: 400, data_pagamento: '2026-10-05', conta_bancaria_id: 'cb1' });
// Novembro em aberto: recebe 300 dia 10, paga 120 dia 20 (Banco Um).
await cr('r-nov', { origem: 'FEE', descricao: 'Fee nov', cliente_nome: 'Davi', data_vencimento: '2026-11-10', valor_final: 300, conta_bancaria_id: 'cb1' });
await cp('p-nov', { categoria_id: 'c221', descricao: 'Luz', fornecedor_nome: 'Energia', data_vencimento: '2026-11-20', valor_final: 120, conta_bancaria_id: 'cb1' });

const corpo = (o) => ({ nome: 'Resultado do mês', relatorio: 'dre', consulta: '', frequencia: 'mensal', dia_mes: 1, hora: 7, periodo: 'mes_anterior', formato: 'pdf', destinatarios: 'diretoria@lua.com.br', validade_dias: 15, ...o });

console.log('--- (a) agendar ---');
como(ADMIN);
let r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpo({ periodo: 'ontem' }))));
eq([r.status, r.corpo.erros?.periodo], [422, 'Este período não serve para este relatório. Escolha um da lista.'], 'período que não serve ao DRE: recusado com o motivo');
r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpo({ consulta: 'regime=competencia&detalhe=completo&de=2026-01-01' }))));
eq([r.status, r.corpo.agendamento.relatorio, r.corpo.agendamento.consulta, r.corpo.agendamento.descricao], [201, 'dre', 'regime=competencia&detalhe=completo', 'Todo dia 1 às 7h, com mês passado'], 'DRE agendado, datas fora da consulta');
const agDRE = r.corpo.agendamento;
como(OPE);
r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpo({}))));
eq([r.status, r.corpo.codigo], [403, 'SEM_DIREITO'], 'quem não baixa em Excel e PDF não agenda (como em vendas)');
como(ADMIN);
r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpo({ nome: 'Caixa do mês', relatorio: 'fluxo', periodo: 'mes_anterior', frequencia: 'semanal', dia_semana: 1, consulta: 'agrupamento=semana' }))));
eq([r.status, r.corpo.agendamento.relatorio, r.corpo.agendamento.descricao], [201, 'fluxo', 'Toda segunda-feira às 7h, com mês passado'], 'fluxo agendado');
const agFluxo = r.corpo.agendamento;

console.log('--- (b) a tarefa manda o DRE uma vez, com os números da tela ---');
const devido = new Date('2026-11-01T10:00:00Z');
await query(`UPDATE relatorios_agendados SET proximo_envio = $2 WHERE id = $1`, [agDRE.id, devido.toISOString()]);
const agora = new Date('2026-11-01T10:05:00Z');
let envio = await enviosDaVez(pool, T, agora, BASE);
const resDRE = envio.resultados.find(x => x.de === '2026-10-01');
eq([resDRE?.situacao, resDRE?.de, resDRE?.ate], ['so_link', '2026-10-01', '2026-10-31'], 'sem CRM: o link do DRE de outubro');
envio = await enviosDaVez(pool, T, agora, BASE);
eq(envio.resultados.length, 0, 'chamar de novo não manda outra vez');
r = await abrir(resDRE.url);
const doc = r.corpo.documento;
const lucro = doc.linhas.find(l => String(l.linha).includes('Lucro líquido'));
const dreDaTela = montarDRE({
  receber: (await todos(`SELECT data FROM contas_receber`)).map(x => x.data), pagar: (await todos(`SELECT data FROM contas_pagar`)).map(x => x.data),
  vendasComLastro: [], planoContas: [{ id: 'c221', codigo: '2.2.1', nome: 'Aluguel' }], comissaoNaoCapturada: new Map(), mes: '2026-10',
});
eq([r.status, doc.titulo, doc.filtros[0].rotulo, doc.filtros[0].valor, lucro?.valor, dreDaTela.find(l => l.nome === 'LUCRO LÍQUIDO').valor], [200, 'Resultado do mês (DRE)', 'Período', 'Outubro 2026', 600, 600], 'o link abre o DRE de outubro, o mesmo lucro da tela');
eq(doc.linhas.length, dreDaTela.filter(l => !l.nome.startsWith('Margem')).length, 'detalhe completo: todas as linhas do DRE da tela');
const xl = await R.leitura.GET(pedir('GET', `/api/leitura/${tokenDe(resDRE.url)}?formato=xlsx`), pt(tokenDe(resDRE.url)));
const wb = XLSX.read(new Uint8Array(await xl.arrayBuffer()), { type: 'array' });
eq([xl.status, wb.Sheets[wb.SheetNames[0]].A1.v], [200, 'Resultado do mês (DRE)'], 'baixa o Excel do DRE');

console.log('--- DRE de vários meses: mês a mês ---');
como(ADMIN);
r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpo({ nome: 'Ano', periodo: 'ano_atual', regime: undefined, consulta: 'regime=caixa' }))));
const agAno = r.corpo.agendamento;
let res = await enviarAgendamento(pool, await lerAgendamento(pool, T, agAno.id), new Date('2026-11-03T12:00:00Z'), { manual: true, base: BASE });
r = await abrir(res.url);
eq([r.corpo.documento.titulo, r.corpo.documento.colunas.length, r.corpo.documento.filtros[1].valor], ['Resultado mês a mês (DRE)', 1 + 11 + 2, 'Caixa'], 'ano até ontem: jan a nov, pelo caixa');

console.log('--- (c) os títulos com os direitos de quem salvou ---');
res = await enviarAgendamento(pool, await lerAgendamento(pool, T, agFluxo.id), new Date('2026-11-03T12:00:00Z'), { manual: true, base: BASE });
r = await abrir(res.url);
eq([res.situacao, r.corpo.documento.titulo, r.corpo.documento.filtros[0].valor, r.corpo.documento.subtitulo.startsWith('Por semana')], ['so_link', 'Fluxo de caixa', '01/10/2026 a 31/10/2026', true], 'fluxo de outubro por semana');
eq([r.corpo.documento.totais.entradas, r.corpo.documento.totais.saidas], [1000, 400], 'o administrador vê as duas contas');
// Só administrador agenda hoje (é quem baixa em Excel e PDF), e ele nunca é restringido; o recorte
// por conta liberada vale para quando o perfil puder exportar. Provado direto no servidor:
const { titulosDaPessoa } = await import('../src/lib/relatorios-agendados/financeiro-servidor.ts');
await salvarRestricaoDeUsuario(pool, T, { usuario_id: 'u-ope', contas_liberadas: ['cb1'] });
invalidarPermissoes(T);
const doOtto = await titulosDaPessoa(pool, T, OPE);
eq([doOtto.receber.map(c => c.id).sort(), doOtto.bancarias.map(c => c.id)], [['r-nov'], ['cb1']], 'só a conta liberada: o recebido no Banco Dois some, como na lista dele');
como(ADMIN);
r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpo({ nome: 'Grade', relatorio: 'fluxo', periodo: 'proximos_30', consulta: 'vista=grade&medida=movimento' }))));
res = await enviarAgendamento(pool, await lerAgendamento(pool, T, r.corpo.agendamento.id), new Date('2026-11-03T12:00:00Z'), { manual: true, base: BASE });
r = await abrir(res.url);
eq([r.corpo.documento.titulo, r.corpo.documento.linhas.length, r.corpo.documento.colunas.map(c => c.rotulo).slice(1, 3)], ['Fluxo de caixa por conta e dia', 30, ['Banco Um', 'Banco Dois']], 'grade dos próximos 30 dias, uma coluna por conta');

console.log('--- (d) perdeu o direito: não envia e diz por quê ---');
await query(`UPDATE usuarios SET data = data || '{"perfil":"OPERADOR"}' WHERE id = 'u-admin'`);
const antes = (await todos(`SELECT COUNT(*)::int AS n FROM relatorios_leituras`))[0].n;
res = await enviarAgendamento(pool, await lerAgendamento(pool, T, agFluxo.id), new Date('2026-11-03T12:00:00Z'), { manual: true, base: BASE });
const depois = (await todos(`SELECT COUNT(*)::int AS n FROM relatorios_leituras`))[0].n;
eq([res.situacao, res.detalhe, depois - antes], ['pulado', 'Ana não pode mais baixar em Excel e PDF; salve o envio de novo com quem pode', 0], 'virou operador: não sai, nenhum link criado, o motivo fica');
const [hist] = await todos(`SELECT situacao, detalhe FROM relatorios_envios WHERE agendamento_id = $1 ORDER BY criado_em DESC LIMIT 1`, [agFluxo.id]);
eq(hist.situacao, 'pulado', 'o histórico registra o envio pulado');
await query(`UPDATE usuarios SET data = data || '{"perfil":"ADMIN"}' WHERE id = 'u-admin'`);
await query(`UPDATE relatorios_agendados SET consulta = 'conta=cb-apagada' WHERE id = $1`, [agFluxo.id]);
res = await enviarAgendamento(pool, await lerAgendamento(pool, T, agFluxo.id), new Date('2026-11-03T12:00:00Z'), { manual: true, base: BASE });
eq([res.situacao, /conta bancária salva/.test(res.detalhe)], ['pulado', true], 'conta salva que sumiu: não sai com outra no lugar');
await query(`UPDATE relatorios_agendados SET consulta = 'conta=cb1' WHERE id = $1`, [agFluxo.id]);
res = await enviarAgendamento(pool, await lerAgendamento(pool, T, agFluxo.id), new Date('2026-11-03T12:00:00Z'), { manual: true, base: BASE });
r = await abrir(res.url);
eq([r.corpo.documento.filtros[1]?.valor, r.corpo.documento.totais.entradas, r.corpo.documento.totais.saidas], ['Banco Um', 0, 400], 'só a conta salva');

console.log('--- (e) visão geral ---');
como(ADMIN);
r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpo({ nome: 'Bom dia', relatorio: 'visao_geral', periodo: 'posicao_do_dia', frequencia: 'diario' }))));
eq([r.status, r.corpo.agendamento.descricao], [201, 'Todo dia às 7h, com a posição do dia'], 'visão geral agendada');
r = await json(await R.enviar.POST(pedir('POST', `/api/relatorios/agendados/${r.corpo.agendamento.id}/enviar`), p(r.corpo.agendamento.id)));
const rv = r.corpo.resultado;
eq([r.status, rv.situacao, rv.de === rv.ate], [200, 'so_link', true], 'Enviar agora: a foto de um dia');
r = await abrir(rv.url);
const item = nome => r.corpo.documento.linhas.find(l => l.item === nome);
eq([r.corpo.documento.titulo, item('A receber')?.valor, item('A pagar')?.valor, item('Davi')?.valor, item('Energia')?.valor], ['Visão geral do financeiro', 300, 120, 300, -120], 'posição e agenda dos próximos 30 dias');

console.log('--- quem salvou saiu da agência ---');
await query(`UPDATE usuarios SET data = data || '{"ativo":false}' WHERE id = 'u-admin'`);
res = await enviarAgendamento(pool, await lerAgendamento(pool, T, agFluxo.id), new Date('2026-11-03T12:00:00Z'), { manual: true, base: BASE });
eq([res.situacao, /não está mais ativo/.test(res.detalhe)], ['pulado', true], 'quem salvou saiu da agência: não sai');
await query(`UPDATE usuarios SET data = data || '{"ativo":true}' WHERE id = 'u-admin'`);

console.log('--- (f) nada sai durante a mudança ---');
await query(`INSERT INTO migracao_lotes (id, tenant_id, status) VALUES ('lote-1', $1, 'aplicando')`, [T]);
await query(`UPDATE relatorios_agendados SET proximo_envio = $2 WHERE id = $1`, [agDRE.id, devido.toISOString()]);
const l0 = (await todos(`SELECT COUNT(*)::int AS n FROM relatorios_leituras`))[0].n;
envio = await enviosDaVez(pool, T, agora);
const l1 = (await todos(`SELECT COUNT(*)::int AS n FROM relatorios_leituras`))[0].n;
eq([envio.resultados[0]?.situacao, l1 - l0], ['pulado', 0], 'nada sai: não monta nem cria link');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
