/**
 * Registro de atividades (05/11/2026): o filtro "Pessoa" novo em
 * buildAuditFilter, e os filtros antigos exatamente como eram.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-consulta-global-log.ts
 */
import { AuditFilterError, buildAuditFilter } from '../src/lib/audit-query.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
function erro(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof AuditFilterError ? e.message : `outro: ${String(e)}`; }
}
const f = (q: string) => buildAuditFilter(new URLSearchParams(q), 't1');

console.log('--- Porteiro: filtros antigos iguais ---');
const antigo = f('modulo=Financeiro&acao=EDITAR&usuario=u1&origem=USUARIO&inicio=2026-11-01T03:00:00.000Z&fim=2026-11-05T02:59:59.999Z&q=50%_x&page=2&pageSize=20');
eq(antigo.values, ['t1', 'Financeiro', 'EDITAR', 'u1', 'USUARIO', '2026-11-01T03:00:00.000Z', '2026-11-05T02:59:59.999Z', '%50\\%\\_x%'], 'valores na mesma ordem de sempre');
eq(antigo.where.split(' AND ').slice(0, 7), [
  'tenant_id = $1', 'modulo = $2', 'acao = $3', 'usuario_id = $4', "COALESCE(data->>'origem', 'SISTEMA') = $5",
  'created_at >= $6', 'created_at <= $7',
], 'cláusulas iguais');
eq([antigo.page, antigo.pageSize], [2, 20], 'paginação igual');
eq(f('').where, 'tenant_id = $1', 'sem filtro: só a agência');
eq(f('pessoa=').where, 'tenant_id = $1', 'pessoa vazia não filtra');
eq(f('pessoa=%20%20').where, 'tenant_id = $1', 'pessoa só com espaço não filtra');

console.log('--- Pessoa ---');
const p = f('pessoa=  Maria_100%  ');
eq(p.values, ['t1', '%Maria\\_100\\%%'], 'valor aparado e escapado (% e _ literais)');
eq(p.where, "tenant_id = $1 AND concat_ws(' ', data->>'entidade_nome', data->>'descricao') ILIKE $2", 'cláusula sobre o nome do registro e a descrição');
const junto = f('modulo=Financeiro&q=baixa&pessoa=Joao');
eq(junto.values, ['t1', 'Financeiro', '%baixa%', '%Joao%'], 'convive com módulo e busca');
eq(junto.where.endsWith('ILIKE $4'), true, 'pessoa é o último parâmetro');
eq(erro(() => f(`pessoa=${'a'.repeat(201)}`)), 'O nome da pessoa deve ter até 200 caracteres.', 'mais de 200 caracteres é recusado');
eq(erro(() => f(`pessoa=${'a'.repeat(200)}`)), null, '200 caracteres passam');
eq(f("pessoa=x' OR 1=1 --").values[1], "%x' OR 1=1 --%", 'texto nunca vira SQL: vai como parâmetro');

console.log(`\n${total - falhas}/${total} testes do registro de atividades passaram`);
if (falhas) process.exit(1);
