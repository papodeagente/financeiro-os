'use client';

import { useEffect, useState } from 'react';
import { GrupoViagem } from '@/lib/types';
import { calcProposta } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';
import { Users } from 'lucide-react';

interface VagasResumo {
  total: number;
  reservadas: number;
  confirmadas: number;
  disponiveis: number;
  alerta: number;
}

export function FloatingResume({ grupo }: { grupo: GrupoViagem }) {
  const proposta = calcProposta(grupo);
  const dblAvista = proposta.totalPaxAvista['dbl'] || 0;
  const dblCartao = proposta.parcelaPaxCC['dbl'] || 0;
  const parcelas = grupo.params.parcelas;

  const [vagas, setVagas] = useState<VagasResumo | null>(null);

  // Carrega resumo de vagas da gestão sob demanda. Falha silenciosa quando
  // a gestão ainda não existe (grupo antigo) — só não mostra o bloco.
  useEffect(() => {
    let alive = true;
    fetch(`/api/gestao-grupos/${grupo.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!alive || !json) return;
        const total = (json.periodos as Array<{ vagas_total: number; vagas_reservadas: number; vagas_confirmadas: number; vagas_disponiveis: number }>)
          .reduce((s, p) => s + p.vagas_total, 0);
        const reservadas = json.periodos.reduce((s: number, p: { vagas_reservadas: number }) => s + p.vagas_reservadas, 0);
        const confirmadas = json.periodos.reduce((s: number, p: { vagas_confirmadas: number }) => s + p.vagas_confirmadas, 0);
        const disponiveis = json.periodos.reduce((s: number, p: { vagas_disponiveis: number }) => s + p.vagas_disponiveis, 0);
        const alerta = json.gestao?.config_vagas?.alerta_vagas_restantes ?? 5;
        setVagas({ total, reservadas, confirmadas, disponiveis, alerta });
      })
      .catch(() => { /* silent */ });
    return () => { alive = false; };
  }, [grupo.id]);

  if (dblAvista === 0 && !vagas) return null;

  const corVagas = vagas
    ? vagas.disponiveis === 0 && vagas.total > 0
      ? 'var(--neg)'
      : vagas.disponiveis <= vagas.alerta
        ? 'var(--warn)'
        : 'var(--pos)'
    : '';

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-[var(--t-header-bg)] text-[var(--t-header-text)] rounded-xl shadow-2xl p-4 min-w-[240px] border border-[var(--t-accent)]/30 space-y-3">
      {dblAvista > 0 && (
        <div>
          <div className="text-xs text-[var(--t-accent)] font-semibold mb-1">Preço por PAX (DBL)</div>
          <div className="text-xl font-bold">{formatBRL(dblAvista)}</div>
          <div className="text-xs text-[var(--t-text-secondary)] mt-1">
            ou {parcelas}x de {formatBRL(dblCartao)}
          </div>
        </div>
      )}

      {vagas && vagas.total > 0 && (
        <div className={dblAvista > 0 ? 'pt-3 border-t border-[var(--t-accent)]/20' : ''}>
          <div className="flex items-center gap-1.5 text-xs text-[var(--t-accent)] font-semibold mb-1">
            <Users className="w-3 h-3" /> Gestão do grupo
          </div>
          <div className="text-sm">
            <span className="font-bold mono" style={{ color: corVagas }}>{vagas.disponiveis}</span>
            <span className="text-[var(--t-text-secondary)]"> de {vagas.total} vagas livres</span>
          </div>
          <div className="text-[11px] text-[var(--t-text-secondary)] mt-1">
            {vagas.reservadas} reservadas · <b style={{ color: 'var(--pos)' }}>{vagas.confirmadas} confirmadas</b>
          </div>
        </div>
      )}
    </div>
  );
}
