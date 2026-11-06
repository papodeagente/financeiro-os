'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarRange, Columns3, Lightbulb } from 'lucide-react';

import { Field } from '@/components/fin/Field';
import { Input } from '@/components/ui/input';
import { BlocoRecolhivel } from '@/components/fin/BlocoRecolhivel';
import { api, chaveDeIdempotencia, ErroDaMudanca, LISTAS_DO_HISTORICO } from '@/lib/migracao/contrato-telas';
import { dataBR, erroDaDataDeCorte, jaAplicou } from '@/lib/migracao/telas/assistente';
import { GUIA_DE_EXPORTACAO, type GuiaDaLista } from '@/lib/migracao/telas/listas';
import { toast } from '@/lib/toast';

import { BarraDoPasso, CabecaDoPasso, PAINEL, textoDoErro, type PropsDoPasso } from '../pecas';

/** Hoje em Brasília (AAAA-MM-DD), para não deixar a data de corte cair no futuro. */
function hojeEmBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Último dia do mês passado: a data de corte mais comum (mês fechado lá). */
function ultimoDiaDoMesPassado(hoje: string): string {
  const [a, m] = hoje.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Passo 1 · O que exportar. A data de corte e, lista por lista, onde fica
 * no sistema anterior, quais colunas deixar visíveis e quando exportar um
 * arquivo por mês. Começar a mudança só cria o rascunho: nenhum dado entra.
 */
export function PassoExportar({ lote, onLote, irPara, onCarregar }: PropsDoPasso & { onCarregar: () => Promise<void> }) {
  const hoje = React.useMemo(() => hojeEmBrasilia(), []);
  const [data, setData] = React.useState(() => lote?.data_corte ?? ultimoDiaDoMesPassado(hoje));
  const [tocado, setTocado] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const chave = React.useRef(chaveDeIdempotencia());

  const erro = erroDaDataDeCorte(data, hoje);
  const aplicou = jaAplicou(lote);
  const mudouData = Boolean(lote && data !== lote.data_corte);

  async function seguir() {
    setTocado(true);
    if (erro) return;
    setSalvando(true);
    try {
      if (!lote) {
        onLote(await api.criar(data, chave.current));
      } else if (mudouData && !aplicou) {
        onLote(await api.mudarDataDeCorte(lote.id, data));
      }
      irPara('arquivos');
    } catch (e) {
      if (e instanceof ErroDaMudanca && e.codigo === 'LOTE_ABERTO') {
        toast.info(textoDoErro(e));
        await onCarregar();
        return;
      }
      toast.error(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <CabecaDoPasso id="passo-exportar" titulo="O que exportar do sistema anterior">
        Exporte cada lista abaixo em Excel, CSV ou texto. A ordem é a mesma em que tudo entra aqui. Pode trazer por partes: o que faltar entra depois, no mesmo assistente.
      </CabecaDoPasso>

      <div className={`${PAINEL} flex flex-col gap-[var(--fin-s-4)] p-[var(--fin-s-5)] lg:flex-row lg:items-start lg:gap-[var(--fin-s-6)]`}>
        <div className="flex max-w-[60ch] flex-col gap-1 lg:flex-1">
          <h3 className="fin-t-body-strong text-[var(--fin-text)]">Data de corte</h3>
          <p className="fin-t-body text-[var(--fin-text-2)]">
            O dia em que o sistema anterior para e o EnturOS começa. Os saldos de abertura e as contas em aberto valem nesse dia. O comum é o último dia de um mês já fechado lá.
          </p>
        </div>
        <div className="w-full lg:w-64">
          <Field rotulo="Data de corte" obrigatorio erro={tocado || lote ? erro : null}>
            {a => (
              <Input
                {...a}
                type="date"
                max={hoje}
                value={data}
                disabled={aplicou}
                onChange={e => { setData(e.target.value); setTocado(true); }}
                className="h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body tabular-nums lg:h-10"
              />
            )}
          </Field>
          {aplicou && lote ? (
            <p className="mt-1 fin-t-caption text-[var(--fin-text-3)]">Aplicada com corte em {dataBR(lote.data_corte)}. Para mudar, desfaça a mudança.</p>
          ) : null}
        </div>
      </div>

      <ol className="grid grid-cols-1 gap-[var(--fin-s-4)] xl:grid-cols-2">
        {GUIA_DE_EXPORTACAO.filter(g => !LISTAS_DO_HISTORICO.includes(g.tipo)).map((g, i) => <GuiaDeUmaLista key={g.tipo} guia={g} ordem={i + 1} />)}
      </ol>

      <BlocoRecolhivel
        titulo="O histórico do sistema anterior"
        preenchido={Boolean(lote?.arquivos.some(a => a.tipo_lista && LISTAS_DO_HISTORICO.includes(a.tipo_lista)))}
        descricao="Para ter aqui o que já aconteceu antes da data de corte: contas já liquidadas, extrato, vendas por produto, faturas, notas, comissões pagas, metas, reembolsos em aberto e créditos de clientes. Entra depois dos saldos e não muda o saldo da data de corte."
      >
        <ol start={7} className="grid grid-cols-1 gap-[var(--fin-s-4)] xl:grid-cols-2">
          {GUIA_DE_EXPORTACAO.filter(g => LISTAS_DO_HISTORICO.includes(g.tipo)).map((g, i) => <GuiaDeUmaLista key={g.tipo} guia={g} ordem={i + 7} />)}
        </ol>
      </BlocoRecolhivel>

      <BarraDoPasso
        bloqueio={tocado ? erro : null}
        principal={{
          rotulo: lote ? (mudouData && !aplicou ? 'Salvar a data e ir aos arquivos' : 'Ir aos arquivos') : 'Já exportei: soltar os arquivos',
          onClick: () => { void seguir(); },
          carregando: salvando,
        }}
      />
    </>
  );
}

function GuiaDeUmaLista({ guia, ordem }: { guia: GuiaDaLista; ordem: number }) {
  const idTitulo = `guia-${guia.tipo}`;
  return (
    <li aria-labelledby={idTitulo} className={`${PAINEL} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-5)]`}>
      <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
        <h3 id={idTitulo} className="flex items-baseline gap-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">
          {/* A ordem informa: é a ordem em que as listas entram. */}
          <span aria-hidden="true" className="fin-t-body tabular-nums text-[var(--fin-text-3)]">{ordem}.</span>
          {guia.nome}
        </h3>
        {guia.opcional ? (
          <span className="shrink-0 rounded-[var(--fin-r-sm)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-2 py-0.5 fin-t-caption text-[var(--fin-text-2)]">Opcional</span>
        ) : null}
      </div>

      <p className="fin-t-body text-[var(--fin-text-2)]">{guia.ondeFica}</p>

      <ol className="flex list-decimal flex-col gap-1 pl-5 fin-t-body text-[var(--fin-text)] marker:text-[var(--fin-text-3)]">
        {guia.passos.map(p => <li key={p}>{p}</li>)}
      </ol>

      <div className="flex flex-col gap-[var(--fin-s-2)]">
        <p className="flex items-center gap-1.5 fin-t-caption font-medium text-[var(--fin-text-2)]">
          <Columns3 aria-hidden="true" className="size-3.5" /> Colunas a deixar visíveis
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label={`Colunas de ${guia.nome}`}>
          {guia.colunas.map(c => (
            <li key={c} className="rounded-[var(--fin-r-sm)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-2 py-0.5 fin-t-caption text-[var(--fin-text)]">{c}</li>
          ))}
        </ul>
      </div>

      {guia.umArquivoPorMes ? (
        <p className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-3 py-2 fin-t-body text-[var(--fin-warning-text)]">
          <CalendarRange aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span><strong className="font-medium">Um arquivo por mês.</strong> O sistema anterior corta listas grandes e mostra só as primeiras linhas; mês a mês nada fica de fora.</span>
        </p>
      ) : null}

      {guia.dica ? (
        <p className="flex items-start gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
          <Lightbulb aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[var(--fin-text-3)]" />
          {guia.dica}
        </p>
      ) : null}

      <p className="mt-auto border-t border-[var(--fin-border)] pt-[var(--fin-s-3)] fin-t-caption text-[var(--fin-text-3)]">
        Aqui vira{' '}
        <Link href={guia.aqui.href} className="text-[var(--fin-accent)] underline-offset-2 hover:underline">{guia.aqui.tela}</Link>
      </p>
    </li>
  );
}
