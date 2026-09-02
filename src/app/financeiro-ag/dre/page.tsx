'use client';

import { useEffect, useState, useMemo } from 'react';
import { ContaReceber, ContaPagar, VendaCRM, PlanoContas } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText, TrendingUp, TrendingDown, DollarSign, Minus, Equal,
  Info, X,
} from 'lucide-react';
import { MetricExplainer } from '@/components/financeiro/MetricExplainer';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { toast } from '@/lib/toast';
import { soma, somaPor, round2, num, divSegura, mesDe, hojeISO } from '@/lib/money';

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
  // Modo Simplificado (default) vs Completo — persistido em localStorage
  const [modoSimplificado, setModoSimplificado] = useState<boolean>(true);
  // Banner "Como ler" — fechável, persiste em localStorage
  const [bannerVisivel, setBannerVisivel] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = window.localStorage.getItem('dre-modo-simplificado');
    if (m !== null) setModoSimplificado(m === 'true');
    const b = window.localStorage.getItem('dre-banner-dismissed');
    if (b === 'true') setBannerVisivel(false);
  }, []);

  const alternarModo = (simpl: boolean) => {
    setModoSimplificado(simpl);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dre-modo-simplificado', String(simpl));
    }
  };

  const dispensarBanner = () => {
    setBannerVisivel(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dre-banner-dismissed', 'true');
    }
  };

  // Toast quando troca de mês
  const trocarMes = (m: string) => {
    setSelectedMonth(m);
    toast.info(`DRE carregada · ${getMonthLabel(m)}`);
  };

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

    setSelectedMonth(mesDe(hojeISO()));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Available months from data
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    contasReceber.forEach(c => { const m = mesDe(c.data_vencimento); if (m) months.add(m); });
    contasPagar.forEach(c => { const m = mesDe(c.data_vencimento); if (m) months.add(m); });
    vendas.forEach(v => { const m = mesDe(v.data_venda); if (m) months.add(m); });
    // Add current month
    months.add(mesDe(hojeISO()));
    return [...months].sort().reverse();
  }, [contasReceber, contasPagar, vendas]);

  // Quanto de cada CR de comissão AINDA NÃO está representado na margem da
  // sua venda. Calculado uma vez para todos os meses (a venda cai num mês e a
  // comissão vence noutro): a margem de cada venda é consumida pelas suas
  // comissões na ordem de vencimento, e o que sobrar da comissão é receita
  // própria a reconhecer.
  const comissaoNaoCapturada = useMemo(() => {
    const restante = new Map<string, number>();
    for (const v of vendas) {
      if (v.status === 'CANCELADO') continue;
      restante.set(v.id, Math.max(round2(num(v.valor_final) - num(v.valor_total_custo)), 0));
    }
    const fora = new Map<string, number>();
    const comissoes = contasReceber
      .filter(cr => cr.origem === 'COMISSAO_FORNECEDOR')
      .sort((a, b) => String(a.data_vencimento).localeCompare(String(b.data_vencimento)));
    for (const cr of comissoes) {
      const vendaId = cr.origem_venda_id || cr.venda_id || '';
      const valor = round2(num(cr.valor_final));
      const margem = vendaId ? (restante.get(vendaId) ?? 0) : 0;
      const capturado = Math.min(margem, valor);
      if (vendaId && restante.has(vendaId)) restante.set(vendaId, round2(margem - capturado));
      fora.set(cr.id, round2(valor - capturado));
    }
    return fora;
  }, [contasReceber, vendas]);

  // DRE para AGÊNCIA DE VIAGENS — CNAE 7911-2/00
  // Regime de INTERMEDIAÇÃO: a agência recebe apenas a COMISSÃO sobre a
  // venda. O valor pago à companhia aérea/hotel/operadora é repasse, não
  // custo da agência (CMV = 0). Receita Bruta = comissão (valor_venda −
  // custo_pago_ao_fornecedor) + comissões diretas + fees + outras receitas
  // próprias. Sem 'Vendas de Serviços' inflando a receita.
  function buildDRE(month: string): DRELine[] {
    if (!month) return [];

    // Competência: entra tudo que não foi cancelado — inclusive ATRASADO e
    // PARCIAL. Listar só RECEBIDO/PENDENTE fazia a conta parcialmente
    // recebida (ou vencida) sumir INTEIRA do relatório.
    const vivo = (s: string | undefined) => String(s ?? '') !== 'CANCELADO';
    const monthReceber = contasReceber.filter(cr =>
      mesDe(cr.data_vencimento) === month && vivo(cr.status)
    );
    const monthPagar = contasPagar.filter(cp =>
      mesDe(cp.data_vencimento) === month && vivo(cp.status)
    );
    const monthVendas = vendas.filter(v =>
      mesDe(v.data_venda) === month && v.status !== 'CANCELADO'
    );

    // VOLUME intermediado (informativo — não entra na DRE; é só
    // referência de quanto a agência movimentou)
    const volumeIntermediado = somaPor(monthVendas, v => v.valor_final);

    // RECEITA BRUTA = margem (comissão) das vendas + comissões de
    // fornecedores recebidas explicitamente + fees + outras receitas.
    // É a base sobre a qual incidem impostos (ISS, PIS/COFINS).
    const comissaoVendas = somaPor(monthVendas, v =>
      Math.max(round2(num(v.valor_final) - num(v.valor_total_custo)), 0)
    );

    // FONTE ÚNICA, por DEDUÇÃO (não por exclusão): a comissão de uma venda
    // entra na Receita Bruta UMA vez. Quando a margem da venda já a contém
    // (linha 1.1), a CR espelho não soma de novo. Mas no fluxo "cliente paga
    // o fornecedor" a venda não tem margem própria (margem = 0) e a comissão
    // É a receita — excluí-la simplesmente apagava esse dinheiro do DRE dos
    // dois meses (o da venda e o do vencimento da comissão).
    const receitaComissoes = somaPor(
      monthReceber.filter(cr => cr.origem === 'COMISSAO_FORNECEDOR'),
      cr => round2(num(comissaoNaoCapturada.get(cr.id) ?? num(cr.valor_final))),
    );
    const receitaFee = somaPor(monthReceber.filter(cr => cr.origem === 'FEE'), cr => cr.valor_final);
    const receitaOutras = somaPor(monthReceber.filter(cr => cr.origem === 'OUTROS'), cr => cr.valor_final);

    const receitaBruta = soma([comissaoVendas, receitaComissoes, receitaFee, receitaOutras]);

    // CP auto-gerada pela venda = repasse ao fornecedor. Neste regime o
    // cliente paga o fornecedor direto, então não é despesa da agência.
    const ehRepasseDeVenda = (cp: ContaPagar) => !!cp.auto_gerado && cp.origem === 'VENDA';

    const idsDoPrefixo = (prefixo: string) =>
      planoContas.filter(p => p.codigo?.startsWith(prefixo)).map(p => p.id);

    function sumByCategory(prefix: string): number {
      const catIds = new Set(idsDoPrefixo(prefix));
      return somaPor(monthPagar.filter(cp => catIds.has(cp.categoria_id)), cp => cp.valor_final);
    }

    // CNAE 7911-2: não tem CMV. Custo do fornecedor é repasse direto
    // do cliente, não despesa da agência. Categorias 2.2..2.6 cobrem
    // as despesas operacionais reais.
    const despOperacionais = sumByCategory('2.2');
    const despComerciais = sumByCategory('2.6');
    const despTaxas = sumByCategory('2.3');
    const despFinanceiras = sumByCategory('2.4');
    const despOutras = sumByCategory('2.5');

    // 2.1 (CMV do plano padrão) não tem linha própria neste regime, mas o
    // dinheiro precisa aparecer: o que sobra depois de tirar o repasse
    // auto-gerado de venda é despesa real e vai para "Outras despesas".
    const idsCMV = new Set(idsDoPrefixo('2.1'));
    const despCMV = somaPor(
      monthPagar.filter(cp => idsCMV.has(cp.categoria_id) && !ehRepasseDeVenda(cp)),
      cp => cp.valor_final,
    );

    // Condição de NEGAÇÃO sobre os ids conhecidos: qualquer conta cuja
    // categoria não caia num bucket da DRE (categoria apagada, id órfão ou
    // categoria vazia) vira "Não categorizadas". Antes o filtro exigia
    // categoria_id vazio e o dinheiro das outras sumia do relatório inteiro.
    const PREFIXOS_DRE = ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6'];
    const idsConhecidos = new Set(PREFIXOS_DRE.flatMap(idsDoPrefixo));
    const uncategorized = somaPor(
      monthPagar.filter(cp => !idsConhecidos.has(cp.categoria_id) && !ehRepasseDeVenda(cp)),
      cp => cp.valor_final,
    );

    const totalDespesas = soma([despOperacionais, despComerciais, despTaxas, despFinanceiras, despOutras, despCMV, uncategorized]);
    const outrasDespesas = soma([despOutras, despCMV, uncategorized]);
    const receitaLiquida = round2(receitaBruta - despTaxas);
    const resultadoOperacional = round2(receitaLiquida - despOperacionais - despComerciais);
    const lucroLiquido = round2(receitaBruta - totalDespesas);
    const margemLiquida = round2(divSegura(lucroLiquido, receitaBruta) * 100);
    const margemSobreVolume = round2(divSegura(receitaBruta, volumeIntermediado) * 100);

    const lines: DRELine[] = [];

    // Informativo no topo: volume intermediado (não entra na conta)
    if (volumeIntermediado > 0) {
      lines.push({ codigo: '', nome: 'VOLUME INTERMEDIADO (informativo)', valor: volumeIntermediado, tipo: 'header', indent: 0 });
      lines.push({ codigo: '0.1', nome: 'Total transacionado (passagens, hotéis, etc.)', valor: volumeIntermediado, tipo: 'item', indent: 1 });
    }

    lines.push(
      { codigo: '', nome: 'RECEITA BRUTA (comissão + serviços)', valor: receitaBruta, tipo: 'header', indent: 0 },
      { codigo: '1.1', nome: 'Comissão sobre vendas', valor: comissaoVendas, tipo: 'item', indent: 1 },
      { codigo: '1.2', nome: 'Comissões de fornecedores', valor: receitaComissoes, tipo: 'item', indent: 1 },
      { codigo: '1.3', nome: 'Fee de serviço', valor: receitaFee, tipo: 'item', indent: 1 },
      { codigo: '1.5', nome: 'Outras receitas', valor: receitaOutras, tipo: 'item', indent: 1 },

      { codigo: '', nome: '(-) IMPOSTOS SOBRE A RECEITA', valor: -despTaxas, tipo: 'header', indent: 0 },
      { codigo: '2.3', nome: 'ISS, PIS, COFINS e outros', valor: despTaxas, tipo: 'item', indent: 1 },

      { codigo: '', nome: 'RECEITA LÍQUIDA', valor: receitaLiquida, tipo: 'subtotal', indent: 0 },

      { codigo: '', nome: '(-) DESPESAS OPERACIONAIS', valor: -(despOperacionais + despComerciais), tipo: 'header', indent: 0 },
      { codigo: '2.2', nome: 'Despesas operacionais (aluguel, salários, etc.)', valor: despOperacionais, tipo: 'item', indent: 1 },
      { codigo: '2.6', nome: 'Despesas comerciais (marketing, comissão vendedor)', valor: despComerciais, tipo: 'item', indent: 1 },

      { codigo: '', nome: 'RESULTADO OPERACIONAL', valor: resultadoOperacional, tipo: 'subtotal', indent: 0 },

      { codigo: '', nome: '(-) DESPESAS FINANCEIRAS', valor: -despFinanceiras, tipo: 'header', indent: 0 },
      { codigo: '2.4', nome: 'Juros, tarifas bancárias', valor: despFinanceiras, tipo: 'item', indent: 1 },
    );

    if (outrasDespesas !== 0) {
      lines.push({ codigo: '', nome: '(-) OUTRAS DESPESAS', valor: -outrasDespesas, tipo: 'header', indent: 0 });
      if (despOutras !== 0) lines.push({ codigo: '2.5', nome: 'Outras despesas', valor: despOutras, tipo: 'item', indent: 1 });
      if (despCMV !== 0) lines.push({ codigo: '2.1', nome: 'Custos diretos (CMV)', valor: despCMV, tipo: 'item', indent: 1 });
      if (uncategorized !== 0) lines.push({ codigo: '', nome: 'Não categorizadas', valor: uncategorized, tipo: 'item', indent: 1 });
    }

    lines.push(
      { codigo: '', nome: 'LUCRO LÍQUIDO', valor: lucroLiquido, tipo: 'total', indent: 0 },
      { codigo: '', nome: `Margem líquida (sobre receita): ${PCT(margemLiquida)}`, valor: margemLiquida, tipo: 'item', indent: 0 },
      { codigo: '', nome: `Margem sobre volume intermediado: ${PCT(margemSobreVolume)}`, valor: margemSobreVolume, tipo: 'item', indent: 0 },
    );

    return lines;
  }

  const dreMain = useMemo(() => buildDRE(selectedMonth), [selectedMonth, contasReceber, contasPagar, vendas, planoContas]);
  const dreCompare = useMemo(() => compareMonth ? buildDRE(compareMonth) : [], [compareMonth, contasReceber, contasPagar, vendas, planoContas]);

  // Summary metrics from main DRE
  const receitaBruta = dreMain.find(l => l.nome.startsWith('RECEITA BRUTA'))?.valor || 0;
  const receitaLiquida = dreMain.find(l => l.nome === 'RECEITA LÍQUIDA')?.valor || 0;
  const lucroLiquido = dreMain.find(l => l.nome === 'LUCRO LÍQUIDO')?.valor || 0;

  // Modo Simplificado: mostra só os totais principais. Modo Completo: tudo.
  // Iniciante consegue ler 4-6 linhas; contador prefere ver detalhe.
  const SIMPL_KEEP = [
    'RECEITA BRUTA',
    '(-) IMPOSTOS SOBRE A RECEITA',
    'RECEITA LÍQUIDA',
    '(-) DESPESAS OPERACIONAIS',
    '(-) DESPESAS FINANCEIRAS',
    '(-) OUTRAS DESPESAS',
    'LUCRO LÍQUIDO',
  ];
  const dreFiltrado = modoSimplificado
    ? dreMain.filter(l => {
        // Mantém só headers/totals/subtotais principais + linhas que começam com "Margem"
        const ehChave = SIMPL_KEEP.some(k => l.nome.startsWith(k));
        const ehMargem = l.nome.startsWith('Margem');
        return ehChave || ehMargem;
      })
    : dreMain;
  const dreCompareFiltrado = modoSimplificado
    ? dreCompare.filter(l => {
        const ehChave = SIMPL_KEEP.some(k => l.nome.startsWith(k));
        const ehMargem = l.nome.startsWith('Margem');
        return ehChave || ehMargem;
      })
    : dreCompare;

  // Comparação casada pelo NOME da linha: dois meses podem ter conjuntos de
  // linhas diferentes (volume intermediado, outras despesas), e casar por
  // índice colocava lado a lado valores de contas distintas.
  const compareByNome = new Map<string, DRELine>();
  for (const l of dreCompareFiltrado) if (!compareByNome.has(l.nome)) compareByNome.set(l.nome, l);

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

        {/* Header padronizado MinimalPageHead com toggle + dropdowns como actions */}
        <MinimalPageHead
          title="DRE — Demonstrativo de Resultado"
          meta={
            <p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
              Regime de intermediação <span className="font-medium" style={{ color: 'var(--ink-2)' }}>CNAE 7911-2/00</span> · Receita Bruta = comissão (margem), não o valor total
            </p>
          }
          actions={
            <>
              {/* Toggle Simplificado / Completo (segmented control) */}
              <div className="inline-flex border" style={{ borderColor: 'var(--line)', height: '34px' }}>
                {[
                  { key: 'simpl', label: 'Simplificado', active: modoSimplificado },
                  { key: 'comp', label: 'Completo', active: !modoSimplificado },
                ].map((opt, i, arr) => (
                  <button
                    key={opt.key}
                    onClick={() => alternarModo(opt.key === 'simpl')}
                    className="px-3 text-[12px] transition-colors"
                    style={{
                      color: opt.active ? 'var(--ink)' : 'var(--ink-3)',
                      fontWeight: opt.active ? 500 : 400,
                      background: opt.active ? 'var(--ink-surface-2)' : 'transparent',
                      borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <select
                value={selectedMonth}
                onChange={e => trocarMes(e.target.value)}
                className="h-[34px] px-3 text-[12px] border"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              >
                {availableMonths.map(m => (
                  <option key={m} value={m}>{getMonthLabel(m)}</option>
                ))}
              </select>
              <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>vs</span>
              <select
                value={compareMonth}
                onChange={e => setCompareMonth(e.target.value)}
                className="h-[34px] px-3 text-[12px] border"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              >
                <option value="">Sem comparação</option>
                {availableMonths.filter(m => m !== selectedMonth).map(m => (
                  <option key={m} value={m}>{getMonthLabel(m)}</option>
                ))}
              </select>
            </>
          }
        />

        {/* Banner explicativo — primeira visita */}
        {bannerVisivel && (
          <div className="rounded-xl border border-[var(--t-blue)]/30 bg-[var(--t-blue-bg)] p-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-[var(--t-blue)] shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-[var(--t-text)]">
              <p className="font-semibold mb-1">Como ler esta DRE</p>
              <p className="text-[var(--t-text-secondary)]">
                Sua agência opera no regime de intermediação <strong>CNAE 7911-2/00</strong>. Isso significa que o que você fatura para o cliente (passagens, hotéis) <strong>NÃO é sua receita</strong> — sua receita é só a comissão. Por isso o DRE mostra <strong>Volume Intermediado</strong> (informativo) separado da <strong>Receita Bruta</strong> (sua margem real, sobre a qual incidem impostos).
              </p>
            </div>
            <button onClick={dispensarBanner} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)] shrink-0" aria-label="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <DollarSign className="w-8 h-8 text-[var(--t-blue)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase flex items-center">
                  Receita Bruta
                  <MetricExplainer
                    title="Receita Bruta (agência)"
                    text={'Margem das vendas + comissões de fornecedores + fees + outras receitas próprias da agência.\n\nÉ sobre este valor que incidem impostos (ISS, PIS/COFINS, Simples).'}
                  />
                </p>
                <p className="text-xl font-bold text-[var(--t-blue)]">{BRL(receitaBruta)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <TrendingUp className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase flex items-center">
                  Receita Líquida
                  <MetricExplainer
                    title="Receita Líquida"
                    text="Receita Bruta menos os impostos sobre faturamento (ISS, PIS, COFINS). É a receita que efetivamente sobra para cobrir despesas operacionais."
                  />
                </p>
                <p className={`text-xl font-bold ${receitaLiquida >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>{BRL(receitaLiquida)}</p>
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
                  {dreFiltrado.map((line, idx) => {
                    const compareLine = compareByNome.get(line.nome);
                    const variacao = compareLine ? round2(line.valor - compareLine.valor) : 0;
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

        <MinimalFooter pageId="DRE" />
      </div>
    </div>
  );
}
