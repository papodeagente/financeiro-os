'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  FileDown,
  Link2,
  Loader2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  normalizarShareState,
  type MapaMentalShareState,
} from '@/lib/mapa-mental-sharing';

interface Props {
  open: boolean;
  mapId: string;
  mapName: string;
  onClose: () => void;
  onExportPdf: () => Promise<void>;
}

type Action = 'create' | 'permission' | 'revoke' | 'pdf' | null;

async function respostaJson(res: Response): Promise<unknown> {
  const texto = await res.text();
  let json: unknown = null;
  if (texto) {
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error('O servidor retornou uma resposta inválida.');
    }
  }
  if (!res.ok) {
    const mensagem = json && typeof json === 'object' && 'error' in json
      && typeof (json as { error?: unknown }).error === 'string'
      ? (json as { error: string }).error
      : `Não foi possível concluir a ação (${res.status}).`;
    throw new Error(mensagem);
  }
  return json;
}

async function copiarTexto(valor: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(valor);
    return;
  } catch {
    const input = document.createElement('textarea');
    input.value = valor;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copiou = document.execCommand('copy');
    input.remove();
    if (!copiou) throw new Error('Não foi possível copiar automaticamente.');
  }
}

export function ShareMapDialog({ open, mapId, mapName, onClose, onExportPdf }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [share, setShare] = useState<MapaMentalShareState | null>(null);
  const [allowCopy, setAllowCopy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState<'public' | 'copy' | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      const res = await fetch(`/api/mapas-mentais/${encodeURIComponent(mapId)}/compartilhar`, {
        cache: 'no-store',
        signal,
      });
      const json = await respostaJson(res);
      if (json && typeof json === 'object' && 'active' in json && json.active === false) {
        setShare(null);
        setAllowCopy(true);
        return;
      }
      const normalizado = normalizarShareState(json, window.location.origin);
      if (!normalizado) throw new Error('O servidor retornou links inválidos.');
      setShare(normalizado);
      setAllowCopy(normalizado.allowCopy);
    } catch (cause) {
      if (signal?.aborted) return;
      setLoadFailed(true);
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o compartilhamento.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [mapId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setCopied(null);
    setConfirmRevoke(false);
    void load(controller.signal);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => controller.abort();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (action) return;
        onClose();
        requestAnimationFrame(() => restoreFocusRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [action, onClose, open]);

  const fechar = () => {
    if (action) return;
    onClose();
    requestAnimationFrame(() => restoreFocusRef.current?.focus());
  };

  const salvarCompartilhamento = async (tipo: 'create' | 'permission') => {
    if (action) return;
    setAction(tipo);
    setError(null);
    setLoadFailed(false);
    try {
      const res = await fetch(`/api/mapas-mentais/${encodeURIComponent(mapId)}/compartilhar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowCopy }),
      });
      const json = await respostaJson(res);
      const normalizado = normalizarShareState(json, window.location.origin);
      if (!normalizado) throw new Error('Os links retornados pelo servidor são inválidos.');
      setShare(normalizado);
      setAllowCopy(normalizado.allowCopy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar os links.');
    } finally {
      setAction(null);
    }
  };

  const revogar = async () => {
    if (action) return;
    setAction('revoke');
    setError(null);
    setLoadFailed(false);
    try {
      const res = await fetch(`/api/mapas-mentais/${encodeURIComponent(mapId)}/compartilhar`, {
        method: 'DELETE',
      });
      await respostaJson(res);
      setShare(null);
      setAllowCopy(true);
      setConfirmRevoke(false);
      setCopied(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível revogar o compartilhamento.');
    } finally {
      setAction(null);
    }
  };

  const copiar = async (tipo: 'public' | 'copy', valor: string) => {
    setError(null);
    setLoadFailed(false);
    try {
      await copiarTexto(valor);
      setCopied(tipo);
      setTimeout(() => setCopied(current => current === tipo ? null : current), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível copiar o link.');
    }
  };

  const exportar = async () => {
    if (action) return;
    setAction('pdf');
    setError(null);
    setLoadFailed(false);
    try {
      await onExportPdf();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o PDF.');
    } finally {
      setAction(null);
    }
  };

  if (!mounted || !open) return null;

  const permissionChanged = !!share && allowCopy !== share.allowCopy;
  const content = (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      onMouseDown={event => { if (event.target === event.currentTarget) fechar(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-map-title"
        className="flex max-h-[min(760px,calc(100dvh-32px))] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Link2 className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="share-map-title" className="text-base font-bold text-slate-900">Compartilhar e exportar</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">{mapName || 'Mapa mental'}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={fechar}
            disabled={action !== null}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {error && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
              {loadFailed && !loading && (
                <button type="button" onClick={() => void load()} className="font-semibold underline">Tentar novamente</button>
              )}
            </div>
          )}

          <section aria-labelledby="share-links-title">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id="share-links-title" className="text-sm font-semibold text-slate-900">Links do mapa</h3>
                <p className="mt-0.5 text-xs text-slate-500">Quem receber o link público verá uma versão somente leitura.</p>
              </div>
              {share && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                  <ShieldCheck className="h-3 w-3" /> Ativo
                </span>
              )}
            </div>

            {loading ? (
              <div className="mt-4 flex items-center justify-center rounded-xl border border-slate-200 py-10 text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando links…
              </div>
            ) : share ? (
              <div className="mt-4 space-y-4">
                <LinkField
                  label="Visualização pública"
                  value={share.publicUrl}
                  copied={copied === 'public'}
                  onCopy={() => void copiar('public', share.publicUrl)}
                />

                {share.allowCopy && share.copyUrl && (
                  <LinkField
                    label="Criar uma cópia no Entur OS FIN"
                    value={share.copyUrl}
                    copied={copied === 'copy'}
                    onCopy={() => void copiar('copy', share.copyUrl!)}
                  />
                )}

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                  <input
                    type="checkbox"
                    checked={allowCopy}
                    onChange={event => setAllowCopy(event.target.checked)}
                    disabled={action !== null}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-slate-800">Disponibilizar link para criar uma cópia</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">O link cria um novo mapa na conta autenticada. Como o conteúdo é público, ele ainda pode ser reproduzido manualmente.</span>
                  </span>
                </label>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  {confirmRevoke ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-red-700">
                      <span>Os links atuais deixarão de funcionar.</span>
                      <button
                        type="button"
                        onClick={() => void revogar()}
                        disabled={action !== null}
                        className="rounded-lg bg-red-600 px-2.5 py-1.5 font-semibold text-white disabled:opacity-60"
                      >
                        {action === 'revoke' ? 'Revogando…' : 'Confirmar revogação'}
                      </button>
                      <button type="button" onClick={() => setConfirmRevoke(false)} className="font-semibold text-slate-600">Cancelar</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(true)}
                      disabled={action !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Revogar links
                    </button>
                  )}
                  {permissionChanged && !confirmRevoke && (
                    <button
                      type="button"
                      onClick={() => void salvarCompartilhamento('permission')}
                      disabled={action !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {action === 'permission' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Salvar permissão
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={allowCopy}
                    onChange={event => setAllowCopy(event.target.checked)}
                    disabled={action !== null}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-slate-800">Gerar também um link para criar cópia</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">O visitante precisará entrar no Entur OS FIN. Ocultar esse link não impede uma reprodução manual do conteúdo público.</span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => void salvarCompartilhamento('create')}
                  disabled={action !== null}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {action === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  {action === 'create' ? 'Gerando links…' : 'Gerar links de compartilhamento'}
                </button>
              </div>
            )}
          </section>

          <section className="mt-6 border-t border-slate-100 pt-5" aria-labelledby="export-map-title">
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 px-4 py-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <FileDown className="h-4 w-4" />
              </div>
              <div className="min-w-[180px] flex-1">
                <h3 id="export-map-title" className="text-sm font-semibold text-slate-900">Exportar mapa inteiro</h3>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                  Expande todos os tópicos e cria páginas de detalhe. Imagens enviadas ao Entur são incluídas; sites externos podem bloquear suas imagens no PDF.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void exportar()}
                disabled={action !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {action === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                {action === 'pdf' ? 'Gerando…' : 'Baixar PDF'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function LinkField({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="flex min-w-0 items-center rounded-xl border border-slate-200 bg-white p-1">
        <input
          value={value}
          readOnly
          onFocus={event => event.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-600 outline-none"
          aria-label={label}
        />
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label={`Abrir ${label.toLowerCase()}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
