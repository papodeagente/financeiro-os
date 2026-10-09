'use client';

import Link from 'next/link';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, Clock, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';

import { ContaReceber, createContaReceber, StatusContaReceber } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import { consumirAtalho, lerAtalhos } from '@/lib/atalho-da-url';
import {
  mensagemDaTaxaInvalida, normalizarPlataforma, validarTaxa,
} from '@/lib/taxa-plataforma';
import {
  round2, num, somaPor, estaVencido, dentroDoPeriodo,
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
import { EtiquetaDaPlataforma } from '@/components/fin/EtiquetaDaPlataforma';
import { descricaoSemPlataforma, nomeDaPlataforma, plataformaDaConta } from '@/lib/plataformas/rotulo';
import { BaixaDeReceber, valorEmAberto } from './BaixaDeReceber';
import { ehComissaoDeFornecedor, fraseDaComissao } from '@/lib/comissao-da-venda';
import { NovaVenda } from './NovaVenda';
import { DetalheDaPlataforma } from './DetalheDaPlataforma';
import { PainelNota } from './PainelNota';
import type { NotaFiscal } from '@/lib/nfse-tipos';
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
  // A lista de plataformas aprende com o que a agência já usou, para não
  // exigir uma tela de cadastro antes do primeiro lançamento.
  const plataformasUsadas = useMemo(
    () => items.map(i => i.taxa_plataforma ?? '').filter(Boolean),
    [items],
  );
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
  // A venda de turismo (serviços, fornecedores e margem) é o lançamento comum.
  const [vendaAberta, setVendaAberta] = useState(false);
  const [detalheAlvo, setDetalheAlvo] = useState<ContaReceber | null>(null);
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
      // As notas vêm junto para o botão da linha saber se já existe documento.
      // Falhar aqui não pode derrubar a tela: sem as notas o botão volta a
      // ser "Emitir nota", que é o comportamento antigo.
      try {
        const res = await fetch('/api/fiscal/notas');
        if (res.ok) {
          const notas = (await res.json()) as NotaFiscal[];
          const porConta: Record<string, NotaFiscal> = {};
          for (const n of Array.isArray(notas) ? notas : []) {
            if (!n.conta_receber_id) continue;
            if (n.status === 'REJEITADA' || n.status === 'CANCELADA') continue;
            porConta[n.conta_receber_id] = n;
          }
          setNotaPorConta(porConta);
        }
      } catch {
        setNotaPorConta({});
      }
      setErroCarga(null);
      setAtualizadoEm(new Date());
    } catch {
      setErroCarga('A consulta das contas a receber falhou. Nenhum lançamento foi alterado.');
    } finally {
      setLoading(false);
    }
  }

  // A visão geral chega aqui com ?nova=1 (lançar) ou ?status=ATRASADO (cobrar).
  function aplicarAtalhos() {
    const a = lerAtalhos();
    if (a.get('status') === 'ATRASADO') setFilterStatus('ATRASADO');
    // ?nova=1 é venda (o lançamento comum de uma agência); ?nova=outro é a
    // conta a receber simples (reembolso, acerto, aluguel).
    if (a.get('nova') === '1') { consumirAtalho('nova'); setVendaAberta(true); }
    if (a.get('nova') === 'outro') { consumirAtalho('nova'); openNew(); }
  }

  // Uma vez, ao abrir a tela: o atalho do endereço não é um estado a seguir.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); aplicarAtalhos(); }, []);

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
      // Conta antiga não tem vínculo: o campo vem vazio e o seletor avisa que
      // a nota não sai enquanto ninguém escolher um cadastro.
      cliente_id: item.cliente_id ?? '',
      cliente_nome: item.cliente_nome,
      descricao: item.descricao,
      categoria_id: item.categoria_id,
      valor_original: item.valor_original,
      data_vencimento: item.data_vencimento,
      forma_recebimento: item.forma_recebimento,
      // Conta antiga não tem os campos de taxa: entram zerados em vez de
      // undefined, senão o formulário vira não-controlado no meio da edição.
      taxa: num(item.taxa),
      taxa_plataforma: item.taxa_plataforma ?? '',
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
    const taxaInvalida = validarTaxa(form.taxa, form.valor_original);
    if (
      !form.cliente_nome || !form.descricao || !form.data_vencimento
      || form.valor_original <= 0 || taxaInvalida
    ) {
      setErrosForm({
        cliente_nome: form.cliente_nome ? undefined : 'Informe o cliente.',
        descricao: form.descricao ? undefined : 'Informe a descrição.',
        data_vencimento: form.data_vencimento ? undefined : 'Informe a data de vencimento.',
        valor_original: form.valor_original > 0 ? undefined : 'Informe um valor maior que zero.',
        taxa: taxaInvalida ? mensagemDaTaxaInvalida(taxaInvalida) : undefined,
      });
      return;
    }
    setErrosForm({});
    setSalvando(true);
    const valorOriginal = round2(form.valor_original);
    // A normalização acontece AQUI, na entrada do dado. Deixar para o
    // relatório normalizar na leitura resolveria a tela de hoje e deixaria o
    // banco com três grafias da mesma plataforma para a próxima consulta.
    const campos = {
      ...form,
      taxa: round2(num(form.taxa)),
      taxa_plataforma: normalizarPlataforma(form.taxa_plataforma),
    };
    try {
      if (editId) {
        const existing = items.find(i => i.id === editId)!;
        const updated: ContaReceber = {
          ...existing,
          ...campos,
          valor_original: valorOriginal,
          valor_final: valorOriginal,
        };
        await updateEntity('contas-receber', updated);
      } else {
        const nova: ContaReceber = {
          ...createContaReceber(),
          ...campos,
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

  // Nota fiscal da parcela. Só faz sentido depois que o dinheiro entrou: a
  // nota acompanha o recebimento, não a promessa de pagamento.
  const [notaAlvo, setNotaAlvo] = useState<ContaReceber | null>(null);
  // Nota viva de cada parcela, para o botão saber se é emitir ou baixar.
  const [notaPorConta, setNotaPorConta] = useState<Record<string, NotaFiscal>>({});
  const [baixandoNota, setBaixandoNota] = useState('');
  /** Baixa o PDF da nota daquela parcela, pelo servidor. */
  async function baixarNota(conta: ContaReceber) {
    const nota = notaPorConta[conta.id];
    if (!nota || baixandoNota) return;
    setBaixandoNota(conta.id);
    try {
      const res = await fetch(`/api/fiscal/notas/${nota.id}/documento?tipo=pdf`);
      if (!res.ok) {
        const corpo = await res.json().catch(() => null);
        toast.error('Não foi possível baixar a nota', corpo?.error || '');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NFSe-${nota.numero || nota.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Não foi possível baixar a nota');
    } finally {
      setBaixandoNota('');
    }
  }

  const recebeuAlgo = (i: ContaReceber) =>
    i.status === 'RECEBIDO' || (i.status === 'PARCIAL' && num(i.valor_recebido) > 0);

  const colunas: FinColuna<ContaReceber>[] = [
    {
      id: 'cliente',
      cabecalho: 'Cliente',
      tipo: 'texto',
      sortable: true,
      minWidth: 220,
      acessor: i => i.cliente_nome || '',
      render: i => {
        // A etiqueta fica na coluna que nunca some, inclusive no celular.
        const plataforma = plataformaDaConta(i);
        const descricao = descricaoSemPlataforma(i.descricao || '', plataforma);
        // Comissão: quem deve é o fornecedor (não há ficha de cliente para
        // abrir), e a linha diz de qual venda ela é.
        const comissao = ehComissaoDeFornecedor(i);
        const fraseComissao = fraseDaComissao(i);
        return (
          <span className="flex flex-col gap-[var(--fin-s-1)]">
            {i.cliente_id && !comissao ? (
              <Link
                href={`/pessoas/clientes/${i.cliente_id}`}
                className="fin-t-body-strong text-[var(--fin-text)] underline-offset-2 hover:text-[var(--fin-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2"
              >
                {i.cliente_nome || 'Cliente não informado'}
              </Link>
            ) : (
              <span className="fin-t-body-strong text-[var(--fin-text)]">
                {i.cliente_nome || 'Cliente não informado'}
              </span>
            )}
            {plataforma ? (
              // Veio de plataforma: a etiqueta e a descrição abrem como o
              // cliente pagou (parcelamento, cartão, antecipação).
              <button
                type="button"
                onClick={() => setDetalheAlvo(i)}
                aria-label={`Ver como ${i.cliente_nome || 'o cliente'} pagou`}
                className="flex min-w-0 max-w-[48ch] items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-sm)] text-left hover:[&>span:last-child]:text-[var(--fin-accent)] hover:[&>span:last-child]:underline"
              >
                <EtiquetaDaPlataforma plataforma={plataforma} />
                {descricao ? (
                  <span className="fin-t-caption min-w-0 truncate text-[var(--fin-text-3)] underline-offset-2">{descricao}</span>
                ) : null}
              </button>
            ) : descricao ? (
              <span className="flex min-w-0 max-w-[48ch] items-center gap-[var(--fin-s-2)]">
                <span className="fin-t-caption min-w-0 truncate text-[var(--fin-text-3)]">{descricao}</span>
              </span>
            ) : null}
            {fraseComissao ? (
              <span className="fin-t-caption max-w-[48ch] text-[var(--fin-text-3)]">{fraseComissao}</span>
            ) : null}
            {comissao && i.fornecedor_pendente ? (
              <span className="fin-t-caption inline-flex items-center gap-1 text-[var(--fin-warning-text)]">
                <TriangleAlert aria-hidden="true" className="size-3.5" />
                Informe qual fornecedor paga esta comissão
              </span>
            ) : null}
          </span>
        );
      },
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
      minWidth: 300,
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
          {recebeuAlgo(i) && (() => {
            const nota = notaPorConta[i.id];
            // Nota autorizada: o que a pessoa quer ali é o documento, não
            // emitir de novo. Nota em processamento não tem arquivo ainda.
            if (nota?.status === 'AUTORIZADA') {
              return (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { void baixarNota(i); }}
                  disabled={baixandoNota === i.id}
                  className={ACAO_LINHA}
                >
                  {baixandoNota === i.id ? 'Baixando…' : 'Baixar nota'}
                </Button>
              );
            }
            if (nota?.status === 'PROCESSANDO') {
              return (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setNotaAlvo(i)}
                  className={ACAO_LINHA}
                >
                  Nota na prefeitura
                </Button>
              );
            }
            return (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNotaAlvo(i)}
                className={ACAO_LINHA}
              >
                Emitir nota
              </Button>
            );
          })()}
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
            'Lance a primeira venda pelo botão Nova venda: cliente, serviços e fornecedores.',
            'Cada serviço tem o net e o preço de venda; a margem sai da diferença.',
            'Quando o dinheiro entrar, use Receber para registrar o valor, total ou em parte.',
          ],
          acao: { rotulo: 'Nova venda', onClick: () => setVendaAberta(true) },
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
          acaoPrimaria={{ rotulo: 'Nova venda', icone: Plus, onClick: () => setVendaAberta(true) }}
          acoesSecundarias={[{ rotulo: 'Outro recebimento', onClick: openNew }]}
          atualizadoEm={atualizadoEm}
          onRecarregar={load}
        />
      }
    >
      <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-3">
        <MetricCard
          rotulo="Em aberto" icone={Clock}
          valor={totalPendente}
          estado={estadoDoValor}
          contexto={
            numerosProntos
              ? `O que falta receber em ${contagem(emAberto.length, 'conta', 'contas')}. Considera todas as contas, sem o filtro da lista.`
              : 'O que falta receber. Considera todas as contas, sem o filtro da lista.'
          }
        />
        <MetricCard
          rotulo="Em atraso" icone={TriangleAlert}
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
          rotulo="Recebido" icone={ArrowDownLeft}
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
            <div className="h-12 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]" />
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
        titulo={editId ? 'Editar conta a receber' : 'Outro recebimento'}
        descricao="Os valores entram nos indicadores assim que a conta é salva."
        sujo={formTocado}
        largura={640}
        acaoPrimaria={{
          rotulo: editId ? 'Salvar alterações' : 'Lançar conta',
          onClick: handleSave,
          carregando: salvando,
        }}
      >
        {(() => {
          const editada = editId ? items.find(i => i.id === editId) : null;
          const plataforma = plataformaDaConta(editada);
          if (!editada || !plataforma) return null;
          return (
            <div className="mb-[var(--fin-s-4)] flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
              <EtiquetaDaPlataforma plataforma={plataforma} />
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                Criada pela integração{editada.plataforma_transacao ? `, transação ${editada.plataforma_transacao}` : ''}. Valor,
                vencimento e baixa são atualizados pela {nomeDaPlataforma(plataforma)} a cada aviso.
              </p>
            </div>
          );
        })()}
        <FormularioConta
          form={form}
          erros={errosForm}
          onChange={atualizarForm}
          plataformasUsadas={plataformasUsadas}
        />
      </RecordSheet>

      <DetalheDaPlataforma conta={detalheAlvo} onFechar={() => setDetalheAlvo(null)} />

      <PainelNota
        conta={notaAlvo}
        aberto={Boolean(notaAlvo)}
        onFechar={() => setNotaAlvo(null)}
        onEmitida={() => { load(); }}
      />

      <NovaVenda
        aberto={vendaAberta}
        onFechar={() => setVendaAberta(false)}
        onGravada={() => { load(); }}
        onOutroRecebimento={() => { setVendaAberta(false); openNew(); }}
      />

      <BaixaDeReceber
        conta={baixaAlvo}
        onFechar={() => setBaixaAlvo(null)}
        onRegistrada={() => { load(); }}
        plataformasUsadas={plataformasUsadas}
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
