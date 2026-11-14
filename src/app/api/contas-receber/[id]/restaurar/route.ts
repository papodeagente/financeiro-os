import { rotasDoTitulo } from '@/lib/rota-do-titulo';
import { recusaModulo } from '@/lib/guarda-rota';

// Restaurar uma conta a receber excluída: volta igual, em aberto (06/11/2026, E7).
// Só com o núcleo completo (src/lib/modulos.ts).
const { RESTAURAR } = rotasDoTitulo('contas_receber');
export async function POST(req: Request, ctx: Parameters<typeof RESTAURAR>[1]) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  return RESTAURAR(req, ctx);
}
