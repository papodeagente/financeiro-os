import { createCrudHandlers } from '@/lib/crud-api';

const handlers = createCrudHandlers('mapas_mentais', ['nome']);

export const GET = handlers.GET;
export const POST = handlers.POST;
