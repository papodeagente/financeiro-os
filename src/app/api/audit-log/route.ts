import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('audit_log', ['usuario_id', 'acao', 'modulo', 'entidade', 'entidade_id']);
