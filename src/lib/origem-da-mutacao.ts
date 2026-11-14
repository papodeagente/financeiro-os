/**
 * Política central de origem para escrita com cookie de sessão (auditoria
 * 04/11/2026, FIN2-16). Sem dependência de Node: roda no middleware.
 *
 * O cookie é SameSite=Lax, o que já barra boa parte dos POSTs de outro site,
 * mas a proteção não pode depender só do navegador. Regras:
 *  - Sec-Fetch-Site cross-site/same-site → recusa (subdomínio irmão também).
 *  - Origin presente → precisa ser a própria origem (ou a canônica).
 *  - Sem nenhum dos dois (CLI, chamada de servidor) → segue; a autorização
 *    da rota continua valendo.
 *  - Nas rotas administrativas de JSON, corpo text/plain ou de formulário é
 *    recusado: é o formato que um formulário de outro site consegue mandar
 *    sem pedir permissão ao navegador.
 */

const METODOS_DE_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

const ROTAS_JSON_ESTRITAS = [
  '/api/usuarios', '/api/apis-config', '/api/v1/crm/config', '/api/fiscal/',
  '/api/admin/', '/api/auth/me', '/api/contas-bancarias', '/api/transferencias',
];

export function metodoDeEscrita(metodo: string): boolean {
  return !METODOS_DE_LEITURA.has(metodo.toUpperCase());
}

export function origemPermitida(
  metodo: string,
  urlDaRequisicao: string,
  cabecalhos: { get(nome: string): string | null },
  origensExtras: string[] = [],
  hostCanonico?: (host: string) => boolean,
): boolean {
  if (!metodoDeEscrita(metodo)) return true;
  const site = cabecalhos.get('sec-fetch-site')?.toLowerCase();
  if (site === 'cross-site' || site === 'same-site') return false;
  const origem = cabecalhos.get('origin');
  if (!origem) return true;
  try {
    const o = new URL(origem);
    if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
    const aceitas = new Set<string>([new URL(urlDaRequisicao).origin]);
    for (const extra of origensExtras) {
      try { aceitas.add(new URL(extra).origin); } catch { /* ignora */ }
    }
    const host = cabecalhos.get('x-forwarded-host')?.split(',')[0]?.trim();
    const proto = cabecalhos.get('x-forwarded-proto')?.split(',')[0]?.trim();
    if (host && (proto === 'http' || proto === 'https')) aceitas.add(`${proto}://${host}`);
    if (aceitas.has(o.origin)) return true;
    // Qualquer host da lista canônica do sistema (a app pode ter mais de um
    // domínio; atrás do proxy, a URL interna não é a que o navegador vê).
    return o.protocol === 'https:' && !!hostCanonico?.(o.host);
  } catch {
    return false;
  }
}

/** Rota administrativa de JSON recebendo corpo que um formulário alheio mandaria. */
export function corpoSimplesEmRotaJson(metodo: string, caminho: string, contentType: string | null): boolean {
  if (!metodoDeEscrita(metodo)) return false;
  if (!ROTAS_JSON_ESTRITAS.some(r => caminho === r || caminho.startsWith(r.endsWith('/') ? r : `${r}/`) || caminho === r.replace(/\/$/, ''))) return false;
  const tipo = (contentType ?? '').split(';', 1)[0].trim().toLowerCase();
  if (caminho.startsWith('/api/fiscal/certificado')) return tipo === 'text/plain' || tipo === 'application/x-www-form-urlencoded';
  return tipo === 'text/plain' || tipo === 'application/x-www-form-urlencoded' || tipo === 'multipart/form-data';
}
