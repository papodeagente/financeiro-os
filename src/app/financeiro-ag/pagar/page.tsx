'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { ContaPagar, PlanoContas, createContaPagar, StatusContaPagar, CartaoCorporativo } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import {
  round2, num, somaPor, paraBRL,
  hojeISO, addDias, addMeses, dataSegura, estaVencido, mesDe, dentroDoPeriodo,
} from '@/lib/money';
import { formatBRL } from '@/lib/utils';
import { PageShell } from '@/components/PageShell';

import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import type { EmptyLessonProps } from '@/components/fin/EmptyLesson';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money, type MoneyEstado } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import type { PeriodoChave, PeriodoRange } from '@/components/fin/PeriodPicker';
import { rotuloStatus } from '@/components/fin/StatusChip';

import { criarColunas } from './colunas';
import { DialogBaixa } from './DialogBaixa';
import { FormularioConta } from './FormularioConta';
import { PainelCopiarMes } from './PainelCopiarMes';
import { EMPTY_FORM, SEM_ERRO, type ErrosDoFormulario, type FiltroPeriodo, type FormState, type RecorrenciaPeriodo } from './tipos';

// Calcula próximo vencimento dado base e tipo de recorrência.
// MENSAL usa addMeses, que CLAMPA o dia (31/01 + 1 mês = 28/02).
function avancarData(baseISO: string, periodo: RecorrenciaPeriodo, count: number): string {
  if (periodo === 'MENSAL') return addMeses(baseISO, count);
  return addDias(baseISO, (periodo === 'SEMANAL' ? 7 : 14) * count);
}

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]}/${y}`;
}

function addMonth(ym: string): string {
  return mesDe(addMeses(`${ym}-01`, 1));
}

/**
 * Valor da conta em BRL.
 *
 * `valor_final` é BRL por contrato (ver venda-financeiro.ts), tanto nas contas
 * geradas por venda quanto nas lançadas à mão. Não se infere formato comparando
 * valor_final com valor_original: contas antigas em moeda estrangeira têm os
 * dois iguais e legitimamente em BRL, e converter de novo inflaria o valor pelo
 * câmbio. `valor_brl` é usado só quando valor_final está ausente.
 */
function valorBRLDaConta(i: ContaPagar): number {
  const final = num(i.valor_final);
  if (final) return round2(final);
  return round2(num(i.valor_brl));
}

/** Quanto ainda falta pagar (em BRL). Conta PARCIAL mantém o saldo visível. */
function saldoDevedor(i: ContaPagar): number {
  return round2(valorBRLDaConta(i) - num(i.valor_pago));
}

/** Está em aberto (PENDENTE/PARCIAL/VENCIDO) com vencimento anterior a hoje. */
function ehVencidoEmAberto(i: ContaPagar, hoje: string): boolean {
  if (i.status !== 'PENDENTE' && i.status !== 'PARCIAL' && i.status !== 'VENCIDO') return false;
  return estaVencido(i.data_vencimento, hoje);
}

/**
 * Só entra na cópia de mês o que é lançamento MANUAL recorrente:
 * custo auto-gerado de venda/grupo é recriado pela própria venda (duplicaria),
 * e conta CANCELADA não pode ser ressuscitada.
 */
function podeCopiarParaOutroMes(i: ContaPagar): boolean {
  if (i.natureza_custo === 'COMPRA_UNICA') return false;
  if (i.auto_gerado) return false;
  if (i.origem === 'VENDA' || i.origem === 'GRUPO') return false;
  if (i.status === 'CANCELADO') return false;
  return true;
}

/** Mesma condição de sempre para a ação de pagar na linha. */
function podePagar(i: ContaPagar): boolean {
  return i.status === 'PENDENTE' || i.status === 'VENCIDO' || i.status === 'PARCIAL';
}

/** O período do filtro e o PeriodPicker falam a mesma coisa com nomes diferentes. */
const FILTRO_PARA_PICKER: Record<FiltroPeriodo, PeriodoChave> = {
  TODOS: 'TUDO',
  MES_ATUAL: 'MES_ATUAL',
  PROX_30D: 'PROX_30',
  PROX_90D: 'PROX_90',
  VENCIDOS: 'VENCIDOS',
  MES_PASSADO: 'MES_PASSADO',
  CUSTOM: 'PERSONALIZADO',
};

const PICKER_PARA_FILTRO: Record<PeriodoChave, FiltroPeriodo> = {
  TUDO: 'TODOS',
  MES_ATUAL: 'MES_ATUAL',
  PROX_30: 'PROX_30D',
  PROX_90: 'PROX_90D',
  VENCIDOS: 'VENCIDOS',
  MES_PASSADO: 'MES_PASSADO',
  PERSONALIZADO: 'CUSTOM',
};

/** Recorte ativo escrito por extenso, para o contexto dos indicadores. */
const ESCOPO_DO_PERIODO: Record<FiltroPeriodo, string> = {
  TODOS: 'em todo o período',
  MES_ATUAL: 'neste mês',
  PROX_30D: 'com vencimento nos próximos 30 dias',
  PROX_90D: 'com vencimento nos próximos 90 dias',
  VENCIDOS: 'entre as vencidas até hoje',
  MES_PASSADO: 'no mês passado',
  CUSTOM: 'no período escolhido',
};

const OPCOES_STATUS: { valor: string; rotulo: string }[] = [
  { valor: 'TODOS', rotulo: 'Todas as situações' },
  { valor: 'ABERTO', rotulo: 'Com saldo a pagar' },
  { valor: 'PENDENTE', rotulo: rotuloStatus('pagar', 'PENDENTE') },
  { valor: 'PARCIAL', rotulo: rotuloStatus('pagar', 'PARCIAL') },
  { valor: 'PAGO', rotulo: rotuloStatus('pagar', 'PAGO') },
  { valor: 'CANCELADO', rotulo: rotuloStatus('pagar', 'CANCELADO') },
];

function contasTexto(n: number): string {
  return n === 1 ? '1 conta' : `${n} contas`;
}

function EsqueletoIndicadores() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4"
        >
          <span className="block h-3 w-24 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-6 w-32 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-3 w-40 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        </div>
      ))}
    </div>
  );
}

function EsqueletoFiltros() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-12 flex-wrap items-center gap-2 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-3"
    >
      <span className="block h-10 w-72 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
      <span className="block h-10 w-48 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
      <span className="block h-10 w-44 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
    </div>
  );
}

export default function ContasPagarPage() {
  const [items, setItems] = useState<ContaPagar[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [cartoes, setCartoes] = useState<CartaoCorporativo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  // 'ABERTO' é pseudo-status do card Pendente: PENDENTE + PARCIAL (tudo que
  // ainda tem saldo devedor), pra o total do card bater com a lista.
  const [filterStatus, setFilterStatus] = useState<StatusContaPagar | 'TODOS' | 'ABERTO'>('TODOS');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('TODAS');
  const [filterBusca, setFilterBusca] = useState('');
  const [filterPeriodo, setFilterPeriodo] = useState<FiltroPeriodo>('MES_ATUAL');
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceMonth, setCopySourceMonth] = useState('');
  const [copyTargetMonth, setCopyTargetMonth] = useState('');
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [excluindo, setExcluindo] = useState<ContaPagar | null>(null);
  const [removendo, setRemovendo] = useState(false);
  // Estado do diálogo de confirmação de pagamento
  const [pagarModal, setPagarModal] = useState<{
    item: ContaPagar;
    dataPagamento: string;
    valorPago: number;
    observacao: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [data, contas, cards] = await Promise.all([
        loadEntities<ContaPagar>('contas-pagar'),
        loadEntities<PlanoContas>('plano-contas'),
        loadEntities<CartaoCorporativo>('cartoes-corp'),
      ]);
      setItems(data);
      setPlanoContas(contas);
      setCartoes(cards);
      setErroCarga(null);
    } catch {
      setErroCarga('A consulta ao servidor falhou. Nenhum dado foi alterado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // When a categoria is selected, auto-fill natureza/comercial from plano de contas
  function onCategoriaChange(catId: string) {
    const cat = planoContas.find(c => c.id === catId);
    setForm(f => ({
      ...f,
      categoria_id: catId,
      natureza_custo: cat?.natureza_custo ?? f.natureza_custo,
      is_custo_comercial: cat?.is_custo_comercial ?? f.is_custo_comercial,
    }));
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setTentouSalvar(false);
    setShowCopyModal(false);
    setShowForm(true);
  }

  function openEdit(item: ContaPagar) {
    setForm({
      origem: item.origem,
      fornecedor_nome: item.fornecedor_nome,
      descricao: item.descricao,
      categoria_id: item.categoria_id || '',
      valor_original: item.valor_original,
      moeda: item.moeda,
      cambio: item.cambio,
      data_vencimento: item.data_vencimento,
      forma_pagamento: item.forma_pagamento,
      cartao_id: item.cartao_id || '',
      natureza_custo: item.natureza_custo ?? null,
      is_custo_comercial: item.is_custo_comercial ?? false,
      observacoes: item.observacoes,
      recorrencia_ativa: false,
      recorrencia_periodo: 'MENSAL',
      recorrencia_repeticoes: 12,
    });
    setEditId(item.id);
    setTentouSalvar(false);
    setShowCopyModal(false);
    setShowForm(true);
  }

  async function handleSave() {
    // Guarda de duplo-submit: sem isso, clique duplo cria a conta (ou a série
    // inteira de parcelas) duas vezes.
    if (saving) return;
    // Validações com feedback específico em vez de return silencioso
    if (!form.fornecedor_nome.trim()) { toast.error('Informe o fornecedor'); return; }
    if (!form.descricao.trim()) { toast.error('Informe uma descrição'); return; }
    if (!form.data_vencimento) { toast.error('Informe a data de vencimento'); return; }
    if (form.valor_original <= 0) { toast.error('Valor deve ser maior que zero'); return; }
    if (form.moeda !== 'BRL' && num(form.cambio) <= 0) { toast.error('Informe o câmbio da moeda estrangeira'); return; }

    const valorOriginal = round2(num(form.valor_original));
    const cambio = form.moeda === 'BRL' ? 1 : num(form.cambio);
    // valor_final é SEMPRE em BRL: o resto do sistema soma esse campo como real.
    // A moeda de origem fica preservada em valor_original + moeda + cambio.
    const valorBrl = paraBRL(valorOriginal, form.moeda, cambio);
    const cartaoIdFinal = form.forma_pagamento === 'CARTAO_CORP' ? (form.cartao_id || null) : null;

    setSaving(true);
    try {
      // Edição NÃO suporta recorrência (só aplica em criação).
      if (editId) {
        const existing = items.find(i => i.id === editId)!;
        const updated: ContaPagar = {
          ...existing,
          ...form,
          cartao_id: cartaoIdFinal,
          valor_original: valorOriginal,
          cambio,
          valor_final: valorBrl,
          valor_brl: valorBrl,
        };
        await updateEntity('contas-pagar', updated);
        setShowForm(false);
        setEditId(null);
        toast.success('Conta atualizada');
        load();
        return;
      }

      // Quantas contas criar: 1 para única, N para recorrente.
      const isDespesaFixa = form.origem === 'DESPESA_FIXA';
      const recorrer = isDespesaFixa && form.recorrencia_ativa && form.recorrencia_repeticoes > 1;
      const total = recorrer ? form.recorrencia_repeticoes : 1;
      const periodoLabel: Record<RecorrenciaPeriodo, string> = {
        MENSAL: 'mensal', SEMANAL: 'semanal', QUINZENAL: 'quinzenal',
      };

      for (let i = 0; i < total; i++) {
        const vencimento = i === 0 ? form.data_vencimento : avancarData(form.data_vencimento, form.recorrencia_periodo, i);
        const desc = recorrer
          ? `${form.descricao} (${i + 1}/${total} — ${periodoLabel[form.recorrencia_periodo]})`
          : form.descricao;
        const nova: ContaPagar = {
          ...createContaPagar(),
          ...form,
          cartao_id: cartaoIdFinal,
          descricao: desc,
          data_vencimento: vencimento,
          valor_original: valorOriginal,
          cambio,
          valor_final: valorBrl,
          valor_brl: valorBrl,
          parcela_numero: i + 1,
          total_parcelas: total,
        };
        await saveEntity('contas-pagar', nova);
      }

      setShowForm(false);
      setEditId(null);
      if (total > 1) {
        const primeiroVenc = form.data_vencimento;
        const ultimoVenc = avancarData(form.data_vencimento, form.recorrencia_periodo, total - 1);
        toast.success(`${total} parcelas criadas`, `Vencimentos de ${primeiroVenc.split('-').reverse().join('/')} a ${ultimoVenc.split('-').reverse().join('/')}`);
      } else {
        toast.success('Conta criada', `${form.fornecedor_nome} · ${formatBRL(valorBrl)}`);
      }
      load();
    } finally {
      setSaving(false);
    }
  }

  function salvarFormulario() {
    setTentouSalvar(true);
    void handleSave();
  }

  function abrirModalPagar(item: ContaPagar) {
    setShowForm(false);
    setShowCopyModal(false);
    setPagarModal({
      item,
      dataPagamento: hojeISO(),
      // default = saldo ainda devido (não o valor cheio), pra baixa de conta PARCIAL
      valorPago: saldoDevedor(item),
      observacao: '',
    });
  }

  async function confirmarPagamento() {
    if (!pagarModal || pagando) return;
    const { item, dataPagamento, valorPago, observacao } = pagarModal;
    const pagoAgora = round2(num(valorPago));
    if (pagoAgora <= 0) { toast.error('Valor pago deve ser maior que zero'); return; }

    const devido = valorBRLDaConta(item);
    // Baixa parcial ACUMULA sobre o que já foi pago antes, nunca substitui,
    // senão o restante da dívida some do sistema.
    const acumulado = round2(num(item.valor_pago) + pagoAgora);
    const restante = round2(devido - acumulado);
    const quitado = restante <= 0.005;

    setPagando(true);
    try {
      const updated: ContaPagar = {
        ...item,
        status: quitado ? 'PAGO' : 'PARCIAL',
        data_pagamento: dataPagamento,
        valor_pago: acumulado,
        observacoes: observacao ? `${item.observacoes ? item.observacoes + ' · ' : ''}${observacao}` : item.observacoes,
      };
      await updateEntity('contas-pagar', updated);
      setPagarModal(null);
      if (quitado) {
        toast.success('Pagamento confirmado', `${item.fornecedor_nome} · ${formatBRL(pagoAgora)}`);
      } else {
        toast.success('Pagamento em parte registrado', `${item.fornecedor_nome} · pago ${formatBRL(pagoAgora)} · saldo ${formatBRL(restante)}`);
      }
      load();
    } finally {
      setPagando(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluindo || removendo) return;
    const item = excluindo;
    setRemovendo(true);
    try {
      await deleteEntity('contas-pagar', item.id);
      setExcluindo(null);
      toast.success('Conta removida', item.fornecedor_nome || '');
      load();
    } finally {
      setRemovendo(false);
    }
  }

  // Monthly copy workflow
  function openCopyModal() {
    const currentMonth = mesDe(hojeISO());
    setCopySourceMonth(currentMonth);
    setCopyTargetMonth(addMonth(currentMonth));
    setShowForm(false);
    setShowCopyModal(true);
  }

  // Contas elegíveis para cópia do mês origem (manuais, recorrentes, não canceladas).
  const itensCopiaveis = items.filter(
    i => mesDe(i.data_vencimento) === copySourceMonth && podeCopiarParaOutroMes(i)
  );

  async function handleCopyMonth() {
    if (!copySourceMonth || !copyTargetMonth || copying) return;
    setCopying(true);
    try {
      const [anoDestino, mesDestino] = copyTargetMonth.split('-').map(Number);

      for (const item of itensCopiaveis) {
        // Mesmo dia no mês destino, com clamp: dia 31 em fevereiro vira 28/29
        // (antes fabricava 2026-02-31, data inexistente que sumia dos filtros).
        const dia = Number(item.data_vencimento.slice(8, 10)) || 1;
        const newDueDate = dataSegura(anoDestino, mesDestino, dia);
        const valorBrl = valorBRLDaConta(item);

        const nova: ContaPagar = {
          ...createContaPagar(),
          origem: item.origem,
          fornecedor_id: item.fornecedor_id,
          fornecedor_nome: item.fornecedor_nome,
          descricao: item.descricao,
          categoria_id: item.categoria_id,
          centro_custo: item.centro_custo,
          valor_original: round2(num(item.valor_original)),
          valor_final: valorBrl,
          moeda: item.moeda,
          cambio: item.cambio,
          valor_brl: valorBrl,
          data_vencimento: newDueDate,
          forma_pagamento: item.forma_pagamento,
          natureza_custo: item.natureza_custo,
          is_custo_comercial: item.is_custo_comercial,
          observacoes: `Copiado de ${getMonthLabel(copySourceMonth)}`,
        };
        await saveEntity('contas-pagar', nova);
      }

      setShowCopyModal(false);
      toast.success(
        `${itensCopiaveis.length} conta(s) copiada(s)`,
        `${getMonthLabel(copySourceMonth)} para ${getMonthLabel(copyTargetMonth)}`
      );
      load();
    } finally {
      setCopying(false);
    }
  }

  // Get unique months from data for the copy modal
  const availableMonths = [...new Set(items.map(i => mesDe(i.data_vencimento)).filter(Boolean))].sort();

  // Resolve período pré-definido em range concreto de datas (sobrescreve
  // filterDateFrom/To quando o usuário usa um atalho).
  const hoje = hojeISO();
  const periodoRange = (() => {
    const [ano, mes] = hoje.split('-').map(Number);
    if (filterPeriodo === 'MES_ATUAL') {
      return { de: dataSegura(ano, mes, 1), ate: dataSegura(ano, mes, 31) };
    }
    if (filterPeriodo === 'PROX_30D') {
      return { de: hoje, ate: addDias(hoje, 30) };
    }
    if (filterPeriodo === 'PROX_90D') {
      return { de: hoje, ate: addDias(hoje, 90) };
    }
    if (filterPeriodo === 'VENCIDOS') {
      // Vencido é DATA (vencimento < hoje) em conta aberta, não o status literal.
      return { de: '', ate: '', somenteVencidos: true };
    }
    if (filterPeriodo === 'MES_PASSADO') {
      const ini = addMeses(dataSegura(ano, mes, 1), -1);
      const [anoP, mesP] = ini.split('-').map(Number);
      return { de: ini, ate: dataSegura(anoP, mesP, 31) };
    }
    if (filterPeriodo === 'CUSTOM') return { de: filterDateFrom, ate: filterDateTo };
    return { de: '', ate: '' };
  })() as { de: string; ate: string; somenteVencidos?: boolean };

  // Aplica TODOS os filtros menos status, usado pelos KPIs (que somam
  // por status). A tabela aplica também o filterStatus por cima.
  const filteredBase = items.filter(i => {
    if (periodoRange.de || periodoRange.ate) {
      const dentro = dentroDoPeriodo(
        i.data_vencimento,
        periodoRange.de || '0000-01-01',
        periodoRange.ate || '9999-12-31',
      );
      if (!dentro) return false;
    }
    if (periodoRange.somenteVencidos && !ehVencidoEmAberto(i, hoje)) return false;
    if (filterCategoria !== 'TODAS' && i.categoria_id !== filterCategoria) return false;
    if (filterBusca) {
      const q = filterBusca.toLowerCase();
      const match = (i.fornecedor_nome || '').toLowerCase().includes(q)
        || (i.descricao || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const filtered = filteredBase.filter(i => {
    if (filterStatus === 'TODOS') return true;
    if (filterStatus === 'ABERTO') return i.status === 'PENDENTE' || i.status === 'PARCIAL';
    return i.status === filterStatus;
  });

  // KPIs RESPEITAM o filtro do período/categoria/busca: só não filtram
  // por status (cada KPI corresponde a um status). Tudo em BRL e por somaPor.
  // Conta PARCIAL entra na pendência pelo SALDO (valor devido - já pago).
  const totalPendente = somaPor(
    filteredBase.filter(i => i.status === 'PENDENTE' || i.status === 'PARCIAL'),
    saldoDevedor,
  );
  // Pago = contas quitadas (o card filtra por esse mesmo status, então o total
  // tem que bater com a lista). O que já foi pago numa conta PARCIAL aparece
  // como abatimento no card Pendente.
  const totalPago = somaPor(
    filteredBase.filter(i => i.status === 'PAGO'),
    i => (i.valor_pago !== null && i.valor_pago !== undefined ? num(i.valor_pago) : valorBRLDaConta(i)),
  );
  const totalVencido = somaPor(filteredBase.filter(i => ehVencidoEmAberto(i, hoje)), saldoDevedor);
  const totalComercial = somaPor(
    filteredBase.filter(i => i.is_custo_comercial && i.status !== 'CANCELADO'),
    valorBRLDaConta,
  );

  // Contagens só para o texto de contexto dos indicadores. Mesmos recortes.
  const qtdPendente = filteredBase.filter(i => i.status === 'PENDENTE' || i.status === 'PARCIAL').length;
  const qtdPago = filteredBase.filter(i => i.status === 'PAGO').length;
  const qtdVencido = filteredBase.filter(i => ehVencidoEmAberto(i, hoje)).length;
  const qtdComercial = filteredBase.filter(i => i.is_custo_comercial && i.status !== 'CANCELADO').length;

  // Soma do recorte inteiro que está na tela (não existe paginação nesta tela).
  const somaDoRecorte = somaPor(filtered, valorBRLDaConta);
  const somaCopiaveis = somaPor(itensCopiaveis, valorBRLDaConta);

  const filtrosAtivos =
    (filterPeriodo !== 'MES_ATUAL' ? 1 : 0) +
    (filterStatus !== 'TODOS' ? 1 : 0) +
    (filterCategoria !== 'TODAS' ? 1 : 0) +
    (filterBusca ? 1 : 0);

  const limparFiltros = () => {
    setFilterStatus('TODOS');
    setFilterPeriodo('MES_ATUAL');
    setFilterCategoria('TODAS');
    setFilterBusca('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  // Mostra todas as categorias de DESPESA (com ou sem subcódigo). Antes
  // filtrava só com '.' no código, então categorias customizadas como
  // "Aluguel" (sem código numérico) sumiam.
  const despesaContas = planoContas
    .filter(c => c.tipo === 'DESPESA')
    .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));

  const estadoDados: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erroCarga ? 'erro' : 'ok';
  const estadoValor: MoneyEstado = loading ? 'carregando' : erroCarga ? 'indisponivel' : 'ok';
  const escopo = ESCOPO_DO_PERIODO[filterPeriodo];

  // Espelho das validações de handleSave, só para mostrar o erro no campo.
  const erros: ErrosDoFormulario = tentouSalvar
    ? {
        fornecedor: form.fornecedor_nome.trim() ? null : 'Informe o fornecedor.',
        descricao: form.descricao.trim() ? null : 'Informe uma descrição.',
        vencimento: form.data_vencimento ? null : 'Informe a data de vencimento.',
        valor: form.valor_original > 0 ? null : 'O valor precisa ser maior que zero.',
        cambio:
          form.moeda !== 'BRL' && num(form.cambio) <= 0
            ? 'Informe o câmbio da moeda estrangeira.'
            : null,
      }
    : SEM_ERRO;

  const colunas = criarColunas({
    valorBRL: valorBRLDaConta,
    saldo: saldoDevedor,
    vencidaEmAberto: i => ehVencidoEmAberto(i, hoje),
    podePagar,
    onPagar: abrirModalPagar,
    onEditar: openEdit,
    onExcluir: item => setExcluindo(item),
  });

  const vazio: EmptyLessonProps =
    items.length === 0
      ? {
          motivo: 'sem-dado',
          titulo: 'Nenhuma conta a pagar lançada',
          oQueE:
            'Aqui ficam as contas que a agência precisa pagar: fornecedores, despesas fixas e custos de venda.',
          comoComeca: [
            'Lance a primeira conta com fornecedor, valor e vencimento.',
            'Marque a origem como despesa fixa para repetir todo mês.',
            'Registre o pagamento quando ele acontecer, para o caixa ficar certo.',
          ],
          acao: { rotulo: 'Lançar a primeira conta', onClick: openNew },
        }
      : {
          motivo: 'sem-resultado',
          titulo: 'Nenhuma conta neste recorte',
          oQueE: `A agência tem ${contasTexto(items.length)} lançadas, mas nenhuma se encaixa nos filtros atuais.`,
          acao: { rotulo: 'Limpar filtros', onClick: limparFiltros },
        };

  return (
    <PageShell width="full" padding="md" gap="md" className="max-w-[1280px]">
      <PageHeader
        titulo="Contas a pagar"
        subtitulo="O que a agência precisa pagar, com vencimento, saldo devedor e situação."
        acaoPrimaria={{ rotulo: 'Nova conta', icone: Plus, onClick: openNew }}
        acoesSecundarias={[{ rotulo: 'Copiar mês', onClick: openCopyModal }]}
      />

      <DataState
        estado={estadoDados}
        erro={{ mensagem: erroCarga ?? '', onTentarDeNovo: () => { void load(); } }}
        esqueleto={<EsqueletoIndicadores />}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            rotulo="Saldo a pagar"
            valor={totalPendente}
            estado={estadoValor}
            contexto={`Falta pagar em ${contasTexto(qtdPendente)} ${escopo}.`}
            explicacao="Saldo devedor das contas ainda não quitadas. Inclui o que falta das contas pagas em parte. Clique para filtrar a lista."
            ativo={filterStatus === 'ABERTO'}
            onClick={() => setFilterStatus(filterStatus === 'ABERTO' ? 'TODOS' : 'ABERTO')}
          />
          <MetricCard
            rotulo="Pago"
            valor={totalPago}
            estado={estadoValor}
            contexto={`Já quitado em ${contasTexto(qtdPago)} ${escopo}.`}
            explicacao="Contas já quitadas no recorte selecionado. É a saída real do caixa."
            ativo={filterStatus === 'PAGO'}
            onClick={() => setFilterStatus(filterStatus === 'PAGO' ? 'TODOS' : 'PAGO')}
          />
          <MetricCard
            rotulo="Vencido"
            valor={totalVencido}
            estado={estadoValor}
            emphasis="destaque"
            tone={totalVencido > 0 ? 'negativo' : 'neutro'}
            contexto={`Em aberto depois do vencimento, em ${contasTexto(qtdVencido)} ${escopo}.`}
            explicacao="Contas em aberto, inteiras ou pagas em parte, com vencimento anterior a hoje. Clique para ver só elas."
            ativo={filterPeriodo === 'VENCIDOS'}
            onClick={() => {
              // O cartão Vencido não filtra por status literal (VENCIDO nunca é
              // atribuído): ele liga o filtro por DATA de vencimento.
              setFilterStatus('TODOS');
              setFilterPeriodo(filterPeriodo === 'VENCIDOS' ? 'MES_ATUAL' : 'VENCIDOS');
            }}
          />
          <MetricCard
            rotulo="Custo para conseguir cliente"
            valor={totalComercial}
            estado={estadoValor}
            contexto={`Marketing e aquisição, em ${contasTexto(qtdComercial)} ${escopo}.`}
            explicacao="Contas de marketing, anúncios e aquisição de clientes, o que a contabilidade chama de CAC. Categoria 2.6 do plano de contas."
          />
        </div>
      </DataState>

      {estadoDados === 'ok' ? (
        <FilterBar
          busca={{
            valor: filterBusca,
            onChange: setFilterBusca,
            placeholder: 'Buscar por fornecedor ou descrição',
          }}
          periodo={{
            valor: FILTRO_PARA_PICKER[filterPeriodo],
            de: filterDateFrom,
            ate: filterDateTo,
            onChange: (chave: PeriodoChave, range: PeriodoRange) => {
              setFilterPeriodo(PICKER_PARA_FILTRO[chave]);
              if (chave === 'PERSONALIZADO') {
                setFilterDateFrom(range.de);
                setFilterDateTo(range.ate);
              }
            },
          }}
          selects={[
            {
              id: 'filtro-situacao',
              rotulo: 'Situação',
              valor: filterStatus,
              opcoes: OPCOES_STATUS,
              onChange: v => setFilterStatus(v as StatusContaPagar | 'TODOS' | 'ABERTO'),
            },
            {
              id: 'filtro-categoria',
              rotulo: 'Categoria',
              valor: filterCategoria,
              opcoes: [
                { valor: 'TODAS', rotulo: 'Todas as categorias' },
                ...despesaContas.map(c => ({ valor: c.id, rotulo: `${c.codigo} · ${c.nome}` })),
              ],
              onChange: setFilterCategoria,
            },
          ]}
          resumo={{
            exibidos: filtered.length,
            total: items.length,
            substantivo: 'contas a pagar',
            soma: somaDoRecorte,
            escopo: escopo,
          }}
          ativos={filtrosAtivos}
          onLimpar={limparFiltros}
        />
      ) : estadoDados === 'carregando' ? (
        <EsqueletoFiltros />
      ) : null}

      <FinTable<ContaPagar>
        linhas={filtered}
        colunas={colunas}
        chave={i => i.id}
        estado={estadoDados}
        erro={{ mensagem: erroCarga ?? '', onTentarDeNovo: () => { void load(); } }}
        vazio={vazio}
        totais={[{ colunaId: 'valor', valor: somaDoRecorte, rotulo: 'Total das contas listadas' }]}
      />

      <FormularioConta
        aberto={showForm}
        onOpenChange={aberto => { setShowForm(aberto); if (!aberto) setTentouSalvar(false); }}
        editando={Boolean(editId)}
        form={form}
        onForm={setForm}
        onCategoriaChange={onCategoriaChange}
        despesaContas={despesaContas}
        cartoes={cartoes}
        erros={erros}
        salvando={saving}
        onSalvar={salvarFormulario}
      />

      <PainelCopiarMes
        aberto={showCopyModal}
        onOpenChange={setShowCopyModal}
        mesOrigem={copySourceMonth}
        onMesOrigem={m => { setCopySourceMonth(m); setCopyTargetMonth(addMonth(m)); }}
        mesDestino={copyTargetMonth}
        onMesDestino={setCopyTargetMonth}
        mesesDisponiveis={availableMonths}
        rotuloMes={getMonthLabel}
        quantidade={itensCopiaveis.length}
        soma={somaCopiaveis}
        copiando={copying}
        onCopiar={() => { void handleCopyMonth(); }}
      />

      <DialogBaixa
        item={pagarModal?.item ?? null}
        dataPagamento={pagarModal?.dataPagamento ?? ''}
        valorPago={pagarModal?.valorPago ?? 0}
        observacao={pagarModal?.observacao ?? ''}
        onDataPagamento={v => setPagarModal(m => (m ? { ...m, dataPagamento: v } : m))}
        onValorPago={v => setPagarModal(m => (m ? { ...m, valorPago: v } : m))}
        onObservacao={v => setPagarModal(m => (m ? { ...m, observacao: v } : m))}
        valorDaConta={pagarModal ? valorBRLDaConta(pagarModal.item) : 0}
        jaPago={pagarModal ? num(pagarModal.item.valor_pago) : 0}
        saldoDevedor={pagarModal ? saldoDevedor(pagarModal.item) : 0}
        restanteDepois={
          pagarModal
            ? round2(saldoDevedor(pagarModal.item) - round2(num(pagarModal.valorPago)))
            : 0
        }
        pagando={pagando}
        onFechar={() => setPagarModal(null)}
        onConfirmar={() => { void confirmarPagamento(); }}
      />

      <ConfirmDialog
        aberto={Boolean(excluindo)}
        onOpenChange={aberto => { if (!aberto) setExcluindo(null); }}
        titulo="Excluir esta conta a pagar"
        oQueVaiAcontecer="A conta sai da lista e dos totais desta tela. Não dá para desfazer."
        detalhes={
          excluindo
            ? [
                { rotulo: 'Fornecedor', valor: excluindo.fornecedor_nome || 'Sem fornecedor' },
                { rotulo: 'Descrição', valor: excluindo.descricao || 'Sem descrição' },
                { rotulo: 'Situação', valor: rotuloStatus('pagar', excluindo.status) },
                {
                  rotulo: 'Valor',
                  valor: <Money valor={valorBRLDaConta(excluindo)} size="strong" estado="ok" />,
                },
              ]
            : undefined
        }
        confirmarRotulo="Excluir conta"
        tone="destrutivo"
        processando={removendo}
        onConfirmar={() => { void confirmarExclusao(); }}
      />
    </PageShell>
  );
}
