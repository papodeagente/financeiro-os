'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ReceiptText } from 'lucide-react';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/fin/PageHeader';

interface Resumo {
  moedas: string[];
  totalReservadoCentavos: number | null; recebidoCentavos: number; reembolsadoCentavos: number;
  taxaCentavos: number; custoCentavos: number; recebidoLiquidoCentavos: number; diferencaCentavos: number | null;
  quantidades: { reservas: number; pagamentos: number; reembolsos: number; custos: number };
}
interface Evento { id: string; tipo: string; criado_em: string; dados: Record<string, unknown> }
interface Pedido { codigo: string; resumo: Resumo; eventos: Evento[] }
const dinheiro = (n: number | null, moeda: string) => n === null ? 'Sem dados' : (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: moeda });
const moedaValida = (v: unknown, fallback: string) => typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : fallback;

export default function PedidoSitesPage() {
  const { codigo } = useParams<{ codigo: string }>();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let ativo = true;
    fetch(`/api/v1/sites/pedidos/${encodeURIComponent(codigo)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.erro || 'Falha ao carregar pedido'); return j; })
      .then(j => { if (ativo) setPedido(j); })
      .catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao carregar pedido'); });
    return () => { ativo = false; };
  }, [codigo]);
  return <PageShell width="full" padding="md" gap="md" className="max-w-[820px]">
    <PageHeader icone={ReceiptText} titulo={`Pedido ${codigo}`} subtitulo="Conferência dos eventos enviados pelo EnturOS Sites" />
    <Link href="/config/integracoes/sites" className="fin-t-caption text-[var(--fin-accent)]">← Voltar aos eventos</Link>
    {erro && <p role="alert">{erro}</p>}
    {!pedido && !erro && <p role="status">Carregando pedido…</p>}
    {pedido && <>
      {pedido.resumo.moedas.length > 1 && <p role="alert" className="rounded-lg border border-[var(--fin-warning)] p-3">Este pedido contém moedas diferentes. Os totais não são somados aqui; confira cada evento no histórico.</p>}
      {pedido.resumo.moedas.length <= 1 && <>
      <section className="grid gap-3 sm:grid-cols-2">
        {[
          ['Valor das reservas', dinheiro(pedido.resumo.totalReservadoCentavos, pedido.resumo.moedas[0] || 'BRL')],
          ['Recebido', dinheiro(pedido.resumo.recebidoCentavos, pedido.resumo.moedas[0] || 'BRL')],
          ['Reembolsado', dinheiro(pedido.resumo.reembolsadoCentavos, pedido.resumo.moedas[0] || 'BRL')],
          ['Taxas', dinheiro(pedido.resumo.taxaCentavos, pedido.resumo.moedas[0] || 'BRL')],
          ['Custos registrados', dinheiro(pedido.resumo.custoCentavos, pedido.resumo.moedas[0] || 'BRL')],
          ['Líquido após taxas e reembolsos', dinheiro(pedido.resumo.recebidoLiquidoCentavos, pedido.resumo.moedas[0] || 'BRL')],
          ['Diferença a receber', dinheiro(pedido.resumo.diferencaCentavos, pedido.resumo.moedas[0] || 'BRL')],
        ].map(([rotulo, valor]) => <div key={rotulo} className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4">
          <p className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</p><p className="fin-t-body-strong mt-1">{valor}</p>
        </div>)}
      </section>
      </>}
      <p className="fin-t-caption text-[var(--fin-text-3)]">Valores apurados apenas dos eventos recebidos. Uma reserva anterior à conexão pode deixar o valor e a diferença sem dados. Confira o repasse no Sites e a venda no CRM antes de fechar a conciliação.</p>
      <section className="rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5">
        <h2 className="fin-t-body-strong">Histórico do pedido</h2>
        <ul className="mt-3 divide-y divide-[var(--fin-border)]">{pedido.eventos.map(ev => <li key={ev.id} className="flex flex-wrap gap-x-4 gap-y-1 py-3 fin-t-caption">
          <strong>{ev.tipo}</strong><time dateTime={ev.criado_em}>{new Date(ev.criado_em).toLocaleString('pt-BR')}</time>
          {typeof ev.dados.valorCentavos === 'number' && <span>{dinheiro(ev.dados.valorCentavos, moedaValida(ev.dados.moeda, pedido.resumo.moedas[0] || 'BRL'))}</span>}
        </li>)}</ul>
      </section>
    </>}
  </PageShell>;
}
