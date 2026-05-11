'use client';

import { GrupoViagem, StatusPipeline } from '@/lib/types';
import { calcProposta } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Package, FileText, ClipboardList, BadgeDollarSign,
  ExternalLink, Loader2, CheckCircle2, Circle,
} from 'lucide-react';
import { GrupoSyncStatus } from '@/components/GrupoSyncStatus';

interface Props {
  grupo: GrupoViagem;
  onGerarProposta: () => void;
  onGerarOrcamento: () => void;
  onFecharVenda: () => void;
  gerandoProposta: boolean;
}

// 4 estágios — RESERVA foi removida. Produtos legados com status='RESERVA'
// são tratados como ORCAMENTO na UI (migração silenciosa em /grupo/[id]/page).
const PIPELINE_STEPS: { key: Exclude<StatusPipeline, 'RESERVA'>; label: string; icon: typeof Package; descricao: string }[] = [
  { key: 'PRODUTO',   label: 'Produto',    icon: Package,          descricao: 'Planejamento, precificação e cálculo de margem' },
  { key: 'PROPOSTA',  label: 'Proposta',   icon: FileText,         descricao: 'Documento visual enviado ao cliente' },
  { key: 'ORCAMENTO', label: 'Orçamento',  icon: ClipboardList,    descricao: 'Card no funil do CRM — sem efeito financeiro' },
  { key: 'VENDA',     label: 'Venda',      icon: BadgeDollarSign,  descricao: 'Marcada no CRM, gera contas no Financeiro' },
];

const STATUS_COLORS: Record<Exclude<StatusPipeline, 'RESERVA'>, string> = {
  PRODUTO: 'bg-gray-500',
  PROPOSTA: 'bg-blue-500',
  ORCAMENTO: 'bg-amber-500',
  VENDA: 'bg-green-500',
};

// Normaliza status legado RESERVA para ORCAMENTO (mesmo nó visual).
function normalizeStatus(s: StatusPipeline | undefined): Exclude<StatusPipeline, 'RESERVA'> {
  if (!s || s === 'RESERVA') return s === 'RESERVA' ? 'ORCAMENTO' : 'PRODUTO';
  return s;
}

function getStepState(stepKey: Exclude<StatusPipeline, 'RESERVA'>, currentStatus: Exclude<StatusPipeline, 'RESERVA'>): 'completed' | 'active' | 'pending' {
  const order = PIPELINE_STEPS.map(s => s.key);
  const currentIdx = order.indexOf(currentStatus);
  const stepIdx = order.indexOf(stepKey);
  if (stepIdx < currentIdx) return 'completed';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

function countServices(grupo: GrupoViagem) {
  const counts: { emoji: string; label: string; count: number }[] = [];
  const tktCount = grupo.tkt.trechos.filter(t => t.fontes.some(f => f.valor_adt !== null && f.valor_adt > 0)).length;
  if (tktCount > 0) counts.push({ emoji: '✈️', label: 'Aereo', count: tktCount });
  const htlCount = grupo.htl.hoteis.filter(h => h.fontes.some(f => f.valor_dbl !== null && f.valor_dbl > 0)).length;
  if (htlCount > 0) counts.push({ emoji: '🏨', label: 'Hotel', count: htlCount });
  const recCount = grupo.rec.passeios.filter(p => p.fornecedores.some(f => f.valor_adt !== null && f.valor_adt > 0)).length;
  if (recCount > 0) counts.push({ emoji: '🎯', label: 'Receptivo', count: recCount });
  const carCount = grupo.car.transportes.filter(t => t.empresas.some(e => e.valor_veiculo !== null && e.valor_veiculo > 0)).length;
  if (carCount > 0) counts.push({ emoji: '🚐', label: 'Carro', count: carCount });
  const guiaCount = grupo.guia.destinos.filter(d => d.fornecedores.some(f => f.valor_total !== null && f.valor_total > 0)).length;
  if (guiaCount > 0) counts.push({ emoji: '🧑‍🏫', label: 'Guia', count: guiaCount });
  const hasSeg = grupo.seg.seguradoras.some(s => s.valor_sgl !== null && s.valor_sgl > 0);
  if (hasSeg) counts.push({ emoji: '🛡️', label: 'Seguro', count: 1 });
  const hasNavio = grupo.navio.fornecedores.some(f => f.valor_dbl !== null && f.valor_dbl > 0);
  if (hasNavio) counts.push({ emoji: '🚢', label: 'Navio', count: 1 });
  const ingCount = grupo.ing.atrativos.filter(a => a.fontes.some(f => f.valor_adt !== null && f.valor_adt > 0)).length;
  if (ingCount > 0) counts.push({ emoji: '🎟️', label: 'Ingresso', count: ingCount });
  const hasBrinde = grupo.brinde.fornecedores.some(f => f.valor_unidade !== null && f.valor_unidade > 0);
  if (hasBrinde) counts.push({ emoji: '🎁', label: 'Brinde', count: 1 });
  return counts;
}

export function PainelPipelineTab({ grupo, onGerarProposta, onGerarOrcamento, onFecharVenda, gerandoProposta }: Props) {
  const status = normalizeStatus(grupo.status_pipeline);
  const pricing = calcProposta(grupo);
  const dblAvista = pricing.totalPaxAvista['dbl'] || 0;
  const services = countServices(grupo);

  return (
    <div className="space-y-8">
      {/* Pipeline Visual — 4 estagios */}
      <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-6">
        <h3 className="text-sm font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-6">
          Fluxo de venda
        </h3>

        <div className="flex items-center justify-between">
          {PIPELINE_STEPS.map((step, i) => {
            const state = getStepState(step.key, status);
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center gap-2 flex-1">
                  <div className={`
                    w-12 h-12 rounded-full flex items-center justify-center transition-all
                    ${state === 'completed' ? 'bg-[var(--t-status-success-bg)] border-2 border-green-500' : ''}
                    ${state === 'active' ? `${STATUS_COLORS[step.key]} text-white shadow-lg scale-110` : ''}
                    ${state === 'pending' ? 'bg-[var(--t-bg)] border-2 border-[var(--t-border)]' : ''}
                  `}>
                    {state === 'completed' ? (
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    ) : state === 'active' ? (
                      <Icon className="w-6 h-6" />
                    ) : (
                      <Circle className="w-6 h-6 text-[var(--t-text-muted)] opacity-40" />
                    )}
                  </div>
                  <span className={`text-xs font-medium ${state === 'active' ? 'text-[var(--t-accent)]' : state === 'completed' ? 'text-green-600' : 'text-[var(--t-text-muted)]'}`}>
                    {step.label}
                  </span>
                  <span className="text-[10px] text-[var(--t-text-muted)] text-center max-w-[120px] leading-tight">
                    {step.descricao}
                  </span>
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <div className={`h-[2px] flex-1 mx-1 transition-colors -translate-y-6 ${
                    getStepState(PIPELINE_STEPS[i + 1].key, status) !== 'pending'
                      ? 'bg-green-400'
                      : 'bg-[var(--t-border)]'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cards de cada etapa */}
      <div className="grid gap-4">
        {/* PRODUTO */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-[var(--t-text-muted)]" />
              <h4 className="font-semibold text-[var(--t-text)]">Produto</h4>
              {getStepState('PRODUTO', status) !== 'pending' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
              <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] ml-2">Entur OS</span>
            </div>
            {dblAvista > 0 && (
              <div className="text-right">
                <div className="text-xs text-[var(--t-text-muted)]">PAX (DBL) a vista</div>
                <div className="text-lg font-bold text-[var(--t-accent)]">{formatBRL(dblAvista)}</div>
              </div>
            )}
          </div>
          {services.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {services.map(s => (
                <span key={s.label} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--t-bg)] text-xs text-[var(--t-text)]">
                  {s.emoji} {s.count} {s.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--t-text-muted)]">Nenhum servico preenchido ainda. Preencha as abas de servico.</p>
          )}
          {/* Status de sincronização com CRM */}
          <div className="mt-3 pt-3 border-t border-[var(--t-border)]">
            <GrupoSyncStatus grupoId={grupo.id} />
          </div>
        </div>

        {/* PROPOSTA */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              <h4 className="font-semibold text-[var(--t-text)]">Proposta Visual</h4>
              {getStepState('PROPOSTA', status) === 'completed' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
              <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] ml-2">Entur OS</span>
            </div>
          </div>
          {grupo.proposta_id ? (
            <div className="flex items-center gap-3">
              <a href={`/propostas/${grupo.proposta_id}`} className="inline-flex items-center gap-1 text-sm text-[var(--t-accent)] hover:underline">
                <ExternalLink className="w-3 h-3" /> Editar proposta
              </a>
              <Button onClick={onGerarProposta} variant="outline" size="sm" disabled={gerandoProposta} className="text-xs">
                {gerandoProposta ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Regerar
              </Button>
            </div>
          ) : (
            <Button onClick={onGerarProposta} size="sm" disabled={gerandoProposta || services.length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1">
              {gerandoProposta ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Gerar Proposta
            </Button>
          )}
        </div>

        {/* ORCAMENTO */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-amber-500" />
              <h4 className="font-semibold text-[var(--t-text)]">Orçamento</h4>
              {getStepState('ORCAMENTO', status) === 'completed' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
              <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] ml-2">CRM</span>
            </div>
          </div>
          {grupo.orcamento_id ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 text-sm text-[var(--t-text-secondary)]">
                <ExternalLink className="w-3 h-3" /> Negociação aberta no CRM ({grupo.orcamento_id})
              </span>
              <Button onClick={onGerarOrcamento} variant="outline" size="sm" className="text-xs">Atualizar</Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--t-text-muted)] mb-2">
                Este estágio acontece no CRM — quando o vendedor anexa o produto a um card de negociação. Sem efeito financeiro.
              </p>
              <Button onClick={onGerarOrcamento} size="sm" disabled={!grupo.proposta_id}
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1">
                <ClipboardList className="w-4 h-4" /> Marcar como orçamento
              </Button>
              {!grupo.proposta_id && (
                <p className="text-xs text-[var(--t-text-muted)] mt-2">Gere uma proposta primeiro.</p>
              )}
            </>
          )}
        </div>

        {/* VENDA */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BadgeDollarSign className="w-5 h-5 text-green-500" />
              <h4 className="font-semibold text-[var(--t-text)]">Venda</h4>
              {status === 'VENDA' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
              <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] ml-2">CRM → Financeiro</span>
            </div>
          </div>
          {grupo.venda_crm_id ? (
            <a href={`/vendas`} className="inline-flex items-center gap-1 text-sm text-[var(--t-accent)] hover:underline">
              <ExternalLink className="w-3 h-3" /> Ver venda
            </a>
          ) : (
            <>
              <p className="text-sm text-[var(--t-text-muted)] mb-2">
                A venda é fechada no CRM. Ao marcar como ganha, o Financeiro recebe automaticamente e gera as contas a pagar/receber.
              </p>
              <Button onClick={onFecharVenda} size="sm" disabled={status !== 'ORCAMENTO'}
                className="bg-green-600 hover:bg-green-700 text-white gap-1">
                <BadgeDollarSign className="w-4 h-4" /> Marcar venda manualmente
              </Button>
              {status !== 'ORCAMENTO' && status !== 'VENDA' && (
                <p className="text-xs text-[var(--t-text-muted)] mt-2">Anexe ao orçamento (CRM) primeiro.</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Resumo financeiro rápido */}
      {dblAvista > 0 && (
        <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] rounded-xl p-5">
          <h4 className="text-xs uppercase tracking-wider text-[var(--t-accent)] mb-3">Resumo de Precos (por PAX)</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(['sgl', 'dbl', 'tpl', 'qdp'] as const).map(t => {
              const v = pricing.totalPaxAvista[t] || 0;
              if (v <= 0) return null;
              return (
                <div key={t}>
                  <div className="text-xs text-[var(--t-text-secondary)]">{t.toUpperCase()} a vista</div>
                  <div className="text-lg font-bold">{formatBRL(v)}</div>
                  {grupo.params.parcelas > 1 && (
                    <div className="text-xs text-[var(--t-text-secondary)]">
                      {grupo.params.parcelas}x {formatBRL(pricing.parcelaPaxCC[t] || 0)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
