'use client';

import { useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Money } from '@/components/fin/Money';
import { MoneyField } from '@/components/fin/MoneyField';
import { round2 } from '@/lib/money';
import { percentualDaTaxa } from '@/lib/taxa-plataforma';
import { Field } from '@/components/fin/Field';
import { SeletorDePlataforma } from './SeletorDePlataforma';

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
  /** Taxa que a plataforma já reteve nesta conta, de baixas anteriores. */
  taxaJaRetida: number;
  /** Plataforma já registrada na conta, se houver. */
  plataformaAtual: string;
  /** Plataformas que a agência já usou, para o seletor aprender. */
  plataformasUsadas?: string[];
  processando?: boolean;
  onConfirmar: (dados: {
    valorInformado: number;
    taxaInformada: number;
    plataforma: string;
  }) => Promise<void> | void;
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
  taxaJaRetida,
  plataformaAtual,
  plataformasUsadas = [],
  processando = false,
  onConfirmar,
}: DialogBaixaProps) {
  const [valor, setValor] = useState(emAberto);
  // A taxa NÃO é pré-preenchida com a anterior: aqui se informa o que foi
  // retido NESTE recebimento, e o campo acumula no total da conta — do mesmo
  // jeito que o valor recebido acumula. Repetir a taxa anterior dobraria a
  // retenção a cada baixa parcial.
  const [taxa, setTaxa] = useState(0);
  const [plataforma, setPlataforma] = useState(plataformaAtual);

  // Um ponto só de reinício quando o diálogo troca de conta: o valor
  // pré-preenchido com o saldo em aberto, como o prompt fazia, e os campos de
  // taxa zerados para não herdar a retenção da conta anterior.
  useEffect(() => {
    setValor(emAberto);
    setTaxa(0);
    setPlataforma(plataformaAtual);
  }, [contaId, emAberto, plataformaAtual]);

  const informado = round2(valor);
  const restante = round2(emAberto - informado);
  const parcial = informado > 0 && restante > 0.005;
  const taxaInformada = round2(Math.max(0, taxa));
  const caiNoBanco = round2(informado - taxaInformada);
  const pctDaTaxa = percentualDaTaxa(taxaInformada, informado);
  const taxaMaiorQueOValor = taxaInformada > informado;
  const invalido = informado <= 0 || taxaMaiorQueOValor;

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
        ...(taxaJaRetida > 0
          ? [{
              rotulo: 'Taxa já retida',
              valor: <Money valor={taxaJaRetida} size="body" tone="negativo" estado="ok" />,
            }]
          : []),
      ]}
      previa={
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          <MoneyField
            rotulo="Quanto entrou"
            obrigatorio
            autoFocus
            valor={valor}
            onChange={setValor}
            erro={informado <= 0 ? 'Informe um valor maior que zero.' : null}
            atalhos={[{ rotulo: 'Usar o saldo em aberto', valor: emAberto }]}
          />
          {/* A taxa é conhecida AQUI, quando o dinheiro passa pela adquirente,
              e não no lançamento da conta. */}
          <MoneyField
            rotulo="Taxa retida neste recebimento"
            valor={taxa}
            onChange={setTaxa}
            maximo={informado > 0 ? informado : undefined}
            ajuda={
              taxaInformada <= 0
                ? 'Opcional. O que a plataforma de pagamento ficou.'
                : pctDaTaxa === null
                  ? 'O que a plataforma de pagamento ficou.'
                  : `${pctDaTaxa.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do que entrou.`
            }
            erro={taxaMaiorQueOValor ? 'A taxa não pode ser maior do que o valor que entrou.' : null}
          />

          {taxaInformada > 0 ? (
            <Field rotulo="Plataforma que reteve">
              {a => (
                <SeletorDePlataforma
                  id={a.id}
                  valor={plataforma}
                  usadas={plataformasUsadas}
                  onChange={setPlataforma}
                />
              )}
            </Field>
          ) : null}

          {taxaInformada > 0 ? (
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              A conta é baixada pelo valor cheio e no banco cai{' '}
              <Money
                valor={caiNoBanco}
                size="caption"
                align="esquerda"
                className="inline-block min-w-0"
                estado="ok"
              />
              .
            </p>
          ) : null}

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
        return onConfirmar({ valorInformado: valor, taxaInformada, plataforma });
      }}
    />
  );
}

export default DialogBaixa;
