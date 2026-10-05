'use client';

/**
 * A espera da importação de extrato.
 *
 * Pedido do Bruno (05/10/2026): ao importar o OFX, abrir uma espera que
 * mostre que está processando, como uma barra de progresso.
 *
 * Regras que não são enfeite:
 * - A barra é dividida nas três etapas de verdade (ler, reconhecer, gravar)
 *   e cada segmento enche com a medida DELA: bytes lidos, linhas
 *   reconhecidas, linhas que o servidor contou como gravadas. Nada de barra
 *   que anda sozinha no tempo.
 * - O que passa embaixo da barra são as linhas do próprio arquivo, na ordem
 *   em que o servidor as confere. A pessoa vê o extrato dela entrando.
 * - O movimento persegue o número real (`aproximar`) e nunca passa dele.
 * - Enquanto grava, não fecha: a importação é uma transação só, e fechar a
 *   janela no meio não a interromperia, só esconderia o resultado.
 * - Quem pediu menos movimento recebe a barra sem brilho e a lista sem
 *   deslizar (os tokens de animação já zeram em prefers-reduced-motion).
 */

import * as React from 'react';
import { Check, FileText, TriangleAlert } from 'lucide-react';

import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Money } from '@/components/fin/Money';
import {
  ETAPAS,
  aproximar,
  etapaDaFase,
  percentualTotal,
  preenchimentoDasEtapas,
  resumoDoArquivo,
  tamanhoLegivel,
  type FaseImportacao,
} from '@/lib/importacao-progresso';

export interface LinhaLida {
  data: string;
  descricao: string;
  valor: number;
}

export interface EstadoDaImportacao {
  fase: FaseImportacao;
  arquivo: { nome: string; tamanho: number };
  /** Nome da conta bancária que recebe o extrato. */
  conta: string;
  lidoBytes: number;
  /** As linhas reconhecidas no arquivo, na ordem em que o servidor grava. */
  linhas: LinhaLida[];
  feitas: number;
  total: number;
  resultado?: { inseridas: number; duplicadas: number };
  erro?: { mensagem: string; nadaGravado: boolean };
}

export interface ImportacaoDeExtratoProps {
  estado: EstadoDaImportacao | null;
  onFechar: () => void;
  onEscolherOutro: () => void;
}

const ALTURA_LINHA = 44;
const LINHAS_VISIVEIS = 4;

const TITULO_DA_FASE: Record<FaseImportacao, string> = {
  lendo: 'Lendo o arquivo',
  reconhecendo: 'Reconhecendo os lançamentos',
  conferindo: 'Conferindo com o que já está na conta',
  gravando: 'Gravando na conta',
  pronto: 'Gravando na conta',
  vazio: 'Nenhum lançamento reconhecido',
  erro: 'A importação não foi concluída',
};

function plural(n: number, um: string, varios: string) {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;
}

/** Posição exibida de 0 a 3 (uma unidade por etapa), perseguindo a real. */
function usePosicaoPerseguida(alvo: number, ativo: boolean): number {
  const [pos, setPos] = React.useState(0);
  const posRef = React.useRef(0);
  const alvoRef = React.useRef(alvo);
  alvoRef.current = alvo;

  React.useEffect(() => {
    if (!ativo) {
      posRef.current = 0;
      setPos(0);
      return;
    }
    let quadro = 0;
    let antes = performance.now();
    const passo = (agora: number) => {
      const dt = Math.min(64, agora - antes);
      antes = agora;
      const proximo = aproximar(posRef.current / 3, alvoRef.current / 3, dt) * 3;
      if (proximo !== posRef.current) {
        posRef.current = proximo;
        setPos(proximo);
      }
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [ativo]);

  return pos;
}

function SegmentoDaBarra({ cheio, ativo, rotulo, feito }: { cheio: number; ativo: boolean; rotulo: string; feito: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[var(--fin-s-2)]">
      <div className="relative h-2 overflow-hidden rounded-[var(--fin-r-dot)] bg-[var(--fin-surface-2)]">
        <div
          className="absolute inset-y-0 left-0 rounded-[var(--fin-r-dot)] bg-[var(--fin-accent)]"
          style={{ width: `${Math.round(cheio * 1000) / 10}%` }}
        />
        {ativo && <div aria-hidden="true" className="fin-importacao-brilho absolute inset-0" />}
      </div>
      <span
        className={cn(
          'fin-t-caption inline-flex min-w-0 items-center gap-[var(--fin-s-1)] truncate',
          feito ? 'text-[var(--fin-text-2)]' : ativo ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]',
        )}
      >
        {feito && <Check aria-hidden="true" className="size-3.5 shrink-0 text-[var(--fin-positive)]" />}
        <span className="truncate">{rotulo}</span>
      </span>
    </div>
  );
}

/** As linhas do arquivo passando, com a que está sendo gravada em destaque. */
function FaixaDoExtrato({ linhas, atual, gravando }: { linhas: LinhaLida[]; atual: number; gravando: boolean }) {
  if (linhas.length === 0) {
    return (
      <div className="flex h-[176px] flex-col justify-center gap-[var(--fin-s-2)] px-[var(--fin-s-3)]" aria-hidden="true">
        {[0.9, 0.7, 0.8, 0.6].map((w, i) => (
          <span key={i} className="fin-importacao-esboco block h-3 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" style={{ width: `${w * 100}%` }} />
        ))}
      </div>
    );
  }
  // A linha em gravação fica na segunda posição da janela: dá para ver a
  // anterior já conferida e as próximas chegando.
  const inicio = Math.max(0, atual - 1);
  const janela: number[] = [];
  for (let i = inicio - 1; i <= inicio + LINHAS_VISIVEIS; i++) if (i >= 0 && i < linhas.length) janela.push(i);
  return (
    <div className="fin-importacao-janela relative overflow-hidden" style={{ height: ALTURA_LINHA * LINHAS_VISIVEIS }} aria-hidden="true">
      {janela.map(i => {
        const l = linhas[i];
        const feita = gravando && i < atual;
        const agora = gravando && i === atual;
        return (
          <div
            key={i}
            className={cn(
              'fin-importacao-linha absolute inset-x-0 flex items-center gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] px-[var(--fin-s-3)]',
              agora && 'bg-[var(--fin-accent-soft)]',
            )}
            style={{ height: ALTURA_LINHA, transform: `translateY(${(i - inicio) * ALTURA_LINHA}px)` }}
          >
            <span className="grid size-4 shrink-0 place-items-center">
              {feita ? (
                <Check className="size-3.5 text-[var(--fin-positive)]" />
              ) : agora ? (
                <span className="size-1.5 rounded-[var(--fin-r-dot)] bg-[var(--fin-accent)]" />
              ) : (
                <span className="size-1.5 rounded-[var(--fin-r-dot)] bg-[var(--fin-border-strong)]" />
              )}
            </span>
            <span className={cn('fin-t-caption w-[44px] shrink-0 tabular-nums', feita || agora ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-text-3)]')}>
              {l.data ? `${l.data.slice(8, 10)}/${l.data.slice(5, 7)}` : ''}
            </span>
            <span className={cn('fin-t-body min-w-0 flex-1 truncate', agora ? 'text-[var(--fin-text)]' : feita ? 'text-[var(--fin-text-2)]' : 'text-[var(--fin-text-3)]')}>
              {l.descricao}
            </span>
            <Money
              valor={l.valor}
              size="body"
              estado="ok"
              sinal="sempre"
              tone={l.valor >= 0 ? 'positivo' : 'neutro'}
              className={cn('min-w-0 shrink-0', !(feita || agora) && 'opacity-60')}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ImportacaoDeExtrato({ estado, onFechar, onEscolherOutro }: ImportacaoDeExtratoProps) {
  const aberto = estado !== null;
  // Guarda o último estado para a janela não piscar vazia enquanto fecha.
  const ultimo = React.useRef<EstadoDaImportacao | null>(null);
  if (estado) ultimo.current = estado;
  const e = estado ?? ultimo.current;

  const emAndamento = !!e && ['lendo', 'reconhecendo', 'conferindo', 'gravando', 'pronto'].includes(e.fase);
  const alvo = e
    ? preenchimentoDasEtapas(e.fase, { lidoBytes: e.lidoBytes, totalBytes: e.arquivo.tamanho, feitas: e.feitas, total: e.total }).reduce((s, v) => s + v, 0)
    : 0;
  const pos = usePosicaoPerseguida(alvo, aberto && emAndamento);
  const cheios = [0, 1, 2].map(i => Math.min(1, Math.max(0, pos - i)));
  const concluido = !!e && e.fase === 'pronto' && pos >= 2.999;
  const falhou = !!e && (e.fase === 'erro' || e.fase === 'vazio');
  const fechavel = concluido || falhou;

  const botaoFinal = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (concluido || falhou) botaoFinal.current?.focus();
  }, [concluido, falhou]);

  if (!e) return null;

  const etapa = etapaDaFase(e.fase);
  const pct = percentualTotal(cheios);
  const feitasExibidas = Math.min(e.total, Math.floor(cheios[2] * e.total + 1e-6));
  const gravando = e.fase === 'gravando' || e.fase === 'pronto';
  const resumo = resumoDoArquivo(e.linhas);

  return (
    <Dialog
      open={aberto}
      onOpenChange={proximo => {
        if (!proximo && fechavel) onFechar();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-0 text-[var(--fin-text)] shadow-[var(--fin-e2)] outline-none focus:outline-none focus-visible:outline-none sm:max-w-[560px]"
      >
        {/* O arquivo e para onde ele vai */}
        <header className="flex items-center gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] px-[var(--fin-s-5)] py-[var(--fin-s-4)]">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]">
            <FileText className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{e.arquivo.nome}</span>
            <span className="fin-t-caption truncate text-[var(--fin-text-3)]">
              {tamanhoLegivel(e.arquivo.tamanho)} · para {e.conta}
            </span>
          </div>
        </header>

        {concluido ? (
          <div className="flex flex-col items-center gap-[var(--fin-s-4)] px-[var(--fin-s-5)] py-[var(--fin-s-6)] text-center">
            <svg viewBox="0 0 56 56" className="size-14" aria-hidden="true">
              <circle cx="28" cy="28" r="26" fill="var(--fin-positive-soft)" />
              <path d="M17 29l7 7 15-16" fill="none" stroke="var(--fin-positive)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="fin-importacao-check" />
            </svg>
            <div className="flex flex-col gap-[var(--fin-s-1)]">
              <DialogTitle className="fin-t-title text-[var(--fin-text)]">
                {e.resultado && e.resultado.inseridas > 0
                  ? plural(e.resultado.inseridas, 'lançamento importado', 'lançamentos importados')
                  : 'Nada novo neste arquivo'}
              </DialogTitle>
              <DialogDescription className="fin-t-body text-[var(--fin-text-2)]">
                {e.resultado && e.resultado.duplicadas > 0
                  ? e.resultado.inseridas > 0
                    ? `${plural(e.resultado.duplicadas, 'já estava', 'já estavam')} na conta e ${e.resultado.duplicadas === 1 ? 'foi pulado' : 'foram pulados'}.`
                    : `${e.resultado.duplicadas === 1 ? 'A linha já estava' : `As ${e.resultado.duplicadas.toLocaleString('pt-BR')} linhas já estavam`} na conta. Reimportar não duplica.`
                  : `Todas as linhas do arquivo entraram em ${e.conta}.`}
              </DialogDescription>
            </div>
            <dl className="grid w-full grid-cols-3 divide-x divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] text-left">
              <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)] p-[var(--fin-s-3)]">
                <dt className="fin-t-overline text-[var(--fin-text-3)]">Período</dt>
                <dd className="fin-t-body-strong truncate tabular-nums text-[var(--fin-text)]">
                  {resumo.de ? `${formatDate(resumo.de).slice(0, 5)} a ${formatDate(resumo.ate).slice(0, 5)}` : 'Sem data'}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)] p-[var(--fin-s-3)]">
                <dt className="fin-t-overline text-[var(--fin-text-3)]">Entrou</dt>
                <dd><Money valor={resumo.entradas} size="strong" estado="ok" tone="positivo" align="esquerda" className="min-w-0" /></dd>
              </div>
              <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)] p-[var(--fin-s-3)]">
                <dt className="fin-t-overline text-[var(--fin-text-3)]">Saiu</dt>
                <dd><Money valor={Math.abs(resumo.saidas)} size="strong" estado="ok" align="esquerda" className="min-w-0" /></dd>
              </div>
            </dl>
            <p className="fin-t-caption text-[var(--fin-text-3)]">Valores do arquivo inteiro, como o banco os mandou.</p>
            <Button
              ref={botaoFinal}
              className="h-11 w-full bg-[var(--fin-accent)] px-4 text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] lg:h-10"
              onClick={onFechar}
            >
              Conferir as linhas
            </Button>
          </div>
        ) : falhou ? (
          <div className="flex flex-col gap-[var(--fin-s-4)] px-[var(--fin-s-5)] py-[var(--fin-s-5)]">
            <div className="flex items-start gap-[var(--fin-s-3)]">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]">
                <TriangleAlert className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
                <DialogTitle className="fin-t-subhead text-[var(--fin-text)]">{TITULO_DA_FASE[e.fase]}</DialogTitle>
                <DialogDescription className="fin-t-body text-[var(--fin-text-2)]">
                  {e.fase === 'vazio'
                    ? 'O arquivo foi lido, mas nenhuma linha tem data e valor reconhecíveis. Confira se é o extrato em OFX ou a planilha em CSV baixada do site do banco.'
                    : e.erro?.mensagem}
                </DialogDescription>
              </div>
            </div>
            {e.fase === 'erro' && (
              <p className="fin-t-caption rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)] text-[var(--fin-text-2)]">
                {e.erro?.nadaGravado
                  ? 'Nada deste arquivo foi gravado: a importação entra inteira ou não entra.'
                  : 'A conexão caiu antes da resposta final. Importe o mesmo arquivo de novo: o que já entrou é reconhecido e não duplica.'}
              </p>
            )}
            <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row-reverse">
              <Button
                ref={botaoFinal}
                className="h-11 bg-[var(--fin-accent)] px-4 text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] lg:h-10"
                onClick={onEscolherOutro}
              >
                Escolher outro arquivo
              </Button>
              <Button variant="ghost" className="h-11 px-4 lg:h-10" onClick={onFechar}>Fechar</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--fin-s-4)] px-[var(--fin-s-5)] py-[var(--fin-s-5)]">
            <div className="flex items-end justify-between gap-[var(--fin-s-3)]">
              <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
                <DialogTitle className="fin-t-subhead text-[var(--fin-text)]" aria-live="polite">
                  {TITULO_DA_FASE[e.fase]}
                </DialogTitle>
                <DialogDescription className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">
                  {e.fase === 'lendo'
                    ? `${tamanhoLegivel(Math.round(cheios[0] * e.arquivo.tamanho))} de ${tamanhoLegivel(e.arquivo.tamanho)}`
                    : e.fase === 'reconhecendo'
                      ? 'Separando data, descrição e valor de cada linha'
                      : e.fase === 'conferindo'
                        ? `${plural(e.total, 'lançamento encontrado', 'lançamentos encontrados')} no arquivo`
                        : `${feitasExibidas.toLocaleString('pt-BR')} de ${plural(e.total, 'lançamento', 'lançamentos')}`}
                </DialogDescription>
              </div>
              <span className="fin-t-metric-sm tabular-nums text-[var(--fin-text)]">{pct}%</span>
            </div>

            <div
              role="progressbar"
              aria-label="Andamento da importação"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={`${TITULO_DA_FASE[e.fase]}, ${pct}%`}
              className="flex gap-[var(--fin-s-2)]"
            >
              {ETAPAS.map((rotulo, i) => (
                <SegmentoDaBarra key={rotulo} rotulo={rotulo} cheio={cheios[i]} ativo={i === etapa} feito={cheios[i] >= 1 && i < etapa} />
              ))}
            </div>

            <div className="rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] py-[var(--fin-s-1)]">
              <FaixaDoExtrato linhas={e.linhas} atual={feitasExibidas} gravando={gravando} />
            </div>

            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Linhas que já estão na conta são reconhecidas e puladas: importar de novo não duplica.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
