'use client';

import * as React from 'react';

import { ATALHOS_DA_BASE, ROTULO_ATALHO, type AtalhoDaBase, type ItemDaBase } from '@/lib/comissao-funcoes';
import { COMPONENTES, TIPOS_COMPONENTE, type TipoComponente } from '@/lib/venda-modelo';
import { cn } from '@/lib/utils';

/**
 * Sobre o que se calcula (a base): um atalho de negócio (Receita da agência,
 * Valor de venda, Tarifa) ou os componentes escolhidos um a um. O atalho é a
 * base inteira; misturar os dois contaria o mesmo dinheiro duas vezes.
 */
const ESCOLHER = 'COMPONENTES';
type Modo = AtalhoDaBase | typeof ESCOLHER;

const AJUDA: Record<Modo, string> = {
  RECEITA: 'O ganho da agência, com os componentes que contam como receita em Configurações › Vendas.',
  VALOR_VENDA: 'O que o cliente paga pelo produto.',
  TARIFA: 'O valor do produto, sem taxas nem componentes.',
  COMPONENTES: 'Some só os componentes marcados. Desconto, Taxa CC e repasse entram subtraindo.',
};

export function EscolhaDaBase({ rotulo, valor, onChange, compacto = false }: { rotulo: string; valor: ItemDaBase[]; onChange: (v: ItemDaBase[]) => void; compacto?: boolean }) {
  const id = React.useId();
  const atalho = valor.find(v => (ATALHOS_DA_BASE as readonly string[]).includes(v)) as AtalhoDaBase | undefined;
  const modo: Modo = atalho ?? (valor.length ? ESCOLHER : 'RECEITA');
  const componentes = valor.filter(v => !(ATALHOS_DA_BASE as readonly string[]).includes(v)) as TipoComponente[];
  return (
    <div className="flex flex-col gap-[var(--fin-s-2)]">
      <label htmlFor={id} className="fin-t-caption font-medium text-[var(--fin-text-2)]">{rotulo}</label>
      <select
        id={id} value={modo}
        onChange={e => {
          const m = e.target.value as Modo;
          onChange(m === ESCOLHER ? (componentes.length ? componentes : ['COMISSAO']) : [m]);
        }}
        className="h-11 w-full max-w-sm rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10"
      >
        {ATALHOS_DA_BASE.map(a => <option key={a} value={a}>{ROTULO_ATALHO[a]}</option>)}
        <option value={ESCOLHER}>Escolher os componentes</option>
      </select>
      {compacto ? null : <p className="fin-t-caption text-[var(--fin-text-3)]">{AJUDA[modo]}</p>}
      {modo === ESCOLHER ? (
        <fieldset className="flex flex-wrap gap-[var(--fin-s-2)]">
          <legend className="sr-only">Componentes da base</legend>
          {TIPOS_COMPONENTE.map(t => {
            const marcado = componentes.includes(t);
            return (
              <label key={t} className={cn(
                'inline-flex h-9 cursor-pointer items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-2)] fin-t-caption transition-colors duration-[var(--fin-dur-rapida)]',
                marcado ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-text)]' : 'border-[var(--fin-border)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]',
              )}>
                <input
                  type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={marcado}
                  onChange={e => {
                    const prox = e.target.checked ? [...componentes, t] : componentes.filter(c => c !== t);
                    onChange(prox);
                  }}
                />
                {COMPONENTES[t].sinal < 0 ? `− ${COMPONENTES[t].rotulo}` : COMPONENTES[t].rotulo}
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}

export default EscolhaDaBase;
