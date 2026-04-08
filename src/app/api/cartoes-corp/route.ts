import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('cartoes_corp', ['apelido', 'bandeira']);
