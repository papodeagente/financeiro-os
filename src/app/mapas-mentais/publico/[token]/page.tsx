'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CopyPlus, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { ReadonlyMindMap } from '@/components/mapa-mental/ReadonlyMindMap';
import {
  normalizarMapaPublico,
  type MapaMentalPublicPayload,
} from '@/lib/mapa-mental-sharing';

type LoadError = { status: number; message: string };

export default function MapaMentalPublicoPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';
  const [payload, setPayload] = useState<MapaMentalPublicPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);

  const carregar = useCallback(async (signal?: AbortSignal) => {
    if (!token) {
      setError({ status: 404, message: 'Link inválido.' });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mapas-mentais/compartilhados/${encodeURIComponent(token)}`, {
        cache: 'no-store',
        signal,
      });
      if (res.status === 404) throw { status: 404, message: 'Este mapa não foi encontrado.' } satisfies LoadError;
      if (res.status === 410) throw { status: 410, message: 'Este link foi revogado ou expirou.' } satisfies LoadError;
      if (!res.ok) throw { status: res.status, message: 'Não foi possível carregar o mapa.' } satisfies LoadError;
      const json = await res.json().catch(() => null);
      const normalizado = normalizarMapaPublico(json, window.location.origin);
      if (!normalizado) throw { status: 502, message: 'O mapa retornado é inválido.' } satisfies LoadError;
      setPayload(normalizado);
    } catch (cause) {
      if (signal?.aborted) return;
      const falha = cause && typeof cause === 'object' && 'status' in cause && 'message' in cause
        ? cause as LoadError
        : { status: 0, message: 'Não foi possível carregar o mapa.' };
      setPayload(null);
      setError(falha);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar]);

  useEffect(() => {
    if (payload?.mapa.nome) document.title = `${payload.mapa.nome} · Mapa mental`;
  }, [payload]);

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FAFBFC]">
        <div className="text-center text-sm text-slate-500">
          <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-blue-600" />
          Carregando mapa…
        </div>
      </main>
    );
  }

  if (error || !payload) {
    const retryable = !error || ![404, 410].includes(error.status);
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FAFBFC] p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Mapa indisponível</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{error?.message ?? 'Não foi possível abrir este link.'}</p>
          {retryable && (
            <button
              type="button"
              onClick={() => void carregar()}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </button>
          )}
        </div>
      </main>
    );
  }

  const copyUrl = payload.copyUrl
    ?? `/planejamento/mapas-mentais/importar/${encodeURIComponent(token)}`;

  return (
    <main className="flex h-[100dvh] min-h-[520px] flex-col overflow-hidden bg-[#FAFBFC]">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <GitBranch className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold text-slate-900 sm:text-base">{payload.mapa.nome || 'Mapa mental'}</h1>
          <p className="text-[11px] text-slate-500">Visualização pública · somente leitura</p>
        </div>
        {payload.allowCopy && (
          <Link
            href={copyUrl}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 sm:px-4 sm:text-sm"
          >
            <CopyPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Criar uma cópia</span>
            <span className="sm:hidden">Copiar</span>
          </Link>
        )}
      </header>
      <div className="relative min-h-0 flex-1" aria-label={`Mapa mental ${payload.mapa.nome}`}>
        <ReadonlyMindMap mapa={payload.mapa} />
      </div>
    </main>
  );
}
