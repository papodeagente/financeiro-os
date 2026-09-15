'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { StatusChip } from '@/components/fin/StatusChip';
import { usePrivacidade } from '@/components/fin/Privacidade';
import type { LancamentoDetalhado, LadoDoLancamento, RecorteDoDetalhe } from '@/lib/dashboard-detalhe';

/**
 * Os lançamentos por trás de um número.
 *
 * POR QUE EXISTE. "R$ 18.400 vencidos" é informação; "R$ 18.400 vencidos, do
 * João, há 45 dias" é decisão. O painel inteiro perde utilidade se cada número
 * for um beco sem saída — e ganha muita se qualquer número for uma porta.
 *
 * A gaveta MOSTRA e LEVA, não edita. Editar aqui criaria um segundo caminho de
 * baixa ao lado do das telas de contas, e baixa é a operação mais perigosa do
 * sistema: ela move o caixa e tem guarda de idempotência. Um segundo caminho
 * seria um segundo lugar para errar.
 */

export type PedidoDeDetalhe = {
  titulo: string;
  /** A frase que explica o recorte, para a pessoa saber o que está vendo. */
  subtitulo?: string;
  lado: LadoDoLancamento;
  recorte: RecorteDoDetalhe;
  referencia?: string;
  de: string;
  ate: string;
  /** Qual coluna de valor importa neste recorte. */
  campo: 'valorEmAberto' | 'valorRealizado';
};

const dataBR = (iso: string | null) => (iso && iso.length >= 10 ? iso.split('-').reverse().join('/') : '—');

function atrasoEmPalavras(dias: number | null): { texto: string; atrasado: boolean } {
  if (dias === null) return { texto: 'sem vencimento', atrasado: false };
  if (dias > 0) return { texto: `${dias} ${dias === 1 ? 'dia' : 'dias'} de atraso`, atrasado: true };
  if (dias === 0) return { texto: 'vence hoje', atrasado: false };
  const falta = Math.abs(dias);
  return { texto: `vence em ${falta} ${falta === 1 ? 'dia' : 'dias'}`, atrasado: false };
}

export function GavetaDeLancamentos({
  pedido,
  onFechar,
}: {
  pedido: PedidoDeDetalhe | null;
  onFechar: () => void;
}) {
  const { formatar } = usePrivacidade();
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [dados, setDados] = React.useState<{ linhas: LancamentoDetalhado[]; total: number; truncado: boolean } | null>(null);

  React.useEffect(() => {
    if (!pedido) return;
    let vivo = true;
    setEstado('carregando');
    setDados(null);
    const busca = new URLSearchParams({
      lado: pedido.lado,
      recorte: pedido.recorte,
      de: pedido.de,
      ate: pedido.ate,
      ...(pedido.referencia ? { ref: pedido.referencia } : {}),
    });
    fetch(`/api/dashboard/lancamentos?${busca}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error || `Erro ${r.status}`);
        return r.json();
      })
      .then(json => {
        if (!vivo) return;
        setDados(json);
        setEstado('ok');
      })
      .catch(() => {
        // A gaveta que falha diz que falhou. Lista vazia aqui leria como
        // "não há nada", que é uma afirmação diferente e perigosa.
        if (vivo) setEstado('erro');
      });
    return () => {
      vivo = false;
    };
  }, [pedido]);

  if (!pedido) return null;

  const soma = dados
    ? Math.round(dados.linhas.reduce((t, l) => t + l[pedido.campo], 0) * 100) / 100
    : 0;

  return (
    <RecordSheet
      aberto
      onOpenChange={aberto => { if (!aberto) onFechar(); }}
      titulo={pedido.titulo}
      descricao={pedido.subtitulo}
      largura={640}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
    >
      {estado === 'carregando' && (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-[56px] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
          ))}
        </div>
      )}

      {estado === 'erro' && (
        <p role="alert" className="fin-t-body text-[var(--fin-text-2)]">
          Não foi possível carregar os lançamentos. Nada foi alterado.
        </p>
      )}

      {estado === 'ok' && dados && (
        <div className="flex flex-col gap-3">
          <p className="fin-t-body-strong text-[var(--fin-text)]">
            {`${dados.total} ${dados.total === 1 ? 'lançamento' : 'lançamentos'} · ${formatar(soma)}`}
          </p>

          {dados.linhas.length === 0 ? (
            <p className="fin-t-body text-[var(--fin-text-2)]">Nenhum lançamento neste recorte.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
              {dados.linhas.map(l => {
                const atraso = atrasoEmPalavras(l.diasDeAtraso);
                return (
                  <li key={l.id} className="flex min-h-[56px] flex-col gap-1 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="fin-t-body-strong min-w-0 truncate text-[var(--fin-text)]">
                        {l.contraparte || l.descricao || 'Sem descrição'}
                      </span>
                      <span className="fin-t-body-strong shrink-0 tabular-nums text-[var(--fin-text)]">
                        {formatar(l[pedido.campo])}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="fin-t-caption text-[var(--fin-text-3)]">
                        {`vence ${dataBR(l.vencimento)}`}
                      </span>
                      {/* O atraso em palavras, não em cor: é ele que faz ligar
                          para o cliente, e cor sozinha não sobrevive à
                          impressão nem ao daltonismo. */}
                      <span
                        className={cn(
                          'fin-t-caption',
                          atraso.atrasado ? 'font-semibold text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]',
                        )}
                      >
                        {atraso.texto}
                      </span>
                      <StatusChip valor={l.status} dominio={pedido.lado === 'receber' ? 'receber' : 'pagar'} />
                      {l.valorRealizado > 0 && l.valorEmAberto > 0 && (
                        <span className="fin-t-caption text-[var(--fin-text-3)]">
                          {`${formatar(l.valorRealizado)} já baixados de ${formatar(l.valorTotal)}`}
                        </span>
                      )}
                    </div>
                    {l.descricao && l.contraparte && (
                      <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{l.descricao}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Corte silencioso é mentira por omissão: se a lista foi truncada,
              a tela diz, e manda para onde está o resto. */}
          {dados.truncado && (
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {`Mostrando os primeiros ${dados.linhas.length} de ${dados.total}. Abra a tela de contas para ver todos.`}
            </p>
          )}

          <a
            href={pedido.lado === 'receber' ? '/financeiro-ag/receber' : '/financeiro-ag/pagar'}
            className="fin-t-body-strong inline-flex h-11 items-center gap-2 self-start rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-4 text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            {pedido.lado === 'receber' ? 'Abrir contas a receber' : 'Abrir contas a pagar'}
          </a>
        </div>
      )}
    </RecordSheet>
  );
}

export default GavetaDeLancamentos;
