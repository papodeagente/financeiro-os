/**
 * Menu lateral, ⌘K e sino por versão e módulo (14/11/2026).
 *
 * A agência simples (sem módulos) vê EXATAMENTE o que via na versão simples
 * (origin/main a9fd7cf): mesmo menu, na mesma ordem e com os mesmos nomes
 * ("Auditoria", não "Registro de atividades"), a mesma busca do ⌘K e os
 * mesmos tipos de aviso. O que era da versão simples está congelado em
 * scripts/menu-da-versao-simples.json. Cada módulo acrescenta só o dele.
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-modulos-menu.ts
 */
import { readFileSync } from 'node:fs';
import { PILLAR_MENUS } from '../src/components/menu-dos-pilares.ts';
import { NAVIGATION_ITEMS, CREATE_ITEMS, CRM_ITEMS, visiveis, resultadosDaBusca, recentesDaConta, textoDaCaixa } from '../src/components/itens-da-busca.ts';
import { menuDaConta, itemLiberado, type ContextoDoMenu } from '../src/lib/menu-por-modulo.ts';
import { MODULOS, SEM_MODULOS, MODULO_DO_AVISO, avisoLiberado, moduloDaTela, modulosDosDados, type ModuloId } from '../src/lib/modulos.ts';
import { TIPOS_NOTIFICACAO } from '../src/lib/notificacoes-config.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

interface Congelado {
  menu: Record<string, { title: string; items: { key: string; label: string; href: string }[] }[]>;
  paleta: Record<'navegacao' | 'criar' | 'crm', { id: string; label: string; href: string; section: string }[]>;
  placeholder: string;
  avisos: string[];
}
const SIMPLES_JSON = JSON.parse(readFileSync(new URL('./menu-da-versao-simples.json', import.meta.url), 'utf8')) as Congelado;

const simples: ContextoDoMenu = { modulos: SEM_MODULOS, ecossistema: false };
const simplesEco: ContextoDoMenu = { modulos: SEM_MODULOS, ecossistema: true };
const completa: ContextoDoMenu = { modulos: modulosDosDados({ fin_versao: 'completa' }), ecossistema: false };
const so = (...ids: ModuloId[]): ContextoDoMenu => ({ modulos: modulosDosDados({ modulos: Object.fromEntries(ids.map(i => [i, true])) }), ecossistema: false });

const PILARES = ['planejamento', 'metas', 'financeiro', 'configuracoes'] as const;
const enxuto = (ctx: ContextoDoMenu, pilar: typeof PILARES[number]) =>
  menuDaConta(PILLAR_MENUS[pilar], ctx).map(s => ({ title: s.title, items: s.items.map(i => ({ key: i.key, label: i.label, href: i.href })) }));
const chaves = (ctx: ContextoDoMenu, pilar: typeof PILARES[number]) => menuDaConta(PILLAR_MENUS[pilar], ctx).flatMap(s => s.items.map(i => i.key));

console.log('--- menu lateral da agência simples = o da versão simples ---');
for (const p of PILARES) {
  eq(enxuto(simples, p), SIMPLES_JSON.menu[p], `pilar ${p}: mesmas seções, itens, ordem e nomes da versão simples`);
  eq(enxuto(simplesEco, p), SIMPLES_JSON.menu[p], `pilar ${p}: igual também na conta do ecossistema (Comissão por MRR é de módulo)`);
}
eq(enxuto(simples, 'configuracoes').flatMap(s => s.items).find(i => i.key === 'cfg-auditoria')?.label, 'Auditoria', 'na simples é "Auditoria"');
eq(enxuto(completa, 'configuracoes').flatMap(s => s.items).find(i => i.key === 'cfg-auditoria')?.label, 'Registro de atividades', 'com o núcleo completo é "Registro de atividades"');

console.log('--- cada módulo acrescenta só o dele ---');
const tudo = (p: typeof PILARES[number]) => PILLAR_MENUS[p].flatMap(s => s.items.filter(i => !i.soEcossistema).map(i => i.key));
for (const p of PILARES) eq(chaves(completa, p), tudo(p), `versão completa: pilar ${p} inteiro (menos o que é só do ecossistema)`);
eq(chaves({ ...completa, ecossistema: true }, 'metas').includes('comissao-mrr'), true, 'Comissão por MRR: versão completa na conta do ecossistema');
const nucleo = so('nucleo');
eq(chaves(nucleo, 'financeiro').filter(k => !SIMPLES_JSON.menu.financeiro.flatMap(s => s.items.map(i => i.key)).includes(k)),
  ['contas', 'extrato', 'movimentacoes', 'fechamento', 'aprovacoes', 'centros-custo', 'formas-pagamento'], 'só o núcleo: os itens do núcleo no Financeiro');
eq(chaves(so('nucleo', 'cobranca'), 'financeiro').includes('cobrancas') && !chaves(so('nucleo', 'cobranca'), 'financeiro').includes('faturas'), true,
  'núcleo + cobrança: Cobranças aparece, Faturas (venda) não');
eq(chaves(so('cobranca'), 'financeiro'), chaves(simples, 'financeiro'), 'cobrança sem o núcleo não vale (dependência): menu da simples');
eq(menuDaConta(PILLAR_MENUS.financeiro, nucleo).some(s => s.title === 'Fornecedores'), false, 'seção sem item visível some (Fornecedores sem a venda completa)');

console.log('--- o módulo do item bate com o da tela ---');
const itensDoMenu = PILARES.flatMap(p => PILLAR_MENUS[p].flatMap(s => s.items));
// O item pode pedir um módulo que depende do da tela (Gerar boletos: cobrança, na tela de Contas do núcleo).
const dependeDe = (a: ModuloId | undefined, b: ModuloId) => a === b || Boolean(a && (MODULOS.find(m => m.id === a)?.depende as readonly string[]).includes(b));
const divergentes = [...itensDoMenu, ...NAVIGATION_ITEMS, ...CREATE_ITEMS, ...CRM_ITEMS]
  .filter(i => { const t = moduloDaTela(i.href); return t && !dependeDe(i.modulo, t); })
  .map(i => `${'key' in i ? i.key : i.id} → ${i.href}: item=${i.modulo ?? '-'} tela=${moduloDaTela(i.href)}`);
eq(divergentes, [], 'item que leva a tela de módulo declara o módulo da tela (ou um que depende dele)');
const ids = new Set(MODULOS.map(m => m.id));
eq([...itensDoMenu, ...NAVIGATION_ITEMS].every(i => !i.modulo || ids.has(i.modulo)), true, 'todo módulo citado existe');

console.log('--- ⌘K da agência simples = o da versão simples ---');
const enxutoK = (l: { id: string; label: string; href: string; section: string }[]) => l.map(i => ({ id: i.id, label: i.label, href: i.href, section: i.section }));
eq(enxutoK(visiveis(NAVIGATION_ITEMS, simples)), SIMPLES_JSON.paleta.navegacao, 'navegação: mesmos itens, ordem e nomes');
eq(enxutoK(visiveis(CREATE_ITEMS, simples)), SIMPLES_JSON.paleta.criar, 'criar: igual');
eq(enxutoK(visiveis(CRM_ITEMS, simples)), SIMPLES_JSON.paleta.crm, 'integração: igual');
eq(textoDaCaixa(simples), SIMPLES_JSON.placeholder, 'texto da caixa de busca igual');

/** A busca da versão simples, como era (CommandPalette de origin/main). */
function buscaDaSimples(query: string) {
  const { criar, navegacao, crm } = SIMPLES_JSON.paleta;
  if (!query.trim()) return [...criar, ...crm].map(i => i.id);
  const q = query.toLowerCase();
  return [...criar, ...navegacao, ...crm].filter(i => i.label.toLowerCase().includes(q)).map(i => i.id);
}
const CONSULTAS = ['', '   ', 'contas', 'Contas a', 'conciliação', 'conciliacao', 'nota', 'relat', 'x', 'DRE', 'fechar caixa',
  'retorno do banco', 'Perguntar ao financeiro', 'cobrança', 'comiss', 'mudar para o enturos', 'extrato', 'auditoria', 'registro', 'a'];
for (const q of CONSULTAS) eq(resultadosDaBusca(q, [], simples).map(i => i.id), buscaDaSimples(q), `busca "${q}" igual à da versão simples`);
eq(recentesDaConta(['/financeiro-ag/contas', '/financeiro-ag/dre', '/mudanca', '/financeiro-ag/cobrancas'], simples).map(i => i.id), ['dre'],
  'recentes: só as telas que a agência simples abre');

console.log('--- ⌘K com módulos ---');
const comp = resultadosDaBusca('fechar caixa', [], completa);
eq(comp.length > 0 && comp.every(i => itemLiberado(i, completa)), true, 'completa: nomes de mercado aparecem e todos abrem');
const soNucleo = resultadosDaBusca('nota fiscal de serviço emitida no sistema anterior', [], nucleo);
eq(soNucleo.some(i => i.section === 'glossario'), false, 'sem o módulo de mudança, o glossário da mudança não aparece');
eq(soNucleo.some(i => i.id === 'perguntar-texto'), false, 'sem a IA, nada de "Perguntar: ..."');
eq(resultadosDaBusca('quanto paguei de tarifa', [], so('nucleo', 'ia')).some(i => i.id === 'perguntar-texto'), true, 'com a IA, a pergunta em texto aparece');
eq(resultadosDaBusca('cobran', [], nucleo).some(i => i.href.startsWith('/financeiro-ag/cobrancas')), false, 'núcleo sem cobrança: nenhum atalho para Cobranças');
eq(resultadosDaBusca('cobran', [], so('nucleo', 'cobranca')).some(i => i.id === 'cobrancas'), true, 'com a cobrança: o atalho aparece');

console.log('--- sino ---');
eq(TIPOS_NOTIFICACAO.map(t => t.tipo).filter(t => avisoLiberado(SEM_MODULOS, t)), SIMPLES_JSON.avisos, 'agência simples: os tipos de aviso da versão simples, na mesma ordem');
eq(Object.keys(MODULO_DO_AVISO).filter(t => !TIPOS_NOTIFICACAO.some(x => x.tipo === t)), [], 'todo aviso de módulo existe no catálogo de avisos');
eq(TIPOS_NOTIFICACAO.map(t => t.tipo).filter(t => !SIMPLES_JSON.avisos.includes(t) && !MODULO_DO_AVISO[t]), [], 'todo aviso novo da completa declara o módulo');
eq(avisoLiberado(so('nucleo').modulos, 'APROVACAO_PEDIDA') && !avisoLiberado(so('nucleo').modulos, 'COBRANCA_PENDENCIA'), true, 'núcleo: aprovações sim, pendência de cobrança não');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
