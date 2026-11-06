'use client';

/**
 * Abas Cliente, Fornecedor, Comissões e Posição da ficha da venda (E5): o
 * que já existe no financeiro por causa desta venda, lido das contas de
 * verdade (baixa parcial, cobrança emitida, estorno).
 */
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Info } from 'lucide-react';

import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Meter } from '@/components/fin/Meter';
import { StatusChip } from '@/components/fin/StatusChip';
import { FORMAS } from '@/lib/venda-modelo';
import type { FichaDaVenda } from '@/lib/venda-rota';
import type { LadoDoFornecedor, PosicaoDaVenda } from '@/lib/venda-posicao';
import { rotuloDaForma } from '@/lib/formas-pagamento';
import { cn } from '@/lib/utils';
import { dataBR, LINK, Pilula, quandoBR, reais, SECAO } from './comum';

type Conta = Record<string, unknown> & { id: string };
const n = (v: unknown) => Math.round((Number(v) || 0) * 100);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const recebidoDe = (c: Conta, campo: 'valor_recebido' | 'valor_pago') => {
  const s = txt(c.status);
  if (s === 'PARCIAL') return n(c[campo]);
  if (s === 'RECEBIDO' || s === 'PAGO') return n(c[campo]) || n(c.valor_final);
  return 0;
};

function SemPermissao({ oQue }: { oQue: string }) {
  return (
    <p className="flex items-center gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-3)] fin-t-body text-[var(--fin-text-2)]">
      <Info aria-hidden="true" className="size-4 shrink-0 text-[var(--fin-text-3)]" /> Seu acesso não inclui {oQue}.
    </p>
  );
}

function Nota({ children }: { children: React.ReactNode }) {
  return <p className="fin-t-caption text-[var(--fin-text-3)]">{children}</p>;
}

// ============================================================
// Cliente (financeiro do cliente)
// ============================================================

export function AbaCliente({ ficha }: { ficha: FichaDaVenda }) {
  if (!ficha.permissoes.ver_financeiro) return <SemPermissao oQue="o financeiro da venda" />;
  const contas = (ficha.contas_receber as Conta[]).filter(c => txt(c.origem) !== 'COMISSAO_FORNECEDOR');
  const colunas: FinColuna<Conta>[] = [
    {
      id: 'desc', cabecalho: 'Conta', tipo: 'texto', minWidth: 240, acessor: c => txt(c.descricao),
      render: c => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate fin-t-body text-[var(--fin-text)]">{txt(c.descricao)}</span>
          <span className="truncate fin-t-caption text-[var(--fin-text-3)]">
            {txt(c.venda_forma) ? FORMAS[txt(c.venda_forma) as keyof typeof FORMAS]?.rotulo : rotuloDaForma(txt(c.forma_recebimento)) || 'Forma a combinar'}
            {c.faturar ? ' · vai para a fatura' : ''}
            {c.auto_gerado ? '' : ' · lançada à mão'}
          </span>
        </div>
      ),
    },
    { id: 'pagante', cabecalho: 'Pagante', tipo: 'texto', minWidth: 160, prioridade: 2, render: c => <span className="truncate">{txt(c.cliente_nome) || '—'}</span> },
    { id: 'venc', cabecalho: 'Vencimento', tipo: 'data', valor: c => txt(c.data_vencimento) || null },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', valor: c => n(c.valor_final) / 100 },
    { id: 'recebido', cabecalho: 'Recebido', tipo: 'dinheiro', prioridade: 1, valor: c => recebidoDe(c, 'valor_recebido') / 100, tone: c => (recebidoDe(c, 'valor_recebido') > 0 ? 'positivo' : 'neutro') },
    { id: 'status', cabecalho: 'Situação', tipo: 'status', dominio: 'receber', valor: c => txt(c.status) || 'PENDENTE' },
  ];
  const lado = ficha.posicao?.cliente;
  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      {lado ? (
        <dl className="grid grid-cols-2 gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] sm:grid-cols-4">
          <Par rotulo="A receber do cliente" valor={reais(lado.a_receber)} />
          <Par rotulo="Recebido" valor={reais(lado.recebido)} tom="positivo" />
          <Par rotulo="Em aberto" valor={reais(lado.em_aberto)} />
          <Par rotulo="Em atraso" valor={reais(lado.em_atraso)} tom={lado.em_atraso > 0 ? 'negativo' : 'neutro'} />
          {lado.coberto_pelo_fornecedor > 0 ? <Par rotulo="Pago direto ao fornecedor" valor={reais(lado.coberto_pelo_fornecedor)} /> : null}
          {lado.coberto_por_credito > 0 ? <Par rotulo="Com crédito do cliente" valor={reais(lado.coberto_por_credito)} /> : null}
          {lado.retido_pelo_intermediario > 0 ? <Par rotulo="Retido pelo intermediário" valor={reais(lado.retido_pelo_intermediario)} /> : null}
          {lado.cobrancas_abertas.quantidade > 0 ? <Par rotulo="Cobranças emitidas" valor={`${lado.cobrancas_abertas.quantidade} · ${reais(lado.cobrancas_abertas.valor)}`} /> : null}
        </dl>
      ) : null}
      <FinTable
        linhas={contas} colunas={colunas} chave={c => c.id} estado="ok" densidade="compacta"
        vazio={{ motivo: 'sem-dado', titulo: 'Nada a receber do cliente', oQueE: 'As contas a receber nascem sozinhas dos pagamentos da venda, ao salvar.' }}
      />
      <Nota>Para dar baixa, emitir boleto ou Pix, abra a conta em <Link href="/financeiro-ag/receber" className={LINK}>Contas a receber</Link>. As contas desta venda são refeitas sozinhas quando a venda muda; as recebidas e as com cobrança emitida ficam como estão.</Nota>
    </div>
  );
}

function Par({ rotulo, valor, tom = 'neutro' }: { rotulo: string; valor: string; tom?: 'neutro' | 'positivo' | 'negativo' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</dt>
      <dd className={cn('fin-t-body-strong tabular-nums', tom === 'positivo' ? 'text-[var(--fin-positive)]' : tom === 'negativo' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>{valor}</dd>
    </div>
  );
}

// ============================================================
// Fornecedor
// ============================================================

export function AbaFornecedor({ ficha }: { ficha: FichaDaVenda }) {
  if (!ficha.permissoes.ver_financeiro || !ficha.posicao) return <SemPermissao oQue="o financeiro da venda" />;
  const lados = ficha.posicao.fornecedores;
  const colunasLado: FinColuna<LadoDoFornecedor>[] = [
    {
      id: 'nome', cabecalho: 'Fornecedor / representante', tipo: 'texto', minWidth: 220, acessor: l => l.nome,
      render: l => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate fin-t-body-strong text-[var(--fin-text)]">{l.nome}</span>
          {l.papel === 'intermediario' ? <Pilula tom="violeta">Intermediário</Pilula> : null}
        </span>
      ),
    },
    { id: 'apagar', cabecalho: 'A pagar', tipo: 'dinheiro', valor: l => l.a_pagar / 100 },
    { id: 'pago', cabecalho: 'Pago', tipo: 'dinheiro', prioridade: 2, valor: l => l.pago / 100 },
    { id: 'aberto', cabecalho: 'Em aberto', tipo: 'dinheiro', valor: l => l.em_aberto / 100 },
    { id: 'areceber', cabecalho: 'Comissão a receber', tipo: 'dinheiro', prioridade: 1, valor: l => l.a_receber / 100, sub: l => (l.recebido ? <span>recebido {reais(l.recebido)}</span> : null) },
    { id: 'venc', cabecalho: 'Próximo vencimento', tipo: 'data', prioridade: 1, valor: l => l.proximo_vencimento },
    { id: 'sit', cabecalho: 'Situação', tipo: 'status', dominio: 'pagar', valor: l => (l.situacao === 'PAGO' ? 'PAGO' : l.situacao === 'PARCIAL' ? 'PARCIAL' : l.a_pagar > 0 ? 'PENDENTE' : 'PAGO') },
  ];
  const contas = ficha.contas_pagar as Conta[];
  const colunasContas: FinColuna<Conta>[] = [
    { id: 'desc', cabecalho: 'Conta a pagar', tipo: 'texto', minWidth: 240, acessor: c => txt(c.descricao), render: c => (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate fin-t-body text-[var(--fin-text)]">{txt(c.descricao)}</span>
        {c.fornecedor_pendente ? <span className="fin-t-caption text-[var(--fin-warning-text)]">Falta dizer a quem pagar</span> : txt(c.observacoes) ? <span className="truncate fin-t-caption text-[var(--fin-text-3)]">{txt(c.observacoes)}</span> : null}
      </div>
    ) },
    { id: 'venc', cabecalho: 'Vencimento', tipo: 'data', valor: c => txt(c.data_vencimento) || null },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', valor: c => n(c.valor_final) / 100, sub: c => (txt(c.moeda) && txt(c.moeda) !== 'BRL' ? <span>{txt(c.moeda)} {Number(c.valor_original).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span> : null) },
    { id: 'pago', cabecalho: 'Pago', tipo: 'dinheiro', prioridade: 1, valor: c => recebidoDe(c, 'valor_pago') / 100 },
    { id: 'status', cabecalho: 'Situação', tipo: 'status', dominio: 'pagar', valor: c => txt(c.status) || 'PENDENTE' },
  ];
  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      <FinTable
        linhas={lados} colunas={colunasLado} chave={l => `${l.papel}:${l.parte_id || l.nome}`} estado="ok" densidade="compacta"
        vazio={{ motivo: 'sem-dado', titulo: 'Nenhum fornecedor ainda', oQueE: 'Cada fornecedor aparece aqui com o que a agência deve, o que já pagou e a comissão que ele deve à agência.' }}
      />
      <section aria-labelledby="t-cp" className="flex flex-col gap-[var(--fin-s-2)]">
        <h3 id="t-cp" className="fin-t-body-strong text-[var(--fin-text)]">Contas a pagar da venda</h3>
        <FinTable
          linhas={contas} colunas={colunasContas} chave={c => c.id} estado="ok" densidade="compacta"
          vazio={{ motivo: 'sem-dado', titulo: 'Nada a pagar', oQueE: 'Quando o cliente paga o fornecedor direto, a agência não deve nada a ele; a receita vira comissão a receber.' }}
        />
      </section>
      <Nota>O acerto é com o representante quando o produto tem um; senão, com o fornecedor. O que o cliente pagou direto ao fornecedor já sai do que a agência deve. Pagar em <Link href="/financeiro-ag/pagar" className={LINK}>Contas a pagar</Link>.</Nota>
    </div>
  );
}

// ============================================================
// Comissões
// ============================================================

export function AbaComissoes({ ficha }: { ficha: FichaDaVenda }) {
  if (!ficha.permissoes.ver_receita) return <SemPermissao oQue="o ganho da agência nas vendas" />;
  const doFornecedor = (ficha.contas_receber as Conta[]).filter(c => txt(c.origem) === 'COMISSAO_FORNECEDOR');
  const repasses = (ficha.contas_pagar as Conta[]).filter(c => txt(c.venda_chave).startsWith('v2:repasse'));
  const vendedor = ficha.comissoes as Conta[];
  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      <Bloco titulo="Comissão a receber do fornecedor" vazio="Nenhuma: quando a agência recebe do cliente, a comissão já sai do que ela paga ao fornecedor.">
        {doFornecedor.map(c => (
          <Linha key={c.id} esquerda={txt(c.cliente_nome)} meio={`vence ${dataBR(txt(c.data_vencimento))}`} valor={n(c.valor_final)} status={<StatusChip dominio="receber" valor={txt(c.status) || 'PENDENTE'} />} />
        ))}
      </Bloco>
      <Bloco titulo="Repasse ao intermediário" vazio="Sem repasse nesta venda.">
        {repasses.map(c => (
          <Linha key={c.id} esquerda={txt(c.fornecedor_nome) || 'Intermediário não informado'} meio={`vence ${dataBR(txt(c.data_vencimento))}`} valor={n(c.valor_final)} status={<StatusChip dominio="pagar" valor={txt(c.status) || 'PENDENTE'} />} />
        ))}
      </Bloco>
      <Bloco titulo="Comissão do vendedor" vazio="Ainda não calculada para esta venda. A comissão do vendedor é calculada em Comissões, pelas regras da agência.">
        {vendedor.map(c => (
          <Linha key={c.id} esquerda={txt(c.vendedor_nome) || 'Vendedor'} meio={`${txt(c.plano_nome) || 'Plano'} · ${Number(c.percentual_aplicado || 0).toLocaleString('pt-BR')}% sobre ${reais(n(c.valor_base))}`} valor={n(c.valor_comissao)} status={<StatusChip dominio="comissao" valor={txt(c.status) || 'CALCULADA'} />} />
        ))}
      </Bloco>
      <Nota>Comissões dos vendedores em <Link href="/equipe/comissoes" className={LINK}>Comissões</Link>.</Nota>
    </div>
  );
}

function Bloco({ titulo, vazio, children }: { titulo: string; vazio: string; children: React.ReactNode }) {
  const itens = React.Children.toArray(children);
  return (
    <section className={SECAO} aria-label={titulo}>
      <h3 className="fin-t-body-strong text-[var(--fin-text)]">{titulo}</h3>
      {itens.length ? <ul className="flex flex-col divide-y divide-[var(--fin-border)]">{itens}</ul> : <p className="fin-t-caption text-[var(--fin-text-3)]">{vazio}</p>}
    </section>
  );
}

function Linha({ esquerda, meio, valor, status }: { esquerda: string; meio: string; valor: number; status: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-[var(--fin-s-3)] gap-y-1 py-[var(--fin-s-2)] sm:grid-cols-[1fr_auto_auto_auto]">
      <span className="truncate fin-t-body text-[var(--fin-text)]">{esquerda}</span>
      <span className="order-3 fin-t-caption text-[var(--fin-text-3)] sm:order-none">{meio}</span>
      <span className="text-right fin-t-body-strong tabular-nums text-[var(--fin-text)]">{reais(valor)}</span>
      <span className="order-4 justify-self-end sm:order-none">{status}</span>
    </li>
  );
}

// ============================================================
// Posição
// ============================================================

export function AbaPosicao({ ficha }: { ficha: FichaDaVenda }) {
  if (!ficha.permissoes.ver_financeiro || !ficha.posicao) return <SemPermissao oQue="o financeiro da venda" />;
  const p: PosicaoDaVenda = ficha.posicao;
  const c = p.cliente;
  const totalCliente = Math.max(c.a_receber, 1);
  const forn = p.fornecedor;
  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      {p.alertas.length ? (
        <ul className="flex flex-col gap-[var(--fin-s-2)]" aria-label="Pontos de atenção">
          {p.alertas.map((a, i) => (
            <li key={`${a.tipo}-${i}`} className={cn(
              'flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body',
              a.gravidade === 'atencao' ? 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]' : 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
            )}>
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{a.mensagem}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-positive-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-positive)]">
          Nada pedindo atenção: nenhum fornecedor é pago antes de o dinheiro do cliente entrar.
        </p>
      )}

      <div className="grid grid-cols-1 gap-[var(--fin-s-4)] lg:grid-cols-2">
        <section aria-labelledby="t-pos-cli" className={SECAO}>
          <h3 id="t-pos-cli" className="flex items-center gap-2 fin-t-subhead text-[var(--fin-text)]">
            <ArrowDownLeft aria-hidden="true" className="size-4 text-[var(--fin-positive)]" /> Cliente
          </h3>
          <Meter
            pct={c.a_receber > 0 ? (c.recebido / totalCliente) * 100 : 100}
            faixa={c.em_atraso > 0 ? 'critico' : c.situacao === 'PAGO' || c.situacao === 'SEM_VALOR' ? 'saudavel' : 'atencao'}
            rotulo={c.situacao === 'PAGO' ? 'Pago' : c.situacao === 'PARCIAL' ? 'Pago em parte' : c.situacao === 'SEM_VALOR' ? 'Nada a receber' : 'Pendente'}
            descricao={`${reais(c.recebido)} de ${reais(c.a_receber)} recebidos`}
          />
          <dl className="grid grid-cols-2 gap-[var(--fin-s-3)]">
            <Par rotulo="Total da venda" valor={reais(c.total)} />
            <Par rotulo="Em aberto" valor={reais(c.em_aberto)} />
            <Par rotulo="Próximo vencimento" valor={dataBR(c.proximo_vencimento)} />
            <Par rotulo="Termina de pagar" valor={dataBR(c.ultimo_vencimento)} />
          </dl>
        </section>
        <section aria-labelledby="t-pos-for" className={SECAO}>
          <h3 id="t-pos-for" className="flex items-center gap-2 fin-t-subhead text-[var(--fin-text)]">
            <ArrowUpRight aria-hidden="true" className="size-4 text-[var(--fin-negative-text)]" /> Fornecedores
          </h3>
          <Meter
            pct={forn.a_pagar > 0 ? (forn.pago / forn.a_pagar) * 100 : 100}
            faixa={forn.situacao === 'PAGO' || forn.situacao === 'SEM_VALOR' ? 'saudavel' : 'atencao'}
            rotulo={forn.situacao === 'PAGO' ? 'Pago' : forn.situacao === 'PARCIAL' ? 'Pago em parte' : forn.situacao === 'SEM_VALOR' ? 'Nada a pagar' : 'Pendente'}
            descricao={`${reais(forn.pago)} de ${reais(forn.a_pagar)} pagos`}
          />
          <dl className="grid grid-cols-2 gap-[var(--fin-s-3)]">
            <Par rotulo="A pagar em aberto" valor={reais(forn.em_aberto)} />
            <Par rotulo="Comissão a receber" valor={reais(forn.a_receber - forn.recebido)} />
          </dl>
        </section>
      </div>

      <section aria-labelledby="t-receita" className={SECAO}>
        <div className="flex flex-col gap-1">
          <h3 id="t-receita" className="fin-t-subhead text-[var(--fin-text)]">Receita da agência</h3>
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            Aberta por componente. Os que a agência deixou fora da receita aparecem riscados (<Link href="/config/vendas" className={LINK}>Configurações › Vendas</Link>).
          </p>
        </div>
        {ficha.receita && ficha.receita.linhas.length ? (
          <table className="w-full border-collapse fin-t-body">
            <tbody>
              {ficha.receita.linhas.map(l => (
                <tr key={l.tipo} className={cn('border-b border-[var(--fin-border)]', !l.entra && 'text-[var(--fin-text-3)]')}>
                  <th scope="row" className={cn('py-1.5 text-left font-normal', !l.entra && 'line-through')}>{l.rotulo}</th>
                  <td className={cn('py-1.5 text-right tabular-nums', !l.entra && 'line-through', l.entra && l.sinal < 0 && 'text-[var(--fin-negative-text)]')}>{l.sinal < 0 ? '− ' : ''}{reais(l.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="pt-2 text-left fin-t-body-strong text-[var(--fin-text)]">Receita</th>
                <td className="pt-2 text-right fin-t-body-strong tabular-nums text-[var(--fin-text)]">{reais(ficha.receita.receita)} <span className="fin-t-caption font-normal text-[var(--fin-text-3)]">({ficha.receita.percentual.toLocaleString('pt-BR')}% do faturamento)</span></td>
              </tr>
              {ficha.receita.fora_da_receita !== 0 ? (
                <tr><th scope="row" className="text-left fin-t-caption font-normal text-[var(--fin-text-3)]">Fora da receita</th><td className="text-right fin-t-caption tabular-nums text-[var(--fin-text-3)]">{reais(ficha.receita.fora_da_receita)}</td></tr>
              ) : null}
            </tfoot>
          </table>
        ) : ficha.receita ? (
          <p className="fin-t-caption text-[var(--fin-text-3)]">Sem componente de receita nos produtos.</p>
        ) : <SemPermissao oQue="a receita da venda" />}
      </section>

      <section aria-labelledby="t-hist" className={SECAO}>
        <h3 id="t-hist" className="fin-t-subhead text-[var(--fin-text)]">Histórico da venda</h3>
        {ficha.eventos.length ? (
          <ol className="flex flex-col divide-y divide-[var(--fin-border)]">
            {ficha.eventos.map(e => (
              <li key={e.id} className="flex flex-col gap-0.5 py-[var(--fin-s-2)] sm:flex-row sm:items-baseline sm:gap-[var(--fin-s-3)]">
                <span className="w-36 shrink-0 fin-t-caption tabular-nums text-[var(--fin-text-3)]">{quandoBR(e.criado_em)}</span>
                <span className="fin-t-body text-[var(--fin-text)]">
                  {ROTULO_EVENTO[e.tipo] ?? e.tipo}{e.usuario_nome ? ` por ${e.usuario_nome}` : ''}
                  {e.motivo ? <span className="text-[var(--fin-text-2)]">: “{e.motivo}”</span> : null}
                  {resumoDoEvento(e.detalhe)}
                </span>
              </li>
            ))}
          </ol>
        ) : <p className="fin-t-caption text-[var(--fin-text-3)]">Esta venda é anterior ao histórico.</p>}
      </section>
    </div>
  );
}

const ROTULO_EVENTO: Record<string, string> = {
  criada: 'Venda lançada',
  alterada: 'Venda alterada',
  recebida_do_crm: 'Recebida do CRM',
  fechada: 'Venda fechada',
  reaberta: 'Venda reaberta',
  mudanca_do_crm_recusada: 'O CRM mandou uma mudança, mas a venda estava fechada',
};

function resumoDoEvento(d: Record<string, unknown>): React.ReactNode {
  const contas = d.contas as { criadas?: number; atualizadas?: number; removidas?: number; preservadas?: number } | undefined;
  if (!contas) return null;
  const partes = [
    contas.criadas ? `${contas.criadas} criada${contas.criadas > 1 ? 's' : ''}` : '',
    contas.atualizadas ? `${contas.atualizadas} atualizada${contas.atualizadas > 1 ? 's' : ''}` : '',
    contas.removidas ? `${contas.removidas} removida${contas.removidas > 1 ? 's' : ''}` : '',
    contas.preservadas ? `${contas.preservadas} já baixada${contas.preservadas > 1 ? 's' : ''} mantida${contas.preservadas > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return partes.length ? <span className="block fin-t-caption text-[var(--fin-text-3)]">Contas: {partes.join(', ')}.</span> : null;
}
