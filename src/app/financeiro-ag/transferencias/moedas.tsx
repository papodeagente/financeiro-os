'use client';

/**
 * Transferência entre moedas (05/11/2026, E6): as peças que a tela usa.
 * A conta de verdade (valor que chega, tarifa, câmbio) é do servidor
 * (planoDaTransferencia em src/lib/cambio.ts); aqui a mesma regra só mostra
 * a prévia antes de gravar.
 */
import type { ContaBancaria, TransferenciaBancaria } from '@/lib/crm-types';
import {
  formatarNaMoeda, moedaDe, pernasDaTransferencia, planoDaTransferencia, significadoDoCambio,
  type CarimboDoCambio, type CodigoMoeda,
} from '@/lib/cambio';
import { CampoCambio } from '@/components/fin/CampoCambio';
import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { MoneyField } from '@/components/fin/MoneyField';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ContaComMoeda = ContaBancaria & { moeda?: string };

export type TransferenciaComMoeda = TransferenciaBancaria & {
  moeda_origem?: string;
  moeda_destino?: string;
  valor_destino?: number;
  cambio?: number;
  cambio_carimbo?: CarimboDoCambio | null;
  tarifa?: number;
};

/** Valor da transferência em reais: o lado em real, quando há um. */
export function valorEmReais(t: TransferenciaComMoeda): number | null {
  const o = moedaDe(t.moeda_origem);
  const d = moedaDe(t.moeda_destino);
  const p = pernasDaTransferencia(t as unknown as Record<string, unknown>);
  if (o === 'BRL') return p.valor;
  if (d === 'BRL') return p.entra;
  return null;
}

/** Saldo de uma conta na moeda dela (real usa o Money de sempre). */
export function SaldoNaMoeda({ valor, moeda, size = 'strong', tone, align, className }: {
  valor: number; moeda?: string; size?: 'caption' | 'strong'; tone?: 'neutro' | 'negativo' | 'suave'; align?: 'esquerda' | 'direita'; className?: string;
}) {
  const m = moedaDe(moeda);
  if (m === 'BRL') return <Money valor={valor} size={size} estado="ok" tone={tone} align={align} className={className} />;
  return (
    <span
      className={cn(
        size === 'caption' ? 'fin-t-caption' : 'fin-t-body-strong',
        'tabular-nums',
        tone === 'negativo' || valor < 0 ? 'text-[var(--fin-negative)]' : tone === 'suave' ? 'text-[var(--fin-text-3)]' : 'text-[var(--fin-text)]',
        className,
      )}
    >
      {formatarNaMoeda(valor, m)}
    </span>
  );
}

const CONTROLE =
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] tabular-nums lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

/**
 * Câmbio e tarifa da transferência. Entre real e moeda, o campo de câmbio
 * com as sugestões; entre duas moedas estrangeiras, o número direto (não há
 * cotação cruzada no cache e nada é inventado).
 */
export function CambioDaTransferencia({
  moedaOrigem, moedaDestino, valor, cambio, carimbo, tarifa, erroCambio, onCambio, onTarifa,
}: {
  moedaOrigem: CodigoMoeda;
  moedaDestino: CodigoMoeda;
  valor: number;
  cambio: number;
  carimbo: CarimboDoCambio | null;
  tarifa: number;
  erroCambio: string | null;
  onCambio: (valor: number, carimbo: CarimboDoCambio | null) => void;
  onTarifa: (valor: number) => void;
}) {
  const diferentes = moedaOrigem !== moedaDestino;
  const plano = planoDaTransferencia({ valor, moeda_origem: moedaOrigem, moeda_destino: moedaDestino, cambio, tarifa });
  const estrangeira = moedaOrigem === 'BRL' ? moedaDestino : moedaOrigem;
  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      {diferentes && (moedaOrigem === 'BRL' || moedaDestino === 'BRL') ? (
        <CampoCambio
          moeda={estrangeira}
          valor={cambio}
          carimbo={carimbo}
          obrigatorio
          erro={erroCambio}
          // Comprar moeda (real → moeda) usa a venda; vender moeda usa a compra.
          lado={moedaOrigem === 'BRL' ? 'venda' : 'compra'}
          onChange={(v, k) => onCambio(v, k)}
        />
      ) : diferentes ? (
        <Field rotulo="Câmbio" obrigatorio ajuda={`${significadoDoCambio(moedaOrigem, moedaDestino)}.`} erro={erroCambio}>
          {a => (
            <Input
              id={a.id}
              aria-invalid={a['aria-invalid'] || undefined}
              aria-describedby={a['aria-describedby']}
              inputMode="decimal"
              placeholder="0,0000"
              defaultValue={cambio > 0 ? String(cambio).replace('.', ',') : ''}
              onChange={e => {
                const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'));
                onCambio(Number.isFinite(n) && n > 0 ? Math.round(n * 10_000) / 10_000 : 0, null);
              }}
              className={CONTROLE}
            />
          )}
        </Field>
      ) : null}

      <MoneyField
        rotulo="Tarifa do banco"
        valor={tarifa}
        moeda={moedaOrigem}
        onChange={v => onTarifa(v)}
        ajuda={`Opcional. Sai da conta de origem junto com o valor${moedaOrigem === 'BRL' ? '' : `, em ${moedaOrigem}`}.`}
      />

      {diferentes && plano.cambio !== null && valor > 0 ? (
        <p className="fin-t-body text-[var(--fin-text-2)]">
          Chegam <strong className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{formatarNaMoeda(plano.valor_destino, moedaDestino)}</strong> na conta de destino
          {plano.tarifa > 0 ? <>; saem <strong className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{formatarNaMoeda(plano.sai_da_origem, moedaOrigem)}</strong> da origem, com a tarifa</> : null}.
        </p>
      ) : null}
    </div>
  );
}
