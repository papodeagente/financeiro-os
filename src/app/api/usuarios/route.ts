import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('usuarios', ['nome', 'email']);
