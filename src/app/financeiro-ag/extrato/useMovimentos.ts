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

// A exportação (Excel, PDF, imprimir) sai pelo BotaoExportar, com o mesmo
// recorte em /api/movimentos-caixa?format=xlsx|pdf|imprimir (o CSV continua na rota).
