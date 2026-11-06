'use client';

import * as React from 'react';
import { CheckCircle2, DoorOpen, Play, ShieldCheck } from 'lucide-react';

import { Callout } from '@/components/fin/Callout';
import { ChecklistViva, type ItemDaChecklist } from '@/components/fin/ChecklistViva';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { api, chaveDeIdempotencia, type FiltroDoEnsaio, type ProgressoDoLote } from '@/lib/migracao/contrato-telas';
import {
  bloqueioDoEnsaio, dataBR, intervaloDoProgresso, jaAplicou, percentual, resumoNaOrdem, totaisDoEnsaio,
} from '@/lib/migracao/telas/assistente';
import { ROTULO_DA_LISTA } from '@/lib/migracao/telas/listas';
import { toast } from '@/lib/toast';

import { BarraDoPasso, CabecaDoPasso, PAINEL, contagem, plural, textoDoErro, type PropsDoPasso } from '../pecas';

/**
 * Passo 5 · Aplicar. Antes: o resumo do que vai ser gravado e a confirmação.
 * Durante: a barra de progresso e cada lista andando, em blocos pela fila do
 * servidor (pode fechar a tela). Depois: segue para as provas.
 */
export function PassoAplicar({ lote, onLote, irPara, onVerNoEnsaio }: PropsDoPasso & { onVerNoEnsaio: (f: FiltroDoEnsaio) => void }) {
  const [confirmar, setConfirmar] = React.useState(false);
  const [aplicando, setAplicando] = React.useState(false);
  const [progresso, setProgresso] = React.useState<ProgressoDoLote | null>(null);
  const chave = React.useRef(chaveDeIdempotencia());
  const loteId = lote?.id;
  const situacao = lote?.situacao;
  const gravou = jaAplicou(lote);

  // Pergunta o progresso enquanto grava; uma vez quando já terminou (para
  // mostrar cada lista concluída). Espaça as perguntas com o tempo.
  React.useEffect(() => {
    if (!loteId || !gravou) return;
    let vivo = true;
    let tentativa = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function perguntar() {
      try {
        const p = await api.progresso(loteId!);
        if (!vivo) return;
        setProgresso(p);
        if (p.situacao !== 'aplicando') {
          if (p.situacao !== situacao) onLote(await api.lote(loteId!));
          return;
        }
      } catch { /* a próxima pergunta tenta de novo */ }
      if (vivo) timer = setTimeout(perguntar, intervaloDoProgresso(tentativa++));
    }
    void perguntar();
    return () => { vivo = false; if (timer) clearTimeout(timer); };
  }, [loteId, gravou, situacao, onLote]);

  if (!lote) return null;

  async function aplicar() {
    if (!lote) return;
    setAplicando(true);
    try {
      // A assinatura do ensaio garante que grava exatamente o que foi visto.
      const { assinatura } = await api.ensaio(lote.id, { pagina: 1, por_pagina: 1 });
      onLote(await api.aplicar(lote.id, assinatura, chave.current));
      setConfirmar(false);
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setAplicando(false);
    }
  }

  const t = totaisDoEnsaio(lote.resumo_do_ensaio);

  if (!gravou) {
    const bloqueio = bloqueioDoEnsaio(lote);
    return (
      <>
        <CabecaDoPasso id="passo-aplicar" titulo="Aplicar a mudança">
          Ao aplicar, o EnturOS grava o que o ensaio mostrou, em blocos, na ordem das listas. Você acompanha aqui e pode fechar a tela no meio.
        </CabecaDoPasso>

        <div className={`${PAINEL} grid grid-cols-1 gap-[var(--fin-s-5)] p-[var(--fin-s-5)] lg:grid-cols-2`}>
          <div className="flex flex-col gap-[var(--fin-s-3)]">
            <h3 className="fin-t-body-strong text-[var(--fin-text)]">O que vai ser gravado</h3>
            <ul className="flex flex-col gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)]">
              {resumoNaOrdem(lote.resumo_do_ensaio).map(r => (
                <li key={r.tipo_lista} className="flex items-baseline justify-between gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] pb-[var(--fin-s-2)] last:border-0">
                  <span>{ROTULO_DA_LISTA[r.tipo_lista]}</span>
                  <span className="text-right tabular-nums text-[var(--fin-text-2)]">
                    {contagem(r.criar)} novos · {contagem(r.vincular)} ligados
                  </span>
                </li>
              ))}
            </ul>
            {t.recusar ? (
              <p className="fin-t-body text-[var(--fin-text-2)]">
                {plural(t.recusar, 'linha recusada fica', 'linhas recusadas ficam')} de fora.{' '}
                <button type="button" onClick={() => onVerNoEnsaio({ resultado: 'recusar' })} className="text-[var(--fin-accent)] underline-offset-2 hover:underline">
                  Ver os motivos
                </button>
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-[var(--fin-s-3)]">
            <h3 className="fin-t-body-strong text-[var(--fin-text)]">O que fica garantido</h3>
            <ul className="flex flex-col gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
              <li className="flex items-start gap-[var(--fin-s-2)]"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-positive)]" />Os saldos de abertura entram na data de corte, {dataBR(lote.data_corte)}, sem mexer no que já foi lançado aqui.</li>
              <li className="flex items-start gap-[var(--fin-s-2)]"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-positive)]" />Durante a mudança nada sai: nenhuma cobrança, WhatsApp, nota fiscal, comissão ou aviso ao CRM.</li>
              <li className="flex items-start gap-[var(--fin-s-2)]"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-positive)]" />Tudo o que for criado guarda de qual arquivo e linha veio, e pode ser desfeito.</li>
            </ul>
          </div>
        </div>

        <BarraDoPasso
          voltar={{ rotulo: 'Ensaio', onClick: () => irPara('ensaio') }}
          bloqueio={bloqueio}
          principal={{ rotulo: 'Aplicar a mudança', icone: Play, onClick: () => setConfirmar(true) }}
        />

        <ConfirmDialog
          aberto={confirmar}
          onOpenChange={setConfirmar}
          titulo="Aplicar a mudança agora?"
          oQueVaiAcontecer="O EnturOS grava as contas, categorias, pessoas, contas em aberto e saldos exatamente como no ensaio. Enquanto a mudança não for concluída, nada sai para clientes, fornecedores ou o CRM. Dá para desfazer depois."
          detalhes={[
            { rotulo: 'Data de corte', valor: dataBR(lote.data_corte) },
            { rotulo: 'Serão criados', valor: contagem(t.criar) },
            { rotulo: 'Ligam com o que já existe', valor: contagem(t.vincular) },
            { rotulo: 'Recusados (ficam de fora)', valor: contagem(t.recusar) },
          ]}
          confirmarRotulo="Aplicar"
          voltarRotulo="Ainda não"
          processando={aplicando}
          onConfirmar={aplicar}
        />
      </>
    );
  }

  const feitos = progresso?.feitos ?? 0;
  const total = progresso?.total ?? t.criar + t.vincular;
  const pct = situacao === 'aplicando' ? percentual(feitos, total) : situacao === 'falhou' ? percentual(feitos, total) : 100;
  const itens: ItemDaChecklist[] = (progresso?.etapas ?? []).map(e => ({
    chave: e.tipo_lista,
    titulo: ROTULO_DA_LISTA[e.tipo_lista],
    estado: e.situacao,
    detalhe: e.erro ?? `${contagem(e.feitos)} de ${contagem(e.total)}`,
  }));
  const erro = progresso?.erro ?? lote.erro;

  return (
    <>
      <CabecaDoPasso id="passo-aplicar" titulo={situacao === 'aplicando' ? 'Gravando a mudança' : situacao === 'falhou' ? 'A gravação parou' : 'Mudança aplicada'}>
        {situacao === 'aplicando'
          ? 'Cada lista entra em blocos, na ordem. Esta tela atualiza sozinha.'
          : situacao === 'falhou'
            ? 'Parte foi gravada e parte não. Nada sai enquanto a mudança não for concluída.'
            : 'Tudo o que o ensaio mostrou foi gravado. Agora confira as provas.'}
      </CabecaDoPasso>

      <div className={`${PAINEL} flex flex-col gap-[var(--fin-s-4)] p-[var(--fin-s-5)]`}>
        <div className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
          <span className="fin-t-body text-[var(--fin-text-2)]">
            <span className="tabular-nums text-[var(--fin-text)]">{contagem(Math.min(feitos, total))}</span> de <span className="tabular-nums">{contagem(total)}</span> registros
          </span>
          <span className="fin-t-metric-sm tabular-nums text-[var(--fin-text)]">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Progresso da gravação"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 w-full overflow-hidden rounded-full bg-[var(--fin-surface-2)]"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-[var(--fin-dur-base)] ease-[var(--fin-curva)] ${situacao === 'falhou' ? 'bg-[var(--fin-negative)]' : situacao === 'aplicando' ? 'bg-[var(--fin-accent)]' : 'bg-[var(--fin-positive)]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {itens.length ? <ChecklistViva itens={itens} /> : null}
      </div>

      {situacao === 'aplicando' ? (
        <Callout tom="info" titulo="Pode fechar a tela">
          A gravação continua no servidor. Quando você voltar a Mudar para o EnturOS, o assistente abre aqui, onde parou.
        </Callout>
      ) : null}

      {situacao === 'falhou' ? (
        <Callout tom="negativo" titulo="A gravação não terminou" acao={{ rotulo: 'Desfazer o que foi gravado', onClick: () => irPara('concluir') }}>
          {erro ?? 'O servidor parou no meio.'} O que entrou guarda o arquivo e a linha de origem e pode ser desfeito.
        </Callout>
      ) : null}

      {situacao !== 'aplicando' && situacao !== 'falhou' ? (
        <BarraDoPasso
          extra={<span className="inline-flex items-center gap-1 fin-t-caption text-[var(--fin-positive)]"><CheckCircle2 aria-hidden="true" className="size-3.5" /> Aplicada</span>}
          principal={{ rotulo: 'Ver as provas', onClick: () => irPara('provas') }}
        />
      ) : null}
      {situacao === 'aplicando' ? (
        <p className="flex items-center gap-1.5 fin-t-caption text-[var(--fin-text-3)]"><DoorOpen aria-hidden="true" className="size-3.5" /> Nada mais a fazer agora: as provas aparecem quando a gravação terminar.</p>
      ) : null}
    </>
  );
}
