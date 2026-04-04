'use client';

import { useState, useEffect } from 'react';
import { Save, Building2, MapPin, Phone, DollarSign, Palette, Loader2, CheckCircle2 } from 'lucide-react';
import { Agencia } from '@/lib/crm-types';
import { loadAgencia, saveAgencia } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const defaultAgencia: Agencia = {
  id: 'default',
  razao_social: '',
  nome_fantasia: '',
  cnpj: '',
  inscricao_municipal: '',
  cadastur: '',
  endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' },
  telefone: '',
  email: '',
  site: '',
  redes_sociais: {},
  logo: '',
  cores_identidade: { primaria: '#1a1a2e', secundaria: '#d4a853' },
  regime_tributario: 'SIMPLES',
  aliquota_padrao: 6,
};

export default function AgenciaPage() {
  const [data, setData] = useState<Agencia>(defaultAgencia);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  useEffect(() => {
    loadAgencia<Agencia>().then((result) => {
      if (result) setData(result);
      setLoading(false);
    });
  }, []);

  function setField<K extends keyof Agencia>(key: K, value: Agencia[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function setEndereco(key: keyof Agencia['endereco'], value: string) {
    setData((prev) => ({ ...prev, endereco: { ...prev.endereco, [key]: value } }));
  }

  function setCores(key: keyof Agencia['cores_identidade'], value: string) {
    setData((prev) => ({ ...prev, cores_identidade: { ...prev.cores_identidade, [key]: value } }));
  }

  async function handleCepBlur() {
    const cep = data.endereco.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const json = await res.json();
      if (!json.erro) {
        setData((prev) => ({
          ...prev,
          endereco: {
            ...prev.endereco,
            logradouro: json.logradouro || prev.endereco.logradouro,
            bairro: json.bairro || prev.endereco.bairro,
            cidade: json.localidade || prev.endereco.cidade,
            estado: json.uf || prev.endereco.estado,
          },
        }));
      }
    } catch {
      // silently fail
    } finally {
      setCepLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await saveAgencia(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-[var(--t-bg)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--t-accent)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Dados da Agência</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Configurações gerais e identidade da empresa</p>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold gap-2"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>

        {/* Section 1: Dados da Empresa */}
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-[var(--t-accent)] flex items-center gap-2 text-base">
              <Building2 className="w-4 h-4" />
              Dados da Empresa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Razão Social</label>
                <Input
                  value={data.razao_social}
                  onChange={(e) => setField('razao_social', e.target.value)}
                  placeholder="Razão Social Ltda."
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Nome Fantasia</label>
                <Input
                  value={data.nome_fantasia}
                  onChange={(e) => setField('nome_fantasia', e.target.value)}
                  placeholder="Nome Fantasia"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">CNPJ</label>
                <Input
                  value={data.cnpj}
                  onChange={(e) => setField('cnpj', e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Inscrição Municipal</label>
                <Input
                  value={data.inscricao_municipal}
                  onChange={(e) => setField('inscricao_municipal', e.target.value)}
                  placeholder="Inscrição Municipal"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Cadastur</label>
                <Input
                  value={data.cadastur}
                  onChange={(e) => setField('cadastur', e.target.value)}
                  placeholder="Número Cadastur"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Endereço */}
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-[var(--t-accent)] flex items-center gap-2 text-base">
              <MapPin className="w-4 h-4" />
              Endereço
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">CEP</label>
                <div className="relative">
                  <Input
                    value={data.endereco.cep}
                    onChange={(e) => setEndereco('cep', e.target.value)}
                    onBlur={handleCepBlur}
                    placeholder="00000-000"
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                  />
                  {cepLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-accent)] animate-spin" />
                  )}
                </div>
              </div>
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Logradouro</label>
                <Input
                  value={data.endereco.logradouro}
                  onChange={(e) => setEndereco('logradouro', e.target.value)}
                  placeholder="Rua, Avenida..."
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Número</label>
                <Input
                  value={data.endereco.numero}
                  onChange={(e) => setEndereco('numero', e.target.value)}
                  placeholder="Nº"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Complemento</label>
                <Input
                  value={data.endereco.complemento}
                  onChange={(e) => setEndereco('complemento', e.target.value)}
                  placeholder="Sala, Andar..."
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Bairro</label>
                <Input
                  value={data.endereco.bairro}
                  onChange={(e) => setEndereco('bairro', e.target.value)}
                  placeholder="Bairro"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Cidade</label>
                <Input
                  value={data.endereco.cidade}
                  onChange={(e) => setEndereco('cidade', e.target.value)}
                  placeholder="Cidade"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Estado (UF)</label>
                <Input
                  value={data.endereco.estado}
                  onChange={(e) => setEndereco('estado', e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="UF"
                  maxLength={2}
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Contato */}
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-[var(--t-accent)] flex items-center gap-2 text-base">
              <Phone className="w-4 h-4" />
              Contato
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Telefone</label>
                <Input
                  value={data.telefone}
                  onChange={(e) => setField('telefone', e.target.value)}
                  placeholder="(00) 00000-0000"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">E-mail</label>
                <Input
                  type="email"
                  value={data.email}
                  onChange={(e) => setField('email', e.target.value)}
                  placeholder="contato@agencia.com.br"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Site</label>
                <Input
                  value={data.site}
                  onChange={(e) => setField('site', e.target.value)}
                  placeholder="https://www.agencia.com.br"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 4: Tributação */}
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-[var(--t-accent)] flex items-center gap-2 text-base">
              <DollarSign className="w-4 h-4" />
              Tributação
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Regime Tributário</label>
                <select
                  value={data.regime_tributario}
                  onChange={(e) => setField('regime_tributario', e.target.value as Agencia['regime_tributario'])}
                  className="w-full h-10 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-bg)] text-[var(--t-text)] px-3 text-sm focus:outline-none focus:border-[var(--t-accent)]"
                >
                  <option value="SIMPLES">Simples Nacional</option>
                  <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
                  <option value="LUCRO_REAL">Lucro Real</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Alíquota Padrão (%)</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={data.aliquota_padrao}
                  onChange={(e) => setField('aliquota_padrao', parseFloat(e.target.value) || 0)}
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 5: Identidade Visual */}
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-[var(--t-accent)] flex items-center gap-2 text-base">
              <Palette className="w-4 h-4" />
              Identidade Visual
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Cor Primária</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={data.cores_identidade.primaria}
                    onChange={(e) => setCores('primaria', e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer shadow-[var(--t-card-shadow)] bg-transparent p-0.5"
                  />
                  <Input
                    value={data.cores_identidade.primaria}
                    onChange={(e) => setCores('primaria', e.target.value)}
                    placeholder="#1a1a2e"
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)] font-mono"
                  />
                </div>
                <div
                  className="h-8 rounded-md shadow-[var(--t-card-shadow)]"
                  style={{ backgroundColor: data.cores_identidade.primaria }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Cor Secundária</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={data.cores_identidade.secundaria}
                    onChange={(e) => setCores('secundaria', e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer shadow-[var(--t-card-shadow)] bg-transparent p-0.5"
                  />
                  <Input
                    value={data.cores_identidade.secundaria}
                    onChange={(e) => setCores('secundaria', e.target.value)}
                    placeholder="#d4a853"
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)] font-mono"
                  />
                </div>
                <div
                  className="h-8 rounded-md shadow-[var(--t-card-shadow)]"
                  style={{ backgroundColor: data.cores_identidade.secundaria }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bottom save button */}
        <div className="flex justify-end pb-6">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold gap-2 px-8"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saved ? 'Dados Salvos!' : saving ? 'Salvando...' : 'Salvar Dados da Agência'}
          </Button>
        </div>

      </div>
    </div>
  );
}
