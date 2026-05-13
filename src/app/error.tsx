'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center px-6 py-8">
      <AlertTriangle className="h-12 w-12 text-destructive" />
      <h2 className="text-xl font-semibold">Algo deu errado</h2>
      <p className="text-muted-foreground max-w-md">
        Ocorreu um erro inesperado. Tente novamente ou entre em contato com o suporte se o problema persistir.
      </p>
      {/* Mensagem do erro — sempre visível para facilitar debug em produção. */}
      <pre className="max-w-3xl w-full text-left text-xs bg-[var(--lg-neg-fill)] text-[var(--lg-neg)] border border-[var(--lg-border-base)] rounded-[10px] p-4 overflow-auto whitespace-pre-wrap break-words">
        <strong>{error.name}: {error.message}</strong>
        {error.digest && <span className="block opacity-60 mt-1">digest: {error.digest}</span>}
        {error.stack && <span className="block mt-2 opacity-80 text-[10px] leading-relaxed">{error.stack.split('\n').slice(0, 12).join('\n')}</span>}
      </pre>
      <Button onClick={reset} variant="outline">
        Tentar novamente
      </Button>
    </div>
  );
}
