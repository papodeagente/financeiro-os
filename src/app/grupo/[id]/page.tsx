'use client';

import { useState, useEffect, useCallback, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import { GrupoViagem, AbaType, ABA_LABELS } from '@/lib/types';
import { loadGrupos, saveGrupo } from '@/lib/storage';
import { calcProposta } from '@/lib/calculations';
import { useApp } from '@/contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GroupStepper } from '@/components/GroupStepper';
import { InfTab } from '@/components/tabs/InfTab';
import { TktTab } from '@/components/tabs/TktTab';
import { HtlTab } from '@/components/tabs/HtlTab';
import { RecTab } from '@/components/tabs/RecTab';
import { CarTab } from '@/components/tabs/CarTab';
import { GuiaTab } from '@/components/tabs/GuiaTab';
import { SegTab } from '@/components/tabs/SegTab';
import { NavioTab } from '@/components/tabs/NavioTab';
import { IngTab } from '@/components/tabs/IngTab';
import { BrindeTab } from '@/components/tabs/BrindeTab';
import { DivulgacaoTab } from '@/components/tabs/DivulgacaoTab';
import { PropostaTab } from '@/components/tabs/PropostaTab';
import { PainelPipelineTab } from '@/components/tabs/PainelPipelineTab';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { createDivulgacaoFornecedor } from '@/lib/defaults';
import { TemplatePickerModal } from '@/components/TemplatePickerModal';
import { TemplateProposta } from '@/lib/crm-types';
import { Save, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from '@/lib/toast';

// 'htl_seg' (tabela auxiliar HTL+SEG combinada) foi removida da timeline
// — ficava ao final e duplicava info que a aba "Proposta" já mostra.
const ABAS_PLANEJAMENTO: AbaType[] = ['pipeline', 'inf', 'tkt', 'htl', 'rec', 'car', 'guia', 'seg', 'navio', 'ing', 'brinde', 'divulgacao', 'proposta'];

const ABA_ICONS: Record<string, string> = {
  pipeline: '🔄', inf: 'ℹ️', tkt: '✈️', htl: '🏨', rec: '🎯', car: '🚐', guia: '🧑‍🏫',
  seg: '🛡️', navio: '🚢', ing: '🎟️', brinde: '🎁', divulgacao: '📢', proposta: '💰',
};

function hasData(grupo: GrupoViagem, aba: AbaType): boolean {
  switch (aba) {
    case 'inf': return !!grupo.grp_id;
    case 'tkt': return grupo.tkt.trechos.some(t => t.fontes.some(f => f.valor_adt !== null && f.valor_adt > 0));
    case 'htl': return grupo.htl.hoteis.some(h => h.fontes.some(f => f.valor_sgl !== null && f.valor_sgl > 0));
    case 'rec': return grupo.rec.passeios.some(p => p.fornecedores.some(f => f.valor_adt !== null && f.valor_adt > 0));
    case 'car': return grupo.car.transportes.some(t => t.empresas.some(e => e.valor_veiculo !== null && e.valor_veiculo > 0));
    case 'guia': return grupo.guia.destinos.some(d => d.fornecedores.some(f => f.valor_total !== null && f.valor_total > 0));
    case 'seg': return grupo.seg.seguradoras.some(s => s.valor_sgl !== null && s.valor_sgl > 0);
    case 'navio': return grupo.navio.fornecedores.some(f => f.valor_sgl !== null && f.valor_sgl > 0);
    case 'ing': return grupo.ing.atrativos.some(a => a.fontes.some(f => f.valor_adt !== null && f.valor_adt > 0));
    case 'brinde': return grupo.brinde.fornecedores.some(f => f.valor_unidade !== null && f.valor_unidade > 0);
    case 'divulgacao': return (grupo.divulgacao?.fornecedores || []).some(f => f.valor_total !== null && f.valor_total > 0);
    default: return false;
  }
}

export default function GrupoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { setActiveGrupo } = useApp();
  const [grupo, setGrupo] = useState<GrupoViagem | null>(null);
  const [activeTab, setActiveTab] = useState<AbaType>('pipeline');
  const [saved, setSaved] = useState(true);
  const [gerandoProposta, setGerandoProposta] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  useEffect(() => {
    loadGrupos().then(grupos => {
      const found = grupos.find(g => g.id === id);
      if (found) {
        if (!found.financeiro) found.financeiro = createFinanceiroGrupo();
        // Migrate existing grupos without divulgação field
        if (!found.divulgacao) {
          found.divulgacao = { fornecedores: Array.from({ length: 8 }, (_, i) => createDivulgacaoFornecedor(i)) };
        }
        if (!found.cambio?.divulgacao) {
          found.cambio = { ...(found.cambio || {}), divulgacao: { valor: 1.0, moeda: 'BRL', deadline: null } };
        }
        // Migrate existing grupos without pipeline fields
        if (!found.status_pipeline) found.status_pipeline = 'PRODUTO';
        if (found.proposta_id === undefined) found.proposta_id = null;
        if (found.orcamento_id === undefined) found.orcamento_id = null;
        if (found.venda_crm_id === undefined) found.venda_crm_id = null;
        if (!found.tarifas_ativas) found.tarifas_ativas = ['sgl', 'dbl', 'tpl', 'qdp'];
        // Tipo: GRUPO/PROPOSTA — legacy grupos viram GRUPO. Cortesia em DBL default.
        if (!found.tipo) found.tipo = 'GRUPO';
        if (!found.params.cortesia_apto) found.params.cortesia_apto = 'dbl';
        setGrupo(found);
        setActiveGrupo(found.id, found.grp_id || 'Sem ID');
      } else {
        router.push('/');
      }
    });
  }, [id, router, setActiveGrupo]);

  const handleChange = useCallback((updated: GrupoViagem) => {
    setGrupo(updated);
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (grupo) {
      await saveGrupo(grupo);
      setSaved(true);
    }
  }, [grupo]);

  const handleGerarProposta = () => {
    if (!grupo) return;
    setShowTemplatePicker(true);
  };

  const handleTemplateSelected = async (template: TemplateProposta | null) => {
    if (!grupo) return;
    setShowTemplatePicker(false);
    setGerandoProposta(true);
    try {
      const res = await fetch('/api/propostas/from-grupo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id: grupo.id, template_id: template?.id || null }),
      });
      const data = await res.json();
      if (data.id) {
        setGrupo(prev => prev ? { ...prev, proposta_id: data.id, status_pipeline: 'PROPOSTA' } : prev);
        setSaved(false);
        toast.success('Proposta gerada');
        router.push(`/propostas/${data.id}`);
      } else {
        toast.error('Erro ao gerar proposta', data.error);
      }
    } catch {
      toast.error('Erro ao gerar proposta');
    }
    setGerandoProposta(false);
  };

  const handleGerarOrcamento = async () => {
    if (!grupo || !grupo.proposta_id) return;
    try {
      const res = await fetch('/api/orcamentos/from-proposta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposta_id: grupo.proposta_id, grupo_id: grupo.id }),
      });
      const data = await res.json();
      if (data.id) {
        setGrupo(prev => prev ? { ...prev, orcamento_id: data.id, status_pipeline: 'ORCAMENTO' } : prev);
        setSaved(false);
        toast.success('Orçamento gerado');
      } else {
        toast.error('Erro ao gerar orçamento', data.error);
      }
    } catch {
      toast.error('Erro ao gerar orçamento');
    }
  };

  const handleCriarReserva = async () => {
    if (!grupo) return;
    try {
      const res = await fetch('/api/vendas/from-grupo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id: grupo.id, status: 'RESERVADO' }),
      });
      const data = await res.json();
      if (data.id) {
        setGrupo(prev => prev ? { ...prev, venda_crm_id: data.id, status_pipeline: 'RESERVA' } : prev);
        setSaved(false);
        toast.success('Reserva criada');
      } else {
        toast.error('Erro ao criar reserva', data.error);
      }
    } catch {
      toast.error('Erro ao criar reserva');
    }
  };

  const handleFecharVenda = async () => {
    if (!grupo) return;
    try {
      const res = await fetch(`/api/grupos/${grupo.id}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'VENDA' }),
      });
      const data = await res.json();
      if (data.ok) {
        setGrupo(prev => prev ? { ...prev, status_pipeline: 'VENDA' } : prev);
        setSaved(false);
        toast.success('Venda fechada');
      } else {
        toast.error('Erro ao fechar venda', data.error);
      }
    } catch {
      toast.error('Erro ao fechar venda');
    }
  };

  const handleNext = useCallback(() => {
    const idx = ABAS_PLANEJAMENTO.indexOf(activeTab);
    if (idx < ABAS_PLANEJAMENTO.length - 1) setActiveTab(ABAS_PLANEJAMENTO[idx + 1]);
  }, [activeTab]);
  const handlePrev = useCallback(() => {
    const idx = ABAS_PLANEJAMENTO.indexOf(activeTab);
    if (idx > 0) setActiveTab(ABAS_PLANEJAMENTO[idx - 1]);
  }, [activeTab]);

  // Auto-save every 5 seconds
  useEffect(() => {
    if (!saved && grupo) {
      const timer = setTimeout(async () => {
        await saveGrupo(grupo);
        setSaved(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [saved, grupo]);

  // Price summary for stepper
  const priceSummary = useMemo(() => {
    if (!grupo) return null;
    const p = calcProposta(grupo);
    const dblAvista = p.totalPaxAvista['dbl'] || 0;
    const dblCartao = p.parcelaPaxCC['dbl'] || 0;
    return { dblAvista, dblCartao, parcelas: grupo.params.parcelas };
  }, [grupo]);

  if (!grupo) return <div className="flex items-center justify-center h-full">Carregando...</div>;

  const PIPELINE_BADGE_COLORS: Record<string, string> = {
    PRODUTO: 'bg-gray-200 text-gray-700',
    PROPOSTA: 'bg-blue-100 text-blue-700',
    ORCAMENTO: 'bg-amber-100 text-amber-700',
    RESERVA: 'bg-purple-100 text-purple-700',
    VENDA: 'bg-green-100 text-green-700',
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'pipeline': return (
        <PainelPipelineTab
          grupo={grupo}
          onGerarProposta={handleGerarProposta}
          onGerarOrcamento={handleGerarOrcamento}
          onCriarReserva={handleCriarReserva}
          onFecharVenda={handleFecharVenda}
          gerandoProposta={gerandoProposta}
        />
      );
      case 'inf': return <InfTab grupo={grupo} onChange={handleChange} />;
      case 'tkt': return <TktTab grupo={grupo} onChange={handleChange} />;
      case 'htl': return <HtlTab grupo={grupo} onChange={handleChange} />;
      case 'rec': return <RecTab grupo={grupo} onChange={handleChange} />;
      case 'car': return <CarTab grupo={grupo} onChange={handleChange} />;
      case 'guia': return <GuiaTab grupo={grupo} onChange={handleChange} />;
      case 'seg': return <SegTab grupo={grupo} onChange={handleChange} />;
      case 'navio': return <NavioTab grupo={grupo} onChange={handleChange} />;
      case 'ing': return <IngTab grupo={grupo} onChange={handleChange} />;
      case 'brinde': return <BrindeTab grupo={grupo} onChange={handleChange} />;
      case 'divulgacao': return <DivulgacaoTab grupo={grupo} onChange={handleChange} />;
      case 'proposta': return <PropostaTab grupo={grupo} />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="bg-[var(--t-surface)] border-b border-[var(--t-border)] px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm text-[var(--t-text-secondary)]">
          <Link href="/grupos" className="hover:text-[var(--t-text)]">Produtos</Link>
          <span>/</span>
          <span className="font-semibold text-[var(--t-text)]">{grupo.grp_id || 'Sem ID'}</span>
          <span>/</span>
          <Badge variant="outline" className="text-[var(--t-accent)] border-[var(--t-accent)]">{ABA_LABELS[activeTab]}</Badge>
          <Badge className={`text-[10px] ${PIPELINE_BADGE_COLORS[grupo.status_pipeline || 'PRODUTO']}`}>
            {grupo.status_pipeline || 'PRODUTO'}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${saved ? 'text-green-600' : 'text-orange-500'}`}>
            {saved ? '● Salvo' : '○ Não salvo'}
          </span>
          <Button onClick={handleGerarProposta} size="sm" disabled={gerandoProposta}
            className="bg-[var(--t-green)] hover:bg-[var(--t-green)]/90 text-white dark:text-[#0a0a14] gap-1">
            {gerandoProposta ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {gerandoProposta ? 'Gerando...' : 'Gerar Proposta'}
          </Button>
          <Button onClick={handleSave} size="sm" className="bg-[var(--t-green)] hover:bg-[var(--t-green)]/90 text-white gap-1">
            <Save className="w-4 h-4" /> Salvar
          </Button>
        </div>
      </header>

      {/* Timeline Stepper */}
      <GroupStepper
        steps={ABAS_PLANEJAMENTO}
        activeStep={activeTab}
        onStepClick={setActiveTab}
        onNext={handleNext}
        onPrev={handlePrev}
        hasData={(aba) => hasData(grupo, aba)}
        icons={ABA_ICONS}
        labels={ABA_LABELS}
        priceSummary={priceSummary}
      />

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">
        <div key={activeTab} className="content-enter">
          {renderTab()}
        </div>
      </main>

      <TemplatePickerModal
        open={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        onSelect={handleTemplateSelected}
      />
    </div>
  );
}
