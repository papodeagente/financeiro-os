'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Target, Trash2, UsersRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { DataState } from '@/components/fin/DataState';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { MoneyField } from '@/components/fin/MoneyField';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Callout } from '@/components/fin/Callout';
import { CARTAO } from '@/components/comissoes/PainelDoVendedor';
import type { CadastroDeComissoes } from '@/lib/comissao-funcoes-servidor';
import type { ConfigComissao, Funcao, PessoaDaFuncao } from '@/lib/comissao-funcoes';
import { hojeISO } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Funções (E5, parte F): Vendedor e Intermediário (do sistema) e as funções
 * que a agência cria (gerente, emissor...), cada uma com quem está nela, o
 * plano, o início, a marca "sem comissão" e as metas do ano. As funções
 * criadas dizem sobre as vendas de quem ganham: pessoas da equipe e/ou
 * unidades (centros de custo).
 */

type Opcao = { id: string; nome: string };
type Cadastro = CadastroDeComissoes & { config: ConfigComissao; equipe: Opcao[]; intermediarios: Opcao[]; unidades: string[] };

const CAMPO = 'h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10';
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const novaFuncao = (): Funcao => ({ id: '', nome: '', sistema: null, sobre_pessoas: [], sobre_unidades: [], ativo: true });

export default function FuncoesPage() {
  const [dados, setDados] = React.useState<Cadastro | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [selecionada, setSelecionada] = React.useState<string>('fn-vendedor');
  const [funcao, setFuncao] = React.useState<Funcao | null>(null);
  const [pessoas, setPessoas] = React.useState<PessoaDaFuncao[]>([]);
  const [sujo, setSujo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [metasDe, setMetasDe] = React.useState<PessoaDaFuncao | null>(null);
  const [apagar, setApagar] = React.useState(false);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch('/api/comissoes-por-funcao/cadastro');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir.');
      setDados(j);
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  // Troca de função: o editor passa a mostrar a escolhida, como está gravada.
  React.useEffect(() => {
    if (!dados) return;
    if (selecionada === '') return;
    const f = dados.funcoes.find(x => x.id === selecionada) ?? dados.funcoes[0] ?? null;
    setFuncao(f ? { ...f } : null);
    setPessoas(f ? dados.pessoas.filter(p => p.funcao_id === f.id) : []);
    setSujo(false);
  }, [dados, selecionada]);

  const opcoesDePessoa = funcao?.sistema === 'INTERMEDIARIO' ? dados?.intermediarios ?? [] : dados?.equipe ?? [];

  async function salvar() {
    if (!funcao) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/comissoes-por-funcao/funcoes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ funcao, pessoas }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi salvo.');
      toast.success('Função salva', `${j.funcao.nome}: ${j.pessoas.length} ${j.pessoas.length === 1 ? 'pessoa' : 'pessoas'}.`);
      setSelecionada(j.funcao.id);
      await carregar();
    } catch (e) {
      toast.error('Não foi salvo', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!funcao?.id) return;
    const r = await fetch(`/api/comissoes-por-funcao/funcoes?id=${encodeURIComponent(funcao.id)}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok) { toast.error('Não foi apagada', j?.error); return; }
    toast.success('Função apagada');
    setApagar(false);
    setSelecionada('fn-vendedor');
    await carregar();
  }

  const mudarPessoa = (i: number, parte: Partial<PessoaDaFuncao>) => {
    setPessoas(ps => ps.map((p, k) => (k === i ? { ...p, ...parte } : p)));
    setSujo(true);
  };
  const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter(x => x !== v) : [...lista, v]);

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={UsersRound}
        titulo="Funções"
        subtitulo="Quem ganha comissão, sobre quais vendas, com qual plano e qual meta."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acaoPrimaria={{ rotulo: 'Nova função', icone: Plus, onClick: () => { setSelecionada(''); setFuncao(novaFuncao()); setPessoas([]); setSujo(true); } }}
        acoesSecundarias={[{ rotulo: 'Planos de comissão', href: '/equipe/planos-por-funcao' }, { rotulo: 'Configurações', href: '/config/comissoes' }]}
      />
      <DataState
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div className="h-96 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
      >
        {dados ? (
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            {dados.config.regra !== 'FUNCOES' ? (
              <Callout tom="aviso" titulo="A agência ainda usa o plano por vendedor">
                Você pode montar funções e planos agora. Eles passam a valer quando a regra por função for escolhida em <Link className="underline underline-offset-4" href="/config/comissoes">Configurações › Comissões</Link>.
              </Callout>
            ) : null}
            <div className="grid grid-cols-1 gap-[var(--fin-s-5)] lg:grid-cols-[240px_minmax(0,1fr)]">
              <nav aria-label="Funções" className={cn(CARTAO, 'flex flex-row gap-1 overflow-x-auto p-[var(--fin-s-2)] lg:flex-col')}>
                {dados.funcoes.map(f => {
                  const qtd = dados.pessoas.filter(p => p.funcao_id === f.id).length;
                  const ativa = f.id === selecionada;
                  return (
                    <button
                      key={f.id} type="button" onClick={() => setSelecionada(f.id)} aria-current={ativa ? 'true' : undefined}
                      className={cn(
                        'flex h-11 shrink-0 items-center justify-between gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] px-[var(--fin-s-3)] text-left fin-t-body transition-colors duration-[var(--fin-dur-rapida)]',
                        ativa ? 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)] font-medium' : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
                      )}
                    >
                      <span className="truncate">{f.nome}</span>
                      <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{qtd}</span>
                    </button>
                  );
                })}
              </nav>

              {funcao ? (
                <section aria-label={`Função ${funcao.nome || 'nova'}`} className={cn(CARTAO, 'flex min-w-0 flex-col gap-[var(--fin-s-5)] p-[var(--fin-s-4)] sm:p-[var(--fin-s-5)]')}>
                  <div className="flex flex-col gap-[var(--fin-s-1)]">
                    {funcao.sistema ? (
                      <>
                        <h2 className="fin-t-title text-[var(--fin-text)]">{funcao.nome}</h2>
                        <p className="fin-t-body text-[var(--fin-text-2)]">
                          {funcao.sistema === 'VENDEDOR' ? 'Cada vendedor ganha sobre as próprias vendas.' : 'Cada intermediário ganha sobre as vendas que trouxe. O que ele já reteve ao receber do cliente sai do que tem a receber.'}
                        </p>
                      </>
                    ) : (
                      <label className="flex max-w-md flex-col gap-[var(--fin-s-1)]">
                        <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Nome da função</span>
                        <input className={CAMPO} value={funcao.nome} placeholder="Ex.: Gerente comercial" onChange={e => { setFuncao({ ...funcao, nome: e.target.value }); setSujo(true); }} />
                      </label>
                    )}
                  </div>

                  {!funcao.sistema ? (
                    <fieldset className="flex flex-col gap-[var(--fin-s-3)]">
                      <legend className="fin-t-subhead text-[var(--fin-text)]">Ganha sobre as vendas de</legend>
                      <div className="flex flex-col gap-[var(--fin-s-2)]">
                        <span className="fin-t-caption text-[var(--fin-text-3)]">Pessoas da equipe</span>
                        <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                          {dados.equipe.map(p => (
                            <label key={p.id} className={cn('inline-flex h-9 cursor-pointer items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-2)] fin-t-caption',
                              funcao.sobre_pessoas.includes(p.id) ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-text)]' : 'border-[var(--fin-border)] text-[var(--fin-text-2)]')}>
                              <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={funcao.sobre_pessoas.includes(p.id)}
                                onChange={() => { setFuncao({ ...funcao, sobre_pessoas: alternar(funcao.sobre_pessoas, p.id) }); setSujo(true); }} />
                              {p.nome}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-[var(--fin-s-2)]">
                        <span className="fin-t-caption text-[var(--fin-text-3)]">Unidades (centro de custo da venda)</span>
                        {dados.unidades.length ? (
                          <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                            {dados.unidades.map(u => (
                              <label key={u} className={cn('inline-flex h-9 cursor-pointer items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-2)] fin-t-caption',
                                funcao.sobre_unidades.includes(u) ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-text)]' : 'border-[var(--fin-border)] text-[var(--fin-text-2)]')}>
                                <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={funcao.sobre_unidades.includes(u)}
                                  onChange={() => { setFuncao({ ...funcao, sobre_unidades: alternar(funcao.sobre_unidades, u) }); setSujo(true); }} />
                                {u}
                              </label>
                            ))}
                          </div>
                        ) : <p className="fin-t-caption text-[var(--fin-text-3)]">Nenhuma venda com centro de custo ainda.</p>}
                      </div>
                    </fieldset>
                  ) : null}

                  <div className="flex flex-col gap-[var(--fin-s-3)]">
                    <div className="flex items-center justify-between gap-[var(--fin-s-3)]">
                      <h3 className="fin-t-subhead text-[var(--fin-text)]">Pessoas nesta função</h3>
                      <Button type="button" variant="outline" size="sm" className="h-11 lg:h-9"
                        onClick={() => { setPessoas(ps => [...ps, { id: '', funcao_id: funcao.id, pessoa_id: '', pessoa_nome: '', plano_id: dados.planos[0]?.id ?? '', data_inicio: hojeISO(), nao_comissionado: false }]); setSujo(true); }}>
                        <Plus aria-hidden="true" className="size-4" /> Adicionar pessoa
                      </Button>
                    </div>
                    {pessoas.length === 0 ? (
                      <p className="fin-t-body text-[var(--fin-text-2)]">Ninguém nesta função ainda.</p>
                    ) : (
                      <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
                        {pessoas.map((p, i) => (
                          <li key={p.id || `nova-${i}`} className="grid grid-cols-1 items-end gap-[var(--fin-s-2)] p-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_150px_auto_auto]">
                            <label className="flex flex-col gap-1">
                              <span className="fin-t-caption text-[var(--fin-text-3)]">Pessoa</span>
                              <select className={CAMPO} value={p.pessoa_id} onChange={e => mudarPessoa(i, { pessoa_id: e.target.value, pessoa_nome: opcoesDePessoa.find(o => o.id === e.target.value)?.nome ?? '' })}>
                                <option value="">Escolha…</option>
                                {opcoesDePessoa.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="fin-t-caption text-[var(--fin-text-3)]">Plano</span>
                              <select className={CAMPO} value={p.plano_id} onChange={e => mudarPessoa(i, { plano_id: e.target.value })}>
                                <option value="">Sem plano</option>
                                {dados.planos.map(pl => <option key={pl.id} value={pl.id}>{pl.nome}</option>)}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="fin-t-caption text-[var(--fin-text-3)]">Início</span>
                              <input type="date" className={CAMPO} value={p.data_inicio} onChange={e => mudarPessoa(i, { data_inicio: e.target.value })} />
                            </label>
                            <label className="flex h-11 items-center gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)] lg:h-10">
                              <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={p.nao_comissionado} onChange={e => mudarPessoa(i, { nao_comissionado: e.target.checked })} />
                              Sem comissão
                            </label>
                            <div className="flex gap-1">
                              <Button type="button" variant="ghost" size="sm" className="h-11 lg:h-10" disabled={!p.id} title={p.id ? undefined : 'Salve a função antes de lançar as metas'} onClick={() => setMetasDe(p)}>
                                <Target aria-hidden="true" className="size-4" /> Metas
                              </Button>
                              <Button type="button" variant="ghost" size="icon" aria-label={`Tirar ${p.pessoa_nome || 'a pessoa'} da função`} onClick={() => { setPessoas(ps => ps.filter((_, k) => k !== i)); setSujo(true); }}>
                                <Trash2 aria-hidden="true" className="size-4" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-col-reverse gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] sm:flex-row sm:items-center sm:justify-between">
                    {funcao.id && !funcao.sistema ? (
                      <Button type="button" variant="ghost" onClick={() => setApagar(true)}>Apagar função</Button>
                    ) : <span />}
                    <div className="flex items-center gap-[var(--fin-s-3)]">
                      <span className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">{sujo ? 'Há alterações não salvas.' : 'Tudo salvo.'}</span>
                      <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || !sujo}>{salvando ? 'Salvando…' : 'Salvar função'}</Button>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        ) : null}
      </DataState>

      {metasDe && dados ? <MetasDoAno pessoa={metasDe} metas={dados.metas} onFechar={() => setMetasDe(null)} onSalvo={carregar} /> : null}

      <ConfirmDialog
        aberto={apagar} onOpenChange={setApagar} tone="destrutivo"
        titulo={`Apagar a função ${funcao?.nome ?? ''}?`}
        oQueVaiAcontecer="A função, as pessoas dela e as metas saem. Função com comissão já fechada não se apaga: desligue-a."
        confirmarRotulo="Apagar função" onConfirmar={excluir}
      />
    </MolduraDaPagina>
  );
}

function MetasDoAno({ pessoa, metas, onFechar, onSalvo }: { pessoa: PessoaDaFuncao; metas: CadastroDeComissoes['metas']; onFechar: () => void; onSalvo: () => Promise<void> }) {
  const [ano, setAno] = React.useState(Number(hojeISO().slice(0, 4)));
  const doAno = React.useCallback((a: number) => Array.from({ length: 12 }, (_, i) => (metas.find(m => m.pessoa_funcao_id === pessoa.id && m.mes === `${a}-${String(i + 1).padStart(2, '0')}`)?.centavos ?? 0) / 100), [metas, pessoa.id]);
  const [valores, setValores] = React.useState<number[]>(() => doAno(ano));
  const [salvando, setSalvando] = React.useState(false);
  React.useEffect(() => { setValores(doAno(ano)); }, [ano, doAno]);

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch('/api/comissoes-por-funcao/metas', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pessoa_funcao_id: pessoa.id, ano, meses: valores.map(v => Math.round(v * 100)) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi salvo.');
      toast.success('Metas salvas', `${pessoa.pessoa_nome}, ${ano}.`);
      await onSalvo();
      onFechar();
    } catch (e) {
      toast.error('Não foi salvo', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <RecordSheet
      aberto onOpenChange={o => { if (!o) onFechar(); }} largura={640}
      titulo={`Metas de ${pessoa.pessoa_nome || 'pessoa'}`} descricao="O resultado do mês comparado com a meta define a faixa do plano. Mês sem meta fica em branco."
      resumo={`Total do ano: ${(valores.reduce((a, v) => a + v, 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
      acaoPrimaria={{ rotulo: 'Salvar metas', onClick: salvar, carregando: salvando }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <label className="flex max-w-[10rem] flex-col gap-1">
          <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Ano</span>
          <select className={CAMPO} value={ano} onChange={e => setAno(Number(e.target.value))}>
            {[ano - 1, ano, ano + 1].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          {MESES.map((m, i) => (
            <MoneyField key={`${ano}-${i}`} rotulo={m} valor={valores[i]} onChange={v => setValores(vs => vs.map((x, k) => (k === i ? v : x)))} />
          ))}
        </div>
      </div>
    </RecordSheet>
  );
}
