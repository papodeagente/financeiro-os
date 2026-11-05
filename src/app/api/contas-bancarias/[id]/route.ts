import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('contas_bancarias', ['nome', 'banco'], {
  somenteFinanceiro: true,
  // Conta não liberada por perfil de acesso: some da leitura e não se edita (05/11/2026).
  filtroDeConta: { cadastro: true },
});
