'use client';

import * as React from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';

import { Callout } from '@/components/fin/Callout';
import { Field } from '@/components/fin/Field';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { Input } from '@/components/ui/input';
import {
  AJUSTES_DE_DIA, CAMPOS_DA_FATURA, DIAS_DA_SEMANA, INFO_DO_MODELO, INFO_DO_PERIODO, MODELOS_DE_FATURA, NOMES_DAS_RETENCOES, PERIODOS,
  ROTULO_AJUSTE_DE_DIA, ROTULO_TIPO_DE_PESSOA, normalizarRegra, validarFaixas,
  type CampoDaFatura, type ConfigRetencoes, type FaixaCustomizada, type PreviaDaFatura, type RegraDeFaturamento, type TipoDePessoaDaRegra,
} from '@/lib/fatura-regras';
import { dataBR } from '@/lib/cobranca/regras-telas';
import { ROTULO_TIPO_PRODUTO, TIPOS_PRODUTO } from '@/lib/venda-modelo';
import { cn } from '@/lib/utils';
import { apiRegras, carregarPessoas, ErroDaTela, type PessoaDoCadastro } from './api';
import { EscolherPessoa } from './EscolherPessoa';

/**
 * Editor da Regra de faturamento (E5, parte B). À esquerda, a regra em
 * grupos (de quem, período, vencimento, documento, retenções); à direita, a
 * prévia ao vivo das próximas 3 faturas com o vencimento já ajustado para
 * fim de semana e feriado. No celular a prévia vem logo depois do período.
 */

const SELECT = 'h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] disabled:opacity-60 lg:h-10';
const GRUPO = 'flex flex-col gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)] first:border-t-0 first:pt-0';
const TITULO_GRUPO = 'fin-t-body-strong text-[var(--fin-text)]';

export type Rascunho = Omit<RegraDeFaturamento, 'id'> & { id: string };

export function regraNova(tipo: TipoDePessoaDaRegra): Rascunho {
  return { ...normalizarRegra({ pessoa_tipo: tipo, periodo: 'MENSAL', prazo_dias: 10, faturar_por: 'VENDA' }).regra, id: '' };
}

const SEMANAIS = new Set(['SEMANAL', 'SEMANAL_MES']);

function CampoPercentual({ id, valor, onChange, rotulo }: { id: string; valor: number; onChange: (v: number) => void; rotulo: string }) {
  const fmt = (v: number) => (v ? String(v).replace('.', ',') : '');
  const [texto, setTexto] = React.useState(fmt(valor));
  const [focado, setFocado] = React.useState(false);
  React.useEffect(() => { if (!focado) setTexto(fmt(valor)); }, [valor, focado]);
  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={rotulo}
        inputMode="decimal"
        value={texto}
        placeholder="0"
        className="pr-8 text-right tabular-nums"
        onFocus={() => setFocado(true)}
        onBlur={() => setFocado(false)}
        onChange={e => {
          const t = e.target.value.replace(/[^\d,.]/g, '');
          setTexto(t);
          const n = Number(t.replace(',', '.'));
          onChange(Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);
        }}
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center fin-t-caption text-[var(--fin-text-3)]">%</span>
    </div>
  );
}

function EditorDeFaixas({ faixas, onChange }: { faixas: FaixaCustomizada[]; onChange: (f: FaixaCustomizada[]) => void }) {
  const erros = validarFaixas(faixas);
  const errosPorLinha = (i: number) => erros.filter(e => e.campo.startsWith(`faixas.${i}`)).map(e => e.mensagem);
  const errosGerais = erros.filter(e => e.campo === 'faixas').map(e => e.mensagem);
  const mudar = (i: number, patch: Partial<FaixaCustomizada>) => onChange(faixas.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const proximoDe = faixas.length ? Math.min(31, faixas[faixas.length - 1].ate + 1) : 1;
  const numero = (v: string) => Math.trunc(Number(v.replace(/\D/g, '')) || 0);
  return (
    <div className="flex flex-col gap-[var(--fin-s-2)]">
      <ul className="flex flex-col gap-[var(--fin-s-2)]">
        {faixas.map((f, i) => (
          <li key={i} className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-2)]">
            <div className="flex flex-wrap items-center gap-x-[var(--fin-s-2)] gap-y-1 fin-t-body text-[var(--fin-text-2)]">
              <span>Do dia</span>
              <Input aria-label={`Faixa ${i + 1}: primeiro dia`} inputMode="numeric" value={f.de || ''} onChange={e => mudar(i, { de: numero(e.target.value) })} className="w-16 text-center tabular-nums" />
              <span>ao dia</span>
              <Input aria-label={`Faixa ${i + 1}: último dia`} inputMode="numeric" value={f.ate || ''} onChange={e => mudar(i, { ate: numero(e.target.value) })} className="w-16 text-center tabular-nums" />
              <span>vence no dia</span>
              <Input aria-label={`Faixa ${i + 1}: dia do vencimento`} inputMode="numeric" value={f.vence_dia || ''} onChange={e => mudar(i, { vence_dia: numero(e.target.value) })} className="w-16 text-center tabular-nums" />
              <select
                aria-label={`Faixa ${i + 1}: mês do vencimento`}
                value={f.vence_mes}
                onChange={e => mudar(i, { vence_mes: e.target.value === '1' ? 1 : 0 })}
                className={cn(SELECT, 'w-auto')}
              >
                <option value={0}>do mesmo mês</option>
                <option value={1}>do mês seguinte</option>
              </select>
              <button
                type="button"
                onClick={() => onChange(faixas.filter((_, j) => j !== i))}
                aria-label={`Tirar a faixa ${i + 1}`}
                className="ml-auto inline-flex size-11 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface)] hover:text-[var(--fin-negative-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:size-10"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
            {errosPorLinha(i).map(m => <p key={m} role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{m}</p>)}
          </li>
        ))}
      </ul>
      {errosGerais.map(m => <p key={m} role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{m}</p>)}
      {proximoDe <= 31 || !faixas.length ? (
        <button
          type="button"
          onClick={() => onChange([...faixas, { de: proximoDe, ate: 31, vence_dia: 10, vence_mes: 1 }])}
          className="inline-flex min-h-11 w-fit items-center gap-1 rounded-[var(--fin-r-md)] px-2 fin-t-body text-[var(--fin-accent)] hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:min-h-9"
        >
          <Plus aria-hidden="true" className="size-4" /> Incluir faixa {faixas.length ? `a partir do dia ${proximoDe}` : ''}
        </button>
      ) : null}
    </div>
  );
}

function PreviaDasFaturas({ previa, descricao, carregando, erro }: { previa: PreviaDaFatura[]; descricao: string; carregando: boolean; erro: string | null }) {
  const tituloId = React.useId();
  return (
    <section aria-labelledby={tituloId} aria-busy={carregando} className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] p-[var(--fin-s-4)]">
      <div className="flex items-center gap-[var(--fin-s-2)]">
        <CalendarClock aria-hidden="true" className="size-4 text-[var(--fin-accent)]" />
        <h3 id={tituloId} className="fin-t-body-strong text-[var(--fin-text)]">Próximas 3 faturas</h3>
      </div>
      {descricao ? <p className="fin-t-caption text-[var(--fin-text-2)]">{descricao}</p> : null}
      {erro ? <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erro}</p> : null}
      {!erro && !previa.length && !carregando ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">Complete a regra para ver as próximas faturas.</p>
      ) : null}
      <ol className={cn('flex flex-col gap-[var(--fin-s-2)] transition-opacity duration-[var(--fin-dur-base)]', carregando && 'opacity-60')}>
        {previa.map((p, i) => (
          <li key={`${p.inicio}-${i}`} className="flex flex-col gap-0.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-3)]">
            <span className="fin-t-caption text-[var(--fin-text-3)]">
              {p.inicio === p.fim ? `Itens de ${dataBR(p.inicio)}` : `Itens de ${dataBR(p.inicio)} a ${dataBR(p.fim)}`}
            </span>
            <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">Vence em {dataBR(p.vencimento)}</span>
            {p.ajuste ? (
              <span className="fin-t-caption text-[var(--fin-warning-text)]">
                {dataBR(p.sem_ajuste)} · {p.ajuste}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function EditorDeRegra({
  aberto, inicial, onFechar, onSalvo, onAbrirExistente, onDesligar,
}: {
  aberto: boolean;
  inicial: Rascunho | null;
  onFechar: () => void;
  onSalvo: (regra: RegraDeFaturamento, nova: boolean) => void;
  onAbrirExistente: (id: string) => void;
  onDesligar: (regra: Rascunho) => void;
}) {
  const [r, setR] = React.useState<Rascunho | null>(inicial);
  const [sujo, setSujo] = React.useState(false);
  const [tentou, setTentou] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erroServidor, setErroServidor] = React.useState<{ mensagem: string; existente?: string } | null>(null);
  const [pessoas, setPessoas] = React.useState<PessoaDoCadastro[]>([]);
  const [fornecedores, setFornecedores] = React.useState<PessoaDoCadastro[]>([]);
  const [carregandoPessoas, setCarregandoPessoas] = React.useState(false);
  const [previa, setPrevia] = React.useState<{ proximas: PreviaDaFatura[]; descricao: string; erro: string | null; carregando: boolean }>({ proximas: [], descricao: '', erro: null, carregando: false });

  React.useEffect(() => {
    setR(inicial); setSujo(false); setTentou(false); setErroServidor(null);
  }, [inicial]);

  const tipo = r?.pessoa_tipo ?? 'CLIENTE';
  React.useEffect(() => {
    if (!aberto) return;
    const ac = new AbortController();
    setCarregandoPessoas(true);
    Promise.all([
      carregarPessoas(tipo, ac.signal),
      tipo === 'CLIENTE' || tipo === 'REPRESENTANTE' ? carregarPessoas('FORNECEDOR', ac.signal) : Promise.resolve<PessoaDoCadastro[]>([]),
    ])
      .then(([ps, fs]) => { setPessoas(ps); setFornecedores(tipo === 'FORNECEDOR' ? ps : fs); })
      .catch(() => { if (!ac.signal.aborted) { setPessoas([]); setFornecedores([]); } })
      .finally(() => { if (!ac.signal.aborted) setCarregandoPessoas(false); });
    return () => ac.abort();
  }, [aberto, tipo]);

  // Prévia ao vivo, com respiro de 350 ms entre as teclas.
  const chaveDaPrevia = r ? JSON.stringify({ ...r, descricao: '', solicitante: '', centro_custo: '', campos: [], retencoes: null, pessoa_nome: '' }) : '';
  React.useEffect(() => {
    if (!aberto || !r) return;
    const ac = new AbortController();
    setPrevia(p => ({ ...p, carregando: true }));
    const t = window.setTimeout(() => {
      apiRegras.previa(r, ac.signal)
        .then(res => setPrevia({ proximas: res.proximas, descricao: res.descricao, erro: res.erros[0]?.mensagem ?? null, carregando: false }))
        .catch(e => { if (!ac.signal.aborted) setPrevia(p => ({ ...p, carregando: false, erro: e instanceof ErroDaTela ? e.message : 'A prévia não respondeu.' })); });
    }, 350);
    return () => { window.clearTimeout(t); ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a prévia depende só do que muda o calendário
  }, [aberto, chaveDaPrevia]);

  if (!r) return null;
  const mudar = (patch: Partial<Rascunho>) => { setR(atual => (atual ? { ...atual, ...patch } : atual)); setSujo(true); setErroServidor(null); };
  const mudarRetencao = (patch: Partial<ConfigRetencoes>) => mudar({ retencoes: { ...r.retencoes, ...patch } });

  const { erros } = normalizarRegra(r);
  const erroDe = (campo: string) => (tentou ? erros.find(e => e.campo === campo)?.mensagem ?? null : null);
  const ehCliente = r.pessoa_tipo === 'CLIENTE';
  const customizado = r.periodo === 'CUSTOMIZADO';
  const avulso = r.periodo === 'AVULSO';
  const rotuloPessoa = ROTULO_TIPO_DE_PESSOA[r.pessoa_tipo];

  async function salvar() {
    setTentou(true);
    if (!r || normalizarRegra(r).erros.length) return;
    setSalvando(true);
    try {
      const nova = !r.id;
      const res = nova ? await apiRegras.criar(r) : await apiRegras.alterar(r.id, r);
      setSujo(false);
      onSalvo(res.regra, nova);
    } catch (e) {
      if (e instanceof ErroDaTela && e.codigo === 'REGRA_REPETIDA') {
        setErroServidor({ mensagem: e.message, existente: typeof e.detalhes?.regra_id === 'string' ? e.detalhes.regra_id : undefined });
      } else setErroServidor({ mensagem: e instanceof Error ? e.message : 'Não foi possível salvar.' });
    } finally {
      setSalvando(false);
    }
  }

  const previaEl = <PreviaDasFaturas previa={previa.proximas} descricao={previa.descricao} carregando={previa.carregando} erro={previa.erro} />;

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={r.id ? `Regra de ${r.pessoa_nome || rotuloPessoa.toLowerCase()}` : `Nova regra para ${rotuloPessoa.toLowerCase()}`}
      descricao={ehCliente
        ? 'Diz como os itens da forma Faturar viram fatura: de quanto em quanto tempo, por qual data e quando vence.'
        : `Diz de quanto em quanto tempo e quando vence a fatura do ${rotuloPessoa.toLowerCase()}.`}
      largura={960}
      sujo={sujo}
      resumo={previa.proximas[0] && !erros.length ? `A próxima fatura junta os itens de ${dataBR(previa.proximas[0].inicio)}${previa.proximas[0].fim !== previa.proximas[0].inicio ? ` a ${dataBR(previa.proximas[0].fim)}` : ''} e vence em ${dataBR(previa.proximas[0].vencimento)}.` : undefined}
      acaoPrimaria={{ rotulo: r.id ? 'Salvar a regra' : 'Criar a regra', onClick: salvar, carregando: salvando }}
      acaoSecundaria={{ rotulo: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-[var(--fin-s-5)] lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-[var(--fin-s-4)]">
          {erroServidor ? (
            <Callout
              tom="aviso"
              titulo={erroServidor.existente ? 'Já existe uma regra igual' : 'A regra não foi salva'}
              acao={erroServidor.existente ? { rotulo: 'Abrir a regra que já existe', onClick: () => onAbrirExistente(erroServidor.existente!) } : undefined}
            >
              {erroServidor.mensagem}
            </Callout>
          ) : null}

          <section className={GRUPO} aria-label="De quem é a regra">
            <h3 className={TITULO_GRUPO}>De quem</h3>
            <Field rotulo={rotuloPessoa} obrigatorio erro={erroDe('pessoa_id')}>
              {a => (
                <EscolherPessoa
                  id={a.id} describedBy={a['aria-describedby']} invalido={a['aria-invalid']}
                  valor={r.pessoa_id ? { id: r.pessoa_id, nome: r.pessoa_nome } : null}
                  pessoas={pessoas} carregando={carregandoPessoas}
                  placeholder={`Buscar ${rotuloPessoa.toLowerCase()} pelo nome ou CPF/CNPJ`}
                  desabilitado={Boolean(r.id)}
                  onChange={p => mudar({ pessoa_id: p?.id ?? '', pessoa_nome: p?.nome ?? '' })}
                />
              )}
            </Field>
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
              <Field rotulo="Só para o produto" ajuda="Vazio: vale para todos os produtos.">
                {a => (
                  <select {...a} className={SELECT} value={r.produto_tipo} onChange={e => mudar({ produto_tipo: e.target.value })}>
                    <option value="">Todos os produtos</option>
                    {TIPOS_PRODUTO.map(t => <option key={t} value={t}>{ROTULO_TIPO_PRODUTO[t]}</option>)}
                  </select>
                )}
              </Field>
              {r.pessoa_tipo !== 'FORNECEDOR' ? (
                <Field rotulo="Só para o fornecedor" ajuda="Vazio: vale para todos os fornecedores.">
                  {a => (
                    <EscolherPessoa
                      id={a.id} describedBy={a['aria-describedby']}
                      valor={r.fornecedor_id ? { id: r.fornecedor_id, nome: r.fornecedor_nome } : null}
                      pessoas={fornecedores} carregando={carregandoPessoas}
                      placeholder="Todos os fornecedores"
                      onChange={p => mudar({ fornecedor_id: p?.id ?? '', fornecedor_nome: p?.nome ?? '' })}
                    />
                  )}
                </Field>
              ) : null}
            </div>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Com mais de uma regra para a mesma pessoa, vale a mais específica: produto e fornecedor, depois só o produto, só o fornecedor, e por fim a geral.
            </p>
          </section>

          <section className={GRUPO} aria-label="Período">
            <h3 className={TITULO_GRUPO}>Período</h3>
            <Field rotulo="De quanto em quanto tempo" ajuda={INFO_DO_PERIODO[r.periodo].ajuda}>
              {a => (
                <select {...a} className={SELECT} value={r.periodo} onChange={e => {
                  const periodo = e.target.value as Rascunho['periodo'];
                  mudar({ periodo, ...(periodo === 'CUSTOMIZADO' && !r.faixas.length ? { faixas: [{ de: 1, ate: 15, vence_dia: 25, vence_mes: 0 }, { de: 16, ate: 31, vence_dia: 10, vence_mes: 1 }] } : {}) });
                }}>
                  {PERIODOS.map(p => <option key={p} value={p}>{INFO_DO_PERIODO[p].rotulo}</option>)}
                </select>
              )}
            </Field>
            {SEMANAIS.has(r.periodo) ? (
              <Field rotulo="A semana começa na">
                {a => (
                  <select {...a} className={SELECT} value={r.inicio_semana} onChange={e => mudar({ inicio_semana: Number(e.target.value) })}>
                    {DIAS_DA_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                )}
              </Field>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="fin-t-body-strong text-[var(--fin-text)]">{avulso ? 'Contar o prazo a partir da' : 'Cada item entra no período pela'}</span>
              <Segmentado
                rotulo="Data que decide"
                valor={r.faturar_por}
                onChange={v => mudar({ faturar_por: v })}
                opcoes={[{ valor: 'VENDA', rotulo: 'Data da venda' }, { valor: 'INICIO', rotulo: 'Início da viagem' }, { valor: 'FIM', rotulo: 'Fim da viagem' }]}
                cheio="celular"
              />
              <span className="fin-t-caption text-[var(--fin-text-3)]">Sem a data da viagem, vale a data da venda.</span>
            </div>
            {customizado ? (
              <div className="flex flex-col gap-1">
                <span className="fin-t-body-strong text-[var(--fin-text)]">Faixas de dias do mês</span>
                <EditorDeFaixas faixas={r.faixas} onChange={faixas => mudar({ faixas })} />
              </div>
            ) : null}
          </section>

          <div className="lg:hidden">{previaEl}</div>

          <section className={GRUPO} aria-label="Vencimento">
            <h3 className={TITULO_GRUPO}>Vencimento</h3>
            {!customizado ? (
              <div className="flex flex-col gap-1">
                <span className="fin-t-body-strong text-[var(--fin-text)]" id="prazo-rotulo">Vence</span>
                <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
                  <Input
                    aria-labelledby="prazo-rotulo" aria-invalid={Boolean(erroDe('prazo_dias'))}
                    inputMode="numeric" value={String(r.prazo_dias)} className="w-20 text-center tabular-nums"
                    onChange={e => mudar({ prazo_dias: Math.trunc(Number(e.target.value.replace(/\D/g, '')) || 0) })}
                  />
                  <span className="fin-t-body text-[var(--fin-text-2)]">{r.prazo_dias === 1 ? 'dia' : 'dias'}</span>
                  <Segmentado
                    rotulo="Antes ou depois"
                    valor={r.sentido}
                    onChange={v => mudar({ sentido: v })}
                    opcoes={[{ valor: 'DEPOIS', rotulo: 'depois' }, { valor: 'ANTES', rotulo: 'antes' }]}
                  />
                  <span className="fin-t-body text-[var(--fin-text-2)]">{avulso ? 'da data escolhida' : 'do fim do período'}</span>
                </div>
                {erroDe('prazo_dias') ? <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erroDe('prazo_dias')}</p> : null}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
              <Field rotulo="Se cair em sábado, domingo ou feriado">
                {a => (
                  <select {...a} className={SELECT} value={r.dia_nao_util} onChange={e => mudar({ dia_nao_util: e.target.value as Rascunho['dia_nao_util'] })}>
                    {AJUSTES_DE_DIA.map(d => <option key={d} value={d}>{ROTULO_AJUSTE_DE_DIA[d]}</option>)}
                  </select>
                )}
              </Field>
              <label className="flex min-h-11 items-center gap-[var(--fin-s-2)] self-end fin-t-body text-[var(--fin-text)] lg:min-h-10">
                <input
                  type="checkbox" checked={r.considerar_feriados}
                  onChange={e => mudar({ considerar_feriados: e.target.checked })}
                  className="size-4 accent-[var(--fin-accent)]"
                />
                Considerar os feriados nacionais
              </label>
            </div>
          </section>

          <section className={GRUPO} aria-label="Na fatura">
            <h3 className={TITULO_GRUPO}>Na fatura</h3>
            <Field rotulo="Descrição" ajuda={`Vai para a descrição de cada fatura desta regra. ${60 - r.descricao.length >= 0 ? `Restam ${60 - r.descricao.length} letras.` : ''}`} erro={erroDe('descricao') ?? (r.descricao.length > 60 ? 'A descrição cabe em 60 letras.' : null)}>
              {a => <Input {...a} value={r.descricao} maxLength={80} onChange={e => mudar({ descricao: e.target.value })} placeholder="Ex.: Viagens corporativas da diretoria" />}
            </Field>
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
              <Field rotulo="Solicitante" ajuda="Quem pede as viagens no cliente. Sai na fatura.">
                {a => <Input {...a} value={r.solicitante} onChange={e => mudar({ solicitante: e.target.value })} />}
              </Field>
              <Field rotulo="Centro de custo" ajuda="O do cliente, para ele lançar a fatura.">
                {a => <Input {...a} value={r.centro_custo} onChange={e => mudar({ centro_custo: e.target.value })} />}
              </Field>
            </div>
            {ehCliente ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className="fin-t-body-strong text-[var(--fin-text)]">Modelo da fatura</span>
                  <Segmentado
                    rotulo="Modelo da fatura"
                    valor={r.modelo}
                    onChange={v => mudar({ modelo: v })}
                    opcoes={MODELOS_DE_FATURA.map(m => ({ valor: m, rotulo: INFO_DO_MODELO[m].rotulo }))}
                    cheio="celular"
                  />
                  <span className="fin-t-caption text-[var(--fin-text-3)]">{INFO_DO_MODELO[r.modelo].ajuda}</span>
                </div>
                {r.modelo === 'PERSONALIZADA' ? (
                  <fieldset className="flex flex-col gap-1">
                    <legend className="fin-t-body-strong text-[var(--fin-text)]">Colunas da fatura</legend>
                    <div className="grid grid-cols-1 gap-x-[var(--fin-s-3)] sm:grid-cols-3">
                      {CAMPOS_DA_FATURA.map(c => (
                        <label key={c.id} className="flex min-h-11 items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)] lg:min-h-9">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--fin-accent)]"
                            checked={c.id === 'valor' || r.campos.includes(c.id)}
                            disabled={c.id === 'valor'}
                            onChange={e => mudar({ campos: e.target.checked ? [...r.campos, c.id] : r.campos.filter(x => x !== c.id) as CampoDaFatura[] })}
                          />
                          {c.rotulo}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </>
            ) : null}
          </section>

          {ehCliente ? (
            <section className={GRUPO} aria-label="Retenções na fonte">
              <h3 className={TITULO_GRUPO}>Retenções na fonte</h3>
              <p className="fin-t-caption text-[var(--fin-text-3)]">Para cliente que retém impostos ao pagar (órgão público, empresa do lucro real). O boleto e o Pix saem pelo valor líquido. Deixe em branco o que ele não retém.</p>
              <div className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-5">
                {(Object.keys(NOMES_DAS_RETENCOES) as Array<keyof typeof NOMES_DAS_RETENCOES>).map(k => (
                  <Field key={k} rotulo={NOMES_DAS_RETENCOES[k]}>
                    {a => <CampoPercentual id={a.id} rotulo={`${NOMES_DAS_RETENCOES[k]} em %`} valor={r.retencoes[k]} onChange={v => mudarRetencao({ [k]: v })} />}
                  </Field>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <span className="fin-t-body-strong text-[var(--fin-text)]">Calcular sobre</span>
                <Segmentado
                  rotulo="Base das retenções"
                  valor={r.retencoes.base}
                  onChange={v => mudarRetencao({ base: v })}
                  opcoes={[{ valor: 'TOTAL', rotulo: 'O total da fatura' }, { valor: 'TAXAS', rotulo: 'Só as taxas de serviço' }]}
                  cheio="celular"
                />
                <span className="fin-t-caption text-[var(--fin-text-3)]">Taxas de serviço: Taxa DU, RAV e Fee dos itens.</span>
              </div>
            </section>
          ) : null}

          {r.id ? (
            <div className="border-t border-[var(--fin-border)] pt-[var(--fin-s-4)]">
              <button
                type="button"
                onClick={() => onDesligar(r)}
                className="inline-flex min-h-11 items-center gap-1 rounded-[var(--fin-r-md)] px-2 fin-t-body text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:min-h-9"
              >
                <Trash2 aria-hidden="true" className="size-4" /> Desligar esta regra
              </button>
            </div>
          ) : null}
        </div>

        <div className="hidden lg:block">
          <div className="sticky top-0">{previaEl}</div>
        </div>
      </div>
    </RecordSheet>
  );
}
