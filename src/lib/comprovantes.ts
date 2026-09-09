import { mkdir } from 'fs/promises';
import path from 'path';

/**
 * Onde ficam os comprovantes de pagamento e recebimento.
 *
 * Separado de /app/data/uploads de propósito: aquela pasta é servida por
 * rota pública, porque a proposta enviada ao cliente precisa mostrar
 * imagem sem sessão. Comprovante tem dado bancário e valor, então mora em
 * pasta própria, por tenant, servida só com sessão.
 */

const RAIZ_PROD = '/app/data/comprovantes';

/** Nome de pasta seguro, para id de tenant nunca montar caminho que escape. */
function pastaDoTenant(tenantId: string): string {
  return tenantId.replace(/[^\w-]/g, '_');
}

export async function pastaComprovantes(tenantId: string): Promise<string> {
  const raiz = process.env.NODE_ENV !== 'production'
    ? path.join(process.cwd(), '.data', 'comprovantes')
    : RAIZ_PROD;
  const dir = path.join(raiz, pastaDoTenant(tenantId));
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Extensões aceitas. Recibo de banco é PDF ou foto da tela. */
export const TIPOS_COMPROVANTE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export const MIME_COMPROVANTE: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** 10MB: comprovante é recibo, não contrato. */
export const MAX_COMPROVANTE = 10 * 1024 * 1024;
