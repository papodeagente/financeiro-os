'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, ExternalLink, TriangleAlert, UserCheck, UserPlus, Users } from 'lucide-react';
import type { Membro, PlanoComissao } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { PageHeader } from '@/components/fin/PageHeader';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { DataState } from '@/components/fin/DataState';
import { Money } from '@/components/fin/Money';
import { toast } from '@/lib/toast';

interface PessoaDaEquipe extends Membro {
  membro_ids_legado: string[];
  perfil: string;
  origem: string;
}

/** Vendeu pelo CRM e ninguém cadastrou no financeiro. A venda entrou, a
 *  comissão não é calculada e a venda não conta para meta nenhuma. */
interface AguardandoCadastro {
  id: string;
  nome: string;
  email: string;
  external_id: string;
  vendas: number;
  valor_vendido: number;
  ultima_venda: string | null;
}

/** Ficha do cadastro antigo que não achou usuário de mesmo email. */
interface Orfao {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  plano_comissao_id: string;
  meta_mensal_vendas: number;
}

const CARTAO =
  'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';

const CAMPO =
  'h-9 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const BOTAO =
  'inline-flex h-9 items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-3 fin-t-body ' +
  'border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] ' +
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const CABECALHO =
  'px-[var(--fin-s-4)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-3)]';

function EsqueletoEquipe() {
  return (
    <div className={`${CARTAO} overflow-hidden`} aria-hidden>
      <div className="border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
        <div className="h-4 w-24 rounded bg-[var(--fin-surface-2)]" />
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="flex items-center gap-[var(--fin-s-4)] border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] last:border-0">
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-40 rounded bg-[var(--fin-surface-2)]" />
            <div className="h-3 w-56 rounded bg-[var(--fin-surface-2)]" />
          </div>
          <div className="h-9 w-48 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
          <div className="h-9 w-32 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
        </div>
      ))}
    </div>
  );
}

export default function VendedoresPage() {
  const [equipe, setEquipe] = useState<PessoaDaEquipe[]>([]);
  const [orfaos, setOrfaos] = useState<Orfao[]>([]);
  const [aguardando, setAguardando] = useState<AguardandoCadastro[]>([]);
  const [planos, setPlanos] = useState<PlanoComissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [metaEditada, setMetaEditada] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [resp, listaPlanos] = await Promise.all([
        fetch('/api/equipe').then(async r => {
          if (!r.ok) throw new Error((await r.json()).error || `Erro ${r.status}`);
          return r.json();
        }),
        loadEntities<PlanoComissao>('planos-comissao'),
      ]);
      setEquipe(resp.equipe ?? []);
      setOrfaos(resp.orfaos ?? []);
      setAguardando(resp.aguardandoCadastro ?? []);
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
      const r = await fetch('/api/equipe', {
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
  const ativos = equipe.filter(p => p.status === 'ATIVO');
  const semPlano = ativos.filter(p => !p.plano_comissao_id).length;

  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      <PageHeader
        titulo="Vendedores e planos"
        subtitulo="A mesma equipe cadastrada em Configurações. Quem tem plano recebe comissão"
        acoesSecundarias={[
          { rotulo: 'Cadastrar pessoa', href: '/config/usuarios' },
          { rotulo: 'Planos de comissão', href: '/equipe/planos-comissao' },
        ]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <DataState
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={<EsqueletoEquipe />}
      >
        {aguardando.length > 0 && (
          <section className={`${CARTAO} overflow-hidden`}>
            <header className="flex items-start gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fin-warning-text)]" aria-hidden />
              <div>
                <h2 className="fin-t-body-strong text-[var(--fin-text)]">
                  {aguardando.length} {aguardando.length === 1 ? 'pessoa vendeu' : 'pessoas venderam'} pelo CRM sem estar cadastrada aqui
                </h2>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  As vendas entraram normalmente. O que não acontece é comissão e meta, porque a
                  pessoa não está na equipe. Confirme quem é do time.
                </p>
              </div>
            </header>

            <ul className="divide-y divide-[var(--fin-border)]">
              {aguardando.map(a => (
                <li key={a.id} className="flex flex-wrap items-center gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                  <div className="min-w-[12rem] flex-1">
                    <p className="fin-t-body-strong text-[var(--fin-text)]">{a.nome || 'Sem nome'}</p>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {a.email || 'sem email no CRM'}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {a.vendas} {a.vendas === 1 ? 'venda' : 'vendas'}
                    </p>
                    <Money valor={a.valor_vendido} size="body" />
                  </div>

                  <button
                    className="inline-flex h-9 items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-3 fin-t-body-strong text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
                    disabled={ocupado === `a-${a.id}`}
                    onClick={() => acao(
                      { acao: 'confirmar_cadastro', usuario_id: a.id },
                      `a-${a.id}`,
                      `${a.nome || 'Vendedor'} entrou na equipe. Defina o plano para gerar comissão.`,
                    )}
                    title="Coloca a pessoa na equipe. Depois atribua o plano e recalcule as comissões."
                  >
                    <UserCheck className="h-4 w-4" aria-hidden />
                    É do time, cadastrar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={`${CARTAO} overflow-hidden`}>
          <header className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Equipe da agência</h2>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {equipe.length} {equipe.length === 1 ? 'pessoa' : 'pessoas'}
              {semPlano > 0 && ` · ${semPlano} sem plano, não recebe comissão`}
            </p>
          </header>

          {equipe.length === 0 ? (
            <div className="p-[var(--fin-s-5)]">
              <EmptyLesson
                motivo="sem-dado"
                titulo="Nenhuma pessoa cadastrada"
                oQueE="A equipe é a mesma de Configurações. Quem está aqui pode vender, e quem tem plano recebe comissão."
                comoComeca={[
                  'Cadastre a pessoa em Configurações, Usuários',
                  'Crie ao menos um plano em Planos de comissão',
                  'Atribua o plano e a meta aqui',
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
                    <th scope="col" className={CABECALHO}>Plano de comissão</th>
                    <th scope="col" className={CABECALHO}>Meta mensal</th>
                    <th scope="col" className={CABECALHO}>Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {equipe.map(p => {
                    const chave = `p-${p.id}`;
                    const plano = planos.find(x => x.id === p.plano_comissao_id);
                    const recebe = p.status === 'ATIVO' && Boolean(plano?.ativo);
                    const metaValor = metaEditada[p.id] ?? String(p.meta_mensal_vendas || '');
                    return (
                      <tr key={p.id} className="border-b border-[var(--fin-border)] last:border-0">
                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                          <p className="fin-t-body-strong text-[var(--fin-text)]">{p.nome}</p>
                          <p className="fin-t-caption text-[var(--fin-text-3)]">
                            {p.email}
                            {' · '}{p.cargo}
                            {p.origem === 'crm' && ' · veio do CRM'}
                            {p.status === 'INATIVO' && ' · inativo'}
                          </p>
                        </td>

                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                          <select
                            className={CAMPO}
                            value={p.plano_comissao_id || ''}
                            disabled={ocupado === chave}
                            aria-label={`Plano de comissão de ${p.nome}`}
                            onChange={e => acao(
                              { acao: 'definir_comercial', usuario_id: p.id, plano_comissao_id: e.target.value },
                              chave,
                              e.target.value ? `Plano aplicado a ${p.nome}` : `Plano removido de ${p.nome}`,
                            )}
                          >
                            <option value="">Sem plano, não gera comissão</option>
                            {planosAtivos.map(x => (
                              <option key={x.id} value={x.id}>{x.nome}</option>
                            ))}
                          </select>
                          {p.plano_comissao_id && !plano && (
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
                          <input
                            type="number"
                            min={0}
                            step={100}
                            inputMode="decimal"
                            className={`${CAMPO} text-right tabular-nums`}
                            value={metaValor}
                            disabled={ocupado === chave}
                            aria-label={`Meta mensal de vendas de ${p.nome}`}
                            placeholder="0"
                            onChange={e => setMetaEditada(s => ({ ...s, [p.id]: e.target.value }))}
                            onBlur={e => {
                              const novo = Number(e.target.value) || 0;
                              if (novo === p.meta_mensal_vendas) return;
                              acao(
                                { acao: 'definir_comercial', usuario_id: p.id, meta_mensal_vendas: novo },
                                chave,
                                `Meta de ${p.nome} atualizada`,
                              );
                            }}
                          />
                        </td>

                        <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                          {recebe ? (
                            <span className="inline-flex items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-dot)] bg-[var(--fin-positive-soft)] px-2 py-0.5 fin-t-caption text-[var(--fin-positive-text)]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--fin-positive)]" aria-hidden />
                              Recebe
                            </span>
                          ) : (
                            <span className="fin-t-caption text-[var(--fin-text-3)]">
                              {p.status !== 'ATIVO' ? 'Inativo' : 'Sem plano'}
                            </span>
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

        {/* Sobras do cadastro antigo. Só aparece enquanto houver alguma. */}
        {orfaos.length > 0 && (
          <section className={`${CARTAO} overflow-hidden`}>
            <header className="flex items-start gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fin-warning-text)]" aria-hidden />
              <div>
                <h2 className="fin-t-body-strong text-[var(--fin-text)]">
                  {orfaos.length} {orfaos.length === 1 ? 'ficha antiga' : 'fichas antigas'} sem pessoa correspondente
                </h2>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  Vinham do cadastro de equipe que existia separado. Quem tinha o mesmo email já foi
                  incorporado automaticamente. Estas não têm usuário: cadastre a pessoa com o mesmo
                  email para incorporar, ou arquive a ficha.
                </p>
              </div>
            </header>

            <ul className="divide-y divide-[var(--fin-border)]">
              {orfaos.map(o => (
                <li key={o.id} className="flex flex-wrap items-center gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                  <div className="min-w-[12rem] flex-1">
                    <p className="fin-t-body-strong text-[var(--fin-text)]">{o.nome || 'Sem nome'}</p>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      {o.email || 'sem email'}{o.cargo ? ` · ${o.cargo}` : ''}
                    </p>
                  </div>

                  {o.meta_mensal_vendas > 0 && (
                    <div className="text-right">
                      <p className="fin-t-caption text-[var(--fin-text-3)]">Meta antiga</p>
                      <Money valor={o.meta_mensal_vendas} size="body" />
                    </div>
                  )}

                  <Link href="/config/usuarios" className={BOTAO}>
                    <UserPlus className="h-4 w-4" aria-hidden />
                    Cadastrar como usuário
                  </Link>

                  <button
                    className={BOTAO}
                    disabled={ocupado === `o-${o.id}`}
                    onClick={() => acao(
                      { acao: 'descartar_orfao', membro_id: o.id },
                      `o-${o.id}`,
                      `Ficha de ${o.nome || 'equipe'} arquivada`,
                    )}
                    title="Arquiva a ficha antiga. Nada é apagado, o histórico continua auditável."
                  >
                    <Archive className="h-4 w-4" aria-hidden />
                    Arquivar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="flex flex-wrap items-center gap-[var(--fin-s-1)] fin-t-caption text-[var(--fin-text-3)]">
          <Users className="h-3.5 w-3.5" aria-hidden />
          A equipe é cadastrada em
          <Link href="/config/usuarios" className="text-[var(--fin-accent)] underline underline-offset-2">
            Configurações, Usuários
          </Link>
          . Depois de atribuir o plano, use
          <Link href="/equipe/comissoes" className="inline-flex items-center gap-1 text-[var(--fin-accent)] underline underline-offset-2">
            Recalcular em Comissões
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
          para gerar as comissões das vendas já fechadas.
        </p>
      </DataState>
    </div>
  );
}
