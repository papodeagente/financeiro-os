'use client';

import { useEffect, useState } from 'react';

/**
 * Quantos tickets de suporte têm resposta que a pessoa ainda não leu.
 *
 * Existe como hook porque o número é mostrado em DOIS lugares que precisam
 * concordar: o ponto no avatar, que avisa sem abrir nada, e a linha de
 * Suporte dentro do menu. Buscar duas vezes daria dois números diferentes
 * entre uma resposta e outra do servidor.
 */
export function useTicketsNaoLidos(): number {
  const [naoLidos, setNaoLidos] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetch('/api/support/tickets')
      .then(r => (r.ok ? r.json() : []))
      .then((d: Array<{ tem_nao_lida_usuario?: boolean }>) => {
        if (!vivo || !Array.isArray(d)) return;
        setNaoLidos(d.filter(t => t.tem_nao_lida_usuario).length);
      })
      .catch(() => {
        // Suporte indisponível não é erro da tela: o menu continua abrindo,
        // só sem o aviso.
      });
    return () => { vivo = false; };
  }, []);

  return naoLidos;
}
