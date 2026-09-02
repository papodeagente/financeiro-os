'use client';

import { useEffect, useState, useMemo } from 'react';
import { ExtratoLinha, ContaBancaria, ContaReceber, ContaPagar, StatusConciliacao } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { parseMoneyBR, round2, divSegura, dataLocal, paraISO } from '@/lib/money';
import { toast } from '@/lib/toast';
import {
  Upload, CheckCircle2, AlertTriangle, X, Link2, FileSpreadsheet,
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

// Linha crua vinda do arquivo. `fitid` só existe em OFX — é o identificador
// da transação no banco e serve de chave de deduplicação na reimportação.
interface LinhaArquivo {
  data: string;
  descricao: string;
  valor: number;
  fitid?: string;
}

function parseCSV(text: string): LinhaArquivo[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  // Try to detect columns
  const cols = header.split(/[;,\t]/);
  const dateIdx = cols.findIndex(c => c.includes('data') || c.includes('date'));
  const descIdx = cols.findIndex(c => c.includes('desc') || c.includes('hist') || c.includes('memo'));
  const valIdx = cols.findIndex(c => c.includes('valor') || c.includes('amount') || c.includes('value'));

  const result: LinhaArquivo[] = [];
  const sep = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(p => p.replace(/^"|"$/g, '').trim());
    if (parts.length < 3) continue;

    const rawDate = parts[dateIdx >= 0 ? dateIdx : 0];
    const desc = parts[descIdx >= 0 ? descIdx : 1];
    // parseMoneyBR decide qual separador é decimal. Limpar o ponto na mão
    // transformava 1234.56 em 123456 (valor 100x maior).
    const valor = parseMoneyBR(parts[valIdx >= 0 ? valIdx : 2]);
    if (valor === null) continue;

    // Parse date (DD/MM/YYYY or YYYY-MM-DD)
    let isoDate = rawDate;
    if (rawDate.includes('/')) {
      const [d, m, y] = rawDate.split('/');
      isoDate = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    result.push({ data: paraISO(isoDate), descricao: desc, valor: round2(valor) });
  }
  return result;
}

function parseOFX(text: string): LinhaArquivo[] {
  const result: LinhaArquivo[] = [];
  const transactions = text.split('<STMTTRN>').slice(1);

  for (const tx of transactions) {
    const getTag = (tag: string) => {
      const match = tx.match(new RegExp(`<${tag}>([^<\\n]+)`));
      return match ? match[1].trim() : '';
    };

    const rawDate = getTag('DTPOSTED');
    const fitid = getTag('FITID');
    const desc = getTag('MEMO') || getTag('NAME') || fitid;
    const valor = parseMoneyBR(getTag('TRNAMT'));
    if (valor === null || !rawDate) continue;

    const isoDate = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;
    result.push({ data: isoDate, descricao: desc, valor: round2(valor), ...(fitid ? { fitid } : {}) });
  }
  return result;
}

// Leitura/gravação que ESTOURA em erro — conciliação precisa saber se a
// segunda escrita falhou para desfazer a primeira.
async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(body?.error || 'Lançamento não encontrado no servidor.');
  return body as T;
}

async function putJSON<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'Falha ao gravar no servidor.');
  return body as T;
}

export default function ConciliacaoPage() {
  const [extrato, setExtrato] = useState<ExtratoLinha[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [conciliando, setConciliando] = useState(false);
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

  // A importação inteira roda no servidor (/api/conciliacao/importar): lá ela
  // é deduplicada contra o que já existe na conta e gravada numa única
  // transação, então reimportar o mesmo arquivo não duplica nem deixa
  // importação pela metade se algo falhar no meio.
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file || !selectedConta) return;
    setImporting(true);

    try {
      const text = await file.text();
      const isOFX = file.name.toLowerCase().endsWith('.ofx') || file.name.toLowerCase().endsWith('.qfx');
      const parsed = isOFX ? parseOFX(text) : parseCSV(text);

      if (parsed.length === 0) {
        toast.warning('Nenhum lançamento reconhecido no arquivo.');
        return;
      }

      const res = await fetch('/api/conciliacao/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conta_bancaria_id: selectedConta,
          arquivo_origem: file.name,
          linhas: parsed,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Falha ao importar o extrato.');

      const inseridas = Number(body?.inseridas) || 0;
      const duplicadas = Number(body?.duplicadas) || 0;
      toast.success(
        `${inseridas} lançamento(s) importado(s)`,
        duplicadas > 0 ? `${duplicadas} já existiam na conta e foram ignorados` : undefined,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao importar o extrato.');
    } finally {
      setImporting(false);
      // Reset input
      input.value = '';
      load();
    }
  }

  // Lançamentos já amarrados a alguma linha CONCILIADA do extrato (de qualquer
  // conta): não podem ser oferecidos de novo, senão a mesma CR/CP é baixada
  // duas vezes por duas linhas diferentes.
  const idsJaConciliados = useMemo(() => {
    const ids = new Set<string>();
    for (const e of extrato) {
      if (e.status_conciliacao === 'CONCILIADO' && e.lancamento_vinculado_id) {
        ids.add(e.lancamento_vinculado_id);
      }
    }
    return ids;
  }, [extrato]);

  // Auto-match: find lancamentos that could match an extrato line
  function findMatches(line: ExtratoLinha) {
    const tolerance = 0.01;
    const absVal = Math.abs(line.valor);

    if (line.tipo === 'CREDITO') {
      return contasReceber
        .filter(cr =>
          Math.abs(cr.valor_final - absVal) <= tolerance &&
          cr.status !== 'CANCELADO' &&
          cr.status !== 'RECEBIDO' &&
          !idsJaConciliados.has(cr.id))
        .map(cr => ({ id: cr.id, tipo: 'CONTA_RECEBER' as const, desc: `${cr.cliente_nome} — ${cr.descricao}`, valor: cr.valor_final, data: cr.data_vencimento }));
    } else {
      return contasPagar
        .filter(cp =>
          Math.abs(cp.valor_final - absVal) <= tolerance &&
          cp.status !== 'CANCELADO' &&
          cp.status !== 'PAGO' &&
          !idsJaConciliados.has(cp.id))
        .map(cp => ({ id: cp.id, tipo: 'CONTA_PAGAR' as const, desc: `${cp.fornecedor_nome} — ${cp.descricao}`, valor: cp.valor_final, data: cp.data_vencimento }));
    }
  }

  async function handleConciliar(line: ExtratoLinha, lancId: string, lancTipo: 'CONTA_RECEBER' | 'CONTA_PAGAR' | 'TRANSFERENCIA') {
    if (conciliando) return;
    setConciliando(true);
    const valorBaixa = round2(Math.abs(line.valor));

    try {
      await putJSON<ExtratoLinha>(`/api/extrato-bancario/${line.id}`, {
        ...line,
        status_conciliacao: 'CONCILIADO',
        lancamento_vinculado_id: lancId,
        lancamento_vinculado_tipo: lancTipo,
      });

      // Baixa da CR/CP: relê o registro do servidor e aplica SÓ os campos da
      // baixa por cima. Usar o objeto que está no estado da tela reverteria
      // qualquer edição feita por outro usuário desde o último load().
      try {
        if (lancTipo === 'CONTA_RECEBER') {
          const atual = await getJSON<ContaReceber>(`/api/contas-receber/${lancId}`);
          await putJSON<ContaReceber>(`/api/contas-receber/${lancId}`, {
            ...atual,
            status: 'RECEBIDO',
            data_recebimento: line.data,
            valor_recebido: valorBaixa,
            conta_bancaria_id: line.conta_bancaria_id,
          });
        } else if (lancTipo === 'CONTA_PAGAR') {
          const atual = await getJSON<ContaPagar>(`/api/contas-pagar/${lancId}`);
          await putJSON<ContaPagar>(`/api/contas-pagar/${lancId}`, {
            ...atual,
            status: 'PAGO',
            data_pagamento: line.data,
            valor_pago: valorBaixa,
            conta_bancaria_id: line.conta_bancaria_id,
          });
        }
      } catch (err) {
        // Baixa falhou: devolve a linha do extrato ao estado anterior para não
        // deixar um "CONCILIADO" apontando para lançamento que não baixou.
        await putJSON<ExtratoLinha>(`/api/extrato-bancario/${line.id}`, line).catch(() => {});
        throw err;
      }

      toast.success('Lançamento conciliado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível conciliar o lançamento.');
    } finally {
      setConciliando(false);
      setConciliarItem(null);
      load();
    }
  }

  async function marcarStatus(line: ExtratoLinha, status: StatusConciliacao) {
    try {
      await putJSON<ExtratoLinha>(`/api/extrato-bancario/${line.id}`, { ...line, status_conciliacao: status });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar a linha do extrato.');
    } finally {
      setConciliarItem(null);
      load();
    }
  }

  async function handleIgnorar(line: ExtratoLinha) {
    await marcarStatus(line, 'IGNORADO');
  }

  async function handleDivergente(line: ExtratoLinha) {
    await marcarStatus(line, 'DIVERGENTE');
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
    return { total, conciliados, pendentes, divergentes, pct: Math.round(divSegura(conciliados, total) * 100) };
  }, [contaExtrato]);

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        <MinimalPageHead
          title="Conciliação bancária"
          meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Importe extratos e concilie com lançamentos do sistema</p>}
          actions={
            <>
              <select
                value={selectedConta}
                onChange={e => setSelectedConta(e.target.value)}
                className="h-[34px] px-3 text-[12px] border"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)', color: 'var(--ink)' }}
              >
                {contas.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
              <label className="cursor-pointer">
                <input type="file" accept=".csv,.ofx,.qfx,.txt" onChange={handleImport} className="hidden" />
                <div className="h-[34px] px-3 text-[12px] font-medium flex items-center gap-2 cursor-pointer" style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}>
                  <Upload className="w-3.5 h-3.5" />
                  {importing ? 'Importando…' : 'Importar extrato'}
                </div>
              </label>
            </>
          }
        />

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
                  : 'bg-[var(--t-surface)] text-[var(--t-text-secondary)] shadow-[var(--t-card-shadow)]'
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
              <div className="p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] mb-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-[var(--t-text)]">{conciliarItem.descricao}</p>
                    <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
                      {dataLocal(conciliarItem.data)?.toLocaleDateString('pt-BR') ?? '—'}
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
                      <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] hover:border-[var(--t-green)]/50 cursor-pointer transition-colors"
                        onClick={() => handleConciliar(conciliarItem, m.id, m.tipo)}
                      >
                        <div>
                          <p className="text-sm text-[var(--t-text)]">{m.desc}</p>
                          <p className="text-xs text-[var(--t-text-muted)]">
                            {dataLocal(m.data)?.toLocaleDateString('pt-BR') ?? ''} · {m.tipo === 'CONTA_RECEBER' ? 'Conta a Receber' : 'Conta a Pagar'}
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
                <Button variant="outline" disabled={conciliando} onClick={() => handleIgnorar(conciliarItem)}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)]">
                  Ignorar
                </Button>
                <Button variant="outline" disabled={conciliando} onClick={() => handleDivergente(conciliarItem)}
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
                          {dataLocal(item.data)?.toLocaleDateString('pt-BR') ?? '—'}
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

        <MinimalFooter pageId="conciliação" />
      </div>
    </div>
  );
}
