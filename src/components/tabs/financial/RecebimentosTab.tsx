'use client';

import { useState, useEffect, useMemo } from 'react';
import { GrupoViagem } from '@/lib/types';
import { Parcela, StatusParcela } from '@/lib/financial-types';
import { calcRecebimentosMetrics, atualizarParcelasAtrasadas } from '@/lib/financial-calculations';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { formatBRL, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface RecebimentosTabProps {
  grupo: GrupoViagem;
  onChange: (g: GrupoViagem) => void;
}

type FiltroStatus = StatusParcela | 'TODOS';

const STATUS_BADGE: Record<StatusParcela, { label: string; className: string }> = {
  PENDENTE: { label: 'Pendente', className: 'bg-yellow-600 text-yellow-100 hover:bg-yellow-600' },
  RECEBIDO: { label: 'Recebido', className: 'bg-green-700 text-green-100 hover:bg-green-700' },
  ATRASADO: { label: 'Atrasado', className: 'bg-red-700 text-red-100 hover:bg-red-700' },
  CANCELADO: { label: 'Cancelado', className: 'bg-[var(--t-surface)] text-[var(--t-text)] hover:bg-[var(--t-surface)]' },
};

const FORMAS_RECEBIMENTO = ['PIX', 'TED', 'Cartao', 'Boleto', 'Dinheiro'] as const;

export default function RecebimentosTab({ grupo, onChange }: RecebimentosTabProps) {
  // Initialize financeiro if missing
  const financeiro = grupo.financeiro ?? createFinanceiroGrupo();

  // Auto-update overdue parcelas on render
  useEffect(() => {
    const atualizadas = atualizarParcelasAtrasadas(financeiro.parcelas);
    const changed = atualizadas.some(
      (p, i) => p.status !== financeiro.parcelas[i]?.status
    );
    if (changed) {
      onChange({
        ...grupo,
        financeiro: { ...financeiro, parcelas: atualizadas },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filters
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('TODOS');
  const [busca, setBusca] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [parcelaSelecionada, setParcelaSelecionada] = useState<Parcela | null>(null);
  const [recebForm, setRecebForm] = useState({
    data_recebimento: new Date().toISOString().split('T')[0],
    valor_recebido: '',
    forma_recebimento: 'PIX' as string,
  });

  // Metrics
  const metrics = useMemo(
    () => calcRecebimentosMetrics(financeiro.parcelas),
    [financeiro.parcelas]
  );

  // Filtered parcelas
  const parcelasFiltradas = useMemo(() => {
    let result = [...financeiro.parcelas];

    if (filtroStatus !== 'TODOS') {
      result = result.filter((p) => p.status === filtroStatus);
    }

    if (busca.trim()) {
      const term = busca.toLowerCase();
      result = result.filter((p) => p.cliente_nome.toLowerCase().includes(term));
    }

    if (dataInicio) {
      result = result.filter((p) => p.data_vencimento >= dataInicio);
    }
    if (dataFim) {
      result = result.filter((p) => p.data_vencimento <= dataFim);
    }

    // Sort by due date
    result.sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento));

    return result;
  }, [financeiro.parcelas, filtroStatus, busca, dataInicio, dataFim]);

  // Handlers
  const abrirConfirmacao = (parcela: Parcela) => {
    setParcelaSelecionada(parcela);
    setRecebForm({
      data_recebimento: new Date().toISOString().split('T')[0],
      valor_recebido: parcela.valor.toFixed(2),
      forma_recebimento: 'PIX',
    });
    setDialogOpen(true);
  };

  const confirmarRecebimento = () => {
    if (!parcelaSelecionada) return;
    const valor = parseFloat(recebForm.valor_recebido.replace(',', '.'));
    if (isNaN(valor) || valor <= 0) return;

    const novasParcelas = financeiro.parcelas.map((p) =>
      p.id === parcelaSelecionada.id
        ? {
            ...p,
            status: 'RECEBIDO' as StatusParcela,
            data_recebimento: recebForm.data_recebimento,
            valor_recebido: valor,
            forma_recebimento: recebForm.forma_recebimento,
          }
        : p
    );

    onChange({
      ...grupo,
      financeiro: { ...financeiro, parcelas: novasParcelas },
    });
    setDialogOpen(false);
    setParcelaSelecionada(null);
  };

  const cancelarParcela = (parcelaId: string) => {
    const novasParcelas = financeiro.parcelas.map((p) =>
      p.id === parcelaId ? { ...p, status: 'CANCELADO' as StatusParcela } : p
    );
    onChange({
      ...grupo,
      financeiro: { ...financeiro, parcelas: novasParcelas },
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div
        className="rounded-lg p-4"
        style={{ backgroundColor: '#1a1a2e' }}
      >
        <h3
          className="text-sm font-bold mb-3 uppercase tracking-wider"
          style={{ color: '#d4a853' }}
        >
          Resumo de Recebimentos
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-[var(--t-text-secondary)]">Total a Receber</p>
            <p className="text-lg font-bold text-[var(--t-text)]">
              {formatBRL(metrics.totalAReceber)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--t-text-secondary)]">Total Recebido</p>
            <p className="text-lg font-bold text-green-400">
              {formatBRL(metrics.totalRecebido)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--t-text-secondary)]">Total Atrasado</p>
            <p className="text-lg font-bold text-red-400">
              {formatBRL(metrics.totalAtrasado)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--t-text-secondary)]">Taxa Inadimplencia</p>
            <p className="text-lg font-bold text-yellow-400">
              {metrics.taxaInadimplencia.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--t-text-secondary)]">Previsao 30d</p>
            <p className="text-lg font-bold text-blue-400">
              {formatBRL(metrics.previsao30d)}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 p-3 bg-[var(--t-surface-hover)] dark:bg-[var(--t-bg)] rounded-lg border">
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--t-text-secondary)]">Status</label>
          <Select
            value={filtroStatus}
            onValueChange={(v) => setFiltroStatus(v as FiltroStatus)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos</SelectItem>
              <SelectItem value="PENDENTE">Pendente</SelectItem>
              <SelectItem value="RECEBIDO">Recebido</SelectItem>
              <SelectItem value="ATRASADO">Atrasado</SelectItem>
              <SelectItem value="CANCELADO">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--t-text-secondary)]">Cliente</label>
          <Input
            placeholder="Buscar por nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-[200px]"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--t-text-secondary)]">Vencimento De</label>
          <Input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-[160px]"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--t-text-secondary)]">Vencimento Ate</label>
          <Input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="w-[160px]"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFiltroStatus('TODOS');
            setBusca('');
            setDataInicio('');
            setDataFim('');
          }}
        >
          Limpar Filtros
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: '#1a1a2e' }}>
              {[
                'Vencimento',
                'Cliente',
                'Parcela',
                'Valor',
                'Status',
                'Dt Recebimento',
                'Valor Recebido',
                'Acoes',
              ].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider border-b border-[var(--t-border)]"
                  style={{ color: '#d4a853' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {parcelasFiltradas.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-[var(--t-text-secondary)]"
                >
                  Nenhuma parcela encontrada.
                </td>
              </tr>
            ) : (
              parcelasFiltradas.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-[var(--t-surface-hover)] dark:hover:bg-[var(--t-surface)]/50"
                >
                  <td className="px-3 py-2 border-r border-gray-100 dark:border-[var(--t-border)] whitespace-nowrap">
                    {formatDate(p.data_vencimento)}
                  </td>
                  <td className="px-3 py-2 border-r border-gray-100 dark:border-[var(--t-border)]">
                    {p.cliente_nome}
                  </td>
                  <td className="px-3 py-2 border-r border-gray-100 dark:border-[var(--t-border)] text-center whitespace-nowrap">
                    {p.numero_parcela}/{p.total_parcelas}
                  </td>
                  <td className="px-3 py-2 border-r border-gray-100 dark:border-[var(--t-border)] text-right whitespace-nowrap font-mono">
                    {formatBRL(p.valor)}
                  </td>
                  <td className="px-3 py-2 border-r border-gray-100 dark:border-[var(--t-border)]">
                    <Badge className={STATUS_BADGE[p.status].className}>
                      {STATUS_BADGE[p.status].label}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 border-r border-gray-100 dark:border-[var(--t-border)] whitespace-nowrap">
                    {formatDate(p.data_recebimento)}
                  </td>
                  <td className="px-3 py-2 border-r border-gray-100 dark:border-[var(--t-border)] text-right whitespace-nowrap font-mono">
                    {formatBRL(p.valor_recebido)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {(p.status === 'PENDENTE' || p.status === 'ATRASADO') && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 border-green-600 text-green-600 hover:bg-green-600 hover:text-[var(--t-text)]"
                          onClick={() => abrirConfirmacao(p)}
                        >
                          Confirmar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 border-gray-400 text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]0 hover:text-[var(--t-text)]"
                          onClick={() => cancelarParcela(p.id)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Count */}
      <p className="text-xs text-[var(--t-text-secondary)] text-right">
        Exibindo {parcelasFiltradas.length} de {financeiro.parcelas.length} parcelas
      </p>

      {/* Confirmar Recebimento Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Recebimento</DialogTitle>
          </DialogHeader>

          {parcelaSelecionada && (
            <div className="space-y-4">
              <div className="rounded-lg p-3 bg-[var(--t-surface-hover)] dark:bg-[var(--t-surface)] text-sm space-y-1">
                <p>
                  <span className="font-medium">Cliente:</span>{' '}
                  {parcelaSelecionada.cliente_nome}
                </p>
                <p>
                  <span className="font-medium">Parcela:</span>{' '}
                  {parcelaSelecionada.numero_parcela}/{parcelaSelecionada.total_parcelas}
                </p>
                <p>
                  <span className="font-medium">Vencimento:</span>{' '}
                  {formatDate(parcelaSelecionada.data_vencimento)}
                </p>
                <p>
                  <span className="font-medium">Valor:</span>{' '}
                  {formatBRL(parcelaSelecionada.valor)}
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Data do Recebimento</label>
                  <Input
                    type="date"
                    value={recebForm.data_recebimento}
                    onChange={(e) =>
                      setRecebForm({ ...recebForm, data_recebimento: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Valor Recebido (R$)</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={recebForm.valor_recebido}
                    onChange={(e) =>
                      setRecebForm({ ...recebForm, valor_recebido: e.target.value })
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Forma de Recebimento</label>
                  <Select
                    value={recebForm.forma_recebimento}
                    onValueChange={(v) =>
                      setRecebForm({ ...recebForm, forma_recebimento: v ?? '' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMAS_RECEBIMENTO.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Voltar
            </Button>
            <Button
              onClick={confirmarRecebimento}
              className="text-[var(--t-text)]"
              style={{ backgroundColor: '#d4a853' }}
            >
              Confirmar Recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
