'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowRightLeft, CheckCircle, ChevronDown, ChevronLeft, ChevronRight,
  Download, Edit3, Eye, FileText, Filter, History, Loader2, LogIn, LogOut, Plus,
  RefreshCw, Search, Send, ShieldCheck, ShieldX, Trash2, X, XCircle, type LucideIcon,
} from 'lucide-react';
import { PageShell } from '@/components/PageShell';
import { Button } from '@/components/ui/button';
import type { LogAuditoria } from '@/lib/crm-types';

type AuditEntry = Omit<LogAuditoria, 'acao'> & {
  acao: string;
  origem?: string;
  rota?: string;
  metodo?: string;
  request_id?: string;
};

interface AuditResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: {
    modulos: string[];
    acoes: string[];
    usuarios: { id: string; nome: string }[];
    origens: string[];
  };
  coverage: { startedAt: string | null; tables: number };
}

interface Filters {
  q: string;
  modulo: string;
  acao: string;
  usuario: string;
  origem: string;
  inicio: string;
  fim: string;
  page: number;
}

interface Result {
  key: string;
  query: string;
  data: AuditResponse | null;
  error: string | null;
  status: number;
  updatedAt: Date | null;
}

const INITIAL_FILTERS: Filters = {
  q: '', modulo: '', acao: '', usuario: '', origem: '', inicio: '', fim: '', page: 1,
};
const PANEL = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';
const FIELD = 'h-11 w-full min-w-0 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-sm text-[var(--fin-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--fin-accent-ring)] focus-visible:border-[var(--fin-accent)]';
const BUTTON = 'h-11 gap-2 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-4 text-[var(--fin-text-2)] shadow-none hover:bg-[var(--fin-surface-2)]';
const MUTED = 'text-[var(--fin-text-3)]';
const ACTIONS: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  CRIAR: { label: 'Criação', icon: Plus, color: 'text-[var(--fin-positive)]' },
  EDITAR: { label: 'Alteração', icon: Edit3, color: 'text-[var(--fin-info)]' },
  EXCLUIR: { label: 'Exclusão', icon: Trash2, color: 'text-[var(--fin-negative-text)]' },
  VISUALIZAR: { label: 'Visualização', icon: Eye, color: MUTED },
  EXPORTAR: { label: 'Exportação', icon: Download, color: 'text-[var(--fin-accent)]' },
  ENVIAR: { label: 'Envio', icon: Send, color: 'text-[var(--fin-info)]' },
  CONVERTER: { label: 'Conversão', icon: ArrowRightLeft, color: 'text-[var(--fin-warning-text)]' },
  CANCELAR: { label: 'Cancelamento', icon: XCircle, color: 'text-[var(--fin-negative-text)]' },
  CONFIRMAR: { label: 'Confirmação', icon: CheckCircle, color: 'text-[var(--fin-positive)]' },
  LOGIN: { label: 'Entrada no sistema', icon: LogIn, color: 'text-[var(--fin-positive)]' },
  LOGOUT: { label: 'Saída do sistema', icon: LogOut, color: MUTED },
  LOGIN_FALHOU: { label: 'Falha no acesso', icon: ShieldX, color: 'text-[var(--fin-negative-text)]' },
  IMPERSONAR: { label: 'Início de acesso de suporte', icon: ShieldCheck, color: 'text-[var(--fin-warning-text)]' },
  ENCERRAR_IMPERSONACAO: { label: 'Fim do acesso de suporte', icon: ShieldCheck, color: MUTED },
};

function humanize(value: string) {
  const text = value.replace(/[_-]+/g, ' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Não informado';
}

function originLabel(value: string) {
  const labels: Record<string, string> = {
    USUARIO: 'Usuário', SISTEMA: 'Sistema', INTEGRACAO: 'Integração', PUBLICO: 'Acesso público',
  };
  return labels[value.toUpperCase()] ?? humanize(value);
}

function dateTime(value: string | Date, withZone = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    ...(withZone ? { timeZoneName: 'short' as const } : {}),
  });
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(vazio)';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : fallback;
}

function AuditEvent({ entry }: { entry: AuditEntry }) {
  const config = ACTIONS[entry.acao] ?? { label: humanize(entry.acao), icon: FileText, color: MUTED };
  const Icon = config.icon;
  const changes = Array.isArray(entry.alteracoes) ? entry.alteracoes : [];

  return (
    <article className="min-w-0 p-4 sm:p-6">
      <div className="flex items-start gap-3 sm:gap-4">
        <div aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] ${config.color}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between xl:gap-6">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={`text-sm font-semibold ${config.color}`}>{config.label}</span>
              {entry.modulo && <span className="rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)] px-2 py-1 text-xs text-[var(--fin-text-2)] break-words">{humanize(entry.modulo)}</span>}
              {entry.origem && <span className="text-xs text-[var(--fin-text-3)]">{originLabel(entry.origem)}</span>}
            </div>
            <time dateTime={entry.timestamp} title={dateTime(entry.timestamp, true)} className="shrink-0 text-xs leading-6 text-[var(--fin-text-3)] tabular-nums">
              {dateTime(entry.timestamp)}
            </time>
          </div>
          <div className="space-y-1">
            <p className="text-sm leading-6 text-[var(--fin-text)] [overflow-wrap:anywhere]">{entry.descricao || `${config.label} em ${entry.entidade || 'registro do sistema'}`}</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-[var(--fin-text-3)]">
              <span className="font-medium text-[var(--fin-text-2)] [overflow-wrap:anywhere]">{entry.usuario_nome || 'Sistema'}</span>
              {entry.perfil && <span>· {humanize(entry.perfil)}</span>}
              {entry.entidade && <span>· {humanize(entry.entidade)}</span>}
            </p>
          </div>
          <details className="group min-w-0">
            <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-[var(--fin-r-sm)] text-sm font-medium text-[var(--fin-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
              {changes.length > 0 ? `Ver detalhes · ${changes.length} ${changes.length === 1 ? 'campo alterado' : 'campos alterados'}` : 'Ver detalhes do registro'}
            </summary>
            <div className="mt-2 space-y-5 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-bg)] p-3 sm:p-4">
              <dl className="grid min-w-0 gap-4 text-xs sm:grid-cols-2">
                {[
                  ['Data e hora', dateTime(entry.timestamp, true)],
                  ['Usuário', `${entry.usuario_nome || 'Sistema'}${entry.usuario_id ? ` · ${entry.usuario_id}` : ''}`],
                  ['ID do registro', entry.entidade_id],
                  ['ID da auditoria', entry.id],
                  ['Origem', entry.origem ? originLabel(entry.origem) : 'Não informada'],
                  ['Operação', [entry.metodo, entry.rota].filter(Boolean).join(' ')],
                  ['Referência da operação', entry.request_id],
                ].filter(([, value]) => value).map(([label, value]) => (
                  <div key={label} className="min-w-0 space-y-1">
                    <dt className="text-[var(--fin-text-3)]">{label}</dt>
                    <dd className="whitespace-pre-wrap leading-5 text-[var(--fin-text-2)] [overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
              </dl>
              {changes.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--fin-text)]">O que mudou</h3>
                  {changes.map((change, index) => (
                    <div key={`${change.campo}-${index}`} className="min-w-0 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-3 sm:p-4">
                      <p className="mb-3 text-xs font-semibold text-[var(--fin-text)] [overflow-wrap:anywhere]">{humanize(change.campo)}</p>
                      <div className="grid min-w-0 gap-4 md:grid-cols-2">
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-medium text-[var(--fin-text-3)]">Antes</p>
                          <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-[var(--fin-text-2)] [overflow-wrap:anywhere]">{displayValue(change.valor_anterior)}</pre>
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-medium text-[var(--fin-positive)]">Depois</p>
                          <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-[var(--fin-text)] [overflow-wrap:anywhere]">{displayValue(change.valor_novo)}</pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs leading-5 text-[var(--fin-text-3)]">Este evento não possui comparação de campos.</p>}
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

export default function AuditoriaPage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [refresh, setRefresh] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const exportController = useRef<AbortController | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters(current => current.q === search.trim() ? current : { ...current, q: search.trim(), page: 1 });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const invalidDates = Boolean(filters.inicio && filters.fim && filters.inicio > filters.fim);
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(filters.page), pageSize: '50' });
    for (const key of ['q', 'modulo', 'acao', 'usuario', 'origem'] as const) {
      if (filters[key]) params.set(key, filters[key]);
    }
    // Date inputs are local calendar days, so include the full day in the user's timezone.
    if (filters.inicio) {
      const date = new Date(`${filters.inicio}T00:00:00.000`);
      if (!Number.isNaN(date.getTime())) params.set('inicio', date.toISOString());
    }
    if (filters.fim) {
      const date = new Date(`${filters.fim}T23:59:59.999`);
      if (!Number.isNaN(date.getTime())) params.set('fim', date.toISOString());
    }
    return params.toString();
  }, [filters]);
  const requestKey = `${query}&refresh=${refresh}`;
  const loading = !invalidDates && result?.key !== requestKey;
  const restricted = result?.status === 401 || result?.status === 403;
  const data = !restricted && result?.query === query ? result.data : null;
  const error = result?.key === requestKey ? result.error : null;
  const facets = result?.data?.facets;
  const hasFilters = Object.entries(filters).some(([key, value]) => key !== 'page' && Boolean(value)) || Boolean(search);

  useEffect(() => {
    if (invalidDates) return;
    const controller = new AbortController();
    inFlight.current = true;

    async function load() {
      try {
        const response = await fetch(`/api/audit-log?${query}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          const message = await responseError(response, 'Não foi possível carregar a auditoria. Tente novamente.');
          if (controller.signal.aborted) return;
          setResult(previous => ({
            key: requestKey, query,
            data: response.status === 401 || response.status === 403 ? null : previous?.query === query ? previous.data : null,
            error: message, status: response.status, updatedAt: previous?.updatedAt ?? null,
          }));
          return;
        }
        const body: AuditResponse = await response.json();
        if (!Array.isArray(body.items) || !Number.isFinite(body.total)) throw new Error('Resposta inválida');
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, query, data: body, error: null, status: response.status, updatedAt: new Date() });
        }
      } catch {
        if (controller.signal.aborted) return;
        setResult(previous => ({
          key: requestKey, query, data: previous?.query === query ? previous.data : null,
          error: 'Não foi possível carregar a auditoria. Verifique sua conexão e tente novamente.',
          status: 0, updatedAt: previous?.updatedAt ?? null,
        }));
      } finally {
        if (!controller.signal.aborted) inFlight.current = false;
      }
    }

    void load();
    return () => { controller.abort(); inFlight.current = false; };
  }, [query, requestKey, invalidDates]);

  useEffect(() => {
    if (!autoRefresh || restricted || invalidDates) return;
    const update = () => {
      if (document.visibilityState === 'visible' && !inFlight.current) setRefresh(value => value + 1);
    };
    const interval = window.setInterval(update, 45_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [autoRefresh, restricted, invalidDates]);

  useEffect(() => () => exportController.current?.abort(), []);

  function changeFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters(current => ({ ...current, [key]: value, page: 1 }));
    setExportError(null);
  }

  function clearFilters() {
    setSearch('');
    setFilters(INITIAL_FILTERS);
    setExportError(null);
  }

  async function handleExport() {
    if (exporting || invalidDates || restricted) return;
    setExporting(true);
    setExportError(null);
    const controller = new AbortController();
    exportController.current = controller;
    try {
      const params = new URLSearchParams(query);
      params.set('format', 'csv');
      params.delete('page');
      params.delete('pageSize');
      const response = await fetch(`/api/audit-log?${params}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok || response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(await responseError(response, 'Não foi possível exportar. Tente novamente ou reduza o período.'));
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (cause) {
      if (!controller.signal.aborted) setExportError(cause instanceof Error ? cause.message : 'Não foi possível exportar a auditoria.');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }

  return (
    <PageShell width="default" padding="sm" gap="md" className="min-w-0 pb-8 sm:px-2 sm:pt-2">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="flex items-center gap-3 text-xl font-semibold text-[var(--fin-text)]">
            <ShieldCheck aria-hidden="true" className="size-6 shrink-0 text-[var(--fin-accent)]" />
            Auditoria do sistema
          </h1>
          <p className="text-sm leading-6 text-[var(--fin-text-3)]">Acompanhe quem fez cada ação e confira os detalhes das alterações.</p>
        </div>
        {!restricted && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className={BUTTON} disabled={loading || invalidDates} onClick={() => setRefresh(value => value + 1)}>
              <RefreshCw aria-hidden="true" className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
            <Button type="button" variant="outline" className={BUTTON} disabled={exporting || loading || invalidDates || !data?.total || search.trim() !== filters.q} onClick={handleExport}>
              {exporting ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Download aria-hidden="true" className="size-4" />}
              {exporting ? 'Exportando…' : 'Exportar CSV'}
            </Button>
          </div>
        )}
      </header>

      {restricted ? (
        <section className={`${PANEL} flex flex-col items-center gap-3 px-6 py-16 text-center`}>
          <ShieldX aria-hidden="true" className="size-10 text-[var(--fin-text-3)]" />
          <h2 className="text-base font-semibold text-[var(--fin-text)]">{result?.status === 401 ? 'Sua sessão expirou' : 'Acesso restrito'}</h2>
          <p className="max-w-md text-sm leading-6 text-[var(--fin-text-3)]">{result?.status === 401 ? 'Entre novamente para consultar os registros de auditoria.' : 'A auditoria está disponível apenas para administradores da agência.'}</p>
          {result?.status === 401 ? <a href="/login" className="mt-2 text-sm font-medium text-[var(--fin-accent)] underline">Entrar novamente</a> : null}
        </section>
      ) : (
        <>
          {result?.data?.coverage && (
            <aside className="flex items-start gap-3 rounded-[var(--fin-r-lg)] bg-[var(--fin-accent-soft)] p-4 text-[var(--fin-text-2)]">
              <History aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--fin-accent)]" />
              <div className="min-w-0 space-y-1 text-xs leading-5">
                <p className="font-medium text-[var(--fin-text)]">{result.data.coverage.startedAt ? `Registro automático de alterações ativo desde ${dateTime(result.data.coverage.startedAt, true)}.` : 'O registro automático de alterações ainda não foi ativado.'}</p>
                <p>O histórico anterior à ativação pode estar incompleto. Os horários são exibidos no fuso do seu dispositivo.</p>
              </div>
            </aside>
          )}

          <section aria-labelledby="audit-filters" className={`${PANEL} space-y-5 p-4 sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="audit-filters" className="flex items-center gap-2 text-sm font-semibold text-[var(--fin-text)]"><Filter aria-hidden="true" className="size-4" /> Filtrar histórico</h2>
              {hasFilters && <button type="button" onClick={clearFilters} className="flex min-h-11 items-center gap-1.5 rounded text-xs font-medium text-[var(--fin-accent)] focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)]"><X aria-hidden="true" className="size-4" /> Limpar filtros</button>}
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-[var(--fin-text-2)] sm:col-span-2">
                Buscar no histórico
                <span className="relative">
                  <Search aria-hidden="true" className="absolute top-3.5 left-3 size-4 text-[var(--fin-text-3)]" />
                  <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Descrição, usuário, entidade ou ID…" className={`${FIELD} pl-10`} />
                </span>
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-[var(--fin-text-2)]">
                Data inicial
                <input type="date" value={filters.inicio} max={filters.fim || undefined} onChange={event => changeFilter('inicio', event.target.value)} aria-invalid={invalidDates} aria-describedby={invalidDates ? 'audit-date-error' : undefined} className={FIELD} />
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-[var(--fin-text-2)]">
                Data final
                <input type="date" value={filters.fim} min={filters.inicio || undefined} onChange={event => changeFilter('fim', event.target.value)} aria-invalid={invalidDates} aria-describedby={invalidDates ? 'audit-date-error' : undefined} className={FIELD} />
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-[var(--fin-text-2)]">
                Usuário
                <select value={filters.usuario} onChange={event => changeFilter('usuario', event.target.value)} className={FIELD}>
                  <option value="">Todos os usuários</option>
                  {(facets?.usuarios ?? []).map(user => <option key={user.id} value={user.id}>{user.nome || 'Sistema'}</option>)}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-[var(--fin-text-2)]">
                Módulo
                <select value={filters.modulo} onChange={event => changeFilter('modulo', event.target.value)} className={FIELD}>
                  <option value="">Todos os módulos</option>
                  {(facets?.modulos ?? []).map(module => <option key={module} value={module}>{humanize(module)}</option>)}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-[var(--fin-text-2)]">
                Ação
                <select value={filters.acao} onChange={event => changeFilter('acao', event.target.value)} className={FIELD}>
                  <option value="">Todas as ações</option>
                  {Array.from(new Set([...Object.keys(ACTIONS), ...(facets?.acoes ?? [])])).map(action => <option key={action} value={action}>{ACTIONS[action]?.label ?? humanize(action)}</option>)}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-[var(--fin-text-2)]">
                Origem
                <select value={filters.origem} onChange={event => changeFilter('origem', event.target.value)} className={FIELD}>
                  <option value="">Todas as origens</option>
                  {(facets?.origens ?? []).map(origin => <option key={origin} value={origin}>{originLabel(origin)}</option>)}
                </select>
              </label>
            </div>
            {invalidDates && <p id="audit-date-error" role="alert" className="text-sm text-[var(--fin-negative-text)]">A data final deve ser igual ou posterior à data inicial.</p>}
          </section>

          {exportError && <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-4 text-sm text-[var(--fin-negative-text)]">{exportError}</p>}
          <section aria-labelledby="audit-history" aria-busy={loading} className={`${PANEL} min-w-0 overflow-hidden`}>
            <div className="flex flex-col gap-4 border-b border-[var(--fin-border)] p-4 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <h2 id="audit-history" className="text-base font-semibold text-[var(--fin-text)]">Histórico de atividades</h2>
                <p aria-live="polite" className="text-xs leading-5 text-[var(--fin-text-3)]">{data && !invalidDates ? `${data.total.toLocaleString('pt-BR')} ${data.total === 1 ? 'registro encontrado' : 'registros encontrados'}${hasFilters ? ' com os filtros aplicados' : ''}` : 'Consulte os eventos registrados no sistema.'}</p>
              </div>
              <div className="flex flex-col gap-1 lg:items-end">
                <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-[var(--fin-text-2)]">
                  <input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} className="size-4 accent-[var(--fin-accent)]" />
                  Atualizar automaticamente a cada 45 s
                </label>
                {result?.updatedAt && <p className="text-xs text-[var(--fin-text-3)]">{loading ? 'Atualizando…' : `Última atualização: ${dateTime(result.updatedAt)}`}</p>}
              </div>
            </div>
            {error && <div role="alert" className="m-4 flex flex-wrap items-center gap-3 rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-4 text-sm text-[var(--fin-negative-text)]"><AlertCircle aria-hidden="true" className="size-5 shrink-0" /><p className="min-w-0 flex-1">{error}{data ? ' Os registros abaixo são da última atualização bem-sucedida.' : ''}</p><Button type="button" variant="outline" className={BUTTON} onClick={() => setRefresh(value => value + 1)}>Tentar novamente</Button></div>}
            {invalidDates ? (
              <p className="px-6 py-12 text-center text-sm text-[var(--fin-text-3)]">Ajuste o período para consultar o histórico.</p>
            ) : !data && loading ? (
              <div role="status" className="flex items-center justify-center gap-3 px-6 py-16 text-sm text-[var(--fin-text-3)]"><Loader2 aria-hidden="true" className="size-5 animate-spin" /> Carregando histórico…</div>
            ) : data?.items.length ? (
              <div className="divide-y divide-[var(--fin-border)]">{data.items.map(entry => <AuditEvent key={entry.id} entry={entry} />)}</div>
            ) : data ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <Search aria-hidden="true" className="size-9 text-[var(--fin-text-3)]" />
                <h3 className="text-sm font-semibold text-[var(--fin-text)]">{hasFilters ? 'Nenhum evento corresponde aos filtros' : 'Nenhum evento registrado ainda'}</h3>
                <p className="max-w-md text-sm leading-6 text-[var(--fin-text-3)]">{hasFilters ? 'Tente outro período, remova um filtro ou altere a busca.' : 'As novas atividades aparecerão aqui conforme forem registradas.'}</p>
                {hasFilters && <Button type="button" variant="outline" className={BUTTON} onClick={clearFilters}>Limpar filtros</Button>}
              </div>
            ) : null}
            {data && data.total > 0 && !invalidDates && (
              <nav aria-label="Paginação do histórico" className="flex flex-col gap-4 border-t border-[var(--fin-border)] p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-xs leading-5 text-[var(--fin-text-3)]">Mostrando {((data.page - 1) * data.pageSize + 1).toLocaleString('pt-BR')}–{Math.min(data.page * data.pageSize, data.total).toLocaleString('pt-BR')} de {data.total.toLocaleString('pt-BR')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" disabled={loading || data.page <= 1} onClick={() => setFilters(current => ({ ...current, page: data.page - 1 }))} className={BUTTON}><ChevronLeft aria-hidden="true" className="size-4" /> Anterior</Button>
                  <span className="px-1 text-xs text-[var(--fin-text-3)]">{data.page} de {Math.max(data.totalPages, 1)}</span>
                  <Button type="button" variant="outline" disabled={loading || data.page >= data.totalPages} onClick={() => setFilters(current => ({ ...current, page: data.page + 1 }))} className={BUTTON}>Próxima <ChevronRight aria-hidden="true" className="size-4" /></Button>
                </div>
              </nav>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
