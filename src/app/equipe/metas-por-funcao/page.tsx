'use client';

import * as React from 'react';
import Link from 'next/link';
import { CopyCheck, Target } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { DataState } from '@/components/fin/DataState';
import { Callout } from '@/components/fin/Callout';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import type { CadastroDeComissoes } from '@/lib/comissao-funcoes-servidor';
import { linhasDaGradeDeMetas, MESES_CURTOS, rotuloDoPeriodoDaMeta, type ConfigComissao, type LinhaDaGradeDeMetas as LinhaDaGrade } from '@/lib/comissao-funcoes';
import { hojeISO, parseMoneyBR } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Grade de metas por função (E7): todas as pessoas das funções × os 12 meses
 * do ano, editáveis na própria grade e gravadas de uma vez (tudo ou nada).
 * Mês em branco = sem meta (a pessoa com plano que depende de meta fica com
 * pendência no Fechar comissões daquele mês).
 */

type Cadastro = CadastroDeComissoes & { config: ConfigComissao };

const CAMPO = 'h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10';
const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const paraTexto = (c: number) => (c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

export default function MetasPorFuncaoPage() {
  const [dados, setDados] = React.useState<Cadastro | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [ano, setAno] = React.useState(Number(hojeISO().slice(0, 4)));
  const [funcaoId, setFuncaoId] = React.useState('');
  // Valores em edição, por pessoa na função: 12 textos (o que a pessoa digitou).
  const [editados, setEditados] = React.useState<Record<string, string[]>>({});
  const [salvando, setSalvando] = React.useState(false);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch('/api/comissoes-por-funcao/cadastro');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir.');
      setDados(j);
      setEditados({});
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const linhas: LinhaDaGrade[] = React.useMemo(() => (dados ? linhasDaGradeDeMetas(dados, ano, funcaoId) : []), [dados, ano, funcaoId]);
  const sujas = Object.keys(editados);
  const textosDe = (l: LinhaDaGrade) => editados[l.pessoa_funcao_id] ?? l.meses.map(paraTexto);
  // Texto da célula → centavos; null = não é um valor válido (letra, negativo).
  const lido = (t: string): number | null => {
    if (!t.trim()) return 0;
    const v = parseMoneyBR(t);
    return v === null || v < 0 ? null : Math.round(v * 100);
  };
  const centavosDe = (t: string) => lido(t) ?? 0;
  const invalidas = linhas.filter(l => textosDe(l).some(t => lido(t) === null));

  function mudar(l: LinhaDaGrade, mes: number, texto: string) {
    setEditados(e => {
      const atual = [...(e[l.pessoa_funcao_id] ?? l.meses.map(paraTexto))];
      atual[mes] = texto;
      return { ...e, [l.pessoa_funcao_id]: atual };
    });
  }

  function repetir(l: LinhaDaGrade) {
    const textos = textosDe(l);
    const primeiro = textos.find(t => t.trim() !== '' && centavosDe(t) > 0);
    if (!primeiro) { toast.info('Nada a repetir', 'Digite a meta de um mês e repita no ano.'); return; }
    setEditados(e => ({ ...e, [l.pessoa_funcao_id]: textos.map(t => (t.trim() === '' ? primeiro : t)) }));
  }

  async function salvar() {
    if (!sujas.length || invalidas.length) return;
    setSalvando(true);
    try {
      const corpo = { ano, linhas: sujas.map(id => ({ pessoa_funcao_id: id, meses: editados[id].map(centavosDe) })) };
      const r = await fetch('/api/comissoes-por-funcao/metas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi salvo.');
      toast.success('Metas salvas', `${j.pessoas} ${j.pessoas === 1 ? 'pessoa' : 'pessoas'}, ${ano}.`);
      await carregar();
    } catch (e) {
      toast.error('Não foi salvo', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  const totalDoMes = (mes: number) => linhas.reduce((a, l) => a + centavosDe(textosDe(l)[mes]), 0);
  const dia = dados?.config.dia_fechamento_meta ?? 0;
  const anos = [ano - 1, ano, ano + 1];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Target}
        titulo="Grade de metas"
        subtitulo="A meta de cada pessoa em cada função, mês a mês. Edite na grade e salve tudo de uma vez."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acoesSecundarias={[{ rotulo: 'Funções', href: '/equipe/funcoes' }, { rotulo: 'Dia de fechamento', href: '/config/comissoes' }]}
      />

      <div className="flex flex-wrap items-end gap-[var(--fin-s-3)]">
        <label className="flex flex-col gap-1">
          <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Ano</span>
          <select className={CAMPO} value={ano} disabled={sujas.length > 0} title={sujas.length ? 'Salve ou desfaça antes de trocar o ano' : undefined} onChange={e => setAno(Number(e.target.value))}>
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Função</span>
          <select className={CAMPO} value={funcaoId} onChange={e => setFuncaoId(e.target.value)}>
            <option value="">Todas</option>
            {(dados?.funcoes ?? []).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <p className="fin-t-caption text-[var(--fin-text-3)] sm:ml-auto">
          {dia ? `As metas fecham no dia ${dia}: a de novembro vai ${rotuloDoPeriodoDaMeta(`${ano}-11`, dia)}.` : 'Cada meta vale do dia 1 ao último dia do mês.'}
        </p>
      </div>

      <DataState
        className={RITMO_DA_PAGINA}
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div className="h-80 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
      >
        {dados ? (
          <>
            {dados.config.regra !== 'FUNCOES' ? (
              <Callout tom="aviso" titulo="A agência ainda usa o plano por vendedor">
                As metas daqui passam a valer quando a regra por função for escolhida em <Link className="underline underline-offset-4" href="/config/comissoes">Configurações › Comissões</Link>. As metas do plano por vendedor continuam em <Link className="underline underline-offset-4" href="/equipe/metas">Metas</Link>.
              </Callout>
            ) : null}
            {invalidas.length ? (
              <Callout tom="negativo">Confira {invalidas.map(l => l.pessoa_nome).join(', ')}: a meta é um valor em reais, zero ou maior.</Callout>
            ) : null}

            {linhas.length === 0 ? (
              <EmptyLesson
                motivo="sem-dado"
                titulo="Ninguém nas funções ainda"
                oQueE="A grade mostra cada pessoa de cada função. Coloque as pessoas nas funções e elas aparecem aqui."
                acao={{ rotulo: 'Abrir Funções', href: '/equipe/funcoes' }}
              />
            ) : (
              <div className="overflow-x-auto rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]">
                <table className="w-full min-w-[1180px] border-collapse fin-t-body">
                  <caption className="sr-only">Metas de {ano} por pessoa e função, em reais</caption>
                  <thead>
                    <tr className="border-b border-[var(--fin-border)] bg-[var(--fin-surface-2)]">
                      <th scope="col" className="sticky left-0 z-[var(--fin-z-conteudo)] min-w-[220px] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-left fin-t-overline text-[var(--fin-text-3)]">Pessoa · função</th>
                      {MESES_CURTOS.map(m => <th key={m} scope="col" className="px-1 py-[var(--fin-s-2)] text-right fin-t-overline text-[var(--fin-text-3)]">{m}</th>)}
                      <th scope="col" className="px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-right fin-t-overline text-[var(--fin-text-3)]">Ano</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map(l => {
                      const textos = textosDe(l);
                      const suja = l.pessoa_funcao_id in editados;
                      const totalAno = textos.reduce((a, t) => a + centavosDe(t), 0);
                      return (
                        <tr key={l.pessoa_funcao_id} className="group border-b border-[var(--fin-border)] last:border-b-0">
                          <th scope="row" className={cn('sticky left-0 z-[var(--fin-z-conteudo)] bg-[var(--fin-surface)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-left font-normal group-hover:bg-[var(--fin-surface-2)]')}>
                            <span className="flex items-center justify-between gap-[var(--fin-s-2)]">
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate fin-t-body-strong text-[var(--fin-text)]">{l.pessoa_nome || 'Sem nome'}{suja ? <span className="sr-only"> (alterada)</span> : null}</span>
                                <span className="truncate fin-t-caption text-[var(--fin-text-3)]">{l.funcao_nome}{l.plano_nome ? ` · ${l.plano_nome}` : ' · sem plano'}{l.nao_comissionado ? ' · sem comissão' : ''}</span>
                              </span>
                              <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label={`Repetir a meta de ${l.pessoa_nome} nos meses em branco`} title="Repetir nos meses em branco" onClick={() => repetir(l)}>
                                <CopyCheck aria-hidden="true" className="size-4" />
                              </Button>
                            </span>
                          </th>
                          {textos.map((t, mes) => (
                            <td key={mes} className="px-1 py-[var(--fin-s-1)] group-hover:bg-[var(--fin-surface-2)]">
                              <input
                                inputMode="decimal"
                                aria-label={`Meta de ${l.pessoa_nome}, ${MESES_CURTOS[mes]} de ${ano}`}
                                value={t}
                                placeholder="—"
                                onChange={e => mudar(l, mes, e.target.value)}
                                onBlur={e => { const c = lido(e.target.value); if (c !== null && editados[l.pessoa_funcao_id]) mudar(l, mes, paraTexto(c)); }}
                                aria-invalid={lido(t) === null || undefined}
                                className={cn(
                                  'h-9 w-full min-w-[76px] rounded-[var(--fin-r-sm)] border bg-transparent px-1.5 text-right tabular-nums fin-t-body text-[var(--fin-text)] placeholder:text-[var(--fin-text-3)] focus:border-[var(--fin-accent)] focus:bg-[var(--fin-surface)] focus:outline-none',
                                  lido(t) === null ? 'border-[var(--fin-negative)] bg-[var(--fin-negative-soft)]'
                                    : editados[l.pessoa_funcao_id] && editados[l.pessoa_funcao_id][mes] !== paraTexto(l.meses[mes]) ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]'
                                      : 'border-transparent hover:border-[var(--fin-border-strong)]',
                                )}
                              />
                            </td>
                          ))}
                          <td className="px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-right tabular-nums fin-t-body-strong text-[var(--fin-text)] group-hover:bg-[var(--fin-surface-2)]">{totalAno ? reais(totalAno) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)]">
                      <th scope="row" className="sticky left-0 z-[var(--fin-z-conteudo)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-left fin-t-body-strong text-[var(--fin-text)]">Total</th>
                      {MESES_CURTOS.map((m, mes) => <td key={m} className="px-1.5 py-[var(--fin-s-2)] text-right tabular-nums fin-t-caption text-[var(--fin-text-2)]">{totalDoMes(mes) ? reais(totalDoMes(mes)).replace('R$', '').trim() : '—'}</td>)}
                      <td className="px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-right tabular-nums fin-t-body-strong text-[var(--fin-text)]">{reais(MESES_CURTOS.reduce((a, _m, mes) => a + totalDoMes(mes), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="sticky bottom-0 z-[var(--fin-z-conteudo)] flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] bg-[var(--fin-bg)] py-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
              <p className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">
                {sujas.length ? `${sujas.length} ${sujas.length === 1 ? 'pessoa alterada' : 'pessoas alteradas'}. Mês em branco fica sem meta.` : 'Tudo salvo.'}
              </p>
              <div className="flex gap-[var(--fin-s-2)]">
                {sujas.length ? <Button type="button" variant="ghost" onClick={() => setEditados({})} disabled={salvando}>Desfazer</Button> : null}
                <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || !sujas.length || invalidas.length > 0}>{salvando ? 'Salvando…' : 'Salvar metas'}</Button>
              </div>
            </div>
          </>
        ) : null}
      </DataState>
    </MolduraDaPagina>
  );
}
