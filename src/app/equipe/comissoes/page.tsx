'use client';

import { useModulos } from '@/components/useModulos';
import TelaCompleta from './TelaCompleta';
import TelaSimples from './TelaSimples';

/**
 * Tela que existe nas duas versões (14/11/2026, modulos.ts). A agência com o módulo "Comissões por função"
 * abre a versão completa (comissões por função); sem ele, a tela da versão simples, igual
 * à de `origin/main` (a9fd7cf), congelada em TelaSimples.tsx
 * (scripts/test-telas-simples-congeladas.mjs).
 */
export default function Pagina() {
  const modulos = useModulos();
  if (modulos.carregando) return null;
  return modulos.tem('comissoes') ? <TelaCompleta /> : <TelaSimples />;
}
