'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CopyPlus, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import {
  normalizarMapaPublico,
  redirectSeguroDaCopia,
  type MapaMentalPublicPayload,
} from '@/lib/mapa-mental-sharing';

interface LoadError { status: number; message: string }

export default function ImportarMapaMentalPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = typeof params?.token === 'string' ? params.token : '';
  const [payload, setPayload] = useState<MapaMentalPublicPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const carregar = useCallback(async (signal?: AbortSignal) => {
    if (!token) {
      setError({ status: 404, message: 'Link de cópia inválido.' });
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
      if (res.status === 404) throw { status: 404, message: 'Este compartilhamento não foi encontrado.' } satisfies LoadError;
      if (res.status === 410) throw { status: 410, message: 'Este link foi revogado ou expirou.' } satisfies LoadError;
      if (!res.ok) throw { status: res.status, message: 'Não foi possível consultar o mapa.' } satisfies LoadError;
      const json = await res.json().catch(() => null);
      const normalizado = normalizarMapaPublico(json, window.location.origin);
      if (!normalizado) throw { status: 502, message: 'O mapa retornado é inválido.' } satisfies LoadError;
      if (!normalizado.allowCopy) throw { status: 403, message: 'O proprietário não permite mais criar cópias deste mapa.' } satisfies LoadError;
      setPayload(normalizado);
    } catch (cause) {
      if (signal?.aborted) return;
      const falha = cause && typeof cause === 'object' && 'status' in cause && 'message' in cause
        ? cause as LoadError
        : { status: 0, message: 'Não foi possível consultar o mapa.' };
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

  const copiar = async () => {
    if (!payload || copying) return;
    setCopying(true);
    setCopyError(null);
    try {
      const res = await fetch(`/api/mapas-mentais/compartilhados/${encodeURIComponent(token)}/copiar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = await res.json().catch(() => null) as { id?: unknown; redirectUrl?: unknown; error?: unknown } | null;
      if (!res.ok) {
        const message = typeof json?.error === 'string' ? json.error : `Não foi possível criar a cópia (${res.status}).`;
        throw new Error(message);
      }
      const destino = redirectSeguroDaCopia(json?.redirectUrl, json?.id);
      if (!destino) throw new Error('A cópia foi criada, mas o destino retornado é inválido.');
      router.replace(destino);
    } catch (cause) {
      setCopyError(cause instanceof Error ? cause.message : 'Não foi possível criar a cópia.');
      setCopying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center p-6 text-sm text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" /> Consultando mapa…
      </div>
    );
  }

  if (error || !payload) {
    const retryable = !error || ![403, 404, 410].includes(error.status);
    return (
      <div className="mx-auto flex min-h-[480px] max-w-xl items-center px-6 py-10">
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Não foi possível copiar este mapa</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{error?.message ?? 'O compartilhamento está indisponível.'}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {retryable && (
              <button
                type="button"
                onClick={() => void carregar()}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <RefreshCw className="h-4 w-4" /> Tentar novamente
              </button>
            )}
            <Link
              href="/planejamento/mapas-mentais"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" /> Meus mapas
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const totalNodes = Object.keys(payload.mapa.nodes).length;
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/planejamento/mapas-mentais" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Voltar para meus mapas
      </Link>
      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 to-emerald-50 px-7 py-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
            <GitBranch className="h-6 w-6" />
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-blue-600">Mapa compartilhado</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{payload.mapa.nome || 'Mapa mental'}</h1>
          <p className="mt-2 text-sm text-slate-500">{totalNodes} {totalNodes === 1 ? 'tópico' : 'tópicos'}</p>
        </div>
        <div className="px-7 py-6">
          <h2 className="text-sm font-semibold text-slate-900">Criar uma cópia na sua conta?</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Um novo mapa editável será criado. Alterações na sua cópia não afetam o mapa original.
          </p>
          {copyError && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {copyError}
            </div>
          )}
          <button
            type="button"
            onClick={() => void copiar()}
            disabled={copying}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CopyPlus className="h-4 w-4" />}
            {copying ? 'Criando sua cópia…' : 'Criar cópia e abrir no editor'}
          </button>
        </div>
      </div>
    </div>
  );
}
