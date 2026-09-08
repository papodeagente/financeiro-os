'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Link2, Link2Off, UserPlus, Users, TriangleAlert, ExternalLink } from 'lucide-react';
import type { Membro, PlanoComissao } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { PageHeader } from '@/components/fin/PageHeader';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { DataState } from '@/components/fin/DataState';
import { Money } from '@/components/fin/Money';
import { toast } from '@/lib/toast';

interface MembroComCrm extends Membro {
  crm: { nome: string; email: string; external_id: string; ativo: boolean } | null;
}

interface Pendente {
  usuario_id: string;
  nome: string;
  email: string;
  external_id: string;
  vendas: number;
  valor_vendido: number;
  ultima_venda: string | null;
  membro_sugerido_id: string | null;
  membro_sugerido_nome: string | null;
}

const CARTAO =
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';

const SELECT =
  'h-9 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const BOTAO =
  'inline-flex h-9 items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-3 fin-t-body ' +
  'border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] ' +
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const BOTAO_PRIMARIO =
  'inline-flex h-9 items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-3 fin-t-body-strong ' +
  'bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

function EsqueletoEquipe() {
  return (
    <div className={`${CARTAO} overflow-hidden`} aria-hidden>
      <div className="border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
        <div className="h-4 w-24 rounded bg-[var(--fin-surface-2)]" />
      </div>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-[var(--fin-s-4)] border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] last:border-0">
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-40 rounded bg-[var(--fin-surface-2)]" />
            <div className="h-3 w-56 rounded bg-[var(--fin-surface-2)]" />
          </div>
          <div className="h-9 w-52 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
          <div className="h-4 w-24 rounded bg-[var(--fin-surface-2)]" />
        </div>
      ))}
    </div>
  );
}

export default function VendedoresPage() {
  const [membros, setMembros] = useState<MembroComCrm[]>([]);
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [planos, setPlanos] = useState<PlanoComissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [resp, listaPlanos] = await Promise.all([
        fetch('/api/equipe/vendedores').then(async r => {
          if (!r.ok) throw new Error((await r.json()).error || `Erro ${r.status}`);
          return r.json();
        }),
        loadEntities<PlanoComissao>('planos-comissao'),
      ]);
      setMembros(resp.membros ?? []);
      setPendentes(resp.pendentes ?? []);
      setPlanos(listaPlanos);
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function acao(corpo: Record<string, unknown>, chave: string, sucesso: string) {
    setOcupado(chave);
    try {
      const r = await fetch('/api/equipe/vendedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `Erro ${r.status}`);
      toast.success(sucesso);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir');
    } finally {
      setOcupado(null);
    }
  }

  const planosAtivos = planos.filter(p => p.ativo);
  const semPlano = membros.filter(m => m.usuario_id && !m.plano_comissao_id).length;

  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      <PageHeader
        titulo="Vendedores e planos"
        subtitulo="Quem vende no CRM, quem recebe comissão aqui, e sob qual regra"
        acoesSecundarias={[{ rotulo: 'Planos de comissão', href: '/equipe/planos-comissao' }]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={<EsqueletoEquipe />}
      >
        {/* Fila de vínculo. Só aparece quando há alguém esperando, porque
            uma seção vazia permanente vira ruído. */}
        {pendentes.length > 0 && (
          <section className={`${CARTAO} mb-[var(--fin-s-5)] overflow-hidden`}>
            <header className="flex items-start gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fin-warning-text)]" aria-hidden />
              <div>
                <h2 className="fin-t-body-strong text-[var(--fin-text)]">
                  {pendentes.length} {pendentes.length === 1 ? 'pessoa vendeu' : 'pessoas venderam'} pelo CRM e ainda não {pendentes.length === 1 ? 'recebe' : 'recebem'} comissão
                </h2>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  Enquanto não estiverem ligadas a um membro da equipe com plano, as vendas delas ficam sem comissão calculada.
                </p>
              </div>
            </header>

            <ul className="divide-y divide-[var(--fin-border)]">
              {pendentes.map(p => {
                const alvo = escolha[p.usuario_id] ?? p.membro_sugerido_id ?? '';
                const chave = `pend-${p.usuario_id}`;
                return (
                  <li key={p.usuario_id} className="flex flex-wrap items-center gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                    <div className="min-w-[12rem] flex-1">
                      <p className="fin-t-body-strong text-[var(--fin-text)]">{p.nome || 'Sem nome'}</p>
                      <p className="fin-t-caption text-[var(--fin-text-3)]">{p.email || 'sem email no CRM'}</p>
                    </div>

                    <div className="text-right">
                      <p className="fin-t-caption text-[var(--fin-text-3)]">
                        {p.vendas} {p.vendas === 1 ? 'venda' : 'vendas'}
                      </p>
                      <Money valor={p.valor_vendido} size="body" />
                    </div>

                    <select
                      className={`${SELECT} w-auto min-w-[13rem]`}
                      value={alvo}
                      onChange={e => setEscolha(s => ({ ...s, [p.usuario_id]: e.target.value }))}
                      aria-label={`Membro da equipe para ${p.nome || p.email}`}
                    >
                      <option value="">Escolha o membro da equipe</option>
                      {membros
                        .filter(m => !m.usuario_id)
                        .map(m => (
                          <option key={m.id} value={m.id}>
                            {m.nome}{m.email ? ` (${m.email})` : ''}
                            {m.id === p.membro_sugerido_id ? ' — mesmo email' : ''}
                          </option>
                        ))}
                    </select>

                    <button
                      className={BOTAO_PRIMARIO}
                      disabled={!alvo || ocupado === chave}
                      onClick={() => acao(
                        { acao: 'vincular', membro_id: alvo, usuario_id: p.usuario_id },
                        chave,
                        `${p.nome || 'Usuário'} vinculado`,
                      )}
                    >
                      <Link2 className="h-4 w-4" aria-hidden />
                      Vincular
                    </button>

                    <button
                      className={BOTAO}
                      disabled={ocupado === chave}
                      onClick={() => acao(
                        { acao: 'criar_membro', usuario_id: p.usuario_id },
                        chave,
                        `Ficha de ${p.nome || 'vendedor'} criada`,
                      )}
                      title="Cria a ficha de membro já vinculada, ainda sem plano"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden />
                      Criar ficha
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Equipe e planos */}
        <section className={`${CARTAO} overflow-hidden`}>
          <header className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Equipe</h2>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {membros.length} {membros.length === 1 ? 'pessoa' : 'pessoas'}
              {semPlano > 0 && ` · ${semPlano} vinculada${semPlano === 1 ? '' : 's'} sem plano`}
            </p>
          </header>

          {membros.length === 0 ? (
            <div className="p-[var(--fin-s-5)]">
              <EmptyLesson
                motivo="sem-dado"
                titulo="Nenhuma pessoa na equipe ainda"
                oQueE="Aqui ficam as pessoas que vendem e a regra de comissão de cada uma."
                comoComeca={[
                  'Cadastre a equipe em Pessoas > Equipe',
                  'Crie ao menos um plano em Planos de comissão',
                  'Atribua o plano a cada vendedor nesta tela',
                ]}
                acao={{ rotulo: 'Cadastrar equipe', href: '/pessoas/equipe' }}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[var(--fin-border)] text-left">
                    <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]">Pessoa</th>
                    <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]">Usuário do CRM</th>
                    <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]">Plano de comissão</th>
                    <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]">Situação</th>
                    <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {membros.map(m => {
                    const chave = `membro-${m.id}`;
                    const vinculado = Boolean(m.usuario_id);
                    const plano = planos.find(p => p.id === m.plano_comissao_id);
                    const recebe = vinculado && plano?.ativo;
                    return (
                      <tr key={m.id} className="border-b border-[var(--fin-border)] last:border-0">
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                          <p className="fin-t-body-strong text-[var(--fin-text)]">{m.nome}</p>
                          <p className="fin-t-caption text-[var(--fin-text-3)]">{m.email || m.cargo}</p>
                        </td>

                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                          {m.crm ? (
                            <span className="inline-flex items-center gap-[var(--fin-s-1)] fin-t-body text-[var(--fin-text-2)]">
                              <Link2 className="h-3.5 w-3.5 text-[var(--fin-positive)]" aria-hidden />
                              {m.crm.email || m.crm.nome || 'vinculado'}
                            </span>
                          ) : (
                            <span className="fin-t-body text-[var(--fin-text-3)]">Não vinculado</span>
                          )}
                        </td>

                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                          <select
                            className={SELECT}
                            value={m.plano_comissao_id || ''}
                            disabled={ocupado === chave}
                            aria-label={`Plano de comissão de ${m.nome}`}
                            onChange={e => acao(
                              { acao: 'definir_plano', membro_id: m.id, plano_comissao_id: e.target.value },
                              chave,
                              e.target.value ? `Plano aplicado a ${m.nome}` : `Plano removido de ${m.nome}`,
                            )}
                          >
                            <option value="">Sem plano, não gera comissão</option>
                            {planosAtivos.map(p => (
                              <option key={p.id} value={p.id}>{p.nome}</option>
                            ))}
                          </select>
                          {m.plano_comissao_id && !plano && (
                            <p className="mt-1 fin-t-caption text-[var(--fin-negative-text)]">
                              O plano vinculado não existe mais
                            </p>
                          )}
                          {plano && !plano.ativo && (
                            <p className="mt-1 fin-t-caption text-[var(--fin-warning-text)]">
                              Plano inativo, não gera comissão
                            </p>
                          )}
                        </td>

                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                          {recebe ? (
                            <span className="inline-flex items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-dot)] bg-[var(--fin-positive-soft)] px-2 py-0.5 fin-t-caption text-[var(--fin-positive-text)]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--fin-positive)]" aria-hidden />
                              Recebe comissão
                            </span>
                          ) : (
                            <span className="fin-t-caption text-[var(--fin-text-3)]">
                              {!vinculado ? 'Sem usuário do CRM' : 'Sem plano válido'}
                            </span>
                          )}
                        </td>

                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right">
                          {vinculado && (
                            <button
                              className={BOTAO}
                              disabled={ocupado === chave}
                              onClick={() => acao(
                                { acao: 'desvincular', membro_id: m.id },
                                chave,
                                `${m.nome} desvinculado do CRM`,
                              )}
                              title="Solta o vínculo com o usuário do CRM. Comissão já calculada não é apagada."
                            >
                              <Link2Off className="h-4 w-4" aria-hidden />
                              Desvincular
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="flex items-center gap-[var(--fin-s-1)] fin-t-caption text-[var(--fin-text-3)]">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Depois de vincular e atribuir o plano, use
          <Link
            href="/equipe/comissoes"
            className="inline-flex items-center gap-1 text-[var(--fin-accent)] underline underline-offset-2"
          >
            Recalcular em Comissões
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
          para gerar as comissões das vendas que ficaram para trás.
        </p>
      </DataState>
    </div>
  );
}
