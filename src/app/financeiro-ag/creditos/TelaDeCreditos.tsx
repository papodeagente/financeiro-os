'use client';

import * as React from 'react';
import { CalendarClock, PiggyBank, Plus, Users, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/fin/Field';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { StatusChip } from '@/components/fin/StatusChip';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import { CampoReais, CONTROLE, SELECT } from '@/components/vendas/ficha/comum';
import { consumirAtalho, lerAtalhos } from '@/lib/atalho-da-url';
import { loadEntities } from '@/lib/crm-storage';
import { deCentavos, hojeISO, paraCentavos } from '@/lib/money';
import { MESES_DE_VALIDADE_PADRAO, ROTULO_MOVIMENTO, ROTULO_ORIGEM_DO_CREDITO, fraseDaValidade, validadePadrao } from '@/lib/credito-cliente';
import type { CarteiraDoCliente, ExtratoCompleto } from '@/lib/credito-cliente-servidor';
import type { ContaReceber } from '@/lib/crm-types';
import { toast } from '@/lib/toast';
import { cn, formatBRL } from '@/lib/utils';

/**
 * Crédito do cliente (E5, parte D): a carteira de cada cliente, com saldo,
 * validade e origem (cancelamento, pagamento a mais, reembolso que virou
 * crédito, lançado à mão). O uso é parcial: numa venda futura (forma
 * "Crédito do cliente", sai sozinho ao salvar a venda) ou numa conta a
 * receber, aqui mesmo. O sino avisa 30 dias antes de um crédito vencer.
 */

type Resposta = { carteiras: CarteiraDoCliente[]; totais: { disponivel: number; vencendo: number; clientes_com_saldo: number } };
type Filtros = { busca: string; mostrar: 'com_saldo' | 'todos' };

const reais = (c: number) => formatBRL(deCentavos(c));
const dataBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

export function TelaDeCreditos() {
  const pode = usePermissoes();
  const [f, setF] = React.useState<Filtros>({ busca: '', mostrar: 'com_saldo' });
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [versao, setVersao] = React.useState(0);
  const [cliente, setCliente] = React.useState<{ id: string; nome: string } | null>(null);
  const [novo, setNovo] = React.useState(false);
  const busca = useDebounce(f.busca.trim());
  const podeUsar = pode('usar_credito_cliente');

  React.useEffect(() => {
    const ac = new AbortController();
    setCarregando(true);
    const q = new URLSearchParams();
    if (busca) q.set('busca', busca);
    if (f.mostrar === 'com_saldo') q.set('so_com_saldo', '1');
    fetch(`/api/creditos-cliente?${q}`, { signal: ac.signal })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'A consulta não respondeu.'); return j as Resposta; })
      .then(j => { setDados(j); setErro(null); setAtualizadoEm(new Date()); })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'A consulta não respondeu.'); })
      .finally(() => { if (!ac.signal.aborted) setCarregando(false); });
    return () => ac.abort();
  }, [busca, f.mostrar, versao]);

  // ?cliente=<id> (link do aviso de vencimento): abre o extrato.
  React.useEffect(() => {
    const id = lerAtalhos().get('cliente');
    if (!id) return;
    consumirAtalho('cliente');
    setCliente({ id, nome: '' });
  }, []);

  const recarregar = React.useCallback(async () => { setVersao(v => v + 1); }, []);
  const ativos = (f.busca ? 1 : 0) + (f.mostrar !== 'com_saldo' ? 1 : 0);
  const limpar = () => setF({ busca: '', mostrar: 'com_saldo' });
  const linhas = dados?.carteiras ?? [];
  const t = dados?.totais;
  const numeros = dados ? 'ok' : carregando ? 'carregando' : 'indisponivel';

  const colunas: FinColuna<CarteiraDoCliente>[] = [
    {
      id: 'cliente', cabecalho: 'Cliente', tipo: 'texto', sortable: true, minWidth: 220, acessor: c => c.cliente_nome.toLowerCase(),
      render: c => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate fin-t-body-strong text-[var(--fin-text)]">{c.cliente_nome || 'Cliente'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{c.creditos_ativos} {c.creditos_ativos === 1 ? 'crédito com saldo' : 'créditos com saldo'}</span>
        </span>
      ),
    },
    { id: 'disponivel', cabecalho: 'Disponível', tipo: 'dinheiro', sortable: true, valor: c => deCentavos(c.disponivel), tone: c => (c.disponivel > 0 ? 'positivo' : 'neutro') },
    {
      id: 'vencendo', cabecalho: 'Vence em 30 dias', tipo: 'dinheiro', sortable: true, prioridade: 2, valor: c => deCentavos(c.vencendo),
      tone: c => (c.vencendo > 0 ? 'negativo' : 'neutro'),
    },
    { id: 'validade', cabecalho: 'Próxima validade', tipo: 'data', sortable: true, prioridade: 1, valor: c => c.proxima_validade || null },
    { id: 'recebido', cabecalho: 'Já entrou', tipo: 'dinheiro', prioridade: 1, valor: c => deCentavos(c.total_recebido) },
    { id: 'usado', cabecalho: 'Já usado', tipo: 'dinheiro', prioridade: 1, valor: c => deCentavos(c.total_usado) },
  ];

  return (
    <MolduraDaPagina>
      <div className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={PiggyBank}
          titulo="Crédito do cliente"
          subtitulo="O dinheiro dos clientes que ficou com a agência: sobra de cancelamento, pagamento a mais, reembolso que virou crédito. Usa-se em parte, numa próxima venda ou numa conta a receber."
          atualizadoEm={atualizadoEm}
          onRecarregar={recarregar}
          acaoPrimaria={podeUsar ? { rotulo: 'Lançar crédito', icone: Plus, onClick: () => setNovo(true) } : undefined}
          acoesSecundarias={[{ rotulo: 'Reembolsos', href: '/financeiro-ag/reembolsos' }]}
        />

        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <MetricCard rotulo="Crédito disponível" icone={Wallet} valor={t ? deCentavos(t.disponivel) : null} estado={numeros} emphasis="destaque"
            contexto="Soma das carteiras, sem o que já venceu. É dinheiro dos clientes guardado pela agência." />
          <MetricCard rotulo="Vence em 30 dias" icone={CalendarClock} valor={t ? deCentavos(t.vencendo) : null} estado={numeros} tone={t && t.vencendo > 0 ? 'negativo' : 'neutro'} tomDoIcone="aviso"
            contexto="Lembre esses clientes: o sino avisa uma vez por crédito." />
          <MetricCard rotulo="Clientes com saldo" icone={Users} valor={t?.clientes_com_saldo ?? null} formato="contagem" estado={numeros}
            contexto="Quem pode pagar a próxima viagem, em parte, com crédito." />
        </div>

        <FilterBar
          busca={{ valor: f.busca, onChange: v => setF(x => ({ ...x, busca: v })), placeholder: 'Pesquisar cliente…' }}
          selects={[{
            id: 'cred-mostrar', rotulo: 'Mostrar', valor: f.mostrar, onChange: v => setF(x => ({ ...x, mostrar: v as Filtros['mostrar'] })),
            opcoes: [{ valor: 'com_saldo', rotulo: 'Só quem tem saldo' }, { valor: 'todos', rotulo: 'Todos, inclusive já usados' }],
          }]}
          resumo={{ exibidos: linhas.length, total: linhas.length, substantivo: linhas.length === 1 ? 'cliente' : 'clientes' }}
          ativos={ativos}
          onLimpar={limpar}
        />

        <FinTable<CarteiraDoCliente>
          linhas={linhas}
          colunas={colunas}
          chave={c => c.cliente_id || c.cliente_nome}
          densidade="compacta"
          estado={!dados && carregando ? 'carregando' : !dados && erro ? 'erro' : 'ok'}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void recarregar(); } } : null}
          vazio={ativos > 0
            ? { motivo: 'sem-resultado', titulo: 'Nenhum cliente neste filtro', oQueE: 'Os créditos continuam guardados; o recorte atual é que não encontrou nenhum.', acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar } }
            : {
              motivo: 'sem-dado', titulo: 'Nenhum cliente com crédito',
              oQueE: 'A carteira de crédito guarda o dinheiro que o cliente deixou com a agência, com validade e extrato.',
              comoComeca: [
                'Ao cancelar na venda, escolha "Guardar como crédito do cliente" para o que ele já pagou a mais.',
                'Na liquidação, quando entrar mais do que o devido, guarde a sobra como crédito.',
                'Na próxima venda, use a forma de pagamento "Crédito do cliente": o saldo sai sozinho.',
              ],
              acao: podeUsar ? { rotulo: 'Lançar crédito', onClick: () => setNovo(true) } : undefined,
            }}
          totais={linhas.length && t ? [{ colunaId: 'disponivel', valor: deCentavos(t.disponivel), rotulo: 'Disponível no filtro' }] : undefined}
          onLinhaClick={c => setCliente({ id: c.cliente_id, nome: c.cliente_nome })}
        />
      </div>

      <ExtratoDoCliente cliente={cliente} podeUsar={podeUsar} onFechar={() => setCliente(null)} onMudou={() => { void recarregar(); }} />
      <NovoCredito aberto={novo} onFechar={() => setNovo(false)} onCriado={() => { setNovo(false); void recarregar(); }} />
    </MolduraDaPagina>
  );
}

function ExtratoDoCliente({ cliente, podeUsar, onFechar, onMudou }: { cliente: { id: string; nome: string } | null; podeUsar: boolean; onFechar: () => void; onMudou: () => void }) {
  const [extrato, setExtrato] = React.useState<ExtratoCompleto | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [contas, setContas] = React.useState<ContaReceber[]>([]);
  const [conta, setConta] = React.useState('');
  const [valor, setValor] = React.useState(0);
  const [usando, setUsando] = React.useState(false);
  const [versao, setVersao] = React.useState(0);

  React.useEffect(() => {
    if (!cliente) { setExtrato(null); return; }
    setErro(null);
    fetch(`/api/creditos-cliente?cliente_id=${encodeURIComponent(cliente.id)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error ?? 'Não abriu.'); return j as ExtratoCompleto; })
      .then(setExtrato)
      .catch(e => setErro(e instanceof Error ? e.message : 'Não abriu.'));
    if (podeUsar) {
      loadEntities<ContaReceber>(`contas-receber?cliente_id=${encodeURIComponent(cliente.id)}`)
        .then(l => setContas(l.filter(c => c.cliente_id === cliente.id && ['PENDENTE', 'ATRASADO', 'PARCIAL'].includes(String(c.status)))))
        .catch(() => setContas([]));
    }
    setConta(''); setValor(0);
  }, [cliente, podeUsar, versao]);

  const escolhida = contas.find(c => c.id === conta);
  const emAberto = escolhida ? paraCentavos((Number(escolhida.valor_final) || 0) - (Number(escolhida.valor_recebido) || 0)) : 0;
  const disponivel = extrato?.saldo.disponivel ?? 0;
  const maximo = Math.min(emAberto, disponivel);

  async function usar() {
    if (!escolhida || valor <= 0) return;
    setUsando(true);
    try {
      const r = await fetch('/api/creditos-cliente/usar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conta_receber_id: escolhida.id, valor_centavos: Math.min(valor, maximo) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error ?? 'Não deu certo.'));
      toast.success('Conta liquidada com crédito', `${reais(Math.min(valor, maximo))} saíram da carteira. Nenhum dinheiro entrou no caixa; o estorno da baixa devolve o crédito.`);
      setVersao(v => v + 1);
      onMudou();
    } catch (e) {
      toast.error('O crédito não foi usado', e instanceof Error ? e.message : undefined);
    } finally {
      setUsando(false);
    }
  }

  const nome = extrato?.cliente_nome || cliente?.nome || 'Cliente';
  return (
    <RecordSheet
      aberto={Boolean(cliente)}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={`Crédito de ${nome}`}
      descricao={extrato ? `${reais(extrato.saldo.disponivel)} disponíveis${extrato.saldo.proxima_validade ? ` · o primeiro vence em ${dataBR(extrato.saldo.proxima_validade)}` : ''}` : undefined}
      largura={960}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={null}
    >
      {erro ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : !extrato ? (
        <div className="flex flex-col gap-[var(--fin-s-3)]"><div className="h-24 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" /><div className="h-48 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" /></div>
      ) : (
        <div className="flex flex-col gap-[var(--fin-s-5)]">
          <section aria-labelledby="cred-lista" className="flex flex-col gap-[var(--fin-s-2)]">
            <h3 id="cred-lista" className="fin-t-body-strong text-[var(--fin-text)]">Créditos</h3>
            <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
              {extrato.creditos.map(c => (
                <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[var(--fin-s-3)] gap-y-1 px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate fin-t-body text-[var(--fin-text)]">{c.descricao || ROTULO_ORIGEM_DO_CREDITO[c.origem]}</span>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      {ROTULO_ORIGEM_DO_CREDITO[c.origem]}{c.origem_venda_numero ? ` · venda ${c.origem_venda_numero}` : ''} · {fraseDaValidade(c.validade, hojeISO())} · entrou {reais(c.valor_centavos)}
                    </span>
                  </span>
                  <span className="flex items-center gap-[var(--fin-s-2)]">
                    <StatusChip dominio="credito" valor={c.situacao_hoje} />
                    <span className="min-w-24 text-right tabular-nums fin-t-body-strong text-[var(--fin-text)]">{reais(c.saldo_centavos)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {podeUsar && disponivel > 0 ? (
            <section aria-labelledby="cred-usar" className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] p-[var(--fin-s-3)]">
              <h3 id="cred-usar" className="fin-t-body-strong text-[var(--fin-text)]">Usar numa conta a receber</h3>
              {contas.length ? (
                <div className="grid grid-cols-1 gap-[var(--fin-s-3)] md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
                  <Field rotulo="Conta em aberto">
                    {a => (
                      <select {...a} className={SELECT} value={conta} onChange={e => { setConta(e.target.value); setValor(0); }}>
                        <option value="">Escolha…</option>
                        {contas.map(c => <option key={c.id} value={c.id}>{`${c.descricao || 'Conta'} · vence ${dataBR(String(c.data_vencimento ?? ''))} · ${formatBRL((Number(c.valor_final) || 0) - (Number(c.valor_recebido) || 0))}`}</option>)}
                      </select>
                    )}
                  </Field>
                  <div className="flex flex-col gap-1">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">Quanto usar</span>
                    <CampoReais rotulo="Quanto do crédito usar" centavos={valor} onChange={setValor} desabilitado={!escolhida} />
                    {escolhida ? (
                      <button type="button" className="self-start fin-t-caption text-[var(--fin-accent)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]" onClick={() => setValor(maximo)}>
                        Usar o máximo ({reais(maximo)})
                      </button>
                    ) : null}
                  </div>
                  <Button type="button" onClick={() => { void usar(); }} disabled={!escolhida || valor <= 0 || usando}>{usando ? 'Usando…' : 'Liquidar com crédito'}</Button>
                </div>
              ) : <p className="fin-t-body text-[var(--fin-text-2)]">Este cliente não tem conta a receber em aberto. O crédito também é usado na próxima venda, pela forma "Crédito do cliente".</p>}
            </section>
          ) : null}

          <section aria-labelledby="cred-extrato" className="flex flex-col gap-[var(--fin-s-2)]">
            <h3 id="cred-extrato" className="fin-t-body-strong text-[var(--fin-text)]">Extrato</h3>
            <div className="overflow-x-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
              <table className="w-full min-w-[640px] border-collapse fin-t-body">
                <caption className="sr-only">Movimentos do crédito de {nome}</caption>
                <thead className="bg-[var(--fin-surface-2)]">
                  <tr className="text-left fin-t-overline text-[var(--fin-text-3)]">
                    <th scope="col" className="px-3 py-2 font-medium">Data</th>
                    <th scope="col" className="px-3 py-2 font-medium">Movimento</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Valor</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {[...extrato.extrato].reverse().map(l => (
                    <tr key={l.id} className="border-t border-[var(--fin-border)]">
                      <td className="px-3 py-2 tabular-nums text-[var(--fin-text-2)]">{new Date(l.criado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                      <td className="px-3 py-2">
                        <span className="block text-[var(--fin-text)]">{ROTULO_MOVIMENTO[l.tipo]}</span>
                        {l.descricao ? <span className="block max-w-[56ch] truncate fin-t-caption text-[var(--fin-text-3)]" title={l.descricao}>{l.descricao}</span> : null}
                      </td>
                      <td className={cn('px-3 py-2 text-right tabular-nums fin-t-body-strong', l.valor_centavos < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-positive)]')}>
                        {l.valor_centavos < 0 ? '−' : '+'}{reais(Math.abs(l.valor_centavos))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--fin-text)]">{reais(l.saldo_carteira_centavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </RecordSheet>
  );
}

function NovoCredito({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: () => void }) {
  const [clientes, setClientes] = React.useState<Array<{ id: string; nome: string }>>([]);
  const [cliente, setCliente] = React.useState('');
  const [valor, setValor] = React.useState(0);
  const [validade, setValidade] = React.useState('');
  const [descricao, setDescricao] = React.useState('');
  const [gravando, setGravando] = React.useState(false);

  React.useEffect(() => {
    if (!aberto) return;
    setCliente(''); setValor(0); setValidade(validadePadrao(hojeISO())); setDescricao('');
    loadEntities<{ id: string; nome: string }>('clientes').then(cs => setClientes(cs.map(c => ({ id: c.id, nome: c.nome || 'Cliente' })).sort((a, b) => a.nome.localeCompare(b.nome)))).catch(() => undefined);
  }, [aberto]);

  const escolhido = clientes.find(c => c.id === cliente);

  async function salvar() {
    if (!escolhido) { toast.error('Escolha o cliente'); return; }
    if (valor <= 0) { toast.error('Informe o valor'); return; }
    if (descricao.trim().length < 5) { toast.error('Diga de onde vem o crédito', 'Pelo menos 5 letras: fica no extrato.'); return; }
    setGravando(true);
    try {
      const r = await fetch('/api/creditos-cliente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente_id: escolhido.id, cliente_nome: escolhido.nome, valor_centavos: valor, validade, descricao }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error ?? 'Não deu certo.'));
      toast.success('Crédito lançado', `${reais(valor)} na carteira de ${escolhido.nome}.`);
      onCriado();
    } catch (e) {
      toast.error('O crédito não foi lançado', e instanceof Error ? e.message : undefined);
    } finally {
      setGravando(false);
    }
  }

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Lançar crédito do cliente"
      descricao="Para o crédito combinado fora de um cancelamento (cortesia, acerto). Fica no extrato com a sua descrição."
      sujo={valor > 0 || Boolean(cliente)}
      resumo={escolhido && valor > 0 ? `${reais(valor)} para ${escolhido.nome}, ${fraseDaValidade(validade, hojeISO())}.` : undefined}
      acaoPrimaria={{ rotulo: 'Lançar crédito', onClick: salvar, carregando: gravando }}
      acaoSecundaria={{ rotulo: 'Voltar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <Field rotulo="Cliente" obrigatorio>
          {a => (
            <select {...a} className={SELECT} value={cliente} onChange={e => setCliente(e.target.value)}>
              <option value="">Escolha…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="fin-t-body-strong text-[var(--fin-text)]">Valor</span>
            <CampoReais rotulo="Valor do crédito" centavos={valor} onChange={setValor} />
          </div>
          <Field rotulo="Validade" ajuda={`Padrão: ${MESES_DE_VALIDADE_PADRAO} meses. Vazio = sem validade.`}>
            {a => <Input {...a} type="date" className={CONTROLE} value={validade} min={hojeISO()} onChange={e => setValidade(e.target.value)} />}
          </Field>
        </div>
        <Field rotulo="De onde vem" obrigatorio ajuda="Fica no extrato do cliente.">
          {a => <Textarea {...a} value={descricao} maxLength={300} onChange={e => setDescricao(e.target.value)} className="min-h-20 fin-t-body" placeholder="Ex.: cortesia pela troca de hotel" />}
        </Field>
      </div>
    </RecordSheet>
  );
}
