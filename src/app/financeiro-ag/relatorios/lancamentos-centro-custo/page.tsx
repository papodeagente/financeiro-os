'use client';

// Relatório por centro de custo (05/11/2026).
import { Network } from 'lucide-react';
import { RelatorioLancamentos } from '../RelatorioLancamentos';

export default function LancamentosPorCentroDeCustoPage() {
  return <RelatorioLancamentos visao="centro" icone={Network} />;
}
