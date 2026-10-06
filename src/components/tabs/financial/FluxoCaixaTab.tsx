'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { GrupoViagem } from '@/lib/types';
import { formatBRL } from '@/lib/utils';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { calcFluxoCaixa, calcDRE } from '@/lib/financial-calculations';

interface FluxoCaixaTabProps {
  grupo: GrupoViagem;
  onChange?: (g: GrupoViagem) => void;
}

export default function FluxoCaixaTab({ grupo, onChange }: FluxoCaixaTabProps) {
  const financeiro = grupo.financeiro ?? createFinanceiroGrupo();
  const [visao, setVisao] = useState<'total' | 'agencia'>('agencia');

  const dre = useMemo(() => calcDRE(grupo, financeiro), [grupo, financeiro]);
  const ratioComissao = dre.faturamentoLiquido > 0
    ? dre.receitaBrutaAgencia / dre.faturamentoLiquido
    : 0;

  const fluxo = useMemo(() => calcFluxoCaixa(financeiro, ratioComissao), [financeiro, ratioComissao]);

  const isAgencia = visao === 'agencia';

  const totalEntradas = fluxo.reduce((s, m) => s + (isAgencia ? m.entradasComissao : m.entradasRealizadas), 0);
  const totalSaidas = fluxo.reduce((s, m) => s + (isAgencia ? 0 : m.saidasRealizadas), 0);
  const saldoFinal = fluxo.length > 0
    ? (isAgencia ? fluxo[fluxo.length - 1].saldoAgenciaAcumulado : fluxo[fluxo.length - 1].saldoAcumulado)
    : 0;
  const mesesNegativos = fluxo.filter((m) => (isAgencia ? m.saldoAgenciaAcumulado : m.saldoAcumulado) < 0);

  return (
    <div className="space-y-6">
      {/* Toggle visão */}
      <div className="flex gap-2">
        <button
          onClick={() => setVisao('agencia')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            visao === 'agencia'
              ? 'bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)]'
              : 'bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] hover:text-[var(--t-text)]'
          }`}
        >
          Fluxo da Agencia (Comissao)
        </button>
        <button
          onClick={() => setVisao('total')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            visao === 'total'
              ? 'bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)]'
              : 'bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] hover:text-[var(--t-text)]'
          }`}
        >
          Fluxo Total (incl. Repasses)
        </button>
      </div>

      {isAgencia && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--fin-accent-soft)] border border-[var(--fin-accent)]/30">
          <AlertTriangle className="h-4 w-4 text-[var(--fin-accent)] mt-0.5 shrink-0" />
          <p className="text-xs text-[var(--fin-accent)]">
            Visao da agencia: mostra apenas a comissao nas entradas e os repasses a fornecedores nas saidas.
            O dinheiro do cliente que e repassado ao fornecedor nao aparece como receita da agencia.
          </p>
        </div>
      )}

      {/* Cards resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-md" style={{ backgroundColor: 'var(--fin-surface)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--t-text-secondary)]">
              {isAgencia ? 'Comissao Recebida' : 'Total Entradas'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-[var(--fin-positive)]">
              {formatBRL(totalEntradas)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md" style={{ backgroundColor: 'var(--fin-surface)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--t-text-secondary)]">
              {isAgencia ? 'Repasses Fornecedores' : 'Total Saidas'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-[var(--fin-negative-text)]">
              {formatBRL(isAgencia ? fluxo.reduce((s, m) => s + m.saidasRepasses, 0) : totalSaidas)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md" style={{ backgroundColor: 'var(--fin-surface)' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--t-text-secondary)]">
              {isAgencia ? 'Saldo Agencia' : 'Saldo Final'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold ${
 saldoFinal >= 0 ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-negative-text)]'
 }`}
            >
              {formatBRL(saldoFinal)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alerta de meses negativos */}
      {mesesNegativos.length > 0 && (
        <Alert variant="destructive" className="border-[var(--fin-negative)] bg-[var(--fin-negative)]/40">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Atencao: {mesesNegativos.length} mes(es) com saldo acumulado negativo.
            Verifique o fluxo de caixa para evitar problemas de liquidez.
          </AlertDescription>
        </Alert>
      )}

      {/* Tabela de fluxo de caixa */}
      <Card className="border-0 shadow-md">
        <CardHeader style={{ backgroundColor: 'var(--fin-surface)' }}>
          <CardTitle className="text-[var(--t-text)] flex items-center gap-2">
            <span style={{ color: 'var(--fin-accent)' }}>$</span>
            {isAgencia ? 'Fluxo de Caixa da Agencia' : 'Fluxo de Caixa Total'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow style={{ backgroundColor: 'var(--fin-surface)' }}>
                  <TableHead className="text-[var(--t-text-secondary)] font-semibold">Mes</TableHead>
                  {isAgencia ? (
                    <>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Comissao</TableHead>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Repasses</TableHead>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Saldo Agencia</TableHead>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Saldo Acum.</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Entradas Prev.</TableHead>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Entradas Real.</TableHead>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Saidas Prev.</TableHead>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Saidas Real.</TableHead>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Saldo Mes</TableHead>
                      <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">Saldo Acum.</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fluxo.map((mes, idx) => (
                  <TableRow
                    key={idx}
                    className={idx % 2 === 0 ? 'bg-[var(--t-surface-hover)]' : 'bg-[var(--t-surface)]'}
                  >
                    <TableCell className="font-medium">{mes.mes}</TableCell>
                    {isAgencia ? (
                      <>
                        <TableCell className="text-right text-[var(--fin-positive)] font-medium">
                          {formatBRL(mes.entradasComissao)}
                        </TableCell>
                        <TableCell className="text-right text-[var(--fin-negative-text)] font-medium">
                          {formatBRL(mes.saidasRepasses)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-semibold ${
 mes.saldoAgencia >= 0 ? 'text-[var(--fin-positive)] bg-[var(--fin-positive-soft)]' : 'text-[var(--fin-negative-text)] bg-[var(--fin-negative-soft)]'
 }`}
                        >
                          {formatBRL(mes.saldoAgencia)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-bold ${
 mes.saldoAgenciaAcumulado >= 0 ? 'text-[var(--fin-positive)] bg-[var(--fin-positive-soft)]' : 'text-[var(--fin-negative-text)] bg-[var(--fin-negative-soft)]'
 }`}
                        >
                          {formatBRL(mes.saldoAgenciaAcumulado)}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right">{formatBRL(mes.entradasPrevistas)}</TableCell>
                        <TableCell className="text-right text-[var(--fin-positive)] font-medium">{formatBRL(mes.entradasRealizadas)}</TableCell>
                        <TableCell className="text-right">{formatBRL(mes.saidasPrevistas)}</TableCell>
                        <TableCell className="text-right text-[var(--fin-negative-text)] font-medium">{formatBRL(mes.saidasRealizadas)}</TableCell>
                        <TableCell
                          className={`text-right font-semibold ${
 mes.saldoMensal >= 0 ? 'text-[var(--fin-positive)] bg-[var(--fin-positive-soft)]' : 'text-[var(--fin-negative-text)] bg-[var(--fin-negative-soft)]'
 }`}
                        >
                          {formatBRL(mes.saldoMensal)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-bold ${
 mes.saldoAcumulado >= 0 ? 'text-[var(--fin-positive)] bg-[var(--fin-positive-soft)]' : 'text-[var(--fin-negative-text)] bg-[var(--fin-negative-soft)]'
 }`}
                        >
                          {formatBRL(mes.saldoAcumulado)}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}

                {fluxo.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={isAgencia ? 5 : 7} className="text-center text-[var(--t-text-secondary)] py-8">
                      Nenhum dado de fluxo de caixa disponivel. Cadastre vendas e
                      fornecedores para gerar o fluxo.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
