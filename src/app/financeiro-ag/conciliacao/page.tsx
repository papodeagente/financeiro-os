'use client';

import { useEffect, useState, useMemo } from 'react';
import { ExtratoLinha, ContaBancaria, ContaReceber, ContaPagar, StatusConciliacao } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Upload, CheckCircle2, AlertTriangle, X, Link2, Eye, FileSpreadsheet,
  ArrowUpCircle, ArrowDownCircle, Search,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_BADGE: Record<StatusConciliacao, string> = {
  PENDENTE: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  CONCILIADO: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
  DIVERGENTE: 'bg-[var(--t-red-bg)] text-[var(--t-red)]',
  IGNORADO: 'bg-[var(--t-surface)] text-[var(--t-text-muted)]',
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function parseCSV(text: string): Array<{ data: string; descricao: string; valor: number }> {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  // Try to detect columns
  const cols = header.split(/[;,\t]/);
  const dateIdx = cols.findIndex(c => c.includes('data') || c.includes('date'));
  const descIdx = cols.findIndex(c => c.includes('desc') || c.includes('hist') || c.includes('memo'));
  const valIdx = cols.findIndex(c => c.includes('valor') || c.includes('amount') || c.includes('value'));

  const result: Array<{ data: string; descricao: string; valor: number }> = [];
  const sep = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(p => p.replace(/^"|"$/g, '').trim());
    if (parts.length < 3) continue;

    const rawDate = parts[dateIdx >= 0 ? dateIdx : 0];
    const desc = parts[descIdx >= 0 ? descIdx : 1];
    const rawVal = parts[valIdx >= 0 ? valIdx : 2].replace(/[R$\s.]/g, '').replace(',', '.');
    const valor = parseFloat(rawVal);
    if (isNaN(valor)) continue;

    // Parse date (DD/MM/YYYY or YYYY-MM-DD)
    let isoDate = rawDate;
    if (rawDate.includes('/')) {
      const [d, m, y] = rawDate.split('/');
      isoDate = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    result.push({ data: isoDate, descricao: desc, valor });
  }
  return result;
}

function parseOFX(text: string): Array<{ data: string; descricao: string; valor: number }> {
  const result: Array<{ data: string; descricao: string; valor: number }> = [];
  const transactions = text.split('<STMTTRN>').slice(1);

  for (const tx of transactions) {
    const getTag = (tag: string) => {
      const match = tx.match(new RegExp(`<${tag}>([^<\\n]+)`));
      return match ? match[1].trim() : '';
    };

    const rawDate = getTag('DTPOSTED');
    const rawVal = getTag('TRNAMT').replace(',', '.');
    const desc = getTag('MEMO') || getTag('NAME') || getTag('FITID');
    const valor = parseFloat(rawVal);
    if (isNaN(valor) || !rawDate) continue;

    const isoDate = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;
    result.push({ data: isoDate, descricao: desc, valor });
  }
  return result;
}

export default function ConciliacaoPage() {
  const [extrato, setExtrato] = useState<ExtratoLinha[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectedConta, setSelectedConta] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusConciliacao | 'TODOS'>('TODOS');
  const [searchTerm, setSearchTerm] = useState('');

  // Conciliation modal
  const [conciliarItem, setConciliarItem] = useState<ExtratoLinha | null>(null);

  async function load() {
    setLoading(true);
    const [e, c, cr, cp] = await Promise.all([
      loadEntities<ExtratoLinha>('extrato-bancario'),
      loadEntities<ContaBancaria>('contas-bancarias'),
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
    ]);
    setExtrato(e);
    setContas(c);
    setContasReceber(cr);
    setContasPagar(cp);
    if (c.length > 0 && !selectedConta) setSelectedConta(c[0].id);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedConta) return;
    setImporting(true);

    const text = await file.text();
    const isOFX = file.name.toLowerCase().endsWith('.ofx') || file.name.toLowerCase().endsWith('.qfx');
    const parsed = isOFX ? parseOFX(text) : parseCSV(text);

    let saldo = 0;
    for (const line of parsed) {
      saldo += line.valor;
      const item: ExtratoLinha = {
        id: generateId(),
        conta_bancaria_id: selectedConta,
        data: line.data,
        descricao: line.descricao,
        valor: line.valor,
        tipo: line.valor >= 0 ? 'CREDITO' : 'DEBITO',
        saldo,
        status_conciliacao: 'PENDENTE',
        lancamento_vinculado_id: null,
        lancamento_vinculado_tipo: null,
        observacao_conciliacao: '',
        importado_em: new Date().toISOString(),
        arquivo_origem: file.name,
      };
      await saveEntity('extrato-bancario', item);
    }

    setImporting(false);
    // Reset input
    e.target.value = '';
    load();
  }

  // Auto-match: find lancamentos that could match an extrato line
  function findMatches(line: ExtratoLinha) {
    const tolerance = 0.01;
    const absVal = Math.abs(line.valor);

    if (line.tipo === 'CREDITO') {
      return contasReceber
        .filter(cr => Math.abs(cr.valor_final - absVal) <= tolerance && cr.status !== 'CANCELADO')
        .map(cr => ({ id: cr.id, tipo: 'CONTA_RECEBER' as const, desc: `${cr.cliente_nome} — ${cr.descricao}`, valor: cr.valor_final, data: cr.data_vencimento }));
    } else {
      return contasPagar
        .filter(cp => Math.abs(cp.valor_final - absVal) <= tolerance && cp.status !== 'CANCELADO')
        .map(cp => ({ id: cp.id, tipo: 'CONTA_PAGAR' as const, desc: `${cp.fornecedor_nome} — ${cp.descricao}`, valor: cp.valor_final, data: cp.data_vencimento }));
    }
  }

  async function handleConciliar(line: ExtratoLinha, lancId: string, lancTipo: 'CONTA_RECEBER' | 'CONTA_PAGAR' | 'TRANSFERENCIA') {
    const updated: ExtratoLinha = {
      ...line,
      status_conciliacao: 'CONCILIADO',
      lancamento_vinculado_id: lancId,
      lancamento_vinculado_tipo: lancTipo,
    };
    await updateEntity('extrato-bancario', updated);

    // Mark the lancamento as paid/received
    if (lancTipo === 'CONTA_RECEBER') {
      const cr = contasReceber.find(c => c.id === lancId);
      if (cr) {
        await updateEntity('contas-receber', {
          ...cr,
          status: 'RECEBIDO',
          data_recebimento: line.data,
          valor_recebido: Math.abs(line.valor),
          conta_bancaria_id: line.conta_bancaria_id,
        });
      }
    } else if (lancTipo === 'CONTA_PAGAR') {
      const cp = contasPagar.find(c => c.id === lancId);
      if (cp) {
        await updateEntity('contas-pagar', {
          ...cp,
          status: 'PAGO',
          data_pagamento: line.data,
          valor_pago: Math.abs(line.valor),
          conta_bancaria_id: line.conta_bancaria_id,
        });
      }
    }

    setConciliarItem(null);
    load();
  }

  async function handleIgnorar(line: ExtratoLinha) {
    await updateEntity('extrato-bancario', { ...line, status_conciliacao: 'IGNORADO' });
    setConciliarItem(null);
    load();
  }

  async function handleDivergente(line: ExtratoLinha) {
    await updateEntity('extrato-bancario', { ...line, status_conciliacao: 'DIVERGENTE' });
    setConciliarItem(null);
    load();
  }

  const contaExtrato = extrato.filter(e => e.conta_bancaria_id === selectedConta);
  const filtered = contaExtrato.filter(e => {
    if (filterStatus !== 'TODOS' && e.status_conciliacao !== filterStatus) return false;
    if (searchTerm && !e.descricao.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.data.localeCompare(a.data));

  const stats = useMemo(() => {
    const total = contaExtrato.length;
    const conciliados = contaExtrato.filter(e => e.status_conciliacao === 'CONCILIADO').length;
    const pendentes = contaExtrato.filter(e => e.status_conciliacao === 'PENDENTE').length;
    const divergentes = contaExtrato.filter(e => e.status_conciliacao === 'DIVERGENTE').length;
    return { total, conciliados, pendentes, divergentes, pct: total > 0 ? Math.round((conciliados / total) * 100) : 0 };
  }, [contaExtrato]);

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Conciliação Bancária</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Importe extratos e concilie com lançamentos do sistema</p>
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={selectedConta}
              onChange={e => setSelectedConta(e.target.value)}
              className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
            >
              {contas.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            <label className="cursor-pointer">
              <input type="file" accept=".csv,.ofx,.qfx,.txt" onChange={handleImport} className="hidden" />
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold text-sm cursor-pointer">
                <Upload className="w-4 h-4" />
                {importing ? 'Importando...' : 'Importar Extrato'}
              </div>
            </label>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-[var(--t-text)]">{stats.total}</p>
              <p className="text-[var(--t-text-muted)] text-xs uppercase mt-1">Total Linhas</p>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-[var(--t-green)]">{stats.conciliados}</p>
              <p className="text-[var(--t-text-muted)] text-xs uppercase mt-1">Conciliados</p>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-[var(--t-amber)]">{stats.pendentes}</p>
              <p className="text-[var(--t-text-muted)] text-xs uppercase mt-1">Pendentes</p>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-[var(--t-blue)]">{stats.pct}%</div>
              <div className="w-full bg-[var(--t-bg)] rounded-full h-1.5 mt-2">
                <div className="bg-[var(--t-green)] h-1.5 rounded-full transition-all" style={{ width: `${stats.pct}%` }} />
              </div>
              <p className="text-[var(--t-text-muted)] text-xs uppercase mt-1">Progresso</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t-text-muted)]" />
            <Input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Buscar no extrato..."
              className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] pl-9"
            />
          </div>
          {(['TODOS', 'PENDENTE', 'CONCILIADO', 'DIVERGENTE', 'IGNORADO'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterStatus === s
                  ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14]'
                  : 'bg-[var(--t-surface)] text-[var(--t-text-secondary)] border border-[var(--t-border)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Conciliation Modal */}
        {conciliarItem && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base flex items-center gap-2">
                <Link2 className="w-4 h-4" /> Conciliar Lançamento
              </CardTitle>
              <button onClick={() => setConciliarItem(null)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="p-3 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)] mb-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-[var(--t-text)]">{conciliarItem.descricao}</p>
                    <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
                      {new Date(conciliarItem.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <p className={`font-mono font-bold text-lg ${conciliarItem.valor >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                    {BRL(conciliarItem.valor)}
                  </p>
                </div>
              </div>

              <p className="text-xs text-[var(--t-text-muted)] uppercase mb-2">Lançamentos compatíveis</p>
              {(() => {
                const matches = findMatches(conciliarItem);
                if (matches.length === 0) {
                  return <p className="text-[var(--t-text-muted)] text-sm py-4 text-center">Nenhum lançamento encontrado com valor compatível.</p>;
                }
                return (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {matches.map(m => (
                      <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)] hover:border-[var(--t-green)]/50 cursor-pointer transition-colors"
                        onClick={() => handleConciliar(conciliarItem, m.id, m.tipo)}
                      >
                        <div>
                          <p className="text-sm text-[var(--t-text)]">{m.desc}</p>
                          <p className="text-xs text-[var(--t-text-muted)]">
                            {m.data ? new Date(m.data + 'T00:00:00').toLocaleDateString('pt-BR') : ''} · {m.tipo === 'CONTA_RECEBER' ? 'Conta a Receber' : 'Conta a Pagar'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm text-[var(--t-text)]">{BRL(m.valor)}</span>
                          <CheckCircle2 className="w-4 h-4 text-[var(--t-green)]" />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="flex gap-2 mt-4">
                <Button variant="outline" onClick={() => handleIgnorar(conciliarItem)}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)]">
                  Ignorar
                </Button>
                <Button variant="outline" onClick={() => handleDivergente(conciliarItem)}
                  className="border-[var(--t-red)]/30 text-[var(--t-red)]">
                  <AlertTriangle className="w-3 h-3 mr-1" /> Marcar Divergente
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Extrato Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[var(--t-green)]" />
              Extrato ({filtered.length} linhas)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-[var(--t-text-secondary)] text-sm p-6">Carregando...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8">
                <FileSpreadsheet className="w-10 h-10 text-[var(--t-text-muted)] mx-auto mb-3" />
                <p className="text-[var(--t-text-muted)] text-sm">Nenhum extrato importado para esta conta.</p>
                <p className="text-[var(--t-text-muted)] text-xs mt-1">Importe um arquivo CSV ou OFX para iniciar a conciliação.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                      <th className="text-left px-4 py-3">Data</th>
                      <th className="text-left px-4 py-3">Descrição</th>
                      <th className="text-right px-4 py-3">Valor</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(item => (
                      <tr key={item.id} className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] transition-colors">
                        <td className="px-4 py-3 text-[var(--t-text-secondary)]">
                          {new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-4 py-3 text-[var(--t-text)] max-w-md">
                          <div className="flex items-center gap-2">
                            {item.tipo === 'CREDITO'
                              ? <ArrowUpCircle className="w-4 h-4 text-[var(--t-green)] shrink-0" />
                              : <ArrowDownCircle className="w-4 h-4 text-[var(--t-red)] shrink-0" />
                            }
                            <span className="truncate">{item.descricao}</span>
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-medium ${item.valor >= 0 ? 'text-[var(--t-green)]' : 'text-[var(--t-red)]'}`}>
                          {BRL(item.valor)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`${STATUS_BADGE[item.status_conciliacao]} border-0 text-xs`}>
                            {item.status_conciliacao}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {item.status_conciliacao === 'PENDENTE' && (
                            <Button size="sm" onClick={() => setConciliarItem(item)}
                              className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] h-7 px-3 text-xs">
                              <Link2 className="w-3 h-3 mr-1" /> Conciliar
                            </Button>
                          )}
                          {item.status_conciliacao === 'CONCILIADO' && (
                            <span className="text-xs text-[var(--t-green)] flex items-center gap-1 justify-end">
                              <CheckCircle2 className="w-3 h-3" /> OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
