'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, MessageSquare, ClipboardList, Check, ChevronDown, Sparkles } from 'lucide-react';

interface Anotacao {
  id: string;
  autor_id: string;
  autor_nome: string;
  texto: string;
  origem: string;          // 'manual' | 'sistema' | 'proposta_publica'
  tipo_evento: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

interface Tarefa {
  id: string;
  venda_id: string;
  responsavel_id: string;
  titulo: string;
  descricao: string;
  status: 'pendente' | 'em_andamento' | 'concluida' | 'cancelada';
  prioridade: 'baixa' | 'normal' | 'alta' | 'urgente';
  origem: string;
  data_vencimento: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

interface Props {
  vendaId: string;
}

const PRIORIDADE_COLOR: Record<string, string> = {
  baixa: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)] border-[var(--fin-border)]',
  normal: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)] border-[var(--fin-accent)]/30',
  alta: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)] border-[var(--fin-warning)]/30',
  urgente: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] border-[var(--fin-negative)]/30',
};
const STATUS_COLOR: Record<string, string> = {
  pendente: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)] border-[var(--fin-warning)]/30',
  em_andamento: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)] border-[var(--fin-accent)]/30',
  concluida: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)] border-[var(--fin-positive)]/30',
  cancelada: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-3)] border-[var(--fin-border)]',
};

export function NegociacaoAtividade({ vendaId }: Props) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [anotacoes, setAnotacoes] = useState<Anotacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [novaAnotacao, setNovaAnotacao] = useState('');
  const [savingAnotacao, setSavingAnotacao] = useState(false);
  const [novaTarefa, setNovaTarefa] = useState({ titulo: '', descricao: '', data_vencimento: '' });
  const [savingTarefa, setSavingTarefa] = useState(false);
  const [showNovaTarefa, setShowNovaTarefa] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [aRes, tRes] = await Promise.all([
        fetch(`/api/vendas-crm/${vendaId}/anotacoes`).then(r => r.json()),
        fetch(`/api/vendas-crm/${vendaId}/tarefas`).then(r => r.json()),
      ]);
      setAnotacoes(Array.isArray(aRes) ? aRes : []);
      setTarefas(Array.isArray(tRes) ? tRes : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [vendaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvarAnotacao = async () => {
    if (!novaAnotacao.trim() || savingAnotacao) return;
    setSavingAnotacao(true);
    try {
      await fetch(`/api/vendas-crm/${vendaId}/anotacoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: novaAnotacao.trim() }),
      });
      setNovaAnotacao('');
      await carregar();
    } catch { /* ignore */ }
    setSavingAnotacao(false);
  };

  const salvarTarefa = async () => {
    if (!novaTarefa.titulo.trim() || savingTarefa) return;
    setSavingTarefa(true);
    try {
      await fetch(`/api/vendas-crm/${vendaId}/tarefas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: novaTarefa.titulo.trim(),
          descricao: novaTarefa.descricao.trim(),
          data_vencimento: novaTarefa.data_vencimento || null,
        }),
      });
      setNovaTarefa({ titulo: '', descricao: '', data_vencimento: '' });
      setShowNovaTarefa(false);
      await carregar();
    } catch { /* ignore */ }
    setSavingTarefa(false);
  };

  const mudarStatusTarefa = async (tarefa: Tarefa, status: Tarefa['status']) => {
    try {
      await fetch(`/api/vendas-crm/${vendaId}/tarefas`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tarefa_id: tarefa.id, status }),
      });
      await carregar();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-[var(--t-text-muted)]">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  const tarefasPendentes = tarefas.filter(t => t.status !== 'concluida' && t.status !== 'cancelada');
  const tarefasFinalizadas = tarefas.filter(t => t.status === 'concluida' || t.status === 'cancelada');

  return (
    <div className="space-y-6">
      {/* ======= TAREFAS ======= */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--t-text)]">
            <ClipboardList className="w-4 h-4 text-[var(--fin-accent)]" />
            Tarefas ({tarefasPendentes.length} pendente{tarefasPendentes.length !== 1 ? 's' : ''})
          </h4>
          <button
            onClick={() => setShowNovaTarefa(v => !v)}
            className="text-[11px] flex items-center gap-1 text-[var(--fin-accent)] hover:text-[var(--fin-accent)]"
          >
            <Plus className="w-3.5 h-3.5" /> Nova tarefa
          </button>
        </div>

        {showNovaTarefa && (
          <div className="bg-[var(--t-bg)] border border-[var(--t-border)] rounded-lg p-3 mb-3 space-y-2">
            <input
              value={novaTarefa.titulo}
              onChange={e => setNovaTarefa(t => ({ ...t, titulo: e.target.value }))}
              placeholder="Título da tarefa"
              className="w-full px-3 py-2 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-md text-sm"
            />
            <textarea
              value={novaTarefa.descricao}
              onChange={e => setNovaTarefa(t => ({ ...t, descricao: e.target.value }))}
              placeholder="Descrição (opcional)"
              rows={2}
              className="w-full px-3 py-2 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-md text-sm resize-none"
            />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={novaTarefa.data_vencimento}
                onChange={e => setNovaTarefa(t => ({ ...t, data_vencimento: e.target.value }))}
                className="px-2 py-1.5 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-md text-xs"
              />
              <button
                onClick={salvarTarefa}
                disabled={!novaTarefa.titulo.trim() || savingTarefa}
                className="ml-auto px-3 py-1.5 bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] rounded-md text-xs font-medium disabled:opacity-50"
              >
                {savingTarefa ? 'Salvando...' : 'Criar'}
              </button>
              <button
                onClick={() => setShowNovaTarefa(false)}
                className="px-3 py-1.5 text-[var(--t-text-muted)] text-xs"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {tarefas.length === 0 ? (
          <p className="text-xs text-[var(--t-text-muted)] py-4 text-center">Sem tarefas. Crie uma acima.</p>
        ) : (
          <div className="space-y-2">
            {[...tarefasPendentes, ...tarefasFinalizadas].map(t => (
              <TarefaCard key={t.id} tarefa={t} onMudarStatus={mudarStatusTarefa} />
            ))}
          </div>
        )}
      </div>

      {/* ======= ANOTAÇÕES ======= */}
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--t-text)] mb-3">
          <MessageSquare className="w-4 h-4 text-[var(--fin-positive)]" />
          Anotações ({anotacoes.length})
        </h4>

        <div className="flex gap-2 mb-3">
          <input
            value={novaAnotacao}
            onChange={e => setNovaAnotacao(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) salvarAnotacao(); }}
            placeholder="Adicionar anotação..."
            className="flex-1 px-3 py-2 bg-[var(--t-bg)] border border-[var(--t-border)] rounded-md text-sm"
          />
          <button
            onClick={salvarAnotacao}
            disabled={!novaAnotacao.trim() || savingAnotacao}
            className="px-3 py-2 bg-[var(--fin-positive)] text-[var(--fin-text-on-fill)] rounded-md text-xs font-medium disabled:opacity-50"
          >
            {savingAnotacao ? '...' : 'Salvar'}
          </button>
        </div>

        {anotacoes.length === 0 ? (
          <p className="text-xs text-[var(--t-text-muted)] py-4 text-center">Sem anotações ainda.</p>
        ) : (
          <div className="space-y-2">
            {anotacoes.map(a => (
              <AnotacaoCard key={a.id} anotacao={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TarefaCard({ tarefa, onMudarStatus }: {
  tarefa: Tarefa;
  onMudarStatus: (t: Tarefa, s: Tarefa['status']) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const concluida = tarefa.status === 'concluida' || tarefa.status === 'cancelada';
  return (
    <div className={`border rounded-lg ${concluida ? 'bg-[var(--fin-surface-2)]/50 border-[var(--fin-border)] opacity-70' : 'bg-[var(--t-bg)] border-[var(--t-border)]'}`}>
      <div className="flex items-start gap-2 p-3">
        <button
          onClick={() => onMudarStatus(tarefa, tarefa.status === 'concluida' ? 'pendente' : 'concluida')}
          className={`shrink-0 mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
 concluida ? 'bg-[var(--fin-positive)] border-[var(--fin-positive)]' : 'border-[var(--fin-border-strong)] hover:border-[var(--fin-positive)]'
 }`}
          title={concluida ? 'Reabrir' : 'Concluir'}
        >
          {concluida && <Check className="w-3 h-3 text-white" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-medium ${concluida ? 'line-through text-[var(--fin-text-3)]' : 'text-[var(--t-text)]'}`}>
              {tarefa.titulo}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-bold ${PRIORIDADE_COLOR[tarefa.prioridade]}`}>
                {tarefa.prioridade}
              </span>
              {tarefa.origem === 'sistema' && (
                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded border font-bold bg-[var(--fin-violet-soft)] text-[var(--fin-violet)] border-[var(--fin-violet)]/30 inline-flex items-center gap-0.5">
                  <Sparkles className="w-2.5 h-2.5" /> auto
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--t-text-muted)]">
            <span className={`px-1.5 py-0.5 rounded border font-bold uppercase ${STATUS_COLOR[tarefa.status]}`}>
              {tarefa.status.replace('_', ' ')}
            </span>
            <span>· {new Date(tarefa.created_at).toLocaleString('pt-BR')}</span>
            {tarefa.data_vencimento && (
              <span>· Vence: {new Date(tarefa.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
            )}
          </div>
          {tarefa.descricao && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-1.5 text-[11px] text-[var(--fin-accent)] hover:text-[var(--fin-accent)] inline-flex items-center gap-0.5"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? 'Ocultar' : 'Ver descrição'}
            </button>
          )}
          {expanded && tarefa.descricao && (
            <pre className="mt-2 text-xs text-[var(--t-text-secondary)] whitespace-pre-wrap font-sans bg-[var(--t-surface)] border border-[var(--t-border)] rounded p-3">
              {tarefa.descricao}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function AnotacaoCard({ anotacao }: { anotacao: Anotacao }) {
  const origemSistema = anotacao.origem === 'sistema' || anotacao.origem === 'proposta_publica';
  const tipoCor = anotacao.tipo_evento === 'aceite'
    ? 'border-l-[var(--fin-positive)] bg-[var(--fin-positive-soft)]'
    : anotacao.tipo_evento === 'alteracao'
      ? 'border-l-[var(--fin-accent)] bg-[var(--fin-accent-soft)]'
      : 'border-l-[var(--fin-border-strong)]';
  return (
    <div className={`border border-[var(--t-border)] border-l-4 rounded-lg p-3 ${tipoCor}`}>
      <div className="flex items-center gap-2 mb-1 text-[10px] text-[var(--t-text-muted)]">
        <span className="font-semibold">{anotacao.autor_nome || 'Sistema'}</span>
        {origemSistema && (
          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded border font-bold bg-[var(--fin-violet-soft)] text-[var(--fin-violet)] border-[var(--fin-violet)]/30 inline-flex items-center gap-0.5">
            <Sparkles className="w-2.5 h-2.5" /> {anotacao.origem === 'proposta_publica' ? 'proposta pública' : 'auto'}
          </span>
        )}
        <span>· {new Date(anotacao.created_at).toLocaleString('pt-BR')}</span>
      </div>
      <pre className="text-xs text-[var(--t-text)] whitespace-pre-wrap font-sans leading-relaxed">{anotacao.texto}</pre>
    </div>
  );
}
