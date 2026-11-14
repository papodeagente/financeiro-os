/**
 * Mudança de sistema (E4, 05/11/2026): leitura dos valores de uma célula
 * vinda da planilha do sistema anterior. Puro, sem banco.
 *
 * As listas exportadas misturam o que o Excel guardou como número (data
 * serial, valor) com o que veio como texto ("05/11/2026", "1.234,56",
 * "R$ -10,00", "(1.234,56)"). Cada leitor aceita as duas formas e devolve
 * null quando não dá para ter certeza: valor duvidoso nunca vira zero.
 */
import { soDigitos } from '../plataformas/conciliacao';

export type Celula = string | number | boolean | null;

/** Texto limpo de uma célula (número vira texto sem notação científica). */
export function texto(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Texto comparável: sem acento (º e ª viram o e a), minúsculo, só letras e
 * números separados por um espaço. Usado nos cabeçalhos e nos nomes.
 */
export function normalizar(v: unknown): string {
  return texto(v)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const DIA_MS = 86_400_000;
/** Dia zero do Excel (sistema 1900, com o falso 29/02/1900 já compensado). */
const EPOCA_EXCEL = Date.UTC(1899, 11, 30);

function iso(ano: number, mes: number, dia: number): string | null {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia)) return null;
  if (ano < 1900 || ano > 2200 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Data serial do Excel → 'AAAA-MM-DD'. Só aceita o intervalo 1950–2150. */
export function dataDoSerial(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const dias = Math.floor(serial);
  if (dias < 18264 || dias > 91311) return null; // 1950-01-01 .. 2149-12-31
  const d = new Date(EPOCA_EXCEL + dias * DIA_MS);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Data brasileira → 'AAAA-MM-DD'. Aceita dd/mm/aaaa (com - ou . no lugar da
 * barra, com hora depois), dd/mm/aa (00–69 = 20xx), aaaa-mm-dd, a data serial
 * do Excel (número ou texto só com dígitos) e Date. Mês/dia nunca são
 * invertidos: 05/11/2026 é 5 de novembro.
 */
export function lerData(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') return dataDoSerial(v);
  const s = texto(v);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    let ano = Number(m[3]);
    if (m[3].length === 2) ano += ano < 70 ? 2000 : 1900;
    return iso(ano, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{5}(?:[.,]\d+)?$/.test(s)) return dataDoSerial(Number(s.replace(',', '.')));
  return null;
}

/**
 * Dinheiro → centavos inteiros. Aceita número e textos como "1.234,56",
 * "R$ 1.234,56", "-1.234,56", "(1.234,56)", "1234,5", "1234.56" e "1.500"
 * (milhar). Devolve null para o que não é dinheiro ("abc", "12/10", vazio).
 */
export function lerCentavos(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) : null;
  if (typeof v === 'boolean') return null;
  let s = texto(v).replace(/\s/g, '');
  if (!s || s === '-' || s === '—') return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  s = s.replace(/^R\$/i, '').replace(/^(-?)R\$/i, '$1');
  if (s.startsWith('-')) { negativo = !negativo; s = s.slice(1); }
  if (s.endsWith('-')) { negativo = !negativo; s = s.slice(0, -1); }
  s = s.replace(/^R\$/i, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const virgula = s.lastIndexOf(',');
  const ponto = s.lastIndexOf('.');
  let inteiro: string;
  let decimal = '';
  if (virgula >= 0 && ponto >= 0) {
    // O último separador é o decimal.
    const sep = Math.max(virgula, ponto);
    inteiro = s.slice(0, sep).replace(/[.,]/g, '');
    decimal = s.slice(sep + 1);
  } else if (virgula >= 0) {
    if (s.indexOf(',') !== virgula) {
      // "1,234,567": vírgula repetida só pode ser milhar (formato inglês).
      inteiro = s.replace(/,/g, '');
    } else {
      inteiro = s.slice(0, virgula);
      decimal = s.slice(virgula + 1);
    }
  } else if (ponto >= 0) {
    // Ponto sozinho: "1.500" e "1.234.567" são milhar; "1234.56" é decimal.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) inteiro = s.replace(/\./g, '');
    else if (s.indexOf('.') === ponto) { inteiro = s.slice(0, ponto); decimal = s.slice(ponto + 1); }
    else return null;
  } else {
    inteiro = s;
  }
  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(decimal)) return null;
  if (decimal.length > 2) {
    // Mais de 2 casas: arredonda (planilha com 4 casas de câmbio, por exemplo).
    const n = Number(`${inteiro || '0'}.${decimal}`);
    const c = Math.round(n * 100 + 1e-7);
    return negativo ? -c : c;
  }
  const c = Number(inteiro || '0') * 100 + Number((decimal + '00').slice(0, 2));
  if (!Number.isFinite(c)) return null;
  return negativo ? -c : c;
}

/** CPF (11) ou CNPJ (14) só com dígitos; o resto vira vazio. */
export function lerDocumento(v: unknown): string {
  const d = soDigitos(typeof v === 'number' ? String(Math.round(v)) : texto(v));
  if (d.length === 11 || d.length === 14) return d;
  // CPF exportado como número perde zeros à esquerda.
  if (typeof v === 'number' && d.length >= 9 && d.length < 11) return d.padStart(11, '0');
  if (typeof v === 'number' && d.length > 11 && d.length < 14) return d.padStart(14, '0');
  return '';
}

/** Sim/Não da planilha. Vazio = null. */
export function lerSimNao(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = normalizar(v);
  if (!s) return null;
  if (['sim', 's', 'yes', 'y', 'true', 'verdadeiro', 'x', '1', 'ativa', 'ativo'].includes(s)) return true;
  if (['nao', 'n', 'no', 'false', 'falso', '0', 'inativa', 'inativo'].includes(s)) return false;
  return null;
}

/** "2/5", "2 de 5", "Parcela 2/5" → { numero: 2, total: 5 }; "3" → total 3. */
export function lerParcela(v: unknown): { numero: number; total: number } | null {
  const s = normalizar(v);
  if (!s) return null;
  const m = s.match(/(\d{1,3})\s+(?:de\s+)?(\d{1,3})$/);
  if (m) {
    const numero = Number(m[1]);
    const total = Number(m[2]);
    if (numero >= 1 && total >= numero) return { numero, total };
    return null;
  }
  const so = s.match(/^(\d{1,3})$/);
  if (so && Number(so[1]) >= 1) return { numero: 1, total: Number(so[1]) };
  return null;
}

/** Centavos → "R$ 1.234,56" (para motivos e provas). */
export function reais(centavos: number): string {
  const v = (centavos ?? 0) / 100;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** 'AAAA-MM-DD' → 'dd/mm/aaaa'. */
export function dataBR(isoData: string | null | undefined): string {
  const m = String(isoData ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
