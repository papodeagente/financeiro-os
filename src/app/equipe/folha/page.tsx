'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Pencil, TriangleAlert, UserPlus } from 'lucide-react';

import type { VinculoEmpresa } from '@/lib/crm-types';
import {
  DIA_PAGAMENTO_FOLHA_PADRAO,
  LIMITE_FOLHA_SOBRE_FATURAMENTO,
  ROTULO_CONTRATO,
  contaFolhaId,
  dataPagamentoDaFolha,
  estaNaFolhaNoMes,
  faixaDaRelacao,
  faixaDeCusto,
  montarFolha,
  type EntradaPessoa,
  type PessoaNaFolha,
} from '@/lib/folha-pagamento';
import { divSegura, hojeISO, mesDe, num, round2 } from '@/lib/money';
import { carregarEntidades } from '@/lib/crm-storage';
import { PageHeader } from '@/components/fin/PageHeader';
import { PageShell, RITMO_DA_PAGINA } from '@/components/fin/PageShell';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Money } from '@/components/fin/Money';
import { Resposta } from '@/components/fin/Resposta';
import { ReguaDeRazao } from '@/components/fin/ReguaDeRazao';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { BarraDeParte, type Parte } from '@/components/fin/BarraDeParte';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { SeletorDeMes, rotuloDoMes, useMesDaUrl } from '@/components/fin/SeletorDeMes';
import { toast } from '@/lib/toast';
import { DialogVinculo, vinculoVazio } from './DialogVinculo';

interface PessoaAPI extends EntradaPessoa {
  email?: string;
  perfil?: string;
  ativo?: boolean;
}

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';
const BOTAO =
  'inline-flex h-11 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] ' +
  'bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] ' +
  'hover:text-[var(--fin-text)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

const BRL = (v: number) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(num(v))}%`;
const dataBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');

/** Ícone MAIS rótulo: cor de status sozinha nunca é sinal. */
const CHIP_DA_FAIXA = {
  dentro: { icone: CheckCircle2, rotulo: 'Dentro do limite', tom: 'positivo' as const },
  'no-limite': { icone: TriangleAlert, rotulo: 'No limite de 40%', tom: 'aviso' as const },
  acima: { icone: TriangleAlert, rotulo: 'Acima do limite', tom: 'negativo' as const },
  'muito-acima': { icone: TriangleAlert, rotulo: 'Muito acima do limite', tom: 'negativo' as const },
};

function Esqueleto() {
  return (
    <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
      <div className="h-[44px] w-40 rounded bg-[var(--fin-surface-2)]" />
      <div className="h-[180px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
      <div className={`${CARTAO} h-64`} />
    </div>
  );
}

export default function FolhaPage() {
  const [pessoas, setPessoas] = useState<PessoaAPI[]>([]);
  const [faturamento, setFaturamento] = useState<Record<string, number>>({});
  const [idsDeContas, setIdsDeContas] = useState<string[]>([]);
  const [mes, setMes] = useMesDaUrl();
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
      // As contas a pagar dizem se a folha do mês JÁ saiu do previsto. Falha
      // aqui não derruba a tela: só apaga a linha do estado de lançamento.
      const contas = await carregarEntidades<{ id: string }>('contas-pagar');
      setIdsDeContas(contas.erro ? [] : contas.dados.map(c => c.id));
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

  const folha = useMemo(() => montarFolha(pessoas, mes), [pessoas, mes]);
  const faturamentoMes = round2(num(faturamento[mes]));
  const relacao = faturamentoMes > 0 ? round2(divSegura(folha.total, faturamentoMes) * 100) : 0;
  const faixa = faixaDaRelacao(relacao);
  const dispersao = useMemo(() => faixaDeCusto(folha), [folha]);
  const nomeDoMes = rotuloDoMes(mes);

  const pagamento = dataPagamentoDaFolha(mes, DIA_PAGAMENTO_FOLHA_PADRAO);
  const jaLancada = useMemo(() => {
    const existentes = new Set(idsDeContas);
    return folha.pessoas.some(p => existentes.has(contaFolhaId(mes, p.id)));
  }, [idsDeContas, folha.pessoas, mes]);

  // Duas filas distintas, e a segunda hoje é invisível: quem tem vínculo com
  // na_folha desligado, ou saiu antes do mês, some da tela inteira sem contador.
  const semVinculo = useMemo(() => pessoas.filter(p => !p.vinculo && p.ativo !== false), [pessoas]);
  const foraNesteMes = useMemo(
    () => pessoas.filter(p => p.vinculo && !estaNaFolhaNoMes(p.vinculo, mes)),
    [pessoas, mes],
  );

  // O histórico não vira gráfico: em cada mês passado o custo seria
  // reconstruído com o vínculo de HOJE, e sem data de admissão não há como
  // saber quem já estava na equipe. Dado fabricado não vira desenho melhor.
  const semDataDeAdmissao = useMemo(
    () => folha.pessoas.filter(p => !mesDe(p.data_admissao)).length,
    [folha.pessoas],
  );
  const mesesComFaturamento = useMemo(
    () => Object.values(faturamento).filter(v => num(v) > 0).length,
    [faturamento],
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

  function abrirFicha(id: string) {
    const pessoa = pessoas.find(p => p.id === id);
    if (!pessoa) return;
    setEditando({ id: pessoa.id, nome: pessoa.nome, vinculo: pessoa.vinculo ?? vinculoVazio() });
  }

  const linhasDaEquipe: LinhaBarra[] = folha.pessoas.map(p => ({
    id: p.id,
    nome: p.nome,
    valor: p.custo.total,
    secundario: `${PCT(round2(divSegura(p.custo.total, folha.total) * 100))} da folha · ${ROTULO_CONTRATO[p.tipo_contrato]}${p.cargo ? ` · ${p.cargo}` : ''}`,
    detalhes: [
      `salário ${BRL(p.custo.salario)}`,
      `benefícios ${BRL(p.custo.beneficios)}`,
      `encargos ${BRL(p.custo.encargos)}`,
      `13º e férias ${BRL(p.custo.provisoes)}`,
      ...(p.data_admissao ? [`na equipe desde ${dataBR(p.data_admissao)}`] : ['sem data de admissão registrada']),
      ...(p.data_desligamento ? [`desligado em ${dataBR(p.data_desligamento)}`] : []),
    ],
  }));

  // Matizes distintos em ordem FIXA: rubrica é categoria nominal. As cores de
  // status saíram daqui — "encargos" em laranja de alerta e "13º" em verde de
  // sucesso emitiam um julgamento que o dado não tem.
  const rubricas: Parte[] = [
    { id: 'salarios', rotulo: 'Salários', valor: folha.salarios, papel: 'serie', indiceSerie: 1 },
    { id: 'encargos', rotulo: 'Encargos', valor: folha.encargos, papel: 'serie', indiceSerie: 2 },
    { id: 'beneficios', rotulo: 'Benefícios', valor: folha.beneficios, papel: 'serie', indiceSerie: 3 },
    { id: 'provisoes', rotulo: '13º e férias', valor: folha.provisoes, papel: 'serie', indiceSerie: 4 },
  ];

  const contratos: Parte[] = folha.por_contrato.map((c, i) => ({
    id: c.tipo,
    rotulo: `${ROTULO_CONTRATO[c.tipo]} (${c.quantidade})`,
    valor: c.total,
    papel: 'serie' as const,
    indiceSerie: ((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6,
  }));

  const colunas: FinColuna<PessoaNaFolha>[] = [
    {
      id: 'pessoa',
      cabecalho: 'Pessoa',
      tipo: 'texto',
      prioridade: 3,
      acessor: r => r.nome,
      sortable: true,
      render: r => (
        <div className="min-w-0">
          <p className="fin-t-body-strong truncate text-[var(--fin-text)]">{r.nome}</p>
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            {ROTULO_CONTRATO[r.tipo_contrato]}
            {r.cargo ? ` · ${r.cargo}` : ''}
            {r.data_desligamento ? ` · desligado em ${dataBR(r.data_desligamento)}` : ''}
          </p>
        </div>
      ),
    },
    { id: 'salario', cabecalho: 'Salário', tipo: 'dinheiro', prioridade: 1, valor: r => r.custo.salario },
    { id: 'beneficios', cabecalho: 'Benefícios', tipo: 'dinheiro', prioridade: 1, valor: r => r.custo.beneficios },
    { id: 'encargos', cabecalho: 'Encargos', tipo: 'dinheiro', prioridade: 2, valor: r => r.custo.encargos },
    { id: 'provisoes', cabecalho: '13º e férias', tipo: 'dinheiro', prioridade: 2, valor: r => r.custo.provisoes },
    // Prioridade 3: o custo total NUNCA é escondido. É a coluna que a pessoa
    // veio conferir, e era justamente a que saía da viewport em 375px.
    { id: 'total', cabecalho: 'Custo total', tipo: 'dinheiro', prioridade: 3, sortable: true, valor: r => r.custo.total },
    {
      id: 'acoes',
      cabecalho: '',
      tipo: 'acoes',
      prioridade: 3,
      render: r => (
        <button className={BOTAO} onClick={() => abrirFicha(r.id)}>
          <Pencil className="h-4 w-4" aria-hidden />
          Editar
        </button>
      ),
    },
  ];

  const temFolha = folha.quantidade > 0;

  return (
    <PageShell>
      <PageHeader
        titulo="Folha de pagamento"
        subtitulo="Quanto a equipe custa por mês e quanto isso pesa no faturamento"
        acoesSecundarias={[{ rotulo: 'Cadastrar pessoa', href: '/config/usuarios' }]}
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
      />

      <DataState
        className={RITMO_DA_PAGINA}
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { carregar(); } } : null}
        esqueleto={<Esqueleto />}
      >
        {/* UM controle de mês, e ele vive na URL: o período atravessa a
            navegação entre as telas do pilar em vez de voltar para hoje. */}
        <SeletorDeMes valor={mes} onChange={setMes} />

        {!temFolha ? (
          <div className={`${CARTAO} p-[var(--fin-s-5)]`}>
            <EmptyLesson
              motivo="sem-dado"
              titulo={`Ninguém está na folha em ${nomeDoMes}`}
              oQueE="A folha mostra quanto cada pessoa da empresa custa por mês, somando salário, benefícios, encargos e provisões de 13º e férias."
              comoComeca={[
                'Cadastre a pessoa em Configurações, Usuários',
                'Quem não usa o sistema entra com o perfil Colaborador',
                'Defina o vínculo dela aqui, com salário e contrato',
              ]}
              acao={{ rotulo: 'Cadastrar pessoa', href: '/config/usuarios' }}
            />
          </div>
        ) : (
          <>
            {/* ── A RESPOSTA ─────────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <Resposta
                overline={
                  faturamentoMes > 0
                    ? `A FOLHA CONTRA O QUE A AGÊNCIA FATUROU EM ${nomeDoMes.toUpperCase()}`
                    : `A FOLHA DE ${nomeDoMes.toUpperCase()}`
                }
                valor={
                  faturamentoMes > 0 ? (
                    PCT(relacao)
                  ) : (
                    <Money valor={folha.total} size="resposta" align="esquerda" />
                  )
                }
                frase={
                  faturamentoMes > 0
                    ? `A equipe custou ${BRL(folha.total)} e a agência faturou ${BRL(faturamentoMes)}.` +
                      (folha.total > faturamentoMes
                        ? ` Faltaram ${BRL(round2(folha.total - faturamentoMes))} só para empatar.`
                        : ` Sobraram ${BRL(round2(faturamentoMes - folha.total))} depois de pagar a equipe.`)
                    : `${folha.quantidade} ${folha.quantidade === 1 ? 'pessoa' : 'pessoas'} na folha de ${nomeDoMes}.`
                }
                chip={faixa === 'sem-base' ? null : CHIP_DA_FAIXA[faixa]}
                marca={
                  <ReguaDeRazao
                    valor={folha.total}
                    rotuloValor="Folha"
                    base={faturamentoMes}
                    rotuloBase="faturamento"
                    marcas={[
                      {
                        id: 'limite',
                        valor: round2(faturamentoMes * (LIMITE_FOLHA_SOBRE_FATURAMENTO / 100)),
                        rotulo: `limite saudável`,
                        descricao: `Acima de ${LIMITE_FOLHA_SOBRE_FATURAMENTO}% do faturamento sobra pouco para custo fixo, marketing e lucro.`,
                      },
                    ]}
                    detalhes={[`${folha.quantidade} ${folha.quantidade === 1 ? 'pessoa' : 'pessoas'}`]}
                    formatar={BRL}
                    semBase={{
                      frase: `Não houve venda registrada em ${nomeDoMes}, então não há faturamento com o que comparar.`,
                      acao: { rotulo: 'Ver as vendas do mês', href: '/vendas' },
                    }}
                  />
                }
              />
              {/* Nomear a base é obrigatório: o faturamento inclui o repasse a
                  fornecedores, então esta razão é mais otimista do que a
                  comparação com o que fica de fato com a agência. */}
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                Comparado com o faturamento, que inclui o repasse a fornecedores. Sobre o que fica de fato
                com a agência, essa proporção é maior.
              </p>
            </div>

            {/* ── TRÊS FATOS ─────────────────────────────────────────────── */}
            <ul className="grid gap-[var(--fin-s-3)] sm:grid-cols-3">
              <li className="flex flex-col gap-1">
                <span className="fin-t-overline text-[var(--fin-text-3)]">Tamanho da equipe</span>
                <span className="fin-t-metric-sm text-[var(--fin-text)]">
                  {folha.quantidade} {folha.quantidade === 1 ? 'pessoa na folha' : 'pessoas na folha'}
                </span>
              </li>
              <li className="flex flex-col gap-1">
                <span className="fin-t-overline text-[var(--fin-text-3)]">Custo por pessoa</span>
                <span className="fin-t-metric-sm text-[var(--fin-text)]">{BRL(folha.custo_medio)}</span>
                {/* A média sozinha mente por omissão quando há R$ 4.200 e
                    R$ 19.800 na mesma folha. */}
                <span className="fin-t-caption text-[var(--fin-text-3)]">
                  {dispersao
                    ? `em média — de ${BRL(dispersao.minimo)} a ${BRL(dispersao.maximo)}`
                    : 'uma pessoa na folha: a média é o próprio valor'}
                </span>
              </li>
              <li className="flex flex-col gap-1">
                <span className="fin-t-overline text-[var(--fin-text-3)]">Quando sai</span>
                <span className="fin-t-metric-sm text-[var(--fin-text)]">{dataBR(pagamento)}</span>
                <span className="fin-t-caption text-[var(--fin-text-3)]">
                  {jaLancada ? 'já lançada em contas a pagar' : 'ainda não virou conta a pagar'}
                </span>
              </li>
            </ul>

            {/* ── QUEM CUSTA QUANTO ──────────────────────────────────────── */}
            <GraficoMoldura
              titulo="Quem custa quanto"
              sublinha="Ordenado por custo. A linha vertical é o custo médio."
              estado="ok"
              descricao={`Custo mensal por pessoa em ${nomeDoMes}, na mesma escala.`}
              tabela={{
                colunas: ['Pessoa', 'Custo', '% da folha'],
                linhas: folha.pessoas.map(p => [
                  p.nome,
                  BRL(p.custo.total),
                  PCT(round2(divSegura(p.custo.total, folha.total) * 100)),
                ]),
              }}
            >
              <BarrasNomeadas
                linhas={linhasDaEquipe}
                formatar={BRL}
                alturaBarra={10}
                onAtivar={abrirFicha}
                referencia={
                  folha.quantidade > 1
                    ? { valor: folha.custo_medio, rotulo: `média ${BRL(folha.custo_medio)}` }
                    : null
                }
                fraseDeLinhaUnica={l => `A folha é uma pessoa: ${l.nome}, ${BRL(num(l.valor))}.`}
              />
            </GraficoMoldura>

            {/* ── DE QUE É FEITO O CUSTO ─────────────────────────────────── */}
            <GraficoMoldura
              titulo="De que é feito o custo"
              sublinha="Salário é só uma parte do que a equipe custa."
              estado="ok"
              descricao={`Composição da folha de ${nomeDoMes} por rubrica e por tipo de contrato.`}
              tabela={{
                colunas: ['Rubrica', 'Valor', '% da folha'],
                linhas: [...rubricas, ...contratos].map(parte => [
                  parte.rotulo,
                  BRL(parte.valor),
                  PCT(round2(divSegura(parte.valor, folha.total) * 100)),
                ]),
              }}
            >
              {/* Largura idêntica entre as duas faixas: é isso que permite
                  comparar uma com a outra na vertical. */}
              <div className="grid gap-[var(--fin-s-4)] lg:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <p className="fin-t-caption text-[var(--fin-text-3)]">Por rubrica</p>
                  <BarraDeParte partes={rubricas} total={folha.total} formatar={BRL} />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="fin-t-caption text-[var(--fin-text-3)]">Por tipo de contrato</p>
                  <BarraDeParte partes={contratos} total={folha.total} formatar={BRL} />
                </div>
              </div>
            </GraficoMoldura>

            {/* ── A CONFERÊNCIA ──────────────────────────────────────────── */}
            <section className={`${CARTAO} overflow-hidden`}>
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                <h2 className="fin-t-subhead text-[var(--fin-text)]">Pessoas na folha de {nomeDoMes}</h2>
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  {folha.quantidade} {folha.quantidade === 1 ? 'pessoa' : 'pessoas'}
                </p>
              </header>
              <FinTable
                linhas={folha.pessoas}
                colunas={colunas}
                chave={p => p.id}
                estado="ok"
                vazio={{
                  motivo: 'sem-dado',
                  titulo: 'Ninguém na folha neste mês',
                  oQueE: 'A folha soma salário, benefícios, encargos e provisões de cada pessoa.',
                  comoComeca: ['Cadastre a pessoa em Configurações, Usuários', 'Defina o vínculo dela aqui'],
                  acao: { rotulo: 'Cadastrar pessoa', href: '/config/usuarios' },
                }}
                // O total existe para a pessoa conferir que as linhas somam o
                // número da manchete. Sem ele, o valor grande é um ato de fé.
                totais={[{ colunaId: 'total', valor: folha.total, rotulo: 'Custo da folha' }]}
              />
            </section>

            {/* ── PESSOAS FORA DA FOLHA ──────────────────────────────────── */}
            {(semVinculo.length > 0 || foraNesteMes.length > 0) && (
              <section className={`${CARTAO} overflow-hidden`}>
                <header className="border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                  <h2 className="fin-t-subhead text-[var(--fin-text)]">Pessoas fora da folha</h2>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">
                    Estão no sistema e não entram no custo de {nomeDoMes}.
                  </p>
                </header>

                {semVinculo.length > 0 && (
                  <>
                    <p className="fin-t-overline bg-[var(--fin-surface-2)] px-[var(--fin-s-4)] py-2 text-[var(--fin-text-3)]">
                      {semVinculo.length} sem vínculo definido
                    </p>
                    <ul className="divide-y divide-[var(--fin-border)]">
                      {semVinculo.map(p => (
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
                  </>
                )}

                {/* Este grupo não existia em tela nenhuma: quem tem vínculo
                    fora da folha, ou saiu antes do mês, simplesmente sumia. */}
                {foraNesteMes.length > 0 && (
                  <>
                    <p className="fin-t-overline bg-[var(--fin-surface-2)] px-[var(--fin-s-4)] py-2 text-[var(--fin-text-3)]">
                      {foraNesteMes.length} com vínculo, fora da folha neste mês
                    </p>
                    <ul className="divide-y divide-[var(--fin-border)]">
                      {foraNesteMes.map(p => {
                        const v = p.vinculo!;
                        const motivo = !v.na_folha
                          ? 'marcada como fora da folha'
                          : mesDe(v.data_desligamento) && mesDe(v.data_desligamento) < mes
                            ? `desligada em ${dataBR(v.data_desligamento)}`
                            : mesDe(v.data_admissao) && mesDe(v.data_admissao) > mes
                              ? `admitida em ${dataBR(v.data_admissao)}`
                              : 'fora do período';
                        return (
                          <li key={p.id} className="flex flex-wrap items-center gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                            <div className="min-w-0 flex-1">
                              <p className="fin-t-body-strong text-[var(--fin-text)]">{p.nome}</p>
                              <p className="fin-t-caption text-[var(--fin-text-3)]">{motivo}</p>
                            </div>
                            <button className={BOTAO} onClick={() => abrirFicha(p.id)}>
                              <Pencil className="h-4 w-4" aria-hidden />
                              Ver vínculo
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            )}

            {/* ── HISTÓRICO ──────────────────────────────────────────────── */}
            <section className="flex flex-col gap-1">
              <h2 className="fin-t-subhead text-[var(--fin-text)]">Histórico</h2>
              <p className="fin-t-body text-[var(--fin-text-2)]">
                {semDataDeAdmissao > 0
                  ? `A comparação mês a mês não é desenhada: o custo de um mês passado seria reconstruído com o vínculo de hoje, e ${semDataDeAdmissao} ${semDataDeAdmissao === 1 ? 'pessoa não tem' : 'pessoas não têm'} data de admissão registrada. Um gráfico assim afirmaria um passado que o sistema não guardou.`
                  : `Houve faturamento em ${mesesComFaturamento} ${mesesComFaturamento === 1 ? 'mês' : 'meses'} registrados. A comparação mês a mês nasce quando houver três meses com venda.`}
              </p>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                Para ver outro mês, use as setas acima: o mês fica no endereço da página e pode ser enviado por link.
              </p>
            </section>
          </>
        )}

        <p className="fin-t-caption text-[var(--fin-text-3)]">
          Quem não usa o sistema entra como Colaborador em{' '}
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
    </PageShell>
  );
}
