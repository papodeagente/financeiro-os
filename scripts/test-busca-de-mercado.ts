/**
 * Busca ⌘K por termos de mercado (src/lib/busca-de-mercado.ts), 05/11/2026.
 *
 * Confere: cada termo comum leva à tela certa, a frase aparece quando aqui o
 * processo é diferente, todo destino existe de verdade e nenhum termo usa
 * nome ou frase exclusiva de outro sistema (lista do contrato da E2).
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-busca-de-mercado.ts
 */
import { existsSync } from 'node:fs';
import { DESTINOS_DE_MERCADO, buscarPorTermoDeMercado, normalizarBusca } from '../src/lib/busca-de-mercado.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
const primeiro = (q: string) => buscarPorTermoDeMercado(q)[0]?.destino;

console.log('--- Quem vem de outro sistema acha a tela ---');
const casos: Array<[string, string]> = [
  ['retorno do banco', '/financeiro-ag/recebimentos'],
  ['remessa', '/financeiro-ag/receber'],
  ['baixar boleto', '/financeiro-ag/receber'],
  ['retenção', '/financeiro-ag/notas'],
  ['retencao', '/financeiro-ag/notas'],
  ['câmbio', '/financeiro-ag/pagar'],
  ['cambio', '/financeiro-ag/pagar'],
  ['conferir depósito', '/financeiro-ag/conciliacao'],
  ['fechar caixa', '/financeiro-ag/fechamento'],
  ['extrato', '/financeiro-ag/extrato'],
  ['contas a pagar', '/financeiro-ag/pagar'],
  ['contas a receber', '/financeiro-ag/receber'],
  ['liquidar', '/financeiro-ag/pagar'],
  ['centro de custo', '/financeiro-ag/centros-custo'],
  ['rateio', '/financeiro-ag/centros-custo'],
  ['movimentações', '/financeiro-ag/movimentacoes'],
  ['plano de contas', '/financeiro-ag/plano-contas'],
  ['pix', '/financeiro-ag/formas-pagamento'],
  ['DRE', '/financeiro-ag/dre'],
  ['inadimplência', '/financeiro-ag/receber?status=ATRASADO'],
  ['juros', '/config/financeiro'],
  ['  Fluxo   de  Caixa ', '/financeiro-ag/fluxo-caixa'],
  ['onde fica o retorno do banco', '/financeiro-ag/recebimentos'],
];
for (const [q, href] of casos) eq(primeiro(q)?.href, href, `"${q.trim()}" → ${href}`);
eq(buscarPorTermoDeMercado('liquidar').map(r => r.destino.id).slice(0, 2), ['liquidar-pagar', 'liquidar-receber'], '"liquidar" mostra pagar e receber');
eq(primeiro('baixar boleto')?.frase, 'Aqui o pagamento do boleto baixa sozinho; acompanhe em Contas a receber.', 'frase quando aqui é diferente');
eq(primeiro('extrato')?.frase, undefined, 'tela igual: sem frase');
eq(buscarPorTermoDeMercado('ex'), [], 'menos de 3 letras: nada');
eq(buscarPorTermoDeMercado('xyzxyz'), [], 'nada casa: nada');
eq(buscarPorTermoDeMercado('conta', 3).length, 3, 'respeita o limite');

console.log('--- Todo destino existe ---');
for (const d of DESTINOS_DE_MERCADO) {
  const rota = d.href.split('?')[0].replace(/^\//, '');
  eq(existsSync(new URL(`../src/app/${rota}/page.tsx`, import.meta.url)), true, `${d.id}: ${rota} existe`);
}
eq(new Set(DESTINOS_DE_MERCADO.map(d => d.id)).size, DESTINOS_DE_MERCADO.length, 'ids únicos');

console.log('--- Só termos de mercado ---');
// Nomes e frases exclusivos de outro sistema (docs/programa/e2-contratos.md, regra 3).
const PROIBIDOS = [
  'lei kandir', 'cartao passagem', 'fornecimento', 'representacao', 'consulta global de log', 'resumo geral',
  'grupos de usuario', 'grupo de usuario', 'acesso total', 'taxa de servico oculta', 'taxa de servico destacada',
  'saldo excluido', 'gerar lancamento', 'parcelas adicionais', 'demonstrativo por categorias', 'lancamentos por',
  'processar retorno', 'gerar remessa', 'atualizar cambios', 'ignorar bloqueios',
];
const textos = DESTINOS_DE_MERCADO.flatMap(d => [...d.termos, d.tela, d.frase ?? '']).map(normalizarBusca);
for (const p of PROIBIDOS) eq(textos.filter(t => t.includes(p)), [], `nenhum termo ou frase com "${p}"`);

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
