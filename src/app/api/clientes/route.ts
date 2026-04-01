import { createCrudHandlers } from '@/lib/crud-api';

const handlers = createCrudHandlers('clientes', ['nome', 'tipo']);

export const GET = handlers.GET;

// Override POST to extract cpf_cnpj from either cpf or cnpj field
export async function POST(req: Request) {
  // Clone request to read body, then reconstruct
  const item = await req.json();
  // Map cpf or cnpj to the cpf_cnpj index column
  item.cpf_cnpj = item.tipo === 'PJ' ? (item.cnpj || '') : (item.cpf || '');
  item.nome = item.nome_completo || item.nome_fantasia || '';

  const newReq = new Request(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  return handlers.POST(newReq);
}
