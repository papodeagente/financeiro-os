'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingDown } from 'lucide-react';

import type { ContaReceber } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { dentroDoPeriodo } from '@/lib/money';
import {
  SEM_PLATAFORMA, agruparTaxasPorPlataforma, taxaRealizada, type LinhaDeTaxa,
} from '@/lib/taxa-plataforma';
import { exportCSV } from '@/lib/export-utils';
import { formatBRL, formatDate as dataBR } from '@/lib/utils';

import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { Money } from '@/components/fin/Money';
import { Resposta } from '@/components/fin/Resposta';
import { type PeriodoChave, ROTULO_PERIODO } from '@/components/fin/PeriodPicker';

/**
 * Quanto as plataformas de pagamento ficaram.
 *
 * O recorte é pela DATA DO RECEBIMENTO, não pelo vencimento: a taxa é cobrada
 * quando o dinheiro passa pela adquirente. Por isso as opções de período aqui
 * são só as do passado — "próximos 30 dias" não diz nada sobre dinheiro que
 * já foi retido.
 */
const PERIODOS: PeriodoChave[] = ['MES_ATUAL', 'MES_PASSADO', 'TUDO', 'PERSONALIZADO'];

const PCT = (v: number | null): string =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export default function RelatorioDeTaxasPage() {
  const [contas, setContas] = useState<ContaReceber[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const [periodo, setPeriodo] = useState<PeriodoChave>('TUDO');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');

  const load = useCallback(async () => {
    setErro(null);
    try {
      const r = await loadEntities<ContaReceber>('contas-receber');
      setContas(r);
      setAtualizadoEm(new Date());
    } catch {
      setErro('Não foi possível carregar as contas a receber.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // O recorte é pela data em que o dinheiro entrou, porque é nela que a
  // plataforma cobra. Conta sem data de recebimento nunca passou por
  // adquirente nenhuma.
  const noPeriodo = useMemo(() => {
    if (periodo === 'TUDO' || !de || !ate) return contas;
    return contas.filter(c => dentroDoPeriodo(c.data_recebimento, de, ate));
  }, [contas, periodo, de, ate]);

  const relatorio = useMemo(() => agruparTaxasPorPlataforma(noPeriodo), [noPeriodo]);
  const { linhas, total } = relatorio;

  // "exibidos de total" só é honesto se os dois lados contarem a mesma coisa:
  // contas que REALMENTE tiveram taxa retida, aqui sem o recorte de período.
  const totalComTaxa = useMemo(
    () => contas.filter(c => taxaRealizada(c) > 0).length,
    [contas],
  );

  const barras: LinhaBarra[] = useMemo(
    () => linhas.map(l => ({
      id: l.plataforma,
      nome: l.plataforma,
      valor: l.taxa,
      secundario: `${PCT(l.percentual)} de ${formatBRL(l.bruto)} · ${l.quantidade} ${l.quantidade === 1 ? 'conta' : 'contas'}`,
      detalhes: [
        `Passou pela plataforma: ${formatBRL(l.bruto)}`,
        `Ficou com a plataforma: ${formatBRL(l.taxa)}`,
        `Sobrou para a agência: ${formatBRL(l.liquido)}`,
      ],
    })),
    [linhas],
  );

  const colunas: FinColuna<LinhaDeTaxa>[] = useMemo(() => [
    {
      id: 'plataforma',
      cabecalho: 'Plataforma',
      tipo: 'texto',
      sortable: true,
      minWidth: 160,
      acessor: l => l.plataforma,
      render: l => (
        <span className={l.plataforma === SEM_PLATAFORMA ? 'text-[var(--fin-text-3)]' : undefined}>
          {l.plataforma}
        </span>
      ),
    },
    {
      id: 'contas',
      cabecalho: 'Contas',
      tipo: 'texto',
      sortable: true,
      prioridade: 1,
      acessor: l => l.quantidade,
      render: l => <span className="fin-t-body-num">{l.quantidade}</span>,
    },
    {
      id: 'bruto',
      cabecalho: 'Passou pela plataforma',
      tipo: 'dinheiro',
      sortable: true,
      prioridade: 2,
      valor: l => l.bruto,
    },
    {
      id: 'taxa',
      cabecalho: 'Ficou com a plataforma',
      tipo: 'dinheiro',
      sortable: true,
      valor: l => l.taxa,
      tone: () => 'negativo',
      // O percentual vive como sublinha do número a que ele se refere, nunca
      // como coluna própria: são o mesmo fato em duas unidades.
      sub: l => PCT(l.percentual),
    },
    {
      id: 'liquido',
      cabecalho: 'Sobrou para a agência',
      tipo: 'dinheiro',
      sortable: true,
      prioridade: 2,
      valor: l => l.liquido,
    },
  ], []);

  function exportar() {
    exportCSV(
      'taxas-por-plataforma',
      ['Plataforma', 'Contas', 'Passou pela plataforma', 'Ficou com a plataforma', 'Percentual', 'Sobrou para a agência'],
      [
        ...linhas.map(l => [
          l.plataforma,
          String(l.quantidade),
          l.bruto.toFixed(2),
          l.taxa.toFixed(2),
          l.percentual === null ? '' : l.percentual.toFixed(2),
          l.liquido.toFixed(2),
        ]),
        [
          'Total',
          String(total.quantidade),
          total.bruto.toFixed(2),
          total.taxa.toFixed(2),
          total.percentual === null ? '' : total.percentual.toFixed(2),
          total.liquido.toFixed(2),
        ],
      ],
    );
  }

  const recorte = periodo === 'TUDO'
    ? 'em todo o período'
    : periodo === 'PERSONALIZADO' && de && ate
      ? `de ${dataBR(de)} a ${dataBR(ate)}`
      : `em ${ROTULO_PERIODO[periodo].toLowerCase()}`;

  const frase = total.taxa > 0
    ? `${PCT(total.percentual)} de ${formatBRL(total.bruto)} que passaram pelas plataformas. Sobraram ${formatBRL(total.liquido)} para a agência.`
    : 'Nenhuma conta recebida neste recorte registrou taxa de plataforma.';

  const estado = carregando ? 'carregando' : erro ? 'erro' : 'ok';

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Taxas de pagamento"
        subtitulo="Quanto as plataformas ficaram do dinheiro que passou por elas"
        atualizadoEm={atualizadoEm}
        onRecarregar={load}
        acoesSecundarias={linhas.length > 0 ? [{ rotulo: 'Baixar CSV', onClick: exportar }] : undefined}
      />

      <DataState
        className={RITMO_DA_PAGINA}
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { load(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className="h-12 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
            <div className="h-64 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
          </div>
        }
      >
        <FilterBar
          periodo={{
            valor: periodo,
            de,
            ate,
            opcoes: PERIODOS,
            onChange: (chave, range) => {
              setPeriodo(chave);
              setDe(range.de);
              setAte(range.ate);
            },
          }}
          resumo={{
            exibidos: total.quantidade,
            total: totalComTaxa,
            substantivo: total.quantidade === 1 ? 'conta com taxa' : 'contas com taxa',
            soma: total.taxa,
            escopo: 'retido pelas plataformas',
          }}
          ativos={periodo === 'TUDO' ? 0 : 1}
          onLimpar={() => { setPeriodo('TUDO'); setDe(''); setAte(''); }}
        />

        <Resposta
          overline={`RETIDO PELAS PLATAFORMAS ${recorte.toUpperCase()}`}
          valor={<Money valor={total.taxa} size="resposta" align="esquerda" estado="ok" />}
          frase={frase}
          chip={
            total.taxa > 0
              ? { icone: TrendingDown, rotulo: `${PCT(total.percentual)} efetivo`, tom: 'aviso' }
              : null
          }
        />

        {linhas.length > 0 ? (
        <GraficoMoldura
          titulo="Quem ficou com quanto"
          sublinha="Ordenado da maior mordida para a menor. Todas as barras na mesma escala."
          estado="ok"
          descricao={`Taxa retida por cada plataforma de pagamento ${recorte}.`}
          tabela={{
            colunas: ['Plataforma', 'Passou', 'Ficou', 'Percentual'],
            linhas: linhas.map(l => [
              l.plataforma,
              formatBRL(l.bruto),
              formatBRL(l.taxa),
              PCT(l.percentual),
            ]),
          }}
        >
          <BarrasNomeadas linhas={barras} ordenacao="dada" formatar={formatBRL} />
        </GraficoMoldura>
        ) : null}

        <FinTable<LinhaDeTaxa>
          linhas={linhas}
          colunas={colunas}
          chave={l => l.plataforma}
          estado="ok"
          vazio={{
            motivo: 'sem-dado',
            titulo: 'Nenhuma taxa registrada',
            oQueE: 'Aqui aparece quanto cada plataforma de pagamento ficou do dinheiro que passou por ela.',
            comoComeca: [
              'Abra contas a receber',
              'Registre o recebimento de uma conta',
              'Informe quanto a plataforma reteve',
            ],
            acao: { rotulo: 'Ir para contas a receber', href: '/financeiro-ag/receber' },
          }}
          totais={
            linhas.length > 0
              ? [
                  { colunaId: 'bruto', valor: total.bruto, rotulo: 'Total' },
                  { colunaId: 'taxa', valor: total.taxa, rotulo: 'Total' },
                  { colunaId: 'liquido', valor: total.liquido, rotulo: 'Total' },
                ]
              : undefined
          }
        />
      </DataState>
    </MolduraDaPagina>
  );
}
