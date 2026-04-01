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
