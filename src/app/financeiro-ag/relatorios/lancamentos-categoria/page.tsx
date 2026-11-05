'use client';

// Relatório por categoria (05/11/2026).
import { Tags } from 'lucide-react';
import { RelatorioLancamentos } from '../RelatorioLancamentos';

export default function LancamentosPorCategoriaPage() {
  return <RelatorioLancamentos visao="categoria" icone={Tags} />;
}
