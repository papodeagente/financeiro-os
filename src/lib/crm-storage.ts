// Generic CRUD storage for CRM entities (API-first, no localStorage fallback needed for new entities)

export async function loadEntities<T>(endpoint: string): Promise<T[]> {
  try {
    const res = await fetch(`/api/${endpoint}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function saveEntity<T extends { id: string }>(endpoint: string, item: T): Promise<T> {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  return res.json();
}

export async function updateEntity<T extends { id: string }>(endpoint: string, item: T): Promise<T> {
  const res = await fetch(`/api/${endpoint}/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  return res.json();
}

export async function deleteEntity(endpoint: string, id: string): Promise<void> {
  await fetch(`/api/${endpoint}/${id}`, { method: 'DELETE' });
}

export async function loadAgencia<T>(): Promise<T | null> {
  try {
    const res = await fetch('/api/agencia');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function saveAgencia<T>(data: T): Promise<T> {
  const res = await fetch('/api/agencia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

/**
 * Equipe da agência: a lista ÚNICA de quem trabalha e vende.
 *
 * Vem de `usuarios`, que é o time real cadastrado em Configurações. Antes
 * existia um cadastro paralelo em `membros` que nunca se encontrava com
 * ele: a tela de comissões oferecia vendedor que não era ninguém do time.
 * A forma devolvida continua sendo `Membro` para as telas não precisarem
 * mudar de modelo, mas o `id` agora é o id do usuário, que é exatamente o
 * que `venda.vendedor_id` guarda quando a venda vem do CRM.
 */
export async function loadEquipe<T = unknown>(): Promise<T[]> {
  try {
    const res = await fetch('/api/equipe');
    if (!res.ok) return [];
    const json = await res.json();
    return (json.equipe ?? []) as T[];
  } catch {
    return [];
  }
}
