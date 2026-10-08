/**
 * Porteiro do Design System: cor só por token.
 *
 * Em 05/10/2026 o sistema tinha 3.205 classes de cor crua do Tailwind
 * (bg-blue-500, text-gray-600...) e 612 hex espalhados em 217 arquivos, ao
 * lado de uma camada de tokens que já existia. A modernização trocou tudo
 * por --fin-*. Este teste impede a volta: cor nova entra como token, e a
 * exceção (conteúdo do usuário, documento da proposta, landing) é uma lista
 * explícita, não um esquecimento.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-design-system.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** O Tailwind varre o projeto inteiro, não só src/: estes também viram CSS. */
function testesEDocs(): string[] {
  const fora: string[] = [];
  for (const dir of ['../scripts/', '../docs/']) {
    const base = new URL(dir, import.meta.url).pathname;
    let nomes: string[] = [];
    try { nomes = readdirSync(base); } catch { continue; }
    for (const n of nomes) {
      if (n.endsWith('.ts') || n.endsWith('.mjs') || n.endsWith('.md')) fora.push(join(base, n));
    }
  }
  return fora;
}

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

/** Conteúdo que NÃO é interface: as cores ali são do usuário, do modelo ou da marca. */
const EXCECOES = [
  'components/landing/',            // landing pública, identidade própria
  'components/propostas/preview/',  // documento da proposta (cores do modelo)
  'components/propostas/blocks/',   // blocos do documento dentro do editor
  'components/propostas/PdfExportModal.tsx',
  'app/p/',                         // proposta pública
  'app/preview-iframe/',
  'app/mapas-mentais/',             // mapa público
  'app/planejamento/mapas-mentais/[id]/MapaMentalEditor.tsx',
  'app/planejamento/fluxogramas/[id]/',
  'components/funis/FunilNode.tsx',
  'components/funis/BibliotecaNodes.tsx', // miniatura de janela: os três pontos coloridos são ilustração
  'components/icons/',
  'components/Logo.tsx',
];

const CORES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PALETA = new RegExp(`(?<![\\w\\-\\[/])(?:[a-z\\-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|outline|from|via|to|fill|stroke|divide|placeholder|decoration|accent|caret)-(?:${CORES})-\\d{2,3}(?:/\\d{1,3})?(?![\\w\\-\\[])`, 'g');
const HEX_EM_CLASSE = /(?<![\w&])[a-z\-]+-\[#[0-9a-fA-F]{3,8}\]/g;

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...arquivos(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const raiz = new URL('../src/', import.meta.url).pathname;
const violacoes: string[] = [];
const hexes: string[] = [];
let verificados = 0;
for (const p of arquivos(raiz)) {
  const rel = relative(raiz, p);
  if (EXCECOES.some(e => rel === e || rel.startsWith(e))) continue;
  verificados++;
  const fonte = readFileSync(p, 'utf8');
  for (const m of fonte.matchAll(PALETA)) violacoes.push(`${rel}: ${m[0]}`);
  for (const m of fonte.matchAll(HEX_EM_CLASSE)) hexes.push(`${rel}: ${m[0]}`);
}

eq(verificados > 200, true, `varre as telas de verdade (${verificados} arquivos fora das exceções)`);
eq(violacoes.slice(0, 10), [], 'nenhuma classe de cor crua do Tailwind fora das exceções: use --fin-*');
eq(hexes.slice(0, 10), [], 'nenhum hex dentro de classe fora das exceções: use --fin-*');

// Texto sobre preenchimento de destaque: só --fin-text-on-fill. Branco fixo
// some no tema escuro (o azul clareia) e o texto escuro do acento dourado
// antigo ficava ilegível sobre o azul.
const FILL = /(?<![\w:\[-])bg-\[var\(--(?:t-green|t-accent|t-primary|t-blue|lg-accent|fin-accent|fin-positive|fin-negative|fin-violet|fin-info)\)\](?!\/)/;
const TEXTO_FIXO = /(?<![\w:\[-])text-(?:white|\[var\(--(?:t-text|fin-text|lg-text)\)\])(?![\w\-\[])/;
const LIT = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const textoFixoNoPreenchimento: string[] = [];
for (const p of arquivos(raiz)) {
  const rel = relative(raiz, p);
  if (EXCECOES.some(e => rel === e || rel.startsWith(e))) continue;
  for (const m of readFileSync(p, 'utf8').matchAll(LIT)) {
    if (FILL.test(m[0]) && TEXTO_FIXO.test(m[0])) textoFixoNoPreenchimento.push(`${rel}: ${m[0].slice(0, 90)}`);
  }
}
eq(textoFixoNoPreenchimento.slice(0, 5), [], 'texto sobre preenchimento de destaque usa --fin-text-on-fill');
eq([FILL.test('"bg-[var(--fin-accent)] text-white"') && TEXTO_FIXO.test('"bg-[var(--fin-accent)] text-white"'), TEXTO_FIXO.test('"text-[var(--fin-text-on-fill)]"'), FILL.test('"bg-[var(--fin-accent)]/10"')], [true, false, false], 'e reconhece o defeito sem confundir o par certo nem o fundo translúcido');

// O próprio porteiro precisa enxergar o que proíbe.
eq(['bg-blue-500', 'hover:text-gray-600', 'border-red-500/30', 'dark:bg-slate-900'].map(c => (c.match(PALETA) ?? []).length), [1, 1, 1, 1], 'o porteiro reconhece cor crua, com variante e com alfa');
eq(['bg-[var(--fin-accent)]', 'text-[var(--fin-text-2)]', 'bg-black/40', 'text-white'].map(c => (c.match(PALETA) ?? []).length), [0, 0, 0, 0], 'e não confunde token, véu e branco com cor crua');

// Camada única: os dialetos antigos só apontam para --fin-*.
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
const dialetoComValor = [...css.matchAll(/^\s*--(t|lg|ink)-[a-z0-9-]+:\s*(#[0-9a-fA-F]{3,8}|rgba?\()/gm)].map(m => m[0].trim());
eq(dialetoComValor, [], 'os dialetos --t-*, --lg-* e --ink-* não declaram cor: são apelidos de --fin-*');

// Escala de raio do Tailwind presa aos três níveis: controle 8, cartão 14.
eq(['--radius-md: var(--fin-r-md)', '--radius-lg: var(--fin-r-md)', '--radius-xl: var(--fin-r-lg)', '--radius-2xl: var(--fin-r-lg)'].every(t => css.includes(t)), true, 'rounded-lg é raio de controle e rounded-xl/2xl é raio de cartão');

for (const v of ['--fin-violet', '--fin-e-card', '--fin-z-modal', '--fin-z-popover', '--fin-h-padrao', '--fin-dur-base']) {
  eq(css.includes(`${v}:`), true, `token ${v} declarado`);
}

// Toda janela abre no CENTRO (pedido do Bruno, 08/10/2026). A gaveta lateral
// sobre a tela (véu de ponta a ponta com o painel encostado num lado) não
// volta: formulário e detalhe usam RecordSheet ou Dialog, que são centrais.
// Menu de navegação no celular não é janela e não entra nesta regra.
const GAVETA = /fixed inset-0[^"'`]*\bjustify-(?:end|start)\b/;
const gavetas: string[] = [];
for (const p of arquivos(raiz)) {
  const rel = relative(raiz, p);
  const fonte = readFileSync(p, 'utf8');
  for (const linha of fonte.split('\n')) if (GAVETA.test(linha)) gavetas.push(`${rel}: ${linha.trim().slice(0, 90)}`);
}
eq(gavetas, [], 'nenhuma janela abre encostada num lado: popup é no centro');
eq(existsSync(new URL('../src/components/ui/sheet.tsx', import.meta.url)), false, 'a gaveta lateral (ui/sheet) não existe mais');
eq([GAVETA.test('className="fixed inset-0 z-50 flex justify-end"'), GAVETA.test('className="fixed inset-0 z-50 flex items-center justify-center p-4"')], [true, false], 'o porteiro reconhece a gaveta e deixa passar a janela central');

// `text-[var(--text-body-sm)]` NÃO é tamanho de fonte: o Tailwind não sabe o
// que há dentro do var() e gera `color: var(--text-body-sm)`, uma "cor" de
// 14px. Ela anula a cor de verdade (botão verde com texto escuro, 08/10/2026)
// e o tamanho nunca é aplicado. Tamanho por variável se escreve com o tipo:
// text-[length:var(--text-body-sm)].
const TAMANHO_SEM_TIPO = /text-\[var\(--(?:text|fin-fs)-[a-z0-9-]+\)\]/g;
const tamanhosSemTipo: string[] = [];
for (const p of arquivos(raiz)) {
  for (const m of readFileSync(p, 'utf8').matchAll(TAMANHO_SEM_TIPO)) tamanhosSemTipo.push(`${relative(raiz, p)}: ${m[0]}`);
}
eq(tamanhosSemTipo.slice(0, 5), [], 'tamanho de fonte por variável declara o tipo: text-[length:var(--text-NOME)]');

// O Tailwind v4 varre TODO arquivo do projeto, inclusive os testes e a
// documentação, e transforma em CSS qualquer coisa com cara de classe. Um
// `*` dentro de var() — escrito como curinga, para o humano ler — sai como
// `font-size: var(--text-*)`: regra inválida que o navegador recusa e que,
// em desenvolvimento, derruba a página com erro na globals.css (08/10/2026).
// Curinga se escreve com NOME, nunca com `*`.
const CURINGA_EM_VAR = /-\[(?:[a-z]+:)?var\(--[a-z0-9-]*\*/gi;
const curingas: string[] = [];
for (const arq of [...arquivos(raiz), ...testesEDocs()]) {
  for (const m of readFileSync(arq, 'utf8').matchAll(CURINGA_EM_VAR)) {
    curingas.push(`${arq.split('/').slice(-2).join('/')}: ${m[0]}`);
  }
}
eq(curingas, [], 'nenhum curinga `*` dentro de var() num valor entre colchetes: o Tailwind geraria CSS inválido');
// O exemplo do defeito é montado por PEDAÇOS de propósito: escrito inteiro,
// o varredor do Tailwind o leria como classe de verdade e geraria a mesma
// regra inválida que este teste proíbe — foi assim que o rótulo acima virou
// CSS quebrado.
const CURINGA = '*)]';
eq(
  [`text-[length:var(--text-${CURINGA}`, `bg-[var(--fin-${CURINGA}`].map(c => (c.match(CURINGA_EM_VAR) ?? []).length),
  [1, 1],
  'e o porteiro reconhece o curinga que proíbe',
);
eq(
  ['text-[length:var(--text-body-sm)]', 'bg-[var(--fin-accent)]', 'w-[var(--fin-page-max)]'].map(c => (c.match(CURINGA_EM_VAR) ?? []).length),
  [0, 0, 0],
  'sem confundir valor de verdade com curinga',
);

console.log(`\n${total - falhas}/${total} testes do design system passaram`);
if (falhas > 0) process.exit(1);
