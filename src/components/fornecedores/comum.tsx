'use client';

/**
 * Peças comuns das telas do lado do fornecedor (E5, parte C): busca na API,
 * a lista de fornecedores para escolher, alertas e formatos. O servidor fala
 * em centavos; a tela mostra reais.
 */
import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

import { deCentavos } from '@/lib/money';
import { cn } from '@/lib/utils';

export { CampoReais, Pilula, SECAO, SELECT, ROTULO, LINK, CONTROLE, dataBR, quandoBR, reais } from '@/components/vendas/ficha/comum';

export class ErroDaApi extends Error {
  status: number;
  codigo: string;
  detalhes: unknown;
  constructor(mensagem: string, status: number, codigo: string, detalhes: unknown) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** fetch + JSON + erro com a frase do servidor. */
export async function api<T>(url: string, init?: { metodo?: string; corpo?: unknown }): Promise<T> {
  const r = await fetch(url, {
    method: init?.metodo ?? 'GET',
    headers: init?.corpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroDaApi(String(j?.error ?? 'Não foi possível concluir agora.'), r.status, String(j?.codigo ?? ''), j?.detalhes);
  return j as T;
}

export interface FornecedorOpcao { id: string; nome: string; tipo: string }

/** Os fornecedores cadastrados, para escolher (nunca digitar código). */
export function useFornecedores(): { fornecedores: FornecedorOpcao[]; carregando: boolean } {
  const [fornecedores, setFornecedores] = React.useState<FornecedorOpcao[]>([]);
  const [carregando, setCarregando] = React.useState(true);
  React.useEffect(() => {
    let vivo = true;
    api<{ fornecedores: FornecedorOpcao[] }>('/api/fornecedores/opcoes')
      .then(j => { if (vivo) setFornecedores(j.fornecedores); })
      .catch(() => { /* a tela segue; o campo fica vazio */ })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);
  return { fornecedores, carregando };
}

/** Centavos → reais, para o <Money> e a FinTable (que recebem reais). */
export const emReais = (c: number | null | undefined) => deCentavos(c ?? 0);

export function percentualBR(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
}

export interface AlertaSimples { codigo: string; gravidade: 'aviso' | 'atencao'; mensagem: string }

/** Lista de alertas em linhas curtas: atenção em âmbar forte, aviso em azul. */
export function ListaDeAlertas({ alertas, className }: { alertas: AlertaSimples[]; className?: string }) {
  if (!alertas.length) return null;
  return (
    <ul className={cn('flex flex-col gap-[var(--fin-s-2)]', className)}>
      {alertas.map((a, i) => {
        const atencao = a.gravidade === 'atencao';
        const Icone = atencao ? AlertTriangle : Info;
        return (
          <li
            key={`${a.codigo}-${i}`}
            className={cn(
              'flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body',
              atencao ? 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]' : 'bg-[var(--fin-info-soft)] text-[var(--fin-text-2)]',
            )}
          >
            <Icone aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{a.mensagem}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Linha "rótulo — valor" dos resumos dentro das janelas. */
export function LinhaDeResumo({ rotulo, children, forte = false }: { rotulo: string; children: React.ReactNode; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] py-[var(--fin-s-2)] last:border-b-0">
      <dt className="fin-t-body text-[var(--fin-text-2)]">{rotulo}</dt>
      <dd className={cn('text-right tabular-nums', forte ? 'fin-t-body-strong text-[var(--fin-text)]' : 'fin-t-body text-[var(--fin-text)]')}>{children}</dd>
    </div>
  );
}

/** Hoje no fuso do Brasil (AAAA-MM-DD), no navegador. */
export function hojeNoBrasil(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
