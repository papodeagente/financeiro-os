'use client';

import * as React from 'react';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { Money } from '@/components/fin/Money';
import { Field } from '@/components/fin/Field';
import { Textarea } from '@/components/ui/textarea';
import { chaveDeIdempotencia } from '@/lib/cobranca/contrato-telas';
import { dataBR } from '@/lib/cobranca/regras-telas';
import { rotuloDaNegativacao } from '@/lib/cobranca/negativacao';
import { toast } from '@/lib/toast';

/**
 * Negativar (Serasa) uma cobrança vencida do Asaas (E7, 06/11/2026).
 *
 * Nunca automática: a janela abre a prévia (o provedor simula se pode, a
 * taxa e quando começa; o cadastro do cliente é conferido) e só o botão
 * grava, com a assinatura da prévia. Com negativação já pedida, a mesma
 * janela mostra a situação, atualiza e cancela (quando o provedor deixa).
 */

interface Previa {
  cobranca_id: string;
  valor_centavos: number;
  vencimento: string;
  pode: boolean;
  motivos: string[];
  faltas: string[];
  simulacao: { permitida: boolean; taxa_centavos: number; liquido_centavos: number; inicio_previsto: string } | null;
  atual: { id: string; status: string; numero: string; taxa_centavos: number; pode_cancelar: boolean; motivo_recusa: string; pedida_em: string; pedida_por: string } | null;
  atual_rotulo: string;
  assinatura: string;
}

async function chamar<T>(url: string, init?: RequestInit & { chave?: string }): Promise<T> {
  const { chave, ...resto } = init ?? {};
  const r = await fetch(url, {
    ...resto,
    headers: { ...(resto.body ? { 'Content-Type': 'application/json' } : {}), ...(chave ? { 'Idempotency-Key': chave } : {}) },
    cache: 'no-store',
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((corpo as { error?: string }).error || 'Não foi possível concluir agora.');
  return corpo as T;
}

const VIVA = ['PEDINDO', 'PENDING', 'AWAITING_APPROVAL', 'AWAITING_CANCELLATION', 'PROCESSED', 'PARTIALLY_PAID'];

export function NegativarCobranca({ cobrancaId, clienteNome, onFechar, onMudou }: {
  /** null fecha a janela. */
  cobrancaId: string | null;
  clienteNome: string;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [gravando, setGravando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [motivo, setMotivo] = React.useState('');
  const chave = React.useRef('');

  const carregar = React.useCallback((id: string) => {
    let vivo = true;
    setPrevia(null); setErro(null);
    chamar<Previa>(`/api/cobrancas/${encodeURIComponent(id)}/negativacao`)
      .then(p => { if (vivo) setPrevia(p); })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'A prévia não respondeu.'); });
    return () => { vivo = false; };
  }, []);

  React.useEffect(() => {
    if (!cobrancaId) return;
    chave.current = chaveDeIdempotencia();
    setCancelando(false); setMotivo('');
    return carregar(cobrancaId);
  }, [cobrancaId, carregar]);

  const atual = previa?.atual ?? null;
  const viva = Boolean(atual && VIVA.includes(atual.status));

  async function acao(corpo: Record<string, unknown>, sucesso: [string, string]) {
    if (!cobrancaId || gravando) return;
    setGravando(true); setErro(null);
    try {
      await chamar(`/api/cobrancas/${encodeURIComponent(cobrancaId)}/negativacao`, { method: 'POST', body: JSON.stringify(corpo), chave: chave.current });
      toast.success(sucesso[0], sucesso[1]);
      onMudou();
      if (corpo.acao === 'negativar' || corpo.acao === 'cancelar') onFechar();
      else carregar(cobrancaId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir agora.');
    } finally {
      setGravando(false);
    }
  }

  const primaria = viva
    ? cancelando
      ? { rotulo: 'Cancelar a negativação', onClick: () => acao({ acao: 'cancelar', motivo }, ['Cancelamento pedido', 'O provedor tira o nome do cliente do Serasa; pode levar alguns dias.']), carregando: gravando, desabilitado: motivo.trim().length < 3 }
      : { rotulo: 'Atualizar a situação', onClick: () => acao({ acao: 'atualizar' }, ['Situação atualizada', 'Lida agora no provedor.']), carregando: gravando }
    : { rotulo: 'Negativar no Serasa', onClick: () => acao({ acao: 'negativar', assinatura: previa?.assinatura }, ['Negativação pedida', 'O provedor confere os dados e envia ao Serasa. Acompanhe a situação nesta cobrança.']), carregando: gravando, desabilitado: !previa?.pode };

  const sim = previa?.simulacao ?? null;
  return (
    <RecordSheet
      aberto={cobrancaId !== null}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={viva ? 'Negativação no Serasa' : 'Negativar no Serasa'}
      descricao={viva
        ? 'A situação vem do provedor. Cancelar só é possível enquanto ele permite.'
        : 'O nome do cliente vai para o Serasa pelo Asaas da agência. Nada é pedido até você confirmar.'}
      largura={640}
      resumo={!viva && previa?.pode && sim
        ? <>{clienteNome || 'O cliente'} será negativado pela cobrança de <Money valor={previa.valor_centavos / 100} size="body" align="esquerda" className="inline-block min-w-0" estado="ok" /> vencida em {dataBR(previa.vencimento)}. O provedor cobra <Money valor={sim.taxa_centavos / 100} size="body" align="esquerda" className="inline-block min-w-0" estado="ok" />{sim.inicio_previsto ? <> e começa por volta de {dataBR(sim.inicio_previsto)}</> : null}.</>
        : undefined}
      acaoPrimaria={primaria}
      acaoSecundaria={viva && !cancelando && atual?.pode_cancelar
        ? { rotulo: 'Quero cancelar', onClick: () => setCancelando(true) }
        : { rotulo: 'Voltar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        {!previa && !erro ? (
          <div aria-busy="true" className="flex flex-col gap-[var(--fin-s-2)]">
            <span className="block h-5 w-56 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
            <span className="block h-16 animate-pulse rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
            <span className="sr-only" role="status">Consultando o provedor.</span>
          </div>
        ) : null}

        {previa && atual ? (
          <dl className="grid grid-cols-2 gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-2)] fin-t-body">
            <div className="flex flex-col">
              <dt className="fin-t-caption text-[var(--fin-text-3)]">Situação</dt>
              <dd className="text-[var(--fin-text)]">{rotuloDaNegativacao(atual.status)}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="fin-t-caption text-[var(--fin-text-3)]">Pedida</dt>
              <dd className="tabular-nums text-[var(--fin-text)]">{atual.pedida_em ? dataBR(atual.pedida_em.slice(0, 10)) : '—'}{atual.pedida_por ? ` · ${atual.pedida_por}` : ''}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="fin-t-caption text-[var(--fin-text-3)]">Taxa do provedor</dt>
              <dd><Money valor={atual.taxa_centavos / 100} size="body" align="esquerda" estado="ok" /></dd>
            </div>
            {atual.numero ? (
              <div className="flex flex-col">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Número no provedor</dt>
                <dd className="tabular-nums text-[var(--fin-text)]">{atual.numero}</dd>
              </div>
            ) : null}
            {atual.motivo_recusa ? <p className="col-span-2 fin-t-caption text-[var(--fin-text-2)]">{atual.motivo_recusa}</p> : null}
          </dl>
        ) : null}

        {previa && !viva ? (
          <>
            {previa.motivos.length ? (
              <ul className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-warning-text)]">
                {previa.motivos.map(m => <li key={m}>{m}</li>)}
              </ul>
            ) : null}
            {previa.faltas.length ? (
              <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-warning-text)]">
                O Serasa exige o cadastro completo do cliente. Falta: {previa.faltas.join(', ')}. Complete a ficha do cliente e abra de novo.
              </p>
            ) : null}
            {sim?.permitida ? (
              <dl className="grid grid-cols-2 gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-2)] fin-t-body">
                <div className="flex flex-col">
                  <dt className="fin-t-caption text-[var(--fin-text-3)]">Taxa do provedor</dt>
                  <dd><Money valor={sim.taxa_centavos / 100} size="body" align="esquerda" estado="ok" /></dd>
                </div>
                <div className="flex flex-col">
                  <dt className="fin-t-caption text-[var(--fin-text-3)]">Início previsto</dt>
                  <dd className="tabular-nums text-[var(--fin-text)]">{sim.inicio_previsto ? dataBR(sim.inicio_previsto) : 'O provedor não informou'}</dd>
                </div>
              </dl>
            ) : null}
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Se o cliente pagar, a cobrança é baixada como sempre e o provedor tira o nome dele do Serasa. A conta Asaas precisa estar liberada para negativar pela integração.
            </p>
          </>
        ) : null}

        {viva && cancelando ? (
          <Field rotulo="Motivo do cancelamento" ajuda="Fica no histórico da cobrança.">
            {a => (
              <Textarea {...a} rows={3} maxLength={300} value={motivo} onChange={e => setMotivo(e.target.value)}
                className="rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body" />
            )}
          </Field>
        ) : null}

        {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
      </div>
    </RecordSheet>
  );
}
