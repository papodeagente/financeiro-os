/**
 * Comissões, fechamento de paridade (E7), contra um Postgres real (PGlite),
 * rodando as ROTAS de produção com sessão de teste.
 *
 * O que se prova:
 *   (a) comissão manual na venda: recusada na regra de hoje e em venda
 *       aberta; lançada em venda fechada (percentual sobre a receita ou valor
 *       fixo); entra no Fechar comissões como item próprio; exclui antes de
 *       fechar e NÃO exclui depois; fica no histórico da venda; vendedor não
 *       lança;
 *   (b) grade de metas: várias pessoas de uma vez, tudo ou nada;
 *   (c) dia de fechamento das metas na configuração (28 a 31 = último dia);
 *   (d) quem fecha cada função: quem não está na lista não vê as linhas dela
 *       na prévia (as outras seguem) e o Fechar recusa; o perfil marcado e o
 *       administrador fecham.
 *
 * Uso: node --no-warnings scripts/test-sql-comissao-e7.mjs
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
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE agendador_execucoes (tarefa TEXT, tenant_id TEXT, janela TEXT);
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

const { VENDA_SCHEMA_SQL } = await import('../src/lib/venda-schema.ts');
const { COMISSAO_FUNCOES_SCHEMA_SQL } = await import('../src/lib/comissao-funcoes-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(VENDA_SCHEMA_SQL);
await pg.exec(COMISSAO_FUNCOES_SCHEMA_SQL);
await pg.exec(COMISSAO_FUNCOES_SCHEMA_SQL); // idempotente (o ALTER e a tabela nova também)

const { fecharVenda } = await import('../src/lib/venda-servidor.ts');
const { invalidarPermissoes } = await import('../src/lib/permissoes-servidor.ts');
const { hojeISO } = await import('../src/lib/money.ts');
const rotaVenda = await import('../src/app/api/vendas/completa/route.ts');
const R = {
  config: await import('../src/app/api/comissoes-por-funcao/config/route.ts'),
  cadastro: await import('../src/app/api/comissoes-por-funcao/cadastro/route.ts'),
  funcoes: await import('../src/app/api/comissoes-por-funcao/funcoes/route.ts'),
  planos: await import('../src/app/api/comissoes-por-funcao/planos/route.ts'),
  metas: await import('../src/app/api/comissoes-por-funcao/metas/route.ts'),
  previa: await import('../src/app/api/comissoes-por-funcao/previa/route.ts'),
  fechar: await import('../src/app/api/comissoes-por-funcao/fechar/route.ts'),
  manuais: await import('../src/app/api/comissoes-por-funcao/manuais/route.ts'),
};

const T = 'agencia-e7';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const sessao = (perfil, userId = `u-${perfil.toLowerCase()}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const ADMIN = sessao('ADMIN', 'u-admin');
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; };
const hoje = hojeISO();
const mesAtual = hoje.slice(0, 7);

await query(`INSERT INTO usuarios (id, nome, data, tenant_id) VALUES ('u-bia', 'Bia', '{}', $1), ('u-leo', 'Leo', '{}', $1), ('u-admin', 'Ana Admin', '{}', $1), ('u-ope', 'Otto', '{"perfil":"OPERADOR"}', $1), ('u-ope2', 'Olga', '{"perfil":"OPERADOR"}', $1)`, [T]);
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('cat-26', $1, '2.6', '{"codigo":"2.6"}')`, [T]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, '{"datas_pagamento_comissao":[20]}')`, [T]);

como(ADMIN);
const lancar = async venda => (await json(await rotaVenda.POST(pedir('POST', '/api/vendas/completa', { venda })))).corpo.venda.id;
// Receita R$ 150 (Comissão R$ 100 + Fee R$ 50), vendida hoje pela Bia.
const vA = await lancar({
  data_venda: hoje, cliente: { id: 'cli-a', nome: 'Carla' }, vendedor: { id: 'u-bia', nome: 'Bia' },
  produtos: [{ id: 'pa', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f1', nome: 'Hotel Mar' },
    passageiros: [{ id: 'x', nome: 'Carla', tarifa_centavos: 100000 }], componentes: [{ id: 'c1', tipo: 'COMISSAO', valor_centavos: 10000 }, { id: 'c2', tipo: 'FEE', valor_centavos: 5000 }] }],
  pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 105000 }],
});
eq(Boolean(vA), true, 'venda lançada');

console.log('--- (a) Comissão manual na venda ---');
let r = await json(await R.manuais.GET(pedir('GET', `/x?venda_id=${vA}`)));
eq([r.status, r.corpo.regra, r.corpo.pode_lancar, r.corpo.situacao_venda, r.corpo.base_centavos, r.corpo.manuais], [200, 'ATUAL', true, 'ABERTA', 15000, []], 'GET: regra de hoje, venda aberta, base = receita (R$ 150)');
r = await json(await R.manuais.POST(pedir('POST', '/x', { venda_id: vA, pessoa_funcao_id: 'fn-vendedor:u-bia', descricao: 'Indicação', tipo: 'VALOR', valor_centavos: 1000 })));
eq([r.status, r.corpo.codigo], [409, 'REGRA_ATUAL'], 'na regra de hoje a comissão manual não entra (diz por quê)');

r = await json(await R.config.PUT(pedir('PUT', '/x', { regra: 'FUNCOES', liberar: 'VENDA', meta_sobre: ['RECEITA'], data_inicial: `${mesAtual}-01` })));
eq([r.status, r.corpo.regra, r.corpo.dia_fechamento_meta], [200, 'FUNCOES', 0], 'regra por função; dia de fechamento padrão = último dia');
r = await json(await R.planos.PUT(pedir('PUT', '/x', { plano: { nome: 'Plano fixo', faixas: [{ percentual_meta: 0, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 10, sobre: ['RECEITA'] } }] }] } })));
const planoId = r.corpo.id;
r = await json(await R.funcoes.PUT(pedir('PUT', '/x', { funcao: { id: 'fn-vendedor' }, pessoas: [
  { pessoa_id: 'u-bia', pessoa_nome: 'Bia', plano_id: planoId }, { pessoa_id: 'u-leo', pessoa_nome: 'Leo', plano_id: planoId },
] })));
eq(r.status, 200, 'Bia e Leo na função Vendedor');

r = await json(await R.manuais.POST(pedir('POST', '/x', { venda_id: vA, pessoa_funcao_id: 'fn-vendedor:u-bia', descricao: 'Indicação', tipo: 'VALOR', valor_centavos: 1000 })));
eq([r.status, r.corpo.codigo], [409, 'VENDA_ABERTA'], 'venda aberta: pede para fechar antes');
await fecharVenda(pool, T, vA, { usuario: { id: 'u-admin', nome: 'Ana Admin' }, confirmar: true });

r = await json(await R.manuais.POST(pedir('POST', '/x', { venda_id: vA, pessoa_funcao_id: 'fn-vendedor:u-bia', descricao: 'Indicação do cliente', tipo: 'PERCENTUAL', percentual: 10 })));
const manBia = r.corpo;
eq([r.status, manBia.valor_centavos, manBia.base_centavos, manBia.pessoa_nome, manBia.funcao_nome, manBia.pode_excluir], [201, 1500, 15000, 'Bia', 'Vendedor', true], '10% sobre a receita (R$ 150) = R$ 15, gravado');
r = await json(await R.manuais.POST(pedir('POST', '/x', { venda_id: vA, pessoa_funcao_id: 'fn-vendedor:u-leo', descricao: 'Bônus da campanha', tipo: 'VALOR', valor_centavos: 5000 })));
const manLeo = r.corpo;
eq([r.status, manLeo.valor_centavos, manLeo.base_centavos], [201, 5000, 0], 'valor fixo de R$ 50 para o Leo');
r = await json(await R.manuais.POST(pedir('POST', '/x', { venda_id: vA, pessoa_funcao_id: 'fn-vendedor:u-leo', descricao: '', tipo: 'VALOR', valor_centavos: 0 })));
eq(r.status, 400, 'sem descrição e sem valor: recusado');
r = await json(await R.manuais.POST(pedir('POST', '/x', { venda_id: vA, pessoa_funcao_id: 'fn-ninguem:u-x', descricao: 'x', tipo: 'VALOR', valor_centavos: 100 })));
eq([r.status, r.corpo.error], [400, 'Escolha a pessoa (ela precisa estar numa função de comissão).'], 'pessoa fora das funções: recusado');

como(sessao('VENDEDOR', 'u-bia'));
r = await json(await R.manuais.POST(pedir('POST', '/x', { venda_id: vA, pessoa_funcao_id: 'fn-vendedor:u-bia', descricao: 'Eu mesma', tipo: 'VALOR', valor_centavos: 99999 })));
eq(r.status, 403, 'vendedor não lança comissão manual');
como(ADMIN);

r = await json(await R.previa.GET(pedir('GET', `/x?ate=${hoje}`)));
const linhaDe = nome => r.corpo.linhas.find(l => l.pessoa_nome === nome);
eq(linhaDe('Bia').itens.map(i => [i.chave.startsWith('manual|') ? 'manual' : 'plano', i.valor_centavos]), [['manual', 1500], ['plano', 1500]], 'Fechar: a manual da Bia entra ao lado do item do plano');
eq(linhaDe('Leo').itens.map(i => i.valor_centavos), [5000], 'Fechar: o Leo tem só a manual');

r = await json(await R.manuais.DELETE(pedir('DELETE', `/x?venda_id=${vA}&id=${manLeo.id}`)));
eq(r.status, 200, 'exclui a manual do Leo antes de fechar');
r = await json(await R.previa.GET(pedir('GET', `/x?ate=${hoje}`)));
eq(linhaDe('Leo'), undefined, 'o Leo sai do fechamento');

r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: hoje, participantes: ['fn-vendedor:u-bia'] })));
eq([r.status, r.corpo.fechados.map(f => f.saldo_centavos)], [200, [3000]], 'fecha a Bia com a manual (R$ 15 + R$ 15)');
r = await json(await R.manuais.DELETE(pedir('DELETE', `/x?venda_id=${vA}&id=${manBia.id}`)));
eq([r.status, r.corpo.codigo], [409, 'JA_FECHADA'], 'depois de fechada não se exclui');
r = await json(await R.manuais.GET(pedir('GET', `/x?venda_id=${vA}`)));
eq(r.corpo.manuais.map(m => [m.pessoa_nome, m.fechado_centavos, m.pode_excluir]), [['Bia', 1500, false]], 'GET: a da Bia fechada, a do Leo excluída some');
const eventos = await todos(`SELECT tipo FROM venda_eventos WHERE tenant_id = $1 AND venda_id = $2 AND tipo LIKE 'comissao_manual%' ORDER BY criado_em`, [T, vA]);
eq(eventos.map(e => e.tipo), ['comissao_manual', 'comissao_manual', 'comissao_manual_excluida'], 'lançar e excluir ficam no histórico da venda');
eq((await todos(`SELECT COUNT(*)::int AS n FROM comissao_manuais WHERE tenant_id = $1 AND excluida_em IS NOT NULL`, [T]))[0].n, 1, 'excluir marca, não apaga');

console.log('--- (b) Grade de metas ---');
const ano = Number(hoje.slice(0, 4));
const meses = v => Array.from({ length: 12 }, () => v);
r = await json(await R.metas.PUT(pedir('PUT', '/x', { ano, linhas: [{ pessoa_funcao_id: 'fn-vendedor:u-bia', meses: meses(30000) }, { pessoa_funcao_id: 'fn-vendedor:u-leo', meses: [20000] }] })));
eq([r.status, r.corpo.pessoas, r.corpo.metas.length], [200, 2, 13], 'grade: Bia nos 12 meses e Leo em janeiro');
r = await json(await R.metas.PUT(pedir('PUT', '/x', { ano, linhas: [{ pessoa_funcao_id: 'fn-vendedor:u-bia', meses: meses(1) }, { pessoa_funcao_id: 'fn-vendedor:u-leo', meses: [-5] }] })));
eq([r.status, r.corpo.error], [400, 'Meta não pode ser negativa (Leo).'], 'uma meta negativa recusa a grade inteira, dizendo de quem');
eq((await todos(`SELECT valor_centavos FROM comissao_metas WHERE tenant_id = $1 AND pessoa_funcao_id = 'fn-vendedor:u-bia' AND mes = $2`, [T, `${ano}-01`]))[0].valor_centavos, 30000, 'nada foi gravado (tudo ou nada)');
r = await json(await R.metas.PUT(pedir('PUT', '/x', { ano, linhas: [{ pessoa_funcao_id: 'fn-sumiu:u-x', meses: [1] }] })));
eq(r.status, 404, 'pessoa que saiu da função: recarregar');
r = await json(await R.metas.PUT(pedir('PUT', '/x', { pessoa_funcao_id: 'fn-vendedor:u-leo', ano, meses: meses(0) })));
eq([r.status, r.corpo], [200, []], 'a forma antiga (uma pessoa) continua valendo');

console.log('--- (c) Dia de fechamento das metas ---');
r = await json(await R.config.PUT(pedir('PUT', '/x', { dia_fechamento_meta: 25 })));
eq([r.status, r.corpo.dia_fechamento_meta, r.corpo.regra], [200, 25, 'FUNCOES'], 'dia 25 gravado sem mexer no resto');
r = await json(await R.config.PUT(pedir('PUT', '/x', { dia_fechamento_meta: 30 })));
eq(r.corpo.dia_fechamento_meta, 0, 'dia 30 vira "último dia do mês"');
r = await json(await R.previa.GET(pedir('GET', `/x?ate=${hoje}`)));
eq(r.corpo.dia_fechamento_meta, 0, 'a prévia diz o dia de fechamento');

console.log('--- (d) Quem fecha cada função ---');
await query(`INSERT INTO grupos_usuario (tenant_id, id, nome, acesso_total) VALUES ($1, 'g-fin', 'Financeiro', TRUE), ($1, 'g-op', 'Operação', TRUE)`, [T]);
await query(`INSERT INTO grupo_usuario_membros (tenant_id, grupo_id, usuario_id) VALUES ($1, 'g-fin', 'u-ope'), ($1, 'g-op', 'u-ope2')`, [T]);
invalidarPermissoes(T);
r = await json(await R.funcoes.PUT(pedir('PUT', '/x', { funcao: { nome: 'Gerente', sobre_pessoas: ['u-bia'], quem_fecha: ['grupo:g-fin', 'u-fantasma', 'grupo:g-nao-existe'] }, pessoas: [{ pessoa_id: 'u-leo', pessoa_nome: 'Leo', plano_id: planoId }] })));
const gerenteId = r.corpo.funcao.id;
eq([r.status, r.corpo.funcao.quem_fecha], [200, ['grupo:g-fin']], 'quem fecha: só pessoas e perfis que existem nesta agência');
r = await json(await R.cadastro.GET());
eq([r.corpo.perfis.map(p => p.nome), r.corpo.funcoes.find(f => f.id === gerenteId).quem_fecha], [['Financeiro', 'Operação'], ['grupo:g-fin']], 'cadastro traz os perfis e a escolha');

como(sessao('OPERADOR', 'u-ope2'));
r = await json(await R.previa.GET(pedir('GET', `/x?ate=${hoje}`)));
eq([r.status, r.corpo.funcoes_de_outros, r.corpo.linhas.some(l => l.funcao_nome === 'Gerente')], [200, ['Gerente'], false], 'fora da lista: as linhas do Gerente não aparecem, e a tela diz por quê');
r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: hoje, participantes: [`${gerenteId}:u-leo`] })));
eq([r.status, r.corpo.fechados.length, r.corpo.recusados[0]?.motivo], [200, 0, 'Quem fecha a função Gerente são outras pessoas (Equipe › Funções).'], 'e o Fechar recusa a pessoa dessa função');

como(sessao('OPERADOR', 'u-ope'));
r = await json(await R.previa.GET(pedir('GET', `/x?ate=${hoje}`)));
eq([r.corpo.funcoes_de_outros, r.corpo.linhas.filter(l => l.funcao_nome === 'Gerente').map(l => [l.pessoa_nome, l.saldo_centavos])], [[], [['Leo', 1500]]], 'no perfil marcado: vê o Gerente (10% da venda da Bia)');
r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: hoje, participantes: [`${gerenteId}:u-leo`] })));
eq(r.corpo.fechados.map(f => [f.pessoa_nome, f.funcao_nome, f.saldo_centavos]), [['Leo', 'Gerente', 1500]], 'e fecha');

como(ADMIN);
r = await json(await R.previa.GET(pedir('GET', `/x?ate=${hoje}`)));
eq(r.corpo.funcoes_de_outros, [], 'o administrador vê e fecha todas as funções');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
