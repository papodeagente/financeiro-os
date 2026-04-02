import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('extrato_bancario', ['conta_bancaria_id', 'status_conciliacao']);
