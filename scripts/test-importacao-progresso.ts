/**
 * Andamento da importação de extrato (src/lib/importacao-progresso.ts).
 *
 * O que estes testes guardam: a barra nunca mostra mais do que foi feito,
 * nunca anda para trás, e a resposta em pedaços não perde nem inventa aviso.
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-importacao-progresso.ts
 */
import {
  etapaDaFase, preenchimentoDasEtapas, percentualTotal, aproximar, criarLeitorNdjson, resumoDoArquivo, tamanhoLegivel,
} from '../src/lib/importacao-progresso.ts';
import { passoDoAviso } from '../src/lib/extrato-importacao.ts';

let falhas = 0, total = 0;
function eq(a: unknown, b: unknown, label: string) {
  total++; const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); } else console.log(`PASS  ${label}`);
}

console.log('--- etapas e barra ---');
eq(['lendo', 'reconhecendo', 'conferindo', 'gravando', 'pronto'].map(f => etapaDaFase(f as never)), [0, 1, 2, 2, 3], 'cada fase cai na sua etapa');
eq(preenchimentoDasEtapas('lendo', { lidoBytes: 50, totalBytes: 200 }), [0.25, 0, 0], 'lendo enche o primeiro segmento pelos bytes');
eq(preenchimentoDasEtapas('gravando', { feitas: 30, total: 120 }), [1, 1, 0.25], 'gravando enche o terceiro pelas linhas que o servidor contou');
eq(preenchimentoDasEtapas('gravando', { feitas: 500, total: 120 }), [1, 1, 1], 'nunca passa de cheio');
eq(preenchimentoDasEtapas('lendo', { lidoBytes: 10, totalBytes: 0 }), [0, 0, 0], 'arquivo de tamanho zero não divide por zero');
eq(percentualTotal([1, 1, 0.5]), 60, 'gravar pesa 80%: metade gravada dá 60%');
eq(percentualTotal([1, 1, 1]), 100, 'tudo feito é 100%');

console.log('--- o perseguidor ---');
{
  let x = 0, passouDoReal = false, voltou = false, ultimo = 0;
  for (let i = 0; i < 200; i++) {
    const real = i < 50 ? 0.3 : 1;
    x = aproximar(x, real, 16);
    if (x > real + 1e-9) passouDoReal = true;
    if (x < ultimo) voltou = true;
    ultimo = x;
  }
  eq([passouDoReal, voltou], [false, false], 'nunca passa do real e nunca anda para trás');
  eq(x, 1, 'e chega ao fim');
  eq(aproximar(0.8, 0.5, 16), 0.8, 'se o real recua, o exibido espera em vez de voltar');
  eq(aproximar(0.2, 0.9, 0), 0.2, 'sem tempo passado, não anda');
}

console.log('--- leitura em pedaços ---');
{
  const l = criarLeitorNdjson();
  eq(l.empurrar('{"fase":"confer'), [], 'meia linha fica guardada');
  eq(l.empurrar('indo","total":3}\n{"fase":"gravando","feitas":1}\n{"fa'), [{ fase: 'conferindo', total: 3 }, { fase: 'gravando', feitas: 1 }], 'a linha completada e a seguinte saem juntas');
  eq(l.empurrar('se":"pronto"}'), [], 'último pedaço sem quebra de linha espera o fim');
  eq(l.fechar(), [{ fase: 'pronto' }], 'e sai no fechar');
  eq(criarLeitorNdjson().empurrar('lixo\n{"ok":1}\n\n'), [{ ok: 1 }], 'linha que não é JSON é descartada, sem derrubar as outras');
}

console.log('--- resumo e tamanho ---');
{
  const r = resumoDoArquivo([{ data: '2026-10-05', valor: 0.1 }, { data: '2026-09-01', valor: 0.2 }, { data: '2026-09-15', valor: -0.3 }]);
  eq(r, { quantidade: 3, de: '2026-09-01', ate: '2026-10-05', entradas: 0.3, saidas: -0.3 }, 'período e totais do arquivo, sem erro de float');
  eq([tamanhoLegivel(900), tamanhoLegivel(184_320), tamanhoLegivel(2_516_582)], ['900 bytes', '180 KB', '2,4 MB'], 'tamanho legível');
  eq([passoDoAviso(0), passoDoAviso(50), passoDoAviso(588), passoDoAviso(10_000)], [1, 1, 6, 100], 'no máximo uns cem avisos por arquivo');
}

console.log(`\n${total - falhas}/${total} testes do andamento da importação passaram`);
if (falhas > 0) process.exit(1);
