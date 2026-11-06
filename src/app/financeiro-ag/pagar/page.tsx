'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Plus, Target, TriangleAlert } from 'lucide-react';

import { ContaPagar, PlanoContas, createContaPagar, StatusContaPagar, CartaoCorporativo } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import { validarRateio } from '@/lib/dimensoes';
import { consumirAtalho, lerAtalhos } from '@/lib/atalho-da-url';
import {
  round2, num, somaPor, paraBRL,
  hojeISO, addDias, addMeses, dataSegura, estaVencido, mesDe, dentroDoPeriodo,
} from '@/lib/money';
import {
  formatarData, podeCopiarConta, previaDoFormulario, REPETICAO_PADRAO, rotuloDoMes, tituloGeradoPeloSistema, tituloSemBaixa,
} from '@/lib/recorrencia';
import {
  copiarMes, criarSerie, editarSerie, novoIdDeSerie, type EscopoDaEdicao, type RespostaCopiarMes, type SerieNaTela,
} from '@/lib/recorrencia-cliente';
import { EscopoDaSerie } from '@/components/financeiro/recorrencia/EscopoDaSerie';
import { FaixaDaSerie } from '@/components/financeiro/recorrencia/FaixaDaSerie';
import { MaisParcelas } from '@/components/financeiro/recorrencia/MaisParcelas';
import { cn, formatBRL } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

import { criarColunas, semFornecedor } from './colunas';
import { BaixaDePagar } from './BaixaDePagar';
import { HistoricoDeBaixas } from '@/components/fin/HistoricoDeBaixas';
import { saldoDevedor, valorBRLDaConta } from './valores';
import { FormularioConta } from './FormularioConta';
import { PainelCopiarMes } from './PainelCopiarMes';
import { EMPTY_FORM, SEM_ERRO, type ErrosDoFormulario, type FiltroPeriodo, type FormState } from './tipos';

/** "Jan/2026": o mesmo rótulo que a cópia de mês sempre gravou. */
const getMonthLabel = rotuloDoMes;

function addMonth(ym: string): string {
  return mesDe(addMeses(`${ym}-01`, 1));
}

/** Está em aberto (PENDENTE/PARCIAL/VENCIDO) com vencimento anterior a hoje. */
function ehVencidoEmAberto(i: ContaPagar, hoje: string): boolean {
  if (i.status !== 'PENDENTE' && i.status !== 'PARCIAL' && i.status !== 'VENCIDO') return false;
  return estaVencido(i.data_vencimento, hoje);
}

/**
 * Só entra na cópia de mês o que é lançamento MANUAL recorrente: o mesmo
 * critério de sempre (src/lib/recorrencia.ts, o servidor usa o mesmo) e,
 * desde 05/11/2026, fora também o que já se repete sozinho numa série.
 */
function podeCopiarParaOutroMes(i: ContaPagar): boolean {
  return podeCopiarConta('contas_pagar', i as unknown as Record<string, unknown>);
}

type ContaComSerie = ContaPagar & { serie_id?: string };

/** Campos que a tela edita e que a série sabe propagar. */
const CAMPOS_DA_SERIE = [
  'origem', 'fornecedor_nome', 'descricao', 'categoria_id', 'moeda', 'forma_pagamento',
  'natureza_custo', 'is_custo_comercial', 'observacoes',
  'centro_custo', 'centro_custo_id',
] as const;

/** O que mudou no formulário em relação à conta lida (só o que mudou vai para a série). */
function diferencasDaConta(
  existing: ContaPagar, form: FormState, valorOriginal: number, cambio: number, cartaoId: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of CAMPOS_DA_SERIE) {
    if ((form[c] ?? '') !== (existing[c] ?? '')) out[c] = form[c];
  }
  if (valorOriginal !== round2(num(existing.valor_original))) out.valor_original = valorOriginal;
  // Rateio e tags: compara o que importa (centro, categoria, percentual).
  const chaveRateio = (r: unknown) => JSON.stringify((Array.isArray(r) ? r : []).map((l: { centro_custo_id?: string; categoria_id?: string; percentual?: number }) =>
    [l.centro_custo_id ?? '', l.categoria_id ?? '', round2(num(l.percentual))]));
  if (chaveRateio(form.rateio) !== chaveRateio(existing.rateio)) out.rateio = form.rateio;
  if (JSON.stringify(form.tags ?? []) !== JSON.stringify(existing.tags ?? [])) out.tags = form.tags ?? [];
  if (cambio !== num(existing.cambio || 1)) out.cambio = cambio;
  if ((cartaoId ?? null) !== (existing.cartao_id ?? null)) out.cartao_id = cartaoId;
  if (form.data_vencimento !== existing.data_vencimento) out.data_vencimento = form.data_vencimento;
  return out;
}

type EdicaoPendente = { existing: ContaPagar; updated: ContaPagar; alteracoes: Record<string, unknown> };

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
          className="flex flex-col gap-3 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4 shadow-[var(--fin-e-card)]"
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
      className="flex min-h-12 flex-wrap items-center gap-2 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-3 shadow-[var(--fin-e-card)]"
    >
      <span className="block h-10 w-72 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
      <span className="block h-10 w-48 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
      <span className="block h-10 w-44 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
    </div>
  );
}

/** Campos do formulário que vão para o título (o bloco "Repetir" e a leitura do documento não vão). */
function camposDoTitulo(form: FormState): Omit<FormState, 'repeticao' | 'leitura'> {
  const { repeticao: _repeticao, leitura: _leitura, ...campos } = form;
  void _repeticao;
  void _leitura;
  return campos;
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
  // Recorte das contas que vieram do CRM sem dizer a quem pagar.
  const [filterSemFornecedor, setFilterSemFornecedor] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceMonth, setCopySourceMonth] = useState('');
  const [copyTargetMonth, setCopyTargetMonth] = useState('');
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [excluindo, setExcluindo] = useState<ContaPagar | null>(null);
  const [removendo, setRemovendo] = useState(false);
  // A conta cuja baixa está aberta. O diálogo e a regra vivem em BaixaDePagar,
  // o mesmo componente que a visão geral abre.
  const [contaAPagar, setContaAPagar] = useState<ContaPagar | null>(null);
  // Recorrência (05/11/2026): id da série gerado ao abrir o formulário (o
  // duplo clique reusa e o servidor não duplica), a série da conta em edição,
  // a pergunta de escopo e as mais parcelas.
  const serieNova = useRef(novoIdDeSerie());
  const [serieEditada, setSerieEditada] = useState<SerieNaTela | null>(null);
  const [edicaoPendente, setEdicaoPendente] = useState<EdicaoPendente | null>(null);
  const [gravandoEscopo, setGravandoEscopo] = useState(false);
  const [parcelasDe, setParcelasDe] = useState<ContaPagar | null>(null);
  const [previaCopia, setPreviaCopia] = useState<RespostaCopiarMes | null>(null);
  const abrirDepoisDeCarregar = useRef<string | null>(null);

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
      const alvo = abrirDepoisDeCarregar.current ? data.find(i => i.id === abrirDepoisDeCarregar.current) : null;
      abrirDepoisDeCarregar.current = null;
      if (alvo) { setFilterPeriodo('TODOS'); openEdit(alvo); }
    } catch {
      setErroCarga('A consulta ao servidor falhou. Nenhum dado foi alterado.');
    } finally {
      setLoading(false);
    }
  }

  // A visão geral chega aqui com ?nova=1 (lançar), ?status=VENCIDO ou
  // ?sem_fornecedor=1. Os dois filtros abrem em todo o período: o vencido de
  // um mês passado não pode ficar escondido atrás de "Este mês".
  function aplicarAtalhos() {
    const a = lerAtalhos();
    if (a.get('status') === 'VENCIDO') setFilterPeriodo('VENCIDOS');
    if (a.get('sem_fornecedor') === '1') { setFilterPeriodo('TODOS'); setFilterSemFornecedor(true); }
    if (a.get('nova') === '1') { consumirAtalho('nova'); openNew(); }
    // Vindo dos relatórios por categoria, centro ou rateio: abre a conta (05/11/2026).
    const abrir = a.get('abrir');
    if (abrir) { consumirAtalho('abrir'); abrirDepoisDeCarregar.current = abrir; }
  }

  // Uma vez, ao abrir a tela: o atalho do endereço não é um estado a seguir.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); aplicarAtalhos(); }, []);

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
    serieNova.current = novoIdDeSerie();
    setSerieEditada(null);
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
      cambio_carimbo: (item as ContaPagar & { cambio_carimbo?: FormState['cambio_carimbo'] }).cambio_carimbo ?? null,
      data_vencimento: item.data_vencimento,
      forma_pagamento: item.forma_pagamento,
      cartao_id: item.cartao_id || '',
      natureza_custo: item.natureza_custo ?? null,
      is_custo_comercial: item.is_custo_comercial ?? false,
      observacoes: item.observacoes,
      centro_custo_id: item.centro_custo_id ?? '',
      centro_custo: item.centro_custo ?? '',
      rateio: Array.isArray(item.rateio) ? item.rateio : [],
      tags: Array.isArray(item.tags) ? item.tags : [],
      repeticao: REPETICAO_PADRAO,
      fornecedor_id: item.fornecedor_id ?? '',
      fornecedor_cnpj: item.fornecedor_cnpj ?? '',
      numero_documento: item.numero_documento ?? '',
      linha_digitavel: item.linha_digitavel ?? '',
      chave_pix: item.chave_pix ?? '',
      anexos: Array.isArray(item.anexos) ? item.anexos : [],
      leitura: null,
    });
    setSerieEditada(null);
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
    // Rateio preenchido fecha 100% e os centavos do valor em reais (05/11/2026).
    const rateioConferido = validarRateio(valorBrl, form.rateio);
    if (!rateioConferido.ok) { toast.error(rateioConferido.erro); return; }
    const rateioFinal = rateioConferido.linhas;

    setSaving(true);
    try {
      if (editId) {
        const existing = items.find(i => i.id === editId)!;
        const updated: ContaPagar = {
          ...existing,
          ...camposDoTitulo(form),
          // Preencher o fornecedor à mão resolve a pendência que veio do CRM.
          // A validação acima já garante que o nome não está em branco.
          fornecedor_pendente: false,
          cartao_id: cartaoIdFinal,
          rateio: rateioFinal,
          valor_original: valorOriginal,
          cambio,
          valor_final: valorBrl,
          valor_brl: valorBrl,
        };
        // Conta de uma série, ainda em aberto e sem baixa: pergunta se a
        // mudança vale só para ela, para as seguintes ou para todas.
        const serieId = (existing as ContaComSerie).serie_id;
        if (serieId && tituloSemBaixa('contas_pagar', existing as unknown as Record<string, unknown>)) {
          const alteracoes = diferencasDaConta(existing, form, valorOriginal, cambio, cartaoIdFinal);
          if (Object.keys(alteracoes).length > 0) {
            setEdicaoPendente({ existing, updated, alteracoes });
            return;
          }
        }
        await gravarSomenteEsta(existing, updated);
        return;
      }

      // Repetir: a série nasce no servidor, numa transação só (05/11/2026).
      const rep = form.repeticao;
      const previa = rep.ativa ? previaDoFormulario(rep, form.data_vencimento, Math.round(valorOriginal * 100), hojeISO()) : null;
      if (previa && 'erro' in previa) { toast.error(previa.erro); return; }
      if (previa && !(previa.total === 1 && previa.ocorrencias.length === 1)) {
        const r = await criarSerie({
          id: serieNova.current,
          tabela: 'contas_pagar',
          estado: rep,
          inicio: form.data_vencimento,
          valor: valorOriginal,
          // Linha digitável e número do documento são de UM boleto: não se repetem nas outras contas.
          modelo: { ...camposDoTitulo(form), linha_digitavel: '', numero_documento: '', cartao_id: cartaoIdFinal, rateio: rateioFinal, cambio },
        });
        setShowForm(false);
        setEditId(null);
        const primeira = r.titulos[0];
        const ultima = r.titulos[r.titulos.length - 1];
        const datas = primeira && ultima ? `Vencimentos de ${formatarData(primeira.vencimento)} a ${formatarData(ultima.vencimento)}` : '';
        if (r.ja_existia) toast.success('Essas contas já tinham sido criadas', datas);
        else toast.success(`${r.criados} ${rep.modo === 'parcelado' ? 'parcelas criadas' : r.criados === 1 ? 'conta criada' : 'contas criadas'}`, datas);
        load();
        return;
      }

      const nova: ContaPagar = {
        ...createContaPagar(),
        ...camposDoTitulo(form),
        cartao_id: cartaoIdFinal,
        rateio: rateioFinal,
        valor_original: valorOriginal,
        cambio,
        valor_final: valorBrl,
        valor_brl: valorBrl,
      };
      await saveEntity('contas-pagar', nova);
      setShowForm(false);
      setEditId(null);
      toast.success('Conta criada', `${form.fornecedor_nome} · ${formatBRL(valorBrl)}`);
      load();
    } catch (e) {
      toast.error('Não foi possível salvar', e instanceof Error ? e.message : '');
    } finally {
      setSaving(false);
    }
  }

  /** O caminho de sempre para editar uma conta (também o "Só esta"). */
  async function gravarSomenteEsta(existing: ContaPagar, updated: ContaPagar) {
    // O status que esta tela LEU: o servidor só desfaz uma baixa quando a
    // tela sabia que a conta estava baixada (senão é tela velha, 409).
    await updateEntity('contas-pagar', { ...updated, _status_lido: existing.status });
    setShowForm(false);
    setEditId(null);
    toast.success('Conta atualizada');
    load();
  }

  async function confirmarEscopo(escopo: EscopoDaEdicao) {
    if (!edicaoPendente || gravandoEscopo) return;
    const { existing, updated, alteracoes } = edicaoPendente;
    const serieId = (existing as ContaComSerie).serie_id!;
    setGravandoEscopo(true);
    try {
      if (escopo === 'so_esta') {
        await gravarSomenteEsta(existing, updated);
      } else {
        // Nas outras contas, a data nova vira "o dia do mês" (mensal/anual).
        // Em outra periodicidade, a data nova vale só para esta conta.
        const { data_vencimento: novaData, ...resto } = alteracoes;
        const freq = serieEditada?.serie.regra.frequencia;
        const porDia = typeof novaData === 'string' && (freq === 'MES' || freq === 'ANO');
        const r = await editarSerie(serieId, {
          escopo, titulo_id: existing.id, versao: serieEditada?.serie.versao,
          alteracoes: porDia ? { ...resto, dia_do_mes: Number(String(novaData).slice(8, 10)) } : resto,
        });
        if (typeof novaData === 'string' && !porDia) {
          await editarSerie(serieId, { escopo: 'so_esta', titulo_id: existing.id, alteracoes: { data_vencimento: novaData } });
        }
        setShowForm(false);
        setEditId(null);
        const n = r.alterados.length;
        toast.success(
          n === 1 ? '1 conta alterada' : `${n} contas alteradas`,
          r.intocados.length > 0
            ? `${r.intocados.length === 1 ? '1 conta já paga ficou' : `${r.intocados.length} contas já pagas ficaram`} como estava${r.intocados.length === 1 ? '' : 'm'}.`
            : '',
        );
        load();
      }
      setEdicaoPendente(null);
    } catch (e) {
      toast.error('Não foi possível salvar', e instanceof Error ? e.message : '');
    } finally {
      setGravandoEscopo(false);
    }
  }

  function salvarFormulario() {
    setTentouSalvar(true);
    void handleSave();
  }

  function abrirModalPagar(item: ContaPagar) {
    setShowForm(false);
    setShowCopyModal(false);
    setContaAPagar(item);
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
    } catch (e) {
      // A conta continua na tela de propósito: dizer "removida" e recarregar
      // com ela de volta é o que fazia parecer que a exclusão não pegava.
      toast.error('Não foi possível excluir', e instanceof Error ? e.message : '');
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

  // A cópia acontece no servidor (05/11/2026), com a chave copia:<mês>:<conta>
  // que impede copiar a mesma conta para o mesmo mês duas vezes.
  async function handleCopyMonth() {
    if (!copySourceMonth || !copyTargetMonth || copying) return;
    setCopying(true);
    try {
      const r = await copiarMes({ tabela: 'contas_pagar', mes_origem: copySourceMonth, mes_destino: copyTargetMonth, previa: false });
      setShowCopyModal(false);
      toast.success(
        `${r.copiadas} conta(s) copiada(s)`,
        `${getMonthLabel(copySourceMonth)} para ${getMonthLabel(copyTargetMonth)}${r.ja_copiadas > 0 ? `. ${r.ja_copiadas} já tinha(m) sido copiada(s) antes.` : ''}`,
      );
      load();
    } catch (e) {
      toast.error('Não foi possível copiar', e instanceof Error ? e.message : '');
    } finally {
      setCopying(false);
    }
  }

  // Prévia do servidor para o painel: já desconta o que foi copiado antes.
  useEffect(() => {
    if (!showCopyModal || !copySourceMonth || !copyTargetMonth || copySourceMonth === copyTargetMonth) {
      setPreviaCopia(null);
      return;
    }
    let vivo = true;
    copiarMes({ tabela: 'contas_pagar', mes_origem: copySourceMonth, mes_destino: copyTargetMonth, previa: true })
      .then(r => { if (vivo) setPreviaCopia(r); })
      .catch(() => { if (vivo) setPreviaCopia(null); });
    return () => { vivo = false; };
  }, [showCopyModal, copySourceMonth, copyTargetMonth]);

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
    if (filterSemFornecedor && !semFornecedor(i)) return false;
    if (filterStatus === 'TODOS') return true;
    if (filterStatus === 'ABERTO') return i.status === 'PENDENTE' || i.status === 'PARCIAL';
    return i.status === filterStatus;
  });

  // Contas sem fornecedor: o custo veio do CRM, o nome de quem recebe não.
  // Só as em aberto interessam — conta já paga teve o dono resolvido fora.
  const semFornecedorLista = filteredBase.filter(
    i => semFornecedor(i) && (i.status === 'PENDENTE' || i.status === 'PARCIAL'),
  );
  const totalSemFornecedor = somaPor(semFornecedorLista, saldoDevedor);

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
    (filterBusca ? 1 : 0) +
    (filterSemFornecedor ? 1 : 0);

  const limparFiltros = () => {
    setFilterSemFornecedor(false);
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
        empresas
        icone={ArrowUpRight}
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
            rotulo="Saldo a pagar" icone={ArrowUpRight}
            valor={totalPendente}
            estado={estadoValor}
            contexto={`Falta pagar em ${contasTexto(qtdPendente)} ${escopo}.`}
            explicacao="Saldo devedor das contas ainda não quitadas. Inclui o que falta das contas pagas em parte. Clique para filtrar a lista."
            ativo={filterStatus === 'ABERTO'}
            onClick={() => setFilterStatus(filterStatus === 'ABERTO' ? 'TODOS' : 'ABERTO')}
          />
          <MetricCard
            rotulo="Pago" icone={ArrowUpRight}
            valor={totalPago}
            estado={estadoValor}
            contexto={`Já quitado em ${contasTexto(qtdPago)} ${escopo}.`}
            explicacao="Contas já quitadas no recorte selecionado. É a saída real do caixa."
            ativo={filterStatus === 'PAGO'}
            onClick={() => setFilterStatus(filterStatus === 'PAGO' ? 'TODOS' : 'PAGO')}
          />
          <MetricCard
            rotulo="Vencido" icone={TriangleAlert}
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
            rotulo="Custo para conseguir cliente" icone={Target}
            valor={totalComercial}
            estado={estadoValor}
            contexto={`Marketing e aquisição, em ${contasTexto(qtdComercial)} ${escopo}.`}
            explicacao="Contas de marketing, anúncios e aquisição de clientes, o que a contabilidade chama de CAC. Categoria 2.6 do plano de contas."
          />
        </div>
      </DataState>

      {/* Custo que chegou do CRM sem fornecedor. A dívida é real e está nos
          totais; o que falta é dizer a quem pagar, editando a conta. */}
      {estadoDados === 'ok' && semFornecedorLista.length > 0 ? (
        <div
          className={cn(
            'flex flex-col gap-3 rounded-[var(--fin-r-lg)] border border-[var(--fin-warning)]',
            'bg-[var(--fin-warning-soft)] p-4 sm:flex-row sm:items-center sm:justify-between',
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <span className="fin-t-body-strong text-[var(--fin-warning-text)]">
              {semFornecedorLista.length === 1
                ? '1 conta sem fornecedor no CRM'
                : `${semFornecedorLista.length} contas sem fornecedor no CRM`}
            </span>
            <span className="fin-t-caption text-[var(--fin-text-2)]">
              O CRM enviou o custo da venda, mas não quem recebe. Some{' '}
              <Money valor={totalSemFornecedor} size="caption" align="esquerda" estado="ok" /> a pagar. Abra a conta e
              informe o fornecedor.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 border-[var(--fin-warning)] bg-[var(--fin-surface)] text-[var(--fin-warning-text)]"
            onClick={() => setFilterSemFornecedor(v => !v)}
          >
            {filterSemFornecedor ? 'Ver todas as contas' : 'Ver só essas'}
          </Button>
        </div>
      ) : null}

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
        extra={editId ? <HistoricoDeBaixas tabela="contas_pagar" tituloId={editId} onMudou={() => { void load(); }} /> : null}
        faixaDaSerie={(() => {
          const editada = editId ? (items.find(i => i.id === editId) as ContaComSerie | undefined) : undefined;
          if (!editada?.serie_id) return null;
          return (
            <FaixaDaSerie
              key={editada.serie_id}
              serieId={editada.serie_id}
              onSerie={setSerieEditada}
              onEncerrada={() => { setShowForm(false); setEditId(null); load(); }}
            />
          );
        })()}
        onMaisParcelas={(() => {
          const editada = editId ? items.find(i => i.id === editId) : undefined;
          if (!editada || editada.status === 'CANCELADO') return null;
          if (tituloGeradoPeloSistema('contas_pagar', editada as unknown as Record<string, unknown>)) return null;
          return () => { setShowForm(false); setParcelasDe(editada); };
        })()}
      />

      <EscopoDaSerie
        aberto={Boolean(edicaoPendente)}
        onOpenChange={a => { if (!a) setEdicaoPendente(null); }}
        regra={serieEditada?.serie.descricao_regra ?? null}
        avisoDeData={
          edicaoPendente && typeof edicaoPendente.alteracoes.data_vencimento === 'string'
            ? serieEditada?.serie.regra.frequencia === 'MES' || serieEditada?.serie.regra.frequencia === 'ANO'
              ? `Nas outras contas, o vencimento passa para o dia ${Number(String(edicaoPendente.alteracoes.data_vencimento).slice(8, 10))}.`
              : 'A data nova vale só para esta conta; as outras mantêm o vencimento.'
            : null
        }
        processando={gravandoEscopo}
        onConfirmar={escopo => { void confirmarEscopo(escopo); }}
      />

      <MaisParcelas
        titulo={parcelasDe ? { id: parcelasDe.id, descricao: parcelasDe.descricao, pessoa: parcelasDe.fornecedor_nome } : null}
        tabela="contas_pagar"
        onFechar={() => setParcelasDe(null)}
        onGeradas={() => { load(); }}
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
        quantidade={previaCopia ? previaCopia.quantidade : itensCopiaveis.length}
        soma={previaCopia ? previaCopia.soma : somaCopiaveis}
        jaCopiadas={previaCopia?.ja_copiadas ?? 0}
        copiando={copying}
        onCopiar={() => { void handleCopyMonth(); }}
      />

      <BaixaDePagar
        conta={contaAPagar}
        onFechar={() => setContaAPagar(null)}
        onRegistrada={() => { load(); }}
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
