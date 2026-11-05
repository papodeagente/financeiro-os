'use client';

/**
 * Campos do segundo fator nas telas de login.
 *
 * `segredo` presente = primeiro acesso: mostra a chave para cadastrar no
 * aplicativo autenticador (Google Authenticator, Microsoft Authenticator,
 * 1Password...) e pede o primeiro código. Sem `segredo` = só o código.
 */
export interface EstadoSegundoFator {
  segredo?: string;
  uri?: string;
}

export function SegundoFatorCampos({
  estado, codigo, onCodigo,
}: { estado: EstadoSegundoFator; codigo: string; onCodigo: (v: string) => void }) {
  const grupos = estado.segredo ? estado.segredo.match(/.{1,4}/g)?.join(' ') : '';
  return (
    <div className="space-y-3">
      {estado.segredo && (
        <div className="rounded-lg border border-[var(--fin-border)] bg-[var(--fin-surface)] p-3 text-sm text-[var(--fin-text)] space-y-2">
          <p className="font-medium">Cadastre o segundo fator</p>
          <p className="text-[var(--fin-text-3)]">
            Abra o aplicativo autenticador no celular, escolha adicionar conta e digite a chave abaixo.
            Depois informe o código de 6 números que o aplicativo mostrar.
          </p>
          <p className="font-mono text-base tracking-wider select-all break-all">{grupos}</p>
          {estado.uri && (
            <a href={estado.uri} className="inline-block text-[var(--fin-accent)] underline underline-offset-2">
              Abrir no aplicativo deste aparelho
            </a>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="codigo-2fa" className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide font-medium">
          Código do aplicativo
        </label>
        <input
          id="codigo-2fa"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          value={codigo}
          onChange={(e) => onCodigo(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
          placeholder="000000"
          autoFocus
          required
          className="w-full h-11 px-4 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] text-base tracking-[0.3em] placeholder:text-[var(--t-text-muted)] focus:outline-none"
        />
      </div>
    </div>
  );
}
