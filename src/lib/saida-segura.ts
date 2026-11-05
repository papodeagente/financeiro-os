/**
 * Cópia do cliente de saída do EnturOS Sites (packages/db/src/saida-segura.ts),
 * trazida para o Financeiro na auditoria de 04/11/2026 (FIN-06): o importador
 * de imagens e o proxy de imagem buscavam qualquer endereço recebido, inclusive
 * da rede interna, seguindo redirecionamento sem conferir o destino.
 *
 * Mantida igual à do Sites, com uma diferença: imagem aceita http:// (ver
 * enderecoDeImagem). Conserto de rede numa vale para a outra.
 */
/**
 * Chamada para um endereço que a AGÊNCIA escolheu (webhook), sem deixar o
 * processo da plataforma ser apontado para dentro da nossa rede.
 *
 * A trava do importador (packages/importador/src/buscar.ts) confere o IP e
 * depois deixa o `fetch` resolver o nome de novo: um DNS que muda de resposta
 * entre as duas consultas (rebinding) passa. Aqui a conexão é aberta pelo
 * `node:https` com um `lookup` próprio que resolve, recusa faixa interna e
 * entrega o PRÓPRIO endereço conferido para o socket: não existe segunda
 * resolução. Redirecionamento não é seguido.
 */
import https from "node:https";
import http from "node:http";
import { lookup as resolver } from "node:dns";
import { BlockList, isIPv4, isIPv6, type LookupFunction } from "node:net";

/*
 * As faixas internas, pelo BlockList do Node (que entende a notação do IPv6
 * inteira, inclusive comprimida). O IPv6 que carrega um IPv4 dentro (mapeado
 * ::ffff:a.b.c.d, compatível ::a.b.c.d, 6to4 2002::/16, Teredo 2001::/32,
 * NAT64) é recusado inteiro ou conferido pelo IPv4 que carrega: era por aí
 * que um webhook alcançava a rede interna.
 */
const V4 = new BlockList();
for (const [rede, prefixo] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) V4.addSubnet(rede, prefixo, "ipv4");
const V6 = new BlockList();
for (const [rede, prefixo] of [["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) V6.addSubnet(rede, prefixo, "ipv6");

export function ipInterno(ip: string): boolean {
  const limpo = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (isIPv4(limpo)) return V4.check(limpo, "ipv4");
  if (!isIPv6(limpo)) return true; // formato desconhecido: recusa
  // IPv4 mapeado escrito com pontos (::ffff:8.8.8.8): vale o IPv4 que ele carrega.
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(limpo);
  if (mapeado) return V4.check(mapeado[1]!, "ipv4");
  return V6.check(limpo, "ipv6");
}

export class DestinoRecusado extends Error {}

/** Endereço aceito para webhook: https, porta padrão, sem usuário, host com ponto. */
export function enderecoDeWebhook(entrada: string): URL {
  let u: URL;
  try { u = new URL(entrada.trim()); } catch { throw new DestinoRecusado("Endereço inválido."); }
  if (u.protocol !== "https:") throw new DestinoRecusado("O endereço precisa começar com https://");
  if (u.username || u.password) throw new DestinoRecusado("O endereço não pode levar usuário nem senha.");
  if (u.port && u.port !== "443") throw new DestinoRecusado("Use a porta padrão do https.");
  if (!u.hostname.includes(".") || /^\[?[\d.:a-f]+\]?$/i.test(u.hostname)) throw new DestinoRecusado("Use um nome de domínio, não um IP.");
  if (u.toString().length > 500) throw new DestinoRecusado("Endereço longo demais.");
  return u;
}

/** O `lookup` que só entrega endereço público. Exportado para o teste. */
export const lookupPublico: LookupFunction = (nome, opcoes, pronto) => {
  resolver(nome, { ...opcoes, all: true }, (erro, enderecos) => {
    if (erro) return pronto(erro, "", 4);
    const lista = (Array.isArray(enderecos) ? enderecos : [{ address: String(enderecos), family: 4 }]) as { address: string; family: number }[];
    if (lista.length === 0 || lista.some((e) => ipInterno(e.address))) {
      return pronto(Object.assign(new Error("destino interno recusado"), { code: "EDESTINOINTERNO" }), "", 4);
    }
    if ((opcoes as { all?: boolean }).all) return (pronto as unknown as (e: null, l: typeof lista) => void)(null, lista);
    pronto(null, lista[0]!.address, lista[0]!.family);
  });
};

/** Endereço de imagem que a plataforma aceita BAIXAR: as mesmas regras do webhook. */
/**
 * Endereço de imagem que o Financeiro aceita BAIXAR. Diferente do Sites,
 * aceita também http:// (porta 80): há foto de hotel publicada só em http,
 * e a guarda que importa é a de rede (IP conferido no próprio socket), que
 * vale igual para os dois. Sem usuário, porta padrão, nome de domínio.
 */
export function enderecoDeImagem(entrada: string): URL {
  let u: URL;
  try { u = new URL(entrada.trim()); } catch { throw new DestinoRecusado("Endereço inválido."); }
  if (u.protocol === "https:") return enderecoDeWebhook(entrada);
  if (u.protocol !== "http:") throw new DestinoRecusado("O endereço precisa começar com http:// ou https://");
  if (u.username || u.password) throw new DestinoRecusado("O endereço não pode levar usuário nem senha.");
  if (u.port && u.port !== "80") throw new DestinoRecusado("Use a porta padrão do http.");
  if (!u.hostname.includes(".") || /^\[?[\d.:a-f]+\]?$/i.test(u.hostname)) throw new DestinoRecusado("Use um nome de domínio, não um IP.");
  if (u.toString().length > 500) throw new DestinoRecusado("Endereço longo demais.");
  return u;
}

/**
 * Baixa uma imagem de um endereço que veio de fora (a API e o MCP importam
 * por URL). As travas, nesta ordem: só https na porta padrão, sem usuário, com
 * nome de domínio; o IP conferido no PRÓPRIO socket (`lookupPublico`, sem
 * segunda resolução); até 3 redirecionamentos, cada um revalidado do zero;
 * corpo cortado no teto; prazo do pedido inteiro, não só do silêncio. O que
 * volta são bytes: o formato quem decide é quem abre (o sharp), nunca o
 * Content-Type de quem respondeu.
 */
export async function baixarImagemSegura(entrada: string, o: { tetoBytes?: number; tempoMs?: number; lookup?: LookupFunction } = {}): Promise<{ bytes: Buffer; final: string }> {
  const teto = o.tetoBytes ?? 5_000_000;
  const tempoMs = o.tempoMs ?? 15_000;
  const inicio = Date.now();
  let url = enderecoDeImagem(entrada);
  for (let saltos = 0; saltos <= 3; saltos++) {
    const restante = tempoMs - (Date.now() - inicio);
    if (restante <= 0) throw new DestinoRecusado("a imagem demorou demais para chegar");
    const r = await new Promise<{ status: number; local?: string; bytes?: Buffer }>((resolve, reject) => {
      const seguro = url.protocol === "https:";
      const req = (seguro ? https : http).request({
        protocol: seguro ? "https:" : "http:", hostname: url.hostname, port: seguro ? 443 : 80, path: `${url.pathname}${url.search}`, method: "GET",
        headers: { accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5", "user-agent": "EnturOS-Financeiro-Imagens/1.0" },
        lookup: o.lookup ?? lookupPublico, timeout: restante,
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) { res.resume(); return resolve({ status, local: res.headers.location }); }
        if (status !== 200) { res.resume(); return resolve({ status }); }
        const declarado = Number(res.headers["content-length"] ?? 0);
        if (declarado > teto) { res.destroy(); return reject(new DestinoRecusado(`a imagem passa de ${Math.round(teto / 1_000_000)} MB`)); }
        const partes: Buffer[] = []; let total = 0;
        res.on("data", (p: Buffer) => { total += p.length; if (total > teto) { res.destroy(); reject(new DestinoRecusado(`a imagem passa de ${Math.round(teto / 1_000_000)} MB`)); } else partes.push(p); });
        res.on("end", () => resolve({ status, bytes: Buffer.concat(partes) }));
        res.on("error", reject);
      });
      const prazo = setTimeout(() => req.destroy(new DestinoRecusado("a imagem demorou demais para chegar")), restante);
      req.on("timeout", () => req.destroy(new DestinoRecusado("a imagem demorou demais para chegar")));
      req.on("close", () => clearTimeout(prazo));
      req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "EDESTINOINTERNO" ? new DestinoRecusado("esse endereço aponta para dentro da nossa rede") : e));
      req.end();
    });
    if (r.bytes) return { bytes: r.bytes, final: url.toString() };
    if (r.local) { url = enderecoDeImagem(new URL(r.local, url).toString()); continue; }
    throw new DestinoRecusado(`o endereço respondeu ${r.status}`);
  }
  throw new DestinoRecusado("redirecionamentos demais");
}
