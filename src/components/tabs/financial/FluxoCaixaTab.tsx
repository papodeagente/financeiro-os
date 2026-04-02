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
import { calcFluxoCaixa } from '@/lib/financial-calculations';

interface FluxoCaixaTabProps {
  grupo: GrupoViagem;
  onChange?: (g: GrupoViagem) => void;
}

export default function FluxoCaixaTab({ grupo, onChange }: FluxoCaixaTabProps) {
  const financeiro = grupo.financeiro ?? createFinanceiroGrupo();

  const fluxo = useMemo(() => calcFluxoCaixa(financeiro), [financeiro]);

  const totalEntradas = fluxo.reduce((s, m) => s + m.entradasRealizadas, 0);
  const totalSaidas = fluxo.reduce((s, m) => s + m.saidasRealizadas, 0);
  const saldoFinal = fluxo.length > 0 ? fluxo[fluxo.length - 1].saldoAcumulado : 0;
  const mesesNegativos = fluxo.filter((m) => m.saldoAcumulado < 0);

  return (
    <div className="space-y-6">
      {/* Cards resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-md" style={{ backgroundColor: '#1a1a2e' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--t-text-secondary)]">
              Total Entradas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-400">
              {formatBRL(totalEntradas)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md" style={{ backgroundColor: '#1a1a2e' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--t-text-secondary)]">
              Total Saidas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-400">
              {formatBRL(totalSaidas)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md" style={{ backgroundColor: '#1a1a2e' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--t-text-secondary)]">
              Saldo Final
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold ${
                saldoFinal >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {formatBRL(saldoFinal)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alerta de meses negativos */}
      {mesesNegativos.length > 0 && (
        <Alert variant="destructive" className="border-red-500 bg-red-950/40">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Atenção: {mesesNegativos.length} mês(es) com saldo acumulado negativo.
            Verifique o fluxo de caixa para evitar problemas de liquidez.
          </AlertDescription>
        </Alert>
      )}

      {/* Tabela de fluxo de caixa */}
      <Card className="border-0 shadow-md">
        <CardHeader style={{ backgroundColor: '#1a1a2e' }}>
          <CardTitle className="text-[var(--t-text)] flex items-center gap-2">
            <span style={{ color: '#d4a853' }}>$</span>
            Fluxo de Caixa Mensal
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow style={{ backgroundColor: '#1a1a2e' }}>
                  <TableHead className="text-[var(--t-text-secondary)] font-semibold">Mês</TableHead>
                  <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">
                    Entradas Prev.
                  </TableHead>
                  <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">
                    Entradas Real.
                  </TableHead>
                  <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">
                    Saidas Prev.
                  </TableHead>
                  <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">
                    Saidas Real.
                  </TableHead>
                  <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">
                    Saldo Mês
                  </TableHead>
                  <TableHead className="text-[var(--t-text-secondary)] font-semibold text-right">
                    Saldo Acum.
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fluxo.map((mes, idx) => {
                  const saldoMes = mes.entradasRealizadas - mes.saidasRealizadas;
                  return (
                    <TableRow
                      key={idx}
                      className={idx % 2 === 0 ? 'bg-[var(--t-surface-hover)]' : 'bg-[var(--t-surface)]'}
                    >
                      <TableCell className="font-medium">{mes.mes}</TableCell>
                      <TableCell className="text-right">
                        {formatBRL(mes.entradasPrevistas)}
                      </TableCell>
                      <TableCell className="text-right text-green-700 font-medium">
                        {formatBRL(mes.entradasRealizadas)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatBRL(mes.saidasPrevistas)}
                      </TableCell>
                      <TableCell className="text-right text-red-700 font-medium">
                        {formatBRL(mes.saidasRealizadas)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold ${
                          saldoMes >= 0 ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                        }`}
                      >
                        {formatBRL(saldoMes)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          mes.saldoAcumulado >= 0
                            ? 'text-green-700 bg-green-100'
                            : 'text-red-700 bg-red-100'
                        }`}
                      >
                        {formatBRL(mes.saldoAcumulado)}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {fluxo.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-[var(--t-text-secondary)] py-8">
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

      {/* Totais */}
      {fluxo.length > 0 && (
        <div
          className="rounded-lg p-4 flex flex-wrap gap-6 justify-between items-center"
          style={{ backgroundColor: '#1a1a2e' }}
        >
          <div>
            <span className="text-[var(--t-text-secondary)] text-sm">Entradas Previstas</span>
            <p className="text-[var(--t-text)] font-semibold">
              {formatBRL(fluxo.reduce((s, m) => s + m.entradasPrevistas, 0))}
            </p>
          </div>
          <div>
            <span className="text-[var(--t-text-secondary)] text-sm">Entradas Realizadas</span>
            <p className="text-green-400 font-semibold">{formatBRL(totalEntradas)}</p>
          </div>
          <div>
            <span className="text-[var(--t-text-secondary)] text-sm">Saidas Previstas</span>
            <p className="text-[var(--t-text)] font-semibold">
              {formatBRL(fluxo.reduce((s, m) => s + m.saidasPrevistas, 0))}
            </p>
          </div>
          <div>
            <span className="text-[var(--t-text-secondary)] text-sm">Saidas Realizadas</span>
            <p className="text-red-400 font-semibold">{formatBRL(totalSaidas)}</p>
          </div>
          <div>
            <span className="text-[var(--t-text-secondary)] text-sm">Saldo Final</span>
            <p
              className={`font-bold text-lg ${
                saldoFinal >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {formatBRL(saldoFinal)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
