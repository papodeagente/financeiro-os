'use client';

// Configurações › Limites e aprovação (05/11/2026).
// Limites do dia a dia (desconto/acréscimo, data do pagamento, vencimento) e
// alçadas de aprovação de pagamento. Passar do limite não trava o trabalho:
// vira um pedido de aprovação com motivo.

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { Segmentado } from '@/components/fin/Segmentado';
import { MoneyField } from '@/components/fin/MoneyField';
import { Field } from '@/components/fin/Field';
import { Caixinha } from '@/components/fin/MatrizDeDireitos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

type Vencimento = 'livre' | 'so_adiantar' | 'aprovacao';
interface Bloqueios {
  desconto_max_reais: number | null; desconto_max_pct: number | null; retroagir_dias_max: number | null;
  vencimento: Vencimento; vencimento_dias_max: number | null;
}
interface Alcada {
  id: string; nome: string; ativo: boolean; categoria_id: string | null; centro_custo: string | null;
  valor_min_centavos: number | null; valor_max_centavos: number | null; aprovadores: string[]; niveis: number;
}
interface Opcao { id: string; nome: string }
interface Dados {
  bloqueios: Bloqueios; alcadas: Alcada[]; pode_editar: boolean;
  usuarios: (Opcao & { papel: string })[]; grupos: Opcao[]; categorias: Opcao[]; centros: Opcao[];
}

const PAINEL = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const SELECT = 'h-11 w-full min-w-0 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-base text-[var(--fin-text)] outline-none focus-visible:border-[var(--fin-accent)] focus-visible:ring-2 focus-visible:ring-[var(--fin-accent-ring)] disabled:opacity-60 lg:h-10 lg:text-sm';

const novoId = () => `alc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export default function LimitesEAprovacaoPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [bloq, setBloq] = useState<Bloqueios | null>(null);
  const [alcadas, setAlcadas] = useState<Alcada[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      const r = await fetch('/api/limites-e-aprovacao');
      const corpo = await r.json();
      if (!r.ok) throw new Error(corpo?.error || 'Erro ao carregar.');
      setDados(corpo);
      setBloq(corpo.bloqueios);
      setAlcadas(corpo.alcadas);
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const sujo = !!dados && !!bloq && (JSON.stringify(bloq) !== JSON.stringify(dados.bloqueios) || JSON.stringify(alcadas) !== JSON.stringify(dados.alcadas));
  const leitura = !dados?.pode_editar;

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch('/api/limites-e-aprovacao', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bloqueios: bloq, alcadas }) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo?.error || 'Não foi possível salvar.');
      toast.success('Limites e alçadas salvos.');
      await carregar();
    } catch (e) {
      toast.error('Não salvou', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  const setB = (p: Partial<Bloqueios>) => setBloq(b => (b ? { ...b, ...p } : b));
  const setA = (i: number, p: Partial<Alcada>) => setAlcadas(l => l.map((a, j) => (j === i ? { ...a, ...p } : a)));
  const mover = (i: number, passo: -1 | 1) => setAlcadas(l => {
    const j = i + passo;
    if (j < 0 || j >= l.length) return l;
    const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Limites e aprovação"
        icone={Lock}
        subtitulo="Passou do limite? Em vez de travar, o sistema pede aprovação a quem você escolher, com o motivo registrado."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />
      <DataState
        estado={erro ? 'erro' : dados && bloq ? 'ok' : 'carregando'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => void carregar() } : null}
        esqueleto={<div className={cn(PAINEL, 'h-96 animate-pulse')} />}
      >
        {dados && bloq && (
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            {leitura && (
              <p className="fin-t-body rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-4 py-3 text-[var(--fin-text-2)]">
                Só quem tem o direito &quot;Configurar limites e aprovação&quot; altera esta tela. Você está vendo as regras em vigor.
              </p>
            )}

            <section aria-labelledby="t-bloq" className={cn(PAINEL, 'flex flex-col')}>
              <header className="border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-3 sm:px-[var(--fin-s-5)]">
                <h2 id="t-bloq" className="fin-t-subhead">Limites</h2>
                <p className="fin-t-caption text-[var(--fin-text-3)]">Valem ao dar baixa e ao alterar contas a pagar e a receber. Desmarcado = livre, como hoje.</p>
              </header>
              <div className="divide-y divide-[var(--fin-border)]">
                <Limite
                  titulo="Desconto ou acréscimo acima de um valor"
                  ligado={bloq.desconto_max_reais !== null}
                  onLigar={v => setB({ desconto_max_reais: v ? 50 : null })}
                  desabilitado={leitura}
                >
                  <MoneyField rotulo="Valor máximo" valor={bloq.desconto_max_reais ?? 0} onChange={v => setB({ desconto_max_reais: v })} />
                </Limite>
                <Limite
                  titulo="Desconto acima de um percentual da conta"
                  ligado={bloq.desconto_max_pct !== null}
                  onLigar={v => setB({ desconto_max_pct: v ? 10 : null })}
                  desabilitado={leitura}
                >
                  <Numero rotulo="Percentual máximo" sufixo="%" valor={bloq.desconto_max_pct} max={100} onChange={v => setB({ desconto_max_pct: v })} />
                </Limite>
                <Limite
                  titulo="Data do pagamento longe de hoje"
                  ajuda="Para baixa com data antiga (ou futura) demais."
                  ligado={bloq.retroagir_dias_max !== null}
                  onLigar={v => setB({ retroagir_dias_max: v ? 5 : null })}
                  desabilitado={leitura}
                >
                  <Numero rotulo="Dias" sufixo="dias" valor={bloq.retroagir_dias_max} max={3650} inteiro onChange={v => setB({ retroagir_dias_max: v })} />
                </Limite>
                <div className="flex flex-col gap-3 px-[var(--fin-s-4)] py-4 sm:px-[var(--fin-s-5)]">
                  <span className="fin-t-body-strong">Mudança de vencimento</span>
                  <Segmentado<Vencimento>
                    rotulo="Mudança de vencimento"
                    valor={bloq.vencimento}
                    onChange={v => !leitura && setB({ vencimento: v })}
                    opcoes={[
                      { valor: 'livre', rotulo: 'Livre' },
                      { valor: 'so_adiantar', rotulo: 'Só adiantar' },
                      { valor: 'aprovacao', rotulo: 'Sempre pedir aprovação' },
                    ]}
                  />
                  {bloq.vencimento !== 'aprovacao' && (
                    <label className="flex flex-wrap items-center gap-3">
                      <Caixinha
                        marcada={bloq.vencimento_dias_max !== null}
                        desabilitada={leitura}
                        onChange={v => setB({ vencimento_dias_max: v ? 30 : null })}
                      />
                      <span className="fin-t-body">Pedir aprovação quando o vencimento andar mais de</span>
                      <span className="w-28">
                        <Numero rotulo="Dias do vencimento" oculto sufixo="dias" inteiro max={3650} valor={bloq.vencimento_dias_max}
                          desabilitado={leitura || bloq.vencimento_dias_max === null} onChange={v => setB({ vencimento_dias_max: v })} />
                      </span>
                    </label>
                  )}
                </div>
              </div>
            </section>

            <section aria-labelledby="t-alc" className={cn(PAINEL, 'flex flex-col')}>
              <header className="flex flex-wrap items-start gap-3 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-3 sm:px-[var(--fin-s-5)]">
                <div className="mr-auto">
                  <h2 id="t-alc" className="fin-t-subhead">Aprovação de pagamento (alçadas)</h2>
                  <p className="fin-t-caption max-w-[70ch] text-[var(--fin-text-3)]">
                    Conta a pagar que cair numa regra só é paga depois de aprovada. Vale a primeira regra da lista que servir. Sem regra, nada muda.
                  </p>
                </div>
                {!leitura && (
                  <Button variant="outline" className="gap-2" onClick={() => setAlcadas(l => [...l, {
                    id: novoId(), nome: '', ativo: true, categoria_id: null, centro_custo: null,
                    valor_min_centavos: 500_000, valor_max_centavos: null, aprovadores: ['papel:ADMIN'], niveis: 1,
                  }])}>
                    <Plus aria-hidden="true" /> Nova regra
                  </Button>
                )}
              </header>
              {alcadas.length === 0 ? (
                <p className="fin-t-body px-[var(--fin-s-4)] py-6 text-[var(--fin-text-3)] sm:px-[var(--fin-s-5)]">
                  Nenhuma regra. Exemplo: pagamentos a partir de R$ 5.000 passam pelo administrador.
                </p>
              ) : (
                <ol className="divide-y divide-[var(--fin-border)]">
                  {alcadas.map((a, i) => (
                    <li key={a.id} className="flex flex-col gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-4 sm:px-[var(--fin-s-5)]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">Regra {i + 1}</span>
                        <label className="ml-2 flex items-center gap-2">
                          <Caixinha marcada={a.ativo} desabilitada={leitura} onChange={v => setA(i, { ativo: v })} />
                          <span className="fin-t-body">Ligada</span>
                        </label>
                        {!leitura && (
                          <span className="ml-auto flex gap-1">
                            <Button variant="ghost" size="icon-sm" aria-label="Subir regra" disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp aria-hidden="true" /></Button>
                            <Button variant="ghost" size="icon-sm" aria-label="Descer regra" disabled={i === alcadas.length - 1} onClick={() => mover(i, 1)}><ArrowDown aria-hidden="true" /></Button>
                            <Button variant="ghost" size="icon-sm" aria-label="Remover regra" className="text-[var(--fin-negative-text)]" onClick={() => setAlcadas(l => l.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /></Button>
                          </span>
                        )}
                      </div>
                      <fieldset disabled={leitura} className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-3">
                        <Field rotulo="Nome da regra" ajuda="Para você reconhecer no pedido.">
                          {p => <Input {...p} value={a.nome} maxLength={80} placeholder="Ex.: Pagamentos grandes" onChange={e => setA(i, { nome: e.target.value })} />}
                        </Field>
                        <MoneyField rotulo="A partir de" valor={(a.valor_min_centavos ?? 0) / 100} onChange={v => setA(i, { valor_min_centavos: v > 0 ? Math.round(v * 100) : null })} />
                        <MoneyField rotulo="Até" ajuda="R$ 0,00 = sem limite" valor={(a.valor_max_centavos ?? 0) / 100} onChange={v => setA(i, { valor_max_centavos: v > 0 ? Math.round(v * 100) : null })} />
                        <Field rotulo="Categoria">
                          {p => (
                            <select {...p} className={SELECT} value={a.categoria_id ?? ''} onChange={e => setA(i, { categoria_id: e.target.value || null })}>
                              <option value="">Qualquer categoria</option>
                              {dados.categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                          )}
                        </Field>
                        <Field rotulo="Centro de custo">
                          {p => (
                            <select {...p} className={SELECT} value={a.centro_custo ?? ''} onChange={e => setA(i, { centro_custo: e.target.value || null })}>
                              <option value="">Qualquer centro de custo</option>
                              {dados.centros.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                          )}
                        </Field>
                        <Field rotulo="Quem aprova" ajuda="Quem pediu nunca aprova o próprio pedido.">
                          {p => (
                            <select {...p} className={SELECT} value={a.aprovadores[0] ?? ''} onChange={e => setA(i, { aprovadores: e.target.value ? [e.target.value] : [] })}>
                              <option value="">Quem tiver o direito &quot;Aprovar pagamentos&quot;</option>
                              <option value="papel:ADMIN">Um administrador</option>
                              {dados.grupos.length > 0 && (
                                <optgroup label="Perfil de acesso">
                                  {dados.grupos.map(g => <option key={g.id} value={`grupo:${g.id}`}>{g.nome}</option>)}
                                </optgroup>
                              )}
                              <optgroup label="Pessoa">
                                {dados.usuarios.map(u => <option key={u.id} value={`usuario:${u.id}`}>{u.nome}</option>)}
                              </optgroup>
                            </select>
                          )}
                        </Field>
                      </fieldset>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="fin-t-body text-[var(--fin-text-2)]">Aprovações necessárias</span>
                        <Segmentado<'1' | '2' | '3'>
                          rotulo="Aprovações necessárias"
                          valor={String(a.niveis) as '1' | '2' | '3'}
                          onChange={v => !leitura && setA(i, { niveis: Number(v) })}
                          opcoes={[{ valor: '1', rotulo: '1 pessoa' }, { valor: '2', rotulo: '2 pessoas' }, { valor: '3', rotulo: '3 pessoas' }]}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {!leitura && (
              <div className={cn(PAINEL, 'sticky bottom-[var(--fin-s-3)] flex items-center gap-3 px-[var(--fin-s-4)] py-3 shadow-[var(--fin-e1)]')}>
                <span className="fin-t-caption mr-auto text-[var(--fin-text-3)]">{sujo ? 'Alterações não salvas' : 'Tudo salvo'}</span>
                <Button variant="ghost" disabled={!sujo || salvando} onClick={() => { setBloq(dados.bloqueios); setAlcadas(dados.alcadas); }}>Descartar</Button>
                <Button className="gap-2" disabled={!sujo || salvando} onClick={() => void salvar()}>
                  <Save aria-hidden="true" /> {salvando ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            )}
          </div>
        )}
      </DataState>
    </MolduraDaPagina>
  );
}

function Limite({
  titulo, ajuda, ligado, onLigar, desabilitado, children,
}: { titulo: string; ajuda?: string; ligado: boolean; onLigar: (v: boolean) => void; desabilitado?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 px-[var(--fin-s-4)] py-4 sm:grid-cols-[1fr_220px] sm:items-center sm:px-[var(--fin-s-5)]">
      <label className="flex cursor-pointer items-start gap-3">
        <span className="pt-0.5"><Caixinha marcada={ligado} desabilitada={desabilitado} onChange={onLigar} /></span>
        <span className="flex flex-col">
          <span className="fin-t-body-strong">{titulo}</span>
          {ajuda && <span className="fin-t-caption text-[var(--fin-text-3)]">{ajuda}</span>}
        </span>
      </label>
      <fieldset disabled={desabilitado || !ligado} className={cn(!ligado && 'opacity-50')}>{children}</fieldset>
    </div>
  );
}

function Numero({
  rotulo, valor, onChange, sufixo, max, inteiro = false, oculto = false, desabilitado = false,
}: { rotulo: string; valor: number | null; onChange: (v: number) => void; sufixo: string; max: number; inteiro?: boolean; oculto?: boolean; desabilitado?: boolean }) {
  const campo = (p: Record<string, unknown>) => (
        <div className="relative">
          <Input
            {...p}
            aria-label={oculto ? rotulo : undefined}
            type="number"
            inputMode={inteiro ? 'numeric' : 'decimal'}
            min={0}
            max={max}
            step={inteiro ? 1 : 0.1}
            disabled={desabilitado}
            value={valor ?? ''}
            onChange={e => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n) || n < 0) return;
              onChange(Math.min(inteiro ? Math.floor(n) : n, max));
            }}
            className="pr-12 tabular-nums"
          />
          <span aria-hidden="true" className="fin-t-caption pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fin-text-3)]">{sufixo}</span>
        </div>
  );
  // Dentro de uma frase ("mudar mais de [30] dias") o rótulo é a própria frase.
  if (oculto) return campo({});
  return <Field rotulo={rotulo}>{p => campo(p)}</Field>;
}
