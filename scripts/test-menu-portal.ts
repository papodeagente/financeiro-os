/**
 * Porteiro do menu em portal: quem vive no portal conta como "dentro".
 *
 * Um menu renderizado com createPortal mora no <body>, fora da árvore do
 * gatilho. Se o fecha-ao-clicar-fora olha só para o gatilho, clicar num item
 * do menu é "clicar fora": o menu fecha no mousedown, o React desmonta o
 * <Link> e o clique termina no vazio. O item não navega e não dá erro — ele
 * simplesmente não funciona.
 *
 * Foi o que aconteceu com o menu da conta ("Meu perfil", "Configurações",
 * "Suporte") na modernização da TopBar: o ref do painel existia no código
 * antigo e se perdeu na reescrita. Daí este teste: todo ref pendurado dentro
 * de um createPortal, num arquivo que escuta mousedown/pointerdown no
 * documento, precisa aparecer num teste de .contains().
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-menu-portal.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

const RAIZ = new URL('../src', import.meta.url).pathname;
function arquivos(dir: string, fora: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, fora);
    else if (nome.endsWith('.tsx')) fora.push(p);
  }
  return fora;
}

const ESCUTA_DOCUMENTO = /addEventListener\(\s*['"](?:mousedown|pointerdown)['"]/;

/** O trecho do argumento do createPortal: do `createPortal(` até o `, document.body`. */
function trechosDoPortal(src: string): string[] {
  const fora: string[] = [];
  for (const m of src.matchAll(/createPortal\(/g)) {
    const fim = src.indexOf('document.body', m.index!);
    fora.push(src.slice(m.index!, fim === -1 ? m.index! + 4000 : fim));
  }
  return fora;
}

/** Refs pendurados dentro do portal — os que o fecha-ao-clicar-fora precisa conhecer. */
export function refsDoPortal(src: string): string[] {
  const nomes = new Set<string>();
  for (const trecho of trechosDoPortal(src)) {
    for (const r of trecho.matchAll(/\sref=\{([A-Za-z_$][\w$]*)\}/g)) nomes.add(r[1]);
  }
  return [...nomes].sort();
}

export function refsProtegidos(src: string): string[] {
  return [...new Set([...src.matchAll(/([A-Za-z_$][\w$]*)\.current\??\.contains\(/g)].map(m => m[1]))].sort();
}

const desprotegidos: string[] = [];
let comPortalEEscuta = 0;
for (const p of arquivos(RAIZ)) {
  const src = readFileSync(p, 'utf8');
  if (!src.includes('createPortal') || !ESCUTA_DOCUMENTO.test(src)) continue;
  comPortalEEscuta++;
  const protegidos = new Set(refsProtegidos(src));
  for (const ref of refsDoPortal(src)) {
    if (!protegidos.has(ref)) desprotegidos.push(`${relative(RAIZ, p)}: ref={${ref}} nunca passa por .contains()`);
  }
}

eq(desprotegidos, [], 'todo ref dentro de um createPortal é testado por .contains() no fecha-ao-clicar-fora');
// Sem este piso, apagar os portais faria o teste "passar" sem olhar nada.
eq(comPortalEEscuta >= 2, true, 'o porteiro encontrou os arquivos que juntam portal e escuta no documento');

// O próprio porteiro precisa enxergar o defeito que proíbe.
const DOENTE = `
  const gatilho = useRef(null); const painel = useRef(null);
  useEffect(() => {
    const fechar = (e) => { if (gatilho.current && !gatilho.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fechar);
  }, []);
  return createPortal(<div ref={painel}><Link href="/perfil">Meu perfil</Link></div>, document.body);
`;
const SADIO = DOENTE.replace('if (gatilho.current', 'if (painel.current?.contains(e.target)) return;\n      if (gatilho.current');
eq([refsDoPortal(DOENTE), refsProtegidos(DOENTE).includes('painel')], [['painel'], false], 'reconhece o menu em portal sem guarda');
eq(refsProtegidos(SADIO).includes('painel'), true, 'e aceita o mesmo menu depois da guarda');
// O ref do gatilho vive fora do portal: não é ele que a regra cobra.
eq(refsDoPortal(DOENTE).includes('gatilho'), false, 'o ref do gatilho fica fora da conta: ele nunca está no portal');

console.log(`\n${total - falhas}/${total} testes do menu em portal passaram`);
if (falhas > 0) process.exit(1);
