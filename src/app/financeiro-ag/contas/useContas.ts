'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { LinhaDeConta, ResultadoDaLista } from '@/lib/contas-pagar-receber';

const ROTA = '/api/contas-pagar-receber';

/**
 * Lê a lista unificada com os filtros da tela (05/11/2026). Cada mudança de
 * filtro cancela a leitura anterior: a resposta velha nunca sobrescreve a
 * nova. A página anterior fica na tela enquanto a nova chega.
 */
export function useContas(consulta: string) {
  const [dados, setDados] = useState<ResultadoDaLista | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [versao, setVersao] = useState(0);
  const controle = useRef<AbortController | null>(null);

  useEffect(() => {
    controle.current?.abort();
    // Consulta vazia = filtro inválido na tela: não pergunta nada ao servidor.
    if (!consulta) return;
    const ac = new AbortController();
    controle.current = ac;
    Promise.resolve().then(() => { if (!ac.signal.aborted) setCarregando(true); });
    fetch(`${ROTA}?${consulta}`, { signal: ac.signal })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : 'A consulta não respondeu.');
        setDados(corpo as ResultadoDaLista);
        setErro(null);
        setAtualizadoEm(new Date());
      })
      .catch(e => {
        if (ac.signal.aborted) return;
        setErro(e instanceof Error ? e.message : 'A consulta não respondeu.');
      })
      .finally(() => { if (!ac.signal.aborted) setCarregando(false); });
    return () => ac.abort();
  }, [consulta, versao]);

  const recarregar = useCallback(async () => { setVersao(v => v + 1); }, []);
  return { dados, carregando: consulta ? carregando : false, erro, atualizadoEm, recarregar };
}

/** Endereço do arquivo do filtro inteiro em Excel (.xlsx), PDF ou impressão (E7). */
export function enderecoDaExportacao(consulta: string, formato: 'xlsx' | 'pdf' | 'imprimir'): string {
  return `${ROTA}?${consulta}&format=${formato}`;
}

/** Baixa a planilha do filtro inteiro; devolve a mensagem de erro, se houver. */
export async function exportarContas(consulta: string): Promise<string | null> {
  const r = await fetch(`${ROTA}?${consulta}&format=csv`);
  if (!r.ok) {
    const corpo = await r.json().catch(() => null);
    return typeof corpo?.error === 'string' ? corpo.error : 'A exportação falhou. Tente de novo.';
  }
  const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'contas.csv';
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

/** Todas as contas do filtro (até 2.000), para "selecionar todas". */
export async function todasDoFiltro(consulta: string): Promise<{ linhas: LinhaDeConta[]; cortado: boolean }> {
  const r = await fetch(`${ROTA}?${consulta}&format=chaves`);
  const corpo = await r.json().catch(() => null);
  if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : 'Não foi possível selecionar todas.');
  return corpo as { linhas: LinhaDeConta[]; cortado: boolean };
}

/** O que a pessoa pode, ação por ação (as telas só escondem; quem decide é o servidor). */
export function usePermissoes() {
  const [acoes, setAcoes] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch('/api/permissoes/minhas')
      .then(r => (r.ok ? r.json() : null))
      .then((c: { acoes?: Record<string, boolean> } | null) => { if (vivo) setAcoes(c?.acoes ?? {}); })
      .catch(() => { if (vivo) setAcoes({}); });
    return () => { vivo = false; };
  }, []);
  // Antes de saber, mostra as ações: o servidor recusa o que não puder.
  return useCallback((acao: string) => (acoes === null ? true : acoes[acao] !== false), [acoes]);
}

/** Endereço da conta na tela de sempre (a de pagar ou a de receber), já aberta. */
export function enderecoDaConta(l: Pick<LinhaDeConta, 'tipo' | 'id'>): string {
  return `/financeiro-ag/${l.tipo === 'pagar' ? 'pagar' : 'receber'}?abrir=${encodeURIComponent(l.id)}`;
}
