'use client';

import { GrupoViagem, StatusPipeline } from '@/lib/types';
import { calcProposta } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Package, FileText, ClipboardList, BookmarkCheck, BadgeDollarSign,
  ChevronRight, ExternalLink, Loader2, CheckCircle2, Circle,
} from 'lucide-react';

interface Props {
  grupo: GrupoViagem;
  onGerarProposta: () => void;
  onGerarOrcamento: () => void;
  onCriarReserva: () => void;
  onFecharVenda: () => void;
  gerandoProposta: boolean;
}

const PIPELINE_STEPS: { key: StatusPipeline; label: string; icon: typeof Package }[] = [
  { key: 'PRODUTO', label: 'Produto', icon: Package },
  { key: 'PROPOSTA', label: 'Proposta', icon: FileText },
  { key: 'ORCAMENTO', label: 'Orçamento', icon: ClipboardList },
  { key: 'RESERVA', label: 'Reserva', icon: BookmarkCheck },
  { key: 'VENDA', label: 'Venda', icon: BadgeDollarSign },
];

const STATUS_COLORS: Record<StatusPipeline, string> = {
  PRODUTO: 'bg-gray-500',
  PROPOSTA: 'bg-blue-500',
  ORCAMENTO: 'bg-amber-500',
  RESERVA: 'bg-purple-500',
  VENDA: 'bg-green-500',
};

function getStepState(stepKey: StatusPipeline, currentStatus: StatusPipeline): 'completed' | 'active' | 'pending' {
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

export function PainelPipelineTab({ grupo, onGerarProposta, onGerarOrcamento, onCriarReserva, onFecharVenda, gerandoProposta }: Props) {
  const status = grupo.status_pipeline || 'PRODUTO';
  const pricing = calcProposta(grupo);
  const dblAvista = pricing.totalPaxAvista['dbl'] || 0;
  const services = countServices(grupo);

  return (
    <div className="space-y-8">
      {/* Pipeline Visual */}
      <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-6">
        <h3 className="text-sm font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-6">Pipeline de Venda</h3>

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
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <div className={`h-[2px] flex-1 mx-1 transition-colors ${
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
        </div>

        {/* PROPOSTA */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              <h4 className="font-semibold text-[var(--t-text)]">Proposta Visual</h4>
              {getStepState('PROPOSTA', status) === 'completed' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
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
              <h4 className="font-semibold text-[var(--t-text)]">Orcamento</h4>
              {getStepState('ORCAMENTO', status) === 'completed' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
            </div>
          </div>
          {grupo.orcamento_id ? (
            <div className="flex items-center gap-3">
              <a href={`/vendas/orcamentos`} className="inline-flex items-center gap-1 text-sm text-[var(--t-accent)] hover:underline">
                <ExternalLink className="w-3 h-3" /> Ver orcamento
              </a>
              <Button onClick={onGerarOrcamento} variant="outline" size="sm" className="text-xs">Regerar</Button>
            </div>
          ) : (
            <Button onClick={onGerarOrcamento} size="sm" disabled={!grupo.proposta_id}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-1">
              <ClipboardList className="w-4 h-4" /> Gerar Orcamento
            </Button>
          )}
          {!grupo.proposta_id && (
            <p className="text-xs text-[var(--t-text-muted)] mt-2">Gere uma proposta primeiro para criar o orcamento.</p>
          )}
        </div>

        {/* RESERVA */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookmarkCheck className="w-5 h-5 text-purple-500" />
              <h4 className="font-semibold text-[var(--t-text)]">Reserva</h4>
              {getStepState('RESERVA', status) === 'completed' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
            </div>
          </div>
          <Button onClick={onCriarReserva} size="sm" disabled={!grupo.orcamento_id}
            className="bg-purple-600 hover:bg-purple-700 text-white gap-1">
            <BookmarkCheck className="w-4 h-4" /> Criar Reserva
          </Button>
          {!grupo.orcamento_id && (
            <p className="text-xs text-[var(--t-text-muted)] mt-2">Gere um orcamento primeiro.</p>
          )}
        </div>

        {/* VENDA */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BadgeDollarSign className="w-5 h-5 text-green-500" />
              <h4 className="font-semibold text-[var(--t-text)]">Venda</h4>
              {status === 'VENDA' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
            </div>
          </div>
          {grupo.venda_crm_id ? (
            <a href={`/vendas`} className="inline-flex items-center gap-1 text-sm text-[var(--t-accent)] hover:underline">
              <ExternalLink className="w-3 h-3" /> Ver venda
            </a>
          ) : (
            <Button onClick={onFecharVenda} size="sm" disabled={status !== 'RESERVA'}
              className="bg-green-600 hover:bg-green-700 text-white gap-1">
              <BadgeDollarSign className="w-4 h-4" /> Fechar Venda
            </Button>
          )}
          {status !== 'RESERVA' && status !== 'VENDA' && (
            <p className="text-xs text-[var(--t-text-muted)] mt-2">Crie uma reserva primeiro.</p>
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
                  {grupo.params.parcelas > 0 && (
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
