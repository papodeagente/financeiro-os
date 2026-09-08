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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calculator, Check, DollarSign, RefreshCw, Clock, CheckCircle2,
  Banknote, Trash2, AlertTriangle, CalendarClock,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_BADGE: Record<StatusComissao, string> = {
  CALCULADA: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  APROVADA: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
  PAGA: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
  CANCELADA: 'bg-[var(--t-surface)] text-[var(--t-text-muted)]',
};

/** Id determinístico da comissão: 1 comissão por (venda, vendedor).
 *  O POST do CRUD é upsert por id, então recalcular nunca duplica. */
function comissaoId(vendaId: string, vendedorId: string): string {
  return `comissao-${vendaId}-${vendedorId}`;
}

/** Id determinístico da conta a pagar da comissão. Aprovar duas vezes
 *  atualiza a MESMA conta em vez de criar uma segunda: é o que impede a
 *  agência de programar o mesmo pagamento duas vezes. */
function contaPagarComissaoId(comissao: ComissaoVenda): string {
  return `pagar-${comissao.id}`;
}

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
  const [filterMonth, setFilterMonth] = useState(() => mesDe(hojeISO()));
  /** Dias do mês em que a agência paga comissão (Configurações > Agência). */
  const [agendaPagamento, setAgendaPagamento] = useState<number[]>([]);
  /** Contas a pagar já programadas pela aprovação, para o pagamento baixar
   *  a existente em vez de criar uma segunda. */
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);

  async function load() {
    setLoading(true);
    const [c, v, m, p, pc, ag, cps] = await Promise.all([
      loadEntities<ComissaoVenda>('comissoes'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEquipe<Membro>(),
      loadEntities<PlanoComissao>('planos-comissao'),
      loadEntities<PlanoContas>('plano-contas'),
      loadAgencia<Agencia>(),
      loadEntities<ContaPagar>('contas-pagar'),
    ]);
    setComissoes(c);
    setVendas(v);
    setMembros(m);
    setPlanos(p);
    setPlanoContas(pc);
    setAgendaPagamento(ag?.datas_pagamento_comissao ?? []);
    setContasPagar(cps);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

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

    return { erro: 'venda sem custo de fornecedor e sem comissão apurada — base viraria o faturamento bruto' };
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
    // Feito antes de tudo: essas comissões saem do acumulado do mês.
    for (const c of comissoes) {
      if (c.status === 'CANCELADA') continue;
      const venda = vendasById.get(c.venda_id);
      if (venda && venda.status !== 'CANCELADO') continue;

      const motivo = venda ? 'venda cancelada' : 'venda removida';
      if (c.status === 'PAGA') {
        pend.push({ id: c.id, venda: c.venda_numero, motivo: `${motivo} com comissão JÁ PAGA — estornar manualmente` });
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
      comissoes.filter(c => c.status !== 'CANCELADA').map(c => [c.venda_id, c]),
    );

    const elegiveis = vendas.filter(v =>
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
            ? `acumulado do mês ${BRL(resultado.base_acumulada)} subiu a faixa para ${nova.percentual_aplicado}% — complemento de ${BRL(diferenca)} devido (comissão ${anterior.status} mantida em ${BRL(num(anterior.valor_comissao))})`
            : diferenca < 0
              ? `acumulado do mês caiu para ${BRL(resultado.base_acumulada)} (faixa ${nova.percentual_aplicado}%) — pago ${BRL(Math.abs(diferenca))} a mais (comissão ${anterior.status} mantida)`
              : `venda mudou de valor — base gravada ${BRL(num(anterior.valor_base))} × base atual ${BRL(nova.valor_base)} (comissão ${anterior.status} mantida)`;
          pend.push({ id: anterior.id, venda: anterior.venda_numero, motivo });
        }
      }
    }

    setPendencias(pend);
    setCalculating(false);
    load();
  }

  /** Monta a conta a pagar da comissão. Uma função só, usada pela aprovação
   *  (que programa) e pelo pagamento (que baixa), para as duas nunca
   *  divergirem em categoria, natureza ou vínculo. */
  function montarContaComissao(c: ComissaoVenda, vencimento: string): ContaPagar {
    const valor = round2(num(c.valor_comissao));

    // origem 'OUTROS' (não 'VENDA') porque o DRE exclui CP auto-gerada de
    // venda como repasse ao fornecedor — comissão não é repasse.
    const categoriaComercial = planoContas.find(
      p => p.tipo === 'DESPESA' && p.ativo && p.codigo.startsWith('2.6')
    ) ?? planoContas.find(p => p.tipo === 'DESPESA' && p.ativo && p.is_custo_comercial);

    return {
      ...createContaPagar(),
      id: contaPagarComissaoId(c),
      origem: 'OUTROS',
      venda_id: c.venda_id || null,
      fornecedor_id: c.vendedor_id,
      fornecedor_nome: c.vendedor_nome,
      descricao: `Comissão ${c.vendedor_nome} — venda ${c.venda_numero}`,
      categoria_id: categoriaComercial?.id ?? '',
      valor_original: valor,
      valor_final: valor,
      valor_brl: valor,
      data_emissao: hojeISO(),
      data_vencimento: vencimento,
      natureza_custo: 'VARIAVEL',
      is_custo_comercial: true,
      // Nasce PENDENTE de propósito: o POST do CRUD genérico grava o registro
      // mas NÃO move o caixa. Gravar 'PAGO' aqui deixaria o saldo bancário sem
      // o débito e — pior — a exclusão dessa conta chamaria o estorno, que
      // CREDITARIA um dinheiro que nunca saiu. A baixa vem só pelo PUT, que é
      // o único caminho que debita o saldo.
      status: 'PENDENTE',
      data_pagamento: null,
      valor_pago: null,
      origem_venda_id: c.venda_id,
      auto_gerado: true,
      // ContaPagar não tem campo origem_comissao_id — o vínculo fica aqui.
      observacoes: `Gerada automaticamente pela aprovação da comissão (origem_comissao_id=${c.id}).`,
    };
  }

  /** Aprovar a comissão PROGRAMA o pagamento: cria a conta a pagar pendente
   *  vencendo na próxima data da agenda da agência. É o que faz a comissão
   *  aparecer no fluxo de caixa antes de o dinheiro sair.
   *
   *  Sem agenda configurada nada é programado, e a tela diz isso. Inventar
   *  uma data aqui colocaria uma saída de dinheiro no dia errado. */
  async function handleAprovar(c: ComissaoVenda) {
    const hoje = hojeISO();
    const vencimento = proximaDataPagamento(agendaPagamento, hoje);

    await updateEntity('comissoes', { ...c, status: 'APROVADA', data_aprovacao: hoje });

    if (vencimento) {
      // Upsert por id determinístico: aprovar de novo atualiza a mesma conta.
      await saveEntity('contas-pagar', montarContaComissao(c, vencimento));
    }
    load();
  }

  /** Pagar NÃO cria conta: baixa a que a aprovação já programou. Se a
   *  comissão foi aprovada sem agenda configurada, a conta não existe
   *  ainda e é criada aqui vencendo hoje, para o caminho antigo continuar
   *  funcionando. A baixa é sempre pelo PUT, único caminho que debita o
   *  saldo, e a rota tem guarda de idempotência. */
  async function handlePagar(c: ComissaoVenda) {
    const hoje = hojeISO();
    const valor = round2(num(c.valor_comissao));

    await updateEntity('comissoes', { ...c, status: 'PAGA', data_pagamento: hoje });

    const contaId = contaPagarComissaoId(c);
    const jaProgramada = contasPagar.find(cp => cp.id === contaId);
    const conta = jaProgramada ?? montarContaComissao(c, hoje);

    if (!jaProgramada) {
      await saveEntity('contas-pagar', conta);
    }

    await updateEntity('contas-pagar', {
      ...conta,
      status: 'PAGO',
      data_pagamento: hoje,
      valor_pago: valor,
    });
    load();
  }

  async function handleCancelar(c: ComissaoVenda) {
    await updateEntity('comissoes', { ...c, status: 'CANCELADA' });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir comissão?')) return;
    try {
      await deleteEntity('comissoes', id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível excluir.');
      return;
    }
    load();
  }

  /** Acumulado do mês por vendedor, com a faixa que ele alcançou. Existe
   *  porque a alíquota da linha não se explica sozinha: ela vem da soma do
   *  mês, e não daquela venda. */
  const acumuladoPorVendedor = useMemo(() => {
    const mapa = new Map<string, { nome: string; base: number; pct: number; vendas: number }>();
    for (const c of comissoes) {
      if (c.status === 'CANCELADA') continue;
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

  const stats = useMemo(() => {
    const porStatus = (s: StatusComissao) =>
      somaPor(comissoes.filter(c => c.status === s), c => c.valor_comissao);
    return { calculadas: porStatus('CALCULADA'), aprovadas: porStatus('APROVADA'), pagas: porStatus('PAGA') };
  }, [comissoes]);

  const STATUSES: Array<StatusComissao | 'TODOS'> = ['TODOS', 'CALCULADA', 'APROVADA', 'PAGA', 'CANCELADA'];

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Comissões</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Cálculo e gestão de comissões por venda</p>
          </div>
          <Button onClick={handleCalcular} disabled={calculating}
            className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
            <RefreshCw className={`w-4 h-4 mr-2 ${calculating ? 'animate-spin' : ''}`} />
            {calculating ? 'Calculando...' : 'Calcular Comissões'}
          </Button>
        </div>

        {/* Banner: agenda de pagamento. Diz de antemão o que aprovar vai
            fazer, porque aprovar passou a programar saída de dinheiro. */}
        {agendaPagamento.length === 0 ? (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <CalendarClock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--t-text)]">
                Nenhuma data de pagamento de comissão configurada
              </p>
              <p className="text-xs text-[var(--t-text-secondary)] mt-0.5">
                Enquanto não houver agenda, aprovar uma comissão não programa a conta a pagar, e o
                valor só entra no caixa quando você clicar em Pagar.
              </p>
              <a
                href="/config/agencia#pagamento-comissao"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--t-green)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                Definir datas de pagamento
              </a>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--t-blue-bg)] border border-[var(--t-blue)]/20">
            <CalendarClock className="w-5 h-5 text-[var(--t-blue)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--t-text)]">
                Comissão aprovada vira conta a pagar programada
              </p>
              <p className="text-xs text-[var(--t-text-secondary)] mt-0.5">
                A agência paga comissão {descreverAgenda(agendaPagamento)}. Aprovada hoje, a conta
                vence em{' '}
                <strong>
                  {(() => {
                    const d = dataLocal(proximaDataPagamento(agendaPagamento, hojeISO()));
                    return d ? d.toLocaleDateString('pt-BR') : 'sem data';
                  })()}
                </strong>{' '}
                e já aparece no fluxo de caixa. Pagar apenas dá baixa nela.
              </p>
            </div>
          </div>
        )}

        {/* Banner: sem plano de comissão */}
        {planos.length === 0 && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Calculator className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--t-text)]">Nenhum Plano de Comissão configurado</p>
              <p className="text-xs text-[var(--t-text-secondary)] mt-0.5">Crie um plano com regras de comissão para que o botão &quot;Calcular Comissões&quot; funcione corretamente.</p>
            </div>
          </div>
        )}

        {/* Banner: vendas que NÃO geraram comissão (config faltando ou base
            não confiável) e comissões divergentes da venda atual */}
        {pendencias.length > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--t-text)]">
                {pendencias.length} venda(s) sem comissão gerada ou com divergência
              </p>
              <ul className="mt-1 space-y-0.5">
                {pendencias.map(p => (
                  <li key={p.id} className="text-xs text-[var(--t-text-secondary)]">
                    <span className="font-mono">{p.venda || '—'}</span>: {p.motivo}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <Clock className="w-8 h-8 text-[var(--t-amber)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">A Aprovar</p>
                <p className="text-xl font-bold text-[var(--t-amber)]">{BRL(stats.calculadas)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <CheckCircle2 className="w-8 h-8 text-[var(--t-blue)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Aprovadas</p>
                <p className="text-xl font-bold text-[var(--t-blue)]">{BRL(stats.aprovadas)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <Banknote className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Pagas</p>
                <p className="text-xl font-bold text-[var(--t-green)]">{BRL(stats.pagas)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as StatusComissao | 'TODOS')}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Vendedor</label>
              <select value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                <option value="">Todos</option>
                {membros.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Mês</label>
              <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]" />
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[var(--t-green)]" />
              Comissões ({filtered.length})
            </CardTitle>
            {acumuladoPorVendedor.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                {acumuladoPorVendedor.map(a => (
                  <p key={a.nome} className="text-xs text-[var(--t-text-secondary)]">
                    <span className="font-medium text-[var(--t-text)]">{a.nome}</span>
                    {' acumulou '}
                    <span className="font-medium text-[var(--t-text)]">{BRL(a.base)}</span>
                    {' em '}{a.vendas}{a.vendas === 1 ? ' venda' : ' vendas'}
                    {' e está na faixa de '}
                    <span className="font-medium text-[var(--t-green)]">{a.pct}%</span>
                  </p>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-[var(--t-text-secondary)] text-sm p-6">Carregando...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8">
                <DollarSign className="w-10 h-10 text-[var(--t-text-muted)] mx-auto mb-3" />
                <p className="text-[var(--t-text-muted)] text-sm">Nenhuma comissão encontrada.</p>
                <p className="text-[var(--t-text-muted)] text-xs mt-1">Clique em &quot;Calcular Comissões&quot; para gerar a partir das vendas confirmadas.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                      <th className="text-left px-4 py-3">Vendedor</th>
                      <th className="text-left px-4 py-3">Venda</th>
                      <th className="text-left px-4 py-3">Data</th>
                      <th className="text-right px-4 py-3">Base</th>
                      <th className="text-center px-4 py-3">%</th>
                      <th className="text-right px-4 py-3">Comissão</th>
                      <th className="text-left px-4 py-3">Plano</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(c => (
                      <tr key={c.id} className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] transition-colors">
                        <td className="px-4 py-3 font-medium text-[var(--t-text)]">{c.vendedor_nome}</td>
                        <td className="px-4 py-3 text-[var(--t-text-secondary)] font-mono text-xs">{c.venda_numero}</td>
                        <td className="px-4 py-3 text-[var(--t-text-secondary)]">
                          {dataLocal(c.data_venda)?.toLocaleDateString('pt-BR') ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--t-text-secondary)]">{BRL(c.valor_base)}</td>
                        <td className="px-4 py-3 text-center text-[var(--t-text-secondary)]">{c.percentual_aplicado}%</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[var(--t-green)]">{BRL(c.valor_comissao)}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-[var(--t-text-muted)]">{c.plano_nome}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`${STATUS_BADGE[c.status]} border-0 text-xs`}>{c.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {c.status === 'CALCULADA' && (
                              <Button size="sm" onClick={() => handleAprovar(c)}
                                className="bg-[var(--t-blue)] hover:brightness-110 text-white h-7 px-2 text-xs">
                                <Check className="w-3 h-3 mr-1" /> Aprovar
                              </Button>
                            )}
                            {c.status === 'APROVADA' && (
                              <Button size="sm" onClick={() => handlePagar(c)}
                                className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] h-7 px-2 text-xs">
                                <Banknote className="w-3 h-3 mr-1" /> Pagar
                              </Button>
                            )}
                            {(c.status === 'CALCULADA' || c.status === 'APROVADA') && (
                              <Button size="sm" variant="outline" onClick={() => handleCancelar(c)}
                                className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 px-2 text-xs">Cancelar</Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => handleDelete(c.id)}
                              className="border-[var(--t-red)]/30 text-[var(--t-red)] h-7 px-2">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
