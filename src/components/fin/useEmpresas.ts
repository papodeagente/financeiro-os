'use client';

/**
 * As empresas da agência para as telas (06/11/2026, E7 G2).
 *
 * Uma leitura só por carregamento de página, dividida por todos os
 * componentes que perguntam (seletor, rateio, conta bancária, cartão, perfil
 * de acesso, configurações). Com uma empresa só, `multi = false` e nenhum
 * componente desenha nada de multiempresa.
 */
import * as React from 'react';

import type { Empresa } from '@/lib/empresas';

export interface ContextoDeEmpresas {
  empresas: Empresa[];
  multi: boolean;
  /** O que a pessoa marcou no seletor (vazio = todas). */
  selecao: string[];
  /** Liberadas pelo perfil de acesso (null = todas). */
  permitidas: string[] | null;
  /** O recorte que vale agora (null = todas). */
  visiveis: string[] | null;
  pode_editar: boolean;
}

const VAZIO: ContextoDeEmpresas = { empresas: [], multi: false, selecao: [], permitidas: null, visiveis: null, pode_editar: false };

let emCurso: Promise<ContextoDeEmpresas> | null = null;

async function ler(): Promise<ContextoDeEmpresas> {
  try {
    const res = await fetch('/api/empresas', { cache: 'no-store' });
    if (!res.ok) return VAZIO;
    const corpo = (await res.json()) as Partial<ContextoDeEmpresas>;
    return {
      empresas: Array.isArray(corpo.empresas) ? corpo.empresas : [],
      multi: corpo.multi === true,
      selecao: Array.isArray(corpo.selecao) ? corpo.selecao : [],
      permitidas: Array.isArray(corpo.permitidas) ? corpo.permitidas : null,
      visiveis: Array.isArray(corpo.visiveis) ? corpo.visiveis : null,
      pode_editar: corpo.pode_editar === true,
    };
  } catch {
    return VAZIO;
  }
}

/** Esquece a leitura guardada (depois de cadastrar empresa ou mudar o seletor). */
export function esquecerEmpresas(): void {
  emCurso = null;
}

export function useEmpresas(): ContextoDeEmpresas & { carregando: boolean } {
  const [estado, setEstado] = React.useState<ContextoDeEmpresas & { carregando: boolean }>({ ...VAZIO, carregando: true });
  React.useEffect(() => {
    let vivo = true;
    if (!emCurso) emCurso = ler();
    emCurso.then(c => { if (vivo) setEstado({ ...c, carregando: false }); });
    return () => { vivo = false; };
  }, []);
  return estado;
}

/** Nome da empresa pelo id (para colunas e rótulos). */
export function nomeDaEmpresa(empresas: readonly Empresa[], id: string | null | undefined): string {
  const alvo = id || 'principal';
  return empresas.find(e => e.id === alvo)?.nome ?? '';
}

/** O recorte de empresas de agora, para as telas que somam no navegador (null = todas). */
export async function lerEmpresasVisiveis(): Promise<string[] | null> {
  if (!emCurso) emCurso = ler();
  return (await emCurso).visiveis;
}
