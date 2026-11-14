'use client';

import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { CampoSelecao, CONTROLE, type OpcaoDeSelecao } from './campos';

export type PainelCopiarMesProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  mesOrigem: string;
  onMesOrigem: (mes: string) => void;
  mesDestino: string;
  onMesDestino: (mes: string) => void;
  mesesDisponiveis: string[];
  /** Rótulo legível do mês, vindo da página. */
  rotuloMes: (ym: string) => string;
  /** Contagem e soma do recorte, calculadas fora. */
  quantidade: number;
  soma: number;
  copiando: boolean;
  onCopiar: () => void;
};

export function PainelCopiarMes({
  aberto,
  onOpenChange,
  mesOrigem,
  onMesOrigem,
  mesDestino,
  onMesDestino,
  mesesDisponiveis,
  rotuloMes,
  quantidade,
  soma,
  copiando,
  onCopiar,
}: PainelCopiarMesProps) {
  const listaDeMeses =
    mesOrigem && !mesesDisponiveis.includes(mesOrigem)
      ? [mesOrigem, ...mesesDisponiveis]
      : mesesDisponiveis;

  const opcoesMes: OpcaoDeSelecao[] = listaDeMeses.map((m) => ({
    valor: m,
    rotulo: rotuloMes(m),
  }));

  const resumo =
    quantidade > 0 ? (
      <span className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-3">
          <span>
            {quantidade === 1 ? '1 conta será copiada' : `${quantidade} contas serão copiadas`}
          </span>
          <Money valor={soma} size="strong" estado="ok" />
        </span>
        <span>
          As cópias nascem em aberto, com o mesmo dia de vencimento em{' '}
          {mesDestino ? rotuloMes(mesDestino) : 'no mês escolhido'}.
        </span>
      </span>
    ) : (
      <span>
        Nenhuma conta do mês escolhido pode ser copiada. Compras únicas, contas canceladas e custos
        gerados por vendas ou grupos ficam de fora.
      </span>
    );

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={onOpenChange}
      titulo="Copiar contas de um mês"
      descricao="Repete no mês seguinte as despesas fixas e variáveis lançadas à mão."
      largura={480}
      resumo={resumo}
      acaoPrimaria={{
        rotulo: 'Copiar contas',
        onClick: onCopiar,
        carregando: copiando,
        desabilitado: !mesOrigem || !mesDestino || quantidade === 0,
      }}
    >
      <div className="flex flex-col gap-4">
        <p className="fin-t-body text-[var(--fin-text-2)]">
          Copia as despesas fixas e variáveis lançadas manualmente de um mês para o outro. Ignora
          compras únicas, contas canceladas e custos gerados automaticamente por vendas ou grupos,
          porque esses nascem da própria venda. Os valores são mantidos e a cópia fica em aberto.
        </p>

        {opcoesMes.length === 0 ? (
          <p className="fin-t-body rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-3 text-[var(--fin-text-2)]">
            Ainda não existe nenhum mês com contas lançadas para copiar.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoSelecao
              rotulo="Mês de origem"
              valor={mesOrigem}
              opcoes={opcoesMes}
              onChange={onMesOrigem}
            />
            <Field rotulo="Mês de destino" ajuda="Escolha o mês que vai receber as cópias.">
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  type="month"
                  value={mesDestino}
                  onChange={(e) => onMesDestino(e.target.value)}
                  className={cn(CONTROLE, 'tabular-nums')}
                />
              )}
            </Field>
          </div>
        )}
      </div>
    </RecordSheet>
  );
}

export default PainelCopiarMes;
