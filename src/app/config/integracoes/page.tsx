'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Settings, Plane, Hotel, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Save, BarChart3, Database, RefreshCw, Sparkles,
} from 'lucide-react';
import type { ConfiguracaoAPIs } from '@/lib/crm-types';

const DEFAULT_CONFIG: ConfiguracaoAPIs = {
  amadeus: { api_key: '', api_secret: '', ambiente: 'test', ativo: false },
  aviationstack: { api_key: '', ativo: false },
  google_places: { api_key: '', ativo: false },
  anthropic: { api_key: '', modelo: 'claude-sonnet-4-20250514', ativo: false },
  cache: {
    busca_voos_ttl: 86400,
    aeroportos_ttl: 2592000,
    busca_hoteis_ttl: 604800,
    precos_hoteis_ttl: 21600,
    fotos_hoteis_ttl: 2592000,
    reviews_ttl: 604800,
    status_voo_ttl: 900,
  },
};

interface CacheStats {
  total_entries: number;
  total_calls_saved: number;
  by_source: Array<{ source: string; entries: number; calls_saved: number }>;
}

export default function IntegracoesPage() {
  const [config, setConfig] = useState<ConfiguracaoAPIs>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string } | null>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/apis-config');
      const data = await res.json();
      if (data && !data.error) {
        setConfig({ ...DEFAULT_CONFIG, ...data });
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadCacheStats = useCallback(async () => {
    try {
      const res = await fetch('/api/apis-config/cache-stats');
      const data = await res.json();
      if (!data.error) setCacheStats(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConfig(); loadCacheStats(); }, [loadConfig, loadCacheStats]);

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/api/apis-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
    } catch { /* ignore */ }
    setSaving(false);
  };

  const testApi = async (provider: string) => {
    setTesting(p => ({ ...p, [provider]: true }));
    setTestResults(p => ({ ...p, [provider]: null }));
    try {
      let apiConfig;
      if (provider === 'amadeus') apiConfig = config.amadeus;
      else if (provider === 'google_places') apiConfig = config.google_places;
      else { setTesting(p => ({ ...p, [provider]: false })); return; }

      const res = await fetch('/api/apis-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, config: apiConfig }),
      });
      const result = await res.json();
      setTestResults(p => ({ ...p, [provider]: result }));
    } catch (e) {
      setTestResults(p => ({ ...p, [provider]: { ok: false, error: 'Erro de conexão' } }));
    }
    setTesting(p => ({ ...p, [provider]: false }));
  };

  const toggleSecret = (key: string) => setShowSecrets(p => ({ ...p, [key]: !p[key] }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--t-green)]" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)] flex items-center gap-2">
              <Settings className="w-6 h-6 text-[var(--t-green)]" />
              Integrações com APIs
            </h1>
            <p className="text-sm text-[var(--t-text-secondary)] mt-1">
              Configure as APIs de voos e hotéis para busca automática de dados
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
        </div>

        {/* Amadeus */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[var(--t-blue-bg)]0/10 flex items-center justify-center">
              <Plane className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-[var(--t-text)]">Amadeus Self-Service</h2>
              <p className="text-xs text-[var(--t-text-secondary)]">Busca de voos, preços, aeroportos e hotéis</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.amadeus.ativo}
                onChange={e => setConfig(c => ({ ...c, amadeus: { ...c.amadeus, ativo: e.target.checked } }))}
                className="w-4 h-4 rounded accent-[var(--t-green)]"
              />
              <span className="text-sm text-[var(--t-text)]">Ativo</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">API Key</label>
              <div className="flex gap-2">
                <input
                  type={showSecrets['amadeus_key'] ? 'text' : 'password'}
                  value={config.amadeus.api_key}
                  onChange={e => setConfig(c => ({ ...c, amadeus: { ...c.amadeus, api_key: e.target.value } }))}
                  className="flex-1 px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                  placeholder="Sua API Key do Amadeus"
                />
                <button onClick={() => toggleSecret('amadeus_key')} className="px-2 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                  {showSecrets['amadeus_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">API Secret</label>
              <div className="flex gap-2">
                <input
                  type={showSecrets['amadeus_secret'] ? 'text' : 'password'}
                  value={config.amadeus.api_secret}
                  onChange={e => setConfig(c => ({ ...c, amadeus: { ...c.amadeus, api_secret: e.target.value } }))}
                  className="flex-1 px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                  placeholder="Seu API Secret do Amadeus"
                />
                <button onClick={() => toggleSecret('amadeus_secret')} className="px-2 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                  {showSecrets['amadeus_secret'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Ambiente</label>
              <div className="flex gap-3">
                {(['test', 'production'] as const).map(amb => (
                  <label key={amb} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="amadeus-amb"
                      checked={config.amadeus.ambiente === amb}
                      onChange={() => setConfig(c => ({ ...c, amadeus: { ...c.amadeus, ambiente: amb } }))}
                      className="accent-[var(--t-green)]"
                    />
                    <span className="text-sm text-[var(--t-text)] capitalize">{amb === 'test' ? 'Test' : 'Production'}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {testResults['amadeus'] && (
                testResults['amadeus'].ok
                  ? <span className="flex items-center gap-1 text-emerald-400 text-sm"><CheckCircle2 className="w-4 h-4" /> Conectado</span>
                  : <span className="flex items-center gap-1 text-red-400 text-sm"><XCircle className="w-4 h-4" /> {testResults['amadeus'].error}</span>
              )}
              <button
                onClick={() => testApi('amadeus')}
                disabled={testing['amadeus'] || !config.amadeus.api_key}
                className="px-3 py-1.5 bg-[var(--t-blue-bg)]0/10 text-blue-400 text-sm rounded-lg hover:bg-[var(--t-blue-bg)]0/20 disabled:opacity-40 flex items-center gap-1.5"
              >
                {testing['amadeus'] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Testar conexão
              </button>
            </div>
          </div>
        </div>

        {/* AviationStack */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Plane className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-[var(--t-text)]">AviationStack</h2>
              <p className="text-xs text-[var(--t-text-secondary)]">Tracking de voos em tempo real e status</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.aviationstack.ativo}
                onChange={e => setConfig(c => ({ ...c, aviationstack: { ...c.aviationstack, ativo: e.target.checked } }))}
                className="w-4 h-4 rounded accent-[var(--t-green)]"
              />
              <span className="text-sm text-[var(--t-text)]">Ativo</span>
            </label>
          </div>

          <div>
            <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">API Key</label>
            <div className="flex gap-2">
              <input
                type={showSecrets['avstack_key'] ? 'text' : 'password'}
                value={config.aviationstack.api_key}
                onChange={e => setConfig(c => ({ ...c, aviationstack: { ...c.aviationstack, api_key: e.target.value } }))}
                className="flex-1 px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                placeholder="Sua API Key do AviationStack"
              />
              <button onClick={() => toggleSecret('avstack_key')} className="px-2 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                {showSecrets['avstack_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Google Places */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Hotel className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-[var(--t-text)]">Google Places API (New)</h2>
              <p className="text-xs text-[var(--t-text-secondary)]">Dados ricos de hotéis: avaliações, fotos, amenities</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.google_places.ativo}
                onChange={e => setConfig(c => ({ ...c, google_places: { ...c.google_places, ativo: e.target.checked } }))}
                className="w-4 h-4 rounded accent-[var(--t-green)]"
              />
              <span className="text-sm text-[var(--t-text)]">Ativo</span>
            </label>
          </div>

          <div>
            <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">API Key</label>
            <div className="flex gap-2">
              <input
                type={showSecrets['gp_key'] ? 'text' : 'password'}
                value={config.google_places.api_key}
                onChange={e => setConfig(c => ({ ...c, google_places: { ...c.google_places, api_key: e.target.value } }))}
                className="flex-1 px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                placeholder="Sua API Key do Google Cloud"
              />
              <button onClick={() => toggleSecret('gp_key')} className="px-2 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                {showSecrets['gp_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 ml-auto justify-end">
            {testResults['google_places'] && (
              testResults['google_places'].ok
                ? <span className="flex items-center gap-1 text-emerald-400 text-sm"><CheckCircle2 className="w-4 h-4" /> Conectado</span>
                : <span className="flex items-center gap-1 text-red-400 text-sm"><XCircle className="w-4 h-4" /> {testResults['google_places'].error}</span>
            )}
            <button
              onClick={() => testApi('google_places')}
              disabled={testing['google_places'] || !config.google_places.api_key}
              className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-sm rounded-lg hover:bg-emerald-500/20 disabled:opacity-40 flex items-center gap-1.5"
            >
              {testing['google_places'] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Testar conexão
            </button>
          </div>
        </div>

        {/* Anthropic (Claude AI) */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-[var(--t-text)]">Anthropic (Claude AI)</h2>
              <p className="text-xs text-[var(--t-text-secondary)]">IA para geração de conteúdo em propostas e destinos</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.anthropic?.ativo ?? false}
                onChange={e => setConfig(c => ({ ...c, anthropic: { ...c.anthropic, api_key: c.anthropic?.api_key ?? '', modelo: c.anthropic?.modelo ?? 'claude-sonnet-4-20250514', ativo: e.target.checked } }))}
                className="w-4 h-4 rounded accent-[var(--t-green)]"
              />
              <span className="text-sm text-[var(--t-text)]">Ativo</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">API Key</label>
              <div className="flex gap-2">
                <input
                  type={showSecrets['anthropic_key'] ? 'text' : 'password'}
                  value={config.anthropic?.api_key ?? ''}
                  onChange={e => setConfig(c => ({ ...c, anthropic: { ...c.anthropic, api_key: e.target.value, modelo: c.anthropic?.modelo ?? 'claude-sonnet-4-20250514', ativo: c.anthropic?.ativo ?? false } }))}
                  className="flex-1 px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                  placeholder="sk-ant-..."
                />
                <button onClick={() => toggleSecret('anthropic_key')} className="px-2 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                  {showSecrets['anthropic_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Modelo</label>
              <select
                value={config.anthropic?.modelo ?? 'claude-sonnet-4-20250514'}
                onChange={e => setConfig(c => ({ ...c, anthropic: { ...c.anthropic, api_key: c.anthropic?.api_key ?? '', modelo: e.target.value, ativo: c.anthropic?.ativo ?? false } }))}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              >
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
              </select>
            </div>
          </div>
        </div>

        {/* Cache Stats */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-[var(--t-text)]">Uso de APIs e Cache</h2>
              <p className="text-xs text-[var(--t-text-secondary)]">Economia de chamadas via cache inteligente</p>
            </div>
            <button
              onClick={loadCacheStats}
              className="px-3 py-1.5 text-sm text-[var(--t-text-secondary)] hover:text-[var(--t-text)] hover:bg-[var(--t-hover)] rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
          </div>

          {cacheStats ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[var(--t-bg)] rounded-lg p-4 text-center">
                <Database className="w-5 h-5 text-[var(--t-text-secondary)] mx-auto mb-1" />
                <div className="text-2xl font-bold text-[var(--t-text)]">{cacheStats.total_entries}</div>
                <div className="text-xs text-[var(--t-text-secondary)]">Entradas em cache</div>
              </div>
              <div className="bg-[var(--t-bg)] rounded-lg p-4 text-center">
                <BarChart3 className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
                <div className="text-2xl font-bold text-emerald-400">{cacheStats.total_calls_saved}</div>
                <div className="text-xs text-[var(--t-text-secondary)]">Calls economizadas</div>
              </div>
              <div className="bg-[var(--t-bg)] rounded-lg p-4">
                <div className="text-xs text-[var(--t-text-secondary)] mb-2">Por fonte:</div>
                {cacheStats.by_source.length === 0 && (
                  <div className="text-xs text-[var(--t-text-muted)]">Nenhum dado em cache</div>
                )}
                {cacheStats.by_source.map(s => (
                  <div key={s.source} className="flex items-center justify-between text-sm mb-1">
                    <span className="text-[var(--t-text)]">{s.source}</span>
                    <span className="text-[var(--t-text-secondary)]">{s.entries} entradas ({s.calls_saved} saved)</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-sm text-[var(--t-text-secondary)] py-4">Carregando estatísticas...</div>
          )}
        </div>

        {/* Compliance notes */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-400 mb-2">Notas de Compliance</h3>
          <ul className="text-xs text-[var(--t-text-secondary)] space-y-1">
            <li>Dados do Google Places devem exibir &quot;Powered by Google&quot; em toda tela que os utilizar.</li>
            <li>Preços do Amadeus são indicativos e podem variar. O disclaimer &quot;Preços fornecidos por Amadeus&quot; é exibido automaticamente.</li>
            <li>Dados de status de voo (AviationStack) são informativos — confirme com a companhia aérea.</li>
            <li>Cache de dados do Google Places é renovado a cada 7 dias (fotos: 30 dias).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
