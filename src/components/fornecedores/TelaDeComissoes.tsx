'use client';

/**
 * COMISSÃO DE FORNECEDORES (E5, parte C): por operadora, no período das
 * vendas, o que o acordo manda (esperada), o que está nas vendas (lançada) e
 * o que já entrou (recebida), com os alertas do que não bate.
 */
import * as React from 'react';
import Link from 'next/link';
import { Percent } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { MetricCard } from '@/components/fin/MetricCard';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { Field } from '@/components/fin/Field';
import { Callout } from '@/components/fin/Callout';
import { addDias } from '@/lib/money';
import type { ComissaoDaOperadora, ComissoesPorOperadora, LinhaDeComissao } from '@/lib/fornecedor-comissao';
import { LINK, LinhaDeResumo, ListaDeAlertas, Pilula, api, dataBR, emReais, hojeNoBrasil, reais } from './comum';

type Resposta = ComissoesPorOperadora & { de: string; ate: string; extrato_disponivel: boolean };
type Atalho = '90' | 'mes' | 'mes_passado' | 'outro';

function periodoDo(atalho: Atalho, hoje: string): { de: string; ate: string } {
  const mes = hoje.slice(0, 7);
  if (atalho === 'mes') return { de: `${mes}-01`, ate: hoje };
  if (atalho === 'mes_passado') {
    const fim = addDias(`${mes}-01`, -1);
    return { de: `${fim.slice(0, 7)}-01`, ate: fim };
  }
  return { de: addDias(hoje, -90), ate: hoje };
}

export function TelaDeComissoes() {
  const hoje = hojeNoBrasil();
  const [atalho, setAtalho] = React.useState<Atalho>('90');
  const [periodo, setPeriodo] = React.useState(periodoDo('90', hoje));
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState('');
  const [aberta, setAberta] = React.useState<ComissaoDaOperadora | null>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      setDados(await api<Resposta>(`/api/fornecedores/comissoes?de=${periodo.de}&ate=${periodo.ate}`));
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, [periodo]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const t = dados?.totais;
  const comExtrato = dados?.extrato_disponivel ?? false;
  const colunas: FinColuna<ComissaoDaOperadora>[] = [
    { id: 'nome', cabecalho: 'Operadora', tipo: 'texto', sortable: true, acessor: o => o.nome, minWidth: 180,
      render: o => <span className="flex flex-col"><span className="fin-t-body-strong">{o.nome}</span><span className="fin-t-caption text-[var(--fin-text-3)]">{o.vendas} {o.vendas === 1 ? 'venda' : 'vendas'} · {o.produtos} {o.produtos === 1 ? 'produto' : 'produtos'}</span></span> },
    { id: 'esperada', cabecalho: 'Esperada', tipo: 'dinheiro', sortable: true, valor: o => emReais(o.esperada) },
    { id: 'lancada', cabecalho: 'Lançada', tipo: 'dinheiro', sortable: true, valor: o => emReais(o.lancada),
      sub: o => (o.diferenca_acordo !== 0 ? <span className={o.diferenca_acordo < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]'}>{o.diferenca_acordo < 0 ? '−' : '+'}{reais(Math.abs(o.diferenca_acordo))} do acordo</span> : null) },
    { id: 'recebida', cabecalho: 'Recebida', tipo: 'dinheiro', sortable: true, valor: o => emReais(o.recebida), tone: o => (o.recebida >= o.lancada && o.lancada > 0 ? 'positivo' : 'neutro') },
    { id: 'a_receber', cabecalho: 'A receber', tipo: 'dinheiro', sortable: true, valor: o => emReais(o.a_receber), prioridade: 2 },
    { id: 'atraso', cabecalho: 'Em atraso', tipo: 'dinheiro', sortable: true, valor: o => emReais(o.em_atraso), tone: o => (o.em_atraso > 0 ? 'negativo' : 'neutro') },
    ...(comExtrato ? [{ id: 'informada', cabecalho: 'No extrato', tipo: 'dinheiro', sortable: true, valor: (o: ComissaoDaOperadora) => emReais(o.informada ?? 0), estado: (o: ComissaoDaOperadora) => (o.informada === null ? 'indisponivel' : 'ok') } as FinColuna<ComissaoDaOperadora>] : []),
    { id: 'alertas', cabecalho: 'Conferência', tipo: 'texto', minWidth: 140,
      render: o => {
        const atencao = o.alertas.filter(a => a.gravidade === 'atencao').length;
        if (atencao) return <span title={o.alertas.map(a => a.mensagem).join(' ')}><Pilula tom="aviso">{atencao === 1 ? '1 ponto a conferir' : `${atencao} pontos a conferir`}</Pilula></span>;
        if (o.alertas.length) return <span title={o.alertas.map(a => a.mensagem).join(' ')}><Pilula tom="neutro">Sem acordo em parte</Pilula></span>;
        return <Pilula tom="positivo">Bate</Pilula>;
      } },
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Percent}
        tomDoIcone="violeta"
        titulo="Comissão de fornecedores"
        subtitulo="Por operadora: o que o acordo manda, o que está nas vendas e o que já entrou."
        acoesSecundarias={[{ rotulo: 'Acordos com fornecedores', href: '/financeiro-ag/fornecedores/acordos' }]}
        onRecarregar={carregar}
      />
      <div className="flex flex-col gap-[var(--fin-s-3)] lg:flex-row lg:items-end">
        <Segmentado<Atalho>
          rotulo="Vendas de"
          opcoes={[{ valor: '90', rotulo: 'Últimos 90 dias' }, { valor: 'mes', rotulo: 'Este mês' }, { valor: 'mes_passado', rotulo: 'Mês passado' }, { valor: 'outro', rotulo: 'Escolher' }]}
          valor={atalho}
          onChange={a => { setAtalho(a); if (a !== 'outro') setPeriodo(periodoDo(a, hoje)); }}
        />
        {atalho === 'outro' ? (
          <div className="grid grid-cols-2 gap-[var(--fin-s-2)]">
            <Field rotulo="Vendas de">{a => <Input {...a} type="date" value={periodo.de} max={periodo.ate} onChange={e => e.target.value && setPeriodo(p => ({ ...p, de: e.target.value }))} className="h-11 lg:h-10" />}</Field>
            <Field rotulo="até">{a => <Input {...a} type="date" value={periodo.ate} min={periodo.de} onChange={e => e.target.value && setPeriodo(p => ({ ...p, ate: e.target.value }))} className="h-11 lg:h-10" />}</Field>
          </div>
        ) : null}
      </div>
      <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard rotulo="Esperada pelos acordos" valor={t ? emReais(t.esperada) : null} estado={estado === 'ok' ? 'ok' : 'carregando'} contexto={`Vendas de ${dataBR(periodo.de)} a ${dataBR(periodo.ate)}`} />
        <MetricCard rotulo="Lançada nas vendas" valor={t ? emReais(t.lancada) : null} estado={estado === 'ok' ? 'ok' : 'carregando'} contexto={t && t.lancada !== t.esperada ? `${t.lancada < t.esperada ? 'Faltam' : 'Sobram'} ${reais(Math.abs(t.lancada - t.esperada))} em relação aos acordos` : 'Igual ao que os acordos mandam'} />
        <MetricCard rotulo="Recebida" emphasis="destaque" tone="positivo" valor={t ? emReais(t.recebida) : null} estado={estado === 'ok' ? 'ok' : 'carregando'} contexto={t ? `${reais(Math.max(0, t.lancada - t.recebida))} ainda por entrar` : '—'} />
        <MetricCard rotulo="Em atraso" tone={t && t.em_atraso > 0 ? 'negativo' : 'neutro'} valor={t ? emReais(t.em_atraso) : null} estado={estado === 'ok' ? 'ok' : 'carregando'} contexto={t && t.alertas ? `${t.alertas} ${t.alertas === 1 ? 'ponto' : 'pontos'} a conferir` : 'Nada vencido sem receber'} />
      </div>
      {dados && !comExtrato ? (
        <Callout tom="info">Quando o extrato da operadora for conferido, o valor que ela informa aparece ao lado do lançado, com o alerta do que não bate.</Callout>
      ) : null}
      <FinTable<ComissaoDaOperadora>
        linhas={dados?.operadoras ?? []}
        colunas={colunas}
        chave={o => o.parte_id || o.nome}
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        onLinhaClick={setAberta}
        vazio={{ motivo: 'sem-dado', titulo: 'Nenhuma comissão no período', oQueE: 'Aqui aparecem as operadoras das vendas completas do período, com a comissão esperada, lançada e recebida.', comoComeca: ['Cadastre os acordos com os fornecedores.', 'Lance as vendas com a comissão de cada produto.'], acao: { rotulo: 'Ver acordos', href: '/financeiro-ag/fornecedores/acordos' } }}
      />
      {aberta && dados ? (
        <DetalheDaOperadora operadora={aberta} linhas={dados.linhas.filter(l => (aberta.parte_id ? l.parte_id === aberta.parte_id : l.parte_nome === aberta.nome))} onFechar={() => setAberta(null)} />
      ) : null}
    </MolduraDaPagina>
  );
}

function DetalheDaOperadora({ operadora: o, linhas, onFechar }: { operadora: ComissaoDaOperadora; linhas: LinhaDeComissao[]; onFechar: () => void }) {
  const colunas: FinColuna<LinhaDeComissao>[] = [
    { id: 'venda', cabecalho: 'Venda', tipo: 'texto', sortable: true, acessor: l => l.data_venda,
      render: l => <Link className={LINK} href={`/vendas/${encodeURIComponent(l.venda_id)}/ficha`}>{l.venda_numero} · {dataBR(l.data_venda)}</Link> },
    { id: 'produto', cabecalho: 'Produto', tipo: 'texto', sortable: true, acessor: l => l.produto, minWidth: 180,
      render: l => <span className="flex flex-col"><span>{l.produto}</span><span className="fin-t-caption text-[var(--fin-text-3)]" title={l.motivo_acordo}>{l.sem_acordo ? 'Sem acordo na data' : (l.localizador || 'Pelo acordo')}</span></span> },
    { id: 'esperada', cabecalho: 'Esperada', tipo: 'dinheiro', sortable: true, valor: l => emReais(l.esperada) },
    { id: 'lancada', cabecalho: 'Lançada', tipo: 'dinheiro', sortable: true, valor: l => emReais(l.lancada), tone: l => (l.lancada < l.esperada ? 'negativo' : 'neutro') },
    { id: 'recebida', cabecalho: 'Recebida', tipo: 'dinheiro', sortable: true, valor: l => emReais(l.recebida) },
  ];
  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={o.nome}
      descricao={`${o.vendas} ${o.vendas === 1 ? 'venda' : 'vendas'} no período`}
      largura={960}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <div className="grid grid-cols-1 gap-[var(--fin-s-4)] md:grid-cols-2">
          <dl className="flex flex-col">
            <LinhaDeResumo rotulo="Esperada pelo acordo">{reais(o.esperada)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Lançada nas vendas">{reais(o.lancada)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Recebida" forte>{reais(o.recebida)}</LinhaDeResumo>
          </dl>
          <dl className="flex flex-col">
            <LinhaDeResumo rotulo="A receber">{reais(o.a_receber)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="Em atraso">{reais(o.em_atraso)}</LinhaDeResumo>
            <LinhaDeResumo rotulo="No extrato da operadora">{o.informada === null ? 'Sem extrato conferido' : reais(o.informada)}</LinhaDeResumo>
          </dl>
        </div>
        <ListaDeAlertas alertas={o.alertas} />
        <FinTable<LinhaDeComissao>
          linhas={linhas}
          colunas={colunas}
          chave={l => `${l.venda_id}:${l.produto_id}`}
          densidade="compacta"
          estado="ok"
          vazio={{ motivo: 'sem-dado', titulo: 'Sem produtos', oQueE: 'Nenhum produto desta operadora no período.' }}
        />
      </div>
    </RecordSheet>
  );
}
