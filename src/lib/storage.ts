import { GrupoViagem } from './types';

const STORAGE_KEY = 'grupos-os-data';

export function loadGrupos(): GrupoViagem[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveGrupos(grupos: GrupoViagem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(grupos));
}

export function saveGrupo(grupo: GrupoViagem): void {
  const grupos = loadGrupos();
  const idx = grupos.findIndex(g => g.id === grupo.id);
  grupo.updated_at = new Date().toISOString();
  if (idx >= 0) {
    grupos[idx] = grupo;
  } else {
    grupos.push(grupo);
  }
  saveGrupos(grupos);
}

export function deleteGrupo(id: string): void {
  const grupos = loadGrupos().filter(g => g.id !== id);
  saveGrupos(grupos);
}

export function exportGrupoJSON(grupo: GrupoViagem): string {
  return JSON.stringify(grupo, null, 2);
}

export function importGrupoJSON(json: string): GrupoViagem | null {
  try {
    const grupo = JSON.parse(json);
    if (grupo && grupo.id && grupo.params) return grupo;
    return null;
  } catch {
    return null;
  }
}
