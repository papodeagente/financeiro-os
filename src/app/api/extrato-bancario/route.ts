import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('extrato_bancario', ['conta_bancaria_id', 'status_conciliacao']);
