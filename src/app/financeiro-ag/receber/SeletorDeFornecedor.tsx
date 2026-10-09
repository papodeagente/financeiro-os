'use client';

import { useMemo, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Building2, Plus } from 'lucide-react';

import type { FornecedorCRM, TipoFornecedor } from '@/lib/crm-types';
import { cn } from '@/lib/utils';

export type FornecedorDaLista = Pick<FornecedorCRM, 'id' | 'tipo' | 'razao_social' | 'nome_fantasia' | 'regras_faturamento'>;

type Opcao = { id: string; nome: string; detalhe: string; novo?: boolean };

const ROTULO_TIPO: Record<TipoFornecedor, string> = {
  OPERADORA: 'Operadora', CONSOLIDADORA: 'Consolidadora', CIA_AEREA: 'Cia. aérea', HOTEL: 'Hotel',
  RECEPTIVO: 'Receptivo', SEGURADORA: 'Seguradora', LOCADORA: 'Locadora', CRUZEIRO: 'Cruzeiro', OUTROS: 'Fornecedor',
};

export function nomeDoFornecedor(f: Pick<FornecedorCRM, 'nome_fantasia' | 'razao_social'>): string {
  return (f.nome_fantasia || f.razao_social || '').trim() || 'Fornecedor';
}

export type SeletorDeFornecedorProps = {
  id?: string;
  fornecedores: readonly FornecedorDaLista[];
  valorId: string;
  valorNome: string;
  onChange: (f: { id: string; nome: string }) => void;
  /** Cadastra um fornecedor novo só com o nome; devolve o id criado. */
  onCadastrar: (nome: string) => Promise<{ id: string; nome: string } | null>;
  invalido?: boolean;
};

/**
 * Quem presta o serviço. Busca pelo nome, mostra o tipo e o prazo de
 * pagamento do cadastro, e cadastra na hora o que ainda não existe: lançar
 * uma venda não pode depender de sair da tela para cadastrar a operadora.
 */
export function SeletorDeFornecedor({
  id, fornecedores, valorId, valorNome, onChange, onCadastrar, invalido = false,
}: SeletorDeFornecedorProps) {
  const [busca, setBusca] = useState(valorNome);
  const [cadastrando, setCadastrando] = useState(false);

  const opcoes = useMemo<Opcao[]>(() => {
    const lista = fornecedores.map(f => ({
      id: f.id,
      nome: nomeDoFornecedor(f),
      detalhe: `${ROTULO_TIPO[f.tipo] ?? 'Fornecedor'} · paga em ${f.regras_faturamento?.prazo_pagamento_dias ?? 30} dias`,
    }));
    const termo = busca.trim();
    const existe = lista.some(o => o.nome.toLowerCase() === termo.toLowerCase());
    return termo && !existe ? [...lista, { id: '__novo__', nome: termo, detalhe: 'Cadastrar este fornecedor', novo: true }] : lista;
  }, [fornecedores, busca]);

  const selecionado = opcoes.find(o => o.id === valorId) ?? (valorNome ? { id: valorId, nome: valorNome, detalhe: '' } : null);

  async function escolher(o: Opcao | null) {
    if (!o) return;
    if (o.novo) {
      setCadastrando(true);
      try {
        const criado = await onCadastrar(o.nome);
        if (criado) { onChange(criado); setBusca(criado.nome); }
      } finally {
        setCadastrando(false);
      }
      return;
    }
    onChange({ id: o.id, nome: o.nome });
    setBusca(o.nome);
  }

  return (
    <Combobox.Root<Opcao>
      items={opcoes}
      value={selecionado}
      onValueChange={o => { void escolher(o); }}
      inputValue={busca}
      onInputValueChange={v => setBusca(v)}
      itemToStringLabel={o => o.nome}
      isItemEqualToValue={(a, b) => a.id === b.id}
      // O item "Cadastrar" sempre aparece enquanto o nome digitado for novo.
      filter={(o, q) => Boolean(o.novo) || o.nome.toLowerCase().includes(q.trim().toLowerCase())}
    >
      <Combobox.Input
        id={id}
        placeholder="Buscar ou cadastrar fornecedor"
        aria-invalid={invalido || undefined}
        disabled={cadastrando}
        className={cn(
          'h-11 w-full rounded-[var(--fin-r-md)] border bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)] lg:h-10',
          'placeholder:text-[var(--fin-text-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
          invalido ? 'border-[var(--fin-negative)]' : 'border-[var(--fin-border-strong)]',
        )}
      />
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-[var(--fin-z-popover)]">
          <Combobox.Popup className="max-h-72 w-[var(--anchor-width)] min-w-64 overflow-y-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-1 shadow-[var(--fin-e2)] outline-none">
            <Combobox.Empty className="px-3 py-2 fin-t-caption text-[var(--fin-text-3)]">
              Digite o nome para cadastrar.
            </Combobox.Empty>
            <Combobox.List>
              {(o: Opcao) => (
                <Combobox.Item
                  key={o.id}
                  value={o}
                  className="flex cursor-default items-start gap-2 rounded-[var(--fin-r-sm)] px-2.5 py-2 outline-none data-[highlighted]:bg-[var(--fin-surface-2)]"
                >
                  {o.novo
                    ? <Plus aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-accent)]" />
                    : <Building2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />}
                  <span className="flex min-w-0 flex-col">
                    <span className={cn('truncate fin-t-body', o.novo ? 'text-[var(--fin-accent)]' : 'text-[var(--fin-text)]')}>
                      {o.novo ? `Cadastrar "${o.nome}"` : o.nome}
                    </span>
                    {o.novo ? null : <span className="fin-t-caption text-[var(--fin-text-3)]">{o.detalhe}</span>}
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

export default SeletorDeFornecedor;
