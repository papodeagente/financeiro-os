import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('transferencias', ['conta_origem_id', 'conta_destino_id', 'status']);
