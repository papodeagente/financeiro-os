/**
 * Identidade visual da agência (13/11/2026): logo e cores cadastradas em
 * Configurações > Dados da Agência, usadas nos documentos para o cliente
 * (o recibo da venda, para começar).
 *
 * Bruno: "No cadastro da empresa, permita o cadastro da logo e cores padrões
 * da empresa."
 *
 * Regras que esta camada garante:
 *  - cor só entra se for hex "#RRGGBB" (ou "#RGB", expandido); o resto cai no
 *    padrão, nunca vira CSS solto vindo do cadastro;
 *  - o texto sobre a cor principal é branco ou quase preto, o que der mais
 *    contraste (WCAG), para a faixa do documento nunca ficar ilegível;
 *  - a cor usada como TEXTO sobre o papel branco é escurecida até ter
 *    contraste de leitura (4,5:1), porque um amarelo de marca escrito em
 *    branco some.
 *
 * Puro: sem banco e sem React.
 */

export const COR_PRIMARIA_PADRAO = '#004AAD';
export const COR_DESTAQUE_PADRAO = '#0F172A';

/** "#RGB" ou "#RRGGBB" → "#RRGGBB" em maiúsculas; qualquer outra coisa → null. */
export function corValida(bruto: unknown): string | null {
  const t = String(bruto ?? '').trim();
  const curta = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (curta) return `#${curta[1]}${curta[1]}${curta[2]}${curta[2]}${curta[3]}${curta[3]}`.toUpperCase();
  return /^#[0-9a-f]{6}$/i.test(t) ? t.toUpperCase() : null;
}

function canais(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexDe([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Luminância relativa (WCAG 2.x). */
export function luminancia(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = canais(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const BRANCO = '#FFFFFF';
const QUASE_PRETO = '#111827';

/** Branco ou quase preto, o que tiver mais contraste sobre a cor. */
export function textoSobre(cor: string): string {
  return contraste(cor, BRANCO) >= contraste(cor, QUASE_PRETO) ? BRANCO : QUASE_PRETO;
}

/** A cor escurecida (misturada com preto) até ler bem sobre o papel branco. */
export function legivelNoPapel(cor: string, minimo = 4.5): string {
  let [r, g, b] = canais(cor);
  for (let i = 0; i < 20 && contraste(hexDe([r, g, b]), BRANCO) < minimo; i++) {
    r *= 0.88; g *= 0.88; b *= 0.88;
  }
  return hexDe([r, g, b]);
}

/** A cor clareada (misturada com branco) para fundos suaves: 0 = a cor, 1 = branco. */
export function clarear(cor: string, quanto: number): string {
  const [r, g, b] = canais(cor);
  const k = Math.max(0, Math.min(1, quanto));
  return hexDe([r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k]);
}

export interface MarcaDoDocumento {
  primaria: string;
  destaque: string;
  /** Texto sobre a faixa na cor principal. */
  textoSobrePrimaria: string;
  /** A principal escrita sobre o papel (títulos, total). */
  primariaNoPapel: string;
  /** Fundo suave da principal (caixa do valor, cabeçalho da tabela). */
  primariaSuave: string;
  /** Linha fina na principal. */
  primariaLinha: string;
}

export function marcaDoDocumento(agencia: { cores?: { primaria?: string; destaque?: string } } | null | undefined): MarcaDoDocumento {
  const primaria = corValida(agencia?.cores?.primaria) ?? COR_PRIMARIA_PADRAO;
  const destaque = corValida(agencia?.cores?.destaque) ?? COR_DESTAQUE_PADRAO;
  return {
    primaria,
    destaque,
    textoSobrePrimaria: textoSobre(primaria),
    primariaNoPapel: legivelNoPapel(primaria),
    primariaSuave: clarear(primaria, 0.93),
    primariaLinha: clarear(primaria, 0.75),
  };
}
