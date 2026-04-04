'use client';

import { useEffect, useState } from 'react';
import { CenarioCAC, CACMensal, NaturezaCusto } from '@/lib/crm-types';
import { loadEntities, saveEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plus, X, Check, Trash2, TrendingUp, Target, Calculator,
  Zap, Save, BarChart3,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const PCT = (v: number) => `${v.toFixed(1)}%`;

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]}/${y}`;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

interface AdsLine {
  plataforma: string;
  investimento_mensal: number;
  cpc_estimado: number;
  taxa_conversao: number;
  leads_estimados: number;
  clientes_estimados: number;
}

interface OutroInvestimento {
  descricao: string;
  valor: number;
  tipo: NaturezaCusto;
}

const EMPTY_ADS: AdsLine = {
  plataforma: 'Google Ads',
  investimento_mensal: 0,
  cpc_estimado: 2.5,
  taxa_conversao: 3,
  leads_estimados: 0,
  clientes_estimados: 0,
};

const PLATAFORMAS = ['Google Ads', 'Meta Ads (Facebook/Instagram)', 'TikTok Ads', 'LinkedIn Ads', 'Outros'];

export default function CACCenariosPage() {
  const [cenarios, setCenarios] = useState<CenarioCAC[]>([]);
  const [cacHistorico, setCacHistorico] = useState<CACMensal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [mesRef, setMesRef] = useState('');
  const [despFixasBase, setDespFixasBase] = useState(0);
  const [despVarBase, setDespVarBase] = useState(0);
  const [adsLines, setAdsLines] = useState<AdsLine[]>([{ ...EMPTY_ADS }]);
  const [outrosInv, setOutrosInv] = useState<OutroInvestimento[]>([]);
  const [clientesAlvo, setClientesAlvo] = useState(10);
  const [ticketMedioAlvo, setTicketMedioAlvo] = useState(5000);

  async function load() {
    setLoading(true);
    const [c, h] = await Promise.all([
      loadEntities<CenarioCAC>('cenarios-cac'),
      loadEntities<CACMensal>('cac-mensal'),
    ]);
    setCenarios(c);
    setCacHistorico(h);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    const latest = cacHistorico.sort((a, b) => b.mes.localeCompare(a.mes))[0];
    setNome('');
    setDescricao('');
    setMesRef(latest?.mes || new Date().toISOString().substring(0, 7));
    setDespFixasBase(latest?.total_despesas_fixas || 0);
    setDespVarBase(latest?.total_despesas_variaveis || 0);
    setAdsLines([{ ...EMPTY_ADS }]);
    setOutrosInv([]);
    setClientesAlvo(latest?.quantidade_clientes_novos || 10);
    setTicketMedioAlvo(latest?.ticket_medio || 5000);
    setShowForm(true);
  }

  function onMesRefChange(mes: string) {
    setMesRef(mes);
    const ref = cacHistorico.find(h => h.mes === mes);
    if (ref) {
      setDespFixasBase(ref.total_despesas_fixas);
      setDespVarBase(ref.total_despesas_variaveis);
      setClientesAlvo(ref.quantidade_clientes_novos);
      setTicketMedioAlvo(ref.ticket_medio);
    }
  }

  // Calculate ads metrics
  function calcAdsLine(line: AdsLine): AdsLine {
    const leads = line.cpc_estimado > 0 ? Math.floor(line.investimento_mensal / line.cpc_estimado) : 0;
    const clientes = Math.floor(leads * (line.taxa_conversao / 100));
    return { ...line, leads_estimados: leads, clientes_estimados: clientes };
  }

  function updateAdsLine(idx: number, field: keyof AdsLine, value: string | number) {
    setAdsLines(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      updated[idx] = calcAdsLine(updated[idx]);
      return updated;
    });
  }

  function addAdsLine() {
    setAdsLines(prev => [...prev, { ...EMPTY_ADS }]);
  }

  function removeAdsLine(idx: number) {
    setAdsLines(prev => prev.filter((_, i) => i !== idx));
  }

  function addOutroInvestimento() {
    setOutrosInv(prev => [...prev, { descricao: '', valor: 0, tipo: 'VARIAVEL' }]);
  }

  function removeOutroInvestimento(idx: number) {
    setOutrosInv(prev => prev.filter((_, i) => i !== idx));
  }

  // Calculated results
  const totalAds = adsLines.reduce((s, l) => s + l.investimento_mensal, 0);
  const totalOutros = outrosInv.reduce((s, o) => s + o.valor, 0);
  const totalInvestimento = totalAds + totalOutros;
  const totalCustoComercial = despFixasBase + despVarBase + totalInvestimento;
  const clientesAds = adsLines.reduce((s, l) => s + calcAdsLine(l).clientes_estimados, 0);
  const totalClientesEstimados = clientesAlvo + clientesAds;
  const cacProjetado = totalClientesEstimados > 0 ? totalCustoComercial / totalClientesEstimados : 0;
  const receitaEstimada = totalClientesEstimados * ticketMedioAlvo;
  const roiProjetado = totalCustoComercial > 0 ? ((receitaEstimada - totalCustoComercial) / totalCustoComercial) * 100 : 0;
  const paybackMeses = receitaEstimada > 0 ? Math.ceil(totalCustoComercial / (receitaEstimada / 12)) : 0;

  async function handleSave() {
    if (!nome) return;
    setSaving(true);

    const cenario: CenarioCAC = {
      id: generateId(),
      nome,
      descricao,
      mes_referencia: mesRef,
      despesas_fixas_base: despFixasBase,
      despesas_variaveis_base: despVarBase,
      investimento_ads: totalAds,
      ads_detalhamento: adsLines.map(l => calcAdsLine(l)),
      outros_investimentos: outrosInv,
      clientes_novos_estimados: totalClientesEstimados,
      cac_projetado: cacProjetado,
      ticket_medio_alvo: ticketMedioAlvo,
      roi_projetado: roiProjetado,
      payback_meses: paybackMeses,
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    };

    await saveEntity('cenarios-cac', cenario);
    setSaving(false);
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir cenário?')) return;
    await deleteEntity('cenarios-cac', id);
    load();
  }

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">CAC — Cenários</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Simule investimentos e projete o impacto no CAC</p>
          </div>
          <Button
            onClick={openNew}
            className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold"
          >
            <Plus className="w-4 h-4 mr-2" /> Novo Cenário
          </Button>
        </div>

        {/* Scenario Form */}
        {showForm && (
          <div className="space-y-4">
            <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-[var(--t-green)] text-base flex items-center gap-2">
                  <Calculator className="w-4 h-4" /> Simulador de Cenário
                </CardTitle>
                <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                  <X className="w-4 h-4" />
                </button>
              </CardHeader>
              <CardContent className="space-y-6">

                {/* Basic info */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Nome do Cenário *</label>
                    <Input
                      value={nome}
                      onChange={e => setNome(e.target.value)}
                      placeholder="Ex: Aumento Google Ads Q2"
                      className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Descrição</label>
                    <Input
                      value={descricao}
                      onChange={e => setDescricao(e.target.value)}
                      placeholder="Breve descrição"
                      className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Mês Referência</label>
                    <select
                      value={mesRef}
                      onChange={e => onMesRefChange(e.target.value)}
                      className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                    >
                      {cacHistorico.sort((a, b) => b.mes.localeCompare(a.mes)).map(h => (
                        <option key={h.mes} value={h.mes}>{getMonthLabel(h.mes)}</option>
                      ))}
                      <option value={new Date().toISOString().substring(0, 7)}>Manual</option>
                    </select>
                  </div>
                </div>

                {/* Base costs */}
                <div className="p-4 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)]">
                  <p className="text-sm font-medium text-[var(--t-text)] mb-3">Custos Base (do mês de referência)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Despesas Fixas</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={despFixasBase}
                        onChange={e => setDespFixasBase(parseFloat(e.target.value) || 0)}
                        className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Despesas Variáveis</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={despVarBase}
                        onChange={e => setDespVarBase(parseFloat(e.target.value) || 0)}
                        className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                      />
                    </div>
                  </div>
                </div>

                {/* Ads Calculator */}
                <div className="p-4 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[var(--t-text)] flex items-center gap-2">
                      <Zap className="w-4 h-4 text-[var(--t-amber)]" /> Investimento em Ads
                    </p>
                    <Button size="sm" variant="outline" onClick={addAdsLine} className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 text-xs">
                      <Plus className="w-3 h-3 mr-1" /> Plataforma
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {adsLines.map((line, idx) => {
                      const calc = calcAdsLine(line);
                      return (
                        <div key={idx} className="grid grid-cols-6 gap-2 items-end p-3 rounded bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
                          <div>
                            <label className="text-[10px] text-[var(--t-text-muted)] mb-0.5 block">Plataforma</label>
                            <select
                              value={line.plataforma}
                              onChange={e => updateAdsLine(idx, 'plataforma', e.target.value)}
                              className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-2 py-1.5 text-xs text-[var(--t-text)]"
                            >
                              {PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--t-text-muted)] mb-0.5 block">Investimento/mês</label>
                            <Input
                              type="number" min={0} step="0.01"
                              value={line.investimento_mensal}
                              onChange={e => updateAdsLine(idx, 'investimento_mensal', parseFloat(e.target.value) || 0)}
                              className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--t-text-muted)] mb-0.5 block">CPC (R$)</label>
                            <Input
                              type="number" min={0} step="0.01"
                              value={line.cpc_estimado}
                              onChange={e => updateAdsLine(idx, 'cpc_estimado', parseFloat(e.target.value) || 0)}
                              className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--t-text-muted)] mb-0.5 block">Conv. (%)</label>
                            <Input
                              type="number" min={0} max={100} step="0.1"
                              value={line.taxa_conversao}
                              onChange={e => updateAdsLine(idx, 'taxa_conversao', parseFloat(e.target.value) || 0)}
                              className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs"
                            />
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] text-[var(--t-text-muted)]">Leads / Clientes</p>
                            <p className="text-sm font-mono text-[var(--t-text)]">
                              {calc.leads_estimados} / <span className="text-[var(--t-green)] font-bold">{calc.clientes_estimados}</span>
                            </p>
                          </div>
                          <div className="flex justify-end">
                            {adsLines.length > 1 && (
                              <Button size="sm" variant="outline" onClick={() => removeAdsLine(idx)} className="border-[var(--t-red)]/30 text-[var(--t-red)] h-8 px-2">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 text-right text-sm text-[var(--t-text-secondary)]">
                    Total Ads: <span className="text-[var(--t-text)] font-bold">{BRL(totalAds)}</span>
                    {' · '}
                    Clientes estimados via Ads: <span className="text-[var(--t-green)] font-bold">{clientesAds}</span>
                  </div>
                </div>

                {/* Other Investments */}
                <div className="p-4 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[var(--t-text)]">Outros Investimentos</p>
                    <Button size="sm" variant="outline" onClick={addOutroInvestimento} className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 text-xs">
                      <Plus className="w-3 h-3 mr-1" /> Adicionar
                    </Button>
                  </div>
                  {outrosInv.map((inv, idx) => (
                    <div key={idx} className="grid grid-cols-4 gap-2 items-end mb-2">
                      <div className="col-span-2">
                        <Input
                          value={inv.descricao}
                          onChange={e => {
                            const u = [...outrosInv];
                            u[idx] = { ...u[idx], descricao: e.target.value };
                            setOutrosInv(u);
                          }}
                          placeholder="Descrição"
                          className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Input
                          type="number" min={0} step="0.01"
                          value={inv.valor}
                          onChange={e => {
                            const u = [...outrosInv];
                            u[idx] = { ...u[idx], valor: parseFloat(e.target.value) || 0 };
                            setOutrosInv(u);
                          }}
                          className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs"
                        />
                      </div>
                      <div className="flex gap-1">
                        <select
                          value={inv.tipo}
                          onChange={e => {
                            const u = [...outrosInv];
                            u[idx] = { ...u[idx], tipo: e.target.value as NaturezaCusto };
                            setOutrosInv(u);
                          }}
                          className="flex-1 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-2 py-1 text-xs text-[var(--t-text)]"
                        >
                          <option value="FIXO">Fixo</option>
                          <option value="VARIAVEL">Variável</option>
                          <option value="COMPRA_UNICA">Única</option>
                        </select>
                        <Button size="sm" variant="outline" onClick={() => removeOutroInvestimento(idx)} className="border-[var(--t-red)]/30 text-[var(--t-red)] h-8 px-2">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Targets */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Clientes Novos Base (sem ads)</label>
                    <Input
                      type="number" min={0}
                      value={clientesAlvo}
                      onChange={e => setClientesAlvo(parseInt(e.target.value) || 0)}
                      className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Ticket Médio Alvo</label>
                    <Input
                      type="number" min={0} step="0.01"
                      value={ticketMedioAlvo}
                      onChange={e => setTicketMedioAlvo(parseFloat(e.target.value) || 0)}
                      className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                </div>

                {/* Results Panel */}
                <div className="p-4 rounded-lg bg-[var(--t-green)]/5 border border-[var(--t-green)]/30">
                  <p className="text-sm font-medium text-[var(--t-green)] mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> Resultado da Simulação
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-[var(--t-green)]">{BRL(cacProjetado)}</p>
                      <p className="text-xs text-[var(--t-text-muted)]">CAC Projetado</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-[var(--t-text)]">{totalClientesEstimados}</p>
                      <p className="text-xs text-[var(--t-text-muted)]">Clientes Estimados</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-2xl font-bold ${roiProjetado >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                        {PCT(roiProjetado)}
                      </p>
                      <p className="text-xs text-[var(--t-text-muted)]">ROI Projetado</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-[var(--t-amber)]">{paybackMeses}</p>
                      <p className="text-xs text-[var(--t-text-muted)]">Payback (meses)</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-[var(--t-green)]/20 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--t-text-muted)]">Investimento Total: </span>
                      <span className="text-[var(--t-text)] font-mono">{BRL(totalCustoComercial)}</span>
                    </div>
                    <div>
                      <span className="text-[var(--t-text-muted)]">Receita Estimada: </span>
                      <span className="text-[var(--t-green)] font-mono">{BRL(receitaEstimada)}</span>
                    </div>
                    <div>
                      <span className="text-[var(--t-text-muted)]">LTV/CAC: </span>
                      <span className="text-[var(--t-blue)] font-mono">
                        {cacProjetado > 0 ? `${(ticketMedioAlvo / cacProjetado).toFixed(1)}x` : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Save */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={saving || !nome}
                    className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold"
                  >
                    <Save className="w-4 h-4 mr-1" /> {saving ? 'Salvando...' : 'Salvar Cenário'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowForm(false)}
                    className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                  >
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Saved Scenarios */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[var(--t-green)]" />
              Cenários Salvos ({cenarios.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-[var(--t-text-secondary)] text-sm">Carregando...</p>
            ) : cenarios.length === 0 ? (
              <div className="text-center py-8">
                <Target className="w-10 h-10 text-[var(--t-text-muted)] mx-auto mb-3" />
                <p className="text-[var(--t-text-muted)] text-sm">Nenhum cenário criado.</p>
                <p className="text-[var(--t-text-muted)] text-xs mt-1">Crie uma simulação para projetar o impacto de investimentos no CAC.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cenarios.sort((a, b) => b.criado_em.localeCompare(a.criado_em)).map(c => (
                  <div key={c.id} className="p-4 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] hover:border-[var(--t-border-hover)] transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-medium text-[var(--t-text)]">{c.nome}</h3>
                        {c.descricao && <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{c.descricao}</p>}
                        <Badge className="bg-[var(--t-surface)] text-[var(--t-text-muted)] border-0 text-[10px] mt-1">
                          Ref: {getMonthLabel(c.mes_referencia)}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(c.id)}
                        className="border-[var(--t-red)]/30 text-[var(--t-red)] hover:bg-[var(--t-red-bg)] h-7 px-2"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-lg font-bold text-[var(--t-green)]">{BRL(c.cac_projetado)}</p>
                        <p className="text-[10px] text-[var(--t-text-muted)]">CAC</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-[var(--t-text)]">{c.clientes_novos_estimados}</p>
                        <p className="text-[10px] text-[var(--t-text-muted)]">Clientes</p>
                      </div>
                      <div>
                        <p className={`text-lg font-bold ${c.roi_projetado >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                          {PCT(c.roi_projetado)}
                        </p>
                        <p className="text-[10px] text-[var(--t-text-muted)]">ROI</p>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-[var(--t-border)] flex justify-between text-xs text-[var(--t-text-muted)]">
                      <span>Ads: {BRL(c.investimento_ads)}</span>
                      <span>Payback: {c.payback_meses} meses</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
