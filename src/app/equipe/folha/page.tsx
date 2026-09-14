'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Pencil, TriangleAlert, UserPlus, Users } from 'lucide-react';
import type { VinculoEmpresa } from '@/lib/crm-types';
import {
  montarFolha, montarEvolucao, ROTULO_CONTRATO,
  type EntradaPessoa,
} from '@/lib/folha-pagamento';
import { hojeISO, mesDe, round2, divSegura } from '@/lib/money';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { toast } from '@/lib/toast';
import { GraficoEvolucao } from './GraficoEvolucao';
import { DialogVinculo, vinculoVazio } from './DialogVinculo';

interface PessoaAPI extends EntradaPessoa {
  email?: string;
  perfil?: string;
  ativo?: boolean;
}

const CARTAO =
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';
const CAMPO =
  'h-9 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-2 fin-t-body text-[var(--fin-text)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const CABECALHO = 'px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]';
const BOTAO =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] ' +
  'hover:text-[var(--fin-text)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function rotuloMes(ym: string): string {
  const [a, m] = ym.split('-');
  return new Date(Number(a), Number(m) - 1, 15).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function ultimosMeses(qtd: number): string[] {
  const [a, m] = hojeISO().split('-').map(Number);
  return Array.from({ length: qtd }, (_, i) => {
    const t = a * 12 + (m - 1) - (qtd - 1 - i);
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  });
}

/** Acima de 40% da receita a folha começa a apertar a operação. Não é lei,
 *  é limiar declarado, para o número ter leitura e não só cor. */
function tomDaRelacao(pct: number): 'positivo' | 'neutro' | 'negativo' {
  if (pct <= 0) return 'neutro';
  if (pct > 40) return 'negativo';
  return 'positivo';
}

function Esqueleto() {
  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
      <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`${CARTAO} h-[104px] p-[var(--fin-s-4)]`}>
            <div className="h-3 w-24 rounded bg-[var(--fin-surface-2)]" />
            <div className="mt-3 h-7 w-32 rounded bg-[var(--fin-surface-2)]" />
          </div>
        ))}
      </div>
      <div className={`${CARTAO} h-56`} />
      <div className={`${CARTAO} h-64`} />
    </div>
  );
}

export default function FolhaPage() {
  const [pessoas, setPessoas] = useState<PessoaAPI[]>([]);
  const [faturamento, setFaturamento] = useState<Record<string, number>>({});
  const [mes, setMes] = useState(() => mesDe(hojeISO()));
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [editando, setEditando] = useState<{ id: string; nome: string; vinculo: VinculoEmpresa } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch('/api/folha');
      if (!r.ok) throw new Error((await r.json()).error || `Erro ${r.status}`);
      const json = await r.json();
      setPessoas(json.pessoas ?? []);
      setFaturamento(json.faturamento ?? {});
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const folha = useMemo(() => montarFolha(pessoas, mes), [pessoas, mes]);
  const evolucao = useMemo(
    () => montarEvolucao(pessoas, new Map(Object.entries(faturamento)), ultimosMeses(12)),
    [pessoas, faturamento],
  );
  const doMes = evolucao.find(p => p.mes === mes);
  const faturamentoMes = doMes?.faturamento ?? 0;
  const relacao = doMes?.folha_sobre_faturamento_pct ?? 0;

  const foraDaFolha = useMemo(
    () => pessoas.filter(p => !p.vinculo && p.ativo !== false),
    [pessoas],
  );

  async function salvarVinculo(vinculo: VinculoEmpresa | null, id: string, nome: string) {
    setSalvando(true);
    try {
      const r = await fetch('/api/folha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'salvar_vinculo', usuario_id: id, vinculo }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `Erro ${r.status}`);
      toast.success(vinculo ? `Vínculo de ${nome} salvo` : `${nome} saiu da folha`);
      setEditando(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar');
    } finally {
      setSalvando(false);
    }
  }

  const composicao = [
    { rotulo: 'Salários', valor: folha.salarios, cor: 'var(--fin-accent)' },
    { rotulo: 'Encargos', valor: folha.encargos, cor: 'var(--fin-warning)' },
    { rotulo: 'Benefícios', valor: folha.beneficios, cor: 'var(--fin-info)' },
    { rotulo: '13º e férias', valor: folha.provisoes, cor: 'var(--fin-positive)' },
  ].filter(c => c.valor > 0);

  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      <PageHeader
        titulo="Folha de pagamento"
        subtitulo="Quanto a equipe custa por mês e quanto isso pesa no faturamento"
        acoesSecundarias={[{ rotulo: 'Cadastrar pessoa', href: '/config/usuarios' }]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={<Esqueleto />}
      >
        <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
          <label htmlFor="mes-folha" className="fin-t-caption text-[var(--fin-text-3)]">Mês</label>
          <select id="mes-folha" className={CAMPO} value={mes} onChange={e => setMes(e.target.value)}>
            {ultimosMeses(12).slice().reverse().map(m => (
              <option key={m} value={m}>{rotuloMes(m)}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            rotulo="Custo da folha"
            valor={folha.total}
            estado="ok"
            emphasis="destaque"
            contexto={`${folha.quantidade} ${folha.quantidade === 1 ? 'pessoa' : 'pessoas'} em ${rotuloMes(mes)}`}
          />
          <MetricCard
            rotulo="Folha sobre faturamento"
            valor={null}
            estado={faturamentoMes > 0 ? 'ok' : 'indisponivel'}
            tone={tomDaRelacao(relacao)}
            contexto={
              faturamentoMes > 0
                ? `${BRL(folha.total)} de ${BRL(faturamentoMes)} faturados`
                : 'sem faturamento no mês, não há base para comparar'
            }
          />
          <MetricCard
            rotulo="Custo médio por pessoa"
            valor={folha.custo_medio}
            estado="ok"
            contexto="salário, benefícios, encargos e provisões"
          />
          <MetricCard
            rotulo="Só de salário"
            valor={folha.salarios}
            estado="ok"
            contexto={
              folha.total > 0
                ? `${round2(divSegura(folha.salarios, folha.total) * 100).toFixed(0)}% do custo total`
                : 'nenhum salário lançado'
            }
          />
        </div>

        {/* O percentual em destaque, porque MetricCard só publica dinheiro. */}
        {faturamentoMes > 0 && (
          <div className={`${CARTAO} flex flex-wrap items-center justify-between gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}>
            <div>
              <p className="fin-t-overline text-[var(--fin-text-3)]">Folha sobre faturamento em {rotuloMes(mes)}</p>
              <p className={`fin-t-metric ${relacao > 40 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-positive)]'}`}>
                {relacao.toFixed(1)}%
              </p>
            </div>
            <p className="max-w-md fin-t-caption text-[var(--fin-text-2)]">
              {relacao > 40
                ? 'Acima de 40% a folha aperta a operação: sobra pouco para custo fixo, marketing e lucro.'
                : 'Dentro do que a operação costuma sustentar. O limiar de atenção usado aqui é 40%.'}
            </p>
          </div>
        )}

        <section className={`${CARTAO} p-[var(--fin-s-4)]`}>
          <header className="mb-[var(--fin-s-3)]">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Folha e faturamento nos últimos 12 meses</h2>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Clique num mês para ver a folha daquele período
            </p>
          </header>
          {evolucao.some(p => p.folha > 0 || p.faturamento > 0) ? (
            <GraficoEvolucao pontos={evolucao} mesAtivo={mes} onSelecionarMes={setMes} />
          ) : (
            <p className="fin-t-body text-[var(--fin-text-3)]">
              Ainda não há folha nem faturamento para desenhar.
            </p>
          )}
        </section>

        {composicao.length > 0 && (
          <section className={`${CARTAO} p-[var(--fin-s-4)]`}>
            <header className="mb-[var(--fin-s-3)]">
              <h2 className="fin-t-subhead text-[var(--fin-text)]">Composição do custo</h2>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                Salário é só uma parte. O resto some do orçamento quando ninguém olha
              </p>
            </header>
            <div className="flex h-3 w-full overflow-hidden rounded-[var(--fin-r-dot)]" role="img"
                 aria-label={composicao.map(c => `${c.rotulo}: ${BRL(c.valor)}`).join(', ')}>
              {composicao.map(c => (
                <div
                  key={c.rotulo}
                  style={{ width: `${divSegura(c.valor, folha.total) * 100}%`, background: c.cor }}
                  title={`${c.rotulo}: ${BRL(c.valor)}`}
                />
              ))}
            </div>
            <ul className="mt-[var(--fin-s-3)] flex flex-wrap gap-x-[var(--fin-s-5)] gap-y-2">
              {composicao.map(c => (
                <li key={c.rotulo} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: c.cor }} aria-hidden />
                  <span className="fin-t-caption text-[var(--fin-text-2)]">{c.rotulo}</span>
                  <Money valor={c.valor} size="caption" />
                  <span className="fin-t-caption text-[var(--fin-text-3)]">
                    {round2(divSegura(c.valor, folha.total) * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>

            {folha.por_contrato.length > 1 && (
              <p className="mt-[var(--fin-s-3)] fin-t-caption text-[var(--fin-text-3)]">
                Por contrato: {folha.por_contrato.map(c =>
                  `${ROTULO_CONTRATO[c.tipo]} ${c.quantidade} (${c.share_pct.toFixed(0)}%)`).join(' · ')}
              </p>
            )}
          </section>
        )}

        <section className={`${CARTAO} overflow-hidden`}>
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Pessoas na folha de {rotuloMes(mes)}</h2>
            <p className="fin-t-caption text-[var(--fin-text-3)]">{folha.quantidade}</p>
          </header>

          {folha.quantidade === 0 ? (
            <div className="p-[var(--fin-s-5)]">
              <EmptyLesson
                motivo="sem-dado"
                titulo="Ninguém na folha neste mês"
                oQueE="A folha mostra quanto cada pessoa da empresa custa por mês, somando salário, benefícios, encargos e provisões."
                comoComeca={[
                  'Cadastre a pessoa em Configurações, Usuários',
                  'Quem não usa o sistema entra com o perfil Colaborador',
                  'Defina o vínculo dela aqui, com salário e contrato',
                ]}
                acao={{ rotulo: 'Cadastrar pessoa', href: '/config/usuarios' }}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[var(--fin-border)] text-left">
                    <th scope="col" className={CABECALHO}>Pessoa</th>
                    <th scope="col" className={`${CABECALHO} text-right`}>Salário</th>
                    <th scope="col" className={`${CABECALHO} text-right`}>Benefícios</th>
                    <th scope="col" className={`${CABECALHO} text-right`}>Encargos</th>
                    <th scope="col" className={`${CABECALHO} text-right`}>13º e férias</th>
                    <th scope="col" className={`${CABECALHO} text-right`}>Custo total</th>
                    <th scope="col" className={CABECALHO}><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {folha.pessoas.map(p => {
                    const origem = pessoas.find(x => x.id === p.id);
                    return (
                      <tr key={p.id} className="border-b border-[var(--fin-border)] last:border-0">
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                          <p className="fin-t-body-strong text-[var(--fin-text)]">{p.nome}</p>
                          <p className="fin-t-caption text-[var(--fin-text-3)]">
                            {ROTULO_CONTRATO[p.tipo_contrato]}
                            {p.cargo && ` · ${p.cargo}`}
                            {p.data_desligamento && ` · desligado em ${p.data_desligamento.split('-').reverse().join('/')}`}
                          </p>
                        </td>
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right"><Money valor={p.custo.salario} size="body" /></td>
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right"><Money valor={p.custo.beneficios} size="body" /></td>
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right"><Money valor={p.custo.encargos} size="body" /></td>
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right"><Money valor={p.custo.provisoes} size="body" /></td>
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right"><Money valor={p.custo.total} size="strong" /></td>
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right">
                          <button
                            className={BOTAO}
                            onClick={() => setEditando({
                              id: p.id,
                              nome: p.nome,
                              vinculo: origem?.vinculo ?? vinculoVazio(),
                            })}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                            Editar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {foraDaFolha.length > 0 && (
          <section className={`${CARTAO} overflow-hidden`}>
            <header className="flex items-start gap-2 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fin-text-3)]" aria-hidden />
              <div>
                <h2 className="fin-t-body-strong text-[var(--fin-text)]">
                  {foraDaFolha.length} {foraDaFolha.length === 1 ? 'pessoa cadastrada sem vínculo' : 'pessoas cadastradas sem vínculo'}
                </h2>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  Existem no sistema mas não têm salário definido, então não entram no custo da folha.
                </p>
              </div>
            </header>
            <ul className="divide-y divide-[var(--fin-border)]">
              {foraDaFolha.map(p => (
                <li key={p.id} className="flex flex-wrap items-center gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                  <div className="min-w-0 flex-1">
                    <p className="fin-t-body-strong text-[var(--fin-text)]">{p.nome}</p>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {p.email || 'sem email'}
                      {p.perfil === 'COLABORADOR' && ' · colaborador, sem acesso ao sistema'}
                    </p>
                  </div>
                  <button
                    className={BOTAO}
                    onClick={() => setEditando({ id: p.id, nome: p.nome, vinculo: vinculoVazio() })}
                  >
                    <UserPlus className="h-4 w-4" aria-hidden />
                    Definir vínculo
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="flex flex-wrap items-center gap-1.5 fin-t-caption text-[var(--fin-text-3)]">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Quem não usa o sistema entra como
          <strong className="text-[var(--fin-text-2)]">Colaborador</strong>
          em
          <Link href="/config/usuarios" className="text-[var(--fin-accent)] underline underline-offset-2">
            Configurações, Usuários
          </Link>
          . Esse perfil não faz login e existe só para a folha.
        </p>
      </DataState>

      {editando && (
        <DialogVinculo
          aberto
          nome={editando.nome}
          vinculo={editando.vinculo}
          salvando={salvando}
          onChange={v => setEditando(e => (e ? { ...e, vinculo: v } : e))}
          onFechar={() => setEditando(null)}
          onConfirmar={() => salvarVinculo(editando.vinculo, editando.id, editando.nome)}
        />
      )}
    </div>
  );
}
