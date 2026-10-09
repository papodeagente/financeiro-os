'use client';

import { useEffect, useState, useMemo } from 'react';
import { ArrowDownLeft, Info, ShoppingBag, TrendingUp, X } from 'lucide-react';
import { ContaReceber, ContaPagar, VendaCRM, PlanoContas } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { vendasComLancamento, apenasVendasComLastro } from '@/lib/venda-lancamentos';
import { calcularResultadoDoMes, despesasPagasPorCategoria } from '@/lib/resultado-do-mes';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { FilterBar } from '@/components/fin/FilterBar';
import { Cascata, type PassoDaCascata } from '@/components/fin/Cascata';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { Jargao } from '@/components/fin/Jargao';
import { MetricCard } from '@/components/fin/MetricCard';
import { PageHeader } from '@/components/fin/PageHeader';
import type { MoneyEstado } from '@/components/fin/Money';
import { toast } from '@/lib/toast';
import { somaPor, round2, num, mesDe, hojeISO } from '@/lib/money';
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
  'FATURAMENTO': 'Faturamento (entrou de clientes)',
  '(-) PARTE DO FORNECEDOR': '(-) Parte do fornecedor',
  'COMISSAO DE FORNECEDOR': '(+) Comissão recebida de fornecedor',
  'RECEITA': 'Receita (a sua comissão)',
  '(-) DESPESAS PAGAS': '(-) Contas pagas no mês',
  'LUCRO': 'Lucro (o que sobrou)',
};

const EXPLICACAO_VOLUME =
  'Dinheiro de cliente que entrou no mês. A maior parte pertence ao fornecedor: no regime de intermediação (CNAE 7911-2/00) o faturamento não é sua receita.';

const NOTA_MARGEM_RECEITA = 'Quanto da receita virou lucro';
const NOTA_MARGEM_VOLUME = 'Quanto do faturamento é receita';

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


  // DRE para AGÊNCIA DE VIAGENS, CNAE 7911-2/00
  // Regime de INTERMEDIAÇÃO: a agência recebe apenas a COMISSÃO sobre a
  // venda. O valor pago à companhia aérea/hotel/operadora é repasse, não
  // custo da agência (CMV = 0). Receita Bruta = comissão (valor_venda −
  // custo_pago_ao_fornecedor) + comissões diretas + fees + outras receitas
  // próprias. Sem 'Vendas de Serviços' inflando a receita.
  /**
   * O demonstrativo, PELO CAIXA.
   *
   * Até 09/10/2026 esta função cortava contas por data de VENCIMENTO e somava
   * o valor DEVIDO: conta vencida e não paga já derrubava o lucro, conta de
   * outro mês paga neste não aparecia. Agora o corte é a data da baixa e o
   * valor é o que de fato se movimentou — as três linhas do topo e estas aqui
   * saem do mesmo módulo (src/lib/resultado-do-mes.ts), então não há dois
   * números para a mesma pergunta.
   */
  function buildDRE(month: string): DRELine[] {
    if (!month) return [];

    const r = calcularResultadoDoMes({
      mes: month,
      receber: contasReceber,
      pagar: contasPagar,
      vendas: vendasComLastro,
    });

    const nomeDaCategoria = new Map(planoContas.map(p => [p.id, `${p.codigo} ${p.nome}`.trim()]));
    const despesas = despesasPagasPorCategoria({ mes: month, pagar: contasPagar });

    const linhas: DRELine[] = [
      { codigo: '', nome: 'FATURAMENTO', valor: r.faturamento, tipo: 'header', indent: 0 },
      { codigo: '', nome: '(-) PARTE DO FORNECEDOR', valor: -r.parte_do_fornecedor, tipo: 'item', indent: 1 },
    ];
    if (r.comissao_de_fornecedor > 0) {
      linhas.push({ codigo: '', nome: 'COMISSAO DE FORNECEDOR', valor: r.comissao_de_fornecedor, tipo: 'item', indent: 1 });
    }
    linhas.push({ codigo: '', nome: 'RECEITA', valor: r.receita, tipo: 'subtotal', indent: 0 });
    linhas.push({ codigo: '', nome: '(-) DESPESAS PAGAS', valor: -r.despesas_pagas, tipo: 'header', indent: 0 });
    for (const d of despesas) {
      linhas.push({
        codigo: '',
        // Conta paga sem categoria aparece nomeada, em vez de sumir: dinheiro
        // que saiu e não está em lugar nenhum é pior do que mal classificado.
        nome: nomeDaCategoria.get(d.categoria_id) ?? (d.categoria_id ? d.categoria_id : 'Sem categoria'),
        valor: -d.valor,
        tipo: 'item',
        indent: 1,
      });
    }
    linhas.push({ codigo: '', nome: 'LUCRO', valor: r.lucro, tipo: 'total', indent: 0 });
    linhas.push({ codigo: '', nome: `Margem líquida ${r.margem_sobre_receita === null ? '—' : PCT(r.margem_sobre_receita)}`, valor: r.margem_sobre_receita ?? 0, tipo: 'item', indent: 0 });
    linhas.push({ codigo: '', nome: `Margem volume ${r.margem_sobre_faturamento === null ? '—' : PCT(r.margem_sobre_faturamento)}`, valor: r.margem_sobre_faturamento ?? 0, tipo: 'item', indent: 0 });
    return linhas;
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


  // Os três números do topo saem do MESMO módulo que monta o demonstrativo:
  // duas contas para a mesma pergunta é como nascem dois números diferentes
  // para o mesmo mês.
  const resultado = useMemo(
    () => calcularResultadoDoMes({
      mes: selectedMonth, receber: contasReceber, pagar: contasPagar, vendas: vendasComLastro,
    }),
    [selectedMonth, contasReceber, contasPagar, vendasComLastro],
  );

  const passosDaCascata = useMemo<PassoDaCascata[]>(() => {
    const passos: PassoDaCascata[] = [
      {
        id: 'faturamento', rotulo: 'Faturamento', valor: resultado.faturamento, papel: 'inicio',
        detalhe: 'Dinheiro de cliente que entrou no mês.',
      },
      {
        id: 'fornecedor', rotulo: 'Fornecedor', valor: -resultado.parte_do_fornecedor, papel: 'subtrai',
        detalhe: 'A fatia do que entrou que pertence ao fornecedor. É a parte proporcional de cada venda, não o repasse que saiu do banco.',
      },
    ];
    if (resultado.comissao_de_fornecedor > 0) {
      passos.push({
        id: 'comissao-fornecedor', rotulo: 'Comissão recebida', valor: resultado.comissao_de_fornecedor, papel: 'soma',
        detalhe: 'Comissão que o fornecedor pagou à agência. É receita sem faturamento: não passa pelo bolso do cliente.',
      });
    }
    passos.push({
      id: 'receita', rotulo: 'Receita', valor: resultado.receita, papel: 'total',
      detalhe: 'A comissão: o que a agência de fato ganhou no mês.',
    });
    passos.push({
      id: 'despesas', rotulo: 'Contas pagas', valor: -resultado.despesas_pagas, papel: 'subtrai',
      detalhe: 'As contas da agência efetivamente pagas no mês. O repasse ao fornecedor não entra aqui: ele já saiu na fatia do fornecedor.',
    });
    passos.push({
      id: 'lucro', rotulo: 'Lucro', valor: resultado.lucro, papel: 'total',
      detalhe: 'O que sobrou.',
    });
    return passos;
  }, [resultado]);

  const dreMain = useMemo(() => buildDRE(selectedMonth), [selectedMonth, contasReceber, contasPagar, vendasComLastro, planoContas]);
  const dreCompare = useMemo(() => compareMonth ? buildDRE(compareMonth) : [], [compareMonth, contasReceber, contasPagar, vendasComLastro, planoContas]);


  // Modo Simplificado: mostra só os totais principais. Modo Completo: tudo.
  // Iniciante consegue ler 4-6 linhas; contador prefere ver detalhe.
  // Resumido: a escada e os totais. Detalhado acrescenta as categorias das
  // contas pagas. Os nomes têm de ser os mesmos que buildDRE emite — quando
  // divergiram, a tela mostrou "0 de 8 linhas" sem erro nenhum.
  const SIMPL_KEEP = [
    'FATURAMENTO',
    '(-) PARTE DO FORNECEDOR',
    'COMISSAO DE FORNECEDOR',
    'RECEITA',
    '(-) DESPESAS PAGAS',
    'LUCRO',
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
          titulo="Resultado do mês"
          subtitulo={
            <Jargao
              comum="Faturamento, receita e lucro do mês, pelo que entrou e saiu de verdade"
              tecnico="regime de caixa"
              explicacao="O mês conta pelo dinheiro que se moveu: a venda entra quando o cliente paga, a conta entra quando é paga. Conta que venceu e não foi paga ainda não está aqui — ela está no fluxo de caixa."
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
                  Três palavras, uma definição cada. <strong>Faturamento</strong> é o dinheiro de
                  cliente que entrou. <strong>Receita</strong> é a sua comissão, o que sobra depois
                  da parte do fornecedor. <strong>Lucro</strong> é o que restou da receita depois
                  das contas que você pagou no mês. Os três se subtraem nesta ordem, sem ninguém
                  refazer a conta de cabeça.
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
                    'Volte aqui para ver o faturamento, a receita e o lucro do mês',
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
                      rotulo="Faturamento" icone={ShoppingBag}
                      valor={resultado.faturamento}
                      estado={estadoValor}
                      contexto={`Dinheiro de clientes que entrou em ${rotuloMes}`}
                      explicacao="O total de vendas que o cliente pagou no mês. A maior parte pertence ao fornecedor: faturamento não é o que a agência ganha."
                    />
                    <MetricCard
                      rotulo="Receita" icone={ArrowDownLeft}
                      valor={resultado.receita}
                      estado={estadoValor}
                      tone={resultado.receita < 0 ? 'negativo' : 'neutro'}
                      contexto={
                        resultado.margem_sobre_faturamento === null
                          ? 'A comissão que ficou com a agência'
                          : `${pctBR(resultado.margem_sobre_faturamento)} do faturamento ficou com a agência`
                      }
                      explicacao="A comissão: o que sobrou do faturamento depois da parte do fornecedor, mais as comissões recebidas direto de fornecedores. É o que a agência de fato ganha."
                    />
                    <MetricCard
                      rotulo="Lucro" icone={TrendingUp}
                      valor={resultado.lucro}
                      estado={estadoValor}
                      emphasis="destaque"
                      tone={resultado.lucro < 0 ? 'negativo' : 'neutro'}
                      contexto={`Receita menos as contas pagas em ${rotuloMes}`}
                      explicacao="O que sobrou da receita depois de todas as contas que a agência pagou no mês. Conta a pagar que ainda não foi paga não entra aqui: ela aparece no fluxo de caixa. Negativo significa que o mês fechou no prejuízo."
                    />
                  </div>

                  <GraficoMoldura
                    titulo="Por onde o dinheiro passou"
                    sublinha="Cada passo começa onde o anterior parou, na mesma régua: o tamanho do que sai e o do que sobra ficam comparáveis sem ninguém refazer a conta."
                    estado="ok"
                    descricao={`Cascata de ${rotuloMes}: faturamento de ${formatBRL(resultado.faturamento)} chega a ${formatBRL(resultado.lucro)} de lucro.`}
                    tabela={{
                      colunas: ['Passo', 'Valor'],
                      linhas: passosDaCascata.map(passo => [passo.rotulo, formatBRL(passo.valor)]),
                    }}
                  >
                    <Cascata passos={passosDaCascata} formatar={formatBRL} altura={260} />
                  </GraficoMoldura>

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
                        Cada linha soma ou subtrai até chegar no lucro do mês. Os mesmos números
                        dos cartões acima, abertos por categoria.
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
