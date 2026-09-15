import { CONSULTAS_INTERNAS } from '@/lib/dashboard-financeiro';
import { listarLancamentos, RECORTES } from '@/lib/dashboard-detalhe';

const sqls: string[] = [];
const exec = { async query(text: string, values?: unknown[]) { sqls.push(text + '\n   -- params: ' + JSON.stringify(values)); return { rows: [] as any[] }; } };

const C = CONSULTAS_INTERNAS as any;
await C.movimentoDeCaixa(exec, 'T', '2026-09-01', '2026-09-30');
await C.saldoEmCaixa(exec, 'T');
await C.posicao(exec, 'contas_receber', 'receber', 'T', '2026-09-15');
await C.aging(exec, 'contas_pagar', 'pagar', 'T', '2026-09-15');
await C.serieMensal(exec, 'T', '2026-09-01', '2026-09-30');
await C.projecao(exec, 'T', '2026-09-15', 0);
await C.receitaPorOrigem(exec, 'T', '2026-09-01', '2026-09-30');
await C.despesaPorCategoria(exec, 'T', '2026-09-01', '2026-09-30');
await C.fornecedores(exec, 'T', '2026-09-01', '2026-09-30');
await C.margemPorFornecedor(exec, 'T', '2026-09-01', '2026-09-30');
await C.clientes(exec, 'T', '2026-09-01', '2026-09-30');
await C.agenda(exec, 'T', '2026-09-15', '2026-10-15');
await C.descasamento(exec, 'T');
await C.vendasDoPeriodo(exec, 'T', '2026-09-01', '2026-09-30');
await C.atencao(exec, 'T');
for (const r of RECORTES) for (const lado of ['receber','pagar'] as const) {
  await listarLancamentos(exec as any, { tenantId:'T', lado, recorte:r, de:'2026-09-01', ate:'2026-09-30', hoje:'2026-09-15', referencia:'X' });
}
console.log(sqls.join('\n\n────────────────────────────\n\n'));
