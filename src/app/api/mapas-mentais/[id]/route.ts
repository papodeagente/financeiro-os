import { createCrudItemHandlers } from '@/lib/crud-api';

const handlers = createCrudItemHandlers('mapas_mentais', ['nome']);

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
