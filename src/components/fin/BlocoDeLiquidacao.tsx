'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { Money } from '@/components/fin/Money';
import { Segmentado } from '@/components/fin/Segmentado';
import { cn } from '@/lib/utils';
import type { EncargosSugeridos, PlanoDaBaixa, TratamentoDiferenca } from '@/lib/baixa-calculo';
import type { OpcaoDeForma } from '@/lib/formas-pagamento';

const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10';
const CAIXA_GERAL = '__caixa_geral__';
const SEM_FORMA = '__sem_forma__';

export type ContaOpcao = { id: string; nome: string };

export type BlocoDeLiquidacaoProps = {
  /** "recebimento" ou "pagamento": muda só as palavras. */
  sentido: 'recebimento' | 'pagamento';
  data: string;
  onData: (v: string) => void;
  contas: ContaOpcao[];
  contaId: string | null;
  onConta: (v: string | null) => void;
  /** Quando as baixas anteriores já estão numa conta, a próxima entra nela. */
  contaTravadaMotivo?: string | null;
  juros: number;
  multa: number;
  desconto: number;
  onJuros: (v: number) => void;
  onMulta: (v: number) => void;
  onDesconto: (v: number) => void;
  sugeridos: EncargosSugeridos;
  tratamento: TratamentoDiferenca;
  onTratamento: (v: TratamentoDiferenca) => void;
  /** A mesma conta que o servidor vai fazer (baixa-calculo.ts). */
  plano: PlanoDaBaixa;
  /** Dinheiro informado sem o que o tratamento acrescentou (para mostrar a diferença). */
  diferencaBruta: number;
  /** Formas de pagamento do cadastro (05/11/2026). Sem elas, o campo não aparece. */
  formas?: OpcaoDeForma[];
  forma?: string;
  onForma?: (v: string) => void;
  /** A conta mostrada é a padrão da forma escolhida. */
  contaDaForma?: boolean;
};

/**
 * Data, conta, encargos e a diferença de uma liquidação (05/11/2026). Entra
 * dentro dos diálogos de recebimento e pagamento, abaixo do valor pago.
 * Não calcula nada sozinho: recebe o plano pronto (baixa-calculo.ts), o
 * mesmo que o servidor confere antes de gravar.
 */
export function BlocoDeLiquidacao(p: BlocoDeLiquidacaoProps) {
  const palavra = p.sentido === 'recebimento' ? 'recebimento' : 'pagamento';
  const sugeriu = p.sugeridos.juros > 0 || p.sugeridos.multa > 0 || p.sugeridos.desconto_antecipacao > 0;
  const faltou = p.diferencaBruta < -0.005;
  const sobrou = p.diferencaBruta > 0.005;
  const nomeConta = (id: string | null) => (id ? p.contas.find(c => c.id === id)?.nome ?? 'Conta' : 'Caixa Geral');
  const temFormas = Boolean(p.formas && p.onForma);
  const opcaoForma = p.forma ? p.formas?.find(f => f.valor === p.forma) : undefined;
  const rotuloForma = opcaoForma?.rotulo ?? 'Não informar';
  const detalheForma = opcaoForma?.detalhe;

  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
        <Field rotulo={`Data do ${palavra}`} obrigatorio>
          {a => (
            <Input
              {...a}
              aria-invalid={a['aria-invalid'] || undefined}
              type="date"
              value={p.data}
              onChange={e => p.onData(e.target.value)}
              className={cn(CONTROLE, 'tabular-nums')}
            />
          )}
        </Field>
        {temFormas ? (
          <Field rotulo="Forma" ajuda={detalheForma}>
            {a => (
              <Select
                value={p.forma || SEM_FORMA}
                onValueChange={v => p.onForma?.(!v || v === SEM_FORMA ? '' : String(v))}
              >
                <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'w-full')}>
                  <SelectValue>{() => rotuloForma}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_FORMA} className="fin-t-body">Não informar</SelectItem>
                  {(p.formas ?? []).map(f => (
                    <SelectItem key={f.valor} value={f.valor} className="fin-t-body">{f.rotulo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        ) : null}
        <Field
          rotulo="Conta"
          ajuda={p.contaTravadaMotivo ?? (p.contaDaForma ? 'Conta padrão desta forma de pagamento.' : undefined)}
        >
          {a => (
            <Select
              value={p.contaId ?? CAIXA_GERAL}
              onValueChange={v => p.onConta(!v || v === CAIXA_GERAL ? null : String(v))}
              disabled={Boolean(p.contaTravadaMotivo)}
            >
              <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'w-full')}>
                <SelectValue>{() => nomeConta(p.contaId)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CAIXA_GERAL} className="fin-t-body">Caixa Geral</SelectItem>
                {p.contas.filter(c => c.nome !== 'Caixa Geral').map(c => (
                  <SelectItem key={c.id} value={c.id} className="fin-t-body">{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
        <legend className="fin-t-body-strong text-[var(--fin-text)]">Juros, multa e desconto</legend>
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          {p.sugeridos.dias_atraso > 0
            ? `${p.sugeridos.dias_atraso} ${p.sugeridos.dias_atraso === 1 ? 'dia' : 'dias'} de atraso.`
            : 'Dentro do vencimento.'}
          {sugeriu ? ' Valores sugeridos pela política da agência; altere se combinou diferente.' : ''}
        </p>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <MoneyField rotulo="Juros" valor={p.juros} onChange={p.onJuros} />
          <MoneyField rotulo="Multa" valor={p.multa} onChange={p.onMulta} />
          <MoneyField rotulo="Desconto" valor={p.desconto} onChange={p.onDesconto} />
        </div>
      </fieldset>

      {faltou ? (
        <div className="flex flex-col gap-[var(--fin-s-2)]">
          <p className="fin-t-body text-[var(--fin-text)]">
            Faltam{' '}
            <Money valor={-p.diferencaBruta} size="body" align="esquerda" className="inline-block min-w-0" estado="ok" />{' '}
            para quitar. Como tratar?
          </p>
          <Segmentado<TratamentoDiferenca>
            rotulo="O que fazer com a diferença"
            cheio
            valor={p.tratamento === 'desconto' ? 'desconto' : 'deixar_aberto'}
            onChange={p.onTratamento}
            opcoes={[
              { valor: 'deixar_aberto', rotulo: 'Pagou uma parte' },
              { valor: 'desconto', rotulo: 'Dar desconto' },
            ]}
          />
        </div>
      ) : null}
      {faltou ? (
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          {p.tratamento === 'desconto'
            ? 'O que falta vira desconto e a conta fica quitada.'
            : 'O restante continua em aberto na mesma conta, com cada parcela no histórico.'}
        </p>
      ) : null}
      {sobrou ? (
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          Entrou{' '}
          <Money valor={p.diferencaBruta} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" />{' '}
          a mais que o devido: a sobra entra como acréscimo e a conta fica quitada.
        </p>
      ) : null}

      <dl
        aria-live="polite"
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-[var(--fin-s-3)] gap-y-1 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]"
      >
        <dt className="fin-t-caption text-[var(--fin-text-2)]">Valor da conta depois</dt>
        <dd className="text-right"><Money valor={p.plano.valor_final_depois} size="body" estado="ok" /></dd>
        <dt className="fin-t-caption text-[var(--fin-text-2)]">Fica em aberto</dt>
        <dd className="text-right">
          <Money valor={p.plano.saldo_depois} size="body" tone={p.plano.saldo_depois > 0 ? 'negativo' : 'neutro'} estado="ok" />
        </dd>
        <dt className="fin-t-caption text-[var(--fin-text-2)]">Entra na conta</dt>
        <dd className="fin-t-body-strong text-right text-[var(--fin-text)]">{nomeConta(p.contaId)}</dd>
      </dl>
      {p.plano.erros.length > 0 ? (
        <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{p.plano.erros[0]}</p>
      ) : null}
    </div>
  );
}

export default BlocoDeLiquidacao;
