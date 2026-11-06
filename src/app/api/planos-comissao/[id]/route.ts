import { createCrudItemHandlers } from '@/lib/crud-api';
import { conferirPlanoComissaoNoServidor } from '@/lib/plano-comissao-servidor';

export const { GET, PUT, DELETE } = createCrudItemHandlers('planos_comissao', ['nome'], {
  escritaFinanceira: true,
  conferirNoServidor: conferirPlanoComissaoNoServidor,
});
