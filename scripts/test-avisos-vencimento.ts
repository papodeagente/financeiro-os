/**
 * Aviso de vencimento no sino (src/lib/avisos-vencimento.ts), 05/11/2026.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-avisos-vencimento.ts
 */
import {
  AVISOS_PADRAO, algumAvisoLigado, montarAvisos, normalizarAvisos, saldoEmAberto, type ContaEmAberto,
} from '../src/lib/avisos-vencimento.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- Preferência ---');
eq(AVISOS_PADRAO, { pagar_hoje: true, pagar_amanha: false, receber_atrasadas: false }, 'padrão: só contas a pagar que vencem hoje');
eq(normalizarAvisos(null), AVISOS_PADRAO, 'sem preferência gravada: o padrão');
eq(normalizarAvisos({ pagar_hoje: false, receber_atrasadas: true, lixo: 1 }), { pagar_hoje: false, pagar_amanha: false, receber_atrasadas: true }, 'grava só o que conhece');
eq(algumAvisoLigado({ pagar_hoje: false, pagar_amanha: false, receber_atrasadas: false }), false, 'tudo desligado');

console.log('--- Saldo em aberto ---');
eq(saldoEmAberto({ status: 'PENDENTE', valor_final: 100 }, 'contas_pagar'), 100, 'pendente: o valor todo');
eq(saldoEmAberto({ status: 'PARCIAL', valor_final: 100, valor_pago: 30 }, 'contas_pagar'), 70, 'parcial: o que falta');
eq(saldoEmAberto({ status: 'PAGO', valor_final: 100 }, 'contas_pagar'), 0, 'paga: nada');
eq(saldoEmAberto({ status: 'CANCELADO', valor_final: 100 }, 'contas_receber'), 0, 'cancelada: nada');
eq(saldoEmAberto({ status: 'PENDENTE', valor_final: 0, valor_brl: 550 }, 'contas_pagar'), 550, 'moeda estrangeira: pelo valor em reais');

console.log('--- Avisos do dia ---');
const HOJE = '2026-11-05';
const c = (tabela: ContaEmAberto['tabela'], id: string, vencimento: string, saldo: number, descricao = `Conta ${id}`, pessoa = ''): ContaEmAberto =>
  ({ tabela, id, descricao, pessoa, vencimento, saldo });
const contas = [
  c('contas_pagar', 'p1', HOJE, 2500, 'Aluguel', 'Imobiliária Sol'),
  c('contas_pagar', 'p2', HOJE, 99.9, 'Internet', 'Vivo'),
  c('contas_pagar', 'p3', HOJE, 0, 'Já paga'),
  c('contas_pagar', 'p4', '2026-11-06', 1200, 'Hotel', 'Operadora X'),
  c('contas_pagar', 'p5', '2026-11-04', 300, 'Atrasada'),
  c('contas_receber', 'r1', '2026-10-01', 1000, 'Pacote Maceió', 'Ana'),
  c('contas_receber', 'r2', '2026-11-04', 250, 'Seguro', 'Bruno'),
  c('contas_receber', 'r3', HOJE, 400, 'Vence hoje'),
];
const so = montarAvisos(contas, HOJE, AVISOS_PADRAO);
eq(so.map(a => [a.tipo, a.titulo]), [['CONTAS_A_PAGAR_VENCENDO', '2 contas a pagar vencem hoje']], 'padrão: um aviso, com as contas do dia que têm saldo');
eq(so[0].descricao, 'R$ 2.599,90 no total. Aluguel (Imobiliária Sol) e Internet (Vivo).', 'total e as contas por extenso');
eq([so[0].link, so[0].chave], ['/financeiro-ag/pagar', 'aviso-vencimento:pagar-hoje:2026-11-05'], 'leva à lista; chave do dia');

const tudo = montarAvisos(contas, HOJE, { pagar_hoje: true, pagar_amanha: true, receber_atrasadas: true });
eq(tudo.map(a => a.titulo), ['2 contas a pagar vencem hoje', '1 conta a pagar vence amanhã', '2 contas a receber em atraso'], 'os três avisos ligados');
eq(tudo[1].link, '/financeiro-ag/pagar?abrir=p4', 'uma conta só: abre a própria conta');
eq(tudo[2].descricao, 'R$ 1.250,00 a receber. A mais antiga venceu há 35 dias. Pacote Maceió (Ana) e Seguro (Bruno).', 'atraso: total, a mais antiga e as contas');
eq(tudo[2].link, '/financeiro-ag/receber?status=ATRASADO', 'leva às contas a receber em atraso');
eq(new Set(tudo.map(a => a.chave)).size, 3, 'cada assunto tem a sua chave do dia');

const muitas = Array.from({ length: 5 }, (_, i) => c('contas_pagar', `m${i}`, HOJE, 100 - i, `Conta ${i + 1}`));
eq(montarAvisos(muitas, HOJE, AVISOS_PADRAO)[0].descricao, 'R$ 490,00 no total. Conta 1, Conta 2, Conta 3 e mais 2.', 'muitas contas: as três maiores e quantas faltam');
eq(montarAvisos([], HOJE, { pagar_hoje: true, pagar_amanha: true, receber_atrasadas: true }), [], 'nada vencendo: nenhum aviso');
eq(montarAvisos(contas, HOJE, { pagar_hoje: false, pagar_amanha: false, receber_atrasadas: false }), [], 'tudo desligado: nenhum aviso');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
