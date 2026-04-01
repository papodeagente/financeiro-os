'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { GrupoViagem, AbaType, ABA_LABELS } from '@/lib/types';
import { loadGrupos, saveGrupo } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FloatingResume } from '@/components/FloatingResume';
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
import { PropostaTab } from '@/components/tabs/PropostaTab';
import { HtlSegTab } from '@/components/tabs/HtlSegTab';
import { VendasTab } from '@/components/tabs/financial/VendasTab';
import RecebimentosTab from '@/components/tabs/financial/RecebimentosTab';
import FornecedoresTab from '@/components/tabs/financial/FornecedoresTab';
import FluxoCaixaTab from '@/components/tabs/financial/FluxoCaixaTab';
import DRETab from '@/components/tabs/financial/DRETab';
import IndicadoresTab from '@/components/tabs/financial/IndicadoresTab';
import PainelTab from '@/components/tabs/financial/PainelTab';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';

const ABAS_PLANEJAMENTO: AbaType[] = ['inf', 'tkt', 'htl', 'rec', 'car', 'guia', 'seg', 'navio', 'ing', 'brinde', 'proposta', 'htl_seg'];
const ABAS_FINANCEIRO: AbaType[] = ['painel', 'vendas', 'recebimentos', 'fornecedores', 'fluxo_caixa', 'dre', 'indicadores'];

const ABA_ICONS: Record<AbaType, string> = {
  inf: 'i', tkt: '✈', htl: '🏨', rec: '🎯', car: '🚌', guia: '👤',
  seg: '🛡', navio: '🚢', ing: '🎫', brinde: '🎁', proposta: '💰', htl_seg: '📊',
  painel: '📊', vendas: '🛒', recebimentos: '💵', fornecedores: '🏭',
  fluxo_caixa: '📈', dre: '📋', indicadores: '🎯',
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
    default: return false;
  }
}

export default function GrupoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [grupo, setGrupo] = useState<GrupoViagem | null>(null);
  const [activeTab, setActiveTab] = useState<AbaType>('inf');
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    const grupos = loadGrupos();
    const found = grupos.find(g => g.id === id);
    if (found) {
      // Ensure financeiro field exists for groups created before financial module
      if (!found.financeiro) found.financeiro = createFinanceiroGrupo();
      setGrupo(found);
    } else {
      router.push('/');
    }
  }, [id, router]);

  const handleChange = useCallback((updated: GrupoViagem) => {
    setGrupo(updated);
    setSaved(false);
  }, []);

  const handleSave = useCallback(() => {
    if (grupo) {
      saveGrupo(grupo);
      setSaved(true);
    }
  }, [grupo]);

  // Auto-save every 5 seconds
  useEffect(() => {
    if (!saved && grupo) {
      const timer = setTimeout(() => {
        saveGrupo(grupo);
        setSaved(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [saved, grupo]);

  if (!grupo) return <div className="flex items-center justify-center h-screen">Carregando...</div>;

  const renderTab = () => {
    switch (activeTab) {
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
      case 'proposta': return <PropostaTab grupo={grupo} />;
      case 'htl_seg': return <HtlSegTab grupo={grupo} />;
      case 'painel': return <PainelTab grupo={grupo} />;
      case 'vendas': return <VendasTab grupo={grupo} onChange={handleChange} />;
      case 'recebimentos': return <RecebimentosTab grupo={grupo} onChange={handleChange} />;
      case 'fornecedores': return <FornecedoresTab grupo={grupo} onChange={handleChange} />;
      case 'fluxo_caixa': return <FluxoCaixaTab grupo={grupo} />;
      case 'dre': return <DRETab grupo={grupo} onChange={handleChange} />;
      case 'indicadores': return <IndicadoresTab grupo={grupo} onChange={handleChange} />;
    }
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-20 bg-[#1a1a2e] text-white flex flex-col items-center py-4 gap-1 overflow-y-auto shrink-0">
        <Link href="/" className="mb-3 text-[#d4a853] hover:text-white transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div className="text-[8px] uppercase tracking-wider text-gray-400 mb-1">Produto</div>
        {ABAS_PLANEJAMENTO.map(aba => (
          <button
            key={aba}
            onClick={() => setActiveTab(aba)}
            className={`w-16 py-1.5 rounded-lg text-center transition-all ${
              activeTab === aba ? 'bg-[#d4a853] text-[#1a1a2e]' : 'hover:bg-white/10'
            }`}
          >
            <div className="text-sm">{ABA_ICONS[aba]}</div>
            <div className="text-[9px] font-semibold">{ABA_LABELS[aba]}</div>
            {hasData(grupo, aba) && <div className="w-1.5 h-1.5 rounded-full bg-green-400 mx-auto mt-0.5" />}
          </button>
        ))}
        <div className="w-12 border-t border-gray-600 my-2" />
        <div className="text-[8px] uppercase tracking-wider text-gray-400 mb-1">Financeiro</div>
        {ABAS_FINANCEIRO.map(aba => (
          <button
            key={aba}
            onClick={() => setActiveTab(aba)}
            className={`w-16 py-1.5 rounded-lg text-center transition-all ${
              activeTab === aba ? 'bg-[#d4a853] text-[#1a1a2e]' : 'hover:bg-white/10'
            }`}
          >
            <div className="text-sm">{ABA_ICONS[aba]}</div>
            <div className="text-[9px] font-semibold">{ABA_LABELS[aba]}</div>
          </button>
        ))}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/" className="hover:text-[#1a1a2e]">Grupos OS</Link>
            <span>/</span>
            <span className="font-semibold text-[#1a1a2e]">{grupo.grp_id || 'Sem ID'}</span>
            <span>/</span>
            <Badge variant="outline" className="text-[#d4a853] border-[#d4a853]">{ABA_LABELS[activeTab]}</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs ${saved ? 'text-green-600' : 'text-orange-500'}`}>
              {saved ? '● Salvo' : '○ Não salvo'}
            </span>
            <Button onClick={handleSave} size="sm" className="bg-[#1a1a2e] hover:bg-[#2a2a4e]">
              <Save className="w-4 h-4 mr-1" /> Salvar
            </Button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {renderTab()}
        </main>
      </div>

      <FloatingResume grupo={grupo} />
    </div>
  );
}
