/**
 * PORTEIRO da E5: a geração de contas da venda de HOJE (entrada v1) não muda.
 *
 * `scripts/fixture-venda-v1-congelada.json` é a saída de `gerarContasVenda`
 * gravada ANTES da E5 (05/11/2026) para as vendas de `fixture-venda-v1.ts`.
 * Este teste prova que:
 *   1. `gerarContasVenda` continua devolvendo exatamente aquilo;
 *   2. o sucessor `contasDaVenda`, com a mesma entrada v1, devolve o mesmo.
 *
 * Ids sorteados e a data de hoje são trocados por marcadores estáveis.
 * Regravar o congelado (só quando a mudança for de propósito):
 *   GRAVAR_CONGELADO=1 node --experimental-strip-types --no-warnings scripts/run-tests.mjs scripts/test-venda-v1-congelada.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gerarContasVenda } from '../src/lib/venda-financeiro.ts';
import { hojeISO } from '../src/lib/money.ts';
import { VENDAS_V1 } from './fixture-venda-v1.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else console.log(`PASS  ${label}`);
}

/** Dia em que o retrato (fixture) foi gravado. */
const DIA_DO_RETRATO = '2026-11-05';

/** Troca ids sorteados por #1, #2... na ordem em que aparecem, e hoje por <hoje>. */
function estavel(valor: unknown): unknown {
  const ids = new Map<string, string>();
  const hoje = hojeISO();
  const andar = (v: unknown, chave = ''): unknown => {
    if (Array.isArray(v)) return v.map(x => andar(x));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = andar(x, k);
      return o;
    }
    if (chave === 'id' && typeof v === 'string') {
      if (!ids.has(v)) ids.set(v, `#${ids.size + 1}`);
      return ids.get(v);
    }
    // O retrato foi tirado em 05/11/2026: as datas de entrada desse dia
    // também viram <hoje>, senão o teste mudaria de resultado com o calendário.
    if (v === hoje || v === DIA_DO_RETRATO) return '<hoje>';
    return v;
  };
  return andar(valor);
}

const ARQUIVO = new URL('./fixture-venda-v1-congelada.json', import.meta.url);
const atual: Record<string, unknown> = {};
for (const [nome, entrada] of Object.entries(VENDAS_V1)) atual[nome] = estavel(gerarContasVenda(entrada));

if (process.env.GRAVAR_CONGELADO === '1' || !existsSync(ARQUIVO)) {
  writeFileSync(ARQUIVO, JSON.stringify(atual, null, 2) + '\n');
  console.log('congelado gravado em scripts/fixture-venda-v1-congelada.json');
}
const congelado = JSON.parse(readFileSync(ARQUIVO, 'utf8')) as Record<string, unknown>;

console.log('--- gerarContasVenda: igual ao congelado ---');
for (const nome of Object.keys(VENDAS_V1)) eq(atual[nome], congelado[nome], `${nome}: mesma saída de antes da E5`);

// O sucessor responde igual para a entrada v1 (existe a partir da E5).
const modulo = await import('../src/lib/venda-contas.ts').catch(() => null);
if (modulo) {
  console.log('--- contasDaVenda (sucessor) com entrada v1 ---');
  for (const [nome, entrada] of Object.entries(VENDAS_V1)) {
    const r = modulo.contasDaVenda({ versao: 1, entrada });
    eq(estavel({ contas_receber: r.contas_receber, contas_pagar: r.contas_pagar, resumo: r.resumo, itens_processados: r.itens_processados }),
      congelado[nome], `${nome}: contasDaVenda(v1) = gerarContasVenda`);
    eq([r.pendencias.length, r.avisos.length], [0, 0], `${nome}: v1 não cria pendência nem aviso`);
  }
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
