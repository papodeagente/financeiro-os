'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ResultadoDoExtrato } from '@/lib/movimentos-caixa';

/**
 * Lê /api/movimentos-caixa com os filtros da tela (05/11/2026). Cada mudança
 * de filtro cancela a leitura anterior: a resposta velha nunca sobrescreve a
 * nova. Os dados anteriores ficam na tela enquanto a nova página chega.
 */
export function useMovimentos(consulta: string) {
  const [dados, setDados] = useState<ResultadoDoExtrato | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [versao, setVersao] = useState(0);
  const controle = useRef<AbortController | null>(null);

  useEffect(() => {
    controle.current?.abort();
    // Consulta vazia = filtro inválido na tela: não pergunta nada ao servidor.
    if (!consulta) { setCarregando(false); return; }
    const ac = new AbortController();
    controle.current = ac;
    setCarregando(true);
    fetch(`/api/movimentos-caixa?${consulta}`, { signal: ac.signal })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : 'A consulta não respondeu.');
        setDados(corpo as ResultadoDoExtrato);
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
  return { dados, carregando, erro, atualizadoEm, recarregar };
}

/** Baixa o CSV do recorte filtrado; devolve a mensagem de erro, se houver. */
export async function exportarMovimentos(consulta: string, leiaute: 'extrato' | 'movimentacoes'): Promise<string | null> {
  const r = await fetch(`/api/movimentos-caixa?${consulta}&format=csv&leiaute=${leiaute}`);
  if (!r.ok) {
    const corpo = await r.json().catch(() => null);
    return typeof corpo?.error === 'string' ? corpo.error : 'A exportação falhou. Tente de novo.';
  }
  const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? `${leiaute}.csv`;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}
