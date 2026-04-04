import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('planejamento_projetos', ['nome', 'status']);
