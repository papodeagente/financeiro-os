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

  // Coloca os dados em window pra acessar via console se a UI não mostrar
  if (typeof window !== 'undefined') {
    (window as unknown as { __ENTUR_LAST_ERROR__: unknown }).__ENTUR_LAST_ERROR__ = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      url: window.location.href,
    };
  }

  const errInfo = {
    name: error.name || '(no name)',
    message: error.message || '(no message)',
    digest: error.digest || '(no digest)',
    stack: error.stack || '(no stack)',
  };

  return (
    <div className="px-6 py-8" style={{ minHeight: '60vh' }}>
      <div className="max-w-4xl mx-auto text-center mb-6">
        <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-3" />
        <h2 className="text-xl font-semibold">Algo deu errado</h2>
      </div>

      {/* DEBUG BLOCK — sempre visível, mesmo se campos vierem vazios */}
      <div
        className="max-w-4xl mx-auto border-2 p-4 mb-6"
        style={{
          borderColor: '#dc2626',
          background: '#FEF2F2',
          color: '#7F1D1D',
          fontFamily: 'monospace',
          fontSize: '12px',
          borderRadius: '10px',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>
          DEBUG — error from Next.js error boundary
        </div>
        <div><b>name:</b> {errInfo.name}</div>
        <div><b>message:</b> {errInfo.message}</div>
        <div><b>digest:</b> {errInfo.digest}</div>
        <div style={{ marginTop: '8px' }}><b>stack (primeiras 15 linhas):</b></div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '4px', fontSize: '11px', lineHeight: 1.5 }}>
          {errInfo.stack.split('\n').slice(0, 15).join('\n')}
        </pre>
      </div>

      <div className="max-w-4xl mx-auto text-center">
        <Button onClick={reset} variant="outline">
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
