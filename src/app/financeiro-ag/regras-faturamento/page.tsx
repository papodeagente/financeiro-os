import { Suspense } from 'react';

import { TelaDeRegras } from './TelaDeRegras';

/** Regras de faturamento (E5, parte B): como cada cliente, fornecedor e representante é faturado. */
export default function RegrasDeFaturamentoPage() {
  return (
    <Suspense fallback={null}>
      <TelaDeRegras />
    </Suspense>
  );
}
