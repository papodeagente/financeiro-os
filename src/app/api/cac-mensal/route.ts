import { createCrudHandlers } from '@/lib/crud-api';
export const { GET, POST } = createCrudHandlers('cac_mensal', ['mes']);
