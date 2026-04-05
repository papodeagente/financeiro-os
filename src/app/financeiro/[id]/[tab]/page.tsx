'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { GrupoViagem, ABA_LABELS, AbaType } from '@/lib/types';
import { loadGrupos, saveGrupo } from '@/lib/storage';
import { useApp } from '@/contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VendasTab } from '@/components/tabs/financial/VendasTab';
import RecebimentosTab from '@/components/tabs/financial/RecebimentosTab';
import FornecedoresTab from '@/components/tabs/financial/FornecedoresTab';
import FluxoCaixaTab from '@/components/tabs/financial/FluxoCaixaTab';
import DRETab from '@/components/tabs/financial/DRETab';
import IndicadoresTab from '@/components/tabs/financial/IndicadoresTab';
import PainelTab from '@/components/tabs/financial/PainelTab';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { Save } from 'lucide-react';
import Link from 'next/link';

const VALID_TABS = ['painel', 'vendas', 'recebimentos', 'fornecedores', 'fluxo_caixa', 'dre', 'indicadores'];

export default function FinanceiroPage({ params }: { params: Promise<{ id: string; tab: string }> }) {
  const { id, tab } = use(params);
  const router = useRouter();
  const { setActiveGrupo } = useApp();
  const [grupo, setGrupo] = useState<GrupoViagem | null>(null);
  const [saved, setSaved] = useState(true);

  const activeTab = VALID_TABS.includes(tab) ? tab : 'painel';

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
      case 'painel': return <PainelTab grupo={grupo} />;
      case 'vendas': return <VendasTab grupo={grupo} onChange={handleChange} />;
      case 'recebimentos': return <RecebimentosTab grupo={grupo} onChange={handleChange} />;
      case 'fornecedores': return <FornecedoresTab grupo={grupo} onChange={handleChange} />;
      case 'fluxo_caixa': return <FluxoCaixaTab grupo={grupo} />;
      case 'dre': return <DRETab grupo={grupo} onChange={handleChange} />;
      case 'indicadores': return <IndicadoresTab grupo={grupo} onChange={handleChange} />;
      default: return <PainelTab grupo={grupo} />;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Top bar */}
      <header className="bg-[var(--t-surface)] border-b border-[var(--t-border)] px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm text-[var(--t-text-secondary)]">
          <Link href="/financeiro-grupos" className="hover:text-[var(--t-text)]">Fin. Produtos</Link>
          <span>/</span>
          <Link href={`/grupo/${grupo.id}`} className="hover:text-[var(--t-text)] font-semibold text-[var(--t-text)]">
            {grupo.grp_id || 'Sem ID'}
          </Link>
          <span>/</span>
          <Badge variant="outline" className="text-[var(--t-accent)] border-[var(--t-accent)]">
            {ABA_LABELS[activeTab as AbaType] || activeTab.toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${saved ? 'text-green-600' : 'text-orange-500'}`}>
            {saved ? '● Salvo' : '○ Não salvo'}
          </span>
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
  );
}
