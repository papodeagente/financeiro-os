'use client';

import { useEffect, useState } from 'react';
import { GrupoViagem } from '@/lib/types';
import { calcProposta, type PropostaResult } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';
import { Users } from 'lucide-react';

interface VagasResumo {
  total: number;
  reservadas: number;
  confirmadas: number;
  disponiveis: number;
  alerta: number;
}

const TIPO_LABEL: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };

// Escolhe o tipo de apto de referência pro FloatingResume.
// Antes era hardcoded 'dbl' — agora respeita o que o produto realmente
// tem configurado (tarifas_ativas + valor preenchido).
function escolherTipoApto(g: GrupoViagem, p: PropostaResult): string {
  // OPERADORA: pacote único — todos os tipos têm o mesmo valor.
  // Usa a primeira tarifa ativa só pra rotular ("DBL"/"TPL" no header).
  if (g.tipo === 'OPERADORA') return (g.tarifas_ativas?.[0] as string) || 'dbl';

  // Tarifas ativas em ordem: pega a primeira que tem valor preenchido.
  const tarifas = (g.tarifas_ativas as string[] | undefined) || ['sgl', 'dbl', 'tpl', 'qdp'];
  for (const t of tarifas) {
    if ((p.totalPaxAvista[t] || 0) > 0) return t;
  }
  // Fallback: qualquer tipo que tenha valor > 0
  for (const t of ['sgl', 'dbl', 'tpl', 'qdp']) {
    if ((p.totalPaxAvista[t] || 0) > 0) return t;
  }
  return tarifas[0] || 'dbl';
}

export function FloatingResume({ grupo }: { grupo: GrupoViagem }) {
  const proposta = calcProposta(grupo);
  const tipo = escolherTipoApto(grupo, proposta);
  const valorAvista = proposta.totalPaxAvista[tipo] || 0;
  const valorCartao = proposta.parcelaPaxCC[tipo] || 0;
  const parcelas = grupo.params.parcelas;
  const labelTipo = TIPO_LABEL[tipo] || tipo.toUpperCase();

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

  if (valorAvista === 0 && !vagas) return null;

  const corVagas = vagas
    ? vagas.disponiveis === 0 && vagas.total > 0
      ? 'var(--neg)'
      : vagas.disponiveis <= vagas.alerta
        ? 'var(--warn)'
        : 'var(--pos)'
    : '';

  return (
    <div
      className="lg-glass-thick fixed bottom-4 right-4 z-50 p-4 min-w-[240px] space-y-3"
      style={{ color: 'var(--lg-text)' }}
    >
      {valorAvista > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] font-semibold mb-1" style={{ color: 'var(--lg-accent)' }}>
            {grupo.tipo === 'OPERADORA' ? 'Preço do pacote' : `Preço por PAX (${labelTipo})`}
          </div>
          <div className="text-xl font-bold tabular-nums" style={{ color: 'var(--lg-text)' }}>{formatBRL(valorAvista)}</div>
          {parcelas > 1 && valorCartao > 0 && (
            <div className="text-xs mt-1" style={{ color: 'var(--lg-text-2)' }}>
              ou {parcelas}x de <span className="tabular-nums">{formatBRL(valorCartao)}</span>
            </div>
          )}
        </div>
      )}

      {vagas && vagas.total > 0 && (
        <div
          className={valorAvista > 0 ? 'pt-3' : ''}
          style={{ borderTop: valorAvista > 0 ? '1px solid var(--lg-border-base)' : undefined }}
        >
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] font-semibold mb-1" style={{ color: 'var(--lg-accent)' }}>
            <Users className="w-3 h-3" /> Gestão do grupo
          </div>
          <div className="text-sm">
            <span className="font-bold mono" style={{ color: corVagas }}>{vagas.disponiveis}</span>
            <span style={{ color: 'var(--lg-text-2)' }}> de {vagas.total} vagas livres</span>
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--lg-text-2)' }}>
            {vagas.reservadas} reservadas · <b style={{ color: 'var(--lg-pos)' }}>{vagas.confirmadas} confirmadas</b>
          </div>
        </div>
      )}
    </div>
  );
}
