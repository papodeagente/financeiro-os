'use client';

/**
 * Campos do segundo fator nas telas de login.
 *
 * `segredo` presente = primeiro acesso: mostra o QR code para o aplicativo
 * autenticador (Google Authenticator, Microsoft Authenticator, 1Password...)
 * ler com a câmera, com a chave escrita como alternativa, e pede o primeiro
 * código. Sem `segredo` = só o código.
 *
 * O sexto número envia sozinho (`onCompleto`): ninguém precisa clicar em
 * Entrar depois de digitar o código.
 */
import { QrDoAutenticador } from './QrDoAutenticador';

export interface EstadoSegundoFator {
  segredo?: string;
  uri?: string;
}

export function SegundoFatorCampos({
  estado, codigo, onCodigo, onCompleto,
}: {
  estado: EstadoSegundoFator;
  codigo: string;
  onCodigo: (v: string) => void;
  onCompleto?: (v: string) => void;
}) {
  const grupos = estado.segredo ? estado.segredo.match(/.{1,4}/g)?.join(' ') : '';
  return (
    <div className="space-y-3">
      {estado.segredo && (
        <div className="rounded-lg border border-[var(--fin-border)] bg-[var(--fin-surface)] p-3 text-sm text-[var(--fin-text)] space-y-3">
          <p className="font-medium">Cadastre o segundo fator</p>
          <p className="text-[var(--fin-text-3)]">
            No celular, abra o aplicativo autenticador, toque em adicionar conta e leia o QR code.
          </p>
          {estado.uri && <QrDoAutenticador uri={estado.uri} />}
          <details className="text-[var(--fin-text-3)]">
            <summary className="cursor-pointer text-[var(--fin-accent)]">Não consegue ler o QR?</summary>
            <p className="mt-2">Escolha adicionar com chave e digite:</p>
            <p className="mt-1 font-mono text-base tracking-wider text-[var(--fin-text)] select-all break-all">{grupos}</p>
            {estado.uri && (
              <a href={estado.uri} className="mt-1 inline-block text-[var(--fin-accent)] underline underline-offset-2">
                Abrir no aplicativo deste aparelho
              </a>
            )}
          </details>
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
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
            onCodigo(v);
            if (v.length === 6 && codigo.length !== 6) onCompleto?.(v);
          }}
          placeholder="000000"
          autoFocus
          required
          className="w-full h-11 px-4 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] text-base tracking-[0.3em] placeholder:text-[var(--t-text-muted)] focus:outline-none"
        />
      </div>
    </div>
  );
}

/** "Manter conectado neste navegador": sessão de 15 dias e sem código por 30. */
export function ManterConectado({ marcado, onMudar }: { marcado: boolean; onMudar: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm text-[var(--t-text-secondary,var(--fin-text-3))] cursor-pointer select-none">
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => onMudar(e.target.checked)}
        className="mt-0.5 size-4 accent-[var(--fin-accent)]"
      />
      <span>
        Manter conectado neste navegador
        <span className="block text-xs opacity-80">Não use em computador compartilhado.</span>
      </span>
    </label>
  );
}
