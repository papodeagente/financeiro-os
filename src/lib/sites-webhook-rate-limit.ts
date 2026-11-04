const JANELA_MS = 60_000;
const LIMITE_POR_ORIGEM = 120;
const LIMITE_ORIGEM_GLOBAL = 1_000;
const LIMITE_POR_TENANT = 600;
const LIMITE_GLOBAL = 5_000;
const MAX_CHAVES = 20_000;

interface Balde {
  inicio: number;
  quantidade: number;
  vistoEm: number;
}

const porOrigemTenant = new Map<string, Balde>();
const porOrigem = new Map<string, Balde>();
const porTenant = new Map<string, Balde>();
const global = new Map<string, Balde>();
let chamadas = 0;

function consumir(mapa: Map<string, Balde>, chave: string, limite: number, agora: number): boolean {
  const atual = mapa.get(chave);
  if (!atual || agora - atual.inicio >= JANELA_MS) {
    mapa.set(chave, { inicio: agora, quantidade: 1, vistoEm: agora });
    return true;
  }
  atual.vistoEm = agora;
  atual.quantidade += 1;
  return atual.quantidade <= limite;
}

function podar(mapa: Map<string, Balde>, agora: number) {
  for (const [chave, balde] of mapa) {
    if (agora - balde.vistoEm >= JANELA_MS * 2) mapa.delete(chave);
  }
  if (mapa.size <= MAX_CHAVES) return;
  const excedente = mapa.size - MAX_CHAVES;
  const maisAntigos = [...mapa.entries()]
    .sort((a, b) => a[1].vistoEm - b[1].vistoEm)
    .slice(0, excedente);
  for (const [chave] of maisAntigos) mapa.delete(chave);
}

export function origemDoWebhook(headers: Headers): string {
  // O Traefik sobrescreve X-Real-IP com o peer recebido. X-Forwarded-For nao
  // entra aqui porque o cliente pode antepor valores. O header da Cloudflare
  // fica como fallback; os tetos global/tenant continuam valendo mesmo que a
  // borda esteja mal configurada.
  const valor = headers.get('x-real-ip')
    || headers.get('cf-connecting-ip')
    || 'desconhecida';
  const limpa = valor.trim().slice(0, 64);
  return /^[0-9a-f:.]+$/i.test(limpa) ? limpa : 'desconhecida';
}

/**
 * Limitador local e limitado em memoria. O teto por tenant continua valendo
 * mesmo se a origem tentar variar X-Forwarded-For; com duas replicas a
 * capacidade efetiva dobra sem criar um ponto central de indisponibilidade.
 */
export function permitirWebhookSites(tenantId: string, origem: string, agora = Date.now()): boolean {
  chamadas += 1;
  if ((chamadas & 255) === 0 || porOrigemTenant.size > MAX_CHAVES || porOrigem.size > MAX_CHAVES || porTenant.size > MAX_CHAVES) {
    podar(porOrigemTenant, agora);
    podar(porOrigem, agora);
    podar(porTenant, agora);
  }
  const globalOk = consumir(global, 'global', LIMITE_GLOBAL, agora);
  const origemGlobalOk = consumir(porOrigem, origem, LIMITE_ORIGEM_GLOBAL, agora);
  const tenantOk = consumir(porTenant, tenantId, LIMITE_POR_TENANT, agora);
  const origemOk = consumir(porOrigemTenant, `${tenantId}:${origem}`, LIMITE_POR_ORIGEM, agora);
  return globalOk && origemGlobalOk && tenantOk && origemOk;
}

export function limparRateLimitSitesParaTeste() {
  porOrigemTenant.clear();
  porOrigem.clear();
  porTenant.clear();
  global.clear();
  chamadas = 0;
}
