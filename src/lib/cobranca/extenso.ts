/**
 * Valor em reais por extenso, para o recibo (05/11/2026).
 *
 *   1234,56 → "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"
 *   1,00    → "um real"
 *   0,01    → "um centavo"
 *   1000000 → "um milhão de reais"
 *
 * Regras do português usadas no recibo: "cem" sozinho e "cento e" com
 * resto; "e" entre centenas, dezenas e unidades; "e" entre grupos de milhar
 * quando o grupo seguinte é menor que cem ou é centena redonda; "de reais"
 * depois de milhão/bilhão redondo. Conta em centavos inteiros, sem flutuar.
 */

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0 a 999 por extenso ("" para zero). */
function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

const ESCALAS: Array<[string, string]> = [
  ['', ''],
  ['mil', 'mil'],
  ['milhão', 'milhões'],
  ['bilhão', 'bilhões'],
  ['trilhão', 'trilhões'],
];

/** Inteiro não negativo por extenso ("zero" para 0). */
export function inteiroPorExtenso(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Número fora da faixa do recibo.');
  if (n === 0) return 'zero';
  const grupos: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  if (grupos.length > ESCALAS.length) throw new RangeError('Número fora da faixa do recibo.');

  const pedacos: Array<{ texto: string; valor: number }> = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let texto: string;
    if (i === 0) texto = ate999(g);
    else if (i === 1) texto = g === 1 ? 'mil' : `${ate999(g)} mil`;
    else texto = `${ate999(g)} ${g === 1 ? ESCALAS[i][0] : ESCALAS[i][1]}`;
    pedacos.push({ texto, valor: g });
  }
  // Junta os grupos: "e" antes do último quando ele é < 100 ou centena
  // redonda ("mil e cem", "dois mil e trinta"); espaço nos demais casos
  // ("mil duzentos e trinta e quatro"), como se escreve em cheque e recibo.
  let saida = pedacos[0].texto;
  for (let k = 1; k < pedacos.length; k++) {
    const p = pedacos[k];
    const ultimo = k === pedacos.length - 1;
    const comE = ultimo && (p.valor < 100 || p.valor % 100 === 0);
    saida += comE ? ` e ${p.texto}` : ` ${p.texto}`;
  }
  return saida;
}

/** Valor em reais por extenso. Aceita até trilhões; negativo é recusado. */
export function valorPorExtenso(reais: number): string {
  if (!Number.isFinite(reais) || reais < 0) throw new RangeError('Valor inválido para o recibo.');
  const centavosTotais = Math.round(reais * 100);
  const inteiro = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  if (inteiro === 0 && centavos === 0) return 'zero real';

  const partes: string[] = [];
  if (inteiro > 0) {
    const texto = inteiroPorExtenso(inteiro);
    // "um milhão de reais", "dois bilhões de reais"; mas "um milhão duzentos mil reais".
    const redondoGrande = inteiro >= 1_000_000 && inteiro % 1_000_000 === 0;
    const moeda = inteiro === 1 ? 'real' : 'reais';
    partes.push(`${texto}${redondoGrande ? ' de' : ''} ${moeda}`);
  }
  if (centavos > 0) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ');
}

/** Primeira letra maiúscula, para começar a frase do recibo. */
export function comMaiuscula(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
