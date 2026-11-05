'use client';

/**
 * Bloco "Repetir" do lançamento (05/11/2026), igual para pagar e receber.
 *
 * O básico é o de sempre: Recorrente ou Parcelado, Quantidade e
 * Periodicidade (Semanal … Anual). "Mais opções" abre a cada N, dia fixo,
 * último dia útil, fim de semana/feriado, quando termina e reajuste. A
 * prévia das datas e valores é a mesma conta que o servidor faz ao gravar.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { Segmentado } from '@/components/fin/Segmentado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CampoSelecao, CONTROLE, Interruptor, type OpcaoDeSelecao } from '@/app/financeiro-ag/pagar/campos';
import { deCentavos, hojeISO, paraCentavos } from '@/lib/money';
import { diaDaSemana } from '@/lib/feriados';
import {
  formatarData, nomeDoDiaDaSemana, nomeDoMes, presetPorChave, previaDoFormulario, PRESETS,
  type ChavePreset, type EstadoRepeticao, type Frequencia, type ModoSerie,
} from '@/lib/recorrencia';
import { cn } from '@/lib/utils';

const OPCOES_MODO = [
  { valor: 'recorrente' as ModoSerie, rotulo: 'Recorrente' },
  { valor: 'parcelado' as ModoSerie, rotulo: 'Parcelado' },
];

const OPCOES_PERIODICIDADE: OpcaoDeSelecao[] = PRESETS.map(p => ({ valor: p.chave, rotulo: p.rotulo }));

const OPCOES_UNIDADE: OpcaoDeSelecao[] = [
  { valor: 'DIA', rotulo: 'dias' },
  { valor: 'SEMANA', rotulo: 'semanas' },
  { valor: 'MES', rotulo: 'meses' },
  { valor: 'ANO', rotulo: 'anos' },
];

const OPCOES_FERIADO: OpcaoDeSelecao[] = [
  { valor: 'manter', rotulo: 'Manter a data' },
  { valor: 'antecipar', rotulo: 'Antecipar para o dia útil anterior' },
  { valor: 'postergar', rotulo: 'Adiar para o próximo dia útil' },
];

const OPCOES_TERMINA: OpcaoDeSelecao[] = [
  { valor: 'ocorrencias', rotulo: 'Após um número de vezes' },
  { valor: 'data', rotulo: 'Em uma data' },
  { valor: 'nunca', rotulo: 'Nunca (até cancelar)' },
];

const OPCOES_MES: OpcaoDeSelecao[] = Array.from({ length: 12 }, (_, i) => ({
  valor: String(i + 1),
  rotulo: nomeDoMes(i + 1).replace(/^./, c => c.toUpperCase()),
}));

/** Quantas linhas da prévia aparecem antes do "e mais N". */
const LINHAS_DA_PREVIA = 6;

export type BlocoDeRepeticaoProps = {
  estado: EstadoRepeticao;
  onChange: (patch: Partial<EstadoRepeticao>) => void;
  /** Primeiro vencimento, do campo Vencimento do formulário. */
  inicio: string;
  /** Valor do formulário (recorrente: de cada; parcelado: o total). */
  valor: number;
  /** "conta a pagar" | "conta a receber", para os textos. */
  substantivo: string;
  moeda?: string;
};

export function BlocoDeRepeticao({ estado, onChange, inicio, valor, substantivo, moeda = 'BRL' }: BlocoDeRepeticaoProps) {
  const idMais = React.useId();
  const parcelado = estado.modo === 'parcelado';
  const previa = React.useMemo(
    () => (estado.ativa ? previaDoFormulario(estado, inicio, paraCentavos(valor), hojeISO()) : null),
    [estado, inicio, valor],
  );

  // Abrir "Mais opções" parte do que o básico já dizia, para nada mudar de
  // repente: a mesma periodicidade e o dia do primeiro vencimento.
  function abrirMaisOpcoes() {
    const p = presetPorChave(estado.periodicidade);
    onChange({
      personalizar: true,
      frequencia: p?.frequencia ?? 'MES',
      intervalo: p?.intervalo ?? 1,
      dia_do_mes: inicio ? Number(inicio.slice(8, 10)) || estado.dia_do_mes : estado.dia_do_mes,
    });
  }

  const usaDiaDoMes = estado.personalizar && (estado.frequencia === 'MES' || estado.frequencia === 'ANO');
  const opcoesDia: OpcaoDeSelecao[] = [
    { valor: 'mesmo', rotulo: 'Mesmo dia do primeiro vencimento' },
    { valor: 'fixo', rotulo: 'Dia fixo do mês' },
    ...(estado.frequencia === 'MES' ? [{ valor: 'ultimo_util', rotulo: 'Último dia útil do mês' }] : []),
  ];
  const terminaPorQuantidade = parcelado || !estado.personalizar || estado.termina === 'ocorrencias';

  return (
    <div className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
      <Interruptor
        rotulo="Repetir"
        descricao={`Cria as próximas ${substantivo}s já com o vencimento avançado.`}
        ligado={estado.ativa}
        onChange={v => onChange({ ativa: v })}
      />

      {estado.ativa ? (
        <>
          <div className="flex flex-col gap-[var(--fin-s-1)]">
            <Segmentado
              rotulo="Tipo de repetição"
              opcoes={OPCOES_MODO}
              valor={estado.modo}
              onChange={m => onChange({ modo: m })}
              cheio="celular"
            />
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {parcelado
                ? 'Divide o valor informado em parcelas. Os centavos que sobram vão na última.'
                : 'Repete o mesmo valor em cada vencimento.'}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
            {terminaPorQuantidade ? (
              <Field rotulo={parcelado ? 'Parcelas' : 'Quantidade'} ajuda={parcelado ? 'De 1 a 120.' : 'Quantas vezes, contando a primeira.'}>
                {a => (
                  <Input
                    {...a}
                    aria-invalid={a['aria-invalid'] || undefined}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={parcelado ? 120 : 2000}
                    value={estado.quantidade}
                    onChange={e => onChange({ quantidade: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className={cn(CONTROLE, 'tabular-nums')}
                  />
                )}
              </Field>
            ) : null}

            {!estado.personalizar ? (
              <CampoSelecao
                rotulo="Periodicidade"
                valor={estado.periodicidade}
                opcoes={OPCOES_PERIODICIDADE}
                onChange={v => onChange({ periodicidade: v as ChavePreset })}
              />
            ) : null}
          </div>

          <div>
            <Button
              type="button"
              variant="ghost"
              aria-expanded={estado.personalizar}
              aria-controls={idMais}
              onClick={() => (estado.personalizar ? onChange({ personalizar: false }) : abrirMaisOpcoes())}
              className="h-11 gap-1 px-2 text-[var(--fin-accent)] hover:text-[var(--fin-accent-hover)] lg:h-10"
            >
              {estado.personalizar ? 'Voltar à periodicidade simples' : 'Mais opções'}
              <ChevronDown
                aria-hidden="true"
                className={cn('size-4 transition-transform duration-[var(--fin-dur-rapida)] motion-reduce:transition-none', estado.personalizar && 'rotate-180')}
              />
            </Button>
          </div>

          {estado.personalizar ? (
            <div id={idMais} className="grid grid-cols-1 gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)] sm:grid-cols-2">
              <Field rotulo="A cada">
                {a => (
                  <Input
                    {...a}
                    aria-invalid={a['aria-invalid'] || undefined}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={366}
                    value={estado.intervalo}
                    onChange={e => onChange({ intervalo: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className={cn(CONTROLE, 'tabular-nums')}
                  />
                )}
              </Field>
              <CampoSelecao
                rotulo="Unidade"
                valor={estado.frequencia}
                opcoes={OPCOES_UNIDADE}
                onChange={v => onChange({ frequencia: v as Frequencia, dia: v === 'MES' || v === 'ANO' ? estado.dia : 'mesmo' })}
              />

              {usaDiaDoMes ? (
                <>
                  <CampoSelecao
                    rotulo="Dia do vencimento"
                    valor={estado.dia === 'ultimo_util' && estado.frequencia !== 'MES' ? 'mesmo' : estado.dia}
                    opcoes={opcoesDia}
                    onChange={v => onChange({ dia: v as EstadoRepeticao['dia'] })}
                  />
                  {estado.dia === 'fixo' ? (
                    <Field rotulo="Dia do mês" ajuda="Em mês mais curto, vale o último dia.">
                      {a => (
                        <Input
                          {...a}
                          aria-invalid={a['aria-invalid'] || undefined}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={31}
                          value={estado.dia_do_mes}
                          onChange={e => onChange({ dia_do_mes: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                          className={cn(CONTROLE, 'tabular-nums')}
                        />
                      )}
                    </Field>
                  ) : <span className="hidden sm:block" aria-hidden="true" />}
                </>
              ) : null}

              {estado.frequencia === 'SEMANA' && inicio ? (
                <p className="fin-t-caption text-[var(--fin-text-3)] sm:col-span-2">
                  Vence sempre na {nomeDoDiaDaSemana(diaDaSemana(inicio))}, o dia da semana do primeiro vencimento.
                </p>
              ) : null}

              {estado.dia !== 'ultimo_util' || !usaDiaDoMes ? (
                <div className="sm:col-span-2">
                  <CampoSelecao
                    rotulo="Se cair em fim de semana ou feriado"
                    valor={estado.feriado}
                    opcoes={OPCOES_FERIADO}
                    onChange={v => onChange({ feriado: v as EstadoRepeticao['feriado'] })}
                  />
                </div>
              ) : null}

              {!parcelado ? (
                <>
                  <CampoSelecao
                    rotulo="Termina"
                    valor={estado.termina}
                    opcoes={OPCOES_TERMINA}
                    onChange={v => onChange({ termina: v as EstadoRepeticao['termina'] })}
                  />
                  {estado.termina === 'data' ? (
                    <Field rotulo="Último vencimento até">
                      {a => (
                        <Input
                          {...a}
                          aria-invalid={a['aria-invalid'] || undefined}
                          type="date"
                          value={estado.termina_em}
                          onChange={e => onChange({ termina_em: e.target.value })}
                          className={cn(CONTROLE, 'tabular-nums')}
                        />
                      )}
                    </Field>
                  ) : <span className="hidden sm:block" aria-hidden="true" />}

                  <Field rotulo="Reajuste anual (%)" ajuda="Opcional. Aplicado uma vez por ano, no mês escolhido.">
                    {a => (
                      <Input
                        {...a}
                        aria-invalid={a['aria-invalid'] || undefined}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0}
                        value={estado.reajuste_percentual || ''}
                        placeholder="Sem reajuste"
                        onChange={e => onChange({ reajuste_percentual: parseFloat(e.target.value) || 0 })}
                        className={cn(CONTROLE, 'tabular-nums')}
                      />
                    )}
                  </Field>
                  {estado.reajuste_percentual ? (
                    <CampoSelecao
                      rotulo="Mês do reajuste"
                      valor={String(estado.reajuste_mes)}
                      opcoes={OPCOES_MES}
                      onChange={v => onChange({ reajuste_mes: Number(v) })}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <PreviaDaRepeticao previa={previa} moeda={moeda} substantivo={substantivo} parcelado={parcelado} />
        </>
      ) : null}
    </div>
  );
}

function PreviaDaRepeticao({
  previa, moeda, substantivo, parcelado,
}: {
  previa: ReturnType<typeof previaDoFormulario> | null;
  moeda: string;
  substantivo: string;
  parcelado: boolean;
}) {
  if (!previa) return null;
  if ('erro' in previa) {
    return (
      <p role="status" className="fin-t-caption rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-3)] text-[var(--fin-text-2)]">
        {previa.erro}
      </p>
    );
  }
  const linhas = previa.ocorrencias.slice(0, LINHAS_DA_PREVIA);
  const resto = previa.ocorrencias.length - linhas.length;
  const ultima = previa.ocorrencias[previa.ocorrencias.length - 1];
  const total = previa.total;

  return (
    <section
      aria-label="Prévia das datas e valores"
      className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-3)]"
    >
      <p className="fin-t-body-strong text-[var(--fin-text)]">{previa.descricao}</p>
      <ol className="flex flex-col">
        {linhas.map(o => (
          <li
            key={o.ordem}
            className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] py-[var(--fin-s-1)] last:border-b-0"
          >
            <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
              {total !== null ? `${o.ordem}/${total}` : `${o.ordem}ª`}
            </span>
            <span className="fin-t-body tabular-nums text-[var(--fin-text)]">
              {formatarData(o.vencimento)}
              <span className="fin-t-caption ml-[var(--fin-s-2)] text-[var(--fin-text-3)]">
                {nomeDoDiaDaSemana(diaDaSemana(o.vencimento)).replace('-feira', '')}
              </span>
              {o.aviso ? (
                <span className="fin-t-caption ml-[var(--fin-s-2)] rounded-[var(--fin-r-sm)] bg-[var(--fin-warning-soft)] px-1.5 py-0.5 text-[var(--fin-warning-text)]">
                  {o.aviso}
                </span>
              ) : null}
            </span>
            <Money valor={deCentavos(o.valor_centavos)} moeda={moeda as 'BRL'} size="body" estado="ok" />
          </li>
        ))}
      </ol>
      {resto > 0 && ultima ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          E mais {resto} até {formatarData(ultima.vencimento)}.
        </p>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] pt-[var(--fin-s-2)]">
        {previa.somaCentavos !== null ? (
          <>
            <span className="fin-t-body text-[var(--fin-text-2)]">
              {previa.ocorrencias.length === 1 ? `1 ${substantivo}` : `${previa.ocorrencias.length} ${substantivo}s`}
              {parcelado ? ', somando exatamente o valor informado' : ''}
            </span>
            <Money valor={deCentavos(previa.somaCentavos)} moeda={moeda as 'BRL'} size="strong" estado="ok" />
          </>
        ) : (
          <span className="fin-t-body text-[var(--fin-text-2)]">
            {previa.ocorrencias.length} nascem agora. As próximas são criadas sozinhas, sempre 3 meses à frente, até você encerrar.
          </span>
        )}
      </div>
    </section>
  );
}

export default BlocoDeRepeticao;
