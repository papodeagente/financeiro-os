'use client';

import { useEffect, useMemo, useState } from 'react';

import { loadEntities } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import { hojeISO, num, round2 } from '@/lib/money';
import { generateId } from '@/lib/utils';
import {
  calcularEncargos,
  planoDaBaixa,
  type PoliticaCobranca,
  type TituloParaBaixa,
  type TituloTabela,
  type TratamentoDiferenca,
} from '@/lib/baixa-calculo';
import { formaDoValor, opcoesDeForma, type FormaPagamento } from '@/lib/formas-pagamento';
import type { BlocoDeLiquidacaoProps, ContaOpcao } from './BlocoDeLiquidacao';
import { useFormasDePagamento } from './useFormasDePagamento';

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
) {
  const [contas, setContas] = useState<ContaOpcao[]>([]);
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

  useEffect(() => {
    let vivo = true;
    loadEntities<{ id: string; nome?: string }>('contas-bancarias')
      .then(l => { if (vivo) setContas(l.map(c => ({ id: c.id, nome: c.nome || 'Conta' }))); })
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

  const pedido = { valor: valorPago, data, juros: j, multa: m, desconto: ds, taxa, tratamento_diferenca: tratamento };
  const plano = t ? planoDaBaixa(t, pedido) : planoDaBaixa(paraBaixa(tabela, { id: '' }), { valor: 0, data });
  const bruto = t ? round2(round2(valorPago) - round2(plano.saldo_antes + j + m - ds)) : 0;

  const contaTravadaMotivo = contaTravada
    ? 'As parcelas desta conta entram na mesma conta bancária das anteriores.'
    : null;
  const sentido = tabela === 'contas_receber' ? 'receber' : 'pagar';

  const bloco: BlocoDeLiquidacaoProps = {
    sentido: tabela === 'contas_receber' ? 'recebimento' : 'pagamento',
    data, onData: setData,
    contas, contaId, onConta: setContaEscolhida, contaTravadaMotivo,
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
          ...extras,
          esperado: { status_depois: plano.status_depois, valor_baixado_depois: plano.valor_baixado_depois },
        }],
    };
    const res = await fetch('/api/baixas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': chave },
      body: JSON.stringify(corpoDoPedido),
    });
    const corpo = (await res.json().catch(() => ({}))) as {
      error?: string; pedir_aprovacao?: { tipo: 'limites' | 'pagamento'; conta_pagar_id?: string; status?: string };
    };
    if (res.status === 409 && corpo.pedir_aprovacao) {
      oferecerAprovacao(corpo.error || 'Precisa de aprovação.', corpo.pedir_aprovacao, corpoDoPedido);
      throw new AguardandoAprovacao(corpo.error || 'Precisa de aprovação.');
    }
    if (!res.ok) throw new Error(corpo.error || `Erro ${res.status}`);
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
