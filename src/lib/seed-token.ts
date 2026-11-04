/**
 * Token de instalação para as rotas de seed (FIN-10, auditoria 04/11/2026).
 *
 * As rotas de seed precisam ser alcançáveis sem sessão (instalação nova não
 * tem usuário), e por isso estavam abertas a qualquer pessoa na internet. A
 * de usuário ainda devolvia a senha gerada na resposta.
 *
 * Agora só funcionam com o cabeçalho `x-seed-token` igual à variável
 * SEED_TOKEN (32 caracteres ou mais). Sem a variável, as rotas respondem 404.
 */
import { createHash, timingSafeEqual } from 'crypto';

export function seedAutorizado(req: Request): boolean {
  const esperado = (process.env.SEED_TOKEN ?? '').trim();
  if (esperado.length < 32) return false;
  const recebido = (req.headers.get('x-seed-token') ?? '').trim();
  if (!recebido) return false;
  // Compara os hashes: mesmo tamanho sempre, e tempo constante.
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}
