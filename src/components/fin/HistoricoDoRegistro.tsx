'use client';

import * as React from 'react';
import { ArrowRight, ChevronDown, PencilLine, Plus, RotateCcw, ScrollText, Trash2, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { VAZIO, type EventoDoHistorico, type TipoDoEvento } from '@/lib/historico-do-registro';
import { cn } from '@/lib/utils';

type Resposta = {
  eventos: EventoDoHistorico[];
  total: number;
  pagina: number;
  total_paginas: number;
  nome: string;
};

const ICONE: Record<TipoDoEvento, LucideIcon> = {
  criou: Plus,
  alterou: PencilLine,
  excluiu: Trash2,
  restaurou: RotateCcw,
  outro: ScrollText,
};

const TOM_DO_ICONE: Record<TipoDoEvento, string> = {
  criou: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
  alterou: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
  excluiu: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
  restaurou: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
  outro: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
};

function Valor({ texto, antes }: { texto: string; antes?: boolean }) {
  if (texto === VAZIO) return <span className="fin-t-caption italic text-[var(--fin-text-3)]">vazio</span>;
  return (
    <span className={cn('break-words tabular-nums', antes ? 'text-[var(--fin-text-3)] line-through decoration-[var(--fin-border-strong)]' : 'text-[var(--fin-text)]')}>
      {texto}
    </span>
  );
}

function Esqueleto() {
  return (
    <ul className="flex flex-col gap-[var(--fin-s-3)]">
      {[0, 1, 2].map(i => (
        <li key={i} className="flex gap-[var(--fin-s-3)]">
          <span className="size-8 shrink-0 rounded-full bg-[var(--fin-surface-2)]" />
          <span className="flex flex-1 flex-col gap-[var(--fin-s-1)]">
            <span className="h-4 w-1/3 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
            <span className="h-3 w-1/2 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Aba Histórico (06/11/2026, E7): cada gravação do registro, com quem fez,
 * quando (horário de Brasília) e o que mudou, antes → depois. Lê
 * GET /api/historico (o Registro de atividades filtrado por este registro).
 * Exclusão e restauração de título aparecem como eventos próprios.
 */
export function HistoricoDoRegistro({
  entidade,
  id,
  titulo = 'Histórico',
}: {
  /** Tabela do registro: contas_pagar, contas_receber, contas_bancarias, plano_contas, centros_custo, formas_pagamento, clientes, fornecedores_crm. */
  entidade: string;
  id: string;
  titulo?: string;
}) {
  const [eventos, setEventos] = React.useState<EventoDoHistorico[]>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = React.useState('');
  const [semAcesso, setSemAcesso] = React.useState<string | null>(null);
  const [pagina, setPagina] = React.useState(1);
  const [totalPaginas, setTotalPaginas] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [nome, setNome] = React.useState('registro');
  const [maisCarregando, setMaisCarregando] = React.useState(false);
  const idDoTitulo = React.useId();

  const ler = React.useCallback(async (p: number) => {
    const r = await fetch(`/api/historico?${new URLSearchParams({ entidade, id, pagina: String(p) })}`);
    const corpo = (await r.json().catch(() => ({}))) as Partial<Resposta> & { error?: string };
    return { ok: r.ok, status: r.status, corpo };
  }, [entidade, id]);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    setSemAcesso(null);
    try {
      const { ok, status, corpo } = await ler(1);
      if (status === 403) {
        setSemAcesso(corpo.error || 'Seu acesso não inclui o histórico deste registro.');
        setEstado('ok');
        return;
      }
      if (!ok) throw new Error(corpo.error || `Erro ${status}`);
      setEventos(corpo.eventos ?? []);
      setPagina(corpo.pagina ?? 1);
      setTotalPaginas(corpo.total_paginas ?? 1);
      setTotal(corpo.total ?? 0);
      if (corpo.nome) setNome(corpo.nome);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o histórico.');
      setEstado('erro');
    }
  }, [ler]);

  React.useEffect(() => { if (id) void carregar(); }, [carregar, id]);

  async function verMais() {
    setMaisCarregando(true);
    try {
      const { ok, corpo } = await ler(pagina + 1);
      if (ok) {
        setEventos(atual => [...atual, ...(corpo.eventos ?? [])]);
        setPagina(corpo.pagina ?? pagina + 1);
        setTotalPaginas(corpo.total_paginas ?? totalPaginas);
      }
    } finally {
      setMaisCarregando(false);
    }
  }

  return (
    <section aria-labelledby={idDoTitulo} className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
        <h3 id={idDoTitulo} className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h3>
        {estado === 'ok' && !semAcesso && total > 0 ? (
          <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
            {total === 1 ? '1 registro' : `${total} registros`}
          </span>
        ) : null}
      </div>

      <DataState
        estado={estado}
        erro={{ mensagem: erro, onTentarDeNovo: () => void carregar() }}
        esqueleto={<Esqueleto />}
      >
        {semAcesso ? (
          <p className="fin-t-body text-[var(--fin-text-2)]">{semAcesso}</p>
        ) : eventos.length === 0 ? (
          <EmptyLesson
            motivo="sem-dado"
            titulo="Nada registrado ainda"
            oQueE={`Cada alteração ${nome.startsWith('conta') || nome.startsWith('categoria') || nome.startsWith('forma') ? 'desta' : 'deste'} ${nome} aparece aqui, com quem fez, quando e o valor de antes e de depois. O que foi gravado antes do registro de atividades ser ligado não aparece.`}
          />
        ) : (
          <ol className="flex flex-col">
            {eventos.map((ev, i) => {
              const Icone = ICONE[ev.tipo];
              const ultimo = i === eventos.length - 1;
              return (
                <li key={ev.id} className="relative flex gap-[var(--fin-s-3)] pb-[var(--fin-s-4)] last:pb-0">
                  {!ultimo ? (
                    <span aria-hidden="true" className="absolute bottom-0 left-4 top-9 w-px bg-[var(--fin-border)]" />
                  ) : null}
                  <span aria-hidden="true" className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-full', TOM_DO_ICONE[ev.tipo])}>
                    <Icone className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-[var(--fin-s-1)] pt-1">
                    <p className="fin-t-body-strong text-[var(--fin-text)]">{ev.titulo}</p>
                    <p className="fin-t-caption text-[var(--fin-text-2)]">
                      <span className="text-[var(--fin-text)]">{ev.quem}</span>
                      {' · '}
                      <time dateTime={ev.quando} className="tabular-nums">{ev.quando_texto}</time>
                      {' · '}
                      {ev.origem}
                    </p>
                    {ev.alteracoes.length > 0 ? (
                      <dl className="mt-[var(--fin-s-1)] grid grid-cols-1 gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] sm:grid-cols-[minmax(8rem,auto)_1fr]">
                        {ev.alteracoes.map(a => (
                          <React.Fragment key={`${a.campo}-${a.antes}-${a.depois}`}>
                            <dt className="fin-t-caption text-[var(--fin-text-2)]">{a.rotulo}</dt>
                            <dd className="fin-t-body flex min-w-0 flex-wrap items-center gap-x-[var(--fin-s-2)] gap-y-1">
                              {ev.tipo === 'criou' ? (
                                <Valor texto={a.depois} />
                              ) : (
                                <>
                                  <Valor texto={a.antes} antes />
                                  <ArrowRight aria-label="passou a ser" className="size-3.5 shrink-0 text-[var(--fin-text-3)]" />
                                  <Valor texto={a.depois} />
                                </>
                              )}
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {!semAcesso && pagina < totalPaginas ? (
          <div className="mt-[var(--fin-s-3)]">
            <Button type="button" variant="outline" size="sm" onClick={() => void verMais()} disabled={maisCarregando}>
              {maisCarregando ? 'Carregando…' : 'Ver alterações mais antigas'}
            </Button>
          </div>
        ) : null}
      </DataState>
    </section>
  );
}

/**
 * O Histórico no pé de uma ficha (RecordSheet): fechado por padrão e só
 * consulta o servidor quando a pessoa abre. Mesmo desenho do BlocoRecolhivel.
 */
export function HistoricoRecolhivel({ entidade, id }: { entidade: string; id: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <details
      onToggle={e => setAberto((e.currentTarget as HTMLDetailsElement).open)}
      className="group border-t border-[var(--fin-border)] pt-3 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--fin-r-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]">
        <span className="flex flex-col">
          <span className="fin-t-subhead text-[var(--fin-text)]">Histórico</span>
          <span className="fin-t-caption text-[var(--fin-text-2)]">Quem mudou o quê e quando, com o valor de antes e de depois.</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--fin-text-3)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3">
        {aberto ? <HistoricoDoRegistro entidade={entidade} id={id} titulo="Alterações" /> : null}
      </div>
    </details>
  );
}

export default HistoricoDoRegistro;
