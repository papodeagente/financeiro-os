'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActivePillar, PILLARS, type Pillar } from '@/hooks/useActivePillar';
import { CrmStatusBadge } from './CrmStatusBadge';
import { NotificacoesBell } from './NotificacoesBell';
import { Logo } from './Logo';
import {
  Sun, Moon, Search, LogOut, ChevronDown, Settings, User as UserIcon, Check, Menu, LifeBuoy, Bug,
} from 'lucide-react';
import { useTicketsNaoLidos } from '@/hooks/useTicketsNaoLidos';
import { useState, useRef, useEffect } from 'react';

interface Props {
  onCommandPalette?: () => void;
  breadcrumb?: React.ReactNode;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** Abre a gaveta de navegação. Só existe abaixo de md. */
  onAbrirMenu?: () => void;
}

function getPillarDefaultRoute(pillar: Pillar): string {
  switch (pillar) {
    case 'planejamento': return '/planejamento/custos';
    case 'metas': return '/dashboard';
    case 'financeiro': return '/financeiro-ag';
    case 'configuracoes': return '/config/agencia';
  }
}

/** Alvo de toque de 36px, um raio só, e cor que só aparece no hover. */
const UTILITARIO = [
  'inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--fin-r-md)]',
  'text-[var(--fin-text-3)] transition-colors duration-150',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2',
].join(' ');

const ITEM_DE_MENU = [
  'mx-1.5 flex items-center gap-2.5 rounded-[var(--fin-r-md)] px-2.5 py-2',
  'fin-t-body text-[var(--fin-text-2)] transition-colors',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-[-2px]',
].join(' ');

const SUPERFICIE_FLUTUANTE = [
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]',
  'shadow-[0_8px_28px_rgba(16,24,40,0.10),0_2px_6px_rgba(16,24,40,0.05)]',
].join(' ');

function Inicial({ nome, tamanho }: { nome?: string; tamanho: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--fin-accent)] font-semibold text-[var(--fin-text-on-fill)]"
      style={{ width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.42) }}
    >
      {nome?.charAt(0)?.toUpperCase() || 'U'}
    </span>
  );
}

/**
 * Seletor de pilar.
 *
 * Antes eram quatro ícones sem rótulo no centro da barra, com o nome só no
 * `title` do navegador. Tooltip nativo não aparece no toque, não aparece no
 * teclado e não existe antes do hover: a navegação primária do sistema ficava
 * adivinhável. Aqui ela é um controle segmentado com o nome escrito.
 *
 * Abaixo de `lg` não cabe segmento para quatro nomes, e espremer volta ao
 * problema de origem. Então vira um botão que mostra o pilar ATUAL por extenso
 * e abre a lista — o nome continua visível em qualquer largura.
 */
function SeletorDePilar({ ativo }: { ativo: Pillar | null }) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const gatilho = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => {
      const alvo = e.target as Node;
      // O MENU TAMBÉM CONTA COMO "DENTRO". Ele vive num portal no <body>, fora
      // da árvore do gatilho: sem esta checagem, clicar num item fecha o menu
      // no mousedown, o React desmonta o <Link> e o clique termina no vazio —
      // o item parece simplesmente não funcionar.
      if (menu.current?.contains(alvo)) return;
      if (gatilho.current && !gatilho.current.contains(alvo)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const pilarAtual = PILLARS.find(p => p.id === ativo) ?? PILLARS[0];

  return (
    <>
      {/* Controle segmentado, a partir de lg */}
      <nav
        aria-label="Áreas do sistema"
        className="hidden shrink-0 items-center gap-0.5 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-[3px] lg:flex"
      >
        {PILLARS.map(pilar => {
          const Icone = pilar.icon;
          const selecionado = ativo === pilar.id;
          return (
            <Link
              key={pilar.id}
              href={getPillarDefaultRoute(pilar.id)}
              aria-current={selecionado ? 'page' : undefined}
              className={[
                'flex h-8 items-center gap-2 rounded-[7px] px-3 fin-t-body transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-1',
                selecionado
                  ? 'bg-[var(--fin-surface)] font-medium text-[var(--fin-text)] shadow-[0_1px_2px_rgba(16,24,40,0.07)]'
                  : 'text-[var(--fin-text-3)] hover:text-[var(--fin-text)]',
              ].join(' ')}
            >
              <Icone className="size-4 shrink-0" />
              <span className="whitespace-nowrap">{pilar.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Botão com o nome do pilar atual, abaixo de lg */}
      <button
        ref={gatilho}
        type="button"
        onClick={() => {
          if (aberto) { setAberto(false); return; }
          const r = gatilho.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 6, left: r.left });
          setAberto(true);
        }}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className={[
          'hidden h-9 min-w-0 shrink items-center gap-1.5 rounded-[var(--fin-r-md)] px-2.5 md:flex lg:hidden',
          'fin-t-body font-medium text-[var(--fin-text)] transition-colors',
          'hover:bg-[var(--fin-surface-2)]',
          'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2',
        ].join(' ')}
      >
        <pilarAtual.icon className="size-4 shrink-0 text-[var(--fin-text-3)]" />
        <span className="truncate">{pilarAtual.label}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-[var(--fin-text-3)] transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && pos && createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label="Áreas do sistema"
          className={`fixed z-[var(--fin-z-menu)] w-56 py-1.5 ${SUPERFICIE_FLUTUANTE}`}
          style={{ top: pos.top, left: pos.left }}
        >
          {PILLARS.map(pilar => {
            const Icone = pilar.icon;
            const selecionado = ativo === pilar.id;
            return (
              <Link
                key={pilar.id}
                href={getPillarDefaultRoute(pilar.id)}
                role="menuitem"
                onClick={() => setAberto(false)}
                className={ITEM_DE_MENU}
              >
                <Icone className="size-4 shrink-0" />
                <span className={`flex-1 ${selecionado ? 'font-medium text-[var(--fin-text)]' : ''}`}>
                  {pilar.label}
                </span>
                {selecionado ? <Check className="size-4 shrink-0 text-[var(--fin-accent)]" /> : null}
              </Link>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export function TopBar({ onCommandPalette, onAbrirMenu }: Props) {
  const activePillar = useActivePillar();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuDaConta = useRef<HTMLDivElement>(null);
  const ticketsNaoLidos = useTicketsNaoLidos();

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      // Mesma regra do seletor de pilar: o menu está num portal, e clicar
      // dentro dele não é "clicar fora".
      if (menuDaConta.current?.contains(t)) return;
      if (triggerRef.current && !triggerRef.current.contains(t)) setDropdownOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDropdownOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [dropdownOpen]);

  return (
    <header
      className={[
        'flex h-14 w-full shrink-0 items-center gap-2 px-3 sm:px-4',
        'z-40 min-w-0 overflow-hidden border-b border-[var(--fin-border)] bg-[var(--fin-surface)]',
      ].join(' ')}
    >
      {/* No celular a navegação inteira está atrás deste botão. Acima de md
          o trilho é permanente e o botão não existe. */}
      <button
        type="button"
        onClick={onAbrirMenu}
        className={`${UTILITARIO} md:hidden`}
        aria-label="Abrir menu de navegação"
      >
        <Menu className="size-[18px]" />
      </button>

      <div className="flex shrink-0 items-center">
        <Logo variant="sidebar" href="/dashboard" />
      </div>

      {/* Separador fino entre a marca e a navegação: são dois assuntos. */}
      <span aria-hidden="true" className="mx-1 hidden h-6 w-px shrink-0 bg-[var(--fin-border)] lg:block" />

      <SeletorDePilar ativo={activePillar} />

      {/* O vão empurra os utilitários para a direita, em vez de centralizar a
          navegação no meio da barra sem âncora nenhuma. */}
      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        <button onClick={onCommandPalette} className={UTILITARIO} title="Buscar (⌘K)" aria-label="Buscar">
          <Search className="size-[18px]" />
        </button>

        <div className="hidden shrink-0 items-center lg:flex">
          <CrmStatusBadge variant="compacto" />
        </div>

        <div className="shrink-0">
          <NotificacoesBell />
        </div>

        <button
          onClick={toggleTheme}
          className={UTILITARIO}
          aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
          {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>

        {user && (
          <button
            ref={triggerRef}
            onClick={() => {
              if (dropdownOpen) { setDropdownOpen(false); return; }
              // Posição medida na hora do clique, igual ao seletor de pilar: o
              // <header> tem overflow-hidden e clipava o menu, então ele vai
              // num portal no body — e aí precisa de coordenada absoluta.
              const r = triggerRef.current?.getBoundingClientRect();
              if (r) setDropdownPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
              setDropdownOpen(true);
            }}
            className={[
              'ml-0.5 flex shrink-0 items-center gap-1 rounded-[var(--fin-r-md)] p-1 transition-colors',
              'hover:bg-[var(--fin-surface-2)]',
              'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2',
            ].join(' ')}
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            aria-label={ticketsNaoLidos > 0
              ? `Conta (${ticketsNaoLidos} ${ticketsNaoLidos === 1 ? 'resposta' : 'respostas'} do suporte sem ler)`
              : 'Conta'}
          >
            <span className="relative inline-flex">
              {user.foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.foto} alt="" className="size-7 rounded-full object-cover" />
              ) : (
                <Inicial nome={user.nome} tamanho={28} />
              )}
              {/* O contador de respostas vivia num botão flutuante sempre à
                  vista. Mudando para dentro do menu, o aviso morreria fechado:
                  este ponto é o que sobrevive da notificação. */}
              {ticketsNaoLidos > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--fin-surface)] bg-[var(--fin-negative)]"
                />
              ) : null}
            </span>
            <ChevronDown
              className={`size-3.5 text-[var(--fin-text-3)] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {user && dropdownOpen && dropdownPos && createPortal(
        <div
          ref={menuDaConta}
          role="menu"
          className={`fixed z-[var(--fin-z-menu)] w-64 py-1.5 ${SUPERFICIE_FLUTUANTE}`}
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-1.5">
            {user.foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.foto} alt="" className="size-9 rounded-full object-cover" />
            ) : (
              <Inicial nome={user.nome} tamanho={36} />
            )}
            <div className="min-w-0 flex-1">
              <p className="fin-t-body-strong truncate text-[var(--fin-text)]">{user.nome}</p>
              <p className="fin-t-caption truncate text-[var(--fin-text-3)]">{user.email}</p>
            </div>
          </div>

          <div className="my-1 h-px bg-[var(--fin-border)]" />

          <Link href="/perfil" className={ITEM_DE_MENU} onClick={() => setDropdownOpen(false)} role="menuitem">
            <UserIcon className="size-4 shrink-0" />
            <span>Meu perfil</span>
          </Link>
          <Link href="/config/agencia" className={ITEM_DE_MENU} onClick={() => setDropdownOpen(false)} role="menuitem">
            <Settings className="size-4 shrink-0" />
            <span>Configurações</span>
          </Link>

          <div className="my-1 h-px bg-[var(--fin-border)]" />

          <Link href="/suporte" className={ITEM_DE_MENU} onClick={() => setDropdownOpen(false)} role="menuitem">
            <LifeBuoy className="size-4 shrink-0" />
            <span className="flex-1">Suporte</span>
            {ticketsNaoLidos > 0 ? (
              <span className="fin-t-caption rounded-[var(--fin-r-sm)] bg-[var(--fin-negative-soft)] px-1.5 font-medium text-[var(--fin-negative-text)]">
                {ticketsNaoLidos > 9 ? '9+' : ticketsNaoLidos}
              </span>
            ) : null}
          </Link>
          <Link href="/suporte?novo=1" className={ITEM_DE_MENU} onClick={() => setDropdownOpen(false)} role="menuitem">
            <Bug className="size-4 shrink-0" />
            <span>Reportar um problema</span>
          </Link>

          <div className="my-1 h-px bg-[var(--fin-border)]" />

          <button
            onClick={() => { setDropdownOpen(false); logout(); }}
            className={`${ITEM_DE_MENU} w-[calc(100%-12px)] text-left text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft,var(--fin-surface-2))] hover:text-[var(--fin-negative-text)]`}
            role="menuitem"
          >
            <LogOut className="size-4 shrink-0" />
            <span>Sair</span>
          </button>
        </div>,
        document.body,
      )}
    </header>
  );
}
