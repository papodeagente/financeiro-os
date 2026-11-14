/**
 * Envio agendado de relatório e link de leitura (E7, G3) contra um Postgres
 * real (PGlite), rodando as ROTAS e a tarefa do agendador de produção.
 *
 * O que se prova:
 *   (a) agendar: campos conferidos, direitos (relatórios + exportar), a
 *       próxima data em Brasília, os direitos de quem criou gravados;
 *   (b) a tarefa manda o que venceu UMA vez e anda a agenda; sem CRM, só o
 *       link (e o link abre sem login, só aquele relatório, com o período do
 *       envio); com CRM, o evento RELATORIO_ENVIAR com tudo que o e-mail pede;
 *   (c) quem não vê o ganho da agência agenda sem a receita (nem no link);
 *   (d) o link: token errado, vencido ou desligado dão o mesmo 404; baixa
 *       Excel e PDF; desligar funciona; apagar o envio desliga os links;
 *   (e) "nada sai": durante a mudança de sistema, nada é enviado.
 *
 * Uso: node --no-warnings scripts/test-sql-relatorios-agendados.mjs
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
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
  CREATE UNIQUE INDEX notificacoes_dedup ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
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
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.__SESSAO_DE_TESTE__ = null;
register('./sessao-de-teste-hook.mjs', import.meta.url);
globalThis.fetch = async url => { throw new Error(`rede de verdade proibida no teste: ${url}`); };

const { VENDA_SCHEMA_SQL } = await import('../src/lib/venda-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RELATORIOS_AGENDADOS_SCHEMA_SQL } = await import('../src/lib/relatorios-agendados/schema.ts');
for (const s of [BAIXAS_SCHEMA_SQL, PERIODO_SCHEMA_SQL, COBRANCA_SCHEMA_SQL, PERMISSOES_SCHEMA_SQL, VENDA_SCHEMA_SQL, RELATORIOS_AGENDADOS_SCHEMA_SQL, RELATORIOS_AGENDADOS_SCHEMA_SQL]) await pg.exec(s);

const { salvarRestricaoDeUsuario, invalidarPermissoes } = await import('../src/lib/permissoes-servidor.ts');
const { enviarAgendamento, enviosDaVez, salvarAgendamento, tarefaRelatoriosAgendados } = await import('../src/lib/relatorios-agendados/servidor.ts');
const { limparLimitePublicoParaTeste } = await import('../src/lib/limite-publico.ts');
const rotaVenda = await import('../src/app/api/vendas/completa/route.ts');
const R = {
  lista: await import('../src/app/api/relatorios/agendados/route.ts'),
  um: await import('../src/app/api/relatorios/agendados/[id]/route.ts'),
  enviar: await import('../src/app/api/relatorios/agendados/[id]/enviar/route.ts'),
  revogar: await import('../src/app/api/relatorios/agendados/leituras/[id]/revogar/route.ts'),
  leitura: await import('../src/app/api/leitura/[token]/route.ts'),
};

const T = 'agencia-r';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const sessao = (perfil, userId) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; };
const p = id => ({ params: Promise.resolve({ id }) });
const pt = token => ({ params: Promise.resolve({ token }) });
const ADMIN = sessao('ADMIN', 'u-admin');

await query(`INSERT INTO usuarios (id, nome, data, tenant_id) VALUES ('u-admin', 'Ana', '{}', $1), ('u-ope', 'Otto', '{"perfil":"OPERADOR"}', $1), ('u-bia', 'Bia', '{}', $1)`, [T]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, '{"nome_fantasia":"Viagens Sol"}')`, [T]);

console.log('--- vendas ---');
como(ADMIN);
const lancar = async venda => (await json(await rotaVenda.POST(pedir('POST', '/api/vendas/completa', { venda })))).corpo.venda.id;
const vOut = await lancar({
  data_venda: '2026-10-10', cliente: { id: 'cli-a', nome: 'Carla' }, vendedor: { id: 'u-bia', nome: 'Bia' },
  produtos: [{ id: 'pa', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f1', nome: 'Hotel Mar' },
    passageiros: [{ id: 'x', nome: 'Carla', tarifa_centavos: 100000 }], componentes: [{ id: 'c1', tipo: 'COMISSAO', valor_centavos: 10000 }] }],
  pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 100000 }],
});
await lancar({
  data_venda: '2026-11-03', cliente: { id: 'cli-b', nome: 'Davi' }, vendedor: { id: 'u-bia', nome: 'Bia' },
  produtos: [{ id: 'pb', tipo: 'SEGURO', descricao: 'Seguro', passageiros: [{ id: 'y', nome: 'Davi', tarifa_centavos: 20000 }] }],
  pagamentos: [{ id: 'g2', forma: 'BOLETO', valor_centavos: 20000 }],
});
eq(Boolean(vOut), true, 'vendas lançadas');

console.log('--- (a) agendar ---');
const corpoBase = {
  nome: 'Vendas por vendedor do mês', relatorio: 'vendas', consulta: 'relatorio=vendedor&de=2026-01-01&ate=2026-01-31&colunas=grupo,faturamento,receita',
  frequencia: 'mensal', dia_mes: 1, hora: 7, periodo: 'mes_anterior', formato: 'xlsx', destinatarios: 'diretoria@sol.com.br; Ana@Sol.com.br, ana@sol.com.br', validade_dias: 15,
};
let r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', { ...corpoBase, destinatarios: 'nao-e-email', hora: 3 })));
eq([r.status, Object.keys(r.corpo.erros).sort()], [422, ['destinatarios', 'hora']], 'campos conferidos com o motivo');
r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpoBase)));
eq(r.status, 201, 'agendado');
const ag = r.corpo.agendamento;
eq([ag.destinatarios, ag.consulta.includes('de='), ag.ver_receita, ag.vendedor_id, ag.descricao], [['diretoria@sol.com.br', 'ana@sol.com.br'], false, true, null, 'Todo dia 1 às 7h, com mês passado'], 'e-mails sem repetir, datas fora da consulta, direitos de quem criou');
eq(new Date(ag.proximo_envio).getTime() > Date.now(), true, 'próximo envio no futuro');

await salvarRestricaoDeUsuario(pool, T, { usuario_id: 'u-ope', acoes_negadas: ['exportar'] });
invalidarPermissoes(T);
como(sessao('OPERADOR', 'u-ope'));
r = await json(await R.lista.POST(pedir('POST', '/api/relatorios/agendados', corpoBase)));
eq(r.status, 403, 'sem o direito de exportar não agenda');
r = await json(await R.lista.GET());
eq([r.status, r.corpo.agendamentos.length, r.corpo.crm_ligado], [200, 1, false], 'mas vê a lista');
como(ADMIN);

console.log('--- (b) a tarefa manda uma vez e anda a agenda; sem CRM, só o link ---');
const devido = new Date('2026-11-01T10:00:00Z'); // 07:00 de Brasília
await query(`UPDATE relatorios_agendados SET proximo_envio = $2 WHERE id = $1`, [ag.id, devido.toISOString()]);
const agora = new Date('2026-11-01T10:05:00Z');
eq(await tarefaRelatoriosAgendados.agencias({ exec: pool, agora }), [T], 'a agência com envio vencido entra na tarefa');
let envio = await enviosDaVez(pool, T, agora, 'https://fin.exemplo.com');
eq([envio.enviados, envio.resultados[0].situacao, envio.resultados[0].de, envio.resultados[0].ate], [1, 'so_link', '2026-10-01', '2026-10-31'], 'sem CRM: link pronto, com o mês passado');
const url = envio.resultados[0].url;
eq(/^https:\/\/fin\.exemplo\.com\/r\/[A-Za-z0-9_-]{43}$/.test(url), true, 'endereço do link');
const [agDepois] = await todos(`SELECT proximo_envio FROM relatorios_agendados WHERE id = $1`, [ag.id]);
eq(new Date(agDepois.proximo_envio).toISOString(), '2026-12-01T10:00:00.000Z', 'a agenda andou para o dia 1 do mês seguinte às 7h');
envio = await enviosDaVez(pool, T, agora, 'https://fin.exemplo.com');
eq(envio.resultados.length, 0, 'chamar de novo não manda outra vez');
const sino = await todos(`SELECT tipo, titulo, link, descricao FROM notificacoes WHERE tenant_id = $1`, [T]);
eq([sino.length, sino[0]?.tipo, sino[0]?.link, sino[0]?.descricao.includes('/r/')], [1, 'RELATORIO_AGENDADO_PRONTO', `/relatorios/envios?abrir=${ag.id}`, false], 'sem CRM: o sino avisa que o link está pronto (sem o endereço)');
const token = url.split('/r/')[1];

console.log('--- (d) o link abre sem login, só aquele relatório ---');
como(null);
r = await json(await R.leitura.GET(pedir('GET', `/api/leitura/${token}`), pt(token)));
eq([r.status, r.corpo.titulo, r.corpo.agencia, r.corpo.documento.linhas.map(l => [l.grupo, l.faturamento, l.receita])],
  [200, 'Vendas por vendedor', 'Viagens Sol', [['Bia', 100000, 10000]]], 'o relatório do período do envio (outubro), com a receita (quem criou podia ver)');
eq([r.corpo.documento.filtros[0].rotulo, r.corpo.documento.filtros[0].valor], ['Data da venda', '01/10/2026 a 31/10/2026'], 'o período por extenso');
const xl = await R.leitura.GET(pedir('GET', `/api/leitura/${token}?formato=xlsx`), pt(token));
const wb = XLSX.read(new Uint8Array(await xl.arrayBuffer()), { type: 'array' });
eq([xl.status, wb.Sheets[wb.SheetNames[0]].A1.v, /vendas-por-vendedor-data-da-venda-2026-10-01-a-2026-10-31\.xlsx|vendas-por-vendedor-2026-10-01-a-2026-10-31\.xlsx/.test(xl.headers.get('content-disposition'))], [200, 'Vendas por vendedor', true], 'baixa o Excel com o período no nome');
const pdf = await R.leitura.GET(pedir('GET', `/api/leitura/${token}?formato=pdf`), pt(token));
eq([pdf.status, pdf.headers.get('content-type')], [200, 'application/pdf'], 'baixa o PDF');
const [lt] = await todos(`SELECT acessos, token_hash FROM relatorios_leituras`);
eq([lt.acessos, lt.token_hash.length, lt.token_hash === token], [1, 64, false], 'conta o acesso; o banco guarda só o hash');
r = await json(await R.leitura.GET(pedir('GET', `/api/leitura/${'x'.repeat(43)}`), pt('x'.repeat(43))));
eq([r.status, r.corpo.error], [404, 'Este link não abre mais. Peça um link novo a quem mandou o relatório.'], 'token errado: 404');

console.log('--- (b) com CRM: o evento com tudo que o e-mail pede ---');
await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, '{"ativo": true, "webhook_url_crm": "https://crm.exemplo.com/webhook"}')`, [T]);
como(ADMIN);
r = await json(await R.enviar.POST(pedir('POST', `/api/relatorios/agendados/${ag.id}/enviar`), p(ag.id)));
eq([r.status, r.corpo.resultado.situacao, r.corpo.resultado.canal], [200, 'na_fila', 'crm'], 'Enviar agora: CRM sem resposta, fica na fila');
const [ev] = await todos(`SELECT tipo, data FROM crm_eventos_saida WHERE tenant_id = $1 AND tipo = 'RELATORIO_ENVIAR'`, [T]);
const pl = ev?.data?.payload ?? {};
eq([pl.destinatarios, pl.titulo, pl.url_leitura === r.corpo.resultado.url, /\/api\/leitura\/[A-Za-z0-9_-]{43}\?formato=xlsx$/.test(pl.url_planilha), typeof pl.valido_ate, pl.assunto.startsWith('Vendas por vendedor do mês · ')],
  [['diretoria@sol.com.br', 'ana@sol.com.br'], 'Vendas por vendedor', true, true, 'string', true], 'RELATORIO_ENVIAR: e-mails, assunto, link de leitura e de download, validade');
{
  const fetchAntes = globalThis.fetch;
  globalThis.fetch = async u => (String(u).startsWith('https://crm.exemplo.com/') ? new Response(JSON.stringify({ recebido: true, acao: 'relatorio_enviado' }), { status: 200, headers: { 'content-type': 'application/json' } }) : fetchAntes(u));
  r = await json(await R.enviar.POST(pedir('POST', `/api/relatorios/agendados/${ag.id}/enviar`), p(ag.id)));
  globalThis.fetch = fetchAntes;
  eq(r.corpo.resultado.situacao, 'enviado', 'CRM recebeu: enviado');
}
r = await json(await R.um.GET(pedir('GET', `/api/relatorios/agendados/${ag.id}`), p(ag.id)));
eq([r.corpo.envios.length, r.corpo.envios.map(e => e.situacao), r.corpo.leituras.length, r.corpo.leituras.every(l => l.situacao === 'valendo')],
  [3, ['enviado', 'na_fila', 'so_link'], 3, true], 'histórico dos envios e os links');

console.log('--- (c) sem o ganho da agência, a receita nem entra no link ---');
// Pelas rotas só quem pode exportar agenda (hoje, o administrador, que vê tudo);
// o servidor guarda e respeita os direitos de quem criou mesmo assim.
await query(`DELETE FROM crm_config`);
const { validarAgendamento } = await import('../src/lib/relatorios-agendados/regras.ts');
const v = validarAgendamento({ ...corpoBase, nome: 'Do vendedor', frequencia: 'diario', periodo: 'ultimos_30' });
const agOpe = await salvarAgendamento(pool, T, null, v.dados, { id: 'u-bia', nome: 'Bia', verReceita: false, vendedorId: 'u-bia' }, new Date());
eq([agOpe.ver_receita, agOpe.vendedor_id], [false, 'u-bia'], 'direitos de quem criou gravados');
const res = await enviarAgendamento(pool, agOpe, new Date('2026-11-05T12:00:00Z'), { manual: true, base: 'https://fin.exemplo.com' });
const t2 = res.url.split('/r/')[1];
como(null);
r = await json(await R.leitura.GET(pedir('GET', `/api/leitura/${t2}`), pt(t2)));
eq([r.corpo.documento.colunas.map(c => c.id), r.corpo.documento.linhas.some(l => 'receita' in l), r.corpo.documento.nota], [['grupo', 'faturamento'], false, 'Só as vendas de quem gerou o arquivo.'], 'a receita não sai no link, e só as vendas de quem criou');

console.log('--- (d) desligar e vencer ---');
como(ADMIN);
const [leit] = await todos(`SELECT id FROM relatorios_leituras WHERE agendamento_id = $1 ORDER BY criado_em LIMIT 1`, [agOpe.id]);
r = await json(await R.revogar.POST(pedir('POST', `/api/relatorios/agendados/leituras/${leit.id}/revogar`), p(leit.id)));
eq(r.status, 200, 'link desligado');
como(null);
r = await json(await R.leitura.GET(pedir('GET', `/api/leitura/${t2}`), pt(t2)));
eq(r.status, 404, 'link desligado não abre');
await query(`UPDATE relatorios_leituras SET expira_em = NOW() - INTERVAL '1 minute' WHERE agendamento_id = $1`, [ag.id]);
r = await json(await R.leitura.GET(pedir('GET', `/api/leitura/${token}`), pt(token)));
eq(r.status, 404, 'link vencido não abre (a mesma resposta)');
limparLimitePublicoParaTeste();

console.log('--- pausar e apagar ---');
como(ADMIN);
r = await json(await R.um.PATCH(pedir('PATCH', `/api/relatorios/agendados/${ag.id}`, { ativo: false }), p(ag.id)));
eq([r.corpo.agendamento.ativo, r.corpo.agendamento.proximo_envio], [false, null], 'pausado não tem próximo envio');
r = await json(await R.um.PUT(pedir('PUT', `/api/relatorios/agendados/${ag.id}`, { ...corpoBase, frequencia: 'semanal', dia_semana: 1, periodo: 'semana_anterior' }), p(ag.id)));
eq([r.status, r.corpo.agendamento.descricao], [200, 'Toda segunda-feira às 7h, com semana passada'], 'alterado para toda segunda');
r = await json(await R.um.DELETE(pedir('DELETE', `/api/relatorios/agendados/${agOpe.id}`), p(agOpe.id)));
const vivos = await todos(`SELECT COUNT(*)::int AS n FROM relatorios_leituras WHERE agendamento_id = $1 AND revogado_em IS NULL`, [agOpe.id]);
eq([r.status, vivos[0].n], [200, 0], 'apagar o envio desliga todos os links dele');

console.log('--- (e) nada sai durante a mudança ---');
await query(`INSERT INTO migracao_lotes (id, tenant_id, status) VALUES ('lote-1', $1, 'aplicando')`, [T]);
const { STATUS_QUE_SEGURAM } = await import('../src/lib/migracao/estado.ts').catch(() => ({}));
if (STATUS_QUE_SEGURAM) await query(`UPDATE migracao_lotes SET status = $1`, [[...STATUS_QUE_SEGURAM][0]]);
await query(`UPDATE relatorios_agendados SET proximo_envio = $2 WHERE id = $1`, [ag.id, devido.toISOString()]);
const antes = (await todos(`SELECT COUNT(*)::int AS n FROM relatorios_leituras`))[0].n;
envio = await enviosDaVez(pool, T, agora);
const depois = (await todos(`SELECT COUNT(*)::int AS n FROM relatorios_leituras`))[0].n;
eq([envio.resultados[0]?.situacao, depois - antes], ['pulado', 0], 'nada sai: não cria link nem avisa o CRM');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
