'use client';

/**
 * Ficha da venda completa (E5, parte A).
 *
 * Uma tela só para a venda lançada à mão (/vendas/lancar) e para a que veio
 * do CRM (/vendas/[id]/ficha): abas Produtos, Pagamentos, Cliente,
 * Fornecedor, Comissões e Posição; totais da venda sempre à vista; Fechar e
 * Reabrir com direito e motivo. As contas nascem e se refazem sozinhas ao
 * salvar; o que já foi baixado ou cobrado fica como está.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, LockOpen, ShoppingBag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { loadEntities } from '@/lib/crm-storage';
import { hojeISO } from '@/lib/money';
import { normalizarVenda, totaisDaVenda, totaisDoProduto, type PagamentoDaVenda, type Venda } from '@/lib/venda-modelo';
import { receitaDaVenda, CONFIG_RECEITA_PADRAO, type ConfigReceita } from '@/lib/venda-receita';
import type { FichaDaVenda as Ficha } from '@/lib/venda-rota';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { AbaProdutos, type PessoaDaLista } from './AbaProdutos';
import { AbaPagamentos } from './AbaPagamentos';
import { AbaCliente, AbaComissoes, AbaFornecedor, AbaPosicao } from './AbasDoFinanceiro';
import { CancelamentoDaVenda } from './CancelamentoDaVenda';
import { NotasERetencoes } from './NotasERetencoes';
import { CONTROLE, dataBR, LINK, Pilula, quandoBR, reais, SELECT, Total } from './comum';
import { CampoEmpresa, useEmpresaSugerida } from '@/components/fin/CamposDeEmpresa';
import { useEmpresas } from '@/components/fin/useEmpresas';

type Aba = 'produtos' | 'pagamentos' | 'cliente' | 'fornecedor' | 'comissoes' | 'posicao';
const ABAS: ReadonlyArray<{ id: Aba; rotulo: string; soDaVendaGravada?: boolean }> = [
  { id: 'produtos', rotulo: 'Produtos' },
  { id: 'pagamentos', rotulo: 'Pagamentos' },
  { id: 'cliente', rotulo: 'Cliente', soDaVendaGravada: true },
  { id: 'fornecedor', rotulo: 'Fornecedor', soDaVendaGravada: true },
  { id: 'comissoes', rotulo: 'Comissões', soDaVendaGravada: true },
  { id: 'posicao', rotulo: 'Posição', soDaVendaGravada: true },
];

class ErroDaTela extends Error {
  constructor(public codigo: string, mensagem: string, public detalhes?: Record<string, unknown>) { super(mensagem); }
}

async function chamar<T>(url: string, metodo: 'GET' | 'POST' | 'PUT', corpo?: unknown): Promise<T> {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroDaTela(String(j?.codigo ?? r.status), String(j?.error ?? 'Não deu certo. Tente de novo.'), j?.detalhes);
  return j as T;
}

function vendaVazia(): Venda {
  return normalizarVenda({ data_venda: hojeISO(), cliente: { id: '', nome: '' } }).venda;
}

export function FichaDaVenda({ vendaId }: { vendaId?: string }) {
  const router = useRouter();
  const nova = !vendaId;
  const [ficha, setFicha] = React.useState<Ficha | null>(null);
  const [rascunho, setRascunho] = React.useState<Venda | null>(nova ? vendaVazia() : null);
  const [config, setConfig] = React.useState<ConfigReceita>(CONFIG_RECEITA_PADRAO);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>(nova ? 'ok' : 'carregando');
  const [erroCarga, setErroCarga] = React.useState<string | null>(null);
  const [sujo, setSujo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [aba, setAba] = React.useState<Aba>('produtos');
  const [clientes, setClientes] = React.useState<PessoaDaLista[]>([]);
  const [fornecedores, setFornecedores] = React.useState<PessoaDaLista[]>([]);
  const [contas, setContas] = React.useState<PessoaDaLista[]>([]);
  const [fechar, setFechar] = React.useState<null | 'perguntar' | { confirmar: string[] }>(null);
  const [reabrir, setReabrir] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [motivo, setMotivo] = React.useState('');
  const [processando, setProcessando] = React.useState(false);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  // Várias empresas (E7): a empresa da venda (o campo só aparece com 2+ empresas).
  const empresaSugerida = useEmpresaSugerida();
  const { multi: variasEmpresas } = useEmpresas();
  const [empresaId, setEmpresaId] = React.useState<string | undefined>(undefined);

  const carregar = React.useCallback(async () => {
    if (!vendaId) return;
    setEstado('carregando');
    try {
      const f = await chamar<Ficha>(`/api/vendas/completa/${encodeURIComponent(vendaId)}`, 'GET');
      setFicha(f);
      setRascunho(f.venda);
      setConfig(f.config_receita);
      setEmpresaId(f.empresa_id ?? 'principal');
      setSujo(false);
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErroCarga(e instanceof Error ? e.message : 'Não foi possível abrir a venda.');
      setEstado('erro');
    }
  }, [vendaId]);

  React.useEffect(() => { void carregar(); }, [carregar]);
  React.useEffect(() => {
    if (!nova) return;
    void chamar<{ receita: ConfigReceita }>('/api/config/vendas', 'GET').then(c => setConfig(c.receita)).catch(() => undefined);
  }, [nova]);

  const podeEditar = nova || (ficha?.permissoes.editar ?? false);
  const aberta = nova || ficha?.situacao !== 'FECHADA';
  const editavel = podeEditar && aberta;

  // Listas para os seletores: só quando dá para editar.
  React.useEffect(() => {
    if (!editavel) return;
    void Promise.all([
      loadEntities<{ id: string; nome: string }>('clientes'),
      loadEntities<{ id: string; nome_fantasia?: string; razao_social?: string }>('fornecedores-crm'),
      loadEntities<{ id: string; nome: string; ativo?: boolean }>('contas-bancarias'),
    ]).then(([cs, fs, bs]) => {
      setClientes(cs.map(c => ({ id: c.id, nome: c.nome || 'Cliente sem nome' })).sort((a, b) => a.nome.localeCompare(b.nome)));
      setFornecedores(fs.map(f => ({ id: f.id, nome: f.nome_fantasia || f.razao_social || 'Fornecedor sem nome' })).sort((a, b) => a.nome.localeCompare(b.nome)));
      setContas(bs.filter(b => b.ativo !== false).map(b => ({ id: b.id, nome: b.nome })));
    });
  }, [editavel]);

  const mudar = (parcial: Partial<Venda>) => { setRascunho(v => (v ? { ...v, ...parcial } : v)); setSujo(true); };
  const atualizarFicha = (f: Ficha) => { setFicha(f); setRascunho(f.venda); setSujo(false); setAtualizadoEm(new Date()); };

  async function salvar() {
    if (!rascunho) return;
    if (!rascunho.cliente.id) { toast.error('Escolha o cliente da venda', 'A venda precisa de um cliente cadastrado para as contas a receber.'); return; }
    if (!rascunho.produtos.length) { toast.error('Inclua ao menos um produto', 'O total da venda vem dos produtos.'); setAba('produtos'); return; }
    setSalvando(true);
    try {
      // A empresa só vai quando a agência tem mais de uma (o campo existe).
      const empresa = variasEmpresas ? empresaId ?? (nova ? empresaSugerida : undefined) : undefined;
      const corpo = { venda: rascunho, ...(empresa ? { empresa_id: empresa } : {}) };
      const f = nova
        ? await chamar<Ficha>('/api/vendas/completa', 'POST', corpo)
        : await chamar<Ficha>(`/api/vendas/completa/${encodeURIComponent(vendaId!)}`, 'PUT', corpo);
      const contasDoEvento = (f.eventos[0]?.detalhe?.contas ?? {}) as { criadas?: number; atualizadas?: number; removidas?: number; preservadas?: number };
      toast.success(nova ? `Venda ${f.venda.numero} lançada` : 'Venda salva',
        `Contas: ${contasDoEvento.criadas ?? 0} criadas, ${contasDoEvento.atualizadas ?? 0} atualizadas, ${contasDoEvento.removidas ?? 0} removidas${contasDoEvento.preservadas ? `, ${contasDoEvento.preservadas} já baixadas mantidas` : ''}.`);
      if (nova) { router.push(`/vendas/${encodeURIComponent(f.venda.id)}/ficha`); return; }
      setFicha(f); setRascunho(f.venda); setSujo(false); setAtualizadoEm(new Date());
    } catch (e) {
      toast.error('A venda não foi salva', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarFechamento(confirmar: boolean) {
    if (!vendaId) return;
    setProcessando(true);
    try {
      const f = await chamar<Ficha>(`/api/vendas/completa/${encodeURIComponent(vendaId)}/fechar`, 'POST', { confirmar });
      setFicha(f); setRascunho(f.venda); setFechar(null);
      toast.success('Venda fechada', 'Produtos e pagamentos não mudam mais. As contas seguem sendo baixadas normalmente.');
    } catch (e) {
      if (e instanceof ErroDaTela && e.codigo === 'CONFIRMAR') {
        const lista = ((e.detalhes?.confirmar ?? []) as Array<{ mensagem: string }>).map(x => x.mensagem);
        setFechar({ confirmar: lista });
      } else {
        setFechar(null);
        toast.error('A venda não foi fechada', e instanceof Error ? e.message : undefined);
      }
    } finally {
      setProcessando(false);
    }
  }

  async function confirmarReabertura() {
    if (!vendaId) return;
    if (motivo.trim().length < 10) { toast.error('Diga o motivo', 'Pelo menos 10 letras: fica no histórico da venda.'); return; }
    setProcessando(true);
    try {
      const f = await chamar<Ficha>(`/api/vendas/completa/${encodeURIComponent(vendaId)}/reabrir`, 'POST', { motivo });
      setFicha(f); setRascunho(f.venda); setReabrir(false); setMotivo('');
      toast.success('Venda reaberta', 'Dá para mudar produtos e pagamentos. As contas já baixadas ficam como estão.');
    } catch (e) {
      toast.error('A venda não foi reaberta', e instanceof Error ? e.message : undefined);
    } finally {
      setProcessando(false);
    }
  }

  const venda = rascunho;
  const totais = venda ? totaisDaVenda(venda) : null;
  const receita = venda ? receitaDaVenda(venda, config) : null;
  const verReceita = nova || (ficha?.permissoes.ver_receita ?? false);
  const titulo = nova ? 'Lançar venda' : venda ? `Venda ${venda.numero || ''}`.trim() : 'Venda';
  const fechada = !nova && ficha?.situacao === 'FECHADA';

  const acaoPrimaria = nova || !ficha ? undefined
    : fechada
      ? (ficha.permissoes.reabrir ? { rotulo: 'Reabrir venda', icone: LockOpen, onClick: () => setReabrir(true) } : undefined)
      : (ficha.permissoes.fechar ? { rotulo: 'Fechar venda', icone: Lock, onClick: () => (sujo ? toast.warning('Salve antes de fechar', 'Há mudanças que ainda não foram salvas.') : setFechar('perguntar')) } : undefined);

  const abasVisiveis = ABAS.filter(a => !(nova && a.soDaVendaGravada));

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)] pb-24">
        <PageHeader
          icone={ShoppingBag}
          titulo={titulo}
          subtitulo={nova
            ? 'Produtos, passageiros, componentes de receita e como o cliente paga. As contas nascem sozinhas ao salvar.'
            : venda ? `${venda.cliente.nome || 'Cliente'} · ${dataBR(venda.data_venda)} · ${venda.origem === 'crm' ? 'recebida do CRM' : 'lançada no financeiro'}` : undefined}
          badge={!nova && ficha ? (
            <Pilula tom={fechada ? 'neutro' : 'positivo'}>{fechada ? <><Lock aria-hidden="true" className="size-3" /> Fechada</> : 'Aberta'}</Pilula>
          ) : undefined}
          acaoPrimaria={acaoPrimaria}
          acoesSecundarias={!nova && vendaId ? [
            ...(ficha && ficha.versao_modelo === 2 && ficha.permissoes.cancelar && ficha.venda.produtos.some(p => !p.cancelado_em || p.passageiros.some(x => x.cancelado_em))
              ? [{ rotulo: ficha.venda.produtos.some(p => !p.cancelado_em) ? 'Cancelar produto ou passageiro' : 'Cancelamentos da venda', onClick: () => (sujo ? toast.warning('Salve antes de cancelar', 'Há mudanças que ainda não foram salvas.') : setCancelando(true)) }]
              : []),
            { rotulo: 'Recibo', href: `/vendas/${encodeURIComponent(vendaId)}/recibo` },
            ...(ficha?.link_crm ? [{ rotulo: 'Contrato e voucher no CRM', href: ficha.link_crm }] : []),
            { rotulo: 'Nota de débito', href: `/vendas/${encodeURIComponent(vendaId)}/nota-de-debito` },
            { rotulo: 'Ver na tela anterior', href: `/vendas/${encodeURIComponent(vendaId)}` },
          ] : undefined}
          atualizadoEm={nova ? undefined : atualizadoEm}
          onRecarregar={nova ? undefined : carregar}
        />

        <DataState
          estado={estado}
          erro={erroCarga ? { mensagem: erroCarga, onTentarDeNovo: () => { void carregar(); } } : null}
          esqueleto={<div className="flex flex-col gap-[var(--fin-s-3)]"><div className="h-20 rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" /><div className="h-72 rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" /></div>}
        >
          {venda && totais && receita ? (
            <div className="flex flex-col gap-[var(--fin-s-4)]">
              {fechada && ficha ? (
                <p className="flex items-center gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
                  <Lock aria-hidden="true" className="size-4 shrink-0" />
                  Fechada em {quandoBR(ficha.fechada_em)}{ficha.fechada_por ? ` por ${ficha.fechada_por}` : ''}. Produtos e pagamentos não mudam, nem pelo CRM; as contas seguem sendo baixadas normalmente.
                </p>
              ) : null}
              {!nova && ficha?.versao_modelo === 1 && editavel ? (
                <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-info-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-info)]">
                  Esta venda veio no formato anterior (um valor por fornecedor). Ao salvar aqui, ela passa a ter produtos, passageiros e pagamentos por forma; as contas já recebidas ou pagas ficam como estão e o resto se ajusta.
                </p>
              ) : null}

              {editavel && variasEmpresas ? (
                <div className="max-w-sm">
                  <CampoEmpresa
                    valor={empresaId ?? empresaSugerida}
                    onChange={e => { setEmpresaId(e); setSujo(true); }}
                    ajuda="Os títulos da venda nascem nesta empresa. Trocar leva junto os que ainda estão em aberto."
                  />
                </div>
              ) : null}
              <DadosDaVenda venda={venda} editavel={editavel} clientes={clientes} intermediarios={fornecedores} onMudar={mudar} />

              <dl aria-label="Totais da venda" className="grid grid-cols-2 gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)] sm:grid-cols-3 lg:grid-cols-6">
                <Total rotulo="Produtos" valor={reais(tarifasDa(venda) + totais.componentes.MARKUP)} dica="Tarifas dos produtos (com o markup embutido)." />
                <Total rotulo="Taxas" valor={reais(taxasDa(venda) + totais.componentes.TAXA_DU + totais.componentes.RAV + totais.componentes.FEE)} dica="Taxas de embarque e outras, Taxa DU, RAV e Fee." />
                <Total rotulo="Descontos" valor={reais(totais.componentes.DESCONTO)} />
                {verReceita ? <Total rotulo="Receitas" valor={reais(receita.receita)} tom={receita.receita < 0 ? 'negativo' : 'positivo'} dica={`${receita.percentual.toLocaleString('pt-BR')}% do total`} /> : <div aria-hidden="true" />}
                <Total rotulo="Venda (total)" valor={reais(totais.valor_cliente)} destaque />
                <Total rotulo="Sem forma de pagamento" valor={reais(Math.max(0, totais.saldo_sem_forma))} tom={totais.saldo_sem_forma !== 0 && venda.pagamentos.length ? 'aviso' : 'neutro'} dica="O que nenhuma forma de pagamento cobre ainda." />
              </dl>

              {!nova && ficha?.posicao?.alertas.some(a => a.tipo === 'FORNECEDOR_PAGO_ANTES' || a.tipo === 'FORNECEDOR_VENCE_ANTES') ? (
                <button type="button" onClick={() => setAba('posicao')}
                  className="self-start rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-left fin-t-body text-[var(--fin-warning-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]">
                  {ficha.posicao.alertas.find(a => a.tipo === 'FORNECEDOR_PAGO_ANTES' || a.tipo === 'FORNECEDOR_VENCE_ANTES')?.mensagem} Ver a posição.
                </button>
              ) : null}

              <div role="tablist" aria-label="Partes da venda" className="flex gap-1 overflow-x-auto border-b border-[var(--fin-border)]">
                {abasVisiveis.map(a => {
                  const ativa = aba === a.id;
                  const contagem = a.id === 'produtos' ? venda.produtos.length : a.id === 'pagamentos' ? venda.pagamentos.length : undefined;
                  return (
                    <button
                      key={a.id} type="button" role="tab" id={`aba-${a.id}`} aria-selected={ativa} aria-controls={`painel-${a.id}`} tabIndex={ativa ? 0 : -1}
                      onClick={() => setAba(a.id)}
                      onKeyDown={e => {
                        const i = abasVisiveis.findIndex(x => x.id === a.id);
                        const passo = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                        if (!passo) return;
                        e.preventDefault();
                        const prox = abasVisiveis[(i + passo + abasVisiveis.length) % abasVisiveis.length];
                        setAba(prox.id);
                        document.getElementById(`aba-${prox.id}`)?.focus();
                      }}
                      className={cn(
                        '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 fin-t-body transition-colors duration-[var(--fin-dur-rapida)]',
                        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--fin-accent)]',
                        ativa ? 'border-[var(--fin-accent)] font-medium text-[var(--fin-text)]' : 'border-transparent text-[var(--fin-text-2)] hover:text-[var(--fin-text)]',
                      )}
                    >
                      {a.rotulo}
                      {contagem !== undefined ? <span className="ml-1.5 tabular-nums text-[var(--fin-text-3)]">{contagem}</span> : null}
                    </button>
                  );
                })}
              </div>

              <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
                {aba === 'produtos' ? (
                  <AbaProdutos
                    produtos={venda.produtos} removidos={venda.produtos_removidos ?? []} editavel={editavel} verReceita={verReceita} fornecedores={fornecedores}
                    onSalvarProduto={p => mudar({ produtos: substituir(venda.produtos, p).map((x, i) => ({ ...x, sequencia: i + 1 })) })}
                    onRemoverProduto={id => {
                      const saiu = venda.produtos.find(x => x.id === id);
                      mudar({
                        produtos: venda.produtos.filter(x => x.id !== id).map((x, i) => ({ ...x, sequencia: i + 1 })),
                        produtos_removidos: saiu ? [...(venda.produtos_removidos ?? []), saiu] : venda.produtos_removidos,
                      });
                      if (saiu) toast.info('Produto removido', 'Ele fica guardado em "produtos removidos" e dá para restaurar. As contas se refazem ao salvar.');
                    }}
                    onRestaurarProduto={id => {
                      const volta = (venda.produtos_removidos ?? []).find(x => x.id === id);
                      if (!volta) return;
                      mudar({
                        produtos: [...venda.produtos, volta].map((x, i) => ({ ...x, sequencia: i + 1 })),
                        produtos_removidos: (venda.produtos_removidos ?? []).filter(x => x.id !== id),
                      });
                    }}
                  />
                ) : aba === 'pagamentos' ? (
                  <AbaPagamentos
                    venda={venda} editavel={editavel} faltando={totais.saldo_sem_forma} contasBancarias={contas} clientes={clientes}
                    onSalvarPagamento={p => mudar({ pagamentos: substituir<PagamentoDaVenda>(venda.pagamentos, p) })}
                    onRemoverPagamento={id => mudar({ pagamentos: venda.pagamentos.filter(x => x.id !== id) })}
                  />
                ) : ficha && sujo ? (
                  <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-warning-text)]">
                    Há mudanças ainda não salvas. Esta aba mostra a venda como está gravada.
                  </p>
                ) : null}
                {ficha && aba === 'cliente' ? (
                  <div className="mt-[var(--fin-s-3)] flex flex-col gap-[var(--fin-s-4)]">
                    <AbaCliente ficha={ficha} podeLancar={podeEditar && !sujo} onAtualizada={atualizarFicha} />
                    {ficha.permissoes.ver_financeiro && vendaId ? <NotasERetencoes vendaId={vendaId} /> : null}
                  </div>
                ) : null}
                {ficha && aba === 'fornecedor' ? <div className="mt-[var(--fin-s-3)]"><AbaFornecedor ficha={ficha} podeLancar={podeEditar && !sujo} onAtualizada={atualizarFicha} /></div> : null}
                {ficha && aba === 'comissoes' ? <div className="mt-[var(--fin-s-3)]"><AbaComissoes ficha={ficha} /></div> : null}
                {ficha && aba === 'posicao' ? <div className="mt-[var(--fin-s-3)]"><AbaPosicao ficha={ficha} /></div> : null}
              </div>
            </div>
          ) : null}
        </DataState>
      </div>

      {editavel && (sujo || nova) ? (
        <div className="fixed inset-x-0 bottom-0 z-[var(--fin-z-cabecalho)] border-t border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e1)]">
          <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-2)] px-[var(--fin-page-pad)] py-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
            <p className="fin-t-caption text-[var(--fin-text-2)]" aria-live="polite">
              {nova ? 'As contas a receber e a pagar nascem quando você salvar.' : 'Mudanças não salvas. Ao salvar, as contas em aberto se ajustam; as recebidas, pagas ou com cobrança emitida ficam como estão.'}
            </p>
            <div className="flex gap-[var(--fin-s-2)]">
              {!nova ? <Button type="button" variant="ghost" disabled={salvando} onClick={() => { if (ficha) { setRascunho(ficha.venda); setSujo(false); } }}>Desfazer</Button> : <Button type="button" variant="ghost" onClick={() => router.push('/vendas')}>Cancelar</Button>}
              <Button type="button" onClick={() => { void salvar(); }} disabled={salvando}>{salvando ? 'Salvando…' : nova ? 'Lançar venda' : 'Salvar venda'}</Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        aberto={fechar !== null}
        onOpenChange={a => { if (!a) setFechar(null); }}
        titulo={fechar && typeof fechar === 'object' ? 'Fechar mesmo assim?' : 'Fechar a venda'}
        oQueVaiAcontecer={fechar && typeof fechar === 'object'
          ? 'A venda fecha com estes pontos. Dá para reabrir depois, com motivo.'
          : 'Produtos e pagamentos param de mudar, inclusive pelo CRM. As contas continuam sendo recebidas e pagas normalmente. Para mudar depois, alguém com o direito reabre a venda dizendo o motivo.'}
        detalhes={venda && totais ? [
          { rotulo: 'Total da venda', valor: reais(totais.valor_cliente) },
          ...(verReceita && receita ? [{ rotulo: 'Receita', valor: reais(receita.receita) }] : []),
        ] : undefined}
        previa={fechar && typeof fechar === 'object' ? (
          <ul className="list-disc pl-5 fin-t-body text-[var(--fin-warning-text)]">{fechar.confirmar.map(m => <li key={m}>{m}</li>)}</ul>
        ) : undefined}
        confirmarRotulo={fechar && typeof fechar === 'object' ? 'Fechar mesmo assim' : 'Fechar venda'}
        processando={processando}
        onConfirmar={() => confirmarFechamento(!!(fechar && typeof fechar === 'object'))}
      />
      {ficha && ficha.versao_modelo === 2 ? (
        <CancelamentoDaVenda
          ficha={ficha}
          aberto={cancelando}
          onFechar={() => setCancelando(false)}
          onConcluido={f => { setFicha(f); setRascunho(f.venda); setSujo(false); setCancelando(false); setAtualizadoEm(new Date()); }}
        />
      ) : null}
      <ConfirmDialog
        aberto={reabrir}
        onOpenChange={a => { if (!a) { setReabrir(false); setMotivo(''); } }}
        titulo="Reabrir a venda"
        oQueVaiAcontecer="A venda volta a aceitar mudanças. Nenhuma conta é apagada: as recebidas e pagas ficam como estão. O motivo fica no histórico da venda."
        previa={
          <Field rotulo="Motivo" obrigatorio ajuda="Pelo menos 10 letras.">
            {a => <Textarea {...a} value={motivo} maxLength={500} onChange={e => setMotivo(e.target.value)} className="min-h-20 fin-t-body" placeholder="Ex.: cliente trocou a data do hotel" />}
          </Field>
        }
        confirmarRotulo="Reabrir venda"
        processando={processando}
        onConfirmar={confirmarReabertura}
      />
    </div>
  );
}

function substituir<T extends { id: string }>(lista: T[], item: T): T[] {
  return lista.some(x => x.id === item.id) ? lista.map(x => (x.id === item.id ? item : x)) : [...lista, item];
}

/** Tarifas dos produtos ativos, em centavos de real. */
function tarifasDa(v: Venda): number {
  return v.produtos.reduce((a, p) => a + totaisDoProduto(p).brl.tarifa, 0);
}

/** Taxas de embarque e outras (já em centavos de real). */
function taxasDa(v: Venda): number {
  let t = 0;
  for (const p of v.produtos) {
    if (p.cancelado_em) continue;
    const taxas = p.passageiros.length
      ? p.passageiros.filter(x => !x.cancelado_em).reduce((a, x) => a + x.taxas_centavos + x.outras_taxas_centavos, 0)
      : p.taxas_centavos;
    t += p.moeda === 'BRL' ? taxas : Math.round(taxas * p.cambio);
  }
  return t;
}

function DadosDaVenda({ venda, editavel, clientes, intermediarios, onMudar }: {
  venda: Venda; editavel: boolean; clientes: PessoaDaLista[]; intermediarios: PessoaDaLista[]; onMudar: (p: Partial<Venda>) => void;
}) {
  const [busca, setBusca] = React.useState(venda.cliente.nome);
  React.useEffect(() => { setBusca(venda.cliente.nome); }, [venda.cliente.nome]);
  if (!editavel) {
    return (
      <dl className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-4">
        <Total rotulo="Cliente" valor={venda.cliente.nome || '—'} />
        <Total rotulo="Data da venda" valor={dataBR(venda.data_venda)} />
        <Total rotulo="Intermediário" valor={venda.intermediario?.nome || '—'} />
        <Total rotulo="Centro de custo" valor={venda.centro_custo || '—'} />
        {venda.operacao_propria ? <Total rotulo="Operação" valor="Própria da agência" /> : null}
      </dl>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-4">
      <Field rotulo="Cliente" obrigatorio ajuda={venda.cliente.id ? undefined : 'Escolha um cliente cadastrado na lista.'}>
        {a => (
          <>
            <Input
              {...a} list="clientes-da-venda" className={CONTROLE} value={busca} autoComplete="off" placeholder="Nome do cliente"
              onChange={e => {
                setBusca(e.target.value);
                const c = clientes.find(x => x.nome.toLowerCase() === e.target.value.trim().toLowerCase());
                onMudar({ cliente: c ? { id: c.id, nome: c.nome } : { id: '', nome: e.target.value } });
              }}
            />
            <datalist id="clientes-da-venda">{clientes.slice(0, 2000).map(c => <option key={c.id} value={c.nome} />)}</datalist>
          </>
        )}
      </Field>
      <Field rotulo="Data da venda" obrigatorio>
        {a => <Input {...a} type="date" className={CONTROLE} value={venda.data_venda} onChange={e => onMudar({ data_venda: e.target.value })} />}
      </Field>
      <Field rotulo="Intermediário" ajuda="Quem trouxe a venda e recebe o repasse.">
        {a => (
          <select {...a} className={SELECT} value={venda.intermediario?.id ?? ''} onChange={e => {
            const f = intermediarios.find(x => x.id === e.target.value);
            onMudar({ intermediario: f ? { id: f.id, nome: f.nome } : null });
          }}>
            <option value="">Nenhum</option>
            {venda.intermediario && !intermediarios.some(x => x.id === venda.intermediario?.id) ? <option value={venda.intermediario.id}>{venda.intermediario.nome}</option> : null}
            {intermediarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        )}
      </Field>
      <Field rotulo="Centro de custo">
        {a => <Input {...a} className={CONTROLE} value={venda.centro_custo} maxLength={120} onChange={e => onMudar({ centro_custo: e.target.value })} />}
      </Field>
      <label className="flex cursor-pointer items-start gap-[var(--fin-s-2)] sm:col-span-2 lg:col-span-4">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]" checked={venda.operacao_propria === true}
          onChange={e => onMudar({ operacao_propria: e.target.checked })} />
        <span className="flex flex-col gap-0.5">
          <span className="fin-t-body text-[var(--fin-text)]">Operação própria</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">A agência opera a viagem (um grupo dela, por exemplo). Produto sem fornecedor não vira conta a pagar: o custo é da própria agência.</span>
        </span>
      </label>
      <p className="fin-t-caption text-[var(--fin-text-3)] sm:col-span-2 lg:col-span-4">
        Quais componentes contam como receita da agência se escolhe em <Link href="/config/vendas" className={LINK}>Configurações › Vendas</Link>.
      </p>
    </div>
  );
}
