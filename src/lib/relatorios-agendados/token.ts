/**
 * Token do link de leitura de relatório (E7, G3): sorteado, só o hash vai ao
 * banco. Só no servidor (node:crypto).
 */
import { createHash, randomBytes } from 'node:crypto';

export function novoTokenDeLeitura(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDoTokenDeLeitura(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
