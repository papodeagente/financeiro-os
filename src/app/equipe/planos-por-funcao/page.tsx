'use client';

import * as React from 'react';
import { Copy, Grid3x3, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { DataState } from '@/components/fin/DataState';
import { Segmentado } from '@/components/fin/Segmentado';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { CARTAO } from '@/components/comissoes/PainelDoVendedor';
import { EscolhaDaBase } from '@/components/comissoes/EscolhaDaBase';
import {
  FUNCAO_TODAS, PRODUTO_TODOS, errosDoPlano, normalizarPlano,
  type Calculo, type FaixaDoPlano, type Funcao, type ModoDaFaixa, type PlanoPorFuncao, type RegraDoPlano,
} from '@/lib/comissao-funcoes';
import { ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO } from '@/lib/venda-modelo';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Planos de comissão por função (E5, parte F): a matriz faixa de meta ×
 * produto × função. Cada regra paga % ou valor por produto, sobre a base
 * escolhida, e pode ter um cálculo próprio para venda com intermediário.
 * "Todos os produtos" e "todas as funções" valem como padrão; a regra mais
 * específica vence. "Copiar faixa" evita montar a matriz na mão.
 */

const CAMPO = 'h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10';
const calculoPadrao = (): Calculo => ({ tipo: 'PERCENTUAL', percentual: 0, valor_centavos: 0, sobre: ['RECEITA'] });
const regraNova = (): RegraDoPlano => ({ id: `r${Date.now()}${Math.round(Math.random() * 1000)}`, produto: PRODUTO_TODOS, funcao_id: FUNCAO_TODAS, calculo: calculoPadrao(), com_intermediario: null });
const planoNovo = (): PlanoPorFuncao => ({ id: '', nome: 'Novo plano', modo_faixa: 'DEGRAU', faixas: [{ percentual_meta: 0, regras: [regraNova()] }], ativo: true, versao: 1 });

function EditorDoCalculo({ calc, onChange, rotulo }: { calc: Calculo; onChange: (c: Calculo) => void; rotulo: string }) {
  return (
    <div className="flex flex-col gap-[var(--fin-s-2)]">
      <div className="flex flex-wrap items-end gap-[var(--fin-s-2)]">
        <Segmentado<'PERCENTUAL' | 'VALOR'>
          rotulo={rotulo} valor={calc.tipo}
          opcoes={[{ valor: 'PERCENTUAL', rotulo: '%' }, { valor: 'VALOR', rotulo: 'R$ por produto' }]}
          onChange={tipo => onChange({ ...calc, tipo })}
        />
        {calc.tipo === 'PERCENTUAL' ? (
          <label className="flex w-28 flex-col gap-1">
            <span className="fin-t-caption text-[var(--fin-text-3)]">Percentual</span>
            <input type="number" min={0} max={100} step={0.0001} className={cn(CAMPO, 'tabular-nums')} value={calc.percentual}
              onChange={e => onChange({ ...calc, percentual: Number(e.target.value) })} />
          </label>
        ) : (
          <label className="flex w-36 flex-col gap-1">
            <span className="fin-t-caption text-[var(--fin-text-3)]">Valor (R$)</span>
            <input type="number" min={0} step={0.01} className={cn(CAMPO, 'tabular-nums')} value={calc.valor_centavos / 100}
              onChange={e => onChange({ ...calc, valor_centavos: Math.round(Number(e.target.value) * 100) })} />
          </label>
        )}
      </div>
      {calc.tipo === 'PERCENTUAL' ? <EscolhaDaBase compacto rotulo="Sobre" valor={calc.sobre} onChange={sobre => onChange({ ...calc, sobre })} /> : null}
    </div>
  );
}

export default function PlanosPorFuncaoPage() {
  const [planos, setPlanos] = React.useState<PlanoPorFuncao[]>([]);
  const [funcoes, setFuncoes] = React.useState<Funcao[]>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [plano, setPlano] = React.useState<PlanoPorFuncao | null>(null);
  const [sujo, setSujo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [apagar, setApagar] = React.useState(false);

  const carregar = React.useCallback(async (manter?: string) => {
    setEstado('carregando');
    try {
      const r = await fetch('/api/comissoes-por-funcao/cadastro');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir.');
      setPlanos(j.planos);
      setFuncoes(j.funcoes);
      const alvo = (j.planos as PlanoPorFuncao[]).find(p => p.id === manter) ?? j.planos[0] ?? null;
      setPlano(alvo ? normalizarPlano(alvo) : null);
      setSujo(false);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const mudar = (p: PlanoPorFuncao) => { setPlano(p); setSujo(true); };
  const mudarFaixa = (i: number, f: FaixaDoPlano) => plano && mudar({ ...plano, faixas: plano.faixas.map((x, k) => (k === i ? f : x)) });
  const mudarRegra = (fi: number, ri: number, r: RegraDoPlano) => plano && mudarFaixa(fi, { ...plano.faixas[fi], regras: plano.faixas[fi].regras.map((x, k) => (k === ri ? r : x)) });
  const problemas = plano ? errosDoPlano(plano) : [];

  async function salvar() {
    if (!plano) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/comissoes-por-funcao/planos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plano }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi salvo.');
      toast.success('Plano salvo', `${j.nome}, versão ${j.versao}. O cálculo de amanhã já usa o plano novo.`);
      await carregar(j.id);
    } catch (e) {
      toast.error('Não foi salvo', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!plano?.id) return;
    const r = await fetch(`/api/comissoes-por-funcao/planos?id=${encodeURIComponent(plano.id)}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok) { toast.error('Não foi apagado', j?.error); return; }
    toast.success('Plano apagado');
    setApagar(false);
    await carregar();
  }

  const nomeDaFuncao = (id: string) => (id === FUNCAO_TODAS ? 'Todas as funções' : funcoes.find(f => f.id === id)?.nome ?? 'Função apagada');

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Grid3x3}
        titulo="Planos por função"
        subtitulo="Quanto cada função ganha em cada produto, conforme a faixa da meta."
        acaoPrimaria={{ rotulo: 'Novo plano', icone: Plus, onClick: () => { setPlano(planoNovo()); setSujo(true); } }}
        acoesSecundarias={[{ rotulo: 'Funções e metas', href: '/equipe/funcoes' }]}
      />
      <DataState
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div className="h-96 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
      >
        {!plano && planos.length === 0 ? (
          <EmptyLesson
            motivo="sem-dado" titulo="Nenhum plano por função ainda"
            oQueE="O plano diz quanto cada função ganha em cada produto, em cada faixa da meta."
            comoComeca={['Crie o plano com uma faixa a partir de 0% da meta', 'Acrescente faixas (80%, 100%, 120%) e copie as regras da faixa anterior', 'Em Funções, ponha as pessoas no plano e lance as metas']}
            acao={{ rotulo: 'Criar plano', onClick: () => { setPlano(planoNovo()); setSujo(true); } }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-[var(--fin-s-5)] lg:grid-cols-[240px_minmax(0,1fr)]">
            <nav aria-label="Planos" className={cn(CARTAO, 'flex flex-row gap-1 overflow-x-auto p-[var(--fin-s-2)] lg:flex-col')}>
              {planos.map(p => (
                <button key={p.id} type="button" onClick={() => { setPlano(normalizarPlano(p)); setSujo(false); }} aria-current={plano?.id === p.id ? 'true' : undefined}
                  className={cn('flex h-11 shrink-0 items-center justify-between gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-[var(--fin-s-3)] text-left fin-t-body',
                    plano?.id === p.id ? 'bg-[var(--fin-accent-soft)] font-medium text-[var(--fin-accent)]' : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]')}>
                  <span className="truncate">{p.nome}</span>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">v{p.versao}</span>
                </button>
              ))}
            </nav>

            {plano ? (
              <section aria-label={`Plano ${plano.nome}`} className="flex min-w-0 flex-col gap-[var(--fin-s-4)]">
                <div className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-4)] p-[var(--fin-s-4)] sm:p-[var(--fin-s-5)]')}>
                  <label className="flex max-w-md flex-col gap-1">
                    <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Nome do plano</span>
                    <input className={CAMPO} value={plano.nome} onChange={e => mudar({ ...plano, nome: e.target.value })} />
                  </label>
                  <div className="flex flex-col gap-[var(--fin-s-2)]">
                    <Segmentado<ModoDaFaixa>
                      rotulo="Como a faixa vale" valor={plano.modo_faixa}
                      opcoes={[{ valor: 'DEGRAU', rotulo: 'Por degrau' }, { valor: 'PROGRESSIVA', rotulo: 'Progressiva' }]}
                      onChange={modo_faixa => mudar({ ...plano, modo_faixa })}
                    />
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {plano.modo_faixa === 'DEGRAU'
                        ? 'Por degrau: alcançou a faixa, o mês inteiro passa a valer o que ela paga.'
                        : 'Progressiva: cada parte do resultado ganha na faixa em que caiu. Ex.: 3% até 100% da meta e 5% só sobre o que passou.'}
                    </p>
                  </div>
                  <label className="flex items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)]">
                    <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={plano.ativo} onChange={e => mudar({ ...plano, ativo: e.target.checked })} />
                    Plano ligado
                  </label>
                </div>

                {plano.faixas.map((f, fi) => (
                  <div key={fi} className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)] sm:p-[var(--fin-s-5)]')}>
                    <div className="flex flex-wrap items-end justify-between gap-[var(--fin-s-3)]">
                      <label className="flex flex-col gap-1">
                        <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Faixa a partir de (% da meta)</span>
                        <input type="number" min={0} step={1} className={cn(CAMPO, 'w-36 tabular-nums')} value={f.percentual_meta}
                          onChange={e => mudarFaixa(fi, { ...f, percentual_meta: Number(e.target.value) })} />
                      </label>
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-11 lg:h-9" onClick={() => mudarFaixa(fi, { ...f, regras: [...f.regras, regraNova()] })}>
                          <Plus aria-hidden="true" className="size-4" /> Regra
                        </Button>
                        {plano.faixas.length > 1 ? (
                          <Button type="button" variant="ghost" size="icon" aria-label={`Tirar a faixa de ${f.percentual_meta}%`} onClick={() => mudar({ ...plano, faixas: plano.faixas.filter((_, k) => k !== fi) })}>
                            <Trash2 aria-hidden="true" className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
                      {f.regras.map((r, ri) => (
                        <li key={r.id} className="flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-3)]">
                          <div className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                            <label className="flex flex-col gap-1">
                              <span className="fin-t-caption text-[var(--fin-text-3)]">Produto</span>
                              <select className={CAMPO} value={r.produto} onChange={e => mudarRegra(fi, ri, { ...r, produto: e.target.value as RegraDoPlano['produto'] })}>
                                <option value={PRODUTO_TODOS}>Todos os produtos</option>
                                {TIPOS_PRODUTO.map(t => <option key={t} value={t}>{ROTULO_TIPO_PRODUTO[t]}</option>)}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="fin-t-caption text-[var(--fin-text-3)]">Função</span>
                              <select className={CAMPO} value={r.funcao_id} onChange={e => mudarRegra(fi, ri, { ...r, funcao_id: e.target.value })}>
                                <option value={FUNCAO_TODAS}>Todas as funções</option>
                                {funcoes.map(fn => <option key={fn.id} value={fn.id}>{fn.nome}</option>)}
                              </select>
                            </label>
                            <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Tirar a regra de ${nomeDaFuncao(r.funcao_id)}`}
                              onClick={() => mudarFaixa(fi, { ...f, regras: f.regras.filter((_, k) => k !== ri) })}>
                              <Trash2 aria-hidden="true" className="size-4" />
                            </Button>
                          </div>
                          <EditorDoCalculo rotulo="Paga" calc={r.calculo} onChange={c => mudarRegra(fi, ri, { ...r, calculo: c })} />
                          <label className="flex items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
                            <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={r.com_intermediario !== null}
                              onChange={e => mudarRegra(fi, ri, { ...r, com_intermediario: e.target.checked ? { ...r.calculo } : null })} />
                            Diferente quando a venda tem intermediário
                          </label>
                          {r.com_intermediario ? (
                            <div className="rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
                              <EditorDoCalculo rotulo="Com intermediário, paga" calc={r.com_intermediario} onChange={c => mudarRegra(fi, ri, { ...r, com_intermediario: c })} />
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                  <Button type="button" variant="outline" onClick={() => {
                    const ultima = plano.faixas[plano.faixas.length - 1];
                    mudar({ ...plano, faixas: [...plano.faixas, { percentual_meta: (ultima?.percentual_meta ?? 0) + 20, regras: (ultima?.regras ?? []).map(r => ({ ...r, id: regraNova().id })) }] });
                  }}>
                    <Copy aria-hidden="true" className="size-4" /> Nova faixa copiando a anterior
                  </Button>
                </div>

                {problemas.length ? (
                  <ul className="flex flex-col gap-1 fin-t-body text-[var(--fin-warning-text)]" aria-live="polite">
                    {problemas.map(p => <li key={p}>{p}</li>)}
                  </ul>
                ) : null}

                <div className="sticky bottom-0 z-[var(--fin-z-conteudo)] flex flex-col-reverse gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] bg-[var(--fin-bg)] py-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
                  {plano.id ? <Button type="button" variant="ghost" onClick={() => setApagar(true)}>Apagar plano</Button> : <span />}
                  <div className="flex items-center gap-[var(--fin-s-3)]">
                    <span className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">{sujo ? 'Há alterações não salvas.' : 'Tudo salvo.'}</span>
                    <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || !sujo || problemas.length > 0}>{salvando ? 'Salvando…' : 'Salvar plano'}</Button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </DataState>

      <ConfirmDialog
        aberto={apagar} onOpenChange={setApagar} tone="destrutivo"
        titulo={`Apagar o plano ${plano?.nome ?? ''}?`}
        oQueVaiAcontecer="O plano sai da lista. Plano em uso por alguma pessoa não se apaga: troque o plano dela antes."
        confirmarRotulo="Apagar plano" onConfirmar={excluir}
      />
    </MolduraDaPagina>
  );
}
