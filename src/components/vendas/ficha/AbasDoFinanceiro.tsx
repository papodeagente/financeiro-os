'use client';

/**
 * Abas Cliente, Fornecedor, Comissões e Posição da ficha da venda (E5): o
 * que já existe no financeiro por causa desta venda, lido das contas de
 * verdade (baixa parcial, cobrança emitida, estorno).
 */
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Info, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Meter } from '@/components/fin/Meter';
import { StatusChip } from '@/components/fin/StatusChip';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { MoneyField } from '@/components/fin/MoneyField';
import { Segmentado } from '@/components/fin/Segmentado';
import { Field } from '@/components/fin/Field';
import type { ComissaoManualNaVenda } from '@/lib/comissao-funcoes-servidor';
import { parseMoneyBR } from '@/lib/money';
import { toast } from '@/lib/toast';
import { FORMAS } from '@/lib/venda-modelo';
import type { FichaDaVenda } from '@/lib/venda-rota';
import type { LadoDoFornecedor, PosicaoDaVenda } from '@/lib/venda-posicao';
import { rotuloDaForma } from '@/lib/formas-pagamento';
import { cn } from '@/lib/utils';
import { dataBR, LINK, Pilula, quandoBR, reais, ROTULO, SECAO, SELECT } from './comum';

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
      <ComissoesManuais vendaId={ficha.venda.id} />
      <Bloco titulo="Comissão do vendedor" vazio="Ainda não calculada para esta venda. A comissão do vendedor é calculada em Comissões, pelas regras da agência.">
        {vendedor.map(c => (
          <Linha key={c.id} esquerda={txt(c.vendedor_nome) || 'Vendedor'} meio={`${txt(c.plano_nome) || 'Plano'} · ${Number(c.percentual_aplicado || 0).toLocaleString('pt-BR')}% sobre ${reais(n(c.valor_base))}`} valor={n(c.valor_comissao)} status={<StatusChip dominio="comissao" valor={txt(c.status) || 'CALCULADA'} />} />
        ))}
      </Bloco>
      <Nota>Comissões dos vendedores em <Link href="/equipe/comissoes" className={LINK}>Comissões</Link>.</Nota>
    </div>
  );
}

// ============================================================
// Comissão manual (indicação, bônus), E7
// ============================================================

interface DadosDasManuais {
  regra: 'ATUAL' | 'FUNCOES';
  pode_lancar: boolean;
  situacao_venda: 'ABERTA' | 'FECHADA';
  cancelada: boolean;
  base_centavos: number;
  manuais: ComissaoManualNaVenda[];
  pessoas: Array<{ id: string; nome: string; funcao_nome: string }>;
}

const pctBR = (p: number) => `${p.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;

export function situacaoDaManual(m: Pick<ComissaoManualNaVenda, 'fechado_centavos' | 'pago_centavos'>): { rotulo: string; tom: 'neutro' | 'positivo' | 'aviso' } {
  if (m.pago_centavos > 0 && m.pago_centavos >= m.fechado_centavos) return { rotulo: 'Paga', tom: 'positivo' };
  if (m.fechado_centavos > 0) return { rotulo: 'Fechada', tom: 'neutro' };
  return { rotulo: 'A fechar', tom: 'aviso' };
}

/** Por que não dá para lançar agora, numa frase (null = dá). */
export function impedimentoDaManual(d: Pick<DadosDasManuais, 'regra' | 'cancelada' | 'situacao_venda' | 'pessoas'>): string | null {
  if (d.regra !== 'FUNCOES') return 'A comissão manual entra no Fechar comissões da regra por função. A agência ainda usa o plano por vendedor (Configurações › Comissões): nele, o ajuste é feito na tela de Comissões.';
  if (d.cancelada) return 'A venda está cancelada.';
  if (d.situacao_venda !== 'FECHADA') return 'Feche a venda para lançar: assim a base da comissão não muda depois.';
  if (!d.pessoas.length) return 'Ninguém está numa função de comissão ainda (Equipe › Funções).';
  return null;
}

export function ComissoesManuais({ vendaId }: { vendaId: string }) {
  const [dados, setDados] = React.useState<DadosDasManuais | null>(null);
  const [falhou, setFalhou] = React.useState(false);
  const [lancar, setLancar] = React.useState(false);
  const [excluir, setExcluir] = React.useState<ComissaoManualNaVenda | null>(null);
  const [processando, setProcessando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/comissoes-por-funcao/manuais?venda_id=${encodeURIComponent(vendaId)}`);
      if (!r.ok) { setFalhou(true); return; }
      setDados(await r.json());
      setFalhou(false);
    } catch { setFalhou(true); }
  }, [vendaId]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  async function confirmarExclusao() {
    if (!excluir) return;
    setProcessando(true);
    try {
      const r = await fetch(`/api/comissoes-por-funcao/manuais?venda_id=${encodeURIComponent(vendaId)}&id=${encodeURIComponent(excluir.id)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? 'Não foi excluída.');
      toast.success('Comissão excluída', `${excluir.pessoa_nome}: ${excluir.descricao}.`);
      setExcluir(null);
      await carregar();
    } catch (e) {
      toast.error('Não foi excluída', e instanceof Error ? e.message : undefined);
    } finally {
      setProcessando(false);
    }
  }

  // Sem o direito de ver o ganho, a rota recusa: o bloco some (o de cima já avisa).
  if (falhou) return null;
  if (!dados) return <div className="h-24 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" aria-hidden="true" />;
  const impedimento = impedimentoDaManual(dados);

  return (
    <section className={SECAO} aria-labelledby="t-manual">
      <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h3 id="t-manual" className="fin-t-body-strong text-[var(--fin-text)]">Comissão manual</h3>
          <p className="fin-t-caption text-[var(--fin-text-3)]">Indicação, bônus ou outro ganho fora do plano. Entra inteira no próximo fechamento da pessoa e não conta para a meta.</p>
        </div>
        {dados.pode_lancar ? (
          <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 lg:h-9" disabled={Boolean(impedimento)} onClick={() => setLancar(true)}>
            <Plus aria-hidden="true" className="size-4" /> Lançar comissão
          </Button>
        ) : null}
      </div>
      {impedimento && dados.pode_lancar ? <p className="fin-t-caption text-[var(--fin-text-2)]">{impedimento}</p> : null}
      {dados.manuais.length ? (
        <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
          {dados.manuais.map(m => {
            const sit = situacaoDaManual(m);
            return (
              <li key={m.id} className="grid grid-cols-[1fr_auto] items-center gap-x-[var(--fin-s-3)] gap-y-1 py-[var(--fin-s-2)] sm:grid-cols-[1fr_auto_auto_auto]">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate fin-t-body text-[var(--fin-text)]">{m.pessoa_nome} <span className="text-[var(--fin-text-3)]">· {m.funcao_nome}</span></span>
                  <span className="truncate fin-t-caption text-[var(--fin-text-3)]">
                    {m.descricao} · {m.tipo === 'PERCENTUAL' ? `${pctBR(m.percentual)} de ${reais(m.base_centavos)}` : 'valor fixo'} · {m.lancado_por || 'lançada'} em {dataBR(m.data)}
                  </span>
                </span>
                <span className="order-3 sm:order-none"><Pilula tom={sit.tom}>{sit.rotulo}</Pilula></span>
                <span className="text-right fin-t-body-strong tabular-nums text-[var(--fin-text)]">{reais(m.valor_centavos)}</span>
                <span className="order-4 justify-self-end sm:order-none">
                  {dados.pode_lancar && m.pode_excluir ? (
                    <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={`Excluir a comissão de ${m.pessoa_nome}`} onClick={() => setExcluir(m)}>
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  ) : <span className="inline-block size-9" aria-hidden="true" />}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="fin-t-caption text-[var(--fin-text-3)]">Nenhuma comissão manual nesta venda.</p>}

      {lancar ? <LancarComissaoManual vendaId={vendaId} dados={dados} onFechar={() => setLancar(false)} onLancada={async () => { setLancar(false); await carregar(); }} /> : null}
      <ConfirmDialog
        aberto={Boolean(excluir)} onOpenChange={o => { if (!o) setExcluir(null); }} tone="destrutivo" processando={processando}
        titulo={`Excluir a comissão de ${excluir?.pessoa_nome ?? ''}?`}
        oQueVaiAcontecer="Ela sai do próximo fechamento. O histórico da venda guarda quem excluiu e quando."
        detalhes={excluir ? [{ rotulo: 'Do que é', valor: excluir.descricao }, { rotulo: 'Valor', valor: reais(excluir.valor_centavos) }] : []}
        confirmarRotulo="Excluir comissão" onConfirmar={confirmarExclusao}
      />
    </section>
  );
}

function LancarComissaoManual({ vendaId, dados, onFechar, onLancada }: { vendaId: string; dados: DadosDasManuais; onFechar: () => void; onLancada: () => Promise<void> }) {
  const [pessoa, setPessoa] = React.useState('');
  const [descricao, setDescricao] = React.useState('');
  const [tipo, setTipo] = React.useState<'VALOR' | 'PERCENTUAL'>(dados.base_centavos > 0 ? 'PERCENTUAL' : 'VALOR');
  const [percentual, setPercentual] = React.useState('');
  const [valor, setValor] = React.useState(0);
  const [salvando, setSalvando] = React.useState(false);
  const pct = parseMoneyBR(percentual) ?? 0;
  const calculado = tipo === 'PERCENTUAL' ? Math.round(Math.max(dados.base_centavos, 0) * Math.max(pct, 0) / 100) : Math.round(valor * 100);
  const falta = !pessoa ? 'Escolha quem recebe.' : !descricao.trim() ? 'Diga do que é a comissão.'
    : tipo === 'PERCENTUAL' && (pct <= 0 || pct > 100) ? 'O percentual vai de 0,01% a 100%.'
      : calculado <= 0 ? 'A comissão dá zero.' : null;

  async function salvar() {
    if (falta) { toast.error('Falta um dado', falta); return; }
    setSalvando(true);
    try {
      const r = await fetch('/api/comissoes-por-funcao/manuais', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venda_id: vendaId, pessoa_funcao_id: pessoa, descricao, tipo, percentual: pct, valor_centavos: Math.round(valor * 100) }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? 'Não foi lançada.');
      toast.success('Comissão lançada', `${j.pessoa_nome}: ${reais(j.valor_centavos)}. Entra no próximo fechamento.`);
      await onLancada();
    } catch (e) {
      toast.error('Não foi lançada', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <RecordSheet
      aberto onOpenChange={o => { if (!o) onFechar(); }} largura={480}
      titulo="Lançar comissão manual"
      descricao="Para indicação, bônus ou outro ganho fora do plano. Quem recebe precisa estar numa função de comissão."
      resumo={calculado > 0 ? <>Comissão de <strong className="tabular-nums">{reais(calculado)}</strong>, no próximo fechamento.</> : null}
      sujo={Boolean(pessoa || descricao || percentual || valor)}
      acaoPrimaria={{ rotulo: 'Lançar comissão', onClick: salvar, carregando: salvando, desabilitado: Boolean(falta) }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <Field rotulo="Quem recebe" obrigatorio>
          {a => (
            <select {...a} className={SELECT} value={pessoa} onChange={e => setPessoa(e.target.value)}>
              <option value="">Escolha…</option>
              {dados.pessoas.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.funcao_nome}</option>)}
            </select>
          )}
        </Field>
        <Field rotulo="Do que é" ajuda="Aparece no fechamento e na conta da pessoa." obrigatorio>
          {a => (
            <input {...a} className={SELECT} value={descricao} maxLength={120} placeholder="Ex.: Indicação do cliente" onChange={e => setDescricao(e.target.value)} />
          )}
        </Field>
        <div className="flex flex-col gap-[var(--fin-s-2)]">
          <span className={ROTULO}>Como calcular</span>
          <Segmentado rotulo="Como calcular" valor={tipo} onChange={setTipo} opcoes={[{ valor: 'PERCENTUAL', rotulo: 'Percentual' }, { valor: 'VALOR', rotulo: 'Valor fixo' }]} />
        </div>
        {tipo === 'PERCENTUAL' ? (
          <Field rotulo="Percentual" ajuda={`Sobre a receita da agência nesta venda: ${reais(dados.base_centavos)}. O valor fica gravado como está hoje.`} obrigatorio>
            {a => (
              <input {...a} inputMode="decimal" className={cn(SELECT, 'max-w-[10rem] text-right tabular-nums')} value={percentual} placeholder="0,00" onChange={e => setPercentual(e.target.value)} />
            )}
          </Field>
        ) : (
          <MoneyField rotulo="Valor" valor={valor} onChange={setValor} obrigatorio />
        )}
      </div>
    </RecordSheet>
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
  comissao_manual: 'Comissão manual lançada',
  comissao_manual_excluida: 'Comissão manual excluída',
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
