'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

import { loadEntities, loadEquipe, carregarEntidades } from '@/lib/crm-storage';
import { vendasComLancamento, apenasVendasComLastro } from '@/lib/venda-lancamentos';
import { normalizeVenda, receitaDaAgencia, type VendaDash } from '@/lib/venda-dash';
import type {
  CACMensal, Cliente, ContaBancaria, ContaPagar, ContaReceber, Membro, VendaCRM,
} from '@/lib/crm-types';
import { nomeDoCliente } from '@/lib/cliente-nome';
import {
  dataLocal, divSegura, hojeISO, mesDe, num, round2, soma, somaPor, ultimoDiaDoMes,
} from '@/lib/money';
import { calcularSaldoBancario } from '@/lib/saldo-bancario';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { Money } from '@/components/fin/Money';
import { Resposta } from '@/components/fin/Resposta';
import { ListaDeFatos, type Fato } from '@/components/fin/ListaDeFatos';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { BarraDeParte, type Parte } from '@/components/fin/BarraDeParte';
import { BarrasNomeadas, type LinhaBarra } from '@/components/fin/BarrasNomeadas';
import { EscadaAcumulada, type EventoAcum } from '@/components/fin/EscadaAcumulada';
import { SeletorDeMes, rotuloDoMes, useMesDaUrl } from '@/components/fin/SeletorDeMes';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num(v));
const PCT = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(num(v))}%`;
const dataCurta = (s: string) => dataLocal(s)?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) ?? '—';

/** A partir daqui a operação se sustenta. Limiar declarado, escrito na tela. */
const MARGEM_SAUDAVEL_PCT = 15;

function diasAte(iso: string): number {
  const d = dataLocal(iso);
  const hoje = dataLocal(hojeISO());
  if (!d || !hoje) return 0;
  return Math.round((d.getTime() - hoje.getTime()) / 86_400_000);
}

/**
 * As faixas de prazo. Ordinal, então rampa sequencial — e "vencido" é o
 * primeiro degrau, não uma cor de status: status vermelho aqui competiria com
 * o vermelho de "a pagar" na mesma tela.
 */
const PRAZOS = [
  { id: 'vencido', rotulo: 'vencido', dentro: (d: number) => d < 0, seq: 4 as const },
  { id: 'ate7', rotulo: 'até 7 dias', dentro: (d: number) => d >= 0 && d <= 7, seq: 3 as const },
  { id: 'ate30', rotulo: '8 a 30 dias', dentro: (d: number) => d > 7 && d <= 30, seq: 2 as const },
];

type Decisao = {
  id: string;
  nivel: 'resolver' | 'acompanhar';
  titulo: string;
  descricao: string;
  href: string;
  acao: string;
};

export default function DashboardPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendas, setVendas] = useState<VendaDash[]>([]);
  const [receber, setReceber] = useState<ContaReceber[]>([]);
  const [pagar, setPagar] = useState<ContaPagar[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [cacData, setCacData] = useState<CACMensal[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Nasce NULO, não com new Date(): num componente cliente o valor do servidor
  // difere do valor do cliente e o React reclama no hidrate. O carimbo só
  // existe quando a carga termina — que é quando ele passa a ser verdade.
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [mes, setMes] = useMesDaUrl();

  const fetchAll = useCallback(() => {
    setLoading(true);
    setErro(null);
    return Promise.all([
      loadEntities<Cliente>('clientes'),
      carregarEntidades<VendaCRM>('vendas-crm'),
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<ContaBancaria>('contas-bancarias'),
      loadEntities<CACMensal>('cac-mensal'),
      loadEquipe<Membro>(),
    ]).then(([cl, vn, cr, cp, cb, cac, mb]) => {
      setClientes(cl);
      setVendas(vn.dados.map(v => normalizeVenda(v as Partial<VendaCRM> & Record<string, unknown>)));
      setReceber(cr);
      setPagar(cp);
      setContas(cb);
      setCacData(cac);
      setMembros(mb);
      // A falha da carga tem que CHEGAR à tela: com a manchete em 44px,
      // anunciar "nenhuma venda" durante uma queda é pior do que não desenhar.
      setErro(vn.erro);
      setLoading(false);
      setLastUpdate(new Date());
    });
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const nomeDoMes = rotuloDoMes(mes);
  const ehMesCorrente = mes === mesDe(hojeISO());

  const vendasDoMes = useMemo(() => {
    // Venda sem lançamento financeiro não entra em número de resultado: quem
    // apagou as contas dela apagou o dinheiro do sistema. Mesma regra do DRE.
    const comLancamento = vendasComLancamento(receber, pagar);
    return apenasVendasComLastro(vendas, comLancamento).filter(
      v => v.data_venda?.startsWith(mes) && v.status !== 'CANCELADO',
    );
  }, [vendas, receber, pagar, mes]);

  const faturamento = useMemo(() => somaPor(vendasDoMes, v => v.valor_final), [vendasDoMes]);
  const ficouComAgencia = useMemo(() => somaPor(vendasDoMes, receitaDaAgencia), [vendasDoMes]);
  const repasse = round2(Math.max(0, faturamento - ficouComAgencia));
  const margemPct = round2(divSegura(ficouComAgencia, faturamento) * 100);
  const ticket = round2(divSegura(faturamento, vendasDoMes.length));
  const saudavel = margemPct >= MARGEM_SAUDAVEL_PCT;

  const saldoCaixa = useMemo(
    () => calcularSaldoBancario(contas, receber, pagar),
    [contas, receber, pagar],
  );

  // O resultado do mês: margem SEM clamp (uma viagem abaixo do custo é
  // prejuízo e precisa reduzir o mês) menos as despesas lançadas.
  const resultadoDoMes = useMemo(() => {
    const margemSemClamp = soma(
      vendasDoMes.map(v => round2(num(v.valor_final) - num(v.valor_total_custo))),
    );
    // A conta a pagar auto-gerada da própria venda É o custo do fornecedor,
    // que já saiu na margem. Contar as duas cobraria o custo duas vezes.
    const despesas = somaPor(
      pagar.filter(
        p =>
          p.data_vencimento?.startsWith(mes) &&
          (p.status === 'PAGO' || p.status === 'PENDENTE') &&
          !(p.auto_gerado && p.origem === 'VENDA'),
      ),
      p => p.valor_final,
    );
    return { valor: round2(margemSemClamp - despesas), despesas };
  }, [vendasDoMes, pagar, mes]);

  const cacDoMes = cacData.find(c => c.mes === mes)?.cac ?? 0;

  const eventosDoRitmo: EventoAcum[] = useMemo(
    () =>
      vendasDoMes
        .filter(v => !!v.data_venda)
        .map(v => {
          const vendedor = membros.find(m => m.id === v.vendedor_id);
          const cliente = clientes.find(c => c.id === v.cliente_id);
          return {
            data: v.data_venda,
            rotulo: vendedor?.nome || (cliente ? nomeDoCliente(cliente) : `Venda ${v.numero}`),
            valor: receitaDaAgencia(v),
            detalhe: cliente ? nomeDoCliente(cliente) : undefined,
          };
        }),
    [vendasDoMes, membros, clientes],
  );

  // Quem vendeu. A tela pertence ao pilar Equipe, carrega vendedor_id e a
  // lista de membros, e não citava uma pessoa sequer.
  const quemVendeu: LinhaBarra[] = useMemo(() => {
    const porPessoa = new Map<string, { valor: number; vendas: number }>();
    for (const v of vendasDoMes) {
      const chave = v.vendedor_id || '__sem_vendedor';
      const atual = porPessoa.get(chave) ?? { valor: 0, vendas: 0 };
      porPessoa.set(chave, {
        valor: round2(atual.valor + receitaDaAgencia(v)),
        vendas: atual.vendas + 1,
      });
    }
    const linhas: LinhaBarra[] = [...porPessoa.entries()].map(([id, dados]) => ({
      id,
      nome: id === '__sem_vendedor' ? 'Sem vendedor definido' : (membros.find(m => m.id === id)?.nome ?? 'Pessoa removida'),
      valor: dados.valor,
      secundario: `${PCT(round2(divSegura(dados.valor, ficouComAgencia) * 100))} do mês · ${dados.vendas} ${dados.vendas === 1 ? 'venda' : 'vendas'} · ticket ${BRL(round2(divSegura(dados.valor, dados.vendas)))}`,
    }));

    // Quem está na equipe e não vendeu entra como AUSÊNCIA declarada, não
    // como barra de R$ 0: "sem meta" e "meta zero" são estados diferentes.
    for (const membro of membros) {
      if (porPessoa.has(membro.id)) continue;
      linhas.push({
        id: membro.id,
        nome: membro.nome,
        valor: null,
        rotuloAusencia: `ainda sem venda em ${nomeDoMes}`,
      });
    }
    return linhas;
  }, [vendasDoMes, membros, ficouComAgencia, nomeDoMes]);

  // Entra e sai: as duas barras na MESMA escala de reais, que é o que permite
  // ver de relance que sai mais do que entra.
  const fluxo = useMemo(() => {
    const aberto = <T extends { status: string; data_vencimento: string; valor_final: number }>(
      linhas: T[],
      pendentes: string[],
    ) => linhas.filter(l => pendentes.includes(l.status) && diasAte(l.data_vencimento) <= 30);

    const receberAberto = aberto(receber, ['PENDENTE', 'ATRASADO']);
    const pagarAberto = aberto(pagar, ['PENDENTE', 'VENCIDO']);

    const fatiar = (linhas: Array<{ data_vencimento: string; valor_final: number }>): Parte[] =>
      PRAZOS.map(prazo => ({
        id: prazo.id,
        rotulo: prazo.rotulo,
        valor: somaPor(
          linhas.filter(l => prazo.dentro(diasAte(l.data_vencimento))),
          l => l.valor_final,
        ),
        papel: 'seq' as const,
        indiceSeq: prazo.seq,
      }));

    const totalReceber = somaPor(receberAberto, r => r.valor_final);
    const totalPagar = somaPor(pagarAberto, p => p.valor_final);

    const daSemana = [
      ...receberAberto
        .filter(r => diasAte(r.data_vencimento) >= 0 && diasAte(r.data_vencimento) <= 7)
        .map(r => ({
          id: `r-${r.id}`,
          sinal: '+' as const,
          valor: r.valor_final,
          descricao: r.cliente_nome || r.descricao || 'A receber',
          data: r.data_vencimento,
        })),
      ...pagarAberto
        .filter(p => diasAte(p.data_vencimento) >= 0 && diasAte(p.data_vencimento) <= 7)
        .map(p => ({
          id: `p-${p.id}`,
          sinal: '−' as const,
          valor: p.valor_final,
          descricao: p.fornecedor_nome || p.descricao || 'A pagar',
          data: p.data_vencimento,
        })),
    ].sort((a, b) => a.data.localeCompare(b.data));

    return {
      receber: fatiar(receberAberto),
      pagar: fatiar(pagarAberto),
      totalReceber,
      totalPagar,
      // A escala comum é o `total` das duas barras: sem ele, cada uma usaria a
      // própria largura e R$ 18.400 pareceria igual a R$ 9.120.
      escala: round2(Math.max(totalReceber, totalPagar)),
      daSemana,
      entramNaSemana: somaPor(daSemana.filter(l => l.sinal === '+'), l => l.valor),
      saemNaSemana: somaPor(daSemana.filter(l => l.sinal === '−'), l => l.valor),
    };
  }, [receber, pagar]);

  // Dois níveis, não quatro. Conquista não é alarme, e um alarme com quatro
  // graus e trilho colorido vira paisagem.
  const decisoes: Decisao[] = useMemo(() => {
    const lista: Decisao[] = [];
    const hj = hojeISO();

    const receberVencido = receber.filter(r => r.status === 'ATRASADO' || (r.status === 'PENDENTE' && r.data_vencimento < hj));
    if (receberVencido.length > 0) {
      lista.push({
        id: 'receber-vencido',
        nivel: 'resolver',
        titulo: `${receberVencido.length} ${receberVencido.length === 1 ? 'parcela vencida' : 'parcelas vencidas'} — ${BRL(somaPor(receberVencido, r => r.valor_final))} a receber`,
        descricao: [...new Set(receberVencido.map(r => r.cliente_nome).filter(Boolean))].slice(0, 3).join(', '),
        href: '/financeiro-ag/receber',
        acao: 'Cobrar',
      });
    }

    const pagarVencido = pagar.filter(p => p.status === 'VENCIDO' || (p.status === 'PENDENTE' && p.data_vencimento < hj));
    if (pagarVencido.length > 0) {
      lista.push({
        id: 'pagar-vencido',
        nivel: 'resolver',
        titulo: `${pagarVencido.length} ${pagarVencido.length === 1 ? 'pagamento vencido' : 'pagamentos vencidos'} — ${BRL(somaPor(pagarVencido, p => p.valor_final))}`,
        descricao: [...new Set(pagarVencido.map(p => p.fornecedor_nome).filter(Boolean))].slice(0, 3).join(', '),
        href: '/financeiro-ag/pagar',
        acao: 'Pagar',
      });
    }

    const pagarProximo = pagar.filter(p => p.status === 'PENDENTE' && diasAte(p.data_vencimento) >= 0 && diasAte(p.data_vencimento) <= 5);
    if (pagarProximo.length > 0) {
      lista.push({
        id: 'pagar-proximo',
        nivel: 'acompanhar',
        titulo: `${pagarProximo.length} ${pagarProximo.length === 1 ? 'pagamento vence' : 'pagamentos vencem'} em até 5 dias — ${BRL(somaPor(pagarProximo, p => p.valor_final))}`,
        descricao: pagarProximo.slice(0, 2).map(p => `${p.fornecedor_nome} em ${dataCurta(p.data_vencimento)}`).join(', '),
        href: '/financeiro-ag/pagar',
        acao: 'Ver',
      });
    }

    const orcamentosParados = vendas.filter(v => v.status === 'ORCAMENTO' && v.data_venda && diasAte(v.data_venda) < -7);
    if (orcamentosParados.length > 0) {
      lista.push({
        id: 'orcamentos',
        nivel: 'acompanhar',
        titulo: `${orcamentosParados.length} ${orcamentosParados.length === 1 ? 'orçamento aguarda resposta' : 'orçamentos aguardam resposta'} há mais de 7 dias`,
        descricao: 'Vale um retorno antes que esfriem.',
        href: '/vendas/orcamentos',
        acao: 'Ver',
      });
    }

    return lista;
  }, [receber, pagar, vendas]);

  // Para onde foi o dinheiro. Venda do CRM chega sem produtos detalhados — que
  // é o estado NORMAL —, e aí a pergunta que dá para responder é a outra: para
  // onde o dinheiro SAIU.
  const composicao = useMemo(() => {
    const porTipo = new Map<string, number>();
    for (const v of vendasDoMes) {
      for (const p of v.produtos ?? []) {
        const tipo = p.tipo || 'OUTROS';
        porTipo.set(tipo, round2((porTipo.get(tipo) ?? 0) + num(p.valor_venda)));
      }
    }
    if (porTipo.size > 0) {
      return {
        origem: 'venda' as const,
        linhas: [...porTipo.entries()].map(([tipo, valor]) => ({ id: tipo, nome: tipo, valor })),
      };
    }

    const ROTULO_NATUREZA: Record<string, string> = {
      FIXO: 'Custo fixo',
      VARIAVEL: 'Custo variável',
      COMPRA_UNICA: 'Compra única',
    };
    const porNatureza = new Map<string, number>();
    for (const p of pagar) {
      if (!p.data_vencimento?.startsWith(mes)) continue;
      if (p.status !== 'PAGO' && p.status !== 'PENDENTE') continue;
      const chave = ROTULO_NATUREZA[p.natureza_custo ?? ''] ?? 'Sem natureza definida';
      porNatureza.set(chave, round2((porNatureza.get(chave) ?? 0) + num(p.valor_final)));
    }
    return {
      origem: 'despesa' as const,
      linhas: [...porNatureza.entries()].map(([nome, valor]) => ({ id: nome, nome, valor })),
    };
  }, [vendasDoMes, pagar, mes]);

  const fatos: Fato[] = [
    {
      rotulo: 'Em caixa hoje',
      // Sem conta cadastrada o valor é um traço, nunca R$ 0,00: zero ali
      // seria um fato, e o fato é que ninguém informou.
      valor: <Money valor={saldoCaixa} size="strong" estado={contas.length === 0 ? 'indisponivel' : 'ok'} align="esquerda" />,
      contexto:
        contas.length === 0
          ? 'nenhuma conta bancária cadastrada'
          : `em ${contas.length} ${contas.length === 1 ? 'conta' : 'contas'}, saldo de agora`,
      acao: contas.length === 0 ? { rotulo: 'Cadastrar conta', href: '/financeiro-ag/contas-bancarias' } : undefined,
    },
    {
      rotulo: 'Sobrou no mês',
      valor: <Money valor={resultadoDoMes.valor} size="strong" tone={resultadoDoMes.valor < 0 ? 'negativo' : 'neutro'} align="esquerda" />,
      contexto:
        resultadoDoMes.despesas > 0
          ? `depois de ${BRL(resultadoDoMes.despesas)} em despesas lançadas`
          : `igual ao que ficou com a agência, porque nenhuma despesa foi lançada em ${nomeDoMes}`,
    },
    {
      rotulo: 'Custo por cliente novo',
      valor:
        cacDoMes > 0 ? (
          <Money valor={cacDoMes} size="strong" align="esquerda" />
        ) : (
          <span className="fin-t-body-strong text-[var(--fin-text-3)]">sem investimento registrado</span>
        ),
      contexto: cacDoMes > 0 ? `investimento em marketing dividido pelos clientes novos de ${nomeDoMes}` : undefined,
      acao: cacDoMes > 0 ? undefined : { rotulo: 'Registrar investimento', href: '/cac/dashboard' },
    },
  ];

  const [ano, mesNum] = mes.split('-').map(Number);
  const diasDoMes = ultimoDiaDoMes(ano, mesNum);
  const diaDeHoje = ehMesCorrente ? Number(hojeISO().slice(8, 10)) : diasDoMes;

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <PageHeader titulo="Painel" atualizadoEm={lastUpdate} onRecarregar={fetchAll} />

        <SeletorDeMes valor={mes} onChange={setMes} />

        <DataState
          estado={loading ? 'carregando' : erro ? 'erro' : 'ok'}
          erro={
            erro
              ? { mensagem: `Não foi possível carregar os dados de ${nomeDoMes}. Nada foi alterado.`, onTentarDeNovo: () => { fetchAll(); } }
              : null
          }
          esqueleto={
            <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden>
              <div className="h-[190px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
              <div className="h-[168px] rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
            </div>
          }
        >
          {/* ── A RESPOSTA ───────────────────────────────────────────────── */}
          <Resposta
            overline={`FICOU COM A AGÊNCIA EM ${nomeDoMes.toUpperCase()}`}
            valor={<Money valor={ficouComAgencia} size="resposta" align="esquerda" estado={faturamento > 0 ? 'ok' : 'indisponivel'} />}
            frase={
              faturamento > 0
                ? `De ${BRL(faturamento)} vendidos, ${BRL(repasse)} foram repasse a fornecedores. ${vendasDoMes.length === 1 ? 'Foi 1 venda' : `Foram ${vendasDoMes.length} vendas`}, ${BRL(ticket)} cada, em média.`
                : `Nenhuma venda com lançamento financeiro em ${nomeDoMes}. Quando a primeira entrar, o número aparece aqui.`
            }
            chip={
              faturamento > 0
                ? {
                    icone: saudavel ? CheckCircle2 : AlertTriangle,
                    rotulo: saudavel ? 'Saudável' : 'Margem apertada',
                    tom: saudavel ? 'positivo' : 'aviso',
                  }
                : null
            }
            marca={
              faturamento > 0 ? (
                <BarraDeParte
                  partes={[
                    { id: 'agencia', rotulo: 'Ficou com a agência', valor: ficouComAgencia, papel: 'serie', indiceSerie: 1 },
                    { id: 'repasse', rotulo: 'Repasse a fornecedores', valor: repasse, papel: 'resto' },
                  ]}
                  total={faturamento}
                  formatar={BRL}
                />
              ) : undefined
            }
          />
          {faturamento > 0 ? (
            // O limiar escrito por extenso: "15%" sozinho não diz se é bom.
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {`De cada R$ 100 vendidos, R$ ${Math.round(margemPct)} ficam com a agência. Saudável a partir de R$ ${MARGEM_SAUDAVEL_PCT}.`}
            </p>
          ) : null}

          {/* ── TRÊS FATOS ───────────────────────────────────────────────── */}
          <ListaDeFatos itens={fatos} />

          {/* ── RITMO DO MÊS ─────────────────────────────────────────────── */}
          <GraficoMoldura
            titulo={`Ritmo de ${nomeDoMes}`}
            sublinha="Como a receita da agência foi se formando, dia a dia."
            estado={eventosDoRitmo.length === 0 ? 'sem-dado' : 'ok'}
            vazio={{
              frase: `Nenhuma venda registrada em ${nomeDoMes}. Quando a primeira entrar, esta linha começa a subir.`,
              acao: { rotulo: 'Registrar venda', href: '/vendas/nova' },
            }}
            descricao={`Receita da agência acumulada dia a dia em ${nomeDoMes}.`}
            tabela={{
              colunas: ['Dia', 'Quem vendeu', 'Valor'],
              linhas: eventosDoRitmo.map(e => [dataCurta(e.data), e.rotulo, BRL(e.valor)]),
            }}
          >
            <EscadaAcumulada
              eventos={eventosDoRitmo}
              diasDoMes={diasDoMes}
              diaDeHoje={diaDeHoje}
              // O topo vem do DADO: escalar pela meta colaria a linha no chão e
              // desenharia fracasso num mês honesto. Meta é a pergunta da tela
              // de Metas, não desta.
              topoDoEixo="dado"
              formatar={BRL}
            />
          </GraficoMoldura>

          {/* ── QUEM VENDEU ──────────────────────────────────────────────── */}
          <GraficoMoldura
            titulo={`Quem vendeu em ${nomeDoMes}`}
            sublinha="Receita da agência por pessoa, na mesma escala."
            estado={quemVendeu.length === 0 ? 'sem-dado' : 'ok'}
            vazio={{ frase: `Nenhuma venda atribuída a um vendedor em ${nomeDoMes}.`, acao: { rotulo: 'Ver as vendas', href: '/vendas' } }}
            descricao={`Receita da agência por pessoa em ${nomeDoMes}, na mesma escala.`}
            tabela={{
              colunas: ['Pessoa', 'Receita da agência'],
              linhas: quemVendeu.map(l => [l.nome, l.valor === null ? '—' : BRL(l.valor)]),
            }}
          >
            <BarrasNomeadas linhas={quemVendeu} formatar={BRL} alturaBarra={10} />
          </GraficoMoldura>

          {/* ── O QUE ENTRA E O QUE SAI ──────────────────────────────────── */}
          <GraficoMoldura
            titulo="O que entra e o que sai até 30 dias"
            sublinha="As duas barras estão na mesma escala de reais, então dá para comparar de relance."
            estado={fluxo.escala > 0 ? 'ok' : 'sem-dado'}
            vazio={{ frase: 'Nada a receber e nada a pagar nos próximos 30 dias.' }}
            descricao="A receber e a pagar nos próximos 30 dias, por prazo, na mesma escala."
            tabela={{
              colunas: ['Prazo', 'A receber', 'A pagar'],
              linhas: PRAZOS.map(prazo => [
                prazo.rotulo,
                BRL(fluxo.receber.find(p => p.id === prazo.id)?.valor ?? 0),
                BRL(fluxo.pagar.find(p => p.id === prazo.id)?.valor ?? 0),
              ]),
            }}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="fin-t-body-strong text-[var(--fin-text)]">A receber {BRL(fluxo.totalReceber)}</p>
                <BarraDeParte partes={fluxo.receber} total={fluxo.escala} formatar={BRL} trilhoVazioRotulo="nada a receber nos próximos 30 dias" />
              </div>
              <div className="flex flex-col gap-2">
                <p className="fin-t-body-strong text-[var(--fin-text)]">A pagar {BRL(fluxo.totalPagar)}</p>
                <BarraDeParte partes={fluxo.pagar} total={fluxo.escala} formatar={BRL} trilhoVazioRotulo="nada a pagar nos próximos 30 dias" />
              </div>
            </div>
          </GraficoMoldura>

          {/* ── A SEMANA ─────────────────────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">
              {fluxo.daSemana.length > 0
                ? `Esta semana entram ${BRL(fluxo.entramNaSemana)} e saem ${BRL(fluxo.saemNaSemana)}`
                : 'Nada vencido e nada a vencer nesta semana.'}
            </h2>
            {fluxo.daSemana.length > 0 ? (
              <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                {fluxo.daSemana.slice(0, 5).map(linha => (
                  <li key={linha.id} className="flex min-h-[44px] items-center gap-3 py-2">
                    <span className="fin-t-caption w-14 shrink-0 tabular-nums text-[var(--fin-text-3)]">
                      {dataCurta(linha.data)}
                    </span>
                    {/* Sinal explícito à esquerda do valor: cor sozinha não diz
                        se o dinheiro entra ou sai. */}
                    <span
                      className={`fin-t-body-strong w-28 shrink-0 tabular-nums ${linha.sinal === '+' ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]'}`}
                    >
                      {linha.sinal} {BRL(linha.valor)}
                    </span>
                    <span className="fin-t-body min-w-0 flex-1 text-[var(--fin-text-2)]">{linha.descricao}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {fluxo.daSemana.length > 5 ? (
              <Link href="/financeiro-ag/receber" className="fin-t-body text-[var(--fin-accent)] underline underline-offset-2">
                {`mais ${fluxo.daSemana.length - 5} nesta semana · ver todos`}
              </Link>
            ) : null}
          </section>

          {/* ── PRECISA DE DECISÃO HOJE ──────────────────────────────────── */}
          {decisoes.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="fin-t-subhead text-[var(--fin-text)]">Precisa de decisão hoje</h2>
              <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                {decisoes.map(d => (
                  <li key={d.id} className="flex min-h-[44px] flex-wrap items-center gap-3 py-3">
                    {d.nivel === 'resolver' ? (
                      <AlertCircle className="size-4 shrink-0 text-[var(--fin-negative-text)]" aria-hidden />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0 text-[var(--fin-warning-text)]" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="fin-t-body-strong text-[var(--fin-text)]">{d.titulo}</p>
                      {d.descricao ? <p className="fin-t-caption text-[var(--fin-text-3)]">{d.descricao}</p> : null}
                    </div>
                    <Link
                      href={d.href}
                      className="fin-t-body inline-flex h-11 shrink-0 items-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-3 text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]"
                    >
                      {d.acao}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="fin-t-caption text-[var(--fin-text-3)]">Nada precisa de decisão hoje.</p>
          )}

          {/* ── PARA ONDE FOI O DINHEIRO ─────────────────────────────────── */}
          {composicao.linhas.length > 0 ? (
            <GraficoMoldura
              titulo={composicao.origem === 'venda' ? 'Para onde foi o dinheiro da venda' : 'Para onde foi o dinheiro que saiu'}
              sublinha={
                composicao.origem === 'venda'
                  ? 'Por tipo de produto vendido.'
                  : `As vendas de ${nomeDoMes} vieram do CRM sem produto detalhado. Enquanto isso, veja para onde o dinheiro saiu.`
              }
              estado="ok"
              descricao={composicao.origem === 'venda' ? 'Composição das vendas por tipo de produto.' : 'Composição da despesa por natureza de custo.'}
              tabela={{
                colunas: [composicao.origem === 'venda' ? 'Tipo' : 'Natureza', 'Valor'],
                linhas: composicao.linhas.map(l => [l.nome, BRL(l.valor)]),
              }}
            >
              <BarrasNomeadas
                linhas={composicao.linhas.map(l => ({ id: l.id, nome: l.nome, valor: l.valor }))}
                formatar={BRL}
                alturaBarra={10}
                fraseDeLinhaUnica={l => `Tudo em ${l.nome} — ${BRL(num(l.valor))}.`}
              />
            </GraficoMoldura>
          ) : null}

          <p className="fin-t-caption text-[var(--fin-text-3)]">
            O mês fica no endereço da página: trocar aqui e ir para{' '}
            <Link href={`/equipe/metas?mes=${mes}`} className="text-[var(--fin-accent)] underline underline-offset-2">
              Metas e ranking
            </Link>{' '}
            leva {nomeDoMes} junto.
          </p>
        </DataState>
      </div>
    </div>
  );
}
