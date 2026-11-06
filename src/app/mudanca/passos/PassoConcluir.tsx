'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, Flag, RotateCcw, Undo2 } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import {
  api, chaveDeIdempotencia, type PreviaDoConcluir, type PreviaDoDesfazer, type RegistroQueFica,
} from '@/lib/migracao/contrato-telas';
import { dataBR } from '@/lib/migracao/telas/assistente';
import { ROTULO_DA_LISTA } from '@/lib/migracao/telas/listas';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

import { BarraDoPasso, CabecaDoPasso, PAINEL, contagem, plural, textoDoErro, type PropsDoPasso } from '../pecas';

/**
 * Passo 7 · Concluir ou desfazer.
 *
 * Concluir liga de novo o que ficou parado (régua, cobrança, notas, avisos).
 * Desfazer apaga só o que esta mudança criou e ninguém mexeu depois; o que
 * foi mexido fica, e aparece numa lista com o motivo. As duas ações mostram
 * a prévia do servidor e pedem confirmação antes de gravar.
 */
export function PassoConcluir({ lote, onLote, irPara, onNovaMudanca }: PropsDoPasso & { onNovaMudanca: () => void }) {
  const [previaConcluir, setPreviaConcluir] = React.useState<PreviaDoConcluir | null>(null);
  const [previaDesfazer, setPreviaDesfazer] = React.useState<PreviaDoDesfazer | null>(null);
  const [pedindo, setPedindo] = React.useState<'concluir' | 'desfazer' | null>(null);
  const [gravando, setGravando] = React.useState(false);
  const chave = React.useRef(chaveDeIdempotencia());

  if (!lote) return null;

  async function pedirPrevia(qual: 'concluir' | 'desfazer') {
    if (!lote) return;
    setPedindo(qual);
    try {
      if (qual === 'concluir') setPreviaConcluir(await api.previaDoConcluir(lote.id));
      else setPreviaDesfazer(await api.previaDoDesfazer(lote.id));
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setPedindo(null);
    }
  }

  async function concluir() {
    if (!lote || !previaConcluir) return;
    setGravando(true);
    try {
      onLote(await api.concluir(lote.id, previaConcluir.assinatura, chave.current));
      setPreviaConcluir(null);
      toast.success('Mudança concluída.');
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setGravando(false);
    }
  }

  async function desfazer() {
    if (!lote || !previaDesfazer) return;
    setGravando(true);
    try {
      const r = await api.desfazer(lote.id, previaDesfazer.assinatura, chave.current);
      onLote({ ...r.lote, nao_desfeitos: r.lote.nao_desfeitos ?? r.ficaram });
      setPreviaDesfazer(null);
      toast.success(r.ficaram.length ? `Desfeito. ${plural(r.ficaram.length, 'registro ficou', 'registros ficaram')}.` : 'Mudança desfeita por inteiro.');
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setGravando(false);
    }
  }

  if (lote.situacao === 'concluido') {
    return (
      <>
        <CabecaDoPasso id="passo-concluir" titulo="Mudança concluída" />
        <Callout tom="positivo" titulo={`Concluída${lote.concluido_em ? ` em ${dataBR(lote.concluido_em)}` : ''}`}>
          O que veio do sistema anterior já é do EnturOS. Cobrança, régua, notas fiscais, comissões e avisos ao CRM voltaram a funcionar.
        </Callout>
        <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row sm:flex-wrap">
          <Link href="/financeiro-ag/contas" className={buttonVariants({ variant: 'default' })}>Abrir Contas a Pagar/Receber</Link>
          <Link href="/mudanca/glossario" className={buttonVariants({ variant: 'outline' })}>Glossário</Link>
          <Link href="/mudanca/paridade" className={buttonVariants({ variant: 'outline' })}>Checklist de paridade</Link>
          <Button variant="ghost" onClick={onNovaMudanca}><RotateCcw aria-hidden="true" /> Trazer mais arquivos (nova mudança)</Button>
        </div>
      </>
    );
  }

  if (lote.situacao === 'desfeito' || lote.situacao === 'desfazendo') {
    const ficaram = lote.nao_desfeitos ?? [];
    return (
      <>
        <CabecaDoPasso id="passo-concluir" titulo={lote.situacao === 'desfazendo' ? 'Desfazendo a mudança' : 'Mudança desfeita'} />
        {lote.situacao === 'desfazendo' ? (
          <Callout tom="info" titulo="Desfazendo">Apagando o que esta mudança criou. Pode fechar a tela.</Callout>
        ) : (
          <Callout tom={ficaram.length ? 'aviso' : 'positivo'} titulo={ficaram.length ? `${plural(ficaram.length, 'registro não pôde', 'registros não puderam')} ser desfeito${ficaram.length === 1 ? '' : 's'}` : 'Tudo o que a mudança criou foi apagado'}>
            {ficaram.length
              ? 'Alguém mexeu neles depois da mudança, então ficaram como estão. Veja abaixo o motivo de cada um e decida à mão.'
              : 'O financeiro voltou a ser o que era antes da mudança.'}
          </Callout>
        )}
        {ficaram.length ? <TabelaDoQueFica linhas={ficaram} /> : null}
        <BarraDoPasso principal={{ rotulo: 'Começar uma nova mudança', icone: RotateCcw, onClick: onNovaMudanca }} />
      </>
    );
  }

  return (
    <>
      <CabecaDoPasso id="passo-concluir" titulo="Concluir ou desfazer">
        Conferiu as provas? Conclua para o EnturOS assumir de vez. Se algo não ficou como devia, desfaça e comece de novo.
      </CabecaDoPasso>

      <div className="grid grid-cols-1 gap-[var(--fin-s-4)] lg:grid-cols-2">
        <section aria-labelledby="concluir-titulo" className={`${PAINEL} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-5)]`}>
          <h3 id="concluir-titulo" className="flex items-center gap-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">
            <Flag aria-hidden="true" className="size-4 text-[var(--fin-accent)]" /> Concluir a mudança
          </h3>
          <p className="fin-t-body text-[var(--fin-text-2)]">
            Cobrança, régua de lembretes, notas fiscais, comissões e avisos ao CRM voltam a funcionar para tudo o que veio. Concluir não apaga nem muda nenhum valor.
          </p>
          <Button className="mt-auto self-start max-sm:w-full max-sm:self-stretch" onClick={() => { void pedirPrevia('concluir'); }} disabled={pedindo !== null || lote.situacao === 'falhou'} aria-busy={pedindo === 'concluir' || undefined}>
            <CheckCircle2 aria-hidden="true" /> Concluir a mudança
          </Button>
          {lote.situacao === 'falhou' ? <p className="fin-t-caption text-[var(--fin-text-2)]">A gravação parou no meio: desfaça e aplique de novo antes de concluir.</p> : null}
        </section>

        <section aria-labelledby="desfazer-titulo" className={`${PAINEL} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-5)]`}>
          <h3 id="desfazer-titulo" className="flex items-center gap-[var(--fin-s-2)] fin-t-subhead text-[var(--fin-text)]">
            <Undo2 aria-hidden="true" className="size-4 text-[var(--fin-negative-text)]" /> Desfazer a mudança
          </h3>
          <p className="fin-t-body text-[var(--fin-text-2)]">
            Apaga o que esta mudança criou e que ninguém mexeu depois. O que já recebeu baixa ou foi editado fica, e aparece numa lista com o motivo. Nada do que existia antes é tocado.
          </p>
          <Button variant="destructive" className="mt-auto self-start max-sm:w-full max-sm:self-stretch" onClick={() => { void pedirPrevia('desfazer'); }} disabled={pedindo !== null} aria-busy={pedindo === 'desfazer' || undefined}>
            <Undo2 aria-hidden="true" /> Ver o que seria desfeito
          </Button>
        </section>
      </div>

      <BarraDoPasso voltar={{ rotulo: 'Provas', onClick: () => irPara('provas') }} />

      <ConfirmDialog
        aberto={Boolean(previaConcluir)}
        onOpenChange={a => { if (!a) setPreviaConcluir(null); }}
        titulo="Concluir a mudança?"
        oQueVaiAcontecer="O que veio do sistema anterior passa a seguir as regras do EnturOS, como qualquer lançamento daqui."
        previa={previaConcluir ? (
          <div className="flex flex-col gap-[var(--fin-s-2)] fin-t-body">
            {previaConcluir.liga.length ? (
              <>
                <p className="fin-t-caption text-[var(--fin-text-3)]">Volta a funcionar</p>
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[var(--fin-text)]">{previaConcluir.liga.map(l => <li key={l}>{l}</li>)}</ul>
              </>
            ) : null}
            {previaConcluir.avisos.length ? (
              <ul className="flex flex-col gap-0.5 text-[var(--fin-warning-text)]">{previaConcluir.avisos.map(a => <li key={a}>{a}</li>)}</ul>
            ) : null}
          </div>
        ) : undefined}
        confirmarRotulo="Concluir"
        voltarRotulo="Ainda não"
        processando={gravando}
        onConfirmar={concluir}
      />

      <ConfirmDialog
        aberto={Boolean(previaDesfazer)}
        onOpenChange={a => { if (!a) setPreviaDesfazer(null); }}
        titulo="Desfazer a mudança?"
        oQueVaiAcontecer="Apaga os registros abaixo, que esta mudança criou e ninguém mexeu depois. Os saldos de abertura que ela trouxe também saem."
        tone="destrutivo"
        detalhes={previaDesfazer ? previaDesfazer.apagar.map(a => ({ rotulo: ROTULO_DA_LISTA[a.tipo_lista], valor: `${contagem(a.quantidade)} a apagar` })) : undefined}
        previa={previaDesfazer && previaDesfazer.ficam.length ? (
          <div className="flex flex-col gap-1 fin-t-body text-[var(--fin-text-2)]">
            <p className="text-[var(--fin-warning-text)]">{plural(previaDesfazer.ficam.length, 'registro fica', 'registros ficam')}, porque alguém mexeu depois:</p>
            <ul className="flex flex-col gap-0.5">
              {previaDesfazer.ficam.slice(0, 5).map((r, i) => <li key={`${r.descricao}-${i}`}><span className="text-[var(--fin-text)]">{r.descricao}</span> · {r.motivo}</li>)}
            </ul>
            {previaDesfazer.ficam.length > 5 ? <p className="fin-t-caption text-[var(--fin-text-3)]">e mais {contagem(previaDesfazer.ficam.length - 5)}. A lista completa aparece depois de desfazer.</p> : null}
          </div>
        ) : undefined}
        confirmarRotulo="Desfazer"
        voltarRotulo="Manter a mudança"
        processando={gravando}
        onConfirmar={desfazer}
      />
    </>
  );
}

function TabelaDoQueFica({ linhas }: { linhas: RegistroQueFica[] }) {
  const colunas: FinColuna<RegistroQueFica>[] = [
    {
      id: 'registro', cabecalho: 'Registro', tipo: 'texto', minWidth: 240,
      render: r => (
        <span className="flex flex-col">
          {r.href
            ? <Link href={r.href} className="fin-t-body-strong text-[var(--fin-accent)] underline-offset-2 hover:underline">{r.descricao}</Link>
            : <span className="fin-t-body-strong text-[var(--fin-text)]">{r.descricao}</span>}
          <span className="fin-t-caption text-[var(--fin-text-3)]">{ROTULO_DA_LISTA[r.tipo_lista]}</span>
        </span>
      ),
    },
    { id: 'motivo', cabecalho: 'Por que ficou', tipo: 'texto', minWidth: 260, render: r => <span className={cn('fin-t-body text-[var(--fin-text-2)]')}>{r.motivo}</span> },
  ];
  return (
    <FinTable<RegistroQueFica>
      linhas={linhas}
      colunas={colunas}
      chave={r => `${r.tipo_lista}|${r.descricao}|${r.motivo}`}
      densidade="compacta"
      estado="ok"
      vazio={{ motivo: 'sem-dado', titulo: 'Nada ficou', oQueE: 'Tudo o que a mudança criou foi apagado.' }}
    />
  );
}
