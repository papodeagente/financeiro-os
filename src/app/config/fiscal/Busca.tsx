'use client';

/**
 * Campo que procura em vez de exigir que a pessoa saiba o código.
 *
 * Os três dados que travavam a configuração fiscal (município, serviço e
 * intermediador) têm a mesma forma: existe uma lista com a resposta certa, e
 * pedir o número cru transferia para a agência um problema de classificação.
 * Aqui ela digita o que conhece e escolhe.
 *
 * O VALOR CONTINUA EDITÁVEL À MÃO. Quem já sabe o código digita direto, e se
 * a busca estiver fora do ar a configuração não trava.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface OpcaoBusca {
  /** O que vai para o campo quando a pessoa escolhe. */
  valor: string;
  /** Linha principal. */
  titulo: string;
  /** Linha de apoio, opcional. */
  detalhe?: string;
}

export function BuscaComLista({
  id,
  valor,
  onValor,
  onBuscar,
  placeholder,
  placeholderBusca,
  rotuloEscolhido,
  minimo = 2,
}: {
  id: string;
  valor: string;
  onValor: (v: string, opcao: OpcaoBusca | null) => void;
  /** Devolve as opções para o termo. Erro vira lista vazia. */
  onBuscar: (termo: string) => Promise<OpcaoBusca[]>;
  placeholder: string;
  placeholderBusca: string;
  /** Texto mostrado abaixo quando já há valor escolhido. */
  rotuloEscolhido?: string;
  /** Caracteres antes de buscar. 0 busca já ao abrir. */
  minimo?: number;
}) {
  const [termo, setTermo] = useState('');
  const [opcoes, setOpcoes] = useState<OpcaoBusca[]>([]);
  const [aberto, setAberto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora: sem isto a lista fica pendurada sobre o resto do
  // formulário e a pessoa não consegue ver o que preencheu.
  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const procurar = useCallback(async (t: string) => {
    if (t.trim().length < minimo) { setOpcoes([]); return; }
    setBuscando(true);
    try {
      setOpcoes(await onBuscar(t));
    } catch {
      setOpcoes([]);
    } finally {
      setBuscando(false);
    }
  }, [onBuscar, minimo]);

  // Espera a pessoa parar de digitar: uma busca por tecla castiga o servidor
  // e faz a lista piscar.
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => { void procurar(termo); }, 250);
    return () => clearTimeout(t);
  }, [termo, aberto, procurar]);

  return (
    <div ref={caixaRef} className="relative flex flex-col gap-2">
      <Input
        id={id}
        value={valor}
        placeholder={placeholder}
        onChange={e => onValor(e.target.value, null)}
        onFocus={() => { setAberto(true); if (minimo === 0) void procurar(''); }}
      />

      <button
        type="button"
        onClick={() => { setAberto(a => !a); if (!aberto && minimo === 0) void procurar(termo); }}
        className="fin-t-caption flex items-center gap-2 self-start text-[var(--fin-accent)]"
      >
        <Search aria-hidden="true" className="size-3.5" />
        {aberto ? 'Fechar a busca' : placeholderBusca}
      </button>

      {rotuloEscolhido ? (
        <span className="fin-t-caption flex items-center gap-1.5 text-[var(--fin-positive)]">
          <Check aria-hidden="true" className="size-3.5" />
          {rotuloEscolhido}
        </span>
      ) : null}

      {aberto ? (
        <div className="absolute top-full z-20 mt-1 flex w-full flex-col gap-2 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] p-2 shadow-lg">
          <Input
            autoFocus
            value={termo}
            placeholder={placeholderBusca}
            onChange={e => setTermo(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto">
            {buscando ? (
              <p className="fin-t-caption p-2 text-[var(--fin-text-3)]">Procurando…</p>
            ) : opcoes.length === 0 ? (
              <p className="fin-t-caption p-2 text-[var(--fin-text-3)]">
                {termo.trim().length < minimo
                  ? `Digite ${minimo} letras para procurar.`
                  : 'Nada encontrado. Você também pode digitar o código direto no campo acima.'}
              </p>
            ) : (
              opcoes.map(o => (
                <button
                  key={`${o.valor}-${o.titulo}`}
                  type="button"
                  onClick={() => { onValor(o.valor, o); setAberto(false); setTermo(''); }}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-[var(--fin-r-sm)] p-2 text-left',
                    'hover:bg-[var(--fin-surface-2)]',
                  )}
                >
                  <span className="fin-t-body text-[var(--fin-text)]">{o.titulo}</span>
                  {o.detalhe ? (
                    <span className="fin-t-caption text-[var(--fin-text-3)]">{o.detalhe}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
