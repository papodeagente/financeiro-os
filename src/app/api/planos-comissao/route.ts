import { createCrudHandlers } from '@/lib/crud-api';
import { conferirPlanoComissaoNoServidor } from '@/lib/plano-comissao-servidor';

export const { GET, POST } = createCrudHandlers('planos_comissao', ['nome'], {
  escritaFinanceira: true,
  conferirNoServidor: conferirPlanoComissaoNoServidor,
});
