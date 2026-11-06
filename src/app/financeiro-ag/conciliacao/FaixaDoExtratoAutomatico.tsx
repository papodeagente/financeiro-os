'use client';

/**
 * Na conciliação, a conta que lê o extrato sozinha diz isso numa faixa: quando
 * leu, quantas linhas chegaram do banco e quantas ainda esperam conferência.
 * Dá para pedir uma leitura na hora. Conexão com problema aparece aqui com a
 * frase da saúde, e o arquivo continua valendo.
 */

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { fraseDaLeitura, lerAgora, type ConexaoBancaria } from '../extrato-automatico/useExtratoAutomatico';

const FOCO = 'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2';

export function FaixaDoExtratoAutomatico({
  conexao, linhasDoBanco, aConferirDoBanco, podeLer, onLido,
}: {
  conexao: ConexaoBancaria;
  /** Linhas desta conta que chegaram pela leitura automática. */
  linhasDoBanco: number;
  /** Dessas, quantas ainda estão na fila. */
  aConferirDoBanco: number;
  podeLer: boolean;
  /** Leu: a tela recarrega o extrato. */
  onLido: () => Promise<void> | void;
}) {
  const [lendo, setLendo] = useState(false);
  const { saude } = conexao;
  const parada = conexao.status === 'EXPIRADA' || saude.nivel === 'critico';
  const atencao = !parada && saude.nivel === 'atencao';

  async function ler() {
    if (lendo) return;
    setLendo(true);
    try {
      const r = await lerAgora(conexao.id);
      const f = fraseDaLeitura(r.corpo);
      if (f.tom === 'sucesso') toast.success(f.titulo, f.detalhe);
      else if (f.tom === 'erro') toast.error(f.titulo, f.detalhe);
      else toast.info(f.titulo, f.detalhe);
      await onLido();
    } catch {
      toast.error('Sem resposta do servidor', 'A leitura automática continua na próxima hora.');
    } finally {
      setLendo(false);
    }
  }

  const contagem = linhasDoBanco === 0
    ? 'Nenhuma linha desta conta chegou do banco ainda.'
    : `${linhasDoBanco.toLocaleString('pt-BR')} ${linhasDoBanco === 1 ? 'linha chegou sozinha' : 'linhas chegaram sozinhas'} do banco${aConferirDoBanco ? `, ${aConferirDoBanco.toLocaleString('pt-BR')} ainda a conferir` : ', todas conferidas'}.`;

  return (
    <section
      aria-label="Extrato automático desta conta"
      className={cn(
        'flex flex-wrap items-center justify-between gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border px-[var(--fin-s-4)] py-[var(--fin-s-3)]',
        parada
          ? 'border-[var(--fin-negative)]/30 bg-[var(--fin-negative-soft)]'
          : atencao
            ? 'border-[var(--fin-warning)]/30 bg-[var(--fin-warning-soft)]'
            : 'border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]',
      )}
    >
      <div className="flex min-w-0 items-start gap-[var(--fin-s-3)]">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-[var(--fin-r-md)]',
            parada ? 'bg-[var(--fin-surface)] text-[var(--fin-negative-text)]'
              : atencao ? 'bg-[var(--fin-surface)] text-[var(--fin-warning-text)]'
                : 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
          )}
        >
          {parada ? <XCircle className="size-5" /> : atencao ? <AlertTriangle className="size-5" /> : <RefreshCw className={cn('size-5', lendo && 'animate-spin')} />}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={cn('fin-t-body-strong', parada ? 'text-[var(--fin-negative-text)]' : atencao ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text)]')}>
            Extrato automático: {saude.titulo.charAt(0).toLowerCase() + saude.titulo.slice(1)}
          </span>
          <span className="fin-t-caption text-[var(--fin-text-2)]">
            {parada || atencao ? saude.frase : contagem}
            {saude.certificado && !parada ? ` ${saude.certificado.frase}` : ''}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
        {podeLer && !parada ? (
          <Button type="button" variant="outline" className="h-11 gap-[var(--fin-s-1)] px-3 lg:h-9" disabled={lendo} aria-busy={lendo} onClick={() => void ler()}>
            <RefreshCw aria-hidden="true" className={cn('size-4', lendo && 'animate-spin')} />
            {lendo ? 'Lendo o banco' : 'Ler agora'}
          </Button>
        ) : null}
        <Link
          href="/financeiro-ag/extrato-automatico"
          className={cn('fin-t-body inline-flex h-11 items-center rounded-[var(--fin-r-md)] px-2 font-medium text-[var(--fin-accent)] underline-offset-2 hover:underline lg:h-9', FOCO)}
        >
          {parada ? 'Resolver a conexão' : 'Ver conexão'}
        </Link>
      </div>
    </section>
  );
}
