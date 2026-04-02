import { createCrudItemHandlers } from '@/lib/crud-api';
export const { GET, PUT, DELETE } = createCrudItemHandlers('transferencias', ['conta_origem_id', 'conta_destino_id', 'status']);
