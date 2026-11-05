/**
 * FinTable congelada (05/11/2026). A tabela ganhou seleção, colunas
 * escolhidas, ordem no servidor, duplo clique e menu por linha, todos
 * OPCIONAIS. Quem já usa a tabela sem essas propriedades precisa ver
 * exatamente o mesmo HTML de antes.
 *
 * O HTML de antes foi gravado (com `--gravar`) a partir da FinTable ANTES
 * da mudança, em scripts/fixtures/fintable-antes.json. Este teste desenha os
 * mesmos casos com a FinTable de agora e compara caractere a caractere.
 * Também confere que as propriedades novas fazem o que dizem.
 *
 * Uso: node --no-warnings scripts/test-fintable.mjs [--gravar]
 */
import { register } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.__POOL_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
// Fora do bundler, os subcaminhos do pacote next (next/link...) precisam do .js.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, n) {
    if (/^next\\/(link|navigation|image)$/.test(s)) return n(s + '.js', c);
    return n(s, c);
  }`));

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { FinTable } = await import('../src/components/fin/FinTable.tsx');

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FOTO = path.join(AQUI, 'fixtures', 'fintable-antes.json');

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const h = React.createElement;
const linhas = [
  { id: 'a', nome: 'Hotel Beira Mar', valor: 1250.5, venc: '2026-11-10', status: 'PENDENTE' },
  { id: 'b', nome: 'Operadora X', valor: -80, venc: '2026-10-01', status: 'PAGO' },
  { id: 'c', nome: 'Ana', valor: 0, venc: null, status: 'PARCIAL' },
];
const colunas = [
  { id: 'nome', cabecalho: 'Pessoa', tipo: 'texto', sortable: true, minWidth: 160, render: r => r.nome, acessor: r => r.nome },
  { id: 'venc', cabecalho: 'Vencimento', tipo: 'data', sortable: true, prioridade: 2, valor: r => r.venc },
  { id: 'status', cabecalho: 'Situação', tipo: 'status', dominio: 'pagar', valor: r => r.status },
  { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: r => r.valor, sub: r => (r.valor < 0 ? 'estorno' : null), tone: r => (r.valor < 0 ? 'negativo' : 'neutro') },
  { id: 'acoes', cabecalho: '', tipo: 'acoes', render: r => h('button', { type: 'button' }, `Abrir ${r.id}`) },
];
const vazio = { motivo: 'sem-resultado', titulo: 'Nada aqui', oQueE: 'Explicação.', acao: { rotulo: 'Limpar', onClick: () => {} } };
const erro = { mensagem: 'Caiu', onTentarDeNovo: () => {} };

const CASOS = {
  ok_completo: { linhas, colunas, chave: r => r.id, estado: 'ok', vazio, totais: [{ colunaId: 'valor', valor: 1170.5, rotulo: 'Total das contas listadas' }] },
  ok_total_na_primeira: { linhas, colunas, chave: r => r.id, estado: 'ok', vazio, totais: [{ colunaId: 'nome', valor: 3, rotulo: 'Soma' }] },
  ok_compacta_com_clique: { linhas, colunas, chave: r => r.id, estado: 'ok', vazio, densidade: 'compacta', onLinhaClick: () => {} },
  carregando: { linhas: [], colunas, chave: r => r.id, estado: 'carregando', vazio },
  erro: { linhas: [], colunas, chave: r => r.id, estado: 'erro', erro, vazio },
  erro_sem_mensagem: { linhas: [], colunas, chave: r => r.id, estado: 'erro', vazio },
  vazio: { linhas: [], colunas, chave: r => r.id, estado: 'ok', vazio },
};

const desenhar = props => renderToStaticMarkup(h(FinTable, props));

if (process.argv.includes('--gravar')) {
  const foto = Object.fromEntries(Object.entries(CASOS).map(([k, p]) => [k, desenhar(p)]));
  mkdirSync(path.dirname(FOTO), { recursive: true });
  writeFileSync(FOTO, JSON.stringify(foto, null, 2) + '\n');
  console.log(`Foto gravada em ${FOTO}`);
  process.exit(0);
}

console.log('--- 1. Sem as propriedades novas: o mesmo HTML de antes ---');
const foto = JSON.parse(readFileSync(FOTO, 'utf8'));
for (const [k, p] of Object.entries(CASOS)) eq(desenhar(p) === foto[k], true, `caso "${k}" igual ao de antes`);

console.log('--- 2. Propriedades novas ---');
const comSelecao = desenhar({
  ...CASOS.ok_completo,
  selecao: { selecionadas: new Set(['b']), onAlterar: () => {}, rotulo: r => `Selecionar ${r.nome}` },
});
eq((comSelecao.match(/type="checkbox"/g) ?? []).length, 4, 'seleção: uma caixa por linha e uma no cabeçalho');
eq(/aria-label="Selecionar Operadora X"[^>]*checked=""/.test(comSelecao) || /checked=""[^>]*aria-label="Selecionar Operadora X"/.test(comSelecao), true, 'a linha selecionada vem marcada');
eq(/aria-selected="true"/.test(comSelecao), true, 'a linha marcada diz que está selecionada');

const soAlgumas = desenhar({ ...CASOS.ok_completo, colunasVisiveis: ['valor', 'nome'] });
eq([soAlgumas.includes('Vencimento'), soAlgumas.includes('Situação'), soAlgumas.indexOf('Pessoa') < soAlgumas.indexOf('Valor')], [false, false, true],
  'colunas escolhidas: só as visíveis, na ordem das colunas');

const ordemServidor = desenhar({ ...CASOS.ok_completo, ordemControlada: { colunaId: 'valor', direcao: 'desc', onOrdenar: () => {} } });
eq(/aria-sort="descending"/.test(ordemServidor), true, 'ordem no servidor: o cabeçalho mostra a ordem que veio de fora');
const nomes = [...ordemServidor.matchAll(/(Hotel Beira Mar|Operadora X|Ana)<\/td>/g)].map(m => m[1]);
eq(nomes, ['Hotel Beira Mar', 'Operadora X', 'Ana'], 'ordem no servidor: as linhas ficam na ordem em que chegaram');

const comMenu = desenhar({ ...CASOS.ok_completo, onLinhaDuploClique: () => {}, onLinhaMenu: () => {} });
eq((comMenu.match(/<tr[^>]*tabindex="0"/g) ?? []).length, 3, 'duplo clique e menu: a linha recebe foco pelo teclado');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
