'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  Eye,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Settings2,
  ThumbsUp,
  UserPlus,
  UserX,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  PREFERENCIAS_NOTIFICACOES_PADRAO,
  TIPOS_NOTIFICACAO,
  type PreferenciasNotificacoes,
} from '@/lib/notificacoes-config';

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  link: string;
  lida: boolean;
  created_at: string;
}

interface PanelPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface ListPage {
  items: Notificacao[];
  unread: number;
  page: number;
  totalPages: number | null;
  hasMore: boolean;
}

type ActivityFilter = 'all' | 'unread';
type PanelTab = 'activities' | 'preferences';
type ListMode = 'replace' | 'append' | 'refresh';
type LoadingKind = 'initial' | 'more' | 'refresh';

interface RetryRequest {
  pages: number[];
  mode: ListMode;
  loadingKind: LoadingKind;
}

interface ItemFailure {
  message: string;
  lida: boolean;
  openAfterSuccess: boolean;
}

const CONFIGURED_TYPES = TIPOS_NOTIFICACAO.map(item => item.tipo);
const CONFIGURED_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  TIPOS_NOTIFICACAO.map(item => [item.tipo, item.label]),
);
const CONFIGURED_DESCRIPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  TIPOS_NOTIFICACAO.map(item => [item.tipo, item.descricao]),
);

const PAGE_SIZE = 20;
const POLL_INTERVAL_MS = 60_000;

const ICON_FOR_TIPO: Record<string, typeof Bell> = {
  PROPOSTA_ACEITA: ThumbsUp,
  PROPOSTA_FEEDBACK: MessageSquare,
  PROPOSTA_VISUALIZADA: Eye,
  PROPOSTA_LEAD: UserPlus,
  VENDA_VENDEDOR_NAO_CADASTRADO: UserX,
};

const COLOR_FOR_TIPO: Record<string, string> = {
  PROPOSTA_ACEITA: 'text-emerald-500 bg-emerald-500/10',
  PROPOSTA_FEEDBACK: 'text-blue-500 bg-blue-500/10',
  PROPOSTA_VISUALIZADA: 'text-violet-500 bg-violet-500/10',
  PROPOSTA_LEAD: 'text-amber-500 bg-amber-500/10',
  VENDA_VENDEDOR_NAO_CADASTRADO: 'text-red-500 bg-red-500/10',
};

function createDefaultPreferences(): PreferenciasNotificacoes {
  return {
    tipos: { ...PREFERENCIAS_NOTIFICACOES_PADRAO.tipos },
    mostrar_contador: PREFERENCIAS_NOTIFICACOES_PADRAO.mostrar_contador,
    atualizacao_automatica: PREFERENCIAS_NOTIFICACOES_PADRAO.atualizacao_automatica,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatTipo(tipo: string): string {
  if (CONFIGURED_LABELS[tipo]) return CONFIGURED_LABELS[tipo];
  return tipo
    .toLocaleLowerCase('pt-BR')
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1))
    .join(' ');
}

function formatRelative(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 'data indisponível';

  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatFullDate(iso: string): string | undefined {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safeLocalLink(link: string): string | null {
  const value = link.trim();
  if (
    !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001F\u007F]/.test(value)
  ) return null;
  return value;
}

async function requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const raw = await response.text();
  let payload: unknown = {};

  if (!raw) {
    throw new Error(response.ok
      ? 'O servidor retornou uma resposta vazia.'
      : `Não foi possível concluir a operação (${response.status}).`);
  } else {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(response.ok
        ? 'O servidor retornou uma resposta inválida.'
        : `Não foi possível concluir a operação (${response.status}).`);
    }
  }

  const record = isRecord(payload) ? payload : {};
  if (!response.ok) {
    const message = typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : `Não foi possível concluir a operação (${response.status}).`;
    throw new Error(message);
  }
  return record;
}

function normalizeNotification(value: unknown): Notificacao | null {
  if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')) return null;
  return {
    id: String(value.id),
    tipo: typeof value.tipo === 'string' ? value.tipo : 'OUTRA',
    titulo: typeof value.titulo === 'string' ? value.titulo : 'Notificação',
    descricao: typeof value.descricao === 'string' ? value.descricao : '',
    link: typeof value.link === 'string' ? value.link : '',
    lida: value.lida === true,
    created_at: typeof value.created_at === 'string' ? value.created_at : '',
  };
}

function normalizeListPage(payload: Record<string, unknown>, requestedPage: number): ListPage {
  if (!Array.isArray(payload.items)) {
    throw new Error('O servidor retornou uma lista de notificações inválida.');
  }
  const pagination = isRecord(payload.pagination)
    ? payload.pagination
    : isRecord(payload.meta)
      ? payload.meta
      : {};
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.notificacoes)
      ? payload.notificacoes
      : [];
  const items = rawItems.map(normalizeNotification).filter((item): item is Notificacao => Boolean(item));
  if (items.length !== rawItems.length) {
    throw new Error('O servidor retornou uma notificação inválida.');
  }
  const unreadValue = finiteNumber(payload.unread ?? payload.nao_lidas);
  if (unreadValue === null || unreadValue < 0) {
    throw new Error('O servidor retornou um contador de notificações inválido.');
  }
  const page = Math.max(1, finiteNumber(pagination.page ?? payload.page) ?? requestedPage);
  const totalPagesValue = finiteNumber(
    pagination.totalPages
    ?? pagination.total_pages
    ?? payload.totalPages
    ?? payload.total_pages,
  );
  const totalPages = totalPagesValue === null ? null : Math.max(1, totalPagesValue);
  const explicitHasMore = pagination.hasMore
    ?? pagination.has_more
    ?? payload.hasMore
    ?? payload.has_more;
  const hasMore = typeof explicitHasMore === 'boolean'
    ? explicitHasMore
    : totalPages !== null
      ? page < totalPages
      : items.length === PAGE_SIZE;

  return {
    items,
    unread: Math.max(0, unreadValue),
    page,
    totalPages,
    hasMore,
  };
}

function normalizePreferences(
  payload: Record<string, unknown>,
  fallback: PreferenciasNotificacoes,
): PreferenciasNotificacoes {
  const raw = isRecord(payload.preferences)
    ? payload.preferences
    : isRecord(payload.preferencias)
      ? payload.preferencias
      : payload;
  const rawTipos = raw.tipos;
  const tipos: Record<string, boolean> = { ...fallback.tipos };

  if (
    !isRecord(rawTipos)
    || typeof raw.mostrar_contador !== 'boolean'
    || typeof raw.atualizacao_automatica !== 'boolean'
  ) {
    throw new Error('O servidor retornou preferências inválidas.');
  }

  for (const tipo of CONFIGURED_TYPES) {
    if (typeof rawTipos[tipo] !== 'boolean') {
      throw new Error('O servidor retornou preferências inválidas.');
    }
    tipos[tipo] = rawTipos[tipo];
  }

  return {
    tipos,
    mostrar_contador: typeof raw.mostrar_contador === 'boolean'
      ? raw.mostrar_contador
      : fallback.mostrar_contador,
    atualizacao_automatica: typeof raw.atualizacao_automatica === 'boolean'
      ? raw.atualizacao_automatica
      : fallback.atualizacao_automatica,
  };
}

function deduplicate(items: Notificacao[]): Notificacao[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function preferenceSignature(preferences: PreferenciasNotificacoes): string {
  return JSON.stringify({
    tipos: Object.entries(preferences.tipos).sort(([left], [right]) => left.localeCompare(right)),
    mostrar_contador: preferences.mostrar_contador,
    atualizacao_automatica: preferences.atualizacao_automatica,
  });
}

export function NotificacoesBell() {
  const router = useRouter();
  const { user } = useAuth();
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const activitiesTabId = `${panelId}-activities-tab`;
  const activitiesPanelId = `${panelId}-activities-panel`;
  const preferencesTabId = `${panelId}-preferences-tab`;
  const preferencesPanelId = `${panelId}-preferences-panel`;
  const userKey = user
    ? `${user.id}:${user.tenantId ?? ''}:${user.impersonatingTenantId ?? ''}`
    : '';

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('activities');
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [items, setItems] = useState<Notificacao[]>([]);
  const [unread, setUnread] = useState(0);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loadedPage, setLoadedPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [itemErrors, setItemErrors] = useState<Record<string, ItemFailure>>({});
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<PreferenciasNotificacoes>(createDefaultPreferences);
  const [preferenceDraft, setPreferenceDraft] = useState<PreferenciasNotificacoes>(createDefaultPreferences);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [preferencesErrorKind, setPreferencesErrorKind] = useState<'load' | 'save' | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activitiesTabRef = useRef<HTMLButtonElement>(null);
  const preferencesTabRef = useRef<HTMLButtonElement>(null);
  const didFocusPanelRef = useRef(false);
  const activeUserKeyRef = useRef(userKey);
  const itemsRef = useRef(items);
  const loadedPageRef = useRef(loadedPage);
  const listAbortRef = useRef<AbortController | null>(null);
  const listRequestIdRef = useRef(0);
  const listLoadedForUserRef = useRef(false);
  const mutationEpochRef = useRef(0);
  const preferenceLoadAbortRef = useRef<AbortController | null>(null);
  const preferenceSaveAbortRef = useRef<AbortController | null>(null);
  const markAllAbortRef = useRef<AbortController | null>(null);
  const itemAbortRefs = useRef<Map<string, AbortController>>(new Map());

  itemsRef.current = items;
  loadedPageRef.current = loadedPage;

  const availableTypes = useMemo(
    () => Array.from(new Set([...CONFIGURED_TYPES, ...items.map(item => item.tipo)])),
    [items],
  );
  const preferencesDirty = useMemo(
    () => preferenceSignature(preferenceDraft) !== preferenceSignature(preferences),
    [preferenceDraft, preferences],
  );

  const closePanel = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setPanelPosition(null);
    didFocusPanelRef.current = false;
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const viewportLeft = window.visualViewport?.offsetLeft ?? 0;
    const gutter = 12;
    const gap = 8;
    const width = Math.max(0, Math.min(400, viewportWidth - gutter * 2));
    const preferredLeft = rect.right - width;
    const left = Math.min(
      viewportLeft + viewportWidth - width - gutter,
      Math.max(viewportLeft + gutter, preferredLeft),
    );
    const spaceBelow = viewportTop + viewportHeight - rect.bottom - gap - gutter;
    const spaceAbove = rect.top - viewportTop - gap - gutter;
    const placeAbove = spaceBelow < 300 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(0, placeAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(620, availableHeight);
    const top = placeAbove
      ? Math.max(viewportTop + gutter, rect.top - gap - maxHeight)
      : rect.bottom + gap;
    const next = { top, left, width, maxHeight };

    setPanelPosition(previous => (
      previous
      && previous.top === next.top
      && previous.left === next.left
      && previous.width === next.width
      && previous.maxHeight === next.maxHeight
        ? previous
        : next
    ));
  }, []);

  const prepareFilterChange = useCallback(() => {
    listRequestIdRef.current += 1;
    listAbortRef.current?.abort();
    listLoadedForUserRef.current = false;
    setItems([]);
    itemsRef.current = [];
    setLoadedPage(1);
    loadedPageRef.current = 1;
    setHasMore(false);
    setInitialLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
    setListError(null);
    setRetryRequest(null);
    setItemErrors({});
    setMarkAllError(null);
  }, []);

  const fetchNotificationPages = useCallback(async (
    pages: number[],
    mode: ListMode,
    loadingKind: LoadingKind,
  ) => {
    if (!userKey || pages.length === 0) return;

    const requestUserKey = userKey;
    const requestId = ++listRequestIdRef.current;
    const startMutationEpoch = mutationEpochRef.current;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;

    if (loadingKind === 'initial') setInitialLoading(true);
    if (loadingKind === 'more') setLoadingMore(true);
    if (loadingKind === 'refresh') setRefreshing(true);

    try {
      const results = await Promise.all(pages.map(async requestedPage => {
        const params = new URLSearchParams({
          page: String(requestedPage),
          limit: String(PAGE_SIZE),
        });
        if (activityFilter === 'unread') params.set('unread', '1');
        if (typeFilter !== 'all') params.set('tipo', typeFilter);
        const payload = await requestJson(`/api/notificacoes?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        return normalizeListPage(payload, requestedPage);
      }));

      if (
        controller.signal.aborted
        || requestId !== listRequestIdRef.current
        || requestUserKey !== activeUserKeyRef.current
        || startMutationEpoch !== mutationEpochRef.current
      ) return;

      const matchesCurrentFilters = (item: Notificacao) => (
        (activityFilter === 'all' || !item.lida)
        && (typeFilter === 'all' || item.tipo === typeFilter)
      );
      const receivedItems = deduplicate(results.flatMap(result => result.items))
        .filter(matchesCurrentFilters);
      const newestPage = results[0];
      const lastPage = results.at(-1) ?? newestPage;
      let nextPage = Math.max(...results.map(result => result.page));
      if (lastPage.totalPages !== null) nextPage = Math.min(nextPage, lastPage.totalPages);

      setItems(previous => {
        const next = mode === 'append'
          ? deduplicate([...previous, ...receivedItems])
          : receivedItems;
        itemsRef.current = next;
        return next;
      });
      setUnread(newestPage.unread);
      setLoadedPage(nextPage);
      loadedPageRef.current = nextPage;
      setHasMore(lastPage.hasMore);
      setListError(null);
      setRetryRequest(null);
      listLoadedForUserRef.current = true;
    } catch (error) {
      if (isAbortError(error)) return;
      if (requestId !== listRequestIdRef.current || requestUserKey !== activeUserKeyRef.current) return;
      setListError(error instanceof Error ? error.message : 'Não foi possível carregar as notificações.');
      setRetryRequest({ pages, mode, loadingKind });
    } finally {
      if (requestId === listRequestIdRef.current) {
        setInitialLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [activityFilter, typeFilter, userKey]);

  const refreshCurrentPages = useCallback(() => {
    const pageCount = Math.max(1, loadedPageRef.current);
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
    return fetchNotificationPages(pages, 'refresh', 'refresh');
  }, [fetchNotificationPages]);

  const fetchPreferences = useCallback(async () => {
    if (!userKey) return;
    const requestUserKey = userKey;
    preferenceLoadAbortRef.current?.abort();
    const controller = new AbortController();
    preferenceLoadAbortRef.current = controller;
    setPreferencesLoading(true);
    setPreferencesError(null);
    setPreferencesErrorKind(null);

    try {
      const payload = await requestJson('/api/notificacoes/preferencias', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestUserKey !== activeUserKeyRef.current) return;
      const next = normalizePreferences(payload, createDefaultPreferences());
      setPreferences(next);
      setPreferenceDraft(next);
      setPreferencesLoaded(true);
    } catch (error) {
      if (isAbortError(error) || requestUserKey !== activeUserKeyRef.current) return;
      setPreferencesError(error instanceof Error ? error.message : 'Não foi possível carregar as preferências.');
      setPreferencesErrorKind('load');
    } finally {
      if (!controller.signal.aborted && requestUserKey === activeUserKeyRef.current) {
        setPreferencesLoading(false);
      }
    }
  }, [userKey]);

  const persistReadState = useCallback(async (
    notification: Notificacao,
    lida: boolean,
    openAfterSuccess = false,
  ) => {
    if (!userKey) return false;
    const requestUserKey = userKey;
    itemAbortRefs.current.get(notification.id)?.abort();
    const controller = new AbortController();
    itemAbortRefs.current.set(notification.id, controller);
    setPendingIds(previous => new Set(previous).add(notification.id));
    setItemErrors(previous => {
      const next = { ...previous };
      delete next[notification.id];
      return next;
    });

    try {
      const payload = await requestJson(`/api/notificacoes/${encodeURIComponent(notification.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lida }),
        signal: controller.signal,
      });
      if (payload.ok !== true) throw new Error('O servidor não confirmou a atualização.');
      if (controller.signal.aborted || requestUserKey !== activeUserKeyRef.current) return false;

      const currentItem = itemsRef.current.find(item => item.id === notification.id);
      const wasRead = currentItem?.lida ?? notification.lida;
      mutationEpochRef.current += 1;
      setItems(previous => {
        const next = activityFilter === 'unread' && lida
          ? previous.filter(item => item.id !== notification.id)
          : previous.map(item => item.id === notification.id ? { ...item, lida } : item);
        itemsRef.current = next;
        return next;
      });
      const serverUnread = finiteNumber(payload.unread ?? payload.nao_lidas);
      setUnread(current => serverUnread === null
        ? Math.max(0, current + (wasRead === lida ? 0 : lida ? -1 : 1))
        : Math.max(0, serverUnread));
      // No filtro de não lidas, remover uma linha desloca a
      // paginação do servidor. Recarregar evita pular o próximo item.
      if (activityFilter === 'unread' && lida && !openAfterSuccess) {
        void refreshCurrentPages();
      }
      return true;
    } catch (error) {
      if (isAbortError(error) || requestUserKey !== activeUserKeyRef.current) return false;
      setItemErrors(previous => ({
        ...previous,
        [notification.id]: {
          message: error instanceof Error ? error.message : 'Não foi possível atualizar esta notificação.',
          lida,
          openAfterSuccess,
        },
      }));
      return false;
    } finally {
      if (itemAbortRefs.current.get(notification.id) === controller) {
        itemAbortRefs.current.delete(notification.id);
        setPendingIds(previous => {
          const next = new Set(previous);
          next.delete(notification.id);
          return next;
        });
      }
    }
  }, [activityFilter, refreshCurrentPages, userKey]);

  const openNotification = useCallback(async (notification: Notificacao) => {
    const destination = safeLocalLink(notification.link);
    if (!destination) return;
    const success = await persistReadState(notification, true, true);
    if (!success) return;
    closePanel(false);
    router.push(destination);
  }, [closePanel, persistReadState, router]);

  const markAllAsRead = useCallback(async () => {
    if (!userKey || markingAll || pendingIds.size > 0) return;
    const requestUserKey = userKey;
    markAllAbortRef.current?.abort();
    const controller = new AbortController();
    markAllAbortRef.current = controller;
    setMarkingAll(true);
    setMarkAllError(null);

    try {
      const payload = await requestJson('/api/notificacoes/marcar-lidas', {
        method: 'POST',
        signal: controller.signal,
      });
      if (payload.ok !== true) throw new Error('O servidor não confirmou a atualização.');
      if (controller.signal.aborted || requestUserKey !== activeUserKeyRef.current) return;

      mutationEpochRef.current += 1;
      setItems(previous => {
        const next = activityFilter === 'unread'
          ? []
          : previous.map(item => ({ ...item, lida: true }));
        itemsRef.current = next;
        return next;
      });
      const serverUnread = finiteNumber(payload.unread ?? payload.nao_lidas);
      setUnread(Math.max(0, serverUnread ?? 0));
    } catch (error) {
      if (isAbortError(error) || requestUserKey !== activeUserKeyRef.current) return;
      setMarkAllError(error instanceof Error ? error.message : 'Não foi possível marcar todas como lidas.');
    } finally {
      if (markAllAbortRef.current === controller) setMarkingAll(false);
    }
  }, [activityFilter, markingAll, pendingIds.size, userKey]);

  const savePreferences = useCallback(async () => {
    if (!userKey || preferencesSaving || !preferencesDirty) return;
    const requestUserKey = userKey;
    const draft = {
      ...preferenceDraft,
      tipos: { ...preferenceDraft.tipos },
    };
    preferenceSaveAbortRef.current?.abort();
    const controller = new AbortController();
    preferenceSaveAbortRef.current = controller;
    setPreferencesSaving(true);
    setPreferencesError(null);
    setPreferencesErrorKind(null);

    try {
      const payload = await requestJson('/api/notificacoes/preferencias', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestUserKey !== activeUserKeyRef.current) return;
      const saved = normalizePreferences(payload, draft);
      setPreferences(saved);
      setPreferenceDraft(saved);
      void refreshCurrentPages();
    } catch (error) {
      if (isAbortError(error) || requestUserKey !== activeUserKeyRef.current) return;
      setPreferencesError(error instanceof Error ? error.message : 'Não foi possível salvar as preferências.');
      setPreferencesErrorKind('save');
    } finally {
      if (!controller.signal.aborted && requestUserKey === activeUserKeyRef.current) {
        setPreferencesSaving(false);
      }
    }
  }, [preferenceDraft, preferencesDirty, preferencesSaving, refreshCurrentPages, userKey]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    activeUserKeyRef.current = userKey;
    listRequestIdRef.current += 1;
    listLoadedForUserRef.current = false;
    mutationEpochRef.current += 1;
    listAbortRef.current?.abort();
    preferenceLoadAbortRef.current?.abort();
    preferenceSaveAbortRef.current?.abort();
    markAllAbortRef.current?.abort();
    itemAbortRefs.current.forEach(controller => controller.abort());
    itemAbortRefs.current.clear();

    setOpen(false);
    setActiveTab('activities');
    setPanelPosition(null);
    setItems([]);
    itemsRef.current = [];
    setUnread(0);
    setActivityFilter('all');
    setTypeFilter('all');
    setLoadedPage(1);
    loadedPageRef.current = 1;
    setHasMore(false);
    setInitialLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
    setListError(null);
    setRetryRequest(null);
    setPendingIds(new Set());
    setItemErrors({});
    setMarkingAll(false);
    setMarkAllError(null);
    const defaults = createDefaultPreferences();
    setPreferences(defaults);
    setPreferenceDraft(defaults);
    setPreferencesLoading(false);
    setPreferencesLoaded(false);
    setPreferencesSaving(false);
    setPreferencesError(null);
    setPreferencesErrorKind(null);
  }, [userKey]);

  useEffect(() => {
    if (!userKey) return;
    if (document.visibilityState !== 'visible') {
      listLoadedForUserRef.current = false;
      return;
    }
    void fetchNotificationPages([1], 'replace', 'initial');
  }, [fetchNotificationPages, userKey]);

  useEffect(() => {
    if (!userKey) return;
    const loadWhenFirstVisible = () => {
      if (document.visibilityState === 'visible' && !listLoadedForUserRef.current) {
        void fetchNotificationPages([1], 'replace', 'initial');
      }
    };
    document.addEventListener('visibilitychange', loadWhenFirstVisible);
    return () => document.removeEventListener('visibilitychange', loadWhenFirstVisible);
  }, [fetchNotificationPages, userKey]);

  useEffect(() => {
    if (!userKey) return;
    void fetchPreferences();
  }, [fetchPreferences, userKey]);

  useEffect(() => {
    if (!userKey || !preferencesLoaded || !preferences.atualizacao_automatica) return;

    const poll = () => {
      if (
        document.visibilityState === 'visible'
        && pendingIds.size === 0
        && !markingAll
        && !initialLoading
        && !loadingMore
        && !refreshing
      ) {
        void refreshCurrentPages();
      }
    };
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    markingAll,
    initialLoading,
    loadingMore,
    pendingIds.size,
    preferences.atualizacao_automatica,
    preferencesLoaded,
    refreshing,
    refreshCurrentPages,
    userKey,
  ]);

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();
    let frame = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePanelPosition);
    };
    const viewport = window.visualViewport;
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleUpdate);
    if (triggerRef.current) resizeObserver?.observe(triggerRef.current);
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    viewport?.addEventListener('resize', scheduleUpdate);
    viewport?.addEventListener('scroll', scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      viewport?.removeEventListener('resize', scheduleUpdate);
      viewport?.removeEventListener('scroll', scheduleUpdate);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        closePanel(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closePanel, open]);

  useEffect(() => {
    if (!open || !panelPosition || didFocusPanelRef.current) return;
    didFocusPanelRef.current = true;
    requestAnimationFrame(() => {
      (activeTab === 'activities' ? activitiesTabRef.current : preferencesTabRef.current)?.focus();
    });
  }, [activeTab, open, panelPosition]);

  useEffect(() => () => {
    listAbortRef.current?.abort();
    preferenceLoadAbortRef.current?.abort();
    preferenceSaveAbortRef.current?.abort();
    markAllAbortRef.current?.abort();
    itemAbortRefs.current.forEach(controller => controller.abort());
  }, []);

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextTab: PanelTab | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextTab = activeTab === 'activities' ? 'preferences' : 'activities';
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextTab = activeTab === 'activities' ? 'preferences' : 'activities';
    } else if (event.key === 'Home') {
      nextTab = 'activities';
    } else if (event.key === 'End') {
      nextTab = 'preferences';
    }
    if (!nextTab) return;
    event.preventDefault();
    setActiveTab(nextTab);
    requestAnimationFrame(() => {
      (nextTab === 'activities' ? activitiesTabRef.current : preferencesTabRef.current)?.focus();
    });
  };

  const retryList = () => {
    if (retryRequest) {
      void fetchNotificationPages(retryRequest.pages, retryRequest.mode, retryRequest.loadingKind);
    } else {
      void refreshCurrentPages();
    }
  };

  const panel = open && panelPosition ? (
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed z-[100] flex flex-col overflow-hidden rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] dropdown-enter"
      style={{
        top: panelPosition.top,
        left: panelPosition.left,
        width: panelPosition.width,
        maxHeight: panelPosition.maxHeight,
        boxShadow: 'var(--elevation-4)',
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--t-border)] px-4 py-3">
        <div className="min-w-0">
          <p id={titleId} className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">
            Notificações
          </p>
          <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]" aria-live="polite">
            {unread > 0 ? `${unread} não lida${unread === 1 ? '' : 's'}` : 'Tudo em dia'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refreshCurrentPages()}
            disabled={refreshing || initialLoading}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--t-text-muted)] transition-colors hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] disabled:opacity-50"
            aria-label="Atualizar notificações"
            title="Atualizar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllAsRead()}
              disabled={markingAll || pendingIds.size > 0}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-[var(--t-text-secondary)] transition-colors hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] disabled:opacity-50"
            >
              {markingAll
                ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                : <CheckCheck className="h-3 w-3" aria-hidden="true" />}
              Marcar todas
            </button>
          )}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 border-b border-[var(--t-border)] px-2 pt-1" role="tablist" aria-label="Seções de notificações">
        <button
          ref={activitiesTabRef}
          id={activitiesTabId}
          type="button"
          role="tab"
          aria-selected={activeTab === 'activities'}
          aria-controls={activitiesPanelId}
          tabIndex={activeTab === 'activities' ? 0 : -1}
          onClick={() => setActiveTab('activities')}
          onKeyDown={handleTabKeyDown}
          className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'activities'
              ? 'border-[var(--t-green)] text-[var(--t-text)]'
              : 'border-transparent text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
          }`}
        >
          Atividades
        </button>
        <button
          ref={preferencesTabRef}
          id={preferencesTabId}
          type="button"
          role="tab"
          aria-selected={activeTab === 'preferences'}
          aria-controls={preferencesPanelId}
          tabIndex={activeTab === 'preferences' ? 0 : -1}
          onClick={() => setActiveTab('preferences')}
          onKeyDown={handleTabKeyDown}
          className={`flex items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'preferences'
              ? 'border-[var(--t-green)] text-[var(--t-text)]'
              : 'border-transparent text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
          }`}
        >
          <Settings2 className="h-3 w-3" aria-hidden="true" />
          Preferências
          {preferencesDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="Alterações não salvas" />}
        </button>
      </div>

      {activeTab === 'activities' ? (
        <div
          id={activitiesPanelId}
          role="tabpanel"
          aria-labelledby={activitiesTabId}
          tabIndex={0}
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--t-border)]/70 px-3 py-2">
            <div className="flex rounded-lg bg-[var(--t-surface-hover)] p-0.5" aria-label="Filtrar por leitura">
              <button
                type="button"
                aria-pressed={activityFilter === 'all'}
                disabled={markingAll || pendingIds.size > 0}
                onClick={() => {
                  if (activityFilter === 'all') return;
                  prepareFilterChange();
                  setActivityFilter('all');
                }}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  activityFilter === 'all'
                    ? 'bg-[var(--t-surface)] text-[var(--t-text)] shadow-sm'
                    : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                aria-pressed={activityFilter === 'unread'}
                disabled={markingAll || pendingIds.size > 0}
                onClick={() => {
                  if (activityFilter === 'unread') return;
                  prepareFilterChange();
                  setActivityFilter('unread');
                }}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  activityFilter === 'unread'
                    ? 'bg-[var(--t-surface)] text-[var(--t-text)] shadow-sm'
                    : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
                }`}
              >
                Não lidas
              </button>
            </div>
            <label className="relative ml-auto min-w-0 flex-1">
              <span className="sr-only">Filtrar por tipo</span>
              <select
                value={typeFilter}
                disabled={markingAll || pendingIds.size > 0}
                onChange={event => {
                  prepareFilterChange();
                  setTypeFilter(event.target.value);
                }}
                className="h-7 w-full appearance-none truncate rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] py-1 pl-2 pr-7 text-[11px] text-[var(--t-text-secondary)] outline-none focus:border-[var(--t-green)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="all">Todos os tipos</option>
                {availableTypes.map(tipo => (
                  <option key={tipo} value={tipo}>{formatTipo(tipo)}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2 h-3 w-3 text-[var(--t-text-muted)]" aria-hidden="true" />
            </label>
          </div>

          {markAllError && (
            <div className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2" role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
              <p className="flex-1 text-[11px] text-red-600 dark:text-red-400">{markAllError}</p>
              <button type="button" onClick={() => void markAllAsRead()} className="text-[11px] font-semibold text-red-600 underline dark:text-red-400">
                Tentar novamente
              </button>
            </div>
          )}

          {listError && items.length > 0 && (
            <div className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2" role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="flex-1 text-[11px] text-[var(--t-text-secondary)]">{listError}</p>
              <button type="button" onClick={retryList} className="text-[11px] font-semibold text-[var(--t-text)] underline">
                Tentar novamente
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {initialLoading && items.length === 0 ? (
              <div className="space-y-1 p-3" aria-label="Carregando notificações" aria-busy="true">
                {[0, 1, 2].map(index => (
                  <div key={index} className="flex animate-pulse items-start gap-3 rounded-xl px-1 py-3">
                    <div className="h-9 w-9 shrink-0 rounded-xl bg-[var(--t-surface-hover)]" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-3 w-2/3 rounded bg-[var(--t-surface-hover)]" />
                      <div className="h-2.5 w-full rounded bg-[var(--t-surface-hover)]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : listError && items.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center px-7 py-10 text-center" role="alert">
                <AlertCircle className="mb-2 h-8 w-8 text-red-500/70" aria-hidden="true" />
                <p className="text-sm font-medium text-[var(--t-text)]">Não foi possível carregar</p>
                <p className="mt-1 text-[11px] text-[var(--t-text-muted)]">{listError}</p>
                <button
                  type="button"
                  onClick={retryList}
                  className="mt-4 rounded-lg bg-[var(--t-green)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Tentar novamente
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center px-7 py-10 text-center">
                <Inbox className="mb-2 h-8 w-8 text-[var(--t-text-muted)] opacity-40" aria-hidden="true" />
                <p className="text-sm font-medium text-[var(--t-text)]">
                  {activityFilter === 'unread' ? 'Nenhuma notificação não lida' : 'Nenhuma notificação'}
                </p>
                <p className="mt-1 text-[11px] text-[var(--t-text-muted)]">
                  {typeFilter === 'all'
                    ? 'Novidades importantes do sistema aparecerão aqui.'
                    : `Não há atividades do tipo “${formatTipo(typeFilter)}”.`}
                </p>
              </div>
            ) : (
              <div role="list" aria-label="Notificações">
                {items.map(notification => {
                  const Icon = ICON_FOR_TIPO[notification.tipo] ?? Bell;
                  const colorClass = COLOR_FOR_TIPO[notification.tipo] ?? 'text-slate-500 bg-slate-500/10';
                  const destination = safeLocalLink(notification.link);
                  const pending = pendingIds.has(notification.id);
                  const itemError = itemErrors[notification.id];
                  const fullDate = formatFullDate(notification.created_at);

                  const content = (
                    <>
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${colorClass}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <p className={`min-w-0 flex-1 text-left text-[var(--text-body-sm)] leading-tight ${
                            notification.lida
                              ? 'text-[var(--t-text-secondary)]'
                              : 'font-semibold text-[var(--t-text)]'
                          }`}
                          >
                            {notification.titulo}
                          </p>
                          {!notification.lida && (
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--t-green)]" aria-label="Não lida" />
                          )}
                        </div>
                        {notification.descricao && (
                          <p className="mt-0.5 line-clamp-2 text-left text-[11px] text-[var(--t-text-muted)]">
                            {notification.descricao}
                          </p>
                        )}
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--t-text-muted)]">
                          <time dateTime={notification.created_at} title={fullDate}>{formatRelative(notification.created_at)}</time>
                          <span aria-hidden="true">·</span>
                          <span>{formatTipo(notification.tipo)}</span>
                        </div>
                      </div>
                    </>
                  );

                  return (
                    <div
                      key={notification.id}
                      role="listitem"
                      className={`border-b border-[var(--t-border)]/50 last:border-b-0 ${notification.lida ? '' : 'bg-[var(--t-green)]/5'}`}
                    >
                      <div className="flex items-start gap-1 px-3 py-3">
                        {destination ? (
                          <button
                            type="button"
                            onClick={() => void openNotification(notification)}
                            disabled={pending || markingAll}
                            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none transition-colors hover:bg-[var(--t-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--t-green)] disabled:opacity-60"
                            aria-label={`Abrir: ${notification.titulo}`}
                          >
                            {content}
                          </button>
                        ) : (
                          <div className="flex min-w-0 flex-1 items-start gap-3">{content}</div>
                        )}
                        <button
                          type="button"
                          onClick={() => void persistReadState(notification, !notification.lida)}
                          disabled={pending || markingAll}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--t-text-muted)] transition-colors hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-green)] disabled:opacity-50"
                          aria-label={notification.lida ? 'Marcar como não lida' : 'Marcar como lida'}
                          title={notification.lida ? 'Marcar como não lida' : 'Marcar como lida'}
                        >
                          {pending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            : notification.lida
                              ? <Circle className="h-3.5 w-3.5" aria-hidden="true" />
                              : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                      </div>
                      {itemError && (
                        <div className="flex items-center gap-2 px-4 pb-2 text-[10px] text-red-600 dark:text-red-400" role="alert">
                          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1">{itemError.message}</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (itemError.openAfterSuccess) {
                                void openNotification(notification);
                              } else {
                                void persistReadState(notification, itemError.lida);
                              }
                            }}
                            className="font-semibold underline"
                          >
                            Tentar novamente
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {(hasMore || loadingMore) && (
                  <div className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => void fetchNotificationPages([loadedPage + 1], 'append', 'more')}
                      disabled={loadingMore}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--t-border)] px-3 py-1.5 text-xs font-medium text-[var(--t-text-secondary)] transition-colors hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] disabled:opacity-50"
                    >
                      {loadingMore && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                      {loadingMore ? 'Carregando…' : 'Carregar mais'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          id={preferencesPanelId}
          role="tabpanel"
          aria-labelledby={preferencesTabId}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 outline-none"
        >
          {preferencesLoading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-xs text-[var(--t-text-muted)]" aria-busy="true">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando preferências…
            </div>
          ) : preferencesErrorKind === 'load' && !preferencesLoaded ? (
            <div className="flex min-h-52 flex-col items-center justify-center px-5 text-center" role="alert">
              <AlertCircle className="mb-2 h-8 w-8 text-red-500/70" aria-hidden="true" />
              <p className="text-sm font-medium text-[var(--t-text)]">Preferências indisponíveis</p>
              <p className="mt-1 text-[11px] text-[var(--t-text-muted)]">{preferencesError}</p>
              <button
                type="button"
                onClick={() => void fetchPreferences()}
                className="mt-4 rounded-lg bg-[var(--t-green)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {preferencesError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2" role="alert">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-red-600 dark:text-red-400">{preferencesError}</p>
                    <button
                      type="button"
                      onClick={() => preferencesErrorKind === 'load' ? void fetchPreferences() : void savePreferences()}
                      className="mt-1 text-[11px] font-semibold text-red-600 underline dark:text-red-400"
                    >
                      Tentar novamente
                    </button>
                  </div>
                </div>
              )}

              <fieldset>
                <legend className="text-xs font-semibold text-[var(--t-text)]">Tipos de notificação</legend>
                <p className="mt-0.5 text-[11px] text-[var(--t-text-muted)]">Escolha quais eventos devem aparecer para você.</p>
                <div className="mt-3 space-y-1">
                  {CONFIGURED_TYPES.map(tipo => {
                    const Icon = ICON_FOR_TIPO[tipo] ?? Bell;
                    const enabled = preferenceDraft.tipos[tipo] !== false;
                    return (
                      <label key={tipo} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--t-surface-hover)]">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${COLOR_FOR_TIPO[tipo] ?? 'text-slate-500 bg-slate-500/10'}`}>
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-[var(--t-text-secondary)]">{formatTipo(tipo)}</span>
                          <span className="mt-0.5 block text-[10px] leading-snug text-[var(--t-text-muted)]">
                            {CONFIGURED_DESCRIPTIONS[tipo]}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={preferencesSaving}
                          onChange={event => {
                            const checked = event.target.checked;
                            setPreferenceDraft(current => ({
                              ...current,
                              tipos: { ...current.tipos, [tipo]: checked },
                            }));
                          }}
                          className="peer sr-only"
                        />
                        <span className={`relative h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--t-green)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--t-surface)] peer-disabled:opacity-50 ${enabled ? 'bg-[var(--t-green)]' : 'bg-[var(--t-border)]'}`}>
                          <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : ''}`} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="border-t border-[var(--t-border)] pt-4">
                <legend className="sr-only">Comportamento</legend>
                <div className="space-y-1">
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--t-surface-hover)]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                      <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-[var(--t-text)]">Mostrar contador</span>
                      <span className="block text-[10px] text-[var(--t-text-muted)]">Exibe o total de não lidas sobre o sino.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferenceDraft.mostrar_contador}
                      disabled={preferencesSaving}
                      onChange={event => setPreferenceDraft(current => ({ ...current, mostrar_contador: event.target.checked }))}
                      className="peer sr-only"
                    />
                    <span className={`relative h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--t-green)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--t-surface)] peer-disabled:opacity-50 ${preferenceDraft.mostrar_contador ? 'bg-[var(--t-green)]' : 'bg-[var(--t-border)]'}`}>
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${preferenceDraft.mostrar_contador ? 'translate-x-4' : ''}`} />
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--t-surface-hover)]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-[var(--t-text)]">Atualização automática</span>
                      <span className="block text-[10px] text-[var(--t-text-muted)]">Busca novidades a cada minuto enquanto a página estiver visível.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferenceDraft.atualizacao_automatica}
                      disabled={preferencesSaving}
                      onChange={event => setPreferenceDraft(current => ({ ...current, atualizacao_automatica: event.target.checked }))}
                      className="peer sr-only"
                    />
                    <span className={`relative h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--t-green)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--t-surface)] peer-disabled:opacity-50 ${preferenceDraft.atualizacao_automatica ? 'bg-[var(--t-green)]' : 'bg-[var(--t-border)]'}`}>
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${preferenceDraft.atualizacao_automatica ? 'translate-x-4' : ''}`} />
                    </span>
                  </label>
                </div>
              </fieldset>

              <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[var(--t-border)] bg-[var(--t-surface)] pt-3">
                {preferencesDirty && (
                  <button
                    type="button"
                    onClick={() => setPreferenceDraft({ ...preferences, tipos: { ...preferences.tipos } })}
                    disabled={preferencesSaving}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] disabled:opacity-50"
                  >
                    Descartar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void savePreferences()}
                  disabled={!preferencesDirty || preferencesSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--t-green)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {preferencesSaving
                    ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    : <Save className="h-3 w-3" aria-hidden="true" />}
                  {preferencesSaving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!userKey) return;
          if (open) {
            closePanel(true);
          } else {
            didFocusPanelRef.current = false;
            updatePanelPosition();
            setOpen(true);
            if (document.visibilityState === 'visible') void refreshCurrentPages();
          }
        }}
        disabled={!userKey}
        className="relative flex h-8 w-8 items-center justify-center rounded-xl text-[var(--t-text-muted)] transition-colors hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-green)] disabled:cursor-default disabled:opacity-50"
        aria-label={unread > 0 ? `Notificações, ${unread} não lida${unread === 1 ? '' : 's'}` : 'Notificações'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title="Notificações"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {preferencesLoaded && preferences.mostrar_contador && unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
            style={{ boxShadow: '0 0 0 2px var(--t-surface)' }}
            aria-hidden="true"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {mounted && panel && createPortal(panel, document.body)}
    </div>
  );
}
