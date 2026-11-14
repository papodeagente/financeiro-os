'use client';

import * as React from 'react';

import { Callout } from '@/components/fin/Callout';
import { CATEGORIAS_DOS_TITULOS, type ChaveCategoriaDoTitulo } from '@/lib/categorias-padrao-titulos';
import { toast } from '@/lib/toast';

/**
 * Assistente inicial do Financeiro (E7, frente D, 06/11/2026).
 *
 * - Agência nova (sem plano próprio e sem contas): roda sozinho, sem pedir
 *   nada, e avisa o que criou.
 * - Agência com dados e alguma conta gerada sem categoria: oferece num
 *   clique. Cria só o que falta e liga só o que está vazio.
 * - Tudo ligado: não aparece.
 */
type Situacao = { modo: 'automatico' | 'oferecer' | 'pronto'; faltam: ChaveCategoriaDoTitulo[]; encargos_faltam: string[] };

const CHAVE_ADIADO = 'fin-assistente-inicial-adiado';

function listaPorExtenso(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

export function AssistenteInicial({ onAplicado, className }: { onAplicado?: () => void; className?: string }) {
  const [situacao, setSituacao] = React.useState<Situacao | null>(null);
  const [aplicando, setAplicando] = React.useState(false);
  const [adiado, setAdiado] = React.useState(() => {
    try { return typeof window !== 'undefined' && window.sessionStorage.getItem(CHAVE_ADIADO) === '1'; } catch { return false; }
  });

  const aplicar = React.useCallback(async (automatico: boolean) => {
    setAplicando(true);
    try {
      const r = await fetch('/api/config/financeiro/assistente', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ automatico }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string; aplicado?: boolean; situacao?: Situacao; resultado?: { categorias_criadas?: number } };
      if (!r.ok) {
        // Agência nova aberta por quem não é administrador: fica a oferta para o administrador.
        if (!automatico) toast.error('Não foi possível criar as categorias.', corpo.error ?? 'Tente de novo.');
        return;
      }
      if (corpo.situacao) setSituacao(corpo.situacao);
      if (corpo.aplicado) {
        const n = corpo.resultado?.categorias_criadas ?? 0;
        toast.success(
          automatico ? 'O Financeiro está pronto para usar.' : 'Categorias padrão ligadas.',
          n > 0
            ? `${n === 1 ? 'Uma categoria criada' : `${n} categorias criadas`} no plano de contas. As contas que o sistema gera já nascem classificadas; dá para trocar em Configurações › Financeiro.`
            : 'As contas que o sistema gera já nascem classificadas.',
        );
        onAplicado?.();
      }
    } catch {
      if (!automatico) toast.error('Sem conexão com o servidor.', 'Nada foi criado.');
    } finally {
      setAplicando(false);
    }
  }, [onAplicado]);

  React.useEffect(() => {
    let vivo = true;
    fetch('/api/config/financeiro/assistente', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((s: Situacao | null) => {
        if (!vivo || !s) return;
        setSituacao(s);
        if (s.modo === 'automatico') void aplicar(true);
      })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [aplicar]);

  if (!situacao || situacao.modo !== 'oferecer' || adiado) return null;
  const nomes = situacao.faltam.map(k => CATEGORIAS_DOS_TITULOS.find(c => c.chave === k)?.rotulo.toLowerCase() ?? k);
  const partes = [
    nomes.length ? listaPorExtenso(nomes) : '',
    situacao.encargos_faltam.length ? 'os juros, descontos e taxas da liquidação' : '',
  ].filter(Boolean);

  return (
    <Callout
      tom="info"
      className={className}
      titulo="Contas geradas pelo sistema ainda sem categoria padrão"
      acao={{ rotulo: 'Criar e ligar as que faltam', onClick: () => { void aplicar(false); }, carregando: aplicando }}
      acaoSecundaria={{ rotulo: 'Agora não', onClick: () => { setAdiado(true); try { window.sessionStorage.setItem(CHAVE_ADIADO, '1'); } catch { /* sem armazenamento */ } } }}
    >
      Falta categoria para {listaPorExtenso(partes)}. Com um clique, o Financeiro cria as categorias padrão que faltam no plano de
      contas e liga cada uma. O que você já escolheu, suas categorias e as contas já lançadas não mudam.
    </Callout>
  );
}
