'use client';

import type { ContaPagar } from '@/lib/crm-types';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { MoneyField } from '@/components/fin/MoneyField';
import { AnexoComprovante, type Anexo } from '@/components/fin/AnexoComprovante';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { CONTROLE } from './campos';
import { BlocoDeLiquidacao, type BlocoDeLiquidacaoProps } from '@/components/fin/BlocoDeLiquidacao';

export type DialogBaixaProps = {
  item: ContaPagar | null;
  dataPagamento: string;
  valorPago: number;
  observacao: string;
  /** Comprovantes já anexados nesta baixa. */
  anexos: Anexo[];
  onDataPagamento: (v: string) => void;
  onValorPago: (v: number) => void;
  onObservacao: (v: string) => void;
  onAnexos: (v: Anexo[]) => void;
  /** Enquanto um comprovante está subindo, confirmar fica bloqueado, para
   *  a baixa não ser gravada sem o anexo que o usuário acabou de escolher. */
  onEnviandoAnexo: (v: boolean) => void;
  enviandoAnexo: boolean;
  /** Números prontos, calculados pelas funções auditadas da página. */
  valorDaConta: number;
  jaPago: number;
  saldoDevedor: number;
  /** Quanto continua devendo depois desta baixa. Já vem arredondado. */
  restanteDepois: number;
  pagando: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
  /** Data, conta, encargos e diferença (05/11/2026). Substitui o campo de data. */
  liquidacao?: BlocoDeLiquidacaoProps;
};

export function DialogBaixa({
  item,
  dataPagamento,
  valorPago,
  observacao,
  anexos,
  onDataPagamento,
  onValorPago,
  onObservacao,
  onAnexos,
  onEnviandoAnexo,
  enviandoAnexo,
  valorDaConta,
  jaPago,
  saldoDevedor,
  restanteDepois,
  pagando,
  onFechar,
  onConfirmar,
  liquidacao,
}: DialogBaixaProps) {
  if (!item) return null;

  const parcial = valorPago > 0 && restanteDepois > 0.005;

  const detalhes = [
    { rotulo: 'Fornecedor', valor: item.fornecedor_nome || 'Sem fornecedor' },
    { rotulo: 'Descrição', valor: item.descricao || 'Sem descrição' },
    { rotulo: 'Valor da conta', valor: <Money valor={valorDaConta} size="metricSm" estado="ok" /> },
    ...(jaPago > 0
      ? [{ rotulo: 'Já pago', valor: <Money valor={jaPago} size="metricSm" estado="ok" /> }]
      : []),
    {
      rotulo: 'Saldo devedor',
      valor: <Money valor={saldoDevedor} size="metricSm" estado="ok" />,
    },
  ];

  const previa = (
    <div className="flex flex-col gap-3">
      <div className={cn('grid grid-cols-1 gap-3', liquidacao ? '' : 'sm:grid-cols-2')}>
        {liquidacao ? null : <Field rotulo="Data do pagamento">
          {(a) => (
            <Input
              {...a}
              aria-invalid={a['aria-invalid'] || undefined}
              type="date"
              value={dataPagamento}
              onChange={(e) => onDataPagamento(e.target.value)}
              className={cn(CONTROLE, 'tabular-nums')}
            />
          )}
        </Field>}

        <MoneyField
          rotulo="Valor pago"
          valor={valorPago}
          onChange={onValorPago}
          atalhos={[{ rotulo: 'Saldo devedor', valor: saldoDevedor }]}
        />
      </div>

      {liquidacao ? <BlocoDeLiquidacao {...liquidacao} /> : null}

      <Field rotulo="Observação" ajuda="Opcional. Fica junto das observações da conta.">
        {(a) => (
          <Input
            {...a}
            aria-invalid={a['aria-invalid'] || undefined}
            value={observacao}
            placeholder="Por exemplo: pago via Pix"
            autoComplete="off"
            onChange={(e) => onObservacao(e.target.value)}
            className={CONTROLE}
          />
        )}
      </Field>

      <AnexoComprovante
        anexos={anexos}
        onChange={onAnexos}
        onEnviandoChange={onEnviandoAnexo}
        desabilitado={pagando}
      />

      {parcial && !liquidacao ? (
        <p className="fin-t-caption text-[var(--fin-warning-text)]">
          Pagamento em parte: a conta continua aberta com saldo devedor de{' '}
          <Money valor={restanteDepois} size="caption" tone="suave" align="esquerda" />.
        </p>
      ) : null}

      <p className="fin-t-caption text-[var(--fin-text-3)]">
        O saldo da conta é atualizado logo depois de confirmar.
      </p>
    </div>
  );

  return (
    <ConfirmDialog
      aberto={Boolean(item)}
      onOpenChange={(proximo) => {
        if (!proximo) onFechar();
      }}
      titulo="Registrar pagamento"
      oQueVaiAcontecer="Registra a saída no caixa e atualiza a situação da conta. Se o valor pago cobrir o saldo, a conta fica paga."
      detalhes={detalhes}
      previa={previa}
      confirmarRotulo={enviandoAnexo ? 'Anexando comprovante...' : 'Confirmar pagamento'}
      processando={pagando || enviandoAnexo}
      onConfirmar={() => { if (liquidacao && liquidacao.plano.erros.length > 0) return; onConfirmar(); }}
    />
  );
}

export default DialogBaixa;
