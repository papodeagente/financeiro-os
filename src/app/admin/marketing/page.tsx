'use client';

import { useEffect, useState, useRef } from 'react';
import { Loader2, Upload, Save, Check, Image as ImageIcon, ExternalLink, Trash2 } from 'lucide-react';

interface Campanha {
  image_url: string;
  link_url: string;
  alt: string;
  ativo: boolean;
}

export default function AdminMarketingPage() {
  const [config, setConfig] = useState<Campanha>({ image_url: '', link_url: '', alt: '', ativo: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/admin/marketing/login').then(r => r.json()).then(data => {
      if (data && !data.error) setConfig({
        image_url: data.image_url || '',
        link_url: data.link_url || '',
        alt: data.alt || 'Campanha',
        ativo: data.ativo !== false,
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const salvar = async () => {
    setSaving(true);
    try {
      await fetch('/api/admin/marketing/login', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const fazerUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Selecione um arquivo de imagem (JPG, PNG, WebP)');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data?.url) {
        setConfig(c => ({ ...c, image_url: data.url }));
      } else {
        alert(data?.error || 'Falha no upload');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro no upload');
    }
    setUploading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Marketing & Campanhas</h1>
        <p className="text-sm text-slate-600 mt-1">
          Imagem promocional exibida no lado esquerdo da tela de login (<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">/login</code>).
          Pode ser clicável vinculando a um link externo.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* Form */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          {/* Imagem */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
              Imagem da campanha
            </label>
            <div className="flex items-start gap-3">
              {config.image_url ? (
                <div className="relative">
                  <img
                    src={config.image_url}
                    alt={config.alt}
                    className="w-40 h-40 object-cover rounded-lg border border-slate-200"
                  />
                  <button
                    onClick={() => setConfig(c => ({ ...c, image_url: '' }))}
                    className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-600"
                    title="Remover imagem"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="w-40 h-40 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-slate-300" />
                </div>
              )}
              <div className="flex-1 space-y-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading ? 'Enviando...' : config.image_url ? 'Trocar imagem' : 'Enviar imagem'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) fazerUpload(f);
                    e.target.value = '';
                  }}
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Recomendado: 1200×1500px ou maior. JPG, PNG ou WebP.
                  A imagem aparece em tela cheia no lado esquerdo do login.
                </p>
              </div>
            </div>
          </div>

          {/* URL alternativa direta */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
              Ou URL externa (opcional)
            </label>
            <input
              type="url"
              value={config.image_url}
              onChange={e => setConfig(c => ({ ...c, image_url: e.target.value }))}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Se você quer hospedar a imagem em outro lugar (CDN, Imgur etc), cole a URL aqui.
            </p>
          </div>

          {/* Link */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
              Link de destino (opcional)
            </label>
            <input
              type="url"
              value={config.link_url}
              onChange={e => setConfig(c => ({ ...c, link_url: e.target.value }))}
              placeholder="https://entur.com.br/summit2026"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Para onde o cliente vai ao clicar na imagem. Se vazio, a imagem fica não-clicável.
              Abre em nova aba (<code>target="_blank"</code>).
            </p>
          </div>

          {/* Alt */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
              Texto alternativo
            </label>
            <input
              type="text"
              value={config.alt}
              onChange={e => setConfig(c => ({ ...c, alt: e.target.value }))}
              placeholder="Ex: Entur Summit 2026 — Save the Date"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Usado por leitores de tela e quando a imagem não carrega.
            </p>
          </div>

          {/* Ativo */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={config.ativo}
              onChange={e => setConfig(c => ({ ...c, ativo: e.target.checked }))}
              className="w-4 h-4 rounded accent-blue-600"
            />
            <span className="text-slate-700">
              <strong>Campanha ativa</strong> — quando desligada, o lado esquerdo do login fica oculto.
            </span>
          </label>

          {/* Salvar */}
          <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
            <button
              onClick={salvar}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar alterações
            </button>
            {savedAt && (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
                <Check className="w-4 h-4" /> Salvo
              </span>
            )}
            <a
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              Ver /login <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
            Pré-visualização
          </div>
          {config.image_url && config.ativo ? (
            <div className="aspect-[3/4] w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              <img src={config.image_url} alt={config.alt} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="aspect-[3/4] w-full rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-center px-4">
              <p className="text-xs text-slate-400">
                {config.ativo ? 'Adicione uma imagem' : 'Campanha desativada — login sem imagem'}
              </p>
            </div>
          )}
          {config.link_url && config.image_url && config.ativo && (
            <div className="mt-2 text-[11px] text-slate-500 truncate">
              Clique abre: <span className="text-blue-600">{config.link_url}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
