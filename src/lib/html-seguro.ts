/**
 * Limpeza do texto rico da proposta (auditoria 04/11/2026, FIN-07).
 *
 * O corpo das seções de texto vem do editor (TipTap) como HTML e era injetado
 * cru na página pública: qualquer atributo de evento ou link `javascript:`
 * gravado por uma conta comprometida rodava no navegador de quem abrisse a
 * proposta, na origem do sistema.
 *
 * Regra: lista FECHADA. Só passam as marcas que o editor produz, cada uma com
 * os atributos que ela precisa; todo o resto vira texto visível (escapado),
 * nunca marcação. Funciona sem DOM, então roda igual no servidor (ao gravar)
 * e no navegador (ao desenhar, como segunda barreira).
 */

const MARCAS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'span',
  'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'code', 'pre', 'sub', 'sup', 'small',
]);
const VAZIAS = new Set(['br', 'hr']);

/** Atributos aceitos por marca. `style` passa por uma régua própria. */
const ATRIBUTOS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  span: new Set(['style']),
  mark: new Set(['style', 'data-color']),
  p: new Set(['style']),
  h1: new Set(['style']), h2: new Set(['style']), h3: new Set(['style']),
  h4: new Set(['style']), h5: new Set(['style']), h6: new Set(['style']),
  li: new Set(['style']),
};

const URL_SEGURA = /^(https?:\/\/|mailto:|tel:)[^\s"'<>`]*$/i;
const COR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|[a-z]{3,20})$/i;
const PROPRIEDADES_DE_ESTILO: Record<string, RegExp> = {
  color: COR,
  'background-color': COR,
  'text-align': /^(left|right|center|justify)$/i,
};

function escapar(texto: string): string {
  return texto.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escaparAtributo(valor: string): string {
  return valor.replace(/&(?![a-z0-9#]+;)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function estiloSeguro(estilo: string): string {
  const partes: string[] = [];
  for (const declaracao of estilo.split(';')) {
    const i = declaracao.indexOf(':');
    if (i < 0) continue;
    const prop = declaracao.slice(0, i).trim().toLowerCase();
    const valor = declaracao.slice(i + 1).trim();
    const regra = PROPRIEDADES_DE_ESTILO[prop];
    if (regra && regra.test(valor)) partes.push(`${prop}: ${valor}`);
  }
  return partes.join('; ');
}

function atributosSeguros(marca: string, bruto: string): string {
  const aceitos = ATRIBUTOS[marca];
  if (!aceitos) return '';
  const saida: string[] = [];
  // Só atributos com valor entre aspas; sem aspas, sem valor ou malformado cai fora.
  const re = /([a-zA-Z][\w-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto))) {
    const nome = m[1].toLowerCase();
    const valor = m[3] ?? m[4] ?? '';
    if (!aceitos.has(nome)) continue;
    if (nome === 'href') {
      if (!URL_SEGURA.test(valor.trim())) continue;
      saida.push(`href="${escaparAtributo(valor.trim())}"`);
    } else if (nome === 'style') {
      const estilo = estiloSeguro(valor);
      if (estilo) saida.push(`style="${escaparAtributo(estilo)}"`);
    } else if (nome === 'target') {
      if (valor === '_blank') saida.push('target="_blank"');
    } else if (nome === 'rel') {
      // rel é sempre o nosso (abaixo)
    } else {
      saida.push(`${nome}="${escaparAtributo(valor)}"`);
    }
  }
  if (marca === 'a') saida.push('rel="noopener noreferrer nofollow"');
  return saida.length ? ' ' + saida.join(' ') : '';
}

/** Devolve o HTML só com a marcação permitida. Texto puro passa igual. */
export function limparHtml(html: unknown): string {
  if (typeof html !== 'string' || !html) return '';
  // Comentários e blocos de script/style somem inteiros (o conteúdo não é texto do autor).
  const semBlocos = html
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript|textarea|title|xmp)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
  let saida = '';
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g;
  let fim = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(semBlocos))) {
    saida += escapar(semBlocos.slice(fim, m.index));
    fim = re.lastIndex;
    const fecha = m[1] === '/';
    const marca = m[2].toLowerCase();
    if (!MARCAS.has(marca)) {
      // Marca desconhecida some (o texto em volta fica).
      continue;
    }
    if (fecha) {
      if (!VAZIAS.has(marca)) saida += `</${marca}>`;
      continue;
    }
    saida += `<${marca}${atributosSeguros(marca, m[3])}${VAZIAS.has(marca) ? ' /' : ''}>`;
  }
  saida += escapar(semBlocos.slice(fim));
  return saida;
}

/** URL para link/iframe vinda do conteúdo: só http(s). Qualquer outra vira vazio. */
export function urlHttp(url: unknown): string {
  if (typeof url !== 'string') return '';
  const u = url.trim();
  return /^https?:\/\/[^\s"'<>`]+$/i.test(u) ? u : '';
}

/**
 * Limpa, numa proposta inteira, todo campo `corpo` de seção (o único que a
 * página injeta como HTML). Usado ao gravar.
 */
export function limparHtmlDaProposta<T>(proposta: T): T {
  if (!proposta || typeof proposta !== 'object') return proposta;
  const p = proposta as unknown as { secoes?: Array<{ conteudo?: Record<string, unknown> }> };
  if (!Array.isArray(p.secoes)) return proposta;
  for (const secao of p.secoes) {
    const c = secao?.conteudo;
    if (c && typeof c.corpo === 'string' && c.corpo.includes('<')) c.corpo = limparHtml(c.corpo);
  }
  return proposta;
}
