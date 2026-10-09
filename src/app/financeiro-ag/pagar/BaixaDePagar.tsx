'use client';

import { useState } from 'react';

import type { ContaPagar } from '@/lib/crm-types';
import type { Anexo } from '@/components/fin/AnexoComprovante';
import { updateEntity } from '@/lib/crm-storage';
import { hojeISO, num, round2 } from '@/lib/money';
import { toast } from '@/lib/toast';
import { formatBRL } from '@/lib/utils';
import { DialogBaixa } from './DialogBaixa';
import { saldoDevedor, valorBRLDaConta } from './valores';

export type BaixaDePagarProps = {
  /** A conta a pagar; null fecha o diálogo. */
  conta: ContaPagar | null;
  onFechar: () => void;
  /** Depois de gravar: a tela recarrega o que mostra. */
  onRegistrada?: () => void;
};

/**
 * A baixa de uma conta a pagar, num lugar só.
 *
 * A tela de contas a pagar e a visão geral abrem ESTE componente: não existe
 * um segundo caminho de baixa, e a regra (parcial acumula, comprovante da
 * baixa soma aos anteriores) vive aqui.
 */
export function BaixaDePagar({ conta, onFechar, onRegistrada }: BaixaDePagarProps) {
  const [form, setForm] = useState<{ dataPagamento: string; valorPago: number; observacao: string; anexos: Anexo[] } | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [pagando, setPagando] = useState(false);

  // Conta nova abre com hoje e o saldo devedor (não o valor cheio, para a
  // baixa de conta PARCIAL). Ajuste na renderização, sem efeito.
  const chave = conta?.id ?? null;
  if (chave !== alvo) {
    setAlvo(chave);
    setEnviandoAnexo(false);
    setForm(conta ? { dataPagamento: hojeISO(), valorPago: saldoDevedor(conta), observacao: '', anexos: [] } : null);
  }

  async function confirmar() {
    if (!conta || !form || pagando) return;
    const pagoAgora = round2(num(form.valorPago));
    if (pagoAgora <= 0) { toast.error('Valor pago deve ser maior que zero'); return; }

    const devido = valorBRLDaConta(conta);
    // Baixa parcial ACUMULA sobre o que já foi pago antes, nunca substitui,
    // senão o restante da dívida some do sistema.
    const acumulado = round2(num(conta.valor_pago) + pagoAgora);
    const restante = round2(devido - acumulado);
    const quitado = restante <= 0.005;

    setPagando(true);
    try {
      // Acumula: baixa parcial pode ter comprovante em cada parcela, e o
      // anexo de uma não pode apagar o da outra.
      const anexosFinais = [...(conta.anexos ?? []), ...form.anexos];
      const atualizada: ContaPagar = {
        ...conta,
        status: quitado ? 'PAGO' : 'PARCIAL',
        data_pagamento: form.dataPagamento,
        valor_pago: acumulado,
        observacoes: form.observacao ? `${conta.observacoes ? conta.observacoes + ' · ' : ''}${form.observacao}` : conta.observacoes,
        anexos: anexosFinais,
        // `comprovante` guarda o mais recente, para quem lê um campo só.
        comprovante: form.anexos.length > 0 ? form.anexos[form.anexos.length - 1].url : conta.comprovante,
      };
      await updateEntity('contas-pagar', atualizada);
      if (quitado) {
        toast.success('Pagamento confirmado', `${conta.fornecedor_nome} · ${formatBRL(pagoAgora)}`);
      } else {
        toast.success('Pagamento em parte registrado', `${conta.fornecedor_nome} · pago ${formatBRL(pagoAgora)} · saldo ${formatBRL(restante)}`);
      }
      onFechar();
      onRegistrada?.();
    } catch (e) {
      toast.error('Não foi possível registrar o pagamento.', e instanceof Error ? e.message : '');
    } finally {
      setPagando(false);
    }
  }

  return (
    <DialogBaixa
      item={conta}
      dataPagamento={form?.dataPagamento ?? ''}
      valorPago={form?.valorPago ?? 0}
      observacao={form?.observacao ?? ''}
      onDataPagamento={v => setForm(f => (f ? { ...f, dataPagamento: v } : f))}
      onValorPago={v => setForm(f => (f ? { ...f, valorPago: v } : f))}
      onObservacao={v => setForm(f => (f ? { ...f, observacao: v } : f))}
      anexos={form?.anexos ?? []}
      onAnexos={v => setForm(f => (f ? { ...f, anexos: v } : f))}
      onEnviandoAnexo={setEnviandoAnexo}
      enviandoAnexo={enviandoAnexo}
      valorDaConta={conta ? valorBRLDaConta(conta) : 0}
      jaPago={conta ? num(conta.valor_pago) : 0}
      saldoDevedor={conta ? saldoDevedor(conta) : 0}
      restanteDepois={conta && form ? round2(saldoDevedor(conta) - round2(num(form.valorPago))) : 0}
      pagando={pagando}
      onFechar={onFechar}
      onConfirmar={() => { void confirmar(); }}
    />
  );
}

export default BaixaDePagar;
