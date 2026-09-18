'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, UserCheck, UserPlus } from 'lucide-react';

import type { Membro, PlanoComissao } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { escalaComumDeFaixas } from '@/lib/escala';
import { hojeISO, num, round2, soma } from '@/lib/money';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { DataState } from '@/components/fin/DataState';
import { Money } from '@/components/fin/Money';
import { MoneyField } from '@/components/fin/MoneyField';
import { StatusChip } from '@/components/fin/StatusChip';
import { Resposta } from '@/components/fin/Resposta';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { EscadaDeFaixas } from '@/components/fin/EscadaDeFaixas';
import { Unidades, type Unidade } from '@/components/fin/Unidades';
import { RecordSheet } from '@/components/fin/RecordSheet';
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

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';
const CAMPO =
  'h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] ' +
  'bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const BOTAO =
  'inline-flex h-11 items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-3 fin-t-body ' +
  'border border-[var(--fin-border)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] ' +
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const BRL = (v: number) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Recência em palavras. `ultima_venda` vem da API e nunca era renderizada —
 *  é o dado que separa o urgente do arqueológico. */
function haQuantoTempo(iso: string | null): string {
  if (!iso) return 'sem data da última venda';
  const dias = Math.round((Date.parse(`${hojeISO()}T00:00:00`) - Date.parse(`${iso.slice(0, 10)}T00:00:00`)) / 86_400_000);
  if (!Number.isFinite(dias)) return 'sem data da última venda';
  if (dias <= 0) return 'última venda hoje';
  if (dias === 1) return 'última venda ontem';
  if (dias < 30) return `última venda há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return `última venda há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}

function primeiroNome(nome: string): string {
  return (nome || 'Sem nome').split(' ')[0];
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
  const [ficha, setFicha] = useState<string | null>(null);
  /** Rascunho da ficha. Vive enquanto a ficha está aberta e morre com ela —
   *  antes o rascunho nunca era limpo e, se o POST falhasse, o campo seguia
   *  exibindo o que foi digitado, como se tivesse salvo. */
  const [rascunho, setRascunho] = useState<{ plano: string; meta: number } | null>(null);

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
      // Colaborador não vende: existe só para a folha de pagamento.
      setEquipe((resp.equipe ?? []).filter((p: PessoaDaEquipe) => p.perfil !== 'COLABORADOR'));
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

  useEffect(() => {
    carregar();
  }, [carregar]);

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
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir');
      return false;
    } finally {
      setOcupado(null);
    }
  }

  const planosAtivos = useMemo(() => planos.filter(p => p.ativo), [planos]);
  const ativos = useMemo(() => equipe.filter(p => p.status === 'ATIVO'), [equipe]);

  /** Recebe comissão de verdade: plano vinculado, ativo E que paga alguma
   *  coisa. O chip antigo dizia "Recebe" olhando só se o plano estava ativo,
   *  prometendo comissão mesmo quando o plano não tinha faixa nem percentual. */
  const recebeComissao = useCallback(
    (p: PessoaDaEquipe) => {
      const plano = planos.find(x => x.id === p.plano_comissao_id);
      if (!plano || !plano.ativo) return false;
      return (plano.faixas ?? []).length > 0 || num(plano.percentual_padrao) > 0;
    },
    [planos],
  );

  const semPlano = useMemo(() => ativos.filter(p => !recebeComissao(p)), [ativos, recebeComissao]);
  const comPlano = ativos.length - semPlano.length;
  const valorForaDaConta = round2(soma(aguardando.map(a => num(a.valor_vendido))));
  const vendasForaDaConta = aguardando.reduce((t, a) => t + num(a.vendas), 0);
  const metaDaEquipe = round2(soma(ativos.map(p => num(p.meta_mensal_vendas))));
  const comMeta = ativos.filter(p => num(p.meta_mensal_vendas) > 0).length;

  // Uma pastilha por pessoa, com o terceiro estado para quem vende sem estar
  // cadastrada: a forma carrega o estado antes da cor.
  const unidades: Unidade[] = [
    ...ativos.map(p => ({
      id: p.id,
      rotulo: p.nome,
      estado: (recebeComissao(p) ? 'preenchida' : 'contorno') as Unidade['estado'],
      descricao: recebeComissao(p)
        ? `${p.nome} · recebe comissão`
        : `${p.nome} · sem plano · não gera comissão`,
    })),
    ...aguardando.map(a => ({
      id: `aguardando-${a.id}`,
      rotulo: a.nome || 'Sem nome',
      estado: 'tracejada' as const,
      descricao: `${a.nome || 'Sem nome'} · vende e não está cadastrada aqui`,
    })),
  ];

  const linhasDeMeta: LinhaBarra[] = ativos.map(p => ({
    id: p.id,
    nome: p.nome,
    valor: num(p.meta_mensal_vendas) > 0 ? num(p.meta_mensal_vendas) : null,
    rotuloAusencia: 'sem meta definida',
  }));

  // A escala travada entre painéis: comparar duas funções em escalas
  // diferentes é pior que não comparar, porque PARECE comparação.
  const escalaDosPlanos = useMemo(
    () =>
      escalaComumDeFaixas(
        planosAtivos.map(p => ({
          faixas: (p.faixas ?? []).map(f => ({
            de: num(f.de),
            ate: num(f.ate) === 0 ? null : num(f.ate),
            percentual: num(f.percentual),
          })),
        })),
      ),
    [planosAtivos],
  );

  const pessoaDaFicha = ficha ? equipe.find(p => p.id === ficha) ?? null : null;

  function abrirFicha(id: string) {
    const p = equipe.find(x => x.id === id);
    if (!p) return;
    setRascunho({ plano: p.plano_comissao_id || '', meta: num(p.meta_mensal_vendas) });
    setFicha(id);
  }

  function fecharFicha() {
    setFicha(null);
    setRascunho(null);
  }

  async function salvarFicha() {
    if (!pessoaDaFicha || !rascunho) return;
    const ok = await acao(
      {
        acao: 'definir_comercial',
        usuario_id: pessoaDaFicha.id,
        plano_comissao_id: rascunho.plano,
        meta_mensal_vendas: rascunho.meta,
      },
      `p-${pessoaDaFicha.id}`,
      `Cadastro de ${pessoaDaFicha.nome} salvo`,
    );
    if (ok) fecharFicha();
  }

  // PRECEDÊNCIA: uma tela que responde sempre a mesma coisa não responde.
  // Dinheiro fora da conta vence quem está sem plano, que vence a meta.
  const caso: 'fora-da-conta' | 'sem-plano' | 'meta' =
    aguardando.length > 0 ? 'fora-da-conta' : semPlano.length > 0 ? 'sem-plano' : 'meta';

  const nomesSemPlano = semPlano.map(p => primeiroNome(p.nome));
  const listaDeNomes =
    nomesSemPlano.length === 0
      ? ''
      : nomesSemPlano.length === 1
        ? nomesSemPlano[0]
        : `${nomesSemPlano.slice(0, -1).join(', ')} e ${nomesSemPlano[nomesSemPlano.length - 1]}`;

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Vendedores e planos"
        subtitulo="A mesma equipe cadastrada em Configurações. Quem tem plano recebe comissão"
        badge={
          semPlano.length > 0 ? (
            <span className="fin-t-caption rounded-[var(--fin-r-sm)] bg-[var(--fin-warning-soft)] px-2 py-1 font-semibold text-[var(--fin-warning-text)]">
              {`${semPlano.length} sem plano`}
            </span>
          ) : undefined
        }
        acaoPrimaria={
          semPlano.length > 0
            ? {
                rotulo: `Atribuir plano a quem não tem (${semPlano.length})`,
                icone: UserPlus,
                onClick: () => abrirFicha(semPlano[0].id),
              }
            : undefined
        }
        acoesSecundarias={[
          { rotulo: 'Cadastrar pessoa', href: '/config/usuarios' },
          { rotulo: 'Planos de comissão', href: '/equipe/planos-comissao' },
        ]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <DataState
        className={RITMO_DA_PAGINA}
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
            <div className="h-[124px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
            <div className={`${CARTAO} h-64`} />
          </div>
        }
      >
        {ativos.length === 0 && aguardando.length === 0 ? (
          <div className={`${CARTAO} p-[var(--fin-s-5)]`}>
            <EmptyLesson
              motivo="sem-dado"
              titulo="Nenhuma pessoa na equipe"
              oQueE="Aqui você diz quem vende, com qual plano de comissão e com qual meta mensal."
              comoComeca={[
                'Cadastre a pessoa em Configurações, Usuários',
                'Escolha o plano de comissão dela',
                'Defina a meta mensal de vendas',
              ]}
              acao={{ rotulo: 'Cadastrar pessoa', href: '/config/usuarios' }}
            />
          </div>
        ) : (
          <>
            {/* ── A RESPOSTA ─────────────────────────────────────────────── */}
            <Resposta
              overline={
                caso === 'fora-da-conta'
                  ? 'DINHEIRO FORA DA CONTA DE COMISSÃO'
                  : caso === 'sem-plano'
                    ? 'QUEM RECEBE COMISSÃO'
                    : 'A META QUE A EQUIPE CARREGA'
              }
              valor={
                caso === 'fora-da-conta' ? (
                  <Money valor={valorForaDaConta} size="resposta" align="esquerda" />
                ) : caso === 'sem-plano' ? (
                  `${comPlano} de ${ativos.length}`
                ) : (
                  <Money valor={metaDaEquipe} size="resposta" align="esquerda" />
                )
              }
              frase={
                caso === 'fora-da-conta'
                  ? `${vendasForaDaConta} ${vendasForaDaConta === 1 ? 'venda' : 'vendas'} de ${aguardando.length} ${aguardando.length === 1 ? 'pessoa que não está cadastrada' : 'pessoas que não estão cadastradas'} aqui. ${haQuantoTempo(aguardando.map(a => a.ultima_venda).filter(Boolean).sort().reverse()[0] ?? null)}.`
                  : caso === 'sem-plano'
                    ? `${listaDeNomes} ${semPlano.length === 1 ? 'está' : 'estão'} sem plano, então as vendas ${semPlano.length === 1 ? 'dessa pessoa' : 'dessas pessoas'} não geram comissão.`
                    : `por mês, somando ${comMeta} ${comMeta === 1 ? 'pessoa' : 'pessoas'}.${ativos.length - comMeta > 0 ? ` ${ativos.length - comMeta} ${ativos.length - comMeta === 1 ? 'ativa ainda sem meta' : 'ativas ainda sem meta'}.` : ''}`
              }
              marca={
                caso === 'meta' ? (
                  <BarrasNomeadas linhas={linhasDeMeta} formatar={BRL} alturaBarra={10} onAtivar={abrirFicha} />
                ) : (
                  <Unidades
                    unidades={unidades}
                    legenda={[
                      { estado: 'preenchida', rotulo: 'recebe comissão' },
                      { estado: 'contorno', rotulo: 'tem cadastro e está sem plano' },
                      { estado: 'tracejada', rotulo: 'vende e não está cadastrada aqui' },
                    ]}
                    onAtivar={id => { if (!id.startsWith('aguardando-')) abrirFicha(id); }}
                  />
                )
              }
            />
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {`${ativos.length} ${ativos.length === 1 ? 'pessoa ativa' : 'pessoas ativas'} com acesso ao sistema. A Folha pode contar mais, porque inclui quem não usa o sistema.`}
            </p>

            {/* ── FORA DA CONTA ──────────────────────────────────────────── */}
            {aguardando.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="fin-t-subhead text-[var(--fin-text)]">
                  {`Venderam pelo CRM sem estar cadastradas aqui — ${BRL(valorForaDaConta)}`}
                </h2>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  As vendas entraram normalmente. O que não acontece é comissão e meta.
                </p>
                <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                  {aguardando.map(a => (
                    <li key={a.id} className="flex min-h-[44px] flex-wrap items-center gap-3 py-3">
                      <div className="min-w-[12rem] flex-1">
                        <p className="fin-t-body-strong text-[var(--fin-text)]">{a.nome || 'Sem nome'}</p>
                        <p className="fin-t-caption text-[var(--fin-text-3)]">
                          {`${a.vendas} ${a.vendas === 1 ? 'venda' : 'vendas'} · ${BRL(num(a.valor_vendido))} · ${haQuantoTempo(a.ultima_venda)}`}
                        </p>
                      </div>
                      <button
                        className="inline-flex h-11 shrink-0 items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-4 fin-t-body-strong text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-50"
                        disabled={ocupado === `a-${a.id}`}
                        onClick={() =>
                          acao(
                            { acao: 'confirmar_cadastro', usuario_id: a.id },
                            `a-${a.id}`,
                            `${a.nome || 'Vendedor'} entrou na equipe. Defina o plano para gerar comissão.`,
                          )
                        }
                      >
                        <UserCheck className="h-4 w-4" aria-hidden />
                        É do time, cadastrar
                      </button>
                    </li>
                  ))}
                </ul>
                {/* A explicação estava escondida em title=, invisível no toque,
                    que é onde a tela mais é usada. */}
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Depois de cadastrar, escolha o plano de comissão e recalcule as comissões do mês.
                </p>
              </section>
            )}

            {/* ── A META QUE A EQUIPE CARREGA ────────────────────────────── */}
            {caso !== 'meta' && ativos.length > 0 && (
              <GraficoMoldura
                titulo="Meta mensal por pessoa"
                sublinha={`Some ${BRL(metaDaEquipe)} em ${comMeta} ${comMeta === 1 ? 'pessoa' : 'pessoas'}. É essa a meta que o ranking usa quando o mês não tem meta acordada.`}
                estado="ok"
                descricao="Meta mensal de vendas de cada pessoa ativa, na mesma escala."
                tabela={{
                  colunas: ['Pessoa', 'Meta mensal'],
                  linhas: ativos.map(p => [p.nome, num(p.meta_mensal_vendas) > 0 ? BRL(num(p.meta_mensal_vendas)) : '—']),
                }}
              >
                <BarrasNomeadas linhas={linhasDeMeta} formatar={BRL} alturaBarra={10} onAtivar={abrirFicha} />
              </GraficoMoldura>
            )}

            {/* ── A EQUIPE ───────────────────────────────────────────────── */}
            <section className="flex flex-col gap-3">
              <h2 className="fin-t-subhead text-[var(--fin-text)]">A equipe</h2>
              <ul className="grid gap-[var(--fin-s-3)] lg:grid-cols-2">
                {/* Sem plano primeiro: é o grupo acionável, e era o que levava
                    o tratamento mais apagado da tela. */}
                {[...ativos].sort((a, b) => Number(recebeComissao(a)) - Number(recebeComissao(b))).map(p => {
                  const plano = planos.find(x => x.id === p.plano_comissao_id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => abrirFicha(p.id)}
                        className={`${CARTAO} flex w-full min-h-[96px] flex-col gap-1 p-[var(--fin-s-4)] text-left transition-colors hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="fin-t-body-strong min-w-0 truncate text-[var(--fin-text)]">{p.nome}</span>
                          {p.origem === 'CRM' && <StatusChip valor="CRM" dominio="origem" />}
                        </div>
                        <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{p.email || 'sem email'}</span>
                        <span className="fin-t-body text-[var(--fin-text-2)]">
                          {recebeComissao(p)
                            ? `${plano?.nome ?? 'Plano'} · recebe comissão`
                            : plano && !plano.ativo
                              ? `${plano.nome} está inativo — não gera comissão`
                              : plano
                                ? `${plano.nome} não paga nada — revisar o plano`
                                : 'Sem plano, não gera comissão'}
                        </span>
                        <span className="fin-t-caption text-[var(--fin-text-3)]">
                          {num(p.meta_mensal_vendas) > 0 ? `meta ${BRL(num(p.meta_mensal_vendas))} por mês` : 'sem meta definida'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ── COMO CADA PLANO PAGA ───────────────────────────────────── */}
            {planosAtivos.length > 0 && (
              <section className="flex flex-col gap-3">
                <div>
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">Como cada plano paga</h2>
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    Todos os painéis usam a mesma escala, então a comparação entre planos é direta.
                  </p>
                </div>
                <div className="grid gap-[var(--fin-s-4)] lg:grid-cols-2 xl:grid-cols-3">
                  {planosAtivos.map(plano => {
                    const faixas = (plano.faixas ?? []).map(f => ({
                      de: num(f.de),
                      ate: num(f.ate) === 0 ? null : num(f.ate),
                      percentual: num(f.percentual),
                    }));
                    return (
                      <div key={plano.id} className={`${CARTAO} p-[var(--fin-s-4)]`}>
                        {faixas.length > 0 ? (
                          <EscadaDeFaixas
                            modo="degraus"
                            faixas={faixas}
                            nomePlano={plano.nome}
                            baseDoCalculo={`sobre ${String(plano.base_calculo ?? 'a base da venda').toLowerCase()}`}
                            escalaTravada={escalaDosPlanos}
                            formatar={BRL}
                          />
                        ) : (
                          <div className="flex flex-col gap-1">
                            <p className="fin-t-body-strong text-[var(--fin-text)]">{plano.nome}</p>
                            {/* Plano sem faixa não é gráfico: é um número. */}
                            <p className="fin-t-metric-sm text-[var(--fin-text)]">{`${num(plano.percentual_padrao)}%`}</p>
                            <p className="fin-t-caption text-[var(--fin-text-3)]">
                              {num(plano.percentual_padrao) > 0
                                ? `fixo, sobre ${String(plano.base_calculo ?? 'a base da venda').toLowerCase()}`
                                : 'Este plano não paga nada — revisar'}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── FICHAS ANTIGAS ─────────────────────────────────────────── */}
            {orfaos.length > 0 && (
              <details className="rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)]">
                <summary className="fin-t-body flex min-h-[44px] cursor-pointer items-center text-[var(--fin-text-2)]">
                  {`${orfaos.length} ${orfaos.length === 1 ? 'ficha antiga sem usuário correspondente' : 'fichas antigas sem usuário correspondente'}`}
                </summary>
                <ul className="mt-2 flex flex-col divide-y divide-[var(--fin-border)]">
                  {orfaos.map(o => {
                    const plano = planos.find(x => x.id === o.plano_comissao_id);
                    return (
                      <li key={o.id} className="flex min-h-[44px] flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="fin-t-body-strong text-[var(--fin-text)]">{o.nome || 'Sem nome'}</p>
                          <p className="fin-t-caption text-[var(--fin-text-3)]">
                            {/* O plano da ficha era carregado e não exibido — e é
                                justamente o que se perde ao arquivar. */}
                            {`${o.email || 'sem email'}${plano ? ` · plano ${plano.nome}` : ''}${num(o.meta_mensal_vendas) > 0 ? ` · meta ${BRL(num(o.meta_mensal_vendas))}` : ''}`}
                          </p>
                        </div>
                        <Link href="/config/usuarios" className={BOTAO}>
                          <ExternalLink className="h-4 w-4" aria-hidden />
                          Cadastrar como usuário
                        </Link>
                        <button
                          className={BOTAO}
                          disabled={ocupado === `o-${o.id}`}
                          onClick={() => acao({ acao: 'descartar_orfao', membro_id: o.id }, `o-${o.id}`, `Ficha de ${o.nome || 'equipe'} arquivada`)}
                        >
                          Arquivar
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 fin-t-caption text-[var(--fin-text-3)]">
                  Arquivar não apaga nada: o histórico continua auditável.
                </p>
              </details>
            )}
          </>
        )}

        <p className="fin-t-caption text-[var(--fin-text-3)]">
          A equipe é cadastrada em{' '}
          <Link href="/config/usuarios" className="text-[var(--fin-accent)] underline underline-offset-2">
            Configurações, Usuários
          </Link>
          . Depois de atribuir o plano, recalcule as comissões em{' '}
          <Link href="/equipe/comissoes" className="text-[var(--fin-accent)] underline underline-offset-2">
            Comissões
          </Link>
          .
        </p>
      </DataState>

      {/* ── FICHA DA PESSOA ──────────────────────────────────────────────── */}
      {pessoaDaFicha && rascunho && (
        <RecordSheet
          aberto
          onOpenChange={aberto => { if (!aberto) fecharFicha(); }}
          titulo={pessoaDaFicha.nome}
          descricao={pessoaDaFicha.email || 'sem email'}
          sujo={
            rascunho.plano !== (pessoaDaFicha.plano_comissao_id || '') ||
            rascunho.meta !== num(pessoaDaFicha.meta_mensal_vendas)
          }
          resumo={
            rascunho.plano
              ? `As vendas de ${primeiroNome(pessoaDaFicha.nome)} passam a gerar comissão pelo plano escolhido. Comissões já calculadas não mudam sozinhas — recalcule em Comissões.`
              : `Sem plano, as vendas de ${primeiroNome(pessoaDaFicha.nome)} não geram comissão.`
          }
          acaoPrimaria={{
            rotulo: 'Salvar',
            onClick: salvarFicha,
            carregando: ocupado === `p-${pessoaDaFicha.id}`,
          }}
          acaoSecundaria={{ rotulo: 'Cancelar', onClick: fecharFicha }}
        >
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="fin-t-caption text-[var(--fin-text-3)]">Plano de comissão</span>
              <select
                className={CAMPO}
                value={rascunho.plano}
                onChange={e => setRascunho(r => (r ? { ...r, plano: e.target.value } : r))}
              >
                <option value="">Sem plano, não gera comissão</option>
                {planosAtivos.map(x => (
                  <option key={x.id} value={x.id}>
                    {`${x.nome} · ${(x.faixas ?? []).length > 0 ? `${(x.faixas ?? []).length} faixas` : `${num(x.percentual_padrao)}% fixo`} · ${String(x.base_calculo ?? '').toLowerCase() || 'base da venda'}`}
                  </option>
                ))}
              </select>
              {pessoaDaFicha.plano_comissao_id && !planos.find(x => x.id === pessoaDaFicha.plano_comissao_id) && (
                <span className="fin-t-caption text-[var(--fin-negative-text)]">
                  O plano vinculado não existe mais
                </span>
              )}
            </label>

            {/* MoneyField no lugar do input type=number cru: 225000 sem
                máscara é onde nasce o erro de um zero. */}
            <MoneyField
              rotulo="Meta mensal de vendas"
              valor={rascunho.meta}
              onChange={v => setRascunho(r => (r ? { ...r, meta: v } : r))}
              ajuda="É a meta que o ranking usa quando o mês não tem meta acordada."
            />
          </div>
        </RecordSheet>
      )}
    </MolduraDaPagina>
  );
}
