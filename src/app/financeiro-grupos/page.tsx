'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Package, Plane, Hotel, Ship, Car, Ticket, Shield, Users2, Boxes } from 'lucide-react';
import {
  montarPainelProdutos,
  type EntradaItem,
  type EntradaVenda,
} from '@/lib/produtos-vendidos';
import { hojeISO } from '@/lib/money';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { Meter } from '@/components/fin/Meter';

const CARTAO =
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';

const BLOCO =
  `${CARTAO} shadow-[0_1px_2px_rgba(15,23,42,0.04)]`;

const CAMPO =
  'h-9 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-2 fin-t-body text-[var(--fin-text)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const CABECALHO = 'px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]';

const ICONE_TIPO: Record<string, typeof Package> = {
  AEREO: Plane,
  HOTEL: Hotel,
  PACOTE: Boxes,
  CRUZEIRO: Ship,
  CARRO: Car,
  INGRESSO: Ticket,
  SEGURO: Shield,
  RECEPTIVO: Users2,
  GRUPO: Users2,
  OUTROS: Package,
};

const ROTULO_TIPO: Record<string, string> = {
  AEREO: 'Aéreo',
  HOTEL: 'Hotel',
  PACOTE: 'Pacote',
  CRUZEIRO: 'Cruzeiro',
  CARRO: 'Carro',
  INGRESSO: 'Ingresso',
  SEGURO: 'Seguro',
  RECEPTIVO: 'Receptivo',
  GRUPO: 'Grupo',
  OUTROS: 'Outros',
};

const rotulo = (t: string) => ROTULO_TIPO[t] ?? t;

function rotuloMes(ym: string): string {
  const [a, m] = ym.split('-');
  const d = new Date(Number(a), Number(m) - 1, 15);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function ultimosMeses(qtd = 12): string[] {
  const [a, m] = hojeISO().split('-').map(Number);
  return Array.from({ length: qtd }, (_, i) => {
    const t = a * 12 + (m - 1) - i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  });
}

/** Margem abaixo de 10% é sinal de produto que quase não paga o trabalho. */
function faixaMargem(pct: number): 'saudavel' | 'atencao' | 'critico' {
  if (pct >= 20) return 'saudavel';
  if (pct >= 10) return 'atencao';
  return 'critico';
}

function Esqueleto() {
  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
      <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`${CARTAO} h-[104px] p-[var(--fin-s-4)]`}>
            <div className="h-3 w-24 rounded bg-[var(--fin-surface-2)]" />
            <div className="mt-3 h-7 w-32 rounded bg-[var(--fin-surface-2)]" />
          </div>
        ))}
      </div>
      <div className={`${CARTAO} h-72`} />
    </div>
  );
}

export default function FinanceiroProdutosPage() {
  const [itens, setItens] = useState<EntradaItem[]>([]);
  const [vendas, setVendas] = useState<EntradaVenda[]>([]);
  const [mes, setMes] = useState('');
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch('/api/produtos-vendidos');
      if (!r.ok) throw new Error((await r.json()).error || `Erro ${r.status}`);
      const json = await r.json();
      setItens(json.itens ?? []);
      setVendas(json.vendas ?? []);
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const painel = useMemo(
    () => montarPainelProdutos(itens, vendas, { mes: mes || undefined, tipo: tipo || undefined, busca }),
    [itens, vendas, mes, tipo, busca],
  );

  /** Tipos existentes na base inteira, para o filtro não sumir sozinho
   *  quando o próprio filtro esvazia a lista. */
  const tiposDisponiveis = useMemo(
    () => montarPainelProdutos(itens, vendas).por_tipo.map(t => t.tipo),
    [itens, vendas],
  );

  const filtrando = Boolean(mes || tipo || busca.trim());

  return (
    <div className="flex flex-col gap-[var(--fin-s-6)]">
      <PageHeader
        titulo="Financeiro por produto"
        subtitulo="Produtos vendidos no CRM que chegaram ao financeiro"
        acoesSecundarias={[{ rotulo: 'Vendas fechadas', href: '/vendas' }]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={<Esqueleto />}
      >
        <div className="flex flex-col gap-[var(--fin-s-5)]">
          <section className={`${BLOCO} p-[var(--fin-s-3)]`}>
            <div className="grid gap-[var(--fin-s-2)] md:grid-cols-[minmax(10rem,12rem)_minmax(10rem,12rem)_minmax(18rem,1fr)] xl:grid-cols-[minmax(10rem,12rem)_minmax(10rem,12rem)_minmax(18rem,1fr)_auto] xl:items-center">
              <select className={`${CAMPO} w-full`} value={mes} onChange={e => setMes(e.target.value)} aria-label="Mês da venda">
                <option value="">Todos os meses</option>
                {ultimosMeses().map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}
              </select>
              <select className={`${CAMPO} w-full`} value={tipo} onChange={e => setTipo(e.target.value)} aria-label="Tipo de produto">
                <option value="">Todos os tipos</option>
                {tiposDisponiveis.map(t => <option key={t} value={t}>{rotulo(t)}</option>)}
              </select>
              <input
                className={`${CAMPO} w-full`}
                placeholder="Buscar produto, fornecedor, cliente ou venda"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                aria-label="Buscar"
              />
              {filtrando && (
                <span className="whitespace-nowrap px-1 fin-t-caption text-[var(--fin-text-3)]">
                  {painel.quantidade} {painel.quantidade === 1 ? 'produto' : 'produtos'} no filtro
                </span>
              )}
            </div>
          </section>

          <div className="grid gap-[var(--fin-s-4)] sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              rotulo="Vendido"
              valor={painel.total_venda}
              estado="ok"
              emphasis="destaque"
              contexto={`em ${painel.quantidade} ${painel.quantidade === 1 ? 'produto' : 'produtos'}${mes ? ` de ${rotuloMes(mes)}` : ''}`}
            />
            <MetricCard
              rotulo="Custo dos fornecedores"
              valor={painel.total_custo}
              estado="ok"
              contexto={`${painel.por_tipo.length} ${painel.por_tipo.length === 1 ? 'tipo de produto' : 'tipos de produto'}`}
            />
            <MetricCard
              rotulo="Margem"
              valor={painel.total_margem}
              estado="ok"
              tone={painel.total_margem >= 0 ? 'positivo' : 'negativo'}
              contexto={`${painel.margem_pct.toFixed(1)}% do que foi vendido`}
            />
            <MetricCard
              rotulo="Ticket médio"
              valor={painel.ticket_medio}
              estado="ok"
              contexto="por produto vendido, não por venda"
            />
          </div>

          {painel.quantidade === 0 ? (
            <div className={`${BLOCO} p-[var(--fin-s-5)]`}>
              <EmptyLesson
                motivo={filtrando ? 'sem-resultado' : 'sem-dado'}
                titulo={filtrando ? 'Nenhum produto com esse filtro' : 'Nenhum produto vendido ainda'}
                oQueE="Aqui aparecem os produtos vendidos no CRM que já chegaram ao financeiro, com custo do fornecedor e margem."
                comoComeca={filtrando ? undefined : [
                  'Feche uma venda no CRM com os produtos dentro',
                  'A venda chega aqui e gera as contas',
                  'Os produtos dela aparecem nesta tela',
                ]}
                acao={filtrando
                  ? { rotulo: 'Limpar filtros', onClick: () => { setMes(''); setTipo(''); setBusca(''); } }
                  : { rotulo: 'Ver vendas fechadas', href: '/vendas' }}
              />
            </div>
          ) : (
            <>
              <section className={`${BLOCO} overflow-hidden`}>
                <header className="border-b border-[var(--fin-border)] px-[var(--fin-s-5)] py-[var(--fin-s-4)]">
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">Por tipo de produto</h2>
                  <p className="mt-1 fin-t-caption text-[var(--fin-text-3)]">
                    O que sustenta a receita e onde a margem é fina
                  </p>
                </header>
                <ul className="divide-y divide-[var(--fin-border)]">
                  {painel.por_tipo.map(t => {
                    const Icone = ICONE_TIPO[t.tipo] ?? Package;
                    return (
                      <li key={t.tipo} className="grid gap-[var(--fin-s-4)] px-[var(--fin-s-5)] py-[var(--fin-s-5)] lg:grid-cols-[minmax(14rem,1fr)_minmax(14rem,18rem)_auto] lg:items-center">
                        <div className="flex min-w-0 items-start gap-[var(--fin-s-3)]">
                          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] text-[var(--fin-text-3)]">
                            <Icone className="h-4 w-4" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate fin-t-body-strong text-[var(--fin-text)]">{rotulo(t.tipo)}</p>
                            <p className="mt-0.5 fin-t-caption text-[var(--fin-text-3)]">
                              {t.quantidade} {t.quantidade === 1 ? 'produto' : 'produtos'} · {t.share_receita_pct.toFixed(1)}% da receita
                            </p>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <Meter
                            pct={Math.max(0, t.margem_pct)}
                            faixa={faixaMargem(t.margem_pct)}
                            descricao={`margem ${t.margem_pct.toFixed(1)}%`}
                            size="sm"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-[var(--fin-s-4)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right lg:min-w-[15rem]">
                          <div>
                            <p className="fin-t-caption text-[var(--fin-text-3)]">Vendido</p>
                            <Money valor={t.venda} size="body" />
                          </div>
                          <div>
                            <p className="fin-t-caption text-[var(--fin-text-3)]">Margem</p>
                            <Money valor={t.margem} size="body" />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className={`${BLOCO} overflow-hidden`}>
                <header className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] px-[var(--fin-s-5)] py-[var(--fin-s-4)]">
                  <div>
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">Produtos vendidos</h2>
                    <p className="mt-1 fin-t-caption text-[var(--fin-text-3)]">Detalhamento por item, venda e fornecedor</p>
                  </div>
                  <p className="rounded-full bg-[var(--fin-surface-2)] px-3 py-1 fin-t-caption text-[var(--fin-text-3)]">
                    {painel.quantidade} {painel.quantidade === 1 ? 'item' : 'itens'}
                  </p>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--fin-border)] bg-[var(--fin-surface-2)] text-left">
                        <th scope="col" className={`${CABECALHO} pl-[var(--fin-s-5)]`}>Produto</th>
                        <th scope="col" className={CABECALHO}>Venda</th>
                        <th scope="col" className={`${CABECALHO} text-right`}>Custo</th>
                        <th scope="col" className={`${CABECALHO} text-right`}>Vendido</th>
                        <th scope="col" className={`${CABECALHO} pr-[var(--fin-s-5)] text-right`}>Margem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {painel.itens.map(i => (
                        <tr key={i.item_id} className="border-b border-[var(--fin-border)] last:border-0 hover:bg-[var(--fin-surface-2)]/60">
                          <td className="max-w-[34rem] px-[var(--fin-s-5)] py-[var(--fin-s-4)] align-top">
                            <p className="fin-t-body-strong leading-6 text-[var(--fin-text)]">
                              {i.descricao || rotulo(i.tipo)}
                            </p>
                            <p className="mt-1 fin-t-caption text-[var(--fin-text-3)]">
                              {rotulo(i.tipo)}
                              {i.fornecedor_nome && ` · ${i.fornecedor_nome}`}
                              {i.moeda_original !== 'BRL' && ` · em ${i.moeda_original}`}
                              {i.localizador && ` · ${i.localizador}`}
                            </p>
                          </td>
                          <td className="px-[var(--fin-s-4)] py-[var(--fin-s-4)] align-top">
                            <Link
                              href={`/vendas/${i.venda_id}`}
                              className="fin-t-body text-[var(--fin-accent)] underline underline-offset-2"
                            >
                              {i.venda_numero}
                            </Link>
                            <p className="mt-1 max-w-[13rem] fin-t-caption text-[var(--fin-text-3)]">
                              {i.cliente_nome}
                              {i.vendedor_nome && ` · ${i.vendedor_nome}`}
                            </p>
                          </td>
                          <td className="px-[var(--fin-s-4)] py-[var(--fin-s-4)] text-right align-top">
                            <Money valor={i.custo} size="body" />
                          </td>
                          <td className="px-[var(--fin-s-4)] py-[var(--fin-s-4)] text-right align-top">
                            <Money valor={i.venda} size="body" />
                          </td>
                          <td className="px-[var(--fin-s-5)] py-[var(--fin-s-4)] text-right align-top">
                            <Money valor={i.margem} size="body" />
                            <p className={`mt-1 fin-t-caption ${i.margem >= 0 ? 'text-[var(--fin-text-3)]' : 'text-[var(--fin-negative-text)]'}`}>
                              {i.margem_pct.toFixed(1)}%
                            </p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </DataState>
    </div>
  );
}
