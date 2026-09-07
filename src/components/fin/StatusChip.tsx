import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

export const statusChipVariants = cva(
  'inline-flex items-center gap-1.5 rounded-[var(--fin-r-sm)] px-2 py-0.5 fin-t-caption font-medium border whitespace-nowrap',
  {
    variants: {
      tone: {
        neutro:   'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)] border-[var(--fin-border)]',
        positivo: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)] border-[var(--fin-positive)]/24',
        negativo: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] border-[var(--fin-negative)]/24',
        aviso:    'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)] border-[var(--fin-warning)]/24',
        info:     'bg-[var(--fin-info-soft)] text-[var(--fin-info)] border-[var(--fin-info)]/24',
      },
      size: { sm: 'h-5', md: 'h-6 px-2.5' },
    },
    defaultVariants: { tone: 'neutro', size: 'sm' },
  }
);

export type StatusTone = NonNullable<VariantProps<typeof statusChipVariants>['tone']>;

export type StatusDominio = 'pagar' | 'receber' | 'conciliacao' | 'transferencia' | 'origem' | 'natureza';

export type StatusChipProps = {
  /** Valor cru do banco. NUNCA é renderizado como veio. */
  valor: string;
  dominio: StatusDominio;
  size?: 'sm' | 'md';
  /** Ponto de 6px antes do texto: segundo portador do significado. */
  dot?: boolean;
  className?: string;
};

/**
 * Dicionário único de rótulos. Consumido pela tela, pela exportação, pelo
 * e-mail e pela mensagem de erro, para que o suporte opere um vocabulário só.
 * O valor do banco permanece intacto: aqui só se traduz o que aparece.
 */
export const STATUS_LABELS: Record<StatusDominio, Record<string, { rotulo: string; tone: StatusTone }>> = {
  pagar: {
    PENDENTE:  { rotulo: 'Em aberto',     tone: 'neutro'   },
    PARCIAL:   { rotulo: 'Pago em parte', tone: 'aviso'    },
    PAGO:      { rotulo: 'Pago',          tone: 'positivo' },
    VENCIDO:   { rotulo: 'Vencido',       tone: 'negativo' },
    CANCELADO: { rotulo: 'Cancelado',     tone: 'neutro'   },
  },
  receber: {
    PENDENTE:  { rotulo: 'Em aberto',          tone: 'neutro'   },
    PARCIAL:   { rotulo: 'Recebido em parte',  tone: 'aviso'    },
    RECEBIDO:  { rotulo: 'Recebido',           tone: 'positivo' },
    ATRASADO:  { rotulo: 'Em atraso',          tone: 'negativo' },
    VENCIDO:   { rotulo: 'Vencido',            tone: 'negativo' },
    CANCELADO: { rotulo: 'Cancelado',          tone: 'neutro'   },
  },
  conciliacao: {
    PENDENTE:   { rotulo: 'A conciliar', tone: 'neutro'   },
    CONCILIADO: { rotulo: 'Conciliado',  tone: 'positivo' },
    DIVERGENTE: { rotulo: 'Divergente',  tone: 'aviso'    },
    IGNORADO:   { rotulo: 'Ignorado',    tone: 'neutro'   },
  },
  transferencia: {
    PENDENTE:  { rotulo: 'Em aberto',  tone: 'neutro'   },
    EFETIVADA: { rotulo: 'Efetivada',  tone: 'positivo' },
    CANCELADA: { rotulo: 'Cancelada',  tone: 'neutro'   },
    CANCELADO: { rotulo: 'Cancelada',  tone: 'neutro'   },
  },
  origem: {
    VENDA:               { rotulo: 'Venda',                  tone: 'info'   },
    GRUPO:               { rotulo: 'Grupo',                  tone: 'info'   },
    CRM:                 { rotulo: 'Importado do CRM',       tone: 'info'   },
    COMISSAO_FORNECEDOR: { rotulo: 'Comissão de fornecedor', tone: 'neutro' },
    DESPESA_FIXA:        { rotulo: 'Despesa fixa',           tone: 'neutro' },
    FEE:                 { rotulo: 'Taxa de serviço',        tone: 'neutro' },
    MANUAL:              { rotulo: 'Lançado à mão',          tone: 'neutro' },
    OUTROS:              { rotulo: 'Outros',                 tone: 'neutro' },
  },
  natureza: {
    FIXO:         { rotulo: 'Fixo',          tone: 'neutro' },
    VARIAVEL:     { rotulo: 'Variável',      tone: 'neutro' },
    COMPRA_UNICA: { rotulo: 'Compra única',  tone: 'neutro' },
  },
};

/** Último recurso: enum desconhecido nunca chega à tela em caixa alta com sublinhado. */
function humanizarEnum(valor: string): string {
  const limpo = valor.trim().replace(/_/g, ' ').toLocaleLowerCase('pt-BR');
  if (!limpo) return valor;
  return limpo.charAt(0).toLocaleUpperCase('pt-BR') + limpo.slice(1);
}

/** Fonte única também para CSV e e-mail. */
export function rotuloStatus(dominio: StatusDominio, valor: string): string {
  return STATUS_LABELS[dominio]?.[valor]?.rotulo ?? humanizarEnum(valor);
}

export function toneStatus(dominio: StatusDominio, valor: string): StatusTone {
  return STATUS_LABELS[dominio]?.[valor]?.tone ?? 'neutro';
}

export function StatusChip({ valor, dominio, size = 'sm', dot = false, className }: StatusChipProps) {
  const tone = toneStatus(dominio, valor);
  const rotulo = rotuloStatus(dominio, valor);

  return (
    <span className={cn(statusChipVariants({ tone, size }), className)} data-slot="fin-status-chip" data-tone={tone}>
      {dot ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-[var(--fin-r-dot)] bg-current"
        />
      ) : null}
      {rotulo}
    </span>
  );
}

export default StatusChip;
