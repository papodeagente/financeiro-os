'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { ContaReceber, createContaReceber, StatusContaReceber } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import {
  round2, num, somaPor, hojeISO, estaVencido, dentroDoPeriodo,
} from '@/lib/money';

import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money, type MoneyEstado } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { type PeriodoChave } from '@/components/fin/PeriodPicker';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { StatusChip, rotuloStatus } from '@/components/fin/StatusChip';
import { DialogBaixa } from './DialogBaixa';
import { EMPTY_FORM, FormularioConta, type ErrosForm, type FormState } from './FormularioConta';

/**
 * Status EFETIVO (derivado na leitura). Nenhum fluxo do sistema grava
 * 'ATRASADO' no banco, porque o atraso é uma consequência da data de vencimento.
 * Regra: PENDENTE/PARCIAL com vencimento anterior a hoje está ATRASADO.
 */
function statusEfetivo(i: ContaReceber): StatusContaReceber {
  if ((i.status === 'PENDENTE' || i.status === 'PARCIAL') && estaVencido(i.data_vencimento)) {
    return 'ATRASADO';
  }
  return i.status;
}

/** Quanto ainda falta receber (desconta baixas parciais já lançadas). */
function valorEmAberto(i: ContaReceber): number {
  return round2(num(i.valor_final) - num(i.valor_recebido));
}

const STATUSES: Array<StatusContaReceber | 'TODOS'> = ['TODOS', 'PENDENTE', 'RECEBIDO', 'ATRASADO', 'CANCELADO', 'PARCIAL'];

const PERIODOS: PeriodoChave[] = ['TUDO', 'MES_ATUAL', 'PROX_30', 'PROX_90', 'MES_PASSADO', 'PERSONALIZADO'];

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

const ACAO_LINHA = [
  'fin-t-body h-10 max-lg:h-11 shrink-0 rounded-[var(--fin-r-md)] px-3 shadow-none',
  'border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)]',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  FOCO,
].join(' ');

const ACAO_ICONE = [
  'size-10 max-lg:size-11 shrink-0 rounded-[var(--fin-r-md)] shadow-none',
  'text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  FOCO,
].join(' ');

const ACAO_ICONE_DESTRUTIVA = [
  'size-10 max-lg:size-11 shrink-0 rounded-[var(--fin-r-md)] shadow-none',
  'text-[var(--fin-text-3)] hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]',
  FOCO,
].join(' ');

function contagem(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export default function ContasReceberPage() {
  const [items, setItems] = useState<ContaReceber[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errosForm, setErrosForm] = useState<ErrosForm>({});
  const [formTocado, setFormTocado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [baixaAlvo, setBaixaAlvo] = useState<ContaReceber | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [exclusaoAlvo, setExclusaoAlvo] = useState<ContaReceber | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [filterStatus, setFilterStatus] = useState<StatusContaReceber | 'TODOS'>('TODOS');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [periodo, setPeriodo] = useState<PeriodoChave>('TUDO');

  async function load() {
    setLoading(true);
    try {
      const data = await loadEntities<ContaReceber>('contas-receber');
      setItems(data);
      setErroCarga(null);
      setAtualizadoEm(new Date());
    } catch {
      setErroCarga('A consulta das contas a receber falhou. Nenhum lançamento foi alterado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setErrosForm({});
    setFormTocado(false);
    setShowForm(true);
  }

  function openEdit(item: ContaReceber) {
    setForm({
      origem: item.origem,
      cliente_nome: item.cliente_nome,
      descricao: item.descricao,
      categoria_id: item.categoria_id,
      valor_original: item.valor_original,
      data_vencimento: item.data_vencimento,
      forma_recebimento: item.forma_recebimento,
      parcela_numero: item.parcela_numero,
      total_parcelas: item.total_parcelas,
      observacoes: item.observacoes,
    });
    setEditId(item.id);
    setErrosForm({});
    setFormTocado(false);
    setShowForm(true);
  }

  function atualizarForm(patch: Partial<FormState>) {
    setFormTocado(true);
    setForm(f => ({ ...f, ...patch }));
  }

  async function handleSave() {
    if (!form.cliente_nome || !form.descricao || !form.data_vencimento || form.valor_original <= 0) {
      setErrosForm({
        cliente_nome: form.cliente_nome ? undefined : 'Informe o cliente.',
        descricao: form.descricao ? undefined : 'Informe a descrição.',
        data_vencimento: form.data_vencimento ? undefined : 'Informe a data de vencimento.',
        valor_original: form.valor_original > 0 ? undefined : 'Informe um valor maior que zero.',
      });
      return;
    }
    setErrosForm({});
    setSalvando(true);
    const valorOriginal = round2(form.valor_original);
    try {
      if (editId) {
        const existing = items.find(i => i.id === editId)!;
        const updated: ContaReceber = {
          ...existing,
          ...form,
          valor_original: valorOriginal,
          valor_final: valorOriginal,
        };
        await updateEntity('contas-receber', updated);
      } else {
        const nova: ContaReceber = {
          ...createContaReceber(),
          ...form,
          valor_original: valorOriginal,
          valor_final: valorOriginal,
        };
        await saveEntity('contas-receber', nova);
      }
      setShowForm(false);
      setFormTocado(false);
      toast.success(editId ? 'Conta a receber atualizada.' : 'Conta a receber lançada.');
      setEditId(null);
      load();
    } catch {
      toast.error('Não foi possível salvar a conta a receber.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Baixa (total ou parcial). O usuário informa quanto entrou:
   *  - valor >= saldo em aberto  → RECEBIDO, valor_recebido = valor_final
   *  - valor < saldo em aberto   → PARCIAL, valor_recebido ACUMULA as baixas
   * Nunca marca RECEBIDO integral quando entrou menos do que o devido.
   */
  async function handleBaixar(item: ContaReceber, valorInformado: number) {
    const informado = round2(valorInformado);
    if (informado <= 0) return;

    const acumulado = round2(num(item.valor_recebido) + informado);
    // tolerância de meio centavo pra não deixar conta aberta por arredondamento
    const quitado = acumulado >= round2(num(item.valor_final)) - 0.005;
    const updated: ContaReceber = {
      ...item,
      status: quitado ? 'RECEBIDO' : 'PARCIAL',
      data_recebimento: hojeISO(),
      valor_recebido: quitado ? round2(num(item.valor_final)) : acumulado,
    };
    setBaixando(true);
    try {
      await updateEntity('contas-receber', updated);
      setBaixaAlvo(null);
      toast.success(quitado ? 'Conta marcada como recebida.' : 'Recebimento em parte registrado.');
      load();
    } catch {
      toast.error('Não foi possível registrar o recebimento.');
    } finally {
      setBaixando(false);
    }
  }

  async function handleDelete(id: string) {
    setExcluindo(true);
    try {
      await deleteEntity('contas-receber', id);
      setExclusaoAlvo(null);
      toast.success('Conta a receber excluída.');
      load();
    } catch (e) {
      toast.error(
        'Não foi possível excluir a conta a receber.',
        e instanceof Error ? e.message : '',
      );
    } finally {
      setExcluindo(false);
    }
  }

  const filtered = items.filter(i => {
    // filtra pelo status EFETIVO, senão "ATRASADO" nunca devolveria nada
    if (filterStatus !== 'TODOS' && statusEfetivo(i) !== filterStatus) return false;
    if ((filterDateFrom || filterDateTo) &&
        !dentroDoPeriodo(i.data_vencimento, filterDateFrom || '0000-01-01', filterDateTo || '9999-12-31')) {
      return false;
    }
    return true;
  });

  // Cards somam o SALDO EM ABERTO por status efetivo (parciais entram pelo que falta).
  // PARCIAL a vencer conta como pendente, senão o que falta receber sumiria dos cards.
  const emAberto = items.filter(i => statusEfetivo(i) === 'PENDENTE' || statusEfetivo(i) === 'PARCIAL');
  const totalPendente = somaPor(emAberto, valorEmAberto);
  const atrasadas = items.filter(i => statusEfetivo(i) === 'ATRASADO');
  const totalAtrasado = somaPor(atrasadas, valorEmAberto);
  // Recebido inclui o que já entrou nas baixas parciais.
  const recebidas = items.filter(i => i.status === 'RECEBIDO' || i.status === 'PARCIAL');
  const totalRecebido = somaPor(
    recebidas,
    i => (i.status === 'RECEBIDO' ? (i.valor_recebido ?? i.valor_final) : num(i.valor_recebido)),
  );
  const somaDoRecorte = somaPor(filtered, i => num(i.valor_final));

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erroCarga ? 'erro' : 'ok';
  const estadoDoValor: MoneyEstado = loading ? 'carregando' : erroCarga ? 'indisponivel' : 'ok';
  // Enquanto carrega ou depois de falhar não existe contagem verdadeira,
  // e um "0 contas" ao lado do número é dado inventado.
  const numerosProntos = estadoDoValor === 'ok';
  const filtrosAtivos = (filterStatus !== 'TODOS' ? 1 : 0) + (periodo !== 'TUDO' ? 1 : 0);

  function limparFiltros() {
    setFilterStatus('TODOS');
    setFilterDateFrom('');
    setFilterDateTo('');
    setPeriodo('TUDO');
  }

  const colunas: FinColuna<ContaReceber>[] = [
    {
      id: 'cliente',
      cabecalho: 'Cliente',
      tipo: 'texto',
      sortable: true,
      minWidth: 220,
      acessor: i => i.cliente_nome || '',
      render: i => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">
            {i.cliente_nome || 'Cliente não informado'}
          </span>
          {i.descricao ? (
            <span className="fin-t-caption block max-w-[42ch] truncate text-[var(--fin-text-3)]">
              {i.descricao}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'vencimento',
      cabecalho: 'Vencimento',
      tipo: 'data',
      sortable: true,
      minWidth: 108,
      valor: i => i.data_vencimento || null,
    },
    {
      id: 'valor',
      cabecalho: 'Valor',
      tipo: 'dinheiro',
      sortable: true,
      minWidth: 132,
      valor: i => i.valor_final,
      tone: i => (statusEfetivo(i) === 'ATRASADO' ? 'negativo' : 'neutro'),
      sub: i =>
        num(i.valor_recebido) > 0 && i.status !== 'RECEBIDO' ? (
          <span className="inline-flex items-center justify-end gap-[var(--fin-s-1)]">
            Falta
            <Money
              valor={valorEmAberto(i)}
              size="caption"
              tone="suave"
              align="direita"
              className="inline-block min-w-0"
              estado="ok"
            />
          </span>
        ) : null,
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      tipo: 'status',
      sortable: true,
      valor: i => statusEfetivo(i),
      dominio: 'receber',
    },
    {
      id: 'origem',
      cabecalho: 'Origem',
      tipo: 'texto',
      prioridade: 1,
      minWidth: 150,
      render: i => (
        <span className="flex flex-col items-start gap-[var(--fin-s-1)]">
          <StatusChip valor={i.origem || 'MANUAL'} dominio="origem" />
          {i.auto_gerado ? (
            <span className="fin-t-caption text-[var(--fin-text-3)]">Gerada pela venda</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      minWidth: 196,
      render: i => (
        <>
          {(i.status === 'PENDENTE' || i.status === 'ATRASADO' || i.status === 'PARCIAL') && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBaixaAlvo(i)}
              className={ACAO_LINHA}
            >
              Receber
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Editar a conta de ${i.cliente_nome || 'cliente não informado'}`}
            onClick={() => openEdit(i)}
            className={ACAO_ICONE}
          >
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Excluir a conta de ${i.cliente_nome || 'cliente não informado'}`}
            onClick={() => setExclusaoAlvo(i)}
            className={ACAO_ICONE_DESTRUTIVA}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </>
      ),
    },
  ];

  const vazio =
    items.length === 0
      ? {
          motivo: 'sem-dado' as const,
          titulo: 'Nenhuma conta a receber lançada',
          oQueE: 'Aqui ficam as cobranças que os clientes ainda vão pagar para a agência.',
          comoComeca: [
            'Lance a primeira conta pelo botão Nova conta a receber.',
            'Informe cliente, descrição, valor e data de vencimento.',
            'Quando o dinheiro entrar, use Receber para registrar o valor, total ou em parte.',
          ],
          acao: { rotulo: 'Nova conta a receber', onClick: openNew },
        }
      : {
          motivo: 'sem-resultado' as const,
          titulo: 'Nenhuma conta com esses filtros',
          oQueE: 'Os lançamentos continuam salvos. O recorte atual é que não encontrou nada.',
          acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limparFiltros },
        };

  return (
    <PageShell
      width="full"
      className="max-w-[1280px]"
      header={
        <PageHeader
          titulo="Contas a receber"
          subtitulo="O que os clientes ainda devem para a agência."
          acaoPrimaria={{ rotulo: 'Nova conta a receber', icone: Plus, onClick: openNew }}
          atualizadoEm={atualizadoEm}
          onRecarregar={load}
        />
      }
    >
      <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-3">
        <MetricCard
          rotulo="Em aberto"
          valor={totalPendente}
          estado={estadoDoValor}
          contexto={
            numerosProntos
              ? `O que falta receber em ${contagem(emAberto.length, 'conta', 'contas')}. Considera todas as contas, sem o filtro da lista.`
              : 'O que falta receber. Considera todas as contas, sem o filtro da lista.'
          }
        />
        <MetricCard
          rotulo="Em atraso"
          valor={totalAtrasado}
          estado={estadoDoValor}
          emphasis="destaque"
          tone="negativo"
          contexto={
            numerosProntos
              ? `${contagem(atrasadas.length, 'conta venceu', 'contas venceram')} e o dinheiro ainda não entrou.`
              : 'Contas que já venceram e o dinheiro ainda não entrou.'
          }
        />
        <MetricCard
          rotulo="Recebido"
          valor={totalRecebido}
          estado={estadoDoValor}
          tone="positivo"
          contexto={
            numerosProntos
              ? `Já entrou em ${contagem(recebidas.length, 'conta', 'contas')}, somando os recebimentos em parte.`
              : 'O que já entrou, somando os recebimentos em parte.'
          }
        />
      </div>

      <DataState
        estado={estado}
        erro={erroCarga ? { mensagem: erroCarga, onTentarDeNovo: () => { load(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className="h-12 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
            <FinTable<ContaReceber>
              linhas={[]}
              colunas={colunas}
              chave={i => i.id}
              estado="carregando"
              vazio={vazio}
            />
          </div>
        }
      >
        <div className="flex flex-col gap-[var(--fin-s-5)]">
          <FilterBar
            periodo={{
              valor: periodo,
              de: filterDateFrom,
              ate: filterDateTo,
              opcoes: PERIODOS,
              onChange: (chave, range) => {
                setPeriodo(chave);
                setFilterDateFrom(range.de);
                setFilterDateTo(range.ate);
              },
            }}
            selects={[
              {
                id: 'situacao',
                rotulo: 'Situação',
                valor: filterStatus,
                opcoes: STATUSES.map(s => ({
                  valor: s,
                  rotulo: s === 'TODOS' ? 'Todas' : rotuloStatus('receber', s),
                })),
                onChange: v => setFilterStatus(v as StatusContaReceber | 'TODOS'),
              },
            ]}
            resumo={{
              exibidos: filtered.length,
              total: items.length,
              substantivo: filtered.length === 1 ? 'conta a receber' : 'contas a receber',
              soma: somaDoRecorte,
              escopo: 'em valor lançado',
            }}
            ativos={filtrosAtivos}
            onLimpar={limparFiltros}
          />

          <FinTable<ContaReceber>
            linhas={filtered}
            colunas={colunas}
            chave={i => i.id}
            estado="ok"
            vazio={vazio}
            totais={
              filtered.length > 0
                ? [{ colunaId: 'valor', valor: somaDoRecorte, rotulo: 'Total do recorte' }]
                : undefined
            }
          />
        </div>
      </DataState>

      <RecordSheet
        aberto={showForm}
        onOpenChange={aberto => {
          setShowForm(aberto);
          if (!aberto) setFormTocado(false);
        }}
        titulo={editId ? 'Editar conta a receber' : 'Nova conta a receber'}
        descricao="Os valores entram nos indicadores assim que a conta é salva."
        sujo={formTocado}
        largura={640}
        acaoPrimaria={{
          rotulo: editId ? 'Salvar alterações' : 'Lançar conta',
          onClick: handleSave,
          carregando: salvando,
        }}
      >
        <FormularioConta form={form} erros={errosForm} onChange={atualizarForm} />
      </RecordSheet>

      <DialogBaixa
        aberto={baixaAlvo !== null}
        onOpenChange={aberto => { if (!aberto) setBaixaAlvo(null); }}
        contaId={baixaAlvo?.id ?? null}
        cliente={baixaAlvo?.cliente_nome ?? ''}
        descricao={baixaAlvo?.descricao ?? ''}
        valorDaConta={baixaAlvo ? num(baixaAlvo.valor_final) : 0}
        jaRecebido={baixaAlvo ? num(baixaAlvo.valor_recebido) : 0}
        emAberto={baixaAlvo ? valorEmAberto(baixaAlvo) : 0}
        processando={baixando}
        onConfirmar={valor => (baixaAlvo ? handleBaixar(baixaAlvo, valor) : undefined)}
      />

      <ConfirmDialog
        aberto={exclusaoAlvo !== null}
        onOpenChange={aberto => { if (!aberto) setExclusaoAlvo(null); }}
        titulo="Excluir esta conta a receber?"
        oQueVaiAcontecer="A conta sai da lista e deixa de contar nos indicadores. Não dá para desfazer."
        detalhes={
          exclusaoAlvo
            ? [
                { rotulo: 'Cliente', valor: exclusaoAlvo.cliente_nome || 'Cliente não informado' },
                { rotulo: 'Descrição', valor: exclusaoAlvo.descricao || 'Sem descrição' },
                { rotulo: 'Valor', valor: <Money valor={exclusaoAlvo.valor_final} size="body" estado="ok" /> },
              ]
            : undefined
        }
        confirmarRotulo="Excluir conta"
        tone="destrutivo"
        processando={excluindo}
        onConfirmar={() => (exclusaoAlvo ? handleDelete(exclusaoAlvo.id) : undefined)}
      />
    </PageShell>
  );
}
