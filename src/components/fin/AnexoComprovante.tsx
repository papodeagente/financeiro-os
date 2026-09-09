'use client';

import * as React from 'react';
import { FileText, ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Anexo de comprovante numa baixa.
 *
 * Envia para /api/comprovantes, que é autenticada e guarda o arquivo na
 * pasta do tenant. Não usa /api/uploads de propósito: aquela rota é
 * pública, porque a proposta enviada ao cliente precisa servir imagem sem
 * sessão, e comprovante tem dado bancário.
 *
 * Sobe o arquivo na hora da escolha, e não no confirmar, para o usuário
 * ver o erro de tamanho ou formato enquanto ainda pode trocar de arquivo.
 */

export type Anexo = { nome: string; url: string };

export type AnexoComprovanteProps = {
  anexos: Anexo[];
  onChange: (anexos: Anexo[]) => void;
  /** Trava o confirmar da baixa enquanto um envio está em curso. */
  onEnviandoChange?: (enviando: boolean) => void;
  max?: number;
  desabilitado?: boolean;
};

const ACEITOS = '.pdf,.jpg,.jpeg,.png,.webp,.avif';

const BOTAO =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] ' +
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

export function AnexoComprovante({
  anexos,
  onChange,
  onEnviandoChange,
  max = 3,
  desabilitado = false,
}: AnexoComprovanteProps) {
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const idAjuda = React.useId();

  const marcarEnviando = React.useCallback((v: boolean) => {
    setEnviando(v);
    onEnviandoChange?.(v);
  }, [onEnviandoChange]);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const escolhidos = Array.from(e.target.files ?? []);
    // Limpa o input já: sem isso, escolher o MESMO arquivo de novo depois
    // de um erro não dispara evento nenhum e parece que travou.
    e.target.value = '';
    if (escolhidos.length === 0) return;

    const cabem = max - anexos.length;
    if (cabem <= 0) {
      setErro(`No máximo ${max} comprovantes`);
      return;
    }

    setErro(null);
    marcarEnviando(true);
    try {
      const form = new FormData();
      escolhidos.slice(0, cabem).forEach(f => form.append('files', f));
      const r = await fetch('/api/comprovantes', { method: 'POST', body: form });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Não foi possível anexar');
      onChange([...anexos, ...(json.arquivos as Anexo[])]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível anexar');
    } finally {
      marcarEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BOTAO}
          disabled={desabilitado || enviando || anexos.length >= max}
          onClick={() => inputRef.current?.click()}
          aria-describedby={idAjuda}
        >
          {enviando
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            : <Paperclip className="h-4 w-4" aria-hidden />}
          {enviando ? 'Anexando...' : 'Anexar comprovante'}
        </button>
        <span id={idAjuda} className="fin-t-caption text-[var(--fin-text-3)]">
          Opcional. PDF ou imagem, até 10MB.
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACEITOS}
          multiple={max > 1}
          className="sr-only"
          onChange={escolher}
          tabIndex={-1}
          aria-hidden
        />
      </div>

      {erro && (
        <p className="fin-t-caption text-[var(--fin-negative-text)]" role="alert">{erro}</p>
      )}

      {anexos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {anexos.map((a, i) => {
            const ehPdf = a.url.endsWith('.pdf');
            const Icone = ehPdf ? FileText : ImageIcon;
            return (
              <li
                key={a.url}
                className={cn(
                  'flex items-center gap-2 rounded-[var(--fin-r-md)]',
                  'border border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-2 py-1.5',
                )}
              >
                <Icone className="h-4 w-4 shrink-0 text-[var(--fin-text-3)]" aria-hidden />
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate fin-t-caption text-[var(--fin-accent)] underline underline-offset-2"
                >
                  {a.nome}
                </a>
                <button
                  type="button"
                  className="rounded p-1 text-[var(--fin-text-3)] hover:bg-[var(--fin-surface)] hover:text-[var(--fin-negative-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
                  disabled={desabilitado}
                  onClick={() => onChange(anexos.filter((_, j) => j !== i))}
                  aria-label={`Remover ${a.nome}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default AnexoComprovante;
