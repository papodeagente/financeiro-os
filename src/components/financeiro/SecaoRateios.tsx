'use client';

/**
 * Seção "Rateios" das contas a pagar e a receber (05/11/2026).
 *
 * Centro único é o caminho curto: um centro, 100% da conta. "Dividir entre
 * centros" abre as linhas (centro, categoria opcional, percentual) e o valor
 * de cada uma é calculado em centavos sobre o valor da conta. Uma regra
 * salva ("Aluguel: 50% SP / 50% RJ") preenche tudo com um clique. Tags
 * livres ficam no fim. Nada aqui grava: devolve as alterações ao formulário.
 */
import * as React from 'react';
import Link from 'next/link';
import { Plus, Split, Trash2, X } from 'lucide-react';

import type { CentroCusto, LinhaRateio, PlanoContas, RegraRateio } from '@/lib/crm-types';
import { aplicarRegraDeRateio, dividirIgual, normalizarTags, ordenarEmArvore, validarRateio } from '@/lib/dimensoes';
import { round2, soma } from '@/lib/money';
import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';
const CONTROLE = cn(
  'fin-t-body h-11 min-h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 lg:min-h-10',
  FOCO,
);
const RECUO: Record<number, string> = { 0: '', 1: 'pl-6', 2: 'pl-9', 3: 'pl-12' };
const NENHUM = '__NENHUM__';
const MESMA = '__MESMA__';

export type AlteracaoDeDimensoes = Partial<{
  centro_custo_id: string;
  centro_custo: string;
  rateio: LinhaRateio[];
  tags: string[];
}>;

export type SecaoRateiosProps = {
  /** Valor da conta em reais (base do rateio). */
  total: number;
  tipo: 'DESPESA' | 'RECEITA';
  centroId: string;
  rateio: LinhaRateio[];
  tags: string[];
  onChange: (alteracao: AlteracaoDeDimensoes) => void;
};

/** O erro do rateio para mostrar antes de salvar, ou null. */
export function erroDoRateio(total: number, rateio: readonly LinhaRateio[] | undefined): string | null {
  const r = validarRateio(total, rateio ?? []);
  return r.ok ? null : r.erro;
}

type Cadastros = { centros: CentroCusto[]; regras: RegraRateio[]; categorias: PlanoContas[] };

async function lerLista<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const corpo = await res.json();
  return Array.isArray(corpo) ? corpo as T[] : [];
}

function useCadastros(): Cadastros & { carregando: boolean } {
  const [estado, setEstado] = React.useState<Cadastros & { carregando: boolean }>({
    centros: [], regras: [], categorias: [], carregando: true,
  });
  React.useEffect(() => {
    let vivo = true;
    Promise.all([
      lerLista<CentroCusto>('/api/centros-custo'),
      lerLista<RegraRateio>('/api/regras-rateio'),
      lerLista<PlanoContas>('/api/plano-contas'),
    ]).then(([centros, regras, categorias]) => {
      if (vivo) setEstado({ centros, regras, categorias, carregando: false });
    }).catch(() => { if (vivo) setEstado(e => ({ ...e, carregando: false })); });
    return () => { vivo = false; };
  }, []);
  return estado;
}

function SeletorDeCentro({
  id, valor, centros, onChange, rotuloVazio, describedBy, ariaLabel,
}: {
  id?: string;
  valor: string;
  centros: Array<CentroCusto & { nivel: number }>;
  onChange: (id: string) => void;
  rotuloVazio: string;
  describedBy?: string;
  ariaLabel: string;
}) {
  const escolhido = centros.find(c => c.id === valor);
  return (
    <Select value={valor || NENHUM} onValueChange={v => onChange(String(v) === NENHUM ? '' : String(v))}>
      <SelectTrigger id={id} aria-label={ariaLabel} aria-describedby={describedBy} className={cn(CONTROLE, 'justify-between gap-2')}>
        <SelectValue>{() => (escolhido ? escolhido.nome : rotuloVazio)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NENHUM} className="fin-t-body">{rotuloVazio}</SelectItem>
        {centros.map(c => (
          <SelectItem key={c.id} value={c.id} disabled={!c.ativo && c.id !== valor} className={cn('fin-t-body', RECUO[Math.min(c.nivel, 3)])}>
            {c.codigo ? <span className="fin-t-code mr-2 text-[var(--fin-text-3)]">{c.codigo}</span> : null}
            {c.nome}{!c.ativo ? ' (inativo)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SecaoRateios({ total, tipo, centroId, rateio, tags, onChange }: SecaoRateiosProps) {
  const { centros, regras, categorias, carregando } = useCadastros();
  const arvore = React.useMemo(() => ordenarEmArvore(centros), [centros]);
  const categoriasDoTipo = React.useMemo(
    () => categorias
      .filter(c => c.tipo === tipo && c.ativo !== false)
      .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })),
    [categorias, tipo],
  );
  const [novaTag, setNovaTag] = React.useState('');
  const dividindo = rateio.length > 0;

  const conferido = validarRateio(total, rateio);
  const somaPct = round2(soma(rateio.map(l => Number(l.percentual) || 0)));
  const valores = conferido.ok
    ? conferido.linhas.map(l => l.valor)
    : rateio.map(l => round2((total * (Number(l.percentual) || 0)) / 100));

  function trocarLinha(i: number, patch: Partial<LinhaRateio>) {
    onChange({ rateio: rateio.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  }

  function dividirEntreCentros() {
    const [a, b] = dividirIgual(2);
    onChange({
      rateio: [
        { centro_custo_id: centroId, percentual: a, valor: 0 },
        { centro_custo_id: '', percentual: b, valor: 0 },
      ],
    });
  }

  // Várias categorias no mesmo título (06/11/2026, E7): linhas com categoria
  // e centro opcional. Cada linha sem centro conta só pela categoria.
  function dividirEntreCategorias() {
    const [a, b] = dividirIgual(2);
    onChange({
      rateio: [
        { centro_custo_id: centroId, percentual: a, valor: 0 },
        { centro_custo_id: centroId, percentual: b, valor: 0 },
      ],
    });
  }

  function aplicarRegra(id: string) {
    const regra = regras.find(r => r.id === id);
    if (!regra) return;
    const r = aplicarRegraDeRateio(regra, total);
    onChange({ rateio: r.ok ? r.linhas : regra.linhas.map(l => ({ ...l, valor: 0 })) });
  }

  function igualar() {
    const pcts = dividirIgual(rateio.length);
    onChange({ rateio: rateio.map((l, i) => ({ ...l, percentual: pcts[i] })) });
  }

  function voltarParaCentroUnico() {
    const primeiro = rateio.find(l => l.centro_custo_id)?.centro_custo_id ?? centroId;
    const centro = centros.find(c => c.id === primeiro);
    onChange({ rateio: [], centro_custo_id: primeiro, centro_custo: centro?.nome ?? '' });
  }

  function adicionarTag(texto: string) {
    const limpas = normalizarTags([...tags, ...texto.split(',')]);
    onChange({ tags: limpas });
    setNovaTag('');
  }

  const semCentros = !carregando && centros.length === 0;
  const opcoesRegra = regras.map(r => ({ valor: r.id, rotulo: r.nome }));

  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      {semCentros ? (
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          Nenhum centro de custo cadastrado ainda.{' '}
          <Link href="/financeiro-ag/centros-custo" className={cn('rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-2', FOCO)}>
            Cadastrar centros de custo
          </Link>
        </p>
      ) : null}

      {!dividindo ? (
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-[1fr_auto] sm:items-end">
          <Field rotulo="Centro de custo" ajuda="A conta inteira vai para este centro.">
            {a => (
              <SeletorDeCentro
                id={a.id}
                describedBy={a['aria-describedby']}
                ariaLabel="Centro de custo"
                valor={centroId}
                centros={arvore}
                rotuloVazio="Sem centro de custo"
                onChange={id => onChange({ centro_custo_id: id, centro_custo: centros.find(c => c.id === id)?.nome ?? '' })}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-[var(--fin-s-2)]">
            <Button
              type="button"
              variant="outline"
              onClick={dividirEntreCentros}
              disabled={semCentros}
              className={cn('h-11 gap-[var(--fin-s-2)] lg:h-10', FOCO)}
            >
              <Split aria-hidden="true" className="size-4" />
              Dividir entre centros
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={dividirEntreCategorias}
              className={cn('h-11 lg:h-10', FOCO)}
            >
              Várias categorias
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--fin-s-2)]">
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_96px_120px_44px] gap-[var(--fin-s-2)] px-1 sm:grid">
            <span className="fin-t-overline text-[var(--fin-text-3)]">Centro de custo</span>
            <span className="fin-t-overline text-[var(--fin-text-3)]">Categoria</span>
            <span className="fin-t-overline text-right text-[var(--fin-text-3)]">%</span>
            <span className="fin-t-overline text-right text-[var(--fin-text-3)]">Valor</span>
            <span className="sr-only">Remover</span>
          </div>
          <ul className="flex flex-col gap-[var(--fin-s-2)]">
            {rateio.map((linha, i) => (
              <li
                key={i}
                className="grid grid-cols-[1fr_96px_44px] items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-2)] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_96px_120px_44px] sm:border-0 sm:bg-transparent sm:p-0"
              >
                <div className="col-span-3 sm:col-span-1">
                  <SeletorDeCentro
                    ariaLabel={`Centro de custo da linha ${i + 1}`}
                    valor={linha.centro_custo_id}
                    centros={arvore}
                    rotuloVazio={linha.categoria_id ? 'Sem centro de custo' : 'Escolha o centro'}
                    onChange={id => trocarLinha(i, { centro_custo_id: id })}
                  />
                </div>
                <div className="col-span-3 sm:col-span-1">
                  <Select
                    value={linha.categoria_id || MESMA}
                    onValueChange={v => trocarLinha(i, { categoria_id: String(v) === MESMA ? undefined : String(v) })}
                  >
                    <SelectTrigger aria-label={`Categoria da linha ${i + 1}`} className={cn(CONTROLE, 'justify-between gap-2')}>
                      <SelectValue>
                        {() => {
                          const c = categoriasDoTipo.find(x => x.id === linha.categoria_id);
                          return c ? `${c.codigo} · ${c.nome}` : 'Mesma da conta';
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MESMA} className="fin-t-body">Mesma da conta</SelectItem>
                      {categoriasDoTipo.map(c => (
                        <SelectItem key={c.id} value={c.id} className="fin-t-body">{c.codigo} · {c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  aria-label={`Percentual da linha ${i + 1}`}
                  value={Number.isFinite(linha.percentual) ? linha.percentual : ''}
                  onChange={e => trocarLinha(i, { percentual: e.target.value === '' ? 0 : Number(e.target.value) })}
                  className={cn(CONTROLE, 'text-right tabular-nums')}
                />
                <span className="hidden justify-end sm:flex">
                  <Money valor={valores[i] ?? 0} size="body" estado="ok" />
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover a linha ${i + 1} do rateio`}
                  onClick={() => onChange({ rateio: rateio.filter((_, j) => j !== i) })}
                  className={cn('size-11 rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)] lg:size-10', FOCO)}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>

          <div
            role="status"
            aria-live="polite"
            className={cn(
              'flex flex-wrap items-center justify-between gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-[var(--fin-s-2)]',
              conferido.ok ? 'border-[var(--fin-border)] bg-[var(--fin-surface-sunken)]' : 'border-[var(--fin-warning)] bg-[var(--fin-warning-soft)]',
            )}
          >
            <span className={cn('fin-t-body-strong', conferido.ok ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-warning-text)]')}>
              {conferido.ok ? `Fecha 100%` : conferido.erro}
            </span>
            <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">
              {somaPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% de{' '}
              <Money valor={total} size="caption" estado="ok" />
            </span>
          </div>

          <div className="flex flex-wrap gap-[var(--fin-s-2)]">
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange({ rateio: [...rateio, { centro_custo_id: '', percentual: round2(Math.max(0, 100 - somaPct)), valor: 0 }] })}
              className={cn('h-11 gap-[var(--fin-s-2)] lg:h-10', FOCO)}
            >
              <Plus aria-hidden="true" className="size-4" />
              Adicionar linha
            </Button>
            <Button type="button" variant="ghost" onClick={igualar} className={cn('h-11 lg:h-10', FOCO)}>
              Dividir igual
            </Button>
            <Button type="button" variant="ghost" onClick={voltarParaCentroUnico} className={cn('h-11 lg:h-10', FOCO)}>
              Voltar para um centro só
            </Button>
          </div>
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            Cada linha precisa de um centro de custo ou de uma categoria. Com categoria, o centro é opcional.
          </p>
        </div>
      )}

      {opcoesRegra.length > 0 ? (
        <Field rotulo="Aplicar regra salva" ajuda="Preenche o rateio de uma vez. Você ainda pode ajustar as linhas.">
          {a => (
            <Select value={NENHUM} onValueChange={v => aplicarRegra(String(v))}>
              <SelectTrigger id={a.id} aria-label="Aplicar regra salva" aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'justify-between gap-2')}>
                <SelectValue>{() => 'Escolha uma regra'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM} disabled className="fin-t-body">Escolha uma regra</SelectItem>
                {opcoesRegra.map(o => <SelectItem key={o.valor} value={o.valor} className="fin-t-body">{o.rotulo}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </Field>
      ) : null}

      <Field rotulo="Tags" ajuda="Marcadores livres para achar e somar depois. Enter ou vírgula adiciona.">
        {a => (
          <div className="flex flex-col gap-[var(--fin-s-2)]">
            {tags.length > 0 ? (
              <ul className="flex flex-wrap gap-[var(--fin-s-1)]" aria-label="Tags do lançamento">
                {tags.map(t => (
                  <li key={t} className="fin-t-caption flex items-center gap-1 rounded-[var(--fin-r-sm)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] py-0.5 pl-2 pr-0.5 text-[var(--fin-text)]">
                    {t}
                    <button
                      type="button"
                      aria-label={`Tirar a tag ${t}`}
                      onClick={() => onChange({ tags: tags.filter(x => x !== t) })}
                      className={cn('flex size-6 items-center justify-center rounded-[var(--fin-r-sm)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface)] hover:text-[var(--fin-text)]', FOCO)}
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Input
              id={a.id}
              aria-describedby={a['aria-describedby']}
              value={novaTag}
              placeholder="Ex.: evento, filial, campanha"
              autoComplete="off"
              onChange={e => {
                const v = e.target.value;
                if (v.includes(',')) adicionarTag(v); else setNovaTag(v);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); if (novaTag.trim()) adicionarTag(novaTag); }
              }}
              onBlur={() => { if (novaTag.trim()) adicionarTag(novaTag); }}
              className={CONTROLE}
            />
          </div>
        )}
      </Field>
    </div>
  );
}

export default SecaoRateios;
