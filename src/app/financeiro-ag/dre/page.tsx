'use client';

import { useEffect, useState, useMemo } from 'react';
import { Info, X } from 'lucide-react';
import { ContaReceber, ContaPagar, VendaCRM, PlanoContas } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { vendasComLancamento, apenasVendasComLastro } from '@/lib/venda-lancamentos';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { FilterBar } from '@/components/fin/FilterBar';
import { Jargao } from '@/components/fin/Jargao';
import { MetricCard } from '@/components/fin/MetricCard';
import { PageHeader } from '@/components/fin/PageHeader';
import type { MoneyEstado } from '@/components/fin/Money';
import { toast } from '@/lib/toast';
import { soma, somaPor, round2, num, divSegura, mesDe, hojeISO } from '@/lib/money';
import { formatBRL } from '@/lib/utils';
import {
  DemonstrativoTabela,
  type LinhaDemonstrativo,
  type NotaDemonstrativo,
} from './DemonstrativoTabela';

const PCT = (v: number) => `${v.toFixed(1)}%`;

const pctBR = (v: number) =>
  `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(v)}%`;

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

/**
 * Camada de apresentação: o `nome` continua sendo a chave que casa os dois
 * meses e o filtro do modo resumido, e não muda. Só o rótulo visível muda,
 * para caixa de frase e para o vocabulário do dono da agência.
 */
const ROTULO_LINHA: Record<string, string> = {
  'VOLUME INTERMEDIADO (informativo)': 'Volume vendido (não é sua receita)',
  'RECEITA BRUTA (comissão + serviços)': 'Receita bruta (comissão e serviços)',
  '(-) IMPOSTOS SOBRE A RECEITA': '(-) Impostos sobre a receita',
  'RECEITA LÍQUIDA': 'Receita líquida',
  '(-) DESPESAS OPERACIONAIS': '(-) Despesas operacionais',
  'RESULTADO OPERACIONAL': 'Resultado operacional',
  '(-) DESPESAS FINANCEIRAS': '(-) Despesas financeiras',
  '(-) OUTRAS DESPESAS': '(-) Outras despesas',
  'LUCRO LÍQUIDO': 'Lucro líquido',
};

const EXPLICACAO_VOLUME =
  'Total que passou pela agência no mês (passagens, hotéis, pacotes). No regime de intermediação (CNAE 7911-2/00) esse dinheiro é repasse ao fornecedor, não receita sua.';

const NOTA_MARGEM_RECEITA = 'Margem sobre a receita';
const NOTA_MARGEM_VOLUME = 'Margem sobre o volume vendido';

function rotuloNota(nome: string): string {
  return nome.startsWith('Margem líquida') ? NOTA_MARGEM_RECEITA : NOTA_MARGEM_VOLUME;
}

export default function DREPage() {
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [compareMonth, setCompareMonth] = useState('');
  // Modo Simplificado (default) vs Completo, persistido em localStorage
  const [modoSimplificado, setModoSimplificado] = useState<boolean>(true);
  // Banner "Como ler": fechável, persiste em localStorage
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
    toast.info(`Resultado de ${getMonthLabel(m)}`);
  };

  async function load() {
    setLoading(true);
    setErro(false);
    try {
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
      setAtualizadoEm(new Date());
    } catch {
      setErro(true);
    } finally {
      setLoading(false);
    }
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

  // VENDA SÓ CONTA ENQUANTO TIVER LANÇAMENTO.
  //
  // A receita das linhas 0.1 e 1.1 saía direto de vendas_crm, sem olhar as
  // contas. Quem apagava as contas a receber e a pagar de uma venda via o
  // dinheiro sumir de Contas a pagar/receber e do fluxo de caixa, e continuava
  // vendo volume e receita aqui — um número que nenhuma outra tela confirmava.
  //
  // A venda em si não some: ela continua em Vendas fechadas, e é lá que se
  // exclui de vez (a exclusão da venda já leva as contas junto).
  const comLancamento = useMemo(
    () => vendasComLancamento(contasReceber, contasPagar),
    [contasReceber, contasPagar],
  );

  const vendasComLastro = useMemo(
    () => apenasVendasComLastro(vendas, comLancamento),
    [vendas, comLancamento],
  );

  // Quanto de cada CR de comissão AINDA NÃO está representado na margem da
  // sua venda. Calculado uma vez para todos os meses (a venda cai num mês e a
  // comissão vence noutro): a margem de cada venda é consumida pelas suas
  // comissões na ordem de vencimento, e o que sobrar da comissão é receita
  // própria a reconhecer.
  const comissaoNaoCapturada = useMemo(() => {
    const restante = new Map<string, number>();
    for (const v of vendasComLastro) {
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
  }, [contasReceber, vendasComLastro]);

  // DRE para AGÊNCIA DE VIAGENS, CNAE 7911-2/00
  // Regime de INTERMEDIAÇÃO: a agência recebe apenas a COMISSÃO sobre a
  // venda. O valor pago à companhia aérea/hotel/operadora é repasse, não
  // custo da agência (CMV = 0). Receita Bruta = comissão (valor_venda −
  // custo_pago_ao_fornecedor) + comissões diretas + fees + outras receitas
  // próprias. Sem 'Vendas de Serviços' inflando a receita.
  function buildDRE(month: string): DRELine[] {
    if (!month) return [];

    // Competência: entra tudo que não foi cancelado, inclusive ATRASADO e
    // PARCIAL. Listar só RECEBIDO/PENDENTE fazia a conta parcialmente
    // recebida (ou vencida) sumir INTEIRA do relatório.
    const vivo = (s: string | undefined) => String(s ?? '') !== 'CANCELADO';
    const monthReceber = contasReceber.filter(cr =>
      mesDe(cr.data_vencimento) === month && vivo(cr.status)
    );
    const monthPagar = contasPagar.filter(cp =>
      mesDe(cp.data_vencimento) === month && vivo(cp.status)
    );
    const monthVendas = vendasComLastro.filter(v =>
      mesDe(v.data_venda) === month && v.status !== 'CANCELADO'
    );

    // VOLUME intermediado (informativo, não entra na DRE; é só
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
    // É a receita, e excluí-la simplesmente apagava esse dinheiro do DRE dos
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

  // O que a regra do lastro tirou deste mês. Subtrair dinheiro em silêncio é
  // pior do que mostrá-lo: aqui o DRE diz quantas vendas ficaram de fora e
  // quanto elas somam, para ninguém procurar um número que sumiu sozinho.
  const vendasSemLastro = useMemo(() => {
    const doMes = vendas.filter(
      v => mesDe(v.data_venda) === selectedMonth && v.status !== 'CANCELADO',
    );
    return doMes.filter(v => !comLancamento.has(v.id));
  }, [vendas, comLancamento, selectedMonth]);

  const volumeSemLastro = useMemo(
    () => somaPor(vendasSemLastro, v => num(v.valor_final)),
    [vendasSemLastro],
  );

  const dreMain = useMemo(() => buildDRE(selectedMonth), [selectedMonth, contasReceber, contasPagar, vendasComLastro, planoContas]);
  const dreCompare = useMemo(() => compareMonth ? buildDRE(compareMonth) : [], [compareMonth, contasReceber, contasPagar, vendasComLastro, planoContas]);

  // Summary metrics from main DRE
  const receitaBruta = dreMain.find(l => l.nome.startsWith('RECEITA BRUTA'))?.valor || 0;
  const receitaLiquida = dreMain.find(l => l.nome === 'RECEITA LÍQUIDA')?.valor || 0;
  const lucroLiquido = dreMain.find(l => l.nome === 'LUCRO LÍQUIDO')?.valor || 0;
  const margemLiquida = dreMain.find(l => l.nome.startsWith('Margem líquida'))?.valor ?? null;

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

  const estadoDados: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erro ? 'erro' : 'ok';
  const estadoValor: MoneyEstado = loading ? 'carregando' : erro ? 'indisponivel' : 'ok';

  const semLancamento =
    contasReceber.length === 0 && contasPagar.length === 0 && vendas.length === 0;

  const rotuloMes = selectedMonth ? getMonthLabel(selectedMonth) : 'Mês atual';
  const rotuloComparativo = compareMonth ? getMonthLabel(compareMonth) : null;

  // Linhas prontas para a tabela. Nenhuma conta nova: só rótulo, recuo e o
  // comparativo já casado por nome.
  const linhasTabela: LinhaDemonstrativo[] = dreFiltrado
    .filter(l => !l.nome.startsWith('Margem'))
    .map((l, idx) => {
      const compareLine = compareByNome.get(l.nome);
      const rotuloBase = ROTULO_LINHA[l.nome] ?? l.nome;
      const rotulo =
        l.nome === 'VOLUME INTERMEDIADO (informativo)' ? (
          <Jargao
            comum={rotuloBase}
            tecnico="Volume intermediado"
            explicacao={EXPLICACAO_VOLUME}
          />
        ) : (
          rotuloBase
        );
      return {
        chave: `${idx}-${l.nome}`,
        rotulo,
        codigo: l.codigo,
        tipo: l.tipo,
        indent: l.indent,
        valor: l.valor,
        comparativo: compareLine ? compareLine.valor : null,
        variacao: compareLine ? round2(l.valor - compareLine.valor) : null,
      };
    });

  const notasTabela: NotaDemonstrativo[] = dreFiltrado
    .filter(l => l.nome.startsWith('Margem'))
    .map((l, idx) => ({
      chave: `nota-${idx}-${l.nome}`,
      rotulo: rotuloNota(l.nome),
      valor: pctBR(l.valor),
    }));

  // A contagem conta o que a tabela desenha: as margens saem no rodapé como
  // nota, não como linha do demonstrativo, nos dois lados da razão.
  const totalLinhas = dreMain.filter(l => !l.nome.startsWith('Margem')).length;

  const filtrosAtivos = (compareMonth ? 1 : 0) + (modoSimplificado ? 0 : 1);

  const limparFiltros = () => {
    setCompareMonth('');
    alternarModo(true);
  };

  const contextoLucro =
    margemLiquida === null
      ? `Receita menos impostos e despesas de ${rotuloMes}`
      : `Margem de ${pctBR(margemLiquida)} sobre a receita bruta de ${rotuloMes}`;

  const esqueleto = (
    <div className="space-y-[var(--fin-s-5)]">
      <div className="h-12 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
      <div className="grid gap-[var(--fin-s-4)] md:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="h-28 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]"
          />
        ))}
      </div>
      <div className="h-96 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
    </div>
  );

  return (
    <div className="w-full bg-[var(--fin-bg)] px-[var(--fin-page-pad)] py-[var(--fin-page-pad)] text-[var(--fin-text)]">
      <div className="mx-auto w-full max-w-[var(--fin-page-max)]">
        <PageHeader
          titulo="Resultado do mês"
          subtitulo={
            <Jargao
              comum="Quanto a agência ganhou e gastou no período"
              tecnico="DRE, demonstrativo de resultado do exercício"
              explicacao="Parte da receita da agência (a comissão), tira os impostos e as despesas do mês e chega no lucro. É este relatório que o contador pede."
              formato="subtitulo"
            />
          }
          atualizadoEm={atualizadoEm}
        />

        <div className="mt-[var(--fin-s-6)] space-y-[var(--fin-s-5)]">
          {bannerVisivel ? (
            <aside
              aria-label="Como ler este relatório"
              className="flex items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-info)]/24 bg-[var(--fin-info-soft)] p-[var(--fin-s-4)]"
            >
              <Info aria-hidden="true" className="mt-[var(--fin-s-1)] size-5 shrink-0 text-[var(--fin-info)]" />
              <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
                <p className="fin-t-body-strong text-[var(--fin-text)]">Como ler este relatório</p>
                <p className="fin-t-body text-[var(--fin-text-2)]">
                  Sua agência opera no regime de intermediação (CNAE 7911-2/00). O que você fatura
                  para o cliente, como passagens e hotéis, não é sua receita: sua receita é só a
                  comissão. Por isso o volume vendido aparece separado da receita bruta, que é a sua
                  margem real e a base sobre a qual incidem os impostos.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Fechar o aviso sobre como ler este relatório"
                onClick={dispensarBanner}
                className="ml-auto size-11 shrink-0 rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] shadow-none hover:bg-[var(--fin-surface)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0 lg:size-10"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </aside>
          ) : null}

          <DataState
            estado={estadoDados}
            erro={{
              mensagem:
                'Não deu para ler as vendas e as contas do período. Nada foi alterado no seu financeiro.',
              onTentarDeNovo: load,
            }}
            esqueleto={esqueleto}
          >
            <div className="space-y-[var(--fin-s-5)]">
              {semLancamento ? null : (
                <FilterBar
                  selects={[
                    {
                      id: 'dre-mes',
                      rotulo: 'Mês',
                      valor: selectedMonth,
                      opcoes: availableMonths.map(m => ({ valor: m, rotulo: getMonthLabel(m) })),
                      onChange: trocarMes,
                    },
                    {
                      id: 'dre-comparar',
                      rotulo: 'Comparar com',
                      valor: compareMonth === '' ? 'nenhum' : compareMonth,
                      opcoes: [
                        { valor: 'nenhum', rotulo: 'Sem comparação' },
                        ...availableMonths
                          .filter(m => m !== selectedMonth)
                          .map(m => ({ valor: m, rotulo: getMonthLabel(m) })),
                      ],
                      onChange: v => setCompareMonth(v === 'nenhum' ? '' : v),
                    },
                    {
                      id: 'dre-detalhe',
                      rotulo: 'Detalhe',
                      valor: modoSimplificado ? 'resumido' : 'completo',
                      opcoes: [
                        { valor: 'resumido', rotulo: 'Resumido' },
                        { valor: 'completo', rotulo: 'Completo' },
                      ],
                      onChange: v => alternarModo(v === 'resumido'),
                    },
                  ]}
                  resumo={{
                    exibidos: linhasTabela.length,
                    total: totalLinhas,
                    substantivo: 'linhas do demonstrativo',
                    escopo: `em ${rotuloMes}`,
                  }}
                  ativos={filtrosAtivos}
                  onLimpar={limparFiltros}
                />
              )}

              {semLancamento ? (
                <EmptyLesson
                  motivo="sem-dado"
                  titulo="Ainda não há lançamentos para montar o resultado"
                  oQueE="Este relatório mostra quanto a agência ganhou de comissão no mês, quanto pagou de impostos e de despesas, e quanto sobrou de lucro."
                  comoComeca={[
                    'Lance as contas a pagar do mês, como aluguel, salários e impostos',
                    'Confira as contas a receber vindas das vendas',
                    'Volte aqui para ver a receita, as despesas e o lucro do período',
                  ]}
                  acao={{ rotulo: 'Lançar conta a pagar', href: '/financeiro-ag/pagar' }}
                />
              ) : linhasTabela.length === 0 ? (
                <EmptyLesson
                  motivo="sem-resultado"
                  titulo="Nenhuma linha para este recorte"
                  oQueE="O mês escolhido não tem lançamento nem venda que forme uma linha do demonstrativo."
                  acaoSecundaria={{ rotulo: 'Limpar filtros', onClick: limparFiltros }}
                />
              ) : (
                <>
                  <div className="grid gap-[var(--fin-s-4)] md:grid-cols-3">
                    <MetricCard
                      rotulo="Receita bruta"
                      valor={receitaBruta}
                      estado={estadoValor}
                      contexto={`Comissões, fees e outras receitas de ${rotuloMes}`}
                      explicacao={'Margem das vendas + comissões de fornecedores + fees + outras receitas próprias da agência. É sobre este valor que incidem impostos (ISS, PIS/COFINS, Simples).'}
                    />
                    <MetricCard
                      rotulo="Receita líquida"
                      valor={receitaLiquida}
                      estado={estadoValor}
                      tone={receitaLiquida < 0 ? 'negativo' : 'neutro'}
                      contexto="Receita bruta depois dos impostos sobre a receita"
                      explicacao="Receita bruta menos os impostos sobre faturamento (ISS, PIS, COFINS). É a receita que efetivamente sobra para cobrir despesas operacionais."
                    />
                    <MetricCard
                      rotulo="Lucro líquido"
                      valor={lucroLiquido}
                      estado={estadoValor}
                      emphasis="destaque"
                      tone={lucroLiquido < 0 ? 'negativo' : 'neutro'}
                      contexto={contextoLucro}
                      explicacao="O que sobra da receita bruta depois de todos os impostos e despesas do período. Negativo significa que o mês fechou no prejuízo."
                    />
                  </div>

                  {vendasSemLastro.length > 0 ? (
                    <div className="flex flex-col gap-[var(--fin-s-1)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] p-4">
                      <span className="fin-t-body-strong text-[var(--fin-text)]">
                        {vendasSemLastro.length === 1
                          ? '1 venda deste mês está fora do resultado'
                          : `${vendasSemLastro.length} vendas deste mês estão fora do resultado`}
                      </span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">
                        Somam {formatBRL(volumeSemLastro)} de volume e não têm nenhuma conta a
                        receber ou a pagar. Sem lançamento financeiro não há resultado para
                        apurar. Elas continuam em Vendas fechadas: lance as contas para
                        recuperá-las no DRE, ou exclua a venda de vez.
                      </span>
                    </div>
                  ) : null}

                  <section className="space-y-[var(--fin-s-3)]">
                    <div className="flex flex-col gap-[var(--fin-s-1)]">
                      <h2 className="fin-t-subhead text-[var(--fin-text)]">
                        Como o resultado se forma
                      </h2>
                      <p className="fin-t-caption text-[var(--fin-text-3)]">
                        Cada linha soma ou subtrai até chegar no lucro líquido do período.
                      </p>
                    </div>

                    <DemonstrativoTabela
                      linhas={linhasTabela}
                      notas={notasTabela}
                      rotuloPeriodo={rotuloMes}
                      rotuloComparativo={rotuloComparativo}
                      descricao={`Resultado de ${rotuloMes}${rotuloComparativo ? `, comparado com ${rotuloComparativo}` : ''}`}
                    />
                  </section>
                </>
              )}
            </div>
          </DataState>
        </div>
      </div>
    </div>
  );
}
