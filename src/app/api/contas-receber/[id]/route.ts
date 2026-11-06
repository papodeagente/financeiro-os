import { rotasDoTitulo } from '@/lib/rota-do-titulo';

// Uma conta a receber: leitura com versão, edição com o caixa junto (baixa,
// estorno e troca de conta numa transação), exclusão lógica e as travas de
// edição simultânea e da venda. Ver src/lib/rota-do-titulo.ts.
export const { GET, PUT, DELETE } = rotasDoTitulo('contas_receber');
