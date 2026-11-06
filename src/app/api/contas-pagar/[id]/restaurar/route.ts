import { rotasDoTitulo } from '@/lib/rota-do-titulo';

// Restaurar uma conta a pagar excluída: volta igual, em aberto (06/11/2026, E7).
const { RESTAURAR } = rotasDoTitulo('contas_pagar');
export const POST = RESTAURAR;
