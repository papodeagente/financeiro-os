import { rotasDoTitulo } from '@/lib/rota-do-titulo';

// Restaurar uma conta a receber excluída: volta igual, em aberto (06/11/2026, E7).
const { RESTAURAR } = rotasDoTitulo('contas_receber');
export const POST = RESTAURAR;
