'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { MoneyInput } from '@/components/MoneyInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { formatBRL, generateId } from '@/lib/utils';
import { Copy, AlertTriangle, ArrowRight, Filter as FunilIcon, Download, FileDown, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { FunilPayload } from '@/lib/funil-types';
import {
  calcRelatorio,
  type CustosData,
} from '@/lib/planejamento-custos';
import { analisarPlano } from '@/lib/planejamento-analise';
import {
  aplicarInvestimentoDosFunis,
  resumirFunisAssociaveis,
} from '@/lib/planejamento-custos-associacao';
import {
  hidratarPlanoCustos,
  mesPlanejamentoValido,
} from '@/lib/planejamento-custos-schema';

const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Decimal no padrão pt-BR — toFixed devolve ponto, que num app brasileiro
 *  lê como erro de digitação ("0.3 vendas por dia"). */
function dec(v: number, casas = 1): string {
  return (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/** 'YYYY-MM' → 'setembro de 2026' (sem passar por Date, que erra o fuso). */
function mesPorExtenso(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  const nome = MESES_PT[(m || 1) - 1] ?? '';
  return `${nome} de ${ano}`;
}

// ============================================================
// TYPES
// ============================================================

// ============================================================
// CALCULATIONS
// ============================================================

// ============================================================
// UI PRIMITIVES
// ============================================================

/** Título de seção — hairline + label, sem ícone decorativo. */
function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Campo de premissa. Altura fixa pra todos os cards ficarem na mesma linha de base. */
function Premissa({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col rounded-[12px] border p-3.5 h-[104px]"
      style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
    >
      <label className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)] mb-2">
        {label}
      </label>
      {children}
      <p className="text-[11px] text-[var(--ink-3)] mt-auto pt-1.5 leading-tight truncate" title={hint}>
        {hint ?? ''}
      </p>
    </div>
  );
}

const inputBase =
  'w-full h-[34px] px-2.5 rounded-[8px] border text-[14px] tabular-nums text-right ' +
  'text-[var(--ink)] outline-none transition-colors ' +
  'focus:border-[var(--lg-accent)] focus:ring-2 focus:ring-[var(--lg-accent)]/15';

const inputStyle = { borderColor: 'var(--line)', background: 'var(--ink-surface-2)' } as const;

/**
 * Campo de dinheiro com o "R$" fixo dentro da moldura: o símbolo para de
 * competir com o número (que fica sozinho à direita, tabular) e o campo
 * inteiro vira alvo de clique.
 */
function CampoValor({ value, onChange, destaque }: {
  value: number; onChange: (v: number) => void; destaque?: boolean;
}) {
  return (
    <label
      className="group relative flex items-center h-[36px] rounded-[9px] border cursor-text transition-colors
                 focus-within:border-[var(--lg-accent)] focus-within:ring-2 focus-within:ring-[var(--lg-accent)]/15
                 hover:border-[var(--line-strong)]"
      style={{
        borderColor: 'var(--line)',
        background: 'var(--ink-surface-2)',
      }}
    >
      <span
        className="pl-2.5 pr-1 text-[12px] font-medium select-none pointer-events-none"
        style={{ color: value > 0 ? 'var(--ink-3)' : 'var(--lg-text-4)' }}
      >
        R$
      </span>
      <div className="flex-1 min-w-0 [&_input]:h-[34px] [&_input]:border-0 [&_input]:bg-transparent [&_input]:shadow-none [&_input]:px-0 [&_input]:pr-2.5 [&_input]:text-[14px] [&_input]:tabular-nums [&_input]:text-right [&_input]:outline-none">
        <MoneyInput
          value={value}
          onChange={v => onChange(v ?? 0)}
          placeholder="0,00"
          className={destaque ? 'font-semibold' : ''}
        />
      </div>
    </label>
  );
}

/** Barra fina de participação — mostra o peso de cada linha no total. */
function Peso({ pct, cor }: { pct: number; cor: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'var(--ink-surface-2)' }}>
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: cor }}
        />
      </div>
      <span className="text-[11.5px] tabular-nums text-[var(--ink-3)] w-[38px] text-right">
        {pct > 0 ? `${dec(pct, 0)}%` : '—'}
      </span>
    </div>
  );
}

/** Linha de entrada: hover discreto pra dar alvo visual à edição. */
function LinhaEntrada({ children, cols }: { children: React.ReactNode; cols: string }) {
  return (
    <div
      className={`grid ${cols} items-center gap-3 px-4 py-[7px] border-b last:border-b-0 transition-colors hover:bg-[var(--ink-surface-2)]/60`}
      style={{ borderColor: 'var(--line)' }}
    >
      {children}
    </div>
  );
}

/** Linha do relatório. Sem ícone por linha — a hierarquia vem do peso do texto. */
function Linha({ label, value, forte, alerta }: {
  label: string; value: string; forte?: boolean; alerta?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-[7px]">
      <span
        className={`text-[13px] leading-snug ${forte ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-2)]'}`}
      >
        {alerta && <AlertTriangle className="w-3 h-3 inline-block mr-1.5 -mt-0.5" style={{ color: 'var(--lg-warn)' }} />}
        {label}
      </span>
      <span
        className={`text-[13px] tabular-nums whitespace-nowrap ${forte ? 'font-bold text-[var(--ink)]' : 'font-medium text-[var(--ink-2)]'}`}
        style={alerta ? { color: 'var(--lg-warn)' } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function GrupoLinhas({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-t" style={{ borderColor: 'var(--line)' }}>
      <div className="px-4 pt-3 pb-1">
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[var(--ink-3)]">
          {titulo}
        </span>
      </div>
      <div className="pb-2">{children}</div>
    </div>
  );
}

/** Linha de total no rodapé de cada bloco de custo. */
function TotalLinha({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 px-4 py-3 border-t"
      style={{ borderColor: 'var(--line)', background: 'var(--ink-surface-2)' }}
    >
      <span className="text-[12.5px] font-semibold text-[var(--ink-2)]">{label}</span>
      <span
        className="text-[17px] font-bold tabular-nums"
        style={{ color: accent ?? 'var(--ink)' }}
      >
        {value}
      </span>
    </div>
  );
}

function Bloco({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[14px] border overflow-hidden"
      style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
    >
      {children}
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

async function lerRespostaJson<T>(res: Response): Promise<T> {
  const texto = await res.text();
  let json: unknown = null;

  if (texto) {
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error('O servidor retornou uma resposta inválida.');
    }
  }

  if (!res.ok) {
    const mensagem = json && typeof json === 'object' && 'error' in json
      && typeof (json as { error?: unknown }).error === 'string'
      ? (json as { error: string }).error
      : `Falha na requisição (${res.status}).`;
    throw new Error(mensagem);
  }

  return json as T;
}

function planoComDefaults(mes: string, valor: unknown): CustosData {
  return hidratarPlanoCustos(valor, mes, generateId());
}

export default function CustosPage() {
  const [mes, setMes] = useState(mesAtual());
  const [data, setData] = useState<CustosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveRetry, setSaveRetry] = useState(0);
  const [copying, setCopying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [funis, setFunis] = useState<FunilPayload[]>([]);
  const [funisLoading, setFunisLoading] = useState(true);
  const [funisError, setFunisError] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const funisAbortRef = useRef<AbortController | null>(null);
  const lastPersistedRef = useRef<string | null>(null);
  const currentSnapshotRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTailRef = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async (m: string) => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaving(false);
    try {
      const res = await fetch(`/api/planejamento/custos?mes=${encodeURIComponent(m)}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const json = await lerRespostaJson<unknown>(res);
      const plano = planoComDefaults(m, json);
      lastPersistedRef.current = JSON.stringify(plano);
      setData(plano);
    } catch (error) {
      if (controller.signal.aborted) return;
      setData(null);
      setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar o planejamento.');
    } finally {
      if (loadAbortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(mes);
    return () => loadAbortRef.current?.abort();
  }, [mes, load]);

  const loadFunis = useCallback(async () => {
    funisAbortRef.current?.abort();
    const controller = new AbortController();
    funisAbortRef.current = controller;
    setFunisLoading(true);
    setFunisError(null);
    try {
      const res = await fetch('/api/funis', { cache: 'no-store', signal: controller.signal });
      const json = await lerRespostaJson<unknown>(res);
      if (!Array.isArray(json)) throw new Error('A lista de funis retornada é inválida.');
      setFunis(json as FunilPayload[]);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFunis([]);
      setFunisError(error instanceof Error ? error.message : 'Não foi possível carregar os funis.');
    } finally {
      if (funisAbortRef.current === controller) setFunisLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFunis();
    return () => funisAbortRef.current?.abort();
  }, [loadFunis]);

  const resumoFunis = useMemo(() => resumirFunisAssociaveis(funis), [funis]);

  /**
   * Serializa as gravações. Abortar um fetch não garante que o Postgres tenha
   * cancelado a query; duas gravações concorrentes podiam terminar invertidas
   * e restaurar silenciosamente um valor antigo. A fila mantém a ordem em que
   * o usuário editou e só apresenta o estado da versão que ainda está na tela.
   */
  const persistir = useCallback((snapshot: string): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);

    const executar = async (): Promise<boolean> => {
      try {
        const res = await fetch('/api/planejamento/custos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: snapshot,
        });
        await lerRespostaJson<unknown>(res);
        lastPersistedRef.current = snapshot;
        if (currentSnapshotRef.current === snapshot) {
          setSaving(false);
          setSaveError(null);
        }
        return true;
      } catch (error) {
        if (currentSnapshotRef.current === snapshot) {
          setSaving(false);
          setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar o planejamento.');
        }
        return false;
      }
    };

    const resultado = saveTailRef.current.then(executar, executar);
    saveTailRef.current = resultado.then(() => undefined);
    return resultado;
  }, []);

  useEffect(() => {
    if (!data || loading) return;
    const snapshot = JSON.stringify(data);
    currentSnapshotRef.current = snapshot;
    if (snapshot === lastPersistedRef.current) {
      setSaving(false);
      return;
    }

    setSaving(true);
    setSaveError(null);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistir(snapshot);
    }, 1500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [data, loading, persistir, saveRetry]);

  const trocarMes = useCallback(async (proximoMes: string) => {
    if (!mesPlanejamentoValido(proximoMes) || proximoMes === mes) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const snapshot = data ? JSON.stringify(data) : null;
    if (snapshot && snapshot !== lastPersistedRef.current) {
      currentSnapshotRef.current = snapshot;
      const salvo = await persistir(snapshot);
      if (!salvo) return;
    }
    setMes(proximoMes);
  }, [data, mes, persistir]);

  const copyFromPrev = async () => {
    const [y, m] = mes.split('-').map(Number);
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const prevKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
    setCopying(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/planejamento/custos?mes=${encodeURIComponent(prevKey)}`, {
        cache: 'no-store',
      });
      const json = await lerRespostaJson<unknown>(res);
      if (json === null) throw new Error(`Não há planejamento salvo para ${mesPorExtenso(prevKey)}.`);
      setData({ ...planoComDefaults(mes, json), id: generateId(), mes });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível copiar o mês anterior.');
    } finally {
      setCopying(false);
    }
  };

  const rel = useMemo(() => data ? calcRelatorio(data) : null, [data]);
  const analise = useMemo(() => (data && rel ? analisarPlano(data, rel) : null), [data, rel]);

  const [gerandoPdf, setGerandoPdf] = useState(false);
  const exportarPdf = useCallback(async () => {
    if (!data || !rel || !analise || gerandoPdf) return;
    setGerandoPdf(true);
    try {
      const { gerarPdfPlanejamento } = await import('@/lib/planejamento-pdf');
      await gerarPdfPlanejamento(data, rel, analise);
    } catch (e) {
      console.error('[planejamento] falha ao gerar PDF', e);
      alert('Não foi possível gerar o PDF. Tente novamente.');
    } finally {
      setGerandoPdf(false);
    }
  }, [data, rel, analise, gerandoPdf]);

  const importarCustosFunis = () => {
    if (!data || resumoFunis.count === 0) return;
    setActionError(null);
    setData({ ...data, marketing: aplicarInvestimentoDosFunis(data.marketing, resumoFunis) });
  };

  if (loading) return (
    <div className="p-6">
      <MinimalPageHead title="Planejamento mensal" meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Carregando…</p>} />
      <SkeletonTable rows={5} cols={3} />
    </div>
  );

  if (loadError || !data || !rel) return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <MinimalPageHead title="Planejamento mensal" />
      <div
        role="alert"
        className="mt-5 max-w-xl rounded-[14px] border p-5"
        style={{ borderColor: 'var(--lg-neg)', background: 'var(--lg-neg-fill)' }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--lg-neg)' }} />
          <div>
            <p className="text-[14px] font-semibold text-[var(--ink)]">Não foi possível carregar o planejamento</p>
            <p className="mt-1 text-[12.5px] text-[var(--ink-2)]">{loadError ?? 'Resposta inválida do servidor.'}</p>
            <button
              type="button"
              onClick={() => void load(mes)}
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
              style={{ color: 'var(--lg-neg)' }}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const totalFixo = rel.custoFixoTotal;
  const totalMarketing = rel.marketingTotal;
  const premissasCompletas = !rel.premissasIncompletas;
  const contribuicaoPositiva = rel.lucroPorVenda > 0;
  const viavel = premissasCompletas && contribuicaoPositiva;

  // Composição do custo mensal — mostra pra onde o dinheiro vai antes de
  // qualquer venda acontecer. Estrutura = tudo que não é verba de campanha.
  const baseComposicao = rel.custoFixoMaisMarketing || 1;
  const pctFixo = (totalFixo / baseComposicao) * 100;
  const pctMkt = (totalMarketing / baseComposicao) * 100;

  // Quanto do caminho até a meta já é consumido só para empatar.
  const pctBreakEven = rel.vendasMeta > 0
    ? Math.min(100, (rel.vendasBreakEven / rel.vendasMeta) * 100)
    : 0;

  const alertas: { tom: 'erro' | 'aviso'; texto: string }[] = [];
  if (premissasCompletas && !contribuicaoPositiva) {
    alertas.push({ tom: 'erro', texto: 'A comissão por venda não cobre os custos variáveis. Revise a margem ou os custos antes de definir metas.' });
  }
  // Aquisição: o que decide é o TETO que a margem suporta e o quanto dele já
  // está comprometido. (Comparar custo atual > teto seria código morto: pela
  // álgebra do modelo o custo por lead nunca cruza o teto — ver a nota em
  // planejamento-custos.ts.)
  if (rel.cplTeto > 0 && rel.cplTeto < 15) {
    alertas.push({
      tom: 'erro',
      texto: `A margem só suporta ${formatBRL(rel.cplTeto)} por lead. Nesse patamar a mídia paga fica inviável — o crescimento teria de vir de indicação e carteira, ou é preciso subir o ticket, a comissão ou a conversão.`,
    });
  } else if (rel.usoDoTetoPct >= 85) {
    alertas.push({
      tom: 'aviso',
      texto: `O marketing já consome ${dec(rel.usoDoTetoPct, 0)}% do que a margem suporta por lead. O plano fica dependente de mídia: uma queda na conversão derruba o lucro.`,
    });
  } else if (rel.usoDoTetoPct > 0 && rel.usoDoTetoPct < 40) {
    alertas.push({
      tom: 'aviso',
      texto: `Cada lead custa ${formatBRL(rel.cplAtual)} e a margem suporta até ${formatBRL(rel.cplTeto)} — ${dec(rel.usoDoTetoPct, 0)}% do teto. Há espaço para investir mais em aquisição sem perder rentabilidade.`,
    });
  }
  if (rel.retornoMarketing > 0 && rel.retornoMarketing < 2) {
    alertas.push({ tom: 'aviso', texto: `Cada real em marketing devolve ${dec(rel.retornoMarketing)} de comissão. Abaixo de 2x sobra pouco para cobrir a estrutura.` });
  }
  if (rel.atendimentosPorVendedorDia > 8) {
    alertas.push({ tom: 'aviso', texto: `${rel.atendimentosPorVendedorDia} atendimentos por vendedor ao dia pode comprometer a qualidade. Considere ampliar o time.` });
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <MinimalPageHead
        title="Planejamento mensal"
        meta={
          <p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            {mesPorExtenso(mes)} ·{' '}
            <b
              style={{ color: saveError ? 'var(--lg-neg)' : 'var(--ink-2)', fontWeight: 500 }}
              title={saveError ?? undefined}
            >
              {saving ? 'Salvando…' : saveError ? 'Falha ao salvar' : 'Salvo'}
            </b>
          </p>
        }
        actions={
          <>
            <input
              type="month"
              value={mes}
              onChange={e => void trocarMes(e.target.value)}
              disabled={saving}
              className="h-[34px] px-3 text-[12px] border rounded-[8px] outline-none focus:border-[var(--lg-accent)]"
              style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
            />
            <button
              type="button"
              onClick={() => void copyFromPrev()}
              disabled={copying}
              className="h-[34px] px-3 text-[12px] border rounded-[8px] transition-colors hover:bg-[var(--ink-surface-2)] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
            >
              {copying
                ? <Loader2 className="w-3.5 h-3.5 inline mr-2 -mt-0.5 animate-spin" />
                : <Copy className="w-3.5 h-3.5 inline mr-2 -mt-0.5" />}
              {copying ? 'Copiando…' : 'Copiar do anterior'}
            </button>
            <button
              type="button"
              onClick={() => void exportarPdf()}
              disabled={gerandoPdf}
              className="h-[34px] px-3 text-[12px] rounded-[8px] font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: 'var(--lg-accent)', color: '#fff' }}
              title="Baixar o relatório do mês em PDF"
            >
              {gerandoPdf
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <FileDown className="w-3.5 h-3.5" />}
              {gerandoPdf ? 'Gerando…' : 'Baixar PDF'}
            </button>
          </>
        }
      />

      {(saveError || actionError) && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center gap-3 rounded-[12px] border px-3.5 py-3 text-[12.5px]"
          style={{ borderColor: 'var(--lg-neg)', background: 'var(--lg-neg-fill)', color: 'var(--ink-2)' }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--lg-neg)' }} />
          <span className="flex-1">{saveError ?? actionError}</span>
          {saveError && (
            <button
              type="button"
              onClick={() => setSaveRetry(value => value + 1)}
              className="inline-flex items-center gap-1.5 font-semibold"
              style={{ color: 'var(--lg-neg)' }}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar salvar novamente
            </button>
          )}
          {actionError && !saveError && (
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="font-semibold"
              style={{ color: 'var(--lg-neg)' }}
            >
              Fechar
            </button>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* A RESPOSTA — o que este plano exige do mês                    */}
      {/* ============================================================ */}
      <section
        className="rounded-[16px] border overflow-hidden mb-7"
        style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
      >
        {!premissasCompletas ? (
          <div className="px-6 py-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--lg-warn)' }} />
            <div>
              <p className="text-[15px] font-semibold text-[var(--ink)]">
                Complete as premissas do plano
              </p>
              <p className="text-[13px] text-[var(--ink-2)] mt-1 max-w-[70ch] leading-relaxed">
                {analise?.veredito ?? 'Preencha ticket médio, margem de comissão e taxa de conversão para calcular metas confiáveis.'}
              </p>
            </div>
          </div>
        ) : viavel ? (
          <>
            <div className="px-6 pt-5 pb-4">
              <p className="text-[12.5px] text-[var(--ink-3)]">
                Para lucrar{' '}
                <b className="text-[var(--ink)] font-semibold">{formatBRL(data.lucro_desejado)}</b>{' '}
                em {mesPorExtenso(mes)}, este plano exige
              </p>

              {/* O valor de faturamento é sempre o mais largo — escala com a
                  viewport pra não invadir a coluna vizinha em telas médias. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 mt-4">
                <div className="min-w-0">
                  <p className="text-[clamp(28px,3vw,38px)] leading-none font-bold tabular-nums text-[var(--ink)]">
                    {rel.vendasMeta}
                  </p>
                  <p className="text-[12.5px] text-[var(--ink-2)] mt-1.5">
                    vendas fechadas
                    <span className="text-[var(--ink-3)]"> · {dec(rel.vendasPorDia)} por dia útil</span>
                  </p>
                </div>
                <div className="min-w-0">
                  <p
                    className="text-[clamp(24px,2.6vw,38px)] leading-none font-bold tabular-nums truncate"
                    style={{ color: 'var(--lg-stat-green)' }}
                    title={formatBRL(rel.faturamentoMeta)}
                  >
                    {formatBRL(rel.faturamentoMeta)}
                  </p>
                  <p className="text-[12.5px] text-[var(--ink-2)] mt-1.5">
                    de faturamento
                    <span className="text-[var(--ink-3)]"> · {formatBRL(rel.faturamentoDiario)} por dia</span>
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[clamp(28px,3vw,38px)] leading-none font-bold tabular-nums text-[var(--ink)]">
                    {rel.atendimentosMeta}
                  </p>
                  <p className="text-[12.5px] text-[var(--ink-2)] mt-1.5">
                    leads atendidos
                    <span className="text-[var(--ink-3)]"> · {rel.atendimentosPorDia} por dia</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Quanto do esforço é só para empatar */}
            <div className="px-6 pb-5">
              <div
                className="h-[7px] rounded-full overflow-hidden flex"
                style={{ background: 'var(--ink-surface-2)' }}
                role="img"
                aria-label={`${rel.vendasBreakEven} das ${rel.vendasMeta} vendas cobrem os custos; o restante vira lucro`}
              >
                <div style={{ width: `${pctBreakEven}%`, background: 'var(--lg-stat-amber)' }} />
                <div style={{ width: `${100 - pctBreakEven}%`, background: 'var(--lg-stat-green)' }} />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2.5 text-[11.5px]">
                <span className="inline-flex items-center gap-1.5 text-[var(--ink-2)]">
                  <i className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--lg-stat-amber)' }} />
                  <b className="tabular-nums font-semibold">{rel.vendasBreakEven}</b> vendas cobrem os custos
                  <span className="text-[var(--ink-3)]">({formatBRL(rel.faturamentoBreakEven)})</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[var(--ink-2)]">
                  <i className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--lg-stat-green)' }} />
                  as outras <b className="tabular-nums font-semibold">{Math.max(0, rel.vendasMeta - rel.vendasBreakEven)}</b> viram lucro
                </span>
                <span className="text-[var(--ink-3)] ml-auto" title="Lucro sobre a receita de comissões da agência">
                  Margem sobre a receita <b className="tabular-nums text-[var(--ink-2)]">{dec(rel.margemSobreReceitaPct)}%</b>
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="px-6 py-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--lg-neg)' }} />
            <div>
              <p className="text-[15px] font-semibold text-[var(--ink)]">
                Este plano não fecha
              </p>
              <p className="text-[13px] text-[var(--ink-2)] mt-1 max-w-[70ch] leading-relaxed">
                A comissão de {formatBRL(rel.comissaoPorVenda)} por venda não cobre os{' '}
                {formatBRL(rel.custoVarPorVenda)} de custo variável. Cada venda dá prejuízo de{' '}
                {formatBRL(Math.abs(rel.lucroPorVenda))}, então nenhuma meta de vendas gera lucro.
                Aumente a margem de comissão ou reduza os custos variáveis.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/* PREMISSAS                                                     */}
      {/* ============================================================ */}
      <section className="mb-7">
        <SectionTitle>Premissas do mês</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Premissa label="Ticket médio" hint={`Comissão de ${formatBRL(rel.comissaoPorVenda)}`}>
            <MoneyInput value={data.ticket_medio} onChange={v => setData({ ...data, ticket_medio: v ?? 0 })} />
          </Premissa>

          <Premissa label="Margem comissão" hint={`${data.margem_comissao || 0}% do ticket`}>
            <input type="number" min={0} max={100} step={0.5} value={data.margem_comissao || ''}
              onChange={e => setData({ ...data, margem_comissao: parseFloat(e.target.value) || 0 })}
              className={inputBase} style={inputStyle} />
          </Premissa>

          <Premissa label="Taxa conversão" hint={`${data.taxa_conversao || 0} de cada 100 leads fecham`}>
            <input type="number" min={0} max={100} step={0.5} value={data.taxa_conversao || ''}
              onChange={e => setData({ ...data, taxa_conversao: parseFloat(e.target.value) || 0 })}
              className={inputBase} style={inputStyle} />
          </Premissa>

          <Premissa label="Lucro desejado" hint="Meta do mês">
            <MoneyInput value={data.lucro_desejado} onChange={v => setData({ ...data, lucro_desejado: v ?? 0 })} />
          </Premissa>

          <Premissa label="Dias úteis" hint="Base do ritmo diário">
            <input type="number" min={1} max={31} value={data.dias_uteis || ''}
              onChange={e => setData({ ...data, dias_uteis: parseInt(e.target.value) || 0 })}
              className={inputBase} style={inputStyle} />
          </Premissa>

          <Premissa
            label="Vendedores"
            hint={data.vendedores_ativos > 1 ? `${rel.vendasPorVendedorMes} vendas cada` : 'No time comercial'}
          >
            <input type="number" min={1} max={100} value={data.vendedores_ativos || ''}
              onChange={e => setData({ ...data, vendedores_ativos: parseInt(e.target.value) || 0 })}
              className={inputBase} style={inputStyle} />
          </Premissa>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_396px] gap-6 items-start">
        {/* ========== ESQUERDA: entradas de custo ========== */}
        <div className="space-y-7 min-w-0">

          {/* Custos fixos */}
          <section>
            <SectionTitle
              right={
                <span className="text-[12px] tabular-nums text-[var(--ink-3)]">
                  {formatBRL(totalFixo)} por mês
                </span>
              }
            >
              Custos fixos mensais
            </SectionTitle>
            <Bloco>
              {data.custos_fixos.map((item, i) => {
                const peso = totalFixo > 0 ? (item.valor / totalFixo) * 100 : 0;
                return (
                  <LinhaEntrada key={i} cols="grid-cols-[minmax(150px,1.2fr)_136px_minmax(110px,0.9fr)_minmax(110px,1fr)]">
                    <span className="text-[13.5px] text-[var(--ink)] truncate" title={item.categoria}>{item.categoria}</span>
                    <CampoValor
                      value={item.valor}
                      onChange={v => { const c = [...data.custos_fixos]; c[i] = { ...c[i], valor: v }; setData({ ...data, custos_fixos: c }); }}
                    />
                    <Peso pct={peso} cor="var(--lg-stat-blue)" />
                    <input
                      value={item.observacao}
                      onChange={e => { const c = [...data.custos_fixos]; c[i] = { ...c[i], observacao: e.target.value }; setData({ ...data, custos_fixos: c }); }}
                      placeholder="Observação"
                      className="w-full h-[36px] px-2.5 rounded-[9px] border text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--lg-text-4)] focus:border-[var(--lg-accent)] focus:ring-2 focus:ring-[var(--lg-accent)]/15 hover:border-[var(--line-strong)]"
                      style={inputStyle}
                    />
                  </LinhaEntrada>
                );
              })}
              <TotalLinha label="Total fixo" value={formatBRL(totalFixo)} />
            </Bloco>
          </section>

          {/* Custos variáveis */}
          <section>
            <SectionTitle
              right={
                <span className="text-[12px] tabular-nums text-[var(--ink-3)]">
                  {formatBRL(rel.custoVarPorVenda)} por venda
                </span>
              }
            >
              Custos variáveis por venda
            </SectionTitle>
            <Bloco>
              {data.custos_variaveis.map((item, i) => {
                const valorLinha = (item.base === 'COMISSAO' ? rel.comissaoPorVenda : data.ticket_medio) * (item.percentual || 0) / 100;
                return (
                  <LinhaEntrada key={i} cols="grid-cols-[minmax(120px,1fr)_92px_158px_minmax(90px,0.8fr)]">
                    <span className="text-[13.5px] text-[var(--ink)] truncate" title={item.nome}>{item.nome}</span>
                    <div className="relative">
                      <input
                        type="number" min={0} step={0.5} value={item.percentual || ''}
                        onChange={e => { const c = [...data.custos_variaveis]; c[i] = { ...c[i], percentual: parseFloat(e.target.value) || 0 }; setData({ ...data, custos_variaveis: c }); }}
                        className={`${inputBase} h-[36px] rounded-[9px] pr-6 hover:border-[var(--line-strong)]`} style={inputStyle}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--ink-3)] pointer-events-none">%</span>
                    </div>
                    <select
                      value={item.base || 'VENDA'}
                      onChange={e => { const c = [...data.custos_variaveis]; c[i] = { ...c[i], base: e.target.value as 'VENDA' | 'COMISSAO' }; setData({ ...data, custos_variaveis: c }); }}
                      className="w-full h-[36px] px-2 rounded-[9px] border text-[12.5px] text-[var(--ink-2)] outline-none transition-colors focus:border-[var(--lg-accent)] focus:ring-2 focus:ring-[var(--lg-accent)]/15 hover:border-[var(--line-strong)]"
                      style={inputStyle}
                    >
                      <option value="VENDA">sobre a venda</option>
                      <option value="COMISSAO">sobre a comissão</option>
                    </select>
                    <span className="text-[12.5px] tabular-nums text-right text-[var(--ink-2)] whitespace-nowrap">
                      {formatBRL(valorLinha)}
                    </span>
                  </LinhaEntrada>
                );
              })}
              <TotalLinha
                label="Total variável por venda"
                value={formatBRL(rel.custoVarPorVenda)}
              />
              <div
                className="flex items-baseline justify-between gap-4 px-4 py-3 border-t"
                style={{ borderColor: 'var(--line)' }}
              >
                <span className="text-[12.5px] font-semibold text-[var(--ink-2)]">
                  Sobra por venda
                  <span className="font-normal text-[var(--ink-3)]"> (comissão − custos)</span>
                </span>
                <span
                  className="text-[17px] font-bold tabular-nums"
                  style={{ color: contribuicaoPositiva ? 'var(--lg-stat-green)' : 'var(--lg-neg)' }}
                >
                  {formatBRL(rel.lucroPorVenda)}
                </span>
              </div>
            </Bloco>
          </section>

          {/* Marketing */}
          <section>
            <SectionTitle
              right={
                funisLoading ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-3)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando funis…
                  </span>
                ) : funisError ? (
                  <button
                    type="button"
                    onClick={() => void loadFunis()}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold"
                    style={{ color: 'var(--lg-neg)' }}
                    title={funisError}
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Recarregar funis
                  </button>
                ) : resumoFunis.count > 0 ? (
                  <button
                    type="button"
                    onClick={importarCustosFunis}
                    className="inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[8px] border text-[12px] font-medium transition-colors hover:bg-[var(--t-green-bg)]"
                    style={{ borderColor: 'var(--t-green)', color: 'var(--t-green)' }}
                    title={`Copia o investimento de ${resumoFunis.count} funil(is) simulado(s) ou em execução, agrupado por canal`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Importar simulados/ativos
                  </button>
                ) : (
                  <span className="text-[12px] tabular-nums text-[var(--ink-3)]">
                    {formatBRL(totalMarketing)} por mês
                  </span>
                )
              }
            >
              Investimento em marketing
            </SectionTitle>
            <Bloco>
              {!funisLoading && !funisError && resumoFunis.count === 0 && (
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 text-[12px]"
                  style={{ borderColor: 'var(--line)', background: 'var(--ink-surface-2)', color: 'var(--ink-3)' }}
                >
                  <span className="flex-1">Nenhum funil simulado ou em execução para importar. Rascunhos ficam de fora.</span>
                  <Link
                    href="/planejamento/funis"
                    className="inline-flex items-center gap-1 font-semibold"
                    style={{ color: 'var(--t-green)' }}
                  >
                    Simular um funil <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}
              {data.marketing.map((item, i) => {
                const share = totalMarketing > 0 ? (item.valor / totalMarketing) * 100 : 0;
                return (
                  <LinhaEntrada key={i} cols="grid-cols-[minmax(150px,1.2fr)_136px_minmax(120px,1.9fr)]">
                    <span className="text-[13.5px] text-[var(--ink)] truncate">{item.canal}</span>
                    <CampoValor
                      value={item.valor}
                      onChange={v => { const c = [...data.marketing]; c[i] = { ...c[i], valor: v }; setData({ ...data, marketing: c }); }}
                    />
                    {/* Participação do canal no total — leitura rápida de onde o dinheiro está */}
                    <Peso pct={share} cor="var(--lg-stat-violet)" />
                  </LinhaEntrada>
                );
              })}
              <TotalLinha label="Total marketing" value={formatBRL(totalMarketing)} />
            </Bloco>
          </section>
        </div>

        {/* ========== DIREITA: leitura do plano ========== */}
        <div className="lg:sticky lg:top-4 space-y-4 min-w-0">

          {/* Composição do custo mensal */}
          <div
            className="rounded-[14px] border p-4"
            style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
          >
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <span className="text-[12.5px] font-semibold text-[var(--ink-2)]">Custo do mês</span>
              <span className="text-[15px] font-bold tabular-nums text-[var(--ink)]">
                {formatBRL(rel.custoFixoMaisMarketing)}
              </span>
            </div>
            <div className="h-[7px] rounded-full overflow-hidden flex" style={{ background: 'var(--ink-surface-2)' }}>
              <div style={{ width: `${pctFixo}%`, background: 'var(--lg-stat-blue)' }} />
              <div style={{ width: `${pctMkt}%`, background: 'var(--lg-stat-violet)' }} />
            </div>
            <div className="flex items-center gap-4 mt-2.5 text-[11.5px] text-[var(--ink-2)]">
              <span className="inline-flex items-center gap-1.5">
                <i className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--lg-stat-blue)' }} />
                Fixos <b className="tabular-nums">{formatBRL(totalFixo)}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--lg-stat-violet)' }} />
                Marketing <b className="tabular-nums">{formatBRL(totalMarketing)}</b>
              </span>
            </div>
          </div>

          {/* Funis aptos para associação */}
          {resumoFunis.count > 0 && (
            <div
              className="rounded-[14px] border overflow-hidden"
              style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
            >
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'var(--t-green-bg)' }}>
                <FunilIcon className="w-3.5 h-3.5" style={{ color: 'var(--t-green)' }} />
                <span className="text-[12.5px] font-semibold text-[var(--ink)]">Funis prontos para importar</span>
                <span className="ml-auto text-[12px] font-semibold tabular-nums" style={{ color: 'var(--t-green)' }}>
                  {resumoFunis.count}
                </span>
              </div>
              <div className="px-4 py-2.5">
                {resumoFunis.simulados > 0 && (
                  <Linha label="Simulados" value={`${resumoFunis.simulados}`} />
                )}
                {resumoFunis.emExecucao > 0 && (
                  <Linha label="Em execução" value={`${resumoFunis.emExecucao}`} />
                )}
                <Linha label="Investimento projetado" value={formatBRL(resumoFunis.investimentoTotal)} />
                <Linha label="Volume de vendas projetado" value={formatBRL(resumoFunis.volumeVendasProjetado)} forte />
                <p className="px-4 pt-1 text-[11.5px] leading-relaxed text-[var(--ink-3)]">
                  A importação copia os valores por canal para este mês. Funis em rascunho não entram.
                </p>
                <Link
                  href="/planejamento/funis"
                  className="flex items-center justify-center gap-1 mt-1.5 py-1.5 text-[12.5px] rounded-[8px] transition-colors hover:bg-[var(--ink-surface-2)]"
                  style={{ color: 'var(--t-green)' }}
                >
                  Ver funis <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}

          {/* Detalhamento */}
          <div
            className="rounded-[14px] border overflow-hidden"
            style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
          >
            <div className="px-4 py-3">
              <span className="text-[12.5px] font-semibold text-[var(--ink)]">Detalhamento do plano</span>
            </div>

            <GrupoLinhas titulo="Por venda">
              <Linha label="Comissão recebida" value={formatBRL(rel.comissaoPorVenda)} />
              <Linha label="Custo variável" value={`− ${formatBRL(rel.custoVarPorVenda)}`} />
              <Linha label="Sobra por venda" value={formatBRL(rel.lucroPorVenda)} forte alerta={!contribuicaoPositiva} />
              <Linha label="Margem de contribuição" value={`${dec(rel.margemContribuicaoPct)}%`} />
            </GrupoLinhas>

            <GrupoLinhas titulo="Ponto de equilíbrio">
              <Linha label="Vendas para cobrir custos" value={`${rel.vendasBreakEven}`} forte />
              <Linha label="Volume a intermediar" value={formatBRL(rel.faturamentoBreakEven)} />
              <Linha label="Receita de comissões" value={formatBRL(rel.receitaBreakEven)} />
            </GrupoLinhas>

            <GrupoLinhas titulo={`Meta de ${formatBRL(data.lucro_desejado)}`}>
              <Linha label="Vendas necessárias" value={`${rel.vendasMeta}`} forte />
              <Linha label="Faturamento necessário" value={formatBRL(rel.faturamentoMeta)} />
              <Linha label="Receita de comissões" value={formatBRL(rel.receitaMeta)} forte />
              <Linha label="Lucro projetado" value={formatBRL(rel.lucroProjetado)} />
              <Linha label="Margem sobre a receita" value={`${dec(rel.margemSobreReceitaPct)}%`} />
            </GrupoLinhas>

            <GrupoLinhas titulo={`Ritmo · ${data.dias_uteis} dias úteis`}>
              <Linha label="Faturamento por dia" value={formatBRL(rel.faturamentoDiario)} />
              <Linha label="Vendas por dia" value={dec(rel.vendasPorDia)} />
              {data.vendedores_ativos > 1 && (
                <>
                  <Linha label={`Vendas por vendedor (${data.vendedores_ativos})`} value={`${rel.vendasPorVendedorMes}`} />
                  <Linha
                    label="Atendimentos por vendedor/dia"
                    value={`${rel.atendimentosPorVendedorDia}`}
                    alerta={rel.atendimentosPorVendedorDia > 8}
                  />
                </>
              )}
            </GrupoLinhas>

            <GrupoLinhas titulo={`Aquisição · conversão de ${data.taxa_conversao}%`}>
              <Linha label="Leads necessários" value={`${rel.atendimentosMeta}`} forte />
              <Linha label="Atendimentos por dia" value={`${rel.atendimentosPorDia}`} />
              <Linha label="Custo atual por lead" value={rel.cplAtual > 0 ? formatBRL(rel.cplAtual) : '—'} alerta={rel.cplTeto > 0 && rel.cplAtual > rel.cplTeto} />
              <Linha label="Teto que a margem suporta" value={formatBRL(rel.cplTeto)} forte />
              <Linha
                label="Capacidade de aquisição usada"
                value={rel.usoDoTetoPct > 0 ? `${dec(rel.usoDoTetoPct, 0)}%` : '—'}
                alerta={rel.usoDoTetoPct >= 85}
              />
              <Linha label="Comissão por real em marketing" value={rel.retornoMarketing > 0 ? `${dec(rel.retornoMarketing)}x` : '—'} alerta={rel.retornoMarketing > 0 && rel.retornoMarketing < 2} />
            </GrupoLinhas>
          </div>

          {/* Pontos de atenção */}
          {alertas.length > 0 && (
            <div className="space-y-2">
              {alertas.map((a, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3"
                  style={{
                    borderColor: a.tom === 'erro' ? 'var(--lg-neg)' : 'var(--line)',
                    background: a.tom === 'erro' ? 'var(--lg-neg-fill)' : 'var(--lg-warn-fill)',
                  }}
                >
                  <AlertTriangle
                    className="w-4 h-4 mt-[1px] shrink-0"
                    style={{ color: a.tom === 'erro' ? 'var(--lg-neg)' : 'var(--lg-warn)' }}
                  />
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--lg-text-2)' }}>
                    {a.texto}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <MinimalFooter pageId="planejamento mensal" />
    </div>
  );
}
