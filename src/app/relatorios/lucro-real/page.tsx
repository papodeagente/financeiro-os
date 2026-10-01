'use client';

/**
 * LUCRO REAL — faturamento, comissão e lucro separados, por mês e por venda.
 *
 * Pedido do Bruno (01/10/2026). A pergunta que a tela responde é uma só:
 * "quando eu realmente lucrei?". Por isso há UMA Resposta (o lucro do mês),
 * e tudo o mais é a conta que leva até ela ou a desdobra por venda.
 *
 * A regra do rateio, o invariante (Σ lucro das vendas = lucro do mês) e o
 * motivo de o lucro POR VENDA ser aproximado estão em src/lib/lucro-real.ts.
 * Esta tela não faz aritmética: ela desenha o que o módulo devolve.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, TrendingDown, TrendingUp } from 'lucide-react';

import type { Cliente, ComissaoVenda, ContaPagar, ContaReceber, PlanoContas, VendaCRM } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { vendasComLancamento, apenasVendasComLastro } from '@/lib/venda-lancamentos';
import { nomeDoCliente } from '@/lib/cliente-nome';
import { escadaDoMes, type EscadaDaVenda, type CenarioDeDiluicao } from '@/lib/lucro-real';
import { hojeISO, mesDe, num, ultimoDiaDoMes } from '@/lib/money';
import { exportCSV } from '@/lib/export-utils';
import { formatBRL, formatDate as dataBR } from '@/lib/utils';

import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { SeletorDeMes, rotuloDoMes } from '@/components/fin/SeletorDeMes';
import { Resposta } from '@/components/fin/Resposta';
import { Money } from '@/components/fin/Money';
import { MetricCard } from '@/components/fin/MetricCard';
import { Callout } from '@/components/fin/Callout';
import { Jargao } from '@/components/fin/Jargao';
import { GraficoMoldura } from '@/components/fin/GraficoMoldura';
import { Cascata, type PassoDaCascata } from '@/components/fin/Cascata';
import { EscadaAcumulada } from '@/components/fin/EscadaAcumulada';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { RecordSheet } from '@/components/fin/RecordSheet';

const PCT = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export default function LucroRealPage() {
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [comissoes, setComissoes] = useState<ComissaoVenda[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [aliquotaIss, setAliquotaIss] = useState<number | null>(null);

  const [mes, setMes] = useState(() => mesDe(hojeISO()));
  const [estado, setEstado] = useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = useState('');
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [vendaAberta, setVendaAberta] = useState<EscadaDaVenda | null>(null);

  const load = useCallback(async () => {
    setEstado('carregando');
    setErro('');
    try {
      const [v, cr, cp, pc, co, cl] = await Promise.all([
        loadEntities<VendaCRM>('vendas-crm'),
        loadEntities<ContaReceber>('contas-receber'),
        loadEntities<ContaPagar>('contas-pagar'),
        loadEntities<PlanoContas>('plano-contas'),
        loadEntities<ComissaoVenda>('comissoes'),
        loadEntities<Cliente>('clientes'),
      ]);
      setVendas(v); setContasReceber(cr); setContasPagar(cp);
      setPlanoContas(pc); setComissoes(co); setClientes(cl);
      // A alíquota só serve de estimativa quando o mês não tem imposto
      // lançado. Falhar aqui não derruba o relatório: vira imposto zero,
      // avisado pelo módulo.
      try {
        const r = await fetch('/api/fiscal/config');
        const corpo = await r.json();
        setAliquotaIss(r.ok ? num(corpo?.config?.aliquota_iss) || null : null);
      } catch { setAliquotaIss(null); }
      setAtualizadoEm(new Date());
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o lucro real.');
      setEstado('erro');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Venda só conta enquanto tiver lançamento — mesma régua do DRE.
  const vendasComLastro = useMemo(
    () => apenasVendasComLastro(vendas, vendasComLancamento(contasReceber, contasPagar)),
    [vendas, contasReceber, contasPagar],
  );

  const hoje = hojeISO();
  const escada = useMemo(
    () => escadaDoMes({ mes, hoje, vendas: vendasComLastro, contasReceber, contasPagar, planoContas, comissoes, aliquotaIssConfig: aliquotaIss }),
    [mes, hoje, vendasComLastro, contasReceber, contasPagar, planoContas, comissoes, aliquotaIss],
  );

  const nomeDoClienteDaVenda = useMemo(() => {
    const porId = new Map(clientes.map(c => [c.id, c]));
    return (id: string) => nomeDoCliente(porId.get(id) ?? null) || '';
  }, [clientes]);

  const rotuloMes = rotuloDoMes(mes);
  const [ano, mesNum] = mes.split('-').map(Number);
  const diasDoMes = ultimoDiaDoMes(ano, mesNum);
  const diaDeHoje = escada.aberto ? Number(hoje.slice(8, 10)) : diasDoMes;

  // ── A leitura do número, em linguagem de dono ─────────────────────────
  const frase = (() => {
    if (escada.n_vendas === 0) return `Nenhuma venda com lançamento em ${rotuloMes}. O custo fixo de ${formatBRL(escada.custo_fixo)} ficou sem o que o pagasse.`;
    const base = `${escada.n_vendas} ${escada.n_vendas === 1 ? 'venda' : 'vendas'} somaram ${formatBRL(escada.faturamento)} de faturamento, ${formatBRL(escada.comissao)} de comissão (${PCT(escada.comissao_pct)}) e ${formatBRL(escada.lucro)} de lucro (${PCT(escada.lucro_pct)} do que os clientes pagaram).`;
    if (escada.equilibrio.atingido && escada.equilibrio.na_venda) {
      return `${base} O fixo foi pago na ${escada.equilibrio.na_venda}ª venda, em ${dataBR(escada.equilibrio.data ?? '')}: dali em diante, cada venda foi lucro.`;
    }
    return `${base} Faltaram ${formatBRL(escada.equilibrio.faltam)} de contribuição para pagar o fixo${escada.equilibrio.vendas_necessarias ? ` — mais ${Math.max(0, escada.equilibrio.vendas_necessarias - escada.n_vendas)} ${escada.equilibrio.vendas_necessarias - escada.n_vendas === 1 ? 'venda' : 'vendas'} como as deste mês` : ''}.`;
  })();

  const chip = escada.n_vendas === 0
    ? null
    : escada.aberto
      ? { icone: Clock, rotulo: 'mês aberto, rateio provisório', tom: 'aviso' as const }
      : escada.lucro >= 0
        ? { icone: TrendingUp, rotulo: `${PCT(escada.lucro_pct)} do faturamento`, tom: 'positivo' as const }
        : { icone: TrendingDown, rotulo: 'prejuízo no mês', tom: 'negativo' as const };

  // ── A cascata: a mesma escada da página pública, com os números do mês ─
  const passos: PassoDaCascata[] = [
    { id: 'fat', rotulo: 'Faturamento', valor: escada.faturamento, papel: 'inicio', detalhe: 'O que os clientes pagaram. A maior parte é do fornecedor.' },
    { id: 'forn', rotulo: 'Fornecedores', valor: -escada.fornecedores, papel: 'subtrai', detalhe: 'Repasse a operadora, aéreo e hotel: só passou pela conta.' },
    { id: 'com', rotulo: 'Comissão', valor: escada.comissao, papel: 'total', detalhe: 'O que ficou da agência depois do fornecedor.' },
    { id: 'vend', rotulo: 'Vendedor', valor: -escada.comissao_vendedor, papel: 'subtrai', detalhe: 'Comissão dos vendedores sobre estas vendas.' },
    { id: 'taxa', rotulo: 'Plataforma', valor: -escada.taxa_plataforma, papel: 'subtrai', detalhe: 'Taxa retida pelas plataformas de pagamento.' },
    { id: 'imp', rotulo: 'Impostos', valor: -escada.impostos, papel: 'subtrai', detalhe: escada.impostos_estimados ? 'Estimado pela alíquota de ISS configurada.' : 'Impostos lançados no mês.' },
    { id: 'fixo', rotulo: 'Custo fixo', valor: -escada.custo_fixo, papel: 'subtrai', detalhe: 'Folha, aluguel, sistema: tudo que não nasce de uma venda.' },
    { id: 'lucro', rotulo: 'Lucro', valor: escada.lucro, papel: 'total', detalhe: 'O único dos três números que é dinheiro da empresa.' },
  ];

  // ── Colunas ───────────────────────────────────────────────────────────
  const colunas: FinColuna<EscadaDaVenda>[] = [
    { id: 'data', cabecalho: 'Data', tipo: 'data', valor: r => r.data, prioridade: 2, minWidth: 92 },
    {
      id: 'venda', cabecalho: 'Venda', tipo: 'texto', minWidth: 180, prioridade: 3,
      acessor: r => r.descricao,
      render: r => (
        <span className="flex flex-col">
          <span className="fin-t-body text-[var(--fin-text)]">{r.descricao}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {[nomeDoClienteDaVenda(r.cliente_id), r.vendedor_nome].filter(Boolean).join(' · ') || (r.numero ? `nº ${r.numero}` : '')}
          </span>
        </span>
      ),
    },
    { id: 'faturamento', cabecalho: 'Faturamento', tipo: 'dinheiro', valor: r => r.faturamento, prioridade: 2, minWidth: 120 },
    { id: 'comissao', cabecalho: 'Comissão', tipo: 'dinheiro', valor: r => r.comissao, sub: r => PCT(r.comissao_pct), prioridade: 3, minWidth: 120 },
    {
      id: 'variaveis', cabecalho: 'Vendedor, taxa e imposto', tipo: 'dinheiro', prioridade: 1, minWidth: 150,
      valor: r => -(r.comissao_vendedor + r.taxa_plataforma + r.impostos),
      sub: r => r.avisos.length ? r.avisos.join(' · ') : null,
    },
    { id: 'fixo', cabecalho: 'Fixo rateado', tipo: 'dinheiro', valor: r => -r.custo_fixo_rateado, prioridade: 1, minWidth: 120 },
    {
      id: 'lucro', cabecalho: 'Lucro', tipo: 'dinheiro', prioridade: 3, minWidth: 120,
      valor: r => r.lucro, sub: r => PCT(r.lucro_pct),
      tone: r => (r.lucro > 0 ? 'positivo' : r.lucro < 0 ? 'negativo' : 'neutro'),
    },
  ];

  const colunasDiluicao: FinColuna<CenarioDeDiluicao>[] = [
    { id: 'vendas', cabecalho: 'Vendas no mês', tipo: 'texto', render: r => <span className="fin-t-body tabular-nums">{r.vendas}{r.vendas === escada.n_vendas ? ' (hoje)' : ''}</span>, acessor: r => r.vendas, prioridade: 3 },
    { id: 'fixo', cabecalho: 'Fixo por venda', tipo: 'dinheiro', valor: r => r.custo_fixo_por_venda, prioridade: 3 },
    { id: 'lucro_venda', cabecalho: 'Lucro por venda', tipo: 'dinheiro', valor: r => r.lucro_por_venda, tone: r => (r.lucro_por_venda >= 0 ? 'positivo' : 'negativo'), prioridade: 3 },
    { id: 'lucro_mes', cabecalho: 'Lucro do mês', tipo: 'dinheiro', valor: r => r.lucro_do_mes, tone: r => (r.lucro_do_mes >= 0 ? 'positivo' : 'negativo'), prioridade: 2 },
  ];

  function exportar() {
    exportCSV(
      `lucro-real-${mes}.csv`,
      ['Data', 'Venda', 'Cliente', 'Vendedor', 'Faturamento', 'Fornecedores', 'Comissão', 'Comissão %', 'Comissão vendedor', 'Taxa plataforma', 'Impostos', 'Custo fixo rateado', 'Lucro', 'Lucro %'],
      escada.vendas.map(v => [
        v.data, v.descricao, nomeDoClienteDaVenda(v.cliente_id), v.vendedor_nome,
        String(v.faturamento), String(v.fornecedores), String(v.comissao), String(v.comissao_pct),
        String(v.comissao_vendedor), String(v.taxa_plataforma), String(v.impostos),
        String(v.custo_fixo_rateado), String(v.lucro), String(v.lucro_pct),
      ]),
    );
  }

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Lucro real"
        subtitulo="Faturamento, comissão e lucro separados. Por mês, e por venda."
        atualizadoEm={atualizadoEm}
        onRecarregar={load}
        acoesSecundarias={escada.vendas.length > 0 ? [{ rotulo: 'Baixar CSV', onClick: exportar }] : undefined}
      />

      <DataState
        className={RITMO_DA_PAGINA}
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => { void load(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className="h-12 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
            <div className="h-40 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
            <div className="h-64 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
          </div>
        }
      >
        <SeletorDeMes valor={mes} onChange={setMes} maximo={mesDe(hoje)} />

        <Resposta
          overline={`LUCRO REAL EM ${rotuloMes.toUpperCase()}`}
          valor={<Money valor={escada.lucro} size="resposta" align="esquerda" estado="ok" sinal="auto" />}
          frase={frase}
          chip={chip}
        />

        {escada.avisos.map(a => (
          <Callout key={a} tom="aviso">{a}</Callout>
        ))}

        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
          <MetricCard
            rotulo="Faturamento"
            valor={escada.faturamento}
            estado="ok"
            contexto={`${escada.n_vendas} ${escada.n_vendas === 1 ? 'venda' : 'vendas'} com lançamento`}
            explicacao="O que os clientes pagaram. Não é receita da agência: a maior parte vai para o fornecedor."
          />
          <MetricCard
            rotulo="Comissão"
            valor={escada.comissao}
            estado="ok"
            contexto={`${PCT(escada.comissao_pct)} do faturamento`}
            explicacao="Faturamento menos o repasse ao fornecedor. É sobre isto que incidem o vendedor, a plataforma e o imposto."
          />
          <MetricCard
            rotulo="Custo fixo"
            valor={escada.custo_fixo}
            estado="ok"
            contexto={escada.n_vendas > 0 ? `${formatBRL(escada.custo_fixo_por_venda)} por venda` : 'sem venda para dividir'}
            explicacao="Folha, aluguel, sistema: o que a agência paga mesmo sem vender. Rateado entre as vendas na proporção do faturamento."
          />
        </div>

        <GraficoMoldura
          titulo="A escada do mês"
          sublinha="Do que o cliente pagou ao que ficou com a empresa, em sete passos."
          estado="ok"
          descricao={`Cascata de ${rotuloMes}: faturamento de ${formatBRL(escada.faturamento)} chega a ${formatBRL(escada.lucro)} de lucro.`}
          tabela={{
            colunas: ['Passo', 'Valor'],
            linhas: passos.map(p => [p.rotulo, formatBRL(p.valor)]),
          }}
        >
          <Cascata passos={passos} formatar={formatBRL} altura={260} />
        </GraficoMoldura>

        {escada.n_vendas > 0 ? (
          <GraficoMoldura
            titulo="Quando o mês pagou o fixo"
            sublinha={
              escada.equilibrio.atingido && escada.equilibrio.na_venda
                ? `A linha cruzou o custo fixo na ${escada.equilibrio.na_venda}ª venda, em ${dataBR(escada.equilibrio.data ?? '')}. Dali em diante, cada venda foi lucro.`
                : `A linha não chegou ao custo fixo. Faltaram ${formatBRL(escada.equilibrio.faltam)} de contribuição.`
            }
            estado="ok"
            descricao="Contribuição das vendas acumulada ao longo do mês contra a reta do custo fixo."
            tabela={{
              colunas: ['Data', 'Venda', 'Contribuição'],
              linhas: escada.acumulado.map(e => [dataBR(e.data), e.rotulo, formatBRL(e.valor)]),
            }}
          >
            <EscadaAcumulada
              eventos={escada.acumulado}
              diasDoMes={diasDoMes}
              diaDeHoje={diaDeHoje}
              limiar={escada.custo_fixo > 0 ? { rotulo: 'Custo fixo', valor: escada.custo_fixo } : null}
              topoDoEixo="referencia"
              formatar={formatBRL}
              altura={220}
            />
          </GraficoMoldura>
        ) : null}

        {escada.n_vendas > 0 && escada.custo_fixo > 0 ? (
          <section className="flex flex-col gap-[var(--fin-s-3)]">
            <div>
              <h2 className="fin-t-subhead text-[var(--fin-text)]">
                <Jargao
                  comum="Quanto mais venda, menor o fixo por venda"
                  tecnico="diluição do custo fixo"
                  explicacao="O custo fixo é o mesmo com 10 ou com 30 vendas. Cada venda nova divide a conta com as anteriores, e o lucro por venda sobe sem ninguém vender melhor."
                  comoCalcula={`Fixo por venda = ${formatBRL(escada.custo_fixo)} ÷ número de vendas. Lucro por venda = contribuição média (${formatBRL(escada.contribuicao_media)}) − fixo por venda.`}
                />
              </h2>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                Cenários com a contribuição média das vendas deste mês.
                {escada.equilibrio.vendas_necessarias ? ` O fixo se paga a partir de ${escada.equilibrio.vendas_necessarias} vendas.` : ''}
              </p>
            </div>
            <FinTable<CenarioDeDiluicao>
              linhas={escada.diluicao}
              colunas={colunasDiluicao}
              chave={r => String(r.vendas)}
              estado="ok"
              densidade="compacta"
              vazio={{ motivo: 'sem-dado', titulo: 'Sem cenários', oQueE: 'Os cenários precisam de ao menos uma venda no mês.', comoComeca: ['Registre uma venda'] }}
            />
          </section>
        ) : null}

        <section className="flex flex-col gap-[var(--fin-s-3)]">
          <div>
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Quanto lucra cada venda</h2>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Aproximado: o fixo de cada venda depende de quantas vendas o mês teve.
              {escada.aberto ? ' Este mês ainda está aberto, então esse número ainda vai cair.' : ''}
              {' '}Toque numa venda para ver a escada inteira.
            </p>
          </div>
          {/* Um total só. A FinTable desenha uma linha de rodapé POR total, e
              cinco rodapés viravam uma segunda tabela embaixo da primeira. Os
              outros números do mês já estão na Resposta e nos cartões. */}
          <FinTable<EscadaDaVenda>
            linhas={escada.vendas}
            colunas={colunas}
            chave={r => r.venda_id}
            estado="ok"
            onLinhaClick={r => setVendaAberta(r)}
            vazio={{
              motivo: 'sem-dado',
              titulo: `Nenhuma venda com lançamento em ${rotuloMes}`,
              oQueE: 'Aqui cada venda aparece com os três números: o que o cliente pagou, o que ficou da agência e o que sobrou depois de tudo.',
              comoComeca: ['Feche uma venda', 'Gere as contas a receber e a pagar dela', 'Volte aqui'],
              acao: { rotulo: 'Ir para vendas', href: '/vendas' },
            }}
            totais={escada.vendas.length > 0 ? [{ colunaId: 'lucro', valor: escada.lucro, rotulo: 'Lucro do mês' }] : undefined}
          />
        </section>
      </DataState>

      {/* A escada de UMA venda. O mesmo desenho da página pública, com os
          números de verdade. */}
      <RecordSheet
        aberto={vendaAberta !== null}
        onOpenChange={a => { if (!a) setVendaAberta(null); }}
        titulo={vendaAberta?.descricao ?? 'Venda'}
        descricao={vendaAberta ? [dataBR(vendaAberta.data), nomeDoClienteDaVenda(vendaAberta.cliente_id), vendaAberta.vendedor_nome].filter(Boolean).join(' · ') : undefined}
        acaoPrimaria={{ rotulo: 'Fechar', onClick: () => setVendaAberta(null) }}
      >
        {vendaAberta ? <EscadaDeUmaVenda v={vendaAberta} aberto={escada.aberto} /> : null}
      </RecordSheet>
    </MolduraDaPagina>
  );
}

function Linha({ rotulo, valor, detalhe, forte, tone }: {
  rotulo: string; valor: number; detalhe?: string; forte?: boolean; tone?: 'neutro' | 'positivo' | 'negativo';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span className={forte ? 'fin-t-body-strong text-[var(--fin-text)]' : 'fin-t-body text-[var(--fin-text-2)]'}>{rotulo}</span>
        {detalhe ? <span className="fin-t-caption text-[var(--fin-text-3)]">{detalhe}</span> : null}
      </span>
      <Money valor={valor} size={forte ? 'metricSm' : 'body'} estado="ok" sinal="auto" tone={tone ?? 'neutro'} />
    </div>
  );
}

function Degrau({ nome, explicacao, valor, tone }: { nome: string; explicacao: string; valor: number; tone?: 'neutro' | 'positivo' | 'negativo' }) {
  return (
    <div className="flex items-end justify-between gap-3 border-t border-[var(--fin-border)] pt-3">
      <span className="flex flex-col">
        <span className="fin-t-overline text-[var(--fin-text-3)]">{nome}</span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">{explicacao}</span>
      </span>
      <Money valor={valor} size="metric" estado="ok" sinal="auto" tone={tone ?? 'neutro'} />
    </div>
  );
}

function EscadaDeUmaVenda({ v, aberto }: { v: EscadaDaVenda; aberto: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Degrau nome="Faturamento" explicacao="o que o cliente pagou" valor={v.faturamento} />
      <div className="flex flex-col gap-2 pl-3">
        <Linha rotulo="Fornecedores" detalhe="operadora, aéreo e hotel" valor={-v.fornecedores} />
      </div>
      <Degrau nome="Comissão" explicacao={`${PCT(v.comissao_pct)} do faturamento`} valor={v.comissao} />
      <div className="flex flex-col gap-2 pl-3">
        <Linha rotulo="Comissão do vendedor" detalhe={v.vendedor_nome || 'sem comissão registrada'} valor={-v.comissao_vendedor} />
        <Linha rotulo="Taxa da plataforma" detalhe="retida nas parcelas desta venda" valor={-v.taxa_plataforma} />
        <Linha rotulo="Impostos" detalhe={v.avisos.includes('Imposto estimado') ? 'estimado pela alíquota de ISS' : 'rateado por comissão'} valor={-v.impostos} />
        <Linha rotulo="Custo fixo rateado" detalhe={aberto ? 'provisório: cai a cada venda nova' : 'pela proporção do faturamento'} valor={-v.custo_fixo_rateado} />
      </div>
      <Degrau
        nome="Lucro"
        explicacao={`${PCT(v.lucro_pct)} do que o cliente pagou`}
        valor={v.lucro}
        tone={v.lucro > 0 ? 'positivo' : v.lucro < 0 ? 'negativo' : 'neutro'}
      />
    </div>
  );
}
