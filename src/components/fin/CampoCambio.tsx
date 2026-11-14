'use client';

import { useMoedas } from './useMoedas';
import * as React from 'react';
import { Check, Clock3 } from 'lucide-react';

import { Field } from '@/components/fin/Field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  carimboDaCotacao, carimboManual, descreverCarimbo, formatarCambio, idadeEmMinutos, moedaDe, round4,
  situacaoDaCotacao, sugestoesPara, textoDaIdade,
  type CarimboDoCambio, type Cotacao, type EstadoDaFonte,
} from '@/lib/cambio';
import { useCotacoes } from '@/components/fin/useCotacoes';

/**
 * Campo de câmbio (05/11/2026, E6).
 *
 * Regra do dono: a pessoa SEMPRE pode digitar. Ao lado do campo ficam as
 * sugestões do cache (turismo e PTAX), cada uma com o nome, o horário e a
 * idade. "Usar" preenche o número e guarda de onde ele veio (o carimbo);
 * mexer no número depois volta a origem para "digitado". Uma sugestão que
 * falta NUNCA é trocada pela outra: ela aparece como indisponível.
 */
export type CampoCambioProps = {
  /** Moeda estrangeira (o câmbio é em reais por 1 unidade dela). */
  moeda: string;
  valor: number;
  carimbo?: CarimboDoCambio | null;
  onChange: (valor: number, carimbo: CarimboDoCambio) => void;
  rotulo?: string;
  /** O que o número significa; padrão: "Quantos reais vale 1 USD". */
  ajuda?: string;
  erro?: string | null;
  obrigatorio?: boolean;
  /** Lado da cotação sugerido: venda (pagar, comprar moeda) ou compra (receber, vender moeda). */
  lado?: 'venda' | 'compra';
  /** Cotações já carregadas pela tela (senão o campo lê /api/cambio). */
  cotacoes?: readonly Cotacao[];
  fontes?: readonly EstadoDaFonte[];
  agora?: Date;
};

const CONTROLE =
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] pr-24 text-[var(--fin-text)] tabular-nums lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

function paraTexto(v: number): string {
  return Number.isFinite(v) && v > 0 ? formatarCambio(v) : '';
}

/** "5,8893", "5.8893" ou "1.234,5" → número. */
function lerNumero(texto: string): number {
  const t = texto.trim().replace(/\s/g, '');
  if (!t) return 0;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const NOME_DO_TIPO = { turismo: 'Turismo', ptax: 'PTAX' } as const;

export function CampoCambio({
  moeda, valor, carimbo, onChange, rotulo = 'Câmbio', ajuda, erro, obrigatorio = false, lado = 'venda',
  cotacoes, fontes, agora,
}: CampoCambioProps) {
  // Catálogo da agência (E7): moeda cadastrada por ela também pede câmbio.
  const { moedas } = useMoedas();
  const m = moedaDe(moeda, moedas);
  const lido = useCotacoes();
  const lista = cotacoes ?? lido.painel?.cotacoes ?? [];
  const estadosDasFontes = fontes ?? lido.painel?.fontes ?? [];
  const instante = agora ?? (lido.painel ? new Date(lido.painel.agora) : new Date());
  const sugestoes = sugestoesPara(m, lista);

  const [texto, setTexto] = React.useState(() => paraTexto(valor));
  const [focado, setFocado] = React.useState(false);
  // O valor mudou por fora (sugestão usada, outra conta): o texto acompanha,
  // a não ser que a pessoa esteja digitando. Ajuste na renderização.
  const [ultimo, setUltimo] = React.useState(valor);
  if (!focado && valor !== ultimo) {
    setUltimo(valor);
    setTexto(paraTexto(valor));
  }

  if (m === 'BRL') return null;

  const usar = (c: Cotacao) => {
    const k = carimboDaCotacao(c, lado);
    setTexto(paraTexto(k.valor));
    onChange(k.valor, k);
  };

  const emUso = (c: Cotacao | null) =>
    !!c && !!carimbo && carimbo.origem === c.tipo && carimbo.cotado_em === c.cotado_em && round4(valor) === carimbo.valor;

  const fonteDe = (tipo: 'turismo' | 'ptax') =>
    estadosDasFontes.find(f => f.fonte === (tipo === 'turismo' ? 'awesomeapi' : 'bcb_ptax')) ?? null;

  const linhas: Array<{ tipo: 'turismo' | 'ptax'; c: Cotacao | null }> = [
    { tipo: 'turismo', c: sugestoes.turismo },
    { tipo: 'ptax', c: sugestoes.ptax },
  ];
  const semTurismoNaFonte = m !== 'USD' && m !== 'EUR';

  return (
    <div className="flex flex-col gap-[var(--fin-s-2)]">
      <Field
        rotulo={rotulo}
        obrigatorio={obrigatorio}
        ajuda={ajuda ?? `Quantos reais vale 1 ${m}. Digite ou use uma das cotações abaixo.`}
        erro={erro}
      >
        {a => (
          <div className="relative">
            <Input
              id={a.id}
              aria-invalid={a['aria-invalid'] || undefined}
              aria-describedby={a['aria-describedby']}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,0000"
              value={texto}
              onFocus={() => setFocado(true)}
              onBlur={() => {
                setFocado(false);
                setTexto(paraTexto(valor));
              }}
              onChange={e => {
                setTexto(e.target.value);
                const n = round4(lerNumero(e.target.value));
                onChange(n, carimboManual(n));
              }}
              className={cn(CONTROLE, erro && 'border-[var(--fin-negative)]')}
            />
            <span
              aria-hidden="true"
              className="fin-t-caption pointer-events-none absolute inset-y-0 right-3 flex items-center text-[var(--fin-text-3)]"
            >
              R$ por {m}
            </span>
          </div>
        )}
      </Field>

      <ul
        aria-label={`Cotações de ${m} sugeridas`}
        className="flex flex-col divide-y divide-[var(--fin-border)] overflow-hidden rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)]"
      >
        {linhas.map(({ tipo, c }) => {
          if (tipo === 'turismo' && semTurismoNaFonte && !c) return null;
          const estadoFonte = fonteDe(tipo);
          const usando = emUso(c);
          if (!c) {
            const motivo = tipo === 'turismo' && estadoFonte?.sem_chave
              ? 'a chave da fonte ainda não foi cadastrada'
              : lido.estado === 'carregando' && !cotacoes
                ? 'carregando'
                : 'sem cotação guardada';
            return (
              <li key={tipo} className="fin-t-caption flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-[var(--fin-text-3)]">
                <span className="fin-t-body-strong text-[var(--fin-text-2)]">{NOME_DO_TIPO[tipo]}</span>
                <span>Indisponível ({motivo})</span>
              </li>
            );
          }
          const valorLado = lado === 'venda' ? c.venda : c.compra;
          const situacao = situacaoDaCotacao(c, instante);
          const idade = textoDaIdade(idadeEmMinutos(c.cotado_em, instante));
          const quando = tipo === 'ptax'
            ? `fechamento de ${c.referencia.slice(8, 10)}/${c.referencia.slice(5, 7)}`
            : idade;
          const pausada = !!estadoFonte?.aberto_ate && new Date(estadoFonte.aberto_ate).getTime() > instante.getTime();
          return (
            <li key={tipo} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="flex items-baseline gap-2">
                  <span className="fin-t-body-strong text-[var(--fin-text)]">{NOME_DO_TIPO[tipo]}</span>
                  <span className="fin-t-body tabular-nums text-[var(--fin-text)]">R$ {formatarCambio(valorLado)}</span>
                </span>
                <span
                  className={cn(
                    'fin-t-caption flex items-center gap-1',
                    situacao === 'atrasada' || pausada ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text-3)]',
                  )}
                >
                  {situacao === 'atrasada' || pausada ? <Clock3 aria-hidden="true" className="size-3.5" /> : null}
                  {quando}
                  {pausada ? ' · fonte fora do ar, última cotação guardada' : situacao === 'atrasada' ? ' · cotação atrasada' : ''}
                  {` · ${lado === 'venda' ? 'venda' : 'compra'}`}
                </span>
              </span>
              {usando ? (
                <span className="fin-t-caption flex h-9 items-center gap-1 font-medium text-[var(--fin-positive)]">
                  <Check aria-hidden="true" className="size-4" /> Em uso
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => usar(c)}
                  aria-label={`Usar ${NOME_DO_TIPO[tipo]} de R$ ${formatarCambio(valorLado)}`}
                  className="fin-t-body h-11 shrink-0 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 font-medium text-[var(--fin-accent)] transition-colors duration-[var(--fin-dur-rapida)] hover:bg-[var(--fin-accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:h-9"
                >
                  Usar
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {valor > 0 ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          Origem do câmbio: {descreverCarimbo(carimbo && carimbo.valor === round4(valor) ? carimbo : carimboManual(valor))}
        </p>
      ) : null}
    </div>
  );
}

export default CampoCambio;
