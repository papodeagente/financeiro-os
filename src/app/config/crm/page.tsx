'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonTable } from '@/components/SkeletonTable';
import { Link2, RefreshCw, Check, X, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

interface CrmConfig {
  ativo: boolean;
  webhook_url_entur: string;
  webhook_url_crm: string;
  api_key_entur: string;
  api_key_crm: string;
  retry_max: number;
  circuit_breaker_threshold: number;
  circuit_breaker_status: string;
}

interface CrmStatus {
  ativo: boolean;
  circuit_breaker: string;
  eventos_pendentes: number;
  eventos_falha: number;
  eventos_processados_hoje: number;
  ultimo_evento_saida: { tipo: string; status: string; timestamp: string } | null;
  ultimo_evento_entrada: { tipo: string; processado: boolean; timestamp: string } | null;
}

interface Evento {
  id: string;
  tipo: string;
  status: string;
  tentativas?: number;
  latencia_ms?: number;
  processado?: boolean;
  created_at: string;
  data: Record<string, unknown>;
}

const defaultConfig: CrmConfig = {
  ativo: false,
  webhook_url_entur: '',
  webhook_url_crm: '',
  api_key_entur: '',
  api_key_crm: '',
  retry_max: 5,
  circuit_breaker_threshold: 10,
  circuit_breaker_status: 'fechado',
};

export default function CrmConfigPage() {
  const [config, setConfig] = useState<CrmConfig>(defaultConfig);
  const [status, setStatus] = useState<CrmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ sucesso: boolean; latencia_ms?: number; erro?: string } | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [direcao, setDirecao] = useState<'saida' | 'entrada'>('saida');
  const [expandedEvento, setExpandedEvento] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, statusRes, eventosRes] = await Promise.all([
        fetch('/api/v1/crm/config').then(r => r.json()),
        fetch('/api/v1/crm/status').then(r => r.json()),
        fetch(`/api/v1/crm/eventos?direcao=${direcao}&limite=20`).then(r => r.json()),
      ]);
      if (configRes && !configRes.error) setConfig({ ...defaultConfig, ...configRes });
      if (statusRes) setStatus(statusRes);
      if (eventosRes?.items) setEventos(eventosRes.items);
    } catch { /* silent */ }
    setLoading(false);
  }, [direcao]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await fetch('/api/v1/crm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
    } catch { /* silent */ }
    setSaving(false);
  };

  const testConnection = async () => {
    setTestResult(null);
    try {
      const res = await fetch('/api/v1/crm/config/testar', { method: 'POST' });
      setTestResult(await res.json());
    } catch {
      setTestResult({ sucesso: false, erro: 'Falha na requisicao' });
    }
  };

  const retryAll = async () => {
    setRetrying(true);
    try {
      await fetch('/api/v1/crm/eventos/retentar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await loadAll();
    } catch { /* silent */ }
    setRetrying(false);
  };

  const retrySingle = async (id: string) => {
    try {
      await fetch('/api/v1/crm/eventos/retentar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      await loadAll();
    } catch { /* silent */ }
  };

  if (loading) return (
    <div className="p-6">
      <PageHeader title="Integracao CRM" crmBadge />
      <SkeletonTable rows={5} cols={4} />
    </div>
  );

  const circuitLabel: Record<string, string> = {
    fechado: 'Fechado (normal)',
    aberto: 'Aberto (pausado por falhas)',
    'semi-aberto': 'Semi-aberto (testando)',
  };

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Integracao CRM" crmBadge />

      {/* Configuration */}
      <section className="mb-8">
        <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-4">Configuracao</h2>
        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">Integracao ativa</p>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Desabilitar pausa a emissao sem perder dados</p>
            </div>
            <button
              onClick={() => setConfig({ ...config, ativo: !config.ativo })}
              className={`w-11 h-6 rounded-full transition-colors relative ${config.ativo ? 'bg-[var(--t-green)]' : 'bg-[var(--t-border)]'}`}
            >
              <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${config.ativo ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="crm-url-crm" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">URL do webhook do CRM</label>
              <input id="crm-url-crm" value={config.webhook_url_crm} onChange={e => setConfig({ ...config, webhook_url_crm: e.target.value })}
                placeholder="https://crm.example.com/webhook"
                className="w-full px-3 py-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            </div>
            <div>
              <label htmlFor="crm-url-entur" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">URL do webhook do Entur OS</label>
              <input id="crm-url-entur" value={config.webhook_url_entur} onChange={e => setConfig({ ...config, webhook_url_entur: e.target.value })}
                placeholder="https://entur.example.com/api/v1/crm/webhook"
                className="w-full px-3 py-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="crm-key-crm" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">API Key do CRM</label>
              <input id="crm-key-crm" type="password" value={config.api_key_crm} onChange={e => setConfig({ ...config, api_key_crm: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            </div>
            <div>
              <label htmlFor="crm-key-entur" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">API Key do Entur OS (somente leitura)</label>
              <div className="flex gap-2">
                <input id="crm-key-entur" readOnly value={config.api_key_entur || 'Gerar ao salvar'}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface-hover)] text-[var(--text-body-sm)] text-[var(--t-text-muted)]" />
                <button onClick={() => { navigator.clipboard.writeText(config.api_key_entur); }} className="px-3 py-2 text-[var(--text-caption)] text-[var(--t-text-muted)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">Copiar</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="crm-retry" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Maximo de tentativas</label>
              <input id="crm-retry" type="number" value={config.retry_max} onChange={e => setConfig({ ...config, retry_max: parseInt(e.target.value) || 5 })}
                className="w-full px-3 py-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            </div>
            <div>
              <label htmlFor="crm-threshold" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Threshold circuit breaker</label>
              <input id="crm-threshold" type="number" value={config.circuit_breaker_threshold} onChange={e => setConfig({ ...config, circuit_breaker_threshold: parseInt(e.target.value) || 10 })}
                className="w-full px-3 py-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={saveConfig} disabled={saving}
              className="px-4 py-2 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar configuracao'}
            </button>
            <button onClick={testConnection}
              className="px-4 py-2 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">
              Testar conexao
            </button>
            {testResult && (
              <span className={`text-[var(--text-body-sm)] flex items-center gap-1 ${testResult.sucesso ? 'text-[var(--crm-ok)]' : 'text-[var(--crm-err)]'}`}>
                {testResult.sucesso ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                {testResult.sucesso ? `OK (${testResult.latencia_ms}ms)` : testResult.erro}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Status */}
      {status && (
        <section className="mb-8">
          <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-4">Status em tempo real</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)]">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Circuit breaker</p>
              <p className={`text-[var(--text-body-sm)] font-medium mt-1 ${
                status.circuit_breaker === 'fechado' ? 'text-[var(--crm-ok)]' :
                status.circuit_breaker === 'aberto' ? 'text-[var(--crm-err)]' : 'text-[var(--crm-warn)]'
              }`}>
                {circuitLabel[status.circuit_breaker] || status.circuit_breaker}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)]">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Eventos pendentes / com falha</p>
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)] mt-1">
                {status.eventos_pendentes} pendentes / {status.eventos_falha} falhas
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)]">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Processados hoje</p>
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)] mt-1">{status.eventos_processados_hoje}</p>
            </div>
          </div>
        </section>
      )}

      {/* Event Log */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)]">Log de eventos</h2>
          <div className="flex items-center gap-2">
            <select value={direcao} onChange={e => setDirecao(e.target.value as 'saida' | 'entrada')}
              className="px-3 py-1.5 rounded-lg border border-[var(--t-border)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]">
              <option value="saida">Eventos enviados</option>
              <option value="entrada">Eventos recebidos</option>
            </select>
            {direcao === 'saida' && (
              <button onClick={retryAll} disabled={retrying}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)] disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} /> Retentar falhas
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden">
          {eventos.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--text-body-sm)] text-[var(--t-text-muted)]">
              Nenhum evento registrado. Configure a integracao para comecar.
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-[var(--text-caption)] text-[var(--t-text-muted)] border-b border-[var(--t-border)]">
                  <th className="px-4 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">Tipo</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  {direcao === 'saida' && <th className="px-4 py-2.5 font-medium">Tentativas</th>}
                  {direcao === 'saida' && <th className="px-4 py-2.5 font-medium">Latencia</th>}
                  <th className="px-4 py-2.5 font-medium w-24">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map(evt => (
                  <>
                    <tr key={evt.id} className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] transition-colors">
                      <td className="px-4 py-2.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)]">
                        {new Date(evt.created_at).toLocaleString('pt-BR')}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-body-sm)] text-[var(--t-text)]">{evt.tipo}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[var(--text-caption)] px-2 py-0.5 rounded-full ${
                          evt.status === 'ENVIADO' || evt.status === 'PROCESSADO' ? 'bg-green-500/10 text-[var(--crm-ok)]' :
                          evt.status === 'FALHA' ? 'bg-red-500/10 text-[var(--crm-err)]' :
                          'bg-amber-500/10 text-[var(--crm-warn)]'
                        }`}>{evt.status}</span>
                      </td>
                      {direcao === 'saida' && <td className="px-4 py-2.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)]">{evt.tentativas || 0}</td>}
                      {direcao === 'saida' && <td className="px-4 py-2.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)]">{evt.latencia_ms ? `${evt.latencia_ms}ms` : '—'}</td>}
                      <td className="px-4 py-2.5 flex items-center gap-1">
                        <button onClick={() => setExpandedEvento(expandedEvento === evt.id ? null : evt.id)}
                          className="p-1 rounded hover:bg-[var(--t-sidebar-item-hover)]" aria-label="Ver payload">
                          {expandedEvento === evt.id ? <ChevronUp className="w-3.5 h-3.5 text-[var(--t-text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--t-text-muted)]" />}
                        </button>
                        {direcao === 'saida' && evt.status === 'FALHA' && (
                          <button onClick={() => retrySingle(evt.id)}
                            className="p-1 rounded hover:bg-[var(--t-sidebar-item-hover)]" aria-label="Retentar">
                            <RefreshCw className="w-3.5 h-3.5 text-[var(--crm-warn)]" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedEvento === evt.id && (
                      <tr key={`${evt.id}-detail`}>
                        <td colSpan={6} className="px-4 py-3 bg-[var(--t-surface-hover)]">
                          <pre className="text-[var(--text-caption)] text-[var(--t-text-secondary)] overflow-x-auto whitespace-pre-wrap font-mono max-h-48">
                            {JSON.stringify(evt.data, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
