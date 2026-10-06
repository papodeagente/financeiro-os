'use client';

import { comAlfa } from '@/lib/cor';
import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Users,
  Target,
  TrendingUp,
  Zap,
  BarChart3,
  Settings2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { GrupoViagem } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { calcIndicadores } from '@/lib/financial-calculations';

interface IndicadoresTabProps {
  grupo: GrupoViagem;
  onChange?: (g: GrupoViagem) => void;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full bg-[var(--t-border)] rounded-full h-3 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ElementType;
  color?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <div
          className="p-2 rounded-lg"
          style={{ backgroundColor: comAlfa(color ?? 'var(--fin-accent)', 12) }}
        >
          <Icon className="h-4 w-4" style={{ color: color ?? 'var(--fin-accent)' }} />
        </div>
      )}
      <div>
        <p className="text-xs text-[var(--t-text-secondary)]">{label}</p>
        <p className="text-lg font-bold" style={{ color: color ?? 'var(--fin-surface)' }}>
          {value}
        </p>
        {subtitle && <p className="text-xs text-[var(--t-text-secondary)]">{subtitle}</p>}
      </div>
    </div>
  );
}

export default function IndicadoresTab({ grupo, onChange }: IndicadoresTabProps) {
  const financeiro = grupo.financeiro ?? createFinanceiroGrupo();
  const config = financeiro.config ?? {};

  const [taxaConversao, setTaxaConversao] = useState(
    config.taxa_conversao_estimada ?? 30
  );

  const handleTaxaChange = useCallback(
    (value: number) => {
      setTaxaConversao(value);
      if (!onChange) return;
      const updatedConfig = { ...config, taxa_conversao_estimada: value };
      const updatedFinanceiro = { ...financeiro, config: updatedConfig };
      onChange({ ...grupo, financeiro: updatedFinanceiro });
    },
    [onChange, grupo, financeiro, config]
  );

  const indicadores = useMemo(
    () =>
      calcIndicadores(grupo, {
        ...financeiro,
        config: { ...config, taxa_conversao_estimada: taxaConversao },
      }),
    [grupo, financeiro, config, taxaConversao]
  );

  const ocp = {
    paxVendidos: indicadores.paxVendidos,
    paxConfirmados: indicadores.paxConfirmados,
    taxaOcupacao: indicadores.taxaOcupacao,
    vagasDisponiveis: indicadores.vagasDisponiveis,
  };
  const be = {
    breakEvenPax: indicadores.breakEvenPax,
    breakEvenAtingido: indicadores.breakEvenAtingido,
    margemSeguranca: indicadores.margemSeguranca,
  };
  const mg = {
    comissaoMediaPax: indicadores.comissaoMediaPax,
    margemOperacional: indicadores.margemOperacional,
    margemLiquida: indicadores.margemLiquida,
    markupEfetivo: indicadores.markupEfetivo,
  };
  const vel = {
    paxPorDia: indicadores.paxPorDia,
    diasParaLotar: indicadores.diasParaLotar,
    dataEstimadaLotacao: indicadores.dataEstimadaLotacao,
    vaiLotarATempo: indicadores.vaiLotarATempo,
  };
  const cenarios = {
    pessimista: indicadores.cenarioPessimista,
    realista: indicadores.cenarioRealista,
    otimista: indicadores.cenarioOtimista,
  };

  return (
    <div className="space-y-6">
      {/* Config */}
      <Card className="border-0 shadow-md" style={{ backgroundColor: 'var(--fin-surface)' }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-[var(--t-text)] flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4" style={{ color: 'var(--fin-accent)' }} />
            Parametros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label className="text-[var(--t-text-secondary)] text-sm">
              Taxa de Conversao Estimada (%)
            </Label>
            <Input
              type="number"
              step="1"
              min="0"
              max="100"
              value={taxaConversao}
              onChange={(e) => handleTaxaChange(parseFloat(e.target.value) || 0)}
              className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
            />
          </div>
        </CardContent>
      </Card>

      {/* 1. Ocupacao */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5" style={{ color: 'var(--fin-accent)' }} />
            Ocupacao
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-4">
            <StatCard
              label="PAX Vendidos"
              value={ocp.paxVendidos ?? 0}
              icon={Users}
              color="var(--fin-accent)"
            />
            <StatCard
              label="PAX Confirmados"
              value={ocp.paxConfirmados ?? 0}
              icon={CheckCircle2}
              color="var(--fin-positive)"
            />
            <StatCard
              label="Taxa de Ocupacao"
              value={`${(ocp.taxaOcupacao ?? 0).toFixed(1)}%`}
              icon={BarChart3}
              color="var(--fin-accent)"
            />
            <StatCard
              label="Vagas Disponiveis"
              value={ocp.vagasDisponiveis ?? 0}
              icon={Target}
              color="var(--fin-violet)"
            />
          </div>
          <ProgressBar
            value={ocp.paxVendidos ?? 0}
            max={(ocp.paxVendidos ?? 0) + (ocp.vagasDisponiveis ?? 0)}
            color="var(--fin-accent)"
          />
          <div className="flex justify-between text-xs text-[var(--t-text-secondary)] mt-1">
            <span>0 PAX</span>
            <span>{(ocp.paxVendidos ?? 0) + (ocp.vagasDisponiveis ?? 0)} PAX</span>
          </div>
        </CardContent>
      </Card>

      {/* 2. Break-even */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-5 w-5" style={{ color: 'var(--fin-accent)' }} />
            Break-even (Ponto de Equilibrio)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard
              label="Break-even PAX"
              value={be.breakEvenPax ?? 0}
              subtitle="Minimo de passageiros para cobrir custos"
              icon={Target}
              color="var(--fin-warning)"
            />
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--t-text-muted)]">Break-even Atingido:</span>
              {be.breakEvenAtingido ? (
                <Badge className="bg-[var(--fin-positive-soft)] text-[var(--fin-positive)] hover:bg-[var(--fin-positive-soft)]">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  SIM
                </Badge>
              ) : (
                <Badge className="bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)]">
                  <XCircle className="h-3 w-3 mr-1" />
                  NAO
                </Badge>
              )}
            </div>
            <StatCard
              label="Margem de Seguranca"
              value={`${(be.margemSeguranca ?? 0).toFixed(1)}%`}
              subtitle="Quanto acima do break-even"
              icon={TrendingUp}
              color={
                (be.margemSeguranca ?? 0) > 0 ? 'var(--fin-positive)' : 'var(--fin-negative)'
              }
            />
          </div>
          {/* Break-even progress */}
          <div className="mt-4">
            <div className="relative">
              <ProgressBar
                value={ocp.paxVendidos ?? 0}
                max={Math.max(
                  be.breakEvenPax ?? 0,
                  (ocp.paxVendidos ?? 0) + (ocp.vagasDisponiveis ?? 0)
                )}
                color={be.breakEvenAtingido ? 'var(--fin-positive)' : 'var(--fin-negative)'}
              />
              {(be.breakEvenPax ?? 0) > 0 && (
                <div
                  className="absolute top-0 h-3 w-0.5 bg-[var(--fin-warning)]"
                  style={{
                    left: `${Math.min(
                      ((be.breakEvenPax ?? 0) /
                        Math.max(
                          be.breakEvenPax ?? 0,
                          (ocp.paxVendidos ?? 0) + (ocp.vagasDisponiveis ?? 0)
                        )) *
                        100,
                      100
                    )}%`,
                  }}
                />
              )}
            </div>
            <div className="flex justify-between text-xs text-[var(--t-text-secondary)] mt-1">
              <span>{ocp.paxVendidos ?? 0} vendidos</span>
              <span className="text-[var(--fin-warning-text)] font-medium">
                BE: {be.breakEvenPax ?? 0}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Margens */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5" style={{ color: 'var(--fin-accent)' }} />
            Margens
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { label: 'Comissão Média/PAX', value: mg.comissaoMediaPax ?? 0, isCurrency: true },
              { label: 'Margem Operacional', value: mg.margemOperacional ?? 0 },
              { label: 'Margem Líquida', value: mg.margemLiquida ?? 0 },
              { label: 'Markup Efetivo', value: mg.markupEfetivo ?? 0 },
            ].map((m) => (
              <div key={m.label} className="text-center">
                <p className="text-xs text-[var(--t-text-secondary)] mb-1">{m.label}</p>
                <p
                  className={`text-2xl font-bold ${
 m.value >= 0 ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-negative-text)]'
 }`}
                >
                  {'isCurrency' in m && m.isCurrency ? formatBRL(m.value) : `${m.value.toFixed(1)}%`}
                </p>
                {'isCurrency' in m && m.isCurrency ? null : (
                  <div className="mt-2">
                    <ProgressBar
                      value={Math.max(m.value, 0)}
                      max={100}
                      color={m.value >= 20 ? 'var(--fin-positive)' : m.value >= 0 ? 'var(--fin-warning)' : 'var(--fin-negative)'}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 4. Velocidade de Vendas */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-5 w-5" style={{ color: 'var(--fin-accent)' }} />
            Velocidade de Vendas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatCard
              label="PAX por Dia"
              value={(vel.paxPorDia ?? 0).toFixed(2)}
              icon={Zap}
              color="var(--fin-accent)"
            />
            <StatCard
              label="Dias para Lotar"
              value={
                vel.diasParaLotar != null && vel.diasParaLotar !== Infinity
                  ? Math.ceil(vel.diasParaLotar)
                  : '---'
              }
              icon={Target}
              color="var(--fin-violet)"
            />
            <StatCard
              label="Data Est. Lotacao"
              value={vel.dataEstimadaLotacao ?? '---'}
              icon={BarChart3}
              color="var(--fin-warning)"
            />
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--t-text-muted)]">Vai lotar a tempo:</span>
              {vel.vaiLotarATempo ? (
                <Badge className="bg-[var(--fin-positive-soft)] text-[var(--fin-positive)] hover:bg-[var(--fin-positive-soft)]">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  SIM
                </Badge>
              ) : (
                <Badge className="bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)]">
                  <XCircle className="h-3 w-3 mr-1" />
                  NAO
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5. Cenarios */}
      <div>
        <h3
          className="text-base font-bold mb-4 flex items-center gap-2"
          style={{ color: 'var(--fin-surface)' }}
        >
          <BarChart3 className="h-5 w-5" style={{ color: 'var(--fin-accent)' }} />
          Analise de Cenarios
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pessimista */}
          <Card className="border-0 shadow-md border-l-4 border-l-[var(--fin-negative)] bg-[var(--fin-negative-soft)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[var(--fin-negative-text)]">Pessimista</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">PAX</span>
                <span className="font-semibold">{cenarios.pessimista?.pax ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Receita</span>
                <span className="font-semibold">
                  {formatBRL(cenarios.pessimista?.receita ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Custo</span>
                <span className="font-semibold">
                  {formatBRL(cenarios.pessimista?.custo ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm pt-1 border-t">
                <span className="text-[var(--t-text)] font-medium">Lucro</span>
                <span
                  className={`font-bold ${
 (cenarios.pessimista?.lucro ?? 0) >= 0
 ? 'text-[var(--fin-positive)]'
 : 'text-[var(--fin-negative-text)]'
 }`}
                >
                  {formatBRL(cenarios.pessimista?.lucro ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Margem</span>
                <span
                  className={`font-semibold ${
 (cenarios.pessimista?.margem ?? 0) >= 0
 ? 'text-[var(--fin-positive)]'
 : 'text-[var(--fin-negative-text)]'
 }`}
                >
                  {(cenarios.pessimista?.margem ?? 0).toFixed(1)}%
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Realista */}
          <Card className="border-0 shadow-md border-l-4 border-l-[var(--fin-warning)] bg-[var(--fin-warning-soft)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[var(--fin-warning-text)]">Realista</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">PAX</span>
                <span className="font-semibold">{cenarios.realista?.pax ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Receita</span>
                <span className="font-semibold">
                  {formatBRL(cenarios.realista?.receita ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Custo</span>
                <span className="font-semibold">
                  {formatBRL(cenarios.realista?.custo ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm pt-1 border-t">
                <span className="text-[var(--t-text)] font-medium">Lucro</span>
                <span
                  className={`font-bold ${
 (cenarios.realista?.lucro ?? 0) >= 0
 ? 'text-[var(--fin-positive)]'
 : 'text-[var(--fin-negative-text)]'
 }`}
                >
                  {formatBRL(cenarios.realista?.lucro ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Margem</span>
                <span
                  className={`font-semibold ${
 (cenarios.realista?.margem ?? 0) >= 0
 ? 'text-[var(--fin-positive)]'
 : 'text-[var(--fin-negative-text)]'
 }`}
                >
                  {(cenarios.realista?.margem ?? 0).toFixed(1)}%
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Otimista */}
          <Card className="border-0 shadow-md border-l-4 border-l-[var(--fin-positive)] bg-[var(--fin-positive-soft)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[var(--fin-positive)]">Otimista</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">PAX</span>
                <span className="font-semibold">{cenarios.otimista?.pax ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Receita</span>
                <span className="font-semibold">
                  {formatBRL(cenarios.otimista?.receita ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Custo</span>
                <span className="font-semibold">
                  {formatBRL(cenarios.otimista?.custo ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm pt-1 border-t">
                <span className="text-[var(--t-text)] font-medium">Lucro</span>
                <span
                  className={`font-bold ${
 (cenarios.otimista?.lucro ?? 0) >= 0
 ? 'text-[var(--fin-positive)]'
 : 'text-[var(--fin-negative-text)]'
 }`}
                >
                  {formatBRL(cenarios.otimista?.lucro ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--t-text-muted)]">Margem</span>
                <span
                  className={`font-semibold ${
 (cenarios.otimista?.margem ?? 0) >= 0
 ? 'text-[var(--fin-positive)]'
 : 'text-[var(--fin-negative-text)]'
 }`}
                >
                  {(cenarios.otimista?.margem ?? 0).toFixed(1)}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
