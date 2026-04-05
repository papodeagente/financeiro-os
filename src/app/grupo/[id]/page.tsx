'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { GrupoViagem, AbaType, ABA_LABELS } from '@/lib/types';
import { loadGrupos, saveGrupo } from '@/lib/storage';
import { useApp } from '@/contexts/AppContext';
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
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { Save, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';

const ABAS_PLANEJAMENTO: AbaType[] = ['inf', 'tkt', 'htl', 'rec', 'car', 'guia', 'seg', 'navio', 'ing', 'brinde', 'proposta', 'htl_seg'];

const ABA_ICONS: Record<string, string> = {
  inf: 'ℹ️', tkt: '✈️', htl: '🏨', rec: '🎯', car: '🚐', guia: '🧑‍🏫',
  seg: '🛡️', navio: '🚢', ing: '🎟️', brinde: '🎁', proposta: '💰', htl_seg: '📊',
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
  const { setActiveGrupo } = useApp();
  const [grupo, setGrupo] = useState<GrupoViagem | null>(null);
  const [activeTab, setActiveTab] = useState<AbaType>('inf');
  const [saved, setSaved] = useState(true);
  const [gerandoProposta, setGerandoProposta] = useState(false);

  useEffect(() => {
    loadGrupos().then(grupos => {
      const found = grupos.find(g => g.id === id);
      if (found) {
        if (!found.financeiro) found.financeiro = createFinanceiroGrupo();
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

  const handleGerarProposta = async () => {
    if (!grupo) return;
    setGerandoProposta(true);
    try {
      const res = await fetch('/api/propostas/from-grupo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id: grupo.id }),
      });
      const data = await res.json();
      if (data.id) {
        router.push(`/propostas/${data.id}`);
      } else {
        alert(data.error || 'Erro ao gerar proposta');
      }
    } catch {
      alert('Erro ao gerar proposta');
    }
    setGerandoProposta(false);
  };

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

  if (!grupo) return <div className="flex items-center justify-center h-full">Carregando...</div>;

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
    }
  };

  return (
    <div className="flex h-full">
      {/* Inner sidebar - Planning tabs only */}
      <aside className="w-[82px] bg-[var(--t-bg)] text-[var(--t-text)] flex flex-col items-center py-3 gap-1 overflow-y-auto shrink-0 border-r border-[var(--t-border)]">
        <div className="text-[8px] uppercase tracking-wider text-[var(--t-text-secondary)] mb-1">Produto</div>
        {ABAS_PLANEJAMENTO.map(aba => (
          <button
            key={aba}
            onClick={() => setActiveTab(aba)}
            className={`w-[72px] py-1.5 rounded-lg text-center transition-all ${
              activeTab === aba ? 'bg-[var(--t-accent)] text-[var(--t-text)]' : 'hover:bg-[var(--t-surface-hover)]'
            }`}
          >
            <div className="text-sm">{ABA_ICONS[aba]}</div>
            <div className="text-[9px] font-semibold leading-tight">{ABA_LABELS[aba]}</div>
            {hasData(grupo, aba) && <div className="w-1.5 h-1.5 rounded-full bg-green-400 mx-auto mt-0.5" />}
          </button>
        ))}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-[var(--t-surface)] border-b border-[var(--t-border)] px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm text-[var(--t-text-secondary)]">
            <Link href="/grupos" className="hover:text-[var(--t-text)]">Produtos</Link>
            <span>/</span>
            <span className="font-semibold text-[var(--t-text)]">{grupo.grp_id || 'Sem ID'}</span>
            <span>/</span>
            <Badge variant="outline" className="text-[var(--t-accent)] border-[var(--t-accent)]">{ABA_LABELS[activeTab]}</Badge>
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
            <Button onClick={handleSave} size="sm" className="bg-[var(--t-header-bg)] hover:bg-[var(--t-surface-hover)]">
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
