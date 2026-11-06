'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Plus, Save, Trash2 } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { Field } from '@/components/fin/Field';
import { Segmentado } from '@/components/fin/Segmentado';
import { EscolherPessoa } from '@/components/financeiro/regras-faturamento/EscolherPessoa';
import { apiRegras, carregarPessoas, type PessoaDoCadastro } from '@/components/financeiro/regras-faturamento/api';
import { api, type FuncaoDaComissao } from '@/lib/migracao/contrato-telas';
import {
  exemploDoPlano, PERGUNTA_DA_BASE, PERIODOS_DA_PERGUNTA, PLANO_EM_BRANCO, planoDasRespostas, REGRA_EM_BRANCO, regraDasRespostas,
  type BaseDoPlano, type RespostasDaRegra, type RespostasDoPlano,
} from '@/lib/migracao/telas/recriar';
import { dataBR } from '@/lib/migracao/telas/assistente';
import { INFO_DO_PERIODO, ROTULO_AJUSTE_DE_DIA, DIAS_DA_SEMANA, type AjusteDeDiaNaoUtil, type BaseDeData, type PreviaDaFatura } from '@/lib/fatura-regras';
import { ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO, type TipoProduto } from '@/lib/venda-modelo';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { BarraDoPasso, CabecaDoPasso, CONTROLE, PAINEL, type PropsDoPasso } from '../pecas';

type Aba = 'plano' | 'regra';

/**
 * Passo 8 · Recriar regras e planos (E7). O sistema anterior não exporta o
 * detalhe das regras de faturamento nem dos planos de comissão. A pessoa
 * responde perguntas simples, com exemplos do mercado, vê como fica e grava:
 * o plano vai para Planos por função e a regra para Regras de faturamento,
 * as mesmas telas da E5, onde dá para ajustar depois.
 */
export function PassoRecriar({ irPara }: PropsDoPasso) {
  const [aba, setAba] = React.useState<Aba>('plano');
  return (
    <>
      <CabecaDoPasso id="passo-recriar" titulo="Recriar regras de faturamento e planos de comissão">
        Lá, essas regras moram em telas que não exportam. Responda como a agência trabalha e o EnturOS monta cada uma; depois, ajuste quando quiser nas telas de sempre.
      </CabecaDoPasso>
      <Segmentado<Aba>
        rotulo="O que recriar"
        valor={aba}
        onChange={setAba}
        cheio="celular"
        opcoes={[{ valor: 'plano', rotulo: 'Plano de comissão' }, { valor: 'regra', rotulo: 'Regra de faturamento' }]}
      />
      {aba === 'plano' ? <PerguntasDoPlano /> : <PerguntasDaRegra />}
      <BarraDoPasso voltar={{ rotulo: 'Concluir ou desfazer', onClick: () => irPara('concluir') }} principal={{ rotulo: 'Mês em paralelo', onClick: () => irPara('paralelo') }} />
    </>
  );
}

// ─── Peças ─────────────────────────────────────────────────────────────────

/** Uma pergunta: o número dela informa a ordem em que se responde. */
function Pergunta({ n, titulo, ajuda, children }: { n: number; titulo: string; ajuda?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] first:border-t-0 first:pt-0">
      <h3 id={id} className="flex items-baseline gap-[var(--fin-s-2)] fin-t-body-strong text-[var(--fin-text)]">
        <span aria-hidden="true" className="tabular-nums text-[var(--fin-text-3)]">{n}.</span>{titulo}
      </h3>
      {ajuda ? <p className="max-w-[68ch] fin-t-caption text-[var(--fin-text-2)]">{ajuda}</p> : null}
      {children}
    </section>
  );
}

/** Escolha única com o exemplo de mercado de cada opção à mostra. */
function EscolhaComExemplo<T extends string>({ rotulo, opcoes, valor, onChange }: {
  rotulo: string; valor: T; onChange: (v: T) => void; opcoes: Array<{ valor: T; titulo: string; exemplo: string }>;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="grid grid-cols-1 gap-[var(--fin-s-2)] md:grid-cols-2">
      {opcoes.map(o => {
        const marcado = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={marcado}
            onClick={() => onChange(o.valor)}
            className={cn(
              'flex items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border px-3 py-2.5 text-left transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
              marcado ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] bg-[var(--fin-surface)] hover:border-[var(--fin-border-strong)]',
            )}
          >
            <span aria-hidden="true" className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', marcado ? 'border-[var(--fin-accent)] bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)]' : 'border-[var(--fin-border-strong)]')}>
              {marcado ? <Check className="size-3" /> : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="fin-t-body-strong text-[var(--fin-text)]">{o.titulo}</span>
              <span className="fin-t-caption text-[var(--fin-text-2)]">{o.exemplo}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CampoPercentual({ rotulo, valor, onChange, erro }: { rotulo: string; valor: number; onChange: (n: number) => void; erro?: string | null }) {
  return (
    <Field rotulo={rotulo} erro={erro ?? null}>
      {a => (
        <div className="relative w-32">
          <input
            {...a}
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            value={Number.isFinite(valor) ? valor : ''}
            onChange={e => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
            className={cn(CONTROLE, 'pr-8 text-right tabular-nums')}
          />
          <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 fin-t-body text-[var(--fin-text-3)]">%</span>
        </div>
      )}
    </Field>
  );
}

/** O painel "Como fica": frases, um exemplo e o botão de gravar. */
function ComoFica({ frases, exemplo, erros, gravar, gravando, gravado, rotuloGravar, extra }: {
  frases: string[]; exemplo?: React.ReactNode; erros: string[]; gravar: () => void; gravando: boolean;
  gravado: { rotulo: string; href: string } | null; rotuloGravar: string; extra?: React.ReactNode;
}) {
  return (
    <aside aria-label="Como fica" className={`${PAINEL} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-5)] lg:sticky lg:top-[var(--fin-s-5)]`}>
      <h3 className="fin-t-subhead text-[var(--fin-text)]">Como fica</h3>
      <ul className="flex flex-col gap-1.5">
        {frases.map(f => (
          <li key={f} className="flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)]">
            <Check aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-[var(--fin-positive)]" />{f}
          </li>
        ))}
      </ul>
      {exemplo ? <div className="rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-3 py-2 fin-t-body text-[var(--fin-text-2)]">{exemplo}</div> : null}
      {extra}
      {erros.length ? (
        <ul className="flex flex-col gap-1" aria-live="polite">
          {erros.map(e => <li key={e} className="fin-t-caption text-[var(--fin-negative-text)]">{e}</li>)}
        </ul>
      ) : null}
      {gravado ? (
        <Callout tom="positivo" titulo="Gravado">
          Confira e ajuste quando quiser em <Link href={gravado.href} className="text-[var(--fin-accent)] underline underline-offset-2">{gravado.rotulo}</Link>.
        </Callout>
      ) : null}
      <Button onClick={gravar} disabled={erros.length > 0 || gravando} aria-busy={gravando || undefined} className="self-start max-sm:w-full max-sm:self-stretch">
        <Save aria-hidden="true" /> {rotuloGravar}
      </Button>
    </aside>
  );
}

// ─── Plano de comissão ─────────────────────────────────────────────────────

function PerguntasDoPlano() {
  const [r, setR] = React.useState<RespostasDoPlano>(PLANO_EM_BRANCO);
  const [funcoes, setFuncoes] = React.useState<FuncaoDaComissao[]>([]);
  const [gravando, setGravando] = React.useState(false);
  const [gravado, setGravado] = React.useState(false);
  const [tocado, setTocado] = React.useState(false);
  const mudar = (p: Partial<RespostasDoPlano>) => { setR(atual => ({ ...atual, ...p })); setGravado(false); };

  React.useEffect(() => {
    const c = new AbortController();
    api.funcoesDaComissao(c.signal).then(setFuncoes).catch(() => setFuncoes([]));
    return () => c.abort();
  }, []);

  const { plano, erros, frases } = planoDasRespostas(r);
  const produtosLivres = TIPOS_PRODUTO.filter(t => !r.por_produto.some(p => p.produto === t));

  async function gravar() {
    setTocado(true);
    if (erros.length) return;
    setGravando(true);
    try {
      await api.salvarPlano(plano);
      setGravado(true);
      toast.success(`Plano "${r.nome.trim()}" gravado.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para gravar o plano. Tente de novo.');
    } finally {
      setGravando(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-[var(--fin-s-5)] lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className={`${PAINEL} flex flex-col gap-[var(--fin-s-4)] p-[var(--fin-s-5)]`}>
        <Pergunta n={1} titulo="Como o plano se chama?" ajuda="O nome que a equipe reconhece. Ex.: Plano dos consultores, Plano da loja do centro.">
          <Field rotulo="Nome do plano" obrigatorio erro={tocado && !r.nome.trim() ? 'Dê um nome ao plano.' : null}>
            {a => <input {...a} value={r.nome} onChange={e => mudar({ nome: e.target.value })} className={cn(CONTROLE, 'max-w-md')} placeholder="Plano dos consultores" />}
          </Field>
        </Pergunta>

        <Pergunta n={2} titulo="Para quem vale?" ajuda="A função de quem recebe. Quem está em cada função se escolhe em Equipe › Funções.">
          <Field rotulo="Função">
            {a => (
              <select {...a} value={r.funcao_id} onChange={e => mudar({ funcao_id: e.target.value })} className={cn(CONTROLE, 'max-w-md')}>
                <option value="*">Todas as funções</option>
                {funcoes.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            )}
          </Field>
        </Pergunta>

        <Pergunta n={3} titulo="A comissão é calculada sobre o quê?">
          <EscolhaComExemplo<BaseDoPlano>
            rotulo="Base da comissão"
            valor={r.sobre}
            onChange={v => mudar({ sobre: v })}
            opcoes={(Object.keys(PERGUNTA_DA_BASE) as BaseDoPlano[]).map(b => ({ valor: b, titulo: PERGUNTA_DA_BASE[b].rotulo, exemplo: PERGUNTA_DA_BASE[b].exemplo }))}
          />
        </Pergunta>

        <Pergunta n={4} titulo="Quanto paga?" ajuda="O percentual de quase todas as vendas.">
          <CampoPercentual rotulo="Percentual" valor={r.percentual} onChange={n => mudar({ percentual: n })} />
        </Pergunta>

        <Pergunta n={5} titulo="Algum produto paga diferente?" ajuda="Ex.: seguro viagem paga 20% e aéreo, 3%. Deixe vazio se todos pagam igual.">
          <ul className="flex flex-col gap-[var(--fin-s-2)]">
            {r.por_produto.map((p, i) => (
              <li key={p.produto} className="flex flex-wrap items-end gap-[var(--fin-s-3)]">
                <Field rotulo="Produto">
                  {a => (
                    <select {...a} value={p.produto} onChange={e => mudar({ por_produto: r.por_produto.map((x, j) => (j === i ? { ...x, produto: e.target.value as TipoProduto } : x)) })} className={cn(CONTROLE, 'w-56')}>
                      {[p.produto, ...produtosLivres].map(t => <option key={t} value={t}>{ROTULO_TIPO_PRODUTO[t]}</option>)}
                    </select>
                  )}
                </Field>
                <CampoPercentual rotulo="Percentual" valor={p.percentual} onChange={n => mudar({ por_produto: r.por_produto.map((x, j) => (j === i ? { ...x, percentual: n } : x)) })} />
                <Button variant="ghost" size="icon" aria-label={`Tirar ${ROTULO_TIPO_PRODUTO[p.produto]}`} onClick={() => mudar({ por_produto: r.por_produto.filter((_, j) => j !== i) })}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          {produtosLivres.length ? (
            <Button variant="outline" size="sm" className="self-start" onClick={() => mudar({ por_produto: [...r.por_produto, { produto: produtosLivres[0], percentual: r.percentual }] })}>
              <Plus aria-hidden="true" /> Um produto que paga diferente
            </Button>
          ) : null}
        </Pergunta>

        <Pergunta n={6} titulo="Muda conforme a meta?" ajuda="Ex.: até a meta, 8%; a partir de 100% da meta, 10%; a partir de 120%, 12%. As metas de cada mês ficam em Equipe › Funções.">
          <Segmentado<'nao' | 'sim'>
            rotulo="Muda conforme a meta"
            valor={r.faixas.length ? 'sim' : 'nao'}
            onChange={v => mudar({ faixas: v === 'sim' ? (r.faixas.length ? r.faixas : [{ a_partir: 100, percentual: r.percentual + 2 }]) : [] })}
            opcoes={[{ valor: 'nao', rotulo: 'Não' }, { valor: 'sim', rotulo: 'Sim, por faixas' }]}
          />
          {r.faixas.length ? (
            <div className="flex flex-col gap-[var(--fin-s-3)]">
              <ul className="flex flex-col gap-[var(--fin-s-2)]">
                {r.faixas.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-end gap-[var(--fin-s-3)]">
                    <CampoPercentual rotulo="A partir de (da meta)" valor={f.a_partir} onChange={n => mudar({ faixas: r.faixas.map((x, j) => (j === i ? { ...x, a_partir: n } : x)) })} />
                    <CampoPercentual rotulo="Paga" valor={f.percentual} onChange={n => mudar({ faixas: r.faixas.map((x, j) => (j === i ? { ...x, percentual: n } : x)) })} />
                    <Button variant="ghost" size="icon" aria-label="Tirar a faixa" onClick={() => mudar({ faixas: r.faixas.filter((_, j) => j !== i) })}><Trash2 aria-hidden="true" /></Button>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" className="self-start" onClick={() => mudar({ faixas: [...r.faixas, { a_partir: (r.faixas.at(-1)?.a_partir ?? 100) + 20, percentual: (r.faixas.at(-1)?.percentual ?? r.percentual) + 2 }] })}>
                <Plus aria-hidden="true" /> Outra faixa
              </Button>
              <EscolhaComExemplo<'DEGRAU' | 'PROGRESSIVA'>
                rotulo="Como a faixa vale"
                valor={r.modo}
                onChange={v => mudar({ modo: v })}
                opcoes={[
                  { valor: 'DEGRAU', titulo: 'Em degrau', exemplo: 'Bateu 100% da meta: o percentual novo vale para todas as vendas do mês.' },
                  { valor: 'PROGRESSIVA', titulo: 'Progressiva', exemplo: 'Até a meta paga o percentual de baixo; só o que passar dela paga o de cima.' },
                ]}
              />
            </div>
          ) : null}
        </Pergunta>

        <Pergunta n={7} titulo="Venda com intermediário paga diferente?" ajuda="Quando outra agência ou um consolidador trouxe a venda e ficou com uma parte. Ex.: nesses casos, 5% em vez de 10%.">
          <Segmentado<'nao' | 'sim'>
            rotulo="Com intermediário paga diferente"
            valor={r.com_intermediario === null ? 'nao' : 'sim'}
            onChange={v => mudar({ com_intermediario: v === 'sim' ? Math.round(r.percentual / 2 * 100) / 100 : null })}
            opcoes={[{ valor: 'nao', rotulo: 'Não, igual' }, { valor: 'sim', rotulo: 'Sim' }]}
          />
          {r.com_intermediario !== null ? <CampoPercentual rotulo="Com intermediário, paga" valor={r.com_intermediario} onChange={n => mudar({ com_intermediario: n })} /> : null}
        </Pergunta>
      </div>

      <ComoFica
        frases={frases}
        exemplo={Number.isFinite(r.percentual) ? exemploDoPlano(r) : null}
        erros={tocado ? erros : erros.filter(e => !e.startsWith('Dê um nome'))}
        gravar={() => { void gravar(); }}
        gravando={gravando}
        gravado={gravado ? { rotulo: 'Planos por função', href: '/equipe/planos-por-funcao' } : null}
        rotuloGravar="Gravar o plano"
      />
    </div>
  );
}

// ─── Regra de faturamento ──────────────────────────────────────────────────

function PerguntasDaRegra() {
  const [r, setR] = React.useState<RespostasDaRegra>(REGRA_EM_BRANCO);
  const [pessoas, setPessoas] = React.useState<PessoaDoCadastro[]>([]);
  const [carregando, setCarregando] = React.useState(true);
  const [proximas, setProximas] = React.useState<PreviaDaFatura[] | null>(null);
  const [gravando, setGravando] = React.useState(false);
  const [gravado, setGravado] = React.useState(false);
  const [tocado, setTocado] = React.useState(false);
  const mudar = (p: Partial<RespostasDaRegra>) => { setR(atual => ({ ...atual, ...p })); setGravado(false); };

  React.useEffect(() => {
    const c = new AbortController();
    carregarPessoas('CLIENTE', c.signal).then(setPessoas).catch(() => setPessoas([])).finally(() => setCarregando(false));
    return () => c.abort();
  }, []);

  const { regra, erros, frases } = regraDasRespostas(r);
  const chaveDaPrevia = JSON.stringify(regra);
  React.useEffect(() => {
    if (!r.pessoa) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      apiRegras.previa(JSON.parse(chaveDaPrevia), c.signal).then(p => setProximas(p.proximas)).catch(() => setProximas(null));
    }, 300);
    return () => { clearTimeout(t); c.abort(); };
  }, [chaveDaPrevia, r.pessoa]);

  async function gravar() {
    setTocado(true);
    if (erros.length) return;
    setGravando(true);
    try {
      await apiRegras.criar(regra);
      setGravado(true);
      toast.success(`Regra de ${r.pessoa?.nome ?? 'cliente'} gravada.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para gravar a regra. Tente de novo.');
    } finally {
      setGravando(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-[var(--fin-s-5)] lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className={`${PAINEL} flex flex-col gap-[var(--fin-s-4)] p-[var(--fin-s-5)]`}>
        <Pergunta n={1} titulo="Para qual cliente?" ajuda="O cliente corporativo que recebe fatura. Uma regra por cliente; regra por fornecedor e por produto se faz na tela de Regras de faturamento.">
          <Field rotulo="Cliente" obrigatorio erro={tocado && !r.pessoa ? 'Escolha o cliente.' : null}>
            {a => <EscolherPessoa id={a.id} describedBy={a['aria-describedby']} invalido={a['aria-invalid']} valor={r.pessoa} pessoas={pessoas} carregando={carregando} onChange={p => mudar({ pessoa: p })} placeholder="Nome ou CNPJ do cliente" />}
          </Field>
        </Pergunta>

        <Pergunta n={2} titulo="De quanto em quanto tempo a fatura fecha?">
          <EscolhaComExemplo
            rotulo="Período da fatura"
            valor={r.periodo}
            onChange={v => mudar({ periodo: v })}
            opcoes={PERIODOS_DA_PERGUNTA.map(p => ({ valor: p.periodo, titulo: INFO_DO_PERIODO[p.periodo].rotulo, exemplo: p.exemplo }))}
          />
          {r.periodo === 'SEMANAL' ? (
            <Field rotulo="A semana começa">
              {a => (
                <select {...a} value={r.inicio_semana} onChange={e => mudar({ inicio_semana: Number(e.target.value) })} className={cn(CONTROLE, 'w-56')}>
                  {DIAS_DA_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              )}
            </Field>
          ) : null}
        </Pergunta>

        <Pergunta n={3} titulo="Cada venda entra na fatura pela data de quê?">
          <EscolhaComExemplo<BaseDeData>
            rotulo="Data que decide a fatura"
            valor={r.faturar_por}
            onChange={v => mudar({ faturar_por: v })}
            opcoes={[
              { valor: 'VENDA', titulo: 'Da venda', exemplo: 'Vendeu em 12/03: entra na fatura de março.' },
              { valor: 'INICIO', titulo: 'Do início da viagem', exemplo: 'Embarca em 05/04: entra na fatura de abril, mesmo vendida antes.' },
              { valor: 'FIM', titulo: 'Do fim da viagem', exemplo: 'Volta em 20/04: só fatura depois que a viagem acaba.' },
            ]}
          />
        </Pergunta>

        <Pergunta n={4} titulo="Vence quantos dias depois de fechar?" ajuda="Ex.: fecha no fim do mês e vence 10 dias depois.">
          <Field rotulo="Dias">
            {a => <input {...a} type="number" inputMode="numeric" min={0} max={120} value={r.prazo_dias} onChange={e => mudar({ prazo_dias: Number(e.target.value) })} className={cn(CONTROLE, 'w-32 text-right tabular-nums')} />}
          </Field>
        </Pergunta>

        <Pergunta n={5} titulo="Se o vencimento cair em sábado, domingo ou feriado?">
          <Segmentado<AjusteDeDiaNaoUtil>
            rotulo="Vencimento em dia sem expediente"
            valor={r.dia_nao_util}
            onChange={v => mudar({ dia_nao_util: v })}
            cheio="celular"
            opcoes={(['PROXIMO', 'ANTERIOR', 'NAO_ALTERAR'] as AjusteDeDiaNaoUtil[]).map(a => ({ valor: a, rotulo: ROTULO_AJUSTE_DE_DIA[a] }))}
          />
        </Pergunta>
      </div>

      <ComoFica
        frases={frases}
        erros={tocado ? erros : []}
        gravar={() => { void gravar(); }}
        gravando={gravando}
        gravado={gravado ? { rotulo: 'Regras de faturamento', href: '/financeiro-ag/regras-faturamento' } : null}
        rotuloGravar="Gravar a regra"
        extra={r.pessoa && proximas && proximas.length ? (
          <div className="flex flex-col gap-1">
            <p className="fin-t-caption font-medium text-[var(--fin-text-2)]">Próximas faturas</p>
            <ul className="flex flex-col gap-0.5">
              {proximas.slice(0, 3).map(p => (
                <li key={`${p.inicio}-${p.fim}`} className="flex justify-between gap-[var(--fin-s-3)] fin-t-body tabular-nums text-[var(--fin-text)]">
                  <span>{dataBR(p.inicio)} a {dataBR(p.fim)}</span>
                  <span className="text-[var(--fin-text-2)]">vence {dataBR(p.vencimento)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      />
      <p className="lg:col-span-2 fin-t-caption text-[var(--fin-text-3)]">
        Mais detalhes (produto, fornecedor, retenções, modelo da fatura) na tela{' '}
        <Link href="/financeiro-ag/regras-faturamento" className={cn(buttonVariants({ variant: 'link' }), 'h-auto p-0 fin-t-caption')}>Regras de faturamento</Link>.
      </p>
    </div>
  );
}
