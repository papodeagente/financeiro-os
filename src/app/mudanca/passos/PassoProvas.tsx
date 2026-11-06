'use client';

import * as React from 'react';
import { FileDown } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Segmentado } from '@/components/fin/Segmentado';
import {
  api, type ExplicacaoDaDiferenca, type FiltroDoEnsaio, type ProvaDaConta, type ProvaDaPessoa, type ProvaDoMes, type RespostaDasProvas,
} from '@/lib/migracao/contrato-telas';
import { contarProvas, dataBR, nomeDoMes, situacaoDaProva } from '@/lib/migracao/telas/assistente';
import { cn, formatBRL } from '@/lib/utils';

import { BarraDoPasso, CabecaDoPasso, plural, textoDoErro, type PropsDoPasso } from '../pecas';

type Aba = 'contas' | 'pessoas' | 'meses';
type Mostrar = 'tudo' | 'diferencas';

/**
 * Passo 6 · Provas. Saldo de cada conta na data de corte, em aberto por
 * pessoa e total por mês × categoria: sistema anterior × EnturOS, e cada
 * diferença explicada pelas linhas do ensaio. O PDF "Prova da mudança" vai
 * para o contador.
 */
export function PassoProvas({ lote, irPara, onVerNoEnsaio }: PropsDoPasso & { onVerNoEnsaio: (f: FiltroDoEnsaio) => void }) {
  const [provas, setProvas] = React.useState<RespostaDasProvas | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [aba, setAba] = React.useState<Aba>('contas');
  const [mostrar, setMostrar] = React.useState<Mostrar>('tudo');
  const [busca, setBusca] = React.useState('');
  const loteId = lote?.id;

  const carregar = React.useCallback(async () => {
    if (!loteId) return;
    setEstado('carregando');
    try { setProvas(await api.provas(loteId)); setEstado('ok'); } catch (e) { setErro(textoDoErro(e)); setEstado('erro'); }
  }, [loteId]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  if (!lote) return null;

  const todas = provas ? [...provas.contas, ...provas.pessoas, ...provas.meses] : [];
  const c = contarProvas(todas);
  const q = busca.trim().toLocaleLowerCase('pt-BR');
  const filtra = <T extends { diferenca: number; explicacoes: ExplicacaoDaDiferenca[] }>(linhas: T[], texto: (l: T) => string) =>
    linhas.filter(l => (mostrar === 'tudo' || situacaoDaProva(l.diferenca, l.explicacoes) !== 'bate') && (!q || texto(l).toLocaleLowerCase('pt-BR').includes(q)));

  const situacao = { id: 'situacao', cabecalho: 'Situação', tipo: 'status' as const, dominio: 'mudanca' as const };
  const explicacao = <T extends { explicacoes: ExplicacaoDaDiferenca[]; diferenca: number }>(): FinColuna<T> => ({
    id: 'explicacao', cabecalho: 'Por que não bateu', tipo: 'texto', minWidth: 240,
    render: l => <Explicacoes linhas={l.explicacoes} diferenca={l.diferenca} onVer={onVerNoEnsaio} />,
  });
  const dinheiro = <T,>(id: string, cabecalho: string, valor: (l: T) => number, tom = false): FinColuna<T> => ({
    id, cabecalho, tipo: 'dinheiro', valor, tone: tom ? (l => (Math.abs(valor(l)) < 0.005 ? 'neutro' : 'negativo')) : undefined,
  });

  const colunasConta: FinColuna<ProvaDaConta>[] = [
    { id: 'conta', cabecalho: 'Conta', tipo: 'texto', minWidth: 180, sortable: true, acessor: l => l.conta, render: l => <span className="fin-t-body-strong text-[var(--fin-text)]">{l.conta}</span> },
    dinheiro<ProvaDaConta>('anterior', 'Sistema anterior', l => l.anterior),
    dinheiro<ProvaDaConta>('enturos', 'EnturOS', l => l.enturos),
    dinheiro<ProvaDaConta>('diferenca', 'Diferença', l => l.diferenca, true),
    { ...situacao, valor: l => situacaoDaProva(l.diferenca, l.explicacoes) },
    explicacao<ProvaDaConta>(),
  ];
  const colunasPessoa: FinColuna<ProvaDaPessoa>[] = [
    { id: 'pessoa', cabecalho: 'Pessoa', tipo: 'texto', minWidth: 200, sortable: true, acessor: l => l.pessoa, render: l => <span className="fin-t-body-strong text-[var(--fin-text)]">{l.pessoa}</span> },
    { id: 'pagar', cabecalho: 'A pagar (aqui)', tipo: 'dinheiro', valor: l => l.pagar_enturos, sub: l => `lá ${formatBRL(l.pagar_anterior)}` },
    { id: 'receber', cabecalho: 'A receber (aqui)', tipo: 'dinheiro', valor: l => l.receber_enturos, sub: l => `lá ${formatBRL(l.receber_anterior)}` },
    dinheiro<ProvaDaPessoa>('diferenca', 'Diferença', l => l.diferenca, true),
    { ...situacao, valor: l => situacaoDaProva(l.diferenca, l.explicacoes) },
    explicacao<ProvaDaPessoa>(),
  ];
  const colunasMes: FinColuna<ProvaDoMes>[] = [
    { id: 'mes', cabecalho: 'Mês', tipo: 'texto', minWidth: 96, sortable: true, acessor: l => l.mes, render: l => <span className="tabular-nums text-[var(--fin-text)]">{nomeDoMes(l.mes)}</span> },
    {
      id: 'categoria', cabecalho: 'Categoria', tipo: 'texto', minWidth: 180, sortable: true, acessor: l => l.categoria,
      render: l => (
        <span className="flex flex-col">
          <span className="text-[var(--fin-text)]">{l.categoria || 'Sem categoria'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{l.tipo === 'pagar' ? 'A pagar' : 'A receber'}</span>
        </span>
      ),
    },
    dinheiro<ProvaDoMes>('anterior', 'Sistema anterior', l => l.anterior),
    dinheiro<ProvaDoMes>('enturos', 'EnturOS', l => l.enturos),
    dinheiro<ProvaDoMes>('diferenca', 'Diferença', l => l.diferenca, true),
    { ...situacao, valor: l => situacaoDaProva(l.diferenca, l.explicacoes) },
    explicacao<ProvaDoMes>(),
  ];

  const vazio = (oQue: string) => (mostrar === 'diferencas' || q
    ? { motivo: 'sem-resultado' as const, titulo: 'Nada neste filtro', oQueE: mostrar === 'diferencas' ? 'Nenhuma diferença aqui: tudo bateu.' : 'A busca não achou nada.', acaoSecundaria: { rotulo: 'Mostrar tudo', onClick: () => { setMostrar('tudo'); setBusca(''); } } }
    : { motivo: 'sem-dado' as const, titulo: `Sem ${oQue} para provar`, oQueE: `Esta mudança não trouxe ${oQue}.` });

  return (
    <>
      <CabecaDoPasso id="passo-provas" titulo="Provas de que bateu">
        O sistema anterior e o EnturOS lado a lado, na data de corte{provas ? ` (${dataBR(provas.data_corte)})` : ''}. Cada diferença aponta para as linhas que a explicam.
      </CabecaDoPasso>

      <DataState
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div aria-hidden="true" className="h-72 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
      >
        <div className="flex flex-col gap-[var(--fin-s-5)]">
          {c.sem_explicacao ? (
            <Callout tom="aviso" titulo={`${plural(c.sem_explicacao, 'número não bateu', 'números não bateram')} e não ${c.sem_explicacao === 1 ? 'tem' : 'têm'} explicação`}>
              Confira antes de concluir. Se for uma lista que faltou, solte o arquivo numa nova mudança depois de desfazer esta, ou ajuste à mão.
            </Callout>
          ) : c.explicada ? (
            <Callout tom="info" titulo={`${plural(c.explicada, 'diferença', 'diferenças')}, todas explicadas`}>
              Vêm de linhas que ficaram de fora no ensaio (recusadas, duplicadas ou sem categoria). Clique no motivo para ver as linhas.
            </Callout>
          ) : provas ? (
            <Callout tom="positivo" titulo="Tudo bateu">
              Saldos, contas em aberto por pessoa e totais por mês e categoria iguais aos do sistema anterior na data de corte.
            </Callout>
          ) : null}

          <div className="flex flex-col gap-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
            <Segmentado<Aba>
              rotulo="Qual prova"
              valor={aba}
              onChange={setAba}
              cheio="celular"
              opcoes={[
                { valor: 'contas', rotulo: 'Saldos das contas', contagem: provas?.contas.length },
                { valor: 'pessoas', rotulo: 'Em aberto por pessoa', contagem: provas?.pessoas.length },
                { valor: 'meses', rotulo: 'Mês e categoria', contagem: provas?.meses.length },
              ]}
            />
            <a
              href={api.urlDoPdf(lote.id)}
              target="_blank"
              rel="noopener"
              className={cn(buttonVariants({ variant: 'outline' }), 'max-sm:w-full')}
            >
              <FileDown aria-hidden="true" /> Prova da mudança (PDF)
            </a>
          </div>

          <FilterBar
            busca={{ valor: busca, onChange: setBusca, placeholder: aba === 'contas' ? 'Pesquisar conta…' : aba === 'pessoas' ? 'Pesquisar pessoa…' : 'Pesquisar categoria…' }}
            selects={[{
              id: 'provas-mostrar', rotulo: 'Mostrar', valor: mostrar, onChange: v => setMostrar(v as Mostrar),
              opcoes: [{ valor: 'tudo', rotulo: 'Tudo' }, { valor: 'diferencas', rotulo: 'Só o que não bateu' }],
            }]}
            resumo={{
              exibidos: aba === 'contas' ? filtra(provas?.contas ?? [], l => l.conta).length : aba === 'pessoas' ? filtra(provas?.pessoas ?? [], l => l.pessoa).length : filtra(provas?.meses ?? [], l => l.categoria).length,
              total: aba === 'contas' ? provas?.contas.length ?? 0 : aba === 'pessoas' ? provas?.pessoas.length ?? 0 : provas?.meses.length ?? 0,
              substantivo: aba === 'contas' ? 'contas' : aba === 'pessoas' ? 'pessoas' : 'linhas',
            }}
            ativos={(mostrar !== 'tudo' ? 1 : 0) + (q ? 1 : 0)}
            onLimpar={() => { setMostrar('tudo'); setBusca(''); }}
          />

          {aba === 'contas' ? (
            <FinTable<ProvaDaConta> linhas={filtra(provas?.contas ?? [], l => l.conta)} colunas={colunasConta} chave={l => l.conta} densidade="compacta" estado="ok" vazio={vazio('contas')} />
          ) : null}
          {aba === 'pessoas' ? (
            <FinTable<ProvaDaPessoa> linhas={filtra(provas?.pessoas ?? [], l => l.pessoa)} colunas={colunasPessoa} chave={l => l.pessoa} densidade="compacta" estado="ok" vazio={vazio('contas em aberto')} />
          ) : null}
          {aba === 'meses' ? (
            <FinTable<ProvaDoMes> linhas={filtra(provas?.meses ?? [], l => l.categoria)} colunas={colunasMes} chave={l => `${l.mes}|${l.tipo}|${l.categoria}`} densidade="compacta" estado="ok" vazio={vazio('contas em aberto')} />
          ) : null}
        </div>
      </DataState>

      <BarraDoPasso
        voltar={{ rotulo: 'Ver o ensaio aplicado', onClick: () => irPara('ensaio') }}
        principal={{ rotulo: 'Concluir ou desfazer', onClick: () => irPara('concluir') }}
      />
    </>
  );
}

function Explicacoes({ linhas, diferenca, onVer }: { linhas: ExplicacaoDaDiferenca[]; diferenca: number; onVer: (f: FiltroDoEnsaio) => void }) {
  if (Math.abs(diferenca) < 0.005) return <span className="fin-t-caption text-[var(--fin-text-3)]">—</span>;
  if (!linhas.length) return <span className="fin-t-body text-[var(--fin-negative-text)]">Sem linha que explique. Confira à mão.</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {linhas.map(e => (
        <li key={e.motivo} className="fin-t-body text-[var(--fin-text-2)]">
          {e.filtro ? (
            <button type="button" onClick={() => onVer(e.filtro!)} className="text-left text-[var(--fin-accent)] underline-offset-2 hover:underline">
              {e.motivo}
            </button>
          ) : <span className="text-[var(--fin-text)]">{e.motivo}</span>}
          <span className="tabular-nums text-[var(--fin-text-3)]"> · {plural(e.linhas, 'linha', 'linhas')} · {formatBRL(e.valor)}</span>
        </li>
      ))}
    </ul>
  );
}
