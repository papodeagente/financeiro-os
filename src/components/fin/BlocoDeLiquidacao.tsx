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
import { CampoCambio } from '@/components/fin/CampoCambio';
import { formatarCambio, formatarNaMoeda, rotuloDaVariacao, type CarimboDoCambio, type VariacaoCambial } from '@/lib/cambio';

const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10';
const CAIXA_GERAL = '__caixa_geral__';
const SEM_FORMA = '__sem_forma__';

export type ContaOpcao = { id: string; nome: string; moeda?: string };

/** Câmbio da liquidação de uma conta lançada em moeda (05/11/2026, E6). */
export type CambioDoBloco = {
  moeda: string;
  valor: number;
  carimbo: CarimboDoCambio | null;
  onChange: (v: number, carimbo: CarimboDoCambio) => void;
  cambio_lancado: number;
  /** Em aberto na moeda. */
  saldo_moeda: number;
  variacao: VariacaoCambial | null;
  /** O que falta, em reais, pelo câmbio informado (com encargos). */
  valor_pelo_cambio: number | null;
  onUsarValor?: () => void;
  moeda_conta: string;
  caixa_na_moeda: number | null;
  lado: 'venda' | 'compra';
};

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
  /** Conta lançada em moeda: câmbio do pagamento e a variação cambial. */
  cambio?: CambioDoBloco;
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

      {p.cambio ? <BlocoDeCambio c={p.cambio} palavra={palavra} /> : null}

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
      {sobrou && p.sentido === 'recebimento' ? (
        <div className="flex flex-col gap-[var(--fin-s-2)]">
          <p className="fin-t-body text-[var(--fin-text)]">
            Entrou{' '}
            <Money valor={p.diferencaBruta} size="body" align="esquerda" className="inline-block min-w-0" estado="ok" />{' '}
            a mais que o devido. O que fazer com a sobra?
          </p>
          <Segmentado<TratamentoDiferenca>
            rotulo="O que fazer com a sobra"
            cheio
            valor={p.tratamento === 'credito' ? 'credito' : 'acrescimo'}
            onChange={p.onTratamento}
            opcoes={[
              { valor: 'acrescimo', rotulo: 'Lançar como acréscimo' },
              { valor: 'credito', rotulo: 'Guardar como crédito do cliente' },
            ]}
          />
        </div>
      ) : null}
      {sobrou ? (
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          {p.sentido === 'recebimento' && p.tratamento === 'credito'
            ? 'A conta fica quitada e a sobra entra na carteira de crédito do cliente, para usar numa próxima viagem.'
            : <>Entrou <Money valor={p.diferencaBruta} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" /> a mais que o devido: a sobra entra como acréscimo e a conta fica quitada.</>}
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
        {p.cambio?.variacao && p.cambio.variacao.variacao !== 0 ? (
          <>
            <dt className="fin-t-caption text-[var(--fin-text-2)]">{rotuloDaVariacao(p.cambio.variacao.resultado)} (linha própria no resultado)</dt>
            <dd className="text-right">
              <Money valor={p.cambio.variacao.resultado} size="body" sinal="sempre" tone={p.cambio.variacao.resultado > 0 ? 'positivo' : 'negativo'} estado="ok" />
            </dd>
          </>
        ) : null}
        <dt className="fin-t-caption text-[var(--fin-text-2)]">Entra na conta</dt>
        <dd className="fin-t-body-strong text-right text-[var(--fin-text)]">
          {nomeConta(p.contaId)}
          {p.cambio?.caixa_na_moeda != null ? <span className="fin-t-caption block font-normal text-[var(--fin-text-3)]">{formatarNaMoeda(p.cambio.caixa_na_moeda, p.cambio.moeda_conta)} na moeda da conta</span> : null}
        </dd>
      </dl>
      {p.plano.erros.length > 0 ? (
        <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{p.plano.erros[0]}</p>
      ) : null}
    </div>
  );
}

export default BlocoDeLiquidacao;

/** Câmbio do pagamento de uma conta lançada em moeda. */
function BlocoDeCambio({ c, palavra }: { c: CambioDoBloco; palavra: string }) {
  const contaEmMoeda = c.moeda_conta !== 'BRL';
  return (
    <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
      <legend className="fin-t-body-strong text-[var(--fin-text)]">Câmbio do {palavra}</legend>
      <p className="fin-t-caption text-[var(--fin-text-2)]">
        Em aberto: {formatarNaMoeda(c.saldo_moeda, c.moeda)}, lançados a {formatarCambio(c.cambio_lancado)}.
        {contaEmMoeda
          ? ` A conta bancária é em ${c.moeda_conta}: o câmbio é obrigatório.`
          : ' Informe o câmbio do dia para registrar a variação; sem ele, a conta é liquidada pelo valor em reais, como sempre.'}
      </p>
      <CampoCambio
        moeda={c.moeda}
        valor={c.valor}
        carimbo={c.carimbo}
        lado={c.lado}
        obrigatorio={contaEmMoeda}
        rotulo={`Câmbio do ${palavra}`}
        onChange={c.onChange}
      />
      {c.valor_pelo_cambio !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
          <p className="fin-t-body text-[var(--fin-text-2)]">
            Pelo câmbio informado, o que falta é{' '}
            <Money valor={c.valor_pelo_cambio} size="strong" align="esquerda" className="inline-block min-w-0" estado="ok" />
          </p>
          {c.onUsarValor ? (
            <button
              type="button"
              onClick={c.onUsarValor}
              className="fin-t-body h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 font-medium text-[var(--fin-accent)] hover:bg-[var(--fin-accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:h-9"
            >
              Usar este valor
            </button>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
