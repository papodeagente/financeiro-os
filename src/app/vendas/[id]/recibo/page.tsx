'use client';

/**
 * Recibo da venda para o cliente: valor total e a descrição dos valores,
 * pronto para imprimir ou salvar em PDF pelo navegador. Regras dos valores em
 * src/lib/recibo-da-venda.ts; identidade da agência (logo e cores do
 * cadastro) em src/lib/marca-da-agencia.ts.
 *
 * Redesenho de 13/11/2026 (Bruno: "torne esse recibo mais bonito"): faixa na
 * cor da agência, valor em destaque com o extenso, quem pagou e quem recebeu
 * lado a lado, tabela limpa e rodapé com os contatos. A folha é SEMPRE papel
 * branco (não segue o tema escuro do sistema) e imprime com as cores reais.
 * As cores da agência entram como variáveis CSS no estilo da folha: nunca
 * como classe com hex (o porteiro do design system barra).
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import type { Agencia, Cliente, VendaCRM } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { documentoDoCliente, nomeDoCliente } from '@/lib/cliente-nome';
import { montarRecibo, vendaTemRecibo } from '@/lib/recibo-da-venda';
import { marcaDoDocumento } from '@/lib/marca-da-agencia';
import { Button } from '@/components/ui/button';

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const dataLonga = (d: Date) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const dataCurta = (d: Date) => d.toLocaleDateString('pt-BR');

/** Papel e tinta do documento: neutros fixos (a folha é sempre branca). */
const FOLHA = `
  [data-recibo] {
    --tinta: #111827; --tinta-2: #374151; --tinta-3: #6B7280; --borda: #E5E7EB; --papel: #FFFFFF;
    background: var(--papel); color: var(--tinta);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @media print {
    header:not([data-recibo] header) { display: none !important; }
    /* A página sai SEM margem e a folha carrega o próprio respiro, em mm:
       o "Salvar como PDF" usa a margem que a pessoa escolher na caixa de
       impressão (às vezes nenhuma), e o recibo encostava na borda. As
       faixas da marca vão de borda a borda, como papel timbrado. */
    /* A 1ª página não tem margem no topo (a faixa da marca encosta na borda,
       como papel timbrado); as demais e o pé de toda página têm 12 mm, para
       a continuação de um recibo longo não colar na borda. */
    @page { size: A4; margin: 12mm 0; }
    @page :first { margin-top: 0; }
    html, body { background: #FFFFFF !important; }
    /* O casco do sistema não pode cortar nem empurrar a folha no papel. */
    body:has([data-recibo]) :has(> [data-recibo]),
    body:has([data-recibo]) :has([data-recibo]) {
      overflow: visible !important; height: auto !important; min-height: 0 !important;
    }
    body:has([data-recibo]) main { padding: 0 !important; margin: 0 !important; }
    [data-recibo] {
      width: 210mm; max-width: none !important; margin: 0 !important;
      border-radius: 0 !important; box-shadow: none !important; opacity: 1 !important;
      overflow: visible !important;
    }
    /* Layout de BLOCO de propósito: num flex o Chrome ignora o "não quebre
       ao meio" e o rodapé partia entre duas páginas. O fim (assinatura,
       contatos e faixa) é uma peça só que nunca parte; a altura mínima do
       corpo o deixa na base da folha quando o recibo cabe numa página.
       Medido no modo de impressão (13/11/2026): folha útil de 285 mm, faixa
       do topo 2,1 mm, fim 48 mm com contatos e 30 mm sem; com folga, senão
       um nome de agência que quebra em mais uma linha leva a 2 páginas. */
    [data-recibo] .recibo-corpo { padding: 14mm 16mm 8mm; min-height: 230mm; }
    [data-recibo][data-sem-contatos] .recibo-corpo { min-height: 248mm; }
    [data-recibo] .recibo-pe footer { padding: 4mm 16mm; }
    [data-recibo] tr, [data-recibo] .recibo-bloco, [data-recibo] .recibo-fim { break-inside: avoid; }
    [data-recibo] .recibo-assinatura { padding: 4mm 16mm 7mm; }
  }
`;

const ROTULO = 'text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--tinta-3)]';

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
  const marca = useMemo(() => marcaDoDocumento(agencia), [agencia]);

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
  const tipoDoc = docCliente ? (docCliente.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF') : '';
  const nomeAgencia = agencia?.nome_fantasia || agencia?.razao_social || 'Agência';
  const razaoAgencia = agencia?.razao_social || nomeAgencia;
  const end = agencia?.endereco;
  const enderecoAgencia = end
    ? [[end.logradouro, end.numero].filter(Boolean).join(', '), end.complemento, end.bairro, [end.cidade, end.estado].filter(Boolean).join('/'), end.cep ? `CEP ${end.cep}` : '']
        .filter(Boolean).join(' · ')
    : '';
  const contatos = [agencia?.telefone, agencia?.email, agencia?.site].filter(Boolean) as string[];
  const cidade = end?.cidade ? `${end.cidade}, ` : '';
  const passageiros = (venda.passageiros || []).map(p => p.nome).filter(Boolean);
  const hoje = new Date();

  // As cores da agência como variáveis da folha.
  const cores = {
    '--m': marca.primaria,
    '--m-texto': marca.textoSobrePrimaria,
    '--m-papel': marca.primariaNoPapel,
    '--m-suave': marca.primariaSuave,
    '--m-linha': marca.primariaLinha,
    '--d': marca.destaque,
  } as React.CSSProperties;

  return (
    <div className="min-h-full bg-[var(--fin-bg)] py-6 print:bg-white print:py-0">
      <style>{FOLHA}</style>
      <div className="fin-no-print mx-auto mb-4 flex max-w-[820px] flex-wrap items-center justify-between gap-3 px-4">
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
        <div className="fin-no-print mx-auto mb-4 max-w-[820px] px-4">
          <p role="alert" className="rounded-[var(--fin-r-md)] border border-[var(--fin-warning)]/30 bg-[var(--fin-warning-soft)] px-4 py-3 text-sm text-[var(--fin-warning-text)]">
            {venda.status === 'CANCELADO'
              ? 'Esta venda foi cancelada: não tem recibo.'
              : 'Esta venda ainda é orçamento. O recibo sai quando ela for reservada ou confirmada.'}
          </p>
        </div>
      ) : null}

      <article
        data-recibo
        data-sem-contatos={enderecoAgencia || contatos.length > 0 ? undefined : ''}
        aria-label={`Recibo da venda ${venda.numero}`}
        style={cores}
        className={`mx-auto max-w-[820px] overflow-hidden rounded-[18px] shadow-[0_1px_2px_rgba(15,23,42,0.06),0_18px_48px_rgba(15,23,42,0.10)] ${podeEmitir ? '' : 'opacity-40'}`}
      >
        {/* Faixa da marca */}
        <div aria-hidden="true" className="h-2 bg-[var(--m)]" />

        <div className="recibo-corpo px-10 pb-8 pt-9">
          {/* Cabeçalho: a agência e o documento */}
          <header className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              {agencia?.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={agencia.logo} alt={nomeAgencia} className="max-h-16 max-w-[220px] object-contain" />
              ) : (
                <p className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--m-papel)]">{nomeAgencia}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[12px] font-semibold uppercase tracking-[0.28em] text-[var(--m-papel)]">Recibo</p>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-[var(--tinta)]">Nº {venda.numero}</p>
              <p className="mt-0.5 text-[12px] text-[var(--tinta-3)]">Emitido em {dataCurta(hoje)}</p>
            </div>
          </header>

          {/* O valor */}
          <section
            aria-label="Valor recebido"
            className="recibo-bloco mt-8 rounded-[14px] border-l-4 border-[var(--m)] bg-[var(--m-suave)] px-6 py-5"
          >
            <p className={ROTULO}>Valor recebido</p>
            <p className="mt-1 text-[38px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--m-papel)]">
              {brl(recibo.total)}
            </p>
            <p className="mt-2 text-[13px] italic text-[var(--tinta-2)]">{recibo.totalPorExtenso}</p>
          </section>

          {/* Quem pagou e quem recebeu */}
          <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 print:grid-cols-2">
            <div>
              <p className={ROTULO}>Recebido de</p>
              <p className="mt-1.5 text-[15px] font-semibold text-[var(--tinta)]">{nomeCliente}</p>
              {docCliente ? <p className="text-[12.5px] text-[var(--tinta-3)]">{tipoDoc} {docCliente}</p> : null}
            </div>
            <div>
              <p className={ROTULO}>Emitido por</p>
              <p className="mt-1.5 text-[15px] font-semibold text-[var(--tinta)]">{razaoAgencia}</p>
              {agencia?.cnpj ? (
                <p className="text-[12.5px] text-[var(--tinta-3)]">
                  CNPJ {agencia.cnpj}{agencia.cadastur ? ` · Cadastur ${agencia.cadastur}` : ''}
                </p>
              ) : null}
            </div>
          </div>

          {/* A declaração */}
          <p className="mt-7 text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
            Recebemos de <strong className="font-semibold text-[var(--tinta)]">{nomeCliente}</strong>
            {docCliente ? <>, {tipoDoc} {docCliente}</> : null}, a importância de{' '}
            <strong className="font-semibold text-[var(--tinta)]">{brl(recibo.total)}</strong> ({recibo.totalPorExtenso}),
            referente aos serviços de viagem descritos abaixo.
          </p>

          {/* Descrição dos valores */}
          <table className="mt-6 w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[var(--m-suave)] text-left">
                <th className="rounded-l-[8px] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--m-papel)]">Descrição</th>
                <th className="rounded-r-[8px] px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--m-papel)]">Valor</th>
              </tr>
            </thead>
            <tbody>
              {recibo.linhas.map((l, i) => (
                <tr key={i} className="border-b border-[var(--borda)] align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[var(--tinta)]">{l.descricao}</p>
                    {l.detalhe ? <p className="mt-0.5 text-[12px] text-[var(--tinta-3)]">{l.detalhe}</p> : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--tinta)]">{brl(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totais */}
          <div className="recibo-bloco mt-4 flex justify-end">
            <dl className="w-full max-w-[300px] text-[13px]">
              {recibo.desconto > 0 ? (
                <>
                  <div className="flex justify-between px-4 py-1 text-[var(--tinta-2)]">
                    <dt>Subtotal</dt><dd className="tabular-nums">{brl(recibo.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between px-4 py-1 text-[var(--tinta-2)]">
                    <dt>Desconto</dt><dd className="tabular-nums">− {brl(recibo.desconto)}</dd>
                  </div>
                </>
              ) : null}
              <div className="mt-1 flex items-baseline justify-between rounded-[10px] bg-[var(--m)] px-4 py-3 text-[var(--m-texto)]">
                <dt className="text-[12px] font-semibold uppercase tracking-[0.12em]">Total</dt>
                <dd className="text-[18px] font-semibold tabular-nums">{brl(recibo.total)}</dd>
              </div>
            </dl>
          </div>

          {/* Pagamento e passageiros */}
          {recibo.pagamento || passageiros.length > 0 ? (
            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
              {recibo.pagamento ? (
                <div className="rounded-[12px] border border-[var(--borda)] px-4 py-3">
                  <p className={ROTULO}>Forma de pagamento</p>
                  <p className="mt-1 text-[13.5px] font-medium text-[var(--tinta)]">{recibo.pagamento}</p>
                </div>
              ) : null}
              {passageiros.length > 0 ? (
                <div className="rounded-[12px] border border-[var(--borda)] px-4 py-3">
                  <p className={ROTULO}>{passageiros.length === 1 ? 'Passageiro' : 'Passageiros'}</p>
                  <p className="mt-1 text-[13.5px] font-medium text-[var(--tinta)]">{passageiros.join(', ')}</p>
                </div>
              ) : null}
            </div>
          ) : null}

        </div>

        {/* O fim da folha é uma peça só, que nunca parte entre páginas:
            assinatura, endereço e contatos e a faixa de destaque. */}
        <div className="recibo-fim">
        {/* Data e assinatura */}
        <div className="recibo-assinatura flex flex-wrap items-end justify-between gap-8 px-10 pb-8 pt-4 text-[13px]">
          <p className="text-[var(--tinta-2)]">{cidade}{dataLonga(hoje)}.</p>
          <div className="w-72 text-center">
            <div className="border-t border-[var(--tinta)] pt-2">
              <p className="font-semibold text-[var(--tinta)]">{razaoAgencia}</p>
              {agencia?.cnpj ? <p className="text-[12px] text-[var(--tinta-3)]">CNPJ {agencia.cnpj}</p> : null}
            </div>
          </div>
        </div>
        {/* Pé da folha: endereço, contatos e a faixa de destaque */}
        <div className="recibo-pe">
          {enderecoAgencia || contatos.length > 0 ? (
            <footer className="border-t border-[var(--m-linha)] px-10 py-4 text-center text-[11.5px] leading-relaxed text-[var(--tinta-3)]">
              {enderecoAgencia ? <p>{enderecoAgencia}</p> : null}
              {contatos.length > 0 ? <p>{contatos.join(' · ')}</p> : null}
            </footer>
          ) : null}
          <div aria-hidden="true" className="h-1.5 bg-[var(--d)]" />
        </div>
        </div>
      </article>
    </div>
  );
}
