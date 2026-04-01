'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AppContextType {
  activeGrupoId: string | null;
  activeGrupoLabel: string;
  setActiveGrupo: (id: string | null, label?: string) => void;
}

const AppContext = createContext<AppContextType>({
  activeGrupoId: null,
  activeGrupoLabel: '',
  setActiveGrupo: () => {},
});

export const useApp = () => useContext(AppContext);

export function AppProvider({ children }: { children: ReactNode }) {
  const [activeGrupoId, setActiveGrupoId] = useState<string | null>(null);
  const [activeGrupoLabel, setActiveGrupoLabel] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('grupos-os-active-grupo');
    const storedLabel = localStorage.getItem('grupos-os-active-grupo-label');
    if (stored) {
      setActiveGrupoId(stored);
      setActiveGrupoLabel(storedLabel || '');
    }
  }, []);

  const setActiveGrupo = (id: string | null, label?: string) => {
    setActiveGrupoId(id);
    setActiveGrupoLabel(label || '');
    if (id) {
      localStorage.setItem('grupos-os-active-grupo', id);
      localStorage.setItem('grupos-os-active-grupo-label', label || '');
    } else {
      localStorage.removeItem('grupos-os-active-grupo');
      localStorage.removeItem('grupos-os-active-grupo-label');
    }
  };

  return (
    <AppContext.Provider value={{ activeGrupoId, activeGrupoLabel, setActiveGrupo }}>
      {children}
    </AppContext.Provider>
  );
}
