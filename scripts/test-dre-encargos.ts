/**
 * Encargos da liquidação no DRE (05/11/2026).
 *
 * PORTEIRO: scripts/fixture-dre-encargos-congelado.json é a saída do DRE
 * ANTES desta mudança (competência e caixa, dois meses, com os lançamentos
 * de cada linha). Sem baixa com encargo, o DRE tem de dar exatamente aquilo.
 *
 * Depois: juros, multa, desconto e taxa da liquidação saem da linha de
 * origem da conta e aparecem em linhas próprias, sem contar duas vezes.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-dre-encargos.ts
 */
import { readFileSync } from 'node:fs';
import { comissaoNaoCapturadaPorConta, montarDRE, type LinhaDRE } from '../src/lib/resultado-dre.ts';
import {
  ajusteDoValor, classificarEncargos, codigoLivre, encargosPorTitulo, rotulosDasCategorias,
  type EncargosDoTitulo,
} from '../src/lib/encargos-categorias.ts';
import { plano, receber, pagar, vendas } from './fixture-dre-encargos.ts';
import type { ContaPagar, ContaReceber, VendaCRM } from '../src/lib/crm-types.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

type Regime = 'competencia' | 'caixa';
const v = vendas as unknown as Parameters<typeof montarDRE>[0]['vendasComLastro'];
function dre(rc: ContaReceber[], pg: ContaPagar[], mes: string, regime: Regime, encargos?: Map<string, EncargosDoTitulo>, rotulos?: ReturnType<typeof rotulosDasCategorias>) {
  return montarDRE({
    receber: rc, pagar: pg, vendasComLastro: v, planoContas: plano,
    comissaoNaoCapturada: comissaoNaoCapturadaPorConta(rc, v), mes, regime, encargos, rotulosEncargos: rotulos,
  });
}
const compacto = (ls: LinhaDRE[]) => ls.map(l => [l.codigo, l.nome, l.valor, l.tipo, l.indent, (l.lancamentos ?? []).map(x => [x.tabela, x.id, x.valor])]);
const linha = (ls: LinhaDRE[], nome: string) => ls.find(l => l.nome === nome)?.valor ?? null;

console.log('--- Congelado: sem baixa com encargo nada muda ---');
const congelado = JSON.parse(readFileSync(new URL('./fixture-dre-encargos-congelado.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const semEncargoNenhum = encargosPorTitulo([
  // Baixas sem encargo, baixa "anterior" (o histórico de antes) com juros,
  // baixa legada e baixa com juros que foi estornada: nenhuma conta.
  { titulo_tabela: 'contas_receber', titulo_id: 'r-fee', tipo: 'baixa', estornada: false, juros: 0, multa: 0, desconto: 0, taxa: 0 },
  { titulo_tabela: 'contas_receber', titulo_id: 'r-fee', tipo: 'anterior', estornada: false, juros: 15, multa: 0, desconto: 0, taxa: 0 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-tarifa', tipo: 'legada', estornada: false, juros: 0, multa: 5, desconto: 0, taxa: 0 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-alug', tipo: 'baixa', estornada: true, juros: 30, multa: 0, desconto: 0, taxa: 0 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-alug', tipo: 'estorno', estornada: false, juros: 30, multa: 0, desconto: 0, taxa: 0 },
]);
eq(semEncargoNenhum.size, 0, 'baixa sem encargo, "anterior", legada e estornada não contam');
for (const regime of ['competencia', 'caixa'] as const) {
  for (const mes of ['2026-10', '2026-11']) {
    const k = `${regime}:${mes}`;
    eq(compacto(dre(receber, pagar, mes, regime)), congelado[k], `${k}: sem encargos (ausente) = DRE de antes`);
    eq(compacto(dre(receber, pagar, mes, regime, new Map())), congelado[k], `${k}: mapa vazio = DRE de antes`);
    eq(compacto(dre(receber, pagar, mes, regime, semEncargoNenhum)), congelado[k], `${k}: baixas sem encargo válido = DRE de antes`);
    // Encargo de conta que não está no mês (nem existe) não mexe em nada.
    eq(compacto(dre(receber, pagar, mes, regime, new Map([['contas_receber:outra', { juros: 9, multa: 0, desconto: 0, taxa: 0 }]]))), congelado[k],
      `${k}: encargo de outra conta não mexe neste DRE`);
  }
}

console.log('--- Regra pura ---');
eq(classificarEncargos('contas_receber', { juros: 8, multa: 4, desconto: 3, taxa: 5 }),
  { receita_financeira: 12, despesa_financeira: 0, descontos_concedidos: 3, taxas: 5 }, 'receber: juros+multa receita, desconto concedido, taxa');
eq(classificarEncargos('contas_pagar', { juros: 20, multa: 5, desconto: 40, taxa: 9 }),
  { receita_financeira: 40, despesa_financeira: 25, descontos_concedidos: 0, taxas: 0 }, 'pagar: juros+multa despesa, desconto obtido é receita');
eq(ajusteDoValor({ juros: 8, multa: 4, desconto: 3, taxa: 5 }), 9, 'ajuste do valor = juros + multa − desconto (a taxa não entra no valor)');
eq(encargosPorTitulo([
  { titulo_tabela: 'contas_receber', titulo_id: 'a', tipo: 'baixa', estornada: false, juros: 1.1, multa: 0, desconto: 0, taxa: 0 },
  { titulo_tabela: 'contas_receber', titulo_id: 'a', tipo: 'baixa', estornada: false, juros: 2.2, multa: 0.5, desconto: 0, taxa: 0.3 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'a', tipo: 'baixa', estornada: false, juros: 0, multa: 0, desconto: 0, taxa: 7 },
]).get('contas_receber:a'), { juros: 3.3, multa: 0.5, desconto: 0, taxa: 0.3 }, 'soma por título, ao centavo; taxa de conta a pagar não conta');
eq(codigoLivre('2.4.05', ['2.4.05', '2.4.06']), '2.4.07', 'código ocupado: o próximo irmão livre');
eq(codigoLivre('1.6', []), '1.6', 'código livre: o padrão');
eq(rotulosDasCategorias({ taxas: 'x' }, [{ id: 'x', codigo: '2.3.03', nome: 'Taxa Adquirencia Cartao' }]).taxas,
  { codigo: '2.3.03', nome: 'Taxa Adquirencia Cartao' }, 'linha leva o nome da categoria escolhida');
eq(rotulosDasCategorias({ taxas: 'apagada' }, []).taxas, { codigo: '2.4.07', nome: 'Taxas de cobrança' }, 'categoria apagada: nome padrão');

console.log('--- Com encargos: cada um na sua linha, sem contar duas vezes ---');
// O mesmo cenário depois de liquidações com encargo:
//  r-out  (OUTROS 200) recebida com juros 8, multa 4 e taxa 5 → valor 212;
//  r-v2   (VENDA 4000) quitada com desconto de 100 → valor 3900;
//  p-alug (aluguel 2500) paga com juros de 25 → 2525;
//  p-cmv  (custo 400, em aberto) com desconto obtido de 40 → 360.
const rc2 = receber.map(c => {
  if (c.id === 'r-out') return { ...c, juros: 8, multa: 4, valor_final: 212, taxa: 5, status: 'RECEBIDO', valor_recebido: 212, data_recebimento: '2026-10-28' } as ContaReceber;
  if (c.id === 'r-v2') return { ...c, desconto: 100, valor_final: 3900, status: 'RECEBIDO', valor_recebido: 3900 } as ContaReceber;
  return c;
});
const pg2 = pagar.map(c => {
  if (c.id === 'p-alug') return { ...c, juros: 25, valor_final: 2525, valor_pago: 2525 } as ContaPagar;
  if (c.id === 'p-cmv') return { ...c, desconto: 40, valor_final: 360 } as ContaPagar;
  return c;
});
const encargos = encargosPorTitulo([
  { titulo_tabela: 'contas_receber', titulo_id: 'r-out', tipo: 'baixa', estornada: false, juros: 8, multa: 4, desconto: 0, taxa: 5 },
  { titulo_tabela: 'contas_receber', titulo_id: 'r-v2', tipo: 'baixa', estornada: false, juros: 0, multa: 0, desconto: 100, taxa: 0 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-alug', tipo: 'baixa', estornada: false, juros: 25, multa: 0, desconto: 0, taxa: 0 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-cmv', tipo: 'baixa', estornada: false, juros: 0, multa: 0, desconto: 40, taxa: 0 },
]);

const LUCRO = 'LUCRO LÍQUIDO';
for (const regime of ['competencia', 'caixa'] as const) {
  const sem = dre(rc2, pg2, '2026-10', regime);
  const com = dre(rc2, pg2, '2026-10', regime, encargos);
  const desp = com.find(l => l.nome === '(-) DESPESAS FINANCEIRAS')!;
  const itensDesp = com.slice(com.indexOf(desp) + 1).filter((l, i, arr) => l.tipo === 'item' && l.indent === 1 && arr.slice(0, i).every(x => x.tipo === 'item' && x.indent === 1));
  eq(Math.round(itensDesp.reduce((a, l) => a + l.valor, 0) * 100) / 100, -desp.valor, `${regime}: as linhas das despesas financeiras somam o cabeçalho`);
  eq(linha(com, 'Outras receitas'), 200, `${regime}: outras receitas sem os juros e a multa (que foram para receita financeira)`);
  eq(linha(com, 'Despesas operacionais (aluguel, salários, etc.)'), 2500, `${regime}: aluguel sem os juros`);
  eq(linha(com, 'Juros e multas pagos'), 25, `${regime}: juros pagos em linha própria`);
  eq(linha(com, 'Descontos concedidos'), 100, `${regime}: desconto dado ao cliente em linha própria`);
  eq(linha(com, 'Taxas de cobrança'), 5, `${regime}: taxa da liquidação em linha própria`);
  eq(linha(com, 'Taxas de plataformas de pagamento'), 120, `${regime}: a taxa de antes continua na linha da plataforma`);
  eq([linha(sem, 'Juros e multas pagos'), linha(sem, '(+) RECEITAS FINANCEIRAS')], [null, null], `${regime}: sem encargos informados, nenhuma linha nova`);
  const lanc = com.find(l => l.nome === 'Juros e multas pagos')!.lancamentos!.map(x => [x.tabela, x.id, x.valor]);
  eq(lanc, [['contas_pagar', 'p-alug', 25]], `${regime}: clicar no número mostra a conta que pagou os juros`);
}

const comC = dre(rc2, pg2, '2026-10', 'competencia', encargos);
const semC = dre(rc2, pg2, '2026-10', 'competencia');
eq(linha(comC, '(+) RECEITAS FINANCEIRAS'), 52, 'competência: receitas financeiras = juros e multa recebidos (12) + desconto obtido (40)');
eq(linha(comC, 'Custos diretos (CMV)'), 400, 'competência: custo sem o desconto obtido');
// Tudo o que só mudou de linha se anula; o que muda o lucro é o desconto da
// venda, que antes não aparecia (a margem vem da venda, não da conta).
eq(Math.round(((linha(comC, LUCRO) ?? 0) - (linha(semC, LUCRO) ?? 0)) * 100) / 100, -100, 'competência: lucro muda só pelo desconto da venda, antes invisível');

const comX = dre(rc2, pg2, '2026-10', 'caixa', encargos);
const semX = dre(rc2, pg2, '2026-10', 'caixa');
eq(linha(comX, '(+) RECEITAS FINANCEIRAS'), 12, 'caixa: desconto de conta ainda não paga não entra');
eq(linha(comX, 'Comissão sobre vendas'), 1150, 'caixa: a venda com desconto conta como paga inteira (o desconto aparece à parte)');
eq(linha(semX, 'Comissão sobre vendas'), 1140, '...antes o desconto encolhia a margem proporcional');
eq(Math.round(((linha(comX, LUCRO) ?? 0) - (linha(semX, LUCRO) ?? 0)) * 100) / 100, -90, 'caixa: diferença no lucro = desconto inteiro menos a margem que voltou');

console.log('--- Nome da categoria escolhida ---');
const rot = rotulosDasCategorias({ descontos_concedidos: 'k' }, [{ id: 'k', codigo: '2.3.09', nome: 'Abatimentos a clientes' }]);
const comNome = dre(rc2, pg2, '2026-10', 'competencia', encargos, rot);
eq(comNome.some(l => l.nome === 'Abatimentos a clientes' && l.codigo === '2.3.09' && l.valor === 100), true, 'a linha usa o nome e o código da categoria configurada');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
