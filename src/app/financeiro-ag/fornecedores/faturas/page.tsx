import { Suspense } from 'react';
import { TelaDeFaturas } from '@/components/fornecedores/TelaDeFaturas';

// Fatura do fornecedor (E5, parte C).
export default function Page() {
  return (
    <Suspense fallback={null}>
      <TelaDeFaturas />
    </Suspense>
  );
}
