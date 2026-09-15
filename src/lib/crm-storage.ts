// Generic CRUD storage for CRM entities (API-first, no localStorage fallback needed for new entities)

/**
 * Carrega uma lista e DIZ se falhou.
 *
 * POR QUE EXISTE. `loadEntities` devolve [] tanto quando a agência não tem
 * nada quanto quando a API caiu, e as telas não têm como distinguir os dois.
 * O resultado é um gráfico anunciando "nenhuma venda em setembro" durante uma
 * queda — que, com a manchete em 44px, é pior do que não desenhar nada.
 *
 * Quem precisa da diferença (todo gráfico e todo estado vazio com motivo) usa
 * esta função. `loadEntities` continua existindo com a assinatura antiga para
 * as telas que ainda só listam.
 */
export async function carregarEntidades<T>(
  endpoint: string,
): Promise<{ dados: T[]; erro: string | null }> {
  try {
    const res = await fetch(`/api/${endpoint}`);
    if (!res.ok) return { dados: [], erro: `Falha ao carregar (${res.status})` };
    const corpo = await res.json();
    // Uma resposta fora de forma é falha, não lista vazia: devolver [] aqui
    // reintroduziria exatamente a ambiguidade que esta função existe para tirar.
    if (!Array.isArray(corpo)) return { dados: [], erro: 'Resposta em formato inesperado' };
    return { dados: corpo as T[], erro: null };
  } catch {
    return { dados: [], erro: 'Sem conexão com o servidor' };
  }
}

export async function loadEntities<T>(endpoint: string): Promise<T[]> {
  const { dados } = await carregarEntidades<T>(endpoint);
  return dados;
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
  // A resposta era ignorada: um DELETE que falhava (sem permissão, erro de
  // transação, sessão expirada) passava por sucesso. A tela dizia "removido",
  // recarregava e o registro voltava — e quem apagou ficava achando que
  // apagou. Agora o erro sobe e a tela mostra o motivo.
  const res = await fetch(`/api/${endpoint}/${id}`, { method: 'DELETE' });
  if (res.ok) return;
  let motivo = '';
  try {
    const corpo = await res.json();
    motivo = typeof corpo?.error === 'string' ? corpo.error : '';
  } catch {
    motivo = '';
  }
  throw new Error(motivo || `Não foi possível excluir (erro ${res.status}).`);
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
