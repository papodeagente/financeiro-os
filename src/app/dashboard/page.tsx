'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpRight, BookOpen, CalendarClock, CalendarDays, ChartColumn, CircleCheck,
  ChartLine, ClipboardList, EyeOff, Gauge, Hourglass, Layers, LayoutDashboard, LayoutGrid, Lightbulb, OctagonAlert,
  Percent, Plus, Receipt, RefreshCw, RotateCcw, ShieldCheck, ShoppingBag, SlidersHorizontal, TrendingUp, TriangleAlert,
  Truck, Users, Wallet, type LucideIcon,
} from 'lucide-react';

import type { DashboardFinanceiro } from '@/lib/dashboard-financeiro';
import type { LadoDoLancamento, RecorteDoDetalhe } from '@/lib/dashboard-detalhe';
import {
  calcularFatoresDeSaude, classificarSaude, gerarInsights, montarCascataDoResultado, ORDEM_DE_GRAVIDADE, type Insight,
} from '@/lib/dashboard-insights';
import {
  CATALOGO, IDS_DOS_WIDGETS, normalizarSelecao, WIDGETS_PADRAO, widgetsEscondidos, type IdDoWidget,
} from '@/lib/dashboard-widgets';
import { janelaDeComparacao } from '@/lib/periodo-financeiro';
import { cn } from '@/lib/utils';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { GraficoMoldura, VazioDoGrafico } from '@/components/fin/GraficoMoldura';
import { BarraDeParte, type Parte } from '@/components/fin/BarraDeParte';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { SerieFinanceira } from '@/components/fin/SerieFinanceira';
import { ProjecaoDeCaixa } from '@/components/fin/ProjecaoDeCaixa';
import { Cascata, type PassoDaCascata } from '@/components/fin/Cascata';
import { PainelDeSaude } from '@/components/fin/PainelDeSaude';
import { FiltroDePeriodo, usePeriodoDaUrl } from '@/components/fin/FiltroDePeriodo';
import { BotaoDePrivacidade, PrivacidadeProvider, usePrivacidade } from '@/components/fin/Privacidade';
import { GavetaDeLancamentos, type PedidoDeDetalhe } from '@/components/fin/GavetaDeLancamentos';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  CabecaDoBloco, CARTAO_DS, CartaoDeNumero, ChipDoTom, FOCO, PILULA_DS, ROTULO_DS, suave, TituloDeSecao, TopoDoDs,
  corDoTom, type NumeroDoDs, type TomDoDs,
} from '@/components/ds/pecas';

/**
 * A Central de Inteligência Financeira da agência.
 *
 * O PAINEL ANTIGO mostrava o FATURAMENTO como número grande. Numa agência de
 * viagens o que o cliente paga pertence em boa parte ao fornecedor: numa viagem
 * de R$ 20.000 com R$ 16.500 de operadora, a agência ganhou R$ 3.500. Estampar
 * o volume como receita multiplica o faturamento por sete na cabeça do dono.
 *
 * TRÊS NÍVEIS, nesta ordem:
 *   1. O que está acontecendo  — saldo, entradas, saídas, resultado.
 *   2. Por que está acontecendo — séries, composições, rankings, margem.
 *   3. O que precisa ser feito  — alarmes, agenda, insights, drill-down.
 *
 * E o que os dados NÃO permitem ficou de fora por decisão, não por esquecimento:
 * orçado x realizado (não existe orçamento conciliável no banco), receita por
 * categoria (categoria_id nasce vazia em toda conta gerada por venda), saldo por
 * banco e forma de pagamento (os campos existem e ninguém os preenche). Um
 * gráfico bonito sobre campo vazio é pior que bloco nenhum: ele afirma.
 */

/*
 * 12/11/2026 — reformulação no design system do CRM (molde das Análises):
 * duas faixas fixas de números com mini-gráfico (como o CRM: barras e anel no
 * próprio cartão) e, abaixo, a área de WIDGETS que a pessoa escolhe e ordena.
 * Os gráficos grandes viraram widgets compactos de altura contida; a tabela
 * ("Números") troca de lugar com o desenho em vez de empilhar.
 */

const PCT = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;
const dataBR = (iso: string) => (iso && iso.length >= 10 ? iso.split('-').reverse().join('/') : '—');
const diaEMes = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const FAIXA_DE_NUMEROS =
  '-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-3.5 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4';
const ITEM_DA_FAIXA = 'grid w-[84%] shrink-0 snap-start sm:w-auto';
const horaBR = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const meses = (m: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(m)} ${m === 1 ? 'mês' : 'meses'}`;

const VEREDITO: Record<'bom' | 'atencao' | 'risco' | 'sem-base', { rotulo: string; icone: LucideIcon; tom: TomDoDs | null }> = {
  bom: { rotulo: 'Saudável', icone: CircleCheck, tom: 'success' },
  atencao: { rotulo: 'Atenção', icone: TriangleAlert, tom: 'warning' },
  risco: { rotulo: 'Risco', icone: OctagonAlert, tom: 'danger' },
  'sem-base': { rotulo: 'Sem base suficiente', icone: TriangleAlert, tom: null },
};

const TOM_DO_INSIGHT: Record<Insight['tom'], TomDoDs> = { critico: 'danger', atencao: 'warning', positivo: 'success', neutro: 'info' };
const ICONE_DO_INSIGHT: Record<Insight['tom'], LucideIcon> = { critico: OctagonAlert, atencao: TriangleAlert, positivo: CircleCheck, neutro: Lightbulb };

/** Ícone e tom de cada widget: o mesmo no cartão e na janela de personalizar. */
const VISUAL_DO_WIDGET: Record<IdDoWidget, { Icone: LucideIcon; tom: TomDoDs }> = {
  atencao: { Icone: Lightbulb, tom: 'warning' },
  saude: { Icone: ShieldCheck, tom: 'success' },
  serie: { Icone: ChartColumn, tom: 'brand' },
  projecao: { Icone: ChartLine, tom: 'info' },
  aging: { Icone: CalendarClock, tom: 'warning' },
  cascata: { Icone: Layers, tom: 'success' },
  origem: { Icone: ArrowDownLeft, tom: 'success' },
  despesa: { Icone: ArrowUpRight, tom: 'danger' },
  fornecedores: { Icone: Truck, tom: 'brand' },
  margem: { Icone: Percent, tom: 'success' },
  clientes: { Icone: Users, tom: 'info' },
  agenda: { Icone: CalendarDays, tom: 'brand' },
  descasamento: { Icone: Hourglass, tom: 'danger' },
  vendas: { Icone: ShoppingBag, tom: 'info' },
  qualidade: { Icone: ClipboardList, tom: 'warning' },
};

const COR_DA_FAIXA: Record<'bom' | 'atencao' | 'risco' | 'sem-base', string> = {
  bom: 'var(--ds-success)',
  atencao: 'var(--ds-warning)',
  risco: 'var(--ds-danger)',
  'sem-base': 'var(--ds-text-subtle)',
};
const PALAVRA_DA_FAIXA: Record<'bom' | 'atencao' | 'risco' | 'sem-base', string> = {
  bom: 'bom', atencao: 'atenção', risco: 'risco', 'sem-base': 'sem base',
};

/* ── Escolha dos widgets ─────────────────────────────────────────────────
   A escolha mora no cadastro da pessoa (GET/PUT /api/dashboard/widgets) e
   numa cópia no navegador, que vale para quem não tem cadastro de agência
   (super admin entrando como agência) e enquanto o servidor não responde. */

const CHAVE_LOCAL = 'fin:dashboard-widgets';

function lerLocal(): IdDoWidget[] | null {
  try {
    const bruto = localStorage.getItem(CHAVE_LOCAL);
    return bruto ? normalizarSelecao(JSON.parse(bruto)) : null;
  } catch {
    return null;
  }
}

function gravarLocal(selecao: IdDoWidget[]) {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(selecao)); } catch { /* navegador sem armazenamento */ }
}

function useWidgetsEscolhidos(): [IdDoWidget[] | null, (nova: IdDoWidget[]) => void] {
  const [selecao, setSelecao] = useState<IdDoWidget[] | null>(null);
  const envio = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/dashboard/widgets', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { widgets: null }))
      .then((j: { widgets?: unknown }) => {
        if (!vivo) return;
        setSelecao(normalizarSelecao(j.widgets) ?? lerLocal() ?? WIDGETS_PADRAO);
      })
      .catch(() => { if (vivo) setSelecao(lerLocal() ?? WIDGETS_PADRAO); });
    return () => { vivo = false; };
  }, []);

  const trocar = useCallback((nova: IdDoWidget[]) => {
    setSelecao(nova);
    gravarLocal(nova);
    // Mudanças seguidas (reordenar três vezes) viram uma gravação só.
    if (envio.current) clearTimeout(envio.current);
    envio.current = setTimeout(() => {
      fetch('/api/dashboard/widgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets: nova }),
      }).catch(() => { /* fica a cópia do navegador */ });
    }, 600);
  }, []);

  return [selecao, trocar];
}

/* ── Peças da área de widgets ───────────────────────────────────────────── */

function BotaoOcultar({ onOcultar, titulo }: { onOcultar: () => void; titulo: string }) {
  return (
    <button
      type="button"
      onClick={onOcultar}
      aria-label={`Ocultar o widget ${titulo}`}
      title="Ocultar este widget"
      className={cn(
        'fin-no-print inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-surface-hover)] hover:text-[var(--ds-text-strong)]',
        FOCO,
      )}
    >
      <EyeOff className="h-[15px] w-[15px]" aria-hidden="true" />
    </button>
  );
}

/** Cartão de widget que não é gráfico (listas e resumos). */
function Widget({
  id, titulo, sub, acoes, children,
}: { id: IdDoWidget; titulo: string; sub?: string; acoes?: React.ReactNode; children: React.ReactNode }) {
  const { Icone, tom } = VISUAL_DO_WIDGET[id];
  return (
    <section aria-labelledby={`widget-${id}`} className={cn(CARTAO_DS, 'flex min-w-0 flex-col p-[18px]')}>
      <CabecaDoBloco id={`widget-${id}`} tom={tom} Icone={Icone} titulo={titulo} sub={sub} nivel={3} compacta>
        {acoes}
      </CabecaDoBloco>
      <div className="mt-4 min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** Linha de um resumo: rótulo à esquerda, número à direita. */
function LinhaDeResumo({ rotulo, valor, detalhe, cor }: { rotulo: string; valor: React.ReactNode; detalhe?: string; cor?: string }) {
  return (
    <li className="flex min-h-[40px] items-center gap-3 border-t border-[var(--ds-border-subtle)] py-2 first:border-t-0">
      {cor ? <i aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: cor }} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-[var(--ds-text-body)]">{rotulo}</span>
        {detalhe ? <span className="block truncate text-[11.5px] text-[var(--ds-text-muted)]">{detalhe}</span> : null}
      </span>
      <span className="ds-num shrink-0 text-[14px] font-medium text-[var(--ds-text-strong)]">{valor}</span>
    </li>
  );
}

/* ── Janela de personalizar ──────────────────────────────────────────────── */

function JanelaDePersonalizar({
  aberta, onFechar, selecao, onTrocar,
}: { aberta: boolean; onFechar: () => void; selecao: IdDoWidget[]; onTrocar: (nova: IdDoWidget[]) => void }) {
  const escondidos = widgetsEscondidos(selecao);
  const mover = (i: number, passo: -1 | 1) => {
    const nova = [...selecao];
    const j = i + passo;
    if (j < 0 || j >= nova.length) return;
    [nova[i], nova[j]] = [nova[j], nova[i]];
    onTrocar(nova);
  };
  const BOTAO_PEQUENO = cn(
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-surface-hover)] hover:text-[var(--ds-text-strong)] disabled:opacity-30 disabled:hover:bg-transparent',
    FOCO,
  );

  return (
    <Dialog open={aberta} onOpenChange={a => { if (!a) onFechar(); }}>
      <DialogContent className="ds w-full gap-0 rounded-[var(--ds-radius-card)] border-[var(--ds-border-subtle)] bg-[var(--ds-surface-card)] p-0 sm:max-w-[640px]">
        <div className="flex items-center gap-3 border-b border-[var(--ds-border-subtle)] px-6 pb-4 pt-6 pr-12">
          <ChipDoTom Icone={LayoutGrid} tamanho={38} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[17px] font-medium tracking-[-0.01em] text-[var(--ds-text-strong)]">Personalizar o dashboard</DialogTitle>
            <DialogDescription className="mt-0.5 text-[12.5px] text-[var(--ds-text-muted)]">
              Escolha os widgets e a ordem. Fica salvo no seu usuário.
            </DialogDescription>
          </div>
        </div>

        <div className="max-h-[60dvh] overflow-y-auto px-6 py-4">
          <p className={cn(ROTULO_DS, 'mb-2 text-[var(--ds-text-strong)]')}>{`No dashboard · ${selecao.length}`}</p>
          {selecao.length === 0 ? (
            <p className="rounded-[14px] bg-[var(--ds-surface-sunken)] px-4 py-3 text-[13px] text-[var(--ds-text-body)]">
              Nenhum widget escolhido. Adicione abaixo.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {selecao.map((id, i) => {
                const w = CATALOGO[id];
                const { Icone, tom } = VISUAL_DO_WIDGET[id];
                return (
                  <li key={id} className="flex items-center gap-3 rounded-[14px] border border-[var(--ds-border-subtle)] px-3 py-2">
                    <ChipDoTom tom={tom} Icone={Icone} tamanho={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-[var(--ds-text-strong)]">{w.titulo}</span>
                      <span className="block truncate text-[11.5px] text-[var(--ds-text-muted)]">{w.descricao}</span>
                    </span>
                    <button type="button" className={BOTAO_PEQUENO} disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Subir ${w.titulo}`}>
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" className={BOTAO_PEQUENO} disabled={i === selecao.length - 1} onClick={() => mover(i, 1)} aria-label={`Descer ${w.titulo}`}>
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" className={BOTAO_PEQUENO} onClick={() => onTrocar(selecao.filter(x => x !== id))} aria-label={`Ocultar ${w.titulo}`}>
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {escondidos.length > 0 && (
            <>
              <p className={cn(ROTULO_DS, 'mb-2 mt-5 text-[var(--ds-text-strong)]')}>{`Disponíveis · ${escondidos.length}`}</p>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {escondidos.map(id => {
                  const w = CATALOGO[id];
                  const { Icone, tom } = VISUAL_DO_WIDGET[id];
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onTrocar([...selecao, id])}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-[14px] border border-dashed border-[var(--ds-border-default)] px-3 py-2 text-left transition-colors hover:border-[var(--ds-brand)] hover:bg-[var(--ds-brand-soft)]',
                          FOCO,
                        )}
                      >
                        <ChipDoTom tom={tom} Icone={Icone} tamanho={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--ds-text-strong)]">{w.titulo}</span>
                          <span className="line-clamp-2 text-[11px] leading-[1.35] text-[var(--ds-text-muted)]">{w.descricao}</span>
                        </span>
                        <Plus className="h-4 w-4 shrink-0 text-[var(--ds-brand)]" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--ds-border-subtle)] px-6 py-4">
          <button type="button" className={PILULA_DS} onClick={() => onTrocar([...WIDGETS_PADRAO])}>
            <RotateCcw className="h-[14px] w-[14px]" aria-hidden="true" />
            Restaurar padrão
          </button>
          <button type="button" className={PILULA_DS} onClick={() => onTrocar([...IDS_DOS_WIDGETS])}>
            Mostrar todos
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onFechar}
            className={cn('inline-flex h-9 items-center rounded-full bg-[var(--ds-brand)] px-4 text-[13px] font-medium text-[var(--fin-text-on-fill)] transition-colors hover:bg-[var(--ds-brand-hover)]', FOCO)}
          >
            Pronto
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Painel() {
  const { formatar, formatarEixo } = usePrivacidade();
  const [janela, estadoDoPeriodo, trocarPeriodo] = usePeriodoDaUrl();
  const [dados, setDados] = useState<DashboardFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  // O status viaja junto da mensagem: 403 não é "tente de novo".
  const [erro, setErro] = useState<{ status: number; texto: string } | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [gaveta, setGaveta] = useState<PedidoDeDetalhe | null>(null);

  /** A busca em voo. Trocar de período rápido dispara duas, e sem cancelar a
   *  primeira a resposta lenta chega DEPOIS e sobrescreve a tela com números
   *  de outro período — sem erro nenhum, só com o painel mentindo. */
  const emVoo = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    emVoo.current?.abort();
    const controle = new AbortController();
    emVoo.current = controle;
    setCarregando(true);
    setErro(null);
    try {
      // A CHAVE viaja junto: é ela que diz ao servidor com o que comparar.
      const busca = new URLSearchParams({
        periodo: estadoDoPeriodo.chave,
        de: janela.de,
        ate: janela.ate,
      });
      const r = await fetch(`/api/dashboard?${busca}`, { signal: controle.signal });
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        throw Object.assign(new Error(corpo.error || `Erro ${r.status}`), { status: r.status });
      }
      setDados(await r.json());
      setAtualizadoEm(new Date());
    } catch (e) {
      // Busca cancelada não é falha: é a resposta velha sendo descartada.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // A falha CHEGA à tela. Com a manchete em 44px, anunciar "R$ 0,00 em
      // caixa" durante uma queda é pior do que não desenhar nada.
      const status = (e as { status?: number })?.status ?? 0;
      setErro({ status, texto: e instanceof Error ? e.message : 'Não foi possível carregar' });
    } finally {
      if (emVoo.current === controle) setCarregando(false);
    }
  }, [janela.de, janela.ate, estadoDoPeriodo.chave]);

  useEffect(() => {
    carregar();
    return () => emVoo.current?.abort();
  }, [carregar]);

  // A janela de comparação vem do PAYLOAD, não de um recálculo aqui: se a
  // tela recalculasse, ela poderia rotular uma janela e o número vir de outra —
  // que é exatamente o defeito que acabou de ser corrigido na rota.
  const comparacao = useMemo(
    () => (dados ? { de: dados.periodo.deAnterior, ate: dados.periodo.ateAnterior } : janelaDeComparacao(janela)),
    [dados, janela],
  );
  const rotuloDaComparacao = janela.comparacao === 'ano-anterior' ? 'vs. ano passado' : 'vs. período anterior';

  const fatores = useMemo(() => (dados ? calcularFatoresDeSaude(dados) : []), [dados]);
  const veredito = useMemo(() => classificarSaude(fatores), [fatores]);
  const insights: Insight[] = useMemo(
    () => (dados ? gerarInsights(dados, formatar) : []),
    [dados, formatar],
  );

  const abrir = (p: Omit<PedidoDeDetalhe, 'de' | 'ate'>) =>
    setGaveta({ ...p, de: janela.de, ate: janela.ate });

  const abrirRecorte = (
    titulo: string,
    subtitulo: string,
    lado: LadoDoLancamento,
    recorte: RecorteDoDetalhe,
    campo: PedidoDeDetalhe['campo'],
    referencia?: string,
  ) => abrir({ titulo, subtitulo, lado, recorte, campo, referencia });

  // ── Derivados de tela ──────────────────────────────────────────────────
  const faixasDeAging = (faixas: DashboardFinanceiro['aging']['receber']): Parte[] =>
    faixas.map((f, i) => ({
      id: f.id,
      rotulo: f.rotulo,
      valor: f.valor,
      // "Sem data" não é o prazo mais longo: é AUSÊNCIA de prazo. Tratá-lo
      // como o último degrau da rampa afirmaria que esse dinheiro entra depois
      // de tudo, quando a verdade é que ninguém sabe quando ele entra. Vai como
      // resto, que é o papel de "isto não é um par comparável".
      papel: (f.id === 'sem_data' ? 'resto' : 'seq') as 'resto' | 'seq',
      // O prazo é ORDINAL: os quatro degraus da rampa, do mais urgente ao mais
      // distante. Vencido NÃO ganha vermelho aqui — o vermelho da tela já é o
      // alarme de caixa negativo, e duas coisas vermelhas competem.
      indiceSeq: (Math.min(3, Math.floor((i / Math.max(1, faixas.length - 1)) * 3)) + 1) as 1 | 2 | 3 | 4,
    }));

  const linhas = (itens: Array<{ id: string; nome: string; valor: number }>): LinhaBarra[] =>
    itens.map(i => ({ id: i.id, nome: i.nome, valor: i.valor }));

  const passosDoResultado: PassoDaCascata[] = useMemo(
    () => (dados ? montarCascataDoResultado(dados, formatar) : []),
    [dados, formatar],
  );

  const temMovimento = Boolean(
    dados &&
      (dados.caixa.entradas.atual !== 0 ||
        dados.caixa.saidas.atual !== 0 ||
        dados.posicao.receber.emAberto > 0 ||
        dados.posicao.pagar.emAberto > 0 ||
        dados.vendas.quantidade > 0),
  );

  // ── Widgets escolhidos ─────────────────────────────────────────────────
  const [selecao, trocarSelecao] = useWidgetsEscolhidos();
  const [personalizando, setPersonalizando] = useState(false);
  const [saudeAberta, setSaudeAberta] = useState(false);
  const ocultar = (id: IdDoWidget) => selecao && trocarSelecao(selecao.filter(x => x !== id));

  const vereditoDaTela = VEREDITO[veredito];
  const IconeDoVeredito = vereditoDaTela.icone;
  const corDoVeredito = vereditoDaTela.tom ? corDoTom(vereditoDaTela.tom) : 'var(--ds-text-muted)';

  // ── As duas faixas de números (fixas) ──────────────────────────────────
  const em30 = dados?.projecao.find(p => p.dias === 30) ?? null;
  const vencidoReceber = dados?.posicao.receber.vencido ?? 0;
  const cobertura = dados?.cobertura.meses ?? null;

  const caixaEResultado: NumeroDoDs[] = dados
    ? [
        {
          chave: 'caixa',
          rotulo: 'Em caixa hoje',
          valor: formatar(dados.caixa.saldo),
          negativo: dados.caixa.saldo < 0,
          sub: em30 ? `${formatar(em30.saldoProjetado)} em 30 dias, pelo que já está lançado` : 'pelo histórico de baixas, não pelo saldo guardado na conta',
          tom: dados.caixa.saldo < 0 ? 'danger' : 'brand',
          Icone: Wallet,
          barras: dados.projecao.map(p => p.saldoProjetado),
        },
        {
          chave: 'sobrou',
          rotulo: 'Sobrou em caixa',
          valor: formatar(dados.caixa.resultado.atual),
          negativo: dados.caixa.resultado.atual < 0,
          sub: `entrou ${formatar(dados.caixa.entradas.atual)} · saiu ${formatar(dados.caixa.saidas.atual)}`,
          tom: dados.caixa.resultado.atual < 0 ? 'danger' : 'brand',
          Icone: TrendingUp,
          barras: dados.serie.map(p => p.resultado),
          variacao: { pct: dados.caixa.resultado.variacao, bom: (dados.caixa.resultado.variacao ?? 0) >= 0 },
          dicaDaVariacao: `${rotuloDaComparacao}: ${dataBR(comparacao.de)} a ${dataBR(comparacao.ate)}`,
        },
        {
          chave: 'receita',
          rotulo: 'Receita da agência',
          valor: formatar(dados.vendas.receitaAgencia),
          sub:
            dados.vendas.margemPct === null
              ? 'nenhuma venda no período'
              : `${PCT(dados.vendas.margemPct)} de margem sobre ${formatar(dados.vendas.volume)} vendidos`,
          tom: 'success',
          Icone: Receipt,
          anel: dados.vendas.margemPct,
          // Venda sem custo gravado entra como margem de 100% e puxa o
          // percentual para cima sem que ninguém perceba. A pílula avisa; o
          // detalhe está no widget "Cadastro incompleto".
          alerta: dados.vendas.semCusto > 0 ? `${dados.vendas.semCusto} sem custo` : undefined,
        },
        {
          chave: 'vendas',
          rotulo: 'Vendas',
          valor: String(dados.vendas.quantidade),
          sub:
            dados.vendas.quantidade > 0
              ? `ticket médio de ${formatar(dados.vendas.ticketReceita)} de receita`
              : 'nenhuma venda confirmada no período',
          tom: 'info',
          Icone: ShoppingBag,
        },
      ]
    : [];

  const contasEmAberto: NumeroDoDs[] = dados
    ? [
        {
          chave: 'receber',
          rotulo: 'A receber',
          valor: formatar(dados.posicao.receber.emAberto),
          sub:
            dados.posicao.receber.venceHoje > 0
              ? `${formatar(dados.posicao.receber.venceHoje)} vencem hoje · ${dados.posicao.receber.contas} ${dados.posicao.receber.contas === 1 ? 'parcela' : 'parcelas'}`
              : `em ${dados.posicao.receber.contas} ${dados.posicao.receber.contas === 1 ? 'parcela' : 'parcelas'}`,
          tom: 'info',
          Icone: ArrowDownLeft,
          barras: dados.aging.receber.map(f => f.valor),
          onAbrir: () => abrirRecorte('A receber em aberto', 'Tudo que ainda falta entrar', 'receber', 'em-aberto', 'valorEmAberto'),
        },
        {
          chave: 'pagar',
          rotulo: 'A pagar',
          valor: formatar(dados.posicao.pagar.emAberto),
          sub:
            dados.posicao.pagar.venceHoje > 0
              ? `${formatar(dados.posicao.pagar.venceHoje)} vencem hoje · ${dados.posicao.pagar.contas} ${dados.posicao.pagar.contas === 1 ? 'conta' : 'contas'}`
              : `em ${dados.posicao.pagar.contas} ${dados.posicao.pagar.contas === 1 ? 'conta' : 'contas'}`,
          tom: 'warning',
          Icone: ArrowUpRight,
          barras: dados.aging.pagar.map(f => f.valor),
          onAbrir: () => abrirRecorte('A pagar em aberto', 'Tudo que ainda falta sair', 'pagar', 'em-aberto', 'valorEmAberto'),
        },
        {
          chave: 'vencido',
          rotulo: 'Vencido a receber',
          valor: formatar(vencidoReceber),
          sub:
            dados.posicao.pagar.vencido > 0
              ? `e ${formatar(dados.posicao.pagar.vencido)} vencidos a pagar`
              : vencidoReceber > 0
                ? `em ${dados.posicao.receber.contasVencidas} ${dados.posicao.receber.contasVencidas === 1 ? 'parcela' : 'parcelas'}; nada vencido a pagar`
                : 'nada vencido nos dois lados',
          tom: vencidoReceber > 0 || dados.posicao.pagar.vencido > 0 ? 'danger' : 'success',
          Icone: vencidoReceber > 0 || dados.posicao.pagar.vencido > 0 ? OctagonAlert : CircleCheck,
          onAbrir:
            vencidoReceber > 0
              ? () => abrirRecorte('A receber em aberto', 'Inclui o que já venceu', 'receber', 'em-aberto', 'valorEmAberto')
              : undefined,
        },
        {
          chave: 'folego',
          rotulo: 'Fôlego de caixa',
          valor: cobertura === null ? 'sem base' : meses(cobertura),
          sub:
            dados.cobertura.despesaMensal > 0
              ? `com despesa própria de ${formatar(dados.cobertura.despesaMensal)} por mês`
              : 'nenhuma despesa própria paga no período',
          tom: cobertura === null ? 'info' : cobertura >= 3 ? 'success' : cobertura >= 1 ? 'warning' : 'danger',
          Icone: Gauge,
        },
      ]
    : [];

  // ── Cada widget ─────────────────────────────────────────────────────────
  const graficoDoWidget = (id: IdDoWidget) => {
    const { Icone, tom } = VISUAL_DO_WIDGET[id];
    return {
      aparencia: 'ds' as const,
      compacta: true,
      icone: Icone,
      tom,
      acoes: <BotaoOcultar titulo={CATALOGO[id].titulo} onOcultar={() => ocultar(id)} />,
    };
  };

  const widget = (id: IdDoWidget): React.ReactNode => {
    if (!dados) return null;
    const ocultarEste = <BotaoOcultar titulo={CATALOGO[id].titulo} onOcultar={() => ocultar(id)} />;
    switch (id) {
      case 'atencao':
        return (
          <Widget id={id} titulo="Precisa da sua atenção" sub={insights.length ? `${insights.length} ${insights.length === 1 ? 'aviso' : 'avisos'}, do mais urgente ao menos` : 'nada pendente'} acoes={ocultarEste}>
            {insights.length === 0 ? (
              <VazioDoGrafico motivo="sem-dado" aparencia="ds" frase="Nada pedindo atenção agora." />
            ) : (
              <ul className="-mr-2 flex max-h-[268px] flex-col gap-2 overflow-y-auto pr-2">
                {insights.map(i => {
                  const t = TOM_DO_INSIGHT[i.tom];
                  return (
                    <li key={i.id} className="flex items-start gap-2.5 rounded-[14px] px-3 py-2.5" style={{ background: suave(corDoTom(t), 0.08) }}>
                      <ChipDoTom tom={t} Icone={ICONE_DO_INSIGHT[i.tom]} tamanho={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-[1.4] text-[var(--ds-text-strong)]">{i.texto}</span>
                        {/* A evidência é o que permite conferir. Insight sem número é opinião. */}
                        {i.evidencia ? <span className="ds-num mt-0.5 block text-[11.5px] text-[var(--ds-text-muted)]">{i.evidencia}</span> : null}
                        {i.acao ? (
                          <Link href={i.acao.href} className={cn('mt-1 inline-block text-[12px] font-medium text-[var(--ds-text-link)] underline-offset-2 hover:underline', FOCO)}>
                            {i.acao.rotulo}
                          </Link>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Widget>
        );

      case 'saude': {
        const pior = fatores.reduce<(typeof fatores)[number] | null>(
          (p, f) => (!p || ORDEM_DE_GRAVIDADE[f.faixa] > ORDEM_DE_GRAVIDADE[p.faixa] ? f : p),
          null,
        );
        return (
          <Widget
            id={id}
            titulo="Saúde financeira"
            sub={pior ? `${vereditoDaTela.rotulo} · o pior fator dá o veredito` : 'sem fatores no período'}
            acoes={
              <>
                {fatores.length > 0 ? (
                  <button type="button" className={cn(PILULA_DS, 'h-8 px-3 text-[12px]')} onClick={() => setSaudeAberta(true)}>
                    Detalhes
                  </button>
                ) : null}
                {ocultarEste}
              </>
            }
          >
            <ul className="flex flex-col">
              {fatores.map(f => (
                <li key={f.id} className="flex min-h-[40px] items-center gap-3 border-t border-[var(--ds-border-subtle)] py-2 first:border-t-0">
                  <i aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: COR_DA_FAIXA[f.faixa] }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ds-text-body)]">{f.nome}</span>
                  <span className="hidden text-[11.5px] text-[var(--ds-text-muted)] sm:inline">{PALAVRA_DA_FAIXA[f.faixa]}</span>
                  <span className="ds-num shrink-0 whitespace-nowrap text-right text-[13.5px] font-medium text-[var(--ds-text-strong)]">{f.valor}</span>
                </li>
              ))}
            </ul>
          </Widget>
        );
      }

      case 'serie':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="Entrou, saiu e sobrou"
            sublinha="Mês a mês, pela data em que o dinheiro se moveu"
            estado={dados.serie.length < 2 ? 'insuficiente' : 'ok'}
            vazio={{ frase: 'A comparação mês a mês nasce quando houver movimento em dois meses do período escolhido.' }}
            descricao="Entradas, saídas e resultado por mês, na mesma escala de reais."
            tabela={{
              colunas: ['Mês', 'Entrou', 'Saiu', 'Sobrou'],
              linhas: dados.serie.map(p => [p.mes, formatar(p.entradas), formatar(p.saidas), formatar(p.resultado)]),
            }}
          >
            <SerieFinanceira
              pontos={dados.serie.map(p => ({
                chave: p.mes,
                rotulo: `${p.mes.slice(5, 7)}/${p.mes.slice(2, 4)}`,
                entradas: p.entradas,
                saidas: p.saidas,
                resultado: p.resultado,
              }))}
              formatar={formatar}
              formatarEixo={formatarEixo}
              altura={180}
              destaque={dados.serie.length - 1}
            />
          </GraficoMoldura>
        );

      case 'projecao':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="Projeção de caixa"
            sublinha="O saldo de hoje mais o que já está lançado"
            estado={dados.projecao.length === 0 ? 'sem-dado' : 'ok'}
            vazio={{ frase: 'Nada lançado para os próximos 90 dias.' }}
            descricao="Saldo projetado de hoje a 90 dias, somando o que já está lançado a receber e a pagar. Não é previsão."
            tabela={{
              colunas: ['Quando', 'Entra', 'Sai', 'Saldo'],
              linhas: dados.projecao.map(p => [p.dias === 0 ? 'hoje' : `${p.dias} dias`, formatar(p.entradas), formatar(p.saidas), formatar(p.saldoProjetado)]),
            }}
          >
            <ProjecaoDeCaixa
              saldoHoje={dados.caixa.saldo}
              dataDeHoje={dados.periodo.hoje}
              pontos={dados.projecao}
              formatar={formatar}
              formatarEixo={formatarEixo}
              altura={180}
              onAtivar={() => abrirRecorte('A pagar em aberto', 'Tudo que ainda falta sair', 'pagar', 'em-aberto', 'valorEmAberto')}
            />
          </GraficoMoldura>
        );

      case 'aging':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="Quando o dinheiro entra e sai"
            sublinha="Em aberto por prazo, na mesma escala"
            estado={dados.posicao.receber.emAberto + dados.posicao.pagar.emAberto > 0 ? 'ok' : 'sem-dado'}
            vazio={{ frase: 'Nada a receber e nada a pagar em aberto.' }}
            descricao="Saldo em aberto por prazo, a receber e a pagar."
            tabela={{
              colunas: ['Prazo', 'A receber', 'A pagar'],
              linhas: [...new Set([...dados.aging.receber.map(f => f.rotulo), ...dados.aging.pagar.map(f => f.rotulo)])].map(rotulo => [
                rotulo,
                formatar(dados.aging.receber.find(f => f.rotulo === rotulo)?.valor ?? 0),
                formatar(dados.aging.pagar.find(f => f.rotulo === rotulo)?.valor ?? 0),
              ]),
            }}
          >
            <div className="flex flex-col gap-4">
              {(['receber', 'pagar'] as const).map(lado => (
                <div key={lado} className="flex flex-col gap-2">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className={cn(ROTULO_DS, 'text-[var(--ds-text-muted)]')}>{lado === 'receber' ? 'A receber' : 'A pagar'}</span>
                    <span className="ds-num text-[14px] font-medium text-[var(--ds-text-strong)]">{formatar(dados.posicao[lado].emAberto)}</span>
                  </p>
                  <BarraDeParte
                    partes={faixasDeAging(dados.aging[lado])}
                    total={Math.max(dados.posicao.receber.emAberto, dados.posicao.pagar.emAberto)}
                    formatar={formatar}
                    altura={12}
                    trilhoVazioRotulo={lado === 'receber' ? 'nada a receber em aberto' : 'nada a pagar em aberto'}
                    onAtivar={faixa =>
                      abrirRecorte(
                        lado === 'receber' ? 'A receber' : 'A pagar',
                        dados.aging[lado].find(f => f.id === faixa)?.rotulo ?? '',
                        lado,
                        // A FAIXA, não o balde inteiro: o título promete a faixa clicada.
                        'aging',
                        'valorEmAberto',
                        faixa,
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </GraficoMoldura>
        );

      case 'cascata':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="Do que o cliente pagou até o que sobrou"
            sublinha="Onde o dinheiro do cliente para"
            estado={dados.vendas.quantidade === 0 ? 'sem-dado' : 'ok'}
            vazio={{ frase: 'Nenhuma venda registrada no período.', acao: { rotulo: 'Registrar venda', href: '/vendas/nova' } }}
            descricao="Volume vendido menos repasse a fornecedores é a receita da agência; menos a despesa própria é o resultado."
            tabela={{ colunas: ['Etapa', 'Valor'], linhas: passosDoResultado.map(p => [p.rotulo, formatar(p.valor)]) }}
          >
            <Cascata passos={passosDoResultado} formatar={formatar} altura={200} />
          </GraficoMoldura>
        );

      case 'origem':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="De onde veio o dinheiro"
            sublinha="Entradas do período por origem"
            estado={dados.receitaPorOrigem.length === 0 ? 'sem-dado' : 'ok'}
            vazio={{ frase: 'Nenhuma entrada registrada no período.' }}
            descricao="Entradas do período por origem. A comissão de operadora é receita da agência por inteiro."
            tabela={{ colunas: ['Origem', 'Valor'], linhas: dados.receitaPorOrigem.map(o => [o.nome, formatar(o.valor)]) }}
          >
            <BarrasNomeadas
              linhas={linhas(dados.receitaPorOrigem)}
              formatar={formatar}
              ordenacao="dada"
              maximoVisivel={5}
              alturaBarra={10}
              onAtivar={ref => abrirRecorte('Entradas por origem', '', 'receber', 'origem', 'valorRealizado', ref)}
            />
          </GraficoMoldura>
        );

      case 'despesa':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="Para onde o dinheiro foi"
            sublinha="Despesa própria por categoria"
            estado={dados.despesaPorCategoria.length === 0 ? 'sem-dado' : 'ok'}
            vazio={{ frase: 'Nenhuma despesa própria paga no período.' }}
            descricao="Despesa própria do período por categoria; o repasse ao fornecedor fica fora."
            tabela={{ colunas: ['Categoria', 'Valor'], linhas: dados.despesaPorCategoria.map(c => [c.nome, formatar(c.valor)]) }}
          >
            <BarrasNomeadas
              linhas={linhas(dados.despesaPorCategoria)}
              formatar={formatar}
              maximoVisivel={5}
              alturaBarra={10}
              onAtivar={ref => abrirRecorte('Despesa por categoria', '', 'pagar', 'categoria', 'valorRealizado', ref)}
            />
          </GraficoMoldura>
        );

      case 'fornecedores':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="Para quem a agência mais pagou"
            sublinha="Pago no período, repasse incluído"
            estado={dados.fornecedores.length === 0 ? 'sem-dado' : 'ok'}
            vazio={{ frase: 'Nenhum pagamento a fornecedor no período.' }}
            descricao="Fornecedores pelo valor pago no período."
            tabela={{ colunas: ['Fornecedor', 'Pago'], linhas: dados.fornecedores.map(f => [f.nome, formatar(f.valor)]) }}
          >
            <BarrasNomeadas
              linhas={linhas(dados.fornecedores)}
              formatar={formatar}
              maximoVisivel={5}
              alturaBarra={10}
              onAtivar={ref => abrirRecorte('Contas deste fornecedor', 'Em aberto', 'pagar', 'contraparte', 'valorEmAberto', ref)}
            />
          </GraficoMoldura>
        );

      case 'margem':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="Quem dá margem"
            sublinha="Margem por fornecedor nos itens das vendas"
            estado={dados.margemPorFornecedor.length === 0 ? 'sem-dado' : 'ok'}
            vazio={{ frase: 'As vendas do período não têm serviço detalhado por fornecedor.' }}
            descricao="Margem por fornecedor: valor de venda menos custo, nos itens das vendas do período."
            tabela={{
              colunas: ['Fornecedor', 'Vendido', 'Custo', 'Margem'],
              linhas: dados.margemPorFornecedor.map(m => [
                m.nome, formatar(m.venda), formatar(m.custo), `${formatar(m.margem)}${m.margemPct === null ? '' : ` (${PCT(m.margemPct)})`}`,
              ]),
            }}
          >
            <BarrasNomeadas
              linhas={dados.margemPorFornecedor.map(m => ({
                id: m.id,
                nome: m.nome,
                valor: m.margem,
                secundario: `${m.margemPct === null ? 'sem base' : PCT(m.margemPct)} de margem · ${formatar(m.venda)} vendidos`,
              }))}
              formatar={formatar}
              maximoVisivel={4}
              alturaBarra={10}
            />
          </GraficoMoldura>
        );

      case 'clientes':
        return (
          <GraficoMoldura
            {...graficoDoWidget(id)}
            titulo="De quem a agência recebeu"
            sublinha="Recebido de clientes no período"
            estado={dados.clientes.length === 0 ? 'sem-dado' : 'ok'}
            vazio={{ frase: 'Nenhum recebimento de cliente no período.' }}
            descricao="Clientes pelo valor recebido no período. A comissão de operadora fica fora."
            tabela={{ colunas: ['Cliente', 'Recebido'], linhas: dados.clientes.map(c => [c.nome, formatar(c.valor)]) }}
          >
            <BarrasNomeadas
              linhas={linhas(dados.clientes)}
              formatar={formatar}
              maximoVisivel={5}
              alturaBarra={10}
              onAtivar={ref => abrirRecorte('Contas deste cliente', 'Em aberto', 'receber', 'contraparte', 'valorEmAberto', ref)}
            />
          </GraficoMoldura>
        );

      case 'agenda':
        return (
          <Widget id={id} titulo="Próximos movimentos" sub="Próximos 30 dias, com o que já venceu" acoes={ocultarEste}>
            {dados.agenda.linhas.length === 0 ? (
              <VazioDoGrafico motivo="sem-dado" aparencia="ds" frase="Nada a receber nem a pagar nos próximos 30 dias." />
            ) : (
              <>
                <ul className="flex flex-col">
                  {dados.agenda.linhas.slice(0, 6).map(l => (
                    <li key={`${l.lado}-${l.id}`} className="flex min-h-[40px] items-center gap-3 border-t border-[var(--ds-border-subtle)] py-2 first:border-t-0">
                      <span className="ds-num w-11 shrink-0 text-[12px] text-[var(--ds-text-muted)]">{diaEMes(l.data)}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ds-text-body)]">
                        {l.contraparte || l.descricao || (l.lado === 'receber' ? 'A receber' : 'A pagar')}
                      </span>
                      {l.vencido ? (
                        <span className="inline-flex h-[20px] shrink-0 items-center rounded-full bg-[var(--ds-danger-soft)] px-2 text-[10.5px] font-medium text-[var(--ds-danger-ink)]">vencido</span>
                      ) : null}
                      {/* Sinal explícito: cor sozinha não diz se o dinheiro entra ou sai. */}
                      <span className={cn('ds-num shrink-0 text-[13.5px] font-medium', l.lado === 'receber' ? 'text-[var(--ds-success-ink)]' : 'text-[var(--ds-text-strong)]')}>
                        {`${l.lado === 'receber' ? '+' : '−'} ${formatar(l.valor)}`}
                      </span>
                    </li>
                  ))}
                </ul>
                {dados.agenda.total > 6 ? (
                  <p className="mt-2 text-[11.5px] text-[var(--ds-text-muted)]">{`Mostrando 6 dos ${dados.agenda.total} lançamentos dos próximos 30 dias.`}</p>
                ) : null}
              </>
            )}
          </Widget>
        );

      case 'descasamento':
        return (
          <Widget id={id} titulo="Fornecedor vence antes do cliente" sub="O dinheiro sai antes de entrar" acoes={ocultarEste}>
            {dados.descasamento.length === 0 ? (
              <VazioDoGrafico motivo="sem-dado" aparencia="ds" frase="Nenhuma venda do período paga o fornecedor antes de receber do cliente." />
            ) : (
              <ul className="flex max-h-[268px] flex-col overflow-y-auto">
                {dados.descasamento.map(v => (
                  <li key={v.vendaId} className="flex min-h-[44px] items-center gap-3 border-t border-[var(--ds-border-subtle)] py-2 first:border-t-0">
                    <button
                      type="button"
                      className={cn('min-w-0 flex-1 rounded-[10px] text-left', FOCO)}
                      onClick={() => abrirRecorte(`Venda ${v.numero}`, 'Contas a pagar desta venda', 'pagar', 'venda', 'valorEmAberto', v.vendaId)}
                    >
                      <span className="block truncate text-[13px] font-medium text-[var(--ds-text-strong)]">{`Venda ${v.numero}${v.cliente ? ` · ${v.cliente}` : ''}`}</span>
                      <span className="block truncate text-[11.5px] text-[var(--ds-text-muted)]">
                        {`paga em ${diaEMes(v.primeiroPagamento)}, recebe em ${diaEMes(v.primeiroRecebimento)} · ${v.diasDeGap} ${v.diasDeGap === 1 ? 'dia' : 'dias'}`}
                      </span>
                    </button>
                    <span className="ds-num shrink-0 text-[13.5px] font-medium text-[var(--ds-danger-ink)]">{formatar(v.exposicao)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Widget>
        );

      case 'vendas':
        return (
          <Widget id={id} titulo="Vendas do período" sub={`${dados.vendas.quantidade} ${dados.vendas.quantidade === 1 ? 'venda confirmada' : 'vendas confirmadas'}`} acoes={ocultarEste}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                ['Volume vendido', formatar(dados.vendas.volume)],
                ['Custo dos serviços', formatar(dados.vendas.custo)],
                ['Receita da agência', formatar(dados.vendas.receitaAgencia)],
                ['Comissão de operadora', formatar(dados.vendas.comissaoDeOperadora)],
                ['Ticket médio vendido', formatar(dados.vendas.ticketVolume)],
                ['Ticket médio de receita', formatar(dados.vendas.ticketReceita)],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="min-w-0 rounded-[14px] bg-[var(--ds-surface-sunken)] px-3 py-2.5">
                  <dt className={cn(ROTULO_DS, 'truncate text-[10px] text-[var(--ds-text-muted)]')}>{rotulo}</dt>
                  <dd className="ds-num mt-1 truncate text-[16px] font-medium text-[var(--ds-text-strong)]">{valor}</dd>
                </div>
              ))}
            </dl>
          </Widget>
        );

      case 'qualidade': {
        const itens = [
          { rotulo: 'Vendas sem custo lançado', n: dados.vendas.semCusto, detalhe: 'a margem delas aparece como 100%' },
          {
            rotulo: 'Vendas que não geraram contas',
            n: dados.vendas.semLastro.quantidade,
            detalhe: dados.vendas.semLastro.quantidade > 0 ? `${formatar(dados.vendas.semLastro.volume)} sem nada a receber nem a pagar` : 'toda venda tem contas',
          },
          { rotulo: 'Contas a pagar com fornecedor pendente', n: dados.atencao.semFornecedor },
          { rotulo: 'Contas sem vencimento', n: dados.atencao.semVencimento },
          {
            rotulo: 'Despesas pagas sem categoria',
            n: dados.atencao.naoCategorizadas.contas,
            detalhe: dados.atencao.naoCategorizadas.contas > 0 ? `${formatar(dados.atencao.naoCategorizadas.valor)} fora do "Para onde o dinheiro foi"` : undefined,
          },
        ];
        const pendentes = itens.filter(i => i.n > 0).length;
        return (
          <Widget id={id} titulo="Cadastro incompleto" sub={pendentes === 0 ? 'tudo lançado' : `${pendentes} ${pendentes === 1 ? 'ponto' : 'pontos'} a completar`} acoes={ocultarEste}>
            <ul className="flex flex-col">
              {itens.map(i => (
                <LinhaDeResumo
                  key={i.rotulo}
                  rotulo={i.rotulo}
                  detalhe={i.detalhe}
                  valor={i.n}
                  cor={i.n > 0 ? 'var(--ds-warning)' : 'var(--ds-success)'}
                />
              ))}
            </ul>
          </Widget>
        );
      }
    }
  };

  return (
    <div className="ds ds-pagina min-h-full w-full">
      <div className="px-3 pb-8 pt-4 sm:px-5 sm:pt-5 lg:px-8 lg:pb-10 lg:pt-7">
        <div className="mx-auto w-full max-w-[1400px]">
          {/* ── Topo ──────────────────────────────────────────────────────── */}
          <TopoDoDs
            Icone={LayoutDashboard}
            titulo="Dashboard financeiro"
            sub={
              <>
                Visão geral da saúde financeira da sua agência ·{' '}
                <span className="font-medium lowercase text-[var(--ds-text-strong)]">{janela.rotulo}</span>
              </>
            }
          >
            <div className="fin-no-print flex items-center gap-2">
              {dados ? (
                <span
                  className="hidden h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium sm:inline-flex"
                  style={{ background: suave(corDoVeredito, 0.12), color: corDoVeredito }}
                  title="Saúde financeira: o pior fator dá o veredito"
                >
                  <IconeDoVeredito className="h-3.5 w-3.5" aria-hidden="true" />
                  {vereditoDaTela.rotulo}
                </span>
              ) : null}
              {atualizadoEm ? (
                <span className="ds-num whitespace-nowrap text-[12px] text-[var(--ds-text-muted)]">{`Atualizado às ${horaBR(atualizadoEm)}`}</span>
              ) : null}
              <button
                type="button"
                onClick={() => { carregar(); }}
                disabled={carregando}
                aria-label="Recarregar os números"
                title="Recarregar os números"
                className={cn(PILULA_DS, 'w-9 justify-center px-0 disabled:opacity-60')}
              >
                <RefreshCw className={cn('h-[15px] w-[15px]', carregando && 'animate-spin')} aria-hidden="true" />
              </button>
            </div>
          </TopoDoDs>

          {/* ── Barra de filtros ──────────────────────────────────────────── */}
          <div className={cn(CARTAO_DS, 'fin-no-print mt-[22px] flex flex-col gap-2.5 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center')}>
            <span className={cn(ROTULO_DS, 'inline-flex items-center gap-1.5 px-1 text-[var(--ds-text-muted)]')}>
              <CalendarDays className="h-[13px] w-[13px]" aria-hidden="true" />
              Período
            </span>
            <div className="ds-periodo min-w-0">
              <FiltroDePeriodo janela={janela} estado={estadoDoPeriodo} onChange={trocarPeriodo} />
            </div>
            <span className="hidden flex-1 sm:block" />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={PILULA_DS} onClick={() => setPersonalizando(true)} disabled={!selecao}>
                <SlidersHorizontal className="h-[15px] w-[15px]" aria-hidden="true" />
                Personalizar
              </button>
              <BotaoDePrivacidade className={PILULA_DS} />
            </div>
          </div>

          {/* 403 é decisão de permissão, não falha de rede. */}
          {erro?.status === 403 ? (
            <div className={cn(CARTAO_DS, 'mt-3.5 p-[22px]')} role="alert">
              <CabecaDoBloco
                tom="warning"
                Icone={TriangleAlert}
                titulo="Seu perfil não tem acesso ao financeiro"
                sub="Este painel mostra saldo em caixa, margem e posição de fornecedor. Peça a quem administra a conta para liberar o acesso ao financeiro do seu usuário."
              />
            </div>
          ) : (
          <DataState
            className="flex flex-col"
            estado={carregando && !dados ? 'carregando' : erro ? 'erro' : 'ok'}
            erro={
              erro
                ? {
                    mensagem: `Não foi possível carregar os dados de ${dataBR(janela.de)} a ${dataBR(janela.ate)}. Nada foi alterado.`,
                    onTentarDeNovo: () => { carregar(); },
                  }
                : null
            }
            esqueleto={
              <div className="mt-[26px] flex flex-col gap-3.5" aria-hidden>
                {[0, 1].map(f => (
                  <div key={f} className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                    {[0, 1, 2, 3].map(i => <div key={i} className={cn(CARTAO_DS, 'h-[150px] animate-pulse')} />)}
                  </div>
                ))}
                <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                  {[0, 1, 2].map(i => <div key={i} className={cn(CARTAO_DS, 'h-[300px] animate-pulse')} />)}
                </div>
              </div>
            }
          >
            {dados && !temMovimento ? (
              <div className={cn(CARTAO_DS, 'mt-[26px] p-[22px]')}>
                <EmptyLesson
                  motivo="sem-dado"
                  titulo="Ainda não há movimento financeiro neste período"
                  oQueE="Este painel lê as contas a receber, as contas a pagar e as vendas para mostrar quanto a agência tem, quanto ganhou e para onde o dinheiro foi."
                  comoComeca={[
                    'Cadastre as contas bancárias com o saldo de abertura',
                    'Registre uma venda: as contas a receber e a pagar nascem dela',
                    'Dê baixa quando o dinheiro entrar ou sair',
                  ]}
                  acao={{ rotulo: 'Registrar venda', href: '/vendas/nova' }}
                />
              </div>
            ) : dados ? (
              <>
                {/* ══ As duas faixas fixas ═══════════════════════════════ */}
                <TituloDeSecao primeira extra={`${dataBR(janela.de)} a ${dataBR(janela.ate)}`}>Caixa e resultado</TituloDeSecao>
                {/* No celular as faixas deslizam para o lado (com encaixe): oito
                    cartões empilhados empurravam os widgets para a terceira tela. */}
                <div className={FAIXA_DE_NUMEROS}>
                  {/* A manchete da tela (uma só): o caixa de hoje. */}
                  <div data-ds-resposta="" className={ITEM_DA_FAIXA}>
                    <CartaoDeNumero n={caixaEResultado[0]} />
                  </div>
                  {caixaEResultado.slice(1).map(n => (
                    <div key={n.chave} className={ITEM_DA_FAIXA}><CartaoDeNumero n={n} /></div>
                  ))}
                </div>

                <TituloDeSecao>Contas em aberto</TituloDeSecao>
                <div className={FAIXA_DE_NUMEROS}>
                  {contasEmAberto.map(n => (
                    <div key={n.chave} className={ITEM_DA_FAIXA}><CartaoDeNumero n={n} /></div>
                  ))}
                </div>

                {/* ══ Área de widgets ═════════════════════════════════════ */}
                <TituloDeSecao
                  extra={selecao ? `${selecao.length} de ${IDS_DOS_WIDGETS.length}` : undefined}
                  acao={
                    <button type="button" className={cn(PILULA_DS, 'fin-no-print h-8 px-3 text-[12px]')} onClick={() => setPersonalizando(true)} disabled={!selecao}>
                      <SlidersHorizontal className="h-[14px] w-[14px]" aria-hidden="true" />
                      Personalizar
                    </button>
                  }
                >
                  Seus widgets
                </TituloDeSecao>

                {!selecao ? (
                  <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
                    {[0, 1, 2].map(i => <div key={i} className={cn(CARTAO_DS, 'h-[300px] animate-pulse')} />)}
                  </div>
                ) : selecao.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setPersonalizando(true)}
                    className={cn(
                      'flex w-full flex-col items-center gap-2 rounded-[var(--ds-radius-card)] border border-dashed border-[var(--ds-border-default)] px-6 py-10 text-center transition-colors hover:border-[var(--ds-brand)] hover:bg-[var(--ds-brand-soft)]',
                      FOCO,
                    )}
                  >
                    <ChipDoTom Icone={LayoutGrid} tamanho={38} />
                    <span className="text-[14px] font-medium text-[var(--ds-text-strong)]">Nenhum widget no dashboard</span>
                    <span className="text-[12.5px] text-[var(--ds-text-muted)]">{`Escolha entre ${IDS_DOS_WIDGETS.length} widgets: caixa, contas, vendas, fornecedores e clientes.`}</span>
                  </button>
                ) : (
                  // Denso: um widget estreito ocupa o vão que um largo deixou.
                  <div className="grid grid-flow-row-dense grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                    {selecao.map(id => (
                      <div key={id} className={cn('grid min-w-0', CATALOGO[id].largura === 2 && 'md:col-span-2')}>
                        {widget(id)}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── O que este painel NÃO mostra, e por quê ─────────────── */}
                <details className={cn(CARTAO_DS, 'group mt-[34px] px-[22px] py-1')}>
                  <summary className={cn('flex min-h-[52px] cursor-pointer list-none items-center gap-3 rounded-[16px]', FOCO)}>
                    <ChipDoTom tom="info" Icone={BookOpen} tamanho={30} />
                    <span className="flex-1 text-[14px] font-medium text-[var(--ds-text-strong)]">O que este painel ainda não mostra</span>
                    <span className="text-[12px] text-[var(--ds-text-muted)] group-open:hidden">abrir</span>
                    <span className="hidden text-[12px] text-[var(--ds-text-muted)] group-open:inline">fechar</span>
                  </summary>
                  <ul className="mb-4 mt-1 flex list-disc flex-col gap-2 pl-[54px] text-[12.5px] text-[var(--ds-text-body)]">
                    <li><strong className="font-medium text-[var(--ds-text-strong)]">Orçado contra realizado.</strong> Não existe orçamento financeiro conciliável no sistema, então não há contra o que comparar.</li>
                    <li><strong className="font-medium text-[var(--ds-text-strong)]">Receita por categoria.</strong> Toda conta a receber gerada por venda nasce sem categoria, então a divisão seria quase toda &quot;sem categoria&quot;.</li>
                    <li><strong className="font-medium text-[var(--ds-text-strong)]">Saldo por banco e forma de pagamento.</strong> Os campos existem, mas as telas de baixa não os gravam. O saldo TOTAL é confiável; a distribuição, não.</li>
                    <li><strong className="font-medium text-[var(--ds-text-strong)]">Prazo médio de recebimento.</strong> A baixa grava sempre a data de hoje, não a data em que o cliente pagou, então a média mediria o dia do lançamento.</li>
                    <li><strong className="font-medium text-[var(--ds-text-strong)]">Um número pode diferir do DRE.</strong> Este painel conta só a venda CONFIRMADA ou concluída; o DRE conta toda venda que não foi cancelada, inclusive orçamento e reserva que já geraram contas.</li>
                    <li><strong className="font-medium text-[var(--ds-text-strong)]">Comparação mês a mês fiel.</strong> A série é reconstruída com o estado atual das contas: uma baixa lançada hoje com data retroativa muda o passado do gráfico.</li>
                  </ul>
                </details>

                <p className="mt-3.5 text-[12px] text-[var(--ds-text-muted)]">
                  {`Período de ${dataBR(janela.de)} a ${dataBR(janela.ate)}, comparado com ${dataBR(comparacao.de)} a ${dataBR(comparacao.ate)}. `}
                  Entradas e saídas são pelo regime de caixa (a data da baixa); a receber e a pagar, pelo vencimento.
                </p>
              </>
            ) : null}
          </DataState>
          )}

          {selecao ? (
            <JanelaDePersonalizar aberta={personalizando} onFechar={() => setPersonalizando(false)} selecao={selecao} onTrocar={trocarSelecao} />
          ) : null}

          <Dialog open={saudeAberta} onOpenChange={setSaudeAberta}>
            <DialogContent className="ds w-full gap-0 border-0 bg-transparent p-0 shadow-none sm:max-w-[920px]">
              <DialogTitle className="sr-only">Saúde financeira</DialogTitle>
              <DialogDescription className="sr-only">Cada fator medido por conta própria; o pior deles dá o veredito.</DialogDescription>
              <PainelDeSaude fatores={fatores} aparencia="ds" />
            </DialogContent>
          </Dialog>

          <GavetaDeLancamentos pedido={gaveta} onFechar={() => setGaveta(null)} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <PrivacidadeProvider>
      <Painel />
    </PrivacidadeProvider>
  );
}
