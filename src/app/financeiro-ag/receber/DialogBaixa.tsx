'use client';

import { useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Money } from '@/components/fin/Money';
import { MoneyField } from '@/components/fin/MoneyField';
import { round2 } from '@/lib/money';

export type DialogBaixaProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Identifica a conta só para reiniciar o campo quando o diálogo troca de alvo. */
  contaId: string | null;
  cliente: string;
  descricao: string;
  /** Todos os três números vêm calculados de fora, pelos helpers auditados. */
  valorDaConta: number;
  jaRecebido: number;
  emAberto: number;
  processando?: boolean;
  onConfirmar: (valorInformado: number) => Promise<void> | void;
};

/**
 * Substitui o window.prompt da baixa. Não calcula status nem acumula
 * recebimento: só coleta quanto entrou e mostra o efeito por extenso.
 */
export function DialogBaixa({
  aberto,
  onOpenChange,
  contaId,
  cliente,
  descricao,
  valorDaConta,
  jaRecebido,
  emAberto,
  processando = false,
  onConfirmar,
}: DialogBaixaProps) {
  const [valor, setValor] = useState(emAberto);

  // Pré-preenche com o saldo em aberto, como o prompt fazia por padrão.
  useEffect(() => {
    setValor(emAberto);
  }, [contaId, emAberto]);

  const informado = round2(valor);
  const restante = round2(emAberto - informado);
  const parcial = informado > 0 && restante > 0.005;
  const invalido = informado <= 0;

  return (
    <ConfirmDialog
      aberto={aberto}
      onOpenChange={onOpenChange}
      titulo="Registrar recebimento"
      oQueVaiAcontecer="Informe quanto entrou. Se for menos que o saldo, a conta continua aberta pelo que falta."
      detalhes={[
        { rotulo: 'Cliente', valor: cliente || 'Cliente não informado' },
        { rotulo: 'Descrição', valor: descricao || 'Sem descrição' },
        { rotulo: 'Valor da conta', valor: <Money valor={valorDaConta} size="body" estado="ok" /> },
        ...(jaRecebido > 0
          ? [{ rotulo: 'Já recebido', valor: <Money valor={jaRecebido} size="body" tone="positivo" estado="ok" /> }]
          : []),
        { rotulo: 'Saldo em aberto', valor: <Money valor={emAberto} size="body" estado="ok" /> },
      ]}
      previa={
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          <MoneyField
            rotulo="Quanto entrou"
            obrigatorio
            autoFocus
            valor={valor}
            onChange={setValor}
            erro={invalido ? 'Informe um valor maior que zero.' : null}
            atalhos={[{ rotulo: 'Usar o saldo em aberto', valor: emAberto }]}
          />
          {parcial ? (
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              Recebimento em parte. A conta fica como recebida em parte e continua em aberto por{' '}
              <Money
                valor={restante}
                size="caption"
                align="esquerda"
                className="inline-block min-w-0"
                estado="ok"
              />
              .
            </p>
          ) : (
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              Com este valor a conta é marcada como recebida.
            </p>
          )}
        </div>
      }
      confirmarRotulo="Registrar recebimento"
      processando={processando}
      onConfirmar={() => {
        // Sem valor não há o que registrar: o erro já está sob o campo.
        if (invalido) return;
        return onConfirmar(valor);
      }}
    />
  );
}

export default DialogBaixa;
