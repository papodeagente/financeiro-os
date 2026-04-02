'use client';

import { useState, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { loadGrupos } from '@/lib/storage';
import { formatDate, formatBRL } from '@/lib/utils';
import { getProdutoGrupo } from '@/lib/financial-calculations';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Package, Search, LayoutDashboard, ShoppingCart, Receipt,
  Factory, TrendingUp, FileText, Gauge,
} from 'lucide-react';
import Link from 'next/link';

const FIN_TABS = [
  { tab: 'painel', label: 'Painel', icon: LayoutDashboard },
  { tab: 'vendas', label: 'Vendas', icon: ShoppingCart },
  { tab: 'recebimentos', label: 'Recebim.', icon: Receipt },
  { tab: 'fornecedores', label: 'Fornec.', icon: Factory },
  { tab: 'fluxo_caixa', label: 'Fluxo Cx', icon: TrendingUp },
  { tab: 'dre', label: 'DRE', icon: FileText },
  { tab: 'indicadores', label: 'Indicad.', icon: Gauge },
];

export default function FinanceiroGruposPage() {
  const [grupos, setGrupos] = useState<GrupoViagem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGrupos().then(g => { setGrupos(g); setLoading(false); });
  }, []);

  const filtered = grupos.filter(g => {
    const q = search.toLowerCase();
    return !q || (g.grp_id || '').toLowerCase().includes(q) || (g.origem_destino || '').toLowerCase().includes(q);
  });

  // Calculate summary for each grupo
  const getGrupoSummary = (g: GrupoViagem) => {
    try {
      const produto = getProdutoGrupo(g);
      // custos_por_apto has lines like 'custo total' or similar
      const custoEntries = Object.values(produto.custos_por_apto) as Array<Record<string, number>>;
      const custoSgl = custoEntries.reduce((sum, entry) => sum + (entry.sgl || 0), 0);
      return {
        custoTotal: custoSgl,
        precoVenda: produto.precos.avista.sgl || 0,
        hasFinanceiro: !!g.financeiro,
        vendas: g.financeiro?.vendas?.length || 0,
        recebimentos: g.financeiro?.parcelas?.filter(p => p.status === 'RECEBIDO').length || 0,
        totalParcelas: g.financeiro?.parcelas?.length || 0,
      };
    } catch {
      return { custoTotal: 0, precoVenda: 0, hasFinanceiro: false, vendas: 0, recebimentos: 0, totalParcelas: 0 };
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-[var(--t-text-secondary)]">Carregando...</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] shadow-lg shrink-0">
        <div className="px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Financeiro <span className="text-[var(--t-accent)]">de Grupos</span></h1>
            <p className="text-sm text-[var(--t-text-secondary)] mt-1">Gestão financeira dos produtos de grupo</p>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-secondary)]" />
            <Input
              className="pl-9 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-secondary)]"
              placeholder="Buscar grupo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <Package className="w-16 h-16 mx-auto text-[var(--t-text-secondary)] mb-4" />
            <h2 className="text-xl font-semibold text-[var(--t-text-muted)]">
              {grupos.length === 0 ? 'Nenhum grupo criado' : 'Nenhum grupo encontrado'}
            </h2>
            <p className="text-[var(--t-text-secondary)] mt-2">
              {grupos.length === 0
                ? 'Crie um produto em Produtos → Grupos primeiro'
                : 'Tente outro termo de busca'}
            </p>
            {grupos.length === 0 && (
              <Link href="/grupos">
                <Button className="mt-4 bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)]">
                  Ir para Produtos
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(g => {
              const summary = getGrupoSummary(g);
              return (
                <Card key={g.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-[#d4a853]">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      {/* Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-bold text-lg text-[var(--t-text)]">{g.grp_id || 'Sem ID'}</h3>
                          <Badge variant="outline" className="text-xs">
                            {g.origem_destino || 'Sem destino'}
                          </Badge>
                          {summary.hasFinanceiro && (
                            <Badge className="bg-green-100 text-green-700 text-xs">Financeiro ativo</Badge>
                          )}
                        </div>
                        <div className="flex gap-6 text-sm text-[var(--t-text-secondary)]">
                          <span>Custo/pax: <strong className="text-[var(--t-text)]">{formatBRL(summary.custoTotal)}</strong></span>
                          <span>Venda/pax: <strong className="text-[var(--t-accent)]">{formatBRL(summary.precoVenda)}</strong></span>
                          <span>Vendas: <strong>{summary.vendas}</strong></span>
                          <span>Recebido: <strong>{summary.recebimentos}/{summary.totalParcelas}</strong></span>
                          <span className="text-xs text-[var(--t-text-secondary)]">Atualizado: {formatDate(g.updated_at?.split('T')[0])}</span>
                        </div>
                      </div>

                      {/* Quick access tabs */}
                      <div className="flex gap-1 ml-4">
                        {FIN_TABS.map(({ tab, label, icon: Icon }) => (
                          <Link key={tab} href={`/financeiro/${g.id}/${tab}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs hover:bg-[var(--t-accent)] hover:text-[var(--t-text)] hover:border-[var(--t-accent)]"
                              title={label}
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
