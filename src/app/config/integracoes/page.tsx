'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Settings, Hotel, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Save, BarChart3, RefreshCw, Sparkles,
  BrainCircuit, ImagePlus, MessageSquare, FileText, Wand2, Globe,
} from 'lucide-react';
import type { ConfiguracaoAPIs } from '@/lib/crm-types';

/**
 * Só a integração com IA é exibida. As APIs de viagem (Amadeus,
 * AviationStack, Google Places) e o painel de cache saíram da tela quando o
 * sistema passou a ser um financeiro simples para o agente de viagens.
 *
 * As chaves delas NÃO foram apagadas: `config` é carregado inteiro do
 * servidor e salvo inteiro, então o que está guardado continua guardado e
 * volta a aparecer se a seção for reativada. Remover os campos daqui é que
 * apagaria as chaves no primeiro salvamento.
 */
const DEFAULT_CONFIG: ConfiguracaoAPIs = {
  amadeus: { api_key: '', api_secret: '', ambiente: 'test', ativo: false },
  aviationstack: { api_key: '', ativo: false },
  google_places: { api_key: '', ativo: false },
  anthropic: { api_key: '', modelo: 'claude-sonnet-4-5-20250929', ativo: false },
  openai: { api_key: '', modelo_imagem: 'gpt-image-1', ativo: false },
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

export default function IntegracoesPage() {
  const [config, setConfig] = useState<ConfiguracaoAPIs>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string; message?: string } | null>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

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


  useEffect(() => { loadConfig(); }, [loadConfig]);

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
      else if (provider === 'anthropic') apiConfig = config.anthropic;
      else if (provider === 'openai') apiConfig = config.openai;
      else { setTesting(p => ({ ...p, [provider]: false })); return; }

      const res = await fetch('/api/apis-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, config: apiConfig }),
      });
      const result = await res.json();
      setTestResults(p => ({ ...p, [provider]: result }));
    } catch {
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
              Integração com IA
            </h1>
            <p className="text-sm text-[var(--t-text-secondary)] mt-1">
              Configure as chaves da Anthropic e da OpenAI usadas pelo sistema
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

        {/* ═══════════ SEÇÃO: INTELIGÊNCIA ARTIFICIAL ═══════════ */}
        <div className="pt-2">
          <h2 className="text-lg font-semibold text-[var(--t-text)] flex items-center gap-2 mb-1">
            <BrainCircuit className="w-5 h-5 text-purple-400" />
            Inteligência Artificial
          </h2>
          <p className="text-sm text-[var(--t-text-secondary)] mb-4">
            Configure as chaves de API para habilitar geração de texto, imagens e análises dentro do sistema.
          </p>
        </div>

        {/* Anthropic (Claude AI) */}
        <div className="bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-[var(--t-text)]">Anthropic (Claude AI)</h2>
              <p className="text-xs text-[var(--t-text-secondary)]">Geração de textos, análises e chat inteligente</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.anthropic?.ativo ?? false}
                onChange={e => setConfig(c => ({ ...c, anthropic: { ...c.anthropic, api_key: c.anthropic?.api_key ?? '', modelo: c.anthropic?.modelo ?? 'claude-sonnet-4-5-20250929', ativo: e.target.checked } }))}
                className="w-4 h-4 rounded accent-[var(--t-green)]"
              />
              <span className="text-sm text-[var(--t-text)]">Ativo</span>
            </label>
          </div>

          {/* O que esta API faz */}
          <div className="bg-purple-500/5 border border-purple-500/10 rounded-lg p-3 mb-4">
            <p className="text-xs font-medium text-purple-300 mb-2">O que o Claude faz no sistema:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="flex items-start gap-2">
                <FileText className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--t-text-secondary)]"><strong>Propostas</strong> — gera textos de roteiros, descrições de destinos e seções completas</span>
              </div>
              <div className="flex items-start gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--t-text-secondary)]"><strong>Chat do cliente</strong> — responde dúvidas sobre a proposta na página pública</span>
              </div>
              <div className="flex items-start gap-2">
                <Wand2 className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--t-text-secondary)]"><strong>Destinos</strong> — gera conteúdo sobre destinos, atrações e dicas</span>
              </div>
              <div className="flex items-start gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--t-text-secondary)]"><strong>Análises</strong> — insights sobre vendas, financeiro e desempenho</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">API Key</label>
              <div className="flex gap-2">
                <input
                  type={showSecrets['anthropic_key'] ? 'text' : 'password'}
                  value={config.anthropic?.api_key ?? ''}
                  onChange={e => setConfig(c => ({ ...c, anthropic: { ...c.anthropic, api_key: e.target.value, modelo: c.anthropic?.modelo ?? 'claude-sonnet-4-5-20250929', ativo: c.anthropic?.ativo ?? false } }))}
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
                value={config.anthropic?.modelo ?? 'claude-sonnet-4-5-20250929'}
                onChange={e => setConfig(c => ({ ...c, anthropic: { ...c.anthropic, api_key: c.anthropic?.api_key ?? '', modelo: e.target.value, ativo: c.anthropic?.ativo ?? false } }))}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              >
                <option value="claude-opus-4-7">Claude Opus 4.7 (mais inteligente)</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (recomendado)</option>
                <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (mais rápido)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 justify-end">
            {testResults['anthropic'] && (
              testResults['anthropic'].ok
                ? <span className="flex items-center gap-1 text-emerald-400 text-sm"><CheckCircle2 className="w-4 h-4" /> {testResults['anthropic'].message || 'Conectado'}</span>
                : <span className="flex items-center gap-1 text-red-400 text-sm max-w-sm truncate"><XCircle className="w-4 h-4" /> {testResults['anthropic'].error}</span>
            )}
            <button
              onClick={() => testApi('anthropic')}
              disabled={testing['anthropic'] || !(config.anthropic?.api_key)}
              className="px-3 py-1.5 bg-purple-500/10 text-purple-400 text-sm rounded-lg hover:bg-purple-500/20 disabled:opacity-40 flex items-center gap-1.5"
            >
              {testing['anthropic'] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Testar conexão
            </button>
          </div>

          <p className="mt-3 text-[11px] text-[var(--t-text-muted)]">
            Obtenha sua chave em <span className="text-purple-400">console.anthropic.com</span>. A chave é armazenada de forma segura por agência (tenant).
          </p>
        </div>

        {/* OpenAI (Geração de imagens) */}
        <div className="bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <ImagePlus className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-[var(--t-text)]">OpenAI (Geração de Imagens)</h2>
              <p className="text-xs text-[var(--t-text-secondary)]">Cria fotos e imagens via IA para uso em propostas e destinos</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.openai?.ativo ?? false}
                onChange={e => setConfig(c => ({ ...c, openai: { api_key: c.openai?.api_key ?? '', modelo_imagem: c.openai?.modelo_imagem ?? 'gpt-image-1', ativo: e.target.checked } }))}
                className="w-4 h-4 rounded accent-[var(--t-green)]"
              />
              <span className="text-sm text-[var(--t-text)]">Ativo</span>
            </label>
          </div>

          {/* O que esta API faz */}
          <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3 mb-4">
            <p className="text-xs font-medium text-emerald-300 mb-2">O que a OpenAI faz no sistema:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="flex items-start gap-2">
                <ImagePlus className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--t-text-secondary)]"><strong>Fotos de capa</strong> — gera imagens de destinos para cabeçalhos de propostas</span>
              </div>
              <div className="flex items-start gap-2">
                <Hotel className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--t-text-secondary)]"><strong>Hotéis e atrações</strong> — ilustrações quando não há fotos reais disponíveis</span>
              </div>
              <div className="flex items-start gap-2">
                <Globe className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--t-text-secondary)]"><strong>Destinos</strong> — cria imagens temáticas para páginas de destinos</span>
              </div>
              <div className="flex items-start gap-2">
                <Wand2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--t-text-secondary)]"><strong>Editor</strong> — botão "Gerar imagem com IA" no editor de propostas</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">API Key</label>
              <div className="flex gap-2">
                <input
                  type={showSecrets['openai_key'] ? 'text' : 'password'}
                  value={config.openai?.api_key ?? ''}
                  onChange={e => setConfig(c => ({ ...c, openai: { api_key: e.target.value, modelo_imagem: c.openai?.modelo_imagem ?? 'gpt-image-1', ativo: c.openai?.ativo ?? false } }))}
                  className="flex-1 px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                  placeholder="sk-..."
                />
                <button onClick={() => toggleSecret('openai_key')} className="px-2 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                  {showSecrets['openai_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Modelo de imagem</label>
              <select
                value={config.openai?.modelo_imagem ?? 'gpt-image-1'}
                onChange={e => setConfig(c => ({ ...c, openai: { api_key: c.openai?.api_key ?? '', modelo_imagem: e.target.value, ativo: c.openai?.ativo ?? false } }))}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              >
                <option value="gpt-image-1">gpt-image-1 (recomendado)</option>
                <option value="dall-e-3">DALL-E 3</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 justify-end">
            {testResults['openai'] && (
              testResults['openai'].ok
                ? <span className="flex items-center gap-1 text-emerald-400 text-sm"><CheckCircle2 className="w-4 h-4" /> {testResults['openai'].message || 'Conectado'}</span>
                : <span className="flex items-center gap-1 text-red-400 text-sm max-w-sm truncate"><XCircle className="w-4 h-4" /> {testResults['openai'].error}</span>
            )}
            <button
              onClick={() => testApi('openai')}
              disabled={testing['openai'] || !(config.openai?.api_key)}
              className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-sm rounded-lg hover:bg-emerald-500/20 disabled:opacity-40 flex items-center gap-1.5"
            >
              {testing['openai'] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Testar conexão
            </button>
          </div>

          <p className="mt-3 text-[11px] text-[var(--t-text-muted)]">
            Obtenha sua chave em <span className="text-emerald-400">platform.openai.com</span>. Imagens geradas são salvas no volume de uploads do servidor.
          </p>
        </div>

      </div>
    </div>
  );
}
