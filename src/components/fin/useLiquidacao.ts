'use client';

import { useEffect, useMemo, useState } from 'react';

import { loadEntities } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import { levarParaSegundoFator, lembrarSegundoFator, type RespostaComSegundoFator } from './segundoFatorNaTela';
import { hojeISO, num, round2 } from '@/lib/money';
import { generateId } from '@/lib/utils';
import {
  baseDosEncargos,
  calcularEncargos,
  planoDaBaixa,
  type PoliticaCobranca,
  type TituloParaBaixa,
  type TituloTabela,
  type TratamentoDiferenca,
} from '@/lib/baixa-calculo';
import { formaDoValor, opcoesDeForma, type FormaPagamento } from '@/lib/formas-pagamento';
import { formaEhCartao, formaEhCheque } from '@/lib/baixa-meio';
import { contasParaEscolher } from '@/lib/contas-bancarias-regras';
import type { BlocoDeLiquidacaoProps, ContaOpcao } from './BlocoDeLiquidacao';
import { useFormasDePagamento } from './useFormasDePagamento';
import { cambioDaLiquidacao, moedaDe, valorNaMoedaDoTitulo, type CarimboDoCambio } from '@/lib/cambio';

type Titulo = Record<string, unknown> & { id: string };

function paraBaixa(tabela: TituloTabela, d: Titulo): TituloParaBaixa {
  const status = String(d.status ?? 'PENDENTE');
  const campo = tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago';
  const baixado = status === 'PARCIAL'
    ? round2(num(d[campo]))
    : status === 'RECEBIDO' || status === 'PAGO' ? round2(num(d[campo]) || num(d.valor_final)) : 0;
  return {
    tabela, status,
    valor_final: round2(num(d.valor_final) || num(d.valor_brl)),
    valor_baixado: baixado,
    data_vencimento: String(d.data_vencimento ?? ''),
    juros: num(d.juros), multa: num(d.multa), desconto: num(d.desconto),
    valor_base_encargos: d.valor_base_encargos == null ? null : num(d.valor_base_encargos),
    conta_bancaria_id: (d.conta_bancaria_id as string | null | undefined) || null,
    ...(num(d.variacao_cambial) !== 0 ? { variacao_cambial: num(d.variacao_cambial) } : {}),
  };
}

/**
 * Estado e regra de uma liquidação na tela (05/11/2026). O plano mostrado é
 * o mesmo que o servidor refaz antes de gravar; se o título mudar no meio,
 * o servidor recusa e a tela pede para abrir de novo.
 */
export function useLiquidacao(
  tabela: TituloTabela,
  titulo: Titulo | null,
  valorPago: number,
  /** Taxa retida, ou a conta dela a partir da forma escolhida (05/11/2026). */
  taxaOuConta: number | ((forma: FormaPagamento | null) => number) = 0,
  /** Preenche o valor pago (o "usar o valor pelo câmbio" chama). */
  onValorPago?: (v: number) => void,
) {
  const [contas, setContas] = useState<Array<ContaOpcao & { ativo?: unknown }>>([]);
  const [politica, setPolitica] = useState<PoliticaCobranca | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [data, setData] = useState(hojeISO());
  // undefined = a pessoa ainda não escolheu: vale a conta da conta a pagar/
  // receber e, sem ela, a conta padrão da forma de pagamento.
  const [contaEscolhida, setContaEscolhida] = useState<string | null | undefined>(undefined);
  const [forma, setForma] = useState('');
  const formas = useFormasDePagamento();
  const [juros, setJuros] = useState<number | null>(null);
  const [multa, setMulta] = useState<number | null>(null);
  const [desconto, setDesconto] = useState<number | null>(null);
  const [tratamento, setTratamento] = useState<TratamentoDiferenca>('deixar_aberto');
  const [chave, setChave] = useState(generateId());
  // Câmbio do pagamento, só para conta lançada em moeda (05/11/2026, E6).
  const [cambio, setCambio] = useState(0);
  const [cambioCarimbo, setCambioCarimbo] = useState<CarimboDoCambio | null>(null);
  // Cheque e cartão (06/11/2026, E7): nunca o número completo do cartão.
  const [cheque, setCheque] = useState('');
  const [ultimos4, setUltimos4] = useState('');
  const [autorizacao, setAutorizacao] = useState('');

  useEffect(() => {
    let vivo = true;
    loadEntities<{ id: string; nome?: string; moeda?: string }>('contas-bancarias')
      .then(l => { if (vivo) setContas(l.map(c => ({ id: c.id, nome: c.nome || 'Conta', moeda: moedaDe(c.moeda), ativo: (c as { ativo?: unknown }).ativo }))); })
      .catch(() => undefined);
    fetch('/api/config/financeiro')
      .then(r => (r.ok ? r.json() : null))
      .then((c: { politica_cobranca?: PoliticaCobranca | null } | null) => { if (vivo && c) setPolitica(c.politica_cobranca ?? null); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  // Título novo: reinicia tudo (ajuste na renderização, sem piscar o anterior).
  const id = titulo?.id ?? null;
  if (id !== alvo) {
    setAlvo(id);
    setData(hojeISO());
    setContaEscolhida(undefined);
    setForma(titulo ? String((tabela === 'contas_receber' ? titulo.forma_recebimento : titulo.forma_pagamento) ?? '') : '');
    setJuros(null); setMulta(null); setDesconto(null);
    setTratamento('deixar_aberto');
    setChave(generateId());
    setCambio(0);
    setCambioCarimbo(null);
    setCheque(''); setUltimos4(''); setAutorizacao('');
  }

  const t = titulo ? paraBaixa(tabela, titulo) : null;
  const formaEscolhida: FormaPagamento | null = formaDoValor(forma, formas);
  const taxa = typeof taxaOuConta === 'function' ? taxaOuConta(formaEscolhida) : taxaOuConta;
  const contaTravada = Boolean(t && t.valor_baixado > 0 && t.conta_bancaria_id);
  const contaId: string | null = contaTravada
    ? (t?.conta_bancaria_id ?? null)
    : contaEscolhida !== undefined
      ? contaEscolhida
      : (t?.conta_bancaria_id || formaEscolhida?.conta_bancaria_id || null);
  const sugeridos = useMemo(
    () => (t ? calcularEncargos(t, data, politica) : { dias_atraso: 0, juros: 0, multa: 0, desconto_antecipacao: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t?.valor_final, t?.valor_baixado, t?.data_vencimento, data, politica],
  );
  // Sem a pessoa mexer, vale a sugestão da política.
  const j = juros ?? sugeridos.juros;
  const m = multa ?? sugeridos.multa;
  const ds = desconto ?? sugeridos.desconto_antecipacao;

  // Câmbio: a mesma conta que o servidor faz (cambioDaLiquidacao).
  const moedaConta = moedaDe(contas.find(c => c.id === contaId)?.moeda);
  const naMoeda = titulo && t ? valorNaMoedaDoTitulo(titulo, baseDosEncargos(t)) : null;
  const cambioCalc = titulo && t && naMoeda
    ? cambioDaLiquidacao({
      tabela, titulo, base_reais: baseDosEncargos(t), valor_baixado: t.valor_baixado,
      valor: valorPago, juros: j, multa: m, desconto: ds, cambio_pago: cambio, moeda_conta: moedaConta,
    })
    : null;
  const variacao = cambioCalc?.variacao.variacao ?? 0;

  const pedido = {
    valor: valorPago, data, juros: j, multa: m, desconto: ds, taxa, tratamento_diferenca: tratamento,
    ...(variacao !== 0 ? { variacao_cambial: variacao } : {}),
  };
  const plano = t ? planoDaBaixa(t, pedido) : planoDaBaixa(paraBaixa(tabela, { id: '' }), { valor: 0, data });
  const bruto = t ? round2(round2(valorPago) - round2(plano.saldo_antes + j + m - ds + variacao)) : 0;
  // Valor em reais pelo câmbio informado: o que falta na moeda × câmbio + encargos.
  const saldoMoedaAgora = cambioCalc?.saldo_moeda ?? null;
  const valorPeloCambio = naMoeda && cambio > 0 && saldoMoedaAgora !== null
    ? round2(round2(saldoMoedaAgora * cambio) + j + m - ds)
    : null;

  const contaTravadaMotivo = contaTravada
    ? 'As parcelas desta conta entram na mesma conta bancária das anteriores.'
    : null;
  const sentido = tabela === 'contas_receber' ? 'receber' : 'pagar';
  const tipoDoMeio = formaEhCheque(forma) ? 'cheque' as const : formaEhCartao(forma) ? 'cartao' as const : null;
  const meio = {
    ...(tipoDoMeio === 'cheque' && cheque ? { cheque_numero: cheque } : {}),
    ...(tipoDoMeio === 'cartao' && ultimos4 ? { cartao_ultimos4: ultimos4 } : {}),
    ...(tipoDoMeio === 'cartao' && autorizacao.trim() ? { cartao_autorizacao: autorizacao.trim() } : {}),
  };

  const bloco: BlocoDeLiquidacaoProps = {
    sentido: tabela === 'contas_receber' ? 'recebimento' : 'pagamento',
    data, onData: setData,
    // Conta desativada some da escolha (a que o título já usa continua).
    contas: contasParaEscolher(contas, contaId), contaId, onConta: setContaEscolhida, contaTravadaMotivo,
    formas: opcoesDeForma(formas, sentido, forma),
    forma,
    // Trocar a forma volta a conta para a padrão dela (se a pessoa não
    // tinha escolhido outra de propósito, a conta segue a forma).
    onForma: v => { setForma(v); setContaEscolhida(undefined); },
    contaDaForma: Boolean(!contaTravada && contaEscolhida === undefined && !t?.conta_bancaria_id && formaEscolhida?.conta_bancaria_id),
    juros: j, multa: m, desconto: ds,
    onJuros: setJuros, onMulta: setMulta, onDesconto: setDesconto,
    sugeridos, tratamento, onTratamento: setTratamento,
    plano, diferencaBruta: bruto,
    ...(tipoDoMeio ? {
      meio: {
        tipo: tipoDoMeio, cheque, ultimos4, autorizacao,
        onCheque: setCheque, onUltimos4: setUltimos4, onAutorizacao: setAutorizacao,
      },
    } : {}),
    ...(naMoeda ? {
      cambio: {
        moeda: naMoeda.moeda,
        valor: cambio,
        carimbo: cambioCarimbo,
        onChange: (v: number, k: CarimboDoCambio) => { setCambio(v); setCambioCarimbo(k); },
        cambio_lancado: naMoeda.cambio,
        saldo_moeda: saldoMoedaAgora ?? naMoeda.valor,
        variacao: cambioCalc?.variacao ?? null,
        valor_pelo_cambio: valorPeloCambio,
        onUsarValor: onValorPago && valorPeloCambio !== null && valorPeloCambio !== round2(valorPago) ? () => onValorPago(valorPeloCambio) : undefined,
        moeda_conta: moedaConta,
        caixa_na_moeda: cambioCalc?.caixa_na_moeda ?? null,
        lado: tabela === 'contas_receber' ? 'compra' as const : 'venda' as const,
      },
    } : {}),
  };

  /** Grava no servidor. Repetir (duplo clique) não grava duas vezes. */
  async function gravar(extras: { forma?: string; observacao?: string; anexos?: Array<Record<string, unknown>>; taxa_plataforma?: string } = {}) {
    if (!titulo) throw new Error('Nenhuma conta selecionada.');
    const corpoDoPedido = {
        modo: 'gravar',
        itens: [{
          titulo_tabela: tabela, titulo_id: titulo.id, data, conta_bancaria_id: contaId,
          valor: round2(valorPago), juros: j, multa: m, desconto: ds, taxa, tratamento_diferenca: tratamento,
          ...(forma ? { forma } : {}),
          ...(naMoeda && cambio > 0 ? { cambio, cambio_carimbo: cambioCarimbo } : {}),
          ...meio,
          ...extras,
          esperado: { status_depois: plano.status_depois, valor_baixado_depois: plano.valor_baixado_depois },
        }],
    };
    const res = await fetch('/api/baixas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': chave },
      body: JSON.stringify(corpoDoPedido),
    });
    const corpo = (await res.json().catch(() => ({}))) as RespostaComSegundoFator & {
      error?: string; pedir_aprovacao?: { tipo: 'limites' | 'pagamento'; conta_pagar_id?: string; status?: string };
    };
    if (res.status === 409 && corpo.pedir_aprovacao) {
      oferecerAprovacao(corpo.error || 'Precisa de aprovação.', corpo.pedir_aprovacao, corpoDoPedido);
      throw new AguardandoAprovacao(corpo.error || 'Precisa de aprovação.');
    }
    // Sem a verificação em duas etapas (E7): o aviso leva a Meu perfil. A tela
    // trata como o pedido de aprovação: nada mais a mostrar.
    if (levarParaSegundoFator(res.status, corpo)) throw new AguardandoAprovacao(corpo.error || 'Ative a verificação em duas etapas.');
    if (!res.ok) throw new Error(corpo.error || `Erro ${res.status}`);
    lembrarSegundoFator(corpo);
    return plano;
  }

  /**
   * Fora dos limites ou acima da alçada: o aviso traz o botão que abre o
   * pedido. Quem aprova vê em Financeiro › Aprovações; aprovada, a baixa
   * é registrada sozinha (limites) ou o pagamento fica liberado (alçada).
   */
  function oferecerAprovacao(
    motivo: string,
    pedir: { tipo: 'limites' | 'pagamento'; conta_pagar_id?: string; status?: string },
    corpoDoPedido: Record<string, unknown>,
  ) {
    if (pedir.tipo === 'pagamento' && pedir.status === 'PENDENTE') {
      toast.info('Pagamento aguardando aprovação.', 'Quando for aprovado, registre o pagamento de novo.');
      return;
    }
    toast.comAcao('Precisa de aprovação', motivo, {
      rotulo: 'Pedir aprovação',
      onClick: () => {
        const req = pedir.tipo === 'pagamento'
          ? fetch('/api/aprovacoes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao: 'pedir_pagamento', conta_pagar_id: pedir.conta_pagar_id }),
          })
          : fetch('/api/baixas', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': chave },
            body: JSON.stringify({ ...corpoDoPedido, pedir_aprovacao: true }),
          });
        void req.then(async r => {
          const c = (await r.json().catch(() => ({}))) as { error?: string };
          if (!r.ok) { toast.error('Não foi possível pedir aprovação.', c.error || `Erro ${r.status}`); return; }
          toast.success('Pedido de aprovação enviado.', pedir.tipo === 'pagamento'
            ? 'Quando for aprovado, registre o pagamento.'
            : 'A baixa é registrada sozinha quando for aprovada.');
        }).catch(() => toast.error('Não foi possível pedir aprovação.'));
      },
    });
  }

  return { bloco, plano, gravar, forma, formaEscolhida };
}

/** A baixa não foi gravada: espera aprovação. O aviso já foi mostrado. */
export class AguardandoAprovacao extends Error {}
