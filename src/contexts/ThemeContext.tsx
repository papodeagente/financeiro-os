'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Chave versionada de propósito. Quem tinha 'entur-theme: dark' salvo cai
 * no claro uma vez, sem que ninguém precise limpar o localStorage remotamente,
 * e continua livre para voltar ao escuro pelo alternador do TopBar.
 */
const STORAGE_KEY = 'entur-theme-v2';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  /** O tema salvo já foi lido do navegador? Antes disso vale o claro. */
  montado: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
  montado: false,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial = saved || 'light';
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  };

  /**
   * O PROVEDOR NUNCA ENGOLE OS FILHOS.
   *
   * Até 29/09/2026 ele devolvia `<div className="h-full" />` enquanto não
   * montava, para "evitar o flash" do tema. O efeito colateral era o app
   * inteiro não ter renderização no servidor: o HTML entregue tinha `html`,
   * `head`, `body` e uma div vazia. Dentro do sistema isso quase não
   * aparece, porque tudo ali é atrás de login — mas a landing pública
   * chegava ao visitante (e ao robô de busca) como página em branco.
   *
   * O flash já era evitado por outro caminho: o script no `<head>` do
   * layout aplica a classe `dark` antes da primeira pintura, e é a CLASSE
   * que o CSS lê. Guardar os filhos por cima disso protegia de um problema
   * que não existia mais.
   *
   * `mounted` continua existindo para quem precisar saber se o tema salvo
   * já foi lido; ele só deixou de decidir se a página aparece.
   */
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, montado: mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
