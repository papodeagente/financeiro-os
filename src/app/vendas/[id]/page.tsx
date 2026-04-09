'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft, User, Calendar, CreditCard, Package,
  FileText, Users, Plane, Hotel, ShieldCheck,
  MapPin, Car, Ship, Ticket, Briefcase, Copy,
  DollarSign, Receipt, Wallet,
} from 'lucide-react';
import { VendaCRM, Cliente, FornecedorCRM, ContaReceber, ContaPagar } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtDate = (d: string) => {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
};

const STATUS_COLORS: Record<string, string> = {
  ORCAMENTO: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  RESERVADO: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  CONFIRMADO: 'bg-green-500/10 text-green-400 border-green-500/30',
  CANCELADO: 'bg-red-500/10 text-red-400 border-red-500/30',
  CONCLUIDO: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  ORCAMENTO: 'Orcamento',
  RESERVADO: 'Reservado',
  CONFIRMADO: 'Confirmado',
  CANCELADO: 'Cancelado',
  CONCLUIDO: 'Concluido',
};

const TIPO_ICONS: Record<string, typeof Plane> = {
  AEREO: Plane,
  HOTEL: Hotel,
  SEGURO: ShieldCheck,
  RECEPTIVO: MapPin,
  CARRO: Car,
  CRUZEIRO: Ship,
  INGRESSO: Ticket,
  PACOTE: Briefcase,
  GRUPO: Users,
  OUTROS: Package,
};

const FORMAS_PAGAMENTO_LABEL: Record<string, string> = {
  AVISTA_PIX: 'A Vista / PIX',
  CARTAO: 'Cartao',
  BOLETO: 'Boleto',
  FATURADO: 'Faturado',
  MISTO: 'Misto',
};

export default function VendaDetalhe() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [venda, setVenda] = useState<VendaCRM | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [fornecedores, setFornecedores] = useState<Record<string, FornecedorCRM>>({});
  const [loading, setLoading] = useState(true);
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [resumoFin, setResumoFin] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/vendas-crm/${id}`).then(r => r.json()),
      loadEntities<Cliente>('clientes'),
      loadEntities<FornecedorCRM>('fornecedores-crm'),
      fetch(`/api/vendas-crm/${id}/financeiro`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([v, cs, fs, fin]) => {
      if (v && !v.error) {
        setVenda(v);
        const c = cs.find((cl: Cliente) => cl.id === v.cliente_id);
        if (c) setCliente(c);
        const fMap: Record<string, FornecedorCRM> = {};
        fs.forEach((f: FornecedorCRM) => { fMap[f.id] = f; });
        setFornecedores(fMap);
      }
      if (fin && !fin.error) {
        setContasReceber(fin.contas_receber || []);
        setContasPagar(fin.contas_pagar || []);
        setResumoFin(fin.resumo || null);
      }
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    );
  }

  if (!venda) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--t-text-secondary)]">
        <Package className="w-12 h-12 opacity-30" />
        <p>Venda nao encontrada</p>
        <Button variant="ghost" onClick={() => router.push('/vendas')}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
        </Button>
      </div>
    );
  }

  const clienteNome = cliente
    ? cliente.tipo === 'PF'
      ? cliente.nome_completo
      : cliente.nome_fantasia || cliente.razao_social
    : '—';

  const lucro = (venda.valor_final || 0) - (venda.valor_total_custo || 0);

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] min-h-full">
      {/* Header */}
      <div className="border-b border-[var(--t-border)] bg-[var(--t-surface)]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/vendas')}
              className="text-[var(--t-text-muted)] hover:text-[var(--t-text)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-bold text-[var(--t-text)]">{venda.numero}</h1>
                <Badge className={`border text-xs ${STATUS_COLORS[venda.status] || ''}`}>
                  {STATUS_LABELS[venda.status] || venda.status}
                </Badge>
              </div>
              <p className="text-xs text-[var(--t-text-secondary)]">
                {fmtDate(venda.data_venda)} · {clienteNome}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)] border border-[var(--t-border)] text-xs gap-1.5"
            onClick={() => {
              navigator.clipboard.writeText(venda.numero);
              toast.success('Numero copiado');
            }}
          >
            <Copy className="w-3.5 h-3.5" /> Copiar numero
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Resumo financeiro */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Custo Total" value={fmt(venda.valor_total_custo || 0)} color="text-orange-400" />
          <SummaryCard label="Valor Venda" value={fmt(venda.valor_total_venda || 0)} color="text-blue-400" />
          <SummaryCard label="Desconto" value={fmt(venda.desconto || 0)} color="text-red-400" />
          <SummaryCard label="Valor Final" value={fmt(venda.valor_final || 0)} color="text-green-400" />
          <SummaryCard label="Lucro" value={fmt(lucro)} color={lucro >= 0 ? 'text-green-400' : 'text-red-400'} extra={
            venda.markup_realizado ? `Markup: ${venda.markup_realizado.toFixed(1)}%` : undefined
          } />
        </div>

        {/* Cliente */}
        <Section icon={User} title="Cliente">
          {cliente ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Info label="Nome" value={clienteNome} />
              <Info label="Tipo" value={cliente.tipo === 'PF' ? 'Pessoa Fisica' : 'Pessoa Juridica'} />
              <Info label="E-mail" value={cliente.email || '—'} />
              <Info label="Telefone" value={cliente.telefone_principal || '—'} />
              <Info label="WhatsApp" value={cliente.whatsapp || '—'} />
              {cliente.tipo === 'PF' && <Info label="CPF" value={cliente.cpf || '—'} />}
              {cliente.tipo === 'PJ' && <Info label="CNPJ" value={cliente.cnpj || '—'} />}
            </div>
          ) : (
            <p className="text-sm text-[var(--t-text-secondary)]">Cliente nao vinculado</p>
          )}
        </Section>

        {/* Passageiros */}
        {venda.passageiros.length > 0 && (
          <Section icon={Users} title={`Passageiros (${venda.passageiros.length})`}>
            <div className="divide-y divide-[var(--t-border)]">
              {venda.passageiros.map((pax, i) => (
                <div key={i} className="py-2.5 first:pt-0 last:pb-0 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Info label="Nome" value={pax.nome || '—'} />
                  <Info label="Tipo" value={pax.tipo} />
                  <Info label="Documento" value={pax.documento || '—'} />
                  <Info label="Nascimento" value={fmtDate(pax.data_nascimento)} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Produtos */}
        <Section icon={Package} title={`Produtos (${venda.produtos.length})`}>
          {venda.produtos.length === 0 ? (
            <p className="text-sm text-[var(--t-text-secondary)]">Nenhum produto cadastrado</p>
          ) : (
            <div className="space-y-3">
              {venda.produtos.map((prod, i) => {
                const Icon = TIPO_ICONS[prod.tipo] || Package;
                const fornecedor = prod.fornecedor_id ? fornecedores[prod.fornecedor_id] : null;
                const fornecedorNome = fornecedor
                  ? (fornecedor.nome_fantasia || fornecedor.razao_social)
                  : prod.fornecedor_nome || '—';
                const custoFinal = (prod.valor_custo || 0) * (prod.cambio || 1);
                const vendaFinal = (prod.valor_venda || 0) * (prod.cambio || 1);
                return (
                  <div key={prod.id || i} className="p-4 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)]">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-[var(--t-accent)]/10 shrink-0">
                        <Icon className="w-4 h-4 text-[var(--t-accent)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge className="text-[10px] border border-[var(--t-border)] bg-[var(--t-surface)]">{prod.tipo}</Badge>
                          {prod.localizador && (
                            <span className="text-[10px] font-mono text-[var(--t-text-muted)]">LOC: {prod.localizador}</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-[var(--t-text)] mt-1">{prod.descricao || '(sem descricao)'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <Info label="Fornecedor" value={fornecedorNome} />
                      {prod.data_inicio && <Info label="Inicio" value={fmtDate(prod.data_inicio)} />}
                      {prod.data_fim && <Info label="Fim" value={fmtDate(prod.data_fim)} />}
                      {prod.cia_aerea && <Info label="Cia Aerea" value={prod.cia_aerea} />}
                      {prod.trecho && <Info label="Trecho" value={prod.trecho} />}
                      {prod.hotel_nome && <Info label="Hotel" value={prod.hotel_nome} />}
                      {prod.tipo_apto && <Info label="Apto" value={prod.tipo_apto} />}
                      {prod.regime && <Info label="Regime" value={prod.regime} />}
                    </div>
                    <div className="flex items-center gap-6 mt-3 pt-3 border-t border-[var(--t-border)] text-sm">
                      <div>
                        <span className="text-[var(--t-text-muted)] text-xs">Custo</span>
                        <p className="text-orange-400 font-medium">{fmt(custoFinal)}</p>
                      </div>
                      <div>
                        <span className="text-[var(--t-text-muted)] text-xs">Venda</span>
                        <p className="text-blue-400 font-medium">{fmt(vendaFinal)}</p>
                      </div>
                      {prod.moeda !== 'BRL' && (
                        <div>
                          <span className="text-[var(--t-text-muted)] text-xs">Moeda/Cambio</span>
                          <p className="text-[var(--t-text-secondary)]">{prod.moeda} × {prod.cambio}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Pagamento */}
        <Section icon={CreditCard} title="Pagamento">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Info label="Forma" value={FORMAS_PAGAMENTO_LABEL[venda.forma_pagamento] || venda.forma_pagamento} />
            <Info label="Parcelas" value={`${venda.parcelas}x`} />
            <Info label="Desconto" value={fmt(venda.desconto || 0)} />
            <Info label="Valor Final" value={fmt(venda.valor_final || 0)} highlight />
          </div>
        </Section>

        {/* Financeiro — Contas geradas automaticamente */}
        {(contasReceber.length > 0 || contasPagar.length > 0) && (
          <>
            {/* Resumo financeiro detalhado */}
            {resumoFin && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryCard label="Total a receber" value={fmt(resumoFin.total_receber || 0)} color="text-blue-400" />
                <SummaryCard label="Recebido" value={fmt(resumoFin.total_recebido || 0)} color="text-green-400" />
                <SummaryCard label="Total a pagar" value={fmt(resumoFin.total_pagar || 0)} color="text-orange-400" />
                <SummaryCard label="Pago" value={fmt(resumoFin.total_pago || 0)} color="text-emerald-400" />
              </div>
            )}

            {/* Contas a receber */}
            {contasReceber.length > 0 && (
              <Section icon={Receipt} title={`Contas a receber (${contasReceber.length})`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wider">
                        <th className="text-left py-1.5 pr-3">Descricao</th>
                        <th className="text-left py-1.5 pr-3">Origem</th>
                        <th className="text-right py-1.5 pr-3">Valor</th>
                        <th className="text-left py-1.5 pr-3">Vencimento</th>
                        <th className="text-left py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--t-border)]">
                      {contasReceber.map(cr => (
                        <tr key={cr.id}>
                          <td className="py-2 pr-3 text-[var(--t-text)]">{cr.descricao}</td>
                          <td className="py-2 pr-3">
                            <Badge className={`text-[10px] ${cr.origem === 'COMISSAO_FORNECEDOR' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' : 'bg-blue-500/10 text-blue-400 border-blue-500/30'}`}>
                              {cr.origem === 'COMISSAO_FORNECEDOR' ? 'Comissao' : 'Venda'}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3 text-right font-medium text-blue-400">{fmt(cr.valor_final)}</td>
                          <td className="py-2 pr-3 text-[var(--t-text-secondary)]">{fmtDate(cr.data_vencimento)}</td>
                          <td className="py-2">
                            <Badge className={`text-[10px] border ${cr.status === 'RECEBIDO' ? 'bg-green-500/10 text-green-400 border-green-500/30' : cr.status === 'ATRASADO' ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
                              {cr.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Contas a pagar */}
            {contasPagar.length > 0 && (
              <Section icon={Wallet} title={`Contas a pagar (${contasPagar.length})`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wider">
                        <th className="text-left py-1.5 pr-3">Descricao</th>
                        <th className="text-left py-1.5 pr-3">Fornecedor</th>
                        <th className="text-right py-1.5 pr-3">Valor</th>
                        <th className="text-left py-1.5 pr-3">Vencimento</th>
                        <th className="text-left py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--t-border)]">
                      {contasPagar.map(cp => (
                        <tr key={cp.id}>
                          <td className="py-2 pr-3 text-[var(--t-text)]">{cp.descricao}</td>
                          <td className="py-2 pr-3 text-[var(--t-text-secondary)]">{cp.fornecedor_nome || '—'}</td>
                          <td className="py-2 pr-3 text-right font-medium text-orange-400">{fmt(cp.valor_final)}</td>
                          <td className="py-2 pr-3 text-[var(--t-text-secondary)]">{fmtDate(cp.data_vencimento)}</td>
                          <td className="py-2">
                            <Badge className={`text-[10px] border ${cp.status === 'PAGO' ? 'bg-green-500/10 text-green-400 border-green-500/30' : cp.status === 'VENCIDO' ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
                              {cp.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
          </>
        )}

        {/* Observacoes */}
        {venda.observacoes && (
          <Section icon={FileText} title="Observacoes">
            <p className="text-sm text-[var(--t-text-secondary)] whitespace-pre-wrap">{venda.observacoes}</p>
          </Section>
        )}

        {/* Dados adicionais */}
        {(venda.vendedor_id || venda.centro_custo || venda.numero_po) && (
          <Section icon={Briefcase} title="Dados adicionais">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {venda.vendedor_id && <Info label="Vendedor" value={venda.vendedor_id} />}
              {venda.centro_custo && <Info label="Centro de custo" value={venda.centro_custo} />}
              {venda.numero_po && <Info label="PO" value={venda.numero_po} />}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color, extra }: { label: string; value: string; color: string; extra?: string }) {
  return (
    <div className="bg-[var(--t-header-bg)] rounded-lg p-3 border border-[var(--t-border)]">
      <p className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {extra && <p className="text-[10px] text-[var(--t-text-secondary)]">{extra}</p>}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--t-header-bg)] rounded-lg border border-[var(--t-border)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--t-border)] flex items-center gap-2">
        <Icon className="w-4 h-4 text-[var(--t-accent)]" />
        <h2 className="text-sm font-semibold text-[var(--t-text)]">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Info({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wider">{label}</p>
      <p className={`text-sm ${highlight ? 'font-bold text-green-400' : 'text-[var(--t-text)]'}`}>{value}</p>
    </div>
  );
}
