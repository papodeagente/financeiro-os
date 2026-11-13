import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('membros', ['nome', 'cargo', 'email']);
