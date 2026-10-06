'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { formatBRL, formatDate as dataBR } from '@/lib/utils';
import { num } from '@/lib/money';
import {
  nomeDoCliente, tipoPessoaLabel, documentoDoCliente, type ClienteNomeavel,
} from '@/lib/cliente-nome';
import {
  ehCompra, tempoDesdeAUltimaCompra, type PerfilDoCliente,
} from '@/lib/perfil-do-cliente';

import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { DataState } from '@/components/fin/DataState';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { Resposta } from '@/components/fin/Resposta';

interface Linha { id: string; status: string; [k: string]: unknown }

interface Payload {
  cliente: ClienteNomeavel & Record<string, unknown> & { id: string; cliente_desde?: string };
  perfil: PerfilDoCliente;
  vendas: Linha[];
  contas: Linha[];
  notas: Linha[];
}

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';

/** Status que o StatusChip ainda não tem domínio para. Texto quieto em vez de
 *  cor inventada: cor de status é vocabulário reservado do design system. */
const ROTULO_VENDA: Record<string, string> = {
  ORCAMENTO: 'Orçamento', RESERVADO: 'Reservado', CONFIRMADO: 'Confirmada',
  CONCLUIDO: 'Concluída', CANCELADO: 'Cancelada',
};
const ROTULO_NOTA: Record<string, string> = {
  RASCUNHO: 'Rascunho', PROCESSANDO: 'Na prefeitura', AUTORIZADA: 'Autorizada',
  REJEITADA: 'Rejeitada', CANCELADA: 'Cancelada',
};

function Secao({ titulo, sublinha, children }: {
  titulo: string; sublinha: string; children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="flex flex-col gap-0.5">
        <h2 className="fin-t-subhead text-[var(--fin-text)]">{titulo}</h2>
        <p className="fin-t-caption text-[var(--fin-text-3)]">{sublinha}</p>
      </div>
      {children}
    </section>
  );
}

export default function PerfilDoClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [dados, setDados] = useState<Payload | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch(`/api/clientes/${encodeURIComponent(id)}/perfil`);
      const corpo = await r.json();
      if (!r.ok) throw new Error(corpo?.error || 'Não foi possível carregar');
      setDados(corpo as Payload);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o perfil.');
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const p = dados?.perfil;
  const nome = dados ? nomeDoCliente(dados.cliente) : '';
  const documento = dados ? documentoDoCliente(dados.cliente) : '';

  const colunasContas: FinColuna<Linha>[] = useMemo(() => [
    {
      id: 'descricao', cabecalho: 'Cobrança', tipo: 'texto', minWidth: 200,
      render: l => String(l.descricao || 'Sem descrição'),
    },
    { id: 'venc', cabecalho: 'Vencimento', tipo: 'data', valor: l => String(l.data_vencimento || '') },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', valor: l => num(l.valor_final) },
    {
      id: 'pago', cabecalho: 'Recebido', tipo: 'dinheiro', prioridade: 1,
      valor: l => num(l.valor_recebido),
    },
    {
      id: 'situacao', cabecalho: 'Situação', tipo: 'status',
      valor: l => l.status, dominio: 'receber',
    },
  ], []);

  const colunasVendas: FinColuna<Linha>[] = useMemo(() => [
    { id: 'numero', cabecalho: 'Negociação', tipo: 'texto', render: l => String(l.numero || l.id).slice(0, 24) },
    { id: 'data', cabecalho: 'Data', tipo: 'data', valor: l => String(l.data_venda || '') },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', valor: l => num(l.valor_final) },
    {
      id: 'situacao', cabecalho: 'Situação', tipo: 'texto', prioridade: 1,
      render: l => (
        <span className={ehCompra(l) ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]'}>
          {ROTULO_VENDA[String(l.status).toUpperCase()] || String(l.status || '—')}
        </span>
      ),
    },
  ], []);

  const colunasNotas: FinColuna<Linha>[] = useMemo(() => [
    { id: 'numero', cabecalho: 'Nota', tipo: 'texto', render: l => String(l.numero || 'Sem número') },
    { id: 'valor', cabecalho: 'Valor do serviço', tipo: 'dinheiro', valor: l => num(l.valor_servicos) },
    {
      id: 'situacao', cabecalho: 'Situação', tipo: 'texto',
      render: l => (
        <span className="text-[var(--fin-text-2)]">
          {ROTULO_NOTA[String(l.status).toUpperCase()] || String(l.status || '—')}
        </span>
      ),
    },
    {
      id: 'pdf', cabecalho: '', tipo: 'acoes',
      render: l => (l.link_pdf ? (
        <a
          href={String(l.link_pdf)}
          target="_blank"
          rel="noreferrer"
          className="fin-t-caption text-[var(--fin-accent)] underline"
        >
          PDF
        </a>
      ) : null),
    },
  ], []);

  const estado = carregando ? 'carregando' : erro ? 'erro' : 'ok';

  return (
    <MolduraDaPagina>
      <div className="flex flex-col gap-[var(--fin-s-3)]">
        <Link
          href="/pessoas/clientes"
          className="fin-t-caption inline-flex w-fit items-center gap-1.5 text-[var(--fin-text-3)] transition-colors hover:text-[var(--fin-text)]"
        >
          <ArrowLeft className="size-3.5" />
          Clientes
        </Link>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="fin-t-title text-[var(--fin-text)]">{nome || 'Cliente'}</h1>
          {dados ? (
            <span className="fin-t-caption rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)] px-2 py-0.5 text-[var(--fin-text-2)]">
              {tipoPessoaLabel(String(dados.cliente.tipo ?? ''))}
            </span>
          ) : null}
        </div>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          {documento || 'Sem CPF ou CNPJ no cadastro'}
          {dados?.cliente.cliente_desde
            ? ` · Cliente desde ${dataBR(String(dados.cliente.cliente_desde).slice(0, 10))}`
            : ''}
        </p>
      </div>

      <DataState
        className={RITMO_DA_PAGINA}
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { load(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className={`h-32 ${CARTAO}`} />
            <div className={`h-24 ${CARTAO}`} />
          </div>
        }
      >
        {p ? (
          <>
            {/* A RESPOSTA: quanto este cliente já comprou. */}
            <Resposta
              overline="VOLUME COMPRADO POR ESTE CLIENTE"
              valor={<Money valor={p.volume_comprado} size="resposta" align="esquerda" estado="ok" />}
              frase={
                p.compras === 0
                  ? 'Nenhuma compra fechada até agora. O que aparece abaixo são as negociações que existiram.'
                  : `${p.compras} ${p.compras === 1 ? 'compra' : 'compras'} em ${p.negociacoes} ${p.negociacoes === 1 ? 'negociação' : 'negociações'}. ${tempoDesdeAUltimaCompra(p.dias_desde_a_ultima_compra)}.`
              }
            />

            {/* O RELACIONAMENTO */}
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                rotulo="Negociações"
                formato="contagem"
                valor={p.negociacoes}
                estado="ok"
                contexto={
                  p.taxa_de_conversao === null
                    ? 'Nenhuma conversa de venda registrada.'
                    : `${p.taxa_de_conversao.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% viraram compra.`
                }
              />
              <MetricCard
                rotulo="Compras fechadas"
                formato="contagem"
                valor={p.compras}
                estado="ok"
                contexto={
                  p.primeira_compra
                    ? `A primeira foi em ${dataBR(p.primeira_compra)}.`
                    : 'Ainda não houve compra fechada.'
                }
              />
              <MetricCard
                rotulo="Ticket médio"
                valor={p.ticket_medio}
                estado={p.ticket_medio === null ? 'indisponivel' : 'ok'}
                contexto={
                  p.ticket_medio === null
                    ? 'Sem compra, não há média.'
                    : `Volume dividido pelas ${p.compras} compras.`
                }
              />
              <MetricCard
                rotulo="Notas emitidas"
                formato="contagem"
                valor={p.notas_emitidas}
                estado="ok"
                contexto={
                  p.notas_emitidas === 0
                    ? 'Nenhuma nota fiscal emitida para este cliente.'
                    : `${formatBRL(p.valor_em_notas)} em serviço declarado.`
                }
              />
            </div>

            {/* O DINHEIRO */}
            <Secao
              titulo="O dinheiro deste cliente"
              sublinha="Os mesmos números do contas a receber, filtrados por ele."
            >
              <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
                <MetricCard
                  rotulo="Já pagou"
                  valor={p.pago}
                  estado="ok"
                  tone="positivo"
                  contexto="Soma do que entrou, incluindo recebimentos em parte."
                />
                <MetricCard
                  rotulo="Em aberto"
                  valor={p.em_aberto}
                  estado="ok"
                  contexto="O que ainda falta entrar, vencido ou não."
                />
                <MetricCard
                  rotulo="Vencido"
                  valor={p.vencido}
                  estado="ok"
                  tone="negativo"
                  contexto={
                    p.vencido === 0
                      ? 'Nada em atraso.'
                      : 'Parte do em aberto cujo prazo já passou.'
                  }
                />
              </div>
            </Secao>

            <Secao
              titulo="Histórico de pagamento"
              sublinha="Toda cobrança lançada para este cliente, da mais recente para a mais antiga."
            >
              <FinTable<Linha>
                linhas={dados.contas}
                colunas={colunasContas}
                chave={l => l.id}
                estado="ok"
                vazio={{
                  motivo: 'sem-dado',
                  titulo: 'Nenhuma cobrança lançada',
                  oQueE: 'Aqui aparecem as contas a receber deste cliente, com o que já foi pago.',
                  acao: { rotulo: 'Ir para contas a receber', href: '/financeiro-ag/receber' },
                }}
              />
            </Secao>

            <Secao
              titulo="Negociações"
              sublinha="Todas as conversas de venda, inclusive as que não fecharam."
            >
              <FinTable<Linha>
                linhas={dados.vendas}
                colunas={colunasVendas}
                chave={l => l.id}
                estado="ok"
                vazio={{
                  motivo: 'sem-dado',
                  titulo: 'Nenhuma negociação',
                  oQueE: 'Aqui aparecem as vendas deste cliente, do orçamento à conclusão.',
                  acao: { rotulo: 'Ver vendas fechadas', href: '/vendas' },
                }}
              />
            </Secao>

            <Secao
              titulo="Notas fiscais"
              sublinha="As notas emitidas para este cliente."
            >
              <FinTable<Linha>
                linhas={dados.notas}
                colunas={colunasNotas}
                chave={l => l.id}
                estado="ok"
                vazio={{
                  motivo: 'sem-dado',
                  titulo: 'Nenhuma nota emitida',
                  oQueE: 'A nota é emitida a partir de uma conta a receber recebida.',
                  acao: { rotulo: 'Ir para notas fiscais', href: '/financeiro-ag/notas' },
                }}
              />
            </Secao>
          </>
        ) : null}
      </DataState>
    </MolduraDaPagina>
  );
}
