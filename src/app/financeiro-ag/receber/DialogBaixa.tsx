'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Money } from '@/components/fin/Money';
import { MoneyField } from '@/components/fin/MoneyField';
import { round2 } from '@/lib/money';
import {
  descontoPadraoDa,
  descontoPeloLiquido,
  formatarPercentual,
  liquidoPeloPercentual,
  mensagemDoLiquidoInvalido,
  percentualDaTaxa,
  validarLiquido,
  type DescontoPadrao,
} from '@/lib/taxa-plataforma';
import { Field } from '@/components/fin/Field';
import { SeletorDePlataforma } from './SeletorDePlataforma';

export type DialogBaixaProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Identifica a conta só para reiniciar o campo quando o diálogo troca de alvo. */
  contaId: string | null;
  cliente: string;
  /** Comissão de fornecedor: quem paga a conta é o fornecedor, não o cliente. */
  quemPaga?: 'cliente' | 'fornecedor';
  descricao: string;
  /** Todos os três números vêm calculados de fora, pelos helpers auditados. */
  valorDaConta: number;
  jaRecebido: number;
  emAberto: number;
  /** Taxa que a plataforma já reteve nesta conta, de baixas anteriores. */
  taxaJaRetida: number;
  /** Plataforma já registrada na conta (ou a da integração que a criou). */
  plataformaAtual: string;
  /** Plataformas que a agência já usou, para o seletor aprender. */
  plataformasUsadas?: string[];
  /** Desconto padrão cadastrado por plataforma. */
  descontosPadrao?: DescontoPadrao[];
  processando?: boolean;
  onConfirmar: (dados: {
    valorInformado: number;
    taxaInformada: number;
    plataforma: string;
    /** Preenchido quando a pessoa pediu para guardar este % como padrão. */
    novoPadrao: DescontoPadrao | null;
  }) => Promise<void> | void;
};

/**
 * Substitui o window.prompt da baixa. Não calcula status nem acumula
 * recebimento: só coleta o que aconteceu e mostra o efeito por extenso.
 *
 * A pessoa informa o que o cliente pagou e o que CAIU NO BANCO, que é o
 * número que ela tem no extrato. O desconto da plataforma, em reais e em
 * percentual, sai da diferença. Com um padrão cadastrado para a plataforma,
 * o que cai no banco já vem calculado e só precisa ser conferido.
 */
export function DialogBaixa({
  aberto,
  onOpenChange,
  contaId,
  cliente,
  quemPaga = 'cliente',
  descricao,
  valorDaConta,
  jaRecebido,
  emAberto,
  taxaJaRetida,
  plataformaAtual,
  plataformasUsadas = [],
  descontosPadrao = [],
  processando = false,
  onConfirmar,
}: DialogBaixaProps) {
  const pagaFornecedor = quemPaga === 'fornecedor';
  const quem = pagaFornecedor ? 'o fornecedor' : 'o cliente';
  const [valor, setValor] = useState(emAberto);
  const [plataforma, setPlataforma] = useState(plataformaAtual);
  // NULL = segue a sugestão (padrão da plataforma, ou sem desconto). Vira
  // número quando a pessoa digita: daí em diante o que ela digitou manda,
  // mesmo que troque o valor pago ou a plataforma.
  const [liquidoDigitado, setLiquidoDigitado] = useState<number | null>(null);
  const [guardarPadrao, setGuardarPadrao] = useState(false);

  // Um ponto só de reinício quando o diálogo troca de conta. O desconto NÃO
  // herda o da baixa anterior: aqui se informa o que foi retido NESTE
  // recebimento, e ele acumula no total da conta, como o valor recebido.
  // Ajuste durante a renderização (e não num efeito): o primeiro quadro da
  // conta nova já sai com os campos dela, sem piscar os da anterior.
  const alvo = `${contaId ?? ''}|${emAberto}|${plataformaAtual}`;
  const [alvoAnterior, setAlvoAnterior] = useState(alvo);
  if (alvo !== alvoAnterior) {
    setAlvoAnterior(alvo);
    setValor(emAberto);
    setPlataforma(plataformaAtual);
    setLiquidoDigitado(null);
    setGuardarPadrao(false);
  }

  const informado = round2(valor);
  const restante = round2(emAberto - informado);
  const parcial = informado > 0 && restante > 0.005;

  const padrao = descontoPadraoDa(plataforma, descontosPadrao);
  const sugerido = padrao ? liquidoPeloPercentual(informado, padrao.percentual) : informado;
  const liquido = liquidoDigitado ?? sugerido;
  const desconto = descontoPeloLiquido(informado, liquido);
  const pct = percentualDaTaxa(desconto, informado);
  const motivoLiquido = informado > 0 ? validarLiquido(informado, liquido) : null;

  // Guardar como padrão só faz sentido com plataforma escolhida, desconto de
  // verdade e um percentual diferente do que já está cadastrado.
  const podeGuardar =
    plataforma.trim() !== '' && desconto > 0 && pct !== null && pct < 100 && (!padrao || padrao.percentual !== pct);

  const invalido = informado <= 0 || motivoLiquido !== null;

  return (
    <ConfirmDialog
      aberto={aberto}
      onOpenChange={onOpenChange}
      titulo="Registrar recebimento"
      oQueVaiAcontecer={`Informe o que ${quem} pagou e quanto caiu no banco. O desconto da plataforma é calculado pela diferença.`}
      detalhes={[
        { rotulo: pagaFornecedor ? 'Fornecedor' : 'Cliente', valor: cliente || (pagaFornecedor ? 'Fornecedor não informado' : 'Cliente não informado') },
        { rotulo: 'Descrição', valor: descricao || 'Sem descrição' },
        { rotulo: 'Valor da conta', valor: <Money valor={valorDaConta} size="body" estado="ok" /> },
        ...(jaRecebido > 0
          ? [{ rotulo: 'Já recebido', valor: <Money valor={jaRecebido} size="body" tone="positivo" estado="ok" /> }]
          : []),
        { rotulo: 'Saldo em aberto', valor: <Money valor={emAberto} size="body" estado="ok" /> },
        ...(taxaJaRetida > 0
          ? [{
              rotulo: 'Desconto já retido',
              valor: <Money valor={taxaJaRetida} size="body" tone="negativo" estado="ok" />,
            }]
          : []),
      ]}
      previa={
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          <MoneyField
            rotulo={`Quanto ${quem} pagou`}
            obrigatorio
            autoFocus
            valor={valor}
            onChange={setValor}
            erro={informado <= 0 ? 'Informe um valor maior que zero.' : null}
            atalhos={[{ rotulo: 'Usar o saldo em aberto', valor: emAberto }]}
          />

          <Field
            rotulo="Plataforma de pagamento"
            ajuda={padrao ? `Desconto padrão: ${formatarPercentual(padrao.percentual)}.` : 'Se o dinheiro passou por uma.'}
          >
            {a => (
              <SeletorDePlataforma
                id={a.id}
                valor={plataforma}
                usadas={plataformasUsadas}
                rotuloVazio="Nenhuma, recebi direto"
                onChange={v => { setPlataforma(v); setGuardarPadrao(false); }}
              />
            )}
          </Field>

          <MoneyField
            rotulo="Quanto caiu no banco"
            obrigatorio
            valor={liquido}
            onChange={v => setLiquidoDigitado(v)}
            ajuda={
              liquidoDigitado === null && padrao
                ? 'Calculado com o desconto padrão desta plataforma. Confira com o extrato.'
                : 'Já com o desconto da plataforma, como aparece no extrato.'
            }
            erro={motivoLiquido ? mensagemDoLiquidoInvalido(motivoLiquido) : null}
            atalhos={
              liquidoDigitado !== null && padrao && round2(liquidoDigitado) !== sugerido
                ? [{ rotulo: `Usar o padrão (${formatarPercentual(padrao.percentual)})`, valor: sugerido }]
                : undefined
            }
          />

          {/* O que o sistema calculou. Sempre visível, inclusive quando dá
              zero: "sem desconto" também é uma informação a conferir. */}
          <dl
            aria-live="polite"
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-[var(--fin-s-3)] gap-y-1 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]"
          >
            <dt className="fin-t-caption text-[var(--fin-text-2)]">Desconto da plataforma</dt>
            <dd className="text-right">
              {motivoLiquido ? (
                <span className="fin-t-body-strong text-[var(--fin-text-3)]">—</span>
              ) : (
                <Money valor={desconto} size="body" tone={desconto > 0 ? 'negativo' : 'neutro'} estado="ok" />
              )}
            </dd>
            <dt className="fin-t-caption text-[var(--fin-text-2)]">Percentual</dt>
            <dd className="fin-t-body-strong text-right tabular-nums text-[var(--fin-text)]">
              {motivoLiquido || pct === null ? '—' : formatarPercentual(pct)}
            </dd>
          </dl>

          {podeGuardar && !motivoLiquido ? (
            <label className="flex items-start gap-2 fin-t-body text-[var(--fin-text)]">
              <input
                type="checkbox"
                checked={guardarPadrao}
                onChange={e => setGuardarPadrao(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
              />
              <span>
                {/* "desta plataforma" e não "da Hotmart": o artigo erraria em
                    "do Mercado Pago", "do PayPal", "do Asaas". */}
                {padrao
                  ? `Trocar o padrão desta plataforma de ${formatarPercentual(padrao.percentual)} para ${formatarPercentual(pct)}`
                  : `Guardar ${formatarPercentual(pct)} como desconto padrão desta plataforma`}
                <span className="block fin-t-caption text-[var(--fin-text-3)]">
                  Nas próximas baixas o valor no banco já vem calculado.
                </span>
              </span>
            </label>
          ) : null}

          {desconto > 0 && !motivoLiquido ? (
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              A conta é baixada pelo que o cliente pagou e o desconto fica registrado como taxa da
              plataforma.
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
        return onConfirmar({
          valorInformado: informado,
          taxaInformada: desconto,
          plataforma,
          novoPadrao:
            guardarPadrao && podeGuardar && pct !== null
              ? { plataforma: plataforma.trim(), percentual: pct }
              : null,
        });
      }}
    />
  );
}

export default DialogBaixa;
