/**
 * Cliente HTTP com mTLS para falar com o banco da agência.
 *
 * Um agente TLS por chamada, criado com o certificado e a chave DAQUELA
 * conexão e destruído no fim (seção 13 do plano: nunca um agente global
 * mutável, nunca o certificado de uma agência numa conexão de outra). O PEM
 * decifrado só existe dentro desta função.
 *
 * Os testes nunca usam este cliente: o adaptador recebe um cliente simulado.
 */
import { Agent, request } from 'node:https';
import type { ClienteHttpBanco, PedidoBanco, RespostaBanco } from './contrato';

const LIMITE_RESPOSTA_BYTES = 50 * 1024 * 1024;

export const clienteHttpMtls: ClienteHttpBanco = (pedido: PedidoBanco): Promise<RespostaBanco> => {
  const url = new URL(pedido.url);
  if (url.protocol !== 'https:') return Promise.reject(new Error('Só HTTPS.'));
  const agente = new Agent({
    keepAlive: false,
    maxSockets: 1,
    ...(pedido.certificadoPem ? { cert: pedido.certificadoPem } : {}),
    ...(pedido.chavePrivadaPem ? { key: pedido.chavePrivadaPem } : {}),
    minVersion: 'TLSv1.2',
  });
  return new Promise<RespostaBanco>((resolve, reject) => {
    const corpo = pedido.corpo ?? '';
    const req = request(url, {
      method: pedido.metodo,
      agent: agente,
      headers: {
        'User-Agent': 'EnturOS-Financeiro/1.0',
        ...pedido.headers,
        ...(corpo ? { 'Content-Length': String(Buffer.byteLength(corpo)) } : {}),
      },
      timeout: pedido.tempoLimiteMs ?? 30_000,
    }, res => {
      const partes: Buffer[] = [];
      let tamanho = 0;
      res.on('data', (c: Buffer) => {
        tamanho += c.length;
        if (tamanho > LIMITE_RESPOSTA_BYTES) { req.destroy(new Error('Resposta grande demais.')); return; }
        partes.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tempo esgotado.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (corpo) req.write(corpo);
    req.end();
  }).finally(() => agente.destroy());
};
