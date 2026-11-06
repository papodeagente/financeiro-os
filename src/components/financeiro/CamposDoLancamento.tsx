'use client';

/**
 * Peças do lançamento de contas a pagar e a receber (06/11/2026, E7):
 *   · CampoContaPrevista: a conta bancária onde se espera pagar/receber
 *     (vazia = a padrão da agência, dita pelo nome);
 *   · AvisoDeDiaNaoUtil: o vencimento cai em fim de semana ou feriado; avisa
 *     e oferece o próximo dia útil, sem impedir de salvar;
 *   · FaixaDaVenda: a conta nasceu de uma venda; o que muda só pela venda;
 *   · CampoMoeda: as moedas do cadastro; depois de criada, só leitura.
 * Nada aqui grava: devolve as alterações ao formulário.
 */
import * as React from 'react';
import Link from 'next/link';
import { CalendarClock, Lock } from 'lucide-react';

import { Field } from '@/components/fin/Field';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMoedas } from '@/components/fin/useMoedas';
import { moedasParaEscolher } from '@/lib/moedas';
import { contasParaEscolher } from '@/lib/contas-bancarias-regras';
import { ErroAoGravar, enderecoDaVenda } from '@/lib/gravar-registro';
import { toast } from '@/lib/toast';
import { avisoDeDiaNaoUtil, EXPLICA_TRAVA_DA_VENDA } from '@/lib/lancamento-titulo';
import { cn } from '@/lib/utils';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';
const CONTROLE = cn(
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10',
  FOCO,
);
const PADRAO = '__PADRAO__';

export type ContaParaPrevisao = { id: string; nome: string; ativo?: unknown; moeda?: string };

/** Contas bancárias e a conta previsão padrão da agência, para os formulários. */
export function useContasDaPrevisao(): { contas: ContaParaPrevisao[]; padraoId: string | null } {
  const [estado, setEstado] = React.useState<{ contas: ContaParaPrevisao[]; padraoId: string | null }>({ contas: [], padraoId: null });
  React.useEffect(() => {
    let vivo = true;
    Promise.all([
      fetch('/api/contas-bancarias', { cache: 'no-store' }).then(r => (r.ok ? r.json() : [])).catch(() => []),
      fetch('/api/config/financeiro/conta-previsao', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([contas, cfg]) => {
      if (!vivo) return;
      const lista = Array.isArray(contas)
        ? (contas as Array<Record<string, unknown>>).map(c => ({
          id: String(c.id ?? ''), nome: String(c.nome ?? '') || 'Conta', ativo: c.ativo, moeda: typeof c.moeda === 'string' ? c.moeda : undefined,
        })).filter(c => c.id)
        : [];
      const padrao = cfg && typeof cfg === 'object' && typeof (cfg as Record<string, unknown>).conta_previsao_padrao === 'string'
        ? String((cfg as Record<string, unknown>).conta_previsao_padrao) || null
        : null;
      setEstado({ contas: lista, padraoId: padrao });
    });
    return () => { vivo = false; };
  }, []);
  return estado;
}

export function CampoContaPrevista({
  valor, onChange, contas, padraoId, verbo, desabilitado,
}: {
  valor: string;
  onChange: (id: string) => void;
  contas: readonly ContaParaPrevisao[];
  padraoId: string | null;
  /** "pagar" ou "receber", para a ajuda. */
  verbo: 'pagar' | 'receber';
  desabilitado?: boolean;
}) {
  const escolhiveis = contasParaEscolher(contas, valor || null);
  const padrao = padraoId ? contas.find(c => c.id === padraoId) : undefined;
  const rotuloVazio = padrao ? `A padrão da agência (${padrao.nome})` : 'Ainda não sei';
  const escolhida = contas.find(c => c.id === valor);
  return (
    <Field
      rotulo="Conta (previsão)"
      ajuda={`Onde se espera ${verbo}. Entra no fluxo de caixa por conta enquanto a conta estiver em aberto.`}
    >
      {a => (
        <Select value={valor || PADRAO} onValueChange={v => onChange(String(v) === PADRAO ? '' : String(v))} disabled={desabilitado}>
          <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'justify-between gap-2')}>
            <SelectValue>{() => (escolhida ? escolhida.nome : rotuloVazio)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PADRAO} className="fin-t-body">{rotuloVazio}</SelectItem>
            {escolhiveis.map(c => (
              <SelectItem key={c.id} value={c.id} className="fin-t-body">
                {c.nome}{c.moeda && c.moeda !== 'BRL' ? ` (${c.moeda})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/** Aviso, não bloqueio: o vencimento cai num dia em que o banco não abre. */
export function AvisoDeDiaNaoUtil({ vencimento, onUsar, desabilitado }: {
  vencimento: string;
  onUsar: (iso: string) => void;
  desabilitado?: boolean;
}) {
  const aviso = avisoDeDiaNaoUtil(vencimento);
  if (!aviso) return null;
  const [a, m, d] = aviso.proximo.split('-');
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-[var(--fin-s-3)] gap-y-[var(--fin-s-1)] rounded-[var(--fin-r-md)] border border-[var(--fin-warning)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]"
    >
      <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-[var(--fin-warning-text)]" />
      <span className="fin-t-caption min-w-0 flex-1 text-[var(--fin-warning-text)]">{aviso.mensagem}</span>
      {!desabilitado ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onUsar(aviso.proximo)}
          className={cn('h-11 shrink-0 px-[var(--fin-s-2)] text-[var(--fin-warning-text)] underline underline-offset-2 lg:h-8', FOCO)}
        >
          Usar {d}/{m}/{a}
        </Button>
      ) : null}
    </div>
  );
}

/** A conta nasceu de uma venda: pessoa, valor e vencimento mudam por lá. */
export function FaixaDaVenda({ vendaId }: { vendaId: string }) {
  return (
    <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] p-[var(--fin-s-3)] sm:flex-row sm:items-center sm:gap-[var(--fin-s-3)]">
      <Lock aria-hidden="true" className="size-4 shrink-0 text-[var(--fin-text-3)]" />
      <p className="fin-t-caption min-w-0 flex-1 text-[var(--fin-text-2)]">{EXPLICA_TRAVA_DA_VENDA}</p>
      <Link
        href={enderecoDaVenda(vendaId)}
        className={cn('fin-t-body-strong shrink-0 rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-2', FOCO)}
      >
        Abrir a venda
      </Link>
    </div>
  );
}

/** Campo travado pela venda: mostra o valor, sem controle para editar. */
export function CampoSoLeitura({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="fin-t-body-strong flex items-center gap-1 text-[var(--fin-text)]">
        {rotulo}
        <Lock aria-hidden="true" className="size-3.5 text-[var(--fin-text-3)]" />
        <span className="sr-only">(muda pela venda)</span>
      </span>
      <span className="fin-t-body flex min-h-11 items-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-3 tabular-nums text-[var(--fin-text-2)] lg:min-h-10">
        {children}
      </span>
    </div>
  );
}

/** As moedas do cadastro. A moeda não muda depois que a conta existe. */
export function CampoMoeda({ valor, onChange, travada, ajuda }: {
  valor: string;
  onChange: (codigo: string) => void;
  travada?: boolean;
  ajuda?: string;
}) {
  // Catálogo da agência (E7): as oito do sistema e as que ela cadastrou.
  const { moedas } = useMoedas();
  const atual = moedas.find(m => m.codigo === valor);
  const rotulo = (m: { codigo: string; nome: string }) => `${m.nome} (${m.codigo})`;
  return (
    <Field
      rotulo="Moeda"
      ajuda={travada ? 'A moeda não muda depois que a conta existe. Para outra moeda, lance uma conta nova.' : ajuda}
    >
      {a => (
        <Select value={valor || 'BRL'} onValueChange={v => onChange(String(v))} disabled={travada}>
          <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'justify-between gap-2')}>
            <SelectValue>{() => (atual ? rotulo(atual) : valor || 'Real (BRL)')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {moedasParaEscolher(moedas, valor).map(m => (
              <SelectItem key={m.codigo} value={m.codigo} className="fin-t-body">{rotulo(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/**
 * O que a tela faz quando o servidor recusou a gravação (06/11/2026, E7):
 *   · edição simultânea (409 conflito): chama `onConflito` (a tela abre o
 *     AvisoDeEdicaoSimultanea);
 *   · campo que só muda pela venda: a frase do servidor com "Abrir a venda";
 *   · o resto: o toast de erro de sempre.
 */
export function tratarErroAoGravar(e: unknown, titulo: string, onConflito: () => void): void {
  if (e instanceof ErroAoGravar && e.conflito) { onConflito(); return; }
  if (e instanceof ErroAoGravar && e.vendaId) {
    const venda = e.vendaId;
    toast.comAcao(titulo, e.message, { rotulo: 'Abrir a venda', onClick: () => { window.location.assign(enderecoDaVenda(venda)); } });
    return;
  }
  toast.error(titulo, e instanceof Error ? e.message : '');
}
