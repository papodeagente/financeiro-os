'use client';

// Relatório por rateio (05/11/2026).
import { Split } from 'lucide-react';
import { RelatorioLancamentos } from '../RelatorioLancamentos';

export default function LancamentosPorRateioPage() {
  return <RelatorioLancamentos visao="rateio" icone={Split} />;
}
