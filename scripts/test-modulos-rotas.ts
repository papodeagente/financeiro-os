/**
 * Versão completa por agência (14/11/2026): nenhuma rota ou tela da versão
 * completa fica sem a guarda do módulo, e nenhuma da versão simples cai
 * num prefixo de módulo.
 *
 * Lê o código (não sobe o Next) e confere contra o catálogo de
 * src/lib/modulos.ts e a lista congelada da versão simples
 * (scripts/rotas-da-versao-simples.json, origin/main a9fd7cf):
 *
 *   (a) rota e tela da versão simples: fora de qualquer prefixo de módulo;
 *   (b) rota e tela que não é da simples: num prefixo de módulo ou com
 *       motivo em ROTAS_SEM_MODULO (rota nova obriga a decidir);
 *   (c) cada handler exportado de rota de módulo começa pela guarda do
 *       módulo CERTO (recusaModulo; na pública, recusaModuloDaAgencia);
 *   (d) cada tela de módulo tem o layout da pasta do prefixo chamando
 *       exigirModuloNaTela com o módulo certo;
 *   (e) todo prefixo do catálogo existe no código (nada de prefixo morto).
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-modulos-rotas.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  APIS_DOS_MODULOS, TELAS_DOS_MODULOS, ROTAS_SEM_MODULO, casaComPrefixo, rotaDaApi, rotaDaTela, MODULOS,
} from '../src/lib/modulos.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

const APP = new URL('../src/app', import.meta.url).pathname;
const SIMPLES = JSON.parse(readFileSync(new URL('./rotas-da-versao-simples.json', import.meta.url), 'utf8')) as { api: string[]; telas: string[] };

function arquivos(dir: string, nome: string, fora: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) arquivos(p, nome, fora);
    else if (n === nome) fora.push(p);
  }
  return fora;
}
/** 'api/x/[id]/route.ts' → '/api/x/[id]' (grupos entre parênteses não entram no endereço). */
const caminhoDe = (arquivo: string) =>
  '/' + relative(APP, arquivo).split(sep).slice(0, -1).filter(s => !(s.startsWith('(') && s.endsWith(')'))).join('/');
const relDe = (arquivo: string) => relative(APP, arquivo).split(sep).join('/');
const semModulo = (c: string) => ROTAS_SEM_MODULO.find(x => casaComPrefixo(x.prefixo, c));

const rotas = arquivos(join(APP, 'api'), 'route.ts');
const telas = arquivos(APP, 'page.tsx');
const simplesApi = new Set(SIMPLES.api);
const simplesTelas = new Set(SIMPLES.telas);

console.log('--- (a) a versão simples fica fora dos módulos ---');
const simplesNoModulo = [
  ...SIMPLES.api.filter(f => rotaDaApi('/' + f.split('/').slice(0, -1).join('/'))).map(f => `${f} → ${rotaDaApi('/' + f.split('/').slice(0, -1).join('/'))?.modulo}`),
  ...SIMPLES.telas.filter(f => rotaDaTela('/' + f.split('/').slice(0, -1).join('/'))).map(f => `${f} → ${rotaDaTela('/' + f.split('/').slice(0, -1).join('/'))?.modulo}`),
];
eq(simplesNoModulo, [], 'nenhuma rota nem tela da versão simples cai num prefixo de módulo');
eq(SIMPLES.api.length > 200 && SIMPLES.telas.length > 90, true, 'a lista congelada da versão simples está inteira');

console.log('--- (b) o que veio com a completa tem módulo ou motivo ---');
const soltasApi = rotas.filter(f => !simplesApi.has(relDe(f)) && !rotaDaApi(caminhoDe(f)) && !semModulo(caminhoDe(f))).map(relDe);
eq(soltasApi, [], 'toda rota fora da versão simples está num módulo ou em ROTAS_SEM_MODULO');
const soltasTelas = telas.filter(f => !simplesTelas.has(relDe(f)) && !rotaDaTela(caminhoDe(f)) && !semModulo(caminhoDe(f))).map(relDe);
eq(soltasTelas, [], 'toda tela fora da versão simples está num módulo ou em ROTAS_SEM_MODULO');
eq(ROTAS_SEM_MODULO.every(x => x.motivo.length > 20), true, 'cada exceção diz o motivo');

console.log('--- (c) a guarda em cada handler das rotas de módulo ---');
const HANDLER = /^export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm;
const semGuarda: string[] = [];
const guardaErrada: string[] = [];
let handlersDeModulo = 0;
for (const f of rotas) {
  const rota = rotaDaApi(caminhoDe(f));
  if (!rota) continue;
  const src = readFileSync(f, 'utf8');
  const inicios = [...src.matchAll(HANDLER)].map(m => ({ nome: m[1], i: m.index ?? 0 }));
  if (inicios.length === 0) semGuarda.push(`${relDe(f)}: nenhum handler reconhecido`);
  inicios.forEach((h, k) => {
    handlersDeModulo++;
    const corpo = src.slice(h.i, k + 1 < inicios.length ? inicios[k + 1].i : src.length);
    // As primeiras linhas do handler: a guarda vem antes de qualquer trabalho.
    const comeco = corpo.split('\n').slice(0, 12).join('\n');
    const guarda = rota.publica
      ? new RegExp(`recusaModuloDaAgencia\\([^;]*'${rota.modulo}'`)
      : new RegExp(`recusaModulo\\('${rota.modulo}'\\)`);
    const alvo = rota.publica ? corpo : comeco; // a pública confere depois de achar o dono do token
    if (!guarda.test(alvo)) semGuarda.push(`${relDe(f)} ${h.nome} (${rota.modulo})`);
  });
  for (const m of src.matchAll(/recusaModulo(?:DaAgencia)?\([^)]*?'([a-z_]+)'/g)) {
    if (m[1] !== rota.modulo) guardaErrada.push(`${relDe(f)}: guarda de '${m[1]}', a rota é de '${rota.modulo}'`);
  }
}
eq(semGuarda, [], 'todo handler de rota de módulo chama a guarda do módulo no começo');
eq(guardaErrada, [], 'nenhuma rota confere o módulo errado');
eq(handlersDeModulo > 250, true, `as ${handlersDeModulo} rotas (handlers) de módulo foram conferidas`);
// A guarda nunca aparece numa rota da versão simples (nada muda para ela).
const guardaNaSimples = rotas.filter(f => simplesApi.has(relDe(f)) && /recusaModulo(DaAgencia)?\(/.test(readFileSync(f, 'utf8'))).map(relDe);
eq(guardaNaSimples, [], 'nenhuma rota da versão simples ganhou guarda de módulo');

console.log('--- (d) o layout de cada tela de módulo ---');
const semLayout: string[] = [];
for (const f of telas) {
  const tela = rotaDaTela(caminhoDe(f));
  if (!tela || tela.publica) continue;
  const layout = join(APP, ...tela.prefixo.split('/').filter(Boolean), 'layout.tsx');
  const ok = existsSync(layout) && new RegExp(`exigirModuloNaTela\\('${tela.modulo}'\\)`).test(readFileSync(layout, 'utf8'));
  if (!ok) semLayout.push(`${relDe(f)} → ${relative(APP, layout)} (${tela.modulo})`);
}
eq(semLayout, [], 'toda tela de módulo passa por um layout que confere o módulo certo');
const layoutsErrados: string[] = [];
for (const f of arquivos(APP, 'layout.tsx')) {
  for (const m of readFileSync(f, 'utf8').matchAll(/exigirModuloNaTela\('([a-z_]+)'\)/g)) {
    const tela = rotaDaTela(caminhoDe(f));
    if (!tela || tela.modulo !== m[1] || tela.prefixo.split('/').filter(Boolean).length !== caminhoDe(f).split('/').filter(Boolean).length) {
      layoutsErrados.push(`${relDe(f)} confere '${m[1]}', o catálogo diz '${tela?.modulo ?? 'nenhum'}' em ${tela?.prefixo ?? '-'}`);
    }
  }
}
eq(layoutsErrados, [], 'cada layout de módulo fica exatamente na pasta de um prefixo do catálogo, com o módulo dele');
// Telas públicas são cascas: a rota de API delas é pública e do mesmo módulo.
const publicas = TELAS_DOS_MODULOS.filter(t => t.publica).map(t => t.prefixo);
eq(publicas, ['/c/[token]', '/r/[token]'], 'as telas públicas são o portal do cliente e o link de leitura');
eq(APIS_DOS_MODULOS.filter(a => a.publica).map(a => [a.prefixo, a.modulo]), [['/api/portal', 'cobranca'], ['/api/leitura', 'relatorios']],
  'e as rotas que elas leem conferem a agência dona do token');

console.log('--- (e) o catálogo não tem prefixo morto nem repetido ---');
const mortosApi = APIS_DOS_MODULOS.filter(a => !rotas.some(f => casaComPrefixo(a.prefixo, caminhoDe(f)))).map(a => a.prefixo);
const mortasTelas = TELAS_DOS_MODULOS.filter(t => !telas.some(f => casaComPrefixo(t.prefixo, caminhoDe(f)))).map(t => t.prefixo);
eq([mortosApi, mortasTelas], [[], []], 'cada prefixo do catálogo tem rota ou tela de verdade');
const repetidos = [...APIS_DOS_MODULOS, ...TELAS_DOS_MODULOS].map(x => x.prefixo).filter((p, i, a) => a.indexOf(p) !== i);
eq(repetidos, [], 'nenhum prefixo aparece duas vezes (um prefixo, um módulo)');
const ids = new Set(MODULOS.map(m => m.id));
eq([...APIS_DOS_MODULOS, ...TELAS_DOS_MODULOS].every(x => ids.has(x.modulo)), true, 'todo prefixo aponta para um módulo do catálogo');

console.log('--- exemplos ---');
eq(rotaDaApi('/api/cobrancas/abc/enviar')?.modulo, 'cobranca', '/api/cobrancas/<id>/enviar é da cobrança');
eq(rotaDaApi('/api/contas-pagar/abc'), null, '/api/contas-pagar/<id> vale para todas');
eq(rotaDaApi('/api/contas-pagar/abc/restaurar')?.modulo, 'nucleo', 'restaurar conta excluída é do núcleo');
eq(rotaDaApi('/api/fiscal/notas'), null, 'notas fiscais da versão simples valem para todas');
eq(rotaDaTela('/vendas/lancar/voucher')?.modulo, 'ia', 'o voucher é da IA (o mais específico vence)');
eq(rotaDaTela('/vendas/lancar')?.modulo, 'venda', 'lançar venda é da venda completa');
eq(rotaDaTela('/financeiro-ag/notas'), null, 'a lista de notas vale para todas');
eq(rotaDaTela('/financeiro-ag/notas/regras?x=1')?.modulo, 'notas', 'regras da nota, com consulta no endereço');
eq(rotaDaTela('/financeiro-ag/contas-bancarias'), null, 'contas bancárias não é "contas" (segmento inteiro)');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
