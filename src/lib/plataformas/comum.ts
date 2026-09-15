/** Leitura tolerante de payload de terceiro. Cada plataforma muda nome de
 *  campo entre versões, e quebrar por causa disso perde venda. */
import { round2, num } from '../money';

export function em(o: unknown, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>(
    (acc, p) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[p] : undefined),
    o,
  );
}

export function texto(o: unknown, ...caminhos: string[]): string {
  for (const c of caminhos) {
    const v = em(o, c);
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

export function numero(o: unknown, ...caminhos: string[]): number {
  for (const c of caminhos) {
    const v = em(o, c);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

/** Centavos para reais. Pagar.me e Hotmart falam em centavos em vários
 *  campos, e somar centavo como real multiplica a receita por cem. */
export function deCentavos(v: unknown): number {
  return round2(num(v) / 100);
}

/** Data civil 'YYYY-MM-DD' a partir de ISO, epoch em ms ou 'DD/MM/YYYY'. */
export function data(o: unknown, ...caminhos: string[]): string {
  for (const c of caminhos) {
    const v = em(o, c);
    if (typeof v === 'number' && v > 0) {
      // Epoch em segundos ou em ms: abaixo de 1e12 é segundos.
      const ms = v < 1e12 ? v * 1000 : v;
      return new Date(ms).toISOString().slice(0, 10);
    }
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
      const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    }
  }
  return '';
}

export function digitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** Comparação de segredo que não vaza tamanho nem posição por tempo. */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length) return false;
  let diferenca = 0;
  for (let i = 0; i < x.length; i++) diferenca |= x[i] ^ y[i];
  return diferenca === 0;
}
