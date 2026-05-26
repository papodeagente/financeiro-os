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
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <button
          onClick={() => router.push('/config/agencia')}
          className="text-sm text-slate-500 hover:text-slate-900 mb-3 inline-flex items-center gap-1"
        >
          ← Voltar pra configurações
        </button>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Eraser className="w-5 h-5 text-red-500" />
          Resetar conta
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Apague dados operacionais da sua conta de forma seletiva. Esta ação é{' '}
          <strong>irreversível</strong> e não pode ser desfeita.
        </p>
      </div>

      {/* Banner de alerta */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-900">
            <p className="font-semibold mb-1">Atenção — ação destrutiva</p>
            <ul className="list-disc list-inside text-red-800 text-[13px] space-y-0.5">
              <li>Cadastros de pessoas (clientes, fornecedores, equipe) <strong>não</strong> serão removidos.</li>
              <li>Configurações da agência, usuários, integrações e plano também ficam intactos.</li>
              <li>Recomendado: exportar relatórios financeiros antes de zerar essa categoria.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Resultado do último reset */}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-900">
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
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 text-sm text-amber-900">
          {error}
        </div>
      )}

      {/* Lista de categorias */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            O que apagar
          </span>
          <button
            onClick={toggleAll}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            {selected.size === CATEGORIES.length ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>
        </div>
        <ul className="divide-y divide-slate-100">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const isSelected = selected.has(cat.id);
            const count = counts?.[cat.id] ?? null;
            const empty = count === 0;
            return (
              <li key={cat.id}>
                <label
                  className={`flex items-start gap-3 p-4 cursor-pointer transition-colors ${
                    isSelected ? 'bg-red-50' : 'hover:bg-slate-50'
                  } ${empty ? 'opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(cat.id)}
                    disabled={empty}
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                  />
                  <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${isSelected ? 'text-red-600' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900 text-[14px]">{cat.label}</span>
                      {count !== null && (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${
                            empty ? 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {count.toLocaleString('pt-BR')} {count === 1 ? 'registro' : 'registros'}
                        </span>
                      )}
                    </div>
                    <p className="text-[12.5px] text-slate-500 mt-0.5">{cat.description}</p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Confirmação */}
      {selected.size > 0 && (
        <div className="bg-white rounded-xl border border-red-200 p-4 mb-4">
          <p className="text-sm text-slate-900 mb-2">
            Você vai apagar <strong>{totalSelected.toLocaleString('pt-BR')}</strong> registros em{' '}
            <strong>{selected.size}</strong> categoria{selected.size === 1 ? '' : 's'}.
          </p>
          <p className="text-xs text-slate-600 mb-3">
            Digite <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">RESETAR</code> abaixo pra confirmar.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="Digite RESETAR"
            className="w-full px-3 py-2 rounded-md border border-slate-300 outline-none focus:border-red-500 text-sm font-mono"
            autoComplete="off"
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => router.push('/config/agencia')}
          className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="px-4 py-2 rounded-md text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
          {submitting ? 'Apagando...' : 'Apagar dados selecionados'}
        </button>
      </div>
    </div>
  );
}
