'use client';

import * as React from 'react';
import { CircleAlert, Mail, MailX } from 'lucide-react';

import { Callout } from '@/components/fin/Callout';
import { Money } from '@/components/fin/Money';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { StatusChip } from '@/components/fin/StatusChip';
import { ROTULO_DESTINO, ROTULO_GATILHO, formatarReais } from '@/lib/nota-regras';
import { TRIBUTOS_RETIDOS } from '@/lib/nota-retencoes';
import { reais, type PreviaDeNotas } from './api';

type NotaDaPrevia = PreviaDeNotas['notas'][number];

const dataBR = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : 'a data da emissão');

/**
 * A prévia das notas que vão sair: para quem, quanto, por que este valor (a
 * fórmula da regra com números), o que o cliente retém e se o e-mail vai.
 * Nada é gravado até "Emitir".
 */
export function PreviaDasNotas({ previa, carregando, emitindo, podeEmitir, onFechar, onEmitir }: {
  previa: PreviaDeNotas | null;
  carregando: boolean;
  emitindo: boolean;
  podeEmitir: boolean;
  onFechar: () => void;
  onEmitir: () => Promise<void>;
}) {
  const notas = previa?.notas ?? [];
  const validas = notas.filter(n => n.valida);
  const total = validas.reduce((s, n) => s + n.valor_centavos, 0);
  const bloqueadas = notas.length - validas.length;

  return (
    <RecordSheet
      aberto={Boolean(previa) || carregando}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Prévia das notas"
      descricao="Confira para quem cada nota sai e por que tem este valor. Nada é emitido antes de você confirmar."
      largura={960}
      resumo={previa ? (
        <span className="fin-t-body text-[var(--fin-text-2)]">
          {validas.length
            ? <>Vão sair <strong className="text-[var(--fin-text)]">{validas.length} {validas.length === 1 ? 'nota' : 'notas'}</strong>, somando <strong className="text-[var(--fin-text)]">{formatarReais(total)}</strong>.</>
            : 'Nenhuma nota pode sair como está.'}
          {bloqueadas ? ` ${bloqueadas} com pendência ${bloqueadas === 1 ? 'fica' : 'ficam'} de fora.` : ''}
        </span>
      ) : null}
      acaoPrimaria={{
        rotulo: validas.length ? `Emitir ${validas.length} ${validas.length === 1 ? 'nota' : 'notas'}` : 'Emitir',
        onClick: onEmitir,
        carregando: emitindo,
        desabilitado: !podeEmitir || !validas.length || Boolean(previa?.pendencias_gerais.length),
      }}
      acaoSecundaria={{ rotulo: 'Voltar', onClick: onFechar }}
    >
      {!previa ? (
        <p role="status" className="fin-t-body text-[var(--fin-text-3)]">Montando a prévia…</p>
      ) : (
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          {previa.pendencias_gerais.length ? (
            <Callout tom="negativo" titulo="A configuração fiscal impede a emissão">
              <ul className="list-disc pl-5">{previa.pendencias_gerais.map(p => <li key={p}>{p}</li>)}</ul>
            </Callout>
          ) : null}
          {notas.length === 0 ? (
            <p className="fin-t-body text-[var(--fin-text-2)]">Os produtos marcados não têm saldo a emitir pela regra.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)]">
              {notas.map(n => <ItemDaPrevia key={n.chave} n={n} />)}
            </ol>
          )}
          {previa.cancelar.length ? (
            <Callout tom="aviso" titulo={`${previa.cancelar.length === 1 ? 'Uma nota destas vendas passa' : `${previa.cancelar.length} notas destas vendas passam`} da receita`}>
              Elas aparecem em &ldquo;Notas para cancelar&rdquo;, na tela anterior. Emitir agora não cancela nada.
            </Callout>
          ) : null}
        </div>
      )}
    </RecordSheet>
  );
}

function ItemDaPrevia({ n }: { n: NotaDaPrevia }) {
  const r = n.retencoes;
  const liquido = n.valor_centavos - (r?.total ?? 0) - (r?.reter_iss ? n.valor_iss : 0);
  return (
    <li className="flex flex-col gap-[var(--fin-s-2)] p-[var(--fin-s-4)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--fin-s-3)]">
        <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
          <span className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">{ROTULO_DESTINO[n.destino]}</span>
            {n.complementar ? <StatusChip dominio="nota" valor="COMPLEMENTAR" /> : null}
          </span>
          <span className="fin-t-body text-[var(--fin-text)]">
            {n.tomador_nota?.razao_social || n.tomador?.nome || 'Sem tomador'}
            {n.tomador_nota?.cpf_cnpj ? <span className="fin-t-caption text-[var(--fin-text-3)]"> · {n.tomador_nota.cpf_cnpj}</span> : null}
          </span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">Venda {n.venda_numero} · regra {n.regra_descricao} · {ROTULO_GATILHO[n.gatilho].toLowerCase()}</span>
        </div>
        <Money valor={reais(n.valor_centavos)} size="metricSm" className="shrink-0" />
      </div>

      <dl className="grid grid-cols-1 gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-1)] sm:grid-cols-[10rem_1fr]">
        <dt className="fin-t-caption text-[var(--fin-text-3)]">Por que este valor</dt>
        <dd className="fin-t-body text-[var(--fin-text-2)]">
          {n.itens.map(i => <span key={i.produto_id} className="block tabular-nums">{i.descricao ? `${i.descricao}: ` : ''}{i.formula}</span>)}
        </dd>
        {r && (r.total > 0 || r.reter_iss) ? (
          <>
            <dt className="fin-t-caption text-[var(--fin-text-3)]">Retido na fonte</dt>
            <dd className="fin-t-body tabular-nums text-[var(--fin-text-2)]">
              {TRIBUTOS_RETIDOS.filter(t => r.por_tributo[t] > 0).map(t => `${t} ${formatarReais(r.por_tributo[t])}`).join(' · ') || 'Nenhum tributo federal'}
              {r.reter_iss ? ` · ISS ${formatarReais(n.valor_iss)}` : ''}
              <span className="block text-[var(--fin-text)]">O cliente paga {formatarReais(liquido)} por esta nota.</span>
            </dd>
          </>
        ) : null}
        {n.dispensas.length ? (
          <>
            <dt className="fin-t-caption text-[var(--fin-text-3)]">Não retido</dt>
            <dd className="fin-t-body text-[var(--fin-text-2)]">{n.dispensas.join(' ')}</dd>
          </>
        ) : null}
        <dt className="fin-t-caption text-[var(--fin-text-3)]">Data da nota</dt>
        <dd className="fin-t-body tabular-nums text-[var(--fin-text-2)]">
          {dataBR(n.data_nota)}
          {n.aviso_data ? <span className="block fin-t-caption text-[var(--fin-warning-text)]">{n.aviso_data}</span> : null}
        </dd>
        <dt className="fin-t-caption text-[var(--fin-text-3)]">Texto da nota</dt>
        <dd className="fin-t-body text-[var(--fin-text-2)]">{n.discriminacao}</dd>
        <dt className="fin-t-caption text-[var(--fin-text-3)]">ISS</dt>
        <dd className="fin-t-body tabular-nums text-[var(--fin-text-2)]">
          {formatarReais(n.valor_iss)} ({n.aliquota_iss.toLocaleString('pt-BR')}%){n.iss_e_estimativa ? ', estimativa: quem calcula é a prefeitura' : ''}
        </dd>
        <dt className="fin-t-caption text-[var(--fin-text-3)]">E-mail</dt>
        <dd className="flex items-start gap-[var(--fin-s-1)] fin-t-body text-[var(--fin-text-2)]">
          {n.envio.pedido
            ? <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-positive)]" />
            : <MailX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />}
          {n.envio.motivo}
        </dd>
      </dl>

      {n.pendencias.length ? (
        <div role="alert" className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>Esta nota não sai: {n.pendencias.join(' ')}</span>
        </div>
      ) : null}
    </li>
  );
}
