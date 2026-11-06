'use client';

import { useEffect, useState, useMemo } from 'react';
import { ArrowDownLeft, CalendarClock, Info, TrendingUp, X } from 'lucide-react';
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
import { somaPor, round2, num, mesDe, hojeISO } from '@/lib/money';
import {
  comissaoNaoCapturadaPorConta, dreMesAMes, mesAnterior, mesesEntre, montarDRE, orcadoPorLinha,
  type LancamentoDRE, type LinhaDRE, type LinhaMesAMes, type RegimeDRE,
} from '@/lib/resultado-dre';
import { aplicarRecorteDRE, type FiltroDeRateio, type RecorteDRE } from '@/lib/dre-recorte';
import { ordenarEmArvore } from '@/lib/dimensoes';
import type { CentroCusto } from '@/lib/crm-types';
import type { DocumentoExportado, FiltroAplicado } from '@/lib/exportacao/documento';
import { BotaoExportar } from '@/components/fin/BotaoExportar';
import { DemonstrativoMeses, rotuloCurtoDoMes } from './DemonstrativoMeses';
import { calcRelatorio, type CustosData } from '@/lib/planejamento-custos';
import {
  encargosPorTitulo, rotulosDasCategorias,
  type CategoriasEncargos, type LinhaDeBaixaComEncargo,
} from '@/lib/encargos-categorias';
import { Segmentado } from '@/components/fin/Segmentado';
import { LancamentosDaLinha } from './LancamentosDaLinha';
import { formatBRL } from '@/lib/utils';
import { variacaoPorTitulo } from '@/lib/cambio';

/** Linha de variação cambial vinda de /api/encargos-da-liquidacao. */
interface LinhaDeVariacaoDRE { titulo_tabela: string; titulo_id: string; variacao: number }
import {
  DemonstrativoTabela,
  type LinhaDemonstrativo,
  type NotaDemonstrativo,
} from './DemonstrativoTabela';
import { lerEmpresasVisiveis } from '@/components/fin/useEmpresas';
import { contasNoRecorte } from '@/lib/empresas';

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

type DRELine = LinhaDRE;

const ROTULO_REGIME: Record<RegimeDRE, string> = { competencia: 'Competência', caixa: 'Caixa' };

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
  // 05/11/2026: regime (competência é o de sempre), orçado do plano do mês e
  // os lançamentos de um número clicado.
  const [regime, setRegime] = useState<RegimeDRE>('competencia');
  const [orcamento, setOrcamento] = useState<CustosData | null>(null);
  // Juros, multa, desconto e taxa da liquidação (05/11/2026). Sem eles (ou
  // se a consulta falhar), o DRE é o de antes.
  const [baixasComEncargo, setBaixasComEncargo] = useState<LinhaDeBaixaComEncargo[]>([]);
  const [linhasDeVariacao, setLinhasDeVariacao] = useState<LinhaDeVariacaoDRE[]>([]);
  const [categoriasEncargos, setCategoriasEncargos] = useState<CategoriasEncargos>({});
  const [aberta, setAberta] = useState<{ titulo: string; lancamentos: LancamentoDRE[]; valor: number } | null>(null);
  // E7, G3: visão mês a mês (meses em colunas) e recorte por centro de custo
  // e rateio. Sem recorte e em "Um mês", a tela é a de antes.
  const [visao, setVisao] = useState<'mes' | 'meses'>('mes');
  const [mesInicial, setMesInicial] = useState('');
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [centroId, setCentroId] = useState('');
  const [filtroRateio, setFiltroRateio] = useState<FiltroDeRateio>('todas');

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
      // Várias empresas (E7): o rateado entre empresas entra só com a parte das
      // empresas marcadas. Uma empresa só: as listas como vieram.
      const visiveis = await lerEmpresasVisiveis();
      setContasReceber(contasNoRecorte(cr, visiveis));
      setContasPagar(contasNoRecorte(cp, visiveis));
      setVendas(v);
      setPlanoContas(pc);
      fetch('/api/encargos-da-liquidacao')
        .then(r => (r.ok ? r.json() : null))
        .then((x: { linhas?: LinhaDeBaixaComEncargo[]; categorias?: CategoriasEncargos; variacoes?: LinhaDeVariacaoDRE[] } | null) => {
          setBaixasComEncargo(Array.isArray(x?.linhas) ? x!.linhas! : []);
          setCategoriasEncargos(x?.categorias && typeof x.categorias === 'object' ? x.categorias : {});
          setLinhasDeVariacao(Array.isArray(x?.variacoes) ? x!.variacoes! : []);
        })
        .catch(() => { setBaixasComEncargo([]); setCategoriasEncargos({}); setLinhasDeVariacao([]); });
      // Centros de custo para o recorte. Sem eles (ou sem acesso), o filtro não aparece.
      fetch('/api/centros-custo')
        .then(r => (r.ok ? r.json() : null))
        .then((c: CentroCusto[] | null) => setCentros(Array.isArray(c) ? c : []))
        .catch(() => setCentros([]));

      setSelectedMonth(mesDe(hojeISO()));
      setMesInicial(`${hojeISO().slice(0, 4)}-01`);
      setAtualizadoEm(new Date());
    } catch {
      setErro(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Orçado: o plano do mês do planejamento, quando existe. Sem plano (ou sem
  // permissão), a coluna simplesmente não aparece.
  useEffect(() => {
    if (!selectedMonth) return;
    let vivo = true;
    fetch(`/api/planejamento/custos?mes=${encodeURIComponent(selectedMonth)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((plano: CustosData | null) => { if (vivo) setOrcamento(plano && typeof plano === 'object' ? plano : null); })
      .catch(() => { if (vivo) setOrcamento(null); });
    return () => { vivo = false; };
  }, [selectedMonth]);

  const orcadoMap = useMemo(() => {
    if (!orcamento) return orcadoPorLinha(null);
    const r = calcRelatorio(orcamento);
    return orcadoPorLinha({
      receitaMeta: r.receitaMeta, custoFixoTotal: r.custoFixoTotal,
      marketingTotal: r.marketingTotal, lucroProjetado: r.lucroProjetado,
    });
  }, [orcamento]);
  const temOrcado = orcadoMap.size > 0;

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

  // Quanto de cada CR de comissão ainda não está na margem da venda. A regra
  // mora em src/lib/resultado-dre.ts desde 05/11/2026.
  // DRE para agência de viagens (CNAE 7911-2/00), regime de intermediação.
  // A conta saiu da tela para a lib (05/11/2026) sem mudar: competência é o
  // padrão e dá os mesmos números de antes (scripts/test-demonstrativo-resultado.ts).
  const encargosTodos = useMemo(() => encargosPorTitulo(baixasComEncargo), [baixasComEncargo]);
  const variacoesTodas = useMemo(() => variacaoPorTitulo(linhasDeVariacao), [linhasDeVariacao]);
  const rotulosEncargos = useMemo(
    () => rotulosDasCategorias(categoriasEncargos, planoContas),
    [categoriasEncargos, planoContas],
  );

  // Recorte por centro de custo e rateio (E7, G3): cada conta entra com a
  // parte dela no centro escolhido (src/lib/dre-recorte.ts). Sem recorte, as
  // listas de sempre, intactas.
  const recorte: RecorteDRE = useMemo(() => ({ centro_id: centroId || null, rateio: filtroRateio }), [centroId, filtroRateio]);
  const recortado = useMemo(
    () => aplicarRecorteDRE({ receber: contasReceber, pagar: contasPagar, vendas: vendasComLastro, encargos: encargosTodos, variacoes: variacoesTodas }, recorte, centros),
    [contasReceber, contasPagar, vendasComLastro, encargosTodos, variacoesTodas, recorte, centros],
  );
  const encargos = recortado.encargos;
  const variacoes = recortado.variacoes;

  const comissaoNaoCapturada = useMemo(
    () => comissaoNaoCapturadaPorConta(recortado.receber, recortado.vendas),
    [recortado],
  );

  const baseDRE = useMemo(() => ({
    receber: recortado.receber,
    pagar: recortado.pagar,
    vendasComLastro: recortado.vendas,
    planoContas,
    comissaoNaoCapturada,
    regime,
    encargos,
    rotulosEncargos,
    variacoes,
  }), [recortado, planoContas, comissaoNaoCapturada, regime, encargos, rotulosEncargos, variacoes]);

  function buildDRE(month: string): LinhaDRE[] {
    return montarDRE({ ...baseDRE, mes: month });
  }

  // Mês a mês: do mês inicial até o mês escolhido (no máximo 24 colunas).
  const mesesDaVisao = useMemo(
    () => (visao === 'meses' && selectedMonth ? mesesEntre(mesInicial || selectedMonth, selectedMonth, 24) : []),
    [visao, mesInicial, selectedMonth],
  );
  const mesAMes = useMemo(
    () => (mesesDaVisao.length ? dreMesAMes(baseDRE, mesesDaVisao) : null),
    [baseDRE, mesesDaVisao],
  );

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dreMain = useMemo(() => buildDRE(selectedMonth), [selectedMonth, baseDRE]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dreCompare = useMemo(() => compareMonth ? buildDRE(compareMonth) : [], [compareMonth, baseDRE]);

  // Summary metrics from main DRE
  // Mês a mês: os cartões mostram o período inteiro.
  const doPeriodo = (prefixo: string) => mesAMes?.linhas.find(l => l.nome.startsWith(prefixo));
  const receitaBruta = (mesAMes ? doPeriodo('RECEITA BRUTA')?.total : dreMain.find(l => l.nome.startsWith('RECEITA BRUTA'))?.valor) || 0;
  const receitaLiquida = (mesAMes ? doPeriodo('RECEITA LÍQUIDA')?.total : dreMain.find(l => l.nome === 'RECEITA LÍQUIDA')?.valor) || 0;
  const lucroLiquido = (mesAMes ? doPeriodo('LUCRO LÍQUIDO')?.total : dreMain.find(l => l.nome === 'LUCRO LÍQUIDO')?.valor) || 0;
  const margemLiquida = (mesAMes ? doPeriodo('Margem líquida')?.total : dreMain.find(l => l.nome.startsWith('Margem líquida'))?.valor) ?? null;

  // Modo Simplificado: mostra só os totais principais. Modo Completo: tudo.
  // Iniciante consegue ler 4-6 linhas; contador prefere ver detalhe.
  const SIMPL_KEEP = [
    'RECEITA BRUTA',
    '(-) IMPOSTOS SOBRE A RECEITA',
    'RECEITA LÍQUIDA',
    '(-) DESPESAS OPERACIONAIS',
    '(-) DESPESAS FINANCEIRAS',
    // Só aparece quando há juros, multa ou desconto obtido na liquidação.
    '(+) RECEITAS FINANCEIRAS',
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
      const orcado = orcadoMap.get(l.nome);
      return {
        chave: `${idx}-${l.nome}`,
        rotulo,
        codigo: l.codigo,
        tipo: l.tipo,
        indent: l.indent,
        valor: l.valor,
        comparativo: compareLine ? compareLine.valor : null,
        variacao: compareLine ? round2(l.valor - compareLine.valor) : null,
        orcado: orcado ?? null,
        desvioOrcado: orcado === undefined ? null : round2(l.valor - orcado),
        detalhavel: Boolean(l.lancamentos && l.lancamentos.length > 0),
      };
    });

  const notasTabela: NotaDemonstrativo[] = dreFiltrado
    .filter(l => l.nome.startsWith('Margem'))
    .map((l, idx) => ({
      chave: `nota-${idx}-${l.nome}`,
      rotulo: rotuloNota(l.nome),
      valor: pctBR(l.valor),
    }));

  function abrirValor(chave: string) {
    const nome = chave.slice(chave.indexOf('-') + 1);
    const l = dreFiltrado.find(x => x.nome === nome);
    if (!l?.lancamentos) return;
    setAberta({ titulo: ROTULO_LINHA[l.nome] ?? l.nome, lancamentos: l.lancamentos, valor: Math.abs(l.valor) });
  }

  // A contagem conta o que a tabela desenha: as margens saem no rodapé como
  // nota, não como linha do demonstrativo, nos dois lados da razão.
  const totalLinhas = dreMain.filter(l => !l.nome.startsWith('Margem')).length;

  const filtrosAtivos = (compareMonth && visao === 'mes' ? 1 : 0) + (modoSimplificado ? 0 : 1) + (regime === 'competencia' ? 0 : 1)
    + (centroId ? 1 : 0) + (filtroRateio === 'todas' ? 0 : 1);

  const limparFiltros = () => {
    setCompareMonth('');
    alternarModo(true);
    setRegime('competencia');
    setCentroId('');
    setFiltroRateio('todas');
  };

  // Mês a mês, no mesmo detalhe (resumido/completo) da visão de um mês.
  const linhasMesAMes = useMemo(() => {
    if (!mesAMes) return [];
    return modoSimplificado
      ? mesAMes.linhas.filter(l => SIMPL_KEEP.some(k => l.nome.startsWith(k)) || l.percentual)
      : mesAMes.linhas;
  }, [mesAMes, modoSimplificado]); // eslint-disable-line react-hooks/exhaustive-deps

  const arvoreDeCentros = useMemo(() => ordenarEmArvore(centros.filter(c => c.ativo !== false || c.id === centroId)), [centros, centroId]);
  const centroEscolhido = centros.find(c => c.id === centroId) ?? null;
  const ROTULO_RATEIO: Record<FiltroDeRateio, string> = { todas: 'Todas as contas', rateadas: 'Só contas rateadas', sem_rateio: 'Só contas sem rateio' };
  const rotuloDaLinhaMeses = (l: LinhaMesAMes) => (l.percentual ? rotuloNota(l.nome) : (ROTULO_LINHA[l.nome] ?? l.nome));
  const rotuloDoPeriodoMeses = mesesDaVisao.length
    ? `${getMonthLabel(mesesDaVisao[0])} a ${getMonthLabel(mesesDaVisao[mesesDaVisao.length - 1])}`
    : rotuloMes;

  /** O que está na tela, para o Excel, o PDF e a impressão. */
  function documentoDaTela(): DocumentoExportado {
    const filtros: FiltroAplicado[] = [
      { rotulo: 'Período', valor: visao === 'meses' ? rotuloDoPeriodoMeses : rotuloMes },
      { rotulo: 'Regime', valor: ROTULO_REGIME[regime] },
    ];
    if (centroEscolhido) filtros.push({ rotulo: 'Centro de custo', valor: centroEscolhido.nome });
    if (filtroRateio !== 'todas') filtros.push({ rotulo: 'Rateio', valor: ROTULO_RATEIO[filtroRateio] });
    if (visao === 'mes' && rotuloComparativo) filtros.push({ rotulo: 'Comparado com', valor: rotuloComparativo });
    const recuo = (n: number) => '   '.repeat(Math.max(0, n));
    if (visao === 'meses' && mesAMes) {
      const colunas = [
        { id: 'linha', rotulo: 'Conta', tipo: 'texto' as const },
        ...mesAMes.meses.map(m => ({ id: m, rotulo: rotuloCurtoDoMes(m), tipo: 'dinheiro' as const })),
        { id: 'total', rotulo: 'Total', tipo: 'dinheiro' as const },
        { id: 'media', rotulo: 'Média', tipo: 'dinheiro' as const },
      ];
      const linhas = linhasMesAMes.filter(l => !l.percentual).map(l => {
        const r: Record<string, string | number> = { linha: `${recuo(l.indent)}${l.codigo ? `${l.codigo} ` : ''}${ROTULO_LINHA[l.nome] ?? l.nome}`, total: l.total, media: l.media };
        mesAMes.meses.forEach((m, i) => { r[m] = l.valores[i]; });
        return r;
      });
      const margens = linhasMesAMes.filter(l => l.percentual)
        .map(l => `${rotuloNota(l.nome)}: ${l.total.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% no período`).join(' · ');
      return { titulo: 'Resultado mês a mês (DRE)', filtros, colunas, linhas, orientacao: 'paisagem', ...(margens ? { nota: margens } : {}) };
    }
    const comComparativo = Boolean(rotuloComparativo);
    const colunas = [
      { id: 'linha', rotulo: 'Conta', tipo: 'texto' as const },
      { id: 'valor', rotulo: rotuloMes, tipo: 'dinheiro' as const },
      ...(temOrcado ? [{ id: 'orcado', rotulo: 'Orçado', tipo: 'dinheiro' as const }, { id: 'desvio', rotulo: 'Desvio', tipo: 'dinheiro' as const }] : []),
      ...(comComparativo ? [{ id: 'comparativo', rotulo: rotuloComparativo!, tipo: 'dinheiro' as const }, { id: 'variacao', rotulo: 'Variação', tipo: 'dinheiro' as const }] : []),
    ];
    const linhas = dreFiltrado.filter(l => !l.nome.startsWith('Margem')).map(l => {
      const c = compareByNome.get(l.nome);
      const o = orcadoMap.get(l.nome);
      return {
        linha: `${recuo(l.indent)}${l.codigo ? `${l.codigo} ` : ''}${ROTULO_LINHA[l.nome] ?? l.nome}`,
        valor: l.valor,
        orcado: o ?? null, desvio: o === undefined ? null : round2(l.valor - o),
        comparativo: c ? c.valor : null, variacao: c ? round2(l.valor - c.valor) : null,
      };
    });
    const nota = notasTabela.map(n => `${n.rotulo}: ${n.valor}`).join(' · ');
    return { titulo: 'Resultado do mês (DRE)', filtros, colunas, linhas, ...(nota ? { nota } : {}) };
  }

  const anteriorAoSelecionado = selectedMonth ? mesAnterior(selectedMonth) : '';

  const contextoLucro =
    margemLiquida === null
      ? `Receita menos impostos e despesas de ${rotuloDoPeriodoMeses}`
      : `Margem de ${pctBR(margemLiquida)} sobre a receita bruta de ${rotuloDoPeriodoMeses}`;

  const esqueleto = (
    <div className="space-y-[var(--fin-s-5)]">
      <div className="h-12 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]" />
      <div className="grid gap-[var(--fin-s-4)] md:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="h-28 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]"
          />
        ))}
      </div>
      <div className="h-96 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]" />
    </div>
  );

  return (
    <div className="w-full bg-[var(--fin-bg)] px-[var(--fin-page-pad)] py-[var(--fin-page-pad)] text-[var(--fin-text)]">
      <div className="mx-auto w-full max-w-[var(--fin-page-max)]">
        <PageHeader
          empresas
          icone={TrendingUp}
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
          acoesSecundarias={[{ rotulo: 'Resultado por categoria', href: '/financeiro-ag/resultado-por-categoria' }]}
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
                    ...(visao === 'meses'
                      ? [
                        {
                          id: 'dre-de',
                          rotulo: 'De',
                          valor: mesInicial,
                          opcoes: availableMonths.filter(m => m <= selectedMonth).map(m => ({ valor: m, rotulo: getMonthLabel(m) })),
                          onChange: setMesInicial,
                        },
                        {
                          id: 'dre-ate',
                          rotulo: 'Até',
                          valor: selectedMonth,
                          opcoes: availableMonths.map(m => ({ valor: m, rotulo: getMonthLabel(m) })),
                          onChange: (m: string) => { setSelectedMonth(m); if (mesInicial > m) setMesInicial(m); },
                        },
                      ]
                      : [
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
                          onChange: (v: string) => setCompareMonth(v === 'nenhum' ? '' : v),
                        },
                      ]),
                    ...(centros.length
                      ? [
                        {
                          id: 'dre-centro',
                          rotulo: 'Centro de custo',
                          valor: centroId || 'todos',
                          opcoes: [
                            { valor: 'todos', rotulo: 'Todos os centros' },
                            ...arvoreDeCentros.map(c => ({ valor: c.id, rotulo: `${'  '.repeat(c.nivel)}${c.codigo ? `${c.codigo} ` : ''}${c.nome}` })),
                          ],
                          onChange: (v: string) => setCentroId(v === 'todos' ? '' : v),
                        },
                        {
                          id: 'dre-rateio',
                          rotulo: 'Rateio',
                          valor: filtroRateio,
                          opcoes: (['todas', 'rateadas', 'sem_rateio'] as FiltroDeRateio[]).map(r => ({ valor: r, rotulo: ROTULO_RATEIO[r] })),
                          onChange: (v: string) => setFiltroRateio(v as FiltroDeRateio),
                        },
                      ]
                      : []),
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
                  resumo={visao === 'meses' && mesAMes ? {
                    exibidos: linhasMesAMes.filter(l => !l.percentual).length,
                    total: mesAMes.linhas.filter(l => !l.percentual).length,
                    substantivo: 'linhas do demonstrativo',
                    escopo: `de ${rotuloDoPeriodoMeses}${centroEscolhido ? ` · ${centroEscolhido.nome}` : ''}`,
                  } : {
                    exibidos: linhasTabela.length,
                    total: totalLinhas,
                    substantivo: 'linhas do demonstrativo',
                    escopo: `em ${rotuloMes}${centroEscolhido ? ` · ${centroEscolhido.nome}` : ''}`,
                  }}
                  ativos={filtrosAtivos}
                  onLimpar={limparFiltros}
                />
              )}

              {semLancamento ? null : (
                <div className="flex flex-col gap-[var(--fin-s-3)] lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex flex-wrap items-start gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-3)]">
                    <div className="flex flex-col gap-[var(--fin-s-1)]">
                      <Segmentado<'mes' | 'meses'>
                        rotulo="Visão"
                        valor={visao}
                        onChange={setVisao}
                        opcoes={[
                          { valor: 'mes', rotulo: 'Um mês' },
                          { valor: 'meses', rotulo: 'Mês a mês' },
                        ]}
                      />
                      <span className="fin-t-caption text-[var(--fin-text-3)]">
                        {visao === 'mes' ? 'O mês escolhido, com comparação e orçado.' : 'Cada mês numa coluna, com total e média do período.'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-[var(--fin-s-1)]">
                      <Segmentado<RegimeDRE>
                        rotulo="Regime"
                        valor={regime}
                        onChange={setRegime}
                        opcoes={[
                          { valor: 'competencia', rotulo: ROTULO_REGIME.competencia },
                          { valor: 'caixa', rotulo: ROTULO_REGIME.caixa },
                        ]}
                      />
                      <span className="max-w-[46ch] fin-t-caption text-[var(--fin-text-3)]">
                        {regime === 'competencia'
                          ? 'Pelo vencimento das contas e pela data da venda, recebidas ou não.'
                          : 'Pela data em que o dinheiro entrou ou saiu. A margem da venda entra na proporção do que o cliente pagou.'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
                    {visao === 'mes' && anteriorAoSelecionado && compareMonth !== anteriorAoSelecionado ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCompareMonth(anteriorAoSelecionado)}
                        className="h-11 lg:h-9"
                      >
                        <CalendarClock aria-hidden="true" className="size-4" />
                        Comparar com o mês anterior
                      </Button>
                    ) : null}
                    <BotaoExportar origem="dre" documento={documentoDaTela} />
                  </div>
                </div>
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
                      rotulo="Receita bruta" icone={ArrowDownLeft}
                      valor={receitaBruta}
                      estado={estadoValor}
                      contexto={`Comissões, fees e outras receitas de ${rotuloDoPeriodoMeses}`}
                      explicacao={'Margem das vendas + comissões de fornecedores + fees + outras receitas próprias da agência. É sobre este valor que incidem impostos (ISS, PIS/COFINS, Simples).'}
                    />
                    <MetricCard
                      rotulo="Receita líquida" icone={ArrowDownLeft}
                      valor={receitaLiquida}
                      estado={estadoValor}
                      tone={receitaLiquida < 0 ? 'negativo' : 'neutro'}
                      contexto="Receita bruta depois dos impostos sobre a receita"
                      explicacao="Receita bruta menos os impostos sobre faturamento (ISS, PIS, COFINS). É a receita que efetivamente sobra para cobrir despesas operacionais."
                    />
                    <MetricCard
                      rotulo="Lucro líquido" icone={TrendingUp}
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

                    {visao === 'meses' && mesAMes ? (
                      <>
                        <DemonstrativoMeses
                          meses={mesAMes.meses}
                          linhas={linhasMesAMes}
                          rotulo={rotuloDaLinhaMeses}
                          descricao={`Resultado mês a mês de ${rotuloDoPeriodoMeses}${regime === 'caixa' ? ' pelo caixa' : ''}${centroEscolhido ? `, centro de custo ${centroEscolhido.nome}` : ''}`}
                          onAbrirMes={m => { setSelectedMonth(m); setVisao('mes'); }}
                        />
                        <p className="fin-t-caption text-[var(--fin-text-3)]">
                          Toque no nome de um mês para abri-lo sozinho, com os lançamentos de cada linha.
                          {mesesEntre(mesInicial || selectedMonth, selectedMonth, 999).length > mesAMes.meses.length ? ' A tabela mostra até 24 meses.' : ''}
                        </p>
                      </>
                    ) : (
                      <>
                        <DemonstrativoTabela
                          linhas={linhasTabela}
                          notas={notasTabela}
                          rotuloPeriodo={rotuloMes}
                          rotuloComparativo={rotuloComparativo}
                          rotuloOrcado={temOrcado ? 'Orçado' : null}
                          onAbrirValor={abrirValor}
                          descricao={`Resultado de ${rotuloMes}${regime === 'caixa' ? ' pelo caixa' : ''}${rotuloComparativo ? `, comparado com ${rotuloComparativo}` : ''}`}
                        />
                        <p className="fin-t-caption text-[var(--fin-text-3)]">
                          Toque num valor sublinhado para ver os lançamentos que o formam.
                          {temOrcado ? ' O orçado vem do plano do mês em Custos do negócio.' : ''}
                        </p>
                      </>
                    )}
                    {centroEscolhido || filtroRateio !== 'todas' ? (
                      <p className="fin-t-caption text-[var(--fin-text-3)]">
                        {centroEscolhido
                          ? `Só a parte de ${centroEscolhido.nome} (e dos centros abaixo dele): conta rateada entra com o percentual deste centro; venda, na proporção das contas a receber dela.`
                          : ''}
                        {filtroRateio !== 'todas' ? ` ${ROTULO_RATEIO[filtroRateio]}.` : ''}
                      </p>
                    ) : null}
                  </section>
                </>
              )}
            </div>
          </DataState>
        </div>
      </div>

      <LancamentosDaLinha
        aberta={aberta}
        regime={regime}
        rotuloMes={rotuloMes}
        onFechar={() => setAberta(null)}
      />
    </div>
  );
}
