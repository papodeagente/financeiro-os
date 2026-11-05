'use client';

import * as React from 'react';

import { Field } from '@/components/fin/Field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatarLinhaDigitavel, lerLinhaDoBoleto, SEGMENTOS_ARRECADACAO, soDigitosDoBoleto } from '@/lib/boleto-linha';
import { hojeISO } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Linha digitável do boleto, conferida enquanto a pessoa digita ou cola
 * (05/11/2026). O leitor é o mesmo que confere a leitura da IA no servidor
 * (boleto-linha.ts): todos os dígitos verificadores, valor e vencimento,
 * com a virada do fator de 2025.
 *
 * Quando a linha confere e o valor ou o vencimento do formulário são outros,
 * oferece usar os do boleto. Só com o clique.
 */

export type CampoLinhaDigitavelProps = {
  /** Só dígitos. */
  valor: string;
  onChange: (digitos: string) => void;
  /** Valor e vencimento que o formulário tem agora. */
  valorAtual: number;
  vencimentoAtual: string;
  onUsarDoBoleto: (dados: { valor: number | null; vencimento: string | null }) => void;
  className?: string;
  controle: string;
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function CampoLinhaDigitavel({
  valor, onChange, valorAtual, vencimentoAtual, onUsarDoBoleto, className, controle,
}: CampoLinhaDigitavelProps) {
  const digitos = soDigitosDoBoleto(valor);
  const lido = React.useMemo(() => (digitos ? lerLinhaDoBoleto(digitos, hojeISO()) : null), [digitos]);
  const completo = digitos.length >= 44;

  let ajuda = 'Cole ou digite os números do boleto. A conferência é na hora.';
  let erro: string | null = null;
  let usar: { valor: number | null; vencimento: string | null } | null = null;
  if (lido?.ok) {
    const emissor = lido.tipo === 'bancario' ? `Banco ${lido.banco}` : SEGMENTOS_ARRECADACAO[lido.segmento] ?? 'Conta de consumo';
    const valorDoBoleto = lido.emReais && lido.valorCentavos > 0 ? lido.valorCentavos / 100 : null;
    const partes = [
      emissor,
      valorDoBoleto !== null ? brl(valorDoBoleto) : 'sem valor no código',
      lido.vencimento ? `vence ${dataBR(lido.vencimento)}` : null,
    ].filter(Boolean);
    ajuda = `Confere. ${partes.join(' · ')}.`;
    const valorDiferente = valorDoBoleto !== null && Math.round(valorDoBoleto * 100) !== Math.round(valorAtual * 100);
    const dataDiferente = !!lido.vencimento && lido.vencimento !== vencimentoAtual;
    if (valorDiferente || dataDiferente) {
      usar = { valor: valorDiferente ? valorDoBoleto : null, vencimento: dataDiferente ? lido.vencimento : null };
    }
  } else if (lido && completo) {
    erro = lido.mensagem;
    ajuda = '';
  } else if (digitos) {
    ajuda = `${digitos.length} de 47 números (48 em conta de consumo).`;
  }

  const acaoUsar = usar;
  const rotuloUsar = acaoUsar
    ? acaoUsar.valor !== null && acaoUsar.vencimento
      ? 'Usar valor e vencimento do boleto'
      : acaoUsar.valor !== null ? 'Usar o valor do boleto' : 'Usar o vencimento do boleto'
    : '';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Field rotulo="Linha digitável do boleto" ajuda={ajuda || undefined} erro={erro}>
        {(a) => (
          <Input
            {...a}
            aria-invalid={a['aria-invalid'] || undefined}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={digitos.length === 47 || digitos.length === 48 ? formatarLinhaDigitavel(digitos) : digitos}
            placeholder="00190.00009 01234.567890 12345.678901 2 12340000010000"
            onChange={(e) => onChange(soDigitosDoBoleto(e.target.value).slice(0, 48))}
            className={cn(controle, 'tabular-nums', erro && 'border-[var(--fin-negative)]')}
          />
        )}
      </Field>
      {acaoUsar ? (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onUsarDoBoleto(acaoUsar)}>
          {rotuloUsar}
        </Button>
      ) : null}
    </div>
  );
}

export default CampoLinhaDigitavel;
