'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pencil, Plus, Power, PowerOff, Trash2, TriangleAlert, X } from 'lucide-react';

import type { CartaoCorporativo, ContaPagar, BandeiraCartao } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { cn, formatBRL, formatDate, generateId } from '@/lib/utils';
import { somaPor, divSegura, round2, paraISO } from '@/lib/money';
import {
  calcLimiteUsado,
  calcProximoFechamento,
  calcProximoVencimento,
  calcFaturaPeriodo,
  BANDEIRA_LABEL,
} from '@/lib/cartoes-utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { PageHeader } from '@/components/fin/PageHeader';
import { MetricCard } from '@/components/fin/MetricCard';
import { Meter } from '@/components/fin/Meter';
import { Money, type MoneyEstado } from '@/components/fin/Money';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { DataState } from '@/components/fin/DataState';
import { type EmptyLessonProps } from '@/components/fin/EmptyLesson';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { statusChipVariants } from '@/components/fin/StatusChip';

import { faixaUtilizacaoCartao } from './faixa-utilizacao';

const BANDEIRAS: BandeiraCartao[] = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'OUTRA'];

function createNew(): CartaoCorporativo {
  return {
    id: generateId(),
    apelido: '',
    bandeira: 'VISA',
    ultimos_digitos: '',
    titular: '',
    banco_emissor: '',
    limite_total: 0,
    dia_fechamento: 0,
    dia_vencimento: 0,
    taxa_antecipacao: 0,
    taxa_parcelamento: 0,
    taxa_anuidade: 0,
    ativo: true,
    observacoes: '',
  };
}

type FormState = Omit<CartaoCorporativo, 'id'>;

const EMPTY_FORM: FormState = {
  apelido: '',
  bandeira: 'VISA',
  ultimos_digitos: '',
  titular: '',
  banco_emissor: '',
  limite_total: 0,
  dia_fechamento: 0,
  dia_vencimento: 0,
  taxa_antecipacao: 0,
  taxa_parcelamento: 0,
  taxa_anuidade: 0,
  ativo: true,
  observacoes: '',
};

type Situacao = 'TODAS' | 'ATIVOS' | 'INATIVOS';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

const CAMPO = cn(
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10',
  FOCO,
);

const GATILHO_SELECT = cn(CAMPO, 'justify-between gap-[var(--fin-s-2)]');

const ACAO_LINHA = cn(
  'size-11 rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] shadow-none hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:size-10',
  FOCO,
);

function ChipSituacao({ ativo }: { ativo: boolean }) {
  return (
    <span className={statusChipVariants({ tone: ativo ? 'positivo' : 'neutro' })}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-[var(--fin-r-dot)] bg-current" />
      {ativo ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[var(--fin-s-3)]">
      <h3 className="fin-t-overline text-[var(--fin-text-3)]">{titulo}</h3>
      <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">{children}</div>
    </section>
  );
}

function FaixaIndicadores({
  estado,
  limite,
  usado,
  disponivel,
  pct,
  ativos,
  cadastrados,
}: {
  estado: MoneyEstado;
  limite: number;
  usado: number;
  disponivel: number;
  pct: number;
  ativos: number;
  cadastrados: number;
}) {
  const pronto = estado === 'ok';
  const plural = cadastrados === 1 ? 'cartão cadastrado' : 'cartões cadastrados';

  // Enquanto carrega, nenhum número é escrito nem em texto: "0 ativos entre 0
  // cartões" é dado inventado do mesmo jeito que um R$ 0,00 falso.
  const contextoLimite = pronto
    ? `${ativos} ativo${ativos === 1 ? '' : 's'} entre ${cadastrados} ${plural}`
    : 'Soma do limite de todos os cartões cadastrados';

  return (
    <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard rotulo="Limite total" valor={limite} estado={estado} contexto={contextoLimite} />
      <MetricCard
        rotulo="Limite usado"
        valor={usado}
        estado={estado}
        contexto="Contas lançadas em todos os cartões, sem contar as canceladas"
        // O gatilho da explicação é focável, e o esqueleto vive debaixo de
        // aria-hidden: só existe com os dados prontos.
        explicacao={
          pronto
            ? 'Pagar a conta a pagar não devolve limite. Quem devolve é o pagamento da fatura do cartão.'
            : undefined
        }
      />
      <MetricCard
        rotulo="Disponível"
        valor={disponivel}
        estado={estado}
        emphasis="destaque"
        contexto="Em todos os cartões, o limite que ainda dá para usar hoje"
      />
      <div className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4">
        <h3 className="fin-t-overline text-[var(--fin-text-3)]">Utilização</h3>
        {pronto ? (
          <Meter
            pct={pct}
            faixa={faixaUtilizacaoCartao(pct)}
            descricao={`${formatBRL(usado)} de ${formatBRL(limite)}`}
          />
        ) : (
          <div className="flex flex-col gap-[var(--fin-s-2)]">
            <span
              aria-hidden="true"
              className="block h-2 w-full rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]"
            />
            <span className="fin-t-caption text-[var(--fin-text-3)]">
              A faixa aparece quando os dados terminam de carregar.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CartoesCorpPage() {
  const [items, setItems] = useState<CartaoCorporativo[]>([]);
  const [contas, setContas] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showTaxas, setShowTaxas] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Situacao>('TODAS');
  const [excluirId, setExcluirId] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [faturaCardId, setFaturaCardId] = useState<string | null>(null);
  const [faturaMes, setFaturaMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  async function load() {
    setLoading(true);
    setErro(null);
    try {
      const [cartoes, cps] = await Promise.all([
        loadEntities<CartaoCorporativo>('cartoes-corp'),
        loadEntities<ContaPagar>('contas-pagar'),
      ]);
      setItems(cartoes);
      setContas(cps);
      setAtualizadoEm(new Date());
    } catch {
      setErro('A consulta aos cartões falhou antes de responder. Nada foi alterado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowTaxas(false);
    setShowForm(true);
  }

  function openEdit(item: CartaoCorporativo) {
    const { id: _id, ...rest } = item;
    void _id;
    setForm({ ...EMPTY_FORM, ...rest });
    setEditId(item.id);
    setShowTaxas((item.taxa_antecipacao || item.taxa_parcelamento || item.taxa_anuidade) > 0);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.apelido) return;
    if (editId) {
      const existing = items.find(i => i.id === editId)!;
      await updateEntity<CartaoCorporativo>('cartoes-corp', { ...existing, ...form });
    } else {
      const novo: CartaoCorporativo = { ...createNew(), ...form };
      await saveEntity<CartaoCorporativo>('cartoes-corp', novo);
    }
    setShowForm(false);
    setEditId(null);
    load();
  }

  async function handleDelete(id: string) {
    await deleteEntity('cartoes-corp', id);
    load();
  }

  async function toggleAtivo(item: CartaoCorporativo) {
    await updateEntity<CartaoCorporativo>('cartoes-corp', { ...item, ativo: !item.ativo });
    load();
  }

  // KPI consolidado
  const totals = useMemo(() => {
    const limite = somaPor(items, c => c.limite_total);
    const usado = somaPor(items, c => calcLimiteUsado(c.id, contas));
    const pct = round2(divSegura(usado, limite) * 100);
    return { limite, usado, pct, ativos: items.filter(c => c.ativo).length };
  }, [items, contas]);

  // Fatura aberta
  const faturaCard = items.find(c => c.id === faturaCardId) || null;
  const fatura = useMemo(() => {
    if (!faturaCard) return null;
    return calcFaturaPeriodo(faturaCard, contas, faturaMes);
  }, [faturaCard, contas, faturaMes]);

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erro ? 'erro' : 'ok';
  const estadoMoney: MoneyEstado = loading ? 'carregando' : erro ? 'indisponivel' : 'ok';

  const termo = busca.trim().toLocaleLowerCase('pt-BR');

  const exibidos = useMemo(() => {
    return items.filter(c => {
      if (situacao === 'ATIVOS' && !c.ativo) return false;
      if (situacao === 'INATIVOS' && c.ativo) return false;
      if (!termo) return true;
      return [c.apelido, c.banco_emissor, c.titular, c.ultimos_digitos, BANDEIRA_LABEL[c.bandeira]]
        .some(campo => (campo || '').toLocaleLowerCase('pt-BR').includes(termo));
    });
  }, [items, situacao, termo]);

  const usadoExibido = useMemo(
    () => somaPor(exibidos, c => calcLimiteUsado(c.id, contas)),
    [exibidos, contas],
  );

  const filtrosAtivos = (termo ? 1 : 0) + (situacao !== 'TODAS' ? 1 : 0);

  function limparFiltros() {
    setBusca('');
    setSituacao('TODAS');
  }

  const cartaoParaExcluir = items.find(c => c.id === excluirId) || null;

  async function confirmarExclusao() {
    if (!cartaoParaExcluir) return;
    setExcluindo(true);
    try {
      await handleDelete(cartaoParaExcluir.id);
      setExcluirId(null);
    } finally {
      setExcluindo(false);
    }
  }

  const vazio: EmptyLessonProps =
    filtrosAtivos > 0
      ? {
          motivo: 'sem-resultado',
          titulo: 'Nenhum cartão com esses filtros',
          oQueE: 'Os cartões continuam cadastrados, mas nenhum deles atende à busca ou à situação escolhida.',
          acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limparFiltros },
        }
      : {
          motivo: 'sem-dado',
          titulo: 'Nenhum cartão cadastrado',
          oQueE:
            'Aqui ficam os cartões corporativos da agência, com o limite de cada um, quanto já foi usado e a fatura do período.',
          comoComeca: [
            'Cadastre o cartão com apelido, limite e os dias de fechamento e de vencimento.',
            'Ao lançar uma conta a pagar, escolha esse cartão como forma de pagamento.',
            'A utilização e a fatura do período passam a ser calculadas sozinhas.',
          ],
          acao: { rotulo: 'Novo cartão', onClick: openNew },
        };

  const colunas: FinColuna<CartaoCorporativo>[] = [
    {
      id: 'cartao',
      cabecalho: 'Cartão',
      tipo: 'texto',
      sortable: true,
      minWidth: 240,
      acessor: c => c.apelido,
      render: c => (
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">{c.apelido}</span>
            <ChipSituacao ativo={c.ativo} />
          </span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {[
              BANDEIRA_LABEL[c.bandeira],
              c.ultimos_digitos ? `final ${c.ultimos_digitos}` : null,
              c.banco_emissor || null,
              c.titular || null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      ),
    },
    {
      id: 'fechamento',
      cabecalho: 'Fecha em',
      tipo: 'data',
      prioridade: 1,
      valor: c => (c.dia_fechamento ? paraISO(calcProximoFechamento(c.dia_fechamento)) : null),
    },
    {
      id: 'vencimento',
      cabecalho: 'Vence em',
      tipo: 'data',
      valor: c => (c.dia_vencimento ? paraISO(calcProximoVencimento(c.dia_vencimento)) : null),
    },
    {
      id: 'limite',
      cabecalho: 'Limite',
      tipo: 'dinheiro',
      prioridade: 2,
      sortable: true,
      valor: c => c.limite_total,
    },
    {
      id: 'usado',
      cabecalho: 'Usado',
      tipo: 'dinheiro',
      sortable: true,
      valor: c => calcLimiteUsado(c.id, contas),
      sub: c => `Disponível ${formatBRL(Math.max(0, c.limite_total - calcLimiteUsado(c.id, contas)))}`,
    },
    {
      id: 'utilizacao',
      cabecalho: 'Utilização',
      tipo: 'texto',
      minWidth: 184,
      render: c => {
        const usado = calcLimiteUsado(c.id, contas);
        const pct = c.limite_total > 0 ? (usado / c.limite_total) * 100 : 0;
        return (
          <Meter
            pct={pct}
            faixa={faixaUtilizacaoCartao(pct)}
            descricao={`${formatBRL(usado)} de ${formatBRL(c.limite_total)}`}
            size="sm"
          />
        );
      },
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      minWidth: 156,
      render: c => (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Editar o cartão ${c.apelido}`}
            className={ACAO_LINHA}
            onClick={() => openEdit(c)}
          >
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={c.ativo ? `Desativar o cartão ${c.apelido}` : `Ativar o cartão ${c.apelido}`}
            className={ACAO_LINHA}
            onClick={() => toggleAtivo(c)}
          >
            {c.ativo ? (
              <Power aria-hidden="true" className="size-4" />
            ) : (
              <PowerOff aria-hidden="true" className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Excluir o cartão ${c.apelido}`}
            className={cn(
              ACAO_LINHA,
              'text-[var(--fin-negative)] hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]',
            )}
            onClick={() => setExcluirId(c.id)}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </>
      ),
    },
  ];

  const colunasFatura: FinColuna<ContaPagar>[] = [
    {
      id: 'lancamento',
      cabecalho: 'Lançamento',
      tipo: 'texto',
      minWidth: 240,
      render: l => (
        <span className="flex flex-col gap-1">
          <span className="fin-t-body-strong text-[var(--fin-text)]">
            {l.descricao || l.fornecedor_nome || 'Sem descrição'}
          </span>
          {l.total_parcelas > 1 ? (
            <span className="fin-t-caption text-[var(--fin-text-3)]">
              Parcela {l.parcela_numero} de {l.total_parcelas}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'data',
      cabecalho: 'Data',
      tipo: 'data',
      valor: l => l.data_pagamento || l.data_vencimento,
    },
    {
      id: 'status',
      cabecalho: 'Situação',
      tipo: 'status',
      dominio: 'pagar',
      valor: l => l.status,
    },
    {
      id: 'valor',
      cabecalho: 'Valor',
      tipo: 'dinheiro',
      valor: l => l.valor_final,
    },
  ];

  return (
    <div className="min-h-full bg-[var(--fin-bg)] px-[var(--fin-page-pad)] py-[var(--fin-s-5)] text-[var(--fin-text)]">
      <div className="mx-auto w-full max-w-[var(--fin-page-max)]">
        <PageHeader
          titulo="Cartões corporativos"
          subtitulo="Limite, fatura e lançamentos de cada cartão da agência"
          acaoPrimaria={{ rotulo: 'Novo cartão', icone: Plus, onClick: openNew }}
          atualizadoEm={atualizadoEm}
          onRecarregar={load}
        />

        <div className="mt-[var(--fin-s-6)] flex flex-col gap-[var(--fin-s-5)]">
          <DataState
            estado={estado}
            erro={{ mensagem: erro ?? '', onTentarDeNovo: load }}
            esqueleto={
              <FaixaIndicadores
                estado="carregando"
                limite={0}
                usado={0}
                disponivel={0}
                pct={0}
                ativos={0}
                cadastrados={0}
              />
            }
          >
            <FaixaIndicadores
              estado={estadoMoney}
              limite={totals.limite}
              usado={totals.usado}
              disponivel={totals.limite - totals.usado}
              pct={totals.pct}
              ativos={totals.ativos}
              cadastrados={items.length}
            />
          </DataState>

          {estado === 'ok' && items.length > 0 ? (
            <FilterBar
              busca={{
                valor: busca,
                onChange: setBusca,
                placeholder: 'Buscar por apelido, banco, titular ou final',
              }}
              selects={[
                {
                  id: 'situacao-cartao',
                  rotulo: 'Situação',
                  valor: situacao,
                  opcoes: [
                    { valor: 'TODAS', rotulo: 'Todos' },
                    { valor: 'ATIVOS', rotulo: 'Ativos' },
                    { valor: 'INATIVOS', rotulo: 'Inativos' },
                  ],
                  onChange: v => setSituacao(v as Situacao),
                },
              ]}
              resumo={{
                exibidos: exibidos.length,
                total: items.length,
                substantivo: exibidos.length === 1 ? 'cartão' : 'cartões',
                soma: usadoExibido,
                escopo: 'usado nos cartões exibidos',
              }}
              ativos={filtrosAtivos}
              onLimpar={limparFiltros}
            />
          ) : null}

          <section aria-label="Cartões cadastrados" className="flex flex-col gap-[var(--fin-s-3)]">
            {estado === 'ok' && exibidos.length > 0 ? (
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                Selecione um cartão para abrir a fatura do período.
              </p>
            ) : null}
            <FinTable
              linhas={exibidos}
              colunas={colunas}
              chave={c => c.id}
              estado={estado}
              erro={{ mensagem: erro ?? '', onTentarDeNovo: load }}
              vazio={vazio}
              totais={
                exibidos.length > 0
                  ? [{ colunaId: 'usado', valor: usadoExibido, rotulo: 'Usado nos cartões exibidos' }]
                  : undefined
              }
              onLinhaClick={c => setFaturaCardId(faturaCardId === c.id ? null : c.id)}
            />
          </section>

          {faturaCard && fatura ? (
            <section
              aria-label={`Fatura do cartão ${faturaCard.apelido}`}
              className="flex flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4"
            >
              <div className="flex flex-col gap-[var(--fin-s-3)] lg:flex-row lg:items-end lg:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">
                    Fatura de {faturaCard.apelido}
                    {faturaCard.ultimos_digitos ? ` (final ${faturaCard.ultimos_digitos})` : ''}
                  </h2>
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    Período de {formatDate(paraISO(fatura.inicio))} a {formatDate(paraISO(fatura.fim))}
                  </p>
                </div>
                <div className="flex items-end gap-[var(--fin-s-2)]">
                  <div className="w-44">
                    <Field rotulo="Mês da fatura">
                      {a => (
                        <Input
                          {...a}
                          type="month"
                          value={faturaMes}
                          onChange={e => setFaturaMes(e.target.value)}
                          className={CAMPO}
                        />
                      )}
                    </Field>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Fechar a fatura"
                    className={ACAO_LINHA}
                    onClick={() => setFaturaCardId(null)}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>

              <FinTable
                linhas={fatura.lancamentos}
                colunas={colunasFatura}
                chave={l => l.id}
                densidade="compacta"
                estado={estado}
                erro={{ mensagem: erro ?? '', onTentarDeNovo: load }}
                vazio={{
                  motivo: 'sem-resultado',
                  titulo: 'Nenhum lançamento neste período',
                  oQueE: `Nenhuma conta deste cartão caiu entre ${formatDate(paraISO(fatura.inicio))} e ${formatDate(paraISO(fatura.fim))}. Troque o mês para ver outro período.`,
                }}
                totais={
                  fatura.lancamentos.length > 0
                    ? [{ colunaId: 'valor', valor: fatura.total, rotulo: 'Total da fatura' }]
                    : undefined
                }
              />

              {fatura.total > faturaCard.limite_total ? (
                <div
                  role="status"
                  className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-negative)]/24 bg-[var(--fin-negative-soft)] p-3"
                >
                  <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--fin-negative)]" />
                  <p className="fin-t-body text-[var(--fin-negative-text)]">
                    A fatura deste período passou do limite total do cartão.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      <RecordSheet
        aberto={showForm}
        onOpenChange={setShowForm}
        titulo={editId ? 'Editar cartão' : 'Novo cartão'}
        descricao="O limite e os dias de fechamento e de vencimento alimentam a utilização e a fatura do período."
        largura={640}
        resumo={`${form.ativo ? 'Cartão ativo' : 'Cartão inativo'}, com limite de ${formatBRL(form.limite_total)}. As contas lançadas nele seguem consumindo limite até a fatura ser paga.`}
        acaoPrimaria={{
          rotulo: editId ? 'Salvar cartão' : 'Criar cartão',
          onClick: handleSave,
          desabilitado: !form.apelido,
        }}
      >
        <div className="flex flex-col gap-[var(--fin-s-5)]">
          <Secao titulo="Essencial">
            <Field rotulo="Apelido" obrigatorio ajuda="Como a equipe chama esse cartão no dia a dia.">
              {a => (
                <Input
                  {...a}
                  value={form.apelido}
                  onChange={e => setForm(f => ({ ...f, apelido: e.target.value }))}
                  placeholder="Itaú Black Marketing"
                  className={CAMPO}
                />
              )}
            </Field>

            <Field rotulo="Bandeira">
              {a => (
                <Select
                  value={form.bandeira}
                  onValueChange={v => setForm(f => ({ ...f, bandeira: v as BandeiraCartao }))}
                >
                  <SelectTrigger
                    id={a.id}
                    aria-describedby={a['aria-describedby']}
                    className={GATILHO_SELECT}
                  >
                    <SelectValue>{() => BANDEIRA_LABEL[form.bandeira]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {BANDEIRAS.map(b => (
                      <SelectItem key={b} value={b} className="fin-t-body">
                        {BANDEIRA_LABEL[b]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field rotulo="Banco emissor">
              {a => (
                <Input
                  {...a}
                  value={form.banco_emissor}
                  onChange={e => setForm(f => ({ ...f, banco_emissor: e.target.value }))}
                  placeholder="Itaú, Bradesco, Nubank"
                  className={CAMPO}
                />
              )}
            </Field>

            <Field rotulo="Quatro últimos dígitos">
              {a => (
                <Input
                  {...a}
                  value={form.ultimos_digitos}
                  maxLength={4}
                  inputMode="numeric"
                  onChange={e => setForm(f => ({ ...f, ultimos_digitos: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="0000"
                  className={cn(CAMPO, 'tabular-nums')}
                />
              )}
            </Field>

            <Field rotulo="Titular" ajuda="Nome impresso no cartão.">
              {a => (
                <Input
                  {...a}
                  value={form.titular}
                  onChange={e => setForm(f => ({ ...f, titular: e.target.value }))}
                  className={CAMPO}
                />
              )}
            </Field>

            <MoneyField
              rotulo="Limite total"
              valor={form.limite_total}
              onChange={v => setForm(f => ({ ...f, limite_total: v }))}
            />
          </Secao>

          <Secao titulo="Calendário e situação">
            <Field rotulo="Dia de fechamento" ajuda="Dia do mês, de 1 a 31.">
              {a => (
                <Input
                  {...a}
                  type="number"
                  min={1}
                  max={31}
                  value={form.dia_fechamento || ''}
                  onChange={e => setForm(f => ({ ...f, dia_fechamento: parseInt(e.target.value) || 0 }))}
                  placeholder="1 a 31"
                  className={CAMPO}
                />
              )}
            </Field>

            <Field rotulo="Dia de vencimento" ajuda="Dia do mês, de 1 a 31.">
              {a => (
                <Input
                  {...a}
                  type="number"
                  min={1}
                  max={31}
                  value={form.dia_vencimento || ''}
                  onChange={e => setForm(f => ({ ...f, dia_vencimento: parseInt(e.target.value) || 0 }))}
                  placeholder="1 a 31"
                  className={CAMPO}
                />
              )}
            </Field>

            <Field rotulo="Situação" ajuda="Cartão inativo continua na lista, mas fica marcado como fora de uso.">
              {a => (
                <Select
                  value={form.ativo ? 'ATIVO' : 'INATIVO'}
                  onValueChange={v => setForm(f => ({ ...f, ativo: v === 'ATIVO' }))}
                >
                  <SelectTrigger
                    id={a.id}
                    aria-describedby={a['aria-describedby']}
                    className={GATILHO_SELECT}
                  >
                    <SelectValue>{() => (form.ativo ? 'Ativo' : 'Inativo')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ATIVO" className="fin-t-body">Ativo</SelectItem>
                    <SelectItem value="INATIVO" className="fin-t-body">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
          </Secao>

          <section className="flex flex-col gap-[var(--fin-s-3)]">
            <Button
              type="button"
              variant="ghost"
              aria-expanded={showTaxas}
              aria-controls="cartao-taxas"
              onClick={() => setShowTaxas(s => !s)}
              className={cn(
                'fin-t-body h-11 w-fit gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-3 text-[var(--fin-text-2)] shadow-none hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:h-10',
                FOCO,
              )}
            >
              {showTaxas ? 'Ocultar taxas e custos' : 'Mostrar taxas e custos'}
            </Button>

            <div id="cartao-taxas" hidden={!showTaxas}>
              <div className="grid grid-cols-1 gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-3 sm:grid-cols-2">
                <Field rotulo="Antecipação" ajuda="Percentual ao mês.">
                  {a => (
                    <Input
                      {...a}
                      type="number"
                      step="0.01"
                      value={form.taxa_antecipacao}
                      onChange={e => setForm(f => ({ ...f, taxa_antecipacao: parseFloat(e.target.value) || 0 }))}
                      className={CAMPO}
                    />
                  )}
                </Field>

                <Field rotulo="Parcelamento" ajuda="Percentual por parcelamento.">
                  {a => (
                    <Input
                      {...a}
                      type="number"
                      step="0.01"
                      value={form.taxa_parcelamento}
                      onChange={e => setForm(f => ({ ...f, taxa_parcelamento: parseFloat(e.target.value) || 0 }))}
                      className={CAMPO}
                    />
                  )}
                </Field>

                <MoneyField
                  rotulo="Anuidade"
                  ajuda="Valor cobrado por ano."
                  valor={form.taxa_anuidade}
                  onChange={v => setForm(f => ({ ...f, taxa_anuidade: v }))}
                />
              </div>
            </div>
          </section>
        </div>
      </RecordSheet>

      <ConfirmDialog
        aberto={excluirId !== null}
        onOpenChange={aberto => { if (!aberto) setExcluirId(null); }}
        titulo="Excluir cartão"
        oQueVaiAcontecer="O cartão sai da lista de cartões corporativos. As contas já lançadas nele continuam registradas e não são alteradas."
        detalhes={
          cartaoParaExcluir
            ? [
                { rotulo: 'Cartão', valor: cartaoParaExcluir.apelido },
                { rotulo: 'Limite', valor: <Money valor={cartaoParaExcluir.limite_total} size="strong" estado="ok" /> },
                {
                  rotulo: 'Usado hoje',
                  valor: <Money valor={calcLimiteUsado(cartaoParaExcluir.id, contas)} size="strong" estado="ok" />,
                },
              ]
            : undefined
        }
        confirmarRotulo="Excluir cartão"
        tone="destrutivo"
        processando={excluindo}
        onConfirmar={confirmarExclusao}
      />
    </div>
  );
}
