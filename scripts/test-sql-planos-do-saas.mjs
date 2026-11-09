/**
 * Planos Básico, Controle e Escala (src/lib/planos-do-saas.ts) contra um
 * Postgres real (PGlite). Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (a) instalação nova nasce com os três planos novos, na ordem, com o
 *       Controle em destaque;
 *   (b) o banco de hoje (Basic, Founder, Founder Pro, já com um item a mais
 *       que alguém pôs pelo /admin/planos) vira Básico, Controle e Escala,
 *       sem mudar slug, preço, ordem, ativo nem os limites que já existiam;
 *   (c) nota fiscal a partir do Controle: o Básico não lista nota e marca
 *       nota_fiscal false; Controle e Escala listam e marcam true;
 *   (d) rodar de novo não muda nada (initDB roda a cada boot), e um plano
 *       editado depois em /admin/planos com outro nome ou preço não é
 *       sobrescrito;
 *   (e) a rota pública /api/planos devolve os nomes novos na ordem.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-planos-do-saas.mjs
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

const TABELA = `
  CREATE TABLE planos (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, nome TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    preco_mensal NUMERIC(10, 2) NOT NULL DEFAULT 0, preco_anual NUMERIC(10, 2) NOT NULL DEFAULT 0, moeda TEXT NOT NULL DEFAULT 'BRL',
    destaque BOOLEAN NOT NULL DEFAULT FALSE, ordem INTEGER NOT NULL DEFAULT 0, ativo BOOLEAN NOT NULL DEFAULT TRUE,
    limites JSONB NOT NULL DEFAULT '{}'::jsonb, features JSONB NOT NULL DEFAULT '[]'::jsonb, data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;

const executor = pg => async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};

// O banco que a rota pública lê é o do caso (b): o pool do teste aponta para ele.
const hoje = new PGlite();
await hoje.exec(TABELA);
const queryHoje = executor(hoje);
globalThis.__POOL_DE_TESTE__ = { query: queryHoje, connect: async () => ({ query: queryHoje, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { semearPlanos, PLANOS_DO_SAAS } = await import('../src/lib/planos-do-saas.ts');
const ler = async q => (await q(`SELECT id, slug, nome, descricao, preco_mensal::float AS mensal, preco_anual::float AS anual, destaque, ordem, ativo, limites, features FROM planos ORDER BY ordem`)).rows;

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (a) instalação nova ---');
const nova = new PGlite();
await nova.exec(TABELA);
const queryNova = executor(nova);
await semearPlanos({ query: queryNova });
const novos = await ler(queryNova);
eq(novos.map(p => [p.slug, p.nome, p.ordem, p.destaque]), [['basic', 'Básico', 1, false], ['founder', 'Controle', 2, true], ['founder-pro', 'Escala', 3, false]],
  'nasce com Básico, Controle (em destaque) e Escala, na ordem');
eq(novos.map(p => p.mensal), [97, 197, 397], 'com os preços de hoje');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) o banco de hoje ---');
// Como está em produção em 09/11/2026 (lido de /api/planos): o seed antigo,
// com um item a mais no Founder Pro.
await queryHoje(`INSERT INTO planos (id, slug, nome, descricao, preco_mensal, preco_anual, destaque, ordem, ativo, limites, features) VALUES
  ('plano-basic', 'basic', 'Basic', 'Para agências que estão começando.', 97, 970, FALSE, 1, TRUE,
    '{"grupos": 10, "usuarios": 3, "ai_enabled": false, "white_label": false, "propostas_mes": 50}', '["Até 3 usuários", "50 propostas/mês", "Hub de viagens", "Templates prontos", "Suporte por email"]'),
  ('plano-founder', 'founder', 'Founder', 'Para agências em crescimento que precisam de mais ferramentas.', 197, 1970, TRUE, 2, TRUE,
    '{"grupos": 50, "usuarios": 10, "ai_enabled": true, "white_label": false, "propostas_mes": 200}', '["Até 10 usuários", "CRM completo"]'),
  ('plano-founder-pro', 'founder-pro', 'Founder Pro', 'Para agências consolidadas.', 397, 3970, FALSE, 3, TRUE,
    '{"grupos": -1, "usuarios": -1, "ai_enabled": true, "white_label": true, "propostas_mes": -1}', '["Usuários ilimitados", "Domínio personalizado nas propostas"]')`);
await semearPlanos({ query: queryHoje });
const trocados = await ler(queryHoje);
eq(trocados.map(p => [p.id, p.slug, p.nome]), [['plano-basic', 'basic', 'Básico'], ['plano-founder', 'founder', 'Controle'], ['plano-founder-pro', 'founder-pro', 'Escala']],
  'Basic, Founder e Founder Pro viram Básico, Controle e Escala, com o mesmo id e slug');
eq(trocados.map(p => [p.mensal, p.anual, p.ordem, p.destaque, p.ativo]), [[97, 970, 1, false, true], [197, 1970, 2, true, true], [397, 3970, 3, false, true]],
  'preço, ordem, destaque e ativo ficam como estavam');
eq(trocados.map(p => p.features), PLANOS_DO_SAAS.map(p => p.features), 'os itens antigos (CRM, propostas, hotéis) dão lugar aos novos');
eq(trocados.flatMap(p => p.features).filter(f => /CRM completo|propostas\/mês|Hub de viagens|Domínio personalizado/.test(f)), [], 'nenhum item do produto antigo sobra');
eq(trocados.map(p => [p.limites.usuarios, p.limites.grupos, p.limites.propostas_mes]), [[3, 10, 50], [10, 50, 200], [-1, -1, -1]],
  'os limites que já existiam ficam (o cadastro copia o de usuários para a conta nova)');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) nota fiscal a partir do Controle ---');
const temNota = p => p.features.some(f => /nota fiscal/i.test(f));
eq(trocados.map(p => [p.nome, temNota(p), p.limites.nota_fiscal]), [['Básico', false, false], ['Controle', true, true], ['Escala', false, true]],
  'o Básico não lista nem marca nota; o Controle lista e marca; o Escala marca (lista via "Tudo do Controle")');
eq(trocados[2].features[1], 'Tudo do Controle', 'o Escala diz que inclui o Controle');
eq(trocados[1].features[1], 'Tudo do Básico', 'o Controle diz que inclui o Básico');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) rodar de novo e edição posterior ---');
await semearPlanos({ query: queryHoje });
eq(await ler(queryHoje), trocados, 'rodar de novo não muda nada');
await queryHoje(`UPDATE planos SET nome = 'Controle Plus', preco_mensal = 247, features = '["Item do admin"]' WHERE slug = 'founder'`);
await queryHoje(`UPDATE planos SET preco_mensal = 117 WHERE slug = 'basic'`);
await semearPlanos({ query: queryHoje });
const editados = await ler(queryHoje);
eq([editados[1].nome, editados[1].mensal, editados[1].features], ['Controle Plus', 247, ['Item do admin']], 'plano renomeado no /admin/planos não é sobrescrito');
eq(editados[0].mensal, 117, 'preço editado no /admin/planos fica');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) a rota pública ---');
await queryHoje(`UPDATE planos SET nome = 'Controle', preco_mensal = 197, features = $1::jsonb WHERE slug = 'founder'`, [JSON.stringify(PLANOS_DO_SAAS[1].features)]);
const { GET } = await import('../src/app/api/planos/route.ts');
const lista = await (await GET()).json();
eq(lista.map(p => p.nome), ['Básico', 'Controle', 'Escala'], '/api/planos devolve Básico, Controle e Escala, nessa ordem');

console.log(`\n${total - falhas}/${total} testes dos planos passaram`);
if (falhas > 0) process.exit(1);
