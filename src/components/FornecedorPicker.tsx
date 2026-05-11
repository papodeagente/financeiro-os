'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { FornecedorCRM, TipoFornecedor } from '@/lib/crm-types';
import { loadEntities, saveEntity } from '@/lib/crm-storage';
import { generateId } from '@/lib/utils';
import { Plus, ChevronDown, Check, Building2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';

interface Props {
  value?: string;            // fornecedor_id selecionado
  nome?: string;             // nome livre (fallback quando não há id)
  onChange: (fornecedor: { id: string; nome: string } | null) => void;
  tipoSugerido?: TipoFornecedor;
  placeholder?: string;
  className?: string;
}

// Picker que conecta linhas de cotação ao cadastro de fornecedores.
// - Mostra fornecedores cadastrados em dropdown filtrável
// - Permite criar fornecedor inline (nome + CNPJ + tipo) sem sair da tela
// - Quando o usuário não escolhe, mantém o nome livre antigo (backward compat)
export function FornecedorPicker({ value, nome, onChange, tipoSugerido, placeholder = 'Selecionar fornecedor', className = '' }: Props) {
  const [fornecedores, setFornecedores] = useState<FornecedorCRM[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoCnpj, setNovoCnpj] = useState('');
  const [novoTipo, setNovoTipo] = useState<TipoFornecedor>(tipoSugerido ?? 'OUTROS');
  const ref = useRef<HTMLDivElement>(null);

  const fetchFornecedores = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadEntities<FornecedorCRM>('fornecedores-crm');
      setFornecedores(data);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFornecedores(); }, [fetchFornecedores]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selecionado = value ? fornecedores.find(f => f.id === value) : null;
  const labelAtual = selecionado
    ? (selecionado.nome_fantasia || selecionado.razao_social || 'Fornecedor')
    : (nome || '');

  const filtrados = query.trim()
    ? fornecedores.filter(f => {
        const q = query.toLowerCase();
        return (f.nome_fantasia?.toLowerCase().includes(q)
             || f.razao_social?.toLowerCase().includes(q)
             || f.cnpj?.includes(q));
      })
    : fornecedores;

  const select = (f: FornecedorCRM) => {
    onChange({ id: f.id, nome: f.nome_fantasia || f.razao_social || 'Fornecedor' });
    setOpen(false);
    setCreating(false);
    setQuery('');
  };

  const handleNomeLivre = (txt: string) => {
    setQuery(txt);
    onChange(txt ? { id: '', nome: txt } : null);
  };

  const handleCriar = async () => {
    const nomeFinal = novoNome.trim();
    if (nomeFinal.length < 2) {
      toast.error('Nome do fornecedor obrigatório');
      return;
    }
    const novo = {
      id: generateId(),
      tipo: novoTipo,
      razao_social: nomeFinal,
      nome_fantasia: nomeFinal,
      cnpj: novoCnpj.replace(/\D+/g, ''),
      telefone: '', email: '', site: '', contato_principal: '', whatsapp: '',
      endereco_completo: '', cidade: '', estado: '',
      dados_bancarios: [],
      regras_faturamento: {
        prazo_pagamento_dias: 30, dia_corte: 0, dia_vencimento: 0,
        comissao_padrao: 0,
      },
      integracao_ativa: false,
      tipo_integracao: 'MANUAL',
      anexos: [],
      marcadores: [],
    } as unknown as FornecedorCRM;
    try {
      await saveEntity('fornecedores-crm', novo);
      await fetchFornecedores();
      onChange({ id: novo.id, nome: nomeFinal });
      toast.success('Fornecedor cadastrado');
      setCreating(false);
      setOpen(false);
      setNovoNome('');
      setNovoCnpj('');
    } catch {
      toast.error('Falha ao salvar fornecedor');
    }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full h-8 px-3 flex items-center justify-between gap-2 rounded-md border border-[var(--t-border)] bg-[var(--t-input-bg)] hover:border-[var(--t-text-muted)] transition-colors text-left"
        title={labelAtual || placeholder}
      >
        <span className={`text-sm truncate flex items-center gap-1.5 ${labelAtual ? 'text-[var(--t-text)]' : 'text-[var(--t-text-muted)]'}`}>
          {selecionado && <Building2 className="w-3.5 h-3.5 text-[var(--t-green)] shrink-0" />}
          {labelAtual || placeholder}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--t-text-muted)] shrink-0" />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl bg-[var(--t-surface)] border border-[var(--t-border)] overflow-hidden"
          style={{ boxShadow: 'var(--elevation-4)', minWidth: '280px' }}
        >
          {creating ? (
            <div className="p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] font-semibold">Novo fornecedor</div>
              <div>
                <label className="text-[10px] text-[var(--t-text-muted)] block mb-0.5">Nome</label>
                <Input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Ex: LATAM, Booking, ..." className="h-8 text-sm" autoFocus />
              </div>
              <div>
                <label className="text-[10px] text-[var(--t-text-muted)] block mb-0.5">CNPJ (opcional)</label>
                <Input value={novoCnpj} onChange={e => setNovoCnpj(e.target.value)} placeholder="12.345.678/0001-90" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-[var(--t-text-muted)] block mb-0.5">Tipo</label>
                <select
                  value={novoTipo}
                  onChange={e => setNovoTipo(e.target.value as TipoFornecedor)}
                  className="h-8 text-sm w-full rounded-md border border-[var(--t-border)] bg-[var(--t-input-bg)] px-2"
                >
                  <option value="CIA_AEREA">Cia Aérea</option>
                  <option value="HOTEL">Hotel</option>
                  <option value="OPERADORA">Operadora</option>
                  <option value="CONSOLIDADORA">Consolidadora</option>
                  <option value="RECEPTIVO">Receptivo</option>
                  <option value="SEGURADORA">Seguradora</option>
                  <option value="CRUZEIRO">Cruzeiro</option>
                  <option value="LOCADORA">Locadora</option>
                  <option value="OUTROS">Outros</option>
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleCriar} className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-[var(--t-green)] rounded-md hover:opacity-90">
                  Cadastrar
                </button>
                <button onClick={() => setCreating(false)} className="px-3 py-1.5 text-xs text-[var(--t-text-secondary)] rounded-md hover:bg-[var(--t-surface-hover)]">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="p-2 border-b border-[var(--t-border)]">
                <Input
                  value={query}
                  onChange={e => handleNomeLivre(e.target.value)}
                  placeholder="Buscar ou digitar nome..."
                  className="h-7 text-sm"
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {loading ? (
                  <div className="px-3 py-3 text-xs text-[var(--t-text-muted)] flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
                  </div>
                ) : filtrados.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-[var(--t-text-muted)]">
                    {query ? `Nenhum encontrado para "${query}"` : 'Sem fornecedores cadastrados'}
                  </div>
                ) : (
                  filtrados.slice(0, 30).map(f => {
                    const nome = f.nome_fantasia || f.razao_social || 'Fornecedor';
                    const isSelected = value === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => select(f)}
                        className={`w-full px-3 py-2 flex items-start gap-2 text-left transition-colors ${isSelected ? 'bg-[var(--t-surface-hover)]' : 'hover:bg-[var(--t-surface-hover)]'}`}
                      >
                        <Building2 className="w-3.5 h-3.5 text-[var(--t-text-muted)] mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[var(--t-text)] truncate">{nome}</p>
                          {f.cnpj && <p className="text-[10px] text-[var(--t-text-muted)] truncate font-mono">{f.cnpj}</p>}
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[var(--t-green)] shrink-0 mt-0.5" />}
                      </button>
                    );
                  })
                )}
              </div>
              <button
                onClick={() => { setCreating(true); setNovoNome(query); }}
                className="w-full px-3 py-2 flex items-center gap-2 text-xs text-[var(--t-green)] hover:bg-[var(--t-surface-hover)] border-t border-[var(--t-border)]"
              >
                <Plus className="w-3.5 h-3.5" />
                Cadastrar novo fornecedor{query ? `: "${query}"` : ''}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
