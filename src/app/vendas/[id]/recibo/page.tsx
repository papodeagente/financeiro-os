'use client';

/**
 * Recibo da venda para o cliente: valor total e a descrição dos valores,
 * pronto para imprimir ou salvar em PDF pelo navegador. Regras em
 * src/lib/recibo-da-venda.ts. Na impressão, só a folha aparece (o menu do
 * sistema e a barra desta tela têm fin-no-print / nav / aside).
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import type { Agencia, Cliente, VendaCRM } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { documentoDoCliente, nomeDoCliente } from '@/lib/cliente-nome';
import { montarRecibo, vendaTemRecibo } from '@/lib/recibo-da-venda';
import { Button } from '@/components/ui/button';

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const dataLonga = (d: Date) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

export default function ReciboDaVendaPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [venda, setVenda] = useState<VendaCRM | null>(null);
  const [agencia, setAgencia] = useState<Agencia | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');

  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetch(`/api/vendas-crm/${id}`).then(r => (r.ok ? r.json() : null)),
      fetch('/api/agencia').then(r => (r.ok ? r.json() : null)).catch(() => null),
      loadEntities<Cliente>('clientes').catch(() => [] as Cliente[]),
    ])
      .then(([v, a, cs]) => {
        if (!vivo) return;
        if (!v || v.error) { setEstado('erro'); return; }
        setVenda(v);
        setAgencia(a && !a.error ? a : null);
        setCliente(cs.find((c: Cliente) => c.id === v.cliente_id) ?? null);
        setEstado('ok');
      })
      .catch(() => { if (vivo) setEstado('erro'); });
    return () => { vivo = false; };
  }, [id]);

  const recibo = useMemo(() => (venda ? montarRecibo(venda) : null), [venda]);

  if (estado === 'carregando') {
    return <p className="p-8 text-sm text-[var(--fin-text-3)]">Carregando o recibo</p>;
  }
  if (estado === 'erro' || !venda || !recibo) {
    return (
      <div className="p-8">
        <p className="text-sm text-[var(--fin-text-2)]">Venda não encontrada.</p>
        <Button variant="ghost" className="mt-3" onClick={() => router.push('/vendas')}>
          <ArrowLeft className="size-4" /> Voltar às vendas
        </Button>
      </div>
    );
  }

  const podeEmitir = vendaTemRecibo(venda.status);
  const nomeCliente = nomeDoCliente(cliente) || venda.pagantes?.[0]?.nome || 'Cliente';
  const docCliente = documentoDoCliente(cliente);
  const nomeAgencia = agencia?.nome_fantasia || agencia?.razao_social || 'Agência';
  const end = agencia?.endereco;
  const enderecoAgencia = end
    ? [[end.logradouro, end.numero].filter(Boolean).join(', '), end.complemento, end.bairro, [end.cidade, end.estado].filter(Boolean).join('/'), end.cep ? `CEP ${end.cep}` : '']
        .filter(Boolean).join(' · ')
    : '';
  const contato = [agencia?.telefone, agencia?.email, agencia?.site].filter(Boolean).join(' · ');
  const cidade = end?.cidade ? `${end.cidade}, ` : '';
  const passageiros = (venda.passageiros || []).map(p => p.nome).filter(Boolean);

  return (
    <div className="min-h-full bg-[var(--fin-bg)] py-6 print:bg-white print:py-0">
      {/* No papel, só a folha: a barra superior do sistema (TopBar) também sai. */}
      <style>{`@media print { header:not([data-recibo] header) { display: none !important; } }`}</style>
      <div className="fin-no-print mx-auto mb-4 flex max-w-[800px] flex-wrap items-center justify-between gap-3 px-4">
        <Button variant="ghost" onClick={() => router.push(`/vendas/${id}`)}>
          <ArrowLeft className="size-4" /> Voltar à venda
        </Button>
        {podeEmitir ? (
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir ou salvar PDF
          </Button>
        ) : null}
      </div>

      {!podeEmitir ? (
        <div className="fin-no-print mx-auto mb-4 max-w-[800px] px-4">
          <p role="alert" className="rounded-[var(--fin-r-md)] border border-[var(--fin-warning)]/30 bg-[var(--fin-warning-soft)] px-4 py-3 text-sm text-[var(--fin-warning-text)]">
            {venda.status === 'CANCELADO'
              ? 'Esta venda foi cancelada: não tem recibo.'
              : 'Esta venda ainda é orçamento. O recibo sai quando ela for reservada ou confirmada.'}
          </p>
        </div>
      ) : null}

      <article
        data-recibo
        aria-label={`Recibo da venda ${venda.numero}`}
        className={`mx-auto max-w-[800px] bg-white px-10 py-10 text-[#1A1A1A] shadow-[var(--fin-e-card)] print:max-w-none print:px-0 print:py-0 print:shadow-none ${podeEmitir ? '' : 'opacity-40'}`}
      >
        {/* Agência */}
        <header className="flex items-start justify-between gap-6 border-b border-[#D9DEE7] pb-5">
          <div className="min-w-0">
            {agencia?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agencia.logo} alt={nomeAgencia} className="mb-3 max-h-14 max-w-[200px] object-contain" />
            ) : null}
            <p className="text-[15px] font-semibold">{agencia?.razao_social || nomeAgencia}</p>
            {agencia?.cnpj ? <p className="text-[12px] text-[#475569]">CNPJ {agencia.cnpj}{agencia.cadastur ? ` · Cadastur ${agencia.cadastur}` : ''}</p> : null}
            {enderecoAgencia ? <p className="text-[12px] text-[#475569]">{enderecoAgencia}</p> : null}
            {contato ? <p className="text-[12px] text-[#475569]">{contato}</p> : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[22px] font-bold tracking-wide">RECIBO</p>
            <p className="text-[12px] text-[#475569]">Venda {venda.numero}</p>
            <p className="mt-2 text-[20px] font-semibold tabular-nums">{brl(recibo.total)}</p>
          </div>
        </header>

        {/* Declaração */}
        <p className="mt-6 text-[14px] leading-relaxed">
          Recebemos de <strong>{nomeCliente}</strong>
          {docCliente ? <>, {docCliente.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF'} <strong>{docCliente}</strong></> : null}
          , a importância de <strong>{brl(recibo.total)}</strong> ({recibo.totalPorExtenso}), referente aos serviços de viagem descritos abaixo.
        </p>

        {/* Descrição dos valores */}
        <table className="mt-6 w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#D9DEE7] text-left text-[11px] uppercase tracking-wide text-[#5B6878]">
              <th className="py-2 pr-4 font-semibold">Descrição</th>
              <th className="py-2 text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {recibo.linhas.map((l, i) => (
              <tr key={i} className="border-b border-[#EEF1F6] align-top">
                <td className="py-2.5 pr-4">
                  <p className="font-medium">{l.descricao}</p>
                  {l.detalhe ? <p className="text-[12px] text-[#5B6878]">{l.detalhe}</p> : null}
                </td>
                <td className="py-2.5 text-right tabular-nums">{brl(l.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {recibo.desconto > 0 ? (
              <>
                <tr>
                  <td className="pt-3 pr-4 text-right text-[#475569]">Subtotal</td>
                  <td className="pt-3 text-right tabular-nums">{brl(recibo.subtotal)}</td>
                </tr>
                <tr>
                  <td className="pt-1 pr-4 text-right text-[#475569]">Desconto</td>
                  <td className="pt-1 text-right tabular-nums">− {brl(recibo.desconto)}</td>
                </tr>
              </>
            ) : null}
            <tr>
              <td className="pt-3 pr-4 text-right font-semibold">Total</td>
              <td className="pt-3 text-right text-[15px] font-semibold tabular-nums">{brl(recibo.total)}</td>
            </tr>
          </tfoot>
        </table>

        {recibo.pagamento || passageiros.length > 0 ? (
          <dl className="mt-6 space-y-1 text-[13px]">
            {recibo.pagamento ? (
              <div className="flex gap-2"><dt className="text-[#5B6878]">Forma de pagamento:</dt><dd>{recibo.pagamento}</dd></div>
            ) : null}
            {passageiros.length > 0 ? (
              <div className="flex gap-2"><dt className="shrink-0 text-[#5B6878]">Passageiros:</dt><dd>{passageiros.join(', ')}</dd></div>
            ) : null}
          </dl>
        ) : null}

        {/* Data e assinatura */}
        <div className="mt-12 text-[13px]">
          <p>{cidade}{dataLonga(new Date())}.</p>
          <div className="mt-14 w-72 border-t border-[#1A1A1A] pt-2">
            <p className="font-medium">{agencia?.razao_social || nomeAgencia}</p>
            {agencia?.cnpj ? <p className="text-[12px] text-[#475569]">CNPJ {agencia.cnpj}</p> : null}
          </div>
        </div>
      </article>
    </div>
  );
}
