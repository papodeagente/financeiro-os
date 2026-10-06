'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Users,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  CreditCard,
  Wallet,
  Receipt,
  Percent,
} from 'lucide-react';
import { GrupoViagem } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import {
  calcVendasMetrics,
  calcRecebimentosMetrics,
  calcFornecedoresMetrics,
  calcDRE,
  calcIndicadores,
} from '@/lib/financial-calculations';

interface PainelTabProps {
  grupo: GrupoViagem;
  onChange?: (g: GrupoViagem) => void;
}

function BigNumberCard({
  label,
  value,
  icon: Icon,
  color,
  bgColor,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}) {
  return (
    <Card className="border-0 shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-[var(--t-text-secondary)] mb-1">{label}</p>
            <p className="text-lg font-bold" style={{ color }}>
              {value}
            </p>
          </div>
          <div className="p-2 rounded-lg" style={{ backgroundColor: bgColor }}>
            <Icon className="h-4 w-4" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HorizontalBar({
  label,
  value,
  maxValue,
  color,
  displayValue,
}: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
  displayValue: string;
}) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-[var(--t-text-muted)]">{label}</span>
        <span className="font-medium text-[var(--t-text)]">{displayValue}</span>
      </div>
      <div className="w-full bg-[var(--t-surface-hover)] rounded-full h-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function PainelTab({ grupo, onChange }: PainelTabProps) {
  const financeiro = grupo.financeiro ?? createFinanceiroGrupo();

  const vendas = useMemo(() => calcVendasMetrics(financeiro, grupo.params.qtd_max_pax), [financeiro, grupo.params.qtd_max_pax]);
  const recebimentos = useMemo(() => calcRecebimentosMetrics(financeiro.parcelas), [financeiro.parcelas]);
  const fornecedoresMetrics = useMemo(() => calcFornecedoresMetrics(financeiro.pagamentos_fornecedores), [financeiro.pagamentos_fornecedores]);
  const dre = useMemo(() => calcDRE(grupo, financeiro), [grupo, financeiro]);
  const indicadores = useMemo(() => calcIndicadores(grupo, financeiro), [grupo, financeiro]);

  const paxVendidos = indicadores.paxVendidos;
  const paxRestantes = indicadores.vagasDisponiveis;
  const faturamento = dre.faturamentoBruto;
  const receita = dre.receitaBrutaAgencia;
  const receitaRecebida = recebimentos.totalRecebido;
  const aReceber = recebimentos.totalPendente;
  const repassesTotal = dre.repassesTotal;
  const aPagar = fornecedoresMetrics.totalAPagar;
  const lucroProjetado = dre.lucroLiquido;
  const margemPct = dre.margemLiquida;

  // Mix de apartamentos
  const mixAptos = vendas.vendasPorTipo;
  const maxMix = Math.max(...Object.values(mixAptos), 1);
  const mixColors: Record<string, string> = {
    SGL: 'var(--fin-accent)',
    DBL: 'var(--fin-violet)',
    TPL: 'var(--fin-warning)',
    QDP: 'var(--fin-positive)',
  };

  // Repasses por categoria
  const repassesPorCategoriaEntries = Object.entries(dre.repassesPorCategoria);
  const maxRepasse = repassesPorCategoriaEntries.length > 0
    ? Math.max(...repassesPorCategoriaEntries.map(([, v]) => Math.abs(v)), 1)
    : 1;
  // Cor por CATEGORIA (nominal): séries do sistema, nunca cor de status.
  const catColors = [
    'var(--fin-serie-1)', 'var(--fin-serie-2)', 'var(--fin-serie-3)',
    'var(--fin-serie-4)', 'var(--fin-serie-5)', 'var(--fin-serie-6)',
  ];

  // Alertas
  const alertas: { tipo: 'warning' | 'error'; msg: string }[] = [];

  // Deadlines de cambio
  const today = new Date();
  if (grupo.cambio) {
    Object.entries(grupo.cambio).forEach(([key, entry]) => {
      if (entry.deadline) {
        const deadline = new Date(entry.deadline);
        const diffDays = Math.ceil(
          (deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diffDays >= 0 && diffDays < 7) {
          alertas.push({
            tipo: 'warning',
            msg: `Cambio ${key.toUpperCase()}: prazo em ${diffDays} dia(s) - vence em ${deadline.toLocaleDateString('pt-BR')}`,
          });
        } else if (diffDays < 0) {
          alertas.push({
            tipo: 'error',
            msg: `Cambio ${key.toUpperCase()}: prazo vencido ha ${Math.abs(diffDays)} dia(s)`,
          });
        }
      }
    });
  }

  // Parcelas atrasadas
  if (recebimentos.totalAtrasado > 0) {
    alertas.push({
      tipo: 'error',
      msg: `Parcelas em atraso. Total: ${formatBRL(recebimentos.totalAtrasado)}`,
    });
  }

  // Fornecedores vencidos
  if (fornecedoresMetrics.totalVencido > 0) {
    alertas.push({
      tipo: 'error',
      msg: `Pagamentos a fornecedores vencidos: ${formatBRL(fornecedoresMetrics.totalVencido)}`,
    });
  }

  return (
    <div className="space-y-6">
      {/* Top cards - big numbers */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <BigNumberCard
          label="PAX Vendidos"
          value={String(paxVendidos)}
          icon={Users}
          color={'var(--fin-accent)'}
          bgColor={'var(--fin-accent-soft)'}
        />
        <BigNumberCard
          label="PAX Restantes"
          value={String(paxRestantes)}
          icon={Users}
          color="var(--fin-text-3)"
          bgColor="var(--fin-surface-2)"
        />
        <BigNumberCard
          label="Faturamento"
          value={formatBRL(faturamento)}
          icon={TrendingUp}
          color="var(--fin-accent)"
          bgColor="var(--fin-accent-soft)"
        />
        <BigNumberCard
          label="Receita (Comissao)"
          value={formatBRL(receita)}
          icon={DollarSign}
          color="var(--fin-positive)"
          bgColor="var(--fin-positive-soft)"
        />
        <BigNumberCard
          label="Recebido"
          value={formatBRL(receitaRecebida)}
          icon={Wallet}
          color="var(--fin-positive)"
          bgColor="var(--fin-positive-soft)"
        />
        <BigNumberCard
          label="A Receber"
          value={formatBRL(aReceber)}
          icon={Clock}
          color="var(--fin-warning)"
          bgColor="var(--fin-warning-soft)"
        />
        <BigNumberCard
          label="Repasses Fornecedores"
          value={formatBRL(repassesTotal)}
          icon={Receipt}
          color="var(--fin-negative)"
          bgColor="var(--fin-negative-soft)"
        />
        <BigNumberCard
          label="A Pagar"
          value={formatBRL(aPagar)}
          icon={CreditCard}
          color="var(--fin-warning)"
          bgColor="var(--fin-warning-soft)"
        />
        <BigNumberCard
          label="Lucro Projetado"
          value={formatBRL(lucroProjetado)}
          icon={lucroProjetado >= 0 ? TrendingUp : TrendingDown}
          color={lucroProjetado >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)'}
          bgColor={lucroProjetado >= 0 ? 'var(--fin-positive-soft)' : 'var(--fin-negative-soft)'}
        />
        <BigNumberCard
          label="Margem %"
          value={`${margemPct.toFixed(1)}%`}
          icon={Percent}
          color={margemPct > 0 ? 'var(--fin-positive)' : 'var(--fin-negative)'}
          bgColor={margemPct > 0 ? 'var(--fin-positive-soft)' : 'var(--fin-negative-soft)'}
        />
      </div>

      {/* Mix de apartamentos + Custo por categoria */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Mix */}
        <Card className="border-0 shadow-md">
          <CardHeader style={{ backgroundColor: 'var(--fin-surface)' }}>
            <CardTitle className="text-[var(--t-text)] text-sm flex items-center gap-2">
              <Users className="h-4 w-4" style={{ color: 'var(--fin-accent)' }} />
              Mix de Apartamentos
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {Object.entries(mixAptos).map(([tipo, qtd]) => (
              <HorizontalBar
                key={tipo}
                label={tipo}
                value={qtd as number}
                maxValue={maxMix}
                color={mixColors[tipo] ?? 'var(--fin-text-3)'}
                displayValue={`${qtd} PAX`}
              />
            ))}
            {Object.values(mixAptos).every((v) => v === 0) && (
              <p className="text-sm text-[var(--t-text-secondary)] text-center py-4">
                Nenhuma venda registrada
              </p>
            )}
          </CardContent>
        </Card>

        {/* Repasses por categoria */}
        <Card className="border-0 shadow-md">
          <CardHeader style={{ backgroundColor: 'var(--fin-surface)' }}>
            <CardTitle className="text-[var(--t-text)] text-sm flex items-center gap-2">
              <Receipt className="h-4 w-4" style={{ color: 'var(--fin-accent)' }} />
              Repasses por Categoria
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {repassesPorCategoriaEntries.map(
              ([cat, valor], idx) => (
                <HorizontalBar
                  key={cat}
                  label={cat}
                  value={Math.abs(valor)}
                  maxValue={maxRepasse}
                  color={catColors[idx % catColors.length]}
                  displayValue={formatBRL(Math.abs(valor))}
                />
              )
            )}
            {repassesPorCategoriaEntries.length === 0 && (
              <p className="text-sm text-[var(--t-text-secondary)] text-center py-4">
                Nenhum repasse cadastrado
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <Card className="border-0 shadow-md">
          <CardHeader style={{ backgroundColor: 'var(--fin-surface)' }}>
            <CardTitle className="text-[var(--t-text)] text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" style={{ color: 'var(--fin-accent)' }} />
              Alertas
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {alertas.map((alerta, idx) => (
              <Alert
                key={idx}
                variant={alerta.tipo === 'error' ? 'destructive' : 'default'}
                className={
                  alerta.tipo === 'error'
                    ? 'border-[var(--fin-negative)]/30 bg-[var(--fin-negative-soft)]'
                    : 'border-[var(--fin-warning)]/30 bg-[var(--fin-warning-soft)]'
                }
              >
                <AlertTriangle
                  className={`h-4 w-4 ${
 alerta.tipo === 'error' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-warning-text)]'
 }`}
                />
                <AlertDescription
                  className={
                    alerta.tipo === 'error' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-warning-text)]'
                  }
                >
                  {alerta.msg}
                </AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      {alertas.length === 0 && (
        <div
          className="rounded-lg p-4 text-center"
          style={{ backgroundColor: 'var(--fin-surface)' }}
        >
          <p className="text-[var(--t-text-secondary)] text-sm">
            Nenhum alerta no momento. Tudo em dia!
          </p>
        </div>
      )}
    </div>
  );
}
