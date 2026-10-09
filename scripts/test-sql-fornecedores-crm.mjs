/**
 * Fornecedor sincronizado entre o CRM e o Financeiro, contra um Postgres real
 * (PGlite), rodando o webhook DE PRODUÇÃO (processarEventoCRM) com o pool
 * trocado (scripts/db-de-teste-hook.mjs). Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (a) as regras puras: leitura dos dois formatos, mesclagem (venda preenche,
 *       cadastro sobrescreve, vazio nunca apaga) e o nome como último sinal;
 *   (b) fornecedor novo no CRM nasce aqui com o cadastro completo e o vínculo,
 *       e o CRM recebe de volta qual cadastro daqui é o dele (o eco);
 *   (c) o que já existia aqui é adotado pelo CNPJ (mesmo formatado) ou pelo
 *       nome único, sem duplicar; nome repetido ou CNPJ diferente não adota;
 *   (d) alteração no CRM sobrescreve, vazio não apaga, aviso atrasado não
 *       desfaz o mais novo, CNPJ de outro cadastro não é copiado, e quem já
 *       tem o vínculo não recebe eco (a conversa termina);
 *   (e) a venda do CRM acha o mesmo cadastro pelo vínculo, inclusive no
 *       formato antigo da chave, e só preenche vazio;
 *   (f) apagado no CRM fica inativo aqui; duplicado do CRM não desativa o
 *       cadastro ligado a outro;
 *   (g) o envio daqui: cadastro com vínculo, remoção e a lista completa;
 *   (h) uma empresa nunca enxerga o fornecedor da outra.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-fornecedores-crm.mjs
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
  CREATE TABLE crm_eventos_entrada (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', processado BOOLEAN NOT NULL DEFAULT false, erro TEXT, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE membros (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_fornecedores_crm_external_id ON fornecedores_crm(tenant_id, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
  CREATE UNIQUE INDEX idx_fornecedores_crm_cnpj ON fornecedores_crm(tenant_id, cnpj) WHERE cnpj IS NOT NULL AND cnpj <> '';
  CREATE UNIQUE INDEX idx_fornecedores_crm_crm_supplier ON fornecedores_crm(tenant_id, crm_supplier_id) WHERE crm_supplier_id IS NOT NULL AND crm_supplier_id <> '';
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const {
  processarEventoCRM, enviarFornecedorAoCrm, enviarRemocaoDeFornecedorAoCrm, sincronizarTodosOsFornecedores,
} = await import('../src/lib/crm-integration.ts');
const {
  lerFornecedorDoCrm, lerFornecedorDaVenda, mesclarFornecedor, candidatoPeloNome, cadastroCompleto,
} = await import('../src/lib/fornecedor-sync.ts');

const T1 = 'agencia-a', T2 = 'agencia-b';
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Itaú","saldo_atual":0}')`, [T1]);

let seq = 0;
const evento = (tipo, payload, tenant = T1, id = `ev-${++seq}`) => processarEventoCRM(tipo, payload, id, tenant);
const doCrm = (o = {}) => ({ crm_supplier_id: 12, nome: 'Rextur', documento: '', email: '', telefone: '', ativo: true, atualizado_em: '2026-10-09T10:00:00Z', ...o });
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const fornecedores = (tenant = T1) => todos(`SELECT id, nome_fantasia, cnpj, crm_supplier_id, external_id, data FROM fornecedores_crm WHERE tenant_id = $1 ORDER BY created_at, id`, [tenant]);
const fornecedor = id => um(`SELECT id, nome_fantasia, cnpj, crm_supplier_id, external_id, crm_atualizado_em, data FROM fornecedores_crm WHERE id = $1`, [id]);
const peloCrm = (crmId, tenant = T1) => um(`SELECT id, nome_fantasia, cnpj, crm_supplier_id, data FROM fornecedores_crm WHERE tenant_id = $1 AND crm_supplier_id = $2`, [tenant, String(crmId)]);
/** O eco é disparado sem esperar (a resposta ao CRM não espera o envio). */
const esperarEco = () => new Promise(r => setTimeout(r, 30));
const saidas = async (tipo, tenant = T1) => (await todos(`SELECT data FROM crm_eventos_saida WHERE tenant_id = $1 AND tipo = $2 ORDER BY created_at, id`, [tenant, tipo])).map(r => r.data.payload);
async function novoFornecedor(id, tenant, d, extra = {}) {
  await query(
    `INSERT INTO fornecedores_crm (id, nome_fantasia, cnpj, data, crm_supplier_id, tenant_id, created_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6, NOW() - ($7 || ' minutes')::interval)`,
    [id, d.nome_fantasia ?? '', d.cnpj ?? '', JSON.stringify({ id, ...d }), extra.crm ?? null, tenant, String(extra.idade ?? 60)],
  );
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) as regras puras ---');
{
  const v = lerFornecedorDoCrm({ crm_supplier_id: 12, financeiro_id: ' f1 ', nome: ' Rextur ', documento: '12.345.678/0001-90', ativo: false, atualizado_em: '2026-10-09T10:00:00-03:00' });
  eq([v.crmId, v.financeiroId, v.nome, v.documento, v.ativo, v.atualizadoEm], ['12', 'f1', 'Rextur', '12345678000190', false, '2026-10-09T13:00:00.000Z'], 'cadastro do CRM: id, vínculo, nome aparado, CNPJ só dígitos, status e hora em UTC');
  eq(lerFornecedorDoCrm({ crm_supplier_id: 'x', documento: '123', ativo: 'sim' }).crmId + '|' + lerFornecedorDoCrm({ documento: '123' }).documento + '|' + String(lerFornecedorDoCrm({ ativo: 'sim' }).ativo), '||undefined', 'id que não é número, documento curto e status que não é sim/não são ignorados');
  eq(lerFornecedorDaVenda({ fornecedor_id: 'crm_supplier_12', fornecedor_nome: 'Rextur' }).crmId, '12', 'venda do CRM antigo: a chave crm_supplier_<id> já diz o vínculo');
  eq(lerFornecedorDaVenda({ fornecedor_id: 'crm_cnpj_12345678000190', crm_supplier_id: '12', financeiro_id: 'f1' }).crmId + lerFornecedorDaVenda({ fornecedor_id: 'crm_cnpj_12345678000190', crm_supplier_id: '12', financeiro_id: 'f1' }).financeiroId, '12f1', 'venda do CRM novo: vínculo e id daqui vêm explícitos');

  const atual = cadastroCompleto({ id: 'f', nome_fantasia: 'REXTUR', razao_social: 'REXTUR', cnpj: '', email: 'velho@rextur.com', telefone: '' });
  const vindo = { ...lerFornecedorDoCrm(doCrm({ nome: 'Rextur', documento: '12345678000190', email: 'novo@rextur.com', telefone: '11 99999-0000' })) };
  const p = mesclarFornecedor(atual, vindo, 'preencher');
  eq([p.data.nome_fantasia, p.data.cnpj, p.data.email, p.data.telefone, p.mudou], ['REXTUR', '12345678000190', 'velho@rextur.com', '11 99999-0000', ['documento', 'telefone']], 'venda só preenche o vazio');
  const s = mesclarFornecedor(atual, vindo, 'sobrescrever');
  eq([s.data.nome_fantasia, s.data.razao_social, s.data.email, s.mudou], ['Rextur', 'Rextur', 'novo@rextur.com', ['nome', 'documento', 'email', 'telefone']], 'cadastro do CRM sobrescreve; a razão social que só repetia o nome acompanha');
  const comRazao = cadastroCompleto({ id: 'f', nome_fantasia: 'Rextur', razao_social: 'Rextur Viagens e Turismo Ltda' });
  eq(mesclarFornecedor(comRazao, { ...vindo, nome: 'Rextur Turismo' }, 'sobrescrever').data.razao_social, 'Rextur Viagens e Turismo Ltda', 'razão social de verdade não é trocada pelo nome');
  const vazio = mesclarFornecedor(cadastroCompleto({ id: 'f', nome_fantasia: 'Rextur', cnpj: '12.345.678/0001-90', email: 'a@b.com', telefone: '1133334444' }), lerFornecedorDoCrm(doCrm({ nome: '', documento: '', email: '', telefone: '' })), 'sobrescrever');
  eq([vazio.data.cnpj, vazio.data.email, vazio.data.telefone, vazio.mudou], ['12.345.678/0001-90', 'a@b.com', '1133334444', []], 'vazio nunca apaga, e o mesmo CNPJ formatado não conta como mudança');
  eq(mesclarFornecedor(cadastroCompleto({ id: 'f', email: 'A@B.com' }), { ...vindo, nome: '', documento: '', telefone: '', email: 'a@b.com' }, 'sobrescrever').mudou, [], 'e-mail só com maiúscula diferente não é mudança');
  eq(mesclarFornecedor(atual, { ...vindo, ativo: false }, 'preencher').data.status, 'ATIVO', 'venda nunca desativa');
  eq(mesclarFornecedor(atual, { ...vindo, ativo: false }, 'sobrescrever').data.status, 'INATIVO', 'desativado no CRM, desativado aqui');

  const lista = [
    { id: 'a', nome: 'Operadora Européia', documento: '', crmId: '' },
    { id: 'b', nome: 'Hotel Central', documento: '', crmId: '' },
    { id: 'c', nome: 'hotel  central', documento: '', crmId: '' },
    { id: 'd', nome: 'Seguros X', documento: '11222333000181', crmId: '' },
    { id: 'e', nome: 'Receptivo Lisboa', documento: '', crmId: '99' },
  ];
  eq(candidatoPeloNome(lista, { nome: 'OPERADORA EUROPEIA', documento: '', crmId: '1' })?.id, 'a', 'nome sem acento e sem diferenciar maiúscula');
  eq(candidatoPeloNome(lista, { nome: 'Operadora Européia Ltda.', documento: '', crmId: '1' })?.id, 'a', 'sufixo de razão social não muda quem é (a mesma regra do CRM)');
  eq(candidatoPeloNome([{ id: 'x', nome: 'Sakura Turismo', documento: '', crmId: '' }], { nome: 'Sakuratur', documento: '', crmId: '1' }), null, 'nome parecido não é o mesmo');
  eq(candidatoPeloNome(lista, { nome: 'Hotel Central', documento: '', crmId: '1' }), null, 'dois cadastros com o mesmo nome: nenhum é escolhido');
  eq(candidatoPeloNome(lista, { nome: 'Seguros X', documento: '99888777000166', crmId: '1' }), null, 'CPF/CNPJ diferente: não é o mesmo, mesmo com o nome igual');
  eq(candidatoPeloNome(lista, { nome: 'Receptivo Lisboa', documento: '', crmId: '1' }), null, 'ligado a outro fornecedor do CRM: não é adotado');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) fornecedor novo no CRM nasce aqui ---');
let rextur;
{
  const r = await evento('FORNECEDOR_ATUALIZADO', doCrm({ email: 'contato@rextur.com', telefone: '11 3333-4444' }));
  eq(r.processado, true, 'o evento entra');
  const lista = await fornecedores();
  eq(lista.length, 1, 'um cadastro');
  rextur = lista[0];
  eq([rextur.nome_fantasia, rextur.crm_supplier_id, rextur.data.email, rextur.data.telefone, rextur.data.status], ['Rextur', '12', 'contato@rextur.com', '11 3333-4444', 'ATIVO'], 'com nome, vínculo, e-mail, telefone e ativo');
  eq([rextur.data.tipo, rextur.data.regras_faturamento?.prazo_pagamento_dias, Array.isArray(rextur.data.dados_bancarios), rextur.data.observacoes], ['OUTROS', 30, true, ''], 'com o cadastro completo: a tela não quebra ao abrir');
  eq(/cadastrado/.test(r.acao), true, 'o histórico diz que foi cadastrado');
  await esperarEco();
  const ecos = await saidas('FORNECEDOR_CADASTRADO');
  eq(ecos.length, 1, 'o CRM recebe UM eco');
  eq([ecos[0].financeiro_id, ecos[0].crm_supplier_id, ecos[0].nome_fantasia, ecos[0].ativo], [rextur.id, '12', 'Rextur', true], 'o eco leva qual cadastro daqui é o dele');

  const de = await evento('FORNECEDOR_ATUALIZADO', doCrm({ email: 'contato@rextur.com' }), T1, 'ev-repetido');
  const de2 = await evento('FORNECEDOR_ATUALIZADO', doCrm({ email: 'contato@rextur.com' }), T1, 'ev-repetido');
  eq([de.processado, de2.acao, (await fornecedores()).length], [true, 'duplicata ignorada', 1], 'o mesmo evento duas vezes não duplica');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) o que já existia aqui é adotado ---');
{
  await novoFornecedor('f-cvc', T1, { nome_fantasia: 'CVC Corp', razao_social: 'CVC Brasil Operadora', cnpj: '10.760.260/0001-19', email: 'fin@cvc.com', status: 'ATIVO' });
  const antes = (await saidas('FORNECEDOR_CADASTRADO')).length;
  const r = await evento('FORNECEDOR_ATUALIZADO', doCrm({ crm_supplier_id: 20, nome: 'CVC', documento: '10760260000119', email: '' }));
  eq((await peloCrm(20))?.id, 'f-cvc', 'adotado pelo CNPJ, mesmo formatado aqui e só dígitos no CRM');
  eq((await fornecedores()).length, 2, 'nenhum cadastro duplicado');
  eq([(await fornecedor('f-cvc')).nome_fantasia, (await fornecedor('f-cvc')).data.email], ['CVC', 'fin@cvc.com'], 'o nome do CRM vale; o e-mail daqui fica (veio vazio)');
  eq(/pelo CPF\/CNPJ/.test(r.acao) && /ligado ao CRM/.test(r.acao), true, 'o histórico diz como achou');
  await esperarEco();
  const eco = (await saidas('FORNECEDOR_CADASTRADO')).slice(antes);
  eq([eco.length, eco[0]?.financeiro_id, eco[0]?.email, eco[0]?.cnpj], [1, 'f-cvc', 'fin@cvc.com', '10760260000119'], 'o eco devolve ao CRM o e-mail que só existia aqui');

  await novoFornecedor('f-europa', T1, { nome_fantasia: 'Operadora Européia', razao_social: '', cnpj: '' });
  await evento('FORNECEDOR_ATUALIZADO', doCrm({ crm_supplier_id: 21, nome: 'OPERADORA EUROPEIA' }));
  eq((await peloCrm(21))?.id, 'f-europa', 'adotado pelo nome, quando é o único com esse nome');

  await novoFornecedor('f-h1', T1, { nome_fantasia: 'Hotel Central', cnpj: '' });
  await novoFornecedor('f-h2', T1, { nome_fantasia: 'HOTEL CENTRAL', cnpj: '' });
  await evento('FORNECEDOR_ATUALIZADO', doCrm({ crm_supplier_id: 22, nome: 'Hotel Central' }));
  const h = await peloCrm(22);
  eq(['f-h1', 'f-h2'].includes(h?.id), false, 'nome repetido aqui: nenhum dos dois é adotado à força');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) alteração no CRM ---');
{
  const antes = (await saidas('FORNECEDOR_CADASTRADO')).length;
  await evento('FORNECEDOR_ATUALIZADO', doCrm({ financeiro_id: rextur.id, nome: 'Rextur Turismo', email: 'novo@rextur.com', telefone: '', atualizado_em: '2026-10-09T11:00:00Z' }));
  let f = await fornecedor(rextur.id);
  eq([f.nome_fantasia, f.data.email, f.data.telefone], ['Rextur Turismo', 'novo@rextur.com', '11 3333-4444'], 'nome e e-mail trocados; telefone vazio não apaga');
  await esperarEco();
  eq((await saidas('FORNECEDOR_CADASTRADO')).length, antes, 'o CRM já tem o vínculo: nada volta (a conversa termina)');

  await evento('FORNECEDOR_ATUALIZADO', doCrm({ financeiro_id: rextur.id, nome: 'Rextur Velho', atualizado_em: '2026-10-09T10:30:00Z' }));
  f = await fornecedor(rextur.id);
  eq(f.nome_fantasia, 'Rextur Turismo', 'aviso atrasado (salvo antes) não desfaz o mais novo');

  const r = await evento('FORNECEDOR_ATUALIZADO', doCrm({ financeiro_id: rextur.id, documento: '10760260000119', atualizado_em: '2026-10-09T12:00:00Z' }));
  f = await fornecedor(rextur.id);
  eq([f.cnpj, /já é de outro fornecedor/.test(r.acao)], ['', true], 'CNPJ que já é de outro cadastro daqui não é copiado, e o histórico avisa');

  await evento('FORNECEDOR_ATUALIZADO', doCrm({ financeiro_id: rextur.id, ativo: false, atualizado_em: '2026-10-09T12:30:00Z' }));
  eq((await fornecedor(rextur.id)).data.status, 'INATIVO', 'desativado no CRM');
  await evento('FORNECEDOR_ATUALIZADO', doCrm({ financeiro_id: rextur.id, ativo: true, atualizado_em: '2026-10-09T12:40:00Z' }));
  eq((await fornecedor(rextur.id)).data.status, 'ATIVO', 'reativado no CRM');

  const semId = await evento('FORNECEDOR_ATUALIZADO', { nome: 'Sem id' });
  eq([semId.processado, /sem crm_supplier_id/.test(semId.erro ?? '')], [false, true], 'sem o id do CRM: erro, nada é criado');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) a venda do CRM acha o mesmo cadastro ---');
{
  const venda = (fornecedoresDaVenda, o = {}) => ({
    versao_contrato: 2, crm_venda_id: `crm_deal_${++seq}`, cliente_id: 'crm_contact_1', cliente_nome: 'Ana Souza',
    valor_total: 1000, custo_total: 600, data_venda: '2026-10-09', fornecedores: fornecedoresDaVenda, ...o,
  });
  // Pago direto ao fornecedor (o padrão): a venda gera a comissão a receber DELE.
  const cps = async () => (await todos(`SELECT data->>'fornecedor_id' AS f FROM contas_receber WHERE tenant_id = $1 AND data->>'origem' = 'COMISSAO_FORNECEDOR' ORDER BY created_at DESC, id`, [T1])).map(r => r.f);

  await evento('VENDA_FECHADA', venda([{ fornecedor_id: 'crm_cnpj_10760260000119', crm_supplier_id: '20', financeiro_id: 'f-cvc', fornecedor_nome: 'Outro nome', fornecedor_email: 'outro@cvc.com', valor_custo: 600, valor_venda: 1000 }]));
  eq((await cps())[0], 'f-cvc', 'a comissão sai do cadastro ligado ao fornecedor do CRM');
  const cvc = await fornecedor('f-cvc');
  eq([cvc.nome_fantasia, cvc.data.email, cvc.external_id], ['CVC', 'fin@cvc.com', 'crm_cnpj_10760260000119'], 'a venda não troca nome nem e-mail; a chave da venda fica guardada');

  const antes = (await saidas('FORNECEDOR_CADASTRADO')).length;
  await evento('VENDA_FECHADA', venda([{ fornecedor_id: 'crm_supplier_12', fornecedor_nome: 'Rextur', valor_custo: 600, valor_venda: 1000 }]));
  eq((await cps())[0], rextur.id, 'formato antigo (só crm_supplier_<id>): o mesmo cadastro');
  await esperarEco();
  eq((await saidas('FORNECEDOR_CADASTRADO')).length, antes + 1, 'CRM antigo não manda o id daqui: recebe o eco para aprender');

  const n = (await fornecedores()).length;
  await evento('VENDA_FECHADA', venda([{ fornecedor_id: 'crm_supplier_name_guia_local', fornecedor_nome: 'Guia Local', valor_custo: 600, valor_venda: 1000 }]));
  const guia = (await fornecedores()).find(f => f.nome_fantasia === 'Guia Local');
  eq([(await fornecedores()).length, guia?.crm_supplier_id, guia?.external_id], [n + 1, null, 'crm_supplier_name_guia_local'], 'fornecedor digitado à mão na negociação: nasce aqui sem vínculo');
  await esperarEco();
  const ecoGuia = (await saidas('FORNECEDOR_CADASTRADO')).filter(p => p.financeiro_id === guia?.id);
  eq(ecoGuia.length, 1, 'e vai para o CRM, que passa a tê-lo cadastrado');
  await evento('VENDA_FECHADA', venda([{ fornecedor_id: 'crm_supplier_name_guia_local', fornecedor_nome: 'Guia Local', valor_custo: 600, valor_venda: 1000 }]));
  await esperarEco();
  eq([(await fornecedores()).length, (await saidas('FORNECEDOR_CADASTRADO')).filter(p => p.financeiro_id === guia?.id).length], [n + 1, 1], 'a próxima venda com o mesmo nome acha o mesmo cadastro, sem novo eco');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (f) apagado no CRM ---');
{
  // Duplicado no CRM: dois fornecedores de lá com o mesmo CNPJ viram um aqui.
  await evento('FORNECEDOR_ATUALIZADO', doCrm({ crm_supplier_id: 30, nome: 'CVC (duplicado)', documento: '10760260000119', atualizado_em: '2026-10-09T13:00:00Z' }));
  eq([(await fornecedor('f-cvc')).crm_supplier_id, (await peloCrm(30))], ['20', undefined], 'o duplicado do CRM cai no mesmo cadastro, que continua ligado ao primeiro');
  const dup = await evento('FORNECEDOR_REMOVIDO', { crm_supplier_id: 30, financeiro_id: 'f-cvc' });
  eq([(await fornecedor('f-cvc')).data.status, /segue ativo/.test(dup.acao)], ['ATIVO', true], 'apagar o duplicado lá não desativa o cadastro daqui');

  const r = await evento('FORNECEDOR_REMOVIDO', { crm_supplier_id: 20, financeiro_id: 'f-cvc' });
  const cvc = await fornecedor('f-cvc');
  eq([cvc.data.status, cvc.crm_supplier_id, (await fornecedores()).some(f => f.id === 'f-cvc')], ['INATIVO', null, true], 'apagado no CRM: inativo aqui, sem vínculo, e não sai da lista (contas antigas apontam para ele)');
  eq(/desativado/.test(r.acao), true, 'o histórico diz que foi desativado');
  eq((await evento('FORNECEDOR_REMOVIDO', { crm_supplier_id: 777 })).acao, 'fornecedor apagado no CRM não existe aqui', 'apagado lá e inexistente aqui: nada acontece');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (g) o envio daqui ---');
{
  await novoFornecedor('f-novo', T1, { nome_fantasia: 'Seguradora Viaje Bem', razao_social: 'Viaje Bem Seguros SA', cnpj: '11.222.333/0001-81', email: 'ops@viajebem.com', tipo: 'SEGURADORA', status: 'ATIVO' });
  await enviarFornecedorAoCrm(T1, 'f-novo');
  const ultimo = (await saidas('FORNECEDOR_CADASTRADO')).at(-1);
  eq([ultimo.financeiro_id, ultimo.crm_supplier_id, ultimo.cnpj, ultimo.nome_fantasia, ultimo.ativo, typeof ultimo.atualizado_em], ['f-novo', null, '11222333000181', 'Seguradora Viaje Bem', true, 'string'], 'cadastrado aqui: vai sem vínculo, CNPJ só dígitos');
  await enviarFornecedorAoCrm(T1, rextur.id);
  eq((await saidas('FORNECEDOR_CADASTRADO')).at(-1).crm_supplier_id, '12', 'alterado aqui depois de ligado: vai com o vínculo');
  eq(await enviarFornecedorAoCrm(T2, rextur.id), false, 'fornecedor de outra empresa não é enviado');

  await enviarRemocaoDeFornecedorAoCrm(T1, { id: rextur.id, crmSupplierId: '12' });
  const rem = (await saidas('FORNECEDOR_REMOVIDO')).at(-1);
  eq([rem.financeiro_id, rem.fornecedor_id, rem.crm_supplier_id], [rextur.id, rextur.id, '12'], 'apagado aqui: o CRM recebe quem desativar');

  const antes = (await saidas('FORNECEDOR_CADASTRADO')).length;
  const n = await sincronizarTodosOsFornecedores(T1, { pedirOsDoCrm: true });
  eq([n, (await saidas('FORNECEDOR_CADASTRADO')).length - antes, (await saidas('FORNECEDORES_SINCRONIZAR')).length], [(await fornecedores()).length, n, 1], 'sincronizar: todos vão, e o CRM é chamado a mandar os dele');

  const pedido = await evento('FORNECEDORES_SINCRONIZAR', {});
  await esperarEco();
  eq([pedido.acao, (await saidas('FORNECEDOR_CADASTRADO')).length - antes, (await saidas('FORNECEDORES_SINCRONIZAR')).length], [`${n} fornecedores enviados ao CRM`, 2 * n, 1], 'o CRM pede a lista: todos vão, sem pedir a dele de volta');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (h) uma empresa não enxerga a outra ---');
{
  await novoFornecedor('f-b', T2, { nome_fantasia: 'Rextur', cnpj: '' });
  const n1 = (await fornecedores(T1)).length;
  const nomeAqui = (await fornecedor(rextur.id)).nome_fantasia;
  await evento('FORNECEDOR_ATUALIZADO', doCrm({ crm_supplier_id: 12, nome: 'REXTUR', email: 'b@rextur.com', atualizado_em: '2026-10-09T15:00:00Z' }), T2);
  eq([(await peloCrm(12, T2))?.id, (await fornecedor(rextur.id)).nome_fantasia, (await fornecedores(T1)).length], ['f-b', nomeAqui, n1], 'o mesmo id de fornecedor do CRM na outra empresa liga o cadastro de lá; o daqui não muda');
  await evento('FORNECEDOR_REMOVIDO', { crm_supplier_id: 12 }, T2);
  eq([(await fornecedor('f-b')).data.status, (await fornecedor(rextur.id)).data.status], ['INATIVO', 'ATIVO'], 'apagar na outra empresa não desativa aqui');
}

console.log(`\n${total - falhas}/${total} testes dos fornecedores do CRM passaram`);
if (falhas > 0) process.exit(1);
