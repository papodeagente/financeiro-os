'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonTable } from '@/components/SkeletonTable';
import { Link2, RefreshCw, Check, X, Copy, Eye, EyeOff, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface CrmConfig {
  ativo: boolean;
  webhook_url_entur: string;
  webhook_url_crm: string;
  api_key_entur: string;
  api_key_crm: string;
  retry_max: number;
  circuit_breaker_threshold: number;
  circuit_breaker_status: string;
  tenant_id?: string;
  suggested_webhook_url_entur?: string;
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

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function CrmConfigPage() {
  const [config, setConfig] = useState<CrmConfig>(defaultConfig);
  const [hmacInput, setHmacInput] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [status, setStatus] = useState<CrmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ sucesso: boolean; latencia_ms?: number; erro?: string } | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [direcao, setDirecao] = useState<'saida' | 'entrada'>('saida');
  const [expandedEvento, setExpandedEvento] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<Record<string, number> | null>(null);
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<Record<string, unknown> | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, statusRes, eventosRes] = await Promise.all([
        fetch('/api/v1/crm/config').then(r => r.json()),
        fetch('/api/v1/crm/status').then(r => r.json()),
        fetch(`/api/v1/crm/eventos?direcao=${direcao}&limite=20`).then(r => r.json()),
      ]);
      if (configRes && !configRes.error) {
        setConfig({ ...defaultConfig, ...configRes });
        setHmacInput('');
        setRevealedSecret(null);
      }
      if (statusRes) setStatus(statusRes);
      if (eventosRes?.items) setEventos(eventosRes.items);
    } catch { /* silent */ }
    setLoading(false);
  }, [direcao]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload: CrmConfig = { ...config };
      // Only send the secret when the user explicitly typed/generated one.
      // Otherwise leave the masked placeholder so the backend preserves it.
      if (hmacInput.trim()) {
        payload.api_key_crm = hmacInput.trim();
        payload.api_key_entur = hmacInput.trim();
      }
      await fetch('/api/v1/crm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await loadAll();
      setHmacInput('');
    } catch { /* silent */ }
    setSaving(false);
  };

  const generateHmac = () => {
    setHmacInput(randomHex(32));
  };

  const revealStoredSecret = async () => {
    try {
      const r = await fetch('/api/v1/crm/config/secret').then(r => r.json());
      if (r.secret) {
        setRevealedSecret(r.secret);
      }
    } catch { /* silent */ }
  };

  const hideStoredSecret = () => setRevealedSecret(null);

  const copyStoredSecret = async () => {
    try {
      let s = revealedSecret;
      if (!s) {
        const r = await fetch('/api/v1/crm/config/secret').then(r => r.json());
        s = r.secret || null;
      }
      if (s) await copy('stored-secret', s);
    } catch { /* silent */ }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* silent */ }
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

  const dispararPendentes = async () => {
    setRetrying(true);
    try {
      const r = await fetch('/api/v1/crm/eventos/disparar-pendentes', { method: 'POST' });
      const j = await r.json();
      if (j.processados > 0) {
        alert(`Disparados: ${j.processados}\nSucesso: ${j.sucesso}\nFalha: ${j.falha}`);
      } else {
        alert('Nenhum evento PENDENTE encontrado. Verifique se a integração está ativa.');
      }
      await loadAll();
    } catch { /* silent */ }
    setRetrying(false);
  };

  const loadDiagnostico = async () => {
    setDiagLoading(true);
    try {
      const r = await fetch('/api/v1/crm/diagnostico').then(r => r.json());
      setDiag(r);
    } catch (e) {
      setDiag({ error: e instanceof Error ? e.message : 'falha' });
    }
    setDiagLoading(false);
  };

  const simularVenda = async () => {
    setSimulating(true);
    setSimResult(null);
    try {
      const r = await fetch('/api/v1/crm/simular-venda', { method: 'POST' }).then(r => r.json());
      setSimResult(r);
      await loadAll();
      await loadDiagnostico();
    } catch (e) {
      setSimResult({ error: e instanceof Error ? e.message : 'falha' });
    }
    setSimulating(false);
  };

  const reprocessarVendas = async () => {
    if (!confirm('Reprocessar vendas antigas? Preenche os campos legados que DRE, Dashboard e Indicadores esperam (valor_final, valor_total_custo, etc.). Idempotente — pode rodar várias vezes.')) return;
    setCleaning(true);
    try {
      const r = await fetch('/api/v1/crm/reprocessar-vendas-legadas', { method: 'POST' });
      const j = await r.json();
      if (j.error) {
        alert('Erro: ' + j.error);
      } else {
        alert(`Vendas no tenant: ${j.total}\nAtualizadas: ${j.atualizadas}\nJá estavam OK: ${j.ja_compatibilidade}\nErros: ${j.erros}`);
      }
      await loadAll();
    } catch (e) {
      alert('Falha: ' + (e instanceof Error ? e.message : ''));
    }
    setCleaning(false);
  };

  const reprocessarVencimentos = async () => {
    if (!confirm('Bumpar contas a receber/pagar PENDENTES com vencimento no passado para o futuro? Mantém a estrutura de parcelas, só atualiza a data. Idempotente — só toca o que está vencido.')) return;
    setCleaning(true);
    try {
      const r = await fetch('/api/v1/crm/reprocessar-vencimentos', { method: 'POST' });
      const j = await r.json();
      if (j.error) {
        alert('Erro: ' + j.error);
      } else {
        alert(`Total pendentes vencidas: ${j.total_pendentes_vencidas}\nReceber atualizadas: ${j.receber_atualizadas}\nPagar atualizadas: ${j.pagar_atualizadas}\nErros: ${j.erros}`);
      }
      await loadAll();
    } catch (e) {
      alert('Falha: ' + (e instanceof Error ? e.message : ''));
    }
    setCleaning(false);
  };

  const cleanupZombies = async () => {
    if (!confirm('Apagar lancamentos antigos do CRM (gravados antes do fix de shape) e liberar reenvio? Acao reversivel apenas via reenvio do CRM.')) return;
    setCleaning(true);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/v1/crm/cleanup-zombies', { method: 'POST' });
      const j = await res.json();
      if (j.ok) {
        setCleanupResult(j.counts);
        await loadAll();
      } else {
        alert('Erro: ' + (j.error || 'desconhecido'));
      }
    } catch (e) {
      alert('Falha na requisicao: ' + (e instanceof Error ? e.message : 'desconhecido'));
    }
    setCleaning(false);
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

  const inboundUrl = config.suggested_webhook_url_entur || config.webhook_url_entur;
  const hasStoredSecret = !!config.api_key_crm && config.api_key_crm.startsWith('****');
  const conected = !!(status?.ativo && hasStoredSecret);

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Integracao CRM" crmBadge />

      {/* Tenant + connection summary */}
      <section className="mb-6">
        <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] p-4 flex items-center gap-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${conected ? 'bg-green-500/10' : 'bg-amber-500/10'}`}>
            <Link2 className={`w-5 h-5 ${conected ? 'text-[var(--crm-ok)]' : 'text-[var(--crm-warn)]'}`} />
          </div>
          <div className="flex-1">
            <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">
              Tenant <span className="font-mono">{config.tenant_id || '—'}</span>
              {' · '}
              {conected ? 'CRM conectado' : 'CRM desconectado'}
            </p>
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">
              {conected
                ? 'Eventos sao trocados automaticamente entre Financeiro e CRM.'
                : 'Configure URL + HMAC abaixo, depois ative a integracao.'}
            </p>
          </div>
        </div>
      </section>

      {/* Setup wizard */}
      <section className="mb-8">
        <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-4">Configuracao</h2>
        <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] p-5 space-y-5">

          {/* HMAC — current vs new (separated) */}
          <div className="space-y-3">
            <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block">HMAC Secret (compartilhado entre Financeiro e CRM)</label>

            {/* Current secret — read-only */}
            <div className="rounded-lg border border-[var(--t-border)] p-3 bg-[var(--t-surface-hover)]/40">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mb-1.5">Secret atual</p>
              {hasStoredSecret ? (
                <div className="flex gap-2 items-center">
                  <code className="flex-1 px-3 py-2 rounded-lg bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] font-mono break-all">
                    {revealedSecret ?? config.api_key_crm}
                  </code>
                  {revealedSecret ? (
                    <button onClick={hideStoredSecret} title="Ocultar"
                      className="px-3 py-2 shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">
                      <EyeOff className="w-4 h-4 text-[var(--t-text-muted)]" />
                    </button>
                  ) : (
                    <button onClick={revealStoredSecret} title="Mostrar valor"
                      className="px-3 py-2 shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">
                      <Eye className="w-4 h-4 text-[var(--t-text-muted)]" />
                    </button>
                  )}
                  <button onClick={copyStoredSecret} title="Copiar para a area de transferencia"
                    className="px-3 py-2 shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">
                    <Copy className="w-4 h-4 text-[var(--t-text-muted)]" />
                  </button>
                </div>
              ) : (
                <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)] italic">
                  Nenhum secret salvo ainda. Defina abaixo e salve a configuracao.
                </p>
              )}
              {copied === 'stored-secret' && (
                <p className="text-[var(--text-caption)] text-[var(--crm-ok)] mt-1">copiado para a area de transferencia</p>
              )}
            </div>

            {/* Set new secret — only used when filled */}
            <div className="rounded-lg border border-[var(--t-border)] p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">
                  Definir novo HMAC <span className="opacity-70">(deixe em branco para manter o atual)</span>
                </p>
                {hmacInput && (
                  <button onClick={() => setHmacInput('')}
                    className="text-[var(--text-caption)] text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
                    Limpar
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={hmacInput}
                  onChange={e => setHmacInput(e.target.value)}
                  placeholder="Cole um secret existente ou clique em Gerar novo"
                  className="flex-1 px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] font-mono"
                />
                <button onClick={generateHmac}
                  className="px-3 py-2 flex items-center gap-1.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">
                  <Sparkles className="w-3.5 h-3.5" /> Gerar novo
                </button>
                {hmacInput && (
                  <button onClick={() => copy('hmac-new', hmacInput)} title="Copiar"
                    className="px-3 py-2 shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">
                    <Copy className="w-4 h-4 text-[var(--t-text-muted)]" />
                  </button>
                )}
              </div>
              {copied === 'hmac-new' && (
                <p className="text-[var(--text-caption)] text-[var(--crm-ok)] mt-1">copiado para a area de transferencia</p>
              )}
            </div>

            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">
              Cole o mesmo valor no CRM em <strong>Settings &gt; Integracoes &gt; Entur OS Financeiro &gt; HMAC Secret</strong>.
            </p>
          </div>

          {/* URL inbound (read-only, copy for CRM) */}
          <div>
            <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">URL para o CRM enviar eventos para o Financeiro</label>
            <div className="flex gap-2">
              <input readOnly value={inboundUrl}
                className="flex-1 px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-surface-hover)] text-[var(--text-body-sm)] text-[var(--t-text-muted)] font-mono" />
              <button onClick={() => copy('inbound', inboundUrl)}
                className="px-3 py-2 shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">
                <Copy className="w-4 h-4 text-[var(--t-text-muted)]" />
              </button>
            </div>
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-1">
              Cole essa URL no CRM em <strong>URL do webhook</strong>.
              {copied === 'inbound' && <span className="ml-2 text-[var(--crm-ok)]">copiado!</span>}
            </p>
          </div>

          {/* URL outbound (CRM webhook) */}
          <div>
            <label htmlFor="crm-url-crm" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">URL do webhook do CRM (para onde o Financeiro envia eventos)</label>
            <input id="crm-url-crm" value={config.webhook_url_crm} onChange={e => setConfig({ ...config, webhook_url_crm: e.target.value })}
              placeholder="https://stagingcrm.enturos.com/api/integracao-financeiro/webhook/<TENANT_CRM>"
              className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] font-mono" />
            <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-1">
              Pegue do CRM. Tipicamente <span className="font-mono">https://stagingcrm.enturos.com/api/integracao-financeiro/webhook/&lt;tenantId-no-CRM&gt;</span>.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="crm-retry" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Maximo de tentativas</label>
              <input id="crm-retry" type="number" value={config.retry_max} onChange={e => setConfig({ ...config, retry_max: parseInt(e.target.value) || 5 })}
                className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            </div>
            <div>
              <label htmlFor="crm-threshold" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Threshold circuit breaker</label>
              <input id="crm-threshold" type="number" value={config.circuit_breaker_threshold} onChange={e => setConfig({ ...config, circuit_breaker_threshold: parseInt(e.target.value) || 10 })}
                className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[var(--t-border)]">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfig({ ...config, ativo: !config.ativo })}
                className={`w-11 h-6 rounded-full transition-colors relative ${config.ativo ? 'bg-[var(--t-green)]' : 'bg-[var(--t-border)]'}`}
              >
                <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${config.ativo ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-[var(--text-body-sm)] text-[var(--t-text)]">
                {config.ativo ? 'Integracao ativa' : 'Integracao pausada'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={testConnection}
                className="px-4 py-2 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)]">
                Testar conexao
              </button>
              {testResult && (
                <span className={`text-[var(--text-body-sm)] flex items-center gap-1 ${testResult.sucesso ? 'text-[var(--crm-ok)]' : 'text-[var(--crm-err)]'}`}>
                  {testResult.sucesso ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  {testResult.sucesso ? `OK (${testResult.latencia_ms}ms)` : testResult.erro}
                </span>
              )}
              <button onClick={saveConfig} disabled={saving}
                className="px-4 py-2 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar configuracao'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Status */}
      {status && (
        <section className="mb-8">
          <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-4">Status em tempo real</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)]">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Circuit breaker</p>
              <p className={`text-[var(--text-body-sm)] font-medium mt-1 ${
                status.circuit_breaker === 'fechado' ? 'text-[var(--crm-ok)]' :
                status.circuit_breaker === 'aberto' ? 'text-[var(--crm-err)]' : 'text-[var(--crm-warn)]'
              }`}>
                {circuitLabel[status.circuit_breaker] || status.circuit_breaker}
              </p>
            </div>
            <div className="p-4 rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)]">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Eventos pendentes / com falha</p>
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)] mt-1">
                {status.eventos_pendentes} pendentes / {status.eventos_falha} falhas
              </p>
            </div>
            <div className="p-4 rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)]">
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">Processados hoje</p>
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)] mt-1">{status.eventos_processados_hoje}</p>
            </div>
          </div>
        </section>
      )}

      {/* Diagnostico — auditoria do estado da integracao */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)]">Diagnostico</h2>
          <div className="flex items-center gap-2">
            <button onClick={loadDiagnostico} disabled={diagLoading}
              className="px-3 py-1.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)] disabled:opacity-50">
              {diagLoading ? 'Carregando...' : 'Recarregar diagnostico'}
            </button>
            <button onClick={simularVenda} disabled={simulating}
              className="px-3 py-1.5 text-[var(--text-body-sm)] text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50">
              {simulating ? 'Simulando...' : 'Simular venda do CRM'}
            </button>
          </div>
        </div>
        <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] p-5">
          {!diag && (
            <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)] italic">
              Clique em <strong>Recarregar diagnostico</strong> para ver config, contagens e ultimos eventos.
            </p>
          )}
          {diag && (
            <pre className="text-[var(--text-caption)] text-[var(--t-text-secondary)] overflow-x-auto whitespace-pre-wrap font-mono max-h-96">
              {JSON.stringify(diag, null, 2)}
            </pre>
          )}
          {simResult && (
            <div className="mt-4 rounded-lg border border-[var(--t-border)] p-3 bg-[var(--t-surface-hover)]/40">
              <p className="text-[var(--text-caption)] font-semibold mb-2"
                 style={{ color: (simResult.ok ? 'var(--crm-ok)' : 'var(--crm-err)') }}>
                {simResult.ok ? 'Simulacao OK' : 'Simulacao FALHOU'}
              </p>
              <pre className="text-[var(--text-caption)] text-[var(--t-text-secondary)] overflow-x-auto whitespace-pre-wrap font-mono max-h-72">
                {JSON.stringify(simResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </section>

      {/* Maintenance — cleanup CRM zombies */}
      <section className="mb-8">
        <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-4">Manutencao</h2>

        {/* Reprocessar vendas legadas */}
        <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">Reprocessar vendas antigas</p>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-1 max-w-2xl">
                Vendas recebidas do CRM antes do fix de sincronia financeira não
                tinham os campos legados que DRE, Dashboard e Indicadores
                esperam (valor_final, valor_total_custo, markup_realizado,
                passageiros/pagantes/produtos, status CONFIRMADO). Este botão
                preenche esses aliases a partir dos campos novos sem perder
                dado nenhum. Idempotente — vendas já corretas são puladas.
              </p>
            </div>
            <button onClick={reprocessarVendas} disabled={cleaning}
              className="px-4 py-2 text-[var(--text-body-sm)] text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50 shrink-0">
              {cleaning ? 'Processando...' : 'Reprocessar vendas'}
            </button>
          </div>
        </div>

        {/* Reprocessar vencimentos atrasados */}
        <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] p-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">Reprocessar vencimentos atrasados</p>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-1 max-w-2xl">
                Vendas legadas geraram contas a receber/pagar com data_vencimento
                no passado (calculado a partir de data_venda antiga). O Fluxo
                de Caixa Projetado filtra só vencimentos futuros, então ficam
                invisíveis. Este botão bumpa as contas PENDENTES vencidas para
                hoje + 30d × parcela. Idempotente — só toca o que está vencido.
              </p>
            </div>
            <button onClick={reprocessarVencimentos} disabled={cleaning}
              className="px-4 py-2 text-[var(--text-body-sm)] text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50 shrink-0">
              {cleaning ? 'Processando...' : 'Reprocessar vencimentos'}
            </button>
          </div>
        </div>

        <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)]">Limpar lancamentos antigos do CRM</p>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-1 max-w-2xl">
                Apaga contas a receber/pagar e vendas gravadas antes do fix
                de shape do payload (R$ NaN, sem cliente). Tambem libera os
                idempotency keys para o CRM poder reenviar os mesmos eventos.
                Idempotente — pode ser executado mais de uma vez sem efeito
                colateral. Acao escopada ao tenant atual.
              </p>
            </div>
            <button onClick={cleanupZombies} disabled={cleaning}
              className="px-4 py-2 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)] disabled:opacity-50 shrink-0">
              {cleaning ? 'Limpando...' : 'Limpar zumbis'}
            </button>
          </div>
          {cleanupResult && (
            <div className="mt-4 rounded-lg border border-[var(--t-border)] p-3 bg-[var(--t-surface-hover)]/40">
              <p className="text-[var(--text-caption)] text-[var(--crm-ok)] font-semibold mb-2">Limpeza concluida</p>
              <ul className="text-[var(--text-caption)] text-[var(--t-text-muted)] space-y-0.5 font-mono">
                <li>contas_receber apagadas: <span className="text-[var(--t-text)]">{cleanupResult.contas_receber_apagadas}</span></li>
                <li>contas_pagar apagadas: <span className="text-[var(--t-text)]">{cleanupResult.contas_pagar_apagadas}</span></li>
                <li>vendas_crm apagadas: <span className="text-[var(--t-text)]">{cleanupResult.vendas_crm_apagadas}</span></li>
                <li>eventos_entrada apagados: <span className="text-[var(--t-text)]">{cleanupResult.eventos_entrada_apagados}</span></li>
                <li>eventos_saida marcados FALHA: <span className="text-[var(--t-text)]">{cleanupResult.eventos_saida_marcados_falha}</span></li>
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Event Log */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)]">Log de eventos</h2>
          <div className="flex items-center gap-2">
            <select value={direcao} onChange={e => setDirecao(e.target.value as 'saida' | 'entrada')}
              className="px-3 py-1.5 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]">
              <option value="saida">Eventos enviados</option>
              <option value="entrada">Eventos recebidos</option>
            </select>
            {direcao === 'saida' && (
              <>
                <button onClick={dispararPendentes} disabled={retrying}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} /> Disparar pendentes
                </button>
                <button onClick={retryAll} disabled={retrying}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] shadow-[var(--t-card-shadow)] rounded-lg hover:bg-[var(--t-sidebar-item-hover)] disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} /> Retentar falhas
                </button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] overflow-hidden">
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
