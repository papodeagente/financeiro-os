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

export type StatusDominio = 'pagar' | 'receber' | 'conciliacao' | 'transferencia' | 'origem' | 'natureza' | 'comissao' | 'plano' | 'cobranca' | 'mudanca' | 'nota' | 'comissao_item' | 'reembolso' | 'credito' | 'fatura' | 'conferencia_fatura';

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
    VENDA_DIRETA:        { rotulo: 'Venda direta',           tone: 'info'   },
    GRUPO:               { rotulo: 'Grupo',                  tone: 'info'   },
    CRM:                 { rotulo: 'Importado do CRM',       tone: 'info'   },
    COMISSAO_FORNECEDOR: { rotulo: 'Comissão de fornecedor', tone: 'neutro' },
    DESPESA_FIXA:        { rotulo: 'Despesa fixa',           tone: 'neutro' },
    FEE:                 { rotulo: 'Taxa de serviço',        tone: 'neutro' },
    MANUAL:              { rotulo: 'Lançado à mão',          tone: 'neutro' },
    OUTROS:              { rotulo: 'Outros',                 tone: 'neutro' },
  },
  comissao: {
    // "CALCULADA" no filtro e "A Aprovar" no cartão eram dois nomes para o
    // mesmo estado, na mesma tela. Aqui o nome é um só.
    CALCULADA: { rotulo: 'A aprovar',        tone: 'aviso'    },
    APROVADA:  { rotulo: 'Aprovada, a pagar', tone: 'info'    },
    PAGA:      { rotulo: 'Paga',             tone: 'positivo' },
    CANCELADA: { rotulo: 'Cancelada',        tone: 'neutro'   },
  },
  // Comissão por função, item a item (comissao-funcoes.ts › situacaoDoItem).
  comissao_item: {
    PREVISTA:  { rotulo: 'Prevista',  tone: 'neutro'   },
    LIBERADA:  { rotulo: 'Liberada',  tone: 'info'     },
    FECHADA:   { rotulo: 'Fechada',   tone: 'aviso'    },
    PAGA:      { rotulo: 'Paga',      tone: 'positivo' },
    ESTORNADA: { rotulo: 'Estornada', tone: 'negativo' },
  },
  // Acompanhamento do plano do mês (src/lib/plano-do-mes.ts).
  plano: {
    concluido: { rotulo: 'Concluído',       tone: 'positivo' },
    pendente:  { rotulo: 'Pendente',        tone: 'info'     },
    atrasado:  { rotulo: 'Atrasado',        tone: 'negativo' },
    acima:     { rotulo: 'Acima do plano',  tone: 'aviso'    },
    sem_dados: { rotulo: 'Sem dados',       tone: 'neutro'   },
    sem_meta:  { rotulo: 'Sem meta',        tone: 'neutro'   },
    em_linha:  { rotulo: 'Dentro do plano', tone: 'positivo' },
    abaixo:    { rotulo: 'Abaixo do plano', tone: 'aviso'    },
  },
  natureza: {
    FIXO:         { rotulo: 'Fixo',          tone: 'neutro' },
    VARIAVEL:     { rotulo: 'Variável',      tone: 'neutro' },
    COMPRA_UNICA: { rotulo: 'Compra única',  tone: 'neutro' },
  },
  // Cobrança emitida pelo Asaas/Pagar.me da agência (E3, 05/11/2026). Mesmos
  // rótulos de src/lib/cobranca/regras-telas.ts (SITUACAO_DA_COBRANCA).
  cobranca: {
    emitindo:  { rotulo: 'Emitindo',             tone: 'info'     },
    aberta:    { rotulo: 'Aguardando pagamento', tone: 'neutro'   },
    vencida:   { rotulo: 'Vencida',              tone: 'negativo' },
    paga:      { rotulo: 'Paga',                 tone: 'positivo' },
    cancelada: { rotulo: 'Cancelada',            tone: 'neutro'   },
    estornada: { rotulo: 'Estornada',            tone: 'aviso'    },
    falhou:    { rotulo: 'Não emitida',          tone: 'negativo' },
  },
  // Fatura ao cliente (E5, parte B, 05/11/2026). Mesmos rótulos de
  // src/lib/fatura-regras.ts (ROTULO_SITUACAO e ROTULO_CONFERENCIA).
  fatura: {
    ABERTA:    { rotulo: 'Aberta',        tone: 'info'     },
    FECHADA:   { rotulo: 'Fechada',       tone: 'neutro'   },
    EM_ATRASO: { rotulo: 'Em atraso',     tone: 'negativo' },
    PARCIAL:   { rotulo: 'Paga em parte', tone: 'aviso'    },
    PAGA:      { rotulo: 'Paga',          tone: 'positivo' },
    CANCELADA: { rotulo: 'Cancelada',     tone: 'neutro'   },
  },
  conferencia_fatura: {
    NAO_ENVIADA: { rotulo: 'Não enviada',            tone: 'neutro'   },
    AGUARDANDO:  { rotulo: 'Aguardando o cliente',   tone: 'info'     },
    APROVADA:    { rotulo: 'Aprovada pelo cliente',  tone: 'positivo' },
    CONTESTADA:  { rotulo: 'Contestada',             tone: 'negativo' },
  },
  // Mudança de sistema (E4, 05/11/2026): resultado de cada linha do ensaio e
  // situação de cada prova (src/lib/migracao/telas/assistente.ts).
  mudanca: {
    criar:          { rotulo: 'Será criado',         tone: 'positivo' },
    vincular:       { rotulo: 'Liga com existente',  tone: 'info'     },
    recusar:        { rotulo: 'Recusado',            tone: 'negativo' },
    bate:           { rotulo: 'Bateu',               tone: 'positivo' },
    explicada:      { rotulo: 'Diferença explicada', tone: 'aviso'    },
    sem_explicacao: { rotulo: 'Sem explicação',      tone: 'negativo' },
    pronto:         { rotulo: 'Completo',            tone: 'positivo' },
    parcial:        { rotulo: 'Em parte',            tone: 'aviso'    },
    vem:            { rotulo: 'Ainda vem',           tone: 'neutro'   },
  },
  // Gerar notas (E5, parte E): a situação de cada produto da venda.
  nota: {
    SEM_REGRA:    { rotulo: 'Sem regra',             tone: 'aviso'    },
    SEM_RECEITA:  { rotulo: 'Nada a emitir',         tone: 'neutro'   },
    A_EMITIR:     { rotulo: 'A emitir',              tone: 'info'     },
    COMPLEMENTAR: { rotulo: 'Complementar sugerida', tone: 'aviso'    },
    EMITIDA:      { rotulo: 'Em nota',               tone: 'positivo' },
    ACIMA:        { rotulo: 'Nota acima da receita', tone: 'negativo' },
    CANCELADA:    { rotulo: 'Cancelada com nota',    tone: 'negativo' },
  },
  // Reembolsos e crédito do cliente (E5, parte D). Mesmos rótulos de
  // src/lib/reembolsos-servidor.ts e src/lib/credito-cliente.ts.
  reembolso: {
    SOLICITADO: { rotulo: 'Solicitado', tone: 'info'     },
    APROVADO:   { rotulo: 'Aprovado',   tone: 'aviso'    },
    PAGO:       { rotulo: 'Pago',       tone: 'positivo' },
    CANCELADO:  { rotulo: 'Cancelado',  tone: 'neutro'   },
    ATRASADO:   { rotulo: 'Prazo vencido', tone: 'negativo' },
  },
  credito: {
    ATIVO:     { rotulo: 'Com saldo', tone: 'positivo' },
    USADO:     { rotulo: 'Usado',     tone: 'neutro'   },
    VENCIDO:   { rotulo: 'Vencido',   tone: 'negativo' },
    CANCELADO: { rotulo: 'Cancelado', tone: 'neutro'   },
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
