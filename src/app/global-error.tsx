'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Algo deu errado</h2>
          <button
            onClick={reset}
            style={{ padding: '0.5rem 1rem', border: '1px solid #ccc', borderRadius: '0.375rem', cursor: 'pointer', background: 'white' }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
