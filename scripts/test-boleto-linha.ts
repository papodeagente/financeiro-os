/**
 * Leitor puro da linha digitável e do código de barras (src/lib/boleto-linha.ts), 05/11/2026.
 * Uso: node --experimental-strip-types scripts/run-tests.mjs scripts/test-boleto-linha.ts
 */
import {
  dataDoFator, formatarLinhaDigitavel, lerLinhaDoBoleto, modulo10, modulo11Arrecadacao, modulo11Bancario,
} from '../src/lib/boleto-linha.ts';

let falhas = 0;
let total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}
const ler = (l: string, hoje = '2026-11-05') => lerLinhaDoBoleto(l, hoje) as Record<string, unknown>;
const trocar = (s: string, i: number) => s.slice(0, i) + ((Number(s[i]) + 1) % 10) + s.slice(i + 1);

// Casos reais publicados (exemplos de bancos e de conta de consumo).
const BB = '00190500954014481606906809350314337370000000100';
const BRADESCO = '23793381286000782713695000063305975520000370000';
const TELEFONE = '846700000017435900240209024050002435842210108119';

console.log('--- Dígitos verificadores ---');
eq(modulo10('001905009'), 5, 'módulo 10 do 1º campo do boleto do Banco do Brasil');
eq(modulo11Bancario('0019373700000001000500940144816060680935031'), 3, 'módulo 11 do código de barras do Banco do Brasil');
eq(modulo11Arrecadacao('0'.repeat(43)), 0, 'módulo 11 da arrecadação: resto 0 vira 0');

console.log('--- Boleto de cobrança (47) ---');
let r = ler(BB, '2008-01-10');
eq([r.ok, r.tipo, r.banco, r.valorCentavos, r.fator, r.vencimento, r.emReais], [true, 'bancario', '001', 100, 3737, '2007-12-31', true],
  'Banco do Brasil: R$ 1,00, fator 3737 = 31/12/2007 (perto da data de referência)');
eq(r.codigoDeBarras, '00193373700000001000500940144816060680935031', 'linha vira o código de barras de 44');
r = ler(BRADESCO);
eq([r.ok, r.banco, r.valorCentavos, r.vencimento], [true, '237', 370000, '2018-06-11'], 'Bradesco: R$ 3.700,00, vencimento 11/06/2018');
eq(ler('2379.33812 86000.782713 69500.006330 5 97552000037 0000'.replace(/ (\d{4})$/, '$1')).ok, true, 'aceita a linha com pontos e espaços');
eq(ler(String(r.codigoDeBarras)).linhaDigitavel, BRADESCO, 'código de barras (44) volta para a mesma linha digitável');

console.log('--- Dígito errado ---');
r = ler(trocar(BB, 12));
eq([r.ok, r.motivo, r.mensagem], [false, 'digito', 'O 2º bloco da linha digitável não confere. Confira os números no papel.'], 'número trocado no 2º bloco');
r = ler(trocar(BB, 2));
eq([r.ok, r.motivo], [false, 'digito'], 'número trocado no 1º bloco');
r = ler(trocar(BB, 46));
eq([r.ok, r.mensagem], [false, 'O dígito verificador geral do boleto não confere. Confira os números no papel.'], 'VALOR trocado (R$ 1,01): o DV geral pega');
r = ler(trocar(BRADESCO, 35));
eq(r.ok, false, 'fator de vencimento trocado: o DV geral pega');
r = ler(trocar(BRADESCO, 32));
eq(r.ok, false, 'o próprio DV geral trocado');
eq(ler(trocar(TELEFONE, 13)).ok, false, 'conta de consumo com número trocado no 2º bloco');
eq(ler(BB.slice(0, 40)).motivo, 'tamanho', 'linha incompleta');
eq(ler('').motivo, 'vazio', 'nada informado');
eq(ler('8' + BB.slice(1)).motivo, 'formato', '47 números começando com 8 não é boleto');

console.log('--- Fator de vencimento e a virada de 2025 ---');
eq(dataDoFator(1000, '2000-07-01'), '2000-07-03', 'fator 1000 no primeiro ciclo = 03/07/2000');
eq(dataDoFator(9999, '2025-02-01'), '2025-02-21', 'fator 9999 = 21/02/2025, último dia do primeiro ciclo');
eq(dataDoFator(1000, '2025-03-01'), '2025-02-22', 'depois da virada, fator 1000 = 22/02/2025');
eq(dataDoFator(1001, '2025-03-01'), '2025-02-23', 'fator 1001 = 23/02/2025');
eq(dataDoFator(1500, '2026-11-05'), '2026-07-07', 'fator 1500 hoje = 07/07/2026 (segundo ciclo)');
eq(dataDoFator(9990, '2026-11-05'), '2025-02-12', 'fator 9990 hoje = 12/02/2025 (boleto antigo, primeiro ciclo)');
eq(dataDoFator(0, '2026-11-05'), null, 'fator 0000 = sem vencimento');

// Boleto do segundo ciclo, montado com os mesmos dígitos verificadores dos bancos.
function bancario(fator: string, valor: string, livre = '1234567890123456789012345'): string {
  const semDv = '341' + '9' + fator + valor + livre;
  const barras = semDv.slice(0, 4) + modulo11Bancario(semDv) + semDv.slice(4);
  return barras;
}
r = ler(bancario('1500', '0000012345'));
eq([r.ok, r.vencimento, r.valorCentavos, r.banco], [true, '2026-07-07', 12345, '341'], 'código de barras do segundo ciclo: 07/07/2026, R$ 123,45');
const linhaNova = String(r.linhaDigitavel);
eq([linhaNova.length, ler(linhaNova).vencimento], [47, '2026-07-07'], 'a linha montada a partir do código lê a mesma data');
r = ler(bancario('0000', '0000000000'));
eq([r.ok, r.vencimento, r.valorCentavos], [true, null, 0], 'sem vencimento e sem valor (quem paga informa)');

console.log('--- Conta de consumo (48) ---');
r = ler(TELEFONE);
eq([r.ok, r.tipo, r.segmento, r.valorCentavos, r.vencimento, r.emReais], [true, 'arrecadacao', '4', 14359, null, true],
  'telefone: R$ 143,59, sem data no código');
eq(ler(String(r.codigoDeBarras)).linhaDigitavel, TELEFONE, 'código de barras (44) da conta volta para a mesma linha');
// Identificador 8: módulo 11.
const semDv = '838' + '00000012345' + '0123' + '4567890123456789012345678';
const barrasMod11 = semDv.slice(0, 3) + modulo11Arrecadacao(semDv) + semDv.slice(3);
r = ler(barrasMod11);
eq([r.ok, r.segmento, r.valorCentavos, String(r.linhaDigitavel).length], [true, '3', 12345, 48], 'energia com módulo 11: R$ 123,45');
eq(ler(trocar(String(r.linhaDigitavel), 5)).ok, false, 'módulo 11 também pega número trocado');
const semDv7 = '817' + '0'.repeat(40);
eq(ler(semDv7.slice(0, 3) + modulo10(semDv7) + semDv7.slice(3)).emReais, false, 'identificador 7: valor de referência, não reais');

console.log('--- Formatação ---');
eq(formatarLinhaDigitavel(BB), '00190.50095 40144.816069 06809.350314 3 37370000000100', 'boleto como no papel');
eq(formatarLinhaDigitavel(TELEFONE), '84670000001-7 43590024020-9 02405000243-5 84221010811-9', 'conta de consumo como no papel');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
