'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Clock, CircleSlash, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';

interface Props {
  grupoId: string;
}

interface SyncStatus {
  crm_configured: boolean;
  circuit_open: boolean;
  ultimo_evento: null | {
    id: string;
    status: 'PENDENTE' | 'ENVIADO' | 'FALHA';
    tentativas: number;
    latencia_ms: number | null;
    proxima_tentativa: string | null;
    created_at: string;
    updated_at: string;
  };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'agora há pouco';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function GrupoSyncStatus({ grupoId }: Props) {
  const [data, setData] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = useCallback(() => {
    setLoading(true);
    fetch(`/api/grupos/${grupoId}/sync-status`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && !d.error) setData(d);
      })
      .catch(() => { /* silent */ })
      .finally(() => setLoading(false));
  }, [grupoId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const reSync = async () => {
    setSyncing(true);
    try {
      const r = await fetch(`/api/grupos/${grupoId}/sync`, { method: 'POST' });
      const j = await r.json();
      if (j.ok) {
        toast.success('Sincronização disparada');
        // aguarda 1s pro evento ser registrado e atualiza
        setTimeout(() => fetchStatus(), 1200);
      } else {
        toast.error('Falha ao sincronizar', j.error);
      }
    } catch (e) {
      toast.error('Falha na requisição', e instanceof Error ? e.message : '');
    }
    setSyncing(false);
  };

  if (loading || !data) {
    return (
      <span className="text-[11px] text-[var(--t-text-muted)] flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Verificando sincronização…
      </span>
    );
  }

  // 1. Config CRM não configurada
  if (!data.crm_configured) {
    return (
      <div className="text-[11px] flex items-center gap-2">
        <CircleSlash className="w-3.5 h-3.5 text-[var(--t-text-muted)]" />
        <span className="text-[var(--t-text-muted)]">CRM não configurado — </span>
        <a href="/config/crm" className="text-[var(--t-green)] hover:underline">Configurar</a>
      </div>
    );
  }

  // 2. Circuit breaker aberto (muitas falhas)
  if (data.circuit_open) {
    return (
      <div className="text-[11px] flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5 text-red-500" />
        <span className="text-red-500">Integração pausada (circuit breaker aberto)</span>
        <a href="/config/crm" className="text-[var(--t-green)] hover:underline">Ver</a>
      </div>
    );
  }

  // 3. Nunca foi enviado
  if (!data.ultimo_evento) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <Clock className="w-3.5 h-3.5 text-[var(--t-text-muted)]" />
        <span className="text-[var(--t-text-muted)]">Ainda não sincronizado com o CRM</span>
        <button
          onClick={reSync}
          disabled={syncing}
          className="ml-1 px-2 py-0.5 text-[10px] rounded-md bg-[var(--t-green)]/10 text-[var(--t-green)] hover:bg-[var(--t-green)]/20 flex items-center gap-1 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Sincronizar agora
        </button>
      </div>
    );
  }

  const evt = data.ultimo_evento;
  // 4. Enviado com sucesso
  if (evt.status === 'ENVIADO') {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
        <span className="text-green-700 dark:text-green-400">
          Sincronizado com o CRM {timeAgo(evt.updated_at)}
        </span>
        {evt.latencia_ms != null && (
          <span className="text-[var(--t-text-muted)]">({evt.latencia_ms}ms)</span>
        )}
        <button
          onClick={reSync}
          disabled={syncing}
          className="ml-1 text-[var(--t-text-muted)] hover:text-[var(--t-text)]"
          title="Reenviar"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </button>
      </div>
    );
  }

  // 5. Falha
  if (evt.status === 'FALHA') {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <AlertCircle className="w-3.5 h-3.5 text-red-500" />
        <span className="text-red-500">
          Falha ao sincronizar {timeAgo(evt.created_at)} ({evt.tentativas} tentativas)
        </span>
        <button
          onClick={reSync}
          disabled={syncing}
          className="ml-1 px-2 py-0.5 text-[10px] rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center gap-1 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Tentar de novo
        </button>
      </div>
    );
  }

  // 6. Pendente
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <Clock className="w-3.5 h-3.5 text-amber-500" />
      <span className="text-amber-600 dark:text-amber-400">
        Aguardando envio… {timeAgo(evt.created_at)}
      </span>
      <button
        onClick={reSync}
        disabled={syncing}
        className="ml-1 px-2 py-0.5 text-[10px] rounded-md bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 flex items-center gap-1 disabled:opacity-50"
      >
        {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Forçar envio
      </button>
    </div>
  );
}
