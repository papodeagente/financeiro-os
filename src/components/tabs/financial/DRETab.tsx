'use client';

import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Settings2, Info } from 'lucide-react';
import { GrupoViagem } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { calcDRE } from '@/lib/financial-calculations';
import { FinanceiroConfig } from '@/lib/financial-types';

interface DRETabProps {
  grupo: GrupoViagem;
  onChange?: (g: GrupoViagem) => void;
}

function DRELine({
  label,
  value,
  level = 0,
  bold = false,
  isTotal = false,
  showPercent,
  percentValue,
  percentLabel,
}: {
  label: string;
  value: number;
  level?: number;
  bold?: boolean;
  isTotal?: boolean;
  showPercent?: boolean;
  percentValue?: number;
  percentLabel?: string;
}) {
  const indent = level * 24;
  const isPositive = value >= 0;
  const colorClass = isTotal
    ? isPositive
      ? 'text-green-700'
      : 'text-red-700'
    : '';
  const bgClass = isTotal ? (isPositive ? 'bg-green-50' : 'bg-red-50') : '';
  const fontClass = bold || isTotal ? 'font-bold' : 'font-normal';

  return (
    <div className={`flex items-center justify-between py-2 px-4 ${bgClass}`}>
      <span
        className={`${fontClass} text-sm`}
        style={{ paddingLeft: `${indent}px` }}
      >
        {label}
      </span>
      <div className="flex items-center gap-4">
        <span className={`${fontClass} text-sm tabular-nums ${colorClass}`}>
          {formatBRL(value)}
        </span>
        {showPercent && percentValue !== undefined && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              percentValue >= 0
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {percentLabel ?? 'Margem'}: {percentValue.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function DREHighlight({
  label,
  value,
  bgColor,
  percentValue,
  percentLabel,
  note,
}: {
  label: string;
  value: number;
  bgColor: string;
  percentValue?: number;
  percentLabel?: string;
  note?: string;
}) {
  return (
    <div className="px-4 py-3" style={{ backgroundColor: bgColor }}>
      <div className="flex justify-between items-center">
        <div>
          <span className="font-bold text-sm">{label}</span>
          {note && (
            <span className="ml-2 text-[10px] text-gray-500 font-normal">{note}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-bold text-sm tabular-nums ${value >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {formatBRL(value)}
          </span>
          {percentValue !== undefined && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${percentValue >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {percentLabel}: {percentValue.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DRETab({ grupo, onChange }: DRETabProps) {
  const financeiro = grupo.financeiro ?? createFinanceiroGrupo();
  const config: FinanceiroConfig = financeiro.config ?? {
    aliquota_imposto: 0,
    custos_administrativos: 0,
  };

  const [aliquotaImposto, setAliquotaImposto] = useState(
    config.aliquota_imposto ?? 0
  );
  const [custosAdmin, setCustosAdmin] = useState(
    config.custos_administrativos ?? 0
  );

  const handleConfigChange = useCallback(
    (field: keyof FinanceiroConfig, value: number) => {
      if (!onChange) return;
      const updatedConfig = {
        ...config,
        [field]: value,
      };
      const updatedFinanceiro = { ...financeiro, config: updatedConfig };
      onChange({ ...grupo, financeiro: updatedFinanceiro });
    },
    [onChange, grupo, financeiro, config]
  );

  const dre = useMemo(
    () =>
      calcDRE(grupo, {
        ...financeiro,
        config: { ...config, aliquota_imposto: aliquotaImposto, custos_administrativos: custosAdmin },
      }),
    [grupo, financeiro, config, aliquotaImposto, custosAdmin]
  );

  return (
    <div className="space-y-6">
      {/* Nota explicativa */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
        <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <strong>Contabilidade de Agencia de Viagens</strong>: A receita da agencia e a comissao (markup),
          nao o valor total do pacote. Os repasses a fornecedores sao valores de passagem (pass-through).
          Impostos incidem sobre a receita da agencia, nao sobre o faturamento total.
        </div>
      </div>

      {/* Configuracoes editaveis */}
      <Card className="border-0 shadow-md" style={{ backgroundColor: '#1a1a2e' }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-[var(--t-text)] flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4" style={{ color: '#d4a853' }} />
            Parametros da DRE
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-[var(--t-text-secondary)] text-sm">Aliquota de Imposto (%)</Label>
              <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5 mb-1">Incide sobre a receita da agencia (comissao)</p>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={aliquotaImposto}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  setAliquotaImposto(v);
                  handleConfigChange('aliquota_imposto', v);
                }}
                className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
              />
            </div>
            <div>
              <Label className="text-[var(--t-text-secondary)] text-sm">
                Custos Administrativos (R$)
              </Label>
              <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5 mb-1">Custos fixos da agencia (aluguel, salarios, etc.)</p>
              <Input
                type="number"
                step="100"
                min="0"
                value={custosAdmin}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  setCustosAdmin(v);
                  handleConfigChange('custos_administrativos', v);
                }}
                className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* DRE */}
      <Card className="border-0 shadow-md overflow-hidden">
        <CardHeader style={{ backgroundColor: '#1a1a2e' }}>
          <CardTitle className="text-[var(--t-text)]">
            <span style={{ color: '#d4a853' }}>DRE</span> - Demonstrativo de
            Resultado do Exercicio
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* 1. FATURAMENTO BRUTO */}
          <div className="bg-[var(--t-surface-hover)] px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-[var(--t-text-muted)]">
              1. Faturamento Bruto
            </span>
            <span className="ml-2 text-[10px] text-[var(--t-text-muted)] font-normal">
              (total cobrado do cliente)
            </span>
          </div>
          {Object.entries(dre.faturamentoBrutoPorTipo).map(([tipo, valor]) => (
            <DRELine key={`fb-${tipo}`} label={`Vendas ${tipo}`} value={valor} level={1} />
          ))}
          <DRELine label="CHDs Extras" value={dre.faturamentoChdExtras} level={1} />
          <DRELine label="FATURAMENTO BRUTO TOTAL" value={dre.faturamentoBruto} bold isTotal />

          <Separator />

          {/* 2. DEDUCOES DO FATURAMENTO */}
          <div className="bg-[var(--t-surface-hover)] px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-[var(--t-text-muted)]">
              2. (-) Deducoes do Faturamento
            </span>
          </div>
          <DRELine label="Cancelamentos" value={-dre.cancelamentos} level={1} />
          <DRELine label="Cortesias" value={-dre.cortesias} level={1} />

          <Separator />

          {/* FATURAMENTO LIQUIDO */}
          <DREHighlight
            label="= FATURAMENTO LIQUIDO"
            value={dre.faturamentoLiquido}
            bgColor="#d4a85320"
          />

          <Separator />

          {/* 3. REPASSES A FORNECEDORES */}
          <div className="bg-[var(--t-surface-hover)] px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-[var(--t-text-muted)]">
              3. (-) Repasses a Fornecedores
            </span>
            <span className="ml-2 text-[10px] text-[var(--t-text-muted)] font-normal">
              (valores repassados — nao sao receita da agencia)
            </span>
          </div>
          {Object.entries(dre.repassesPorCategoria).map(([cat, valor]) => (
            <DRELine key={`rp-${cat}`} label={`[${cat}] Fornecedores`} value={-Math.abs(valor)} level={1} />
          ))}
          {dre.repassesCustosExtras > 0 && (
            <DRELine label="Custos Extras" value={-dre.repassesCustosExtras} level={1} />
          )}
          <DRELine label="TOTAL REPASSES" value={-dre.repassesTotal} bold isTotal />

          <Separator />

          {/* 4. RECEITA DA AGENCIA */}
          <DREHighlight
            label="= RECEITA DA AGENCIA (Comissao)"
            value={dre.receitaBrutaAgencia}
            bgColor={dre.receitaBrutaAgencia >= 0 ? '#dcfce740' : '#fee2e240'}
            note="Faturamento - Repasses"
            percentValue={dre.markupEfetivo}
            percentLabel="Markup"
          />

          <Separator />

          {/* 5. DESCONTOS CONCEDIDOS */}
          <div className="bg-[var(--t-surface-hover)] px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-[var(--t-text-muted)]">
              5. (-) Descontos Concedidos
            </span>
            <span className="ml-2 text-[10px] text-[var(--t-text-muted)] font-normal">
              (saem da margem da agencia)
            </span>
          </div>
          <DRELine label="Descontos" value={-dre.descontosConcedidos} level={1} />

          <Separator />

          {/* RECEITA LIQUIDA DA AGENCIA */}
          <DREHighlight
            label="= RECEITA LIQUIDA DA AGENCIA"
            value={dre.receitaLiquidaAgencia}
            bgColor="#d4a85330"
            note="Base de calculo dos impostos"
          />

          <Separator />

          {/* 6. CUSTOS OPERACIONAIS */}
          <div className="bg-[var(--t-surface-hover)] px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-[var(--t-text-muted)]">
              6. (-) Custos Operacionais
            </span>
            <span className="ml-2 text-[10px] text-[var(--t-text-muted)] font-normal">
              (custos proprios da agencia)
            </span>
          </div>
          <DRELine label="Taxa Adquirencia (Cartao)" value={-dre.taxaAdquirencia} level={1} />
          <DRELine label="Taxa Boleto" value={-dre.taxaBoleto} level={1} />
          <DRELine label="Contrato/Comissao" value={-dre.contratoComissao} level={1} />
          <DRELine label="Variacao Cambial" value={-dre.variacaoCambial} level={1} />
          <DRELine label="Custos Administrativos" value={-dre.custosAdmin} level={1} />
          <DRELine label="TOTAL CUSTOS OPERACIONAIS" value={-dre.custosOpTotal} bold isTotal />

          <Separator />

          {/* 7. LUCRO OPERACIONAL */}
          <DREHighlight
            label="= LUCRO OPERACIONAL"
            value={dre.lucroOperacional}
            bgColor="#d4a85330"
            percentValue={dre.margemOperacional}
            percentLabel="Margem Op."
          />

          <Separator />

          {/* 8. IMPOSTOS */}
          <div className="bg-[var(--t-surface-hover)] px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-[var(--t-text-muted)]">
              8. (-) Impostos
            </span>
            <span className="ml-2 text-[10px] text-[var(--t-text-muted)] font-normal">
              ({aliquotaImposto.toFixed(1)}% sobre receita liquida da agencia)
            </span>
          </div>
          <DRELine label={`Impostos (${aliquotaImposto.toFixed(1)}% s/ receita líquida)`} value={-dre.impostos} level={1} />
          <DRELine label="Outras Taxas" value={-dre.outrasTaxas} level={1} />

          <Separator />

          {/* 9. LUCRO LIQUIDO */}
          <div
            className="px-4 py-4 flex justify-between items-center rounded-b-lg"
            style={{ backgroundColor: dre.lucroLiquido >= 0 ? '#dcfce7' : '#fef2f2' }}
          >
            <div>
              <span className="font-bold text-lg">= LUCRO LIQUIDO</span>
              <span className="ml-2 text-[10px] text-gray-500">
                ({dre.margemSobreFaturamento.toFixed(1)}% s/ faturamento)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`font-bold text-lg tabular-nums ${dre.lucroLiquido >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatBRL(dre.lucroLiquido)}
              </span>
              <span className={`text-sm px-3 py-1 rounded-full font-bold ${dre.margemLiquida >= 0 ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'}`}>
                Margem: {dre.margemLiquida.toFixed(1)}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
