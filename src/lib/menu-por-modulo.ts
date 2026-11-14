/**
 * Menu lateral e ⌘K por versão e módulo (14/11/2026). Regras puras.
 *
 * O item com `modulo` só aparece com o módulo ligado; o item que leva a uma
 * tela de módulo (modulos.ts, TELAS_DOS_MODULOS) também, mesmo sem o campo.
 * Sem o núcleo completo, o item com `rotuloSimples` volta ao nome da versão
 * simples. Assim a agência simples vê exatamente o menu de antes
 * (scripts/test-modulos-menu.ts congela esse menu). Esconder é só a tela:
 * a rota e o layout da tela barram no servidor.
 */
import { moduloLigado, telaLiberada, type ModuloId, type ModulosDaConta } from './modulos';

export interface ContextoDoMenu {
  modulos: Pick<ModulosDaConta, 'ligados' | 'telasCompletas'>;
  /** Conta do ecossistema (perfil-da-conta.ts). */
  ecossistema?: boolean;
}

export interface ItemDoMenu {
  label: string;
  href: string;
  modulo?: ModuloId;
  soEcossistema?: boolean;
  rotuloSimples?: string;
}

export function itemLiberado(item: ItemDoMenu, ctx: ContextoDoMenu): boolean {
  if (item.soEcossistema && !ctx.ecossistema) return false;
  if (item.modulo && !moduloLigado(ctx.modulos, item.modulo)) return false;
  return telaLiberada(ctx.modulos, item.href);
}

export function rotuloDoItem(item: ItemDoMenu, ctx: ContextoDoMenu): string {
  return !ctx.modulos.telasCompletas && item.rotuloSimples ? item.rotuloSimples : item.label;
}

/** Os itens que a agência vê, com o rótulo da versão dela. */
export function itensDaConta<T extends ItemDoMenu>(itens: readonly T[], ctx: ContextoDoMenu): T[] {
  return itens.filter(it => itemLiberado(it, ctx)).map(it => {
    const label = rotuloDoItem(it, ctx);
    return label === it.label ? it : { ...it, label };
  });
}

/** As seções do pilar que a agência vê (seção que fica vazia some). */
export function menuDaConta<T extends ItemDoMenu, S extends { items: T[] }>(secoes: readonly S[], ctx: ContextoDoMenu): S[] {
  return secoes
    .map(sec => ({ ...sec, items: itensDaConta(sec.items, ctx) }))
    .filter(sec => sec.items.length > 0);
}
