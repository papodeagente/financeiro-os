import { GrupoViagem } from './types';

const STORAGE_KEY = 'grupos-os-data';
const API_BASE = '/api/grupos';

// --- localStorage helpers (internal fallback/cache) ---

function loadLocal(): GrupoViagem[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function saveLocal(grupos: GrupoViagem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(grupos));
}

function saveOneLocal(grupo: GrupoViagem): void {
  const grupos = loadLocal();
  const idx = grupos.findIndex(g => g.id === grupo.id);
  if (idx >= 0) grupos[idx] = grupo; else grupos.push(grupo);
  saveLocal(grupos);
}

// --- Async API functions with localStorage fallback ---

export async function loadGrupos(): Promise<GrupoViagem[]> {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) throw new Error('API error');
    const dbGrupos: GrupoViagem[] = await res.json();

    // Auto-migrate: if DB is empty but localStorage has data, sync up
    if (dbGrupos.length === 0) {
      const localGrupos = loadLocal();
      if (localGrupos.length > 0) {
        await fetch(`${API_BASE}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(localGrupos),
        });
        return localGrupos;
      }
    }

    saveLocal(dbGrupos); // keep localStorage as cache
    return dbGrupos;
  } catch {
    return loadLocal();
  }
}

export async function saveGrupo(grupo: GrupoViagem): Promise<void> {
  grupo.updated_at = new Date().toISOString();
  try {
    await fetch(`${API_BASE}/${grupo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grupo),
    });
  } catch { /* fallback to localStorage only */ }
  saveOneLocal(grupo);
}

export async function saveGrupos(grupos: GrupoViagem[]): Promise<void> {
  try {
    await fetch(`${API_BASE}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grupos),
    });
  } catch { /* fallback */ }
  saveLocal(grupos);
}

export async function deleteGrupo(id: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  } catch { /* fallback */ }
  const grupos = loadLocal().filter(g => g.id !== id);
  saveLocal(grupos);
}

// Pure transforms - stay synchronous
export function exportGrupoJSON(grupo: GrupoViagem): string {
  return JSON.stringify(grupo, null, 2);
}

export function importGrupoJSON(json: string): GrupoViagem | null {
  try {
    const grupo = JSON.parse(json);
    if (grupo && grupo.id && grupo.params) return grupo;
    return null;
  } catch { return null; }
}
