/**
 * Recorrência (05/11/2026) contra um Postgres real (PGlite), rodando o
 * código DE PRODUÇÃO (src/lib/recorrencia-servidor.ts).
 *
 * Prova:
 *  1. criar a série é idempotente (mesmo id = nada novo) e a mesma ocorrência
 *     nunca nasce duas vezes (índice único por série e ordem);
 *  2. a despesa fixa pelo servidor gera os mesmos títulos do laço antigo;
 *  3. série sem fim cresce pelo agendador até o horizonte, sem duplicar;
 *  4. os três escopos de edição; título pago ou com baixa parcial intocado;
 *  5. parcelado soma exatamente o total em centavos (real e moeda estrangeira);
 *  6. encerrar exclui só os pendentes futuros;
 *  7. mais parcelas recusa título de venda/fatura e não duplica;
 *  8. copiar mês tem o mesmo resultado de antes e não duplica na segunda vez.
 *
 * Uso: node --no-warnings scripts/test-sql-recorrencia.mjs
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
async function erro(p) { try { await p; return null; } catch (e) { return { msg: e?.message ?? String(e), status: e?.status }; } }

const TABELAS = `
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
`;

const pg = new PGlite();
await pg.exec(TABELAS);
const query = async (text, values) => {
  const r = await pg.query(text, values);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { RECORRENCIA_SCHEMA_SQL } = await import('../src/lib/recorrencia-schema.ts');
const S = await import('../src/lib/recorrencia-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { addDias, addMeses, paraBRL, paraCentavos, round2, num } = await import('../src/lib/money.ts');
const { createContaPagar } = await import('../src/lib/crm-types.ts');

await pg.exec(RECORRENCIA_SCHEMA_SQL);
await pg.exec(RECORRENCIA_SCHEMA_SQL); // idempotente: roda a cada boot

const T = 't1';
const HOJE = '2026-11-05';
const tx = fn => emTransacao(fn);
const criar = (corpo, hoje = HOJE, t = T) => tx(e => S.criarSerieNoExecutor(e, t, S.prepararSerie(corpo), hoje));
const titulos = async (serie, tabela = 'contas_pagar', t = T) =>
  (await query(`SELECT id, data FROM ${tabela} WHERE tenant_id = $1 AND data->>'serie_id' = $2 ORDER BY (data->>'serie_ordem')::int`, [t, serie])).rows.map(r => r.data);
const umTitulo = async (id, tabela = 'contas_pagar') => (await query(`SELECT data FROM ${tabela} WHERE id = $1`, [id])).rows[0]?.data;
const gravarData = (id, data, tabela = 'contas_pagar') => query(`UPDATE ${tabela} SET data = $2::jsonb, status = $3 WHERE id = $1`, [id, JSON.stringify(data), data.status]);
const centavos = lista => lista.reduce((a, t) => a + paraCentavos(num(t.valor_final)), 0);
const MODELO_PAGAR = {
  origem: 'DESPESA_FIXA', fornecedor_nome: 'Imobiliária Centro', descricao: 'Aluguel da loja', categoria_id: 'cat-aluguel',
  moeda: 'BRL', cambio: 1, forma_pagamento: 'BOLETO', cartao_id: '', natureza_custo: 'FIXO', is_custo_comercial: false, observacoes: '',
};

// ---------------------------------------------------------------------------
console.log('--- 1. Criar é idempotente e a mesma ocorrência não nasce duas vezes ---');
{
  const corpo = { id: 'serie-aluguel', tabela: 'contas_pagar', tipo: 'recorrente', inicio: '2026-01-31', valor: 3500.1,
    regra: { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'ocorrencias', ocorrencias: 12 } }, modelo: MODELO_PAGAR };
  const r1 = await criar(corpo);
  eq([r1.criados, r1.ja_existia, r1.serie.status], [12, false, 'concluida'], 'série de 12 nasce inteira e concluída');
  const r2 = await criar(corpo);
  eq([r2.criados, r2.ja_existia, r2.titulos.length], [0, true, 12], 'mesmo id de novo: nada novo, devolve o que existe');
  eq((await titulos('serie-aluguel')).length, 12, 'continuam 12 títulos');
  const dup = await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('outro-id', $1, 'PENDENTE', $2::jsonb) ON CONFLICT DO NOTHING`,
    [T, JSON.stringify({ serie_id: 'serie-aluguel', serie_ordem: 3, status: 'PENDENTE' })]);
  eq(dup.rowCount, 0, 'índice único: outra linha com a mesma série e ordem é recusada');
  eq(await S.estenderHorizonteNoExecutor(pool, T, 'serie-aluguel', HOJE), 0, 'série concluída não gera mais nada');

  console.log('--- 2. Despesa fixa pelo servidor = o laço antigo da tela ---');
  // Cópia congelada do laço que a tela de contas a pagar rodava até 05/11/2026.
  const form = { ...MODELO_PAGAR, valor_original: 3500.1, data_vencimento: '2026-01-31' };
  const legado = [];
  for (let i = 0; i < 12; i++) {
    const valorBrl = paraBRL(round2(form.valor_original), 'BRL', 1);
    legado.push({ ...createContaPagar(), ...form, cartao_id: null, descricao: `${form.descricao} (${i + 1}/12 — mensal)`,
      data_vencimento: i === 0 ? form.data_vencimento : addMeses(form.data_vencimento, i), valor_original: 3500.1, cambio: 1,
      valor_final: valorBrl, valor_brl: valorBrl, parcela_numero: i + 1, total_parcelas: 12 });
  }
  const CAMPOS = ['origem', 'fornecedor_nome', 'descricao', 'categoria_id', 'data_vencimento', 'valor_original', 'moeda', 'cambio', 'valor_final',
    'valor_brl', 'forma_pagamento', 'cartao_id', 'natureza_custo', 'is_custo_comercial', 'status', 'parcela_numero', 'total_parcelas', 'valor_pago'];
  const rec = l => l.map(c => Object.fromEntries(CAMPOS.map(k => [k, c[k]])));
  eq(rec(await titulos('serie-aluguel')), rec(legado), 'mesmos títulos (descrição, vencimentos com clamp, valores, parcela i/N)');
  const st = (await query(`SELECT DISTINCT status FROM contas_pagar WHERE data->>'serie_id' = 'serie-aluguel'`)).rows.map(r => r.status);
  eq(st, ['PENDENTE'], 'coluna status = PENDENTE');
}

// ---------------------------------------------------------------------------
console.log('--- 3. Série sem fim cresce pelo agendador, sem duplicar ---');
{
  const corpo = { id: 'serie-assinatura', tabela: 'contas_pagar', tipo: 'recorrente', inicio: '2026-11-10', valor: 99.9, horizonte_meses: 3,
    regra: { frequencia: 'MES', intervalo: 1, dia_do_mes: 10, feriado: 'postergar', fim: { tipo: 'nunca' } }, modelo: { ...MODELO_PAGAR, descricao: 'Assinatura' } };
  const prev = S.previaDaSerie(S.prepararSerie(corpo), HOJE);
  eq([prev.gerar_agora, prev.proximas_sozinhas, prev.soma], [4, true, null], 'prévia: 4 agora (3 meses à frente), o resto sozinho');
  const r = await criar(corpo);
  eq(r.titulos.map(t => t.vencimento), ['2026-11-10', '2026-12-10', '2027-01-11', '2027-02-10'], 'até o horizonte; 10/01/2027 (domingo) adiado');
  eq((await titulos('serie-assinatura'))[0].descricao, 'Assinatura', 'série sem fim não ganha sufixo');
  const tarefa = S.tarefaRecorrenciaGerar;
  eq(tarefa.janela(new Date('2027-01-15T07:00:00Z')), null, 'tarefa: antes das 5h de Brasília não é hora');
  eq(tarefa.janela(new Date('2027-01-15T09:00:00Z')), '2027-01-15', 'tarefa: janela diária a partir das 5h');
  const ctx = { exec: pool, emTransacao: tx, agora: new Date('2027-01-15T09:00:00Z'), restanteMs: () => 60_000 };
  eq(await tarefa.agencias(ctx), ['t1'], 'tarefa: agências com série viva');
  const r1 = await tarefa.executar(ctx, T);
  const r2 = await tarefa.executar(ctx, T);
  eq([r1.criados, r2.criados], [2, 0], 'tarefa cria 2 (mar e abr) e na segunda vez nada');
  eq((await titulos('serie-assinatura')).map(t => t.data_vencimento).slice(-2), ['2027-03-10', '2027-04-12'], '10/04/2027 (sábado) adiado para segunda 12');
}

// ---------------------------------------------------------------------------
console.log('--- 4. Editar: só esta, esta e as próximas, todas ---');
{
  await criar({ id: 'serie-edicao', tabela: 'contas_pagar', tipo: 'recorrente', inicio: '2026-12-05', valor: 1000,
    regra: { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'ocorrencias', ocorrencias: 6 } }, modelo: { ...MODELO_PAGAR, descricao: 'Contador' } });
  const ids = (await titulos('serie-edicao')).map(t => t.id);
  // 2 pago inteiro, 3 com baixa parcial.
  const t2 = await umTitulo(ids[1]);
  await gravarData(ids[1], { ...t2, status: 'PAGO', valor_pago: 1000, data_pagamento: '2027-01-05', conta_bancaria_id: 'b1' });
  const t3 = await umTitulo(ids[2]);
  await gravarData(ids[2], { ...t3, status: 'PARCIAL', valor_pago: 300, data_pagamento: '2027-02-05', conta_bancaria_id: 'b1' });
  const pago = JSON.stringify(await umTitulo(ids[1]));
  const parcial = JSON.stringify(await umTitulo(ids[2]));

  const edit = (titulo_id, escopo, alteracoes, extra = {}) => tx(e => S.editarSerieNoExecutor(e, T, 'serie-edicao', { titulo_id, escopo, alteracoes, ...extra }));
  const s1 = await edit(ids[3], 'so_esta', { valor_original: 1100, data_vencimento: '2027-03-08' });
  eq(s1.alterados.map(a => a.ordem), [4], 'só esta: só o 4');
  const ts = await titulos('serie-edicao');
  eq([ts[3].valor_final, ts[3].data_vencimento, ts[4].valor_final], [1100, '2027-03-08', 1000], 'só esta: valor e data do 4, o 5 igual');

  const previa = await edit(ids[1], 'esta_e_proximas', { valor_original: 1200 }, { previa: true });
  eq([previa.alterados.map(a => a.ordem), previa.intocados.map(a => a.ordem)], [[4, 5, 6], [2, 3]], 'prévia dos seguintes: 4, 5, 6 mudam; 2 (pago) e 3 (parcial) ficam');
  eq((await titulos('serie-edicao'))[4].valor_final, 1000, 'prévia não grava nada');
  const s2 = await edit(ids[1], 'esta_e_proximas', { valor_original: 1200, descricao: 'Contador novo (2/6 — mensal)' }, { versao: 1 });
  const ts2 = await titulos('serie-edicao');
  eq(ts2.map(t => t.valor_final), [1000, 1000, 1000, 1200, 1200, 1200], 'seguintes: valores (pago e parcial intactos, o 1 de antes intacto)');
  eq(ts2.map(t => t.descricao), ['Contador (1/6 — mensal)', 'Contador (2/6 — mensal)', 'Contador (3/6 — mensal)',
    'Contador novo (4/6 — mensal)', 'Contador novo (5/6 — mensal)', 'Contador novo (6/6 — mensal)'], 'seguintes: descrição troca o texto e mantém o "(i/6 — mensal)" de cada um');
  eq([JSON.stringify(await umTitulo(ids[1])), JSON.stringify(await umTitulo(ids[2]))], [pago, parcial], 'título pago e título parcial: byte a byte iguais');
  eq(s2.versao, 2, 'versão da série sobe');
  const conflito = await erro(edit(ids[0], 'todas', { valor_original: 1 }, { versao: 1 }));
  eq(conflito?.status, 409, 'versão velha: 409, ninguém sobrescreve a mudança do outro');

  const s3 = await edit(ids[4], 'todas', { fornecedor_nome: 'Escritório Contábil', dia_do_mes: 20 });
  eq(s3.alterados.map(a => a.ordem), [1, 4, 5, 6], 'todos: inclusive o 1, menos o pago e o parcial');
  const ts3 = await titulos('serie-edicao');
  eq(ts3.map(t => t.fornecedor_nome), ['Escritório Contábil', 'Imobiliária Centro', 'Imobiliária Centro', 'Escritório Contábil', 'Escritório Contábil', 'Escritório Contábil'], 'todos: fornecedor');
  eq(ts3.map(t => t.data_vencimento), ['2026-12-20', '2027-01-05', '2027-02-05', '2027-03-20', '2027-04-20', '2027-05-20'], 'todos: novo dia 20 (o "só esta" do 4 foi substituído)');
  const serie = await S.carregarSerie(pool, T, 'serie-edicao');
  eq([serie.regra.dia_do_mes, serie.modelo.fornecedor_nome, serie.valorCentavos], [20, 'Escritório Contábil', 120000], 'a série guarda a mudança para as próximas');
  const outro = await erro(tx(e => S.editarSerieNoExecutor(e, 'outra-agencia', 'serie-edicao', { titulo_id: ids[0], escopo: 'todas', alteracoes: { valor_original: 1 } })));
  eq(outro?.status, 404, 'outra agência não enxerga a série');
}

// ---------------------------------------------------------------------------
console.log('--- 5. As próximas ocorrências seguem a edição ---');
{
  await tx(e => S.editarSerieNoExecutor(e, T, 'serie-assinatura', {
    titulo_id: 'serie-assinatura-006', escopo: 'esta_e_proximas', alteracoes: { valor_original: 120 } }));
  const ctx = { exec: pool, emTransacao: tx, agora: new Date('2027-02-20T09:00:00Z'), restanteMs: () => 60_000 };
  await S.tarefaRecorrenciaGerar.executar(ctx, T);
  const ts = await titulos('serie-assinatura');
  eq(ts.map(t => t.valor_final), [99.9, 99.9, 99.9, 99.9, 99.9, 120, 120], 'nova ocorrência (mai) nasce com o valor novo');
}

// ---------------------------------------------------------------------------
console.log('--- 6. Parcelado soma exatamente o total em centavos ---');
{
  const base = { tabela: 'contas_pagar', tipo: 'parcelado', inicio: '2026-11-20', modelo: { ...MODELO_PAGAR, descricao: 'Notebook', origem: 'OUTROS' } };
  for (const [id, valor, n] of [['parc-1', 1000, 3], ['parc-2', 999.99, 7], ['parc-3', 0.05, 4], ['parc-4', 12345.67, 12]]) {
    await criar({ ...base, id, valor, regra: { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'ocorrencias', ocorrencias: n } } });
    const ts = await titulos(id);
    eq([ts.length, centavos(ts)], [n, paraCentavos(valor)], `R$ ${valor} em ${n}: soma ${paraCentavos(valor)} centavos`);
  }
  const ts = await titulos('parc-1');
  eq(ts.map(t => [t.valor_final, t.descricao]), [[333.33, 'Notebook (parcela 1/3)'], [333.33, 'Notebook (parcela 2/3)'], [333.34, 'Notebook (parcela 3/3)']], 'resto na última e "(parcela i/N)"');
  await criar({ ...base, id: 'parc-usd', valor: 100, modelo: { ...base.modelo, moeda: 'USD', cambio: 5.4321 },
    regra: { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'ocorrencias', ocorrencias: 3 } } });
  const usd = await titulos('parc-usd');
  eq([usd.reduce((a, t) => a + paraCentavos(t.valor_original), 0), centavos(usd)], [10000, paraCentavos(paraBRL(100, 'USD', 5.4321))], 'dólar: soma na moeda e em reais batem com o total');
  const rec = await tx(e => S.criarSerieNoExecutor(e, T, S.prepararSerie({ id: 'parc-rec', tabela: 'contas_receber', tipo: 'parcelado', inicio: '2026-12-01', valor: 1000,
    regra: { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'ocorrencias', ocorrencias: 3 } },
    modelo: { origem: 'OUTROS', cliente_id: 'c1', cliente_nome: 'Maria', descricao: 'Pacote Chile', taxa: 10 } }), HOJE));
  const tr = await titulos('parc-rec', 'contas_receber');
  eq([rec.criados, centavos(tr), tr.reduce((a, t) => a + paraCentavos(t.taxa), 0)], [3, 100000, 1000], 'a receber: total e taxa repartidos sem perder centavo');
  const linhaRec = (await query(`SELECT cliente_id, status FROM contas_receber WHERE id = 'parc-rec-001'`)).rows[0];
  eq([linhaRec.cliente_id, linhaRec.status], ['c1', 'PENDENTE'], 'colunas de índice do a receber preenchidas');
}

// ---------------------------------------------------------------------------
console.log('--- 7. Encerrar: só os pendentes futuros saem ---');
{
  const ids = (await titulos('serie-edicao')).map(t => t.id);
  const pr = await tx(e => S.encerrarSerieNoExecutor(e, T, 'serie-edicao', { aPartirDe: '2027-01-01', previa: true }));
  eq([pr.removidos.map(r => r.ordem), pr.mantidos, pr.soma], [[4, 5, 6], 3, 3600], 'prévia: 4, 5 e 6 saem; 1 (passado), 2 (pago) e 3 (parcial) ficam');
  eq((await titulos('serie-edicao')).length, 6, 'prévia não exclui');
  const r = await tx(e => S.encerrarSerieNoExecutor(e, T, 'serie-edicao', { aPartirDe: '2027-01-01' }));
  eq([r.removidos.length, (await titulos('serie-edicao')).map(t => t.id)], [3, ids.slice(0, 3)], 'encerrar exclui os 3 pendentes futuros');
  eq((await S.carregarSerie(pool, T, 'serie-edicao')).status, 'encerrada', 'série encerrada');
  await tx(e => S.encerrarSerieNoExecutor(e, T, 'serie-assinatura', { aPartirDe: '2027-03-01' }));
  const antes = (await titulos('serie-assinatura')).length;
  await S.tarefaRecorrenciaGerar.executar({ exec: pool, emTransacao: tx, agora: new Date('2027-06-20T09:00:00Z'), restanteMs: () => 60_000 }, T);
  eq((await titulos('serie-assinatura')).length, antes, 'série encerrada não cresce mais');
}

// ---------------------------------------------------------------------------
console.log('--- 8. Mais parcelas ---');
{
  const venda = { ...createContaPagar(), id: 'cp-venda', origem: 'VENDA', auto_gerado: true, origem_venda_id: 'v1', descricao: 'Custo da venda', valor_original: 10, valor_final: 10, data_vencimento: '2026-12-01' };
  await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('cp-venda', $1, 'PENDENTE', $2::jsonb)`, [T, JSON.stringify(venda)]);
  const crVenda = { id: 'cr-venda', origem: 'VENDA', origem_venda_id: 'v1', status: 'PENDENTE', valor_final: 10, data_vencimento: '2026-12-01' };
  await query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ('cr-venda', $1, 'PENDENTE', $2::jsonb)`, [T, JSON.stringify(crVenda)]);
  const cartao = { ...createContaPagar(), id: 'cp-cartao', compra_id: 'compra-1', descricao: 'Hotel (1/3)', valor_final: 10, data_vencimento: '2026-12-01' };
  await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('cp-cartao', $1, 'PENDENTE', $2::jsonb)`, [T, JSON.stringify(cartao)]);
  const pa = (tabela, titulo_id, extra = {}) => tx(e => S.maisParcelasNoExecutor(e, T,
    { tabela, titulo_id, quantidade: 3, periodicidade: 'MENSAL', emissao_no_vencimento: true, ...extra }, HOJE));
  eq((await erro(pa('contas_pagar', 'cp-venda')))?.msg, S.MSG_MAIS_PARCELAS_RECUSADA, 'recusa título gerado por venda (a pagar)');
  eq((await erro(pa('contas_receber', 'cr-venda')))?.msg, S.MSG_MAIS_PARCELAS_RECUSADA, 'recusa título gerado por venda (a receber)');
  eq((await erro(pa('contas_pagar', 'cp-cartao')))?.msg, S.MSG_MAIS_PARCELAS_RECUSADA, 'recusa parcela de fatura do cartão');
  eq((await erro(pa('contas_pagar', 'cp-venda', { quantidade: 0 })))?.msg, 'A quantidade vai de 1 a 120.', 'quantidade inválida');
  eq((await erro(pa('contas_pagar', 'cp-venda', { periodicidade: 'X' })))?.msg, 'Escolha uma periodicidade da lista.', 'periodicidade inválida');

  const manual = { ...createContaPagar(), id: 'cp-manual', origem: 'OUTROS', fornecedor_nome: 'Gráfica', descricao: 'Folhetos', valor_original: 250, valor_final: 250, valor_brl: 250, data_vencimento: '2026-11-30' };
  await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('cp-manual', $1, 'PENDENTE', $2::jsonb)`, [T, JSON.stringify(manual)]);
  const pv = await pa('contas_pagar', 'cp-manual', { previa: true });
  eq(pv.parcelas.map(p => [p.ordem, p.vencimento, p.emissao, p.valor]), [[2, '2026-12-30', '2026-12-30', 250], [3, '2027-01-30', '2027-01-30', 250], [4, '2027-02-28', '2027-02-28', 250]], 'prévia: 3 parcelas, emissão = vencimento');
  const g = await pa('contas_pagar', 'cp-manual', { chave: 'clique-1' });
  eq(g.criadas, 3, 'grava 3 parcelas');
  const g2 = await pa('contas_pagar', 'cp-manual', { chave: 'clique-1' });
  eq([g2.criadas, g2.ja_feito], [0, true], 'mesmo clique de novo: nada novo');
  const ts = await titulos(g.serie_id);
  eq(ts.map(t => [t.serie_ordem, t.status, t.valor_final, t.descricao]), [[1, 'PENDENTE', 250, 'Folhetos'], [2, 'PENDENTE', 250, 'Folhetos'], [3, 'PENDENTE', 250, 'Folhetos'], [4, 'PENDENTE', 250, 'Folhetos']], 'o original vira a 1ª e as cópias nascem em aberto');
  const g3 = await pa('contas_pagar', 'cp-manual', { quantidade: 1, chave: 'clique-2', emissao_no_vencimento: false });
  eq([g3.criadas, g3.parcelas[0].ordem, g3.parcelas[0].emissao], [1, 5, HOJE], 'pedir mais uma acrescenta a 5ª, emissão hoje');
}

// ---------------------------------------------------------------------------
console.log('--- 9. Copiar mês: mesmo resultado de antes, sem duplicar ---');
{
  const ins = (id, d) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1, 'tc', $2, $3::jsonb)`, [id, d.status ?? 'PENDENTE', JSON.stringify({ ...createContaPagar(), id, ...d })]);
  await ins('a', { origem: 'DESPESA_FIXA', fornecedor_nome: 'Luz', descricao: 'Energia', valor_original: 300, valor_final: 300, valor_brl: 300, data_vencimento: '2026-01-31', natureza_custo: 'FIXO' });
  await ins('b', { origem: 'OUTROS', fornecedor_nome: 'Google', descricao: 'Anúncios', valor_original: 100, valor_final: 540, valor_brl: 540, moeda: 'USD', cambio: 5.4, data_vencimento: '2026-01-10', natureza_custo: 'VARIAVEL', is_custo_comercial: true, status: 'PAGO', valor_pago: 540 });
  await ins('c', { origem: 'OUTROS', fornecedor_nome: 'Loja', descricao: 'Cadeira', valor_original: 900, valor_final: 900, data_vencimento: '2026-01-12', natureza_custo: 'COMPRA_UNICA' });
  await ins('d', { origem: 'VENDA', auto_gerado: true, fornecedor_nome: 'Hotel', descricao: 'Custo', valor_original: 50, valor_final: 50, data_vencimento: '2026-01-12' });
  await ins('e', { origem: 'OUTROS', fornecedor_nome: 'X', descricao: 'Cancelada', valor_original: 50, valor_final: 50, data_vencimento: '2026-01-12', status: 'CANCELADO' });
  await ins('f', { origem: 'OUTROS', fornecedor_nome: 'Série', descricao: 'Da série', valor_original: 50, valor_final: 50, data_vencimento: '2026-01-12', serie_id: 's9', serie_ordem: 1 });
  await ins('g', { origem: 'OUTROS', fornecedor_nome: 'Outro mês', descricao: 'Fev', valor_original: 50, valor_final: 50, data_vencimento: '2026-02-12' });
  const copiar = (modo = 'gravar') => tx(e => S.copiarMesNoExecutor(e, 'tc', { tabela: 'contas_pagar', mes_origem: '2026-01', mes_destino: '2026-02', previa: modo === 'previa' }, HOJE));
  const pv = await copiar('previa');
  eq([pv.quantidade, pv.soma, pv.ja_copiadas], [2, 840, 0], 'prévia: 2 contas (fixa e variável), R$ 840');
  const r1 = await copiar();
  eq([r1.copiadas, r1.ja_copiadas], [2, 0], 'copia 2');
  const copias = (await query(`SELECT data FROM contas_pagar WHERE tenant_id = 'tc' AND data->>'copia_chave' IS NOT NULL ORDER BY data->>'descricao'`)).rows.map(r => r.data);
  const rec = c => [c.descricao, c.fornecedor_nome, c.data_vencimento, c.valor_original, c.valor_final, c.valor_brl, c.moeda, c.cambio, c.status, c.valor_pago, c.natureza_custo, c.is_custo_comercial, c.observacoes];
  eq(copias.map(rec), [
    ['Anúncios', 'Google', '2026-02-10', 100, 540, 540, 'USD', 5.4, 'PENDENTE', null, 'VARIAVEL', true, 'Copiado de Jan/2026'],
    ['Energia', 'Luz', '2026-02-28', 300, 300, 300, 'BRL', 1, 'PENDENTE', null, 'FIXO', false, 'Copiado de Jan/2026'],
  ], 'mesmos campos da cópia antiga: dia 31 vira 28/02, nasce em aberto, "Copiado de Jan/2026"');
  const r2 = await copiar();
  eq([r2.copiadas, r2.ja_copiadas, r2.quantidade], [0, 2, 0], 'segunda vez: nada copiado (chave copia:<mês>:<título>)');
  eq(Number((await query(`SELECT COUNT(*)::int AS n FROM contas_pagar WHERE tenant_id = 'tc'`)).rows[0].n), 9, 'total de contas: 7 + 2 cópias');
  eq((await erro(tx(e => S.copiarMesNoExecutor(e, 'tc', { tabela: 'contas_pagar', mes_origem: '2026-01', mes_destino: '2026-01' }, HOJE))))?.msg, 'O mês de destino precisa ser outro.', 'mesmo mês recusado');
}

// ---------------------------------------------------------------------------
console.log('--- 10. Validação na entrada ---');
{
  const ruim = await erro(Promise.resolve().then(() => S.prepararSerie({ tabela: 'contas_pagar', tipo: 'parcelado', inicio: '2026-11-10', valor: 100,
    regra: { frequencia: 'MES', intervalo: 1, fim: { tipo: 'nunca' } }, modelo: { descricao: 'x' } })));
  eq(ruim?.msg, 'No parcelado, informe em quantas parcelas o valor é dividido.', 'parcelado sem quantidade');
  const semValor = await erro(Promise.resolve().then(() => S.prepararSerie({ tabela: 'contas_pagar', tipo: 'recorrente', inicio: '2026-11-10', valor: 0,
    regra: { frequencia: 'MES', intervalo: 1, fim: { tipo: 'ocorrencias', ocorrencias: 2 } }, modelo: { descricao: 'x' } })));
  eq(semValor?.msg, 'O valor precisa ser maior que zero.', 'valor zero');
  const tabela = await erro(Promise.resolve().then(() => S.prepararSerie({ tabela: 'usuarios' })));
  eq(tabela?.msg, 'Diga se é conta a pagar ou a receber.', 'tabela fora da lista é recusada');
  const modelo = S.prepararSerie({ tabela: 'contas_pagar', tipo: 'recorrente', inicio: '2026-11-10', valor: 5,
    regra: { frequencia: 'MES', intervalo: 1, fim: { tipo: 'ocorrencias', ocorrencias: 2 } },
    modelo: { descricao: 'x', status: 'PAGO', valor_pago: 5, auto_gerado: true, tenant_id: 'outro' } }).modelo;
  eq([modelo.status, modelo.valor_pago, modelo.auto_gerado, modelo.tenant_id], [undefined, undefined, undefined, undefined], 'modelo não carrega situação, baixa nem marca de sistema');
}

// ---------------------------------------------------------------------------
console.log('--- 11. "Resetar dados" leva as séries junto com as contas ---');
{
  const { CATEGORIES, apagarCategorias } = await import('../src/lib/reset-da-conta.ts');
  for (const t of CATEGORIES.financeiro) {
    await pg.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb)`);
  }
  await criar({ id: 'serie-outra', tabela: 'contas_pagar', tipo: 'recorrente', inicio: '2026-12-01', valor: 10,
    regra: { frequencia: 'MES', intervalo: 1, feriado: 'manter', fim: { tipo: 'nunca' } }, modelo: { ...MODELO_PAGAR } }, HOJE, 'outra');
  const series = async t => Number((await query(`SELECT COUNT(*)::int AS n FROM recorrencias WHERE tenant_id = $1`, [t])).rows[0].n);
  const antes = await series(T);
  const r = await tx(e => apagarCategorias(e, T, 'agencia', ['financeiro']));
  eq([antes > 0, r.summary.recorrencias, await series(T), await series('outra')], [true, antes, 0, 1], 'as séries da agência saem; as de outra agência ficam');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
