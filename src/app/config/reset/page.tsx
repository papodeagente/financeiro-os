'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Loader2, Eraser, Check,
  Wallet, Package, Users, Sparkles, Filter, Workflow,
} from 'lucide-react';

type CategoryId = 'financeiro' | 'produtos' | 'grupos' | 'mapas_mentais' | 'funis' | 'fluxogramas';

interface CategoryDef {
  id: CategoryId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'financeiro',
    label: 'Informações financeiras',
    description: 'Contas a receber/pagar, transferências, extrato, plano de contas, comissões, metas, CAC, centros de custo, cartões.',
    icon: Wallet,
  },
  {
    id: 'produtos',
    label: 'Produtos',
    description: 'Catálogo de produtos (grupos), templates de proposta, orçamentos, propostas, vendas fechadas, destinos.',
    icon: Package,
  },
  {
    id: 'grupos',
    label: 'Grupos (gestão)',
    description: 'Grupos de viagem ativos: períodos, reservas, materiais, passageiros, quartos, documentos, tarefas e eventos.',
    icon: Users,
  },
  {
    id: 'mapas_mentais',
    label: 'Mapas mentais',
    description: 'Todos os mapas mentais criados em Planejamento.',
    icon: Sparkles,
  },
  {
    id: 'funis',
    label: 'Funis e campanhas',
    description: 'Todos os funis criados, simulações salvas e templates de funil.',
    icon: Filter,
  },
  {
    id: 'fluxogramas',
    label: 'Fluxogramas',
    description: 'Todos os fluxogramas e suas categorias.',
    icon: Workflow,
  },
];

export default function ResetPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<CategoryId>>(new Set());
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ total: number; summary: Record<string, number> } | null>(null);

  useEffect(() => {
    fetch('/api/config/reset')
      .then(async r => {
        if (r.status === 403) {
          setError('Apenas administradores podem acessar essa página.');
          return;
        }
        if (!r.ok) throw new Error(await r.text());
        const d = await r.json();
        setCounts(d.counts || {});
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Falha ao carregar dados'));
  }, []);

  const toggle = (id: CategoryId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === CATEGORIES.length) setSelected(new Set());
    else setSelected(new Set(CATEGORIES.map(c => c.id)));
  };

  const totalSelected = Array.from(selected).reduce(
    (s, id) => s + (counts?.[id] || 0),
    0,
  );

  const canSubmit = selected.size > 0 && confirmText === 'RESETAR' && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/config/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: Array.from(selected), confirm: 'RESETAR' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Erro HTTP ${res.status}`);
      setResult({ total: d.total || 0, summary: d.summary || {} });
      setSelected(new Set());
      setConfirmText('');
      // Recarrega contagem após reset
      fetch('/api/config/reset').then(r => r.json()).then(d => setCounts(d.counts || {})).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao resetar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <div className="mb-6">
        <button
          onClick={() => router.push('/config/agencia')}
          className="text-sm text-[var(--fin-text-3)] hover:text-[var(--fin-text)] mb-3 inline-flex items-center gap-1"
        >
          ← Voltar pra configurações
        </button>
        <h1 className="text-2xl font-bold text-[var(--fin-text)] flex items-center gap-2">
          <Eraser className="w-5 h-5 text-[var(--fin-negative-text)]" />
          Resetar conta
        </h1>
        <p className="text-sm text-[var(--fin-text-2)] mt-1">
          Apague dados operacionais da sua conta de forma seletiva. Esta ação é{' '}
          <strong>irreversível</strong> e não pode ser desfeita.
        </p>
      </div>

      {/* Banner de alerta */}
      <div className="bg-[var(--fin-negative-soft)] border border-[var(--fin-negative)]/30 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[var(--fin-negative-text)] shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--fin-negative-text)]">
            <p className="font-semibold mb-1">Atenção — ação destrutiva</p>
            <ul className="list-disc list-inside text-[var(--fin-negative-text)] text-[13px] space-y-0.5">
              <li>Cadastros de pessoas (clientes, fornecedores, equipe) <strong>não</strong> serão removidos.</li>
              <li>Configurações da agência, usuários, integrações e plano também ficam intactos.</li>
              <li>Recomendado: exportar relatórios financeiros antes de zerar essa categoria.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Resultado do último reset */}
      {result && (
        <div className="bg-[var(--fin-positive-soft)] border border-[var(--fin-positive)]/30 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Check className="w-5 h-5 text-[var(--fin-positive)] shrink-0 mt-0.5" />
            <div className="text-sm text-[var(--fin-positive)]">
              <p className="font-semibold mb-1">Reset concluído</p>
              <p>
                {result.total.toLocaleString('pt-BR')} registros removidos em{' '}
                {Object.keys(result.summary).filter(k => result.summary[k] > 0).length}{' '}
                tabelas.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-[var(--fin-warning-soft)] border border-[var(--fin-warning)]/30 rounded-xl p-3 mb-6 text-sm text-[var(--fin-warning-text)]">
          {error}
        </div>
      )}

      {/* Lista de categorias */}
      <div className="bg-[var(--fin-surface)] rounded-xl border border-[var(--fin-border)] overflow-hidden mb-6 shadow-[var(--fin-e-card)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--fin-border)] bg-[var(--fin-surface-2)]">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--fin-text-2)]">
            O que apagar
          </span>
          <button
            onClick={toggleAll}
            className="text-xs font-medium text-[var(--fin-accent)] hover:text-[var(--fin-accent)]"
          >
            {selected.size === CATEGORIES.length ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>
        </div>
        <ul className="divide-y divide-[var(--fin-border)]">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const isSelected = selected.has(cat.id);
            const count = counts?.[cat.id] ?? null;
            const empty = count === 0;
            return (
              <li key={cat.id}>
                <label
                  className={`flex items-start gap-3 p-4 cursor-pointer transition-colors ${
 isSelected ? 'bg-[var(--fin-negative-soft)]' : 'hover:bg-[var(--fin-surface-2)]'
 } ${empty ? 'opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(cat.id)}
                    disabled={empty}
                    className="mt-1 w-4 h-4 rounded border-[var(--fin-border-strong)] text-[var(--fin-negative-text)] focus:ring-[var(--fin-negative)]"
                  />
                  <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${isSelected ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[var(--fin-text)] text-[14px]">{cat.label}</span>
                      {count !== null && (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${
 empty ? 'bg-[var(--fin-surface-2)] text-[var(--fin-text-3)]' : 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]'
 }`}
                        >
                          {count.toLocaleString('pt-BR')} {count === 1 ? 'registro' : 'registros'}
                        </span>
                      )}
                    </div>
                    <p className="text-[12.5px] text-[var(--fin-text-3)] mt-0.5">{cat.description}</p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Confirmação */}
      {selected.size > 0 && (
        <div className="bg-[var(--fin-surface)] rounded-xl border border-[var(--fin-negative)]/30 p-4 mb-4 shadow-[var(--fin-e-card)]">
          <p className="text-sm text-[var(--fin-text)] mb-2">
            Você vai apagar <strong>{totalSelected.toLocaleString('pt-BR')}</strong> registros em{' '}
            <strong>{selected.size}</strong> categoria{selected.size === 1 ? '' : 's'}.
          </p>
          <p className="text-xs text-[var(--fin-text-2)] mb-3">
            Digite <code className="bg-[var(--fin-surface-2)] px-1.5 py-0.5 rounded font-mono">RESETAR</code> abaixo pra confirmar.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="Digite RESETAR"
            className="w-full px-3 py-2 rounded-md border border-[var(--fin-border-strong)] outline-none focus:border-[var(--fin-negative)] text-sm font-mono"
            autoComplete="off"
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => router.push('/config/agencia')}
          className="px-4 py-2 rounded-md text-sm font-medium text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="px-4 py-2 rounded-md text-sm font-semibold text-[var(--fin-text-on-fill)] bg-[var(--fin-negative)] hover:bg-[var(--fin-negative)] disabled:bg-[var(--fin-surface-sunken)] disabled:text-[var(--fin-text-3)] disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
          {submitting ? 'Apagando...' : 'Apagar dados selecionados'}
        </button>
      </div>
    </div>
  );
}
