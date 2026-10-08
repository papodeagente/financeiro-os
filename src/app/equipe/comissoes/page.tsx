'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ComissaoVenda, VendaCRM, Membro, PlanoComissao, StatusComissao,
  ContaReceber, ContaPagar, ItemVendaData, PlanoContas, ProdutoVenda,
  Agencia, createContaPagar,
} from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity, loadAgencia, loadEquipe } from '@/lib/crm-storage';
import { proximaDataPagamento, descreverAgenda } from '@/lib/comissao-agenda';
import { calcularComissaoDoMes, chaveAcumulado } from '@/lib/comissao-acumulada';
import {
  round2, num, somaPor, percentual, divSegura, paraBRL, hojeISO, dataLocal, mesDe,
} from '@/lib/money';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { DataState } from '@/components/fin/DataState';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Money } from '@/components/fin/Money';
import { StatusChip } from '@/components/fin/StatusChip';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Resposta } from '@/components/fin/Resposta';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { BarraDeParte, type Parte } from '@/components/fin/BarraDeParte';
import { EscadaDeFaixas } from '@/components/fin/EscadaDeFaixas';
import { posicaoNaEscala } from '@/lib/comissao-acumulada';
import { SeletorDeMes, rotuloDoMes, useMesDaUrl } from '@/components/fin/SeletorDeMes';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Callout } from '@/components/fin/Callout';
import { toast } from '@/lib/toast';
import {
  aprovarComissao, cancelarComissao, idDaContaDaComissao, pagarComissao, type PortasDaComissao,
} from '@/lib/comissao-conta-unica';
import { ehComissaoDoCrm, nomeDaCompetencia, recorteDoMotor } from '@/lib/comissao-do-crm';
import type { ContaDuplicada, ResumoDuplicadas } from '@/lib/comissao-duplicadas';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const dataBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const CAMPO =
  'h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-2 fin-t-body text-[var(--fin-text)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const BOTAO =
  'inline-flex h-11 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] ' +
  'bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] ' +
  'hover:text-[var(--fin-text)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';


/** Id determinístico da comissão: 1 comissão por (venda, vendedor).
 *  O POST do CRUD é upsert por id, então recalcular nunca duplica. */
function comissaoId(vendaId: string, vendedorId: string): string {
  return `comissao-${vendaId}-${vendedorId}`;
}

// A conta a pagar da comissão é UMA, `cp-comissao-<id>`, e quem a cria é o
// servidor, a cada gravação da comissão (src/lib/comissao-conta.ts). Esta
// tela criava uma segunda, `pagar-<id>`, ao aprovar e ao pagar: pagar
// baixava a dela e a do servidor ficava pendente para sempre, e o fluxo de
// caixa contava a comissão duas vezes. Ver src/lib/comissao-conta-unica.ts.

/** A conta a pagar como está no banco AGORA: o gancho do servidor acabou de gravá-la. */
async function lerContaPagar(id: string): Promise<ContaPagar | null> {
  const res = await fetch(`/api/contas-pagar/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Não foi possível ler a conta a pagar da comissão (erro ${res.status}).`);
  return (await res.json()) as ContaPagar;
}

/** Envia e DIZ se falhou: o pagamento não pode parecer feito sem ter sido. */
async function enviar(metodo: 'POST' | 'PUT', url: string, corpo: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  let dados: Record<string, unknown> = {};
  try {
    dados = (await res.json()) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  if (!res.ok) throw new Error(typeof dados.error === 'string' && dados.error ? dados.error : `A gravação falhou (erro ${res.status}).`);
  return dados;
}

/** As rotas que aprovar, pagar e cancelar usam (src/lib/comissao-conta-unica.ts).
 *  Gravar a comissão roda o gancho do servidor, que programa a conta a
 *  pagar; se ele falhar, a comissão fica gravada e o motivo volta como aviso. */
const PORTAS: PortasDaComissao<ComissaoVenda, ContaPagar> = {
  gravarComissao: async c => {
    const r = await enviar('PUT', `/api/comissoes/${encodeURIComponent(c.id)}`, c);
    if (typeof r.aviso === 'string' && r.aviso) {
      toast.warning('A comissão foi gravada, mas a conta a pagar dela não', r.aviso);
    }
  },
  lerConta: lerContaPagar,
  criarConta: async conta => { await enviar('POST', '/api/contas-pagar', conta); },
  atualizarConta: async conta => { await enviar('PUT', `/api/contas-pagar/${encodeURIComponent(conta.id)}`, conta); },
};

/** Valor de venda do produto convertido para BRL (moeda estrangeira x câmbio). */
function valorVendaBRL(p: ProdutoVenda): number {
  return paraBRL(p.valor_venda, p.moeda, p.cambio);
}

/** Pendência de configuração/consistência que impede (ou invalida) o cálculo. */
interface PendenciaComissao {
  id: string;
  venda: string;
  motivo: string;
}

export default function ComissoesPage() {
  const [comissoes, setComissoes] = useState<ComissaoVenda[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [planos, setPlanos] = useState<PlanoComissao[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [pendencias, setPendencias] = useState<PendenciaComissao[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<StatusComissao | 'TODOS'>('TODOS');
  const [filterVendedor, setFilterVendedor] = useState('');
  // O mês é estado do PILAR e vive na URL: trocar aqui e ir para Metas
  // leva o mesmo mês junto.
  const [filterMonth, setFilterMonth] = useMesDaUrl();
  /** A ação aguardando confirmação. Aprovar cria conta a pagar e Pagar debita
   *  o caixa: os dois eram botões de 28px sem confirmação nenhuma. */
  const [confirmando, setConfirmando] = useState<
    | { tipo: 'aprovar' | 'pagar' | 'cancelar' | 'excluir'; comissao: ComissaoVenda }
    | { tipo: 'recalcular' }
    | { tipo: 'duplicadas' }
    | null
  >(null);
  const [processando, setProcessando] = useState(false);
  /** Quando a última varredura rodou. A tela não guardava isso em lugar
   *  nenhum, então não dava para saber se os números eram de hoje. */
  const [ultimoCalculo, setUltimoCalculo] = useState<Date | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  /** Dias do mês em que a agência paga comissão (Configurações > Agência). */
  const [agendaPagamento, setAgendaPagamento] = useState<number[]>([]);
  /** A integração marcou a agência como "a comissão vem do CRM"
   *  (crm_config.data.comissao_pelo_crm, gravada pelo primeiro evento
   *  COMISSAO_APURADA). */
  const [crmMarcouComissao, setCrmMarcouComissao] = useState(false);
  /** As contas de comissão que ficaram em dobro antes da correção. Null
   *  quando o perfil não vê o financeiro. */
  const [duplicadas, setDuplicadas] = useState<ResumoDuplicadas | null>(null);
  /** A comissão do CRM aberta no detalhe das contas recebidas. */
  const [detalhe, setDetalhe] = useState<ComissaoVenda | null>(null);

  async function load() {
    setLoading(true);
    const [c, v, m, p, pc, ag, cfg, dup] = await Promise.all([
      loadEntities<ComissaoVenda>('comissoes'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEquipe<Membro>(),
      loadEntities<PlanoComissao>('planos-comissao'),
      loadEntities<PlanoContas>('plano-contas'),
      loadAgencia<Agencia>(),
      fetch('/api/v1/crm/config').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/comissoes/duplicadas').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setComissoes(c);
    setVendas(v);
    setMembros(m);
    setPlanos(p);
    setPlanoContas(pc);
    setAgendaPagamento(ag?.datas_pagamento_comissao ?? []);
    setCrmMarcouComissao((cfg as { comissao_pelo_crm?: unknown } | null)?.comissao_pelo_crm === true);
    setDuplicadas(dup && typeof (dup as ResumoDuplicadas).quantidade === 'number' ? (dup as ResumoDuplicadas) : null);
    setLoading(false);
    setAtualizadoEm(new Date());
  }

  useEffect(() => { load(); }, []);

  /** A comissão vem do CRM: a marca da integração ou, sem ela, a existência
   *  de comissão do CRM (a marca pode ter falhado; a linha não mente). */
  const comissaoPeloCrm = crmMarcouComissao || comissoes.some(ehComissaoDoCrm);

  /** O que o motor de comissão desta tela pode tocar: nunca a comissão do
   *  CRM e, com a comissão pelo CRM, nunca as vendas do CRM. */
  const recorte = useMemo(
    () => recorteDoMotor(comissoes, vendas, comissaoPeloCrm),
    [comissoes, vendas, comissaoPeloCrm],
  );

  // ============================================================
  // CÁLCULO DA COMISSÃO
  // ============================================================
  //
  // Regras de negócio (todas quebradas antes desta versão):
  //  • A comissão SEGUE a venda: venda cancelada/removida cancela a comissão
  //    ainda não paga, e mudança de valor recalcula (ou sinaliza, se já
  //    aprovada/paga).
  //  • Vendedor sem plano de comissão NÃO gera comissão — vira pendência
  //    visível, nunca cai num plano alheio.
  //  • A base COMISSAO_FORNECEDOR é dinheiro, não percentual.
  //  • Percentual por produto é PONDERADO pelo valor de cada produto.
  //  • Id determinístico: recalcular é idempotente (upsert por id).

  /** Base em R$ das comissões de fornecedor da venda.
   *  Ordem: percentual por produto → contas a receber de comissão →
   *  itens_venda (comissao_valor já apurado na geração financeira). */
  async function baseComissaoFornecedor(
    venda: VendaCRM,
    comissoesPorVenda: Map<string, number>,
    cacheItens: Map<string, ItemVendaData[]>,
  ): Promise<number> {
    const produtos = venda.produtos ?? [];
    // comissao_fornecedor é PERCENTUAL do valor de venda do produto.
    const porProduto = somaPor(produtos, p => percentual(valorVendaBRL(p), p.comissao_fornecedor));
    if (porProduto > 0) return porProduto;

    const porConta = comissoesPorVenda.get(venda.id) ?? 0;
    if (porConta > 0) return porConta;

    let itens = cacheItens.get(venda.id);
    if (!itens) {
      itens = await loadEntities<ItemVendaData>(`itens-venda?venda_id=${encodeURIComponent(venda.id)}`);
      cacheItens.set(venda.id, itens);
    }
    return somaPor(itens, i => i.comissao_valor);
  }

  /** Valor base do plano para a venda, ou o motivo de não haver base confiável. */
  async function calcularValorBase(
    venda: VendaCRM,
    plano: PlanoComissao,
    comissoesPorVenda: Map<string, number>,
    cacheItens: Map<string, ItemVendaData[]>,
  ): Promise<{ valor: number } | { erro: string }> {
    const valorFinal = num(venda.valor_final);
    const custo = num(venda.valor_total_custo);

    if (plano.base_calculo === 'VALOR_VENDA') return { valor: round2(valorFinal) };

    if (plano.base_calculo === 'COMISSAO_FORNECEDOR') {
      const base = await baseComissaoFornecedor(venda, comissoesPorVenda, cacheItens);
      if (base <= 0) return { erro: 'venda sem comissão de fornecedor apurada (produtos, contas a receber e itens zerados)' };
      return { valor: base };
    }

    // RECEITA_AGENCIA / MARKUP / LUCRO = o que sobra pra agência.
    // Com custo preenchido, é valor final - custo. Sem custo (ex.: venda
    // nascida de proposta pública), a única base confiável é a comissão de
    // fornecedor — somar o bruto pagaria comissão sobre faturamento.
    if (custo > 0) return { valor: Math.max(round2(valorFinal - custo), 0) };

    const porComissao = await baseComissaoFornecedor(venda, comissoesPorVenda, cacheItens);
    if (porComissao > 0) return { valor: porComissao };

    return { erro: 'venda sem custo de fornecedor e sem comissão apurada: a base viraria o faturamento bruto' };
  }

  /** Percentual de fallback: o padrão do plano, ponderado pelas regras de
   *  produto quando existirem. NÃO aplica faixa: a faixa depende do
   *  acumulado do mês do vendedor, resolvido em comissao-acumulada.ts. */
  function calcularPercentual(venda: VendaCRM, plano: PlanoComissao): number {
    let pct = num(plano.percentual_padrao);

    const produtos = venda.produtos ?? [];
    if (plano.regras_produto.length > 0 && produtos.length > 0) {
      const totalProdutos = somaPor(produtos, valorVendaBRL);
      if (totalProdutos > 0) {
        // Ponderação pelo valor: produto sem regra usa o percentual padrão.
        const comissaoPonderada = somaPor(produtos, p => {
          const regra = plano.regras_produto.find(r => r.tipo_produto === p.tipo);
          return percentual(valorVendaBRL(p), regra ? num(regra.percentual) : num(plano.percentual_padrao));
        });
        pct = round2(divSegura(comissaoPonderada, totalProdutos) * 100);
      }
    }

    // A FAIXA NÃO É APLICADA AQUI. Ela depende do acumulado do mês do
    // vendedor, não desta venda isolada, e é resolvida em
    // src/lib/comissao-acumulada.ts depois que todas as bases do mês são
    // apuradas. O que sai daqui é só o percentual de fallback, usado
    // quando o acumulado do mês não casa com faixa nenhuma.
    return pct;
  }

  // Recalcula todas as comissões: reconcilia as existentes com a venda e
  // gera as que faltam.
  async function handleCalcular() {
    setCalculating(true);
    const pend: PendenciaComissao[] = [];

    // Contas a receber de comissão de fornecedor: fallback de base quando a
    // venda não detalha percentual por produto.
    const receber = await loadEntities<ContaReceber>('contas-receber');
    const comissoesPorVenda = new Map<string, number>();
    for (const r of receber) {
      if (r.origem !== 'COMISSAO_FORNECEDOR' || !r.venda_id || r.status === 'CANCELADO') continue;
      comissoesPorVenda.set(r.venda_id, round2((comissoesPorVenda.get(r.venda_id) ?? 0) + num(r.valor_final)));
    }
    const cacheItens = new Map<string, ItemVendaData[]>();
    const vendasById = new Map(vendas.map(v => [v.id, v]));
    const hoje = hojeISO();

    /** Base apurada de uma venda, ainda SEM percentual e sem valor: os dois
     *  dependem do acumulado do mês do vendedor. */
    interface BaseApurada {
      vendedor: Membro;
      plano: PlanoComissao;
      base: number;
      pctFallback: number;
      parcial: ComissaoVenda;
    }

    /** Apura a base da venda, ou devolve o motivo da pendência. */
    async function montar(venda: VendaCRM, anterior?: ComissaoVenda): Promise<BaseApurada | { erro: string }> {
      // A equipe é uma lista só, vinda de `usuarios`, e é exatamente para
      // lá que venda.vendedor_id aponta quando a venda vem do CRM. Venda
      // antiga, gravada quando existia o cadastro paralelo, resolve pelos
      // ids absorvidos na migração.
      const vendedor =
        membros.find(m => m.id === venda.vendedor_id) ??
        membros.find(m => (m.membro_ids_legado ?? []).includes(venda.vendedor_id));
      if (!vendedor) {
        return {
          erro: `o vendedor desta venda não está na equipe (vendedor_id ${venda.vendedor_id}). Cadastre a pessoa em Configurações, Usuários.`,
        };
      }

      // Sem plano vinculado NÃO gera comissão — cair no "plano ativo mais
      // recente" pagava percentual de outra regra sem ninguém perceber.
      const plano = planos.find(p => p.id === vendedor.plano_comissao_id && p.ativo);
      if (!plano) {
        return {
          erro: vendedor.plano_comissao_id
            ? `plano de comissão do vendedor ${vendedor.nome} não existe ou está inativo`
            : `vendedor ${vendedor.nome} está sem plano de comissão vinculado`,
        };
      }

      const base = await calcularValorBase(venda, plano, comissoesPorVenda, cacheItens);
      if ('erro' in base) return base;

      // Percentual e valor ficam em aberto de propósito: quem os fecha é a
      // distribuição do acumulado do mês, mais abaixo.
      return {
        vendedor,
        plano,
        base: round2(base.valor),
        pctFallback: calcularPercentual(venda, plano),
        parcial: {
          ...(anterior ?? {}),
          id: anterior?.id ?? comissaoId(venda.id, venda.vendedor_id),
          venda_id: venda.id,
          venda_numero: venda.numero,
          vendedor_id: venda.vendedor_id,
          vendedor_nome: vendedor.nome,
          plano_comissao_id: plano.id,
          plano_nome: plano.nome,
          data_venda: venda.data_venda,
          valor_base: round2(base.valor),
          percentual_aplicado: 0,
          valor_comissao: 0,
          status: anterior?.status ?? 'CALCULADA',
          data_aprovacao: anterior?.data_aprovacao ?? null,
          data_pagamento: anterior?.data_pagamento ?? null,
          observacoes: anterior?.observacoes ?? '',
        } as ComissaoVenda,
      };
    }

    // ---- 1) Comissão de venda que sumiu ou foi cancelada ----
    // Feito antes de tudo: essas comissões saem do acumulado do mês. A
    // comissão do CRM fica de fora: a "venda" dela é o mês, não existe em
    // vendas, e ela seria cancelada como "venda removida".
    for (const c of recorte.paraConciliar) {
      if (c.status === 'CANCELADA') continue;
      const venda = vendasById.get(c.venda_id);
      if (venda && venda.status !== 'CANCELADO') continue;

      const motivo = venda ? 'venda cancelada' : 'venda removida';
      if (c.status === 'PAGA') {
        pend.push({ id: c.id, venda: c.venda_numero, motivo: `${motivo} com comissão JÁ PAGA: estornar manualmente` });
      } else {
        await updateEntity('comissoes', {
          ...c, status: 'CANCELADA',
          observacoes: `${c.observacoes ? c.observacoes + ' | ' : ''}Cancelada automaticamente em ${hoje}: ${motivo}.`,
        });
      }
    }

    // ---- 2) Apura a base de TODAS as vendas elegíveis do período ----
    // A faixa de comissão é escolhida pelo acumulado do mês do vendedor, e
    // não pela venda isolada. Por isso é preciso ter todas as bases antes
    // de fechar qualquer valor.
    const comissaoPorVendaId = new Map(
      recorte.comissoesDoMotor.filter(c => c.status !== 'CANCELADA').map(c => [c.venda_id, c]),
    );

    // Com a comissão pelo CRM, as vendas do CRM não entram: o CRM já pagou
    // sobre o dinheiro delas.
    const elegiveis = recorte.vendasParaCalcular.filter(v =>
      (v.status === 'CONFIRMADO' || v.status === 'CONCLUIDO') && v.vendedor_id,
    );

    const apuradas: BaseApurada[] = [];
    for (const venda of elegiveis) {
      const anterior = comissaoPorVendaId.get(venda.id);
      const r = await montar(venda, anterior);
      if ('erro' in r) {
        pend.push({ id: anterior?.id ?? venda.id, venda: venda.numero, motivo: r.erro });
        continue;
      }
      apuradas.push(r);
    }

    // ---- 3) Fecha o valor pelo acumulado de cada vendedor em cada mês ----
    const porVendedorMes = new Map<string, BaseApurada[]>();
    for (const a of apuradas) {
      // Agrupa pela pessoa da equipe, não pelo vendedor_id cru: venda antiga
      // com id do cadastro anterior tem que somar no mesmo acumulado.
      const chave = chaveAcumulado(a.vendedor.id, mesDe(a.parcial.data_venda));
      const lista = porVendedorMes.get(chave) ?? [];
      lista.push(a);
      porVendedorMes.set(chave, lista);
    }

    for (const grupo of porVendedorMes.values()) {
      // Todas as vendas do grupo têm o mesmo vendedor, logo o mesmo plano.
      const plano = grupo[0].plano;
      const resultado = calcularComissaoDoMes(
        grupo.map(a => ({ venda_id: a.parcial.venda_id, base: a.base, pct_fallback: a.pctFallback })),
        plano,
      );
      const porVenda = new Map(resultado.itens.map(i => [i.venda_id, i]));

      for (const a of grupo) {
        const item = porVenda.get(a.parcial.venda_id);
        if (!item) continue;

        const nova: ComissaoVenda = {
          ...a.parcial,
          percentual_aplicado: item.percentual,
          valor_comissao: item.valor,
        };

        const anterior = comissaoPorVendaId.get(a.parcial.venda_id);
        if (!anterior) {
          await saveEntity('comissoes', nova);
          continue;
        }

        const divergiu =
          nova.valor_base !== round2(num(anterior.valor_base)) ||
          nova.valor_comissao !== round2(num(anterior.valor_comissao)) ||
          nova.percentual_aplicado !== round2(num(anterior.percentual_aplicado));
        if (!divergiu) continue;

        if (anterior.status === 'CALCULADA') {
          const mudouFaixa = round2(num(anterior.percentual_aplicado)) !== nova.percentual_aplicado;
          const nota = mudouFaixa
            ? `Recalculada em ${hoje}: acumulado do mês ${BRL(resultado.base_acumulada)} coloca o vendedor na faixa de ${nova.percentual_aplicado}% (antes ${num(anterior.percentual_aplicado)}%).`
            : `Recalculada em ${hoje} (base ${BRL(num(anterior.valor_base))} → ${BRL(nova.valor_base)}).`;
          await updateEntity('comissoes', {
            ...nova,
            observacoes: `${anterior.observacoes ? anterior.observacoes + ' | ' : ''}${nota}`,
          });
        } else {
          // Aprovada ou paga não muda de valor sem decisão humana. Mas o
          // acumulado do mês pode ter subido a faixa DEPOIS da aprovação, e
          // aí existe complemento devido: dizer o número é obrigação.
          const diferenca = round2(nova.valor_comissao - round2(num(anterior.valor_comissao)));
          const motivo = diferenca > 0
            ? `acumulado do mês ${BRL(resultado.base_acumulada)} subiu a faixa para ${nova.percentual_aplicado}%: complemento de ${BRL(diferenca)} devido (comissão ${anterior.status} mantida em ${BRL(num(anterior.valor_comissao))})`
            : diferenca < 0
              ? `acumulado do mês caiu para ${BRL(resultado.base_acumulada)} (faixa ${nova.percentual_aplicado}%): pago ${BRL(Math.abs(diferenca))} a mais (comissão ${anterior.status} mantida)`
              : `venda mudou de valor: base gravada ${BRL(num(anterior.valor_base))} × base atual ${BRL(nova.valor_base)} (comissão ${anterior.status} mantida)`;
          pend.push({ id: anterior.id, venda: anterior.venda_numero, motivo });
        }
      }
    }

    setPendencias(pend);
    setUltimoCalculo(new Date());
    setCalculating(false);
    load();
  }

  /** A conta a pagar da comissão montada AQUI. Só para o caso em que o
   *  gancho do servidor não a criou (ele falhou e voltou como aviso): o
   *  pagamento cria a conta com o mesmo id da conta única e a baixa. */
  function montarContaComissao(c: ComissaoVenda, vencimento: string): ContaPagar {
    const valor = round2(num(c.valor_comissao));
    const doCrm = ehComissaoDoCrm(c);

    // origem 'OUTROS' (não 'VENDA') porque o DRE exclui CP auto-gerada de
    // venda como repasse ao fornecedor: comissão não é repasse.
    const categoriaComercial = planoContas.find(
      p => p.tipo === 'DESPESA' && p.ativo && p.codigo.startsWith('2.6')
    ) ?? planoContas.find(p => p.tipo === 'DESPESA' && p.ativo && p.is_custo_comercial);

    return {
      ...createContaPagar(),
      id: idDaContaDaComissao(c.id),
      origem: 'OUTROS',
      // A comissão do CRM é do mês, não de uma venda.
      venda_id: doCrm ? null : (c.venda_id || null),
      fornecedor_id: '',
      fornecedor_nome: c.vendedor_nome,
      descricao: doCrm
        ? `Comissão · ${c.vendedor_nome} · ${c.descricao || 'calculada pelo CRM'}`
        : `Comissão · ${c.vendedor_nome} · venda ${c.venda_numero}`,
      categoria_id: categoriaComercial?.id ?? '',
      valor_original: valor,
      valor_final: valor,
      valor_brl: valor,
      data_emissao: hojeISO(),
      data_vencimento: vencimento,
      natureza_custo: 'VARIAVEL',
      is_custo_comercial: true,
      // Nasce PENDENTE de propósito: o POST do CRUD genérico grava o registro
      // mas NÃO move o caixa. A baixa vem só pelo PUT, que é o único caminho
      // que debita o saldo.
      status: 'PENDENTE',
      data_pagamento: null,
      valor_pago: null,
      origem_venda_id: doCrm ? undefined : c.venda_id,
      auto_gerado: true,
      origem_comissao_id: c.id,
      observacoes: `Criada pelo pagamento da comissão ${c.id}: a conta programada não foi encontrada.`,
    };
  }

  /** Aprovar só aprova. A conta a pagar já existe: o servidor a programa a
   *  cada gravação da comissão, na próxima data da agenda (ou no fim do mês,
   *  sem agenda). Criar outra aqui era a origem da conta em dobro. */
  async function handleAprovar(c: ComissaoVenda) {
    await aprovarComissao(c, hojeISO(), PORTAS);
    load();
  }

  /** Pagar baixa UMA conta pelo PUT de contas a pagar, o único caminho que
   *  debita o saldo: a antiga `pagar-<id>` se ainda viva, senão a
   *  `cp-comissao-<id>` do servidor. Sem nenhuma (o gancho falhou), cria a
   *  conta aqui com o id da conta única e a baixa. */
  async function handlePagar(c: ComissaoVenda) {
    const hoje = hojeISO();
    await pagarComissao(c, hoje, PORTAS, () => montarContaComissao(c, hoje));
    load();
  }

  /** Cancelar passa pelo gancho, que cancela a conta da comissão ainda não
   *  paga; a antiga pendente que tenha sobrado é cancelada aqui. */
  async function handleCancelar(c: ComissaoVenda) {
    await cancelarComissao(c, PORTAS);
    load();
  }

  /** Cancela as contas em dobro. O servidor refaz a lista: não há como
   *  mandar cancelar uma conta que não é duplicada. */
  async function handleCancelarDuplicadas() {
    const r = await enviar('POST', '/api/comissoes/duplicadas', {});
    const n = Number(r.canceladas) || 0;
    if (n === 0) toast.info('Nenhuma conta em dobro para cancelar', 'Alguém já tinha cancelado, ou a conta foi paga nesse meio tempo.');
    else toast.success(`${n} ${n === 1 ? 'conta em dobro cancelada' : 'contas em dobro canceladas'}`, `${BRL(num(r.valor_total))} saíram do a pagar. Nenhum dinheiro se moveu.`);
    await load();
  }

  async function handleDelete(id: string) {
    await deleteEntity('comissoes', id);
    load();
  }

  /** Acumulado do mês por vendedor, com a faixa que ele alcançou. Existe
   *  porque a alíquota da linha não se explica sozinha: ela vem da soma do
   *  mês, e não daquela venda. */
  const acumuladoPorVendedor = useMemo(() => {
    const mapa = new Map<string, { nome: string; base: number; pct: number; vendas: number }>();
    for (const c of comissoes) {
      if (c.status === 'CANCELADA') continue;
      // A comissão do CRM não vem da faixa de um plano daqui: somá-la no
      // acumulado explicaria um número com a régua errada.
      if (ehComissaoDoCrm(c)) continue;
      if (filterMonth && mesDe(c.data_venda) !== filterMonth) continue;
      const atual = mapa.get(c.vendedor_id) ?? { nome: c.vendedor_nome, base: 0, pct: 0, vendas: 0 };
      atual.base = round2(atual.base + num(c.valor_base));
      atual.pct = Math.max(atual.pct, round2(num(c.percentual_aplicado)));
      atual.vendas += 1;
      mapa.set(c.vendedor_id, atual);
    }
    return [...mapa.values()].sort((a, b) => b.base - a.base);
  }, [comissoes, filterMonth]);

  const filtered = comissoes.filter(c => {
    if (filterStatus !== 'TODOS' && c.status !== filterStatus) return false;
    if (filterVendedor && c.vendedor_id !== filterVendedor) return false;
    if (filterMonth && mesDe(c.data_venda) !== filterMonth) return false;
    return true;
  }).sort((a, b) => (b.data_venda ?? '').localeCompare(a.data_venda ?? ''));

  // O MESMO recorte da tabela. Antes isto somava o array inteiro enquanto a
  // tabela aplicava mês, pessoa e situação — dois números contraditórios na
  // mesma tela, e nenhum aviso de que eram escopos diferentes.
  const doEscopo = useMemo(
    () =>
      comissoes.filter(c => {
        if (filterVendedor && c.vendedor_id !== filterVendedor) return false;
        if (filterMonth && mesDe(c.data_venda) !== filterMonth) return false;
        return true;
      }),
    [comissoes, filterVendedor, filterMonth],
  );

  const stats = useMemo(() => {
    const porStatus = (s: StatusComissao) =>
      somaPor(doEscopo.filter(c => c.status === s), c => c.valor_comissao);
    return { calculadas: porStatus('CALCULADA'), aprovadas: porStatus('APROVADA'), pagas: porStatus('PAGA') };
  }, [doEscopo]);

  const aAprovar = useMemo(() => doEscopo.filter(c => c.status === 'CALCULADA'), [doEscopo]);
  const proximaSaida = proximaDataPagamento(agendaPagamento, hojeISO());
  const nomeDoMes = rotuloDoMes(filterMonth);

  /**
   * As vendas travadas são calculadas NA CARGA, não só depois de clicar em
   * Calcular. Antes a fila só existia em memória após handleCalcular e sumia
   * ao recarregar: a agência podia ter cinco vendas travadas e abrir a tela
   * limpa, sem nenhum sinal.
   */
  const travadas = useMemo(() => {
    const lista: PendenciaComissao[] = [];
    // Com a comissão pelo CRM, venda do CRM sem comissão aqui é o certo.
    for (const v of recorte.vendasParaCalcular) {
      if (v.status !== 'CONFIRMADO' && v.status !== 'CONCLUIDO') continue;
      if (mesDe(v.data_venda ?? '') !== filterMonth) continue;
      if (comissoes.some(c => c.venda_id === v.id && c.status !== 'CANCELADA')) continue;

      const pessoa = membros.find(m => m.id === v.vendedor_id);
      if (!pessoa) {
        lista.push({ id: v.id, venda: v.numero, motivo: 'a venda não tem vendedor da equipe vinculado' });
        continue;
      }
      const plano = planos.find(p => p.id === pessoa.plano_comissao_id && p.ativo);
      if (!plano) {
        lista.push({ id: v.id, venda: v.numero, motivo: `${pessoa.nome} não tem plano de comissão vinculado` });
        continue;
      }
      lista.push({ id: v.id, venda: v.numero, motivo: 'esta venda ainda não teve comissão apurada' });
    }
    return lista;
  }, [recorte, comissoes, membros, planos, filterMonth]);

  /** Quem aparece no filtro de pessoa: quem TEM comissão no escopo mais a
   *  equipe inteira. Antes o filtro listava só quem já tinha comissão, então
   *  não dava para perguntar "e a Karen, não recebeu nada?". */
  const pessoasDoFiltro = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const m of membros) mapa.set(m.id, m.nome);
    for (const c of comissoes) if (!mapa.has(c.vendedor_id)) mapa.set(c.vendedor_id, c.vendedor_nome);
    return [...mapa.entries()].map(([valor, rotulo]) => ({ valor, rotulo }));
  }, [membros, comissoes]);

  const colunas: FinColuna<ComissaoVenda>[] = [
    {
      id: 'pessoa',
      cabecalho: 'Pessoa',
      tipo: 'texto',
      prioridade: 3,
      sortable: true,
      acessor: c => c.vendedor_nome,
      render: c => (
        <div className="min-w-0">
          <p className="fin-t-body-strong truncate text-[var(--fin-text)]">{c.vendedor_nome}</p>
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            {ehComissaoDoCrm(c)
              ? `${nomeDaCompetencia(c.competencia ?? '')} · calculada pelo CRM`
              : `venda ${c.venda_numero}${c.data_venda ? ` · ${dataBR(c.data_venda)}` : ''}`}
          </p>
        </div>
      ),
    },
    {
      id: 'base',
      cabecalho: 'Base da comissão',
      tipo: 'dinheiro',
      prioridade: 1,
      valor: c => num(c.valor_base),
      // A base NOMEADA: "R$ 1.815,55" sozinho não diz sobre o que a comissão
      // incidiu, e a coluna "%" repetia a mesma alíquota em todas as linhas
      // da mesma pessoa, sugerindo variação onde não há.
      sub: c => (
        <span>
          {ehComissaoDoCrm(c)
            ? `${num(c.percentual_aplicado)}% sobre o dinheiro recebido`
            : `${num(c.percentual_aplicado)}% sobre a receita da agência`}
        </span>
      ),
    },
    { id: 'valor', cabecalho: 'Comissão', tipo: 'dinheiro', prioridade: 3, sortable: true, valor: c => num(c.valor_comissao) },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', prioridade: 2, valor: c => c.status, dominio: 'comissao' },
    {
      id: 'acoes',
      cabecalho: '',
      tipo: 'acoes',
      prioridade: 3,
      render: c => (
        <div className="flex flex-wrap justify-end gap-1">
          {ehComissaoDoCrm(c) && (
            <button
              className={BOTAO}
              onClick={() => setDetalhe(c)}
              aria-label={`Ver as contas recebidas da comissão de ${c.vendedor_nome}`}
            >
              Contas
            </button>
          )}
          {c.status === 'CALCULADA' && (
            <button className={BOTAO} onClick={() => setConfirmando({ tipo: 'aprovar', comissao: c })}>
              Aprovar
            </button>
          )}
          {c.status === 'APROVADA' && (
            <button className={BOTAO} onClick={() => setConfirmando({ tipo: 'pagar', comissao: c })}>
              Pagar
            </button>
          )}
          {c.status !== 'PAGA' && c.status !== 'CANCELADA' && (
            <button className={BOTAO} onClick={() => setConfirmando({ tipo: 'cancelar', comissao: c })}>
              Cancelar
            </button>
          )}
          {c.status === 'CANCELADA' && (
            <button className={BOTAO} onClick={() => setConfirmando({ tipo: 'excluir', comissao: c })}>
              Excluir
            </button>
          )}
        </div>
      ),
    },
  ];

  // As três etapas do dinheiro. É rampa SEQUENCIAL porque etapa é ordinal —
  // e porque --t-green e --t-blue apontavam ambos para --fin-accent, deixando
  // "Aprovadas" e "Pagas" exatamente da mesma cor nos dois temas.
  const etapas: Parte[] = [
    { id: 'aprovar', rotulo: 'A aprovar', valor: stats.calculadas, papel: 'seq', indiceSeq: 2 },
    { id: 'aprovadas', rotulo: 'Aprovadas, a pagar', valor: stats.aprovadas, papel: 'seq', indiceSeq: 3 },
    { id: 'pagas', rotulo: 'Pagas', valor: stats.pagas, papel: 'seq', indiceSeq: 4 },
  ];
  const etapasComValor = etapas.filter(e => num(e.valor) > 0).length;

  const acumulados = acumuladoPorVendedor.map(a => {
    const pessoa = membros.find(m => m.nome === a.nome);
    const plano = pessoa ? planos.find(p => p.id === pessoa.plano_comissao_id) : undefined;
    const faixas = (plano?.faixas ?? []).map(f => ({
      de: num(f.de),
      ate: num(f.ate) === 0 ? null : num(f.ate),
      percentual: num(f.percentual),
    }));
    return { ...a, id: pessoa?.id ?? a.nome, plano, faixas, posicao: posicaoNaEscala(plano?.faixas ?? [], a.base) };
  });

  const filtrosAtivos = (filterStatus !== 'TODOS' ? 1 : 0) + (filterVendedor ? 1 : 0);

  const alvoDaConfirmacao = confirmando && 'comissao' in confirmando ? confirmando.comissao : null;

  async function executarConfirmacao() {
    if (!confirmando) return;
    setProcessando(true);
    try {
      if (confirmando.tipo === 'recalcular') await handleCalcular();
      else if (confirmando.tipo === 'duplicadas') await handleCancelarDuplicadas();
      else if (confirmando.tipo === 'aprovar') await handleAprovar(confirmando.comissao);
      else if (confirmando.tipo === 'pagar') await handlePagar(confirmando.comissao);
      else if (confirmando.tipo === 'cancelar') await handleCancelar(confirmando.comissao);
      else if (confirmando.tipo === 'excluir') await handleDelete(confirmando.comissao.id);
      setConfirmando(null);
    } catch (e) {
      toast.error('Não foi possível concluir', e instanceof Error ? e.message : undefined);
    } finally {
      setProcessando(false);
    }
  }

  const textoDaConfirmacao = (): { titulo: string; oQue: string; rotulo: string; tone: 'padrao' | 'destrutivo' } => {
    if (!confirmando) return { titulo: '', oQue: '', rotulo: '', tone: 'padrao' };
    if (confirmando.tipo === 'recalcular') {
      return {
        titulo: `Recalcular comissões de ${nomeDoMes}`,
        oQue: `Vamos reler as vendas confirmadas de ${nomeDoMes}, recalcular as faixas e cancelar as comissões que perderam base. Comissões já pagas não mudam.${comissaoPeloCrm ? ' As comissões calculadas pelo CRM e as vendas do CRM ficam de fora.' : ''}`,
        rotulo: 'Recalcular',
        tone: 'padrao',
      };
    }
    if (confirmando.tipo === 'duplicadas') {
      const q = duplicadas?.quantidade ?? 0;
      return {
        titulo: `Cancelar ${q} ${q === 1 ? 'conta em dobro' : 'contas em dobro'}`,
        oQue: `Vamos cancelar ${q === 1 ? 'a conta a pagar de comissão que duplica' : `as ${q} contas a pagar de comissão que duplicam`} outra (${BRL(duplicadas?.valor_total ?? 0)}). Fica a conta que a aprovação criou, que é a que o pagamento baixa. Nada é excluído e nenhum dinheiro se move.`,
        rotulo: 'Cancelar as duplicadas',
        tone: 'destrutivo',
      };
    }
    const c = confirmando.comissao;
    if (confirmando.tipo === 'aprovar') {
      return {
        titulo: `Aprovar ${BRL(num(c.valor_comissao))}`,
        oQue: proximaSaida
          ? `Aprovar confirma a comissão de ${c.vendedor_nome}. A conta a pagar dela, de ${BRL(num(c.valor_comissao))}, fica programada para ${dataBR(proximaSaida)}. Cancelar depois cancela a conta junto, se ainda não foi paga.`
          : `Aprovar confirma a comissão de ${c.vendedor_nome}. Como a agência não tem dias de pagamento definidos, a conta a pagar de ${BRL(num(c.valor_comissao))} vence no fim do mês.`,
        rotulo: 'Aprovar',
        tone: 'padrao',
      };
    }
    if (confirmando.tipo === 'pagar') {
      return {
        titulo: `Pagar ${BRL(num(c.valor_comissao))}`,
        oQue: `Pagar dá baixa na conta a pagar de ${c.vendedor_nome} e DEBITA ${BRL(num(c.valor_comissao))} do saldo em caixa, com data de hoje.`,
        rotulo: 'Pagar',
        tone: 'padrao',
      };
    }
    if (confirmando.tipo === 'cancelar') {
      return {
        titulo: 'Cancelar esta comissão',
        oQue: `A comissão de ${c.vendedor_nome} sai das contas do mês, e a conta a pagar dela é cancelada junto. Conta já paga não muda: o dinheiro que saiu continua lançado.`,
        rotulo: 'Cancelar a comissão',
        tone: 'destrutivo',
      };
    }
    return {
      titulo: 'Excluir esta comissão',
      oQue: `Excluir apaga o registro da comissão de ${c.vendedor_nome}. A conta a pagar dela, cancelada junto com a comissão, continua no histórico de Contas a pagar.`,
      rotulo: 'Excluir',
      tone: 'destrutivo',
    };
  };

  const confirmacao = textoDaConfirmacao();

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Comissões"
        subtitulo={`O que a agência deve à equipe em ${nomeDoMes} e o que depende da sua aprovação`}
        acoesSecundarias={[{ rotulo: 'Vendedores e planos', href: '/equipe/vendedores' }]}
        atualizadoEm={atualizadoEm}
        onRecarregar={load}
      />

      <DataState
        className={RITMO_DA_PAGINA}
        estado={loading ? 'carregando' : 'ok'}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
            <div className="h-[44px] w-60 rounded bg-[var(--fin-surface-2)]" />
            <div className="h-[126px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
            <div className="h-[220px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
          </div>
        }
      >
        {/* ── FILTROS ─────────────────────────────────────────────────────
            Manchete, faixa e tabela derivam do MESMO recorte, e o recorte
            aparece escrito: sem isso, a tela mostra dois números diferentes
            para a mesma pergunta. */}
        <div className="flex flex-wrap items-end gap-3">
          <SeletorDeMes valor={filterMonth} onChange={setFilterMonth} />

          <label className="flex flex-col gap-1">
            <span className="fin-t-caption text-[var(--fin-text-3)]">Pessoa</span>
            <select className={CAMPO} value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)}>
              <option value="">Todas</option>
              {pessoasDoFiltro.map(p => (
                <option key={p.valor} value={p.valor}>{p.rotulo}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="fin-t-caption text-[var(--fin-text-3)]">Situação</span>
            <select
              className={CAMPO}
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as StatusComissao | 'TODOS')}
            >
              <option value="TODOS">Todas</option>
              <option value="CALCULADA">A aprovar</option>
              <option value="APROVADA">Aprovada, a pagar</option>
              <option value="PAGA">Paga</option>
              <option value="CANCELADA">Cancelada</option>
            </select>
          </label>

          {filtrosAtivos > 0 && (
            <button
              type="button"
              className={BOTAO}
              onClick={() => { setFilterStatus('TODOS'); setFilterVendedor(''); }}
            >
              Limpar filtros
            </button>
          )}

          <p className="fin-t-caption w-full text-[var(--fin-text-3)]">
            {`${filtered.length} de ${doEscopo.length} ${doEscopo.length === 1 ? 'comissão' : 'comissões'} de ${nomeDoMes}${filterVendedor ? `, de ${pessoasDoFiltro.find(p => p.valor === filterVendedor)?.rotulo ?? 'uma pessoa'}` : ''}`}
          </p>
        </div>

        {/* ── CONTAS EM DOBRO ─────────────────────────────────────────────
            Antes de 08/10/2026 a aprovação criava uma segunda conta a pagar
            para a mesma comissão. A lista aparece antes de qualquer mudança;
            cancelar é uma decisão, com confirmação. */}
        {duplicadas && duplicadas.quantidade > 0 && (
          <Callout
            tom="aviso"
            titulo={`${duplicadas.quantidade} ${duplicadas.quantidade === 1 ? 'conta a pagar de comissão está' : 'contas a pagar de comissão estão'} em dobro (${BRL(duplicadas.valor_total)})`}
            acao={{ rotulo: 'Cancelar as duplicadas', onClick: () => setConfirmando({ tipo: 'duplicadas' }) }}
          >
            <p>
              Cada comissão abaixo tem duas contas a pagar, e o fluxo de caixa conta as duas. Cancelar mantém a conta
              que a aprovação criou e cancela a outra. Nada é excluído e nenhum dinheiro se move.
            </p>
            <ListaDeDuplicadas itens={duplicadas.itens} rotulo="Ver as contas em dobro" />
          </Callout>
        )}
        {duplicadas && duplicadas.pagas_em_dobro.length > 0 && (
          <Callout
            tom="negativo"
            titulo={`${duplicadas.pagas_em_dobro.length} ${duplicadas.pagas_em_dobro.length === 1 ? 'comissão foi paga' : 'comissões foram pagas'} duas vezes (${BRL(somaPor(duplicadas.pagas_em_dobro, d => d.valor))})`}
          >
            <p>
              As duas contas a pagar destas comissões já foram baixadas: o dinheiro saiu duas vezes. Cancelar não
              devolve dinheiro. Acerte com o vendedor e desfaça a baixa de uma das contas em Contas a pagar.
            </p>
            <ListaDeDuplicadas itens={duplicadas.pagas_em_dobro} rotulo="Ver as comissões pagas duas vezes" />
          </Callout>
        )}

        {/* ── COMISSÃO PELO CRM ───────────────────────────────────────────
            O motor desta tela não calcula as vendas do CRM: o CRM paga o
            time sobre o dinheiro recebido e manda a comissão pronta. */}
        {comissaoPeloCrm && (
          <Callout tom="info" titulo="As comissões das vendas do CRM vêm calculadas do CRM">
            <p>
              O CRM calcula a comissão de cada vendedor sobre o dinheiro recebido no mês e manda pronta. Aqui ela é
              aprovada e paga como as outras, e o recálculo desta tela não a muda. Vendas lançadas no financeiro
              continuam nos planos daqui.
            </p>
            {recorte.anterioresEmVendaDoCrm.length > 0 && (
              <p className="mt-1">
                {`${recorte.anterioresEmVendaDoCrm.length} ${recorte.anterioresEmVendaDoCrm.length === 1 ? 'comissão calculada aqui' : 'comissões calculadas aqui'} sobre vendas do CRM, antes desta mudança, ainda não ${recorte.anterioresEmVendaDoCrm.length === 1 ? 'foi paga' : 'foram pagas'} (${BRL(somaPor(recorte.anterioresEmVendaDoCrm, c => num(c.valor_comissao)))}). Confira se o CRM não pagou o mesmo dinheiro antes de aprovar.`}
              </p>
            )}
          </Callout>
        )}

        {/* ── A RESPOSTA E A AÇÃO ─────────────────────────────────────────
            Sem chip de veredito: aqui o julgamento é do dono, e a peça que o
            representa é o botão. */}
        <div className="flex flex-col gap-2">
          <Resposta
            overline="ESPERANDO SUA APROVAÇÃO"
            valor={<Money valor={stats.calculadas} size="resposta" align="esquerda" />}
            frase={
              aAprovar.length === 0
                ? `Nada esperando aprovação em ${nomeDoMes}.`
                : `${aAprovar.length} ${aAprovar.length === 1 ? 'comissão' : 'comissões'}, ${
                    new Set(aAprovar.map(c => c.vendedor_nome)).size === 1
                      ? `de ${aAprovar[0].vendedor_nome}`
                      : `de ${new Set(aAprovar.map(c => c.vendedor_nome)).size} pessoas`
                  }. ${
                    proximaSaida
                      ? `Aprovando hoje, ${aAprovar.length === 1 ? 'sai' : 'saem'} no pagamento de ${dataBR(proximaSaida)}.`
                      : 'A agência ainda não tem dias de pagamento definidos, então não dá para dizer quando sai.'
                  }`
            }
            acao={
              aAprovar.length === 1
                ? {
                    rotulo: `Aprovar ${BRL(num(aAprovar[0].valor_comissao))}`,
                    onClick: () => setConfirmando({ tipo: 'aprovar', comissao: aAprovar[0] }),
                  }
                : null
            }
          />

          {/* descreverAgenda devolve um FRAGMENTO ("dia 10"), não uma frase:
              emendar um ponto final nele produzia "dia 10 A próxima saída é…". */}
          {proximaSaida ? (
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {`A agência paga comissão ${descreverAgenda(agendaPagamento)} de cada mês. A próxima saída é ${dataBR(proximaSaida)}.`}
            </p>
          ) : (
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Nenhuma agenda de pagamento definida: sem ela, não dá para dizer quando a comissão sai.{' '}
              <Link href="/config/agencia" className="text-[var(--fin-accent)] underline underline-offset-2">
                Definir os dias de pagamento
              </Link>
            </p>
          )}
        </div>

        {/* ── ONDE ESTÁ O DINHEIRO ────────────────────────────────────────
            Com uma etapa só, a barra é um número com tinta em volta: viram
            três fatos em linha. */}
        {etapasComValor >= 2 ? (
          <GraficoMoldura
            titulo={`Onde está o dinheiro das comissões de ${nomeDoMes}`}
            estado="ok"
            descricao={`Comissões de ${nomeDoMes} por etapa: a aprovar, aprovadas e pagas.`}
            tabela={{
              colunas: ['Etapa', 'Valor'],
              linhas: etapas.map(e => [e.rotulo, BRL(num(e.valor))]),
            }}
          >
            <BarraDeParte partes={etapas} formatar={v => BRL(num(v))} />
          </GraficoMoldura>
        ) : (
          // Com uma etapa só a barra seria um número com tinta em volta. Vira
          // o mesmo trio de fatos que a Folha e o Painel usam, para a tela
          // continuar parecendo a mesma casa.
          <ul className="grid gap-[var(--fin-s-3)] sm:grid-cols-3">
            {etapas.map(e => (
              <li key={e.id} className={`${CARTAO} flex flex-col gap-1 p-[var(--fin-s-4)]`}>
                <span className="fin-t-overline text-[var(--fin-text-3)]">{e.rotulo}</span>
                {num(e.valor) > 0 ? (
                  <Money valor={num(e.valor)} size="metricSm" align="esquerda" />
                ) : (
                  <span className="fin-t-metric-sm text-[var(--fin-text-3)]">—</span>
                )}
                <span className="fin-t-caption text-[var(--fin-text-3)]">
                  {num(e.valor) > 0
                    ? `${e.id === 'aprovar' ? 'esperando você' : e.id === 'aprovadas' ? 'programadas para pagamento' : 'já saíram do caixa'}`
                    : e.id === 'aprovar' ? 'nada esperando aprovação' : e.id === 'aprovadas' ? 'nada aprovado ainda' : 'nada pago ainda'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* ── POR VENDEDOR ────────────────────────────────────────────────
            O percentual vive AQUI, uma vez só, com a razão dele ao lado. */}
        {acumulados.length > 0 && (
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="fin-t-subhead text-[var(--fin-text)]">Por que a comissão de cada um é o que é</h2>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                A faixa vem do acumulado do mês, não da venda. Subir de faixa revaloriza o mês inteiro.
              </p>
            </div>
            <div className="grid gap-[var(--fin-s-4)] lg:grid-cols-2">
              {acumulados.map(a => (
                <div key={a.id} className={`${CARTAO} flex flex-col gap-2 p-[var(--fin-s-4)]`}>
                  <p className="fin-t-body-strong text-[var(--fin-text)]">{a.nome}</p>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">
                    {`${BRL(round2(a.base * (a.pct / 100)))} são ${a.pct}% de ${BRL(a.base)} de receita da agência.`}
                  </p>
                  {a.faixas.length > 0 ? (
                    <EscadaDeFaixas
                      modo="trilho"
                      faixas={a.faixas}
                      baseAcumulada={a.base}
                      posicao={a.posicao}
                      formatar={v => BRL(num(v))}
                      nome={a.nome}
                    />
                  ) : a.plano ? (
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {`Este plano paga ${num(a.plano.percentual_padrao)}% fixo sobre a base da venda, sem faixas.`}
                    </p>
                  ) : (
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      Sem plano de comissão: as vendas desta pessoa não geram comissão.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── A TABELA ────────────────────────────────────────────────────
            Cinco colunas, não nove, e a coluna de Ações — a razão de a tela
            existir — nunca sai da viewport no celular. */}
        <section className={`${CARTAO} overflow-hidden`}>
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">{`Comissões de ${nomeDoMes}`}</h2>
          </header>
          <FinTable
            linhas={filtered}
            colunas={colunas}
            chave={c => c.id}
            estado="ok"
            vazio={{
              motivo: filtrosAtivos > 0 ? 'sem-resultado' : 'sem-dado',
              titulo: filtrosAtivos > 0 ? 'O filtro não encontrou nenhuma comissão' : `Nenhuma comissão apurada em ${nomeDoMes}`,
              oQueE: 'A comissão nasce da venda confirmada, do plano da pessoa e da faixa que o acumulado do mês alcançou.',
              comoComeca: [
                'Confirme as vendas do mês',
                'Vincule cada pessoa a um plano de comissão',
                'Use "Recalcular" aqui embaixo',
              ],
              acao: { rotulo: 'Vendedores e planos', href: '/equipe/vendedores' },
            }}
            totais={[{ colunaId: 'valor', valor: somaPor(filtered, c => num(c.valor_comissao)), rotulo: 'Total do recorte' }]}
          />
        </section>

        {/* ── VENDAS TRAVADAS ─────────────────────────────────────────────
            Calculada na carga: antes esta fila só existia depois de clicar em
            Calcular, e sumia ao recarregar a página. */}
        {(travadas.length > 0 || pendencias.length > 0) && (
          <section className="flex flex-col gap-2">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">
              {`Vendas confirmadas de ${nomeDoMes} que não geraram comissão`}
            </h2>
            <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
              {[...travadas, ...pendencias].map(p => (
                <li key={`${p.id}-${p.motivo}`} className="flex min-h-[44px] flex-wrap items-center gap-3 py-3">
                  <p className="fin-t-body min-w-0 flex-1 text-[var(--fin-text-2)]">
                    {`Venda ${p.venda}: ${p.motivo}`}
                  </p>
                  <Link href="/equipe/vendedores" className="fin-t-body shrink-0 text-[var(--fin-accent)] underline underline-offset-2">
                    Vincular plano
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── RECALCULAR ──────────────────────────────────────────────────
            Ação secundária no rodapé, com o carimbo do último cálculo. */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BOTAO}
            disabled={calculating}
            onClick={() => setConfirmando({ tipo: 'recalcular' })}
          >
            <RefreshCw className={`h-4 w-4 ${calculating ? 'animate-spin' : ''}`} aria-hidden />
            {`Recalcular comissões de ${nomeDoMes}`}
          </button>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {ultimoCalculo
              ? `Último cálculo em ${ultimoCalculo.toLocaleDateString('pt-BR')} às ${ultimoCalculo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : `As comissões de ${nomeDoMes} ainda não foram recalculadas nesta sessão.`}
          </span>
        </div>
      </DataState>

      <ConfirmDialog
        aberto={confirmando !== null}
        onOpenChange={aberto => { if (!aberto) setConfirmando(null); }}
        titulo={confirmacao.titulo}
        oQueVaiAcontecer={confirmacao.oQue}
        detalhes={
          alvoDaConfirmacao
            ? [
                { rotulo: 'Pessoa', valor: alvoDaConfirmacao.vendedor_nome },
                ehComissaoDoCrm(alvoDaConfirmacao)
                  ? { rotulo: 'Mês', valor: `${nomeDaCompetencia(alvoDaConfirmacao.competencia ?? '')} (calculada pelo CRM)` }
                  : { rotulo: 'Venda', valor: alvoDaConfirmacao.venda_numero },
                { rotulo: 'Valor', valor: <Money valor={num(alvoDaConfirmacao.valor_comissao)} size="body" /> },
              ]
            : undefined
        }
        confirmarRotulo={confirmacao.rotulo}
        tone={confirmacao.tone}
        processando={processando}
        onConfirmar={executarConfirmacao}
      />

      {/* O detalhe da comissão do CRM: o dinheiro recebido, conta a conta. */}
      <RecordSheet
        aberto={detalhe !== null}
        onOpenChange={aberto => { if (!aberto) setDetalhe(null); }}
        titulo={detalhe ? `${detalhe.vendedor_nome}, ${nomeDaCompetencia(detalhe.competencia ?? '')}` : ''}
        descricao="O dinheiro recebido no mês sobre o qual o CRM calculou a comissão."
        acaoPrimaria={{ rotulo: 'Fechar', onClick: () => setDetalhe(null) }}
        acaoSecundaria={null}
        largura={640}
      >
        {detalhe && <DetalheDaComissaoDoCrm comissao={detalhe} />}
      </RecordSheet>
    </MolduraDaPagina>
  );
}

/** A lista recolhível das contas em dobro: aparece antes de qualquer mudança. */
function ListaDeDuplicadas({ itens, rotulo }: { itens: ContaDuplicada[]; rotulo: string }) {
  return (
    <details className="mt-2">
      <summary className="fin-t-body cursor-pointer text-[var(--fin-accent)] underline underline-offset-2">
        {rotulo}
      </summary>
      <ul className="mt-2 flex flex-col divide-y divide-[var(--fin-border)]">
        {itens.map(d => (
          <li key={d.conta_duplicada_id} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="fin-t-body text-[var(--fin-text)]">{d.vendedor || 'Vendedor sem nome'}</span>
              <span className="fin-t-caption block text-[var(--fin-text-3)]">
                {`Fica ${d.conta_mantida_id} (${d.status_da_mantida.toLowerCase()}); sai ${d.conta_duplicada_id}`}
              </span>
            </span>
            <Money valor={d.valor} size="body" />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** As contas recebidas que formaram a comissão do CRM. */
function DetalheDaComissaoDoCrm({ comissao }: { comissao: ComissaoVenda }) {
  const linhas = comissao.linhas ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="fin-t-body text-[var(--fin-text-2)]">
        {`${BRL(num(comissao.valor_comissao))} de comissão sobre ${BRL(num(comissao.valor_base))} recebidos (${num(comissao.percentual_aplicado)}% no total do mês).`}
      </p>
      {linhas.length === 0 ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">O CRM não mandou as contas deste mês.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
          {linhas.map((l, i) => (
            <li key={`${l.conta_id}-${l.dia}-${i}`} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="fin-t-body text-[var(--fin-text)]">{l.conta_nome || `Conta ${l.conta_id}`}</span>
                <span className="fin-t-caption block text-[var(--fin-text-3)]">
                  {[
                    `recebido em ${dataBR(l.dia)}`,
                    `${BRL(l.valor)} a ${num(l.percentual)}%`,
                    l.plano ? `plano ${l.plano}` : '',
                    l.provedor ? `via ${l.provedor}` : '',
                  ].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Money valor={l.comissao} size="body" />
            </li>
          ))}
        </ul>
      )}
      {comissao.apurado_em && (
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          {`Apurada pelo CRM em ${Number.isNaN(new Date(comissao.apurado_em).getTime())
            ? comissao.apurado_em
            : new Date(comissao.apurado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`}
        </p>
      )}
    </div>
  );
}
