'use client';

import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Settings2 } from 'lucide-react';
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
      {/* Configuracoes editaveis */}
      <Card className="border-0 shadow-md" style={{ backgroundColor: '#1a1a2e' }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4" style={{ color: '#d4a853' }} />
            Parametros da DRE
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-300 text-sm">Aliquota de Imposto (%)</Label>
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
                className="mt-1 bg-white/10 border-white/20 text-white"
              />
            </div>
            <div>
              <Label className="text-gray-300 text-sm">
                Custos Administrativos (R$)
              </Label>
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
                className="mt-1 bg-white/10 border-white/20 text-white"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* DRE */}
      <Card className="border-0 shadow-md overflow-hidden">
        <CardHeader style={{ backgroundColor: '#1a1a2e' }}>
          <CardTitle className="text-white">
            <span style={{ color: '#d4a853' }}>DRE</span> - Demonstrativo de
            Resultado do Exercicio
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* 1. RECEITA BRUTA */}
          <div className="bg-gray-100 px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-gray-600">
              1. Receita Bruta
            </span>
          </div>
          {Object.entries(dre.receitaPorTipo).map(([tipo, valor]) => (
            <DRELine key={`rb-${tipo}`} label={`Vendas ${tipo}`} value={valor} level={1} />
          ))}
          <DRELine label="CHDs Extras" value={dre.receitaChdExtras} level={1} />
          <DRELine label="RECEITA BRUTA TOTAL" value={dre.receitaBruta} bold isTotal />

          <Separator />

          {/* 2. DEDUCOES */}
          <div className="bg-gray-100 px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-gray-600">
              2. (-) Deducoes
            </span>
          </div>
          <DRELine label="Descontos Concedidos" value={-dre.descontos} level={1} />
          <DRELine label="Cancelamentos" value={-dre.cancelamentos} level={1} />
          <DRELine label="Cortesias" value={-dre.cortesias} level={1} />
          <DRELine label="TOTAL DEDUCOES" value={-(dre.descontos + dre.cancelamentos + dre.cortesias)} bold isTotal />

          <Separator />

          {/* 3. RECEITA LIQUIDA */}
          <div className="px-4 py-3 flex justify-between items-center" style={{ backgroundColor: '#d4a85320' }}>
            <span className="font-bold text-sm">= RECEITA LIQUIDA</span>
            <span className="font-bold text-sm tabular-nums">{formatBRL(dre.receitaLiquida)}</span>
          </div>

          <Separator />

          {/* 4. CUSTOS DIRETOS */}
          <div className="bg-gray-100 px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-gray-600">
              4. (-) Custos Diretos
            </span>
          </div>
          {Object.entries(dre.custosPorCategoria).map(([cat, valor]) => (
            <DRELine key={`cd-${cat}`} label={`[${cat}] Fornecedores`} value={-Math.abs(valor)} level={1} />
          ))}
          <DRELine label="TOTAL CUSTOS DIRETOS" value={-dre.custosDiretosTotal} bold isTotal />

          <Separator />

          {/* 5. LUCRO BRUTO */}
          <div className="px-4 py-3 flex justify-between items-center" style={{ backgroundColor: '#d4a85330' }}>
            <span className="font-bold">= LUCRO BRUTO</span>
            <div className="flex items-center gap-3">
              <span className={`font-bold tabular-nums ${dre.lucroBruto >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatBRL(dre.lucroBruto)}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dre.margemBruta >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                Margem Bruta: {dre.margemBruta.toFixed(1)}%
              </span>
            </div>
          </div>

          <Separator />

          {/* 6. CUSTOS OPERACIONAIS */}
          <div className="bg-gray-100 px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-gray-600">
              6. (-) Custos Operacionais
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
          <div className="px-4 py-3 flex justify-between items-center" style={{ backgroundColor: '#d4a85330' }}>
            <span className="font-bold">= LUCRO OPERACIONAL</span>
            <div className="flex items-center gap-3">
              <span className={`font-bold tabular-nums ${dre.lucroOperacional >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatBRL(dre.lucroOperacional)}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dre.margemOperacional >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                Margem Operacional: {dre.margemOperacional.toFixed(1)}%
              </span>
            </div>
          </div>

          <Separator />

          {/* 8. IMPOSTOS */}
          <div className="bg-gray-100 px-4 py-2">
            <span className="font-bold text-sm uppercase tracking-wide text-gray-600">
              8. (-) Impostos
            </span>
          </div>
          <DRELine label={`Impostos (${aliquotaImposto.toFixed(1)}%)`} value={-dre.impostos} level={1} />
          <DRELine label="Outras Taxas" value={-dre.outrasTaxas} level={1} />

          <Separator />

          {/* 9. LUCRO LIQUIDO */}
          <div
            className="px-4 py-4 flex justify-between items-center rounded-b-lg"
            style={{ backgroundColor: dre.lucroLiquido >= 0 ? '#dcfce7' : '#fef2f2' }}
          >
            <span className="font-bold text-lg">= LUCRO LIQUIDO</span>
            <div className="flex items-center gap-3">
              <span className={`font-bold text-lg tabular-nums ${dre.lucroLiquido >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatBRL(dre.lucroLiquido)}
              </span>
              <span className={`text-sm px-3 py-1 rounded-full font-bold ${dre.margemLiquida >= 0 ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'}`}>
                Margem Liquida: {dre.margemLiquida.toFixed(1)}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
