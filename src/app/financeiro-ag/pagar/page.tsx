'use client';

import { useEffect, useState } from 'react';
import { ContaPagar, PlanoContas, NaturezaCusto, createContaPagar, StatusContaPagar, CartaoCorporativo } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plus, X, Check, Trash2, TrendingDown, Clock, AlertCircle, CreditCard,
  Copy, Target, Calendar, Search,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  round2, num, somaPor, paraBRL,
  hojeISO, dataLocal, addDias, addMeses, dataSegura, estaVencido, mesDe, dentroDoPeriodo,
} from '@/lib/money';
import { MetricExplainer } from '@/components/financeiro/MetricExplainer';
import { PageShell } from '@/components/PageShell';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_BADGE: Record<StatusContaPagar, string> = {
  PENDENTE: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  PAGO: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
  VENCIDO: 'bg-[var(--t-red-bg)] text-[var(--t-red)]',
  CANCELADO: 'bg-[var(--t-surface)] text-[var(--t-text-muted)]',
  PARCIAL: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
};

const NATUREZA_LABEL: Record<string, string> = {
  FIXO: 'Fixo',
  VARIAVEL: 'Variável',
  COMPRA_UNICA: 'Compra Única',
};

const NATUREZA_COLORS: Record<string, string> = {
  FIXO: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
  VARIAVEL: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  COMPRA_UNICA: 'bg-purple-500/10 text-purple-400',
};

type RecorrenciaPeriodo = 'MENSAL' | 'SEMANAL' | 'QUINZENAL';

type FormState = {
  origem: ContaPagar['origem'];
  fornecedor_nome: string;
  descricao: string;
  categoria_id: string;
  valor_original: number;
  moeda: ContaPagar['moeda'];
  cambio: number;
  data_vencimento: string;
  forma_pagamento: ContaPagar['forma_pagamento'];
  cartao_id: string;
  natureza_custo: NaturezaCusto | null;
  is_custo_comercial: boolean;
  observacoes: string;
  // Recorrência (só quando origem = DESPESA_FIXA)
  recorrencia_ativa: boolean;
  recorrencia_periodo: RecorrenciaPeriodo;
  recorrencia_repeticoes: number;
};

const EMPTY_FORM: FormState = {
  origem: 'OUTROS',
  fornecedor_nome: '',
  descricao: '',
  categoria_id: '',
  valor_original: 0,
  moeda: 'BRL',
  cambio: 1,
  data_vencimento: '',
  forma_pagamento: '',
  cartao_id: '',
  natureza_custo: null,
  is_custo_comercial: false,
  observacoes: '',
  recorrencia_ativa: false,
  recorrencia_periodo: 'MENSAL',
  recorrencia_repeticoes: 12,
};

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
 * `valor_final` é BRL por contrato (ver venda-financeiro.ts) — tanto nas contas
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

/** Quanto ainda falta pagar (em BRL) — conta PARCIAL mantém o saldo visível. */
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

export default function ContasPagarPage() {
  const [items, setItems] = useState<ContaPagar[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [cartoes, setCartoes] = useState<CartaoCorporativo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // 'ABERTO' é pseudo-status do card Pendente: PENDENTE + PARCIAL (tudo que
  // ainda tem saldo devedor), pra o total do card bater com a lista.
  const [filterStatus, setFilterStatus] = useState<StatusContaPagar | 'TODOS' | 'ABERTO'>('TODOS');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('TODAS');
  const [filterBusca, setFilterBusca] = useState('');
  const [filterPeriodo, setFilterPeriodo] = useState<'TODOS' | 'MES_ATUAL' | 'PROX_30D' | 'PROX_90D' | 'VENCIDOS' | 'MES_PASSADO' | 'CUSTOM'>('MES_ATUAL');
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceMonth, setCopySourceMonth] = useState('');
  const [copyTargetMonth, setCopyTargetMonth] = useState('');
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pagando, setPagando] = useState(false);

  async function load() {
    setLoading(true);
    const [data, contas, cards] = await Promise.all([
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<PlanoContas>('plano-contas'),
      loadEntities<CartaoCorporativo>('cartoes-corp'),
    ]);
    setItems(data);
    setPlanoContas(contas);
    setCartoes(cards);
    setLoading(false);
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
    // valor_final é SEMPRE em BRL — o resto do sistema soma esse campo como real.
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
        toast.success('Despesa atualizada');
        load();
        return;
      }

      // Quantas contas criar — 1 para única, N para recorrente.
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
        toast.success('Despesa criada', `${form.fornecedor_nome} · ${BRL(valorBrl)}`);
      }
      load();
    } finally {
      setSaving(false);
    }
  }

  // Estado do modal de confirmação de pagamento
  const [pagarModal, setPagarModal] = useState<{
    item: ContaPagar;
    dataPagamento: string;
    valorPago: number;
    observacao: string;
  } | null>(null);

  function abrirModalPagar(item: ContaPagar) {
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
    // Baixa parcial ACUMULA sobre o que já foi pago antes — nunca substitui,
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
        toast.success('Pagamento confirmado', `${item.fornecedor_nome} · ${BRL(pagoAgora)}`);
      } else {
        toast.success('Baixa parcial registrada', `${item.fornecedor_nome} · pago ${BRL(pagoAgora)} · saldo ${BRL(restante)}`);
      }
      load();
    } finally {
      setPagando(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Confirmar exclusão?')) return;
    const item = items.find(i => i.id === id);
    await deleteEntity('contas-pagar', id);
    toast.success('Despesa removida', item?.fornecedor_nome || '');
    load();
  }

  // Monthly copy workflow
  function openCopyModal() {
    const currentMonth = mesDe(hojeISO());
    setCopySourceMonth(currentMonth);
    setCopyTargetMonth(addMonth(currentMonth));
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
        `${itensCopiaveis.length} despesa(s) copiada(s)`,
        `${getMonthLabel(copySourceMonth)} → ${getMonthLabel(copyTargetMonth)}`
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

  // Aplica TODOS os filtros menos status — usado pelos KPIs (que somam
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

  // KPIs RESPEITAM o filtro do período/categoria/busca — só não filtram
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

  const STATUSES: Array<StatusContaPagar | 'TODOS'> = ['TODOS', 'PENDENTE', 'PAGO', 'VENCIDO', 'CANCELADO', 'PARCIAL'];
  // Mostra todas as categorias de DESPESA (com ou sem subcódigo). Antes
  // filtrava só com '.' no código, então categorias customizadas como
  // "Aluguel" (sem código numérico) sumiam.
  const despesaContas = planoContas.filter(c => c.tipo === 'DESPESA');

  const columns: DataTableColumn<ContaPagar>[] = [
    {
      key: 'fornecedor',
      header: 'Fornecedor',
      sortable: true,
      sortAccessor: i => i.fornecedor_nome || '',
      cell: i => <span className="font-medium text-[var(--t-text)]">{i.fornecedor_nome || '—'}</span>,
    },
    {
      key: 'descricao',
      header: 'Descrição',
      cell: i => (
        <div className="flex items-center gap-2 text-[var(--t-text-secondary)] max-w-xs truncate">
          <span>{i.descricao}</span>
          {i.is_custo_comercial && (
            <span title="Custo Comercial (CAC)">
              <Target className="w-3 h-3 text-[var(--t-amber)] shrink-0" />
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'referente',
      header: 'Referente a',
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
      cell: i => {
        const isAuto = (i as ContaPagar).auto_gerado;
        if (isAuto && i.origem === 'VENDA') return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">Venda (auto)</Badge>;
        if (i.origem === 'VENDA') return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">Venda</Badge>;
        if (i.origem === 'GRUPO') return <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-[10px]">Produto</Badge>;
        return <span className="text-[var(--t-text-muted)] text-xs">{i.origem || '—'}</span>;
      },
    },
    {
      key: 'valor',
      header: 'Valor',
      align: 'right',
      sortable: true,
      sortAccessor: i => valorBRLDaConta(i),
      cell: i => (
        <div className="flex flex-col items-end">
          <span className="font-mono text-[var(--t-text)]">{BRL(valorBRLDaConta(i))}</span>
          {i.moeda !== 'BRL' && (
            <span className="text-[10px] text-[var(--t-text-muted)]">
              {i.moeda} {num(i.valor_original).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          )}
          {i.status === 'PARCIAL' && (
            <span className="text-[10px] text-[var(--t-blue)]">
              pago {BRL(num(i.valor_pago))} · saldo {BRL(saldoDevedor(i))}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'natureza',
      header: 'Natureza',
      cell: i =>
        i.natureza_custo ? (
          <Badge className={`${NATUREZA_COLORS[i.natureza_custo]} border-0 text-[10px]`}>
            {NATUREZA_LABEL[i.natureza_custo]}
          </Badge>
        ) : (
          <span className="text-[var(--t-text-muted)] text-xs">—</span>
        ),
    },
    {
      key: 'vencimento',
      header: 'Vencimento',
      sortable: true,
      sortAccessor: i => i.data_vencimento || '',
      cell: i => (
        <span className="text-[var(--t-text-secondary)]">
          {dataLocal(i.data_vencimento)?.toLocaleDateString('pt-BR') ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: i => (
        <Badge className={`${STATUS_BADGE[i.status]} border-0 text-xs`}>{i.status}</Badge>
      ),
    },
    {
      key: 'acoes',
      header: 'Ações',
      align: 'right',
      cell: i => (
        <div className="flex items-center justify-end gap-2">
          {(i.status === 'PENDENTE' || i.status === 'VENCIDO' || i.status === 'PARCIAL') && (
            <Button
              size="sm"
              onClick={() => abrirModalPagar(i)}
              className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] h-7 px-3 text-xs"
            >
              <Check className="w-3 h-3 mr-1" /> Pagar
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => openEdit(i)}
            className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] h-7 px-3 text-xs"
          >
            Editar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDelete(i.id)}
            className="border-[var(--t-red)]/30 text-[var(--t-red)] hover:bg-[var(--t-red-bg)] h-7 px-2"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell>
        <MinimalPageHead
          title="Contas a pagar"
          meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Gestão de obrigações financeiras da agência</p>}
          actions={
            <>
              <button
                onClick={openCopyModal}
                className="h-[34px] px-3 text-[12px] border transition-colors hover:bg-[var(--ink-surface-2)]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
              >
                <Copy className="w-3.5 h-3.5 inline mr-2" /> Copiar mês
              </button>
              <button
                onClick={openNew}
                className="h-[34px] px-3 text-[12px] font-medium"
                style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
              >
                <Plus className="w-3.5 h-3.5 inline mr-2" /> Nova conta
              </button>
            </>
          }
        />

        {/* Summary Cards — clicáveis, refletem o período/filtros ativos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { key: 'PENDENTE' as const, label: 'Pendente', icon: Clock, color: 'text-[var(--t-amber)]', value: totalPendente, hint: 'Saldo ainda em aberto', explainer: 'Saldo devedor das despesas ainda não quitadas — inclui o que falta das contas com baixa parcial. Clique no card para filtrar a lista.' },
            { key: 'PAGO' as const, label: 'Pago', icon: TrendingDown, color: 'text-[var(--t-green)]', value: totalPago, hint: 'Já quitado', explainer: 'Despesas já quitadas neste período. Saídas reais do caixa.' },
            { key: 'VENCIDO' as const, label: 'Vencido', icon: AlertCircle, color: 'text-[var(--t-red)]', value: totalVencido, hint: 'Em aberto após o vencimento', explainer: 'Despesas em aberto (pendentes ou parciais) com vencimento anterior a hoje. Clique para filtrar por data de vencimento.' },
            { key: 'COMERCIAL' as const, label: 'Custo Comercial', icon: Target, color: 'text-[var(--t-blue)]', value: totalComercial, hint: 'Marketing, CAC', explainer: 'Despesas relacionadas a marketing, anúncios e aquisição de clientes (CAC). Categoria 2.6 do plano de contas.' },
          ].map(card => {
            // O card Vencido não filtra por status literal (VENCIDO nunca é
            // atribuído) — ele liga o filtro por DATA de vencimento.
            const ativo =
              card.key === 'PENDENTE' ? filterStatus === 'ABERTO'
              : card.key === 'PAGO' ? filterStatus === 'PAGO'
              : card.key === 'VENCIDO' ? filterPeriodo === 'VENCIDOS'
              : false;
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => {
                  if (card.key === 'COMERCIAL') return;
                  if (card.key === 'VENCIDO') {
                    setFilterStatus('TODOS');
                    setFilterPeriodo(filterPeriodo === 'VENCIDOS' ? 'MES_ATUAL' : 'VENCIDOS');
                    return;
                  }
                  const alvo = card.key === 'PENDENTE' ? 'ABERTO' : 'PAGO';
                  setFilterStatus(filterStatus === alvo ? 'TODOS' : alvo);
                }}
                disabled={card.key === 'COMERCIAL'}
                className={`text-left rounded-[var(--t-card-radius)] bg-[var(--t-surface)] p-4 border transition-all ${
                  ativo ? 'border-[var(--t-green)] shadow-[0_0_0_3px_var(--t-green-shadow)]' : 'border-[var(--t-border)] hover:border-[var(--t-text-muted)]'
                } ${card.key === 'COMERCIAL' ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-7 h-7 shrink-0 ${card.color}`} />
                  <div className="min-w-0">
                    <p className="text-[var(--t-text-muted)] text-[10px] uppercase tracking-wide flex items-center">
                      {card.label}
                      <span onClick={e => e.stopPropagation()}>
                        <MetricExplainer title={card.label} text={card.explainer} size={11} />
                      </span>
                    </p>
                    <p className={`text-xl font-bold ${card.color}`}>{BRL(card.value)}</p>
                    <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">{card.hint}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Copy Month Modal */}
        {showCopyModal && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Copiar Despesas do Mês
              </CardTitle>
              <button onClick={() => setShowCopyModal(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <p className="text-[var(--t-text-secondary)] text-sm mb-4">
                Copia as despesas fixas e variáveis lançadas manualmente de um mês para o seguinte.
                Ignora compras únicas, contas canceladas e custos gerados automaticamente por vendas/grupos
                (esses nascem da própria venda). Os valores são mantidos e o status volta para PENDENTE.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Mês Origem</label>
                  <select
                    value={copySourceMonth}
                    onChange={e => {
                      setCopySourceMonth(e.target.value);
                      setCopyTargetMonth(addMonth(e.target.value));
                    }}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    {availableMonths.map(m => (
                      <option key={m} value={m}>{getMonthLabel(m)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Mês Destino</label>
                  <Input
                    type="month"
                    value={copyTargetMonth}
                    onChange={e => setCopyTargetMonth(e.target.value)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
              </div>
              {copySourceMonth && (
                <p className="text-xs text-[var(--t-text-muted)] mt-2">
                  {itensCopiaveis.length} despesas serão copiadas · {BRL(somaPor(itensCopiaveis, valorBRLDaConta))}
                </p>
              )}
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleCopyMonth}
                  disabled={copying || !copySourceMonth || !copyTargetMonth}
                  className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold"
                >
                  <Copy className="w-4 h-4 mr-1" /> {copying ? 'Copiando...' : 'Copiar Despesas'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowCopyModal(false)}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Inline Form */}
        {showForm && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base">
                {editId ? 'Editar Conta' : 'Nova Conta a Pagar'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Origem</label>
                  <select
                    value={form.origem}
                    onChange={e => setForm(f => ({ ...f, origem: e.target.value as ContaPagar['origem'] }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="VENDA">Venda</option>
                    <option value="GRUPO">Grupo</option>
                    <option value="DESPESA_FIXA">Despesa Fixa</option>
                    <option value="OUTROS">Outros</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Fornecedor *</label>
                  <Input
                    value={form.fornecedor_nome}
                    onChange={e => setForm(f => ({ ...f, fornecedor_nome: e.target.value }))}
                    placeholder="Nome do fornecedor"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Descrição *</label>
                  <Input
                    value={form.descricao}
                    onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                    placeholder="Descrição"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Categoria (Plano de Contas)</label>
                  <select
                    value={form.categoria_id}
                    onChange={e => onCategoriaChange(e.target.value)}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="">Selecione</option>
                    {despesaContas.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })).map(c => (
                      <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Valor *</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.valor_original}
                    onChange={e => setForm(f => ({ ...f, valor_original: parseFloat(e.target.value) || 0 }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Moeda</label>
                  <select
                    value={form.moeda}
                    onChange={e => setForm(f => ({ ...f, moeda: e.target.value as ContaPagar['moeda'] }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Câmbio</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={form.cambio}
                    onChange={e => setForm(f => ({ ...f, cambio: parseFloat(e.target.value) || 1 }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Vencimento *</label>
                  <Input
                    type="date"
                    value={form.data_vencimento}
                    onChange={e => setForm(f => ({ ...f, data_vencimento: e.target.value }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Forma de Pagamento</label>
                  <select
                    value={form.forma_pagamento}
                    onChange={e => setForm(f => ({ ...f, forma_pagamento: e.target.value as ContaPagar['forma_pagamento'] }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="">Selecione</option>
                    <option value="PIX">PIX</option>
                    <option value="TED">TED</option>
                    <option value="CARTAO_CORP">Cartão Corporativo</option>
                    <option value="BOLETO">Boleto</option>
                    <option value="DEPOSITO">Depósito</option>
                  </select>
                </div>
                {form.forma_pagamento === 'CARTAO_CORP' && (
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Cartão usado</label>
                    {cartoes.filter(c => c.ativo).length === 0 ? (
                      <div className="text-xs text-[var(--t-text-muted)] py-2">
                        Nenhum cartão ativo. <a href="/financeiro-ag/cartoes" className="text-[var(--t-accent)] underline">Cadastrar</a>
                      </div>
                    ) : (
                      <select
                        value={form.cartao_id}
                        onChange={e => setForm(f => ({ ...f, cartao_id: e.target.value }))}
                        className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                      >
                        <option value="">Selecione o cartão</option>
                        {cartoes.filter(c => c.ativo).map(c => (
                          <option key={c.id} value={c.id}>
                            {c.apelido}{c.ultimos_digitos ? ` •••• ${c.ultimos_digitos}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Classification fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)]">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Natureza do Custo</label>
                  <select
                    value={form.natureza_custo || ''}
                    onChange={e => setForm(f => ({ ...f, natureza_custo: (e.target.value || null) as NaturezaCusto | null }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="">Não classificado</option>
                    <option value="FIXO">Fixo</option>
                    <option value="VARIAVEL">Variável</option>
                    <option value="COMPRA_UNICA">Compra Única</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_custo_comercial}
                      onChange={e => setForm(f => ({ ...f, is_custo_comercial: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[var(--t-border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--t-green)]"></div>
                  </label>
                  <div>
                    <span className="text-sm text-[var(--t-text)]">Custo Comercial</span>
                    <p className="text-xs text-[var(--t-text-muted)]">Incluir no cálculo do CAC</p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Observações</label>
                <Input
                  value={form.observacoes}
                  onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                  placeholder="Observações"
                  className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                />
              </div>

              {/* Recorrência — aparece apenas se Origem = DESPESA_FIXA e for criação (não edição) */}
              {form.origem === 'DESPESA_FIXA' && !editId && (
                <div className="mt-4 p-4 rounded-lg border border-[var(--t-blue)]/30 bg-[var(--t-blue-bg)]/20">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.recorrencia_ativa}
                      onChange={e => setForm(f => ({ ...f, recorrencia_ativa: e.target.checked }))}
                      className="accent-[var(--t-blue)]"
                    />
                    <span className="text-sm font-medium text-[var(--t-text)]">Repetir esta despesa automaticamente</span>
                  </label>
                  {form.recorrencia_ativa && (
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Periodicidade</label>
                        <select
                          value={form.recorrencia_periodo}
                          onChange={e => setForm(f => ({ ...f, recorrencia_periodo: e.target.value as RecorrenciaPeriodo }))}
                          className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                        >
                          <option value="MENSAL">Mensal (todo mês no mesmo dia)</option>
                          <option value="QUINZENAL">Quinzenal (a cada 14 dias)</option>
                          <option value="SEMANAL">Semanal (a cada 7 dias)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Quantidade de parcelas</label>
                        <Input
                          type="number"
                          min={1}
                          max={120}
                          value={form.recorrencia_repeticoes}
                          onChange={e => setForm(f => ({ ...f, recorrencia_repeticoes: Math.max(1, parseInt(e.target.value) || 1) }))}
                          className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        />
                      </div>
                      <p className="col-span-2 text-[11px] text-[var(--t-text-secondary)] mt-1">
                        Vão ser criadas <strong>{form.recorrencia_repeticoes} contas a pagar</strong> a partir de {form.data_vencimento || '(sem data)'},
                        com vencimento avançando {form.recorrencia_periodo === 'MENSAL' ? 'mês a mês' : form.recorrencia_periodo === 'QUINZENAL' ? 'a cada 15 dias' : 'a cada 7 dias'}.
                        Cada parcela pode ser editada/paga individualmente.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {form.moeda !== 'BRL' && (
                <p className="text-sm text-[var(--t-text-secondary)] mt-2">
                  Valor BRL: <span className="text-[var(--t-text)] font-semibold">{BRL(paraBRL(form.valor_original, form.moeda, form.cambio))}</span>
                  <span className="text-[var(--t-text-muted)]"> · a conta é registrada em reais, mantendo {form.moeda} {num(form.valor_original).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} como valor original</span>
                </p>
              )}
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold disabled:opacity-60"
                >
                  <Check className="w-4 h-4 mr-1" /> {saving ? 'Salvando...' : editId ? 'Salvar' : 'Criar'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters — busca + chips de período + categoria + clear */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardContent className="p-4 space-y-3">
            {/* Linha 1: busca + categoria + limpar */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-[var(--t-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={filterBusca}
                  onChange={e => setFilterBusca(e.target.value)}
                  placeholder="Buscar por fornecedor ou descrição..."
                  className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] pl-9"
                />
              </div>
              <select
                value={filterCategoria}
                onChange={e => setFilterCategoria(e.target.value)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)] min-w-[180px]"
              >
                <option value="TODAS">Todas as categorias</option>
                {despesaContas.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })).map(c => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>
                ))}
              </select>
              {filtrosAtivos > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={limparFiltros}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                >
                  <X className="w-3 h-3 mr-1" /> Limpar filtros ({filtrosAtivos})
                </Button>
              )}
            </div>

            {/* Linha 2: chips de período rápido */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] mr-1">Período:</span>
              {[
                { key: 'MES_ATUAL', label: 'Este mês' },
                { key: 'PROX_30D', label: 'Próximos 30d' },
                { key: 'PROX_90D', label: 'Próximos 90d' },
                { key: 'VENCIDOS', label: 'Vencidos' },
                { key: 'MES_PASSADO', label: 'Mês passado' },
                { key: 'TODOS', label: 'Tudo' },
                { key: 'CUSTOM', label: 'Personalizado' },
              ].map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setFilterPeriodo(p.key as typeof filterPeriodo)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    filterPeriodo === p.key
                      ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14] font-medium'
                      : 'bg-[var(--t-bg)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Linha 3: date pickers (só quando CUSTOM) */}
            {filterPeriodo === 'CUSTOM' && (
              <div className="flex gap-3 items-end">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">De</label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={e => setFilterDateFrom(e.target.value)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Até</label>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={e => setFilterDateTo(e.target.value)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40"
                  />
                </div>
              </div>
            )}

            {/* Linha 4: chips de status */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] mr-1">Status:</span>
              {STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterStatus(s)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    filterStatus === s
                      ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14] font-medium'
                      : 'bg-[var(--t-bg)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border)]'
                  }`}
                >
                  {s === 'TODOS' ? 'Todos' : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[var(--t-green)]" />
              Lançamentos ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable<ContaPagar>
              columns={columns}
              data={filtered}
              loading={loading}
              rowKey={i => i.id}
              zebra
              emptyState={{
                icon: <CreditCard className="w-10 h-10 opacity-30" />,
                title: 'Nenhum lançamento encontrado',
                description: 'Ajuste os filtros ou cadastre uma nova conta a pagar.',
              }}
            />
          </CardContent>
        </Card>

      {/* Modal de confirmação de pagamento */}
      {pagarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setPagarModal(null)}>
          <div className="bg-[var(--t-surface)] rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--t-border)] flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--t-text)]">Confirmar pagamento</h3>
              <button onClick={() => setPagarModal(null)} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)]">
                <p className="text-[10px] uppercase text-[var(--t-text-muted)] tracking-wide">Despesa</p>
                <p className="text-sm font-medium text-[var(--t-text)]">{pagarModal.item.fornecedor_nome}</p>
                <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{pagarModal.item.descricao}</p>
                <div className="mt-2 pt-2 border-t border-[var(--t-border)] flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-[var(--t-text-secondary)]">
                    Valor: <span className="font-mono text-[var(--t-text)]">{BRL(valorBRLDaConta(pagarModal.item))}</span>
                  </span>
                  {num(pagarModal.item.valor_pago) > 0 && (
                    <span className="text-[var(--t-text-secondary)]">
                      Já pago: <span className="font-mono text-[var(--t-green)]">{BRL(num(pagarModal.item.valor_pago))}</span>
                    </span>
                  )}
                  <span className="text-[var(--t-text-secondary)]">
                    Saldo devedor: <span className="font-mono text-[var(--t-amber)]">{BRL(saldoDevedor(pagarModal.item))}</span>
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data do pagamento</label>
                  <Input
                    type="date"
                    value={pagarModal.dataPagamento}
                    onChange={e => setPagarModal({ ...pagarModal, dataPagamento: e.target.value })}
                    className="bg-[var(--t-input-bg)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Valor pago</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={pagarModal.valorPago}
                    onChange={e => setPagarModal({ ...pagarModal, valorPago: parseFloat(e.target.value) || 0 })}
                    className="bg-[var(--t-input-bg)]"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Observação (opcional)</label>
                <Input
                  value={pagarModal.observacao}
                  onChange={e => setPagarModal({ ...pagarModal, observacao: e.target.value })}
                  placeholder="Ex: pago via PIX"
                  className="bg-[var(--t-input-bg)]"
                />
              </div>
              {/* Baixa parcial: mostra o que continua devendo em vez de sumir com a dívida */}
              {round2(num(pagarModal.valorPago)) > 0 && round2(saldoDevedor(pagarModal.item) - round2(num(pagarModal.valorPago))) > 0.005 && (
                <p className="text-[11px] text-[var(--t-blue)] bg-[var(--t-blue-bg)] rounded px-2 py-1.5">
                  Baixa parcial: a conta fica com status PARCIAL e saldo devedor de{' '}
                  <strong>{BRL(round2(saldoDevedor(pagarModal.item) - round2(num(pagarModal.valorPago))))}</strong>.
                </p>
              )}
              <p className="text-[11px] text-[var(--t-text-muted)]">
                O saldo da Caixa Geral será atualizado automaticamente após confirmar.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--t-border)] flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPagarModal(null)}>Cancelar</Button>
              <Button
                onClick={confirmarPagamento}
                disabled={pagando}
                className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] disabled:opacity-60"
              >
                <Check className="w-4 h-4 mr-1" /> {pagando ? 'Confirmando...' : 'Confirmar pagamento'}
              </Button>
            </div>
          </div>
        </div>
      )}
      <MinimalFooter pageId="contas a pagar" />
    </PageShell>
  );
}
