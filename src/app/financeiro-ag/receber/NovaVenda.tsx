'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';

import type { FormaPagamentoCRM, FornecedorCRM, TipoFornecedor, TipoProdutoVenda } from '@/lib/crm-types';
import { createFornecedorCRM } from '@/lib/crm-types';
import { loadEntities, saveEntity } from '@/lib/crm-storage';
import { addDias, hojeISO, num, parseMoneyBR, round2 } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn, formatBRL } from '@/lib/utils';
import { gerarContasVenda } from '@/lib/venda-financeiro';
import {
  TIPOS_DE_SERVICO, contaDaLinha, linhaDeTaxa, linhasComPrejuizo, montarVenda, novaLinha, numeroDeVenda, temErros,
  totaisDaVenda, validarVenda, type LinhaDeServico, type Moeda,
} from '@/lib/venda-turismo';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClientePicker } from '@/components/ClientePicker';
import { Field } from '@/components/fin/Field';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { SeletorDeFornecedor, nomeDoFornecedor, type FornecedorDaLista } from './SeletorDeFornecedor';

const FORMAS: { valor: FormaPagamentoCRM; rotulo: string }[] = [
  { valor: 'AVISTA_PIX', rotulo: 'Pix ou transferência' },
  { valor: 'CARTAO', rotulo: 'Cartão de crédito' },
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'FATURADO', rotulo: 'Faturado' },
  { valor: 'MISTO', rotulo: 'Misto' },
];

/** O tipo de fornecedor que o serviço sugere, para o cadastro rápido. */
const TIPO_DO_FORNECEDOR: Partial<Record<TipoProdutoVenda, TipoFornecedor>> = {
  AEREO: 'CONSOLIDADORA', HOTEL: 'HOTEL', PACOTE: 'OPERADORA', CRUZEIRO: 'CRUZEIRO', SEGURO: 'SEGURADORA',
  RECEPTIVO: 'RECEPTIVO', CARRO: 'LOCADORA',
};

/** Exemplo de descrição por tipo de serviço. */
const EXEMPLO: Partial<Record<TipoProdutoVenda, string>> = {
  AEREO: 'Ex.: GRU-LIS ida e volta, 2 adultos',
  HOTEL: 'Ex.: Lisboa, 7 noites, quarto duplo',
  PACOTE: 'Ex.: Portugal clássico, 10 dias',
  CRUZEIRO: 'Ex.: MSC Seaview, cabine externa',
  SEGURO: 'Ex.: seguro viagem Europa, 8 dias',
  RECEPTIVO: 'Ex.: traslados e city tour',
  CARRO: 'Ex.: carro econômico, 5 diárias',
  INGRESSO: 'Ex.: ingressos para o show',
};

const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10';

function paraTexto(v: number): string {
  return v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

/** Valor sem rótulo visível, para as colunas da lista. Formata ao sair do campo. */
function CampoValor({ valor, onChange, rotulo, prefixo = 'R$', invalido = false }: {
  valor: number; onChange: (v: number) => void; rotulo: string; prefixo?: string; invalido?: boolean;
}) {
  const [texto, setTexto] = useState(paraTexto(valor));
  const [focado, setFocado] = useState(false);
  const mostrado = focado ? texto : paraTexto(valor);
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center fin-t-caption text-[var(--fin-text-3)]">{prefixo}</span>
      <Input
        aria-label={rotulo}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={mostrado}
        aria-invalid={invalido || undefined}
        onFocus={() => { setFocado(true); setTexto(paraTexto(valor)); }}
        onBlur={() => setFocado(false)}
        onChange={e => {
          setTexto(e.target.value);
          if (e.target.value.trim() === '') { onChange(0); return; }
          const v = parseMoneyBR(e.target.value);
          if (v !== null) onChange(Math.max(0, v));
        }}
        className={cn(CONTROLE, 'pl-9 text-right tabular-nums', invalido && 'border-[var(--fin-negative)]')}
      />
    </div>
  );
}

function diaMes(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : '';
}

function listaDeDatas(datas: string[]): string {
  const ds = datas.map(diaMes);
  return ds.length <= 1 ? ds.join('') : `${ds.slice(0, -1).join(', ')} e ${ds[ds.length - 1]}`;
}

export type NovaVendaProps = {
  aberto: boolean;
  onFechar: () => void;
  /** Depois de gravar: a tela recarrega. */
  onGravada: () => void;
  /** Não é venda: abre o lançamento de uma conta a receber simples. */
  onOutroRecebimento: () => void;
};

/**
 * Nova venda de turismo (09/10/2026).
 *
 * Cliente, os serviços com o fornecedor, o net e o preço de venda de cada um
 * (e a margem que sobra), e como o cliente vai pagar. Grava pelo mesmo
 * caminho da venda (POST /api/vendas-crm): o servidor gera as contas a
 * receber do cliente e as contas a pagar dos fornecedores com a mesma função
 * que monta a prévia aqui embaixo.
 */
export function NovaVenda({ aberto, onFechar, onGravada, onOutroRecebimento }: NovaVendaProps) {
  const hoje = hojeISO();
  const [cliente, setCliente] = useState<{ id: string; nome: string }>({ id: '', nome: '' });
  const [dataVenda, setDataVenda] = useState(hoje);
  const [vendedorId, setVendedorId] = useState('');
  const [linhas, setLinhas] = useState<LinhaDeServico[]>([novaLinha()]);
  const [forma, setForma] = useState<FormaPagamentoCRM>('AVISTA_PIX');
  const [parcelas, setParcelas] = useState(1);
  const [primeiroVencimento, setPrimeiroVencimento] = useState(hoje);
  const [vencimentoTocado, setVencimentoTocado] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [fornecedores, setFornecedores] = useState<FornecedorDaLista[]>([]);
  const [equipe, setEquipe] = useState<Array<{ id: string; nome: string }>>([]);

  // Listas de apoio, carregadas ao abrir. Falhar aqui não trava o lançamento.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    loadEntities<FornecedorCRM>('fornecedores-crm')
      .then(l => { if (vivo) setFornecedores(l.filter(f => f.status !== 'INATIVO')); })
      .catch(() => undefined);
    fetch('/api/equipe').then(r => (r.ok ? r.json() : null)).then(j => {
      if (!vivo || !j) return;
      const pessoas = (j.equipe ?? []) as Array<{ id: string; nome: string; perfil?: string; status?: string }>;
      setEquipe(pessoas.filter(p => p.perfil !== 'COLABORADOR' && p.status !== 'INATIVO').map(p => ({ id: p.id, nome: p.nome })));
    }).catch(() => undefined);
    return () => { vivo = false; };
  }, [aberto]);

  function limpar() {
    setCliente({ id: '', nome: '' }); setDataVenda(hojeISO()); setVendedorId(''); setLinhas([novaLinha()]);
    setForma('AVISTA_PIX'); setParcelas(1); setPrimeiroVencimento(hojeISO()); setVencimentoTocado(false);
    setObservacoes(''); setTentou(false);
  }

  function fechar() { limpar(); onFechar(); }

  const atualizar = (id: string, parcial: Partial<LinhaDeServico>) =>
    setLinhas(ls => ls.map(l => (l.id === id ? { ...l, ...parcial } : l)));

  async function cadastrarFornecedor(nome: string, tipoServico: TipoProdutoVenda) {
    const f = { ...createFornecedorCRM(), nome_fantasia: nome, razao_social: nome, tipo: TIPO_DO_FORNECEDOR[tipoServico] ?? 'OUTROS' };
    try {
      await saveEntity('fornecedores-crm', f);
      setFornecedores(l => [...l, f]);
      toast.success(`${nome} cadastrado como fornecedor.`, 'Prazo de pagamento de 30 dias: ajuste no cadastro se for outro.');
      return { id: f.id, nome: nomeDoFornecedor(f) };
    } catch (e) {
      toast.error('Não foi possível cadastrar o fornecedor.', e instanceof Error ? e.message : '');
      return null;
    }
  }

  const totais = useMemo(() => totaisDaVenda(linhas), [linhas]);
  const erros = useMemo(
    () => validarVenda({ cliente_id: cliente.id, linhas, primeiroVencimento, dataVenda }),
    [cliente.id, linhas, primeiroVencimento, dataVenda],
  );
  const prejuizo = useMemo(() => new Set(linhasComPrejuizo(linhas)), [linhas]);

  // A prévia sai do MESMO gerador do servidor, com a mesma forma de conta
  // (venda lançada aqui: uma conta a receber por parcela).
  const previa = useMemo(() => {
    const cab = { cliente_id: cliente.id || 'previa', dataVenda, vendedor_id: vendedorId, formaPagamento: forma, parcelas, primeiroVencimento, observacoes };
    const { venda, itens } = montarVenda(cab, linhas.filter(l => num(l.venda) > 0), 'previa');
    return gerarContasVenda({
      venda, itens, cliente_nome: cliente.nome,
      fornecedores: fornecedores.map(f => ({ id: f.id, nome_fantasia: nomeDoFornecedor(f), regras_faturamento: f.regras_faturamento })),
    });
  }, [cliente, dataVenda, vendedorId, forma, parcelas, primeiroVencimento, observacoes, linhas, fornecedores]);

  const doCliente = previa.contas_receber.filter(c => c.origem === 'VENDA');
  const comissoes = previa.contas_receber.filter(c => c.origem === 'COMISSAO_FORNECEDOR');
  const sujo = Boolean(cliente.id) || linhas.some(l => num(l.venda) > 0 || num(l.net) > 0 || l.fornecedor_nome);

  async function gravar() {
    setTentou(true);
    if (temErros(erros)) {
      toast.error('Confira os campos marcados.');
      return;
    }
    const cab = { cliente_id: cliente.id, dataVenda, vendedor_id: vendedorId, formaPagamento: forma, parcelas, primeiroVencimento, observacoes };
    const { venda, itens } = montarVenda(cab, linhas, numeroDeVenda());
    setSalvando(true);
    try {
      const r = await fetch('/api/vendas-crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venda, itens, cliente_nome: cliente.nome }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
      const cr = Number(j.contas_receber_count ?? doCliente.length + comissoes.length);
      const cp = Number(j.contas_pagar_count ?? previa.contas_pagar.length);
      toast.success('Venda lançada.', `${cr} ${cr === 1 ? 'conta a receber' : 'contas a receber'} e ${cp} ${cp === 1 ? 'conta a pagar' : 'contas a pagar'}. Margem de ${formatBRL(totais.margem)}.`);
      limpar();
      onGravada();
      onFechar();
    } catch (e) {
      toast.error('Não foi possível lançar a venda.', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
  const semValores = !linhas.some(l => num(l.venda) > 0);
  const resumoDoRecebimento = semValores
    ? 'Preencha os serviços para ver as parcelas.'
    : doCliente.length === 0
    ? 'Nada a receber do cliente: todos os serviços são pagos direto aos fornecedores.'
    : doCliente.length === 1
      ? `${formatBRL(doCliente[0].valor_final)} em ${diaMes(doCliente[0].data_vencimento)}`
      : `${doCliente.length}x de ${formatBRL(doCliente[0].valor_final)}${doCliente.some(c => c.valor_final !== doCliente[0].valor_final) ? ' (a última ajusta os centavos)' : ''}: ${listaDeDatas(doCliente.map(c => c.data_vencimento))}`;

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) fechar(); }}
      titulo="Nova venda"
      descricao="Os serviços, quem presta cada um, o net e o preço de venda. A margem sai da diferença."
      largura={960}
      sujo={sujo}
      acaoPrimaria={{ rotulo: 'Lançar venda', onClick: gravar, carregando: salvando }}
      resumo={
        <span className="flex flex-wrap items-baseline gap-x-[var(--fin-s-4)] gap-y-1">
          <span>Cliente paga <b className="tabular-nums text-[var(--fin-text)]">{formatBRL(totais.cliente)}</b></span>
          <span>Custo <b className="tabular-nums text-[var(--fin-text)]">{formatBRL(totais.custo)}</b></span>
          {totais.comissoes > 0 ? <span>Comissões <b className="tabular-nums text-[var(--fin-text)]">{formatBRL(totais.comissoes)}</b></span> : null}
          <span>
            Margem{' '}
            <b className={cn('tabular-nums', totais.margem < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-positive)]')}>
              {formatBRL(totais.margem)}
            </b>{' '}
            ({pct(totais.margemPct)})
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-[var(--fin-s-5)]">
        {/* ── Cliente e venda ─────────────────────────────────────────── */}
        <section className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
          <Field rotulo="Cliente" obrigatorio erro={tentou ? erros.cliente ?? null : null}>
            {a => (
              <ClientePicker
                id={a.id}
                value={cliente.id}
                nome={cliente.nome}
                placeholder="Buscar quem comprou"
                onChange={c => setCliente({ id: c?.id ?? '', nome: c?.nome ?? '' })}
              />
            )}
          </Field>
          <Field rotulo="Data da venda" obrigatorio>
            {a => (
              <Input
                {...a}
                type="date"
                value={dataVenda}
                onChange={e => {
                  setDataVenda(e.target.value);
                  if (!vencimentoTocado) setPrimeiroVencimento(e.target.value);
                }}
                className={CONTROLE}
              />
            )}
          </Field>
          <Field rotulo="Vendedor" ajuda="Para a comissão da equipe.">
            {a => (
              <Select value={vendedorId} onValueChange={v => setVendedorId(String(v ?? ''))}>
                <SelectTrigger id={a.id} className={cn(CONTROLE, 'w-full')}>
                  <SelectValue>{() => equipe.find(p => p.id === vendedorId)?.nome ?? 'Sem vendedor'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="" className="fin-t-body">Sem vendedor</SelectItem>
                  {equipe.map(p => <SelectItem key={p.id} value={p.id} className="fin-t-body">{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </Field>
        </section>

        {/* ── Serviços ────────────────────────────────────────────────── */}
        <section aria-labelledby="t-servicos" className="flex flex-col gap-[var(--fin-s-2)]">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="t-servicos" className="fin-t-subhead text-[var(--fin-text)]">Serviços</h3>
              <p className="fin-t-caption text-[var(--fin-text-3)]">Uma linha por serviço. Cada fornecedor revendido ganha a sua conta a pagar.</p>
            </div>
            {tentou && erros.linhas ? <span role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erros.linhas}</span> : null}
          </div>

          {/* Cabeçalho das colunas: só onde elas cabem lado a lado. */}
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_8.5rem_8.5rem_7rem_2.75rem] gap-[var(--fin-s-2)] px-[var(--fin-s-3)] fin-t-overline text-[var(--fin-text-3)] lg:grid">
            <span>Serviço</span><span>Fornecedor</span><span className="text-right">Net (custo)</span><span className="text-right">Venda</span><span className="text-right">Margem</span><span />
          </div>

          <ol className="flex flex-col gap-[var(--fin-s-2)]">
            {linhas.map((l, i) => {
              const conta = contaDaLinha(l);
              const erro = tentou ? erros.porLinha[l.id] : undefined;
              const fornecedor = fornecedores.find(f => f.id === l.fornecedor_id);
              const prazo = fornecedor?.regras_faturamento?.prazo_pagamento_dias ?? 30;
              const vencePadrao = addDias(dataVenda, num(prazo));
              const moedaPrefixo = l.moeda === 'USD' ? 'US$' : l.moeda === 'EUR' ? '€' : 'R$';
              return (
                <li
                  key={l.id}
                  className={cn(
                    'flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border bg-[var(--fin-surface)] p-[var(--fin-s-3)]',
                    erro ? 'border-[var(--fin-negative)]' : 'border-[var(--fin-border)]',
                  )}
                >
                  <div className="grid grid-cols-2 gap-[var(--fin-s-2)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_8.5rem_8.5rem_7rem_2.75rem] lg:items-center">
                    <div className="col-span-2 lg:col-span-1">
                      <Select value={l.tipo} onValueChange={v => atualizar(l.id, { tipo: (v ?? 'OUTROS') as TipoProdutoVenda })}>
                        <SelectTrigger aria-label={`Tipo do serviço ${i + 1}`} className={cn(CONTROLE, 'w-full')}>
                          <SelectValue>{() => (l.daAgencia ? 'Taxa de serviço' : TIPOS_DE_SERVICO.find(t => t.id === l.tipo)?.rotulo ?? 'Outros')}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TIPOS_DE_SERVICO.map(t => <SelectItem key={t.id} value={t.id} className="fin-t-body">{t.rotulo}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 lg:col-span-1">
                      {l.daAgencia ? (
                        <span className="flex h-11 items-center rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-3 fin-t-body text-[var(--fin-text-2)] lg:h-10">
                          Receita da agência
                        </span>
                      ) : (
                        <SeletorDeFornecedor
                          fornecedores={fornecedores}
                          valorId={l.fornecedor_id}
                          valorNome={l.fornecedor_nome}
                          invalido={Boolean(erro && /fornecedor/.test(erro))}
                          onChange={f => atualizar(l.id, { fornecedor_id: f.id, fornecedor_nome: f.nome })}
                          onCadastrar={nome => cadastrarFornecedor(nome, l.tipo)}
                        />
                      )}
                    </div>
                    {l.pagoDireto ? (
                      <div className="relative flex flex-col gap-1">
                        <span aria-hidden="true" className="fin-t-caption text-[var(--fin-text-3)] lg:hidden">Comissão</span>
                        <Input
                          aria-label={`Comissão do fornecedor, serviço ${i + 1}`}
                          inputMode="decimal"
                          placeholder="Comissão"
                          value={l.comissaoPct ? String(l.comissaoPct).replace('.', ',') : ''}
                          onChange={e => {
                            const v = Number(e.target.value.replace('%', '').replace(',', '.'));
                            atualizar(l.id, { comissaoPct: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0 });
                          }}
                          className={cn(CONTROLE, 'pr-7 text-right tabular-nums')}
                        />
                        <span aria-hidden="true" className="pointer-events-none absolute bottom-0 right-2.5 flex h-11 items-center fin-t-caption text-[var(--fin-text-3)] lg:h-10">%</span>
                      </div>
                    ) : l.daAgencia ? (
                      <span className="hidden text-right fin-t-body text-[var(--fin-text-3)] lg:block">—</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span aria-hidden="true" className="fin-t-caption text-[var(--fin-text-3)] lg:hidden">Net (custo)</span>
                        <CampoValor rotulo={`Net (custo) do serviço ${i + 1}`} prefixo={moedaPrefixo} valor={l.net} onChange={v => atualizar(l.id, { net: v })} />
                      </div>
                    )}
                    <div className={cn('flex flex-col gap-1', l.daAgencia && 'col-span-2 lg:col-span-1')}>
                    <span aria-hidden="true" className="fin-t-caption text-[var(--fin-text-3)] lg:hidden">{l.pagoDireto ? 'Valor do serviço' : 'Venda'}</span>
                    <CampoValor
                      rotulo={l.pagoDireto ? `Valor do serviço ${i + 1}` : `Preço de venda do serviço ${i + 1}`}
                      prefixo={moedaPrefixo}
                      valor={l.venda}
                      invalido={Boolean(erro && /venda|valor do serviço/.test(erro))}
                      onChange={v => atualizar(l.id, { venda: v })}
                    />
                    </div>
                    <div className="flex items-baseline gap-2 lg:flex-col lg:items-end lg:gap-0">
                      <span className="fin-t-caption text-[var(--fin-text-3)] lg:hidden">{l.pagoDireto ? 'Comissão' : 'Margem'}</span>
                      <span className={cn('fin-t-body-strong tabular-nums', conta.margem < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>
                        {formatBRL(conta.margem)}
                      </span>
                      <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{pct(conta.margemPct)}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Tirar o serviço ${i + 1}`}
                      disabled={linhas.length === 1}
                      onClick={() => setLinhas(ls => ls.filter(x => x.id !== l.id))}
                      className="justify-self-end text-[var(--fin-text-3)]"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_7rem_auto_auto] lg:items-center">
                    <Input
                      aria-label={`Descrição do serviço ${i + 1}`}
                      placeholder={l.daAgencia ? 'Taxa de serviço (RAV/DU)' : EXEMPLO[l.tipo] ?? 'Descrição do serviço'}
                      value={l.descricao}
                      onChange={e => atualizar(l.id, { descricao: e.target.value })}
                      className={CONTROLE}
                    />
                    {l.daAgencia ? null : (
                      <Select value={l.moeda} onValueChange={v => atualizar(l.id, { moeda: (v ?? 'BRL') as Moeda, cambio: v === 'BRL' ? 1 : l.cambio })}>
                        <SelectTrigger aria-label={`Moeda do serviço ${i + 1}`} className={cn(CONTROLE, 'w-full')}>
                          <SelectValue>{() => (l.moeda === 'BRL' ? 'Real' : l.moeda === 'USD' ? 'Dólar' : 'Euro')}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BRL" className="fin-t-body">Real</SelectItem>
                          <SelectItem value="USD" className="fin-t-body">Dólar</SelectItem>
                          <SelectItem value="EUR" className="fin-t-body">Euro</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {!l.daAgencia && l.moeda !== 'BRL' ? (
                      <div className="flex items-center gap-2">
                        <span className="fin-t-caption text-[var(--fin-text-2)]">Câmbio</span>
                        <CampoValor rotulo={`Câmbio do serviço ${i + 1}`} valor={l.cambio} onChange={v => atualizar(l.id, { cambio: v })} invalido={Boolean(erro && /câmbio/.test(erro))} />
                      </div>
                    ) : null}
                    {l.daAgencia ? null : (
                      <label className="flex min-h-11 items-center gap-2 fin-t-body text-[var(--fin-text-2)] lg:min-h-10">
                        <input
                          type="checkbox"
                          checked={l.pagoDireto}
                          onChange={e => atualizar(l.id, { pagoDireto: e.target.checked })}
                          className="size-4 accent-[var(--fin-accent)]"
                        />
                        Cliente paga direto ao fornecedor
                      </label>
                    )}
                  </div>

                  {!l.daAgencia && !l.pagoDireto && num(l.net) > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 fin-t-caption text-[var(--fin-text-2)]">
                      <span>Pagar o fornecedor em</span>
                      <Input
                        type="date"
                        aria-label={`Data de pagamento do fornecedor, serviço ${i + 1}`}
                        value={l.dataPagamento || vencePadrao}
                        onChange={e => atualizar(l.id, { dataPagamento: e.target.value })}
                        className="h-9 w-auto rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] fin-t-caption"
                      />
                      <span className="text-[var(--fin-text-3)]">
                        {l.dataPagamento ? '' : `prazo de ${prazo} dias do cadastro`}
                      </span>
                    </div>
                  ) : null}

                  {erro ? <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erro}</p> : null}
                  {prejuizo.has(l.id) ? (
                    <p className="flex items-center gap-1.5 fin-t-caption text-[var(--fin-warning-text)]">
                      <TriangleAlert aria-hidden="true" className="size-3.5" />
                      Vendido abaixo do custo: a agência perde {formatBRL(Math.abs(conta.margem))} neste serviço.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap gap-[var(--fin-s-2)]">
            <Button type="button" variant="outline" onClick={() => setLinhas(ls => [...ls, novaLinha({ tipo: 'HOTEL' })])} className="h-11 lg:h-10">
              <Plus aria-hidden="true" />
              Adicionar serviço
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLinhas(ls => [...ls, linhaDeTaxa()])}
              disabled={linhas.some(l => l.daAgencia)}
              className="h-11 text-[var(--fin-text-2)] lg:h-10"
            >
              <Plus aria-hidden="true" />
              Taxa de serviço (RAV/DU)
            </Button>
          </div>

          <dl className="grid grid-cols-2 gap-x-[var(--fin-s-4)] gap-y-2 rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)] p-[var(--fin-s-4)] sm:grid-cols-4">
            {[
              { rotulo: 'Cliente paga', valor: formatBRL(totais.cliente), extra: totais.pagoDireto > 0 ? `+ ${formatBRL(totais.pagoDireto)} direto aos fornecedores` : '' },
              { rotulo: 'Custo (net)', valor: formatBRL(totais.custo), extra: totais.markupPct !== null ? `markup de ${pct(totais.markupPct)}` : '' },
              { rotulo: 'Comissões a receber', valor: formatBRL(totais.comissoes), extra: '' },
              { rotulo: 'Margem da venda', valor: formatBRL(totais.margem), extra: `${pct(totais.margemPct)} da venda`, destaque: true },
            ].map(c => (
              <div key={c.rotulo} className="flex min-w-0 flex-col">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">{c.rotulo}</dt>
                <dd className={cn('tabular-nums', c.destaque ? 'fin-t-metric-sm' : 'fin-t-body-strong', c.destaque && totais.margem < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>
                  {c.valor}
                </dd>
                {c.extra ? <dd className="fin-t-caption text-[var(--fin-text-3)]">{c.extra}</dd> : null}
              </div>
            ))}
          </dl>
        </section>

        {/* ── Recebimento do cliente ──────────────────────────────────── */}
        <section aria-labelledby="t-recebimento" className="flex flex-col gap-[var(--fin-s-3)]">
          <h3 id="t-recebimento" className="fin-t-subhead text-[var(--fin-text)]">Como o cliente paga</h3>
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
            <Field rotulo="Forma de pagamento">
              {a => (
                <Select value={forma} onValueChange={v => setForma((v ?? 'AVISTA_PIX') as FormaPagamentoCRM)}>
                  <SelectTrigger id={a.id} className={cn(CONTROLE, 'w-full')}>
                    <SelectValue>{() => FORMAS.find(f => f.valor === forma)?.rotulo ?? ''}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAS.map(f => <SelectItem key={f.valor} value={f.valor} className="fin-t-body">{f.rotulo}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field rotulo="Parcelas">
              {a => (
                <Select value={String(parcelas)} onValueChange={v => setParcelas(Number(v) || 1)}>
                  <SelectTrigger id={a.id} className={cn(CONTROLE, 'w-full')}>
                    <SelectValue>{() => (parcelas === 1 ? 'À vista' : `${parcelas}x`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map(n => (
                      <SelectItem key={n} value={String(n)} className="fin-t-body">{n === 1 ? 'À vista' : `${n}x`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field rotulo={parcelas === 1 ? 'Vencimento' : '1º vencimento'} erro={tentou ? erros.primeiroVencimento ?? null : null}>
              {a => (
                <Input
                  {...a}
                  type="date"
                  value={primeiroVencimento}
                  onChange={e => { setPrimeiroVencimento(e.target.value); setVencimentoTocado(true); }}
                  className={CONTROLE}
                />
              )}
            </Field>
          </div>
          <p className="fin-t-body text-[var(--fin-text-2)]">{resumoDoRecebimento}</p>
        </section>

        {/* ── O que vai ser lançado ───────────────────────────────────── */}
        <section aria-labelledby="t-lancado" className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] p-[var(--fin-s-4)]">
          <h3 id="t-lancado" className="fin-t-body-strong text-[var(--fin-text)]">O que vai ser lançado</h3>
          <ul className="flex flex-col gap-1.5 fin-t-body text-[var(--fin-text-2)]">
            {semValores ? <li>Nada ainda: os lançamentos aparecem aqui conforme os serviços são preenchidos.</li> : null}
            <li hidden={semValores}>
              <b className="text-[var(--fin-text)]">{doCliente.length} {doCliente.length === 1 ? 'conta a receber' : 'contas a receber'}</b> do cliente
              {doCliente.length > 0 ? `, somando ${formatBRL(round2(doCliente.reduce((s, c) => s + c.valor_final, 0)))}` : ''}.
            </li>
            {previa.contas_pagar.length > 0 ? (
              <li>
                <b className="text-[var(--fin-text)]">{previa.contas_pagar.length} {previa.contas_pagar.length === 1 ? 'conta a pagar' : 'contas a pagar'}</b>:{' '}
                {previa.contas_pagar.map(c => `${c.fornecedor_nome || 'fornecedor a informar'} ${formatBRL(c.valor_final)} em ${diaMes(c.data_vencimento)}`).join(' · ')}.
              </li>
            ) : null}
            {comissoes.length > 0 ? (
              <li>
                <b className="text-[var(--fin-text)]">{comissoes.length} {comissoes.length === 1 ? 'comissão a receber' : 'comissões a receber'}</b>:{' '}
                {comissoes.map(c => `${c.cliente_nome || 'fornecedor'} ${formatBRL(c.valor_final)} em ${diaMes(c.data_vencimento)}`).join(' · ')}.
              </li>
            ) : null}
          </ul>
          <Field rotulo="Observações">
            {a => (
              <Input {...a} value={observacoes} onChange={e => setObservacoes(e.target.value)} placeholder="Opcional: localizador, pedido do cliente..." className={CONTROLE} />
            )}
          </Field>
        </section>

        <p className="fin-t-caption text-[var(--fin-text-3)]">
          Não é uma venda?{' '}
          <button type="button" onClick={() => { limpar(); onOutroRecebimento(); }} className="font-medium text-[var(--fin-accent)] underline-offset-2 hover:underline">
            Lançar outro recebimento
          </button>
          {' '}(reembolso, aluguel de espaço, acerto).
        </p>
      </div>
    </RecordSheet>
  );
}

export default NovaVenda;
