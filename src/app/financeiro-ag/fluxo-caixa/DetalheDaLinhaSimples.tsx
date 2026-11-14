'use client';

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { EtiquetaDaPlataforma } from '@/components/fin/EtiquetaDaPlataforma';
import { Segmentado } from '@/components/fin/Segmentado';
import {
  dataPorExtenso, ordenarLancamentos, rotuloDoDia,
  type Agrupamento, type Lancamento, type LinhaDoCaderno,
} from '@/lib/caderno-caixa';
import { cn, formatBRL } from '@/lib/utils';

export type DetalheDaLinhaProps = {
  linha: LinhaDoCaderno | null;
  agrupamento: Agrupamento;
  /** Ano do período, para o título "Outubro de 2026". */
  ano: string;
  hoje: string;
  onFechar: () => void;
};

type Filtro = 'tudo' | 'entrada' | 'saida';

function dataCurta(iso: string): string {
  return iso ? iso.split('-').reverse().slice(0, 2).join('/') : '';
}

function situacaoPorExtenso(l: Lancamento): { texto: string; tom: 'neutro' | 'atencao' } {
  if (l.situacao === 'realizado') return { texto: l.tipo === 'entrada' ? 'Recebido' : 'Pago', tom: 'neutro' };
  if (l.situacao === 'atrasado') {
    return { texto: `${l.tipo === 'entrada' ? 'Atrasado' : 'Vencido'}, venceu em ${dataCurta(l.vencimento)}`, tom: 'atencao' };
  }
  if (l.origem === 'folha') return { texto: 'Folha prevista', tom: 'neutro' };
  return { texto: l.tipo === 'entrada' ? 'A receber' : 'A pagar', tom: 'neutro' };
}

function LinhaDeLancamento({ l }: { l: Lancamento }) {
  const entrada = l.tipo === 'entrada';
  const situacao = situacaoPorExtenso(l);
  const Icone = entrada ? ArrowDownLeft : ArrowUpRight;
  return (
    <li className="flex items-start gap-[var(--fin-s-3)] py-[var(--fin-s-3)]">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
          entrada ? 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]' : 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
        )}
      >
        <Icone className="size-4" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-[var(--fin-s-2)] gap-y-1">
          <span className="min-w-0 truncate fin-t-body-strong text-[var(--fin-text)]">
            {l.quem || l.descricao || 'Lançamento sem descrição'}
          </span>
          {l.plataforma ? <EtiquetaDaPlataforma plataforma={l.plataforma} /> : null}
        </span>
        {l.quem && l.descricao ? (
          <span className="truncate fin-t-body text-[var(--fin-text-2)]">{l.descricao}</span>
        ) : null}
        <span
          className={cn(
            'fin-t-caption',
            situacao.tom === 'atencao' ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text-3)]',
          )}
        >
          {situacao.texto}
          {l.taxa > 0 ? ` · ${formatBRL(l.valor + l.taxa)} com ${formatBRL(l.taxa)} de taxa retida` : ''}
        </span>
      </span>

      <span
        className={cn(
          'shrink-0 pt-0.5 fin-t-body-strong tabular-nums',
          entrada ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]',
          l.situacao !== 'realizado' && 'opacity-80',
        )}
      >
        {entrada ? '+' : '−'}{formatBRL(l.valor)}
      </span>
    </li>
  );
}

/**
 * O detalhe de uma linha do caderno, no centro da tela.
 *
 * Os lançamentos vêm na ordem do caderno (data, o que já aconteceu antes do
 * previsto). Em semana e mês, cada dia ganha um subtítulo, como as folhas de
 * um caderno de verdade.
 */
export function DetalheDaLinha({ linha, agrupamento, ano, hoje, onFechar }: DetalheDaLinhaProps) {
  const [filtro, setFiltro] = useState<Filtro>('tudo');
  const [linhaAnterior, setLinhaAnterior] = useState<string | null>(null);
  // Linha nova abre sempre em "Tudo": ajuste na renderização, sem efeito.
  const chave = linha?.chave ?? null;
  if (chave !== linhaAnterior) {
    setLinhaAnterior(chave);
    setFiltro('tudo');
  }

  const lancamentos = linha ? ordenarLancamentos(linha.lancamentos) : [];
  const nEntradas = lancamentos.filter(l => l.tipo === 'entrada').length;
  const nSaidas = lancamentos.length - nEntradas;
  const visiveis = lancamentos.filter(l => filtro === 'tudo' || l.tipo === filtro);
  const variosDias = agrupamento !== 'dia';

  const titulo = !linha ? ''
    : agrupamento === 'dia' ? dataPorExtenso(linha.inicio)
      : agrupamento === 'semana' ? `Semana de ${linha.rotulo}`
        : `${linha.rotulo} de ${ano}`;

  const quando = !linha ? ''
    : linha.contemHoje ? (agrupamento === 'dia' ? 'Hoje' : 'Inclui hoje')
      : linha.futura ? 'Previsão'
        : 'Já aconteceu';

  // Agrupa por dia mantendo a ordem do caderno.
  const porDia: Array<{ dia: string; itens: Lancamento[] }> = [];
  for (const l of visiveis) {
    const ultimo = porDia[porDia.length - 1];
    if (ultimo && ultimo.dia === l.data) ultimo.itens.push(l);
    else porDia.push({ dia: l.data, itens: [l] });
  }

  return (
    <Dialog open={linha !== null} onOpenChange={aberto => { if (!aberto) onFechar(); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {linha ? (
          <>
            <div className="flex flex-col gap-1 px-[var(--fin-s-5)] pb-[var(--fin-s-4)] pt-[var(--fin-s-5)] pr-12">
              <span className="fin-t-caption font-medium text-[var(--fin-text-3)]">{quando}</span>
              <DialogTitle className="fin-t-title text-[var(--fin-text)]">{titulo}</DialogTitle>
              <DialogDescription className="fin-t-body text-[var(--fin-text-2)]">
                {lancamentos.length} {lancamentos.length === 1 ? 'lançamento' : 'lançamentos'}{' '}
                {agrupamento === 'dia' ? 'neste dia' : agrupamento === 'semana' ? 'nesta semana' : 'neste mês'}
              </DialogDescription>
            </div>

            <dl className="mx-[var(--fin-s-5)] grid grid-cols-3 divide-x divide-[var(--fin-border)] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)] py-[var(--fin-s-3)]">
              {[
                {
                  rotulo: 'Entrou',
                  valor: linha.entradas > 0 ? `+${formatBRL(linha.entradas)}` : '—',
                  cor: linha.entradas > 0 ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text-3)]',
                },
                {
                  rotulo: 'Saiu',
                  valor: linha.saidas > 0 ? `−${formatBRL(linha.saidas)}` : '—',
                  cor: linha.saidas > 0 ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]',
                },
                {
                  rotulo: 'Saldo no fim',
                  valor: formatBRL(linha.saldo),
                  cor: linha.saldo < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]',
                },
              ].map(c => (
                <div key={c.rotulo} className="flex min-w-0 flex-col items-center gap-0.5 px-[var(--fin-s-2)]">
                  <dt className="fin-t-caption text-[var(--fin-text-3)]">{c.rotulo}</dt>
                  <dd className={cn('truncate fin-t-body-strong tabular-nums', c.cor)}>{c.valor}</dd>
                </div>
              ))}
            </dl>

            {nEntradas > 0 && nSaidas > 0 ? (
              <div className="px-[var(--fin-s-5)] pt-[var(--fin-s-4)]">
                <Segmentado<Filtro>
                  rotulo="Mostrar"
                  cheio
                  valor={filtro}
                  onChange={setFiltro}
                  opcoes={[
                    { valor: 'tudo', rotulo: 'Tudo' },
                    { valor: 'entrada', rotulo: `Entradas (${nEntradas})` },
                    { valor: 'saida', rotulo: `Saídas (${nSaidas})` },
                  ]}
                />
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-[var(--fin-s-5)] pb-[var(--fin-s-2)] pt-[var(--fin-s-2)]">
              {porDia.map(grupo => (
                <section key={grupo.dia || 'sem-data'} aria-label={variosDias ? rotuloDoDia(grupo.dia) : undefined}>
                  {variosDias ? (
                    <h3 className="sticky top-0 z-[var(--fin-z-conteudo)] border-b border-[var(--fin-border)] bg-[var(--fin-surface)] pb-1 pt-[var(--fin-s-3)] fin-t-overline text-[var(--fin-text-3)]">
                      {rotuloDoDia(grupo.dia)}{grupo.dia === hoje ? ' · hoje' : ''}
                    </h3>
                  ) : null}
                  <ul className="divide-y divide-[var(--fin-border)]">
                    {grupo.itens.map(l => <LinhaDeLancamento key={l.id} l={l} />)}
                  </ul>
                </section>
              ))}
            </div>

            <div className="flex justify-end border-t border-[var(--fin-border)] px-[var(--fin-s-5)] py-[var(--fin-s-3)]">
              <Button type="button" variant="outline" onClick={onFechar} className="h-11 lg:h-10">
                Fechar
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default DetalheDaLinha;
