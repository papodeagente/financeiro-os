'use client';

import { useEffect, useMemo, useState } from 'react';
import { Table2 } from 'lucide-react';

import type { ContaBancaria, ContaPagar, ContaReceber, PlanoContas } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { hojeISO } from '@/lib/money';
import {
  CAMPOS_COM_EMPRESA, COLUNAS_PADRAO, camposDoDemonstrativo, LINHAS_PADRAO, ORDEM_DO_DEMONSTRATIVO, ROTULO_DO_CAMPO,
  registrosDoDemonstrativo, rotuloDoValor, type CampoDemonstrativo, type LancamentoDoDemonstrativo,
} from '@/lib/resultado-por-categoria';
import { documentoDaTabelaDinamica } from '@/lib/exportacao/tabela-dinamica';
import { montarTabelaDinamica, registrosDaCelula } from '@/lib/tabela-dinamica';
import { cn } from '@/lib/utils';

import { BotaoExportar } from '@/components/fin/BotaoExportar';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { FilterBar } from '@/components/fin/FilterBar';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { Segmentado } from '@/components/fin/Segmentado';
import { CamposDaTabela, type Disposicao } from './CamposDaTabela';
import { GradeDinamica } from './GradeDinamica';
import { LancamentosDaCelula } from './LancamentosDaCelula';
import { useEmpresas } from '@/components/fin/useEmpresas';

type Regime = 'competencia' | 'caixa';
const CHAVE_LAYOUT = 'resultado-por-categoria-layout';
const TODOS = 'todos';

function Interruptor({ ligado, onChange, children }: { ligado: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => onChange(!ligado)}
      className="inline-flex min-h-11 items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-1 fin-t-body text-[var(--fin-text-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:min-h-9"
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--fin-dur-rapida)]',
          ligado ? 'bg-[var(--fin-accent)]' : 'bg-[var(--fin-border-strong)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-[var(--fin-surface)] shadow-[var(--fin-e-card)] transition-transform duration-[var(--fin-dur-rapida)]',
            ligado ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </span>
      {children}
    </button>
  );
}

function disposicaoValida(v: unknown): Disposicao | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { linhas?: unknown; colunas?: unknown };
  const ok = (x: unknown): x is CampoDemonstrativo[] =>
    Array.isArray(x) && x.every(c => (CAMPOS_COM_EMPRESA as string[]).includes(String(c)));
  if (!ok(o.linhas) || !ok(o.colunas)) return null;
  if (new Set([...o.linhas, ...o.colunas]).size !== o.linhas.length + o.colunas.length) return null;
  return { linhas: o.linhas, colunas: o.colunas };
}

/**
 * Resultado por categoria (05/11/2026): tabela dinâmica no navegador.
 * Linhas Tipo › Grupo › Categoria e colunas Ano › Mês por padrão; os campos
 * se arrastam entre Linhas, Colunas e Disponíveis (ou se movem pelos botões
 * de cada campo, pelo teclado). Toda conta mora em src/lib.
 */
export default function DemonstrativoPorCategoriasPage() {
  const [receber, setReceber] = useState<ContaReceber[]>([]);
  const [pagar, setPagar] = useState<ContaPagar[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [contasBancarias, setContasBancarias] = useState<ContaBancaria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const [regime, setRegime] = useState<Regime>('competencia');
  const [ano, setAno] = useState<string>(hojeISO().slice(0, 4));
  const [incluirRepasse, setIncluirRepasse] = useState(false);
  const [usarRateio, setUsarRateio] = useState(false);
  // Várias empresas (E7): o campo Empresa e a divisão do rateio entre empresas.
  const empresasCtx = useEmpresas();
  const [disposicao, setDisposicao] = useState<Disposicao>({ linhas: LINHAS_PADRAO, colunas: COLUNAS_PADRAO });
  const [celula, setCelula] = useState<{ titulo: string; lancamentos: LancamentoDoDemonstrativo[] } | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const [cr, cp, pc, cb] = await Promise.all([
        loadEntities<ContaReceber>('contas-receber'),
        loadEntities<ContaPagar>('contas-pagar'),
        loadEntities<PlanoContas>('plano-contas'),
        loadEntities<ContaBancaria>('contas-bancarias'),
      ]);
      setReceber(cr);
      setPagar(cp);
      setPlanoContas(pc);
      setContasBancarias(cb);
      setErro(null);
      setAtualizadoEm(new Date());
    } catch {
      setErro('Não deu para ler as contas e as categorias. Nada foi alterado no seu financeiro.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    try {
      const salvo = disposicaoValida(JSON.parse(window.localStorage.getItem(CHAVE_LAYOUT) ?? 'null'));
      if (salvo) setDisposicao(salvo);
    } catch { /* layout salvo ilegível: fica o padrão */ }
  }, []);

  function trocarDisposicao(d: Disposicao) {
    setDisposicao(d);
    try { window.localStorage.setItem(CHAVE_LAYOUT, JSON.stringify(d)); } catch { /* navegador sem armazenamento */ }
  }

  const anos = useMemo(() => {
    const s = new Set<string>([hojeISO().slice(0, 4)]);
    for (const c of receber) for (const d of [c.data_vencimento, c.data_recebimento]) if (d) s.add(String(d).slice(0, 4));
    for (const c of pagar) for (const d of [c.data_vencimento, c.data_pagamento]) if (d) s.add(String(d).slice(0, 4));
    return [...s].filter(a => /^\d{4}$/.test(a)).sort().reverse();
  }, [receber, pagar]);

  const multiempresa = useMemo(
    () => (empresasCtx.multi
      ? { nomes: new Map(empresasCtx.empresas.map(x => [x.id, x.nome])), visiveis: empresasCtx.visiveis }
      : undefined),
    [empresasCtx.multi, empresasCtx.empresas, empresasCtx.visiveis],
  );
  // Disposição salva com o campo Empresa numa agência que voltou a ter uma empresa só.
  const disposicaoEfetiva = useMemo<Disposicao>(() => (multiempresa ? disposicao : {
    linhas: disposicao.linhas.filter(c => c !== 'empresa'), colunas: disposicao.colunas.filter(c => c !== 'empresa'),
  }), [multiempresa, disposicao]);

  const registros = useMemo(() => registrosDoDemonstrativo({
    receber, pagar, planoContas, contasBancarias, regime, incluirRepasse, usarRateio,
    de: ano === TODOS ? undefined : `${ano}-01-01`,
    ate: ano === TODOS ? undefined : `${ano}-12-31`,
    ...(multiempresa ? { multiempresa } : {}),
  }), [receber, pagar, planoContas, contasBancarias, regime, incluirRepasse, usarRateio, ano, multiempresa]);

  const tabela = useMemo(
    () => montarTabelaDinamica(registros, disposicaoEfetiva.linhas, disposicaoEfetiva.colunas, { ordem: ORDEM_DO_DEMONSTRATIVO }),
    [registros, disposicaoEfetiva],
  );

  function abrirCelula(caminhoLinha: string[] | null, chaveColuna: string | null, titulo: string) {
    const regs = registrosDaCelula(registros, tabela, caminhoLinha, chaveColuna);
    setCelula({ titulo, lancamentos: regs.map(r => r.ref!).filter(Boolean) });
  }

  function documento() {
    return documentoDaTabelaDinamica(tabela, {
      titulo: 'Resultado por categoria',
      subtitulo: regime === 'competencia'
        ? 'Competência: cada conta pelo vencimento e pelo valor total. Receitas somam, despesas subtraem.'
        : 'Caixa: cada conta pela data da baixa e pelo valor que entrou ou saiu. Receitas somam, despesas subtraem.',
      filtros: [
        { rotulo: 'Ano', valor: ano === TODOS ? 'todos os anos' : ano },
        { rotulo: 'Regime', valor: regime === 'competencia' ? 'Competência' : 'Caixa' },
        ...(incluirRepasse ? [{ rotulo: 'Repasses', valor: 'incluídos' }] : []),
        ...(usarRateio ? [{ rotulo: 'Rateio', valor: 'dividido' }] : []),
      ],
      rotuloDoCampo: c => ROTULO_DO_CAMPO[c as CampoDemonstrativo] ?? c,
      rotuloDoValor,
    });
  }

  const semDado = !carregando && !erro && receber.length === 0 && pagar.length === 0;
  const ativos = (regime === 'caixa' ? 1 : 0) + (incluirRepasse ? 1 : 0) + (usarRateio ? 1 : 0);

  return (
    <MolduraDaPagina>
      <PageHeader
        empresas
        icone={Table2}
        titulo="Resultado por categoria"
        subtitulo="Receitas e despesas cruzadas por categoria e mês. Arraste os campos para montar a sua visão."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acoesSecundarias={[{ rotulo: 'Resultado do mês', href: '/financeiro-ag/dre' }]}
      />

      <DataState
        className={RITMO_DA_PAGINA}
        estado={carregando ? 'carregando' : erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className="h-24 animate-pulse rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
            <div className="h-96 animate-pulse rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]" />
          </div>
        }
      >
        {semDado ? (
          <EmptyLesson
            motivo="sem-dado"
            titulo="Ainda não há lançamentos para cruzar"
            oQueE="Este demonstrativo soma as contas a receber e a pagar por categoria e por mês, como uma tabela dinâmica."
            comoComeca={[
              'Organize as categorias no plano de contas',
              'Lance as contas a receber e a pagar com a categoria',
              'Volte aqui e arraste os campos para cruzar como quiser',
            ]}
            acao={{ rotulo: 'Abrir o plano de contas', href: '/financeiro-ag/plano-contas' }}
          />
        ) : (
          <>
            <FilterBar
              selects={[{
                id: 'demonstrativo-ano',
                rotulo: 'Ano',
                valor: ano,
                opcoes: [...anos.map(a => ({ valor: a, rotulo: a })), { valor: TODOS, rotulo: 'Todos os anos' }],
                onChange: setAno,
              }]}
              resumo={{
                exibidos: registros.length,
                total: registros.length,
                substantivo: registros.length === 1 ? 'lançamento' : 'lançamentos',
                escopo: ano === TODOS ? 'em todos os anos' : `em ${ano}`,
              }}
              ativos={ativos}
              onLimpar={() => { setRegime('competencia'); setIncluirRepasse(false); setUsarRateio(false); }}
            />

            <section
              aria-label="Montagem da tabela"
              className="flex flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)] sm:p-[var(--fin-s-5)]"
            >
              <div className="flex flex-col gap-[var(--fin-s-3)] lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-2)]">
                  <Segmentado<Regime>
                    rotulo="Regime"
                    valor={regime}
                    onChange={setRegime}
                    opcoes={[{ valor: 'competencia', rotulo: 'Competência' }, { valor: 'caixa', rotulo: 'Caixa' }]}
                  />
                  <Interruptor ligado={incluirRepasse} onChange={setIncluirRepasse}>Mostrar repasses ao fornecedor</Interruptor>
                  <Interruptor ligado={usarRateio} onChange={setUsarRateio}>Dividir pelo rateio</Interruptor>
                </div>
                <BotaoExportar origem="resultado_por_categoria" tamanho="default" className="self-start" desabilitado={registros.length === 0} documento={documento} />
              </div>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                {regime === 'competencia'
                  ? 'Competência: cada conta pelo vencimento e pelo valor total, recebida ou não.'
                  : 'Caixa: cada conta pela data da baixa e pelo valor que de fato entrou ou saiu.'}
                {' '}Receitas somam, despesas subtraem: o total geral é o resultado.
                {incluirRepasse ? '' : ' O repasse ao fornecedor fica de fora.'}
              </p>
              <CamposDaTabela disposicao={disposicaoEfetiva} onChange={trocarDisposicao} campos={camposDoDemonstrativo(Boolean(multiempresa))} />
            </section>

            {registros.length === 0 ? (
              <EmptyLesson
                motivo="sem-resultado"
                titulo="Nada neste recorte"
                oQueE="Nenhuma conta cai no ano e no regime escolhidos."
                acaoSecundaria={{ rotulo: 'Ver todos os anos', onClick: () => setAno(TODOS) }}
              />
            ) : (
              <GradeDinamica tabela={tabela} onAbrirCelula={abrirCelula} />
            )}
          </>
        )}
      </DataState>

      <LancamentosDaCelula aberta={celula} onFechar={() => setCelula(null)} />
    </MolduraDaPagina>
  );
}
