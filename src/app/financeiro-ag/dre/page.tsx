'use client';

import { useEffect, useState, useMemo } from 'react';
import { ContaReceber, ContaPagar, VendaCRM, PlanoContas } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText, TrendingUp, TrendingDown, DollarSign, Minus, Equal,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const PCT = (v: number) => `${v.toFixed(1)}%`;

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

interface DRELine {
  codigo: string;
  nome: string;
  valor: number;
  tipo: 'header' | 'item' | 'subtotal' | 'total';
  indent: number;
}

export default function DREPage() {
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [compareMonth, setCompareMonth] = useState('');

  async function load() {
    setLoading(true);
    const [cr, cp, v, pc] = await Promise.all([
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<PlanoContas>('plano-contas'),
    ]);
    setContasReceber(cr);
    setContasPagar(cp);
    setVendas(v);
    setPlanoContas(pc);

    const now = new Date();
    setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Available months from data
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    contasReceber.forEach(c => { const m = c.data_vencimento?.substring(0, 7); if (m) months.add(m); });
    contasPagar.forEach(c => { const m = c.data_vencimento?.substring(0, 7); if (m) months.add(m); });
    vendas.forEach(v => { const m = v.data_venda?.substring(0, 7); if (m) months.add(m); });
    // Add current month
    const now = new Date();
    months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    return [...months].sort().reverse();
  }, [contasReceber, contasPagar, vendas]);

  function buildDRE(month: string): DRELine[] {
    if (!month) return [];

    // Filter data for this month
    const monthReceber = contasReceber.filter(cr =>
      cr.data_vencimento?.substring(0, 7) === month && (cr.status === 'RECEBIDO' || cr.status === 'PENDENTE')
    );
    const monthPagar = contasPagar.filter(cp =>
      cp.data_vencimento?.substring(0, 7) === month && (cp.status === 'PAGO' || cp.status === 'PENDENTE')
    );
    const monthVendas = vendas.filter(v =>
      v.data_venda?.substring(0, 7) === month && v.status !== 'CANCELADO'
    );

    // Revenue from sales
    const receitaBrutaVendas = monthVendas.reduce((s, v) => s + v.valor_final, 0);

    // Revenue from receivables (comissoes, fees, etc.)
    const receitaComissoes = monthReceber
      .filter(cr => cr.origem === 'COMISSAO_FORNECEDOR')
      .reduce((s, cr) => s + cr.valor_final, 0);
    const receitaFee = monthReceber
      .filter(cr => cr.origem === 'FEE')
      .reduce((s, cr) => s + cr.valor_final, 0);
    const receitaOutras = monthReceber
      .filter(cr => cr.origem === 'OUTROS')
      .reduce((s, cr) => s + cr.valor_final, 0);

    const receitaBruta = receitaBrutaVendas + receitaComissoes + receitaFee + receitaOutras;

    // Costs by category (using plano de contas)
    function sumByCategory(prefix: string): number {
      const catIds = planoContas.filter(p => p.codigo.startsWith(prefix)).map(p => p.id);
      return monthPagar.filter(cp => catIds.includes(cp.categoria_id)).reduce((s, cp) => s + cp.valor_final, 0);
    }

    // Direct costs (CMV = Cost of Merchandise Sold)
    const cmv = sumByCategory('2.1');
    // If no categorization, approximate from vendas custo
    const cmvReal = cmv || monthVendas.reduce((s, v) => s + v.valor_total_custo, 0);

    // Operational expenses
    const despOperacionais = sumByCategory('2.2');
    const despComerciais = sumByCategory('2.6');
    const despTaxas = sumByCategory('2.3');
    const despFinanceiras = sumByCategory('2.4');
    const despOutras = sumByCategory('2.5');

    // Uncategorized expenses
    const categorizedIds = new Set(planoContas.map(p => p.id));
    const uncategorized = monthPagar
      .filter(cp => !categorizedIds.has(cp.categoria_id) && !cp.categoria_id)
      .reduce((s, cp) => s + cp.valor_final, 0);

    const totalDespesas = cmvReal + despOperacionais + despComerciais + despTaxas + despFinanceiras + despOutras + uncategorized;
    const lucroBruto = receitaBruta - cmvReal;
    const lucroOperacional = lucroBruto - despOperacionais - despComerciais;
    const lucroLiquido = receitaBruta - totalDespesas;
    const margemBruta = receitaBruta > 0 ? (lucroBruto / receitaBruta) * 100 : 0;
    const margemLiquida = receitaBruta > 0 ? (lucroLiquido / receitaBruta) * 100 : 0;

    const lines: DRELine[] = [
      { codigo: '', nome: 'RECEITA BRUTA', valor: receitaBruta, tipo: 'header', indent: 0 },
      { codigo: '1.0', nome: 'Vendas de Serviços', valor: receitaBrutaVendas, tipo: 'item', indent: 1 },
      { codigo: '1.1', nome: 'Comissões de Fornecedores', valor: receitaComissoes, tipo: 'item', indent: 1 },
      { codigo: '1.3', nome: 'Fee de Serviço', valor: receitaFee, tipo: 'item', indent: 1 },
      { codigo: '1.5', nome: 'Outras Receitas', valor: receitaOutras, tipo: 'item', indent: 1 },

      { codigo: '', nome: '(-) CUSTOS DIRETOS (CMV)', valor: -cmvReal, tipo: 'header', indent: 0 },
      { codigo: '2.1', nome: 'Custos de Vendas', valor: cmvReal, tipo: 'item', indent: 1 },

      { codigo: '', nome: 'LUCRO BRUTO', valor: lucroBruto, tipo: 'subtotal', indent: 0 },

      { codigo: '', nome: '(-) DESPESAS OPERACIONAIS', valor: -(despOperacionais + despComerciais), tipo: 'header', indent: 0 },
      { codigo: '2.2', nome: 'Despesas Operacionais', valor: despOperacionais, tipo: 'item', indent: 1 },
      { codigo: '2.6', nome: 'Custos Comerciais', valor: despComerciais, tipo: 'item', indent: 1 },

      { codigo: '', nome: 'LUCRO OPERACIONAL', valor: lucroOperacional, tipo: 'subtotal', indent: 0 },

      { codigo: '', nome: '(-) DESPESAS FINANCEIRAS E IMPOSTOS', valor: -(despTaxas + despFinanceiras), tipo: 'header', indent: 0 },
      { codigo: '2.3', nome: 'Taxas e Impostos', valor: despTaxas, tipo: 'item', indent: 1 },
      { codigo: '2.4', nome: 'Despesas Financeiras', valor: despFinanceiras, tipo: 'item', indent: 1 },
    ];

    if (despOutras > 0 || uncategorized > 0) {
      lines.push({ codigo: '', nome: '(-) OUTRAS DESPESAS', valor: -(despOutras + uncategorized), tipo: 'header', indent: 0 });
      if (despOutras > 0) lines.push({ codigo: '2.5', nome: 'Outras Despesas', valor: despOutras, tipo: 'item', indent: 1 });
      if (uncategorized > 0) lines.push({ codigo: '', nome: 'Não Categorizadas', valor: uncategorized, tipo: 'item', indent: 1 });
    }

    lines.push(
      { codigo: '', nome: 'LUCRO LÍQUIDO', valor: lucroLiquido, tipo: 'total', indent: 0 },
      { codigo: '', nome: `Margem Bruta: ${PCT(margemBruta)}`, valor: margemBruta, tipo: 'item', indent: 0 },
      { codigo: '', nome: `Margem Líquida: ${PCT(margemLiquida)}`, valor: margemLiquida, tipo: 'item', indent: 0 },
    );

    return lines;
  }

  const dreMain = useMemo(() => buildDRE(selectedMonth), [selectedMonth, contasReceber, contasPagar, vendas, planoContas]);
  const dreCompare = useMemo(() => compareMonth ? buildDRE(compareMonth) : [], [compareMonth, contasReceber, contasPagar, vendas, planoContas]);

  // Summary metrics from main DRE
  const receitaBruta = dreMain.find(l => l.nome === 'RECEITA BRUTA')?.valor || 0;
  const lucroBruto = dreMain.find(l => l.nome === 'LUCRO BRUTO')?.valor || 0;
  const lucroLiquido = dreMain.find(l => l.nome === 'LUCRO LÍQUIDO')?.valor || 0;

  if (loading) {
    return (
      <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6 flex items-center justify-center">
        <p className="text-[var(--t-text-secondary)]">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">DRE — Demonstrativo de Resultado</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Resultado financeiro calculado automaticamente a partir dos lançamentos</p>
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
            >
              {availableMonths.map(m => (
                <option key={m} value={m}>{getMonthLabel(m)}</option>
              ))}
            </select>
            <span className="text-xs text-[var(--t-text-muted)]">vs</span>
            <select
              value={compareMonth}
              onChange={e => setCompareMonth(e.target.value)}
              className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
            >
              <option value="">Sem comparação</option>
              {availableMonths.filter(m => m !== selectedMonth).map(m => (
                <option key={m} value={m}>{getMonthLabel(m)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <DollarSign className="w-8 h-8 text-[var(--t-blue)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Receita Bruta</p>
                <p className="text-xl font-bold text-[var(--t-blue)]">{BRL(receitaBruta)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <TrendingUp className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Lucro Bruto</p>
                <p className={`text-xl font-bold ${lucroBruto >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>{BRL(lucroBruto)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              {lucroLiquido >= 0
                ? <TrendingUp className="w-8 h-8 text-[var(--t-green)] shrink-0" />
                : <TrendingDown className="w-8 h-8 text-[var(--t-red)] shrink-0" />
              }
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Lucro Líquido</p>
                <p className={`text-xl font-bold ${lucroLiquido >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>{BRL(lucroLiquido)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* DRE Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--t-green)]" />
              {selectedMonth ? getMonthLabel(selectedMonth) : 'DRE'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                    <th className="text-left px-6 py-3">Conta</th>
                    <th className="text-right px-6 py-3">{selectedMonth ? getMonthLabel(selectedMonth) : 'Valor'}</th>
                    {compareMonth && <th className="text-right px-6 py-3">{getMonthLabel(compareMonth)}</th>}
                    {compareMonth && <th className="text-right px-6 py-3">Variação</th>}
                  </tr>
                </thead>
                <tbody>
                  {dreMain.map((line, idx) => {
                    const compareLine = dreCompare[idx];
                    const variacao = compareLine ? line.valor - compareLine.valor : 0;
                    const isMargin = line.nome.startsWith('Margem');

                    if (isMargin) {
                      return (
                        <tr key={idx} className="border-t border-[var(--t-border)]">
                          <td colSpan={compareMonth ? 4 : 2} className="px-6 py-2 text-xs text-[var(--t-text-muted)]">
                            {line.nome}
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr
                        key={idx}
                        className={`border-b border-[var(--t-border)] transition-colors ${
                          line.tipo === 'header' ? 'bg-[var(--t-bg)]' :
                          line.tipo === 'total' ? 'bg-[var(--t-green)]/5' :
                          line.tipo === 'subtotal' ? 'bg-[var(--t-bg)]' :
                          'hover:bg-[var(--t-surface-hover)]'
                        }`}
                      >
                        <td
                          className={`px-6 py-3 ${
                            line.tipo === 'header' ? 'font-semibold text-[var(--t-text-secondary)] text-xs uppercase' :
                            line.tipo === 'total' ? 'font-bold text-[var(--t-text)] text-base' :
                            line.tipo === 'subtotal' ? 'font-semibold text-[var(--t-text)]' :
                            'text-[var(--t-text-secondary)]'
                          }`}
                          style={{ paddingLeft: `${24 + line.indent * 16}px` }}
                        >
                          {line.tipo === 'subtotal' && <Equal className="w-3 h-3 inline mr-1 text-[var(--t-text-muted)]" />}
                          {line.tipo === 'total' && <Equal className="w-4 h-4 inline mr-1 text-[var(--t-green)]" />}
                          {line.nome}
                        </td>
                        <td className={`px-6 py-3 text-right font-mono ${
                          line.tipo === 'total' ? `text-base font-bold ${line.valor >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}` :
                          line.tipo === 'subtotal' ? `font-semibold ${line.valor >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}` :
                          line.tipo === 'header' ? `font-medium ${line.valor >= 0 ? 'text-[var(--t-text)]' : 'text-[var(--t-red)]'}` :
                          'text-[var(--t-text-secondary)]'
                        }`}>
                          {line.tipo === 'item' ? BRL(line.valor) : BRL(line.valor)}
                        </td>
                        {compareMonth && (
                          <>
                            <td className="px-6 py-3 text-right font-mono text-[var(--t-text-secondary)]">
                              {compareLine ? BRL(compareLine.valor) : '—'}
                            </td>
                            <td className="px-6 py-3 text-right">
                              {compareLine && variacao !== 0 ? (
                                <Badge className={`${variacao > 0 ? 'bg-[var(--t-green-bg)] text-[var(--t-green)]' : 'bg-[var(--t-red-bg)] text-[var(--t-red)]'} border-0 text-xs font-mono`}>
                                  {variacao > 0 ? '+' : ''}{BRL(variacao)}
                                </Badge>
                              ) : (
                                <span className="text-[var(--t-text-muted)]">—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
