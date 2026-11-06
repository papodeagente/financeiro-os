'use client';

/**
 * Aba Pagamentos da ficha da venda (E5): como o cliente paga, forma a forma.
 * Cada forma vira sozinha as contas certas; a janela mostra o que vai nascer
 * antes de guardar. Não existe botão de "gerar".
 */
import * as React from 'react';
import { ChevronDown, ReceiptText, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { Field } from '@/components/fin/Field';
import {
  FORMAS, congelarTaxaDoCartao, novoIdDaVenda, normalizarPagamento, parteDoAcerto, taxaDoCartao, taxaDoCartaoIndefinida, textoDosCampos, vencimentoDaParcela,
  type CamposDaForma, type FormaDaVenda, type PagamentoDaVenda, type ParteDaVenda, type Venda,
} from '@/lib/venda-modelo';
import { contasDaVenda } from '@/lib/venda-contas';
import { EmitirCobrancas, type ContaParaEmitir } from '@/components/financeiro/cobranca/EmitirCobrancas';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import { contasDaVendaParaCobrar } from '@/lib/cobranca/regras-telas';
import { hojeISO } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useFormasDePagamento } from '@/components/fin/useFormasDePagamento';
import type { FormaPagamento } from '@/lib/formas-pagamento';
import { cn } from '@/lib/utils';
import { CampoReais, CONTROLE, dataBR, reais, ROTULO, SELECT } from './comum';
import type { PessoaDaLista } from './AbaProdutos';

/** As formas como aparecem no menu, nos três grupos de sempre. */
const GRUPOS: ReadonlyArray<{ titulo: string; formas: FormaDaVenda[] }> = [
  { titulo: 'O cliente paga a agência', formas: ['PIX', 'BOLETO', 'CARTAO', 'DINHEIRO', 'DEPOSITO', 'CHEQUE', 'FATURAR', 'OUTROS'] },
  { titulo: 'Com crédito', formas: ['CREDITO_CLIENTE', 'CREDITO_FORNECEDOR'] },
  { titulo: 'O dinheiro não passa pela agência', formas: ['PAGO_DIRETO_FORNECEDOR', 'RETIDO_INTERMEDIARIO'] },
];

const COM_PARCELAS: ReadonlySet<FormaDaVenda> = new Set(['CHEQUE', 'BOLETO', 'CARTAO', 'OUTROS', 'FATURAR']);
const RECEBE_NA_AGENCIA: ReadonlySet<FormaDaVenda> = new Set(['DINHEIRO', 'CHEQUE', 'BOLETO', 'CARTAO', 'DEPOSITO', 'PIX', 'OUTROS', 'FATURAR']);

export function AbaPagamentos({
  venda, editavel, faltando, contasBancarias, clientes, onSalvarPagamento, onRemoverPagamento,
}: {
  venda: Venda;
  editavel: boolean;
  /** O que ainda não tem forma (centavos; negativo = passou do total). */
  faltando: number;
  contasBancarias: PessoaDaLista[];
  clientes: PessoaDaLista[];
  onSalvarPagamento: (p: PagamentoDaVenda) => void;
  onRemoverPagamento: (id: string) => void;
}) {
  const [aberto, setAberto] = React.useState<PagamentoDaVenda | null>(null);
  const [novo, setNovo] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const pode = usePermissoes();
  const podeEmitir = pode('gerar_boletos');
  const [emitir, setEmitir] = React.useState<ContaParaEmitir[] | null>(null);
  const [buscandoContas, setBuscandoContas] = React.useState(false);

  // "Emitir boletos" (E7): as contas a receber GRAVADAS desta venda, na mesma janela de Gerar boleto(s).
  async function abrirEmissao() {
    setBuscandoContas(true);
    try {
      const r = await fetch(`/api/vendas/completa/${encodeURIComponent(venda.id)}`);
      if (r.status === 404) { toast.info('Salve a venda primeiro', 'Os boletos saem das contas a receber que a venda gravou.'); return; }
      const corpo = (await r.json().catch(() => null)) as { contas_receber?: Array<Record<string, unknown>>; error?: string } | null;
      if (!r.ok) { toast.error('Não foi possível ler as contas da venda.', corpo?.error); return; }
      const contas = contasDaVendaParaCobrar(corpo?.contas_receber ?? [], hojeISO());
      if (!contas.length) { toast.info('Nenhuma conta a receber nesta venda', 'Inclua um pagamento (Boleto, Pix...) e salve: a conta nasce sozinha.'); return; }
      setEmitir(contas);
    } catch {
      toast.error('Sem resposta do servidor.', 'Nada foi emitido; tente de novo.');
    } finally {
      setBuscandoContas(false);
    }
  }

  React.useEffect(() => {
    if (!menu) return;
    const fora = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [menu]);

  function abrirNovo(forma: FormaDaVenda) {
    setMenu(false);
    setNovo(true);
    setAberto({
      id: novoIdDaVenda('pg'), forma, valor_centavos: Math.max(0, faltando), parcelas: 1, primeiro_vencimento: '', intervalo_dias: 0,
      pagante: null, fornecedor: null, conta_bancaria_id: null, cartao_tipo: forma === 'CARTAO' ? 'credito' : null, detalhe: '', venda_origem_credito: '',
    });
  }

  const colunas: FinColuna<PagamentoDaVenda>[] = [
    {
      id: 'forma', cabecalho: 'Forma', tipo: 'texto', minWidth: 200, acessor: p => FORMAS[p.forma].rotulo,
      render: p => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{FORMAS[p.forma].rotulo}{p.forma === 'CARTAO' ? ` (${p.cartao_tipo === 'debito' ? 'débito' : 'crédito'})` : ''}</span>
          <span className="truncate fin-t-caption text-[var(--fin-text-3)]">
            {[p.detalhe, textoDosCampos(p.campos)].filter(Boolean).join(' · ') || efeitoCurto(p, venda)}
            {taxaDoCartao(p) > 0 ? ` · taxa do cartão ${reais(taxaDoCartao(p))}` : ''}
          </span>
        </div>
      ),
    },
    { id: 'pagante', cabecalho: 'Pagante', tipo: 'texto', minWidth: 160, prioridade: 2, render: p => <span className="truncate">{p.pagante?.nome || venda.cliente.nome || 'Cliente da venda'}</span> },
    { id: 'parcelas', cabecalho: 'Parcelas', tipo: 'texto', minWidth: 80, prioridade: 1, render: p => <span className="tabular-nums">{p.parcelas}x</span> },
    { id: 'venc', cabecalho: '1º vencimento', tipo: 'data', valor: p => vencimentoDaParcela(p, venda.data_venda, 1) },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', minWidth: 120, valor: p => p.valor_centavos / 100 },
    ...(editavel ? [{
      id: 'acoes', cabecalho: '', tipo: 'acoes' as const,
      render: (p: PagamentoDaVenda) => (
        <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${FORMAS[p.forma].rotulo}`} onClick={e => { e.stopPropagation(); onRemoverPagamento(p.id); }}>
          <Trash2 aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />
        </Button>
      ),
    }] : []),
  ];

  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row sm:items-center sm:justify-between">
        <p className={cn('fin-t-body', faltando > 0 ? 'text-[var(--fin-warning-text)]' : faltando < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-2)]')} aria-live="polite">
          {faltando > 0 ? `Faltam ${reais(faltando)} sem forma de pagamento.`
            : faltando < 0 ? `Os pagamentos passam do total em ${reais(-faltando)}.`
              : venda.produtos.length ? 'Os pagamentos cobrem a venda inteira.' : 'Inclua os produtos primeiro: o total da venda vem deles.'}
        </p>
        <div className="flex flex-wrap items-center gap-[var(--fin-s-2)] self-end">
        {podeEmitir && venda.pagamentos.length ? (
          <Button type="button" variant="outline" disabled={buscandoContas} aria-busy={buscandoContas} onClick={() => { void abrirEmissao(); }}
            title="Boleto ou Pix pelo provedor da agência, para as contas a receber desta venda que ainda não têm cobrança">
            <ReceiptText aria-hidden="true" className="size-4" /> {buscandoContas ? 'Lendo as contas…' : 'Emitir boletos'}
          </Button>
        ) : null}
        {editavel ? (
          <div ref={menuRef} className="relative">
            <Button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
              Adicionar pagamento <ChevronDown aria-hidden="true" className="size-4" />
            </Button>
            {menu ? (
              <div role="menu" className="absolute right-0 z-[var(--fin-z-menu)] mt-1 w-[min(92vw,320px)] overflow-hidden rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] py-1 shadow-[var(--fin-e1)]">
                {GRUPOS.map(g => (
                  <div key={g.titulo} role="group" aria-label={g.titulo} className="border-b border-[var(--fin-border)] py-1 last:border-b-0">
                    <p className="px-3 py-1 fin-t-overline text-[var(--fin-text-3)]">{g.titulo}</p>
                    {g.formas.map(f => (
                      <button
                        key={f} type="button" role="menuitem" onClick={() => abrirNovo(f)}
                        className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-[var(--fin-surface-2)] focus-visible:bg-[var(--fin-surface-2)] focus-visible:outline-none"
                      >
                        <span className="fin-t-body text-[var(--fin-text)]">{FORMAS[f].rotulo}</span>
                        <span className="fin-t-caption text-[var(--fin-text-3)]">{FORMAS[f].ajuda}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>
      <FinTable
        linhas={venda.pagamentos}
        colunas={colunas}
        chave={p => p.id}
        estado="ok"
        densidade="compacta"
        totais={venda.pagamentos.length ? [{ colunaId: 'valor', valor: venda.pagamentos.reduce((a, p) => a + p.valor_centavos, 0) / 100, rotulo: 'Total' }] : undefined}
        onLinhaClick={p => { setNovo(false); setAberto(p); }}
        vazio={{
          motivo: 'sem-dado', titulo: 'Ainda sem forma de pagamento',
          oQueE: 'Sem forma escolhida, a venda inteira fica como uma conta a receber do cliente, um mês depois da venda. Diga como ele paga e as contas se ajustam sozinhas.',
          acao: editavel && venda.produtos.length ? { rotulo: 'Pix', onClick: () => abrirNovo('PIX') } : undefined,
          acaoSecundaria: editavel && venda.produtos.length ? { rotulo: 'Boleto', onClick: () => abrirNovo('BOLETO') } : undefined,
        }}
      />
      <EmitirCobrancas contas={emitir} onFechar={() => setEmitir(null)} onConcluido={() => { /* a janela mostra o resultado; a aba Cliente lê as contas de novo ao abrir */ }} />
      {aberto ? (
        <EditorDePagamento
          key={aberto.id} inicial={aberto} novo={novo} editavel={editavel} venda={venda}
          contasBancarias={contasBancarias} clientes={clientes}
          onFechar={() => setAberto(null)}
          onSalvar={p => { onSalvarPagamento(p); setAberto(null); }}
        />
      ) : null}
    </div>
  );
}

function efeitoCurto(p: PagamentoDaVenda, venda: Venda): string {
  switch (FORMAS[p.forma].efeito) {
    case 'faturar_ao_cliente': return 'Entra na fatura do cliente.';
    case 'credito_do_cliente': return 'Sai da carteira de crédito do cliente.';
    case 'abate_do_fornecedor': return `Abate o que a agência deve${p.fornecedor?.nome ? ` a ${p.fornecedor.nome}` : ' ao fornecedor'}.`;
    case 'receber_do_intermediario': return `A receber de ${venda.intermediario?.nome || 'intermediário não informado'}.`;
    default: return p.conta_bancaria_id ? 'Conta prevista escolhida.' : 'Conta a receber do pagante.';
  }
}

/** Fornecedores da venda (pessoa do acerto de cada produto), para os pagamentos que abatem. */
function fornecedoresDaVenda(venda: Venda): ParteDaVenda[] {
  const vistos = new Map<string, ParteDaVenda>();
  for (const p of venda.produtos) {
    const { chave, parte } = parteDoAcerto(p);
    if (parte) vistos.set(chave, parte);
  }
  return [...vistos.values()];
}

function EditorDePagamento({ inicial, novo, editavel, venda, contasBancarias, clientes, onFechar, onSalvar }: {
  inicial: PagamentoDaVenda; novo: boolean; editavel: boolean; venda: Venda; contasBancarias: PessoaDaLista[]; clientes: PessoaDaLista[];
  onFechar: () => void; onSalvar: (p: PagamentoDaVenda) => void;
}) {
  const [bruto, setP] = React.useState<PagamentoDaVenda>(inicial);
  const [sujo, setSujo] = React.useState(false);
  const mudar = (parcial: Partial<PagamentoDaVenda>) => { setP(x => ({ ...x, ...parcial })); setSujo(true); };
  const formasDaAgencia = useFormasDePagamento();
  // Cartão ainda sem taxa: a da forma de pagamento da agência (a gravação congela a mesma).
  const formaDoCartao = formasDaAgencia.find(f => f.codigo === (bruto.cartao_tipo === 'debito' ? 'CARTAO_DEBITO' : 'CARTAO_CREDITO'));
  const p: PagamentoDaVenda = taxaDoCartaoIndefinida(bruto) ? congelarTaxaDoCartao(bruto, formaDoCartao) : bruto;
  const mudarCampos = (parcial: CamposDaForma) => mudar({ campos: { ...(p.campos ?? {}), ...parcial } });
  const formasProprias = formasDaAgencia.filter(f => !f.sistema && f.ativo && f.uso !== 'pagar');
  const info = FORMAS[p.forma];
  const fornecedores = fornecedoresDaVenda(venda);
  const outros = venda.pagamentos.filter(x => x.id !== p.id).reduce((a, x) => a + x.valor_centavos, 0);

  // O que nasce: o gerador de verdade, sobre a venda com este pagamento.
  const simulada: Venda = { ...venda, pagamentos: [...venda.pagamentos.filter(x => x.id !== p.id), p] };
  const contas = contasDaVenda({ versao: 2, venda: simulada });
  const doPagamento = contas.contas_receber.filter(c => c.venda_pagamento_id === p.id);

  const erro = !(p.valor_centavos > 0) ? 'Informe um valor maior que zero.' : null;

  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={`Pagamento: ${info.rotulo}`}
      descricao={info.ajuda}
      largura={640}
      sujo={sujo}
      resumo={<ResumoDoQueNasce p={p} doPagamento={doPagamento} venda={venda} />}
      acaoPrimaria={editavel
        ? { rotulo: novo ? 'Incluir pagamento' : 'Guardar pagamento', desabilitado: !!erro, onClick: () => { const n = normalizarPagamento(p, 0); if (n) onSalvar(n); } }
        : { rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={editavel ? { rotulo: 'Cancelar', onClick: onFechar } : null}
    >
      <fieldset disabled={!editavel} className="flex min-w-0 flex-col gap-[var(--fin-s-4)]">
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className={ROTULO}>Valor</span>
            <CampoReais rotulo="Valor do pagamento" centavos={p.valor_centavos} onChange={v => mudar({ valor_centavos: v })} desabilitado={!editavel} />
            {erro ? <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erro}</p> : null}
            {editavel ? (() => {
              const falta = venda.produtos.length ? Math.max(0, valorACobrar(venda) - outros) : 0;
              return falta > 0 && falta !== p.valor_centavos ? (
                <button type="button" className="self-start fin-t-caption text-[var(--fin-accent)] underline-offset-2 hover:underline" onClick={() => mudar({ valor_centavos: falta })}>
                  Usar o que falta: {reais(falta)}
                </button>
              ) : null;
            })() : null}
          </div>
          {COM_PARCELAS.has(p.forma) ? (
            <Field rotulo="Parcelas">
              {a => <Input {...a} type="number" min={1} max={120} step={1} className={cn(CONTROLE, 'text-right tabular-nums')} value={String(p.parcelas)} onChange={e => mudar({ parcelas: Math.max(1, Math.min(120, Math.floor(Number(e.target.value) || 1))) })} />}
            </Field>
          ) : null}
          {p.forma === 'CARTAO' ? (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className={ROTULO}>Cartão</span>
              <Segmentado rotulo="Tipo do cartão" valor={p.cartao_tipo ?? 'credito'}
                onChange={v => mudar({ cartao_tipo: v, taxa_cartao_percentual: null, taxa_cartao_fixa_centavos: null, taxa_cartao_centavos: null, dias_para_cair: null })}
                opcoes={[{ valor: 'credito', rotulo: 'Crédito' }, { valor: 'debito', rotulo: 'Débito' }]} />
            </div>
          ) : null}
          {p.forma === 'CARTAO' ? <TaxaDoCartao p={p} forma={formaDoCartao ?? null} onMudar={mudar} /> : null}
          {p.forma === 'CARTAO' ? (
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:col-span-2 sm:grid-cols-3">
              <Field rotulo="Bandeira">
                {a => <Input {...a} className={CONTROLE} maxLength={40} placeholder="Ex.: Visa" value={p.campos?.bandeira ?? ''} onChange={e => mudarCampos({ bandeira: e.target.value })} />}
              </Field>
              <Field rotulo="Autorização">
                {a => <Input {...a} className={CONTROLE} maxLength={40} value={p.campos?.autorizacao ?? ''} onChange={e => mudarCampos({ autorizacao: e.target.value })} />}
              </Field>
              <Field rotulo="Final do cartão" ajuda="Só os 4 últimos números.">
                {a => <Input {...a} className={cn(CONTROLE, 'tabular-nums')} inputMode="numeric" maxLength={4} autoComplete="off" placeholder="0000" value={p.campos?.final_cartao ?? ''} onChange={e => mudarCampos({ final_cartao: e.target.value.replace(/\D/g, '').slice(0, 4) })} />}
              </Field>
            </div>
          ) : null}
          {p.forma === 'CHEQUE' ? (
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:col-span-2 sm:grid-cols-3">
              <Field rotulo="Banco">
                {a => <Input {...a} className={CONTROLE} maxLength={80} value={p.campos?.banco ?? ''} onChange={e => mudarCampos({ banco: e.target.value })} />}
              </Field>
              <Field rotulo="Número do 1º cheque">
                {a => <Input {...a} className={cn(CONTROLE, 'tabular-nums')} maxLength={40} value={p.campos?.numero_cheque ?? ''} onChange={e => mudarCampos({ numero_cheque: e.target.value })} />}
              </Field>
              <Field rotulo="CPF ou CNPJ do emitente">
                {a => <Input {...a} className={cn(CONTROLE, 'tabular-nums')} inputMode="numeric" maxLength={20} value={p.campos?.emitente_documento ?? ''} onChange={e => mudarCampos({ emitente_documento: e.target.value })} />}
              </Field>
            </div>
          ) : null}
          {p.forma === 'OUTROS' && formasProprias.length ? (
            <div className="sm:col-span-2">
              <Field rotulo="Forma combinada" ajuda="As formas próprias da agência (Formas de pagamento). O texto pronto dela entra na observação.">
                {a => (
                  <select {...a} className={SELECT} value={p.forma_agencia ?? ''} onChange={e => {
                    const f = formasProprias.find(x => x.codigo === e.target.value);
                    mudar({ forma_agencia: f?.codigo ?? '', ...(f?.informacoes && !p.detalhe ? { detalhe: f.informacoes.slice(0, 300) } : {}) });
                  }}>
                    <option value="">Outra, sem cadastro</option>
                    {formasProprias.map(f => <option key={f.codigo} value={f.codigo}>{f.nome}</option>)}
                  </select>
                )}
              </Field>
            </div>
          ) : null}
          {info.efeito !== 'abate_do_fornecedor' && info.efeito !== 'credito_do_cliente' ? (
            <Field rotulo="1º vencimento" ajuda={`Vazio: ${dataBR(vencimentoDaParcela({ ...p, primeiro_vencimento: '' }, venda.data_venda, 1))}.`}>
              {a => <Input {...a} type="date" className={CONTROLE} value={p.primeiro_vencimento} onChange={e => mudar({ primeiro_vencimento: e.target.value })} />}
            </Field>
          ) : null}
          {COM_PARCELAS.has(p.forma) && p.parcelas > 1 ? (
            <Field rotulo="Entre as parcelas" ajuda="Vazio ou zero: de mês em mês.">
              {a => <Input {...a} type="number" min={0} max={365} step={1} placeholder="Mensal" className={cn(CONTROLE, 'text-right tabular-nums')} value={p.intervalo_dias ? String(p.intervalo_dias) : ''} onChange={e => mudar({ intervalo_dias: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />}
            </Field>
          ) : null}
          {RECEBE_NA_AGENCIA.has(p.forma) || p.forma === 'CREDITO_CLIENTE' ? (
            <Field rotulo="Pagante" ajuda="Quem paga pode ser outra pessoa (empresa, parente).">
              {a => (
                <select {...a} className={SELECT} value={p.pagante?.id ?? ''} onChange={e => {
                  const c = clientes.find(x => x.id === e.target.value);
                  mudar({ pagante: c ? { id: c.id, nome: c.nome } : null });
                }}>
                  <option value="">{venda.cliente.nome || 'Cliente da venda'}</option>
                  {p.pagante && !clientes.some(x => x.id === p.pagante?.id) ? <option value={p.pagante.id}>{p.pagante.nome}</option> : null}
                  {clientes.filter(x => x.id !== venda.cliente.id).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              )}
            </Field>
          ) : null}
          {RECEBE_NA_AGENCIA.has(p.forma) && p.forma !== 'FATURAR' ? (
            <Field rotulo="Conta prevista" ajuda="Onde o dinheiro deve cair. Dá para mudar na baixa.">
              {a => (
                <select {...a} className={SELECT} value={p.conta_bancaria_id ?? ''} onChange={e => mudar({ conta_bancaria_id: e.target.value || null })}>
                  <option value="">Escolher na baixa</option>
                  {contasBancarias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              )}
            </Field>
          ) : null}
          {info.efeito === 'abate_do_fornecedor' ? (
            <Field rotulo="Fornecedor que recebeu" ajuda={fornecedores.length === 1 ? 'A venda tem um fornecedor só: é ele.' : 'Escolha para abater o que a agência deve a ele.'}>
              {a => (
                <select {...a} className={SELECT} value={p.fornecedor?.id || p.fornecedor?.nome || ''} onChange={e => {
                  const f = fornecedores.find(x => (x.id || x.nome) === e.target.value);
                  mudar({ fornecedor: f ?? null });
                }}>
                  <option value="">{fornecedores.length === 1 ? fornecedores[0].nome : 'Escolha…'}</option>
                  {fornecedores.map(f => <option key={f.id || f.nome} value={f.id || f.nome}>{f.nome}</option>)}
                </select>
              )}
            </Field>
          ) : null}
          {p.forma === 'CREDITO_CLIENTE' || p.forma === 'CREDITO_FORNECEDOR' ? (
            <Field rotulo="Venda que originou o crédito" ajuda="Opcional. Ajuda a rastrear de onde veio.">
              {a => <Input {...a} className={CONTROLE} maxLength={80} placeholder="Ex.: VND-0042" value={p.venda_origem_credito} onChange={e => mudar({ venda_origem_credito: e.target.value })} />}
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <Field rotulo="Observação" ajuda={p.forma === 'CARTAO' ? 'Nunca digite o número do cartão: o sistema não guarda.' : undefined}>
              {a => <Input {...a} className={CONTROLE} maxLength={300} value={p.detalhe} onChange={e => mudar({ detalhe: e.target.value })} />}
            </Field>
          </div>
        </div>
      </fieldset>
    </RecordSheet>
  );
}

function valorACobrar(venda: Venda): number {
  const c = contasDaVenda({ versao: 2, venda: { ...venda, pagamentos: [] } });
  return c.contas_receber.filter(x => x.origem === 'VENDA').reduce((a, x) => a + Math.round(x.valor_final * 100), 0);
}

function ResumoDoQueNasce({ p, doPagamento, venda }: { p: PagamentoDaVenda; doPagamento: Array<{ valor_final: number; data_vencimento: string }>; venda: Venda }) {
  const info = FORMAS[p.forma];
  let texto: React.ReactNode;
  if (info.efeito === 'receber_do_cliente' || info.efeito === 'faturar_ao_cliente') {
    texto = doPagamento.length === 0 ? 'Nenhuma conta: informe o valor.'
      : <>Nasce{doPagamento.length > 1 ? 'm' : ''} <strong className="text-[var(--fin-text)]">{doPagamento.length} conta{doPagamento.length > 1 ? 's' : ''} a receber</strong>: {doPagamento.slice(0, 4).map(c => `${reais(Math.round(c.valor_final * 100))} em ${dataBR(c.data_vencimento)}`).join(', ')}{doPagamento.length > 4 ? '…' : ''}{info.efeito === 'faturar_ao_cliente' ? ', marcada para a fatura do cliente' : ''}.</>;
  } else if (info.efeito === 'credito_do_cliente') {
    texto = <>Nenhuma conta. {reais(p.valor_centavos)} saem do crédito de {p.pagante?.nome || venda.cliente.nome || 'cliente'}, como pendência para a carteira de crédito.</>;
  } else if (info.efeito === 'abate_do_fornecedor') {
    texto = <>Nenhuma conta a receber. O que a agência deve{p.fornecedor?.nome ? ` a ${p.fornecedor.nome}` : ''} cai {reais(p.valor_centavos)}; se passar do que ela deve, vira comissão a receber dele.</>;
  } else {
    texto = <>Nasce uma conta a receber de {venda.intermediario?.nome || 'intermediário (diga quem é na aba Cliente)'}, já descontado o repasse que cabe a ele.</>;
  }
  return <span className="fin-t-caption text-[var(--fin-text-2)]">{texto}</span>;
}

/**
 * Taxa do cartão que a agência recebe (E7): vem da forma de pagamento da
 * agência e fica guardada na venda. É custo da agência: sai da receita e
 * não muda o que o cliente paga.
 */
function TaxaDoCartao({ p, forma, onMudar }: { p: PagamentoDaVenda; forma: FormaPagamento | null; onMudar: (x: Partial<PagamentoDaVenda>) => void }) {
  const taxa = taxaDoCartao(p);
  const pct = p.taxa_cartao_percentual ?? 0;
  const fixa = p.taxa_cartao_fixa_centavos ?? 0;
  return (
    <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-[var(--fin-s-3)] sm:col-span-2">
      <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
        <Field rotulo="Taxa da operadora (%)">
          {a => (
            <Input {...a} type="number" inputMode="decimal" min={0} max={99.99} step="0.01" className={cn(CONTROLE, 'text-right tabular-nums')}
              value={String(pct)} onChange={e => onMudar({ taxa_cartao_percentual: Math.max(0, Math.min(99.99, Number(e.target.value.replace(',', '.')) || 0)), taxa_cartao_fixa_centavos: fixa, taxa_cartao_centavos: null })} />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <span className={ROTULO}>Fixa por operação</span>
          <CampoReais rotulo="Taxa fixa por operação" centavos={fixa} onChange={v => onMudar({ taxa_cartao_fixa_centavos: v, taxa_cartao_percentual: pct, taxa_cartao_centavos: null })} />
        </div>
        <Field rotulo="Dias para cair" ajuda="Vazio: 1º vencimento um mês depois.">
          {a => (
            <Input {...a} type="number" inputMode="numeric" min={0} max={365} step={1} placeholder="—" className={cn(CONTROLE, 'text-right tabular-nums')}
              value={p.dias_para_cair ? String(p.dias_para_cair) : ''} onChange={e => onMudar({ dias_para_cair: e.target.value === '' ? null : Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0))) })} />
          )}
        </Field>
      </div>
      <p className="fin-t-caption text-[var(--fin-text-2)]" aria-live="polite">
        {taxa > 0
          ? <>A operadora fica com <strong className="tabular-nums text-[var(--fin-text)]">{reais(taxa)}</strong>: sai da receita da agência; o cliente paga o mesmo.</>
          : 'Sem taxa: a agência recebe o valor inteiro.'}
        {forma ? ` Padrão da agência: ${(forma.taxa_pct || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%${forma.taxa_fixa ? ` + ${reais(Math.round(forma.taxa_fixa * 100))}` : ''}${forma.dias_para_cair ? `, cai em ${forma.dias_para_cair} dias` : ''}.` : ''}
      </p>
    </div>
  );
}
